/**
 * Batch 10f: transcript scrollback. Two layers:
 *
 * 1. REAL behavior — the native ScrollBoxRenderable semantics the wiring
 *    relies on, against the pinned @opentui 0.8.1 (probed live before the
 *    wiring was written; this pins the contract so an upstream drift fails
 *    here instead of in a terminal):
 *      - stickyScroll + stickyStart="bottom" follows appends at the bottom;
 *      - a scroll-up KEEPS its position through new appends (native unpin,
 *        no flag toggling needed);
 *      - scrolling back to the bottom re-engages follow;
 *      - scrollBy(±1, "viewport") steps one full viewport (the page unit).
 * 2. Wiring shape — the scroll keys ride the vendored route's keymap
 *    vocabulary (session.page.up/down, mode "global", dialog-stack gate)
 *    and the mouse flip is present on the render paths.
 */
import { describe, expect, test } from "bun:test"
import { BoxRenderable, ScrollBoxRenderable, TextRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { TuiKeybind } from "../src/config/keybind"

const src = (file: string) => readFileSync(join(import.meta.dir, "..", file), "utf8")

describe("transcript scroll native semantics (@opentui 0.8.1 contract)", () => {
	test("stickyScroll follows at the bottom, scroll-up keeps position through appends, bottom re-engages", async () => {
		await using setup = await createTestRenderer({ width: 40, height: 12, useMouse: false })
		const { renderer, flush } = setup

		const box = new BoxRenderable(renderer, { width: 40, height: 12, flexDirection: "column" })
		renderer.root.add(box)
		const scroll = new ScrollBoxRenderable(renderer, {
			width: 40,
			height: 10,
			stickyScroll: true,
			stickyStart: "bottom",
			scrollY: true,
		})
		box.add(scroll)

		let counter = 0
		const addRows = (n: number) => {
			for (let i = 0; i < n; i++) {
				counter++
				scroll.add(new TextRenderable(renderer, { content: `row ${counter}`, width: "auto" }))
			}
		}
		const maxScroll = () => Math.max(0, scroll.scrollHeight - scroll.viewport.height)

		addRows(50)
		await flush()
		expect(scroll.scrollTop).toBe(maxScroll()) // pinned at the bottom

		// PgUp: one full viewport up
		const viewport = scroll.viewport.height
		scroll.scrollBy(-1, "viewport")
		await flush()
		const awayPosition = scroll.scrollTop
		expect(awayPosition).toBeCloseTo(maxScroll() - viewport)

		// new rows arrive mid-stream (the turn keeps streaming): the reader's
		// position is KEPT (the same absolute offset) — no snap to bottom,
		// no custom flag toggling
		addRows(5)
		await flush()
		expect(scroll.scrollTop).toBe(awayPosition)
		expect(scroll.scrollTop).toBeLessThan(maxScroll())

		// PgDn past the end: clamped at the bottom, follow re-engages
		scroll.scrollBy(3, "viewport")
		await flush()
		expect(scroll.scrollTop).toBe(maxScroll())
		addRows(3)
		await flush()
		expect(scroll.scrollTop).toBe(maxScroll())
	})
})

describe("transcript scroll keys wiring", () => {
	test("keys ride the vendored keybind config vocabulary", () => {
		expect(TuiKeybind.defaultValue("session.page.up")).toBe("pageup,ctrl+alt+b")
		expect(TuiKeybind.defaultValue("session.page.down")).toBe("pagedown,ctrl+alt+f")
	})

	test("transcript-scroll.tsx: global-mode layer, dialog-stack gate, viewport page unit", () => {
		const source = src("src/routes/session/transcript-scroll.tsx")
		expect(source).toMatch(/mode: "global"/)
		expect(source).toMatch(/id: "session\.page\.up"/)
		expect(source).toMatch(/id: "session\.page\.down"/)
		expect(source).toMatch(/enabled: props\.enabled\(\)/)
		expect(source).toMatch(/scrollBy\(delta, "viewport"\)/)
		// never takes focus — scrollBy only (OpenTUI focus-singleton law)
		expect(source).not.toMatch(/\.focus\(\)/)
	})

	test("transcript.tsx publishes the scrollbox (scrollRef), undefined on teardown", () => {
		const source = src("src/routes/session/transcript.tsx")
		expect(source).toMatch(/scrollRef\?\: \(scroll: ScrollBoxRenderable \| undefined\) => void/)
		expect(source).toMatch(/props\.scrollRef\?\.\(undefined\)/)
	})

	test("v2-entry wires the layer + scrollRef and flips useMouse off (the default client path)", () => {
		const source = src("examples/v2-entry.tsx")
		expect(source).toMatch(/scrollRef: \(value: ScrollBoxRenderable \| undefined\) => \(transcriptScroll = value\)/)
		expect(source).toMatch(/createComponent\(TranscriptScrollKeys, \{/)
		expect(source).toMatch(/enabled: \(\) => dialog\.stack\.length === 0/)
		expect(source).toMatch(/\{ useMouse: false \}/)
	})

	test("session.tsx bench carries the same wiring (v2-entry parity)", () => {
		const source = src("examples/session.tsx")
		expect(source).toMatch(/scrollRef=\{\(value\) => \(transcriptScroll = value\)\}/)
		expect(source).toMatch(/<TranscriptScrollKeys scroll=\{\(\) => transcriptScroll\} enabled=\{\(\) => dialog\.stack\.length === 0\} \/>/)
		expect(source).toMatch(/useMouse: false/)
	})
})
