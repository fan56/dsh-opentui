/**
 * Pane focus (transcript ↔ composer) for the rebuilt session view.
 *
 * The user's report: after a reply lands, ↑/↓ inside the composer move prompt
 * history, so the transcript can never be scrolled back with the arrow keys —
 * the reply view is pinned to the bottom. This batch gives the page TWO panes
 * and makes the real focus decide which one owns the keys:
 *
 *   Pane = "composer" | "transcript"
 *
 * Truth source (no guessed mirror state): the renderer's actual focused
 * renderable. `createPaneFocus` listens to `CliRenderEvents.FOCUSED_RENDERABLE`
 * and walks the focused node's parent chain against the two pane roots
 * (`paneForFocused`). Both panes are focused through OpenTUI itself:
 *
 *   - the composer is its TextareaRenderable (`SessionComposerRef.node()`);
 *   - the transcript is its ScrollBoxRenderable (Transcript's `scrollRef`),
 *     focusable by default in @opentui 0.8.1.
 *
 * Mouse: the renderer's `autoFocus` (default true) focuses the nearest
 * focusable ancestor on a left-button press, so a click anywhere in either
 * pane lands here as a normal renderer focus change — no click handlers.
 *
 * Keys (`PaneFocusKeys`, two global layers, priority 1):
 *   F6                     toggle transcript ↔ composer  (gated: no dialog,
 *                          focus in one of the two panes, slash menu closed,
 *                          subagent picker closed — never steals overlay keys)
 *   transcript focused:
 *     ↑/↓                  scroll one line
 *     PgUp/PgDn            scroll one viewport
 *     Home/End             top / bottom (End restores sticky follow)
 *     Tab, idle Esc        back to the composer (busy Esc stays "stop turn" —
 *                          the run returns false and TurnCancelKeys takes it)
 *
 * The composer-focused ↑/↓ history behavior is untouched: its own priority-1
 * layer still owns the keys (session-composer.tsx), and this layer is OFF
 * whenever the transcript is not the focused pane.
 *
 * Static only: focus flips redraw a border weight, never an animation; no new
 * timers, no frame-rate changes.
 */
