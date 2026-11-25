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
 * onAnimationTick callback flips). Since 2026-11-23 the fade sweep is off
 * (DOCK_FADE_OUT_MS=0): the full-color linger frame and the terminal drop
 * frame are asserted, and the visibility state machine is checked never to
 * enter `fading` (the old mid-sweep mix frame no longer exists).
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
import { afterEach, describe, expect, test } from "bun:test"
import { createShellRenderFixture } from "./shell-render-fixture.tsx"
import { markPanelActive, resetActivePanel } from "../../tui-base/src/routes/session/pane-focus"
import { setMotionTier } from "../../tui-base/src/skin/motion"
import { latestTodos, skinDockLineFg, todosTableLines } from "../../tui-base/src/routes/session/widgets-dock"
import { setDockSpin } from "../../tui-base/src/routes/session/widgets-dock"
import { DOCK_FADE_OUT_MS, DOCK_LINGER_MS, dockLineVisibility } from "../../tui-base/src/routes/session/dock-visibility"
import type { SeamRow } from "../../tui-base/src/routes/session/seam-rows"
import { stringWidth } from "../../tui-base/src/util/string-width"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
/** Advance to an absolute wall-clock target (Date.now based). */
async function sleepUntil(at: number): Promise<void> {
	const rest = at - Date.now()
	if (rest > 0) await sleep(rest)
}

describe("incident regressions: paint continuity (real renderer, canned events)", () => {
	// R5 漏网：本文件用 heavy ┏/┗/┃ 定位边框用例须显式把 activity 设为 active；
	// 复位防止信号跨用例泄漏（默认 composer → single 边框）。
	afterEach(() => {
		resetActivePanel()
	})

	// -------------------------------------------------------------------
	// Incident 2 — fade frames (positive case): a pure-think turn (no tool)
	// must paint intermediate fade frames, not jump to the terminal state.
	// -------------------------------------------------------------------
	test("pure-think dock holds full color for 2s then drops directly (sweep disabled)", async () => {
		// Decorated tier: 2s linger → hidden, no sweep (DOCK_FADE_OUT_MS=0).
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

			// 2026-11-23 用户指示关闭渐隐（DOCK_FADE_OUT_MS 300→0）：行 2 秒停留
			// 后直接消失，原「300ms sweep 中间帧」不再存在。渐隐窗口用例的前提
			// 已不成立，改为断言状态机全程不进入 fading；终态帧断言保留。
			expect(DOCK_FADE_OUT_MS).toBe(0)
			for (let elapsed = DOCK_LINGER_MS; elapsed <= DOCK_LINGER_MS + 300; elapsed += 25) {
				expect(dockLineVisibility(settleAt, settleAt + elapsed, true).phase).not.toBe("fading")
			}

			// Terminal state: past the retention edge (2000ms, no sweep) the row is gone.
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
		// past the 2s edge with no sweep, decorated resolves to background,
		// reduced stays at the target.
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
			// R5: heavy ┏/┗/┃ borders are focus-driven (default composer → single).
			// Re-pin per iteration: fixture dispose unmounts WidgetsDock, whose
			// onCleanup resets the active panel back to composer.
			markPanelActive("activity")

			const frame = await fixture.waitForFrame((f) => f.includes("🧩 activity"))
			const lines = frame.split("\n")

			// Batch a (scene C) INTENTIONAL change: the old single-line summary
			// `todos [✓]d/n · item` became a TREE painted inside the activity
			// frame — a `● Todos (d/n)` header + one `├─/└─ <glyph> <content>`
			// row per todo. OLD: `expect(frame).not.toContain("● Todos")`;
			// NEW: assert the header and all three child rows are painted.
			expect(frame).toContain("● Todos (1/3)")
			// The activity TITLE carries only the activity title (plus any
			// overflow suffix); the tab strip is a real content row below it.
			// Neither the tab label "2 todo" nor the tree header belongs in the
			// title, so keep this guard against title/content regression.
			const topIdx = lines.findIndex((line) => line.includes("┏"))
			expect(topIdx).toBeGreaterThanOrEqual(0)
			expect(lines[topIdx]!.toLowerCase()).not.toContain("todos")

			// Locate the activity frame by its HEAVY borders (┏ title / ┗ close);
			// the transcript uses light ┌/└, so ┏/┗ are unambiguous.
			const bottomIdx = lines.findIndex((line, i) => i > topIdx && line.includes("┗"))
			expect(bottomIdx).toBeGreaterThan(topIdx)

			// Count content rows straight off the frame: every row between the
			// two borders is a content row (frame height - 2), each with a ┃ wall.
			// OLD: the active-only summary was ONE row (`inner.length === 1`).
			// NEW: the tree draws the header + all 3 todos = FOUR rows, followed
			// by the powerline tab strip = FIVE content rows.
			const frameHeight = bottomIdx - topIdx + 1
			const inner = lines.slice(topIdx + 1, bottomIdx)
			expect(inner.length).toBe(frameHeight - 2)
			expect(inner.length).toBe(5)
			for (const row of inner) expect(row).toContain("┃")

			// Exact painted rows (D13): wall, body, stringWidth padding to the
			// inner width, closing wall. OLD body: "todos [✓]1/3 · write the
			// regression". NEW bodies: the header + one row per todo, glyphs
			// ✓ completed / ● in_progress / ○ pending, branch ├─ except the
			// final row's └─; the final content row is the right-aligned tab strip.
			const bodies = [
				"● Todos (1/3)",
				"├─ ✓ map the incident",
				"├─ ● write the regression",
				"└─ ○ ship the gate",
			]
			const tabStrip = " 🏠 1 main \ue0b0 📋 2 todo \ue0b0"
			const tabBody = `${" ".repeat(width - 4 - stringWidth(tabStrip))}${tabStrip}  `
			expect(inner).toEqual([
				...bodies.map((body) => `┃${body}${" ".repeat(width - 2 - stringWidth(body))}┃`),
				`┃${tabBody}┃`,
			])
			const stripRow = inner[4]!
			expect(stripRow).toContain("1 main")
			expect(stripRow).toContain("2 todo")
			expect(stripRow).toContain("\ue0b0")
			expect(stringWidth(stripRow.slice(1, -1))).toBe(width - 2)

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
