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
import type { SessionSeam } from "../../seams/session"
import type { SlashCommand, SlashCommandContext } from "./commands"
import { coreCommands, dispatchLine, filterCommands, unknownCommandRow } from "./commands"

/** Max rows shown before the list clamps (the old menu's cap). */
const MAX_ROWS = 6

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

	/** Rows to render (0 = closed). */
	rows(): number {
		return this.#rows[0]()
	}
	/** Selected index into the FILTERED list. */
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
		const count = filterCommands(commands, next).length
		// Zero matches = closed (batch V5): the old max(1, count) floor left a
		// 1-row box open with no rows in it ("/zz" painted an empty strip);
		// Enter on such a line resolves through dispatchLine's unknown row.
		this.#rows[1](Math.min(MAX_ROWS, count))
		this.#selected[1]((current) => Math.min(current, Math.max(0, count - 1)))
	}

	/** The filtered rows for the current query. */
	filtered(commands: SlashCommand[]): SlashCommand[] {
		return filterCommands(commands, this.#query[0]())
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
 * The inline rows box. Fixed explicit height (rows or 0 when closed) so the
 * composer's root height arithmetic stays exact; the highlight follows the
 * controller's selected signal.
 */
export function SlashPalette(props: {
	controller: SlashPaletteController
	commands: SlashCommand[]
}) {
	const theme = useThemeOptional()
	const color = {
		active: () => theme?.border.base ?? "#7aa2f7",
		base: () => theme?.text.base ?? "#e6e6e6",
		muted: () => theme?.text.muted ?? "#565f89",
		background: () => (theme ? theme.decrease(theme.background.raised.base) : "#1a1b26"),
	}
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
					{(command, index) => (
						<text
							flexShrink={0}
							fg={index() === props.controller.selected() ? color.active() : color.base()}
						>
							{command.name}{" "}
							<span style={{ fg: color.muted() }}>{command.description}</span>
						</text>
					)}
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
	}

	function run(command: SlashCommand, argText: string): boolean {
		void command.run(ctx, argText)
		return true
	}

	return {
		commands,
		controller,
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
			const highlighted = controller.current(commands)
			controller.close()
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
