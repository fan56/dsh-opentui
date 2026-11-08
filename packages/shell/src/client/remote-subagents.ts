/**
 * Subagent panel aggregation for the client-mode session layer (ADR-0005
 * bucket (b) wave 3; audit row 33).
 *
 * The in-process panel rode the firehose (host-session.ts:921-1054): it
 * adopted children by session header, paired tool-workflow runs, and kept
 * the live child agent for steer. The Remote surface replaces each leg:
 *
 * - ADOPTION: `session/list` rows (`parentSessionId` + `origin:'subagent'`)
 *   plus `api-session/added|removed|status` push events (the forwarded
 *   allowlist carries them; `added` ships the full SessionSummary row).
 * - PAIRING: `tool-workflow/agent-start|agent-end` are DURABLE parent
 *   events — they arrive on the parent's `session/follow` journal, so the
 *   facade feeds every record here (the runId:seq pairing map of
 *   host-session.ts:1318-1325 parity).
 * - TRANSCRIPT/VIEWS: one read-only `session/follow` per child with the
 *   `address.kind:'subagent'` wire address ({parentSessionId,
 *   childSessionId, mode:'unknown'}), durable records folded exactly like
 *   host-session.ts:992-1035 (descriptor label/model/mode, request/header
 *   model, assistant/message rounds/tokens/lastLine, tool ▶/⎿ log lines) —
 *   plus `assistantStream:true` so live text deltas scroll `lastLine`
 *   like the firehose path did (:1232-1238).
 * - STEER: `subagents/prompt` {request{parentSessionId, childSessionId,
 *   mode:'continuable', delivery:'steer', content}} — HOST POLICY rejects
 *   non-continuable/one-shot children with `subagent/not-resumable`
 *   (typed RemoteError). The facade surfaces that as the SAME shape the
 *   in-process steerChild path yields — a false return with the typed
 *   reason logged (UX parity) — plus a detailed async variant that
 *   carries the typed error honestly.
 * - INTERRUPT: `subagents/interruptByParent`
 *   {childSessionId, parentSessionId, mode:'continuable'}.
 *
 * One-shot children never turn/end (host-session.ts:1011 comment) — their
 * settlement comes from the agent-end pairing and `session/list`
 * `running` flags, never from a child turn/end.
 */

import { randomUUID } from "node:crypto"
import type { MuxSocketFactory } from "./events-source.ts"
import { blocksText } from "./remote-follow.ts"
import type { RemoteJournalEntry } from "./remote-session-ops.ts"
import { openRemoteStream, type RemoteStreamHandle } from "./remote-stream.ts"
import { RemoteRpcError } from "./transport.ts"
import { SubagentRoundPolicy, type HardStopRecord, type SubagentRoundLimits } from "../subagent-policy.ts"

/** One panel row — the exact TurnCallbacks.onSubagentUpdate entry shape. */
export interface RemoteSubagentView {
	id: string
	label: string
	model?: string
	status: "running" | "completed" | "failed" | "cancelled"
	rounds: number
	/** Batch V2b: the child's start wall clock (epoch ms) — the transcript
	 * subagent tree's live duration ticks off it; `elapsed` stays the
	 * read-time snapshot for the picker. */
	startedAt: number
	tokens?: number
	elapsed: number
	lastLine?: string
	/** maxRounds wrap-up delivered at this round (F6 `⚡ injected` marker). */
	injectedRound?: number
	/** maxRounds force-stop fired at this round (F6 `⏻ hard-stopped @N`). */
	hardStopRound?: number
	/** Spin-detected early force-stop fired at this round (`⏻!` marker —
	 * grace never eaten; exclusive with the classic hardStopRound latch). */
	spinStopRound?: number
}

/** Child steerable-mode facts from the durable `subagent/descriptor`. */
export interface RemoteChildDescriptor {
	mode?: "one-shot" | "continuable"
	provider?: string
	label?: string
	model?: string
}

/** Unary RPC carrier (the ClientConnection subset used here). */
export type RemoteSubagentRpc = (method: string, args?: Record<string, unknown>) => Promise<unknown>

