/**
 * SessionComposer — the rebuilt session input area (batch 4), on SessionSeam.
 *
 * Shape follows the vendored textarea composers (component/prompt/index.tsx
 * `<textarea>` and routes/session/form.tsx): a native TextareaRenderable
 * with content-driven height capped by `minHeight`/`maxHeight`, focus taken
 * once the ref publishes, and the skin frame (skin/semantic.ts): four-side
 * border, heavy + accent while focused, single + border.base unfocused,
 * warning while busy; short terminals drop the top/bottom sides. Decision
 * logic (send vs steer, busy, history) lives in ./composer-state.ts.
 *
 * Keys (vendored keybind config: `input.submit` = return, `input.newline` =
 * shift/ctrl/alt+return, ctrl+j). The raw textarea defaults are the reverse
 * (return → newline, meta+return → submit); the vendored app flips them via
 * its keymap layer. This component flips them with the textarea's own
 * `keyBindings` prop, DERIVED from the same config values
 * (./composer-keybinds.ts; batch 6), so it needs no vendored Keymap context
 * and a `keybinds` override reaches it through the `keybinds` prop.
 *
 * Colors: vendored theme tokens via `useThemeOptional()` (batch 6); the
 * pre-batch-6 hex constants are the no-provider fallback.
 *
 *   enter              submit (idle → send a turn; busy → steer)
 *   alt/shift/ctrl+enter, ctrl+j   newline
 *   ↑ at buffer start  recall previous prompt   (vendored prompt.history.previous)
 *   ↓ at buffer end    recall next / back to draft
 *
 * ↑/↓ reach this component two ways. Under the client's Keymap.Provider the
 * layer below binds the CONFIGURED `prompt.history.previous`/`next` strokes,
 * so a config override (e.g. ctrl+p) is honored there. Without a provider
 * (bare FT harness) the textarea onKeyDown fallback matches hardcoded
 * up/down and ignores config overrides.
 *
 * Shell-style recall (aligned with dsh-tui-pi's pi editor navigateHistory and
 * mini/prompt.shared.ts movePromptHistory): the first ↑ stashes the draft
 * (typed or empty), ↑ walks newest → oldest and stops at the oldest, ↓ walks
 * back and past the newest restores the draft (empty draft = "at the bottom,
 * a new message"). A typed single-line draft recalls on the FIRST ↑; on a
 * multi-line draft ↑ still steps the cursor to the line start first so
 * vertical cursor movement is not eaten. While browsing, ↑/↓ at the buffer
 * edges navigate immediately, matching pi.
 *
 * Edge handling: when not browsing, ↑ off offset 0 on the first visual row
 * snaps the cursor to 0 (next ↑ recalls); ↓ off the end on the last visual
 * row snaps to the end. Other rows fall through to native cursor movement.
 *
 * The Keymap.Provider installed by the real client maps ↑/↓ to
 * `input.move.up/down` for the focused textarea and consumes the key BEFORE
 * the renderable's own onKeyDown (a prepended renderer listener that calls
 * preventDefault/stopPropagation). That is why this component registers a
 * priority-1 Keymap layer for the history commands: without it, the native
 * cursor layer swallows ↑/↓ and the onKeyDown fallback below never fires in
 * the app (it only survives in the bare FT harness, which mounts no
 * Keymap.Provider). The layer consults `slashKeyFilter` first, so an open
 * slash palette keeps ↑/↓.
 *
 * Paste: native (TextareaRenderable.handlePaste, bracketed). No custom code.
 *
 * Busy marker: pushed through `onBusyChange` for the status/powerline batch
 * (the footer hint itself is a constant row — flicker mitigation 2).
 *
 * OpenTUI law: the root box gets an explicit height computed from the
 * textarea's reported height (+ footer), never auto-height in a flex column.
 */
