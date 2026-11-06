// The spin attention source — the facade's own jev layer feeding
// noteChildSpinVerdict (the early-stop verdict feed). Covered here: the
// question/state/answer shapes (id8 correlation both ways), the settings
// knob parse, and the source's dispatch discipline — debounce as the replay
// guard, the settled-children filter, the fail-open counter, and one
// onVerdict per child per classify (no duplicate feeds from one call).
import { describe, expect, test } from "bun:test"
import {
	SPIN_JEV_MIN_INTERVAL_MS,
	SPIN_JEV_TIMEOUT_MS,
	buildSpinQuestions,
	buildSpinState,
	createSpinAttentionSource,
	parseSpinAnswers,
	spinAttentionEnabled,
	spinAttentionEnabledFromRows,
	type JevCoreModule,
} from "../src/spin-attention.ts"

const NOW = 1_000_000

/** Drain the source's microtask chain (probe -> dispatch -> classify -> feed). */
async function flush(times = 6) {
	for (let i = 0; i < times; i++) await Promise.resolve()
}

function fakeCore(overrides: Partial<Record<"configured" | "answers" | "fail", unknown>> = {}): JevCoreModule & { calls: { questions: Record<string, unknown>; state: string; timeoutMs?: number }[] } {
	const calls: { questions: Record<string, unknown>; state: string; timeoutMs?: number }[] = []
	return {
		calls,
		classify: async (options) => {
			calls.push({ questions: options.questions, state: options.state, timeoutMs: options.timeoutMs })
			if (overrides.fail) throw new Error("boom")
			return {
				answers: (overrides.answers as Record<string, { kind: "noul"; value: number }>) ?? {},
				model: "jev-test",
				usage: null,
				latencyMs: 1,
			}
		},
		isConfigured: () => overrides.configured !== false,
	} as never
}

const VIEWS = [
	{ childId: "aaaaaaaa-1111", label: "looper", rounds: 21, running: true, startedAt: NOW - 30_000 },
	{ childId: "bbbbbbbb-2222", label: "worker", rounds: 3, running: true, startedAt: NOW - 5_000 },
]

describe("spin questions / state / answers (id8 correlation)", () => {
	test("one atomic noul question per child, keyed spin_<id8>", () => {
		const q = buildSpinQuestions(["aaaaaaaa", "bbbbbbbb"])
		expect(Object.keys(q).sort()).toEqual(["spin_aaaaaaaa", "spin_bbbbbbbb"])
		expect(q["spin_aaaaaaaa"].type).toBe("noul")
		expect(q["spin_aaaaaaaa"].criteria.true).toContain("UNPRODUCTIVE")
		expect(q["spin_aaaaaaaa"].criteria.false).toContain("productive")
	})

	test("state table carries id8, label, rounds/cap; settled rows are the caller's problem", () => {
		const state = buildSpinState(VIEWS, 60, NOW)
		expect(state).toContain("aaaaaaaa looper")
		expect(state).toContain("rounds 21/60")
		expect(state).toContain("bbbbbbbb worker")
		expect(state.length).toBeLessThanOrEqual(SPIN_JEV_MIN_INTERVAL_MS) // sanity vs accidental huge constant
		const uncapped = buildSpinState(VIEWS, 0, NOW)
		expect(uncapped).toContain("rounds 21/∞")
	})

	test("parseSpinAnswers maps id8 keys back to full child ids; missing/invalid skipped", () => {
		const map = new Map([
			["aaaaaaaa", "aaaaaaaa-1111"],
			["bbbbbbbb", "bbbbbbbb-2222"],
		])
		const out = parseSpinAnswers(
			{
				spin_aaaaaaaa: { value: 0.95 },
				spin_bbbbbbbb: { value: Number.NaN },
				spin_cccccccc: { value: 0.9 }, // unknown child — dropped
			} as never,
			map,
		)
		expect(out).toEqual([["aaaaaaaa-1111", 0.95]])
	})
})

describe("spinAttentionEnabled knob", () => {
	test("default on; explicit false in the dsh-opentui namespace turns it off", () => {
		expect(spinAttentionEnabled(undefined)).toBe(true)
		expect(spinAttentionEnabled({ maxRounds: 60 })).toBe(true)
		expect(spinAttentionEnabled({ spinAttention: false })).toBe(false)
		expect(spinAttentionEnabledFromRows([{ ns: "other", value: { spinAttention: false } }, { ns: "dsh-opentui", value: { spinAttention: false } }])).toBe(false)
		expect(spinAttentionEnabledFromRows([{ ns: "dsh-opentui", value: { maxRounds: 5 } }])).toBe(true)
		expect(spinAttentionEnabledFromRows([])).toBe(true)
	})
})