export interface RemoteSubagentPanelOptions {
	rpc: RemoteSubagentRpc
	socketFactory: MuxSocketFactory
	/** The live parent session id (changes across /new/resume/fork). */
	parentId(): string | undefined
	/** Panel snapshot sink (wired to TurnCallbacks.onSubagentUpdate). */
	onUpdate?(views: RemoteSubagentView[]): void
	/**
	 * maxRounds policy knobs (feature batch F1) — the facade's cached
	 * `dsh-opentui` settings snapshot. Absent = the ladder is disabled on
	 * this panel. The client face resolves the GLOBAL cap only (agent
	 * .md files are host-side; the per-agent tier stays plugin-mode).
	 */
	limits?: () => SubagentRoundLimits
	/** Kick a lazy settings refresh before each ladder decision. */
	refreshLimits?: () => void
	/** Hard-stop report sink (the force-stop marker fold). */
	onHardStop?(record: HardStopRecord): void
	/** Spin-detected early stop sink (the `⏻!` marker fold). */
	onSpinStop?(childId: string, round: number): void
}

interface ChildState {
	label: string
	model?: string
	status: "running" | "completed" | "failed" | "cancelled"
	rounds: number
	tokens?: number
	startedAt: number
	lastLine?: string
	descriptor: RemoteChildDescriptor
	log: string[]
	/** F6 markers: wrap-up delivered / force-stop fired round counts. */
	injectedRound?: number
	hardStopRound?: number
	/** Spin-detected early force-stop (`⏻!`) — exclusive with hardStopRound. */
	spinStopRound?: number
}

export class RemoteSubagentPanel {
	readonly #options: RemoteSubagentPanelOptions
	#children = new Map<string, ChildState>()
	/** tool-workflow/agent-start ↔ agent-end pairing (runId:seq → child). */
	#runSeqToChild = new Map<string, string>()
	#pumps = new Map<string, RemoteStreamHandle>()
	#stopped = false
	/** maxRounds round ladder (batch F1) — built only when limits are wired. */
	readonly #policy?: SubagentRoundPolicy

	constructor(options: RemoteSubagentPanelOptions) {
		this.#options = options
		if (options.limits !== undefined) {
			this.#policy = new SubagentRoundPolicy({
				limits: options.limits,
				// No per-agent tier here: agent files live host-side.
				isSettled: (id) => this.#children.get(id)?.status !== "running",
				wrapup: (id, message) => {
					if (!this.#children.has(id)) return false
					// Fire-and-forget steer: a host rejection (typed
					// subagent/not-resumable) is logged; the ladder's stage 2
					// still bounds the run at cap + grace.
					void this.steer(id, message)
					return true
				},
				forceStop: (id) => {
					if (!this.#children.has(id)) return false
					this.interrupt(id).catch(() => {
						/* a raced settle loses its stop — stage 2 stays latched */
					})
					this.#settle(id, "cancelled")
					return true
				},
				onHardStop: (record) => this.#options.onHardStop?.(record),
				// F6 marker folds: latch the round counts onto the child's view.
				onWrapUp: (id, round) => {
					const child = this.#children.get(id)
					if (!child) return
					this.#children.set(id, { ...child, injectedRound: round })
					this.#emit()
				},
				onForceStop: (id, round) => {
					const child = this.#children.get(id)
					if (!child) return
					this.#children.set(id, { ...child, hardStopRound: round })
					this.#emit()
				},
				// Spin-detected early stop (`⏻!` marker fold).
				onSpinStop: (id, round) => {
					const child = this.#children.get(id)
					if (!child) return
					this.#children.set(id, { ...child, spinStopRound: round })
					this.#emit()
				},
			})
		}
	}

	/**
	 * Fold one durable PARENT journal record (the facade feeds every
	 * record; only the tool-workflow rows register/settle children).
	 */
	foldParentRecord(entry: RemoteJournalEntry): void {
		if (entry.type === "tool-workflow/agent-start") {
			const childId = typeof entry.data.childId === "string" ? entry.data.childId : ""
			const label = typeof entry.data.label === "string" ? entry.data.label : ""
			if (!childId) return
			this.#registerChild(childId, label)
			this.#runSeqToChild.set(`${String(entry.data.runId ?? "")}:${String(entry.data.seq ?? "")}`, childId)
			return
		}
		if (entry.type === "tool-workflow/agent-end") {
			const childId = this.#runSeqToChild.get(`${String(entry.data.runId ?? "")}:${String(entry.data.seq ?? "")}`)
			const outcome = entry.data.outcome === "failed" || entry.data.outcome === "cancelled" ? entry.data.outcome : "completed"
			if (childId) this.#settle(childId, outcome)
		}
	}

	/**
	 * One `api-session/status` emit (sessionId, running) — live running
	 * state for an adopted child without a list round-trip.
	 */
	noteStatus(sessionId: string, running: boolean): void {
		const view = this.#children.get(sessionId)
		if (!view) return
		if (!running && view.status === "running") {
			this.#children.set(sessionId, { ...view, status: "completed" })
			this.#emit()
		}
	}

