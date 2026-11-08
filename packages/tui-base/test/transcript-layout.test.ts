/**
 * Batch 11: transcript layout tear regression.
 *
 * The tear signature (missing rows / reply text painted over the composer
 * dock) is flexbox layout: under overflow the transcript box paints its
 * tail past the container edge — tail rows go missing and, without
 * clipping, content bleeds over the dock. Verified fix in transcript.tsx:
 *   - every row wrapper carries flexShrink={0} (rows never shrink);
 *   - the transcript scroll container carries overflow="hidden"
 *     (stickyScroll still owns vertical scrolling — the clip only guards
 *     paint overflow).
 *
 * Verified against the pinned @opentui 0.8.1 test renderer, mirroring
 * transcript-scroll.test.ts (real behavior + source shape). The renderer's
 * deterministic manifestation of the unfixed layout: a 250-row feed loses
 * the tail (last painted row < 250, dock pushed clean only by sibling
 * overwrite); with the fix the tail is complete through row 250 and the
 * dock region is intact in the painted frame:
 *  - red control: window shape (plain flex column + dock slot) WITHOUT the
 *    fix loses tail rows (the assertion has teeth);
 *  - fixed window shape: tail complete, dock intact;
 *  - fixed transcript chain (row > flexGrow col > scrollbox + dock slot):
 *    250-row feed paints the tail, dock region clean, sticky bottom follow
 *    intact.
 */
