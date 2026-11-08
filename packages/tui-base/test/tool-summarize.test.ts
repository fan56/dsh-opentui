// Tool-block summarization unit tests (batch V1 + P1-1 CJK width law).
// The helpers are total functions — every case here is a real-wire shape:
// ASCII args, CJK args (no spaces, 1 code point = 2 display columns), the
// follow stream's JSON brief envelope, and legacy/absent output.
import { describe, expect, test } from "bun:test"
import { clipToWidth, toolDetail, toolResultLine, toolSubject } from "../src/routes/session/tool-summarize"

describe("clipToWidth (display-column budget)", () => {
	test("ASCII strings clip at the column limit with an ellipsis", () => {
		expect(clipToWidth("cargo build --release --workspace", 12)).toBe("cargo build…")
		expect(clipToWidth("short", 12)).toBe("short")
	})

	test("CJK: 1 code point counts 2 columns — the result NEVER exceeds the budget", () => {
		// 8 CJK chars = 16 columns; limit 10 must cut it (the old length-based
		// clip kept all 8 and overflowed to 16 columns).
		const clipped = clipToWidth("构建项目构建项目构建", 10)
		expect(clipped.endsWith("…")).toBe(true)
		expect([...clipped].some((ch) => ch !== "…")).toBe(true)
		// Full string is 18 columns; clipped must be ≤ 10 (import stringWidth
		// indirectly via a re-clip sanity: the head without the ellipsis fits).
		const head = clipped.slice(0, -1)
		expect(head.length * 2 <= 9).toBe(true) // CJK-only head: 2 cols/char
	})

	test("CJK + ASCII mixed measures per-character width", () => {
		// "$ 构建项目" = 2 + 8 = 10 columns; limit 6 keeps 5 cols of head + "…".
		expect(clipToWidth("$ 构建项目", 6)).toBe("$ 构…")
	})

	test("degenerate limits", () => {
		expect(clipToWidth("anything", 0)).toBe("")
		expect(clipToWidth("anything", 1)).toBe("…")
		expect(clipToWidth("", 10)).toBe("")
	})
})

describe("toolSubject", () => {
	test("picks the head word of known keys (dsh-tui-pi parity)", () => {
		expect(toolSubject('{"command":"cargo build --release"}')).toBe("cargo")
		expect(toolSubject('{"file_path":"/tmp/some file.ts"}')).toBe("/tmp/some")
		expect(toolSubject("{}")).toBe("")
		expect(toolSubject("not json")).toBe("")
	})

	test("P1-1: an unsplit CJK value comes back display-capped, never unbounded", () => {
		// A Chinese command has no spaces — firstWord returns the WHOLE string.
		// The subject cap (24 columns) must hold it; 45 raw columns pre-review.
		const subject = toolSubject(JSON.stringify({ command: "构建整个工作区并发布所有包到生产环境流水线" }))
		expect(subject.length).toBeLessThanOrEqual(12) // 12 CJK chars = 24 columns
		expect(subject.length).toBeGreaterThanOrEqual(1)
	})
})

describe("toolDetail", () => {
	test("renders the human arg line and folds newlines", () => {
		expect(toolDetail('{"command":"ls -la"}')).toBe("$ ls -la")
		expect(toolDetail('{"command":"echo a\\nb"}')).toBe("$ echo a ⏎ b")
		expect(toolDetail("not json")).toBe("")
	})

	test("P1-1: the detail budget is display columns, not code points", () => {
		const detail = toolDetail(JSON.stringify({ command: "构建".repeat(60) }))
		// 120 CJK code points = 240 columns raw; the clip must hold ≤ 120 cols.
		expect(detail.length).toBeLessThanOrEqual(61) // ≤60 CJK chars + ellipsis
		expect(detail.endsWith("…")).toBe(true)
	})
})

describe("toolResultLine", () => {
	test("digs the first text line out of the content array", () => {
		expect(toolResultLine(JSON.stringify({ content: [{ type: "text", text: "line1\nline2" }] }))).toBe("line1 (+1 lines)")
		expect(toolResultLine(JSON.stringify({ text: "plain" }))).toBe("plain")
		expect(toolResultLine("already plain")).toBe("already plain")
		expect(toolResultLine(undefined)).toBe("")
		// Degradation law: an object with no diggable text shows its JSON slice.
		expect(toolResultLine("{}")).toBe("{}")
	})

	test("P2 (live finding): digs through the whole-wire envelope the follow brief carries", () => {
		const envelope = JSON.stringify({
			turn: 1,
			step: 1,
			message: { role: "tool", content: [{ type: "text", text: "/private/tmp" }] },
		})
		expect(toolResultLine(envelope)).toBe("/private/tmp")
	})

	test("P1-1: CJK result lines clip by display columns", () => {
		const line = toolResultLine(JSON.stringify({ text: "编译".repeat(80) }))
		expect(line.length).toBeLessThanOrEqual(61)
		expect(line.endsWith("…")).toBe(true)
	})
})

describe("toolDetail: use_agent shape (batch D1)", () => {
	test("names the agent and leads with the prompt — never the raw-JSON fallback", () => {
		const detail = toolDetail(JSON.stringify({ agent: "oldfox", prompt: "修复登录 bug\n然后跑测试" }))
		expect(detail).toBe("agent: oldfox  修复登录 bug ⏎ 然后跑测试")
	})
	test("prompt alone still summarizes humanly (no bare JSON)", () => {
		expect(toolDetail(JSON.stringify({ prompt: "one line" }))).toBe("one line")
	})
	test("non-agent args keep the existing fallback", () => {
		expect(toolDetail('{"x":1}')).toBe('{"x":1}')
	})
	test("the detail budget is display columns with a CJK prompt", () => {
		const detail = toolDetail(JSON.stringify({ agent: "oldfox", prompt: "构建".repeat(80) }))
		expect(detail.length).toBeLessThanOrEqual(121)
		expect(detail.endsWith("…")).toBe(true)
	})
})
