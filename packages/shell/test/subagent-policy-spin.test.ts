// Spin-detected early stop (ported from dsh-tui-pi wayfinder ticket 05 —
// the part F1 deliberately left out): the pure spinDecision verdict
// (thresholds / streak / freshness / post-wrapup rules) and the stateful
// SubagentRoundPolicy legs — early wrap-up past the floor, early force-stop
// on a post-wrapup strike, the onSpinStop hook and the `early` HardStopRecord.
import { describe, expect, test } from "bun:test"
import {
	EARLY_STOP_SPIN_STREAK,
	SPIN_HIGH_SEGMENT_AT,
	SPIN_STRIKE_STALE_MS,
	SubagentRoundPolicy,
	earlyFloor,
	spinDecision,
	wrapupMessageEarly,
	type SpinLadderAction,
} from "../src/subagent-policy.ts"

const NOW = 1_000_000

describe("spin constants + helpers (reference parity)", () => {
	test("thresholds match the reference", () => {
		expect(SPIN_HIGH_SEGMENT_AT).toBe(0.75) // the spinning high-segment line
		expect(SPIN_STRIKE_STALE_MS).toBe(90_000) // three debounce windows
		expect(EARLY_STOP_SPIN_STREAK).toBe(2) // one strike is never enough
	})
	test("earlyFloor is max(10, cap/3)", () => {
		expect(earlyFloor(60)).toBe(20)
		expect(earlyFloor(30)).toBe(10)
		expect(earlyFloor(9)).toBe(10)
		expect(earlyFloor(90)).toBe(30)
	})
	test("the early wrap-up names circling, not budget", () => {
		expect(wrapupMessageEarly()).toContain("going in circles")
		expect(wrapupMessageEarly()).not.toContain("Round limit reached")
	})
})

describe("spinDecision (pure verdict)", () => {
	const armed = { streak: 2, lastStrikeAt: NOW - 1000, now: NOW, cap: 60, grace: 7, settled: false }
	function verdict(over: Partial<Parameters<typeof spinDecision>[0]>): SpinLadderAction {
		return spinDecision({ ...armed, ...over } as Parameters<typeof spinDecision>[0])
	}

	test("below the streak, everything is inert", () => {
		expect(verdict({ streak: 1, count: 25 })).toBe("none")
		expect(verdict({ streak: 0, count: 25 })).toBe("none")
	})
	test("a stale strike is not evidence", () => {
		expect(verdict({ lastStrikeAt: NOW - SPIN_STRIKE_STALE_MS, count: 25 })).toBe("none")
		expect(verdict({ lastStrikeAt: NOW - SPIN_STRIKE_STALE_MS + 1, count: 25 })).toBe("wrapup-early")
	})
	test("a non-spinning verdict is folded upstream: the trail zeroes (noteSpinVerdict)", () => {
		// The pure verdict only sees the trail; zeroing is the policy's job.
		const policy = new SubagentRoundPolicy({ limits: () => ({ maxRounds: 60, maxRoundsGrace: 7 }), wrapup: () => true, forceStop: () => true })
		policy.noteSpinVerdict("c", 0.95, NOW)
		policy.noteSpinVerdict("c", 0.95, NOW + 1)
		expect(policy.getSpinState("c")).toEqual({ streak: 2, lastStrikeAt: NOW + 1 })
		policy.noteSpinVerdict("c", SPIN_HIGH_SEGMENT_AT - 0.01, NOW + 2)
		expect(policy.getSpinState("c")).toEqual({ streak: 0, lastStrikeAt: 0 })
		policy.dispose()
	})
	test("verdicts below the high-segment line never arm; malformed input ignored", () => {
		const policy = new SubagentRoundPolicy({ limits: () => ({ maxRounds: 60, maxRoundsGrace: 7 }), wrapup: () => true, forceStop: () => true })
		policy.noteSpinVerdict("c", 0.74, NOW)
		expect(policy.getSpinState("c").streak).toBe(0)
		policy.noteSpinVerdict("c", Number.NaN, NOW)
		policy.noteSpinVerdict("c", Number.POSITIVE_INFINITY, NOW)
		expect(policy.getSpinState("c").streak).toBe(0)
		policy.noteSpinVerdict("c", 0.95, NOW)
		expect(policy.getSpinState("c")).toEqual({ streak: 1, lastStrikeAt: NOW })
		policy.dispose()
	})
	test("early stage 1: past the floor, below the cap", () => {
		expect(verdict({ count: 19 })).toBe("none") // floor for cap 60 is 20
		expect(verdict({ count: 20 })).toBe("wrapup-early")
		expect(verdict({ count: 59 })).toBe("wrapup-early")
	})
	test("stage 1 never reaches the cap — the classic ladder owns the at-cap wrap-up", () => {
		expect(verdict({ count: 60 })).toBe("none")
		expect(verdict({ count: 70 })).toBe("none")
	})
	test("a settled child is left alone", () => {
		expect(verdict({ count: 25, settled: true })).toBe("none")
	})
	test("a disabled ladder (cap <= 0) keeps the spin legs inert", () => {
		expect(verdict({ count: 25, cap: 0 })).toBe("none")
	})
	test("early stage 2: wrap-up delivered, round burned, fresh strike AFTER delivery", () => {
		expect(
			verdict({ count: 22, wrapupDelivered: true, wrapupDeliveredAt: NOW - 5000, roundsSinceWrapup: 2 }),
		).toBe("force-stop-early")
	})
	test("early stage 2 demands a NEW judgment: a strike predating the wrap-up never stops", () => {
		expect(
			verdict({ count: 22, wrapupDelivered: true, wrapupDeliveredAt: NOW - 500, roundsSinceWrapup: 2 }),
		).toBe("none")
		expect(
			verdict({ count: 22, wrapupDelivered: true, wrapupDeliveredAt: NOW - 5000, lastStrikeAt: NOW - 5000, roundsSinceWrapup: 2 }),
		).toBe("none")
	})
	test("early stage 2 demands a burned round and grace > 0 (pure-soft never stops)", () => {
		expect(verdict({ count: 20, wrapupDelivered: true, wrapupDeliveredAt: NOW - 5000, roundsSinceWrapup: 0 })).toBe("none")
		expect(verdict({ count: 22, grace: 0, wrapupDelivered: true, wrapupDeliveredAt: NOW - 5000, roundsSinceWrapup: 2 })).toBe("none")
	})
})

