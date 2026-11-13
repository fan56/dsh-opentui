/**
 * SessionsSearch — the cross-session full-text search overlay (batch H3,
 * tui-pi 77-plugins-search parity).
 *
 * `/search` (and the ctrl+alt+f keybind, `session.searchSessions`) opens
 * the overlay: a query input, Enter runs the FTS query through the session
 * seam (`searchSessions` — present on BOTH faces, host-session.searchSessions
 * via the sessionQuery capability and the client remote ops `session/search`
 * RPC, 1:1), and the hits render as an id + snippet list under the
 * "🔍 Search sessions" title. B1 (gap C2, tui-pi search.ts parity): Enter on
 * a hit RESUMES it — the hits are cursor-navigable (up/down, wrapping), the
 * selected row is prefixed `› `, and Enter routes to the entry's `onResumed`
 * (the same seam path a /resume pick takes: stage the id, reload THAT
 * journal). No confirm — the reference's resumeTarget({ id }) fires
 * straight. An empty hit list keeps Enter = (re)run the query. A rejected
 * resume keeps the overlay open with a `resume failed — …` status line
 * (never a silent no-op); escape closes. Reopening starts a FRESH query.
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

/**
 * Step the hit cursor by `delta` within `count` rows, wrapping at the edges
 * (the subagents-picker moveTo modulo law). `count === 0` never moves.
 */
export function hitCursorStep(current: number, delta: number, count: number): number {
	if (count <= 0) return current
	return (current + delta + count) % count
}

/**
 * Route the Enter press: a hit list resumes the SELECTED hit, an empty one
 * (re)runs the query (the tui-pi split — query-editor Enter searches, table
 * Enter picks).
 */
export function enterAction(hitCount: number): "resume" | "search" {
	return hitCount > 0 ? "resume" : "search"
}

/** One short failure line for a rejected search-hit resume (the /login commit convention — sliced, key-free). */
export function resumeFailureText(error: unknown): string {
	return `resume failed — ${String(error instanceof Error ? error.message : error).slice(0, 150)}`
}

/**
 * The resume orchestration behind Enter-on-a-hit, lifted out of the
 * component so the B1 contract is testable without a renderer (the
 * commands.test.ts law): the selected sessionId reaches `onResumed`
 * UNCHANGED, success closes the overlay, a rejection keeps it open with the
 * `resume failed — …` status line (never a silent no-op).
 */
export async function resumeSearchHit(options: {
	sessionId: string
	onResumed: (sessionId: string) => void | Promise<void>
	onSuccess: () => void
	onFailure: (statusLine: string) => void
}): Promise<void> {
	try {
		await options.onResumed(options.sessionId)
		options.onSuccess()
	} catch (error) {
		options.onFailure(resumeFailureText(error))
	}
}

export function SessionsSearch(props: {
	seam: SessionSeam
	onClosed?: () => void
	/** B1: Enter-on-a-hit resumes through this (the entry wires the /resume seam path: resumeSession + reload(id) + say). */
	onResumed?: (sessionId: string) => void | Promise<void>
}) {
	const theme = useThemeOptional()
	const dialog = useDialog()

	const [open, setOpen] = useSessionsSearchOpenState()
	const [query, setQuery] = createSignal("")
	const [hits, setHits] = createSignal<SessionSearchHit[]>([])
	const [searched, setSearched] = createSignal(false)
	const [busy, setBusy] = createSignal(false)
	// B1: the hit cursor (up/down navigates, wrapping) and the failed-resume
	// status line (empty = no failure on screen).
	const [cursor, setCursor] = createSignal(0)
	const [resumeError, setResumeError] = createSignal("")

	// The command bridge opens; the overlay owns closing.
	createEffect(() => {
		if (bridgeOpen()) {
			setBridgeOpen(false)
			setQuery("")
			setHits([])
			setSearched(false)
			setResumeError("")
			setOpen(true)
		}
	})

	async function run() {
		const needle = query().trim()
		if (!needle || busy()) return
		setBusy(true)
		setResumeError("")
		try {
			const found = await props.seam.searchSessions(needle)
			setHits(found.slice(0, ROW_CAP))
			// A fresh result list restarts the cursor at the first hit.
			setCursor(0)
		} catch {
			setHits([])
			setCursor(0)
		} finally {
			setSearched(true)
			setBusy(false)
		}
	}

	function moveCursor(delta: number) {
		const count = hits().length
		if (count === 0) return
		setCursor((current) => hitCursorStep(current, delta, count))
	}

	// B1: the Enter routing (tui-pi split — query-editor Enter searches,
	// hit-list Enter resumes the selected row). Both the layer binding and the
	// input's onSubmit route through HERE so a double dispatch (layer +
	// focused input) lands on one action: the first caller wins, the second
	// sees `busy` and no-ops.
	function enterKey() {
		if (busy()) return
		if (enterAction(hits().length) === "resume") {
			const hit = hits()[cursor()]
			if (!hit) return
			setBusy(true)
			void resumeSearchHit({
				sessionId: hit.id,
				onResumed: (sessionId) => props.onResumed?.(sessionId),
				onSuccess: () => {
					setBusy(false)
					close()
				},
				onFailure: (statusLine) => {
					setBusy(false)
					setResumeError(statusLine)
				},
			})
			return
		}
		void run()
	}

	function close() {
		setOpen(false)
		// Refocus AFTER the teardown (the SearchOverlay H1 law — the destroyed
		// input leaves nothing focused; the page reclaims its composer).
		setTimeout(() => props.onClosed?.(), 3)
	}

	// Active layer (priority 2, the SearchOverlay H1 shape): a global — not
	// modal — layer owns escape/return (and the hit cursor) while the overlay
	// is open.
	Keymap.createLayer(() => ({
		mode: "global",
		enabled: open() && dialog.stack.length === 0,
		priority: 2,
		commands: [
			{ bind: "escape", title: "Close session search", group: "Search", run: close },
			{
				bind: "return",
				title: "Search stored sessions / resume selected hit",
				group: "Search",
				run: () => enterKey(),
			},
			{ bind: "down,j", title: "Next hit", group: "Search", run: () => moveCursor(1) },
			{ bind: "up,k", title: "Previous hit", group: "Search", run: () => moveCursor(-1) },
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
		// B1: a rejected resume reads LOUDER than the counters — the failure
		// line owns the status slot until the next search or reopen.
		if (resumeError()) return resumeError()
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
						<text
							fg={
								resumeError()
									? (theme?.text.feedback.error.base ?? "#f7768e")
									: (theme?.text.muted ?? "#565f89")
							}
							wrapMode="none"
						>
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
						// B1: the input's submit routes through the SAME enterKey as
						// the layer binding — one action per press, whichever lands
						// first (the busy gate no-ops the second).
						onSubmit={() => enterKey()}
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
						{(hit, index) => (
							<box height={1} flexShrink={0}>
								<text
									fg={index() === cursor() ? (theme?.text.base ?? "#e6e6e6") : (theme?.text.muted ?? "#565f89")}
									wrapMode="none"
								>
									{index() === cursor() ? `› ${formatSearchHitLine(hit)}` : `  ${formatSearchHitLine(hit)}`}
								</text>
							</box>
						)}
					</For>
				</Show>
			</box>
		</Show>
	)
}
