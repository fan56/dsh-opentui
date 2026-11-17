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
import { createSignal, type JSX } from "solid-js"
import { createComponent } from "@opentui/solid"
import { testRender } from "@opentui/solid"
import type { CapturedFrame, CapturedSpan } from "@opentui/core"
import {
	WidgetsDock,
	mergedDockCursor,
	resetMergedDockCursor,
	resetSkinLineFades,
	dockAccentColor,
	setActivityPanelGear,
	mergedThinkRows,
} from "../src/routes/session/widgets-dock"
import { DOCK_LINGER_MS, DOCK_FADE_OUT_MS } from "../src/routes/session/dock-visibility"
import { stringWidth } from "../src/util/string-width"
import { setMotionTier } from "../src/skin/motion"
import type { SeamRow } from "../src/routes/session/seam-rows"
import { ConfigProvider, resolve } from "../src/config"
import { Keymap } from "../src/context/keymap"
import {
	InputOwnershipProvider,
	useInputOwnership,
	type InputOwnership,
	type OwnerFrame,
} from "../src/context/input-ownership"

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
	resetMergedDockCursor()
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

	/** The dock frame's content rows: the heavy-border verticals (`┃`) delimit
	 * the rows inside the box; the top/bottom borders use `┏┓┗┛`, so they are
	 * excluded. Visible content = 2 border rows + this count. */
	const dockContentLines = (frame: CapturedFrame): number =>
		frame.lines.filter((line) => line.spans.some((span) => span.text.includes("┃"))).length

	const spansMatching = (frame: CapturedFrame, re: RegExp): CapturedSpan[] =>
		frame.lines.flatMap((line) => line.spans).filter((span) => re.test(span.text))

	/** A settled `todo_write` row carrying `count` in_progress todos in its
	 * args; `latestTodos` reads this, and `mergedToolRows` excludes it (key not
	 * `tool:live:`), so it feeds the lower zone without adding a tool line. */
	const todoWriteRows = (count: number): SeamRow => ({
		key: "tool:todos",
		kind: "tool",
		name: "todo_write",
		args: JSON.stringify({
			todos: Array.from({ length: count }, (_, i) => ({ content: `task ${i + 1}`, status: "in_progress" })),
		}),
		status: "done",
		output: "Updated todo list",
	})

	test("U4 panelHeight: gear caps the merged frame at min(gear, 10) (1 → 10)", async () => {
		setMotionTier("full")
		const now = Date.now()
		// A 5-line collapsed think burst + a running tool + 12 in_progress todos
		// → coexistence: think + tool above, todo window below. The gear caps
		// the WHOLE merged frame; think itself never expands past one line.
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
			todoWriteRows(12),
		]
		const setup = await testRender(
			() => createComponent(WidgetsDock, { rows, turnActive: () => true }),
			{ width: WIDTH, height: HEIGHT, useMouse: false },
		)
		try {
			await sleep(300) // the frame latch + entrance fades
			await setup.renderOnce()
			// No gear → the 10-line ceiling. Think is exactly ONE line (the
			// tail, g5); the coexistence tool zone is exactly ONE line.
			const base = setup.captureSpans()
			expect(dockContentLines(base)).toBe(10)
			expect(spansMatching(base, /g[1-5]/)).toHaveLength(1)
			expect(spansMatching(base, /g[1-5]/)[0]!.text).toContain("g5")
			expect(spansMatching(base, /g[1-5]/)[0]!.text).not.toContain("g1")
			expect(spansMatching(base, /bash/)).toHaveLength(1)

			// Gear 1: the frame shrinks in place (no remount) to ONE content
			// line — the newest upper line (tool); think/lower are trimmed.
			setActivityPanelGear("1")
			await setup.renderOnce()
			const tight = setup.captureSpans()
			expect(dockContentLines(tight)).toBe(1)
			expect(spansMatching(tight, /bash/)).toHaveLength(1)
			expect(spansMatching(tight, /g[1-5]/)).toHaveLength(0)
			expect(spansMatching(tight, /task \d+/)).toHaveLength(0)

			// Gear 5 → exactly 5 content lines; gear 10 → exactly 10. Think and
			// the tool zone stay at one line each at every gear.
			for (const [gear, expected] of [["5", 5], ["10", 10]] as const) {
				setActivityPanelGear(gear)
				await setup.renderOnce()
				const frame = setup.captureSpans()
				expect(dockContentLines(frame)).toBe(expected)
				expect(spansMatching(frame, /g[1-5]/)).toHaveLength(1)
				expect(spansMatching(frame, /bash/)).toHaveLength(1)
			}

			// Short terminal: the gear is INERT — the rule-bar degradation wins.
			setActivityPanelGear("10")
			const small = await testRender(
				() => createComponent(WidgetsDock, { rows, turnActive: () => true }),
				{ width: WIDTH, height: 24, useMouse: false },
			)
			try {
				await sleep(200)
				await small.renderOnce()
				// The compact rule bar carries ONE think line (the tail), not five.
				expect(spansMatching(small.captureSpans(), /g[1-5]/)).toHaveLength(1)
			} finally {
				await small.dispose()
			}
		} finally {
			setActivityPanelGear(undefined)
			await setup.dispose()
		}
	})

	test("U4 panelHeight `all`: content caps at 10 with scroll indicators", async () => {
		setMotionTier("full")
		const now = Date.now()
		// 20 collapsed think lines + a running tool + 20 in_progress todos:
		// far more than the merged frame can show. Under `all` (unbounded gear)
		// the merged ceiling still caps content at 10 visible lines.
		const rows: SeamRow[] = [
			{
				key: "reasoning:all-budget",
				kind: "reasoning",
				text: Array.from({ length: 20 }, (_, index) => `g${index + 1}`).join("\n"),
				final: true,
				startedAt: now - 400,
				elapsedSec: 0.4,
			},
			{ key: "tool:live:all", kind: "tool", name: "bash", args: "{}", status: "running", startedAt: now },
			todoWriteRows(20),
		]
		const setup = await testRender(
			() => createComponent(WidgetsDock, { rows, turnActive: () => true }),
			{ width: WIDTH, height: HEIGHT, useMouse: false },
		)
		try {
			await sleep(300) // the frame latch + entrance fades
			await setup.renderOnce()
			// No gear → the 10-line ceiling (the default is already 10).
			expect(dockContentLines(setup.captureSpans())).toBe(10)

			// Gear `all`: 2 upper (think + tool) + 7 todos + 1 bottom indicator
			// = 10. Think stays at ONE line; the tool zone stays at ONE line;
			// the indicator consumes a real visible line (counted in the 10).
			setActivityPanelGear("all")
			await setup.renderOnce()
			const all = setup.captureSpans()
			expect(dockContentLines(all)).toBe(10)
			expect(spansMatching(all, /g\d+/)).toHaveLength(1)
			expect(spansMatching(all, /bash/)).toHaveLength(1)
			expect(spansMatching(all, /task \d+/)).toHaveLength(7)
			const more = spansMatching(all, /more/)
			expect(more).toHaveLength(1)
			expect(more[0]!.text).toContain("▼ 13 more")
			expect(spansMatching(all, /▲/)).toHaveLength(0)

			// Gear 10 is the same ceiling; gear 1 shrinks to one content line.
			setActivityPanelGear("10")
			await setup.renderOnce()
			expect(dockContentLines(setup.captureSpans())).toBe(10)
			setActivityPanelGear("1")
			await setup.renderOnce()
			expect(dockContentLines(setup.captureSpans())).toBe(1)
		} finally {
			setActivityPanelGear(undefined)
			await setup.dispose()
		}
	})

	test("title shows N/M only on lower-zone overflow, right-aligned (D8/D13)", async () => {
		const now = Date.now()
		const [rows, setRows] = createSignal<SeamRow[]>([
			{ key: "tool:live:title", kind: "tool", name: "bash", args: "{}", status: "running", startedAt: now },
			todoWriteRows(14),
		])
		const setup = await testRender(
			() => createComponent(WidgetsDock, { get rows() { return rows() }, turnActive: () => true }),
			{ width: WIDTH, height: HEIGHT, useMouse: false },
		)
		try {
			resetMergedDockCursor()
			await sleep(300) // frame latch + entrance fades
			await setup.renderOnce()
			const topLine = setup.captureSpans().lines[0]
			const title = topLine?.spans.map((s) => s.text).join("") ?? ""

			// 14 todos overflow → N/M present. FIX A: the box reserves 4 chrome
			// columns (┏, leading ━, trailing ━, ┓), so the title slot is W-4 and
			// the suffix right edge is flush against the ONE mandatory trailing
			// ━ (`1/14━┓`). Encode the EXACT full string: a 1-column pad error
			// (W-3/W-5) or an extra ━ (`1/14━━┓`) now fails, unlike the old
			// `endsWith("1/14━┓")`. `1/14┓` is not achievable — a W-3 title is
			// wider than the slot and opentui drops the title entirely (probe
			// evidence; see widgets-dock.tsx titleSlotWidth comment).
			const base = "🔧 tool"
			const suffix = "1/14"
			const slot = WIDTH - 4
			const expected = `┏━${base}${" ".repeat(slot - stringWidth(base) - stringWidth(suffix))}${suffix}━┓`
			expect(title).toBe(expected)
			expect(title.includes("todo")).toBe(false)

			// 2 todos fit → NO N/M anywhere in the title.
			setRows([
				{ key: "tool:live:title2", kind: "tool", name: "bash", args: "{}", status: "running", startedAt: now },
				todoWriteRows(2),
			])
			await setup.renderOnce()
			const fitTitle = (setup.captureSpans().lines[0]?.spans.map((s) => s.text).join("") ?? "")
			expect(fitTitle).toContain("🔧 tool")
			expect(/\d+\/\d+/.test(fitTitle)).toBe(false)
		} finally {
			await setup.dispose()
		}
	})

	test("wheel steps the lower-zone cursor only while it overflows (D9)", async () => {
		const now = Date.now()
		const [rows, setRows] = createSignal<SeamRow[]>([
			{ key: "tool:live:wheel", kind: "tool", name: "bash", args: "{}", status: "running", startedAt: now },
			todoWriteRows(14),
		])
		// Mouse capture must be ON for renderer wheel delivery (main client path).
		const setup = await testRender(
			() => createComponent(WidgetsDock, { get rows() { return rows() }, turnActive: () => true }),
			{ width: WIDTH, height: HEIGHT, useMouse: true },
		)
		const titleOf = () => setup.captureSpans().lines[0]?.spans.map((s) => s.text).join("") ?? ""
		try {
			resetMergedDockCursor()
			await sleep(300)
			await setup.renderOnce()
			expect(titleOf()).toContain("1/14")

			// Scroll down over the dock frame (x=6, y=2 is inside a content row).
			// The SGR mouse parser emits scroll delta=1, so one notch = one line.
			await setup.mockMouse.scroll(6, 2, "down")
			await setup.renderOnce()
			expect(titleOf()).toContain("2/14")

			// Scroll back up to the top.
			await setup.mockMouse.scroll(6, 2, "up")
			await setup.renderOnce()
			expect(titleOf()).toContain("1/14")

			// No overflow → the wheel is a no-op (cursor guard).
			setRows([
				{ key: "tool:live:wheel2", kind: "tool", name: "bash", args: "{}", status: "running", startedAt: now },
				todoWriteRows(2),
			])
			await setup.renderOnce()
			const fitTitle = titleOf()
			expect(fitTitle).toContain("🔧 tool")
			expect(/\d+\/\d+/.test(fitTitle)).toBe(false)
		} finally {
			await setup.dispose()
		}
	})

	test("D10: lower zone survives turn end (turnActive false, no FlatDock fallback)", async () => {
		// turnActive=false but an in_progress todo keeps mergedLowerHasContent true,
		// so the latch stays shown and the MERGED frame renders (FlatDock draws no
		// heavy border). Assert exact line count + exact content strings.
		const rows: SeamRow[] = [todoWriteRows(1)]
		const setup = await testRender(
			() => createComponent(WidgetsDock, { rows, turnActive: () => false }),
			{ width: WIDTH, height: HEIGHT, useMouse: false },
		)
		try {
			resetMergedDockCursor()
			await sleep(120) // 60ms latch defer + entrance margin
			await setup.renderOnce()
			const lines = setup.captureSpans().lines.map((l) => l.spans.map((s) => s.text).join(""))
			const occupied = lines.filter((l) => l.trim() !== "")
			expect(occupied).toHaveLength(3) // top border + 1 todo content + bottom border
			const body = "● 1 task 1"
			const inner = WIDTH - 2
			expect(occupied[0]).toBe(`┏━🧩 activity${"━".repeat(inner - 1 - stringWidth("🧩 activity"))}┓`)
			expect(occupied[1]).toBe(`┃${body}${" ".repeat(inner - stringWidth(body))}┃`)
			expect(occupied[2]).toBe(`┗${"━".repeat(inner)}┛`)
		} finally {
			await setup.dispose()
		}
	})

	test("D11: compact terminal keeps 2-line rule form + 1 summary line, no scroll/N-M", async () => {
		// height 24 ≤ COMPOSER_COMPACT_TERMINAL_ROWS: no box/scroll zone; upper
		// zone keeps its 2 rule lines, lower zone collapses to ONE summary line.
		const now = Date.now()
		const rows: SeamRow[] = [
			{ key: "reasoning:compact", kind: "reasoning", text: "think tail", final: true, startedAt: now - 400, elapsedSec: 0.4 },
			{ key: "tool:live:compact", kind: "tool", name: "bash", args: "{}", status: "running", startedAt: now },
			todoWriteRows(12),
		]
		const setup = await testRender(
			() => createComponent(WidgetsDock, { rows, turnActive: () => true }),
			{ width: WIDTH, height: 24, useMouse: false },
		)
		try {
			resetMergedDockCursor()
			await sleep(120)
			await setup.renderOnce()
			const lines = setup.captureSpans().lines.map((l) => l.spans.map((s) => s.text).join(""))
			const occupied = lines.filter((l) => l.trim() !== "")
			expect(occupied).toHaveLength(3) // 2 upper rule lines + 1 lower summary
			expect(occupied[0]!.trimEnd()).toBe("   ┃ activity · 💭 thought · 0.4s · think tail")
			expect(occupied[1]!.includes("┃")).toBe(true) // rule form (not a boxed ┃ row)
			expect(occupied[1]!.includes("bash")).toBe(true)
			expect(occupied[2]!.trimEnd()).toBe("   todos [✓]0/12 · task 1")
			// No scroll indicators and no boxed title carrying N/M.
			for (const line of occupied) {
				expect(line.includes("▲")).toBe(false)
				expect(line.includes("▼")).toBe(false)
				expect(line.includes("┏")).toBe(false)
				expect(line.includes("┓")).toBe(false)
			}
		} finally {
			await setup.dispose()
		}
	})

	test("D3/D14: think-row retention filter hides a settled row when tier drops decorations mid-linger", async () => {
		// Pure law at the tier-switch boundary (the only changed input is
		// `decorated`): same row + same clock, kept under full (fading), dropped
		// under reduced/off (hidden at the 2.0s linger edge).
		const stoppedAt = 2500
		const row: Extract<SeamRow, { kind: "reasoning" }> = {
			key: "reasoning:tier",
			kind: "reasoning",
			text: "tier switch line",
			final: true,
			streaming: false,
			startedAt: 1000,
			elapsedSec: 1.5, // stop = 1000 + 1.5s = 2500
		}
		const now = stoppedAt + 2100 // inside 2.0-2.3s window
		expect(mergedThinkRows([row], now, true)).toHaveLength(1)
		expect(mergedThinkRows([row], now, false)).toHaveLength(0)
		// A live streaming burst is never filtered, even with a stale stop anchor.
		const live: SeamRow = { ...row, streaming: true }
		expect(mergedThinkRows([live], now, false)).toHaveLength(1)
	})
})

