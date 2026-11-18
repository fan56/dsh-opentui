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

export class BridgeSessionSeam implements SessionSeam {
	readonly #transport: BridgeTransport
	readonly #ctx: BridgeSeamContext
	readonly #unsubEvent: () => void
	readonly #listeners: ((event: SeamSessionEvent) => void)[] = []

	// status state machine (no dedicated status frame — ticket §1 #1).
	#connection: SeamStatus["connection"] = "disconnected"
	#turn: SeamStatus["turn"] = "idle"
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
	#usage: UsageAccumulator = { turns: 0, prompt: 0, completion: 0, cacheRead: 0, cacheWrite: 0 }
	#disposed = false

	constructor(options: BridgeSessionSeamOptions) {
		this.#transport = options.transport
		this.#ctx = options.ctx
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
			this.#degrade("status", "no handshake/status frame; returning disconnected/idle")
		}
		return { connection: this.#connection, turn: this.#turn, sessionAttached: this.#sessionAttached }
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
		// The BRIDGE still holds the old session open until that next turn —
		// #sessionAttached stays true so the staged open carries replace:true
		// (otherwise the bridge answers ALREADY_OPEN).
		this.#currentSessionId = undefined
		this.#pendingOpen = { mode: "new" }
	}

	interrupt(): void {
		// PARTIAL: turn.abort is real, but the seam is sync void and needs the
		// turnId from the live turn. Without one, degrade to a no-op + log.
		const turnId = this.#inFlightTurnId
		if (turnId === undefined || turnId === "") {
			this.#degrade("interrupt", "no in-flight turnId; turn.abort skipped (no-op)")
			return
		}
		// Fire-and-forget: a sync member cannot await the bridge response.
		void this.#transport.request("turn.abort", { turnId }).catch((err: unknown) => {
			this.#ctx.logger.warn("[bridge-seam] turn.abort failed (fire-and-forget): %s", err)
		})
	}

	usageSummary(): string[] {
		// PARTIAL: cache turn.end.usage; sync read, so no data = empty + log.
		if (this.#usage.turns === 0) {
			this.#degrade("usageSummary", "no turn.end usage captured yet; returning []")
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
		// bridge.shutdown do not exist on the wire. Log that gap once.
		this.#degrade("onSessionEvent", "only turn.* lifecycle/error events project; permission.asked / bridge.shutdown absent")
		this.#listeners.push(listener)
		return () => {
			const i = this.#listeners.indexOf(listener)
			if (i >= 0) this.#listeners.splice(i, 1)
		}
	}

	// ----- async members (D3: UNSUPPORTED error, never fake success) --------

	async listSessions(limit?: number): Promise<SeamSessionSummary[]> {
		// session.list is read-only; on a stock opentui-inproc profile the host
		// returns ok:false{code:"UNSUPPORTED"} (sessionController is mounted by
		// dsh-web-app, not the base+bridge bundle). The transport rejects with
		// BridgeProtocolError(code=UNSUPPORTED) and we MUST let it propagate —
		// no `catch { return [] }`. (Do not "fix" this by changing the profile.)
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
		// PARTIAL: host reads currentSelection() internally but no frame exists
		// yet. The request is wired so the frame can land without a seam change;
		// today the bridge answers UNSUPPORTED (unknown method), which propagates.
		const selection = await this.#transport.request("model.currentSelection")
		if (selection === undefined || selection === null) return undefined
		const s = asRecord(selection)
		const providerID = typeof s.provider === "string" ? s.provider : ""
		const modelID = typeof s.model === "string" ? s.model : ""
		if (!providerID || !modelID) return undefined
		return { providerID, modelID }
	}

	async turn(userText: string, cb: SeamTurnCallbacks): Promise<void> {
		// PARTIAL: session.send + turn.* stream. onApprove has no ask frame, so
		// this seam cannot ever call it — log that degrade once per call so the
		// UI owner knows approval is unavailable on this path.
		this.#degrade("turn.onApprove", "bridge has no ask/permission frame; onApprove will not fire")

		// Bind a staged id (resume/new) at the next turn, as in the remote seam.
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
		let sendFailed: unknown
		try {
			const sent = asRecord(await this.#transport.request("session.send", { text: userText }))
			if (typeof sent.turnId === "string") this.#inFlightTurnId = sent.turnId
			await done
		} catch (err) {
			sendFailed = err
		} finally {
			this.#activeCallbacks = undefined
			this.#turnDone = undefined
			this.#inFlightTurnId = undefined
			this.#turn = "idle"
		}
		if (sendFailed !== undefined) throw sendFailed
	}

	async dispose(): Promise<void> {
		if (this.#disposed) return
		this.#disposed = true
		this.#unsubEvent()
		this.#listeners.length = 0
		this.#activeCallbacks = undefined
		this.#turnDone?.()
		this.#turnDone = undefined
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

	registerAskProvider(_onAsk: (questions: SeamAskQuestion[]) => Promise<SeamAskPick[]>): void {
		// UI MUST surface ask/approve as unavailable — registration is empty.
		this.#degrade("registerAskProvider", "no ask/permission frames; provider registration is empty (ask/approve unavailable)")
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
	// event pump / state machine
	// ------------------------------------------------------------------

	#degrade(member: string, reason: string): void {
		this.#ctx.logger.warn("[bridge-seam] %s degraded: %s", member, reason)
	}

	#onBridgeEvent(frame: BridgeEventFrame): void {
		const payload = asRecord(frame.payload)
		// status state machine (no reconnect precision — D3: idle on ambiguity).
		if (frame.type === "turn.start") this.#turn = "starting"
		if (frame.type === "turn.token" || frame.type === "turn.tool") this.#turn = "running"
		if (frame.type === "turn.end" || frame.type === "turn.error") {
			this.#turn = "idle"
			this.#inFlightTurnId = undefined
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
