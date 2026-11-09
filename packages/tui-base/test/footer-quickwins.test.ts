/**
 * Footer-quickwins batch: the tui-pi parity footer pieces —
 *   - model segment's per-level effort glyph ladder (○◔◑◕●◉★, off bare)
 *   - effortFromModelLabel: the sessionInfo().model label parse fallback
 *   - provider segment's ☁️ lead
 *   - tools / tps / durable-message wiring through sessionFooterSegments
 *   - the 8-segment hint bar: per-segment toggles, busy/idle state wording,
 *     the conditional ↓ subagents gate, and the four label languages
 *     (tui-pi locales `footer.hint.*` parity).
 */
import { describe, expect, test, beforeEach } from "bun:test"
import {
	EFFORT_ICONS,
	effortIcon,
	effortFromModelLabel,
	modelSegment,
	providerSegment,
	sessionFooterSegments,
} from "../src/routes/session/powerline"
import {
	DEFAULT_FOOTER_HINTS,
	FOOTER_HINT_IDS,
	hintInState,
	hintLabel,
	hintsText,
	setFooterHints,
	setHintsLocale,
	footerHints,
	hintsLocale,
	type FooterHints,
} from "../src/routes/session/hints-line"

describe("effort glyph ladder (tui-pi thinkingIcon parity)", () => {
	test("the seven levels map to the seven ramp glyphs; off is bare", () => {
		expect(EFFORT_ICONS.off).toBe("")
		expect(effortIcon("minimal")).toBe("◔")
		expect(effortIcon("low")).toBe("◑")
		expect(effortIcon("medium")).toBe("◕")
		expect(effortIcon("high")).toBe("●")
		expect(effortIcon("xhigh")).toBe("◉")
		expect(effortIcon("max")).toBe("★")
	})
	test("unknown provider-specific effort words fall to ○ (tui-pi default)", () => {
		expect(effortIcon("thinking")).toBe("○")
	})
	test("model segment: off renders no level; non-off renders `<glyph> <word>`", () => {
		expect(modelSegment("glm", "off")?.text).toBe("🤖 glm")
		expect(modelSegment("glm", "xhigh")?.text).toBe("🤖 glm ◉ xhigh")
	})
})

describe("effortFromModelLabel (sessionInfo().model parse fallback)", () => {
	test("parses the trailing parenthesized effort word", () => {
		expect(effortFromModelLabel("anthropic/claude-x (high)")).toBe("high")
		expect(effortFromModelLabel("openai/gpt-x(minimal)")).toBe("minimal")
	})
	test("returns undefined without a trailing parenthesized word", () => {
		expect(effortFromModelLabel("anthropic/claude-x")).toBeUndefined()
		expect(effortFromModelLabel("m (fast mode)")).toBeUndefined() // not an effort word
		expect(effortFromModelLabel(null)).toBeUndefined()
		expect(effortFromModelLabel(undefined)).toBeUndefined()
	})
	test("recognizes exactly the seven effort words", () => {
		for (const level of Object.keys(EFFORT_ICONS)) {
			if (level === "off") continue
			expect(effortFromModelLabel(`p/m (${level})`)).toBe(level)
		}
	})
})

describe("provider segment ☁️ lead", () => {
	test("provider label carries the ☁️ prefix", () => {
		expect(providerSegment("bigmodel")?.text).toBe("☁️ bigmodel")
	})
})

describe("footer wiring: tools / tps / durable messages", () => {
	test("tools > 0 renders the 🛠 segment; 0 stays omitted", () => {
		const withTools = sessionFooterSegments({ provider: "p", model: "m", tools: 3 })
		expect(withTools.find((s) => s.text === "🛠 3")).toBeDefined()
		const noTools = sessionFooterSegments({ provider: "p", model: "m", tools: 0 })
		expect(noTools.find((s) => s.text.startsWith("🛠"))).toBeUndefined()
	})
	test("tps renders the ⚡ tok/s segment (last-turn or session-average source)", () => {
		const segs = sessionFooterSegments({ provider: "p", model: "m", tps: 42.6 })
		expect(segs.find((s) => s.text === "⚡ 43 tok/s")).toBeDefined()
		expect(sessionFooterSegments({ provider: "p", model: "m", tps: null }).find((s) => s.text.includes("tok/s"))).toBeUndefined()
	})
	test("durable message count rides the 💬 segment (sessionInfo().messageCount)", () => {
		const segs = sessionFooterSegments({ provider: "p", model: "m", messages: 7 })
		expect(segs.find((s) => s.text === "💬 7")).toBeDefined()
	})
})

