/**
 * U4 panelHeight unit pins: the /settings gear for the activity panel size
 * (dsh-tui-pi parity: 1 / 5 / 7 / 10 / all).
 *
 *   - the config validator accepts ONLY the five gear spellings;
 *   - boot replay restores the gear and silently REJECTS an invalid stored
 *     value (the default sizing keeps running — the hints-line fail-open law);
 *   - the geometry resolver (2026-11-19; defaults revised in
 *     settings-defaults-029): unset gear = the 5-line product default, except
 *     short terminals where compact degradation wins; numeric gears cap the
 *     THINK block at N lines (≤ 10), `all` is a legacy spelling that means 10;
 *     the tool block is NEVER gear-driven and the 2/3-of-rows growth rule and
 *     halfBudget clamp are GONE;
 *   - the scene table (A = running subagent, B = visible think, C = neither)
 *     drives think/tool line counts in `dockBlocks`;
 *   - the settings write plan merges the profile's session slice (configSave
 *     merges top-level keys shallowly), `default` unsets the key, and a
 *     non-contract value is REJECTED (never written to the profile);
 *   - applySettingsLive flips the gear signal on the
 *     `session.activity_panel_height` write key (the hot-apply contract).
 */
import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { bundledLocalesDir, loadLocales, setLanguages } from "@dsh-opentui/i18n"
import {
	ACTIVITY_PANEL_GEARS,
	DEFAULT_ACTIVITY_PANEL_GEAR,
	activityPanelCapSpec,
	activityPanelGear,
	activityPanelHeightFromConfig,
	applyActivityPanelConfig,
	dockBlocks,
	setActivityPanelGear,
	type ActivityPanelGear,
} from "../src/routes/session/widgets-dock"
import { DEFAULT_FOOTER_HINTS } from "../src/routes/session/hints-line"
import { applySettingsLive, planLocalWrite, type SettingsItem } from "../src/routes/session/settings-panel"
import { COMPOSER_COMPACT_TERMINAL_ROWS } from "../src/skin/semantic"
import type { SeamRow } from "../src/routes/session/seam-rows"

// The write-plan rejection copy resolves through `t()`: boot the bundled
// registry so the en-literal assertion stays hermetic (settings-panel.test
// parity).
beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages)
})

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

	test("an invalid stored value silently keeps the default (the fail-open law)", () => {
		// P2-2: replay runs BEFORE the first frame — stderr noise there can
		// corrupt a raw-mode first paint, so the rejection is silent (the
		// applyHintsConfig/applyI18nConfig contract).
		applyActivityPanelConfig({ session: { activity_panel_height: "42" } })
		expect(gearOf()).toBeUndefined()
	})
})

describe("activityPanelCapSpec", () => {
	// settings-defaults-029 —必要更新透明记录（旧 criterion 逐字保留）：
	//   old: activityPanelCapSpec(undefined, 24) === {maxLines:1}  —— 不变（compact 优先）
	//   old: activityPanelCapSpec(undefined, 45) === {maxLines:2}  —— 更新为 5
	//   old: activityPanelCapSpec(undefined, 60) === {maxLines:3}  —— 更新为 5
	//   old: activityPanelCapSpec(undefined, undefined) === {maxLines:3} —— 更新为 5
	// 旧断言未删除，只改期望值；断言强度（exact equality）不降。
	test("unset gear = the 5-line product default, EXCEPT on short terminals (compact wins)", () => {
		expect(DEFAULT_ACTIVITY_PANEL_GEAR).toBe("5")
		expect(activityPanelCapSpec(undefined, 24)).toEqual({ maxLines: 1 })
		expect(activityPanelCapSpec(undefined, COMPOSER_COMPACT_TERMINAL_ROWS)).toEqual({ maxLines: 1 })
		expect(activityPanelCapSpec(undefined, 45)).toEqual({ maxLines: 5 })
		expect(activityPanelCapSpec(undefined, 60)).toEqual({ maxLines: 5 })
		expect(activityPanelCapSpec(undefined, undefined)).toEqual({ maxLines: 5 })
		// An explicit legacy gear still wins over the new default.
		expect(activityPanelCapSpec("7", 60)).toEqual({ maxLines: 7 })
	})

	test("short terminals leave the gear inert (the rule-bar contract wins)", () => {
		for (const gear of ACTIVITY_PANEL_GEARS) {
			expect(activityPanelCapSpec(gear, COMPOSER_COMPACT_TERMINAL_ROWS)).toEqual({ maxLines: 1 })
			expect(activityPanelCapSpec(gear, 20)).toEqual({ maxLines: 1 })
		}
	})

	test("numeric gears cap ONLY the think block at N lines (≤ 10)", () => {
		expect(activityPanelCapSpec("1", 60)).toEqual({ maxLines: 1 })
		expect(activityPanelCapSpec("5", 60)).toEqual({ maxLines: 5 })
		expect(activityPanelCapSpec("7", 60)).toEqual({ maxLines: 7 })
		expect(activityPanelCapSpec("10", 60)).toEqual({ maxLines: 10 })
		// No geometry: a numeric gear still applies.
		expect(activityPanelCapSpec("10", undefined)).toEqual({ maxLines: 10 })
	})

	test("`all` is a legacy spelling that means 10 (no 2/3 growth, no budget)", () => {
		expect(activityPanelCapSpec("all", 60)).toEqual({ maxLines: 10 })
		expect(activityPanelCapSpec("all", 31)).toEqual({ maxLines: 10 })
		expect(activityPanelCapSpec("all", undefined)).toEqual({ maxLines: 10 })
		// The old combined-budget field is gone entirely.
		expect(activityPanelCapSpec("all", 60).totalMaxLines).toBeUndefined()
	})

	test("no halfBudget clamp: gears are capped only by the 10-line ceiling", () => {
		// The old rule clamped gear 10 to half of floor(rows*2/3)-2 (9 at 31/32
		// rows). Since 2026-11-19 the content area is hard-capped at 10 lines in
		// `merged-dock.ts`, never here, and terminal height no longer shrinks it.
		for (const rows of [31, 32, 35, 52, 60]) {
			expect(activityPanelCapSpec("10", rows)).toEqual({ maxLines: 10 })
		}
		expect(activityPanelCapSpec("7", 31)).toEqual({ maxLines: 7 })
	})
})