import { createSignal, onCleanup, onMount, type Accessor } from "solid-js"
import { CliRenderEvents, type CliRenderer, type Renderable, type ScrollBoxRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { Keymap } from "../../context/keymap"

export type Pane = "composer" | "transcript"

export type PaneNodes = {
	/** The transcript's scrollbox (undefined before mount / after teardown). */
	transcript?: () => Renderable | undefined
	/** The composer's textarea (undefined before mount / after teardown). */
	composer?: () => Renderable | undefined
}

export type PaneFocus = {
	pane: Accessor<Pane | undefined>
	composerFocused: Accessor<boolean>
	transcriptFocused: Accessor<boolean>
	focusComposer(): void
	focusTranscript(): void
	toggle(): void
}

/** Is `node` the ancestor itself or a descendant of it? Walks `parent`
 * (the renderable tree), never a parallel registry — the same shape the
 * vendored session-frame uses to classify focus by pane. */
export function withinRenderable(node: Renderable | null | undefined, ancestor: Renderable | null | undefined): boolean {
	if (!node || !ancestor) return false
	let current: Renderable | null = node
	while (current) {
		if (current === ancestor) return true
		current = current.parent
	}
	return false
}

/** The pane that owns a focused renderable (pure, testable). */
export function paneForFocused(current: Renderable | null | undefined, nodes: PaneNodes): Pane | undefined {
	if (!current) return undefined
	if (withinRenderable(current, nodes.transcript?.())) return "transcript"
	if (withinRenderable(current, nodes.composer?.())) return "composer"
	return undefined
}

/** F6 may toggle only while the app owns the keys and focus sits in one of
 * the two panes (never while a dialog, the slash menu or the subagent picker
 * is open — those own their own keys). */
export function paneToggleEnabled(gate: {
	pane: Pane | undefined
	keysEnabled: boolean
	slashOpen: boolean
	pickerOpen: boolean
}): boolean {
	return gate.keysEnabled && gate.pane !== undefined && !gate.slashOpen && !gate.pickerOpen
}

/** Transcript scroll keys: only while the transcript is the focused pane and
 * no overlay owns the keyboard. */
export function transcriptKeysEnabled(gate: { pane: Pane | undefined; keysEnabled: boolean }): boolean {
	return gate.keysEnabled && gate.pane === "transcript"
}

/** Create the pane-focus truth source. Call in the page component (it needs
 * the renderer from the OpenTUI context). */
export function createPaneFocus(nodes: PaneNodes): PaneFocus {
	const renderer = useRenderer()
	const pane = createPaneFocusSignal(renderer, nodes)
	const focus = (which: Pane) => {
		const node = which === "transcript" ? nodes.transcript?.() : nodes.composer?.()
		node?.focus()
	}
	return {
		pane,
		composerFocused: () => pane() === "composer",
		transcriptFocused: () => pane() === "transcript",
		focusComposer: () => focus("composer"),
		focusTranscript: () => focus("transcript"),
		toggle: () => focus(pane() === "transcript" ? "composer" : "transcript"),
	}
}

// Split out so the signal wiring is a plain function (no hook ordering
// surprises): createSignal must run inside the component's owner.
function createPaneFocusSignal(renderer: CliRenderer, nodes: PaneNodes) {
	const [pane, setPane] = createSignal<Pane | undefined>(undefined)
	const refresh = () => setPane(paneForFocused(renderer.currentFocusedRenderable, nodes))
	onMount(() => {
		renderer.on(CliRenderEvents.FOCUSED_RENDERABLE, refresh)
		refresh()
	})
	onCleanup(() => renderer.off(CliRenderEvents.FOCUSED_RENDERABLE, refresh))
	return pane
}

export type PaneFocusKeysProps = {
	pane: Accessor<Pane | undefined>
	/** No dialog/overlay owns the keyboard (the page passes
	 * `dialog.stack.length === 0`). */
	keysEnabled: Accessor<boolean>
	slashOpen: Accessor<boolean>
	pickerOpen: Accessor<boolean>
	/** A turn is running (busy Esc stays the stop-turn gesture). */
	busy: Accessor<boolean>
	scroll: () => ScrollBoxRenderable | undefined
	toggle: () => void
	focusComposer: () => void
}

export function PaneFocusKeys(props: PaneFocusKeysProps) {
	const scroll = () => {
		const box = props.scroll()
		return box && !box.isDestroyed ? box : undefined
	}
	const line = (delta: number) => {
		scroll()?.scrollBy(delta)
		return true
	}
	const page = (delta: number) => {
		scroll()?.scrollBy(delta, "viewport")
		return true
	}
	const top = () => {
		scroll()?.scrollTo(0)
		return true
	}
	// scrollTo(Infinity) lands at the end and re-engages the scrollbox's
	// native sticky follow (stickyScroll stays true through the whole model).
	const bottom = () => {
		scroll()?.scrollTo(Infinity)
		return true
	}

	Keymap.createLayer(() => ({
		mode: "global",
		priority: 1,
		enabled: paneToggleEnabled({
			pane: props.pane(),
			keysEnabled: props.keysEnabled(),
			slashOpen: props.slashOpen(),
			pickerOpen: props.pickerOpen(),
		}),
		commands: [
			{
				id: "pane.focus.toggle",
				title: "Toggle transcript / composer focus",
				group: "Session",
				bind: "f6",
				run: () => {
					props.toggle()
					return true
				},
			},
		],
	}))

	Keymap.createLayer(() => ({
		mode: "global",
		priority: 1,
		enabled: transcriptKeysEnabled({ pane: props.pane(), keysEnabled: props.keysEnabled() }),
		commands: [
			{
				id: "pane.transcript.line.up",
				title: "Scroll transcript up one line",
				group: "Session",
				bind: "up",
				run: () => line(-1),
			},
			{
				id: "pane.transcript.line.down",
				title: "Scroll transcript down one line",
				group: "Session",
				bind: "down",
				run: () => line(1),
			},
			{
				id: "pane.transcript.page.up",
				title: "Scroll transcript up one page",
				group: "Session",
				bind: "pageup",
				run: () => page(-1),
			},
			{
				id: "pane.transcript.page.down",
				title: "Scroll transcript down one page",
				group: "Session",
				bind: "pagedown",
				run: () => page(1),
			},
			{
				id: "pane.transcript.top",
				title: "Transcript top",
				group: "Session",
				bind: "home",
				run: top,
			},
			{
				id: "pane.transcript.bottom",
				title: "Transcript bottom",
				group: "Session",
				bind: "end",
				run: bottom,
			},
			{
				id: "pane.transcript.composer",
				title: "Focus the composer",
				group: "Session",
				bind: "tab",
				run: () => {
					props.focusComposer()
					return true
				},
			},
			{
				// Idle Esc returns to the composer; while a turn runs the run
				// returns false so TurnCancelKeys' esc (interrupt) takes the key.
				id: "pane.transcript.escape",
				title: "Focus the composer",
				group: "Session",
				bind: "escape",
				run: () => {
					if (props.busy()) return false
					props.focusComposer()
					return true
				},
			},
		],
	}))
	return null
}
