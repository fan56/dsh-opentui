/**
 * Incident-mapped renderer regressions, paint/animation class
 * (pilot/shell-render). Two incidents, each with a positive + negative
 * case; mapping source: research/oldfox-reuse-verdict.md §3 and the
 * corresponding chapters of research/opencode-test-cases-ui.md.
 *
 * ── Incident 2: fade frames not painted (pure think, no tool) ────────────
 * The think-only dock "sat at full color until the store dropped the row"
 * — no intermediate fade frame ever reached the renderer buffer (the
 * reactive-repaint miss; widgets-dock.tsx dockBlocks "Clock law (M1)"
 * documents the fix). opencode counterpart: fake timers + per-tick
 * captureCharFrame in packages/tui/test/util/delayed-presence.test.ts and
 * component/session-tabs-marquee.test.ts (research/opencode-test-cases-ui.md
 * fade/marquee chapter). Adaptation: bun:test has no jest fake timers we can
 * safely drive the renderer clock with, so we advance the SHARED animation
 * tick (the exported setDockSpin signal — exactly what the dock's
 * onAnimationTick callback flips) against the real fade window and assert
 * TWO distinct intermediate frames (full-color linger + mid-sweep mix), not
 * just the terminal state. Color needs the span capture — a char frame
 * cannot see the gradient.
 *
 * ── Incident 3: border-box row count always 0, hint fallback masked it ───
 * Counting rows inside a bordered widget box always answered 0 and a hint
 * fallback masked the regression (research/oldfox-reuse-verdict.md §3;
 * opencode counterpart: packages/tui/test/ui/layout.test.ts exact boundary
 * asserts + inline-tool-wrap-snapshot fixed-width captureCharFrame). The
 * antidote is a headless frame assertion that COUNTS the drawn rows inside
 * the merged activity frame's heavy border — no hint fallback involved.
 * Under the merged widget (D1) todos render inside that frame; there is no
 * standalone bordered Todos box any more.
 *
 * Fixture: ./shell-render-fixture.tsx. Scope guards: short-burst frames
 * only — no sustained streaming turn (upstream diff-paint corruption).
 */
import { describe, expect, test } from "bun:test"
import type { RGBA } from "@opentui/core"
import { createShellRenderFixture } from "./shell-render-fixture.tsx"
import { setMotionTier } from "../../tui-base/src/skin/motion"
import { latestTodos, skinDockLineFg, todosTableLines } from "../../tui-base/src/routes/session/widgets-dock"
import { setDockSpin } from "../../tui-base/src/routes/session/widgets-dock"
import type { SeamRow } from "../../tui-base/src/routes/session/seam-rows"
import { stringWidth } from "../../tui-base/src/util/string-width"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
/** Advance to an absolute wall-clock target (Date.now based). */
async function sleepUntil(at: number): Promise<void> {
	const rest = at - Date.now()
	if (rest > 0) await sleep(rest)
}

/** First span fg whose text carries `needle` (the fade gradient lives in
 * span colors — captureCharFrame is color-blind). */
function spanFg(fixture: Awaited<ReturnType<typeof createShellRenderFixture>>, needle: string): RGBA {
	const captured = fixture.captureSpans()
	for (const line of captured.lines) {
		for (const span of line.spans) {
			if (span.text.includes(needle)) return span.fg
		}
	}
	throw new Error(`spanFg: no span containing ${JSON.stringify(needle)} in the captured frame`)
}

function colorDistance(a: RGBA, b: RGBA): number {
	return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)
}