	/** One `api-session/removed` emit (sessionId) — the child is gone. */
	noteRemoved(sessionId: string): void {
		if (!this.#children.has(sessionId)) return
		this.#children.delete(sessionId)
		this.#closePump(sessionId)
		this.#emit()
	}

	/**
	 * `session/list` sweep: adopt rows of THIS parent with
	 * `origin:'subagent'` (the audit's aggregation source), refresh their
	 * running state, and open follow pumps for unknown children.
	 */
	async refreshFromList(): Promise<void> {
		if (this.#stopped) return
		const parent = this.#options.parentId()
		if (parent === undefined) return
		let changed = false
		try {
			const value = (await this.#options.rpc("session/list", { _request: {} })) as { items?: unknown }
			const items = Array.isArray(value.items) ? value.items : []
			for (const item of items) {
				const row = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>
				if (row.origin !== "subagent") continue
				if (row.parentSessionId !== parent) continue
				const id = typeof row.sessionId === "string" ? row.sessionId : ""
				if (!id) continue
				const existing = this.#children.get(id)
				if (existing === undefined) {
					this.#adopt(id, `subagent ${id.slice(0, 8)}`)
					changed = true
				} else if (row.running === false && existing.status === "running") {
					this.#children.set(id, { ...existing, status: "completed" })
					changed = true
				}
			}
		} catch {
			/* the list is best-effort; the journal pairing covers the rest */
		}
		if (changed) this.#emit()
	}

	/** Panel snapshot (elapsed computed at read time — HostSession parity). */
	views(): RemoteSubagentView[] {
		const clamp = (v: string | undefined) => (v && v.length > 240 ? v.slice(-240) : v)
		return [...this.#children.entries()].map(([id, v]) => ({
			id,
			label: v.label,
			...(v.model ? { model: v.model } : {}),
			status: v.status,
			rounds: v.rounds,
			startedAt: v.startedAt,
			...(v.tokens !== undefined ? { tokens: v.tokens } : {}),
			elapsed: Math.max(0, Math.floor((Date.now() - v.startedAt) / 1000)),
			...(v.lastLine ? { lastLine: clamp(v.lastLine) } : {}),
			...(v.injectedRound !== undefined ? { injectedRound: v.injectedRound } : {}),
			...(v.hardStopRound !== undefined ? { hardStopRound: v.hardStopRound } : {}),
			...(v.spinStopRound !== undefined ? { spinStopRound: v.spinStopRound } : {}),
		}))
	}

	/** Child transcript lines (viewer; capped buffer, oldest dropped). */
	transcript(id: string): string[] {
		return [...(this.#children.get(id)?.log ?? [])]
	}

	/** Whether the child is adopted (the sync steerChild reachability check). */
	known(id: string): boolean {
		return this.#children.has(id)
	}

	/**
	 * Steer a child (`subagents/prompt`, delivery 'steer'). False when the
	 * host rejects the request — the typed RemoteError carries the reason
	 * (`subagent/not-resumable` for one-shot/non-continuable children —
	 * host policy, audit gap 8; parity of UX with the in-process
	 * steerChild's false on settled children). `steerChildDetailed`
	 * surfaces the typed reason verbatim.
	 */
	/**
	 * The spin-detection feed (jev noul verdict for one child, 0–1): forward
	 * to the panel's round policy streak trail. The client face has no
	 * verdict stream of its own (verdicts live host-side — the mounted
	 * dsh-agent-dispatch chain); callers with a verdict trail push through
	 * here. A no-op when the ladder is disabled (no limits wired) or the
	 * child is unknown.
	 */
	noteSpinVerdict(id: string, noul: number): void {
		if (!this.#children.has(id)) return
		this.#policy?.noteSpinVerdict(id, noul)
	}

	async steer(id: string, text: string): Promise<boolean> {
		const parent = this.#options.parentId()
		if (parent === undefined) return false
		try {
			await this.#options.rpc("subagents/prompt", {
				request: {
					requestId: randomUUID(),
					parentSessionId: parent,
					childSessionId: id,
					mode: "continuable",
					delivery: "steer",
					content: [{ type: "text", text }],
				},
			})
			return true
		} catch (error) {
			if (error instanceof RemoteRpcError) {
				console.error(`[remote-subagents] steer rejected (${error.code}): ${error.message}`)
			} else {
				console.error("[remote-subagents] steer failed:", error)
			}
			return false
		}
	}

	/** Steer with the typed outcome ({ok:false, reason} on host rejection). */
	async steerChildDetailed(id: string, text: string): Promise<{ ok: true } | { ok: false; reason: string }> {
		const parent = this.#options.parentId()
		if (parent === undefined) return { ok: false, reason: "no live parent session" }
		try {
			await this.#options.rpc("subagents/prompt", {
				request: {
					requestId: randomUUID(),
					parentSessionId: parent,
					childSessionId: id,
					mode: "continuable",
					delivery: "steer",
					content: [{ type: "text", text }],
				},
			})
			return { ok: true }
		} catch (error) {
			const reason =
				error instanceof RemoteRpcError
					? `${error.code}: ${error.message}` // e.g. "subagent/not-resumable: …" (one-shot child)
					: String(error instanceof Error ? error.message : error)
			return { ok: false, reason }
		}
	}

