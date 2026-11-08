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
 * Three knobs, read live by each facade at every decision point:
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
 * CAP SOURCE (client face, post-plugin-retirement): the profile config.json
 * `maxRounds` / `maxRoundsGrace` keys through the client configLoad seam —
 * the same layer theme/agentsProfiles ride. The retired plugin face's
 * settings ns `dsh-opentui` no longer has an owning entry, so a
 * describe-based provider answered defaults forever and the ladder stayed
 * disabled (the B5 e2e finding: an unbounded looper child). The settings-ns
 * row parser ({@link limitsFromSettingsRows}) is kept for the host settings
 * describe surface, but the client ladder no longer sources from it.
 *
 * The TWO-STAGE ladder (per child, caps frozen at the first crossing):
 *   Stage 1 — at `cap`: one wrap-up message ("finish now, no more tools").
 *   Stage 2 — at `cap + grace` (grace > 0): force-stop. `grace: 0` keeps
 *   the historical warn-only behavior (stage 1 only, never stops).
 *
 * SPIN-DETECTED EARLY STOP (ported from dsh-tui-pi's wayfinder ticket 05 —
 * the part F1 deliberately left out): jev verdicts (TypeSafe System One
 * noul probabilities, 0–1) are fed per child through `noteSpinVerdict`. A
 * verdict at or above SPIN_HIGH_SEGMENT_AT (0.75, the reference's spinning
 * high-segment line) is a strike: consecutive strikes arm the ladder's
 * TIGHTEN-ONLY legs, a non-spinning verdict zeroes the streak, and a strike
 * older than SPIN_STRIKE_STALE_MS (90s) is stale evidence:
 *   Early stage 1 — fresh 2-streak, round at/after the floor
 *   `max(10, ⌊cap/3⌋)` but below the cap: the wrap-up is pulled forward
 *   (wrapupMessageEarly — "going in circles", door left open).
 *   Early stage 2 — wrap-up delivered, at least one more round burned, and
 *   a FRESH strike that POSTDATES the delivery ("still judged circling
 *   through the wrap-up"): force-stop now, grace never eaten. The stop
 *   carries `early: true` (the `⏻!` marker) and fires the onSpinStop hook.
 * Without a fresh verdict the ladder below is byte-for-byte the old one —
 * the spin legs never widen a cap or add grace.
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

/**
 * Foreground descriptor-label namespaces (dsh-subagent's run-agent tool
 * prefixes a foreground child's label with "[fg] ", legacy
 * "[use_agent foreground] "), so a descriptor label like "[fg] looper"
 * never string-equals the registered agent's bare name.
 */
const FOREGROUND_LABEL_PREFIXES = ["[fg] ", "[use_agent foreground] "]

/** Strip a foreground namespace prefix from a child descriptor label
 * ("[fg] looper" → "looper"); any other label passes through trimmed. */
export function bareAgentLabel(label: string): string {
	const trimmed = label.trim()
	for (const prefix of FOREGROUND_LABEL_PREFIXES) {
		if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length).trim()
	}
	return trimmed
}

/** The pure ladder verdict, given one child's state. Unit-tested standalone. */
export type LadderAction = "none" | "wrapup" | "force-stop"

// ---- spin-detected early stop (ported from dsh-tui-pi wayfinder ticket 05) ----

/** A jev noul verdict at/above this line is a spinning strike (the reference's
 * high-segment cut — the mock-jev e2e answers 0.95 to sit comfortably past it). */
export const SPIN_HIGH_SEGMENT_AT = 0.75

/** A spinning verdict older than this is stale evidence (three debounce
 * windows in the reference; the ladder re-checks freshness at every decision). */
export const SPIN_STRIKE_STALE_MS = 90_000

/** Consecutive spinning verdicts that arm the early legs — everything looks
 * repetitive in a young child's first rounds, so one strike is never enough. */
export const EARLY_STOP_SPIN_STREAK = 2

/** The early wrap-up's rounds floor: `max(10, ⌊cap/3⌋)` of the child's cap. */
export function earlyFloor(cap: number): number {
	return Math.max(10, Math.floor(cap / 3))
}

/** Per-child spin-strike state: consecutive spinning verdicts plus the clock
 * of the most recent one (the freshness anchor). A non-spinning verdict
 * zeroes BOTH (progress does NOT — a circling child's rounds keep growing). */
export interface SpinState {
	streak: number
	lastStrikeAt: number
}

/** The spin ladder's verdict, given one child's verdict trail. Unit-tested
 * standalone; mirrors dsh-tui-pi's tighten-only legs:
 *   "wrapup-early"    — stage 1 pulled forward past the floor, below the cap.
 *   "force-stop-early" — stage 2 fired before the grace window: the wrap-up
 *   was delivered, ≥1 round burned after it, and a fresh strike POSTDATES
 *   the delivery (the same judgment that triggered the wrap-up must not
 *   re-trigger; a post-wrapup strike is a NEW judgment). */
