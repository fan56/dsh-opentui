/**
 * Subagent maxRounds hard-stop policy — the session-layer shared
 * implementation (feature batch F1), ported from dsh-tui-pi's
 * subagent-policy.ts round ladder.
 *
 * Both session facades feed it and both benefit (ADR: policy at the seam,
 * not at either entry):
 * - plugin mode: HostSession folds it into the firehose child-event path
 *   (host-session.ts #foldChildEvent); wrap-up rides the live child agent's
 *   steer, force-stop rides the agent's cancel.
 * - client mode: RemoteSubagentPanel folds it into the child follow frames
 *   (client/remote-subagents.ts #foldChildFrame); wrap-up rides
 *   `subagents/prompt` (delivery 'steer'), force-stop rides
 *   `subagents/interruptByParent`.
 *
 * Three knobs, read live from the `dsh-opentui` settings namespace at every
 * decision point (the facades cache the describe() snapshot and refresh it
 * lazily — the next round count picks up an edit, same semantics as the
 * dsh-tui settings browser):
 * - `maxRounds` (global): caps a child's assistant messages (each LLM
 *   round-trip is one "round"). `<= 0` disables the whole ladder.
 * - `maxRoundsGrace`: the wrap-up grace window. After the wrap-up lands at
 *   the cap, `maxRoundsGrace` further rounds are allowed; at `cap + grace`
 *   the run is FORCE-STOPPED — code, not persuasion.
 * - per-agent `maxRounds` (agent .md frontmatter, plugin mode only — agent
 *   files are host-side): overrides the global cap for children whose
 *   descriptor label resolves to a registered agent. An unresolvable label
 *   falls back to the global cap, never widens it.
 *
 * The TWO-STAGE ladder (per child, caps frozen at the first crossing):
 *   Stage 1 — at `cap`: one wrap-up message ("finish now, no more tools").
 *   Stage 2 — at `cap + grace` (grace > 0): force-stop. `grace: 0` keeps
 *   the historical warn-only behavior (stage 1 only, never stops).
 */

/** The parsed `dsh-opentui` settings knobs. */
export interface SubagentRoundLimits {
	/** Global assistant-message cap per child (`<= 0` disables the ladder). */
	maxRounds: number
	/** Grace rounds after the wrap-up before the force-stop. */
	maxRoundsGrace: number
}

/** Defaults: disabled — an unconfigured deployment enforces nothing. */
export const DEFAULT_SUBAGENT_ROUND_LIMITS: SubagentRoundLimits = { maxRounds: 0, maxRoundsGrace: 0 }

/** The settings namespace this policy reads (settings entry id `dsh-opentui`). */
export const SUBAGENT_LIMITS_NS = "dsh-opentui"

/** Non-negative integer or undefined (a malformed value disables that knob). */
function nonNegativeInt(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.floor(value)
	if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim())
	return undefined
}

/** Parse the knobs out of one namespace `value` object (defensive). */
export function parseSubagentRoundLimits(value: unknown): SubagentRoundLimits {
	if (value === null || typeof value !== "object") return { ...DEFAULT_SUBAGENT_ROUND_LIMITS }
	const record = value as Record<string, unknown>
	const maxRounds = nonNegativeInt(record.maxRounds)
	const maxRoundsGrace = nonNegativeInt(record.maxRoundsGrace)
	return {
		maxRounds: maxRounds ?? DEFAULT_SUBAGENT_ROUND_LIMITS.maxRounds,
		maxRoundsGrace: maxRoundsGrace ?? DEFAULT_SUBAGENT_ROUND_LIMITS.maxRoundsGrace,
	}
}

/** Parse the knobs out of settings describe rows (the `{ns, value}` entries
 * both the host settings service and the remote settings client hand back). */
export function limitsFromSettingsRows(rows: readonly { ns?: unknown; value?: unknown }[]): SubagentRoundLimits {
	for (const row of rows) {
		if (row?.ns === SUBAGENT_LIMITS_NS) return parseSubagentRoundLimits(row.value)
	}
	return { ...DEFAULT_SUBAGENT_ROUND_LIMITS }
}

/** The pure ladder verdict, given one child's state. Unit-tested standalone. */
export type LadderAction = "none" | "wrapup" | "force-stop"

