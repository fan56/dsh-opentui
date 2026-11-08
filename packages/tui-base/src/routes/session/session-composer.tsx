/**
 * SessionComposer — the rebuilt session input area (batch 4), on SessionSeam.
 *
 * Shape follows the vendored textarea composers (component/prompt/index.tsx
 * `<textarea>` and routes/session/form.tsx): a native TextareaRenderable
 * with content-driven height capped by `minHeight`/`maxHeight`, focus taken
 * once the ref publishes, `┃` split border. Decision logic (send vs steer,
 * busy, history) lives in ./composer-state.ts.
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
 * Edge handling is the vendored one: ↑ off offset 0 on the first visual row
 * snaps the cursor to 0 (next ↑ recalls); ↓ off the end on the last visual
 * row snaps to the end. Other rows fall through to native cursor movement.
 *
 * Paste: native (TextareaRenderable.handlePaste, bracketed). No custom code.
 *
 * Busy marker: rendered in the footer row and pushed through `onBusyChange`
 * for the status/powerline batch.
 *
 * OpenTUI law: the root box gets an explicit height computed from the
 * textarea's reported height (+ footer), never auto-height in a flex column.
 */
import { createSignal, onCleanup, Show, type JSX } from "solid-js"
import { useRenderer } from "@opentui/solid"
import { measureEditText, type KeyEvent, type TextareaRenderable } from "@opentui/core"
import type { SessionSeam } from "../../seams/session"
import { SplitBorder } from "../../ui/border"
import { ComposerController, type ComposerHistory } from "./composer-state"
import { composerKeyBindings, type ComposerKeybindConfig } from "./composer-keybinds"
import { useThemeOptional } from "../../context/theme"

export type SessionComposerRef = {
	/** The textarea's live focused flag (OpenTUI renderable state, not a
	 * cached copy — the login-era bug was a stale flag hiding a blur). */
	focused(): boolean
	focus(): void
}

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
	 * unknowns included) — the composer clears its buffer, no send/steer. */
	interceptSubmit?: (buffer: string) => boolean
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
	const theme = useThemeOptional()
	const color = {
		// Vendored prompt: border = border.base tinted by the agent color
		// (no agent here → untinted); bg = decrease(background.raised.base).
		border: () => theme?.border.base ?? "#7aa2f7",
		busy: () => theme?.text.feedback.warning.base ?? "#e0af68",
		background: () => (theme ? theme.decrease(theme.background.raised.base) : "#1a1b26"),
		text: () => theme?.text.base ?? "#e6e6e6",
		placeholder: () => theme?.text.faint ?? "#565f89",
		hint: () => theme?.text.muted ?? "#565f89",
	}
	const keyBindings = composerKeyBindings(props.keybinds)
	const [busy, setBusy] = createSignal(false)
	const [textareaHeight, setTextareaHeight] = createSignal(1)
	let textarea: TextareaRenderable | undefined
	let disposed = false
	onCleanup(() => (disposed = true))

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
	const maxLines = () => props.maxHeight ?? 8

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
		if (!textarea || textarea.isDestroyed) return
		// Slash commands resolve here (batch 8): the palette's enter path and
		// unknown "/xxx" both come through the intercept; only plain text
		// reaches the send/steer controller.
		if (props.interceptSubmit?.(textarea.plainText)) {
			textarea.setText("")
			syncHeight()
			return
		}
		const result = controller.submit(textarea.plainText)
		if (result !== "ignored") textarea.setText("")
	}

	function recall(event: KeyEvent) {
		if (!textarea || textarea.isDestroyed) return
		// Slash palette keys first (batch 8): while the menu is open the
		// arrows move its highlight and esc closes it; the filter owns
		// preventDefault for those.
		if (props.slashKeyFilter?.(event, textarea.plainText)) return
		if (event.ctrl || event.meta || event.shift || event.super) return
		const input = textarea.plainText
		const row = textarea.scrollY + textarea.visualCursor.visualRow
		if (event.name === "up") {
			if (textarea.cursorOffset !== 0) {
				// Vendored prompt.history.previous: first visual row snaps to 0,
				// other rows fall through to native move-up.
				if (row !== 0) return
				event.preventDefault()
				textarea.cursorOffset = 0
				return
			}
			const item = controller.history.move(-1, input)
			if (item === undefined) return
			event.preventDefault()
			textarea.setText(item)
			textarea.cursorOffset = 0
			return
		}
		if (event.name === "down") {
			const end = measure(input)
			if (textarea.cursorOffset !== end) {
				// Vendored prompt.history.next: last visual row snaps to end.
				if (row !== Math.max(0, textarea.editorView.getTotalVirtualLineCount() - 1)) return
				event.preventDefault()
				textarea.cursorOffset = end
				return
			}
			const item = controller.history.move(1, input)
			if (item === undefined) return
			event.preventDefault()
			textarea.setText(item)
			textarea.cursorOffset = measure(item)
		}
	}

	return (
		<box
			flexShrink={0}
			width="100%"
			height={textareaHeight() + FOOTER_HEIGHT + (props.slashHeight?.() ?? 0)}
			flexDirection="column"
			border={["left"]}
			borderColor={busy() ? color.busy() : color.border()}
			customBorderChars={SplitBorder.customBorderChars}
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
				cursorColor={color.text()}
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
					<Show
						when={busy()}
						fallback={<text fg={color.hint()}>{"enter send · alt+enter newline · ↑↓ history"}</text>}
					>
						<text fg={color.busy()}>{"* streaming… enter steers the running turn"}</text>
					</Show>
				</box>
			</Show>
		</box>
	)
}
