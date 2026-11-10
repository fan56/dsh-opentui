/**
 * Pane focus (focus batch): the focus truth source, the key-layer gates, the
 * transcript frame form, and the search-close sticky restore.
 *
 * The focus model is pinned twice:
 *   1. pure classification — `paneForFocused` walks the renderable parent
 *      chain (composer textarea / transcript scrollbox / neither);
 *   2. a REAL render pin — the Transcript on @opentui's test renderer paints
 *      the heavy accent frame while focused and the single frame otherwise,
 *      and at ≤30 rows keeps its left/right rules without spending a row on
 *      top/bottom.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createSignal } from "solid-js"
import { createComponent, testRender } from "@opentui/solid"
import type { Renderable } from "@opentui/core"
import {
	paneForFocused,
	paneToggleEnabled,
	transcriptKeysEnabled,
} from "../src/routes/session/pane-focus"
import { transcriptBorderSides, transcriptFrame } from "../src/skin/semantic"
import { Transcript } from "../src/routes/session/transcript"
import { NullSessionSeam } from "../src/seams/session"
import { createStickyScrollGuard } from "../src/routes/session/search-overlay"
import { transcriptHintsText } from "../src/routes/session/hints-line"

describe("pane classification (renderer focus is the truth source)", () => {
	test("composer textarea → composer, transcript descendants → transcript, dialogs → neither", () => {
		const root = { parent: null } as unknown as Renderable
		const transcript = { parent: root } as unknown as Renderable
		const transcriptText = { parent: transcript } as unknown as Renderable
		const composer = { parent: root } as unknown as Renderable
		const dialogInput = { parent: { parent: null } } as unknown as Renderable
		const nodes = { transcript: () => transcript, composer: () => composer }

		expect(paneForFocused(composer, nodes)).toBe("composer")
		expect(paneForFocused(transcript, nodes)).toBe("transcript")
		expect(paneForFocused(transcriptText, nodes)).toBe("transcript")
		expect(paneForFocused(dialogInput, nodes)).toBeUndefined()
		expect(paneForFocused(null, nodes)).toBeUndefined()
	})

	test("unpublished pane nodes (pre-mount / teardown) classify as neither", () => {
		const node = { parent: null } as unknown as Renderable
		expect(paneForFocused(node, {})).toBeUndefined()
		expect(paneForFocused(node, { transcript: () => undefined, composer: () => undefined })).toBeUndefined()
	})
})

describe("key-layer gates (overlays never lose their keys)", () => {
	const base = { pane: "composer" as const, keysEnabled: true, slashOpen: false, pickerOpen: false }

	test("F6 toggles only in a pane with no dialog/slash menu/subagent picker", () => {
		expect(paneToggleEnabled(base)).toBe(true)
		expect(paneToggleEnabled({ ...base, pane: "transcript" })).toBe(true)
		expect(paneToggleEnabled({ ...base, pane: undefined })).toBe(false)
		expect(paneToggleEnabled({ ...base, keysEnabled: false })).toBe(false)
		expect(paneToggleEnabled({ ...base, slashOpen: true })).toBe(false)
		expect(paneToggleEnabled({ ...base, pickerOpen: true })).toBe(false)
	})

	test("transcript scroll keys run only while the transcript is focused and no overlay is open", () => {
		expect(transcriptKeysEnabled({ pane: "transcript", keysEnabled: true })).toBe(true)
		expect(transcriptKeysEnabled({ pane: "composer", keysEnabled: true })).toBe(false)
		expect(transcriptKeysEnabled({ pane: undefined, keysEnabled: true })).toBe(false)
		expect(transcriptKeysEnabled({ pane: "transcript", keysEnabled: false })).toBe(false)
	})
})

describe("transcript frame vocabulary (skin/semantic)", () => {
	const theme = {
		border: { base: "#101010" },
		hue: { interactive: { 500: "#202020" } },
		text: { faint: "#303030" },
	} as never

	test("focus swaps weight + color; the title follows the border", () => {
		const focused = transcriptFrame({ focused: true, terminalRows: 40, theme })
		expect(focused.borderStyle).toBe("heavy")
		expect(focused.borderColor).toBe("#202020")
		expect(focused.title).toBe(" transcript ")
		expect(focused.titleColor).toBe("#202020")

		const unfocused = transcriptFrame({ focused: false, terminalRows: 40, theme })
		expect(unfocused.borderStyle).toBe("single")
		expect(unfocused.borderColor).toBe("#101010")
		expect(unfocused.title).toBe(" transcript ")
		expect(unfocused.titleColor).toBe("#303030")
	})

	test("≤30 rows draws left/right only and suppresses the title (no extra rows)", () => {
		expect(transcriptBorderSides(30)).toEqual(["left", "right"])
		expect(transcriptBorderSides(24)).toEqual(["left", "right"])
		expect(transcriptBorderSides(31)).toEqual(["top", "bottom", "left", "right"])
		const compact = transcriptFrame({ focused: true, terminalRows: 24, theme })
		expect(compact.border).toEqual(["left", "right"])
		expect(compact.title).toBeUndefined()
	})
})

describe("transcript frame on the real renderer", () => {
	test("focused transcript paints the heavy frame; unfocused paints the single frame", async () => {
		const [focused, setFocused] = createSignal(false)
		const setup = await testRender(
			() =>
				createComponent(Transcript, {
					seam: new NullSessionSeam(),
					focused: () => focused(),
				}),
			{ width: 100, height: 40, useMouse: true },
		)
		try {
			await setup.renderOnce()
			const off = setup.captureCharFrame()
			expect(off).toContain(" transcript ")
			expect(off).toMatch(/┌[─]+ transcript /)

			setFocused(true)
			await setup.renderOnce()
			const on = setup.captureCharFrame()
			expect(on).toMatch(/┏[━]+ transcript /)
			expect(on).not.toMatch(/┌[─]+ transcript /)
		} finally {
			await setup.dispose()
		}
	})

	test("≤30 rows: the focused frame adds no top row (left/right rules only)", async () => {
		const setup = await testRender(
			() =>
				createComponent(Transcript, {
					seam: new NullSessionSeam(),
					focused: () => true,
				}),
			{ width: 80, height: 24, useMouse: true },
		)
		try {
			await setup.renderOnce()
			const frame = setup.captureCharFrame()
			// No top/bottom border rows at this height...
			expect(frame).not.toContain("┏")
			expect(frame).not.toContain(" transcript ")
			// ...but the vertical rules still paint (heavy, because focused).
			expect(frame.split("\n").some((line) => line.startsWith("┃"))).toBe(true)
		} finally {
			await setup.dispose()
		}
	})
})

describe("search close restores sticky follow", () => {
	test("suspend records the pre-search value once; restore puts it back", () => {
		const box = { stickyScroll: true }
		const guard = createStickyScrollGuard(() => box)
		guard.suspend()
		expect(box.stickyScroll).toBe(false)
		guard.suspend() // a second jump must not record `false` as the saved value
		expect(box.stickyScroll).toBe(false)
		guard.restore()
		expect(box.stickyScroll).toBe(true)
	})

	test("a reader already scrolled away keeps follow off after close", () => {
		const box = { stickyScroll: false }
		const guard = createStickyScrollGuard(() => box)
		guard.suspend()
		guard.restore()
		expect(box.stickyScroll).toBe(false)
	})
})

describe("wiring source guards", () => {
	const src = (file: string) => readFileSync(join(import.meta.dir, "..", file), "utf8")

	test("v2-entry mounts the pane layers, feeds the frame + hints, and enables mouse", () => {
		const entry = src("examples/v2-entry.tsx")
		expect(entry).toContain("createPaneFocus({")
		expect(entry).toContain("createComponent(PaneFocusKeys, {")
		expect(entry).toMatch(/focused: paneFocus\.transcriptFocused/)
		expect(entry).toMatch(/pane: paneFocus\.pane,/)
		expect(entry).toMatch(/slashOpen: \(\) => slash\.controller\.open/)
		expect(entry).toContain("pickerOpen: subagentsPickerOpen")
		expect(entry).toMatch(/\{ useMouse: true, exitOnCtrlC: false \}/)
	})

	test("session.tsx bench carries the same pane wiring", () => {
		const entry = src("examples/session.tsx")
		expect(entry).toContain("createPaneFocus({")
		expect(entry).toContain("<PaneFocusKeys")
		expect(entry).toMatch(/focused=\{paneFocus\.transcriptFocused\}/)
		expect(entry).toMatch(/useMouse: true/)
	})

	test("search overlay restores sticky follow on close (not just on jump)", () => {
		const overlay = src("src/routes/session/search-overlay.tsx")
		expect(overlay).toContain("const sticky = createStickyScrollGuard")
		expect(overlay).toContain("sticky.suspend()")
		expect(overlay).toContain("sticky.restore()")
	})

	test("runtime engine enables mouse reporting and keeps autoFocus", () => {
		const engine = join(import.meta.dir, "..", "..", "runtime", "src", "engine.ts")
		const source = readFileSync(engine, "utf8")
		expect(source).toMatch(/autoFocus: true/)
		expect(source).toMatch(/useMouse: true/)
	})
})

describe("transcript hint row (4 locales)", () => {
	test("each locale has wording; the master toggle zeroes the row", () => {
		for (const locale of ["en", "zh-CN", "ja", "ko"] as const) {
			const text = transcriptHintsText(true, locale)
			expect(text.startsWith("⌨ ")).toBe(true)
			expect(text).toContain("f6")
		}
		expect(transcriptHintsText(false)).toBe("")
		expect(transcriptHintsText(true, "en")).toContain("↑↓ scroll")
		expect(transcriptHintsText(true, "zh-CN")).toContain("↑↓ 滚动")
	})
})