import { createSignal, onCleanup, Show, type JSX } from "solid-js"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { measureEditText, RenderableEvents, type KeyEvent, type TextareaRenderable } from "@opentui/core"
import type { SessionSeam } from "../../seams/session"
import { ComposerController, type ComposerHistory } from "./composer-state"
import { composerKeyBindings, type ComposerKeybindConfig } from "./composer-keybinds"
import { useThemeOptional } from "../../context/theme"
import { Keymap } from "../../context/keymap"
import { useCursorStyle } from "../../config"
import {
	COMPOSER_COMPACT_TERMINAL_ROWS,
	SKIN_FOCUS_BLUR_DEBOUNCE_MS,
	composerBorderSides,
	composerLayout,
	skinCursor,
	surfaceBorder,
	warningColor,
} from "../../skin/semantic"

export type SessionComposerRef = {
	/** The textarea's live focused flag (OpenTUI renderable state, not a
	 * cached copy — the login-era bug was a stale flag hiding a blur). */
	focused(): boolean
	focus(): void
}

/** Busy top-border title (contract §1): the steer affordance, warning-tier. */
const STEER_TITLE = " steer "

/** Keys the slash palette can own while open (scroll window + edge jumps).
 * Routed through a pre-binding interceptor: the transcript page layer and the
 * managed textarea home/end bindings would otherwise win the key. */
const PALETTE_NAV_KEYS = new Set(["pageup", "pagedown", "home", "end"])

/** Flicker mitigation 2 (research/skin-flicker-analysis.md 缓解 3): the
 * composer footer hint — the input box's bottom-edge row — is ONE CONSTANT
 * string for idle and busy alike. The old busy↔idle swap repainted the row
 * on every turn boundary (different text/width → full-row redraw). Busy
 * stays visible via the cursor color, the top-border steer title, and the
 * activity frame; this row never changes again. */
export const COMPOSER_FOOTER_HINT = "enter send · while streaming enter steers · alt+enter newline · ↑↓ history"

export type SessionComposerProps = {
	/** Seam used for steering a running turn. */
	seam: SessionSeam
	/** Starts a turn; page wiring passes the transcript projection's `send`. */
	send: (text: string) => Promise<void>
	/** Busy surface for the status/powerline batch. */
	onBusyChange?: (busy: boolean) => void
	/** Injectable history (tests / persistence later). */
	history?: ComposerHistory
	/** Textarea line cap (content-driven height grows up to this). */
	maxHeight?: number
	placeholder?: string
	/** Focus handle for overlay hosts: re-assert focus after a dialog drains. */
	ref?: (ref: SessionComposerRef) => void
	/** Resolved `input.submit` / `input.newline` overrides (vendored config
	 * vocabulary); omitted = vendored defaults. */
	keybinds?: ComposerKeybindConfig
	/** Slash palette (batch 8): key filter consulted before history recall —
	 * true = consumed (up/down move the menu, esc closes it; the filter owns
	 * preventDefault). Plain typing returns false and falls through. */
	slashKeyFilter?: (event: KeyEvent, buffer: string) => boolean
	/** Slash palette re-sync after the buffer actually changed (keydown sees
	 * the PRE-insertion buffer, so visibility/filtering must derive from the
	 * content-change event instead — one-key lag otherwise). */
	slashSync?: (buffer: string) => void
	/** Slash palette enter path: true = the line was a command (harmless
	 * unknowns included) — the composer clears its buffer, no send/steer.
	 * `apply` lets the interception REWRITE the buffer before a fall-through
	 * submit: a skill row resolved from an abbreviation expands to its
	 * canonical `/name ` line (the pi-tui autocomplete applies the selected
	 * completion before Enter submits), and returning false then sends the
	 * rewritten text. */
	interceptSubmit?: (buffer: string, apply?: (text: string) => void) => boolean
	/** Slash Tab completion (fish-style). `cursor` is the caret as a
	 * code-unit index into `buffer` (converted from the textarea's
	 * `cursorOffset`, which is a DISPLAY-cell offset — see completeKey).
	 * undefined = Tab is not ours and falls through to the textarea's native
	 * handling (plain text, argument phase, mid-token caret). A returned value
	 * ALWAYS consumes Tab — `text === buffer` is the "no matches, do nothing"
	 * consume, so a literal tab can never reach the editor on a slash-name
	 * line. */
	slashComplete?: (buffer: string, cursor: number) => { text: string; cursor: number } | undefined
	/** Palette rows rendered above the textarea (inline palette host). */
	slashPalette?: () => JSX.Element
	/** Palette height contribution to the composer's explicit root height. */
	slashHeight?: () => number
	/** Batch D3: false drops the composer's own hint row — the page paints
	 * the key hints on its dedicated last row (./hints-line.tsx). */
	footerHint?: boolean
}