describe("hint bar: 8 segments × 4 languages (tui-pi FooterHints parity)", () => {
	beforeEach(() => {
		setFooterHints({ ...DEFAULT_FOOTER_HINTS })
		setHintsLocale("en")
	})

	test("all-on idle text keeps the pre-quickwins segment order", () => {
		const text = hintsText(false)
		expect(text).toBe("⌨ enter send · alt+enter newline · ↑↓ history · ctrl+shift+f search · pgup/pgdn scroll · ctrl+c ×2 quit")
	})

	test("busy text leads with the running-turn keys", () => {
		const text = hintsText(true)
		expect(text).toBe("⌨ enter steer · esc stop · ctrl+shift+f search · pgup/pgdn scroll · ctrl+c ×2 quit")
	})

	test("per-segment toggles drop exactly their own label (both states)", () => {
		for (const id of FOOTER_HINT_IDS) {
			setFooterHints((hints) => ({ ...hints, [id]: false }))
			const idle = hintsText(false)
			const busy = hintsText(true)
			const idleLabel = hintLabel(id, false)
			const busyLabel = hintLabel(id, true)
			if (idleLabel) expect(idle).not.toContain(idleLabel)
			if (busyLabel) expect(busy).not.toContain(busyLabel)
			setFooterHints({ ...DEFAULT_FOOTER_HINTS })
		}
	})

	test("state-absent segments: stop busy-only, newline/history idle-only", () => {
		expect(hintInState("stop", false)).toBe(false)
		expect(hintInState("stop", true)).toBe(true)
		expect(hintInState("newline", true)).toBe(false)
		expect(hintInState("history", true)).toBe(false)
		expect(hintInState("send", true)).toBe(true) // steer wording
	})

	test("all segments off renders '' (bar collapses)", () => {
		const off: FooterHints = {
			send: false,
			newline: false,
			history: false,
			stop: false,
			quit: false,
			scroll: false,
			search: false,
			subagents: false,
		}
		expect(hintsText(false, true, false, off)).toBe("")
		expect(hintsText(true, true, true, off)).toBe("")
	})

	test("↓ subagents renders only while live AND its segment is on", () => {
		expect(hintsText(true, true, true)).toContain("↓ subagents")
		expect(hintsText(true, true, false)).not.toContain("↓ subagents")
		setFooterHints((hints) => ({ ...hints, subagents: false }))
		expect(hintsText(true, true, true)).not.toContain("↓ subagents")
	})

	test("four languages: en / zh-CN / ja / ko labels (tui-pi locales wording)", () => {
		setHintsLocale("zh-CN")
		expect(hintsText(false)).toContain("enter 发送")
		expect(hintsText(true)).toContain("esc 停止")
		expect(hintsText(true, true, true)).toContain("↓ 子代理")
		setHintsLocale("ja")
		expect(hintsText(false)).toContain("enter 送信")
		expect(hintsText(true, true, true)).toContain("↓ サブエージェント")
		setHintsLocale("ko")
		expect(hintsText(false)).toContain("enter 전송")
		expect(hintsText(true, true, true)).toContain("↓ 서브에이전트")
		setHintsLocale("en")
		expect(hintsLocale()).toBe("en")
		expect(hintsText(false)).toContain("enter send")
	})

	test("module store starts at the tui-pi default (every segment on)", () => {
		expect(footerHints()).toEqual({ ...DEFAULT_FOOTER_HINTS })
	})
})
