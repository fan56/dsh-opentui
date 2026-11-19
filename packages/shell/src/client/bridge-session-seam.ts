/**
 * BridgeSessionSeam — the `SessionSeam` backed by the in-process host bridge
 * (ADR-0009 方案 D / ADR-0010 IPC contract). The bridge runs as a cordis
 * bundle inside the node host and speaks stdio JSON-lines; this seam is the
 * bun-side client of that protocol.
 *
 * SCOPE (first batch, 12 members — tickets/2026-11-18-seam-capability-matrix.md):
 *   COVERED  currentSessionId / resumeSession / newSession / dispose
 *   PARTIAL  status / storedTranscript / turn / interrupt /
 *            currentModelSelection / usageSummary / onSessionEvent / listSessions
 * The remaining 7 members exist only to satisfy `implements SessionSeam` and
 * are honest D3 stubs (async → UNSUPPORTED, sync → degrade + log) until their
 * own bridge frames land in a later batch. This file does NOT switch the
 * default seam, does NOT add fail-fast, and does NOT touch `--remote` (T9/T10).
 *
 * DEGRADE LAW (ticket §6 D3, non-negotiable):
 *   - A sync-signature member whose bridge capability is absent returns a
 *     contract-valid degraded value and logs through `ctx.logger`. It NEVER
 *     throws — throwing on the render path would break the view.
 *   - An async member whose capability is absent rejects with a protocol
 *     error carrying `code === "UNSUPPORTED"`. It never silently resolves
 *     with fake data (notably `listSessions`: a UNSUPPORTED frame is passed
 *     through, NOT flattened to `[]`).
 *
 * The stdio transport (spawning the host with DSH_OPENTUI_BRIDGE_STDIO=1,
 * correlating {id} responses, forwarding {type,payload} events) is injected
 * as `BridgeTransport` — wiring it at the composition root is a separate
 * task. Keeping it injected makes every degrade path unit-testable without a
 * live host.
 */

import type {
	BridgeLinkStatus,
	SeamApprovalVerdict,
	SeamAskPick,
	SeamAskQuestion,
	SeamPermissionCatalog,
	SeamProviderModel,
	SeamSessionEvent,
	SeamSessionInfo,
	SeamSessionSummary,
	SeamStatus,
	SeamSubagentView,
	SeamTranscriptRow,
	SeamTurnCallbacks,
	SessionSeam,
} from "../../../tui-base/src/seams/session"
import type { RemoteJournalEntry } from "./remote-session-ops.ts"
import { journalToTranscriptRows } from "./remote-session-ops.ts"
import { projectJournalRecord } from "./session-seam-adapter.ts"
import { tokensPerSecond } from "../agent/loop.ts"

// ---------------------------------------------------------------------------
// Injected transport surface (ADR-0010 frame shapes)
// ---------------------------------------------------------------------------

/** A decoded `response{ok:false,error}` frame. `code` is the ADR-0010 code. */
export class BridgeProtocolError extends Error {
	readonly code: string
	readonly detail?: unknown

	constructor(code: string, message: string, detail?: unknown) {
		super(message)
		this.name = "BridgeProtocolError"
		this.code = code
		if (detail !== undefined) this.detail = detail
	}
}

/** One `event{type,payload}` frame from the bridge. */
export interface BridgeEventFrame {
	type: string
	payload: unknown
}

/**
 * Stage at which the bridge reached DEAD (ADR-0010 DEAD recovery, A1).
 * `spawn` = the child never started, `handshake` = hello/ping rejected,
 * `runtime` = a live child exited/was signalled, `closed` = deliberate teardown.
 */
export type BridgeDeadStage = "spawn" | "handshake" | "runtime" | "closed"

/** Structured cause of the current DEAD transition (A1), republished on the
 *  existing `onEvent` pipeline as a `bridge.dead` frame. A3: a successful
 *  recover() clears it; a new DEAD (including a failed recovery) replaces it. */
export interface BridgeDeadCause {
	stage: BridgeDeadStage
	/** Process exit code on a runtime exit; null when unavailable. */
	code: number | null
	/** Terminating signal on a runtime exit; null when unavailable. */
	signal: string | null
	/** Short human-readable summary. */
	message: string
	/** A3: `permanent` means another recover() cannot help (a version /
	 *  fingerprint / host-compat mismatch). Absent/`retriable` means a manual
	 *  retry may succeed. */
	recoverability?: "permanent" | "retriable"
	/** A3: the concrete items that failed a recovery handshake, e.g.
	 *  `["VERSION_INCOMPATIBLE"]`. */
	mismatches?: string[]
}

/** The minimal client half of the stdio bridge, injected by the caller. */
export interface BridgeTransport {
	/** Send `request{id,method,params}`; resolve with `result`, reject with a
	 *  `BridgeProtocolError` when the response frame is `ok:false`. */
	request(method: string, params?: Record<string, unknown>): Promise<unknown>
	/** Subscribe to `event{type,payload}` frames; returns a disposer. */
	onEvent(listener: (event: BridgeEventFrame) => void): () => void
}

/** `ctx.logger` — the host logger shape (info/warn/error), structural so the
 *  seam does not import the bridge package at runtime. */
export interface BridgeSeamLogger {
	info(message: string, ...args: unknown[]): void
	warn(message: string, ...args: unknown[]): void
	error(message: string, ...args: unknown[]): void
}

export interface BridgeSeamContext {
	logger: BridgeSeamLogger
}

/**
 * ADR-0011 T8/Q4: a stable machine code for WHY the bridge seam could not
 * confirm an approval provider. A code (not prose) keeps localization in the
 * composition root's i18n layer instead of baking English into the shell seam.
 */
export type PermissionUnavailableReason = "no-provider" | "bridge-offline" | "ask-no-provider"

export interface BridgeSessionSeamOptions {
	transport: BridgeTransport
	ctx: BridgeSeamContext
	/** A2: called synchronously once when a `bridge.dead` frame arrives, even
	 *  with no in-flight turn (the idle-period crash case). The composition
	 *  root turns this into an immediate transient UI notice. */
	onDead?: (cause: BridgeDeadCause) => void
	/** ADR-0011 T8/Q4: called at most ONCE per process from `permissionCatalog()`
	 *  when no approval provider can be confirmed. The composition root turns
	 *  this into a transient (never persistent) localized fail-closed notice. */
	onPermissionUnavailable?: (reason: PermissionUnavailableReason) => void
}

// ---------------------------------------------------------------------------
// ADR-0011 ask frames (host → client events, client → host ask.response)
// ---------------------------------------------------------------------------

/** One `ask.request` payload, structurally mirrored from ADR-0011 §3.2. Kept
 *  local to the shell client so this file never imports the bridge package at
 *  runtime (same rule as BridgeTransport above). */
export interface BridgeAskRequestPayload {
	eventId: string
	sessionId: string
	kind: "approval" | "questions"
	toolName?: string
	callId?: string
	reason?: string
	questions?: SeamAskQuestion[]
	deadlineAt?: number
	detachGraceMs?: number
	escalation?: boolean
}

/** Derive the turn id from the ADR-0011 association key `${turnId}:ask-${seq}`. */
function askTurnId(eventId: string): string {
	const i = eventId.lastIndexOf(":ask-")
	return i === -1 ? "" : eventId.slice(0, i)
}

function optionalStringField(row: Record<string, unknown>, key: string): string | undefined {
	const value = row[key]
	return typeof value === "string" && value !== "" ? value : undefined
}

/** Parse an `ask.request` payload. Returns undefined for malformed frames —
 *  a bad ask frame must never poison the pending queue or throw on the event
 *  pump (the seam's event path is shared with the render loop). */
function parseAskRequest(value: unknown): BridgeAskRequestPayload | undefined {
	const row = asRecord(value)
	const eventId = optionalStringField(row, "eventId")
	const sessionId = optionalStringField(row, "sessionId")
	const kind = row.kind
	if (eventId === undefined || sessionId === undefined || (kind !== "approval" && kind !== "questions")) {
		return undefined
	}
	const out: BridgeAskRequestPayload = { eventId, sessionId, kind }
	for (const key of ["toolName", "callId", "reason"] as const) {
		const v = optionalStringField(row, key)
		if (v !== undefined) out[key] = v
	}
	for (const key of ["deadlineAt", "detachGraceMs"] as const) {
		const v = row[key]
		if (typeof v === "number" && Number.isFinite(v)) out[key] = v
	}
	if (row.escalation === true) out.escalation = true
	if (Array.isArray(row.questions)) {
		const questions: SeamAskQuestion[] = []
		for (const raw of row.questions) {
			const q = asRecord(raw)
			const id = optionalStringField(q, "id")
			const prompt = optionalStringField(q, "prompt")
			if (id === undefined || prompt === undefined || !Array.isArray(q.options)) continue
			const options: SeamAskQuestion["options"] = []
			for (const rawOpt of q.options) {
				const opt = asRecord(rawOpt)
				const label = optionalStringField(opt, "label")
				if (label === undefined) continue
				const description = optionalStringField(opt, "description")
				options.push({ label, ...(description !== undefined ? { description } : {}) })
			}
			if (options.length === 0) continue
			const question: SeamAskQuestion = { id, prompt, options }
			for (const key of ["header", "description", "detail"] as const) {
				const v = optionalStringField(q, key)
				if (v !== undefined) question[key] = v
			}
			if (q.multiSelect === true) question.multiSelect = true
			questions.push(question)
		}
		if (questions.length > 0) out.questions = questions
	}
	return out
}

/** `SeamApprovalVerdict` plus the two escalated behaviors the wire exposes.
 *  `onApprove`'s real type only promises the first two; the latter two are
 *  handled defensively (a view/caller may widen it) and gated on the ask's
 *  `escalation` flag before a frame is ever sent (ASK_INVALID_RESPONSE). */
type BridgeApproveVerdict = SeamApprovalVerdict | "always" | "session"

/** Args passed to `onApprove(name, args)` — the ask.request wire carries no
 *  tool arguments, so surface the identifying fields the host did send. */
function approvalArgs(request: BridgeAskRequestPayload): Record<string, unknown> {
	return {
		...(request.callId !== undefined ? { callId: request.callId } : {}),
		...(request.reason !== undefined ? { reason: request.reason } : {}),
	}
}

/** A registered ask provider answers an approval ask via a synthesized
 *  allow/deny question (the default-surface fallback when no turn-scoped
 *  onApprove is active). Real approvals should go through onApprove. */
function approvalQuestion(request: BridgeAskRequestPayload): SeamAskQuestion {
	const toolName = request.toolName ?? "tool"
	return {
		id: request.eventId,
		prompt: request.reason ?? `Allow ${toolName}?`,
		options: [{ label: "allow" }, { label: "deny" }],
		header: "Approval",
		...(request.callId !== undefined ? { detail: `callId: ${request.callId}` } : {}),
	}
}

function approvalVerdictFromPicks(request: BridgeAskRequestPayload, picks: SeamAskPick[]): BridgeApproveVerdict {
	const pick = picks.find((p) => p.questionId === request.eventId)
	const choice = pick?.custom ?? pick?.selections?.[0] ?? pick?.selected ?? ""
	return /^(allow|allowed-once|yes|approve)$/i.test(choice) ? "allowed-once" : "rejected"
}

/** Map SeamAskPick[] → the wire `{id, selected[], custom?}` answers shape,
 *  mirroring remote-waterfall.ts:206-223 `answersValue` exactly: custom wins,
 *  missing/empty picks become `{selected:[],custom:"declined"}`, multi-select
 *  rides `selections` with `selected` as the first pick. */
function answersFor(request: BridgeAskRequestPayload, picks: SeamAskPick[]): { id: string; selected: string[]; custom?: string }[] {
	const questions = request.questions ?? []
	if (questions.length === 0) {
		return picks.map((pick) => ({
			id: pick.questionId,
			selected: pick.selections?.length ? [...pick.selections] : [pick.selected],
			...(pick.custom !== undefined && pick.custom !== "" ? { custom: pick.custom } : {}),
		}))
	}
	return questions.map((q) => {
		const pick = picks.find((p) => p.questionId === q.id)
		if (pick?.custom !== undefined && pick.custom !== "") return { id: q.id, selected: [], custom: pick.custom }
		if (pick === undefined || (pick.selected === "" && (pick.custom ?? "") === "")) {
			return { id: q.id, selected: [], custom: "declined" }
		}
		return {
			id: q.id,
			selected: pick.selections?.length ? [...pick.selections] : [pick.selected],
		}
	})
}

/** Fail-closed response for a provider-less ask: `verdict:"unavailable"` per
 *  ADR-0011 §5 ASK_CHANNEL_UNAVAILABLE (never a silent approve). Questions
 *  additionally carry declined answers because the host rejects a questions
 *  response with no answers (ask-registry.ts:310). */
function unavailableResponse(request: BridgeAskRequestPayload): Record<string, unknown> {
	return request.kind === "questions"
		? { eventId: request.eventId, kind: "questions", verdict: "unavailable", answers: answersFor(request, []) }
		: { eventId: request.eventId, kind: "approval", verdict: "unavailable" }
}

// ---------------------------------------------------------------------------
// Pure helpers / projections (unit-tested standalone)
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {}
}

/** Build the honest UNSUPPORTED rejection for an absent async capability. */
function unsupported(capability: string): never {
	throw new BridgeProtocolError(
		"UNSUPPORTED",
		`${capability} is not backed by the in-process bridge`,
		{ capability },
	)
}

/**
 * `session.list` wire rows → `SeamSessionSummary[]`.
 *
 * Mirrors remote-session-ops.ts:271-305 (retention filter, origin subagent out,
 * title at `projections.values.title` sliced to 40, cwd/sizeBytes/blank
 * pass-through, updatedAt-desc sort, `slice(0, limit)`) and
 * session-seam-adapter.ts:174-184 (RemoteSessionRow → SeamSessionSummary).
 * The seam has no `retentionDays` arm, so the cutoff is off (retentionDays=0).
 */