/**
 * D9 keyboard fallback harness: mount the REAL dock under the same provider
 * tree the client uses (ConfigProvider -> Keymap.Provider -> InputOwnershipProvider)
 * so the global scroll layer is live and its page-owner guard is real. A bare
 * testRender (no provider) would leave the layer unregistered and make every
 * key assertion vacuous. `pressChord` drives the REAL ctrl+alt+up / ctrl+alt+down
 * bytes through the renderer input parser, so the chord-to-command binding in
 * keybind.ts is exercised end to end; `openOverlay`/`closeOverlay` push/pop a
 * dialog frame on the ownership stack — the canonical ADR-0008 API `pageOwns()`
 * reads.
 */
type KeyHarness = {
	setup: Awaited<ReturnType<typeof testRender>>
	titleOf: () => string
	pressChord: (direction: "up" | "down") => void
	openOverlay: () => void
	closeOverlay: () => void
}

async function mountDockWithKeys(rows: () => readonly SeamRow[]): Promise<KeyHarness> {
	let ownership: InputOwnership | undefined
	let overlay: OwnerFrame | undefined
	function Capture() {
		ownership = useInputOwnership()
		return null
	}
	const setup = await testRender(
		() =>
			createComponent(ConfigProvider, {
				config: resolve({} as Parameters<typeof resolve>[0], { terminalSuspend: true }),
				get children() {
					return createComponent(Keymap.Provider, {
						get children() {
							return createComponent(InputOwnershipProvider, {
								get children() {
									return [
										createComponent(Capture, {}),
										createComponent(WidgetsDock, {
											get rows() {
												return rows()
											},
											turnActive: () => true,
										}),
									] as unknown as JSX.Element
								},
							})
						},
					})
				},
			}),
		{ width: WIDTH, height: HEIGHT, useMouse: false },
	)
	return {
		setup,
		titleOf: () => setup.captureSpans().lines[0]?.spans.map((s) => s.text).join("") ?? "",
		pressChord: (direction) => {
			// alt = meta in the TUI modifier model; ctrl+meta+arrow encodes the
			// exact ctrl+alt+up / ctrl+alt+down chord the config binds.
			setup.mockInput.pressArrow(direction, { ctrl: true, meta: true })
		},
		openOverlay: () => {
			if (!ownership) throw new Error("key harness: ownership context not captured")
			overlay = ownership.push("dialog")
		},
		closeOverlay: () => {
			if (!ownership || !overlay) throw new Error("key harness: no overlay frame open")
			ownership.pop(overlay)
			overlay = undefined
		},
	}
}

