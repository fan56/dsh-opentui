/**
 * U4 panelHeight unit pins: the /settings gear for the activity panel size
 * (dsh-tui-pi parity: 1 / 5 / 7 / 10 / all).
 *
 *   - the config validator accepts ONLY the five gear spellings;
 *   - boot replay restores the gear and REJECTS an invalid stored value with
 *     a warning (the default sizing keeps running);
 *   - the geometry resolver: unset gear = the graded dockLineCap default
 *     byte for byte, short terminals stay inert, numeric gears cap each
 *     block at N lines, `all` runs unbounded under the 2/3 frame budget;
 *   - the combined-budget trim sheds the LONGER block's oldest lines first;
 *   - the settings write plan merges the profile's session slice (configSave
 *     merges top-level keys shallowly) and `default` unsets the key.
 */
import { afterEach, describe, expect, test } from "bun:test"
import {
	ACTIVITY_PANEL_GEARS,
	activityPanelCapSpec,
	activityPanelGear,
	activityPanelHeightFromConfig,
	applyActivityPanelConfig,
	dockBlocks,
	setActivityPanelGear,
	type ActivityPanelGear,
} from "../src/routes/session/widgets-dock"
import { DEFAULT_FOOTER_HINTS } from "../src/routes/session/hints-line"
import { planLocalWrite } from "../src/routes/session/settings-panel"
import { COMPOSER_COMPACT_TERMINAL_ROWS } from "../src/skin/semantic"
import type { SeamRow } from "../src/routes/session/seam-rows"

afterEach(() => {
	setActivityPanelGear(undefined)
})

const gearOf = (): ActivityPanelGear | undefined => activityPanelGear()

describe("activityPanelHeightFromConfig", () => {
	test("accepts exactly the five gear spellings", () => {
		for (const gear of ACTIVITY_PANEL_GEARS) {
			expect(activityPanelHeightFromConfig(gear)).toBe(gear)
		}
	})

	test("rejects typos, numbers, null with undefined", () => {
		expect(activityPanelHeightFromConfig("3")).toBeUndefined()
		expect(activityPanelHeightFromConfig("ALL")).toBeUndefined()
		expect(activityPanelHeightFromConfig(10)).toBeUndefined()
		expect(activityPanelHeightFromConfig(null)).toBeUndefined()
		expect(activityPanelHeightFromConfig(undefined)).toBeUndefined()
		expect(activityPanelHeightFromConfig({ all: true })).toBeUndefined()
	})
})

describe("applyActivityPanelConfig", () => {
	test("restores the gear from config.session before the first paint", () => {
		applyActivityPanelConfig({ session: { activity_panel_height: "7" } })
		expect(gearOf()).toBe("7")
	})

	test("a missing config or session slice leaves the default untouched", () => {
		applyActivityPanelConfig(undefined)
		expect(gearOf()).toBeUndefined()
		applyActivityPanelConfig({})
		expect(gearOf()).toBeUndefined()
		applyActivityPanelConfig({ session: {} })
		expect(gearOf()).toBeUndefined()
	})

	test("an invalid stored value warns and keeps the default", () => {
		const warnings: string[] = []
		const original = console.warn
		console.warn = (message?: unknown) => {
			warnings.push(String(message))
		}
		try {
			applyActivityPanelConfig({ session: { activity_panel_height: "42" } })
		} finally {
			console.warn = original
		}
		expect(gearOf()).toBeUndefined()
		expect(warnings.some((line) => line.includes("activity_panel_height") && line.includes("42"))).toBe(true)
	})
})

describe("activityPanelCapSpec", () => {
	test("unset gear = the graded dockLineCap default, byte for byte", () => {
		expect(activityPanelCapSpec(undefined, 24)).toEqual({ maxLines: 1 })
		expect(activityPanelCapSpec(undefined, 45)).toEqual({ maxLines: 2 })
		expect(activityPanelCapSpec(undefined, 60)).toEqual({ maxLines: 3 })
		expect(activityPanelCapSpec(undefined, undefined)).toEqual({ maxLines: 3 })
	})

	test("short terminals leave the gear inert (the rule-bar contract wins)", () => {
		for (const gear of ACTIVITY_PANEL_GEARS) {
			expect(activityPanelCapSpec(gear, COMPOSER_COMPACT_TERMINAL_ROWS)).toEqual({ maxLines: 1 })
			expect(activityPanelCapSpec(gear, 20)).toEqual({ maxLines: 1 })
		}
	})

	test("numeric gears cap EACH block at N lines", () => {
		expect(activityPanelCapSpec("1", 60)).toEqual({ maxLines: 1 })
		expect(activityPanelCapSpec("5", 60)).toEqual({ maxLines: 5 })
		expect(activityPanelCapSpec("7", 60)).toEqual({ maxLines: 7 })
		expect(activityPanelCapSpec("10", 60)).toEqual({ maxLines: 10 })
		// No geometry: a numeric gear still applies (only `all` needs rows).
		expect(activityPanelCapSpec("10", undefined)).toEqual({ maxLines: 10 })
	})

	test("`all` drops the per-block cap and holds the frame at 2/3 of the rows", () => {
		const spec = activityPanelCapSpec("all", 60)
		expect(spec.totalMaxLines).toBe(Math.floor((60 * 2) / 3) - 2) // 38 content rows
		expect(spec.maxLines).toBeGreaterThan(1000) // unbounded per block
		// Small tall-enough terminals keep a positive budget.
		expect(activityPanelCapSpec("all", 31)?.totalMaxLines).toBe(Math.floor((31 * 2) / 3) - 2)
		// Unknown height degrades to unbounded (no clamp without geometry).
		expect(activityPanelCapSpec("all", undefined)).toEqual({ maxLines: activityPanelCapSpec("all", undefined).maxLines })
		expect(activityPanelCapSpec("all", undefined).totalMaxLines).toBeUndefined()
	})
})