describe("incident regressions: paint continuity (real renderer, canned events)", () => {
	// -------------------------------------------------------------------
	// Incident 2 — fade frames (positive case): a pure-think turn (no tool)
	// must paint intermediate fade frames, not jump to the terminal state.
	// -------------------------------------------------------------------
	test("pure-think fade window paints intermediate frames (linger + mid-sweep) before the row drops", async () => {
		// Decorated tier: 2s linger → 300ms sweep → hidden (dock-visibility).
		setMotionTier("full")
		try {
			await using fixture = await createShellRenderFixture({
				turnScript: async (cb) => {
					cb.onThinkingDelta("alpha reasoning draft")
				},
			})
			const pending = fixture.send("think only, no tool")
			await fixture.waitForFrame((f) => f.includes("💭 thought"))
			const settleAt = Date.now()
			await pending

			// Advance the animation tick so the dock re-derives its colors
			// (the M1 clock law: an un-flipped tick = no repaint = the incident).
			const tick = async () => {
				setDockSpin((s) => s + 1)
				await fixture.renderOnce()
			}

			// Intermediate state 1 — inside the 2s linger: full-color frame.
			await sleepUntil(settleAt + 700)
			await tick()
			const lingerFrame = fixture.captureFrame()
			expect(lingerFrame).toContain("💭 thought")
			const lingerFg = spanFg(fixture, "💭 thought")

			// Intermediate state 2 — inside the 300ms sweep (2000–2300ms past
			// the row's fadeOutAt): the line is STILL on screen and its color
			// has started mixing toward the background. This frame is the one
			// the incident never painted.
			//
			// Sampling window (flaky-mitigation): settleAt is taken BEFORE
			// `await pending` resolves, so the row's real fadeOutAt sits one
			// projection-convergence beat LATER than settleAt — a CI process
			// pause during that await shifts the whole fade window right and
			// the old narrow sample range [2150, 2270] could miss it. Start
			// before the nominal sweep edge and end past it: [2015, 2290].
			// Acceptance inside the loop still requires a MIXED color (the
			// capture must have moved off the linger color), so an early tick
			// that lands while the row is still lingering cannot be mistaken
			// for a mid-sweep frame.
			await sleepUntil(settleAt + 2015)
			let sweepFrame: string | undefined
			let sweepFg: RGBA | undefined
			// Poll inside the sweep window: catch one painted mid-sweep frame.
			while (Date.now() < settleAt + 2290) {
				await tick()
				const frame = fixture.captureFrame()
				if (frame.includes("💭 thought")) {
					const fg = spanFg(fixture, "💭 thought")
					if (colorDistance(fg, lingerFg) > 0.02) {
						sweepFrame = frame
						sweepFg = fg
						break
					}
				}
				await sleep(20)
			}
			expect(sweepFrame).toBeDefined()
			expect(sweepFg).toBeDefined()
			// The gradient really moved between the two intermediate frames.
			expect(colorDistance(sweepFg!, lingerFg)).toBeGreaterThan(0.02)

			// Terminal state: past the retention edge (2300ms) the row is gone.
			await sleepUntil(settleAt + 2480)
			await tick()
			expect(fixture.captureFrame()).not.toContain("💭 thought")
		} finally {
			setMotionTier(undefined)
		}
	})

	// Incident 2 — negative pairing: a SILENT thinking period paints nothing
	// (no panel, no empty box), and the reduced tier paints no gradient at
	// all (the fade only exists in the decorated tier).
	test("negative: silent think paints nothing; reduced tier paints no fade gradient", async () => {
		await using fixture = await createShellRenderFixture()
		expect(fixture.captureFrame()).not.toContain("💭 thinking")
		expect(fixture.captureFrame()).not.toContain("💭 thought")

		// Pure degradation contract (dock-visibility + skinDockLineFg):
		// mid-sweep moment, decorated mixes, reduced stays at the target.
		const target = "#9ece6a"
		const background = "#000000"
		const midSweep = { id: "dock:think", fadeOutAt: Date.now() - 2150 }
		const decorated = skinDockLineFg({ decorated: true, background }, target, midSweep)
		expect(decorated).not.toBe(target)
		const reduced = skinDockLineFg({ decorated: false, background }, target, midSweep)
		expect(reduced).toBe(target)
	})

	// -------------------------------------------------------------------
	// Incident 3 — paint continuity (positive case): the MERGED activity
	// frame must DRAW its in_progress todo rows INSIDE its heavy border —
	// counted straight off the captured frame, no hint fallback, no
	// standalone Todos box (D1/D6).
	// -------------------------------------------------------------------
	test("bordered todos box draws its content rows inside the border (counted off the frame)", async () => {
		// Right-wall alignment is a RENDER-layer invariant: the pure row builder
		// fits every line to the container's inner width with stringWidth (D13),
		// but the old renderer re-clipped rows with a character-count clip (whose
		// whitespace fold pulled the right wall 2 columns left of the top-right
		// corner), so a pure-function test stayed green while the painted frame
		// was broken. Pin it off the REAL frame at three widths — including 40
		// (the narrow Math.max(16, W-4) floor path). The fixture feeds a settled
		// `todo_write` seam row whose args carry the todos — the merged path's
		// data source (there is no standalone panel any more).
		const todoArgs = JSON.stringify({
			todos: [
				{ content: "map the incident", status: "completed" },
				{ content: "write the regression", status: "in_progress" },
				{ content: "ship the gate", status: "pending" },
			],
		})
		for (const width of [80, 120, 40]) {
			await using fixture = await createShellRenderFixture({
				width,
				stored: [{ kind: "tool", name: "todo_write", args: todoArgs, brief: "Updated todo list", ok: true }],
			})

			const frame = await fixture.waitForFrame((f) => f.includes("🧩 activity"))
			const lines = frame.split("\n")

			// D1/D4: no separate bordered Todos box (the "● Todos" header is gone)
			// and the activity title never mentions "todo".
			expect(frame).not.toContain("● Todos")
			const topIdx = lines.findIndex((line) => line.includes("┏"))
			expect(topIdx).toBeGreaterThanOrEqual(0)
			expect(lines[topIdx]!.toLowerCase()).not.toContain("todo")

			// Locate the activity frame by its HEAVY borders (┏ title / ┗ close);
			// the transcript uses light ┌/└, so ┏/┗ are unambiguous.
			const bottomIdx = lines.findIndex((line, i) => i > topIdx && line.includes("┗"))
			expect(bottomIdx).toBeGreaterThan(topIdx)

			// Count content rows straight off the frame: every row between the
			// two borders is a content row (frame height - 2), each with a ┃ wall.
			// Active-only (D6) keeps just the one in_progress todo, at its
			// original plan index 2 — no pending/completed residue.
			const frameHeight = bottomIdx - topIdx + 1
			const inner = lines.slice(topIdx + 1, bottomIdx)
			expect(inner.length).toBe(frameHeight - 2)
			expect(inner.length).toBe(1)
			for (const row of inner) expect(row).toContain("┃")

			// Exact painted row (D13): wall, "● <index> <content>", stringWidth
			// padding to the inner width, closing wall.
			const body = "● 2 write the regression"
			expect(inner).toEqual([`┃${body}${" ".repeat(width - 2 - stringWidth(body))}┃`])

			// THE render-layer regression assert (width=${width}): every content
			// row's right wall (┃) must land in the SAME column as the top
			// border's ┓. The character-count re-clip bug sat 2 columns left.
			const topRightCol = lines[topIdx]!.lastIndexOf("┓")
			expect(topRightCol).toBe(width - 1)
			for (const row of inner) expect(row.lastIndexOf("┃")).toBe(topRightCol)
		}
	})

	// Incident 3 — negative pairing at pure granularity: with content the
	// builder returns border + content rows; with everything completed (or
	// no todos) it returns ZERO rows — the only legitimate "count 0".
	test("negative: the bordered box clears when there is nothing to draw (zero rows)", () => {
		const todos = [
			{ content: "map the incident", status: "completed" },
			{ content: "write the regression", status: "in_progress" },
		] as const
		const todoRow = (list: readonly { content: string; status: string }[]): SeamRow => ({
			key: "tool:live:call-todo",
			kind: "tool",
			name: "todo_write",
			args: JSON.stringify({ todos: list }),
			status: "done",
			output: "Updated todo list",
		})

		const withContent = todosTableLines([todoRow([...todos])], 40)
		expect(withContent.length).toBeGreaterThan(0)
		expect(withContent[0]!.text.startsWith("┌")).toBe(true)
		expect(withContent[withContent.length - 1]!.text.startsWith("└")).toBe(true)
		const inner = withContent.slice(1, -1)
		expect(inner.length).toBeGreaterThan(0)
		for (const line of inner) expect(line.text).toContain("│")

		// The legit zero: no todos → no box at all.
		expect(todosTableLines([], 40)).toEqual([])
		// And latestTodos agrees (the builder's data source).
		expect(latestTodos([todoRow([...todos])])).toHaveLength(2)
	})
})