import { describe, expect, test } from "bun:test"
import { BoxRenderable, ScrollBoxRenderable, TextRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const src = (file: string) => readFileSync(join(import.meta.dir, "..", file), "utf8")

const WIDTH = 60
const HEIGHT = 24
const FEED_ROWS = 250

/** bleed-analyze rules over a painted frame's dock region (from the input
 * box's top border to the end of the frame). */
const dockSigns = (frame: string) => {
	const lines = frame.split("\n")
	const top = lines.findIndex((l) => l.startsWith("┌") || l.startsWith("╭"))
	if (top < 0) return { region: [], signs: ["dock-top-border-missing"] }
	const region = lines.slice(top)
	const signs: string[] = []
	if (!region.some((l) => l.includes("input placeholder"))) signs.push("placeholder-gone")
	if (!region.some((l) => l.includes("help commands"))) signs.push("hints-gone")
	if (!region.some((l) => /^[└╰]/.test(l))) signs.push("dock-bottom-border-missing")
	for (const l of region) {
		if (/deterministic|payload/.test(l)) signs.push("payload-in-dock: " + JSON.stringify(l))
		if (/[╭╰╮╯└┘]/.test(l) && /\d/.test(l)) signs.push("digit-in-border: " + JSON.stringify(l))
	}
	return { region, signs }
}

/** The window shape (plain flex column transcript + bottom dock slot). */
const buildWindow = (renderer: any, opts: { rowFlexShrink?: number; overflow?: "hidden" }) => {
	const root = new BoxRenderable(renderer, { width: WIDTH, height: HEIGHT, flexDirection: "column" })
	const transcript = new BoxRenderable(renderer, {
		flexDirection: "column",
		flexGrow: 1,
		justifyContent: "flex-end",
		overflow: opts.overflow,
		minHeight: 0,
	})
	const rows: TextRenderable[] = []
	for (let i = 1; i <= FEED_ROWS; i++) {
		const row = new TextRenderable(renderer, {
			content: `deterministic payload row ${i}`,
			width: "auto",
			flexShrink: opts.rowFlexShrink,
		})
		transcript.add(row)
		rows.push(row)
	}
	// bottom slot: flexShrink=0, explicit height (input box + hints inside)
	const dockSlot = new BoxRenderable(renderer, { width: "100%", flexShrink: 0 })
	const dock = new BoxRenderable(renderer, { width: "100%", height: 3, border: true, flexShrink: 0 })
	dock.add(new TextRenderable(renderer, { content: "❯ input placeholder (fixed dock)" }))
	dockSlot.add(dock)
	dockSlot.add(new TextRenderable(renderer, { content: "help commands · ctrl+c quit" }))
	root.add(transcript)
	root.add(dockSlot)
	return { root, transcript, rows }
}

/** The transcript.tsx box chain, in raw core renderables. */
const buildChain = (renderer: any) => {
	const root = new BoxRenderable(renderer, { width: WIDTH, height: HEIGHT, flexDirection: "column" })
	// session route shape: row > flexGrow col (position relative) > scrollbox
	const rowBox = new BoxRenderable(renderer, { flexDirection: "row", flexGrow: 1, minHeight: 0 })
	const col = new BoxRenderable(renderer, { flexGrow: 1, minHeight: 0, position: "relative", paddingBottom: 1 })
	const scroll = new ScrollBoxRenderable(renderer, {
		flexGrow: 1,
		overflow: "hidden",
		stickyScroll: true,
		stickyStart: "bottom",
		scrollY: true,
	})
	col.add(scroll)
	rowBox.add(col)
	root.add(rowBox)
	// bottom slot: flexShrink=0, composer sets an explicit height
	const dockSlot = new BoxRenderable(renderer, { width: "100%", flexShrink: 0 })
	const dock = new BoxRenderable(renderer, { width: "100%", height: 3, border: true, flexShrink: 0 })
	dock.add(new TextRenderable(renderer, { content: "❯ input placeholder (fixed dock)" }))
	dockSlot.add(dock)
	dockSlot.add(new TextRenderable(renderer, { content: "help commands · ctrl+c quit" }))
	root.add(dockSlot)

	const rows: BoxRenderable[] = []
	for (let i = 1; i <= FEED_ROWS; i++) {
		const row = new BoxRenderable(renderer, { marginTop: 1, flexShrink: 0 })
		row.add(new TextRenderable(renderer, { content: `deterministic payload row ${i}`, width: "auto" }))
		scroll.add(row)
		rows.push(row)
	}
	return { root, scroll, rows }
}

describe("transcript layout: rows never shrink, dock never bleeds (@opentui 0.8.1)", () => {
	test("red control — window shape without the fix: overflow feed loses the tail", async () => {
		await using setup = await createTestRenderer({ width: WIDTH, height: HEIGHT, useMouse: false })
		const { renderer, flush } = setup
		const { root } = buildWindow(renderer, {})
		renderer.root.add(root)
		await flush()
		const frame = setup.captureCharFrame()
		// the missing-rows signature: the tail of the feed never paints
		expect(frame).not.toContain(`payload row ${FEED_ROWS}`)
	})

	test("window shape fixed — tail complete, dock intact in the painted frame", async () => {
		await using setup = await createTestRenderer({ width: WIDTH, height: HEIGHT, useMouse: false })
		const { renderer, flush } = setup
		const { root, rows } = buildWindow(renderer, { rowFlexShrink: 0, overflow: "hidden" })
		renderer.root.add(root)
		await flush()
		// rows never shrink to zero height
		for (const row of rows) expect(row.height).toBeGreaterThan(0)
		const frame = setup.captureCharFrame()
		// the tail paints through the last fed row
		expect(frame).toContain(`payload row ${FEED_ROWS}`)
		const { signs } = dockSigns(frame)
		expect(signs).toEqual([])
	})

	test("transcript chain fixed — 250-row feed: tail painted, dock clean, sticky bottom holds", async () => {
		await using setup = await createTestRenderer({ width: WIDTH, height: HEIGHT, useMouse: false })
		const { renderer, flush } = setup
		const { root, scroll, rows } = buildChain(renderer)
		renderer.root.add(root)
		await flush()

		// (a) rows never shrink after the overflow feed
		for (const row of rows) expect(row.height).toBeGreaterThan(0)

		// stickyScroll still owns vertical scrolling: pinned at the bottom
		const maxScroll = () => Math.max(0, scroll.scrollHeight - scroll.viewport.height)
		expect(scroll.scrollTop).toBe(maxScroll())

		// (b) dock region intact in the PAINTED frame
		const frame = setup.captureCharFrame()
		expect(frame).toContain(`payload row ${FEED_ROWS}`)
		const { signs } = dockSigns(frame)
		expect(signs).toEqual([])
	})
})

describe("transcript layout source shape (transcript.tsx carries the fix)", () => {
	test("scroll container clips paint overflow; stickyScroll untouched", () => {
		const source = src("src/routes/session/transcript.tsx")
		// the scrollbox itself carries the clip (not a wrapper)
		expect(source).toMatch(/<scrollbox[\s\S]*?overflow="hidden"[\s\S]*?stickyScroll=\{true\}/)
		// stickyScroll semantics unchanged (S1's scroll tests stay authoritative)
		expect(source).toMatch(/stickyStart="bottom"/)
	})

	test("every row wrapper carries flexShrink={0} — rows never shrink", () => {
		const source = src("src/routes/session/transcript.tsx")
		// the keyed row wrapper in the <For>
		expect(source).toMatch(/<box id=\{`seam-row-\$\{row\.key\}`\} marginTop=\{1\} flexShrink=\{0\}>/)
		// user rows + the keyed wrapper + the hydration box + the bottom slot
		// (batch D2: the subagent tree box moved to the lastRequest dock —
		// one flexShrink={0} box left the transcript with it)
		const rowBoxes = source.match(/<box[^>]*flexShrink=\{0\}[^>]*>/g) ?? []
		expect(rowBoxes.length).toBeGreaterThanOrEqual(4)
		// no row-rendering box is left without flexShrink
		const rowView = source.slice(source.indexOf("const rowView"), source.indexOf("onCleanup"))
		for (const m of rowView.matchAll(/<box(?![^>]*flexShrink)/g)) {
			throw new Error(`row box without flexShrink={0}: ${m[0]}`)
		}
	})
})
