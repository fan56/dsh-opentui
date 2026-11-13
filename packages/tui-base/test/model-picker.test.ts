/**
 * A4 model-picker favorites/hidden layer (gap-analysis C14, dsh-tui-pi
 * selectors.ts pickModel parity): the pure row-assembly/toggle semantics,
 * plus the /model command's f/h wiring — every toggle persists immediately
 * through the config seam, and the reactive getOptions source reflects the
 * toggles (favorites pinned to the top with a ★ prefix).
 */
import { describe, expect, test } from "bun:test"
import {
	buildModelPickerRows,
	modelKey,
	narrowStringList,
	readModelPrefsFromConfig,
	toggleStringList,
} from "../src/routes/session/model-picker"
import { coreCommands, type PickOneExtras, type SlashCommandContext } from "../src/routes/session/commands"
import type { SessionSeam } from "../src/seams/session"

const CATALOG = [
	{ providerID: "bigmodel", modelID: "glm-5.3-flash" },
	{ providerID: "deepseek", modelID: "v3.2" },
	{ providerID: "anthropic", modelID: "claude-x" },
]

describe("model-picker pure helpers", () => {
	test("modelKey composes provider/id", () => {
		expect(modelKey("bigmodel", "glm-5.3-flash")).toBe("bigmodel/glm-5.3-flash")
	})

	test("toggleStringList appends then removes (new array, input untouched)", () => {
		const list = ["a"]
		const next = toggleStringList(list, "b")
		expect(next).toEqual(["a", "b"])
		expect(toggleStringList(next, "b")).toEqual(["a"])
		expect(list).toEqual(["a"])
	})

	test("narrowStringList drops non-strings and non-arrays", () => {
		expect(narrowStringList(["a", 1, "b", null])).toEqual(["a", "b"])
		expect(narrowStringList(undefined)).toEqual([])
		expect(narrowStringList("nope")).toEqual([])
	})

	test("readModelPrefsFromConfig degrades malformed fields to empty lists", () => {
		expect(readModelPrefsFromConfig(undefined)).toEqual({ favoriteModels: [], hiddenModels: [] })
		expect(
			readModelPrefsFromConfig({ favoriteModels: "a/b", hiddenModels: ["x/y", 3] }),
		).toEqual({ favoriteModels: [], hiddenModels: ["x/y"] })
	})

	test("buildModelPickerRows pins favorites (★, Favorites header) above the uncategorized rest", () => {
		const rows = buildModelPickerRows(CATALOG, ["deepseek/v3.2"], [], {
			providerID: "bigmodel",
			modelID: "glm-5.3-flash",
		})
		expect(rows.map((r) => r.title)).toEqual([
			"★ deepseek/v3.2",
			"bigmodel/glm-5.3-flash",
			"anthropic/claude-x",
		])
		expect(rows[0]?.category).toBe("Favorites")
		expect(rows[0]?.description).toBeUndefined()
		expect(rows.find((r) => r.value === "bigmodel/glm-5.3-flash")?.description).toBe("current")
		expect(rows.slice(1).every((r) => r.category === undefined)).toBe(true)
	})

	test("buildModelPickerRows keeps favorites in the persisted join order", () => {
		const rows = buildModelPickerRows(
			CATALOG,
			["deepseek/v3.2", "anthropic/claude-x"],
			[],
		)
		expect(rows.slice(0, 2).map((r) => r.value)).toEqual(["deepseek/v3.2", "anthropic/claude-x"])
		expect(rows.slice(0, 2).every((r) => r.category === "Favorites")).toBe(true)
	})

	test("buildModelPickerRows lists hidden models last under a Hidden header (the h-again recovery path)", () => {
		const rows = buildModelPickerRows(CATALOG, [], ["bigmodel/glm-5.3-flash"])
		const last = rows[rows.length - 1]
		expect(last?.title).toBe("bigmodel/glm-5.3-flash")
		expect(last?.category).toBe("Hidden")
		expect(rows.filter((r) => r.category === "Hidden")).toHaveLength(1)
	})

	test("buildModelPickerRows skips stale keys and keeps a favorite out of Hidden", () => {
		const rows = buildModelPickerRows(CATALOG, ["ghost/missing", "deepseek/v3.2"], ["deepseek/v3.2"])
		expect(rows.some((r) => r.value === "ghost/missing")).toBe(false)
		expect(rows.filter((r) => r.title.startsWith("★")).map((r) => r.value)).toEqual(["deepseek/v3.2"])
		expect(rows.filter((r) => r.category === "Hidden")).toEqual([])
	})
})

/** Extras-capturing fake ctx: the /model f/h presses are driven by hand. */
function makeModelPickCtx(config: Record<string, unknown>, pickAnswer: string | undefined) {
	const saved: Record<string, unknown>[] = []
	let seamConfig = { ...config }
	const seam = {
		lastSelectionError: () => undefined,
		modelCatalog: async () => CATALOG,
		currentModelSelection: async () => ({ providerID: "bigmodel", modelID: "glm-5.3-flash" }),
		selectModel: async () => {},
		configLoad: () => seamConfig,
		configSave: (patch: Record<string, unknown>) => {
			saved.push(patch)
			seamConfig = { ...seamConfig, ...patch }
			return seamConfig
		},
	} as unknown as SessionSeam
	const lines: string[] = []
	const picks: { extras?: PickOneExtras; options: { title: string; category?: string }[] }[] = []
	const ctx: SlashCommandContext = {
		seam,
		say: (text) => lines.push(text),
		clear: () => {},
		reload: () => {},
		quit: () => {},
		refreshFooter: () => {},
		pickOne: async (_title, options, _header, _current, extras) => {
			picks.push({ extras, options })
			return pickAnswer
		},
	}
	return { ctx, lines, picks, saved, seamConfig: () => seamConfig }
}