describe("createSpinAttentionSource dispatch discipline", () => {
	function views() {
		return VIEWS.map((v) => ({ ...v }))
	}

	test("debounce is the replay guard: one classify per window, onVerdict per child per call", async () => {
		const core = fakeCore({ answers: { spin_aaaaaaaa: { kind: "noul", value: 0.95 }, spin_bbbbbbbb: { kind: "noul", value: 0.2 } } })
		const fed: [string, number][] = []
		const source = createSpinAttentionSource({
			enabledReader: () => true,
			onVerdict: (childId, score) => fed.push([childId, score]),
			module: core,
			env: {},
			now: () => NOW,
			minIntervalMs: SPIN_JEV_MIN_INTERVAL_MS,
		})
		source.tick(views(), 60)
		await flush()
		source.tick(views(), 60) // inside the window — must NOT reclassify
		expect(core.calls.length).toBe(1)
		expect(core.calls[0]!.timeoutMs).toBe(SPIN_JEV_TIMEOUT_MS)
		expect(fed).toEqual([["aaaaaaaa-1111", 0.95], ["bbbbbbbb-2222", 0.2]]) // one feed per child, once
		// After the window the next verdict round is a NEW judgment.
		source.tick(views(), 60) // still inside (now frozen) — use a moving clock instead
	})

	test("window expiry re-arms the dispatch (fresh verdicts, not replays)", async () => {
		let clock = NOW
		const core = fakeCore({ answers: { spin_aaaaaaaa: { kind: "noul", value: 0.95 } } })
		const source = createSpinAttentionSource({
			enabledReader: () => true,
			onVerdict: () => {},
			module: core,
			env: {},
			now: () => clock,
		})
		source.tick(views(), 60)
		await flush()
		expect(core.calls.length).toBe(1)
		clock += SPIN_JEV_MIN_INTERVAL_MS + 1
		source.tick(views(), 60)
		await flush()
		expect(core.calls.length).toBe(2)
	})

	test("silent when toggled off, nothing live, unconfigured, or core absent — and failures are counted, never thrown", async () => {
		const fed: [string, number][] = []
		let on = true
		const core = fakeCore({ configured: false })
		const source = createSpinAttentionSource({
			enabledReader: () => on,
			onVerdict: (id, s) => fed.push([id, s]),
			module: core,
			env: {},
			now: () => NOW,
		})
		source.tick([], 60)
		expect(core.calls.length).toBe(0)
		on = false
		source.tick(views(), 60)
		expect(core.calls.length).toBe(0)
		on = true
		source.tick(views(), 60) // isConfigured false — silent
		await flush()
		expect(core.calls.length).toBe(0)
		source.tick(views(), 60)
		await flush()
		expect(source.failures()).toBe(0)

		const failing = fakeCore({ fail: true })
		const fsource = createSpinAttentionSource({
			enabledReader: () => true,
			onVerdict: (id, s) => fed.push([id, s]),
			module: failing,
			env: {},
			now: () => NOW,
		})
		fsource.tick(views(), 60)
		await flush()
		expect(fsource.failures()).toBe(1)
		expect(fed).toEqual([])

		const absent = createSpinAttentionSource({
			enabledReader: () => true,
			onVerdict: (id, s) => fed.push([id, s]),
			module: null,
			env: {},
			now: () => NOW,
		})
		absent.tick(views(), 60)
		await flush()
		expect(absent.failures()).toBe(0)
	})

	test("running filter at dispatch time: a settled child is never asked or fed", async () => {
		const core = fakeCore({ answers: { spin_aaaaaaaa: { kind: "noul", value: 0.95 } } })
		const fed: [string, number][] = []
		const source = createSpinAttentionSource({
			enabledReader: () => true,
			onVerdict: (id, s) => fed.push([id, s]),
			module: core,
			env: {},
			now: () => NOW,
		})
		source.tick(
			[
				{ childId: "aaaaaaaa-1111", label: "looper", rounds: 21, running: false },
				{ childId: "bbbbbbbb-2222", label: "worker", rounds: 3, running: true },
			],
			60,
		)
		await flush()
		expect(core.calls.length).toBe(1)
		// Only the live child's question left the machine...
		expect(Object.keys(core.calls[0]!.questions)).toEqual(["spin_bbbbbbbb"])
		// ...and an answer keyed for the settled child (which was never asked)
		// feeds nothing — correlation never resurrects a dropped child.
		expect(fed).toEqual([])
	})
})
