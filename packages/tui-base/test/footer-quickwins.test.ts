/**
 * Footer-quickwins batch: the tui-pi parity footer pieces —
 *   - model segment's per-level effort glyph ladder (○◔◑◕●◉★, off = ○ off)
 *   - effortFromModelLabel: the sessionInfo().model label parse fallback
 *   - provider segment's ☁️ lead
 *   - tools / tps / durable-message wiring through sessionFooterSegments
 *   - the 8-segment hint bar: per-segment toggles, busy/idle state wording,
 *     the conditional ↓ subagents gate, and the en/zh golden label wording
 *     (T8 fold — the labels are `footer.hint.*` registry keys now).
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

describe("hint bar: 8 segments, en/zh golden wording (tui-pi FooterHints parity)", () => {
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

	test("en + zh-CN golden wording matches the folded table verbatim (design §5.6)", () => {
		// T8: the label language is the boot-fixed registry language, so the
		// golden check flips it via setLanguages (the hintsLocale signal is
		// persistence-only now). ja/ko are gone by contract §1 — no bundled
		// file, the boot chain degrades those picks to en.
		expect(hintsText(false)).toBe("⌨ enter send · alt+enter newline · ↑↓ history · ctrl+shift+f search · pgup/pgdn scroll · ctrl+c ×2 quit")
		setLanguages(languages, "zh-CN")
		expect(hintsText(false)).toBe("⌨ enter 发送 · alt+enter 换行 · ↑↓ 历史 · ctrl+shift+f 搜索 · pgup/pgdn 滚动 · ctrl+c ×2 退出")
		expect(hintsText(true)).toBe("⌨ enter 插话 · esc 停止 · ctrl+shift+f 搜索 · pgup/pgdn 滚动 · ctrl+c ×2 退出")
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
	// The row clips at viewport-width - 2 BY DESIGN (wrapMode="none" +
	// clipToWidth — tui-pi clips its 105-col regression row the same way),
	// so these caps pin the designed ceilings: wording growth must fail here
	// loudly instead of silently truncating mid-glyph on a narrow terminal.
	// T8: the ja/ko columns are gone with the typed table (contract §1 — no
	// bundled file; the boot chain degrades those picks to en).
	// 19 = the widest designed bundled label, en search "ctrl+shift+f search"
	// (19 ascii); one segment never eats more than ~¼ of the
	// common 80-column viewport's 78 usable columns.
	const SEGMENT_CAP = 19
	// All-on full-row ceilings measured at implementation (idle includes the
	// conditional ↓ subagents segment live; busy likewise). en idle (117) is
	// the global worst case — the designed maximum row.
	const ROW_CAPS = { en: 117, "zh-CN": 104 }
	const BUSY_ROW_CAPS = { en: 96, "zh-CN": 88 }

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
		// label too instead of keeping the boot fallback.
		expect(source).toMatch(
			/createEffect\(\(\) => \{\s*\n\s*if \(!turnBusy\(\)\) \{\s*\n\s*refreshFooterData\(\)\s*\n\s*refreshPresetLabel\(\)/,
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
