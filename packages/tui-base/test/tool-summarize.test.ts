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
		// Batch D5 law: an EMPTY object has no readable leaves — the human
		// placeholder renders, never the raw JSON.
		expect(toolResultLine("{}")).toBe("tool result")
	})

	test("D2: a no-dig envelope renders its string leaves, never raw JSON", () => {
		// The D1 live frame: `✘ use_agent(looper) · 0.0s · {"turn":2,...}`
		const envelope = JSON.stringify({ turn: 2, agent: "looper", note: "child settled" })
		expect(toolResultLine(envelope)).toBe("turn: 2 · agent: looper · note: child settled")
		// Nested envelopes flatten one level.
		const nested = JSON.stringify({ result: { output: "done", extra: "x" } })
		expect(toolResultLine(nested)).toContain("output: done")
	})

	test("P2 (live finding): digs through the whole-wire envelope the follow brief carries", () => {
		const envelope = JSON.stringify({
			turn: 1,
			step: 1,
			message: { role: "tool", content: [{ type: "text", text: "/private/tmp" }] },
		})
		expect(toolResultLine(envelope)).toBe("/private/tmp")
	})

	test("D5 (live finding): the truncated follow-brief envelope never paints raw JSON", () => {
		// The exact on-device shape: the follow brief is
		// JSON.stringify(data).slice(0, 300) of the whole tool/result wire
		// event — a long one is CUT, so JSON.parse fails.
		const wire = {
			turn: 1,
			step: 1,
			message: {
				role: "tool",
				source: { kind: "tool", callId: "call_00_abcdefghijklmnopqrstuvwx" },
				toolCallId: "call_00_abcdefghijklmnopqrstuvwx",
				toolCall: { id: "call_00_abcdefghijklmnopqrstuvwx", name: "use_agent", arguments: "{\"agent\":\"牛马狗\"}" },
				content: [{ type: "text", text: "Started background subagent sa_1 (牛马狗).\nUse get_agent to poll." }],
			},
		}
		// 300 cuts right at `"text":` on this shape (placeholder); a slightly
		// longer cut lands mid-text — the decoded prefix renders.
		expect(toolResultLine(JSON.stringify(wire).slice(0, 300))).toBe("tool result")
		const cut = JSON.stringify(wire).slice(0, 345)
		expect(() => JSON.parse(cut)).toThrow()
		expect(toolResultLine(cut)).toBe("Started background subagent sa_1 (牛马狗). (+1 lines)")
		// Cut BEFORE any text field: the placeholder, never `{"turn":1,…`.
		const early = JSON.stringify(wire).slice(0, 120)
		expect(toolResultLine(early)).toBe("tool result")
		// Cut mid-string (and mid-escape): the decoded prefix.
		expect(toolResultLine('{"message":{"content":[{"type":"text","text":"hello wor\\u00')).toBe("hello wor")
		// Parseable role:tool envelope with a string content.
		expect(toolResultLine(JSON.stringify({ turn: 1, message: { role: "tool", content: "done ok" } }))).toBe("done ok")
		// A bare content-block array.
		expect(toolResultLine(JSON.stringify([{ type: "text", text: "arr text" }]))).toBe("arr text")
		expect(toolResultLine(JSON.stringify({ content: [] }))).toBe("tool result")
		expect(toolResultLine("plain text stays")).toBe("plain text stays")
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

describe("toolDetail: ask_agent shape (batch D5 live finding)", () => {
	// Real-model capture: the ask_agent tool row painted its args raw —
	// `⚙ ask_agent · … · {"agent_id":…}` — because toolDetail only knew the
	// use_agent keys. The human line reads `→ <agent> · <content>` (the
	// use_agent row's style) and raw JSON must never reach the screen.
	test("humanizes { agent_id, prompt } as → agent · content — never raw JSON", () => {
		const detail = toolDetail(JSON.stringify({ agent_id: "oldfox", prompt: "修复登录 bug\n然后跑测试" }))
		expect(detail).toBe("→ oldfox · 修复登录 bug ⏎ 然后跑测试")
		expect(detail.includes("{")).toBe(false)
	})
	test("message carries the content when prompt is absent (the captured shape)", () => {
		const detail = toolDetail('{"agent_id":"牛马狗","message":"检查一下构建"}')
		expect(detail).toBe("→ 牛马狗 · 检查一下构建")
		expect(detail.includes("agent_id")).toBe(false)
	})
	test("agent_id alone still names the target", () => {
		expect(toolDetail('{"agent_id":"sa_1"}')).toBe("→ sa_1")
	})
	test("empty agent_id falls through — no dangling arrow", () => {
		expect(toolDetail(JSON.stringify({ agent_id: "", prompt: "one line" }))).toBe("one line")
	})
	test("the detail budget is display columns with a CJK message", () => {
		const detail = toolDetail(JSON.stringify({ agent_id: "牛马狗", message: "构建".repeat(80) }))
		expect(detail.length).toBeLessThanOrEqual(121)
		expect(detail.endsWith("…")).toBe(true)
	})
})