export function ladderDecision(input: {
	/** The child's current round count (assistant messages). */
	count: number
	/** The effective cap (per-agent when resolved, else global). */
	cap: number
	/** The grace window following the wrap-up. */
	grace: number
	/** Whether stage 1 (wrap-up) already fired for this child. */
	wrapupDelivered: boolean
	/** Whether the child settled (completed/failed/cancelled). */
	settled: boolean
}): LadderAction {
	if (input.cap <= 0) return "none" // disabled
	if (input.settled) return "none" // self-completed: leave it
	if (!input.wrapupDelivered) {
		return input.count >= input.cap ? "wrapup" : "none"
	}
	// Wrap-up delivered: pure-soft mode (grace 0) never stops.
	if (input.grace <= 0) return "none"
	return input.count >= input.cap + input.grace ? "force-stop" : "none"
}

/**
 * The wrap-up message injected at the cap (dsh-tui parity: English,
 * directive — a soft "please summarize" was routinely ignored). Names the
 * limit, forbids further tool calls, demands a final-answer summary, and
 * with a positive grace window warns about the coming force-stop.
 */
export function wrapupMessage(maxRounds: number, grace: number): string {
	const base =
		`Round limit reached (${maxRounds} LLM round-trips, set by the dsh-opentui maxRounds policy). ` +
		"Do NOT call any more tools. Finish this task NOW: summarize what you have accomplished so far, " +
		'state clearly what remains undone, and return that summary as your final answer.'
	return grace > 0
		? `${base} You have ${grace} more round${grace === 1 ? "" : "s"} before this run is force-stopped.`
		: base
}

/** One executed hard stop, surfaced through the policy's onHardStop sink. */
export interface HardStopRecord {
	/** The child session id the stop was issued to. */
	childId: string
	/** Round count at which the stop fired (cap + grace). */
	round: number
	/** The cap the ladder resolved for this child. */
	cap: number
	/** The grace window of the ladder that fired. */
	grace: number
}

export interface SubagentRoundPolicyOptions {
	/** Live limits read (the facade's cached settings snapshot). */
	limits(): SubagentRoundLimits
	/** Per-agent cap lookup (agent .md frontmatter `maxRounds`, by label).
	 * Absent on the client face (agent files are host-side): the global cap
	 * applies. A throwing lookup falls back to the global cap. */
	resolveAgentCap?(label: string): number | undefined
	/** Whether the child already settled (never re-awaken a settled child). */
	isSettled?(childId: string): boolean
	/** Stage-1 sink: deliver the wrap-up to the child. False/throw = not
	 * delivered — the child stays eligible and the next counted round retries. */
	wrapup(childId: string, message: string, label: string | undefined): boolean
	/** Stage-2 sink: force-stop the child's run. False/throw = nothing was
	 * stopped (a raced settle) — the stage marker still latches. */
	forceStop(childId: string): boolean
	/** Hard-stop report sink (viewer marker fold). */
	onHardStop?(record: HardStopRecord): void
	/** Observation hook (batch F6): the wrap-up message was delivered to the
	 * child (`⚡ injected` marker). Fires with the round count at delivery. */
	onWrapUp?(childId: string, round: number): void
	/** Observation hook (batch F6): the force-stop executed (`⏻` marker).
	 * Fires with the round count at the stop; same firing point as
	 * onHardStop (which additionally carries cap/grace). */
	onForceStop?(childId: string, round: number): void
}

/** Per-child caps frozen at the first ladder crossing (the stage-2 cap must
 * not shift mid-flight — a settings edit between warn and stop would move
 * the goalposts). */
interface ResolvedCaps {
	cap: number
	grace: number
}

/**
 * The running round ladder. One instance per session facade; feed it every
 * child round count and it runs the two-stage ladder through the injected
 * sinks. Delivery is DEFERRED to a microtask (the sinks splice the child's
 * inbox from inside a session-event observer in the plugin facade — the
 * reference implementation documents the same reentry hazard and defers the
 * same way).
 */
