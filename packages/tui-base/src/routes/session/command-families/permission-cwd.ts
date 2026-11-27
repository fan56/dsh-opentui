import type { SeamPermissionCatalog } from "../../../seams/session"

// ------------------------------------------------- /permission helpers (026) --
// Pure + table-testable. Mirrors the web permission-presets `optionsOf` risk
// classification (深读 A2-8): full-access / auto presets get a second
// confirmation with an explicit acknowledge; ordinary presets switch directly.
export function isRiskPermissionPreset(value: string, name?: string): boolean {
	return /danger-full-access|full.?access|auto/i.test(`${value} ${name ?? ""}`)
}

/**
 * 026 — basename of a cwd (深读 #1 `workspaceLabel(cwd)`): last path segment,
 * trailing separators stripped, root `/` preserved. undefined/empty stays
 * undefined (honest absence). Pure + table-testable.
 */
export function cwdBasename(cwd: string | undefined): string | undefined {
	if (cwd === undefined || cwd === "") return undefined
	const trimmed = cwd.replace(/[\\/]+$/, "")
	if (trimmed === "") return cwd // root "/"
	const parts = trimmed.split(/[\\/]/)
	return parts[parts.length - 1] || trimmed
}

/** Bare `/permission` view lines from a catalog. Pure for unit testing.
 *
 *  026 review S1: our seam has NO readable current-session preset face. rc.5
 *  does register a `permissions` projection with `currentValue`, but the bridge
 *  wires `session/observeProjections` only as a raw push stream with no consumer
 *  face — wiring one is a new capability slice, not this one-line fix. So never
 *  label `defaultPreset` as "current" (that lies whenever default !== current,
 *  i.e. after a switch). State only what we can actually read and defer the
 *  current-session value to the host. */
export function permissionCatalogLines(catalog: SeamPermissionCatalog): string[] {
	const names = catalog.options.map((option) => option.value).join(", ")
	const lines = [`available presets: ${names}`]
	for (const option of catalog.options) {
		const detail = option.description === undefined || option.description === "" ? "" : ` — ${option.description}`
		lines.push(`${option.value}${detail}`)
	}
	lines.push(`default preset: ${catalog.defaultPreset}`)
	lines.push("current session preset is host-authoritative (not readable here); use /permission <preset> to set it")
	return lines
}
