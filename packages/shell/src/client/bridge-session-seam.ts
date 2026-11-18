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
	SeamProviderModel,
	SeamSessionEvent,
	SeamSessionSummary,
	SeamStatus,
	SeamTranscriptRow,
	SeamTurnCallbacks,
	SessionSeam,
} from "../../../tui-base/src/seams/session"
import type { RemoteJournalEntry } from "./remote-session-ops.ts"
import { journalToTranscriptRows } from "./remote-session-ops.ts"

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

export interface BridgeSessionSeamOptions {
	transport: BridgeTransport
	ctx: BridgeSeamContext
	/** A2: called synchronously once when a `bridge.dead` frame arrives, even
	 *  with no in-flight turn (the idle-period crash case). The composition
	 *  root turns this into an immediate transient UI notice. */
	onDead?: (cause: BridgeDeadCause) => void
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

function parseUsage(value: unknown): Partial<UsageAccumulator> {
	const u = asRecord(value)
	const num = (key: string): number | undefined =>
		typeof u[key] === "number" && Number.isFinite(u[key]) ? (u[key] as number) : undefined
	const out: Partial<UsageAccumulator> = {}
	for (const key of ["prompt", "completion", "cacheRead", "cacheWrite"] as const) {
		const n = num(key)
		if (n !== undefined) out[key] = n
	}
	return out
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
				const result: BridgeRecoveryResult = {
					state: "locked", sessionId, applied: 0, from: 0, cursor: 0, rows: [],
					error: { code, message },
				}
				emit({
					type: "bridge.recovery.locked",
					details: { ...result, message: `会话已被占用，已连接未挂载: ${message}` },
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
		const rows = bridgeReplayRowsToSeamTranscript(drained.rows)
		if (drained.rows.length > 0) {
			const maxSeq = drained.rows.reduce((m, row) => Math.max(m, row.seq), -Infinity)
			this.#lastAppliedSeq = Math.max(this.#lastAppliedSeq ?? 0, maxSeq)
			this.#lastAppliedSessionId = boundId
		}

		// (d) A6 timing gate — ONLY now that the replay drain has completed do
		// we rebuild pending cards from a buffered `ask.pending` snapshot. The
		// eventId is preserved verbatim so the cards answer through the existing
		// ask.response path (blocky §2.3 step 6; A4/A5 recovery order).
		const buffered = this.#bufferedPendingSnapshot
		this.#bufferedPendingSnapshot = undefined
		this.#replayDrainPending = false
		if (buffered !== undefined) this.#applyPendingSnapshot(buffered)

		// (e) A7 — the in-flight turn at DEAD gets a LOCAL INTERRUPTED marker
		// ONLY when the durable journal stays silent about its terminal. If a
		// `turn/end` / `turn/error` was replayed, the host's real terminal is
		// already in the transcript — do NOT paint a second one. This event is
		// client-inferred (seq:null, source:"local") and is NEVER journaled.
		const dead = this.#deadInFlight
		this.#deadInFlight = undefined
		if (dead !== undefined && !journalHasTurnTerminal(drained.rows)) {
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

	/** A6: `ask.response` failed for a reason that means the rebuilt ask can no
	 *  longer be answered — the ask was evicted or its turn/session is dead.
	 *  `ASK_NOT_FOUND` is accepted as a defensive alias (ADR-0011's code for an
	 *  unknown eventId is `ASK_UNKNOWN_REQUEST`). */
	#isDeadResponseError(err: unknown): string | undefined {
		const code = err instanceof BridgeProtocolError ? err.code
			: err !== null && typeof err === "object" && typeof (err as { code?: unknown }).code === "string"
				? (err as { code: string }).code
				: undefined
		if (code === "ASK_NOT_FOUND" || code === "ASK_UNKNOWN_REQUEST" || code === "ASK_TURN_ENDED") {
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
					params = unavailableResponse(request)
				}
			} else if (this.#askProvider !== undefined) {
				const picks = await this.#askProvider(request.questions ?? [])
				params = { eventId: request.eventId, kind: "questions", answers: answersFor(request, picks) }
			} else {
				this.#degradeOnce("ask.no-provider", "no ask provider; answering questions unavailable (ASK_CHANNEL_UNAVAILABLE)")
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
		// Invalidated entries stay in #pendingAsks as a terminal card (with the
		// reason in #invalidatedAsks) so they never disappear silently.
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
		if (frame.type === "turn.start") this.#turn = "starting"
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
		}

		// A7: remember the text already delivered to the view so a local
		// INTERRUPTED marker can report what was produced. Bounded to avoid an
		// unbounded buffer on a long stream; this is a local fact, never a
		// journal write.
		if (frame.type === "turn.token" && payload.kind !== "reasoning" && typeof payload.text === "string" && payload.text) {
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
