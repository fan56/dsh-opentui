/**
 * Footer-quickwins batch: the tui-pi parity footer pieces —
 *   - model segment's per-level effort glyph ladder (○◔◑◕●◉★, off = ○ off)
 *   - effortFromModelLabel: the sessionInfo().model label parse fallback
 *   - provider segment's ☁️ lead
 *   - tools / tps / durable-message wiring through sessionFooterSegments
 *   - the 9-segment hint bar: per-segment toggles, busy/idle state wording,
 *     the conditional ↓ subagents gate, the en/zh golden label wording
 *     (T8 fold — the labels are `footer.hint.*` registry keys now), and the
 *     width-fitted folding: whole low-priority segments drop as the terminal
 *     narrows so the core keys (enter / esc / ctrl+c) always stay visible.
 */
import { describe, expect, test, beforeEach, beforeAll } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { bundledLocalesDir, loadLocales, setLanguages } from "@dsh-opentui/i18n"
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
	hintsTextAtWidth,
	HINT_SEGMENT_PRIORITY,
	setFooterHints,
	setHintsLocale,
	footerHints,
	hintsLocale,
	footerHintsFromConfig,
	hintsLocaleFromConfig,
	applyHintsConfig,
	type FooterHints,
} from "../src/routes/session/hints-line"
import { stringWidth } from "../src/util/string-width"

// The 💬 label rides the i18n registry (t() fail-open → the key itself when
// no table is loaded); boot the bundled locales before any segment assertion
// so this file also passes standalone (the footer-wiring describe relies on it).
setLanguages(loadLocales({ bundledDir: bundledLocalesDir() }).languages)