describe("/model f/h wiring (A4)", () => {
	test("stage-1 opens with extras armed and no prefs keeps the flat face", async () => {
		const { ctx, picks, saved } = makeModelPickCtx({}, "deepseek/v3.2")
		await coreCommands()
			.find((c) => c.name === "/model")!
			.run(ctx, "")
		expect(picks).toHaveLength(1)
		expect(picks[0]?.extras?.actions?.map((a) => a.command)).toEqual([
			"model.picker.favorite",
			"model.picker.hide",
		])
		// The initial rows arrive through the static options arg (no prefs):
		// plain titles, current marked.
		expect(picks[0]?.options.map((o) => o.title)).toEqual([
			"bigmodel/glm-5.3-flash",
			"deepseek/v3.2",
			"anthropic/claude-x",
		])
		// No toggle, no write.
		expect(saved).toEqual([])
	})

	test("f press toggles favorite, persists immediately, and getOptions pins it on top", async () => {
		const { ctx, picks, saved } = makeModelPickCtx({}, "deepseek/v3.2")
		await coreCommands()
			.find((c) => c.name === "/model")!
			.run(ctx, "")
		const extras = picks[0]?.extras
		expect(extras?.onAction).toBeDefined()
		extras!.onAction!("model.picker.favorite", "deepseek/v3.2")
		// Immediate persistence (one write per press, both keys carried).
		expect(saved).toEqual([{ favoriteModels: ["deepseek/v3.2"], hiddenModels: [] }])
		// The reactive source re-reads the live state: favorite pinned on top.
		const rows = extras!.getOptions!()
		expect(rows[0]?.title).toBe("★ deepseek/v3.2")
		expect(rows[0]?.category).toBe("Favorites")
		expect(rows.slice(1).map((r) => r.title)).toEqual(["bigmodel/glm-5.3-flash", "anthropic/claude-x"])
		// Toggle off un-favorites and persists the removal.
		extras!.onAction!("model.picker.favorite", "deepseek/v3.2")
		expect(saved[1]).toEqual({ favoriteModels: [], hiddenModels: [] })
		expect(extras!.getOptions!().every((r) => r.category !== "Favorites")).toBe(true)
	})

	test("h press hides, persists, and the Hidden section keeps the row recoverable", async () => {
		const { ctx, picks, saved } = makeModelPickCtx({}, undefined)
		await coreCommands()
			.find((c) => c.name === "/model")!
			.run(ctx, "")
		const extras = picks[0]!.extras!
		extras.onAction!("model.picker.hide", "bigmodel/glm-5.3-flash")
		expect(saved).toEqual([{ favoriteModels: [], hiddenModels: ["bigmodel/glm-5.3-flash"] }])
		const rows = extras.getOptions!()
		const hiddenRow = rows[rows.length - 1]
		expect(hiddenRow?.title).toBe("bigmodel/glm-5.3-flash")
		expect(hiddenRow?.category).toBe("Hidden")
		// h again restores (toggle semantics, tui-pi parity).
		extras.onAction!("model.picker.hide", "bigmodel/glm-5.3-flash")
		expect(saved[1]).toEqual({ favoriteModels: [], hiddenModels: [] })
		expect(extras.getOptions!().every((r) => r.category !== "Hidden")).toBe(true)
	})

	test("h is refused on a favorite row (disabled callback + onAction guard)", async () => {
		const { ctx, picks, saved } = makeModelPickCtx(
			{ favoriteModels: ["deepseek/v3.2"] },
			undefined,
		)
		await coreCommands()
			.find((c) => c.name === "/model")!
			.run(ctx, "")
		const extras = picks[0]!.extras!
		const hide = extras.actions!.find((a) => a.command === "model.picker.hide")!
		expect(hide.disabled?.("deepseek/v3.2")).toBe(true)
		expect(hide.disabled?.("bigmodel/glm-5.3-flash")).toBe(false)
		// Belt-and-braces: even a pressed h on a favorite persists nothing.
		extras.onAction!("model.picker.hide", "deepseek/v3.2")
		expect(saved).toEqual([])
		expect(extras.getOptions!().every((r) => r.category !== "Hidden")).toBe(true)
	})

	test("prefs are seeded from the config seam and persist onto it", async () => {
		const { ctx, picks, saved, seamConfig } = makeModelPickCtx(
			{ favoriteModels: ["anthropic/claude-x"], hiddenModels: ["deepseek/v3.2"] },
			undefined,
		)
		await coreCommands()
			.find((c) => c.name === "/model")!
			.run(ctx, "")
		// The seeded favorites shape the opening rows (the static options arg).
		expect(picks[0]?.options.map((o) => o.title)).toEqual([
			"★ anthropic/claude-x",
			"bigmodel/glm-5.3-flash",
			"deepseek/v3.2",
		])
		// One more favorite lands after the seeded one and persists both keys.
		picks[0]!.extras!.onAction!("model.picker.favorite", "bigmodel/glm-5.3-flash")
		expect(saved).toEqual([
			{ favoriteModels: ["anthropic/claude-x", "bigmodel/glm-5.3-flash"], hiddenModels: ["deepseek/v3.2"] },
		])
		expect(seamConfig().favoriteModels).toEqual(["anthropic/claude-x", "bigmodel/glm-5.3-flash"])
	})
})