describe("2026-11-19 scene table in dockBlocks", () => {
	const NOW = 1_000_000
	const think = (lines = 5): SeamRow => ({
		key: "reasoning:scene",
		kind: "reasoning",
		text: Array.from({ length: lines }, (_, index) => `think-${index + 1}`).join("\n"),
		final: true,
		startedAt: NOW - 2000,
		elapsedSec: 2,
	})
	const tool = (index: number): SeamRow => ({
		key: `tool:live:scene-${index}`,
		kind: "tool",
		name: `tool-${index}`,
		args: "",
		status: "running",
		startedAt: NOW,
	})
	const subagent: SeamRow = {
		key: "subagents:scene",
		kind: "subagents",
		children: [{ id: "a", label: "agent", status: "running", rounds: 1, startedAt: NOW }],
	}

	test("scene B (visible think, no running subagent) hides tool entirely", () => {
		const blocks = dockBlocks([think(), tool(1), tool(2)], {
			now: NOW,
			decorated: false,
			maxLines: 3,
			thinkMaxLines: 7,
		})
		expect(blocks.think).toHaveLength(5)
		expect(blocks.tool).toHaveLength(0)
	})

	test("scene A (running subagent) keeps think AND tool at one line each", () => {
		const blocks = dockBlocks([think(), tool(1), tool(2), subagent], {
			now: NOW,
			decorated: false,
			maxLines: 3,
			thinkMaxLines: 7,
		})
		expect(blocks.think).toHaveLength(1)
		expect(blocks.tool).toHaveLength(1)
	})

	test("scene C (no subagent, no visible think) keeps the fixed tool cap", () => {
		// 3000ms past the stop anchor: the think row has left retention.
		const blocks = dockBlocks([think(), tool(1), tool(2), tool(3), tool(4)], {
			now: NOW + 3_000,
			decorated: false,
			maxLines: 3,
			thinkMaxLines: 7,
		})
		expect(blocks.think).toHaveLength(0)
		expect(blocks.tool).toHaveLength(3)
		expect(blocks.tool[0]?.text).toContain("tool-2") // newest 3 survive
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

	test("P2-3: a non-contract value is rejected, never written to the profile", () => {
		for (const stray of ["42", "3", "ALL", "ten"]) {
			const plan = planLocalWrite(item, stray, DEFAULT_FOOTER_HINTS)
			expect(plan.ok).toBe(false)
			if (!plan.ok) expect(plan.error).toContain(stray)
		}
	})
})

describe("applySettingsLive session gear case", () => {
	const item: SettingsItem = {
		id: "activityPanelHeight",
		zone: "local",
		label: "activityPanelHeight",
		value: "default",
		source: "config.json · session.activity_panel_height",
		kind: "enum",
		editable: true,
		options: ["default", "1", "5", "7", "10", "all"],
		write: { via: "config", key: "session.activity_panel_height" },
	}

	test("P2-5: a gear write flips the module signal live (no restart)", () => {
		expect(gearOf()).toBeUndefined()
		applySettingsLive(item, "7", DEFAULT_FOOTER_HINTS)
		expect(gearOf()).toBe("7")
		applySettingsLive(item, "1", DEFAULT_FOOTER_HINTS)
		expect(gearOf()).toBe("1")
	})

	test("an unset write clears the signal back to the graded default", () => {
		setActivityPanelGear("5")
		applySettingsLive(item, undefined, DEFAULT_FOOTER_HINTS)
		expect(gearOf()).toBeUndefined()
	})

	test("an invalid applied value fails open to unset (never throws)", () => {
		applySettingsLive(item, "42", DEFAULT_FOOTER_HINTS)
		expect(gearOf()).toBeUndefined()
	})
})
