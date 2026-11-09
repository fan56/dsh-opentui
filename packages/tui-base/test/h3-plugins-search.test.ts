/**
 * Batch H3 pure helpers: the sessions-search hit line formatting and the
 * plugins-panel filter/table line helpers (tui-pi 77 parity surface —
 * table-testable without a renderer, the commands.test.ts law).
 */
import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { formatSearchHitLine } from "../src/routes/session/sessions-search"
import {
	filterPluginRows,
	formatPluginLine,
	pluginsPanelOpen,
	usePluginsPanelOpenState,
} from "../src/routes/session/plugins-panel"

describe("sessions-search helpers", () => {
	test("hit line joins id and snippet through an em dash", () => {
		expect(formatSearchHitLine({ id: "ses_1", snippet: "hello world" })).toBe("ses_1 — hello world")
	})

	test("empty snippet renders the bare id", () => {
		expect(formatSearchHitLine({ id: "ses_2", snippet: "" })).toBe("ses_2")
	})

	test("snippet whitespace collapses", () => {
		expect(formatSearchHitLine({ id: "s", snippet: "a\n  b\tc" })).toBe("s — a b c")
	})
})

describe("plugins-panel helpers", () => {
	const rows = [
		{ name: "dsh-tui-pi", version: "2.7.0" },
		{ name: "pkg-b", version: "0.1.0" },
	]

	test("table line is name@version", () => {
		expect(formatPluginLine(rows[0]!)).toBe("dsh-tui-pi@2.7.0")
	})

	test("empty filter passes every row through", () => {
		expect(filterPluginRows(rows, "")).toEqual(rows)
		expect(filterPluginRows(rows, "   ")).toEqual(rows)
	})

	test("filter narrows on a case-insensitive substring of name@version", () => {
		expect(filterPluginRows(rows, "dsh-tui-pi")).toEqual([rows[0]])
		expect(filterPluginRows(rows, "TUI-PI@2")).toEqual([rows[0]])
		expect(filterPluginRows(rows, "nope")).toEqual([])
	})
})

describe("plugins-panel open-state lifetime", () => {
	test("unmount resets the /plugins open signal so the sidebar Esc layer recovers", () => {
		const dispose = createRoot((dispose) => {
			const [open, setOpen] = usePluginsPanelOpenState()
			setOpen(true)
			expect(open()).toBe(true)
			return dispose
		})
		dispose()
		expect(pluginsPanelOpen()).toBe(false)
	})
})
