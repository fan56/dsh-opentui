/**
 * Slash palette (batch 8) — the rebuilt replacement for the old ShellHost
 * inline "/"-autocomplete menu. Pattern chosen: the OLD INLINE PALETTE
 * (render rows above the composer, keys intercepted in the composer's
 * onKeyDown), NOT the batch-5 vendored-dialog overlay host. Why:
 *
 *   1. Focus law. The palette must filter AS THE USER TYPES ("/lo" → rows
 *      shrink live). A DialogSelect on the vendored dialog stack steals
 *      focus to its own input on open and re-captures it on close; the
 *      typed-so-far buffer would live in a second editor. The old app's
 *      palette kept ONE editor (the buffer stays in the textarea) and so
 *      does this one — zero focus juggling, zero DialogProvider churn.
 *   2. The old ShellHost paletteKeyFilter pattern maps 1:1 onto the batch-4
 *      composer's existing onKeyDown/onSubmit interception points.
 *
 * The controller is renderer-free (unit-testable): the composer's key
 * filter calls `sync(buffer)` on every key, decides visibility/filter from
 * the buffer, and consumes up/down/enter/tab/escape while open. Rendering
 * is a fixed-height rows box the composer hosts above its textarea
 * (OpenTUI law: the composer's root height adds `height()`).
 */
import { For, Show, createSignal } from "solid-js"
import type { KeyEvent } from "@opentui/core"
import { useThemeOptional } from "../../context/theme"
import { currentRowColors } from "../../skin/semantic"
import type { SessionSeam } from "../../seams/session"
import type { SlashCommand, SlashCommandContext } from "./commands"
import { coreCommands, dispatchLine, filterCommands, unknownCommandRow } from "./commands"
import { completeSlash } from "./slash-complete"
import { carrySlashHooks } from "./slash-deps"
import { createCommandUsage, type CommandUsageView } from "./slash-usage"
import { isSkillCommand, paletteRowAttributes } from "./skills-source"

/**
 * Max rows shown before the list clamps (the old menu's cap) — and, since the
 * stable-height fix, the FIXED height of the open palette box regardless of
 * how many results the filter leaves (unmatched rows show the box background).
 * A count-tracking height resized the composer root on every keystroke
 * (global reflow, border flicker per keystroke — skin-flicker-analysis.md,
 * family 1). Exported for the height-stability tests.
 */
export const MAX_ROWS = 10

/**
 * Rendered box height while the palette is open: MAX_ROWS command rows plus
 * one RESERVED row that carries the `… N more` overflow hint (blank padding
 * when everything fits). Constant — the stable-height law is unchanged.
 */
export const PALETTE_ROWS = MAX_ROWS + 1

/**
 * The overflow hint for a result list past the visible cap. `offset` is the
 * first visible row, so the hint reports BOTH hidden edges: rows scrolled off
 * the top ("… N more above") and rows still below the window ("… N more").
 * The below-only shape stays byte-identical to the old single-sided hint
 * (the 80×24 verify gate and the FT fixture match `… N more`).
 */
export function overflowHint(total: number, offset = 0): string | undefined {
	if (total <= MAX_ROWS) return undefined
	const maxOffset = total - MAX_ROWS
	const above = Math.min(Math.max(0, offset), maxOffset)
	const below = Math.max(0, total - above - MAX_ROWS)
	const parts: string[] = []
	if (above > 0) parts.push(`… ${above} more above`)
	if (below > 0) parts.push(`… ${below} more`)
	return parts.length > 0 ? parts.join(" · ") : undefined
}

/**
 * Final ordering rule: executable commands first, then skills (the skills
 * boundary from skills-source.ts — a skill's `run` is never executed, so it
 * must never outrank an executable row). Within each tier: executions DESC,
 * then name ASC (case-insensitive; a prefix sorts before its extension, so
 * `/session` sits just before `/sessions`). No executions yet = pure
 * alphabetical — the default list is deterministic, not registry order.
 */