	/** Interrupt a child (`subagents/interruptByParent`). */
	async interrupt(id: string): Promise<void> {
		const parent = this.#options.parentId()
		if (parent === undefined) throw new Error("no live parent session")
		await this.#options.rpc("subagents/interruptByParent", {
			childSessionId: id,
			parentSessionId: parent,
			mode: "continuable",
		})
	}

	/** Close every child pump; the panel stops adopting (dispose parity). */
	stop(): void {
		this.#stopped = true
		for (const id of [...this.#pumps.keys()]) this.#closePump(id)
	}

	// -----------------------------------------------------------------
	// Internals
	// -----------------------------------------------------------------

	#registerChild(childId: string, label: string): void {
		const existing = this.#children.get(childId)
		if (existing !== undefined) {
			if (label && label !== existing.label) this.#children.set(childId, { ...existing, label })
		} else {
			this.#adopt(childId, label || `subagent ${childId.slice(0, 8)}`)
		}
		this.#emit()
	}

	#adopt(id: string, label: string): ChildState {
		const state: ChildState = { label, status: "running", rounds: 0, startedAt: Date.now(), descriptor: {}, log: [] }
		this.#children.set(id, state)
		this.#openChildFollow(id)
		return state
	}

	#settle(childId: string, outcome: "completed" | "failed" | "cancelled"): void {
		const existing = this.#children.get(childId)
		if (existing !== undefined && existing.status === "running") {
			this.#children.set(childId, { ...existing, status: outcome })
			this.#emit()
		}
	}

	/**
	 * One read-only child follow (`address.kind:'subagent'`), durable
	 * records + live assistant-stream deltas for lastLine scrolling.
	 * Fails soft: a child that cannot be followed (already archived,
	 * one-shot teardown) keeps its list-derived view.
	 */
	#openChildFollow(id: string): void {
		if (this.#stopped || this.#pumps.has(id)) return
		const parent = this.#options.parentId()
		if (parent === undefined) return
		const handle = openRemoteStream(
			this.#options.socketFactory,
			"session/follow",
			{
				request: {
					address: { kind: "subagent", parentSessionId: parent, childSessionId: id, mode: "unknown" },
					assistantStream: true,
				},
			},
			{
				onItem: (value) => this.#foldChildFrame(id, value),
				onEnd: () => this.#closePump(id),
				onFailed: () => this.#closePump(id),
			},
		)
		this.#pumps.set(id, handle)
	}

	#closePump(id: string): void {
		const pump = this.#pumps.get(id)
		if (pump === undefined) return
		this.#pumps.delete(id)
		try {
			pump.close()
		} catch {
			/* already gone */
		}
	}

	#foldChildFrame(id: string, value: unknown): void {
		const view = this.#children.get(id)
		if (view === undefined) return
		const frame = (typeof value === "object" && value !== null && !Array.isArray(value) ? value : {}) as Record<string, unknown>
		let changed = false
		const log = view.log

		if (frame.type === "assistant-stream") {
			// live delta scroll (host-session.ts:1232-1238 parity)
			const streamFrame = (typeof frame.frame === "object" && frame.frame !== null ? frame.frame : {}) as Record<string, unknown>
			if (streamFrame.type === "chunk" && view.status === "running") {
				const chunk = (typeof streamFrame.chunk === "object" && streamFrame.chunk !== null ? streamFrame.chunk : {}) as Record<string, unknown>
				if (chunk.type === "text-delta" && typeof chunk.text === "string" && chunk.text) {
					this.#children.set(id, { ...view, lastLine: (view.lastLine ?? "") + chunk.text })
					this.#emit()
				}
			}
			return
		}
		if (frame.type !== "event") return
		const event = (typeof frame.event === "object" && frame.event !== null ? frame.event : {}) as Record<string, unknown>
		const type = String(event.type ?? "")
		const data = (typeof event.data === "object" && event.data !== null ? event.data : {}) as Record<string, unknown>

		if (type === "subagent/descriptor") {
			const descriptor = descriptorOf(data)
			const label = descriptor.label ?? view.label
			const model = descriptor.model ?? view.model
			this.#children.set(id, { ...view, descriptor, ...(label !== view.label ? { label } : {}), ...(model !== view.model ? { model } : {}) })
			changed = true
		} else if (type === "request/header") {
			const header = (typeof data.header === "object" && data.header !== null ? data.header : {}) as Record<string, unknown>
			const cfg = (typeof header.config === "object" && header.config !== null ? header.config : (typeof data.config === "object" && data.config !== null ? data.config : {})) as Record<string, unknown>
			const model = cfg.provider || cfg.model ? `${String(cfg.provider ?? "")}/${String(cfg.model ?? "")}`.replace(/^\//, "") : undefined
			if (model) {
				this.#children.set(id, { ...view, model })
				changed = true
			}
		} else if (type === "assistant/message") {
			// rounds are assistant/message-counted (one-shot children never turn/end)
			const message = (typeof data.message === "object" && data.message !== null ? data.message : {}) as Record<string, unknown>
			const text = blocksText(message.content ?? data.content)
			const usage = totalTokensOf(data.usage) ?? totalTokensOf(message.usage)
			const next: ChildState = {
				...view,
				rounds: view.rounds + 1,
				...(usage !== undefined ? { tokens: (view.tokens ?? 0) + usage } : {}),
				...(text ? { lastLine: text.split("\n").pop()?.slice(0, 80) } : {}),
			}
			this.#children.set(id, next)
			changed = true
			// maxRounds ladder feed (batch F1): wrap-up/force-stop delivery is
			// microtask-deferred inside the policy — no reentry into this fold.
			if (this.#policy !== undefined) {
				this.#options.refreshLimits?.()
				this.#policy.onRoundCount(id, next.rounds, next.label)
			}
			for (const line of text.split("\n")) if (line.trim()) log.push(line.slice(0, 110))
		} else if (type === "tool/call") {
			log.push(`▶ ${String(data.name ?? "tool")} ${String(data.arguments ?? "").slice(0, 90)}`)
		} else if (type === "tool/result") {
			log.push(data.isError === true ? "  ⎿ failed" : "  ⎿ done")
		} else if (type === "turn/end" && view.status === "running") {
			// continuable children settle here too; one-shot children rely on
			// the agent-end pairing / list running flags
			this.#children.set(id, { ...view, status: "completed" })
			changed = true
		}
		while (log.length > 200) log.shift()
		if (changed) this.#emit()
	}

	#emit(): void {
		try {
			this.#options.onUpdate?.(this.views())
		} catch (error) {
			console.error("[remote-subagents] update callback threw:", error)
		}
	}
}