export function projectBridgeSessionList(items: unknown, limit = 12): SeamSessionSummary[] {
	const rows = Array.isArray(items) ? items : []
	const out: SeamSessionSummary[] = []
	for (const item of rows) {
		const row = asRecord(item)
		// subagent children are not user-resumable (same rule as remote).
		if (row.origin === "subagent") continue
		const id = typeof row.sessionId === "string" ? row.sessionId : ""
		if (!id) continue
		const updatedAt = typeof row.updatedAt === "number" ? String(row.updatedAt) : ""
		const values = asRecord(asRecord(row.projections).values)
		const title = typeof values.title === "string" ? values.title : ""
		out.push({
			id,
			title: title.slice(0, 40),
			...(updatedAt ? { updatedAt } : {}),
			...(typeof row.cwd === "string" && row.cwd ? { cwd: row.cwd } : {}),
			...(typeof row.sizeBytes === "number" && Number.isFinite(row.sizeBytes) ? { sizeBytes: row.sizeBytes } : {}),
			...(typeof row.blank === "boolean" ? { blank: row.blank } : {}),
		})
	}
	return out.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""))).slice(0, limit)
}

/** One `journal.replay` row (the bridge's read-only durable row shape). */
export interface BridgeReplayRow {
	seq: number
	type: string
	payload: unknown
}

/**
 * A4+A5: read-only outcome of a post-DEAD session recovery. Exposed on the
 * seam so the UI branch (A8) can render "已连接未挂载" / "补齐 N 条" without
 * polling, and so a failed open is an explicit state rather than a retry loop.
 */
export type BridgeRecoveryState = "idle" | "recovering" | "attached" | "locked" | "failed"

export interface BridgeRecoveryResult {
	state: BridgeRecoveryState
	sessionId: string | undefined
	/** Number of NEW, deduplicated journal events applied (the N in the notice). */
	applied: number
	/** Inclusive seq lower bound the drain started from (1 when no lastSeq). */
	from: number
	/** Full-log exclusive upper bound from the bridge (`maxSeq + 1`). */
	cursor: number
	/** Transcript projection via the EXISTING journal pipeline (never a new render path). */
	rows: SeamTranscriptRow[]
	error?: { code: string; message: string }
}

/**
 * `journal.replay` rows `{seq,type,payload}` → `SeamTranscriptRow[]`.
 *
 * `payload` is the host event's `data`, so each row is structurally a
 * `RemoteJournalEntry` (`{type,seq,time,data}`) with `data = payload`; `time`
 * is absent on the bridge wire and irrelevant to the transcript projection.
 * Reusing `journalToTranscriptRows` keeps the call→result pairing, ask-row
 * merge and subagent-origin filtering EXACTLY the same as the remote seam —
 * no second implementation of those rules (ticket hard constraint 3).
 * The final SeamTranscriptRow mapping mirrors session-seam-adapter.ts:208-230.
 *
 * `skip` (a ROW COUNT) and `journal.replay`'s `from` (an INCLUSIVE SEQ LOWER
 * BOUND) are NOT equivalent: seqs are sparse — non-human events (turn/start,
 * tool/call, compaction markers) occupy seqs, and compaction can drop whole
 * ranges — so "skip the first 2 rows" over seqs [1,5,9] must yield [9], while
 * `from=2` would yield [5,9]. `cursor` is `maxSeq+1`, the FULL log's exclusive
 * upper bound and independent of `from`, so it cannot express a row offset
 * either. Therefore this seam sends `journal.replay` WITHOUT `from`, reads the
 * whole log, and slices by row count locally (see storedTranscript below).
 */
export function bridgeReplayRowsToSeamTranscript(
	rows: readonly BridgeReplayRow[],
	skip = 0,
): SeamTranscriptRow[] {
	const entries: RemoteJournalEntry[] = rows.map((row) => ({
		type: row.type,
		seq: row.seq,
		time: 0,
		data: asRecord(row.payload),
	}))
	const durable = journalToTranscriptRows(entries, skip)
	return durable.map((row) => {
		if (row.kind === "ask") {
			return { kind: "ask", text: "", final: true, entries: row.entries }
		}
		if (row.kind === "tool") {
			return { kind: "tool", text: row.name, final: true, args: row.args, output: row.brief, ok: row.ok }
		}
		return { kind: row.kind, text: row.text, final: true }
	})
}

/**
 * P1-2: drained journal rows → the SAME wire events `seam-rows.ts` already
 * consumes for the remote seam (`message.updated` / `message.part.updated` /
 * `session.error`). Emitting them through `onSessionEvent` is the ADR-0010:35
 * "经既有 transcript 管线 apply" path: no new render path, and the existing
 * keyed upsert (`user:${id}`, `assistant:${messageID}:${partID}`,
 * `tool:${messageID}:${partID}`) is naturally idempotent.
 *
 * Text/user/notice/error records go through `projectJournalRecord` verbatim —
 * the remote seam's journal feed uses the identical projector, so the source
 * filter, ask merge and seq-derived ids stay in one place. `projectJournalRecord`
 * deliberately skips tool records (the live turn paints those), so replay
 * `tool/call`+`tool/result` pairs are projected here with the same call→result
 * pairing and brief as `journalToTranscriptRows`, under a seq-derived messageID
 * so a re-delivered drain patches the same row instead of appending a second.
 *
 * `seen` is the keys-level half of the seq/keys double insurance: even if a
 * paged drain overlaps (or a second DEAD replays a row already painted live),
 * an event whose key was already emitted is skipped — no duplicate line.
 */
export function seamReplayEventKey(event: SeamSessionEvent): string {
	const details = asRecord(event.details)
	return `${event.type}:${String(details.id ?? details.messageID ?? "")}:${String(asRecord(details.part).id ?? "")}`
}

export function bridgeReplayRowsToSeamEvents(
	rows: readonly BridgeReplayRow[],
	sessionId: string,
): SeamSessionEvent[] {
	const events: SeamSessionEvent[] = []
	const seen = new Set<string>()
	const push = (event: SeamSessionEvent): void => {
		const key = seamReplayEventKey(event)
		if (seen.has(key)) return
		seen.add(key)
		events.push(event)
	}
	const toolCalls = new Map<string, { seq: number; name: string; args: string }>()
	for (const row of rows) {
		const entry: RemoteJournalEntry = { type: row.type, seq: row.seq, time: 0, data: asRecord(row.payload) }
		for (const event of projectJournalRecord(entry, sessionId)) push(event)
		const data = entry.data
		if (row.type === "tool/call") {
			const callId = data.callId === undefined ? "" : String(data.callId)
			if (callId) {
				toolCalls.set(callId, {
					seq: row.seq,
					name: typeof data.name === "string" ? data.name : "tool",
					args: typeof data.arguments === "string" ? data.arguments : "",
				})
			}
		} else if (row.type === "tool/result") {
			const message = asRecord(data.message)
			const callId = data.callId !== undefined
				? String(data.callId)
				: message.toolCallId !== undefined ? String(message.toolCallId) : ""
			const call = callId ? toolCalls.get(callId) : undefined
			if (call !== undefined) {
				toolCalls.delete(callId)
				const messageID = `journal-${call.seq}`
				const ok = data.isError !== true && message.isError !== true
				push({
					type: "message.part.updated",
					details: {
						messageID,
						sessionID: sessionId,
						part: {
							type: "tool",
							id: callId,
							name: call.name,
							input: call.args,
							status: ok ? "done" : "failed",
							output: JSON.stringify(data.output ?? data).slice(0, 300),
						},
					},
				})
			}
		}
	}
	return events
}

// ---------------------------------------------------------------------------
// Subagent lifecycle projection (row 33 on the inproc path)
// ---------------------------------------------------------------------------
//
// The remote seam's subagent panel (RemoteSubagentPanel) is fed by TWO sources:
// durable parent-journal records `tool-workflow/agent-start|agent-end` (paired
// by runId:seq) and a session/list sweep. The inproc bridge has no subagent RPC,
// but its `journal.replay` reads the SAME host journal, so the durable records
// are available; its live `session/event` firehose carries the same events,
// which the bridge forwards as additive `agent.spawn`/`agent.settle` frames.
// Both paths fold through this ONE function so the view shape is identical to
// the remote adapter's `#projectSubagentViews` (session-seam-adapter.ts:708).

/** The host's durable agent lifecycle record types (dsh-tool-workflow/types.ts:47-57). */
const BRIDGE_AGENT_START = "tool-workflow/agent-start"
const BRIDGE_AGENT_END = "tool-workflow/agent-end"

function bridgeAgentRunKey(runId: string, seq: number): string {
	return `${runId}:${seq}`
}

/**
 * Fold ONE agent lifecycle record (durable journal row OR live frame payload)
 * into the canonical `SeamSubagentView` map. `runSeq` pairs agent-end's
 * `{runId, seq}` back to the child registered by agent-start (the exact remote
 * pairing, remote-subagents.ts:152/235-249). `liveStarts` remembers which
 * children got a REAL wall-clock start from a live frame so a later replay
 * sweep never overwrite it with an approximate one.
 *
 * Returns true when the map changed (caller decides whether to re-emit).
 */
function bridgeFoldAgentRecord(
	children: Map<string, SeamSubagentView>,
	runSeq: Map<string, string>,
	liveStarts: Set<string>,
	type: string,
	data: Record<string, unknown>,
	now: number,
	live: boolean,
): boolean {
	if (type === BRIDGE_AGENT_START) {
		const childId = typeof data.childId === "string" ? data.childId : ""
		if (!childId) return false
		const runId = data.runId === undefined ? "" : String(data.runId)
		const seq = typeof data.seq === "number" ? data.seq : -1
		runSeq.set(bridgeAgentRunKey(runId, seq), childId)
		const existing = children.get(childId)
		if (existing !== undefined) {
			// A live spawn arriving after a replay approximation upgrades the start
			// clock to the real wall clock; a replay sweep never downgrades it.
			if (live && !liveStarts.has(childId)) {
				children.set(childId, { ...existing, startedAt: now })
				liveStarts.add(childId)
				return true
			}
			return false
		}
		const label = typeof data.label === "string" && data.label ? data.label : `subagent ${childId.slice(0, 8)}`
		children.set(childId, { id: childId, label, status: "running", rounds: 0, startedAt: now })
		if (live) liveStarts.add(childId)
		return true
	}
	if (type === BRIDGE_AGENT_END) {
		const runId = data.runId === undefined ? "" : String(data.runId)
		const seq = typeof data.seq === "number" ? data.seq : -1
		const key = bridgeAgentRunKey(runId, seq)
		const childId = runSeq.get(key)
		if (!childId) return false
		const existing = children.get(childId)
		if (!existing || existing.status !== "running") return false
		const outcome = data.outcome === "failed" || data.outcome === "cancelled" ? data.outcome : "completed"
		const startedAt = existing.startedAt ?? now
		// Settled rows DROP `startedAt` and carry `elapsedSec` + `endedAt` — the
		// exact projection shape of session-seam-adapter.ts:715-721.
		children.set(childId, {
			id: existing.id,
			label: existing.label,
			...(existing.model !== undefined ? { model: existing.model } : {}),
			status: outcome,
			rounds: existing.rounds,
			elapsedSec: Number(((now - startedAt) / 1000).toFixed(1)),
			endedAt: now,
			...(existing.injectedRound !== undefined ? { injectedRound: existing.injectedRound } : {}),
			...(existing.hardStopRound !== undefined ? { hardStopRound: existing.hardStopRound } : {}),
			...(existing.spinStopRound !== undefined ? { spinStopRound: existing.spinStopRound } : {}),
			...(existing.lastLine !== undefined ? { lastLine: existing.lastLine } : {}),
		})
		runSeq.delete(key)
		return true
	}
	return false
}

/**
 * Pure replay projection: drained journal rows → `SeamSubagentView[]`.
 * spawn→running→settle folds by runId:seq; a child with agent-start but no
 * agent-end stays `running` (the same "start without terminal = running" rule
 * the remote panel uses, remote-subagents.ts:460-473). Replayed rows carry no
 * wall clock, so `now` is used as the discovery anchor for running children —
 * an honest wall-clock approximation (duration shows from first observation).
 */
export function bridgeReplayRowsToSubagentViews(
	rows: readonly BridgeReplayRow[],
	now: number = Date.now(),
): SeamSubagentView[] {
	const children = new Map<string, SeamSubagentView>()
	const runSeq = new Map<string, string>()
	const liveStarts = new Set<string>()
	for (const row of rows) {
		bridgeFoldAgentRecord(children, runSeq, liveStarts, row.type, asRecord(row.payload), now, false)
	}
	return [...children.values()]
}

/**
 * A7: does the drained journal carry a TERMINAL for the turn that was in
 * flight when the bridge died? The host journal records `turn/end` with
 * `data.reason.kind` (completed / aborted / error / interrupted / blocked /
 * forked / max-tokens); a crash mid-turn leaves `turn/start` with NO following
 * `turn/end`. turnId is a bridge-side UUID and is NOT in the journal, so the
 * association is by order: the terminal closing the in-flight turn is any
 * `turn/end` (or a defensive `turn/error`) at a seq ABOVE the last
 * `turn/start`, or — when that start was applied before this drain window —
 * any such row in the drained window.
 *
 * Read-only: this never writes to the journal (blocky 2.4: journal is the
 * single source of truth; the client only infers a LOCAL marker).
 */
export function journalHasTurnTerminal(rows: readonly BridgeReplayRow[]): boolean {
	let lastStart = -Infinity
	let hasStart = false
	for (const row of rows) {
		if (row.type === "turn/start") {
			lastStart = row.seq
			hasStart = true
		}
	}
	return rows.some((row) =>
		(row.type === "turn/end" || row.type === "turn/error") && (!hasStart || row.seq > lastStart),
	)
}

/**
 * The journal row that TERMINATES the in-flight turn — the highest-seq
 * `turn/end` / `turn/error` above the last `turn/start` (any terminal when the
 * start fell outside this drain window). Same association rule as
 * `journalHasTurnTerminal`; `undefined` when the journal stays silent about it.
 * Read-only: the row's `payload` is the host's real terminal shape (`reason`,
 * `usage`, …) and is never rewritten by the client.
 */