describe("dockBlocks combined budget (the `all` gear trim)", () => {
	const NOW = 1_000_000
	const think = (lines: number): SeamRow => ({
		key: "reasoning:trim",
		kind: "reasoning",
		text: Array.from({ length: lines }, (_, index) => `think-${index + 1}`).join("\n"),
		final: true,
		startedAt: NOW - 2000,
		elapsedSec: 2,
	})
	const tool = (index: number): SeamRow => ({
		key: `tool:live:trim-${index}`,
		kind: "tool",
		name: `tool-${index}`,
		args: "",
		status: "running",
		startedAt: NOW,
	})

	test("the sum never exceeds the budget; the LONGER block sheds first, a tie sheds think", () => {
		const rows: SeamRow[] = [think(5), tool(1), tool(2), tool(3), tool(4), tool(5)]
		const blocks = dockBlocks(rows, { now: NOW, decorated: false, maxLines: 100, totalMaxLines: 6 })
		expect(blocks.think.length + blocks.tool.length).toBe(6)
		// 5+5 → tie sheds think (4+5) → tool sheds (4+4) → tie sheds think
		// (3+4) → tool sheds (3+3): balanced halves.
		expect(blocks.think.length).toBe(3)
		expect(blocks.tool.length).toBe(3)
		// The shed lines are the OLDEST of each block: think keeps its tail,
		// tools keep the newest.
		expect(blocks.think[0]?.text).toContain("think-3")
		expect(blocks.tool[0]?.text).toContain("tool-3")
	})

	test("no budget = no trim (the blocks grow as usual)", () => {
		const rows: SeamRow[] = [think(5), tool(1), tool(2), tool(3), tool(4), tool(5)]
		const blocks = dockBlocks(rows, { now: NOW, decorated: false, maxLines: 100 })
		expect(blocks.think.length).toBe(5)
		expect(blocks.tool.length).toBe(5)
	})
})

describe("planLocalWrite session gear branch", () => {
	const item = {
		id: "activityPanelHeight",
		zone: "local" as const,
		label: "activityPanelHeight",
		value: "default",
		source: "config.json · session.activity_panel_height",
		kind: "enum" as const,
		editable: true,
		options: ["default", "1", "5", "7", "10", "all"],
		write: { via: "config" as const, key: "session.activity_panel_height" },
	}

	test("a gear write merges the profile session slice (siblings survive)", () => {
		const plan = planLocalWrite(item, "10", DEFAULT_FOOTER_HINTS, { verbosity: "high" })
		expect(plan.ok).toBe(true)
		if (plan.ok) {
			expect(plan.patch).toEqual({ session: { verbosity: "high", activity_panel_height: "10" } })
			expect(plan.applied).toBe("10")
		}
	})

	test("`default` (or empty) unsets the key inside the merged slice", () => {
		const plan = planLocalWrite(item, "default", DEFAULT_FOOTER_HINTS, { verbosity: "high", activity_panel_height: "10" })
		expect(plan.ok).toBe(true)
		if (plan.ok) {
			expect(plan.patch).toEqual({ session: { verbosity: "high", activity_panel_height: undefined } })
			expect(plan.applied).toBeUndefined()
		}
		const empty = planLocalWrite(item, "", DEFAULT_FOOTER_HINTS)
		expect(empty.ok).toBe(true)
		if (empty.ok) expect(empty.patch).toEqual({ session: { activity_panel_height: undefined } })
	})

	test("no profile slice still produces a clean session patch", () => {
		const plan = planLocalWrite(item, "5", DEFAULT_FOOTER_HINTS)
		expect(plan.ok).toBe(true)
		if (plan.ok) expect(plan.patch).toEqual({ session: { activity_panel_height: "5" } })
	})
})
