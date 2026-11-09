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
import { TextAttributes } from "@opentui/core"
import { useThemeOptional } from "../../context/theme"
import { currentRowColors } from "../../skin/semantic"
import type { SessionSeam } from "../../seams/session"
import type { SlashCommand, SlashCommandContext } from "./commands"
import { coreCommands, dispatchLine, filterCommands, unknownCommandRow } from "./commands"
import { completeSlash } from "./slash-complete"

/**
 * Max rows shown before the list clamps (the old menu's cap) — and, since the
 * stable-height fix, the FIXED height of the open palette box regardless of
 * how many results the filter leaves (unmatched rows show the box background).
 * A count-tracking height resized the composer root on every keystroke
 * (global reflow, border flicker per keystroke — skin-flicker-analysis.md,
 * family 1). Exported for the height-stability tests.
 */
export const MAX_ROWS = 6

/** Renderer-free palette state: visibility, filter query, selection. */
export class SlashPaletteController {
	// Solid signal tuples (createSignal returns [get, set]).
	#rows = createSignal(0)
	#selected = createSignal(0)
	#query = createSignal("")
	// Esc sticks the menu closed until the buffer CHANGES again (old rule:
	// "esc closes the menu explicitly; any further typed edit reopens it") —
	// otherwise the still-"/"-prefixed buffer would instantly re-arm it.
	#suppressed = false
	#lastBuffer = ""

	/** Rendered box height: MAX_ROWS while open (STABLE-HEIGHT), 0 = closed. */
	rows(): number {
		return this.#rows[0]()
	}
	/** Selected index into the VISIBLE filtered list (see filtered). */
	selected(): number {
		return this.#selected[0]()
	}
	/** The current filter query ("" when closed). */
	query(): string {
		return this.#query[0]()
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
		const next = buffer.startsWith("/") && !buffer.includes(" ") ? buffer : ""
		this.#query[1](next)
		if (!next || this.#suppressed) {
			this.#rows[1](0)
			return
		}
		// CAPPED to MAX_ROWS so every consumer below shares ONE count — the
		// number of VISIBLE rows (see filtered). Cap-preserves the >0 test:
		// any raw match count above 0 stays above 0 after the cap.
		const count = Math.min(filterCommands(commands, next).length, MAX_ROWS)
		// Zero matches = closed (batch V5): the old max(1, count) floor left a
		// 1-row box open with no rows in it ("/zz" painted an empty strip);
		// Enter on such a line resolves through dispatchLine's unknown row.
		// STABLE-HEIGHT (palette flicker fix): any non-zero result renders the
		// FULL MAX_ROWS box — the filter only decides WHICH rows paint, never
		// how tall the box is. A count-tracking height resized the composer
		// root per keystroke (9→5→4 …), reflowing the whole screen and
		// flickering the border each key; now the height only transitions at
		// open (0→MAX_ROWS) and close (→0, incl. a zero-match query, batch V5).
		this.#rows[1](count > 0 ? MAX_ROWS : 0)
		this.#selected[1]((current) => Math.min(current, Math.max(0, count - 1)))
	}

