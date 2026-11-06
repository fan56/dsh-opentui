import { describe, expect, test } from "bun:test"
import { SubagentRoundPolicy, type SubagentRoundLimits } from "../src/subagent-policy.ts"

/** Drive one child to `rounds` assistant messages through the policy. The
 * per-round await mirrors the real facade: each round arrives on its own
 * event turn, so the policy's microtask-deferred wrap-up flushes in between. */
async function run(policy: SubagentRoundPolicy, childId: string, rounds: number, label?: string): Promise<void> {
	for (let i = 1; i <= rounds; i++) {
		policy.onRoundCount(childId, i, label)
		await Promise.resolve()
	}
}

function makePolicy(limits: Partial<SubagentRoundLimits>, extra: Partial<ConstructorParameters<typeof SubagentRoundPolicy>[0]> = {}) {
	const full: SubagentRoundLimits = { maxRounds: 2, maxRoundsGrace: 1, ...limits }
	return new SubagentRoundPolicy({
		limits: () => full,
		wrapup: () => true,
		forceStop: () => true,
		...extra,
	})
}

describe("SubagentRoundPolicy observation hooks (batch F6)", () => {
	test("onWrapUp fires with the delivery round (stage 1)", async () => {
		const wrapUps: { childId: string; round: number }[] = []
		const policy = makePolicy({ maxRounds: 2, maxRoundsGrace: 0 }, { onWrapUp: (childId, round) => wrapUps.push({ childId, round }) })
		await run(policy, "c1", 5)
		expect(wrapUps).toEqual([{ childId: "c1", round: 2 }])
	})

	test("onForceStop fires with the stop round (stage 2), after onWrapUp", async () => {
		const events: string[] = []
		const policy = makePolicy({ maxRounds: 2, maxRoundsGrace: 1 }, {
			onWrapUp: (_id, round) => events.push(`wrapup@${round}`),
			onForceStop: (_id, round) => events.push(`stop@${round}`),
		})
		await run(policy, "c1", 5)
		expect(events).toEqual(["wrapup@2", "stop@3"])
	})

	test("grace 0 (warn-only) never fires onForceStop", async () => {
		const stops: number[] = []
		const policy = makePolicy({ maxRounds: 2, maxRoundsGrace: 0 }, { onForceStop: (_id, round) => stops.push(round) })
		await run(policy, "c1", 6)
		expect(stops).toEqual([])
	})

	test("a throwing observer does not disturb the stop", async () => {
		let stopped = false
		const policy = makePolicy({ maxRounds: 2, maxRoundsGrace: 1 }, {
			onForceStop: () => {
				throw new Error("observer boom")
			},
			forceStop: () => {
				stopped = true
				return true
			},
		})
		await run(policy, "c1", 4)
		expect(stopped).toBe(true)
	})

	test("hook fires once per child (stage latches)", async () => {
		const stops: number[] = []
		const policy = makePolicy({ maxRounds: 2, maxRoundsGrace: 1 }, { onForceStop: (_id, round) => stops.push(round) })
		await run(policy, "c1", 3)
		await run(policy, "c1", 8)
		expect(stops).toEqual([3])
	})
})
