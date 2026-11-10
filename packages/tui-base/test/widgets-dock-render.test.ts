/**
 * Render-layer pin for the two review must-fixes (M1/M2) on the REAL
 * @opentui render path: the actual WidgetsDock component mounted through
 * @opentui/solid's `testRender`, painted frames captured as styled spans.
 * No pure-function stand-ins — a color frame that never reaches the buffer
 * fails the assertion.
 *
 * M1 (think-only fade): a collapsed think block used to stop tracking the
 * shared animation clock (only the STREAMING branch of thinkBlockLines read
 * `dockSpin`), so the tick bumped a signal nobody subscribed to: the block
 * sat at full color until the store dropped it. The dock now consumes the
 * clock unconditionally, and this file asserts an INTERMEDIATE color frame
 * exists between 2.0s and 2.3s after the collapse.
 *
 * M2 (resumed burst): a streaming row carrying a stale `elapsedSec` from
 * the previous segment must not get a fadeOutAt anchor. Here a
 * think→tool→think cycle paints the resumed burst at full accent, never in
 * the background color a stale hidden anchor would produce.
 *
 * Frames are driven by `renderOnce()` (renderer.loop runs the animation
 * ticks), so the samples land on controlled wall-clock points.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { createComponent } from "@opentui/solid"
import { testRender } from "@opentui/solid"
import type { CapturedFrame, CapturedSpan } from "@opentui/core"
import { WidgetsDock, resetSkinLineFades, dockAccentColor } from "../src/routes/session/widgets-dock"
import { setMotionTier } from "../src/skin/motion"
import type { SeamRow } from "../src/routes/session/seam-rows"

const WIDTH = 72
const HEIGHT = 60 // > 50 rows → dockLineCap 3

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)))

function spanFor(frame: CapturedFrame, needle: string): CapturedSpan | undefined {
	for (const line of frame.lines) {
		for (const span of line.spans) {
			if (span.text.includes(needle)) return span
		}
	}
	return undefined
}

/** Parsed "r,g,b" accent (the no-provider fallback is #9d7cd8 on black). */
function rgbOf(fg: CapturedSpan["fg"]): { r: number; g: number; b: number } {
	return { r: fg.r, g: fg.g, b: fg.b }
}

const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol

afterEach(() => {
	setMotionTier(undefined)
	resetSkinLineFades()
})