function compareCommands(a: SlashCommand, b: SlashCommand, usage: CommandUsageView | undefined): number {
	const ta = isSkillCommand(a) ? 1 : 0
	const tb = isSkillCommand(b) ? 1 : 0
	if (ta !== tb) return ta - tb
	const ca = usage?.count(a.name) ?? 0
	const cb = usage?.count(b.name) ?? 0
	if (ca !== cb) return cb - ca
	const la = a.name.toLowerCase()
	const lb = b.name.toLowerCase()
	if (la !== lb) return la < lb ? -1 : 1
	// Same word, different case: keep it deterministic.
	return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

/** Renderer-free palette state: visibility, filter query, selection, window. */
export class SlashPaletteController {
	// Solid signal tuples (createSignal returns [get, set]).
	#rows = createSignal(0)
	#selected = createSignal(0)
	// First VISIBLE row of the ordered match list (scroll window origin).
	#offset = createSignal(0)
	#query = createSignal("")
	#usage: CommandUsageView | undefined
	// Esc sticks the menu closed until the buffer CHANGES again (old rule:
	// "esc closes the menu explicitly; any further typed edit reopens it") —
	// otherwise the still-"/"-prefixed buffer would instantly re-arm it.
	#suppressed = false
	#lastBuffer = ""

	/** `usage` supplies the execution counts for the frequent-first order;
	 * absent = pure alphabetical (tests, seams without a config face). */
	constructor(usage?: CommandUsageView) {
		this.#usage = usage
	}

	/** The rendered box height: PALETTE_ROWS while open (STABLE-HEIGHT), 0 = closed. */
	rows(): number {
		return this.#rows[0]()
	}
	/** Number of commands matching the current query, BEFORE the visible cap
	 * (the overflow hint reads this). */
	matches(commands: SlashCommand[]): number {
		return this.ordered(commands).length
	}
	/** Selected index into the FULL ordered match list (0-based, not the window). */
	selected(): number {
		return this.#selected[0]()
	}
	/** First visible row of the ordered match list (window origin). */
	offset(): number {
		return this.#offset[0]()
	}
	/** The current filter query ("" when closed). */
	query(): string {
		return this.#query[0]()
	}
	/** Is the window-relative row at `index` the highlighted one? */
	isRowActive(index: number): boolean {
		return index + this.#offset[0]() === this.#selected[0]()
	}

	/**
	 * Re-derive open/closed + query from the live buffer. Called on every
	 * composer key; a buffer that stops with "/" keeps the menu open (any
	 * further typed edit re-arms), anything else closes it.
	 */
	sync(buffer: string, commands: SlashCommand[]): void {
		if (buffer !== this.#lastBuffer) {
			this.#lastBuffer = buffer
			this.#suppressed = false
		}
		const next = buffer.startsWith("/") && !/\s/.test(buffer) ? buffer : ""
		this.#query[1](next)
		if (!next || this.#suppressed) {
			this.#rows[1](0)
			this.#offset[1](0)
			return
		}
		// FULL match count (not capped): the selection indexes the whole list,
		// the window renders MAX_ROWS of it, and the hint reports both edges.
		// Zero matches = closed (batch V5): the old max(1, count) floor left a
		// 1-row box open with no rows in it ("/zz" painted an empty strip);
		// Enter on such a line resolves through dispatchLine's unknown row.
		// STABLE-HEIGHT (palette flicker fix): any non-zero result renders the
		// FULL PALETTE_ROWS box (MAX_ROWS rows + the reserved overflow-hint
		// row) — the filter only decides WHICH rows paint, never how tall the
		// box is. A count-tracking height resized the composer root per
		// keystroke (9→5→4 …), reflowing the whole screen and flickering the
		// border each key; now the height only transitions at open
		// (0→PALETTE_ROWS) and close (→0, incl. a zero-match query, batch V5).
		const count = this.ordered(commands).length
		this.#rows[1](count > 0 ? PALETTE_ROWS : 0)
		this.#selected[1]((current) => Math.min(current, Math.max(0, count - 1)))
		this.#follow(count)
	}

	/**
	 * The ordered VISIBLE rows: the filtered list (alphabetical / frequent
	 * first) sliced to the MAX_ROWS window starting at `offset`. This is the
	 * single row-count authority: the <For> renders exactly this list and the
	 * highlight compares `index + offset`, so the selection can walk the whole
	 * match list while the box height stays fixed.
	 */
	filtered(commands: SlashCommand[]): SlashCommand[] {
		const all = this.ordered(commands)
		const start = Math.min(this.#offset[0](), Math.max(0, all.length - MAX_ROWS))
		return all.slice(start, start + MAX_ROWS)
	}

	/** The FULL ordered match list (sorting applied, not windowed). */
	ordered(commands: SlashCommand[]): SlashCommand[] {
		const list = filterCommands(commands, this.#query[0]()).slice()
		list.sort((a, b) => compareCommands(a, b, this.#usage))
		return list
	}

	/** Selection move with wrap over the FULL list (old palette wrap, now
	 * covering the rows hidden past the window). */
	move(delta: number, commands: SlashCommand[]): void {
		const count = this.ordered(commands).length
		if (count === 0) return
		const n = this.#selected[0]()
		this.#selected[1]((n + delta + count) % count)
		this.#follow(count)
	}

	/** PgUp/PgDn: move one MAX_ROWS page, clamped (no wrap past the edges). */
	movePage(direction: -1 | 1, commands: SlashCommand[]): void {
		const count = this.ordered(commands).length
		if (count === 0) return
		const next = this.#selected[0]() + direction * MAX_ROWS
		this.#selected[1](Math.min(Math.max(0, next), count - 1))
		this.#follow(count)
	}

	/** Home/End: jump to the first/last match. */
	moveEdge(edge: "home" | "end", commands: SlashCommand[]): void {
		const count = this.ordered(commands).length
		if (count === 0) return
		this.#selected[1](edge === "home" ? 0 : count - 1)
		this.#follow(count)
	}

	/** The highlighted command, if any. */
	current(commands: SlashCommand[]): SlashCommand | undefined {
		return this.filtered(commands)[this.#selected[0]() - this.#offset[0]()]
	}

	/** Esc: close but keep the buffer (old behavior — the editor keeps its
	 * text); stays closed until the next buffer edit re-arms it. */
	close(): void {
		this.#suppressed = true
		this.#query[1]("")
		this.#rows[1](0)
		this.#offset[1](0)
	}

	get open(): boolean {
		return this.rows() > 0
	}

	/** Keep the selected row inside the window (window follows selection). */
	#follow(count: number): void {
		if (count === 0) {
			this.#offset[1](0)
			return
		}
		const selected = this.#selected[0]()
		let offset = this.#offset[0]()
		if (selected < offset) offset = selected
		else if (selected >= offset + MAX_ROWS) offset = selected - MAX_ROWS + 1
		const maxOffset = Math.max(0, count - MAX_ROWS)
		this.#offset[1](Math.min(Math.max(0, offset), maxOffset))
	}
}

/** One visible palette row (name + description). */
export interface PaletteRowProps {
	command: SlashCommand
	active: boolean
}

/**
 * The inline rows box. Fixed explicit height (PALETTE_ROWS while open, 0
 * closed — STABLE-HEIGHT: the filter narrows the painted rows, never the box)
 * so the composer's root height arithmetic stays exact and keystrokes don't
 * reflow the screen; unmatched rows leave the box's own background (blank
 * padding). The last row is reserved for the `… N more` overflow hint when
 * the query matches more than MAX_ROWS commands (blank otherwise). The
 * highlight follows the controller's selected signal.
 */
export function SlashPalette(props: {
	controller: SlashPaletteController
	commands: SlashCommand[]
}) {
	const theme = useThemeOptional()
	const color = {
		base: () => theme?.text.base ?? "#e6e6e6",
		muted: () => theme?.text.muted ?? "#565f89",
		background: () => (theme ? theme.decrease(theme.background.raised.base) : "#1a1b26"),
	}
	// Current row = the skin's full-row highlight (skin/semantic.ts, the
	// dialog-select token semantics): whole row swaps background, text goes
	// bold in the row color (was: text-color-only highlight).
	const row = () => currentRowColors(theme ?? undefined)
	return (
		<Show when={props.controller.rows() > 0}>
			<box
				flexShrink={0}
				width="100%"
				height={props.controller.rows()}
				flexDirection="column"
				backgroundColor={color.background()}
				paddingLeft={2}
			>
				<For each={props.controller.filtered(props.commands)}>
					{(command, index) => {
						const active = () => props.controller.isRowActive(index())
						return (
							<box
								height={1}
								flexShrink={0}
								width="100%"
								flexDirection="row"
								backgroundColor={active() ? row().backgroundColor : undefined}
							>
								<text
									flexShrink={0}
									wrapMode="none"
									fg={active() ? row().textColor : color.base()}
									attributes={paletteRowAttributes(command, active())}
								>
									{command.name}{" "}
									{/* The description rides the row's own selected fg when the
									    row is highlighted — the page-muted gray on the focused
									    action background fails contrast (1.31:1 dsh-blue dark,
									    2.28:1 light, 3.32 tokyonight, 3.67 gruvbox; ≥ 4.5 required
									    — skin-semantic.test.ts). Unselected rows keep muted.
									    Skill rows stay italic in both segments (whole-row
									    treatment); command rows keep the plain span. */}
									<span
										style={{
											fg: active() ? row().textColor : color.muted(),
											...(isSkillCommand(command) ? { italic: true } : {}),
										}}
									>
										{command.description}
									</span>
								</text>
							</box>
						)
					}}
				</For>
				{/* Reserved overflow row: `… N more` for rows below the window
				    and/or `… N more above` for rows scrolled off the top; blank
				    box background when everything fits (stable height). */}
				<Show when={overflowHint(props.controller.matches(props.commands), props.controller.offset())}>
					{(hint) => (
						<box height={1} flexShrink={0} width="100%" flexDirection="row">
							<text flexShrink={0} wrapMode="none" fg={color.muted()}>
								{hint()}
							</text>
						</box>
					)}
				</Show>
			</box>
		</Show>
	)
}

/**
 * Page-side glue: the registry + controller + the two composer hooks
 * (batch-4 interception points). `interceptSubmit` is the palette's enter
 * path (a highlighted entry wins over a longest-prefix re-parse of a
 * partial name — "/m" + enter runs /model, old palette parity; a typed
 * argument line re-parses through `dispatchLine`); unknown "/xxx" resolves
 * as the harmless error row, never a model send. Plain text returns false
 * and flows to send/steer as batch 4 built.
 */
/**
 * The deps bag `createSlashHost` accepts — the ONE gate a command hook can
 * enter the host through. `SlashCommandContext` is the dispatch-side
 * contract; this interface is the wiring-side contract. `./slash-deps.ts`
 * (`buildSlashDeps`) is the entry assembly and `test/entry-slash-deps.test.ts`
 * pins that every hook listed there lands here.
 */
export interface SlashHostDeps {
	seam: SessionSeam
	/** Registry override (tests); default = the batch-8 core set. */
	commands?: SlashCommand[]
	say(text: string): void
	clear(): void
	reload(): void
	quit(): void
	pickOne: SlashCommandContext["pickOne"]
	/** /login chained-form text prompt (batch H4); absent = /login says unavailable. */
	promptText?: SlashCommandContext["promptText"]
	/** /btw overlay opener (feature batch F3); absent = /btw says unavailable. */
	openBtw?: (argText: string) => void
	/** Theme-switch surface (batch F7a); absent = /theme says unavailable. */
	themes?: SlashCommandContext["themes"]
	/** /search FTS overlay opener (batch H3); absent = /search says unavailable. */
	openSearch?: SlashCommandContext["openSearch"]
	/** /plugins panel opener (batch H3); absent = /plugins keeps the listing. */
	openPlugins?: SlashCommandContext["openPlugins"]
	/** /agents manager opener (tui-pi agents manager parity); absent = /agents
	 * says "not mounted in this entry" (the pre-fix symptom: the entry passed
	 * the hook, this deps type/ctx spread never carried it). */
	openAgents?: SlashCommandContext["openAgents"]
	/** Footer-refresh hook (footer-quickwins); absent = setting commands skip
	 * the immediate footer re-read (turn-end-only refresh, the old behavior). */
	refreshFooter?: SlashCommandContext["refreshFooter"]
	/** Footer-refresh cancellation (review 3.5); absent = /think keeps the
	 * accept-then-refresh order (old hosts). */
	invalidateFooter?: SlashCommandContext["invalidateFooter"]
}

export function createSlashHost(deps: SlashHostDeps) {
	const commands = deps.commands ?? coreCommands()
	// Execution counts (frequent-first ordering). Reads the profile config at
	// construction and re-saves on every dispatch; both legs degrade silently
	// (slash-usage.ts) so a missing config face keeps the session-scoped count.
	const usage = createCommandUsage(deps.seam)
	const controller = new SlashPaletteController(usage)
	const ctx: SlashCommandContext = {
		seam: deps.seam,
		say: deps.say,
		clear: deps.clear,
		reload: deps.reload,
		quit: deps.quit,
		pickOne: deps.pickOne,
		// Every optional hook is carried through ONE shared, exhaustively
		// checked list (./slash-deps.ts). The /agents bug was a hand-written
		// spread here that silently dropped a hook the deps type declared.
		...carrySlashHooks(deps),
	}

	function run(command: SlashCommand, argText: string): boolean {
		// THE counting point: an actual dispatch (exact/abbreviated/argument
		// line). Highlighting or Tab-completing a row never reaches here.
		usage.record(command.name)
		void command.run(ctx, argText)
		return true
	}

	return {
		commands,
		controller,
		/**
		 * Tab completion (./slash-complete.ts). `cursor` is the caret as a
		 * code-unit index into `buffer`; undefined = Tab is not ours (plain
		 * text / argument phase / mid-token caret) and must fall through to
		 * the textarea's native handling. A returned value always consumes
		 * Tab — `text === buffer` is the "no matches, do nothing" consume
		 * (the literal tab never lands in the editor).
		 *
		 * Re-syncs before deciding: a history recall writes the buffer with
		 * `setText` (no content change, so no `slashSync`), leaving the
		 * controller on the pre-recall query/selection. The sync makes the
		 * highlight read below describe the buffer being completed.
		 *
		 * The highlighted row is only consulted while the menu is actually
		 * open: after Esc the controller is suppressed, so the pure rule falls
		 * back to the first candidate instead of an invisible highlight.
		 */
		slashComplete(buffer: string, cursor: number): { text: string; cursor: number } | undefined {
			controller.sync(buffer, commands)
			const selected = controller.open ? controller.current(commands)?.name : undefined
			return completeSlash(buffer, cursor, commands, selected === undefined ? {} : { selected })
		},
		slashKeyFilter(event: KeyEvent, buffer: string): boolean {
			controller.sync(buffer, commands)
			if (!controller.open) return false
			if (event.name === "up" || event.name === "down") {
				event.preventDefault()
				controller.move(event.name === "up" ? -1 : 1, commands)
				return true
			}
			// Page navigation over the FULL match list (the window follows):
			// PgUp/PgDn one MAX_ROWS page, Home/End the list edges.
			if (event.name === "pageup" || event.name === "pagedown") {
				event.preventDefault()
				controller.movePage(event.name === "pageup" ? -1 : 1, commands)
				return true
			}
			if (event.name === "home" || event.name === "end") {
				event.preventDefault()
				controller.moveEdge(event.name === "home" ? "home" : "end", commands)
				return true
			}
			if (event.name === "escape") {
				event.preventDefault()
				controller.close()
				return true
			}
			return false
		},
		interceptSubmit(buffer: string, apply?: (text: string) => void): boolean {
			controller.sync(buffer, commands)
			// Capture the highlighted row BEFORE close(): close() resets the
			// query, so a later current() would read the unfiltered first row
			// and turn every abbreviation into "/help". The filtered highlight
			// is what the documented "/m" + Enter → /model path needs.
			const highlighted = controller.current(commands)
			controller.close()
			// Exact-name precedence (parity with dispatchLine's rule): a buffer
			// that IS a command's full name runs THAT command, regardless of the
			// palette highlight — otherwise typing "/session" and hitting enter
			// executes the highlighted "/sessions" (the longer prefix row sorts
			// ahead in the table) and opens the Resume picker instead of the
			// info panel. Abbreviations ("/m") still resolve through the
			// highlight below; a closed menu (arguments present) re-parses
			// through dispatch.
			const needle = buffer.trim().toLowerCase()
			const exact = commands.find((command) => command.name.toLowerCase() === needle)
			// Skill rows resolve exactly like commands, then deliberately fall
			// through (false): the composer sends the typed `/name` line to the
			// model untouched, where the host's skill gesture injects the body.
			// Running a skill row here would swallow the gesture as a no-op.
			if (exact) return isSkillCommand(exact) ? false : run(exact, "")
			// A visible menu is always a pure slash prefix (a space closes it),
			// so the highlighted entry IS the line's command — "/m" + enter runs
			// /model, not "unknown /m". A closed menu means the line carries
			// arguments ("/model provider/id") and re-parses through dispatch.
			if (highlighted) {
				if (!isSkillCommand(highlighted)) return run(highlighted, "")
				// Skill highlight: expand the abbreviation before submitting
				// (pi-tui's editor applies the selected completion on Enter, so
				// "/cro" + Enter sends "/cron " — a raw "/cro" would not match
				// the host's /name gesture). An exact name needs no rewrite.
				if (needle !== highlighted.name.toLowerCase()) apply?.(`${highlighted.name} `)
				return false
			}
			const dispatch = dispatchLine(commands, buffer)
			if (dispatch.kind === "command") {
				return isSkillCommand(dispatch.command) ? false : run(dispatch.command, dispatch.argText)
			}
			if (dispatch.kind === "unknown") {
				deps.say(unknownCommandRow(dispatch.name))
				return true
			}
			return false
		},
	}
}
