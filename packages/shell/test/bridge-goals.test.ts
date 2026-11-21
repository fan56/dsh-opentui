/**
 * 025 W2-5b — pure goals projection tests (AMEND-2 C-1 blind-spot family).
 * The 7 goal result schemas are schema-open / null, so these hand-written
 * SECOND whitelist projections are the load-bearing defence: every hostile
 * key dropped, free text capped, enums closed, malformed -> undefined (honest
 * "no current goal", never a fabricated row). No live host / no real secrets.
 */
import { describe, expect, test } from "bun:test"
import {
	projectCreateGoalResult,
	projectGoalRef,
	projectGoalView,
	unwrapGoalsValue,
} from "../src/client/bridge-goals.ts"

const SENTINEL = "W2_5_SENTINEL_synthetic_no_real_credential"

function goalView(overrides: Record<string, unknown> = {}) {
	return {
		id: "g-123", revision: 4, objective: "Ship the feature",
		phase: "active", activation: "armed", roundsStarted: 2,
		maxGoalRounds: 10, createdAt: 1700000000000, updatedAt: 1700000001000,
		...overrides,
	}
}

describe("W2-5b goals projections — second whitelist (AMEND-2 blind spot)", () => {
	test("unwrapGoalsValue accepts {value} wrap and direct object", () => {
		expect(unwrapGoalsValue({ value: 42 })).toBe(42)
		const obj = { id: "x" }
		expect(unwrapGoalsValue(obj)).toBe(obj)
	})

	test("projectGoalRef: id + revision only; extra keys dropped", () => {
		const ref = projectGoalRef({ id: "g-1", revision: 3, apiKey: SENTINEL, secret: SENTINEL })
		expect(ref).toEqual({ id: "g-1", revision: 3 })
		expect(JSON.stringify(ref)).not.toContain(SENTINEL)
	})

	test("projectGoalRef: missing/shaped-wrong -> undefined (no fake ref)", () => {
		expect(projectGoalRef({})).toBeUndefined()
		expect(projectGoalRef({ id: "g-1" })).toBeUndefined()
		expect(projectGoalRef({ id: "g-1", revision: "3" })).toBeUndefined()
		expect(projectGoalRef(null)).toBeUndefined()
		expect(projectGoalRef({ value: null })).toBeUndefined()
	})

	test("projectGoalView: full valid view projects closed enums + all display fields", () => {
		const view = projectGoalView({ value: goalView() })
		expect(view).toEqual({
			id: "g-123", revision: 4, objective: "Ship the feature",
			phase: "active", activation: "armed", roundsStarted: 2,
			maxGoalRounds: 10, createdAt: 1700000000000, updatedAt: 1700000001000,
		})
	})

	test("projectGoalView: blockedReason projected when both fields present", () => {
		const view = projectGoalView(goalView({
			phase: "blocked",
			blockedReason: { code: "need-input", message: "awaiting answer", apiKey: SENTINEL },
		}))
		expect(view!.phase).toBe("blocked")
		expect(view!.blockedReason).toEqual({ code: "need-input", message: "awaiting answer" })
		expect(JSON.stringify(view)).not.toContain(SENTINEL)
	})

	test("E5 hostile: apiKey/token/secret/password/credential never cross the seam", () => {
		const hostile = goalView({
			apiKey: SENTINEL, token: SENTINEL, secret: SENTINEL,
			password: SENTINEL, credential: SENTINEL, authorizeUrl: SENTINEL,
		})
		const view = projectGoalView(hostile)
		const text = JSON.stringify(view)
		for (const key of ["apiKey", "token", "secret", "password", "credential", "authorizeUrl"]) {
			expect(text).not.toContain('"' + key + '"')
		}
		expect(text).not.toContain(SENTINEL)
		// Real display fields still survive the whitelist.
		expect(view!.objective).toBe("Ship the feature")
	})

	test("E5 free text is capped (objective + blockedReason.message)", () => {
		const long = "x".repeat(9000)
		const view = projectGoalView(goalView({
			objective: long,
			phase: "blocked",
			blockedReason: { code: "c", message: long },
		}))
		expect(view!.objective.length).toBe(4096)
		expect(view!.blockedReason!.message.length).toBe(4096)
	})

	test("closed enums: unknown phase/activation degrades to undefined (no fake row)", () => {
		expect(projectGoalView(goalView({ phase: "bogus" }))).toBeUndefined()
		expect(projectGoalView(goalView({ activation: "bogus" }))).toBeUndefined()
	})

	test("null/malformed/missing-required -> undefined (honest no-goal)", () => {
		expect(projectGoalView(null)).toBeUndefined()
		expect(projectGoalView(undefined)).toBeUndefined()
		expect(projectGoalView({ value: undefined })).toBeUndefined()
		expect(projectGoalView({})).toBeUndefined()
		expect(projectGoalView(goalView({ roundsStarted: "2" }))).toBeUndefined()
	})

	test("projectCreateGoalResult: {ref} -> SeamGoalRef; hostile keys dropped", () => {
		const ref = projectCreateGoalResult({ ref: { id: "g-9", revision: 1, token: SENTINEL }, secret: SENTINEL })
		expect(ref).toEqual({ id: "g-9", revision: 1 })
		expect(JSON.stringify(ref)).not.toContain(SENTINEL)
		expect(projectCreateGoalResult({})).toBeUndefined()
	})
})
