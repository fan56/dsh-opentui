/**
 * U4 panelHeight unit pins: the /settings gear for the activity panel size
 * (dsh-tui-pi parity: 1 / 5 / 7 / 10 / all).
 *
 *   - the config validator accepts ONLY the five gear spellings;
 *   - boot replay restores the gear and silently REJECTS an invalid stored
 *     value (the default sizing keeps running — the hints-line fail-open law);
 *   - the geometry resolver: unset gear = the graded dockLineCap default
 *     byte for byte, short terminals stay inert, numeric gears cap each
 *     block at N lines AND at half the `all` gear's 2/3 content budget,
 *     `all` runs unbounded under the 2/3 frame budget;
 *   - the combined-budget trim sheds the LONGER block's oldest lines first;
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
		// P2-4: literal expectations, not the implementation's own formula —
		// 60 rows → floor(60*2/3) - 2 = 38 content rows.
		expect(spec.totalMaxLines).toBe(38)
		expect(spec.maxLines).toBeGreaterThan(1000) // unbounded per block
		// Small tall-enough terminals keep a positive budget: 31 → 18.
		expect(activityPanelCapSpec("all", 31)?.totalMaxLines).toBe(18)
		// Unknown height degrades to the unbounded sentinel (no clamp without
		// geometry; no budget either).
		expect(activityPanelCapSpec("all", undefined)).toEqual({ maxLines: 1_000_000 })
		expect(activityPanelCapSpec("all", undefined).totalMaxLines).toBeUndefined()
	})

	test("P1: numeric gears also clamp to half the terminal content budget", () => {
		// The `all` budget split between the two blocks: each block gets
		// min(N, floor(budget/2)), budget = floor(rows*2/3) - 2.
		// rows=52 → budget 32, half 16: gear 10 untouched (the verified
		// behavior must not move).
		expect(activityPanelCapSpec("10", 52)).toEqual({ maxLines: 10 })
		// rows=35 → budget 21, half 10: gear 10 still fits exactly.
		expect(activityPanelCapSpec("10", 35)).toEqual({ maxLines: 10 })
		// rows=32 → budget 19, half 9: gear 10 clamps (frame 2+9+9=20 ≤ 2/3).
		expect(activityPanelCapSpec("10", 32)).toEqual({ maxLines: 9 })
		// rows=31 → budget 18, half 9: gear 7 fits, gear 10 clamps.
		expect(activityPanelCapSpec("7", 31)).toEqual({ maxLines: 7 })
		expect(activityPanelCapSpec("10", 31)).toEqual({ maxLines: 9 })
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