export function lastJournalTurnTerminal(
	rows: readonly BridgeReplayRow[],
	startOutsideWindow = false,
): BridgeReplayRow | undefined {
	// P2-1: when the in-flight turn's `turn/start` was applied BEFORE this drain
	// window, a `turn/start` that DOES appear in the window belongs to a LATER
	// (possibly other-writer) turn. The old "highest terminal above the LAST
	// start" rule then attributed that later turn's terminal to ours. Two
	// guards, in the spirit of the recommendation:
	//   - rows carrying a turn id: a terminal whose id matches a start present
	//     in this window is that later turn's — never ours (id association);
	//   - otherwise: only a terminal BEFORE the next (first) turn/start can be
	//     ours, because our start precedes the whole window (order association).
	if (startOutsideWindow) {
		let nextStart = Infinity
		const startIds = new Set<unknown>()
		for (const row of rows) {
			if (row.type === "turn/start") {
				nextStart = Math.min(nextStart, row.seq)
				const id = journalTurnId(row)
				if (id !== undefined) startIds.add(id)
			}
		}
		let latest: BridgeReplayRow | undefined
		for (const row of rows) {
			if (row.type !== "turn/end" && row.type !== "turn/error") continue
			if (row.seq >= nextStart) continue
			const id = journalTurnId(row)
			if (id !== undefined && startIds.has(id)) continue
			if (latest === undefined || row.seq > latest.seq) latest = row
		}
		return latest
	}
	let lastStart = -Infinity
	let hasStart = false
	for (const row of rows) {
		if (row.type === "turn/start") {
			lastStart = row.seq
			hasStart = true
		}
	}
	let latest: BridgeReplayRow | undefined
	for (const row of rows) {
		if ((row.type === "turn/end" || row.type === "turn/error") && (!hasStart || row.seq > lastStart)) {
			if (latest === undefined || row.seq > latest.seq) latest = row
		}
	}
	return latest
}

/** The journal's per-turn identifier (`data.turn` on host rows, defensively a
 *  string `turnId` too). The bridge's UUID turnId is NOT in the journal — this
 *  is the host's numeric turn number and is only used for same-window turn
 *  association (P2-1). */
function journalTurnId(row: BridgeReplayRow): number | string | undefined {
	const payload = asRecord(row.payload)
	if (typeof payload.turn === "number" && Number.isFinite(payload.turn)) return payload.turn
	if (typeof payload.turnId === "string" && payload.turnId !== "") return payload.turnId
	return undefined
}

/**
 * Bridge turn events → the seam-event shapes seam-rows.ts consumes.
 *
 * Explicitly NOT projected (ticket §2 seq 4 / ADR-0010 event list):
 *   - `turn.token` / `turn.tool`: delivered live through the turn() callbacks;
 *     re-emitting them as events would double-paint the transcript rows.
 *   - `permission.asked` / host-initiated `session.updated` / `bridge.shutdown`:
 *     the bridge emits none of these (emitEvent has only the 5 turn.* types).
 * The onSessionEvent registration logs this once as a sync-member degrade.
 */
export function projectBridgeEvent(frame: BridgeEventFrame, sessionId: string): SeamSessionEvent[] {
	const payload = asRecord(frame.payload)
	const turnId = typeof payload.turnId === "string" ? payload.turnId : ""
	if (frame.type === "turn.start") {
		return [{ type: "session.updated", details: { sessionID: sessionId, turnId, turn: "starting" } }]
	}
	if (frame.type === "turn.end") {
		return [{ type: "session.updated", details: { sessionID: sessionId, turnId, turn: "idle" } }]
	}
	if (frame.type === "turn.error") {
		return [{
			type: "session.error",
			details: {
				sessionID: sessionId,
				turnId,
				code: typeof payload.code === "string" ? payload.code : "INTERNAL",
				message: typeof payload.message === "string" ? payload.message : "turn failed",
			},
		}]
	}
	return []
}

/** Accumulated `turn.end.usage` (host `{prompt,completion,cacheRead,cacheWrite}`). */
interface UsageAccumulator {
	turns: number
	prompt: number
	completion: number
	cacheRead: number
	cacheWrite: number
}

/**
 * Parse ONE usage object into the accumulator's canonical fields.
 *
 * The bridge host's `turn.end` frame carries the LAST `assistant/message`
 * row's `data.usage` (bridge/src/index.ts:1006,1066), whose wire fields are
 * `{inputTokens, outputTokens, totalTokens, cacheReadTokens?, cacheWriteTokens?}`
 * — NOT `{prompt, completion, cacheRead, cacheWrite}`. The remote seam maps
 * exactly these aliases (`scanUsageChunk`, remote-follow.ts:199-212); the old
 * bridge-only numeric names are kept first so legacy callers/fixtures still
 * work. A field is set only when at least one alias is present; multiple
 * aliases take the max (the remote scanner's rule). This mismatch is the
 * root cause of the inproc /session "cache read/write 0/0" panel: the journal
 * row DOES carry `cacheReadTokens`, but the seam never read that field.
 */
function parseUsage(value: unknown): Partial<UsageAccumulator> {
	const u = asRecord(value)
	const num = (...aliases: string[]): number | undefined => {
		let present = false
		let best = 0
		for (const alias of aliases) {
			const v = u[alias]
			if (typeof v === "number" && Number.isFinite(v)) {
				present = true
				best = Math.max(best, v)
			}
		}
		return present ? best : undefined
	}
	const out: Partial<UsageAccumulator> = {}
	const prompt = num("prompt", "promptTokens", "inputTokens", "prompt_tokens")
	if (prompt !== undefined) out.prompt = prompt
	const completion = num("completion", "completionTokens", "outputTokens", "completion_tokens")
	if (completion !== undefined) out.completion = completion
	const cacheRead = num("cacheRead", "cacheReadTokens", "cache_read_tokens")
	if (cacheRead !== undefined) out.cacheRead = cacheRead
	const cacheWrite = num("cacheWrite", "cacheWriteTokens", "cache_write_tokens")
	if (cacheWrite !== undefined) out.cacheWrite = cacheWrite
	return out
}

/**
 * One durable `assistant/message.data.usage` row → the same canonical fields
 * plus the host's authoritative `totalTokens` (billed input + output; on
 * cache-splitting adapters input = prompt + cacheRead + cacheWrite). This is
 * the 🧠 numerator's source: remote's `ContextTokenMeter` billed base
 * (`#billedInput + #billedOutput`, token-estimate.ts:65-71) is exactly
 * `input + cacheRead + cacheWrite + output` = `totalTokens`.
 */
function journalUsage(payload: unknown): (Partial<UsageAccumulator> & { total: number }) | undefined {
	const usage = asRecord(asRecord(payload).usage)
	const parsed = parseUsage(usage)
	if (Object.keys(parsed).length === 0) return undefined
	const billed = (parsed.prompt ?? 0) + (parsed.cacheRead ?? 0) + (parsed.cacheWrite ?? 0)
	const rawTotal = usage.totalTokens
	const total = typeof rawTotal === "number" && Number.isFinite(rawTotal) && rawTotal > 0
		? rawTotal
		: billed + (parsed.completion ?? 0)
	return { ...parsed, total }
}

const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)

// ---------------------------------------------------------------------------
// BridgeSessionSeam
// ---------------------------------------------------------------------------

/** Normalize a `bridge.dead` frame payload into the structured cause. Unknown
 *  senders still get a usable cause (fail open), never a crash. */
function asDeadCause(value: unknown): BridgeDeadCause {
	const r = asRecord(value)
	const stage = r.stage
	const stages: readonly string[] = ["spawn", "handshake", "runtime", "closed"]
	return {
		stage: typeof stage === "string" && stages.includes(stage) ? (stage as BridgeDeadStage) : "runtime",
		code: typeof r.code === "number" ? r.code : null,
		signal: typeof r.signal === "string" ? r.signal : null,
		message: typeof r.message === "string" ? r.message : "bridge connection lost",
		// A3: keep the recovery classification attached to the SeamSessionEvent
		// too, so the view can tell a permanent mismatch from a retryable drop.
		...(r.recoverability === "permanent" || r.recoverability === "retriable"
			? { recoverability: r.recoverability }
			: {}),
		...(Array.isArray(r.mismatches) && r.mismatches.every((m) => typeof m === "string")
			? { mismatches: r.mismatches as string[] }
			: {}),
	}
}

/** One locally-pending ask. `done` always settles — on answer, cancel, host
 *  settled broadcast, reconnect snapshot replacement or dispose — so no
 *  consumer ever waits on a dangling promise (ADR-0011 §3.3 / invariant A2). */
interface PendingAskEntry {
	request: BridgeAskRequestPayload
	turnId: string
	cancelled: boolean
	readonly done: Promise<void>
	readonly finish: () => void
}

export class BridgeSessionSeam implements SessionSeam {
	readonly #transport: BridgeTransport
	readonly #ctx: BridgeSeamContext
	readonly #unsubEvent: () => void
	readonly #listeners: ((event: SeamSessionEvent) => void)[] = []
	readonly #onDead?: (cause: BridgeDeadCause) => void

	// Subagent lifecycle (row 33 inproc): the canonical child map is the single
	// source of truth for both the live `agent.spawn/settle` frames and the
	// journal-replay derivation. runSeq pairs runId:seq -> child; liveStarts
	// remembers real wall-clock starts so replay sweeps never overwrite them.
	readonly #subagentViews = new Map<string, SeamSubagentView>()
	readonly #subagentRunSeq = new Map<string, string>()
	readonly #subagentLiveStarts = new Set<string>()
	readonly #subagentListeners = new Set<(views: SeamSubagentView[]) => void>()
	/** The session the current subagent map belongs to; reset on binding change. */
	#subagentSessionId: string | undefined

	// status state machine (no dedicated status frame — ticket §1 #1).
	#connection: SeamStatus["connection"] = "disconnected"
	#turn: SeamStatus["turn"] = "idle"
	/** A2: three-value bridge link health, additive to the connection leg. */
	#bridgeLink: BridgeLinkStatus = "ready"
	#sessionAttached = false
	/** lastSessionId for recovery — this IS the last opened session id; it
	 *  survives a `bridge.dead` frame (only `newSession`/`dispose` clear it). */
	#currentSessionId: string | undefined
	/** A4: highest journal seq applied to the transcript so far. Did NOT exist
	 *  before this task; recovery needs it to compute `from = lastAppliedSeq+1`. */
	#lastAppliedSeq: number | undefined
	/** The session `#lastAppliedSeq` belongs to; reset on a different binding. */
	#lastAppliedSessionId: string | undefined
	/**
	 * P1-2: replay-event keys already pushed to `onSessionEvent` listeners.
	 * Live bridge frames carry NO seq (`turn.token/start/end/tool` payloads in
	 * bridge/src/index.ts have turnId/sessionId/text only), so `lastAppliedSeq`
	 * cannot advance on the live path; a second DEAD re-drains rows painted
	 * since the first drain's cursor. This set is the keys-level half of the
	 * dedup: a re-delivered row upserts the SAME key instead of appending a
	 * duplicate line. Cleared when the session binding changes.
	 */
	readonly #appliedReplayKeys = new Set<string>()
	/** A4+A5: explicit recovery outcome for the UI branch (A8), never thrown. */
	#recoveryState: BridgeRecoveryState = "idle"
	/** Pending sync-stage from resumeSession()/newSession(), bound at next turn. */
	#pendingOpen: { mode: "resume"; id: string } | { mode: "new" } | undefined
	/** Turn id of the single in-flight turn (drives interrupt()/status()). */
	#inFlightTurnId: string | undefined
	/** Live callbacks of the in-flight turn (set before send to catch early deltas). */
	#activeCallbacks: SeamTurnCallbacks | undefined
	/** Terminal-event waiter for the in-flight turn. */
	#turnDone: (() => void) | undefined
	/**
	 * P1-3 turn generation guard. Every turn() claims a monotonic generation;
	 * the three slots above only mean anything for the generation that claimed
	 * them. A stale `finally` must never clear a newer generation's slots.
	 * 0 == no turn in flight (also the reentrancy gate at turn() entry).
	 */
	#turnGeneration = 0
	#inFlightGeneration = 0
	/** P2-9: degrade classes that already logged once; idle polling must not spam. */
	#degradedOnce = new Set<string>()
	#usage: UsageAccumulator = { turns: 0, prompt: 0, completion: 0, cacheRead: 0, cacheWrite: 0 }
	/**
	 * Decode-window timing for the footer ⚡ tok/s. The bridge has no stats
	 * frame, so the seam measures live turn frames itself: window starts at the
	 * first non-reasoning token of a turn and closes at `turn.end`, with the
	 * billed `usage.completion` as the token count (mirrors the remote seam's
	 * first-delta → settle rate). Feeds `sessionInfo().lastTurnTps/sessionAvgTps`.
	 */
	#decodeWindowStart: number | undefined
	#lastTurnDecode: { tokens: number; ms: number } | undefined
	#decodeTotals = { tokens: 0, ms: 0 }
	/**
	 * Review P2-1: the single in-flight `sessionInfo()` promise. The footer
	 * refresh (v2-entry) and the `/session` command share this one seam
	 * instance; without coalescing, two calls racing at a turn boundary each
	 * drain the same incremental rows and add them twice to #sessionInfoStats
	 * (a permanent doubling until session switch / clamp). Concurrent callers
	 * reuse this exact promise so the tally is mutated by ONE drain per
	 * generation. Same single-flight shape as bridge dispatchChain /
	 * resolveSessionController. Cleared on settle with a generation guard.
	 */
	#sessionInfoInFlight: Promise<SeamSessionInfo | undefined> | undefined
	/**
	 * P2-1: incremental `sessionInfo()` tally. The footer /session panel polls
	 * on every turn boundary; re-draining the whole journal each call is O(N²)
	 * on a long session. We keep one cumulative, per-session count and only
	 * drain rows whose seq is greater than `lastSeq`. `tps` is deliberately NOT
	 * cached here — `#lastTurnDecode`/`#decodeTotals` are already accumulated
	 * incrementally from live `turn.end` frames and are read fresh each call.
	 * Invalidated on a different session binding or a journal reset (the drain
	 * clamps when `cursor` falls behind `lastSeq`, i.e. seqs restarted).
	 */
	#sessionInfoStats:
		| {
				sessionId: string
				lastSeq: number
				/** Filtered durable `user` transcript rows (seam口径). */
				userRows: number
				/** Filtered durable `assistant` transcript rows (seam口径). */
				assistantRows: number
				/** Raw `assistant/message` rows — the 0.21.1 footer 💬 unit. */
				rawAssistants: number
				/** ⚡ CH: cumulative billing totals from journal usage rows,
				 *  remote `cacheHitRate("session")` 口径 (prompt = uncached input). */
				cachePrompt: number
				cacheRead: number
				cacheWrite: number
				/** ⚡ CH: latest billed row's own hit rate (remote `lastMessage`). */
				lastCacheHitRate: number | null
				/** 🧠 numerator: latest billed row's input+output (remote meter base). */
				contextTokens: number | null
				/** 🧠 denominator: host-resolved window from `request/context`. */
				contextWindow: number | undefined
				/** provider/model the window belongs to (route-key guard). */
				contextWindowKey: string | undefined
				/** provider/model of the live route (from currentModelSelection()). */
				selectionKey: string | undefined
		  }
		| undefined
	/**
	 * ADR-0011 T8/Q4: a host→client ask frame is the bridge-side proof that the
	 * host armed its ask answerers (`armAskAnswerers`, bridge/src/index.ts). We
	 * use it as the provider signal because `bridge.hello`/`bridge.ping` reply
	 * with ONLY `{protocolVersion, bridgeVersion, hostVersion}` (NO capability
	 * field) and the bridge dispatch exposes NO `permissionPresets/catalog`
	 * route — see permissionCatalog() for the full reasoning.
	 */
	#askFrameSeen = false
	/** ADR-0011 T8/Q4: process-once flag for the fail-closed notice. Never a
	 *  persistent status bit; set on the first confirmed "no provider" probe. */
	#permissionNoticeShown = false
	/** ADR-0011 T8/Q4: composition-root sink for the one-shot notice. */
	#onPermissionUnavailable: ((reason: PermissionUnavailableReason) => void) | undefined
	/** ADR-0011: the globally registered answerer (default for question asks,
	 *  fallback for approval asks when no turn-scoped onApprove is active). */
	#askProvider: ((questions: SeamAskQuestion[]) => Promise<SeamAskPick[]>) | undefined
	/** ADR-0011: pending asks keyed by eventId — first-wins, turn-scoped. */
	readonly #pendingAsks = new Map<string, PendingAskEntry>()
	/** A6: reconnect snapshot buffered while the recovery replay drain is still
	 *  in flight. Applied only AFTER the drain completes (blocky §2.3 step 6),
	 *  so rebuilt cards never race the durable transcript replay. */
	#bufferedPendingSnapshot: BridgeAskRequestPayload[] | undefined
	/** A6: true from recoverSession's attach step until the drain is applied.
	 *  While true, an incoming `ask.pending` frame is buffered, not applied. */
	#replayDrainPending = false
	/** A7: the in-flight turn as of the DEAD frame — id plus the text deltas
	 *  already delivered to the view. A fact captured at death time, consumed
	 *  once after replay; NEVER written to the journal (blocky 2.4). */
	#deadInFlight: { turnId: string; partial: string } | undefined
	/** A7: text-delta accumulator for the generation currently in flight. */
	#inFlightPartial = ""
	/** A6: rebuilt asks whose `ask.response` failed because the ask/turn is gone
	 *  (ASK_UNKNOWN_REQUEST / ASK_TURN_ENDED), keyed by eventId → reason. Kept
	 *  read-only for the view to paint a terminal "已失效" card (never vanish). */
	readonly #invalidatedAsks = new Map<string, string>()
	#disposed = false

