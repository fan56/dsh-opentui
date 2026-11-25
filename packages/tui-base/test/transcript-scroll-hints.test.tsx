/**
 * Transcript scrollbar / away-hint / pull-down pulse (user slice).
 *
 * Three layers of proof, all pinned BEFORE the vendored route (which stays
 * untouched):
 *  1. Pure kernel — geometry predicate, new-row count, pulse envelope;
 *  2. Real render — 80x24 / 120x40, away / back-at-bottom, new rows vs a
 *     streaming same-row edit, three motion tiers;
 *  3. Wiring shape — v2 entry scrollbar opt-in, passive listener with no
 *     stickyScroll write, independent alt+shift+end command without an editor
 *     gate, no resident timer.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { testRender } from "@opentui/solid"
import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { createBindingLookup } from "@opentui/keymap/extras"
import { applyI18nConfig, setLanguage, t } from "@dsh-opentui/i18n"
import { Keymap } from "../src/context/keymap"
import { TuiKeybind } from "../src/config/keybind"
import { Transcript } from "../src/routes/session/transcript"
import { TranscriptScrollKeys } from "../src/routes/session/transcript-scroll"
import { NullSessionSeam, type SeamTranscriptRow } from "../src/seams/session"
import { readSessionScrollbar, resolveSessionScrollbar } from "../src/seams/config"
import { setMotionTier, type MotionTier } from "../src/skin/motion"
import {
	awayFromBottom,
	keybindLabel,
	newMessageCopyKey,
	newMessageCount,
	pulseLevel,
	shouldPulse,
	HINT_PULSE_TOTAL_MS,
} from "../src/routes/session/transcript-scroll-hints"

const src = (file: string) => readFileSync(join(import.meta.dir, "..", file), "utf8")

// ---------------------------------------------------------------------------
// 1. Pure kernel
// ---------------------------------------------------------------------------

describe("away-hint pure kernel", () => {
	test("awayFromBottom: scrollTop + viewport.height < scrollHeight", () => {
		expect(awayFromBottom({ scrollTop: 10, viewportHeight: 10, scrollHeight: 30 })).toBe(true)
		expect(awayFromBottom({ scrollTop: 20, viewportHeight: 10, scrollHeight: 30 })).toBe(false)
		expect(awayFromBottom({ scrollTop: 19, viewportHeight: 10, scrollHeight: 30 })).toBe(true)
		// degenerate geometry is at-bottom
		expect(awayFromBottom({ scrollTop: 0, viewportHeight: 0, scrollHeight: 0 })).toBe(false)
		expect(awayFromBottom({ scrollTop: Number.NaN, viewportHeight: 10, scrollHeight: 30 })).toBe(false)
	})

	test("newMessageCount / shouldPulse: new ROWS only, never negative", () => {
		expect(newMessageCount(10, 7)).toBe(3)
		expect(newMessageCount(8, 7)).toBe(1)
		expect(newMessageCount(7, 7)).toBe(0)
		expect(newMessageCount(5, 7)).toBe(0)
		expect(shouldPulse(0, 0)).toBe(false)
		expect(shouldPulse(1, 1)).toBe(false) // streaming SAME row: no pulse
		expect(shouldPulse(1, 2)).toBe(true)
	})

		test("newMessageCopyKey: singular only at N=1", () => {
			expect(newMessageCopyKey(1)).toBe("transcript.scroll.newMessage")
			expect(newMessageCopyKey(2)).toBe("transcript.scroll.newMessages")
			expect(newMessageCopyKey(3)).toBe("transcript.scroll.newMessages")
			expect(newMessageCopyKey(0)).toBe("transcript.scroll.newMessages")
		})

		test("keybindLabel: hint chord is derived from the live keybind, not baked into copy", () => {
		const bound = TuiKeybind.defaultValue("session.scroll.to_bottom")
		expect(keybindLabel(bound)).toBe("alt+shift+end")
		expect(keybindLabel("ctrl+x,alt+shift+end")).toBe("ctrl+x")
		expect(keybindLabel(["ctrl+x", "alt+end"])).toBe("ctrl+x")
		expect(keybindLabel({ key: "alt+shift+end" })).toBe("alt+shift+end")
		expect(keybindLabel(false)).toBe("")
	})

	test("pulseLevel: two cycles inside 600ms, exactly zero outside", () => {
		expect(HINT_PULSE_TOTAL_MS).toBe(600)
		expect(pulseLevel(-1)).toBe(0)
		expect(pulseLevel(0)).toBe(0)
		expect(pulseLevel(150)).toBe(1) // first peak
		expect(pulseLevel(300)).toBe(0) // first cycle end
		expect(pulseLevel(450)).toBe(1) // second peak
		expect(pulseLevel(599)).toBeGreaterThan(0)
		expect(pulseLevel(600)).toBe(0)
		expect(pulseLevel(1200)).toBe(0)
		expect(pulseLevel(Number.NaN)).toBe(0)
		// Count contiguous NON-ZERO segments, not rising samples.
		// Old (wrong) criterion: `for (let ms = 1; ms < 600; ms++)
		//   if (pulseLevel(ms) > pulseLevel(ms - 1)) rising++; expect(rising).toBe(2)`
		// That counted every ascending millisecond of the two triangles (300
		// samples), not the two pulses. Keep the expected value (2) unchanged.
		let segments = 0
		let inSegment = false
		for (let ms = 0; ms <= HINT_PULSE_TOTAL_MS; ms++) {
			const nonzero = pulseLevel(ms) > 0
			if (nonzero && !inSegment) segments++
			inSegment = nonzero
		}
		expect(segments).toBe(2)
	})
})

// ---------------------------------------------------------------------------
// 2. i18n en / zh
// ---------------------------------------------------------------------------

describe("hint copy through i18n", () => {
	test("both locale tables carry singular/plural keys with {count} and {keys}", () => {
		const tableOf = (lang: string) =>
			JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "i18n", "locales", `${lang}.json`), "utf8"))
		for (const lang of ["en", "zh-CN"]) {
			const table = tableOf(lang)
			for (const key of ["transcript.scroll.newMessage", "transcript.scroll.newMessages"]) {
				expect(typeof table[key]).toBe("string")
				expect(table[key]).toContain("{count}")
				// no literal chord in copy — the label is injected from the keybind
				expect(table[key]).toContain("{keys}")
				expect(table[key]).not.toContain("alt+")
			}
			expect(typeof table["transcript.scroll.toLatest"]).toBe("string")
			expect(table["transcript.scroll.toLatest"]).toContain("{keys}")
		}
		const en = tableOf("en")
		expect(en["transcript.scroll.newMessage"]).toBe("↓ {count} new message ({keys})")
		expect(en["transcript.scroll.newMessages"]).toBe("↓ {count} new messages ({keys})")
		// zh-CN stays plural-agnostic: both keys carry the same unchanged copy.
		const zh = tableOf("zh-CN")
		expect(zh["transcript.scroll.newMessage"]).toBe(zh["transcript.scroll.newMessages"])
		expect(zh["transcript.scroll.newMessages"]).toBe("↓ {count} 条新消息 ({keys})")
	})

	test("t() replaces count in en and zh-CN, singular at N=1", () => {
		applyI18nConfig({ lang: "en" }) // boot-load the bundled tables
		setLanguage("en")
		const keys = keybindLabel(TuiKeybind.defaultValue("session.scroll.to_bottom"))
		expect(t(newMessageCopyKey(1), { count: 1, keys })).toBe("↓ 1 new message (alt+shift+end)")
		expect(t(newMessageCopyKey(3), { count: 3, keys })).toBe("↓ 3 new messages (alt+shift+end)")
		setLanguage("zh-CN")
		expect(t(newMessageCopyKey(1), { count: 1, keys })).toBe("↓ 1 条新消息 (alt+shift+end)")
		expect(t(newMessageCopyKey(3), { count: 3, keys })).toBe("↓ 3 条新消息 (alt+shift+end)")
		setLanguage("en")
	})
})

// ---------------------------------------------------------------------------
// 3. Wiring shape (source pins — no terminal needed)
// ---------------------------------------------------------------------------

describe("wiring shape", () => {
	test("v2 entry opts in from config (default true); component default stays off with a themed track", () => {
		const v2 = src("examples/v2-entry.tsx")
		// round7 AMEND: no hardcoded `scrollbar: true` — a getter resolves the
		// config faces read-only through the shared seam reader.
		expect(v2).toMatch(/createComponent\(Transcript, \{[\s\S]*?get scrollbar\(\) \{[\s\S]*?resolveSessionScrollbar\(/)
		expect(v2).toMatch(/resolveSessionScrollbar\(seam\.workspaceConfig\?\.\(\), seam\.configRaw\?\.\(\), seam\.configLoad\?\.\(\)\)/)
		expect(v2).not.toMatch(/scrollbar: true,/)
		const transcript = src("src/routes/session/transcript.tsx")
		expect(transcript).toMatch(/scrollbar\?: boolean/)
		expect(transcript).toMatch(/visible: props\.scrollbar \?\? false/)
		expect(transcript).toMatch(/trackOptions: \{[\s\S]*?backgroundColor: color\.background\(\)[\s\S]*?foregroundColor: color\.reasoningBorder\(\)/)
	})

	test("scrollbar config default / explicit false (pure resolve seam reader)", () => {
		// default when unconfigured, off when explicitly false — both legs are
		// exercised against the same helper the v2 getter calls at mount.
		expect(resolveSessionScrollbar()).toBe(true)
		expect(resolveSessionScrollbar({}, undefined, null)).toBe(true)
		expect(resolveSessionScrollbar({ theme: "blue", cacheHitMode: "session" })).toBe(true)
		expect(resolveSessionScrollbar({ session: { scrollbar: false } })).toBe(false)
		expect(resolveSessionScrollbar({ session: { scrollbar: true } })).toBe(true)
		expect(readSessionScrollbar({ session: { scrollbar: false } })).toBe(false)
	})

	test("user submit scrolls to bottom before projection.send", () => {
		const v2 = src("examples/v2-entry.tsx")
		const send = v2.match(/const send = \(text: string\) => \{[\s\S]*?\n\t\}/)?.[0] ?? ""
		expect(send).toContain("transcriptScroll?.scrollTo(Infinity)")
		expect(send.indexOf("scrollTo(Infinity)")).toBeLessThan(send.indexOf("projection.send(text)"))
		// passive paths never scroll: the only scrollTo in the user submit path
		// is the one above; streaming/appends own no scroll call here.
		expect([...send.matchAll(/scrollTo\(/g)].length).toBe(1)
	})

	test("passive scrollbar listener, no stickyScroll write, no resident timer", () => {
		const transcript = src("src/routes/session/transcript.tsx")
		expect(transcript).toMatch(/verticalScrollBar\.on\("change", syncAway\)/)
		expect(transcript).toMatch(/verticalScrollBar\.off\("change", syncAway\)/)
		expect(transcript).toMatch(/awayFromBottom\(\{[\s\S]*?scrollTop: scroll\.scrollTop[\s\S]*?viewportHeight: scroll\.viewport\.height[\s\S]*?scrollHeight: scroll\.scrollHeight/)
		// the new slice never writes the native follow flag (the single
		// occurrence is the JSX prop `stickyScroll={true}` on the scrollbox)
		expect([...transcript.matchAll(/stickyScroll\s*=/g)].length).toBe(1)
		expect(transcript).not.toMatch(/setTimeout|setInterval/)
		expect(transcript).toMatch(/onAnimationTick\(/)
		expect(transcript).toMatch(/pulseLevel\(Date\.now\(\) - pulseStartedAt\)/)
	})

	test("alt+shift+end is an independent command with no editor-focus gate", () => {
		expect(TuiKeybind.defaultValue("session.scroll.to_bottom")).toBe("alt+shift+end")
		const keys = src("src/routes/session/transcript-scroll.tsx")
		expect(keys).toMatch(/id: "session\.scroll\.to_bottom"/)
		expect(keys).toMatch(/scrollTo\(Infinity\)/)
		// exactly one CODE-level editor gate remains (session.first/last);
		// the docblock mentions the same predicate in prose, hence the
		// `renderer.`-qualified count.
		expect([...keys.matchAll(/renderer\.currentFocusedEditor/g)].length).toBe(1)
	})

	test("away hint is an in-flow reserved row, not an absolute overlay", () => {
		const transcript = src("src/routes/session/transcript.tsx")
		// No absolute positioning anywhere in the component.
		expect(transcript).not.toContain('position="absolute"')
		expect(transcript).not.toContain("bottom={0}")
		// The old paddingBottom=1 reserved row became a real column child.
		expect(transcript).not.toMatch(/flexGrow=\{1\} minHeight=\{0\} position="relative" paddingBottom=\{1\}/)
		expect(transcript).toMatch(/flexGrow=\{1\} minHeight=\{0\} flexDirection="column"/)
		const hint = transcript.match(/id="transcript-scroll-hint"[\s\S]*?<\/box>/)?.[0] ?? ""
		expect(hint).toMatch(/flexShrink=\{0\}/)
		expect(hint).toMatch(/height=\{1\}/)
		// E3: right-alignment comes from flex-end alone. No paddingRight, so the
		// text right edge sits 1 column in (the transcript's own border) instead
		// of 2 columns (border + padding).
		expect(hint).not.toMatch(/paddingRight/)
		expect(hint).toMatch(/flexDirection="row"/)
		expect(hint).toMatch(/justifyContent="flex-end"/)
		expect(hint).toMatch(/onMouseUp=\{toBottom\}/)
		expect(hint).not.toMatch(/position=|bottom=|left=|right=/)
		// Only the TEXT is conditional — the row itself is always mounted, so
		// the viewport budget never changes and no terminal row is added.
		expect(hint).toMatch(/<Show when=\{away\(\)\}>/)
	})

	test("overflow hidden on the scrollbox cannot clip the in-flow hint", () => {
		const transcript = src("src/routes/session/transcript.tsx")
		expect(transcript).toMatch(/<scrollbox[\s\S]*?overflow="hidden"/)
		// Sibling AFTER </scrollbox> — outside the clipped subtree entirely.
		const after = transcript.split("</scrollbox>")[1] ?? ""
		expect(after).toContain('id="transcript-scroll-hint"')
		expect(after).not.toContain('position="absolute"')
	})

	test("to-bottom hint chord comes from the live keymap, default only when unconfigured", () => {
		const transcript = src("src/routes/session/transcript.tsx")
		expect(transcript).toMatch(/const keymap = Keymap\.useOptional\(\)/)
		expect(transcript).toMatch(/keymap \? Keymap\.useShortcut\("session\.scroll\.to_bottom"\) : undefined/)
		expect(transcript).toMatch(/liveToBottomKeys\?\.\(\) \?\? keybindLabel\(TuiKeybind\.defaultValue\("session\.scroll\.to_bottom"\)\)/)
		// The singular/plural copy key is chosen by count, never baked into copy.
		expect(transcript).toMatch(/t\(newMessageCopyKey\(count\), \{ count, keys \}\)/)
	})

	test("vendored route untouched by this slice", () => {
		const vendored = src("src/routes/session/index.tsx")
		expect(vendored).not.toContain("transcript.scroll.newMessages")
		expect(vendored).not.toContain("session.scroll.to_bottom")
	})
})

// ---------------------------------------------------------------------------
// 4. Real render — sizes 80x24 / 120x40, away / return, new rows, motion tiers
// ---------------------------------------------------------------------------

class FeedSeam extends NullSessionSeam {
	constructor(private readonly feed: SeamTranscriptRow[]) {
		super()
	}
	override currentSessionId() {
		return "ses-hints"
	}
	override async storedTranscript(): Promise<SeamTranscriptRow[]> {
		return this.feed
	}
}

const SIZES = [
	{ width: 80, height: 24 },
	{ width: 120, height: 40 },
] as const

const keybindsConfig = (overrides: TuiKeybind.KeybindOverrides = {}) => ({
	keybinds: createBindingLookup(TuiKeybind.toBindingConfig(TuiKeybind.parse(overrides)), {
		bindingDefaults: TuiKeybind.bindingDefaults(),
	}),
	leader: { timeout: 2000 },
})

async function harness(
	size: { width: number; height: number },
	tier: MotionTier,
	keybindOverrides: TuiKeybind.KeybindOverrides = {},
) {
	applyI18nConfig({ lang: "en" }) // frame assertions use the pinned en copy
	setMotionTier(tier)
	setLanguage("en")
	const feed: SeamTranscriptRow[] = Array.from({ length: 30 }, (_, i) => ({
		kind: "assistant" as const,
		text: `line-${String(i + 1).padStart(2, "0")}`,
		final: true,
	}))
	const seam = new FeedSeam(feed)
	let scroll: ScrollBoxRenderable | undefined
	let editor: TextareaRenderable | undefined
	let enabled = true
	const setup = await testRender(
		() => (
			<Keymap.Provider config={keybindsConfig(keybindOverrides)}>
				<box width="100%" height="100%" flexDirection="column">
					<Transcript seam={seam} scrollbar={true} focused={() => false} scrollRef={(value) => (scroll = value)} />
					<TranscriptScrollKeys scroll={() => scroll} enabled={() => enabled} />
					<box width="100%" flexShrink={0} height={3}>
						<textarea placeholder="composer" height={3} width="100%" ref={(value) => (editor = value)} />
					</box>
				</box>
			</Keymap.Provider>
		),
		{ width: size.width, height: size.height, useMouse: false },
	)
	const frame = () => setup.captureCharFrame()
	for (let i = 0; i < 40; i++) {
		await setup.renderOnce()
		if (frame().includes("line-30")) break
		await Bun.sleep(20)
	}
	if (!frame().includes("line-30")) throw new Error(`harness ${size.width}x${size.height}: feed never painted`)
	const press = async (key: string, modifiers?: { meta?: boolean; shift?: boolean; ctrl?: boolean }) => {
		setup.mockInput.pressKey(key, modifiers)
		await Bun.sleep(30)
		await setup.renderOnce()
	}
	return {
		setup,
		seam,
		frame,
		press,
		scroll: () => scroll!,
		max: () => Math.max(0, scroll!.scrollHeight - scroll!.viewport.height),
		focusEditor: () => editor?.focus(),
		/** Mirrors the v2-entry `send()` order pinned above: the user submit
		 * returns to the bottom BEFORE the projection receives the text. */
		submit: async () => {
			scroll!.scrollTo(Infinity)
			await setup.renderOnce()
		},
		setEnabled: (value: boolean) => {
			enabled = value
		},
		async dispose() {
			await setup.dispose()
			setMotionTier(undefined)
			setLanguage("en")
		},
		async [Symbol.asyncDispose]() {
			await this.dispose()
		},
	}
}

