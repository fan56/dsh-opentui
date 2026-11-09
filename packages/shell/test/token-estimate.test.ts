// ContextTokenMeter + estimateTextTokens contract tests (footer context
// batch): the 🧠 segment's occupancy estimate — tui-pi BridgeStats.
// contextTokens semantics (dsh-tui-pi/src/session.ts:1885-1894 reference),
// priced with the same CJK estimator as tui-pi src/tokens.ts.
import { describe, expect, test } from "bun:test"
import { ContextTokenMeter, estimateTextTokens } from "../src/client/token-estimate.ts"

describe("estimateTextTokens (CJK-aware pricing, tui-pi tokens.ts parity)", () => {
	test("pure ASCII ≈ 4 chars/token, ceil per text", () => {
		expect(estimateTextTokens("")).toBe(0)
		expect(estimateTextTokens("abcd")).toBe(1)
		expect(estimateTextTokens("abcde")).toBe(2) // ceil(5/4)
		expect(estimateTextTokens("abcdefgh")).toBe(2)
	})

	test("CJK prices at ~2 chars/token (one token per Han char in practice)", () => {
		// 8 Han chars → ceil(8/2) = 4
		expect(estimateTextTokens("你好世界早上好呀")).toBe(4)
		// Mixed: 4 Han + 8 ASCII → ceil(4/2 + 8/4) = 4
		expect(estimateTextTokens("你好abcd世界efgh")).toBe(4)
	})

	test("CJK punctuation and full-width forms price dense too", () => {
		// 「测试」，ａｂ — 7 chars, all in the CJK class (punctuation +
		// full-width letters) → ceil(7/2) = 4
		expect(estimateTextTokens("「测试」，ａｂ")).toBe(4)
	})
})

describe("ContextTokenMeter (tui-pi BridgeStats.contextTokens semantics)", () => {
	test("starts at zero and prices pending text before any billed frame", () => {
		const meter = new ContextTokenMeter()
		expect(meter.tokens).toBe(0)
		meter.notePending("abcdefgh") // 2
		meter.notePending("你好") // 1
		expect(meter.tokens).toBe(3)
	})

	test("a billed frame prices the pending pool: input + output, pending resets", () => {
		const meter = new ContextTokenMeter()
		meter.notePending("abcdefgh") // 2 pending
		// frame: 100 uncached + 200 cacheRead + 300 cacheWrite = 600 billed,
		// 40 tokens of frame output (the completion accumulator's delta).
		meter.noteUsage(100, 200, 300, 40)
		expect(meter.tokens).toBe(640)
		// Post-frame deltas re-enter the pending pool on top.
		meter.notePending("abcd") // 1
		expect(meter.tokens).toBe(641)
	})

	test("the next frame re-bases: occupancy follows the latest request, not a cumulative total", () => {
		const meter = new ContextTokenMeter()
		meter.noteUsage(1000, 0, 0, 50) // 1050
		meter.noteUsage(400, 100, 0, 30) // compaction/route change → 530
		expect(meter.tokens).toBe(530)
	})

	test("output-only frames keep the base and add exact tokens to the pool", () => {
		const meter = new ContextTokenMeter()
		meter.noteUsage(500, 0, 0, 20) // 520
		meter.noteUsage(0, 0, 0, 10) // no billed input → 530
		expect(meter.tokens).toBe(530)
		meter.noteUsage(0, 0, 0, Number.NaN) // junk deltas never poison the pool
		expect(meter.tokens).toBe(530)
	})

	test("reset restarts from zero (fresh/resumed session)", () => {
		const meter = new ContextTokenMeter()
		meter.noteUsage(900, 0, 0, 50)
		meter.notePending("abcdefgh")
		meter.reset()
		expect(meter.tokens).toBe(0)
	})
})