export function SessionComposer(props: SessionComposerProps) {
	const FOOTER_HEIGHT = props.footerHint === false ? 0 : 1
	const renderer = useRenderer()
	const dimensions = useTerminalDimensions()
	const theme = useThemeOptional()
	// useCursorStyle needs the ConfigProvider; the FT harness mounts bare.
	let configCursorStyle: (() => { style?: string; blinking?: boolean }) | undefined
	try {
		configCursorStyle = useCursorStyle()
	} catch {
		configCursorStyle = undefined
	}
	const color = {
		// Skin semantic colors (skin/semantic.ts): focused = heavy + accent,
		// unfocused = single + border.base, busy = warning (instant swap,
		// never animated). bg = decrease(background.raised.base).
		background: () => (theme ? theme.decrease(theme.background.raised.base) : "#1a1b26"),
		text: () => theme?.text.base ?? "#e6e6e6",
		placeholder: () => theme?.text.faint ?? "#565f89",
		hint: () => theme?.text.muted ?? "#565f89",
	}
	const keyBindings = composerKeyBindings(props.keybinds)
	const [busy, setBusy] = createSignal(false)
	const [textareaHeight, setTextareaHeight] = createSignal(1)
	// Visual focus with a debounce on UNFOCUS only (SKIN_FOCUS_BLUR_DEBOUNCE_MS):
	// a dialog close blurs then refocuses the editor a frame later (vendored
	// DialogProvider at 1ms, turn overlays at 3ms) — without the debounce the
	// frame border would flash unfocused for exactly that frame. Focus-in
	// applies immediately; the composer owns focus whenever no overlay does.
	const [visuallyFocused, setVisuallyFocused] = createSignal(true)
	let blurDebounce: ReturnType<typeof setTimeout> | undefined
	let textarea: TextareaRenderable | undefined
	let disposed = false
	onCleanup(() => {
		disposed = true
		if (blurDebounce !== undefined) clearTimeout(blurDebounce)
	})

	// Subagent marker face (batch F6): subscribe for this component's
	// lifetime so the seam adapter keeps folding the live subagent snapshot
	// (with the maxRounds `⚡ injected` / `⏻ hard-stopped @N` markers) into
	// the module store the vendored SubagentsTab picker reads. Both entry
	// faces pass the real seam here, so one subscription feeds both; the
	// listener body is a deliberate no-op — the adapter's fold into
	// subagent-markers.ts IS the reactive write.
	if (props.seam.onSubagentViews) {
		onCleanup(props.seam.onSubagentViews(() => {}))
	}

	const controller = new ComposerController({
		send: (text) => props.send(text),
		steer: (text) => props.seam.steer(text),
		history: props.history,
		onBusyChange: (value) => {
			if (disposed) return
			setBusy(value)
			props.onBusyChange?.(value)
		},
	})

	const measure = (text: string) => measureEditText(text, { widthMethod: renderer.widthMethod })
	/** Caret as a code-unit index into `text`, converted from the textarea's
	 * DISPLAY-cell offset (`cursorOffset`; wide glyphs occupy two cells, so the
	 * two diverge). The end position is exact (that is the guard's hot case);
	 * a mid-token caret only needs to be recognisably not the end, so the
	 * prefix walk may land on a code-point boundary (zero-width combining
	 * marks stay attached). */
	function cursorCharIndex(text: string, cursorOffset: number): number {
		if (cursorOffset >= measure(text)) return text.length
		let cells = 0
		let index = 0
		for (const char of text) {
			if (cells >= cursorOffset) return index
			cells += measure(char)
			index += char.length
		}
		return text.length
	}
	const maxLines = () => props.maxHeight ?? 8

	// Skin cursor: vertical bar (contract §1), blinking, from the user's
	// cursor config (semantic.skinCursor). Bare FT harnesses mount without a
	// ConfigProvider — fall back to the skin default there.
	const cursor = () => skinCursor(configCursorStyle?.())
	// Border state: busy recolors to warning (instant), focus sets the weight.
	const border = () => surfaceBorder({ busy: busy(), focused: visuallyFocused(), theme: theme ?? undefined })
	const busyColor = () => warningColor(theme ?? undefined)

	/**
	 * Content-driven height: the box height is explicit (OpenTUI law), so the
	 * textarea's own height is clamped by it and can't be the source — read
	 * the wrapped (virtual) line count instead, capped to [1, maxHeight].
	 */
	function syncHeight() {
		if (!textarea || textarea.isDestroyed || disposed) return
		const lines = textarea.editorView.getTotalVirtualLineCount()
		setTextareaHeight(Math.min(maxLines(), Math.max(1, lines)))
	}

	function submit() {
		const editor = textarea
		if (!editor || editor.isDestroyed) return
		// Slash commands resolve here (batch 8): the palette's enter path and
		// unknown "/xxx" both come through the intercept; only plain text
		// reaches the send/steer controller. `apply` is the skill fall-through
		// rewrite (abbreviation → canonical `/name `); it mutates only the
		// editor text, and the normal send path below reads it back.
		if (props.interceptSubmit?.(editor.plainText, (text) => editor.setText(text))) {
			editor.setText("")
			syncHeight()
			return
		}
		const result = controller.submit(editor.plainText)
		if (result !== "ignored") editor.setText("")
	}

	/**
	 * One history step. Returns true when this layer handled the key (the
	 * caller/keymap must suppress the native textarea movement).
	 *
	 * Direction -1 = ↑ (newer → older), 1 = ↓ (older → newer → draft).
	 * Browsing state lives in the controller's ComposerHistory; the draft
	 * (text + cursor) is stashed by `history.move` on the first ↑.
	 */
	function recallStep(direction: 1 | -1): boolean {
		if (!textarea || textarea.isDestroyed) return false
		const input = textarea.plainText
		const row = textarea.scrollY + textarea.visualCursor.visualRow
		const browsing = controller.history.browsing
		const virtualRows = textarea.editorView.getTotalVirtualLineCount()

		if (direction === -1) {
			if (textarea.cursorOffset !== 0) {
				// Not on the first visual row: native cursor-up keeps working.
				if (row !== 0) return false
				// A typed MULTI-LINE draft: step the cursor to the line start
				// first (pi parity), the next ↑ recalls. A single-line draft
				// recalls immediately (shell-style), stashing the whole draft.
				if (!browsing && virtualRows > 1) {
					textarea.cursorOffset = 0
					return true
				}
			}
			const step = controller.history.move(-1, input, textarea.cursorOffset)
			if (step === undefined) return false
			textarea.setText(step.text)
			textarea.cursorOffset = step.cursor ?? 0
			return true
		}

		const end = measure(input)
		if (textarea.cursorOffset !== end) {
			// Not on the last visual row: native cursor-down keeps working.
			if (row !== Math.max(0, virtualRows - 1)) return false
			// Same edge rule as ↑: browsing recalls on the edge, the draft
			// slot snaps to the end.
			if (!browsing) {
				textarea.cursorOffset = end
				return true
			}
		}
		const step = controller.history.move(1, input, textarea.cursorOffset)
		if (step === undefined) return false
		textarea.setText(step.text)
		// Draft restore brings its own cursor back (pi restores the whole
		// state); a committed entry lands at the end.
		textarea.cursorOffset = step.cursor ?? measure(step.text)
		return true
	}

	/**
	 * Keymap command body (priority-1 layer, see module comment) — the path
	 * the real client takes. On the bare FT harness (no Keymap.Provider) the
	 * textarea's onKeyDown fallback below runs instead.
	 *
	 * No modifier guard here: the layer binding is the CONFIGURED stroke
	 * (`config.keybinds.get("prompt.history.previous" | "prompt.history.next")`,
	 * default up/down) and the keymap matches strokes exactly, so shift+up or
	 * any other unmapped chord never reaches this body. A guard would instead
	 * silently drop a user override such as `prompt.history.previous = ctrl+p`
	 * on the one path where that override is read.
	 */
	function historyKey(direction: 1 | -1, event: KeyEvent): boolean {
		if (!textarea || textarea.isDestroyed) return false
		// Slash palette owns ↑/↓ while it is open (filter preventDefaults).
		if (props.slashKeyFilter?.(event, textarea.plainText)) return true
		return recallStep(direction)
	}

	/**
	 * Tab completion body (priority-1 keymap layer, the path the real client
	 * takes). The host decides whether the buffer is a slash name phase; a
	 * returned replacement is applied here and the palette re-syncs from the
	 * new buffer (a trailing space closes it, a common prefix keeps it open).
	 * Returns true = Tab consumed (including the "no matches, do nothing"
	 * replacement), false = let the native textarea handle the key.
	 */
	function completeKey(): boolean {
		if (!textarea || textarea.isDestroyed) return false
		const buffer = textarea.plainText
		// `cursorOffset` is a DISPLAY-cell offset (CJK = 2 cells), the pure
		// rule works in code units — convert so the mid-token guard sees the
		// real caret instead of a fabricated buffer end.
		const cursor = cursorCharIndex(buffer, textarea.cursorOffset)
		const result = props.slashComplete?.(buffer, cursor)
		if (result === undefined) return false
		if (result.text !== buffer) {
			textarea.setText(result.text)
			// The setter takes a display offset; result.cursor is a code-unit
			// index, so measure the prefix it points at.
			textarea.cursorOffset = measure(result.text.slice(0, result.cursor))
			// The native setText mutation does not emit a content change, so
			// the palette would otherwise stay on the pre-completion buffer.
			props.slashSync?.(result.text)
			syncHeight()
		}
		return true
	}

	// The real client's Keymap.Provider binds ↑/↓ to native textarea cursor
	// movement and consumes them before the renderable's onKeyDown. This
	// layer (priority 1, the vendored prompt's history-layer priority) runs
	// first so shell-style recall wins; it rejects (returns false) off the
	// buffer edges, letting the managed cursor layer take over.
	const keymap = Keymap.useOptional()
	if (keymap) {
		Keymap.createLayer(() => ({
			priority: 1,
			enabled: () => !!textarea && !textarea.isDestroyed && textarea.focused,
			commands: [
				{
					id: "prompt.history.previous",
					title: "Previous prompt history",
					group: "Prompt",
					bind: "up",
					run: (_input, event) => historyKey(-1, event),
				},
				{
					id: "prompt.history.next",
					title: "Next prompt history",
					group: "Prompt",
					bind: "down",
					run: (_input, event) => historyKey(1, event),
				},
				// Tab rides the SAME priority-1 layer as history for the same
				// reason (see the module comment): the client's Keymap.Provider
				// prepends a renderer keypress listener that consumes keys BEFORE
				// the textarea's onKeyDown. A bare onKeyDown Tab handler is dead in
				// the app while a bare harness keeps passing. The id is the
				// vendored keybind (`prompt.autocomplete.complete`, default tab),
				// so a user override reaches this path through createLayer's
				// configured-binding lookup.
				{
					id: "prompt.autocomplete.complete",
					title: "Complete slash command",
					group: "Prompt",
					bind: "tab",
					run: () => completeKey(),
				},
			],
		}))
		// PgUp/PgDn/Home/End must reach the palette BEFORE the keymap bindings
		// that own them elsewhere: the transcript's page layer (global) and the
		// managed textarea layer (input.line.home/end) are bindings, and their
		// precedence would otherwise swallow the keys while the menu is open
		// (real-client symptom: the palette never scrolled). An interceptor
		// runs ahead of every binding and only consumes when the open palette
		// reports the key as its own; otherwise the normal binding takes it.
		onCleanup(
			keymap.intercept("key", ({ event, consume }) => {
				if (!textarea || textarea.isDestroyed || !textarea.focused) return
				if (!PALETTE_NAV_KEYS.has(event.name)) return
				if (props.slashKeyFilter?.(event, textarea.plainText)) consume()
			}),
		)
	}

	function recall(event: KeyEvent) {
		if (!textarea || textarea.isDestroyed) return
		// Slash palette keys first (batch 8): while the menu is open the
		// arrows move its highlight and esc closes it; the filter owns
		// preventDefault for those.
		if (props.slashKeyFilter?.(event, textarea.plainText)) return
		// Bare-mount fallback only (no Keymap.Provider — the real client takes
		// the historyKey path above). It hardcodes up/down, so it does NOT see
		// `prompt.history.*` overrides, and the raw event carries modifiers the
		// binding match would have filtered out: keep ctrl/meta/shift/super
		// away from history here so shift+up stays native selection.
		if (event.ctrl || event.meta || event.shift || event.super) return
		// Bare harness Tab completion (no Keymap.Provider); the real client's
		// keymap layer above consumes Tab before this onKeyDown ever runs.
		// shift+tab is deliberately not ours (back-tab stays native).
		if (event.name === "tab") {
			if (completeKey()) event.preventDefault()
			return
		}
		if (event.name === "up") {
			if (recallStep(-1)) event.preventDefault()
			return
		}
		if (event.name === "down" && recallStep(1)) event.preventDefault()
	}

	return (
		<box
			flexShrink={0}
			width="100%"
			height={composerLayout({
				textareaLines: textareaHeight(),
				footerRows: FOOTER_HEIGHT,
				paletteRows: props.slashHeight?.() ?? 0,
				terminalRows: dimensions().height,
			}).height}
			flexDirection="column"
			border={composerBorderSides(dimensions().height)}
			borderStyle={border().borderStyle}
			borderColor={border().borderColor}
			title={busy() && dimensions().height > COMPOSER_COMPACT_TERMINAL_ROWS ? STEER_TITLE : undefined}
			titleColor={busyColor()}
			backgroundColor={color.background()}
			paddingLeft={1}
		>
			{props.slashPalette?.()}
			<textarea
				width="100%"
				minHeight={1}
				maxHeight={maxLines()}
				placeholder={props.placeholder ?? "Type a message (enter send, alt+enter newline)"}
				placeholderColor={color.placeholder()}
				textColor={color.text()}
				focusedTextColor={color.text()}
				cursorColor={busy() ? busyColor() : color.text()}
				cursorStyle={cursor()}
				keyBindings={keyBindings}
				onSubmit={submit}
				onKeyDown={recall}
				onContentChange={() => {
					syncHeight()
					if (textarea && !textarea.isDestroyed) props.slashSync?.(textarea.plainText)
				}}
				onSizeChange={syncHeight}
				ref={(value: TextareaRenderable) => {
					textarea = value
					// Focus events drive the skin frame (with the unfocus debounce,
					// above). core emits these on the renderable itself.
					value.on(RenderableEvents.FOCUSED, () => {
						if (blurDebounce !== undefined) {
							clearTimeout(blurDebounce)
							blurDebounce = undefined
						}
						if (!disposed) setVisuallyFocused(true)
					})
					value.on(RenderableEvents.BLURRED, () => {
						if (blurDebounce !== undefined) clearTimeout(blurDebounce)
						blurDebounce = setTimeout(() => {
							blurDebounce = undefined
							if (!disposed && !value.isDestroyed && !value.focused) setVisuallyFocused(false)
						}, SKIN_FOCUS_BLUR_DEBOUNCE_MS)
					})
					// Vendored form/prompt: focus after the ref publishes so burst
					// typing lands once the editor is ready.
					queueMicrotask(() => {
						if (value.isDestroyed) return
						value.focus()
					})
					// Live focused flag for overlay hosts (vendored PromptRef shape):
					// overlay hosts poll this after a dialog drains and re-assert
					// focus when the vendored DialogProvider refocus missed us.
					props.ref?.({
						focused: () => !value.isDestroyed && value.focused,
						focus: () => {
							if (value.isDestroyed) return
							value.focus()
						},
					})
				}}
			/>
			<Show when={FOOTER_HEIGHT > 0}>
				<box height={FOOTER_HEIGHT} flexShrink={0} flexDirection="row" gap={2}>
					<text fg={color.hint()}>{COMPOSER_FOOTER_HINT}</text>
				</box>
			</Show>
		</box>
	)
}
