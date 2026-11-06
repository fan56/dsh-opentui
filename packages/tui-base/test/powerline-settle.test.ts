/**
 * Batch F2: PowerlineFooter disappears at settle after a long turn.
 *
 * Live repro (tmux 120x34, default client path, 60-sentence turn): footer
 * present at boot and early-stream, GONE at settle (composer hints sit on
 * the last row); a resize does not bring it back -> layout overflow, not
 * paint. Mechanism (probed on the 0.8.1 test renderer): the footer is an
 * auto-height row; once the transcript content exceeds the viewport the
 * page column shrinks its shrinkable children and the footer row collapses
 * to 0 rows (making the transcript chain shrinkable does NOT help; pinning
 * the footer does). Fix: PowerlineFooter root box flexShrink: 0.
 *
 *  - red control: footer row WITHOUT flexShrink 0 is gone after a 250-row
 *    feed + status-row unmount (the settle transition);
 *  - fixed footer (flexShrink 0): painted on the last line at settle;
 *  - source guard: powerline.tsx keeps flexShrink: 0 on the root box.
 */
import { describe, expect, test } from "bun:test"
import { BoxRenderable, ScrollBoxRenderable, TextRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const WIDTH = 60
const HEIGHT = 24
const FEED_ROWS = 250
const FOOTER = "dsh powerline footer"

/** The page column: transcript chain (+dock slot), status row, footer row. */
const buildPage = (renderer: any, footerShrink: number | undefined) => {
	const root = new BoxRenderable(renderer, { width: WIDTH, height: HEIGHT, flexDirection: "column" })
	const tcol = new BoxRenderable(renderer, { flexDirection: "column", flexGrow: 1, minHeight: 0, width: "100%" })
	const trow = new BoxRenderable(renderer, { flexDirection: "row", flexGrow: 1, minHeight: 0 })
	const inner = new BoxRenderable(renderer, { flexGrow: 1, minHeight: 0, position: "relative", paddingBottom: 1 })
	const scroll = new ScrollBoxRenderable(renderer, {
		flexGrow: 1,
		overflow: "hidden",
		stickyScroll: true,
		stickyStart: "bottom",
	})
	inner.add(scroll)
	trow.add(inner)
	tcol.add(trow)
	const dockSlot = new BoxRenderable(renderer, { width: "100%", flexShrink: 0 })
	const dock = new BoxRenderable(renderer, { width: "100%", height: 3, border: true, flexShrink: 0 })
	dock.add(new TextRenderable(renderer, { content: "input placeholder" }))
	dockSlot.add(dock)
	tcol.add(dockSlot)
	root.add(tcol)
	const status = new BoxRenderable(renderer, { height: 1, flexGrow: 0 })
	status.add(new TextRenderable(renderer, { content: "Writing... 19s" }))
	root.add(status)
	const footer = new BoxRenderable(renderer, { flexDirection: "row", paddingLeft: 1, flexShrink: footerShrink })
	footer.add(new TextRenderable(renderer, { content: FOOTER }))
	root.add(footer)
	renderer.root.add(root)
	return { root, scroll, status }
}

const feed = (renderer: any, scroll: ScrollBoxRenderable) => {
	for (let i = 1; i <= FEED_ROWS; i++) {
		const row = new BoxRenderable(renderer, { marginTop: 1, flexShrink: 0 })
		row.add(new TextRenderable(renderer, { content: `payload row ${i}` }))
		scroll.add(row)
	}
}

/** Drive the settle transition: long feed while busy, then status unmount. */
const settle = async (footerShrink: number | undefined) => {
	const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width: WIDTH, height: HEIGHT })
	try {
		const page = buildPage(renderer, footerShrink)
		await renderOnce()
		const boot = captureCharFrame()
		feed(renderer, page.scroll)
		await renderOnce()
		page.root.remove(page.status) // busy -> idle: the StatusBar unmounts
		await renderOnce()
		await renderOnce()
		const settled = captureCharFrame()
		return { boot, settled }
	} finally {
		renderer.destroy()
	}
}

const lastLine = (frame: string) => frame.split("\n").filter((l) => l.trim() !== "").at(-1) ?? ""

describe("batch F2: powerline footer survives settle after a long turn", () => {
	test("red control: shrinkable footer row collapses at settle", async () => {
		const { boot, settled } = await settle(undefined)
		expect(boot).toContain(FOOTER)
		expect(settled).not.toContain(FOOTER)
	})

	test("fixed footer (flexShrink 0): painted on the last row at settle", async () => {
		const { boot, settled } = await settle(0)
		expect(boot).toContain(FOOTER)
		expect(settled).toContain(FOOTER)
		expect(lastLine(settled)).toContain(FOOTER)
		expect(settled).toContain("input placeholder")
	})

	test("source guard: PowerlineFooter root box keeps flexShrink: 0", () => {
		const src = readFileSync(join(import.meta.dir, "..", "src/routes/session/powerline.tsx"), "utf8")
		const body = src.slice(src.indexOf("export function PowerlineFooter"))
		expect(body).toMatch(/<box style=\{\{ flexDirection: "row", paddingLeft: 1, flexShrink: 0 \}\}>/)
	})
})
