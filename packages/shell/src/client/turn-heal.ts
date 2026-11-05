/**
 * Turn-end renderer heal, detection half (Batch B mitigation for the
 * confirmed OpenTUI 0.7.0 engine bug): a long streaming turn corrupts the
 * native diff-paint state — reply rows bleed into the input box and
 * SIGWINCH does NOT heal it (only a renderer state reset does; 0.8.2
 * tried and reverted).
 *
 * THIS BATCH LANDS THE DETECTION ONLY: the client entry wraps the
 * session's `turn` and counts churn (content deltas + streamed chars +
 * streaming seconds) and schedules one deferred heal per threshold trip.
 * The heal ACTION is currently a no-op — the cheapest API candidate,
 * `renderer.suspend()` → `resume()` (native terminal transition cycle +
 * forceFullRepaint on resume), was FALSIFIED by the live tear repro
 * (2026-11-05): the turn froze at end — screen static and torn from the
 * turn-end frame onward, idle placeholder never returned, subsequent
 * input dead (suspend halts the render loop; its native transition never
 * completes in this configuration, so resume is impossible). Wiring the
 * bounce froze every long turn; it must not ship.
 *
 * The remaining mechanism is threshold-based renderer recreation at turn
 * end, which needs ShellHost state (input buffer, transcript, dock,
 * focus) externalized first — a ShellHost edit would break the dist-host
 * zero-diff gate, so it is out of this batch's scope. This module keeps
 * the churn detection + the heal factory seam (`heal` option) so the
 * recreation lands as a one-line swap once the state problem is solved.
 *
 * Turn churn basis (tear repro, 60-sentence weather prompt): ~299 torn
 * frames over ~150s, ~2.7k streamed chars. Thresholds sit BELOW the
 * repro and ABOVE any ordinary short turn (~<500 chars, <30s).
 */
import type { ShellSessionSurface } from "./shell-session.ts"
import type { TurnCallbacks } from "../agent/loop.ts"

/** The renderer surface the heal needs (structural — fakes in tests). */
export interface HealTerminal {
	suspend(): Promise<void>
	resume(): Promise<void>
}

export interface HealThresholds {
	/** Streamed content chars above which a turn trips the heal. */
	maxChars: number
	/** Content delta callbacks above which a turn trips the heal. */
	maxDeltas: number
	/** Streaming seconds above which a turn trips the heal. */
	maxSecs: number
}

/** Tuned from the tear repro (see module header): 2.7k chars / ~150s
 * trips all three; an ordinary short turn trips none. */
export const DEFAULT_HEAL_THRESHOLDS: HealThresholds = {
	maxChars: 2_000,
	maxDeltas: 400,
	maxSecs: 120,
}

export interface TurnHealOptions {
	/** Heal action factory; returns the action, or null when the
	 * renderer is not ready (tests / plugin mode) — skips the heal. */
	heal?: (() => (() => Promise<void>) | null) | null
	/** Trip thresholds; defaults DEFAULT_HEAL_THRESHOLDS. */
	thresholds?: Partial<HealThresholds>
	/** Delay after turn end before the heal fires (let the final paint
	 * settle). Default 1000ms. */
	settleMs?: number
	/** Clock seam for tests. */
	now?: () => number
}

export interface TurnHealState {
	/** Churn counters of the current (latest) turn. */
	deltas: number
	chars: number
	startedAt: number
	/** Sequence of the latest turn() call; heals for older seqs are void. */
	seq: number
	/** Seq already evaluated & tripped (0 = none). */
	trippedSeq: number
	/** Turns that actually ran the heal. */
	healsRun: number
	/** Turns that tripped the threshold. */
	tripped: number
}

/**
 * Wrap a session surface so every turn is churn-tracked and a threshold
 * trip schedules exactly one deferred heal at turn end. Pure client-side
 * decorator: the wrapped surface is ShellSessionSurface-shaped via the
 * same Proxy pattern as aggregateTurnContext (private-field targets stay
 * usable — accessors run with the real target as receiver).
 */
export function createTurnHeal(session: ShellSessionSurface, options: TurnHealOptions = {}): ShellSessionSurface {
	const thresholds = { ...DEFAULT_HEAL_THRESHOLDS, ...(options.thresholds ?? {}) }
	const settleMs = options.settleMs ?? 1_000
	const now = options.now ?? Date.now

	const state: TurnHealState = {
		deltas: 0,
		chars: 0,
		startedAt: 0,
		seq: 0,
		trippedSeq: 0,
		healsRun: 0,
		tripped: 0,
	}

	const tripped = (): boolean => {
		if (state.chars > thresholds.maxChars) return true
		if (state.deltas > thresholds.maxDeltas) return true
		if ((now() - state.startedAt) / 1000 > thresholds.maxSecs) return true
		return false
	}

	/** One heal per turn, only if this is still the latest turn (a newer
	 * turn() voids the pending one — never bounce the terminal mid-turn). */
	const maybeSchedule = (seq: number): void => {
		if (seq !== state.seq) return
		if (state.trippedSeq === seq) return // already evaluated & tripped
		if (!tripped()) return
		state.trippedSeq = seq
		state.tripped += 1
		setTimeout(() => {
			if (state.seq !== seq) return // a newer turn started meanwhile
			const action = options.heal?.()
			if (!action) return // renderer not ready (tests / plugin mode) — skip
			state.healsRun += 1
			void action().catch((error: unknown) => {
				console.error("[turn-heal] renderer heal failed:", error)
			})
		}, settleMs)
	}

	const turn: ShellSessionSurface["turn"] = (userText, cb, signal) => {
		const seq = ++state.seq
		state.deltas = 0
		state.chars = 0
		state.startedAt = now()
		const wrapped: TurnCallbacks = {
			...cb,
			onContentDelta: (text: string) => {
				state.deltas += 1
				state.chars += text.length
				cb.onContentDelta(text)
			},
			onTurnEnd: (u) => {
				cb.onTurnEnd(u)
				maybeSchedule(seq)
			},
		}
		// Settlement anchor too: endings without onTurnEnd (error path)
		// still get the heal; maybeSchedule is idempotent per seq.
		return session.turn(userText, wrapped, signal).finally(() => maybeSchedule(seq))
	}

	return new Proxy(session, {
		get(target, prop) {
			if (prop === "turn") return turn
			if (prop === "turnHealState") return state
			const value = Reflect.get(target, prop, target)
			return typeof value === "function" ? value.bind(target) : value
		},
	})
}
