/**
 * SessionsSearch — the cross-session full-text search overlay (batch H3,
 * tui-pi 77-plugins-search parity).
 *
 * `/search` (and the ctrl+alt+f keybind, `session.searchSessions`) opens
 * the overlay: a query input, Enter runs the FTS query through the session
 * seam (`searchSessions` — present on BOTH faces, host-session.searchSessions
 * via the sessionQuery capability and the client remote ops `session/search`
 * RPC, 1:1), and the hits render as an id + snippet list under the
 * "🔍 Search sessions" title. Enter on a hit is a no-op (the reference
 * leaves resume to the /resume suites); escape closes. Reopening starts a
 * FRESH query.
 *
 * Open state rides a module signal so the slash-command context can open
 * the overlay without threading renderables through commands.ts (the same
 * module-bridge law as subagent-markers.ts).
 *
 * Layer law (SearchOverlay H1): while open a priority-2 GLOBAL layer owns
 * escape/return — mode "global", NOT "modal" (a modal-mode layer only
 * activates while a dialog is open; outside one it is inert). Typed query
 * chars fall through to the focused input.
 *
 * OpenTUI law: every box carries an explicit height, never auto-height in
 * a flex column.
 */
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import type { InputRenderable } from "@opentui/core"
import { createSignal as createBridgeSignal } from "solid-js"
import { Keymap } from "../../context/keymap"
import { useDialog } from "../../ui/dialog"
import { useThemeOptional } from "../../context/theme"
import type { SessionSeam } from "../../seams/session"

/** Module bridge: /search flips this; the overlay owns the close side. */
const [bridgeOpen, setBridgeOpen] = createBridgeSignal(false)
// Module-scope open state: the session sidebar's priority-10 Esc layer
// yields while this overlay owns the screen.
const [panelOpen, setPanelOpen] = createBridgeSignal(false)
/** Whether the cross-session search overlay is on screen. */
export const sessionsSearchOpen = panelOpen

/** Open the cross-session search overlay (the /search command path). */
export function openSessionsSearch(): void {
	setBridgeOpen(true)
}

/**
 * The overlay's module-scope open state. Unmount resets it: the sidebar's
 * priority-10 Esc layer yields on this signal, so a stale `true` would leave
 * Esc dead for the rest of the session.
 */
export function useSessionsSearchOpenState() {
	onCleanup(() => setPanelOpen(false))
	return [sessionsSearchOpen, setPanelOpen] as const
}

export type SessionSearchHit = { id: string; snippet: string }

/** One rendered result line: the session id, then the collapsed snippet. */
export function formatSearchHitLine(hit: SessionSearchHit): string {
	const snippet = hit.snippet.replace(/\s+/g, " ").trim()
	return snippet ? `${hit.id} — ${snippet}` : hit.id
}

const ROW_CAP = 8

export function SessionsSearch(props: { seam: SessionSeam; onClosed?: () => void }) {
	const theme = useThemeOptional()
	const dialog = useDialog()

	const [open, setOpen] = useSessionsSearchOpenState()
	const [query, setQuery] = createSignal("")
	const [hits, setHits] = createSignal<SessionSearchHit[]>([])
	const [searched, setSearched] = createSignal(false)
	const [busy, setBusy] = createSignal(false)

	// The command bridge opens; the overlay owns closing.
	createEffect(() => {
		if (bridgeOpen()) {
			setBridgeOpen(false)
			setQuery("")
			setHits([])
			setSearched(false)
			setOpen(true)
		}
	})

	async function run() {
		const needle = query().trim()
		if (!needle || busy()) return
		setBusy(true)
		try {
			const found = await props.seam.searchSessions(needle)
			setHits(found.slice(0, ROW_CAP))
		} catch {
			setHits([])
		} finally {
			setSearched(true)
			setBusy(false)
		}
	}

	function close() {
		setOpen(false)
		// Refocus AFTER the teardown (the SearchOverlay H1 law — the destroyed
		// input leaves nothing focused; the page reclaims its composer).
		setTimeout(() => props.onClosed?.(), 3)
	}

	// Active layer (priority 2, the SearchOverlay H1 shape): a global — not
	// modal — layer owns escape/return while the overlay is open.
	Keymap.createLayer(() => ({
		mode: "global",
		enabled: open() && dialog.stack.length === 0,
		priority: 2,
		commands: [
			{ bind: "escape", title: "Close session search", group: "Search", run: close },
			{ bind: "return", title: "Search stored sessions", group: "Search", run: () => void run() },
		],
	}))

	// Toggle layer (closed): the `session.searchSessions` command id resolves
	// its configured binding (ctrl+alt+f) from the shared keybind config.
	Keymap.createLayer(() => ({
		mode: "global",
		enabled: !open() && dialog.stack.length === 0,
		commands: [
			{
				id: "session.searchSessions",
				title: "Search stored sessions",
				group: "Session",
				run: () => setBridgeOpen(true),
			},
		],
	}))

	const status = createMemo(() => {
		if (busy()) return "searching…"
		if (!searched()) return ""
		const count = hits().length
		return count === 0 ? "No matches" : `${count} hit${count === 1 ? "" : "s"}`
	})

	return (
		<Show when={open()}>
			<box
				flexShrink={0}
				width="100%"
				height={1 + 1 + (hits().length || 1) + 1}
				flexDirection="column"
				border={["left"]}
				borderColor={theme?.border.base ?? "#7aa2f7"}
				backgroundColor={theme?.background.raised.base ?? "#1a1b26"}
				paddingLeft={1}
				paddingRight={1}
			>
				<box height={1} flexShrink={0} flexDirection="row">
					<text fg={theme?.text.base ?? "#e6e6e6"} wrapMode="none">
						🔍 Search sessions
					</text>
					<Show when={status()}>
						<text fg={theme?.text.muted ?? "#565f89"} wrapMode="none">
							{` ${status()}`}
						</text>
					</Show>
				</box>
				<box height={1} flexShrink={0} flexDirection="row">
					<input
						flexGrow={1}
						placeholder="Full-text over stored sessions"
						placeholderColor={theme?.text.muted ?? "#565f89"}
						value={query()}
						onInput={(value: string) => setQuery(value)}
						onSubmit={() => void run()}
						ref={(renderable: InputRenderable) => {
							setTimeout(() => {
								if (!renderable.isDestroyed) renderable.focus()
							}, 1)
						}}
					/>
				</box>
				<Show
					when={hits().length > 0}
					fallback={
						<box height={1} flexShrink={0}>
							<text fg={theme?.text.muted ?? "#565f89"} wrapMode="none">
								{searched() ? "No matches" : "Type a query, Enter searches"}
							</text>
						</box>
					}
				>
					<For each={hits()}>
						{(hit) => (
							<box height={1} flexShrink={0}>
								<text fg={theme?.text.base ?? "#e6e6e6"} wrapMode="none">
									{formatSearchHitLine(hit)}
								</text>
							</box>
						)}
					</For>
				</Show>
			</box>
		</Show>
	)
}
