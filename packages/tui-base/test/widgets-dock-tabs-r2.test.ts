/**
 * R2 activity-panel tabs — pure/state contracts plus render-level mouse hits.
 * Preregistered expectations: .proof/r2-dock-tabs/00-preregistered-expected.md
 *   E1 default tab = main; E2 main tab == existing merged view; E3 todo tab
 *   (mouse + alt+2) renders width-fitted todo tree; E4 alt+1 returns to main;
 *   E5 empty/cleared todos yield zero lines.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { MouseButton, type MouseEvent } from "@opentui/core"
import { createComponent, testRender } from "@opentui/solid"
import { bundledLocalesDir, loadLocales, setLanguages } from "@dsh-opentui/i18n"
import { TuiKeybind } from "../src/config/keybind"
import type { SeamRow } from "../src/routes/session/seam-rows"
import { markPanelActive } from "../src/routes/session/pane-focus"
import {
	activityDockTab,
	activityDockTabLabels,
	dockTabAtPosition,
	dockTabStripLayout,
	mainTabLines,
	onDockTabMouseUp,
	resetActivityDockTab,
	selectActivityDockTab,
	todoTabLines,
	WidgetsDock,
} from "../src/routes/session/widgets-dock"
import { lineWidth, mergedDockLines, type MergedDockData } from "../src/routes/session/merged-dock"
import { stringWidth } from "../src/util/string-width"
import { SKIN_FALLBACK } from "../src/skin/semantic"

beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages)
	resetActivityDockTab()
})

const W = 40

function todoRows(items: { content: string; status: string }[]): SeamRow[] {
	return [
		{
			key: "tool:live:todo",
			kind: "tool",
			name: "todo_write",
			args: JSON.stringify({ todos: items }),
			status: "done",
			output: "ok",
			faded: true,
		} as SeamRow,
	]
}

const rows = todoRows([
	{ content: "write tests", status: "in_progress" },
	{ content: "ship it", status: "pending" },
])

function click(button: MouseButton): MouseEvent {
	return { button } as MouseEvent
}

describe("E1 — default tab state", () => {
	test("signal starts at main and reset restores main", () => {
		expect(activityDockTab()).toBe("main")
		selectActivityDockTab("todo")
		expect(activityDockTab()).toBe("todo")
		resetActivityDockTab()
		expect(activityDockTab()).toBe("main")
	})
})

describe("E2 — main tab is the unchanged merged view", () => {
	test("mainTabLines is the existing mergedDockLines builder", () => {
		const data: MergedDockData = { tools: [], think: [], todos: [], agents: [] }
		const options = { innerWidth: W, now: 0 }
		expect(mainTabLines(data, options)).toEqual(mergedDockLines(data, options))
	})
})

describe("E3 — switch to todo tab (mouse + alt+2)", () => {
	test("select + left mouse click switch the signal to todo", () => {
		selectActivityDockTab("main")
		onDockTabMouseUp("todo", click(MouseButton.LEFT))
		expect(activityDockTab()).toBe("todo")
	})

	test("non-left mouse buttons do not switch", () => {
		selectActivityDockTab("main")
		onDockTabMouseUp("todo", click(MouseButton.RIGHT))
		expect(activityDockTab()).toBe("main")
	})

	test("todo tab renders the fitted todo tree with every line exactly W columns", () => {
		const lines = todoTabLines(rows, W)
		expect(lines.length).toBeGreaterThan(0)
		const joined = lines.map((line) => line.segments.map((s) => s.text).join("")).join("\n")
		expect(joined).toContain("write tests")
		expect(joined).toContain("ship it")
		for (const line of lines) expect(lineWidth(line)).toBe(W)
	})

	test("alt+2 is bound to the todo command", () => {
		expect(TuiKeybind.defaultValue("session.dock.tab.todo")).toBe("alt+2")
	})
})

describe("E4 — switch back to main (alt+1)", () => {
	test("selector and binding return to the main view", () => {
		selectActivityDockTab("todo")
		selectActivityDockTab("main")
		expect(activityDockTab()).toBe("main")
		expect(TuiKeybind.defaultValue("session.dock.tab.main")).toBe("alt+1")
	})
})

describe("E5 — empty todo list in tab2", () => {
	test("no todos and all-completed todos both yield zero lines", () => {
		expect(todoTabLines([], W)).toEqual([])
		const done = todoRows([
			{ content: "done one", status: "completed" },
			{ content: "done two", status: "completed" },
		])
		expect(todoTabLines(done, W)).toEqual([])
	})
})

const stripFor = (activeTab: "main" | "todo", innerWidth = W - 2) =>
	dockTabStripLayout({ mainLabel: "1 main", todoLabel: "2 todo", activeTab, innerWidth })

describe("powerline strip — cell widths (no hard-coded 11/24)", () => {
	test("segment + arrow + segment + arrow, all measured with stringWidth", () => {
		const strip = stripFor("main")
		expect(strip.cells.map((cell) => cell.text)).toEqual([" 🏠 1 main ", "\ue0b0", " 📋 2 todo ", "\ue0b0"])
		expect(stringWidth("🏠")).toBe(2)
		expect(stringWidth("📋")).toBe(2)
		expect(stringWidth("\ue0b0")).toBe(1)
		expect(strip.stripWidth).toBe(stringWidth(" 🏠 1 main ") + 1 + stringWidth(" 📋 2 todo ") + 1)
		expect(strip.stripWidth).toBe(24)
	})
})

describe("tab-bar mouse hit zone (last row, right-aligned, cells drive hit)", () => {
	const box = { screenX: 10, screenY: 5, width: W, height: 10 }
	const strip = stripFor("main")

	test("framed: every column of every cell, arrows inert, bottom border tolerant", () => {
		const row = box.screenY + box.height - 2
		const start = box.screenX + 1 + (box.width - 2) - strip.rightPadding - strip.stripWidth
		let cursor = start
		for (const cell of strip.cells) {
			const cellWidth = stringWidth(cell.text)
			for (let dx = 0; dx < cellWidth; dx++) {
				expect(dockTabAtPosition(cursor + dx, row, box, true, strip)).toBe(cell.tab)
			}
			cursor += cellWidth
		}
		expect(cursor).toBe(box.screenX + box.width - 1 - strip.rightPadding)
		// framed tolerance: the bottom border row is also clickable
		expect(dockTabAtPosition(start, row + 1, box, true, strip)).toBe("main")
		expect(dockTabAtPosition(start, row - 1, box, true, strip)).toBeUndefined()
		expect(dockTabAtPosition(start - 1, row, box, true, strip)).toBeUndefined()
		expect(dockTabAtPosition(cursor, row, box, true, strip)).toBeUndefined()
	})

	test("compact: origin shifts with the box, last row only, no border tolerance", () => {
		const compactBox = { screenX: 3, screenY: 5, width: W, height: 8 }
		const compactStrip = stripFor("main", W - 3)
		const row = compactBox.screenY + compactBox.height - 1
		const start = compactBox.screenX + compactBox.width - compactStrip.rightPadding - compactStrip.stripWidth
		expect(dockTabAtPosition(start, row, compactBox, false, compactStrip)).toBe("main")
		// arrow cell (immediately after the 11-column main segment) is inert
		expect(dockTabAtPosition(start + stringWidth(compactStrip.cells[0]!.text), row, compactBox, false, compactStrip)).toBeUndefined()
		expect(dockTabAtPosition(start + 12, row, compactBox, false, compactStrip)).toBe("todo")
		expect(dockTabAtPosition(start, row + 1, compactBox, false, compactStrip)).toBeUndefined()
		expect(dockTabAtPosition(start, row - 1, compactBox, false, compactStrip)).toBeUndefined()
	})
})

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

describe("rendered mouse hit zones (real renderer)", () => {
	const width = 80
	const strip = " 🏠 1 main \ue0b0 📋 2 todo \ue0b0"
	const renderedRows = todoRows([
		{ content: "map the incident", status: "completed" },
		{ content: "write the regression", status: "in_progress" },
		{ content: "ship the gate", status: "pending" },
	])
	// Independent painted geometry at 80 columns: two 11-column label cells,
	// two 1-column arrows, P=2. Do not derive these from dockTabStripLayout.
	const framedLeft = width - 1 - 2 - 24 // 53: right border - P - strip
	const framedMainX = framedLeft + 5 // 58
	const framedArrowX = framedLeft + 11 // 64
	const framedTodoX = framedLeft + 17 // 70
	const framedTailArrowX = framedLeft + 23 // 76
	const compactLeft = width - 2 - 24 // 54: no border, P=2
	const compactMainX = 58
	const compactArrowX = compactLeft + 11 // 65
	const compactTodoX = 70
	const todoTreeLines = 4 // header + three todos
	const framedStripY = 1 + todoTreeLines // top border + tree, then strip
	const compactMainStripY = 2 + todoTreeLines // two rule rows + tree, then strip
	const compactTodoStripY = todoTreeLines // todo tab drops the two rule rows

	test("framed: rendered labels switch, both arrows stay inert", async () => {
		expect([framedLeft, framedMainX, framedArrowX, framedTodoX, framedTailArrowX]).toEqual([53, 58, 64, 70, 76])
		resetActivityDockTab()
		const setup = await testRender(
			() => createComponent(WidgetsDock, { rows: renderedRows, turnActive: () => true }),
			{ width, height: 60, useMouse: true },
		)
		const lineAt = (y: number) => setup.captureSpans().lines[y]?.spans.map((span) => span.text).join("") ?? ""
		const expectedStripRow = `┃${" ".repeat(width - 4 - stringWidth(strip))}${strip}  ┃`
		try {
			markPanelActive("activity")
			await sleep(300) // frame latch + height tween
			await setup.renderOnce()
			expect(activityDockTab()).toBe("main")
			expect(lineAt(framedStripY)).toBe(expectedStripRow)
			expect(lineAt(framedStripY + 1)).toContain("┗")

			await setup.mockMouse.click(framedTodoX, framedStripY)
			await setup.renderOnce()
			expect(activityDockTab()).toBe("todo")

			await setup.mockMouse.click(framedArrowX, framedStripY)
			await setup.renderOnce()
			expect(activityDockTab()).toBe("todo")
			await setup.mockMouse.click(framedTailArrowX, framedStripY)
			await setup.renderOnce()
			expect(activityDockTab()).toBe("todo")

			await setup.mockMouse.click(framedMainX, framedStripY)
			await setup.renderOnce()
			expect(activityDockTab()).toBe("main")
		} finally {
			await setup.dispose()
		}
	})

	test("compact: rendered labels switch in both directions, separator arrow stays inert", async () => {
		expect([compactLeft, compactMainX, compactArrowX, compactTodoX]).toEqual([54, 58, 65, 70])
		resetActivityDockTab()
		const setup = await testRender(
			() => createComponent(WidgetsDock, { rows: renderedRows, turnActive: () => true }),
			{ width, height: 24, useMouse: true },
		)
		const lineAt = (y: number) => setup.captureSpans().lines[y]?.spans.map((span) => span.text).join("") ?? ""
		const expectedStripRow = `${" ".repeat(width - 2 - stringWidth(strip))}${strip}  `
		try {
			markPanelActive("activity")
			await sleep(300) // frame latch + height tween
			await setup.renderOnce()
			expect(activityDockTab()).toBe("main")
			expect(lineAt(compactMainStripY)).toBe(expectedStripRow)

			await setup.mockMouse.click(compactArrowX, compactMainStripY)
			await setup.renderOnce()
			expect(activityDockTab()).toBe("main")

			await setup.mockMouse.click(compactTodoX, compactMainStripY)
			await setup.renderOnce()
			expect(activityDockTab()).toBe("todo")
			// The todo tab drops both rule rows, so the same painted strip moves up.
			expect(lineAt(compactTodoStripY)).toBe(expectedStripRow)

			await setup.mockMouse.click(compactMainX, compactTodoStripY)
			await setup.renderOnce()
			expect(activityDockTab()).toBe("main")
			expect(lineAt(compactMainStripY)).toBe(expectedStripRow)
		} finally {
			await setup.dispose()
		}
	})
})

describe("width ladder — shrink P before dropping whole content levels", () => {
	test("P=2 → 1 → 0, then L2/L3/L4/L5/L6, never a half-cut name", () => {
		expect(stripFor("main", 26).rightPadding).toBe(2)
		expect(stripFor("main", 25).rightPadding).toBe(1)
		expect(stripFor("main", 24).rightPadding).toBe(0)
		// 23 columns: L0 fits no P → whole-level degradation starts
		const l2 = stripFor("main", 23)
		expect(l2.stripWidth).toBe(20)
		expect(l2.cells[0]!.text).toBe("🏠 1 main")
		expect(l2.rightPadding).toBe(2)
		expect(stripFor("main", 13).cells[0]!.text).toBe(" 🏠1 ")
		expect(stripFor("main", 9).cells[0]!.text).toBe("🏠1")
		expect(stripFor("main", 5).cells[0]!.text).toBe("1")
		expect(stripFor("main", 3).cells).toEqual([])
	})
})

describe("selection by color, not ASCII brackets", () => {
	test("main selected: solid main segment, arrows bridge the two backgrounds", () => {
		const cells = stripFor("main").cells
		expect(cells.map((cell) => cell.tab)).toEqual(["main", undefined, "todo", undefined])
		expect(cells[0]!.bg).toBe(SKIN_FALLBACK.tabSelectedBg)
		expect(cells[0]!.fg).toBe(SKIN_FALLBACK.tabSelectedFg)
		expect(cells[2]!.bg).toBe(SKIN_FALLBACK.tabUnselectedBg)
		expect(cells[1]!.fg).toBe(cells[0]!.bg)
		expect(cells[1]!.bg).toBe(cells[2]!.bg)
		expect(cells[3]!.fg).toBe(cells[2]!.bg)
		expect(cells[3]!.bg).toBeUndefined()
	})

	test("todo selected: identical cells, swapped colors (no focus dimension)", () => {
		const main = stripFor("main").cells
		const todo = stripFor("todo").cells
		expect(todo.map((cell) => cell.text)).toEqual(main.map((cell) => cell.text))
		expect(todo[0]!.bg).toBe(SKIN_FALLBACK.tabUnselectedBg)
		expect(todo[2]!.bg).toBe(SKIN_FALLBACK.tabSelectedBg)
		expect(todo[3]!.fg).toBe(SKIN_FALLBACK.tabSelectedBg)
	})

	test("labels are bracket-free; icons never enter i18n strings", () => {
		expect(activityDockTabLabels("main", "1 main", "2 todo")).toEqual({ main: "1 main", todo: "2 todo" })
		expect(activityDockTabLabels("todo", "1 main", "2 todo")).toEqual({ main: "1 main", todo: "2 todo" })
	})
})