export class SubagentRoundPolicy {
	readonly #options: SubagentRoundPolicyOptions
	/** Children whose wrap-up was delivered (stage 1 latched). */
	readonly #injected = new Set<string>()
	/** Children whose force-stop already fired or found nothing to stop. */
	readonly #hardStopped = new Set<string>()
	/** Caps frozen at the first crossing, per child. */
	readonly #resolvedCaps = new Map<string, ResolvedCaps>()
	/** Labels remembered at wrap-up time (stage-2 may arrive off the live board). */
	readonly #injectedLabel = new Map<string, string>()
	#disposed = false

	constructor(options: SubagentRoundPolicyOptions) {
		this.#options = options
	}

	/** The bridge's round-count sink: call on every child assistant message. */
	onRoundCount(childId: string, count: number, label?: string): void {
		if (this.#disposed || !childId) return
		// Stage 2 already fired (or found nothing to stop): latched for good.
		if (this.#hardStopped.has(childId)) return
		// Refresh the knobs before the decision (the facade's snapshot may
		// still be one refresh behind — same live-read semantics as the
		// reference: the NEXT decision reads the new value).
		const caps = this.#resolveCaps(childId, label ?? this.#injectedLabel.get(childId))
		if (caps === undefined) return
		const settled = this.#options.isSettled?.(childId) ?? false
		const action = ladderDecision({
			count,
			cap: caps.cap,
			grace: caps.grace,
			wrapupDelivered: this.#injected.has(childId),
			settled,
		})
		if (action === "none") return
		if (action === "wrapup") {
			if (this.#injected.has(childId)) return
			const rememberedLabel = label ?? this.#injectedLabel.get(childId)
			// Defer out of the caller's append publication window (header).
			queueMicrotask(() => {
				if (this.#disposed || this.#injected.has(childId)) return
				// Re-check settle at flush time: the child may have finished.
				if (this.#options.isSettled?.(childId) === true) return
				let delivered = false
				try {
					delivered = this.#options.wrapup(childId, wrapupMessage(caps.cap, caps.grace), rememberedLabel)
				} catch {
					delivered = false
				}
				if (!delivered) return // stays eligible; next round retries
				this.#injected.add(childId)
				if (rememberedLabel !== undefined) this.#injectedLabel.set(childId, rememberedLabel)
				// F6 marker: the injection landed — observers fold `⚡`.
				try {
					this.#options.onWrapUp?.(childId, count)
				} catch {
					// An observation failure must not touch delivery.
				}
			})
			return
		}
		// force-stop: latch FIRST (the stop's own settlement events re-enter
		// this sink synchronously in some facades — never double-fire).
		this.#hardStopped.add(childId)
		let stopped = false
		try {
			stopped = this.#options.forceStop(childId)
		} catch {
			stopped = false
		}
		if (stopped) {
			try {
				this.#options.onHardStop?.({ childId, round: count, cap: caps.cap, grace: caps.grace })
			} catch {
				// A reporting failure must not touch the stop itself.
			}
			// F6 marker: observers fold `⏻ hard-stopped @N`.
			try {
				this.#options.onForceStop?.(childId, count)
			} catch {
				// Same containment as onHardStop.
			}
		}
	}

	/** Resolve and freeze one child's caps (per-agent tier first). */
	#resolveCaps(childId: string, label: string | undefined): ResolvedCaps | undefined {
		const cached = this.#resolvedCaps.get(childId)
		if (cached !== undefined) return cached
		const limits = this.#options.limits()
		const globalCap = limits.maxRounds
		if (globalCap <= 0) return undefined
		let cap = globalCap
		if (label !== undefined && this.#options.resolveAgentCap !== undefined) {
			try {
				const perAgent = this.#options.resolveAgentCap(label)
				if (perAgent !== undefined && perAgent > 0) cap = perAgent
			} catch {
				// A throwing lookup is a global-cap lookup.
			}
		}
		const caps: ResolvedCaps = { cap, grace: limits.maxRoundsGrace }
		this.#resolvedCaps.set(childId, caps)
		return caps
	}

	/** Stop feeding; pending deferred wrap-ups will not fire afterwards. */
	dispose(): void {
		this.#disposed = true
		this.#injected.clear()
		this.#hardStopped.clear()
		this.#resolvedCaps.clear()
		this.#injectedLabel.clear()
	}
}