describe("away hint real render", () => {
	for (const size of SIZES) {
		test(`${size.width}x${size.height}: hint right-aligned while away, gone at bottom`, async () => {
			await using h = await harness(size, "full")
			expect(h.frame()).not.toContain("new messages")
			expect(h.frame()).not.toContain("Jump to latest")
			h.scroll().scrollBy(-1, "viewport")
			await h.setup.renderOnce()
			expect(h.scroll().scrollTop).toBeLessThan(h.max())
			expect(h.frame()).toMatch(/↓ (Jump to latest|\d+ new messages)/)

			h.scroll().scrollTo(Infinity)
			await h.setup.renderOnce()
			expect(h.scroll().scrollTop).toBe(h.max())
			expect(h.frame()).not.toContain("new messages")
			expect(h.frame()).not.toContain("Jump to latest")
		})

		test(`${size.width}x${size.height}: in-flow hint row is fixed and visible below the feed`, async () => {
			await using h = await harness(size, "full")
			const rows = () => h.frame().split("\n")
			const rowOf = (needle: string) => rows().findIndex((line) => line.includes(needle))

			h.focusEditor()
			await h.press("z")
			await h.press("z")
			const composerRow = rowOf("zz")
			expect(composerRow).toBeGreaterThan(-1)

			const viewportAtBottom = h.scroll().viewport.height
			const scrollHeightAtBottom = h.scroll().scrollHeight
			const lineCount = rows().length

			h.scroll().scrollBy(-1, "viewport")
			await h.setup.renderOnce()
			expect(h.scroll().scrollTop).toBeLessThan(h.max())

			// The reserved row is always in flow: no layout shift when the text
			// appears, no new terminal row, composer stays on the same row.
			expect(h.scroll().viewport.height).toBe(viewportAtBottom)
			expect(h.scroll().scrollHeight).toBe(scrollHeightAtBottom)
			expect(rowOf("zz")).toBe(composerRow)
			expect(rows().length).toBe(lineCount)

			// Hint paints in that reserved row: above the composer, visible
			// despite the scrollbox's overflow="hidden" clipping the feed.
			const hintRow = rowOf("Jump to latest")
			expect(hintRow).toBeGreaterThan(0)
			expect(hintRow).toBeLessThan(composerRow)
			expect(composerRow - hintRow).toBeLessThanOrEqual(2) // +1 frame bottom border on tall terminals
			expect(rows()[hintRow]).toContain("↓")
		})
	}

		test("away → user submit → scrollTop=max and hint disappears", async () => {
			await using h = await harness(SIZES[0], "full")
			h.scroll().scrollBy(-1, "viewport")
			await h.setup.renderOnce()
			expect(h.scroll().scrollTop).toBeLessThan(h.max())
			expect(h.frame()).toMatch(/↓ (Jump to latest|\d+ new messages)/)

			await h.submit()
			expect(h.scroll().scrollTop).toBe(h.max())
			expect(h.frame()).not.toContain("new messages")
			expect(h.frame()).not.toContain("Jump to latest")
		})

		test("new rows grow N; a same-row streaming edit does not", async () => {
		await using h = await harness(SIZES[1], "full")
		h.scroll().scrollBy(-1, "viewport")
		await h.setup.renderOnce()
		expect(h.frame()).toContain("Jump to latest")

		h.seam.emit({ type: "message.updated", details: { role: "notice", id: "extra-1", text: "brand new row" } })
		await h.setup.renderOnce()
		// The chord comes from the LIVE keymap, which canonicalizes modifier
		// order as shift+alt+end (the shipped default string is alt+shift+end).
		expect(h.frame()).toContain("↓ 1 new message (shift+alt+end)")
		expect(h.frame()).not.toContain("1 new messages")

		// Same key, new text: the row is updated in place, count stays 1.
		h.seam.emit({ type: "message.updated", details: { role: "notice", id: "extra-1", text: "brand new row streamed" } })
		await h.setup.renderOnce()
		expect(h.frame()).not.toContain("↓ 2 new messages")
	})

	for (const tier of ["full", "reduced", "off"] as const) {
		test(`motion ${tier}: hint renders; pulse registration follows the tier`, async () => {
			await using h = await harness(SIZES[0], tier)
			h.scroll().scrollBy(-1, "viewport")
			await h.setup.renderOnce()
			expect(h.frame()).toMatch(/↓ (Jump to latest|\d+ new messages)/)
			// off/reduced never start a wall-clock pulse; full may. The pure
			// envelope and the static color fallback are pinned above.
			const transcript = src("src/routes/session/transcript.tsx")
			expect(transcript).toMatch(/motionDecorationsEnabled\(\) && pulseStartedAt !== undefined/)
			expect(transcript).toMatch(/motionAnimationRunning\(\) \? motionFrameRate\(\)/)
		})
	}

	test("alt+shift+end returns to bottom even while the composer owns focus", async () => {
		await using h = await harness(SIZES[1], "full")
		h.focusEditor()
		await h.press("h")
		await h.press("i")
		expect(h.frame()).toContain("hi")
		h.scroll().scrollBy(-1, "viewport")
		await h.setup.renderOnce()
		expect(h.scroll().scrollTop).toBeLessThan(h.max())

		// mockInput cannot encode a MODIFIED named key from its name:
		// pressKey("end", {meta:true}) emits ESC + literal "end" (parsed as
		// alt+e, n, d). Feed the raw CSI END sequence so the mock applies the
		// modifier bits: "\x1B[1;4F" => end + meta(alt) + shift.
		await h.press("\x1B[F", { meta: true, shift: true }) // alt+shift+end
		expect(h.scroll().scrollTop).toBe(h.max())
		expect(h.frame()).not.toContain("Jump to latest")
	})

	test("remapped to_bottom chord drives both the hint label and the live command", async () => {
		await using h = await harness(SIZES[0], "full", { "session.scroll.to_bottom": "ctrl+shift+end" })
		h.scroll().scrollBy(-1, "viewport")
		await h.setup.renderOnce()
		const away = h.frame()
		expect(away).toContain("Jump to latest")
		// The hint shows the REMAPPED chord, not the shipped default definition.
		expect(away).toContain("ctrl+shift+end")
		expect(away).not.toContain("alt+shift+end")
		// The same remapped chord is the one the keymap actually dispatches:
		// ctrl+shift+end = CSI 1;6 F (modifier 6 = shift(1) + ctrl(4)).
		await h.press("\x1B[1;6F")
		expect(h.scroll().scrollTop).toBe(h.max())
		expect(h.frame()).not.toContain("Jump to latest")
	})
})