	/**
	 * The VISIBLE rows for the current query — the filtered list CAPPED to
	 * MAX_ROWS (overflow fix). This is the single row-count authority: the
	 * <For> renders exactly this list, move() wraps modulo its length and
	 * current() indexes into it, so the highlight can never land in an
	 * un-rendered row past the fixed-height box (a 9-command table used to
	 * paint all 9 rows out of the 6-row box, overlapping the textarea).
	 */
	filtered(commands: SlashCommand[]): SlashCommand[] {
		return filterCommands(commands, this.#query[0]()).slice(0, MAX_ROWS)
	}

	/** Selection move with wrap (old palette behavior). */
	move(delta: number, commands: SlashCommand[]): void {
		const count = this.filtered(commands).length
		if (count === 0) return
		const n = this.#selected[0]()
		this.#selected[1]((n + delta + count) % count)
	}

	/** The highlighted command, if any. */
	current(commands: SlashCommand[]): SlashCommand | undefined {
		return this.filtered(commands)[this.#selected[0]()]
	}

	/** Esc: close but keep the buffer (old behavior — the editor keeps its
	 * text); stays closed until the next buffer edit re-arms it. */
	close(): void {
		this.#suppressed = true
		this.#query[1]("")
		this.#rows[1](0)
	}

	get open(): boolean {
		return this.rows() > 0
	}
}

/** One visible palette row (name + description). */
export interface PaletteRowProps {
	command: SlashCommand
	active: boolean
}

/**
 * The inline rows box. Fixed explicit height (MAX_ROWS while open, 0 closed —
 * STABLE-HEIGHT: the filter narrows the painted rows, never the box) so the
 * composer's root height arithmetic stays exact and keystrokes don't reflow
 * the screen; unmatched rows leave the box's own background (blank padding).
 * The highlight follows the controller's selected signal.
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
						const active = () => index() === props.controller.selected()
						return (
							<box
								flexShrink={0}
								width="100%"
								flexDirection="row"
								backgroundColor={active() ? row().backgroundColor : undefined}
							>
								<text
									flexShrink={0}
									fg={active() ? row().textColor : color.base()}
									attributes={active() ? TextAttributes.BOLD : undefined}
								>
									{command.name}{" "}
									{/* The description rides the row's own selected fg when the
									    row is highlighted — the page-muted gray on the focused
									    action background fails contrast (1.31:1 dsh-blue dark,
									    2.28:1 light, 3.32 tokyonight, 3.67 gruvbox; ≥ 4.5 required
									    — skin-semantic.test.ts). Unselected rows keep muted. */}
									<span style={{ fg: active() ? row().textColor : color.muted() }}>
										{command.description}
									</span>
								</text>
							</box>
						)
					}}
				</For>
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
export function createSlashHost(deps: {
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
	/** Footer-refresh hook (footer-quickwins); absent = setting commands skip
	 * the immediate footer re-read (turn-end-only refresh, the old behavior). */
	refreshFooter?: SlashCommandContext["refreshFooter"]
	/** Footer-refresh cancellation (review 3.5); absent = /think keeps the
	 * accept-then-refresh order (old hosts). */
	invalidateFooter?: SlashCommandContext["invalidateFooter"]
}) {
	const commands = deps.commands ?? coreCommands()
	const controller = new SlashPaletteController()
	const ctx: SlashCommandContext = {
		seam: deps.seam,
		say: deps.say,
		clear: deps.clear,
		reload: deps.reload,
		quit: deps.quit,
		pickOne: deps.pickOne,
		...(deps.promptText ? { promptText: deps.promptText } : {}),
		...(deps.openBtw ? { openBtw: deps.openBtw } : {}),
		...(deps.themes ? { themes: deps.themes } : {}),
		...(deps.openSearch ? { openSearch: deps.openSearch } : {}),
		...(deps.openPlugins ? { openPlugins: deps.openPlugins } : {}),
		...(deps.refreshFooter ? { refreshFooter: deps.refreshFooter } : {}),
		...(deps.invalidateFooter ? { invalidateFooter: deps.invalidateFooter } : {}),
	}

	function run(command: SlashCommand, argText: string): boolean {
		void command.run(ctx, argText)
		return true
	}

	return {
		commands,
		controller,
		/**
		 * Tab completion (./slash-complete.ts). undefined = Tab is not ours
		 * (plain text / argument phase / mid-token caret) and must fall
		 * through to the textarea's native handling. A returned value always
		 * consumes Tab — `text === buffer` is the "no matches, do nothing"
		 * consume (the literal tab never lands in the editor).
		 *
		 * The highlighted row is only consulted while the menu is actually
		 * open: after Esc the controller is suppressed, so the pure rule falls
		 * back to the first candidate instead of an invisible highlight.
		 */
		slashComplete(buffer: string): { text: string; cursor: number } | undefined {
			const selected = controller.open ? controller.current(commands)?.name : undefined
			const result = completeSlash(buffer, buffer.length, commands, selected === undefined ? {} : { selected })
			if (result === undefined) return undefined
			return { text: result.text, cursor: result.cursor }
		},
		slashKeyFilter(event: KeyEvent, buffer: string): boolean {
			controller.sync(buffer, commands)
			if (!controller.open) return false
			if (event.name === "up" || event.name === "down") {
				event.preventDefault()
				controller.move(event.name === "up" ? -1 : 1, commands)
				return true
			}
			if (event.name === "escape") {
				event.preventDefault()
				controller.close()
				return true
			}
			return false
		},
		interceptSubmit(buffer: string): boolean {
			controller.sync(buffer, commands)
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
			if (exact) return run(exact, "")
			const highlighted = controller.current(commands)
			// A visible menu is always a pure slash prefix (a space closes it),
			// so the highlighted entry IS the line's command — "/m" + enter runs
			// /model, not "unknown /m". A closed menu means the line carries
			// arguments ("/model provider/id") and re-parses through dispatch.
			if (highlighted) return run(highlighted, "")
			const dispatch = dispatchLine(commands, buffer)
			if (dispatch.kind === "command") return run(dispatch.command, dispatch.argText)
			if (dispatch.kind === "unknown") {
				deps.say(unknownCommandRow(dispatch.name))
				return true
			}
			return false
		},
	}
}
