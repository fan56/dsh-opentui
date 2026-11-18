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

/** Structured cause captured the first time the transport enters DEAD (A1),
 *  republished on the existing `onEvent` pipeline as a `bridge.dead` frame. */
export interface BridgeDeadCause {
	stage: BridgeDeadStage
	/** Process exit code on a runtime exit; null when unavailable. */
	code: number | null
	/** Terminating signal on a runtime exit; null when unavailable. */
	signal: string | null
	/** Short human-readable summary. */
	message: string
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
	#currentSessionId: string | undefined
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
			if (typeof sent.turnId === "string") this.#inFlightTurnId = sent.turnId
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
		this.#turnDone?.()
		this.#turnDone = undefined
		this.#inFlightTurnId = undefined
		this.#inFlightGeneration = 0
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

	/** Enqueue a freshly received ask and start its answer task. Duplicate
	 *  eventIds are dropped (first-wins / replay safety, A2/A5). */
	#enqueueAsk(request: BridgeAskRequestPayload): void {
		if (this.#disposed || this.#pendingAsks.has(request.eventId)) return
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
			}
		}
		entry.finish()
		if (this.#pendingAsks.get(request.eventId) === entry) this.#pendingAsks.delete(request.eventId)
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
				// Reconnect snapshot replaces the whole queue. Resolve every old
				// waiter before enqueueing the fresh set (no dangling promises).
				this.#cancelAllAsks()
				const asks = Array.isArray(payload.asks) ? payload.asks : []
				for (const raw of asks) {
					const request = parseAskRequest(raw)
					if (request !== undefined) this.#enqueueAsk(request)
				}
				return true
			}
			default:
				return false
		}
	}

	// ------------------------------------------------------------------
	// event pump / state machine
	// ------------------------------------------------------------------

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
