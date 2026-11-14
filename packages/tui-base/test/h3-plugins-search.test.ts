/**
 * Batch H3 pure helpers: the sessions-search hit line formatting and the
 * plugins-panel filter/table line helpers (tui-pi 77 parity surface —
 * table-testable without a renderer, the commands.test.ts law).
 */
import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { formatSearchHitLine } from "../src/routes/session/sessions-search"
import {
	bundleStateText,
	filterPluginRows,
	formatPluginLine,
	installPreviewLine,
	legacyPluginViews,
	pluginBundleViews,
	pluginChangeNotice,
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

// C1: the /plugins manager's management face — the pure row/notice builders
// the panel renders through (the tui-pi plugins.ts 72-162 parity surface,
// table-testable without a renderer).
describe("plugins-panel bundle views (C1)", () => {
	const bundles = [
		{ name: "dsh-tui-pi", version: "2.7.0", enabled: true, installed: true, optional: false, removable: true },
		{
			name: "dsh-skills-office",
			version: "0.9.1",
			enabled: false,
			installed: false,
			optional: true,
			removable: false,
			readOnlyReason: "management-required",
		},
		{
			name: "broken-bundle",
			version: "1.0.0",
			enabled: true,
			installed: true,
			optional: false,
			removable: true,
			error: "failed to load",
		},
	]

	test("state text reflects the real enablement (on / off / available + badges)", () => {
		const views = pluginBundleViews(bundles)
		expect(bundleStateText(views.find((row) => row.name === "dsh-tui-pi")!)).toBe("on")
		expect(bundleStateText(views.find((row) => row.name === "dsh-skills-office")!)).toBe("available read-only")
		expect(bundleStateText(views.find((row) => row.name === "broken-bundle")!)).toBe("on error")
		const disabled = { ...views.find((row) => row.name === "dsh-tui-pi")!, enabled: false }
		expect(bundleStateText(disabled)).toBe("off")
	})

	test("rows sort alphabetically and toggleable excludes read-only and error rows", () => {
		const views = pluginBundleViews(bundles)
		expect(views.map((row) => row.name)).toEqual(["broken-bundle", "dsh-skills-office", "dsh-tui-pi"])
		expect(views.find((row) => row.name === "dsh-tui-pi")).toMatchObject({ toggleable: true, removable: true })
		expect(views.find((row) => row.name === "dsh-skills-office")).toMatchObject({ toggleable: false, removable: false })
		expect(views.find((row) => row.name === "broken-bundle")).toMatchObject({ toggleable: false })
	})

	test("legacy F7a rows keep the listing honest (loaded = on, nothing toggleable)", () => {
		const views = legacyPluginViews([{ name: "dsh-tui-pi", version: "2.7.0" }])
		expect(views[0]).toMatchObject({ label: "dsh-tui-pi@2.7.0", enabled: true, toggleable: false, removable: false })
		expect(bundleStateText(views[0]!)).toBe("on")
	})
})

describe("pluginChangeNotice (C1 — the restart semantics surface)", () => {
	test("applied states the change is live", () => {
		expect(pluginChangeNotice({ changed: true, application: "applied", target: "dsh-tui-pi" })).toBe(
			"dsh-tui-pi: change applied",
		)
	})

	test("restart-required states the host-restart limitation explicitly", () => {
		expect(pluginChangeNotice({ changed: true, application: "restart-required", target: "dsh-tui-pi" })).toBe(
			"dsh-tui-pi: change saved — restart the host for it to take effect",
		)
	})

	test("failed carries the diagnostic", () => {
		expect(pluginChangeNotice({ changed: false, application: "failed", target: "x", error: "management-required" })).toBe(
			"x: change failed — management-required",
		)
		expect(pluginChangeNotice({ changed: false, application: "overridden", target: "x" })).toContain(
			"higher-priority config",
		)
	})
})

describe("install preview (C1 — the i flow)", () => {
	test("accepted inspection renders name@version + the not-a-bundle caveat", () => {
		expect(installPreviewLine({ status: "accepted", name: "dsh-tui-pi", version: "2.7.0", bundle: true })).toBe(
			"dsh-tui-pi@2.7.0",
		)
		expect(installPreviewLine({ status: "accepted", name: "plain-pkg", bundle: false })).toContain(
			"(not a bundle package",
		)
		expect(installPreviewLine({ status: "accepted", bundle: null })).toBe("spec")
	})
})
