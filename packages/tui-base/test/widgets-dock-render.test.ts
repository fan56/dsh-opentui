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
import { beforeAll, afterEach, describe, expect, test } from "bun:test"
import { bundledLocalesDir, loadLocales, setLanguages } from "@dsh-opentui/i18n"
import { createSignal } from "solid-js"
import { createComponent } from "@opentui/solid"
import { testRender } from "@opentui/solid"
import type { CapturedFrame, CapturedSpan } from "@opentui/core"
import { WidgetsDock, resetSkinLineFades, dockAccentColor, setActivityPanelGear } from "../src/routes/session/widgets-dock"
import { DOCK_LINGER_MS, DOCK_FADE_OUT_MS } from "../src/routes/session/dock-visibility"
import { setMotionTier } from "../src/skin/motion"
import type { SeamRow } from "../src/routes/session/seam-rows"

// T7b: the dock/picker/palette copy now flows through t() — load the bundled
// locales into the registry so the en values resolve in tests (T5/T6 law).
beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages)
})


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

			// Poll a WINDOW derived from the same constants the visibility
			// state machine uses. A single fixed sample at 2150ms sat only
			// 150ms from the 2300ms edge, so one 200ms-class CI stall pushed
			// it past `hidden` (macOS observed 2361ms → midSpan undefined).
			// Guard bands on BOTH sides keep the sample inside the sweep.
			const WINDOW_START = DOCK_LINGER_MS + 50 // 2050
			const WINDOW_END = DOCK_LINGER_MS + DOCK_FADE_OUT_MS - 50 // 2250
			const STEP_MS = 50
			// Cheap self-check: a future constant change must not collapse the
			// window into a point (which would recreate the flake).
			expect(WINDOW_END - WINDOW_START).toBeGreaterThan(2 * STEP_MS)

			const target = rgbOf(lingerSpan!.fg) // accent reference from the linger sample
			let lastRgb: [number, number, number] = [target.r, target.g, target.b]
			let passed = false
			let samples = 0
			for (let at = WINDOW_START; at <= WINDOW_END; at += STEP_MS) {
				await sleep(Math.max(0, t0 + at - Date.now()))
				await setup.renderOnce()
				const midSpan = spanFor(setup.captureSpans(), "💭 thought")
				samples++
				if (midSpan === undefined) {
					// Row already hidden — sampling ran too late.
					throw new Error(
						`M1 fade window FAIL (span vanished — sampled too late): ` +
							`elapsed=${Date.now() - t0}ms, last fg rgb=${JSON.stringify(lastRgb)}, ` +
							`sample #${samples} (target t0+${at}ms, window [${WINDOW_START},${WINDOW_END}]). ` +
							`The "💭 thought" line went hidden before a mid-fade frame was observed.`,
					)
				}
				const bg = rgbOf(midSpan.bg)
				const mixed = rgbOf(midSpan.fg)
				lastRgb = [mixed.r, mixed.g, mixed.b]
				// Unchanged discrimination: not near(accent), not near(bg), and
				// EVERY channel strictly between bg and target (near tol unchanged).
				const nearAccent = near(mixed.r, target.r) && near(mixed.g, target.g) && near(mixed.b, target.b)
				const nearBg = near(mixed.r, bg.r) && near(mixed.g, bg.g) && near(mixed.b, bg.b)
				let strictlyBetween = true
				for (const channel of ["r", "g", "b"] as const) {
					const lo = Math.min(bg[channel], target[channel])
					const hi = Math.max(bg[channel], target[channel])
					if (!(mixed[channel] > lo && mixed[channel] < hi)) strictlyBetween = false
				}
				if (!nearAccent && !nearBg && strictlyBetween) {
					passed = true
					break
				}
			}
			if (!passed) {
				// No intermediate frame anywhere in the window — the M1
				// regression signature: the tick never re-ran the builders,
				// so the dock sat at full accent until the store dropped it.
				throw new Error(
					`M1 fade window FAIL (full-color across window — M1 regression: ` +
						`animation tick did not re-run builders): elapsed=${Date.now() - t0}ms, ` +
						`last fg rgb=${JSON.stringify(lastRgb)}, samples=${samples}, ` +
						`window [${WINDOW_START},${WINDOW_END}]ms. No intermediate frame seen.`,
				)
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

	test("U4 panelHeight: the /settings gear live-resizes the frame (1 → 10)", async () => {
		setMotionTier("full")
		const now = Date.now()
		// A 5-line collapsed think burst beside a running tool: the frame is
		// 2 borders + think + tool rows, so the gear moves its height directly.
		const rows: SeamRow[] = [
			{
				key: "reasoning:gear",
				kind: "reasoning",
				text: "g1\ng2\ng3\ng4\ng5",
				final: true,
				startedAt: now - 400,
				elapsedSec: 0.4,
			},
			{ key: "tool:live:gear", kind: "tool", name: "bash", args: "{}", status: "running", startedAt: now },
		]
		const setup = await testRender(
			() => createComponent(WidgetsDock, { rows, turnActive: () => true }),
			{ width: WIDTH, height: HEIGHT, useMouse: false },
		)
		const thinkLines = (frame: CapturedFrame): number =>
			frame.lines.reduce(
				(count, line) => count + line.spans.filter((span) => /g[1-5]/.test(span.text)).length,
				0,
			)
		try {
			await sleep(300) // the frame latch + entrance fades
			await setup.renderOnce()
			// Gear 1: ONE think line survives (the tail), the frame is tight.
			setActivityPanelGear("1")
			await setup.renderOnce()
			const tight = setup.captureSpans()
			expect(spanFor(tight, "g5")).toBeDefined()
			expect(spanFor(tight, "g1")).toBeUndefined()
			expect(thinkLines(tight)).toBe(1)

			// Gear 10, NO remount: the reactive gear signal re-runs the block
			// builders and the frame grows in place — the live-apply contract.
			setActivityPanelGear("10")
			await setup.renderOnce()
			const tall = setup.captureSpans()
			expect(spanFor(tall, "g1")).toBeDefined()
			expect(spanFor(tall, "g5")).toBeDefined()
			expect(thinkLines(tall)).toBe(5)

			// Short terminal: the gear is INERT — the rule-bar degradation wins
			// (the same gear must not resize a ≤30-row terminal).
			setActivityPanelGear("10")
			const small = await testRender(
				() => createComponent(WidgetsDock, { rows, turnActive: () => true }),
				{ width: WIDTH, height: 24, useMouse: false },
			)
			try {
				await sleep(200)
				await small.renderOnce()
				const compact = small.captureSpans()
				// The rule bar carries ONE think line (the tail), never five.
				expect(thinkLines(compact)).toBeLessThanOrEqual(1)
			} finally {
				await small.dispose()
			}
		} finally {
			setActivityPanelGear(undefined)
			await setup.dispose()
		}
	})

	test("U4 panelHeight `all`: the frame is clamped to the 2/3 budget (the LONGER block sheds first)", async () => {
		setMotionTier("full")
		const now = Date.now()
		// 20 collapsed think lines + 8 running tools = 28 unbounded content
		// rows. At 36 terminal rows the `all` budget is floor(72/3) - 2 =
		// 22, so the trim MUST shed 6 think lines (the longer block) and
		// keep every tool.
		const rows: SeamRow[] = [
			{
				key: "reasoning:all-budget",
				kind: "reasoning",
				text: Array.from({ length: 20 }, (_, index) => `g${index + 1}`).join("\n"),
				final: true,
				startedAt: now - 400,
				elapsedSec: 0.4,
			},
			...Array.from({ length: 8 }, (_, index) => ({
				key: `tool:live:all-${index + 1}`,
				kind: "tool" as const,
				name: `tool-${index + 1}`,
				args: "{}",
				status: "running" as const,
				startedAt: now,
			})),
		]
		const setup = await testRender(
			() => createComponent(WidgetsDock, { rows, turnActive: () => true }),
			{ width: WIDTH, height: 36, useMouse: false },
		)
		const texts = (frame: CapturedFrame): string[] =>
			frame.lines.flatMap((line) => line.spans.map((span) => span.text.trim()))
		try {
			await sleep(300) // the frame latch + entrance fades
			await setup.renderOnce()
			// Baseline: NO gear → the graded default (36 rows → cap 1) — one
			// think line, one tool line.
			const base = texts(setup.captureSpans())
			expect(base.filter((text) => /^g\d+$/.test(text)).length).toBeLessThanOrEqual(1)
			expect(base.filter((text) => /tool-\d+/.test(text)).length).toBeLessThanOrEqual(1)

			// Gear `all`: per-block caps drop, but the combined budget holds:
			// 22 content rows = think 14 (tail g7..g20) + all 8 tools.
			setActivityPanelGear("all")
			await setup.renderOnce()
			const frame = texts(setup.captureSpans())
			const thinkLines = frame.filter((text) => /^g\d+$/.test(text))
			const toolLines = frame.filter((text) => /tool-\d+/.test(text))
			expect(thinkLines.length + toolLines.length).toBe(22)
			expect(thinkLines.length).toBe(14)
			expect(toolLines.length).toBe(8)
			// The shed lines are the OLDEST of the longer block: the tail
			// survives, the head goes.
			expect(thinkLines).not.toContain("g1")
			expect(thinkLines).not.toContain("g6")
			expect(thinkLines).toContain("g7")
			expect(thinkLines).toContain("g20")
		} finally {
			setActivityPanelGear(undefined)
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
