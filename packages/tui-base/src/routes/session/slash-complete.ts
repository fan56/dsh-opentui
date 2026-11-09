/**
 * Slash-command Tab completion (fish-style) — the renderer-free decision core
 * the composer's priority-1 keymap layer and the palette host share.
 *
 * Semantics (all paths are pure; the composer applies `text` + `cursor` and
 * the palette re-derives its own open/filter state from the new buffer):
 *
 *   - Only a NAME-phase buffer completes: the whole buffer is exactly one
 *     "/token" (no whitespace, so multi-line drafts and "/cmd arg" lines are
 *     untouched) and the caret is at the token end.
 *   - 0 matches     → consume Tab but change nothing. The literal tab must
 *     never reach the textarea ("/zz" + Tab stays "/zz").
 *   - Exact full name (case-insensitive) → the canonical name + a TRAILING
 *     SPACE, caret at end, menu closes. Same landing as a unique match, so
 *     Tab and Enter agree on the same line: "/session" + Tab gives
 *     "/session " (Enter runs /session), never "/sessions" — fish model,
 *     not bash menu-complete. The command table carries no argument
 *     metadata, so every command gets the separator (dsh-tui-pi's
 *     applyCompletion does the same); a no-argument command just ignores it.
 *   - 1 match       → "/cmd " with the trailing separator.
 *   - N matches with a longer common prefix → extend to the common prefix,
 *     menu stays open, selection not moved (pins "/s" → "/se").
 *   - N matches, no extension, not a full name → accept the palette's
 *     highlighted row (fallback: the first candidate) with the trailing
 *     space, menu closes.
 *
 * No state is carried: one deterministic step per call, derived purely from
 * the buffer (and, for the accept step, the palette's visible highlight).
 */
import type { SlashCommand } from "./commands"
import { filterCommands } from "./commands"

/** What the composer should do with Tab. */
export type SlashCompletion = {
	/** Replacement buffer. */
	text: string
	/** Caret offset after the replacement (code-unit index into `text`). */
	cursor: number
}

export type SlashCompleteOptions = {
	/** The palette's highlighted row (only when the menu is open). Consulted
	 * when the token cannot be extended. */
	selected?: string
}

/** True when the buffer is exactly one "/command-name" token: "/" + no
 * whitespace. "…" and a leading token keep the old Tab behavior. */
export function isSlashNamePhase(input: string): boolean {
	return input.startsWith("/") && !/\s/.test(input)
}

/** Longest common prefix of the candidate names, code-unit safe (a mismatch
 * always lands on a boundary where both strings differ, never mid-pair). */
function commonPrefix(names: string[]): string {
	if (names.length === 0) return ""
	let prefix = names[0]!
	for (const name of names.slice(1)) {
		let i = 0
		while (i < prefix.length && i < name.length && prefix[i] === name[i]) i++
		prefix = prefix.slice(0, i)
		if (prefix.length === 0) break
	}
	return prefix
}

/**
 * One Tab press. `cursor` is the caret position as a code-unit index into
 * `input`. `undefined` = not a slash name phase, let the key fall through
 * (plain text, multi-line, argument phase, caret mid-token). A returned value
 * ALWAYS consumes the key — `text === input` is the deliberate "no matches,
 * do nothing" case.
 */
export function completeSlash(
	input: string,
	cursor: number,
	commands: readonly SlashCommand[],
	options: SlashCompleteOptions = {},
): SlashCompletion | undefined {
	// Name phase only, and only at the token end: completing a mid-token
	// caret would clobber the tail the user is still positioned in.
	if (!isSlashNamePhase(input) || cursor !== input.length) return undefined

	const candidates = filterCommands(commands, input)

	// No match: swallow Tab, rewrite nothing (never a literal tab).
	if (candidates.length === 0) return { text: input, cursor }

	const needle = input.toLowerCase()

	// Exact full name: finish like a unique match (trailing separator), so
	// Tab never drifts to a longer same-prefix sibling ("/session" stays
	// "/session " even though "/sessions" shares the prefix).
	const exact = candidates.find((command) => command.name.toLowerCase() === needle)
	if (exact) {
		const text = `${exact.name} `
		return { text, cursor: text.length }
	}

	// Unique: finish with the argument separator; the menu closes via sync
	// (a space leaves the name phase).
	if (candidates.length === 1) {
		const name = candidates[0]!.name
		const text = `${name} `
		return { text, cursor: text.length }
	}

	// Several candidates: extend the token while a longer common prefix
	// exists. The palette stays open and its selection does not move.
	const prefix = commonPrefix(candidates.map((command) => command.name))
	if (prefix.length > input.length && prefix.toLowerCase().startsWith(needle)) {
		return { text: prefix, cursor: prefix.length }
	}

	// Nothing to extend and the token is not a name yet: accept the
	// highlighted row (menu open) or the first candidate (menu closed).
	const selected = options.selected
		? candidates.find((command) => command.name === options.selected)
		: undefined
	const name = (selected ?? candidates[0]!).name
	const text = `${name} `
	return { text, cursor: text.length }
}
