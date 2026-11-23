/**
 * R2 activity-panel tabs — pure/state contract tests (no renderer).
 * Preregistered expectations: .proof/r2-dock-tabs/00-preregistered-expected.md
 *   E1 default tab = main; E2 main tab == existing merged view; E3 todo tab
 *   (mouse + alt+2) renders width-fitted todo tree; E4 alt+1 returns to main;
 *   E5 empty/cleared todos yield zero lines.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { MouseButton, type MouseEvent } from "@opentui/core"
import { bundledLocalesDir, loadLocales, setLanguages } from "@dsh-opentui/i18n"
import { TuiKeybind } from "../src/config/keybind"
import type { SeamRow } from "../src/routes/session/seam-rows"
import {
	activityDockTab,
	activityDockTabLabels,
	dockTabAtPosition,
	dockTabBarLayout,
	mainTabLines,
	onDockTabMouseUp,
	resetActivityDockTab,
	selectActivityDockTab,
	todoTabLines,
} from "../src/routes/session/widgets-dock"
import { lineWidth, mergedDockLines, type MergedDockData } from "../src/routes/session/merged-dock"

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

describe("tab-bar mouse hit zone (title row)", () => {
	test("clicks on each tab label select that tab; outside is a no-op", () => {
		const layout = dockTabBarLayout(W, "1 main", "2 todo", "")
		const screenX = 10
		const screenY = 5
		// title starts at screenX + 2 (┏ + mandatory ━)
		expect(dockTabAtPosition(screenX + 2, screenY, screenX, screenY, layout)).toBe("main")
		const todoStart = 6 + 2 // "1 main" width + the two-space separator
		expect(dockTabAtPosition(screenX + 2 + todoStart, screenY, screenX, screenY, layout)).toBe("todo")
		// generous 2-row height; below that nothing
		expect(dockTabAtPosition(screenX + 3, screenY + 1, screenX, screenY, layout)).toBe("main")
		expect(dockTabAtPosition(screenX + 3, screenY + 2, screenX, screenY, layout)).toBeUndefined()
		expect(dockTabAtPosition(screenX + 2 + 30, screenY, screenX, screenY, layout)).toBeUndefined()
	})
})

describe("tab bar width law (no clipToWidth re-crop)", () => {
	test("layout parts fill exactly innerWidth display columns", () => {
		const layout = dockTabBarLayout(W, "1 main", "2 todo", "activity · 1/3")
		const total =
			lineWidth({ kind: "todo", segments: [{ text: layout.mainLabel, tone: "muted" }] }) +
			lineWidth({ kind: "todo", segments: [{ text: layout.between, tone: "muted" }] }) +
			lineWidth({ kind: "todo", segments: [{ text: layout.todoLabel, tone: "muted" }] }) +
			lineWidth({ kind: "todo", segments: [{ text: layout.tailGap + layout.tail, tone: "muted" }] })
		expect(total).toBe(W)
	})
})

describe("B2c-2 — active tab ASCII [] marker (shared by framed + compact)", () => {
	test("the active tab label alone is bracketed; both states are exact", () => {
		expect(activityDockTabLabels("main", "1 main", "2 todo")).toEqual({ main: "[1 main]", todo: "2 todo" })
		expect(activityDockTabLabels("todo", "1 main", "2 todo")).toEqual({ main: "1 main", todo: "[2 todo]" })
	})

	test("CJK locale labels are bracketed too (ASCII brackets around the whole label)", () => {
		expect(activityDockTabLabels("main", "1 主面板", "2 待办")).toEqual({ main: "[1 主面板]", todo: "2 待办" })
		expect(activityDockTabLabels("todo", "1 主面板", "2 待办")).toEqual({ main: "1 主面板", todo: "[2 待办]" })
	})

	test("hit zones track the bracketed labels (width-derived, no hard-code)", () => {
		// main active: main label is 8 cols incl. brackets.
		const mainActive = activityDockTabLabels("main", "1 main", "2 todo")
		const layoutMain = dockTabBarLayout(W, mainActive.main, mainActive.todo, "")
		expect(dockTabAtPosition(2, 0, 0, 0, layoutMain)).toBe("main") // inside "[1 main]"
		const todoAt = 2 + lineWidth({ kind: "todo", segments: [{ text: "[1 main]" + layoutMain.between, tone: "muted" }] })
		expect(dockTabAtPosition(todoAt, 0, 0, 0, layoutMain)).toBe("todo")

		// todo active: brackets migrate to the todo label; its zone grows by 2.
		const todoActive = activityDockTabLabels("todo", "1 main", "2 todo")
		const layoutTodo = dockTabBarLayout(W, todoActive.main, todoActive.todo, "")
		expect(dockTabAtPosition(2, 0, 0, 0, layoutTodo)).toBe("main")
		const todoAt2 = 2 + lineWidth({ kind: "todo", segments: [{ text: "1 main" + layoutTodo.between, tone: "muted" }] })
		expect(dockTabAtPosition(todoAt2, 0, 0, 0, layoutTodo)).toBe("todo")
		expect(dockTabAtPosition(todoAt2 + lineWidth({ kind: "todo", segments: [{ text: "[2 todo]", tone: "muted" }] }), 0, 0, 0, layoutTodo)).toBeUndefined()
	})
})