// ---------------------------------------------------------------------------
// Pure mappers (unit-tested standalone)
// ---------------------------------------------------------------------------

/** Descriptor facts of one `subagent/descriptor` payload (v3 fields). */
export function descriptorOf(data: Record<string, unknown>): RemoteChildDescriptor {
	const mode = data.mode === "one-shot" || data.mode === "continuable" ? data.mode : undefined
	const provider = typeof data.provider === "string" && data.provider ? data.provider : undefined
	const label = typeof data.label === "string" && data.label ? data.label : undefined
	const model =
		[typeof data.agentProvider === "string" ? data.agentProvider : "", typeof data.agentModel === "string" ? data.agentModel : ""]
			.filter(Boolean)
			.join("/") || (typeof data.model === "string" && data.model ? data.model : undefined)
	return {
		...(mode !== undefined ? { mode } : {}),
		...(provider !== undefined ? { provider } : {}),
		...(label !== undefined ? { label } : {}),
		...(model !== undefined ? { model } : {}),
	}
}

/** The `totalTokens` of a usage shape (numeric scan — adapter variance). */
export function totalTokensOf(usage: unknown): number | undefined {
	if (usage === null || typeof usage !== "object") return undefined
	const u = usage as Record<string, unknown>
	for (const key of ["totalTokens", "total_tokens"]) {
		if (typeof u[key] === "number" && Number.isFinite(u[key])) return u[key] as number
	}
	return undefined
}