describe("WidgetsDock on the real renderer", () => {
	test("M1: collapsed think-only dock paints an intermediate fade frame inside 2.0-2.3s", async () => {
		setMotionTier("full") // decorations on: fades/colors enabled
		const t0 = Date.now()
		// stopAt = startedAt + elapsedSec*1000 = t0 (stopped just now).
		const rows: SeamRow[] = [
			{
				key: "reasoning:live-1",
				kind: "reasoning",
				text: "alpha\nbeta\ngamma",
				final: true,
				startedAt: t0 - 1500,
				elapsedSec: 1.5,
			},
		]
		const setup = await testRender(() => createComponent(WidgetsDock, { get rows() { return rows } }), {
			width: WIDTH,
			height: HEIGHT,
			useMouse: false,
		})
		try {
			// Let the entrance fade finish, then sample the LINGER color.
			await sleep(t0 + 700 - Date.now())
			await setup.renderOnce()
			const linger = setup.captureSpans()
			const lingerSpan = spanFor(linger, "💭 thought")
			expect(lingerSpan).toBeDefined()
			// Full accent (the entrance fade is done, the hold is not).
			expect(near(lingerSpan!.fg.r, 157 / 255)).toBe(true)
			expect(near(lingerSpan!.fg.g, 124 / 255)).toBe(true)
			expect(near(lingerSpan!.fg.b, 216 / 255)).toBe(true)

			// Sample INSIDE the 300ms sweep (2.0s..2.3s after the stop).
			await sleep(t0 + 2150 - Date.now())
			await setup.renderOnce()
			const mid = setup.captureSpans()
			const midSpan = spanFor(mid, "💭 thought")
			expect(midSpan).toBeDefined()
			const bg = rgbOf(midSpan!.bg)
			const target = rgbOf(lingerSpan!.fg)
			const mixed = rgbOf(midSpan!.fg)
			// Not the linger color (a stale frame) and not the background (a
			// dropped line): every channel strictly between bg and target —
			// i.e. a REAL intermediate frame was painted by the tick.
			expect(near(mixed.r, target.r) && near(mixed.g, target.g) && near(mixed.b, target.b)).toBe(false)
			expect(near(mixed.r, bg.r) && near(mixed.g, bg.g) && near(mixed.b, bg.b)).toBe(false)
			for (const channel of ["r", "g", "b"] as const) {
				const lo = Math.min(bg[channel], target[channel])
				const hi = Math.max(bg[channel], target[channel])
				expect(mixed[channel]).toBeGreaterThan(lo)
				expect(mixed[channel]).toBeLessThan(hi)
			}
		} finally {
			await setup.dispose()
		}
	})

	test("M2: think→tool→think keeps the resumed burst at full accent (no stale anchor)", async () => {
		setMotionTier("full")
		const [rows, setRows] = createSignal<SeamRow[]>([])
		const setup = await testRender(() => createComponent(WidgetsDock, { get rows() { return rows() } }), {
			width: WIDTH,
			height: HEIGHT,
			useMouse: false,
		})
		const toolAccent = dockAccentColor(undefined, "tool")
		try {
			const think = dockAccentColor(undefined, "think")
			// Phase A: a resumed think burst (streaming) carrying a stale
			// elapsedSec from the segment that collapsed before it, beside a
			// running tool.
			const now = Date.now()
			setRows([
				{
					key: "reasoning:live-1",
					kind: "reasoning",
					text: "one\nresumed tail",
					final: false,
					streaming: true,
					startedAt: now - 5000,
					elapsedSec: 4.5, // stale: would anchor a stop 4.5s ago
				},
				{ key: "tool:live:c1", kind: "tool", name: "bash", args: '{"command":"ls"}', status: "running", startedAt: now - 400 },
			])
			await sleep(500) // 60ms frame latch + the 400ms line entrance fade
			await setup.renderOnce()
			let frame = setup.captureSpans()
			const thinkA = spanFor(frame, "💭 thinking")
			expect(thinkA).toBeDefined()
			// Full accent — a stale-anchor fade would paint this in the bg.
			expect(nearSphere(thinkA!.fg, think)).toBe(true)
			expect(spanFor(frame, "bash")).toBeDefined()
			// The body carries the tool accent; the ⚙ marker keeps the running tone.
			expect(nearSphere(spanFor(frame, "bash")!.fg, toolAccent)).toBe(true)
			expect(spanFor(frame, "⚙")).toBeDefined()

			// Phase B: the segment collapses and the tool settles → both lines
			// keep their INDEPENDENT anchors (one never hides the other).
			const collapsedAt = Date.now()
			setRows([
				{
					key: "reasoning:live-1",
					kind: "reasoning",
					text: "one\nresumed tail",
					final: true,
					streaming: false,
					startedAt: collapsedAt - 1300,
					elapsedSec: 1.3,
				},
				{
					key: "tool:live:c1",
					kind: "tool",
					name: "bash",
					args: '{"command":"ls"}',
					status: "done",
					output: "ok",
					startedAt: collapsedAt - 500,
					elapsedSec: 0.5,
				},
			])
			await setup.renderOnce()
			frame = setup.captureSpans()
			expect(spanFor(frame, "💭 thought")).toBeDefined()
			expect(spanFor(frame, "✔")).toBeDefined()
			expect(spanFor(frame, "bash")).toBeDefined()

			// Phase C: a NEW think burst resumes after the tool (think→tool→think)
			// — still streaming with the phase-B elapsedSec left on the row. The
			// dock must paint it at FULL accent, not fade it on the old anchor.
			setRows([
				{
					key: "reasoning:live-1",
					kind: "reasoning",
					text: "one\nresumed tail\nfresh burst",
					final: false,
					streaming: true,
					startedAt: collapsedAt - 1300,
					elapsedSec: 1.3,
				},
				{
					key: "tool:live:c1",
					kind: "tool",
					name: "bash",
					args: '{"command":"ls"}',
					status: "done",
					output: "ok",
					startedAt: collapsedAt - 500,
					elapsedSec: 0.5,
				},
			])
			await setup.renderOnce()
			frame = setup.captureSpans()
			const thinkC = spanFor(frame, "💭 thinking")
			expect(thinkC).toBeDefined()
			expect(nearSphere(thinkC!.fg, think)).toBe(true)
			// The settled tool is still inside its linger: independent, painted.
			expect(spanFor(frame, "✔")).toBeDefined()
		} finally {
			await setup.dispose()
		}
	})
})

/** Compare a captured fg to a target string/RGBA accent (channel tolerance). */
function nearSphere(fg: CapturedSpan["fg"], target: unknown): boolean {
	const p = target as { r: number; g: number; b: number }
	const a = typeof target === "string" ? parseHex(target) : { r: p.r, g: p.g, b: p.b }
	return near(fg.r, a.r, 0.02) && near(fg.g, a.g, 0.02) && near(fg.b, a.b, 0.02)
}

function parseHex(hex: string): { r: number; g: number; b: number } {
	const n = Number.parseInt(hex.replace(/^#/, ""), 16)
	return { r: ((n >> 16) & 0xff) / 255, g: ((n >> 8) & 0xff) / 255, b: (n & 0xff) / 255 }
}
