/**
 * Batch D3: the dock's status/notices/hints pure contracts.
 *   - hintsText: idle vs busy key sets, '' when toggled off, never carries
 *     a powerline segment;
 *   - notices store: stack, per-line auto-dismiss, oldest-drop cap,
 *     newline folding, width clip;
 *   - the powerline strip carries no hint segment any more.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { hintsText } from "../src/routes/session/hints-line"
import {
	NOTICE_MAX_LINES,
	clearNotices,
	noticeLines,
	noticeList,
	retireNotice,
	showNotice,
} from "../src/routes/session/notices-dock"
import { sessionFooterSegments } from "../src/routes/session/powerline"

describe("hintsText", () => {
	test("idle: send/newline/history lead, common keys follow", () => {
		const text = hintsText(false)
		expect(text.startsWith("⌨ enter send · alt+enter newline · ↑↓ history")).toBe(true)
		expect(text).toContain("ctrl+shift+f search")
		expect(text).not.toContain("enter steer")
	})
	test("busy: steer/stop lead", () => {
		const text = hintsText(true)
		expect(text.startsWith("⌨ enter steer · esc stop")).toBe(true)
		expect(text).not.toContain("enter send")
	})
	test("toggled off → ''", () => {
		expect(hintsText(false, false)).toBe("")
	})
	test("D5b: `↓ subagents` only while a child runs", () => {
		expect(hintsText(false)).not.toContain("↓ subagents")
		expect(hintsText(true, true, true)).toContain("↓ subagents")
	})
})

describe("powerline is pure segments (D3)", () => {
	test("no hint segment in the strip", () => {
		const texts = sessionFooterSegments({ provider: "p", model: "m", messages: 1 }).map((s) => s.text)
		expect(texts.some((t) => /search|enter|ctrl/i.test(t))).toBe(false)
	})
})

describe("notices store", () => {
	afterEach(() => clearNotices())
	test("lines stack in arrival order and fold newlines", () => {
		showNotice("a")
		showNotice("b\nc")
		expect(noticeList().map((n) => n.text)).toEqual(["a", "b c"])
	})
	test("blank text is ignored", () => {
		expect(showNotice("  ")).toBe(-1)
		expect(noticeList()).toHaveLength(0)
	})
	test("each line retires on its own timer", async () => {
		showNotice("short", 20)
		showNotice("long", 5000)
		await new Promise((r) => setTimeout(r, 60))
		expect(noticeList().map((n) => n.text)).toEqual(["long"])
	})
	test("cap drops the OLDEST line", () => {
		for (let i = 0; i < NOTICE_MAX_LINES + 2; i++) showNotice(`n${i}`)
		const texts = noticeList().map((n) => n.text)
		expect(texts).toHaveLength(NOTICE_MAX_LINES)
		expect(texts[0]).toBe("n2")
		expect(texts[texts.length - 1]).toBe(`n${NOTICE_MAX_LINES + 1}`)
	})
	test("retireNotice is idempotent", () => {
		const id = showNotice("x")
		retireNotice(id)
		retireNotice(id)
		expect(noticeList()).toHaveLength(0)
	})
	test("noticeLines clips to the display width", () => {
		const lines = noticeLines([{ id: 1, text: "中文".repeat(20) }], 10)
		expect(lines[0]!.length).toBeLessThan(20)
	})
})