describe("SubagentRoundPolicy spin legs (stateful)", () => {
	function makePolicy(extra: Partial<ConstructorParameters<typeof SubagentRoundPolicy>[0]> = {}) {
		return new SubagentRoundPolicy({
			limits: () => ({ maxRounds: 60, maxRoundsGrace: 7 }),
			wrapup: () => true,
			forceStop: () => true,
			...extra,
		})
	}
	const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

	test("two strikes pull the wrap-up forward past the floor; the early message rides it", async () => {
		const messages: string[] = []
		const policy = makePolicy({ wrapup: (_id, message) => {
			messages.push(message)
			return true
		} })
		policy.noteSpinVerdict("c1", 0.95)
		policy.noteSpinVerdict("c1", 0.95)
		for (let i = 1; i <= 20; i++) {
			policy.onRoundCount("c1", i)
			await flush()
		}
		expect(messages).toEqual([wrapupMessageEarly()])
		policy.dispose()
	})
	test("one strike alone never fires early — the classic ladder stays silent below the cap", async () => {
		const wrapups: number[] = []
		const policy = makePolicy({ onWrapUp: (_id, round) => wrapups.push(round) })
		policy.noteSpinVerdict("c1", 0.95)
		for (let i = 1; i <= 30; i++) {
			policy.onRoundCount("c1", i)
			await flush()
		}
		expect(wrapups).toEqual([])
		policy.dispose()
	})
	test("a post-wrapup fresh strike stops BEFORE the grace window (early: true + onSpinStop)", async () => {
		const events: string[] = []
		const stops: string[] = []
		const policy = makePolicy({
			onWrapUp: (_id, round) => events.push(`wrapup@${round}`),
			onForceStop: (_id, round) => events.push(`classic-stop@${round}`),
			onSpinStop: (_id, round) => events.push(`spin-stop@${round}`),
			onHardStop: (record) => events.push(`record:${record.round}:${record.early === true ? "early" : "classic"}`),
			forceStop: (id) => {
				stops.push(id)
				return true
			},
		})
		policy.noteSpinVerdict("c1", 0.95)
		policy.noteSpinVerdict("c1", 0.95)
		policy.onRoundCount("c1", 20) // early wrap-up fires (floor 20)
		await flush()
		policy.noteSpinVerdict("c1", 0.95) // NEW judgment, postdates the delivery
		policy.onRoundCount("c1", 21) // one round burned — early stage 2
		await flush()
		expect(events).toEqual(["wrapup@20", "record:21:early", "spin-stop@21"])
		expect(stops).toEqual(["c1"])
		policy.dispose()
	})
	test("the strike that ARMED the wrap-up never re-triggers it (no post-delivery strike -> classic ladder)", async () => {
		const events: string[] = []
		const policy = makePolicy({ onSpinStop: (_id, round) => events.push(`spin-stop@${round}`), onForceStop: (_id, round) => events.push(`classic-stop@${round}`) })
		policy.noteSpinVerdict("c1", 0.95)
		policy.noteSpinVerdict("c1", 0.95)
		policy.onRoundCount("c1", 20)
		await flush()
		policy.onRoundCount("c1", 21)
		await flush()
		policy.onRoundCount("c1", 22)
		await flush()
		expect(events).toEqual([]) // no NEW strike: grace runs its course
		policy.onRoundCount("c1", 67) // cap 60 + grace 7 — the classic stop
		expect(events).toEqual(["classic-stop@67"])
		policy.dispose()
	})
	test("a stale post-wrapup strike is not evidence (freshness window)", async () => {
		const stops: string[] = []
		const policy = makePolicy({ forceStop: (id) => {
			stops.push(id)
			return true
		} })
		policy.noteSpinVerdict("c1", 0.95)
		policy.noteSpinVerdict("c1", 0.95)
		policy.onRoundCount("c1", 20)
		await flush()
		// A strike 91s in the past: the trail says spinning, the ladder says stale.
		policy.noteSpinVerdict("c1", 0.95, Date.now() - SPIN_STRIKE_STALE_MS - 1000)
		policy.onRoundCount("c1", 21)
		await flush()
		expect(stops).toEqual([])
		policy.dispose()
	})
})