describe("WidgetsDock D9 keyboard scroll fallback (ctrl+alt+up/down)", () => {
	/** A settled todo_write row with `count` in_progress todos (same shape the
	 * other describe uses) — `latestTodos` reads it without adding a tool line. */
	const todoRows = (count: number): SeamRow => ({
		key: "tool:todos:kb",
		kind: "tool",
		name: "todo_write",
		args: JSON.stringify({
			todos: Array.from({ length: count }, (_, i) => ({ content: `task ${i + 1}`, status: "in_progress" })),
		}),
		status: "done",
		output: "Updated todo list",
	})

	test("overflow + key advances N/M, one line per notch", async () => {
		const now = Date.now()
		const [rows, setRows] = createSignal<SeamRow[]>([
			{ key: "tool:live:kb", kind: "tool", name: "bash", args: "{}", status: "running", startedAt: now },
			todoRows(14),
		])
		const h = await mountDockWithKeys(() => rows())
		try {
			resetMergedDockCursor()
			await sleep(300)
			await h.setup.renderOnce()
			expect(h.titleOf()).toContain("1/14")

			// ctrl+alt+down (session.dock.scroll.down) advances the window.
			h.pressChord("down")
			await h.setup.renderOnce()
			expect(h.titleOf()).toContain("2/14")

			// ctrl+alt+up (session.dock.scroll.up) steps back.
			h.pressChord("up")
			await h.setup.renderOnce()
			expect(h.titleOf()).toContain("1/14")

			// Content change keeps the harness live (proves the provider tree did
			// not freeze the dock's reactive rows).
			setRows([
				{ key: "tool:live:kb-b", kind: "tool", name: "bash", args: "{}", status: "running", startedAt: now },
				todoRows(16),
			])
			await h.setup.renderOnce()
			expect(h.titleOf()).toContain("1/16")
		} finally {
			await h.setup.dispose()
		}
	})

	test("no overflow + key is a no-op: cursor stays at 0 and no N/M", async () => {
		const now = Date.now()
		const rows: SeamRow[] = [
			{ key: "tool:live:kb2", kind: "tool", name: "bash", args: "{}", status: "running", startedAt: now },
			todoRows(2),
		]
		const h = await mountDockWithKeys(() => rows)
		try {
			resetMergedDockCursor()
			await sleep(300)
			await h.setup.renderOnce()
			const before = h.titleOf()
			expect(/\d+\/\d+/.test(before)).toBe(false)

			h.pressChord("down")
			h.pressChord("up")
			await h.setup.renderOnce()
			expect(mergedDockCursor()).toBe(0)
			expect(/\d+\/\d+/.test(h.titleOf())).toBe(false)
		} finally {
			await h.setup.dispose()
		}
	})

	test("overlay open + key is a real no-op (page-owner guard)", async () => {
		const now = Date.now()
		const rows: SeamRow[] = [
			{ key: "tool:live:kb3", kind: "tool", name: "bash", args: "{}", status: "running", startedAt: now },
			todoRows(14),
		]
		const h = await mountDockWithKeys(() => rows)
		try {
			resetMergedDockCursor()
			await sleep(300)
			await h.setup.renderOnce()
			expect(h.titleOf()).toContain("1/14")

			// A dialog frame owns the keyboard: pageOwns() is false, so the layer's
			// enabled flips off and the key must not move the cursor.
			h.openOverlay()
			await h.setup.flush()
			h.pressChord("down")
			await h.setup.renderOnce()
			expect(mergedDockCursor()).toBe(0)
			expect(h.titleOf()).toContain("1/14")

			// Closing the overlay re-arms the same key — proves the guard, not a
			// dead binding.
			h.closeOverlay()
			await h.setup.flush()
			h.pressChord("down")
			await h.setup.renderOnce()
			expect(mergedDockCursor()).toBe(1)
			expect(h.titleOf()).toContain("2/14")
		} finally {
			await h.setup.dispose()
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