export type SpinLadderAction = "none" | "wrapup-early" | "force-stop-early"

export function spinDecision(input: {
	/** Consecutive spinning verdicts (noteSpinVerdict's trail). */
	streak: number
	/** Clock of the most recent spinning verdict. */
	lastStrikeAt: number
	/** Now (injectable for tests). */
	now: number
	/** The child's current round count. */
	count: number
	/** The effective cap (per-agent when resolved, else global). */
	cap: number
	/** The grace window following the wrap-up. */
	grace: number
	/** Whether stage 1 (wrap-up) already fired for this child. */
	wrapupDelivered: boolean
	/** Wall clock of the wrap-up delivery (undefined when not delivered). */
	wrapupDeliveredAt?: number
	/** Rounds burned after the wrap-up delivery. */
	roundsSinceWrapup?: number
	/** Whether the child settled (completed/failed/cancelled). */
	settled: boolean
}): SpinLadderAction {
	if (input.cap <= 0) return "none" // ladder disabled — spin legs never run alone
	if (input.settled) return "none"
	if (input.streak < EARLY_STOP_SPIN_STREAK) return "none"
	if (input.now - input.lastStrikeAt >= SPIN_STRIKE_STALE_MS) return "none" // stale evidence
	if (!input.wrapupDelivered) {
		// Early stage 1: pull the wrap-up forward, but only past the floor
		// (young children) and only BEFORE the cap (the classic ladder owns
		// the at-cap wrap-up — the spin legs never widen it).
		return input.count >= earlyFloor(input.cap) && input.count < input.cap ? "wrapup-early" : "none"
	}
	// Early stage 2: the wrap-up landed, the child kept burning rounds, and a
	// FRESH strike arrived AFTER the delivery. Requires grace > 0 (pure-soft
	// mode never stops — reference parity).
	if (input.grace <= 0) return "none"
	if (input.wrapupDeliveredAt === undefined) return "none"
	if (input.lastStrikeAt <= input.wrapupDeliveredAt) return "none" // the old judgment, not a new one
	if ((input.roundsSinceWrapup ?? 0) < 1) return "none" // no round burned yet
	return "force-stop-early"
}

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

/**
 * The spin-detected early wrap-up (dsh-tui-pi parity): the jev layer judged
 * this child circling while still far from its cap. Same ask as
 * `wrapupMessage` — stop tools, return a summary — but the reason is
 * unproductive repetition, not budget exhaustion, and the tone leaves a door
 * open in case the judgment is wrong.
 */