describe("effort glyph ladder (tui-pi thinkingIcon parity)", () => {
	test("the seven levels map to the seven ramp glyphs; off is ○ (tui-pi parity, not bare)", () => {
		expect(EFFORT_ICONS.off).toBe("○")
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
	test("model segment: off renders `○ off` (tui-pi parity); non-off renders `<glyph> <word>`", () => {
		expect(modelSegment("glm", "off")?.text).toBe("🤖 glm ○ off")
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
	test("tools render the 🔧 segment and stay visible at 0 (tui-pi parity: `🔧 n tools`)", () => {
		const withTools = sessionFooterSegments({ provider: "p", model: "m", tools: 3 })
		expect(withTools.find((s) => s.text === "🔧 3 tools")).toBeDefined()
		const noTools = sessionFooterSegments({ provider: "p", model: "m", tools: 0 })
		expect(noTools.find((s) => s.text === "🔧 0 tools")).toBeDefined()
	})
	test("tps renders the tok/s segment without the ⚡ prefix (⚡ stays tui-pi's cache-hit symbol)", () => {
		const segs = sessionFooterSegments({ provider: "p", model: "m", tps: 42.6 })
		expect(segs.find((s) => s.text === "43 tok/s")).toBeDefined()
		expect(segs.find((s) => s.text.includes("⚡"))).toBeUndefined()
		expect(sessionFooterSegments({ provider: "p", model: "m", tps: null }).find((s) => s.text.includes("tok/s"))).toBeUndefined()
	})
	test("durable message count rides the 💬 segment (sessionInfo().messageCount)", () => {
		const segs = sessionFooterSegments({ provider: "p", model: "m", messages: 7 })
		expect(segs.find((s) => s.text === "💬 7 msgs")).toBeDefined()
	})
})

describe("hint bar: 9 segments, en/zh golden wording (tui-pi FooterHints parity)", () => {
	// T8 fold: labels ride the i18n registry — the bundled locales must be in
	// (t() fail-open would render the bare keys on an empty registry).
	let languages: Map<string, import("@dsh-opentui/i18n").LocaleTable>
	beforeAll(() => {
		languages = loadLocales({ bundledDir: bundledLocalesDir() }).languages
		setLanguages(languages)
	})
	beforeEach(() => {
		setFooterHints({ ...DEFAULT_FOOTER_HINTS })
		setHintsLocale("en")
	})

	test("all-on idle text keeps the pre-quickwins segment order", () => {
		const text = hintsText(false)
		expect(text).toBe("⌨ enter send · alt+enter newline · ↑↓ history · ctrl+g subagents panel · ctrl+shift+f search · pgup/pgdn scroll · ctrl+c ×2 quit")
	})

	test("busy text leads with the running-turn keys", () => {
		const text = hintsText(true)
		expect(text).toBe("⌨ enter steer · esc stop · ctrl+g subagents panel · ctrl+shift+f search · pgup/pgdn scroll · ctrl+c ×2 quit")
	})

	test("subagentPanel is unconditional (no running-agent gate) and independently toggleable", () => {
		expect(hintsText(false)).toContain("ctrl+g subagents panel")
		expect(hintsText(true)).toContain("ctrl+g subagents panel")
		expect(hintsText(false, true, false)).toContain("ctrl+g subagents panel")
		setFooterHints((hints) => ({ ...hints, subagentPanel: false }))
		expect(hintsText(false)).not.toContain("ctrl+g subagents panel")
		expect(hintsText(true)).not.toContain("ctrl+g subagents panel")
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
		subagentPanel: false,
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

	test("en + zh-CN golden wording matches the folded table verbatim (design §5.6)", () => {
		// T8: the label language is the boot-fixed registry language, so the
		// golden check flips it via setLanguages (the hintsLocale signal is
		// persistence-only now). ja/ko are gone by contract §1 — no bundled
		// file, the boot chain degrades those picks to en.
		expect(hintsText(false)).toBe("⌨ enter send · alt+enter newline · ↑↓ history · ctrl+g subagents panel · ctrl+shift+f search · pgup/pgdn scroll · ctrl+c ×2 quit")
		setLanguages(languages, "zh-CN")
		expect(hintsText(false)).toBe("⌨ enter 发送 · alt+enter 换行 · ↑↓ 历史 · ctrl+g 子代理活动面板 · ctrl+shift+f 搜索 · pgup/pgdn 滚动 · ctrl+c ×2 退出")
		expect(hintsText(true)).toBe("⌨ enter 插话 · esc 停止 · ctrl+g 子代理活动面板 · ctrl+shift+f 搜索 · pgup/pgdn 滚动 · ctrl+c ×2 退出")
		expect(hintsText(true, true, true)).toContain("↓ 子代理")
		setLanguages(languages)
		expect(hintsLocale()).toBe("en")
		expect(hintsText(false)).toContain("enter send")
	})

	test("module store starts at the tui-pi default (every segment on)", () => {
		expect(footerHints()).toEqual({ ...DEFAULT_FOOTER_HINTS })
	})
})

describe("hint bar width upper bounds (en/zh, terminal columns)", () => {
	// Bounds are TERMINAL COLUMNS (stringWidth — the P1-1 CJK law: one CJK
	// code point is 2 columns), measured per segment per language per state.
	// hintsText is the WIDTH-UNAWARE full row: these caps pin the designed
	// ceilings so wording growth fails here loudly. At render time the row
	// folds whole low-priority segments to fit (see the folding block below),
	// so the visible row never mid-cuts a segment on a narrow terminal.
	// T8: the ja/ko columns are gone with the typed table (contract §1 — no
	// bundled file; the boot chain degrades those picks to en).
	// 22 = the widest designed bundled label, en subagentPanel
	// "ctrl+g subagents panel" (22 ascii); one segment never eats more than
	// ~¼ of the common 80-column viewport's 78 usable columns.
	const SEGMENT_CAP = 22
	// All-on full-row ceilings measured at implementation (idle includes the
	// conditional ↓ subagents segment live; busy likewise). en idle (142) is
	// the global worst case — the designed maximum row.
	const ROW_CAPS = { en: 142, "zh-CN": 128 }
	const BUSY_ROW_CAPS = { en: 121, "zh-CN": 112 }

	test("every segment label in every language and state stays within its cap", () => {
		for (const id of FOOTER_HINT_IDS) {
			for (const busy of [false, true]) {
				const label = hintLabel(id, busy)
				if (!label) continue // segment absent from this state
				expect(stringWidth(label)).toBeLessThanOrEqual(SEGMENT_CAP)
			}
		}
	})

	test("each language's all-on row stays under its pinned ceiling (idle + busy)", () => {
		const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
		const hints: FooterHints = { ...DEFAULT_FOOTER_HINTS }
		for (const language of Object.keys(ROW_CAPS)) {
			setLanguages(languages, language)
			expect(stringWidth(hintsText(false, true, true, hints))).toBeLessThanOrEqual(ROW_CAPS[language as keyof typeof ROW_CAPS])
			expect(stringWidth(hintsText(true, true, true, hints))).toBeLessThanOrEqual(BUSY_ROW_CAPS[language as keyof typeof BUSY_ROW_CAPS])
		}
		setLanguages(languages)
	})
})

describe("hint bar width folding (whole-segment priority collapse)", () => {
	// Width-fitted rendering: segments are taken high → low priority until the
	// next would overflow, then dropped WHOLE. These tests pin which segments
	// survive at 40 / 80 / 120 / 160 columns (the `-2` viewport margin is inside
	// hintsTextAtWidth). Golden strings are replaced by per-width presence /
	// absence assertions so a whole-segment drop is observable, not just a
	// string equality check on the widest row.
	const EN = {
		sendIdle: "enter send",
		sendBusy: "enter steer",
		newline: "alt+enter newline",
		history: "↑↓ history",
		stop: "esc stop",
		subagentPanel: "ctrl+g subagents panel",
		subagents: "↓ subagents",
		search: "ctrl+shift+f search",
		scroll: "pgup/pgdn scroll",
		quit: "ctrl+c ×2 quit",
	}
	const ZH = {
		sendIdle: "enter 发送",
		sendBusy: "enter 插话",
		newline: "alt+enter 换行",
		history: "↑↓ 历史",
		stop: "esc 停止",
		subagentPanel: "ctrl+g 子代理活动面板",
		subagents: "↓ 子代理",
		search: "ctrl+shift+f 搜索",
		scroll: "pgup/pgdn 滚动",
		quit: "ctrl+c ×2 退出",
	}

	let languages: Map<string, import("@dsh-opentui/i18n").LocaleTable>
	beforeAll(() => {
		languages = loadLocales({ bundledDir: bundledLocalesDir() }).languages
	})
	beforeEach(() => {
		setLanguages(languages, "en")
		setFooterHints({ ...DEFAULT_FOOTER_HINTS })
	})

	/** Assert a row shows exactly the wanted segments and never a half-cut one. */
	function expectSegments(row: string, present: string[], absent: string[], columns: number): void {
		for (const seg of present) expect(row).toContain(seg)
		for (const seg of absent) expect(row).not.toContain(seg)
		expect(stringWidth(row)).toBeLessThanOrEqual(columns - 2)
		expect(row).not.toContain("…") // folding drops whole segments; no mid-glyph cut
		expect(row.startsWith("⌨ ")).toBe(true)
	}

	test("priority table: core (send/stop/quit), then subagentPanel, then the optional tail", () => {
		expect(HINT_SEGMENT_PRIORITY.send).toBe(HINT_SEGMENT_PRIORITY.stop)
		expect(HINT_SEGMENT_PRIORITY.stop).toBe(HINT_SEGMENT_PRIORITY.quit)
		// ctrl+g is core-adjacent: above every optional segment, but strictly
		// after the core three so a 40-column bar keeps quit (display-order tie).
		for (const core of ["send", "stop", "quit"] as const) {
			expect(HINT_SEGMENT_PRIORITY[core]).toBeLessThan(HINT_SEGMENT_PRIORITY.subagentPanel)
			for (const optional of ["history", "newline", "subagents", "search", "scroll"] as const) {
				expect(HINT_SEGMENT_PRIORITY[core]).toBeLessThan(HINT_SEGMENT_PRIORITY[optional])
			}
		}
		expect(HINT_SEGMENT_PRIORITY.subagentPanel).toBeLessThan(HINT_SEGMENT_PRIORITY.history)
		expect(HINT_SEGMENT_PRIORITY.history).toBeLessThan(HINT_SEGMENT_PRIORITY.newline)
		expect(HINT_SEGMENT_PRIORITY.search).toBeLessThan(HINT_SEGMENT_PRIORITY.scroll)
	})

	test("en idle: which of send/newline/history/subagentPanel/search/scroll/quit survive per width", () => {
		const all = [EN.sendIdle, EN.newline, EN.history, EN.subagentPanel, EN.search, EN.scroll, EN.quit]
		const cases: { width: number; present: string[] }[] = [
			{ width: 40, present: [EN.sendIdle, EN.quit] },
			// ctrl+g now outranks newline: at 80 the panel survives beside quit,
			// and newline (the widest optional label) is the segment that yields.
			{ width: 80, present: [EN.sendIdle, EN.history, EN.subagentPanel, EN.quit] },
			{ width: 120, present: [EN.sendIdle, EN.newline, EN.history, EN.subagentPanel, EN.search, EN.quit] },
			{ width: 160, present: all },
		]
		for (const { width, present } of cases) {
			const row = hintsTextAtWidth(false, true, false, width, { ...DEFAULT_FOOTER_HINTS })
			expectSegments(row, present, all.filter((seg) => !present.includes(seg)), width)
		}
	})

	test("en busy: esc + ctrl+c survive 80 columns; search/scroll drop", () => {
		const all = [EN.sendBusy, EN.stop, EN.subagentPanel, EN.search, EN.scroll, EN.quit]
		const cases: { width: number; present: string[] }[] = [
			{ width: 40, present: [EN.sendBusy, EN.stop] },
			{ width: 80, present: [EN.sendBusy, EN.stop, EN.subagentPanel, EN.quit] },
			{ width: 120, present: all },
			{ width: 160, present: all },
		]
		for (const { width, present } of cases) {
			const row = hintsTextAtWidth(true, true, false, width, { ...DEFAULT_FOOTER_HINTS })
			expectSegments(row, present, all.filter((seg) => !present.includes(seg)), width)
		}
		// The core observable of the fix: esc stop and ctrl+c ×2 quit are both
		// still on an 80-column bar even though new low-tier segments were added.
		const at80 = hintsTextAtWidth(true, true, false, 80, { ...DEFAULT_FOOTER_HINTS })
		expect(at80).toContain(EN.stop)
		expect(at80).toContain(EN.quit)
	})

	test("zh-CN idle/busy fold on the same priorities (CJK columns)", () => {
		setLanguages(languages, "zh-CN")
		const idleAll = [ZH.sendIdle, ZH.newline, ZH.history, ZH.subagentPanel, ZH.search, ZH.scroll, ZH.quit]
		expectSegments(
			hintsTextAtWidth(false, true, false, 80, { ...DEFAULT_FOOTER_HINTS }),
			[ZH.sendIdle, ZH.history, ZH.subagentPanel, ZH.quit],
			[ZH.newline, ZH.search, ZH.scroll],
			80,
		)
		// 40 columns: the wide ctrl+g label yields to the core pair, so the
		// "leave" key stays reachable in zh as in en.
		expectSegments(
			hintsTextAtWidth(false, true, false, 40, { ...DEFAULT_FOOTER_HINTS }),
			[ZH.sendIdle, ZH.quit],
			[ZH.newline, ZH.history, ZH.subagentPanel, ZH.search, ZH.scroll],
			40,
		)
		expectSegments(hintsTextAtWidth(false, true, false, 160, { ...DEFAULT_FOOTER_HINTS }), idleAll, [], 160)
		const busyAt80 = hintsTextAtWidth(true, true, false, 80, { ...DEFAULT_FOOTER_HINTS })
		expectSegments(busyAt80, [ZH.sendBusy, ZH.stop, ZH.subagentPanel, ZH.quit], [ZH.search, ZH.scroll], 80)
		expect(busyAt80).toContain(ZH.stop)
		expect(busyAt80).toContain(ZH.quit)
		setLanguages(languages, "en")
	})

	test("160 columns: no folding — every present segment visible in both states", () => {
		// No single state renders all 9 at once (stop is busy-only, newline /
		// history idle-only), so "all 9" means: both states render their full
		// segment set unfolded, whose union covers the 9 ids.
		for (const busy of [false, true]) {
			const hints = { ...DEFAULT_FOOTER_HINTS }
			const full = hintsText(busy, true, true, hints)
			const fitted = hintsTextAtWidth(busy, true, true, 160, hints)
			expect(fitted).toBe(full)
			for (const id of FOOTER_HINT_IDS) {
				const label = hintLabel(id, busy)
				if (label) expect(fitted).toContain(label)
			}
		}
		const union = FOOTER_HINT_IDS.filter((id) => hintLabel(id, false) || hintLabel(id, true))
		expect(union.length).toBe(9)
	})

	test("survivors keep display order; folding never promotes a lower-priority segment", () => {
		for (const width of [40, 80, 120, 160]) {
			const row = hintsTextAtWidth(false, true, false, width, { ...DEFAULT_FOOTER_HINTS })
			// Display order from FOOTER_HINT_IDS: send < newline < history <
			// subagentPanel < search < scroll < quit (stop/subagents absent here).
			const order = [EN.sendIdle, EN.newline, EN.history, EN.subagentPanel, EN.search, EN.scroll, EN.quit]
			const indices = order.filter((seg) => row.includes(seg)).map((seg) => row.indexOf(seg))
			expect(indices).toEqual([...indices].sort((a, b) => a - b))
		}
	})

	test("extreme narrow falls back to a bounded clipToWidth hard-cut", () => {
		// At 9 columns (usable 8) not even `⌨ enter send` fits whole — the
		// function must fall back to the original bounded hard-cut, never
		// overflow. This is the only path that may emit an ellipsis.
		const row = hintsTextAtWidth(false, true, false, 9, { ...DEFAULT_FOOTER_HINTS })
		expect(stringWidth(row)).toBeLessThanOrEqual(8)
		expect(row).toContain("…")
	})

	test("all segments off / bar hidden still renders '' at any width", () => {
		const off: FooterHints = {
			send: false,
			newline: false,
			history: false,
			stop: false,
			subagentPanel: false,
			quit: false,
			scroll: false,
			search: false,
			subagents: false,
		}
		for (const width of [9, 40, 80, 160]) {
			expect(hintsTextAtWidth(false, true, false, width, off)).toBe("")
			expect(hintsTextAtWidth(false, false, false, width, { ...DEFAULT_FOOTER_HINTS })).toBe("")
		}
	})
})

describe("hint persistence (profile config replay — /motion parity)", () => {
	test("footerHintsFromConfig: partial record over defaults; junk → undefined", () => {
		expect(footerHintsFromConfig(undefined)).toBeUndefined()
		expect(footerHintsFromConfig("all on")).toBeUndefined()
		expect(footerHintsFromConfig([])).toBeUndefined()
		expect(footerHintsFromConfig({})).toBeUndefined() // nothing valid stored
		// unknown keys and non-boolean values ignored; missing keys keep on
		expect(footerHintsFromConfig({ scroll: false, banana: true, quit: "yes" })).toEqual({ ...DEFAULT_FOOTER_HINTS, scroll: false })
	})

	test("hintsLocaleFromConfig: canonical spellings only", () => {
		expect(hintsLocaleFromConfig("ja")).toBe("ja")
		expect(hintsLocaleFromConfig("zh-CN")).toBe("zh-CN")
		expect(hintsLocaleFromConfig("EN")).toBeUndefined() // stored values are canonical; replay does no case-fold
		expect(hintsLocaleFromConfig("fr")).toBeUndefined()
		expect(hintsLocaleFromConfig(42)).toBeUndefined()
	})

	test("applyHintsConfig replays both keys onto the module signals", () => {
		setFooterHints({ ...DEFAULT_FOOTER_HINTS })
		setHintsLocale("en")
		applyHintsConfig({ footerHints: { scroll: false, search: false }, hintsLocale: "ko" })
		expect(footerHints().scroll).toBe(false)
		expect(footerHints().search).toBe(false)
		expect(footerHints().send).toBe(true) // untouched keys keep the default
		expect(hintsLocale()).toBe("ko")
	})

	test("applyHintsConfig keeps defaults on missing/garbage keys and never throws", () => {
		setFooterHints({ ...DEFAULT_FOOTER_HINTS })
		setHintsLocale("en")
		applyHintsConfig(undefined)
		applyHintsConfig({})
		applyHintsConfig({ footerHints: 42, hintsLocale: "klingon" })
		expect(footerHints()).toEqual({ ...DEFAULT_FOOTER_HINTS })
		expect(hintsLocale()).toBe("en")
	})
})

describe("v2-entry remote snapshot hygiene (source shape — the entry is ts-nocheck)", () => {
	const source = readFileSync(join(import.meta.dir, "..", "examples", "v2-entry.tsx"), "utf8")

	test("a missing sessionInfo snapshot CLEARS remoteInfo instead of keeping the stale one", () => {
		expect(source).toMatch(/if \(!info\) \{\s*\n\s*setRemoteInfo\(undefined\)\s*\n\s*settleEffort\(\)\s*\n\s*return\s*\n\s*\}/)
		// the guard sits inside refreshFooterData's sessionInfo chain, before setRemoteInfo({...})
		expect(source.indexOf("if (!info) {")).toBeGreaterThan(source.indexOf("seam.sessionInfo?.()"))
		expect(source.indexOf("if (!info) {")).toBeLessThan(source.indexOf("setRemoteInfo({ messageCount"))
	})

	test("both effort sources settle before the default lands (review 3.3)", () => {
		// The two answers are aggregated: the seam's currentEffort AND the
		// sessionInfo label parse. Neither may decide on its own — the old code
		// painted effectiveEffort(undefined) = high as soon as the thinking
		// source answered and the label's explicit off never applied.
		expect(source).toMatch(/let effortSourcesPending = 2/)
		expect(source).toMatch(/if \(--effortSourcesPending > 0 \|\| seq !== footerRefreshSeq\) return/)
		expect(source).toMatch(/const decision = decideEffort\(currentEffortWord, labelEffortWord\)/)
		expect(source).toMatch(/setEffort\(decision\.display\)/)
		expect(source).toMatch(/labelEffortWord = effortFromModelLabel\(info\.model\)/)
		// Behavior half: only an unspecified level on a ladder that exposes high
		// writes the default route (defaultEffortToApply owns the precedence).
		expect(source).toMatch(/defaultEffortToApply\(decision\.explicit, ladder\.map\(\(entry\) => entry\.id\)\)/)
		// EFFORT_ICONS is no longer an explicitness test anywhere in the entry.
		expect(source).not.toMatch(/word in EFFORT_ICONS/)
	})

	test("a stale refresh is dropped by the ordinal guard before touching any signal", () => {
		expect(source).toMatch(/const seq = \+\+footerRefreshSeq/)
		// One guard per promise stage: both effort sources (then + catch), the
		// aggregate settle, the model selection, the session snapshot (then +
		// catch; the model read is the /model fix) and the nested
		// default-effort ladder read.
		expect(source.match(/seq !== footerRefreshSeq/g)?.length).toBe(7)
	})

	test("the footer ordinal can be invalidated without a re-read (review 3.5)", () => {
		// /think bumps the ordinal BEFORE the host accepts the pick, so a
		// pending default-effort write can never land after the user's choice.
		expect(source).toMatch(/invalidateFooter: \(\) => \{\s*\n\s*footerRefreshSeq\+\+\s*\n\s*\}/)
	})

	test("boot replays the persisted hint selection before the first paint", () => {
		expect(source).toContain("applyHintsConfig(seam.configLoad?.())")
		// replay sits in the boot section, after the motion tier replay
		expect(source.indexOf("applyHintsConfig(seam.configLoad?.())")).toBeGreaterThan(source.indexOf("setMotionTier("))
	})

	test("the brand preset label resolves like tui-pi and refreshes through the footer chain", () => {
		// formatPresetLabel semantics: the default row answers at boot, before
		// any session/create names the live preset (plain rows.find(id) showed
		// the plain "dsh" for the whole session).
		expect(source).toMatch(/setPresetLabel\(presetLabelFor\(rows, id\)\)/)
		// /preset lands through reload() (already wired) AND the first turn
		// creates the session, so the turn-end footer refresh re-reads the
		// label too instead of keeping the boot fallback. Tolerate intervening
		// statements in the effect body (e.g. the first-turn probe reset): the
		// contract is that both refresh calls run inside the !turnBusy guard.
		expect(source).toMatch(
			/createEffect\(\(\) => \{\s*\n\s*if \(!turnBusy\(\)\) \{[\s\S]*?refreshFooterData\(\)[\s\S]*?refreshPresetLabel\(\)/,
		)
		// A transient list/currentId failure keeps the last label instead of
		// flipping a known "dsh(<preset>)" back to the plain "dsh"; the next
		// refresh retries.
		expect(source).not.toMatch(/\.catch\(\(\) => setPresetLabel\(undefined\)\)/)
		expect(source).toMatch(/\.catch\(\(\) => \{\}\)/)
	})
})

describe("HintsLine zero-row gate (all-off collapses to 0 lines — tui-pi parity)", () => {
	const source = readFileSync(join(import.meta.dir, "..", "src", "routes", "session", "hints-line.tsx"), "utf8")

	test("the Show gate requires non-empty row text, not just hintsShown", () => {
		expect(source).toMatch(/<Show when=\{hintsShown\(\) && row\(\)\.length > 0\}>/)
	})
})
