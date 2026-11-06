/**
 * /hotkeys panel rows (batch F7b): the static keybind surface, generated
 * from THIS stack's config/keybind.ts Definitions — the vendored schema
 * table is the single source of truth (never a hand-copied tui-pi list;
 * the keybinds differ).
 *
 * Face: the /help print path — aligned transcript lines via ctx.say, no
 * overlay, no busy-gate. Rows are `keys — description`; entries whose
 * default is `none` (declared but unbound) are skipped, and the leader
 * prefix is resolved so `<leader>q` reads as its actual stroke.
 */
import { Definitions, LeaderDefault } from "../../config/keybind"

/** The default leader stroke (config/keybind LeaderDefault). */
export function leaderKey(): string {
	return LeaderDefault
}

/** The panel header line. */
export function hotkeysHeader(): string {
	return "Keybinds (defaults — override via profiles/<profile>/keybindings.json)"
}

/**
 * The panel rows: `keys — description`, definitions order preserved.
 * `none` defaults are skipped; `<leader>` expands to the real stroke.
 */
export function hotkeyRows(): string[] {
	const rows: string[] = []
	for (const [name, definition] of Object.entries(Definitions)) {
		if (definition.default === "none" || definition.default === false) continue
		const keys = String(definition.default).replaceAll("<leader>", `${LeaderDefault} `)
		rows.push(`${keys} — ${definition.description} (${name})`)
	}
	return rows
}