export function wrapupMessageEarly(): string {
	return (
		"This run appears to be going in circles — repeating work without forward progress, " +
		"as judged by the dsh-opentui attention policy. Do NOT call any more tools. Finish NOW with what you have: " +
		"summarize what was accomplished, state clearly what remains undone, and return that summary as your final answer. " +
		"If this judgment looks wrong, say so in the summary and stop."
	)
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
	/** Set when the stop fired BEFORE the grace window — the spin-detected
	 * early stop (the `⏻!` / "spin-detected early" marker). */
	early?: true
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
	/** Stage-1 sink: deliver the wrap-up to the child. False/throw (or a
	 * rejected promise) = not delivered — the child stays eligible and the
	 * next counted round retries. A PROMISE (the plugin facade's service
	 * steer is async) latches the delivery when it resolves true. */
	wrapup(childId: string, message: string, label: string | undefined): boolean | Promise<boolean>
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
	/** Observation hook (spin batch): the SPIN-DETECTED early force-stop
	 * executed (`⏻!` marker — "spin-detected early", grace never eaten).
	 * Fires INSTEAD of onForceStop for the early variant; onHardStop still
	 * fires with `early: true`. */
	onSpinStop?(childId: string, round: number): void
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
	/** Round count at the wrap-up delivery — the early-stop "rounds since
	 * wrap-up" baseline. */
	readonly #injectedRound = new Map<string, number>()
	/** Wall clock of the wrap-up delivery — the early stop demands a FRESH
	 * strike that POSTDATES it (a post-wrapup strike is a new judgment). */
	readonly #injectedAt = new Map<string, number>()
	/** Per-child spin-strike trail (noteSpinVerdict's write side). */
	readonly #spinState = new Map<string, SpinState>()
	#disposed = false

	constructor(options: SubagentRoundPolicyOptions) {
		this.#options = options
	}

	/**
	 * The jev layer's write side: fold one verdict in for one child. `score`
	 * is a noul probability (0–1); at/above {@link SPIN_HIGH_SEGMENT_AT} it is
	 * a spinning strike (streak +1, clock stamped), below it the streak zeroes
	 * — reference parity: progress does NOT zero the streak (a circling
	 * child's rounds keep growing — that IS the circling), only a
	 * non-spinning verdict or dispose does; staleness is the ladder's job.
	 */
	noteSpinVerdict(childId: string, score: number, now: number = Date.now()): void {
		if (this.#disposed || !childId) return
		if (typeof score !== "number" || !Number.isFinite(score)) return
		const previous = this.#spinState.get(childId) ?? { streak: 0, lastStrikeAt: 0 }
		if (score >= SPIN_HIGH_SEGMENT_AT) {
			this.#spinState.set(childId, { streak: previous.streak + 1, lastStrikeAt: now })
		} else {
			this.#spinState.set(childId, { streak: 0, lastStrikeAt: 0 })
		}
	}

	/** One child's spin-strike trail (observability/tests; zeroed when absent). */
	getSpinState(childId: string): SpinState {
		return this.#spinState.get(childId) ?? { streak: 0, lastStrikeAt: 0 }
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
		// Spin-detected early legs FIRST (dsh-tui-pi parity — tighten-only:
		// they can only pull the wrap-up forward or stop before the grace
		// window, never widen a cap or add grace). Early stage 2: the wrap-up
		// was delivered, ≥1 round burned, and a FRESH strike POSTDATED the
		// delivery — stop now instead of eating the grace window.
		const spin = this.#spinState.get(childId) ?? { streak: 0, lastStrikeAt: 0 }
		const injectedRound = this.#injectedRound.get(childId)
		const spinAction = spinDecision({
			streak: spin.streak,
			lastStrikeAt: spin.lastStrikeAt,
			now: Date.now(),
			count,
			cap: caps.cap,
			grace: caps.grace,
			wrapupDelivered: this.#injected.has(childId),
			wrapupDeliveredAt: this.#injectedAt.get(childId),
			roundsSinceWrapup: injectedRound !== undefined ? count - injectedRound : undefined,
			settled,
		})
		if (spinAction === "force-stop-early") {
			this.#hardStopped.add(childId)
			let stoppedEarly = false
			try {
				stoppedEarly = this.#options.forceStop(childId)
			} catch {
				stoppedEarly = false
			}
			if (stoppedEarly) {
				try {
					this.#options.onHardStop?.({ childId, round: count, cap: caps.cap, grace: caps.grace, early: true })
				} catch {
					// A reporting failure must not touch the stop itself.
				}
				// Spin marker: observers fold `⏻!` ("spin-detected early").
				try {
					this.#options.onSpinStop?.(childId, count)
				} catch {
					// Same containment as onForceStop.
				}
			}
			return
		}
		const action = ladderDecision({
			count,
			cap: caps.cap,
			grace: caps.grace,
			wrapupDelivered: this.#injected.has(childId),
			settled,
		})
		if (action === "none" && spinAction !== "wrapup-early") return
		if (action === "wrapup" || spinAction === "wrapup-early") {
			if (this.#injected.has(childId)) return
			const rememberedLabel = label ?? this.#injectedLabel.get(childId)
			const early = spinAction === "wrapup-early"
			// Defer out of the caller's append publication window (header).
			queueMicrotask(() => {
				if (this.#disposed || this.#injected.has(childId)) return
				// Re-check settle at flush time: the child may have finished.
				if (this.#options.isSettled?.(childId) === true) return
				let delivered: boolean | Promise<boolean> = false
				try {
					delivered = this.#options.wrapup(childId, early ? wrapupMessageEarly() : wrapupMessage(caps.cap, caps.grace), rememberedLabel)
				} catch {
					delivered = false
				}
				// Latch on a true delivery. Sync deliveries latch now (the
				// historical timing); a promised delivery (service steer)
				// latches when it resolves — a rejection means not delivered.
				const latch = (ok: boolean) => {
					if (this.#disposed || this.#injected.has(childId) || this.#hardStopped.has(childId)) return
					if (!ok) return // stays eligible; next round retries
					this.#injected.add(childId)
					if (rememberedLabel !== undefined) this.#injectedLabel.set(childId, rememberedLabel)
					this.#injectedRound.set(childId, count)
					this.#injectedAt.set(childId, Date.now())
					// F6 marker: the injection landed — observers fold `⚡`.
					try {
						this.#options.onWrapUp?.(childId, count)
					} catch {
						// An observation failure must not touch delivery.
					}
				}
				if (delivered instanceof Promise) {
					void delivered.then(latch, () => {
						/* rejected = not delivered; stays eligible */
					})
					return
				}
				latch(delivered)
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
		this.#injectedRound.clear()
		this.#injectedAt.clear()
		this.#spinState.clear()
	}
}
