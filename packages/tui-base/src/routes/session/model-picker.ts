/**
 * Pure model-list assembly for the /model picker's favorite/hidden layer
 * (gap-analysis C14; dsh-tui-pi `src/model-list.ts` parity — the same
 * ordering/toggle semantics, adapted to the opentui pickOne row shape).
 *
 * No TUI imports: every function here is plain data-in/data-out, so the
 * ordering, toggle and config-narrowing semantics stay unit-testable
 * without a renderer (test/model-picker.test.ts).
 */

/** One catalog row the /model command receives from the seam. */
export interface ModelPickerEntry {
	providerID: string
	modelID: string
}

/** One pickOne option row (the extras.getOptions shape, category included). */
export interface ModelPickerRow {
	title: string
	value: string
	description?: string
	/** Section header (DialogSelect category). Empty/undefined = no header. */
	category?: string
}

/** Persisted favorite/hidden model keys (`provider/id` composites). */
export interface ModelPrefs {
	favoriteModels: string[]
	hiddenModels: string[]
}

/** Composite settings key of a model route: `${providerID}/${modelID}`. */
export function modelKey(providerID: string, modelID: string): string {
	return `${providerID}/${modelID}`
}

/**
 * Toggle `key` in `list`: remove when present, append when absent (join
 * order = favorite order, the persisted form). Returns a new array; the
 * input is never mutated.
 */
export function toggleStringList(list: readonly string[], key: string): string[] {
	return list.includes(key) ? list.filter((entry) => entry !== key) : [...list, key]
}

/** Narrow an unknown config value into a string[] (non-strings dropped). */
export function narrowStringList(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
}

/**
 * Read the favorite/hidden lists off a merged `configLoad()` face (tui-pi
 * `readModelPrefs` parity): malformed/missing fields degrade to empty
 * lists, so a seam without the keys keeps the pre-A4 flat picker.
 */
export function readModelPrefsFromConfig(config: Record<string, unknown> | undefined): ModelPrefs {
	return {
		favoriteModels: narrowStringList(config?.favoriteModels),
		hiddenModels: narrowStringList(config?.hiddenModels),
	}
}

/**
 * Assemble the stage-1 picker rows (gap-analysis C14; dsh-tui-pi
 * `buildModelRows` favorites/hidden structure), top to bottom:
 *
 * 1. favorites — `★ provider/id` rows under a "Favorites" category header,
 *    in the join order of the persisted list (the user's own ordering);
 * 2. the remaining models, uncategorized, in the seam's catalog order (the
 *    pre-A4 face — no reordering when no prefs exist);
 * 3. the hidden models under a "Hidden" header — the recovery path: the
 *    rows stay visible and selectable, and pressing `h` again unhides.
 *
 * Stale keys in `favorites`/`hidden` (models no longer in the catalog) are
 * skipped silently.
 */
export function buildModelPickerRows(
	entries: readonly ModelPickerEntry[],
	favorites: readonly string[],
	hidden: readonly string[],
	current?: { providerID: string; modelID: string },
): ModelPickerRow[] {
	const byKey = new Map(entries.map((entry) => [modelKey(entry.providerID, entry.modelID), entry]))
	const hiddenSet = new Set(hidden)

	const row = (entry: ModelPickerEntry, category?: string, star = false): ModelPickerRow => ({
		title: `${star ? "★ " : ""}${entry.providerID}/${entry.modelID}`,
		value: modelKey(entry.providerID, entry.modelID),
		description:
			current !== undefined &&
			current.providerID === entry.providerID &&
			current.modelID === entry.modelID
				? "current"
				: undefined,
		...(category !== undefined ? { category } : {}),
	})

	const favoriteRows = favorites
		.map((key) => byKey.get(key))
		.filter((entry): entry is ModelPickerEntry => entry !== undefined)
		.map((entry) => row(entry, "Favorites", true))

	const normalRows = entries
		.filter((entry) => !favorites.includes(modelKey(entry.providerID, entry.modelID)) && !hiddenSet.has(modelKey(entry.providerID, entry.modelID)))
		.map((entry) => row(entry))

	const hiddenRows = entries
		.filter((entry) => hiddenSet.has(modelKey(entry.providerID, entry.modelID)) && !favorites.includes(modelKey(entry.providerID, entry.modelID)))
		.map((entry) => row(entry, "Hidden"))

	return [...favoriteRows, ...normalRows, ...hiddenRows]
}
