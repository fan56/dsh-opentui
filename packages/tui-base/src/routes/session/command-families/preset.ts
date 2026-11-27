import type { SeamPresetRow } from "../../../seams/session"

// ---------------------------------------------------------- /preset helpers --
// Batch H2 (tui-pi 60-preset parity). Pure — table-testable like the
// resume-picker helpers.

/**
 * The row `/preset next` would switch to — the roster item after the current
 * selection, wrapping around (tui-pi peekNextPreset semantics). Undefined
 * with 0 or 1 rows (nothing to rotate to). When nothing is current (no
 * session attached yet, or the selection is not in the roster) the anchor is
 * the registry-default row, falling back to the first-listed one.
 */
export function presetNextRow(rows: SeamPresetRow[], currentId: string | undefined): SeamPresetRow | undefined {
	if (rows.length <= 1) return undefined
	const anchorId =
		currentId ?? rows.find((row) => row.isDefault)?.id ?? rows[0]?.id
	const index = rows.findIndex((row) => row.id === anchorId)
	if (index < 0) return rows[0]
	return rows[(index + 1) % rows.length]
}

/** Find a preset by id or display name, case-insensitive (tui-pi
 * findPresetByName semantics, officialName folded into the name). */
export function findPresetRow(rows: SeamPresetRow[], query: string): SeamPresetRow | undefined {
	const needle = query.trim().toLowerCase()
	if (needle === "") return undefined
	return rows.find((row) => row.id.toLowerCase() === needle || row.name.toLowerCase() === needle)
}

/**
 * The footer brand segment's preset label (tui-pi `formatPresetLabel`
 * semantics): the current row's name, else the registry-default row's, else
 * the `standard` entry, else the first-listed one — the footer shows the
 * preset the next session will compose, so at boot (no session yet, nothing
 * staged) the default row is the honest answer. A staged id (`currentId`)
 * that names no listed row means the composed preset is unknown here (a
 * broken row was filtered out, or the preset was deleted): undefined, never
 * another row's name that the session is not actually composed with. Empty
 * roster / no face → undefined (the brand segment stays the plain "dsh").
 */
export function presetLabelFor(rows: SeamPresetRow[], currentId: string | undefined): string | undefined {
	if (rows.length === 0) return undefined
	if (currentId !== undefined) return rows.find((row) => row.id === currentId)?.name
	const marked = rows.find((row) => row.isDefault) ?? rows.find((row) => row.id === "standard")
	return (marked ?? rows[0])?.name
}