	constructor(options: BridgeSessionSeamOptions) {
		this.#transport = options.transport
		this.#ctx = options.ctx
		this.#onDead = options.onDead
		this.#onPermissionUnavailable = options.onPermissionUnavailable
		this.#unsubEvent = this.#transport.onEvent((frame) => this.#onBridgeEvent(frame))
	}

	/** Additive handshake helper (not one of the 19 seam members): ping fills
	 *  the connection leg of status() without a dedicated status frame. */
	async connect(): Promise<void> {
		try {
			await this.#transport.request("bridge.ping")
			this.#connection = "connected"
		} catch (err) {
			this.#connection = "disconnected"
			this.#ctx.logger.warn("[bridge-seam] bridge.ping failed, status connection=disconnected: %s", err)
		}
	}

	// ----- sync members (D3: degrade + log, never throw) -------------------

	status(): SeamStatus {
		if (this.#connection === "disconnected") {
			// No status frame + no successful handshake: the only honest
			// sync answer is the null-seam default, plus a degrade log.
			// P2-9: session-tabs polls status() on a timer — log this class once.
			this.#degradeOnce("status", "no handshake/status frame; returning disconnected/idle")
		}
		return { connection: this.#connection, turn: this.#turn, sessionAttached: this.#sessionAttached, bridge: this.#bridgeLink }
	}

	currentSessionId(): string | undefined {
		// COVERED: just the client-side projection of session.open/close.
		return this.#currentSessionId
	}

	resumeSession(id: string): "ok" | "owned" {
		// COVERED (staging semantics, remote-host-session.ts:760-764 parity):
		// stage the id; the real resume is an eager `session.open{mode:"resume"}`
		// at the next turn. "owned" is not determinable sync — a writer-held
		// target surfaces as SESSION_LOCKED from that open, asynchronously.
		this.#pendingOpen = { mode: "resume", id }
		return "ok"
	}

	newSession(): void {
		// COVERED: clear the bound id and stage a `session.open{mode:"new"}` for
		// the next turn (remote-host-session.ts:746-751 staging parity).
		//
		// P2-8 LOCK WINDOW (deliberate, no behavior change): after /new but before
		// the next turn, the BRIDGE still holds the OLD session open because no
		// `session.open` has been sent yet. #sessionAttached intentionally stays
		// true so the staged open carries `replace:true` (without it the bridge
		// answers ALREADY_OPEN). Consequence: during this window another process
		// that resumes the old id gets SESSION_LOCKED from the bridge, even
		// though this client already reports currentSessionId() === undefined.
		// That is the intended cost of keeping `replace` available (ADR-0010 §
		// session.open replace semantics); do NOT clear #sessionAttached here.
		this.#currentSessionId = undefined
		this.#pendingOpen = { mode: "new" }
		// P1-1: starting a fresh session abandons the DEAD session entirely —
		// settle any turn() the dead frame left suspended (busy wedge escape),
		// and drop the death snapshot so a later recovery cannot revive it.
		this.#settleSuspendedTurn()
		this.#deadInFlight = undefined
		this.#inFlightPartial = ""
	}

	stagedSessionId(): string | undefined {
		// P1-4: the resume target staged by resumeSession(), still unbound until
		// the next turn calls session.open. Returns undefined for a staged
		// newSession() or when nothing is staged — consumers targeting "the
		// session on screen" must read this alongside currentSessionId() or a
		// resumed-but-not-yet-turned session browses the wrong id (review P1-1).
		return this.#pendingOpen?.mode === "resume" ? this.#pendingOpen.id : undefined
	}

	// ----- A4+A5: post-DEAD session recovery (respawn is A3/transport) --------

	/** A4+A5: read-only recovery outcome; the view reads this in A8 instead of
	 *  polling. Never throws — failures are states + events. */
	recoveryState(): BridgeRecoveryState {
		return this.#recoveryState
	}

	/**
	 * A4+A5: after the transport's `recover()` has reached READY, re-attach the
	 * last session and drain the durable journal. Steps (blocky §2.3 first four):
	 *   session.open{mode:"resume", id:lastSessionId}
	 *   → journal.replay{from:lastAppliedSeq+1} (no lastSeq → 1), paged drain
	 *   → seq dedup + ascending apply through the EXISTING transcript pipeline
	 *   → "已恢复，补齐 N 条事件" event, terminal state "attached".
	 * SESSION_LOCKED keeps the transport READY and drops the session layer to
	 * "connected / not attached" (visible via status() + recoveryState() + event).
	 * A non-LOCKED open/replay failure becomes an explicit "failed" state — no
	 * retry loop, no transport rollback.
	 */
	async recoverSession(): Promise<BridgeRecoveryResult> {
		const sessionId = this.#currentSessionId ?? this.stagedSessionId()

		const emit = (event: SeamSessionEvent): void => {
			for (const listener of [...this.#listeners]) {
				try {
					listener(event)
				} catch {
					/* one stale view listener must not break the feed */
				}
			}
		}
		const fail = (code: string, message: string): BridgeRecoveryResult => {
			this.#recoveryState = "failed"
			this.#sessionAttached = false
			this.#connection = "connected"
			this.#bridgeLink = "ready"
			// A6: a failed recovery never rebuilds cards — drop any buffered
			// snapshot and release the drain gate.
			this.#bufferedPendingSnapshot = undefined
			this.#replayDrainPending = false
			// P1-1: a failed recovery is a terminal outcome for a turn that DEAD
			// left suspended — never leave its waiter hanging (busy wedged, next
			// turn() rejected TURN_REENTRANT). No-op when no turn is suspended.
			this.#settleSuspendedTurn()
			const result: BridgeRecoveryResult = {
				state: "failed", sessionId, applied: 0, from: 0, cursor: 0, rows: [],
				error: { code, message },
			}
			emit({ type: "bridge.recovery.failed", details: { ...result, message: `恢复失败: ${message}` } })
			return result
		}

		if (this.#disposed) return fail("DISPOSED", "bridge seam is disposed")
		if (sessionId === undefined || sessionId === "") {
			return fail("NO_SESSION_TO_RESUME", "no session was open before DEAD")
		}

		this.#recoveryState = "recovering"
		this.#connection = "connected"
		this.#bridgeLink = "ready"
		this.#sessionAttached = false
		// A6: open the drain gate BEFORE session.open — the bridge pushes
		// ask.pending on resume, and that frame can arrive before this method
		// reaches the journal replay below.
		this.#replayDrainPending = true

		// (a) re-attach the last session with an eager resume, never replace.
		let opened: Record<string, unknown>
		try {
			opened = asRecord(await this.#transport.request("session.open", { mode: "resume", id: sessionId }))
		} catch (err) {
			const code = err instanceof BridgeProtocolError ? err.code : "SESSION_OPEN_FAILED"
			const message = err instanceof Error ? err.message : String(err)
			if (code === "SESSION_LOCKED") {
				// Transport stays READY; only the session layer degrades. A8 paints
				// the branch from status()/recoveryState()/this event.
				this.#recoveryState = "locked"
				this.#sessionAttached = false
				// A6: no attach happened — no card rebuild on a locked session.
				this.#bufferedPendingSnapshot = undefined
				this.#replayDrainPending = false
				// P1-1: a locked recovery is also terminal for the suspended turn;
				// otherwise /new (which now settles it too) is the only escape.
				this.#settleSuspendedTurn()
				// P2-1: the bridge maps the host's SessionAlreadyOwnedError to
				// SESSION_LOCKED with detail.holder = the owning session id
				// (packages/bridge/src/index.ts mapHostError). Forward it so the
				// UI banner can name the holder. `message` stays the raw host
				// diagnostic (language-neutral); the localised reason template
				// in the UI does the framing, so no CJK copy rides the wire.
				const errorDetail = err instanceof BridgeProtocolError ? asRecord(err.detail) : {}
				const holder =
					typeof errorDetail.holder === "string" && errorDetail.holder.trim() !== ""
						? errorDetail.holder
						: undefined
				const result: BridgeRecoveryResult = {
					state: "locked", sessionId, applied: 0, from: 0, cursor: 0, rows: [],
					error: { code, message },
				}
				emit({
					type: "bridge.recovery.locked",
					details: {
						...result,
						message,
						...(holder !== undefined ? { holder } : {}),
					},
				})
				return result
			}
			this.#ctx.logger.error("[bridge-seam] recovery session.open failed: %s", err)
			return fail(code, message)
		}

		const boundId = typeof opened.sessionId === "string" ? opened.sessionId : sessionId
		this.#currentSessionId = boundId
		if (this.#pendingOpen?.mode === "resume" && this.#pendingOpen.id === boundId) this.#pendingOpen = undefined
		if (this.#lastAppliedSessionId !== boundId) {
			this.#lastAppliedSessionId = boundId
			this.#lastAppliedSeq = undefined
			this.#appliedReplayKeys.clear()
		}
		this.#sessionAttached = true

		// (b) catch up the durable journal. `from` is inclusive; no lastSeq → 1.
		const from = this.#lastAppliedSeq === undefined ? 1 : this.#lastAppliedSeq + 1
		let drained: { rows: BridgeReplayRow[]; cursor: number; clamped: boolean }
		try {
			drained = await this.#drainJournal(boundId, from)
		} catch (err) {
			const code = err instanceof BridgeProtocolError ? err.code : "JOURNAL_REPLAY_FAILED"
			const message = err instanceof Error ? err.message : String(err)
			this.#ctx.logger.error("[bridge-seam] recovery journal.replay failed: %s", err)
			return fail(code, message)
		}
		if (drained.clamped) {
			this.#ctx.logger.warn(
				"[bridge-seam] recovery replay from=%d is ahead of journal max=%d; clamped to %d",
				from, Math.max(0, drained.cursor - 1), drained.cursor,
			)
		}

		// (c) apply through the SAME projection storedTranscript() uses — no new
		// render path. Dedup + ascending order were established by #drainJournal.
		// Same rows also restore the subagent roster after a process restart
		// (spawn/settle from the durable journal; running = start w/o terminal).
		this.#foldAgentReplayRows(drained.rows, boundId)
		const rows = bridgeReplayRowsToSeamTranscript(drained.rows)
		if (drained.rows.length > 0) {
			const maxSeq = drained.rows.reduce((m, row) => Math.max(m, row.seq), -Infinity)
			this.#lastAppliedSeq = Math.max(this.#lastAppliedSeq ?? 0, maxSeq)
			this.#lastAppliedSessionId = boundId
		}

		// P1-2: the projection above used to be DATA-ONLY — `rows` rode on
		// `bridge.recovered`, whose consumer reads `applied` (the count) but
		// never the rows, so content journalled after the last live delta (the
		// killed turn's tail, tool lines landed during the death window) was
		// never painted, and `#lastAppliedSeq` had already moved past it.
		// The actual event application happens BELOW, after step (e) settles
		// the DEAD-suspended turn — seam-rows' SETTLE SUPERSEDE only replaces a
		// streamed group when `turnOpen === false`, so emitting earlier would
		// append a SECOND body beside the raw live one.

		// (d) A6 timing gate — ONLY now that the replay drain has completed do
		// we rebuild pending cards from a buffered `ask.pending` snapshot. The
		// eventId is preserved verbatim so the cards answer through the existing
		// ask.response path (blocky §2.3 step 6; A4/A5 recovery order).
		const buffered = this.#bufferedPendingSnapshot
		this.#bufferedPendingSnapshot = undefined
		this.#replayDrainPending = false
		if (buffered !== undefined) this.#applyPendingSnapshot(buffered)

		// (e) A7 — the in-flight turn at DEAD is finalized by the durable journal.
		// If replay carries the host terminal, the live turn state is settled to
		// THAT terminal (reason/payload verbatim from the journal row) and NO
		// local duplicate marker is painted. Only when the journal stays silent
		// does the client paint its LOCAL INTERRUPTED marker (seq:null, source:
		// "local", never journaled). A normal (non-DEAD) in-flight turn has no
		// #deadInFlight snapshot and is never touched here.
		const dead = this.#deadInFlight
		this.#deadInFlight = undefined
		if (dead !== undefined) {
			// P2-1: if a terminal precedes the first turn/start in this drain,
			// our turn's start was applied before the window (that terminal is
			// ours) and any turn/start in the window is a LATER writer — switch
			// to the id/next-start association instead of "above the last start".
			const firstStart = drained.rows.find((r) => r.type === "turn/start")?.seq
			const firstTerminal = drained.rows.find((r) => r.type === "turn/end" || r.type === "turn/error")?.seq
			const startOutsideWindow = firstStart !== undefined && firstTerminal !== undefined && firstTerminal < firstStart
			const terminal = lastJournalTurnTerminal(drained.rows, startOutsideWindow)
			if (terminal !== undefined) {
				// The host terminal is already projected into the transcript by
				// step (c). This event feeds the terminal reason/payload back to
				// the live turn state so the streamed rows settle and the spinner
				// closes — without a second transcript marker.
				emit({
					type: "bridge.turn.terminal",
					details: {
						sessionID: boundId,
						turnId: dead.turnId,
						seq: terminal.seq,
						terminalType: terminal.type,
						reason: asRecord(terminal.payload).reason,
						payload: terminal.payload,
						source: "journal",
					},
				})
				// P1-1: settle the suspended turn() waiter — its generation-
				// guarded finally sweep finalizes the live rows and clears the
				// busy/spinner state. Without this the busy flag wedged forever
				// and the next turn() threw TURN_REENTRANT.
				this.#settleSuspendedTurn()
			} else {
				emit({
					type: "bridge.turn.interrupted",
					details: {
						sessionID: boundId,
						turnId: dead.turnId,
						partial: dead.partial,
						reason: "connection lost while the turn was in flight",
						code: "INTERRUPTED",
						seq: null,
						source: "local",
					},
				})
				// P1-1: the journal stayed silent → the dead turn is a LOCAL
				// INTERRUPTED terminal. Settle turn() the same way as the journal
				// terminal arm (resolve), so busy returns to zero and the next
				// submission is accepted; the event above carries the reason.
				this.#settleSuspendedTurn()
			}
		}

		// Step (e)'s #settleSuspendedTurn() resolves turn(), but the view's
		// .finally() (live-row finalize + `turnOpen=false`) runs on a LATER
		// microtask. Yield one macrotask so seam-rows' SETTLE SUPERSEDE guard
		// sees `turnOpen===false` and replaces the raw live group IN PLACE —
		// emitting earlier appends a second body beside the streamed one.
		await new Promise<void>((resolve) => setTimeout(resolve, 0))

		// P1-2: apply the drained rows through the EXISTING onSessionEvent
		// pipeline (the same `message.updated`/`message.part.updated` events the
		// remote seam's journal feed emits). Now that step (e) has settled the
		// suspended turn, seam-rows' SETTLE SUPERSEDE replaces the raw live
		// group in place (one body per turn) instead of appending a duplicate,
		// and tool lines from the death window land under their seq-derived key.
		// The keys set is the seq/keys double insurance for a SECOND death —
		// live bridge frames carry no seq, so a re-drain of rows painted live
		// since the first cursor upserts the same key instead of appending.
		for (const event of bridgeReplayRowsToSeamEvents(drained.rows, boundId)) {
			const key = seamReplayEventKey(event)
			if (this.#appliedReplayKeys.has(key)) continue
			this.#appliedReplayKeys.add(key)
			emit(event)
		}

		this.#sessionAttached = true
		this.#connection = "connected"
		this.#bridgeLink = "ready"
		this.#recoveryState = "attached"
		const result: BridgeRecoveryResult = {
			state: "attached", sessionId: boundId, applied: drained.rows.length,
			from, cursor: drained.cursor, rows,
		}
		emit({ type: "bridge.recovered", details: { ...result, message: `已恢复，补齐 ${result.applied} 条事件` } })
		return result
	}

	/**
	 * Drain `journal.replay` pages. The bridge replies `{rows, cursor}` in one
	 * frame (`cursor = maxSeq+1` of the FULL log, independent of `from`); this
	 * loop still advances `from` by the page's max seq so a paginating bridge is
	 * drained completely. Rows are deduplicated by seq and sorted ascending, so
	 * overlapping/out-of-order pages never paint a duplicate transcript line.
	 * A client ahead of the journal (`from > cursor`) is clamped once + reported
	 * to the caller (which logs `warn`) instead of throwing.
	 */
	async #drainJournal(
		sessionId: string,
		startFrom: number,
	): Promise<{ rows: BridgeReplayRow[]; cursor: number; clamped: boolean }> {
		let from = startFrom
		let floor = startFrom
		let cursor = 0
		let clamped = false
		const seen = new Set<number>()
		const collected: BridgeReplayRow[] = []
		for (;;) {
			const value = asRecord(await this.#transport.request("journal.replay", { sessionId, from }))
			const rawRows = Array.isArray(value.rows) ? value.rows : []
			if (typeof value.cursor === "number" && Number.isFinite(value.cursor)) cursor = value.cursor
			if (!clamped && cursor > 0 && from > cursor) {
				// lastAppliedSeq > journal max — clamp the lower bound once, then
				// re-request; never loop on the clamp itself.
				clamped = true
				from = cursor
				floor = cursor
				continue
			}
			let added = 0
			let pageMax = from - 1
			for (const raw of rawRows) {
				const row = asRecord(raw)
				const seq = row.seq
				if (typeof seq !== "number" || !Number.isFinite(seq) || seq < floor || seen.has(seq)) continue
				seen.add(seq)
				collected.push({ seq, type: typeof row.type === "string" ? row.type : "", payload: row.payload })
				added += 1
				if (seq > pageMax) pageMax = seq
			}
			if (added === 0) break
			from = pageMax + 1
			if (cursor > 0 && from >= cursor) break
		}
		collected.sort((a, b) => a.seq - b.seq)
		return { rows: collected, cursor, clamped }
	}

	interrupt(): void {
		// PARTIAL: turn.abort is real, but the seam is sync void and needs the
		// turnId from the live turn. Without one, degrade to a no-op + log.
		const turnId = this.#inFlightTurnId
		if (turnId === undefined || turnId === "") {
			this.#degrade("interrupt", "no in-flight turnId; turn.abort skipped (no-op)")
			return
		}

		// P1-5: a failed abort used to be logger.warn-only — the state machine
		// stayed "running" with no callback and no event, so the user never saw
		// it. Surface it on BOTH channels the view consumes: the live turn's
		// onError callback and a projected session.error event. Also release the
		// waiter so turn() does not hang forever when no terminal frame arrives
		// (TURN_NOT_FOUND / transport death / a noop "success"). The sync void
		// signature still never throws — all of this runs in a microtask.
		const fail = (message: string, code: string): void => {
			this.#ctx.logger.warn("[bridge-seam] %s", message)
			const cb = this.#activeCallbacks
			if (cb !== undefined) {
				try {
					cb.onError(message)
				} catch {
					/* a throwing view callback must not break the feed */
				}
			}
			const [event] = projectBridgeEvent(
				{ type: "turn.error", payload: { turnId, code, message } },
				this.#currentSessionId ?? "",
			)
			if (event !== undefined) {
				for (const listener of this.#listeners) {
					try {
						listener(event)
					} catch {
						/* one stale view listener must not break the feed */
					}
				}
			}
			// Let turn() finish and status() report idle — the abort failed, so
			// waiting on a terminal frame that may never come is a deadlock.
			if (this.#inFlightTurnId === turnId) {
				this.#inFlightTurnId = undefined
				this.#turn = "idle"
				this.#turnDone?.()
			}
		}

		// Fire-and-forget with ONE bounded retry. A noop response already means
		// the id was terminal/already-aborted — report it, do not retry it.
		const attempt = (remaining: number): void => {
			void this.#transport.request("turn.abort", { turnId })
				.then((result) => {
					if (asRecord(result).noop === true) {
						fail(`turn.abort was a noop for turn ${turnId}; turn may still be running`, "TURN_ABORT_NOOP")
					}
				})
				.catch((err: unknown) => {
					if (remaining > 0) {
						attempt(remaining - 1)
						return
					}
					const code = err instanceof BridgeProtocolError ? err.code : "TURN_ABORT_FAILED"
					const reason = err instanceof Error ? err.message : String(err)
					fail(`turn.abort failed for turn ${turnId}: ${reason}`, code)
				})
		}
		attempt(1)
	}

	usageSummary(): string[] {
		// PARTIAL: cache turn.end.usage; sync read, so no data = empty + log.
		if (this.#usage.turns === 0) {
			// P2-9: the status bar polls this too — warn once per degrade class.
			this.#degradeOnce("usageSummary", "no turn.end usage captured yet; returning []")
			return []
		}
		const u = this.#usage
		return [
			`turns ${u.turns}`,
			`prompt ${fmtTokens(u.prompt)} tok`,
			`completion ${fmtTokens(u.completion)} tok`,
		]
	}

	/**
	 * Footer /session snapshot (0.21.1 single-💬 semantics). `msgCount` is the
	 * authoritative footer unit and is derived from the durable journal's
	 * RAW `assistant/message` rows — one event = one msg (0.21.1 release
	 * semantics, same unit the remote seam bills). `messageCount`/`turnCount`
	 * are the FILTERED durable transcript counts for the /session panel ONLY,
	 * aligned with the seam contract and the remote adapter: a `user/message`
	 * with a non-"user" `source.kind` (runtime-context / tool-registry
	 * injections) and any empty-text user/assistant row are excluded (see
	 * `journalToTranscriptRows`, which the remote adapter also uses).
	 *
	 * P2-1: the journal is drained INCREMENTALLY via a per-session tally —
	 * only rows with seq > the cached `lastSeq` are read, so repeated polls do
	 * not re-scan the whole log. A different session binding or a journal reset
	 * (drain clamped) invalidates the cache and restarts from seq 1.
	 *
	 * tps rides the LIVE decode window measured from turn frames; a journal
	 * that cannot be read omits `msgCount`/`messageCount`/`turnCount` entirely
	 * ("unknown", not a fabricated 0). No session bound → undefined, matching
	 * the null seam.
	 *
	 * Review P2-1: concurrent callers coalesce onto ONE in-flight promise
	 * (#sessionInfoInFlight), so two polls racing at a turn boundary cannot both
	 * drain the same incremental rows and double-count the tally.
	 */

	/**
	 * ⚡ CH footer segment — RemoteHostSession.cacheHitRate() 1:1
	 * (remote-host-session.ts:789-803). "session" is the cumulative journal rate
	 * ΣcacheRead / (Σprompt + ΣcacheRead + ΣcacheWrite); the default
	 * ("lastMessage") is the latest billed row's `cacheRead / billed * 100`.
	 * Visibility gate: null until ANY cache traffic. Reads the SAME
	 * `#sessionInfoStats` tally the footer's sessionInfo() poll fills, so it
	 * needs no extra journal drain and cannot double-count.
	 */
	cacheHitRate(mode?: "session" | "lastMessage"): number | null {
		const stats = this.#liveStats()
		if (stats === undefined || stats.cacheRead + stats.cacheWrite <= 0) return null
		if (mode === "session") {
			const billed = stats.cachePrompt + stats.cacheRead + stats.cacheWrite
			return billed > 0 ? (stats.cacheRead / billed) * 100 : null
		}
		return stats.lastCacheHitRate
	}

	/**
	 * 🧠 numerator — the latest billed journal usage row's input+output
	 * (`totalTokens`, remote `ContextTokenMeter` billed base). null until a
	 * usage row has been drained for the live session (honest omission, same
	 * gate as the other footer counters).
	 */
	contextTokens(): number | null {
		return this.#liveStats()?.contextTokens ?? null
	}

	/**
	 * 🧠 denominator — the host-resolved `request/context.contextWindow` for the
	 * live route (remote's projection window / catalog resolution equivalent).
	 * null while unknown → the footer degrades to the bare `🧠 used` shape.
	 */
	contextWindow(): number | null {
		return this.#liveContextWindow()
	}

	/** The stats tally only while it belongs to the CURRENT session binding. */
	#liveStats() {
		const stats = this.#sessionInfoStats
		return stats !== undefined && stats.sessionId === this.currentSessionId() ? stats : undefined
	}

	/** The route-guarded context window shared by the getter and sessionInfo(). */
	#liveContextWindow(): number | null {
		const stats = this.#liveStats()
		if (stats?.contextWindow === undefined) return null
		if (
			stats.contextWindowKey !== undefined &&
			stats.selectionKey !== undefined &&
			stats.contextWindowKey !== stats.selectionKey
		) return null // window belongs to a different route — degrade, never a wrong denominator
		return stats.contextWindow
	}

	sessionInfo(): Promise<SeamSessionInfo | undefined> {
		const existing = this.#sessionInfoInFlight
		if (existing !== undefined) return existing
		const run = this.#computeSessionInfo()
		this.#sessionInfoInFlight = run
		const release = (): void => {
			// Generation guard: only the call that set the slot may clear it.
			if (this.#sessionInfoInFlight === run) this.#sessionInfoInFlight = undefined
		}
		void run.then(release, release)
		return run
	}

	async #computeSessionInfo(): Promise<SeamSessionInfo | undefined> {
		const sessionId = this.currentSessionId()
		if (!sessionId) return undefined

		let counts: Pick<SeamSessionInfo, "msgCount" | "messageCount" | "turnCount"> | undefined
		try {
			// P2-1: reuse the cumulative tally only while the binding is unchanged;
			// a new session starts a fresh one at seq 1.
			let stats = this.#sessionInfoStats
			if (stats === undefined || stats.sessionId !== sessionId) {
				stats = {
					sessionId, lastSeq: 0, userRows: 0, assistantRows: 0, rawAssistants: 0,
					cachePrompt: 0, cacheRead: 0, cacheWrite: 0, lastCacheHitRate: null,
					contextTokens: null, contextWindow: undefined, contextWindowKey: undefined, selectionKey: undefined,
				}
				this.#sessionInfoStats = stats
			}
			let from = stats.lastSeq + 1
			// Read-only incremental log; #drainJournal pages and dedups by seq and
			// never writes to the journal or touches a writer lock (ADR-0010 I6).
			let drained = await this.#drainJournal(sessionId, from)
			if (drained.clamped && from > 1) {
				// Journal reset: `cursor` fell behind our `lastSeq` (seqs restarted).
				// Drop the stale cumulative counts and re-read the whole log.
				stats = {
					sessionId, lastSeq: 0, userRows: 0, assistantRows: 0, rawAssistants: 0,
					cachePrompt: 0, cacheRead: 0, cacheWrite: 0, lastCacheHitRate: null,
					contextTokens: null, contextWindow: undefined, contextWindowKey: undefined, selectionKey: undefined,
				}
				this.#sessionInfoStats = stats
				from = 1
				drained = await this.#drainJournal(sessionId, 1)
			}

			// msgCount stays the RAW assistant/message count (0.21.1 semantics).
			// The SAME journal rows also carry the ⚡ CH and 🧠 inputs: the host's
			// `assistant/message.data.usage` (`inputTokens/outputTokens/cacheReadTokens/
			// cacheWriteTokens/totalTokens`) is the exact data the remote seam reads
			// off its live usage chunks (scanUsageChunk parity). Accumulate into the
			// ONE #sessionInfoStats tally so the incremental drain, its single-flight
			// coalescing and its session/reset invalidation stay shared (P2-1).
			for (const row of drained.rows) {
				if (row.type === "assistant/message") {
					stats.rawAssistants++
					const usage = journalUsage(row.payload)
					if (usage !== undefined) {
						// remote-host-session.ts:2529-2533 parity — cumulative
						// billing totals + the latest billed request's own rate.
						// Gate on `> 0`, not truthiness, exactly like remote: a
						// reported 0 must never advance (or reset) a tally.
						const prompt = usage.prompt ?? 0
						const cacheRead = usage.cacheRead ?? 0
						const cacheWrite = usage.cacheWrite ?? 0
						if (prompt > 0) stats.cachePrompt += prompt
						if (cacheRead > 0) stats.cacheRead += cacheRead
						if (cacheWrite > 0) stats.cacheWrite += cacheWrite
						const billed = prompt + cacheRead + cacheWrite
						if (billed > 0) stats.lastCacheHitRate = (cacheRead / billed) * 100
						// 🧠 numerator: latest billed request's input+output — remote's
						// ContextTokenMeter billed base (totalTokens when disclosed).
						stats.contextTokens = usage.total
					}
				} else if (row.type === "request/context") {
					// 🧠 denominator: the host resolved the live route's window for
					// this request (remote's `pressure.contextWindow` equivalent).
					const data = asRecord(row.payload)
					const window = data.contextWindow
					if (typeof window === "number" && Number.isFinite(window) && window > 0) {
						const provider = typeof data.provider === "string" ? data.provider : ""
						const model = typeof data.model === "string" ? data.model : ""
						stats.contextWindow = window
						stats.contextWindowKey = provider && model ? `${provider}/${model}` : undefined
					}
				}
			}
			// P2-2: the /session counts go through the SAME projection the remote
			// adapter uses, so the filtered口径 (non-user source.kind + empty-text
			// rows excluded) is identical. The ask/tool pairing inside the
			// projection is irrelevant here — only user/assistant kinds are
			// counted, and those are decided per row, independent of chunking.
			for (const row of bridgeReplayRowsToSeamTranscript(drained.rows)) {
				if (row.kind === "user") stats.userRows++
				else if (row.kind === "assistant") stats.assistantRows++
			}
			for (const row of drained.rows) {
				if (row.seq > stats.lastSeq) stats.lastSeq = row.seq
			}
			counts = {
				msgCount: stats.rawAssistants,
				messageCount: stats.userRows + stats.assistantRows,
				turnCount: stats.userRows,
			}
		} catch (err) {
			// P3-1: a failed read omits ALL durable counts rather than painting a
			// fake 0 — consistent with msgCount's honest-omission contract.
			this.#ctx.logger.warn("[bridge-seam] sessionInfo journal.replay failed: %s", err)
		}

		const selection = await this.currentModelSelection().catch(() => undefined)
		const stats = this.#liveStats()
		// The journal's `request/context` window belongs to the route that made
		// that request. Keep the live route key on the SAME tally so the sync
		// contextWindow() getter and sessionInfo() share the route guard (the
		// remote seam's `#contextWindowKey`): a window for a different route
		// degrades to unknown rather than serving a wrong denominator.
		const selectionKey = selection ? `${selection.providerID}/${selection.modelID}` : undefined
		if (stats !== undefined) stats.selectionKey = selectionKey
		const u = this.#usage
		const last = this.#lastTurnDecode
		return {
			sessionId,
			model: selectionKey ?? null,
			...(counts !== undefined ? counts : {}),
			tokensIn: u.prompt,
			tokensOut: u.completion,
			cacheRead: u.cacheRead,
			cacheWrite: u.cacheWrite,
			lastTurnTps: last && last.ms > 0 ? tokensPerSecond(last.tokens, last.ms) : null,
			sessionAvgTps: this.#decodeTotals.ms > 0
				? tokensPerSecond(this.#decodeTotals.tokens, this.#decodeTotals.ms)
				: null,
			// 🧠 context rows (footer context batch; remote adapter parity).
			contextTokens: stats?.contextTokens ?? null,
			contextWindow: this.#liveContextWindow(),
		}
	}

	onSessionEvent(listener: (event: SeamSessionEvent) => void): () => void {
		// PARTIAL: only turn.start/end/error project; token/tool ride the live
		// turn callbacks, and permission.asked / host session.updated /
		// bridge.shutdown do not exist on the wire. The ask channel owns its
		// OWN frame queue (ask.request/cancel/settled/pending), so this gap is
		// noise for the approval card — log it once (the view subscribes on
		// every boot / session switch, which used to spam the same warn).
		this.#degradeOnce("onSessionEvent", "only turn.* lifecycle/error events project; permission.asked / bridge.shutdown absent")
		this.#listeners.push(listener)
		return () => {
			const i = this.#listeners.indexOf(listener)
			if (i >= 0) this.#listeners.splice(i, 1)
		}
	}

	// ----- subagent marker face (row 33 inproc, RemoteHostSession 1:1) -------

	/** Panel/viewer snapshot — a fresh copy so callers cannot mutate the store. */
	subagentViews(): SeamSubagentView[] {
		return [...this.#subagentViews.values()].map((view) => ({ ...view }))
	}

	/** Push listener (the seam-rows tree row + /subagents viewer subscribe here).
	 *  Replays the current snapshot immediately for a late subscriber. */
	onSubagentViews(listener: (views: SeamSubagentView[]) => void): () => void {
		this.#subagentListeners.add(listener)
		listener(this.subagentViews())
		return () => {
			this.#subagentListeners.delete(listener)
		}
	}

	/** Emit the current snapshot to every listener; one stale UI listener is contained. */
	#emitSubagentViews(): void {
		if (this.#subagentListeners.size === 0) return
		const snapshot = this.subagentViews()
		for (const listener of [...this.#subagentListeners]) {
			try {
				listener(snapshot)
			} catch {
				/* a UI listener must never take the event pump down */
			}
		}
	}

	/**
	 * Fold an additive `agent.spawn`/`agent.settle` frame through the SAME pure
	 * projector the replay path uses. Live frames carry a real wall clock, so a
	 * spawn registers with `Date.now()` and a settle freezes the true duration.
	 */
	#foldAgentFrame(frame: BridgeEventFrame): void {
		const payload = asRecord(frame.payload)
		// Defensive session filter: a stale frame from a replaced binding must not
		// pollute the current roster (the bridge already filters by active turn;
		// this is the seam-side backstop for the replay boundary).
		const frameSession = typeof payload.sessionId === "string" ? payload.sessionId : ""
		if (this.#subagentSessionId !== undefined && frameSession !== "" && frameSession !== this.#subagentSessionId) return
		const now = Date.now()
		let changed = false
		if (frame.type === "agent.spawn") {
			changed = bridgeFoldAgentRecord(
				this.#subagentViews, this.#subagentRunSeq, this.#subagentLiveStarts,
				BRIDGE_AGENT_START, payload, now, true,
			)
		} else if (frame.type === "agent.settle") {
			changed = bridgeFoldAgentRecord(
				this.#subagentViews, this.#subagentRunSeq, this.#subagentLiveStarts,
				BRIDGE_AGENT_END, payload, now, true,
			)
		}
		if (changed) this.#emitSubagentViews()
	}

	/**
	 * Derive subagent rows from durable journal rows (replay / recovery), for the
	 * SAME session only. A binding change clears the old session's map so a /new
	 * or a different replay target cannot pollute the live roster. Re-folding the
	 * full log is idempotent (start on a known child / settle on a settled child
	 * are no-ops), so repeated `storedTranscript` sweeps are safe.
	 */
	#foldAgentReplayRows(rows: readonly BridgeReplayRow[], sessionId: string): void {
		if (sessionId !== this.#subagentSessionId) {
			this.#subagentViews.clear()
			this.#subagentRunSeq.clear()
			this.#subagentLiveStarts.clear()
			this.#subagentSessionId = sessionId
		}
		let changed = false
		const now = Date.now()
		for (const row of rows) {
			if (bridgeFoldAgentRecord(
				this.#subagentViews, this.#subagentRunSeq, this.#subagentLiveStarts,
				row.type, asRecord(row.payload), now, false,
			)) changed = true
		}
		if (changed) this.#emitSubagentViews()
	}

	// ----- config faces (optional seam members — D3 degrade, never throw) --
	//
	// The bridge host dispatches ONLY bridge.hello/ping, session.{list,open,
	// send,close}, turn.abort and journal.replay (packages/bridge/src/index.ts
	// handleLine). There is no config frame, so the merged config, its raw
	// profile layer and the workspace overlay are not reachable over this seam.
	// These three OPTIONAL `SessionSeam` members are nevertheless called
	// UNGUARDED by v2-entry.tsx at boot (configLoad/configRaw/workspaceConfig);
	// omitting them crashed the default inproc path ("seam.configLoad is not a
	// function"). Per ticket §6 D3 a sync member with no capability returns a
	// contract-valid degraded value + a once-only log — NEVER throws, NEVER a
	// fabricated config. The view already treats `{}` as "no stored override"
	// (lastMessage cacheHitMode, default skin, empty hints/i18n), so `{}` is the
	// honest degrade. Reading the files locally would duplicate the host's
	// mergeConfig layering in a second implementation (ticket hard constraint 3)
	// and would desync the moment the host mutates its overlay cache.
	configLoad(): Record<string, unknown> {
		this.#degradeOnce("configLoad", "no config frame on the in-process bridge; returning {} (no stored override)")
		return {}
	}

	configRaw(): Record<string, unknown> {
		this.#degradeOnce("configRaw", "no config frame on the in-process bridge; returning {} (no profile layer)")
		return {}
	}

	workspaceConfig(): Record<string, unknown> {
		this.#degradeOnce("workspaceConfig", "no config frame on the in-process bridge; returning {} (no workspace overlay)")
		return {}
	}

	/**
	 * ADR-0011 T8 / Q4 — approval-provider availability probe.
	 *
	 * PROBE BASIS (verified, not guessed): the in-process bridge has NO
	 * capability declaration — `bridge.hello`/`bridge.ping` reply with ONLY
	 * `{protocolVersion, bridgeVersion, hostVersion}` (packages/bridge/src/index.ts
	 * :1977-1994) — and NO `permissionPresets/catalog` route (dispatch :1977-2042),
	 * unlike the remote host which calls that RPC (remote-host-session.ts:1347).
	 * A real catalog therefore cannot be fetched here. The honest signal is the
	 * ask event channel plus local answerer state:
	 *   - a delivered `ask.request`/`ask.pending` frame (#askFrameSeen) proves the
	 *     host armed its ask answerers (bridge/src/index.ts `armAskAnswerers`);
	 *   - a registered `#askProvider` or a live turn's `onApprove` proves this
	 *     client CAN answer an ask;
	 *   - the `ask.no-provider` degrade class (#degradedOnce) is positive proof
	 *     the channel exists but has NO answerer — fail-closed.
	 * When no provider can be confirmed we return `undefined` (the same meaning
	 * the remote implementation gives "service absent / malformed") and fire the
	 * composition-root sink ONCE per process for a transient fail-closed notice.
	 * We never invent preset values: a confirmed provider yields a shape-valid
	 * EMPTY catalog so /settings falls back to the schema-derived enum.
	 */
	async permissionCatalog(): Promise<SeamPermissionCatalog | undefined> {
		const answererReady =
			this.#askProvider !== undefined ||
			(this.#inFlightGeneration !== 0 && this.#activeCallbacks !== undefined) ||
			this.#askFrameSeen
		const providerConfirmed =
			this.#connection === "connected" && answererReady && !this.#degradedOnce.has("ask.no-provider")
		if (providerConfirmed) return { options: [], defaultOptions: [], defaultPreset: "" }
		if (!this.#permissionNoticeShown) {
			this.#permissionNoticeShown = true
			const reason: PermissionUnavailableReason = this.#degradedOnce.has("ask.no-provider")
				? "ask-no-provider"
				: this.#connection === "disconnected"
					? "bridge-offline"
					: "no-provider"
			this.#onPermissionUnavailable?.(reason)
		}
		return undefined
	}

	// ----- async members (D3: UNSUPPORTED error, never fake success) --------

	async listSessions(limit?: number): Promise<SeamSessionSummary[]> {
		// session.list is read-only: the bridge calls the host's
		// sessionController.list and passes items through (7e66b3f, ADR-0010:89).
		// The opentui-inproc profile mounts a standalone sessionController shim
		// (2b5e2f1), so dsh-web-app is NOT required. If that service is absent the
		// bridge replies UNSUPPORTED and the transport rejects with
		// BridgeProtocolError(code=UNSUPPORTED); we MUST let it propagate —
		// no `catch { return [] }` (an empty store must stay distinct from a
		// "capability unavailable" answer).
		const value = await this.#transport.request("session.list")
		return projectBridgeSessionList(asRecord(value).items, limit)
	}

	async storedTranscript(id: string, skip = 0): Promise<SeamTranscriptRow[]> {
		// journal.replay(seq rows) works on ANY id with no writer lock. Send no
		// `from`: skip is a row count, not a seq bound (see projection comment).
		const value = await this.#transport.request("journal.replay", { sessionId: id })
		const rows = (Array.isArray(asRecord(value).rows) ? asRecord(value).rows : []) as BridgeReplayRow[]
		// The SAME durable rows carry the subagent lifecycle records the remote
		// panel reads off session/follow. Derive the live roster from them so a
		// fresh boot / resume / session switch paints spawned+settled (and any
		// start-without-terminal → running) agents even before a frame arrives.
		this.#foldAgentReplayRows(rows, id)
		return bridgeReplayRowsToSeamTranscript(rows, skip)
	}

	async currentModelSelection(): Promise<{ providerID: string; modelID: string } | undefined> {
		// The bridge now exposes a read-only `model.currentSelection` route
		// (19c2ab2, packages/bridge/src/index.ts:1795) backed by
		// ctx.agentDefaultModel.currentSelection(); the seam reads it at boot
		// before staging the first session.open. If that service is absent the
		// bridge replies UNSUPPORTED and the error propagates — do not swallow it
		// into a fabricated selection.
		const selection = await this.#transport.request("model.currentSelection")
		if (selection === undefined || selection === null) return undefined
		const s = asRecord(selection)
		const providerID = typeof s.provider === "string" ? s.provider : ""
		const modelID = typeof s.model === "string" ? s.model : ""
		if (!providerID || !modelID) return undefined
		return { providerID, modelID }
	}

	/**
	 * P1-1: settle the turn() waiter that a `bridge.dead` frame left SUSPENDED
	 * (the dead handler snapshots #deadInFlight but deliberately leaves the
	 * promise awaiting so recovery may decide terminal vs INTERRUPTED). Every
	 * recovery exit that is NOT "journal terminal found" must settle it here:
	 * local INTERRUPTED, failed/locked recovery, and newSession(). Resolving
	 * (not rejecting) matches the journal-terminal arm above and lets seam-rows'
	 * .finally() finalize the partial text; the view learns the interrupted
	 * reason from the bridge.turn.interrupted event emitted at that site.
	 *
	 * Clear the slots BEFORE resolving so turn()'s own finally sees a different
	 * generation and cannot double-settle or race a newer turn's state.
	 */
	#settleSuspendedTurn(): void {
		const done = this.#turnDone
		const endedTurnId = this.#inFlightTurnId
		this.#turnDone = undefined
		this.#activeCallbacks = undefined
		this.#inFlightTurnId = undefined
		this.#inFlightGeneration = 0
		this.#turn = "idle"
		if (endedTurnId !== undefined) this.#cancelAsksForTurn(endedTurnId)
		done?.()
	}

	async turn(userText: string, cb: SeamTurnCallbacks): Promise<void> {
		// ADR-0011 T4: cb.onApprove is the turn-scoped answerer for `ask.request
		// {kind:"approval"}` frames (it shadows the registered ask provider for
		// this turn only). The active callbacks are installed below before send;
		// #answerAsk reads them under the in-flight generation guard.

		// P1-3 REENTRANCY SEMANTICS: reject, do not queue. The bridge drives one
		// turn per session (TURN_BUSY on a second send), so an overlapping turn()
		// is not meaningful work to defer — it is a caller bug. Rejecting keeps
		// the single-slot callback/waiter state sound. Callers must await the
		// first turn() before starting another.
		if (this.#inFlightGeneration !== 0) {
			throw new BridgeProtocolError(
				"TURN_REENTRANT",
				"turn() called while another turn is in flight; await the first turn()",
				{ activeTurnId: this.#inFlightTurnId },
			)
		}

		// Claim a generation BEFORE any await. Only this generation's finally
		// may clear the slots; a stale turn cannot wipe a newer one's state.
		const gen = ++this.#turnGeneration
		this.#inFlightGeneration = gen
		// A7: a NEW turn supersedes any stale death snapshot; start a fresh
		// partial-text accumulator for this generation.
		this.#deadInFlight = undefined
		this.#inFlightPartial = ""
		let sendFailed: unknown
		try {
			// Bind a staged id (resume/new) at the next turn, as in the remote seam.
			// Default startup (autoResume off / no --session) stages NOTHING, so
			// the first turn used to reach session.send with no bridge binding
			// and the bridge answered SESSION_NOT_OPEN — no turn started, so the
			// pre-execute gate never fired and no approval ask.card was pushed.
			// Mirror RemoteHostSession.#ensureSession(): when no id is staged and
			// no session is attached yet, stage a fresh session on this turn so
			// the bridge binds it BEFORE send. --session / auto-resume / /new
			// still win because they stage #pendingOpen explicitly.
			if (this.#pendingOpen === undefined && !this.#sessionAttached) {
				this.#pendingOpen = { mode: "new" }
			}
			if (this.#pendingOpen !== undefined) {
				const pending = this.#pendingOpen
				this.#pendingOpen = undefined
				const params: Record<string, unknown> =
					pending.mode === "resume"
						? { mode: "resume", id: pending.id, ...(this.#sessionAttached ? { replace: true } : {}) }
						: { mode: "new", ...(this.#sessionAttached ? { replace: true } : {}) }
				try {
					const opened = asRecord(await this.#transport.request("session.open", params))
					if (typeof opened.sessionId === "string") this.#currentSessionId = opened.sessionId
					// A4: lastAppliedSeq is per-session. A different binding starts a
					// fresh journal, so the next recovery must replay from 1.
					if (this.#lastAppliedSessionId !== this.#currentSessionId) {
						this.#lastAppliedSessionId = this.#currentSessionId
						this.#lastAppliedSeq = undefined
						this.#appliedReplayKeys.clear()
					}
					this.#sessionAttached = true
				} catch (err) {
					// SESSION_LOCKED / SESSION_NOT_FOUND surface to the turn caller.
					throw err
				}
			}

			// Register the terminal waiter and live callbacks BEFORE send: the
			// bridge emits turn.start ahead of its send response, so early deltas
			// must reach the callbacks even though turnId is not known yet.
			this.#activeCallbacks = cb
			const done = new Promise<void>((resolve) => {
				this.#turnDone = resolve
			})
			const sent = asRecord(await this.#transport.request("session.send", { text: userText }))
			if (typeof sent.turnId === "string") {
				this.#inFlightTurnId = sent.turnId
				// A7 scenario 3: session.send resolves with a turnId = the submit
				// ACK. The submit path carries NO client inputId (see report), so
				// the view matches this ACK to its optimistic user row by text.
				this.#emitEvent({
					type: "bridge.input.acked",
					details: { sessionID: this.#currentSessionId ?? "", turnId: sent.turnId, text: userText },
				})
			}
			await done
		} catch (err) {
			sendFailed = err
		} finally {
			// Generation guard: only clear the slots if they still belong to
			// THIS turn. A stale finally (send/reject resolving late) must not
			// clear a newer generation's callbacks, waiter or turnId.
			if (this.#inFlightGeneration === gen) {
				const endedTurnId = this.#inFlightTurnId
				this.#activeCallbacks = undefined
				this.#turnDone = undefined
				this.#inFlightTurnId = undefined
				this.#inFlightGeneration = 0
				this.#turn = "idle"
				// Turn end is the upper bound for every ask it opened (A1/D5):
				// resolve their waiters and drop them even if no terminal frame
				// arrived (e.g. session.send failed).
				if (endedTurnId !== undefined) this.#cancelAsksForTurn(endedTurnId)
			}
		}
		if (sendFailed !== undefined) throw sendFailed
	}

	async dispose(): Promise<void> {
		if (this.#disposed) return
		this.#disposed = true
		this.#unsubEvent()
		this.#listeners.length = 0
		this.#subagentListeners.clear()
		this.#subagentViews.clear()
		this.#subagentRunSeq.clear()
		this.#subagentLiveStarts.clear()
		this.#activeCallbacks = undefined
		this.#cancelAllAsks()
		// A6: release buffered/invalidated recovery state on dispose.
		this.#bufferedPendingSnapshot = undefined
		this.#replayDrainPending = false
		this.#invalidatedAsks.clear()
		this.#turnDone?.()
		this.#turnDone = undefined
		this.#inFlightTurnId = undefined
		this.#inFlightGeneration = 0
		this.#inFlightPartial = ""
		this.#deadInFlight = undefined
		this.#turn = "idle"
		try {
			if (this.#sessionAttached) await this.#transport.request("session.close")
		} catch (err) {
			// Teardown is best-effort: a dropped connection must still dispose.
			this.#ctx.logger.warn("[bridge-seam] session.close failed during dispose: %s", err)
		}
		this.#sessionAttached = false
		this.#currentSessionId = undefined
	}

	// ----- out-of-batch members: honest D3 stubs (later batch) --------------

	async searchSessions(_query: string): Promise<{ id: string; snippet: string }[]> {
		return unsupported("searchSessions")
	}

	async renameSession(_title: string): Promise<{ title: string; seq: number } | undefined> {
		return unsupported("renameSession")
	}

	steer(_text: string): void {
		this.#degrade("steer", "no session.steer frame; steer is a no-op")
	}

	registerAskProvider(onAsk: (questions: SeamAskQuestion[]) => Promise<SeamAskPick[]>): void {
		// ADR-0011 T4: really save the answerer. It is the default for
		// `ask.request{kind:"questions"}` and the fallback for approval asks
		// outside a turn; a turn-scoped onApprove shadows it for that turn.
		this.#askProvider = onAsk
	}

	/** ADR-0011: read-only snapshot of the still-pending asks (reconnect cards,
	 *  T5 UI). Fresh shallow copies — callers cannot mutate the live queue. */
	pendingAsks(): readonly BridgeAskRequestPayload[] {
		return [...this.#pendingAsks.values()].map((entry) => ({ ...entry.request }))
	}

	/** A6: read-only rebuilt-and-invalidated asks (eventId → reason). A rebuilt
	 *  card whose `ask.response` failed (ASK_UNKNOWN_REQUEST / ASK_TURN_ENDED)
	 *  lands here as a TERMINAL state with its reason — it never silently
	 *  disappears. Fresh copy so callers cannot mutate the live map. */
	invalidatedAsks(): ReadonlyMap<string, string> {
		return new Map(this.#invalidatedAsks)
	}

	async listProviders(): Promise<{ provider: string; models: string[] }[]> {
		return unsupported("listProviders")
	}

	async modelCatalog(_force?: boolean): Promise<SeamProviderModel[]> {
		return unsupported("modelCatalog")
	}

	selectModel(_providerID: string, _modelID: string): Promise<void> {
		return Promise.reject(new BridgeProtocolError("UNSUPPORTED", "selectModel is not backed by the in-process bridge", { capability: "selectModel" }))
	}

	// ------------------------------------------------------------------
	// ADR-0011 ask queue / answerer resolution
	// ------------------------------------------------------------------

	/**
	 * Map an approval verdict to `ask.response` params. `allowed-once` /
	 * `rejected` are the real SeamApprovalVerdict values. The widened
	 * `always` / `session` behaviors are only legal when the request carried
	 * `escalation:true`; otherwise return undefined so NO frame is sent (the
	 * host would answer ASK_INVALID_RESPONSE — refuse locally instead).
	 */
	#approvalParams(request: BridgeAskRequestPayload, verdict: BridgeApproveVerdict): Record<string, unknown> | undefined {
		const base = { eventId: request.eventId, kind: "approval" as const }
		switch (verdict) {
			case "allowed-once":
				return { ...base, verdict: "allowed-once" }
			case "rejected":
				return { ...base, verdict: "rejected" }
			case "always":
			case "session":
				if (request.escalation !== true) {
					this.#degradeOnce(
						"ask.invalid-escalation",
						`behavior:${verdict} needs a granted escalation; refusing to send ask.response (ASK_INVALID_RESPONSE)`,
					)
					return undefined
				}
				return { ...base, verdict: "allowed-once", behavior: verdict, escalation: true }
			default:
				// Unknown verdict → fail closed (deny), never an implicit allow.
				return { ...base, verdict: "rejected" }
		}
	}

	/** A6: rebuild the local ask queue from a reconnect snapshot. The eventId is
	 *  preserved verbatim (parseAskRequest keeps it), so rebuilt cards answer
	 *  through the EXISTING ask.response path — D4 first-wins stays in the host.
	 *  Old waiters are cancelled first so no snapshot leaves a dangling promise. */
	#applyPendingSnapshot(asks: readonly BridgeAskRequestPayload[]): void {
		this.#cancelAllAsks()
		for (const request of asks) {
			this.#invalidatedAsks.delete(request.eventId)
			this.#enqueueAsk(request)
		}
	}

	/** A6: `ask.response` failed for a reason that means the ask can no longer
	 *  be answered — the ask was evicted, its turn/session is dead, OR the bridge
	 *  connection itself is gone. `ASK_NOT_FOUND` is a defensive alias (ADR-0011's
	 *  code for an unknown eventId is `ASK_UNKNOWN_REQUEST`). RM-2b V3: a DEAD
	 *  bridge rejects every request with `BRIDGE_DEAD` (`bridge-transport.ts`),
	 *  so answering a still-pending card during DEAD must map to the terminal
	 *  invalidated state instead of silently dropping the card. `BRIDGE_CLOSED`
	 *  is the same connection-level class (transport closed, terminal). */
	#isDeadResponseError(err: unknown): string | undefined {
		const code = err instanceof BridgeProtocolError ? err.code
			: err !== null && typeof err === "object" && typeof (err as { code?: unknown }).code === "string"
				? (err as { code: string }).code
				: undefined
		if (
			code === "ASK_NOT_FOUND" || code === "ASK_UNKNOWN_REQUEST" || code === "ASK_TURN_ENDED" ||
			code === "BRIDGE_DEAD" || code === "BRIDGE_CLOSED"
		) {
			return err instanceof Error && err.message !== "" ? `${code}: ${err.message}` : code
		}
		return undefined
	}

	/** Enqueue a freshly received ask and start its answer task. Duplicate
	 *  eventIds are dropped (first-wins / replay safety, A2/A5). */
	#enqueueAsk(request: BridgeAskRequestPayload): void {
		if (this.#disposed || this.#pendingAsks.has(request.eventId)) return
		this.#invalidatedAsks.delete(request.eventId)
		let finish!: () => void
		const done = new Promise<void>((resolve) => { finish = resolve })
		const entry: PendingAskEntry = {
			request,
			turnId: askTurnId(request.eventId),
			cancelled: false,
			done,
			finish,
		}
		this.#pendingAsks.set(request.eventId, entry)
		void this.#answerAsk(entry)
	}

	/**
	 * Resolve the answerer and send exactly one `ask.response`. Turn-scoped
	 * onApprove wins over the registered provider for approval asks and only
	 * while that turn is in flight. Questions always use the registered
	 * provider. No provider / provider failure → explicit `verdict:"unavailable"`
	 * (ASK_CHANNEL_UNAVAILABLE), never a silent approve.
	 */
	async #answerAsk(entry: PendingAskEntry): Promise<void> {
		const request = entry.request
		let params: Record<string, unknown> | undefined
		try {
			if (request.kind === "approval") {
				const cb = this.#inFlightGeneration !== 0 ? this.#activeCallbacks : undefined
				if (cb !== undefined) {
					const verdict = await cb.onApprove(request.toolName ?? "tool", approvalArgs(request))
					params = this.#approvalParams(request, verdict)
				} else if (this.#askProvider !== undefined) {
					const picks = await this.#askProvider([approvalQuestion(request)])
					params = this.#approvalParams(request, approvalVerdictFromPicks(request, picks))
				} else {
					this.#degradeOnce("ask.no-provider", "no onApprove/ask provider; answering approval unavailable (ASK_CHANNEL_UNAVAILABLE)")
					// ADR-0011 T8: a fail-closed ask with no answerer is the precise
					// moment to probe the catalog; it returns undefined and fires the
					// one-shot transient notice. Never on boot (avoids false alarms).
					void this.permissionCatalog()
					params = unavailableResponse(request)
				}
			} else if (this.#askProvider !== undefined) {
				const picks = await this.#askProvider(request.questions ?? [])
				params = { eventId: request.eventId, kind: "questions", answers: answersFor(request, picks) }
			} else {
				this.#degradeOnce("ask.no-provider", "no ask provider; answering questions unavailable (ASK_CHANNEL_UNAVAILABLE)")
				void this.permissionCatalog() // ADR-0011 T8: one-shot fail-closed notice
				params = unavailableResponse(request)
			}
		} catch (err) {
			// A provider that throws is a fail-closed answer, never an implicit
			// allow and never a dangling promise.
			this.#degradeOnce("ask.provider-error", "ask provider threw; answering unavailable (ASK_CHANNEL_UNAVAILABLE)")
			this.#ctx.logger.warn("[bridge-seam] ask provider failed: %s", err)
			params = unavailableResponse(request)
		}

		// cancel / host-settled / turn end / snapshot replacement may have
		// removed this entry while the provider was pending: never send then.
		if (entry.cancelled || this.#pendingAsks.get(request.eventId) !== entry) {
			entry.finish()
			return
		}
		if (params !== undefined) {
			try {
				await this.#transport.request("ask.response", params)
			} catch (err) {
				// A late response gets ASK_TURN_ENDED / ASK_ALREADY_ANSWERED from
				// the host; log it, never retry (first-wins lives in the bridge).
				this.#ctx.logger.warn("[bridge-seam] ask.response failed for %s: %s", request.eventId, err)
				// A6: a rebuilt card whose ask/turn is gone must not silently
				// vanish. Record a terminal invalidated state + reason and let the
				// view paint it; the local entry is KEPT so syncPendingAsks() does
				// not close the card as an ordinary cancellation.
				const reason = this.#isDeadResponseError(err)
				if (reason !== undefined) {
					this.#invalidatedAsks.set(request.eventId, reason)
					this.#emitEvent({
						type: "bridge.ask.invalidated",
						details: { eventId: request.eventId, sessionId: request.sessionId, reason },
					})
				}
			}
		}
		entry.finish()
		// P2-3: an invalidated entry is KEPT in #pendingAsks through the DEAD
		// window as a terminal card (reason in #invalidatedAsks) so it never
		// vanishes silently mid-crash. It is NOT permanent: a successful
		// recovery's pending-snapshot rebuild clears it along with the view's
		// cards (RM-2c observed ≤200ms post-recovery). This mirrors the
		// turn-overlay-controller invalidateAll() comment.
		if (!this.#invalidatedAsks.has(request.eventId) && this.#pendingAsks.get(request.eventId) === entry) {
			this.#pendingAsks.delete(request.eventId)
		}
	}

	/** Drop one ask: cancel, host-settled or superseded. Always resolves the
	 *  waiter so no consumer hangs (A2/D5). */
	#settlePendingAsk(eventId: string): void {
		const entry = this.#pendingAsks.get(eventId)
		if (entry === undefined) return
		entry.cancelled = true
		this.#pendingAsks.delete(eventId)
		entry.finish()
	}

	#cancelAsksForTurn(turnId: string): void {
		if (turnId === "") return
		for (const [eventId, entry] of [...this.#pendingAsks]) {
			if (entry.turnId === turnId) this.#settlePendingAsk(eventId)
		}
	}

	#cancelAllAsks(): void {
		for (const eventId of [...this.#pendingAsks.keys()]) this.#settlePendingAsk(eventId)
	}

	/** Handle the four host→client ask events. Returns true when consumed. */
	#onAskEvent(frame: BridgeEventFrame): boolean {
		const payload = asRecord(frame.payload)
		// ADR-0011 T8: a delivered ask.request / ask.pending proves the host
		// armed its ask answerers — the availability signal permissionCatalog()
		// reads (bridge has no capability field and no catalog RPC).
		if (frame.type === "ask.request" || frame.type === "ask.pending") this.#askFrameSeen = true
		switch (frame.type) {
			case "ask.request": {
				const request = parseAskRequest(frame.payload)
				if (request !== undefined) this.#enqueueAsk(request)
				return true
			}
			case "ask.cancel": {
				const eventId = optionalStringField(payload, "eventId")
				if (eventId !== undefined) this.#settlePendingAsk(eventId)
				return true
			}
			case "ask.settled": {
				// Host broadcast: this eventId is closed — de-dup any local copy.
				const eventId = optionalStringField(payload, "eventId")
				if (eventId !== undefined) this.#settlePendingAsk(eventId)
				return true
			}
			case "ask.pending": {
				const asks: BridgeAskRequestPayload[] = []
				const rawAsks = Array.isArray(payload.asks) ? payload.asks : []
				for (const raw of rawAsks) {
					const request = parseAskRequest(raw)
					if (request !== undefined) asks.push(request)
				}
				// A6 timing gate: while recovery's journal replay drain is in
				// flight, BUFFER the snapshot. Cards are rebuilt only after the
				// drain completes (blocky §2.3 step 6), never racing replay. A
				// snapshot arriving with no drain pending still applies at once
				// (ordinary /resume or a frame that lost the race to the drain).
				if (this.#replayDrainPending) {
					this.#bufferedPendingSnapshot = asks
					return true
				}
				this.#applyPendingSnapshot(asks)
				return true
			}
			default:
				return false
		}
	}

	// ------------------------------------------------------------------
	// event pump / state machine
	// ------------------------------------------------------------------

	/** Push an event to every view listener; one stale listener never breaks the
	 *  feed (same containment as the recover/dead event emissions). */
	#emitEvent(event: SeamSessionEvent): void {
		for (const listener of [...this.#listeners]) {
			try {
				listener(event)
			} catch {
				/* one stale view listener must not break the feed */
			}
		}
	}

	#degrade(member: string, reason: string): void {
		this.#ctx.logger.warn("[bridge-seam] %s degraded: %s", member, reason)
	}

	/** P2-9: warn once per degrade class; later hits (idle polling) stay silent. */
	#degradeOnce(member: string, reason: string): void {
		if (this.#degradedOnce.has(member)) return
		this.#degradedOnce.add(member)
		this.#degrade(member, reason)
	}

	#onBridgeEvent(frame: BridgeEventFrame): void {
		// ADR-0011 ask frames own their own queue — never project them as turn
		// deltas or session events (they are not transcript rows).
		if (this.#onAskEvent(frame)) return

		// Additive subagent lifecycle frames (row 33 inproc): feed the onSubagentViews
		// face, never the transcript/status pipeline. An unknown frame is a no-op.
		if (frame.type === "agent.spawn" || frame.type === "agent.settle") {
			this.#foldAgentFrame(frame)
			return
		}

		// A2: DEAD is published on the existing onEvent pipeline (no polling).
		// Event-driven so an idle-period crash — no in-flight turn — paints the
		// notice immediately. Re-emit as a SeamSessionEvent for the view and call
		// the composition-root callback synchronously.
		if (frame.type === "bridge.dead") {
			const cause = asDeadCause(frame.payload)
			// A7: snapshot the in-flight turn BEFORE any state flip. The DEAD
			// transition is the only moment we can factually say "a turn was
			// in flight"; replay later decides whether the host terminalized it.
			if (this.#inFlightGeneration !== 0 && this.#inFlightTurnId !== undefined && this.#inFlightTurnId !== "") {
				this.#deadInFlight = { turnId: this.#inFlightTurnId, partial: this.#inFlightPartial }
			}
			this.#bridgeLink = "dead"
			this.#connection = "disconnected"
			this.#turn = "idle"
			this.#onDead?.(cause)
			for (const listener of [...this.#listeners]) {
				try {
					listener({ type: "bridge.dead", details: cause })
				} catch {
					/* one stale view listener must not break the feed */
				}
			}
			return
		}

		const payload = asRecord(frame.payload)
		// status state machine (no reconnect precision — D3: idle on ambiguity).
		if (frame.type === "turn.start") {
			this.#turn = "starting"
			// A new turn opens a fresh decode window (closed at turn.end).
			this.#decodeWindowStart = undefined
		}
		if (frame.type === "turn.token" || frame.type === "turn.tool") this.#turn = "running"
		if (frame.type === "turn.end" || frame.type === "turn.error") {
			this.#turn = "idle"
			const endedTurnId = typeof payload.turnId === "string" ? payload.turnId : this.#inFlightTurnId
			this.#inFlightTurnId = undefined
			// Turn terminal frame is the upper bound for its asks (A1/D5).
			if (endedTurnId !== undefined) this.#cancelAsksForTurn(endedTurnId)
			this.#turnDone?.()
		}

		// Cache billed usage on EVERY turn.end, not only turns this seam drove:
		// the status bar reads usageSummary() synchronously and must reflect
		// usage from any turn on this connection.
		if (frame.type === "turn.end") {
			const usage = parseUsage(payload.usage)
			if (Object.keys(usage).length > 0) {
				this.#usage.turns += 1
				for (const key of ["prompt", "completion", "cacheRead", "cacheWrite"] as const) {
					this.#usage[key] += usage[key] ?? 0
				}
			}
			// Close the decode window: billed completion tokens over the time from
			// the first streamed delta to this terminal frame. A turn with no
			// observed token (e.g. tool-only) has no window and no tps sample.
			const start = this.#decodeWindowStart
			const tokens = usage.completion ?? 0
			if (start !== undefined && tokens > 0) {
				const ms = Date.now() - start
				if (ms > 0) {
					this.#lastTurnDecode = { tokens, ms }
					this.#decodeTotals.tokens += tokens
					this.#decodeTotals.ms += ms
				}
			}
			this.#decodeWindowStart = undefined
		}

		// A7: remember the text already delivered to the view so a local
		// INTERRUPTED marker can report what was produced. Bounded to avoid an
		// unbounded buffer on a long stream; this is a local fact, never a
		// journal write.
		if (frame.type === "turn.token" && payload.kind !== "reasoning" && typeof payload.text === "string" && payload.text) {
			// First visible delta opens the decode window (first-delta → settle).
			if (this.#decodeWindowStart === undefined) this.#decodeWindowStart = Date.now()
			this.#inFlightPartial = (this.#inFlightPartial + payload.text).slice(-4096)
		}

		// live turn callbacks (double-paint law: content goes through turn()).
		const cb = this.#activeCallbacks
		if (cb !== undefined) {
			if (frame.type === "turn.token") {
				const text = typeof payload.text === "string" ? payload.text : ""
				if (payload.kind === "reasoning") {
					if (text) cb.onThinkingDelta(text)
				} else if (text) {
					cb.onContentDelta(text)
				}
			} else if (frame.type === "turn.tool") {
				// The bridge's turn.tool carries either `input` (call) or
				// `output` (result) — no callId on the wire, so that arm degrades.
				const name = typeof payload.name === "string" ? payload.name : "tool"
				if (payload.input !== undefined) {
					cb.onToolStart?.({ name, args: JSON.stringify(payload.input) })
				} else if (payload.output !== undefined) {
					cb.onToolRun?.({
						name,
						argsPretty: "",
						output: typeof payload.output === "string" ? payload.output : "",
						ok: true,
					})
				}
			} else if (frame.type === "turn.error") {
				cb.onError(typeof payload.message === "string" ? payload.message : "turn failed")
			}
		}

		// project the lifecycle/error events to onSessionEvent listeners.
		const events = projectBridgeEvent(frame, this.#currentSessionId ?? "")
		for (const event of events) {
			for (const listener of this.#listeners) {
				try {
					listener(event)
				} catch {
					/* one stale view listener must not break the feed */
				}
			}
		}
	}
}
