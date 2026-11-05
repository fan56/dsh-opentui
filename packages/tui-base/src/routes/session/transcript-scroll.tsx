/**
 * TranscriptScrollKeys — transcript scrollback keybinds for the rebuilt
 * view (batch 10f): the vendored route's scroll layer
 * (routes/session/index.tsx globalCommands + `Keymap.createLayer` mode
 * "global", keys from the vendored keybind config), rebuilt on the
 * Transcript's `scrollRef`.
 *
 *   session.page.up    pageup,ctrl+alt+b   one viewport up
 *   session.page.down  pagedown,ctrl+alt+f  one viewport down
 *
 * Laws honored:
 *
 * - Focus stays in the composer (OpenTUI focus-singleton law): the layer
 *   scrolls via `scrollBy`, never focus. Keymap bindings run on
 *   `renderer.keyInput` BEFORE the focused editor and consume matches
 *   (preventDefault + stopPropagation), so pageup/pagedown never reach the
 *   textarea — the same mechanism the vendored app types under.
 * - Overlays claim the keys first: the vendored DialogSelect registers a
 *   modal-mode layer with its own pageup/pagedown when it mounts, and
 *   later-registered layers shadow earlier ones; `enabled` additionally
 *   gates the whole layer on an empty dialog stack, which closes the gap
 *   for overlays that do NOT bind pageup (DialogConfirm-shaped cards) —
 *   while ANY dialog is open the transcript does not scroll.
 * - Follow mode is NATIVE stickyScroll, verified against @opentui 0.8.1
 *   (batch 10f probe, createTestRenderer): stickyScroll+stickyStart="bottom"
 *   follows appends only while the viewport sits at the bottom edge — a
 *   scroll-up keeps its position through new appends (no flag toggling),
 *   and scrolling back to the bottom re-engages follow. No custom pin
 *   logic here, and none of the M4-era bottom-anchor semantics.
 *
 * Mouse wheel: with renderer `useMouse: false` (batch 10f — terminal-native
 * drag-select/copy), no wheel events reach the app; scrollback moves via
 * these keys.
 */
import { Show } from "solid-js"
import type { ScrollBoxRenderable } from "@opentui/core"
import { Keymap } from "../../context/keymap"

export type TranscriptScrollKeysProps = {
	/** The transcript scrollbox (Transcript's `scrollRef`). */
	scroll: () => ScrollBoxRenderable | undefined
	/** Layer gate — pass "no overlay is open" (e.g. `dialog.stack.length === 0`). */
	enabled: () => boolean
}

export function TranscriptScrollKeys(props: TranscriptScrollKeysProps) {
	const page = (delta: number) => {
		const scroll = props.scroll()
		if (!scroll || scroll.isDestroyed) return
		scroll.scrollBy(delta, "viewport")
	}
	Keymap.createLayer(() => ({
		mode: "global",
		enabled: props.enabled(),
		commands: [
			{
				id: "session.page.up",
				title: "Page up",
				group: "Session",
				run: () => page(-1),
			},
			{
				id: "session.page.down",
				title: "Page down",
				group: "Session",
				run: () => page(1),
			},
		],
		bindings: ["session.page.up", "session.page.down"],
	}))
	// The layer lives in the Keymap, not the scene; the vendored hosts use
	// the same always-false Show slot for layer-only components.
	return <Show when={false}>{null}</Show>
}
