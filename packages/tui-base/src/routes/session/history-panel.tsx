/**
 * HistoryPanel — the /history two-pane turn browser (gap C1 step 2, tui-pi
 * history.ts parity), mounted on the panel-kit modal stack (the /agents
 * skeleton: module bridge open → panels.open ONE browser layer; the `s`
 * session switch pushes a second layer on top).
 *
 * Layout (tui-pi HistoryBrowserPanel): LEFT = the completed-turn list
 * (`#N` + preview, cursor `› `, scroll window follows the cursor); RIGHT =
 * the selected turn's detail (end state, prompts, assistant bodies, tool
 * calls with their settled ok/output mirror). Keys:
 *
 *   ↑/↓ (j/k)  move the turn cursor (wraps)
 *   Enter / c  refill the composer editor with the turn's first HUMAN
 *              prompt (turnPrimaryUserText) and close — an injected-only
 *              turn keeps the panel open with a notice (a notice must never
 *              land in the editor)
 *   s          session switch: a second stack layer lists the stored
 *              sessions; a pick RE-FOLDS that session's journal and browsing
 *              continues on it (no app-session resume)
 *   f          fork-at-turn: seam.forkSession(browsingId, turn.seqEnd) →
 *              onForked(newId) (the entry resumes the fork — the same path
 *              a /resume pick takes). A seam without the fork face degrades
 *              to the refill notice (never a fake fork)
 *   esc        panel-kit pops the layer → finish → onClosed
 *
 * Data: the fold input is the RAW journal (seam.sessionJournal →
 * groupHistoryTurns) — the storedTranscript row face cannot serve the turn
 * brackets. Optional face: a seam without sessionJournal degrades to the
 * unavailable notice.
 *
 * Open state rides a module signal (the sessions-search/agents-panel
 * module-bridge law); the sidebar Esc layer yields on historyPanelOpen.
 *
 * Solid props law: reactive VALUES ride getters (seam/sessionId); callbacks
 * are plain function values (the solid-props.test.ts pin — an array or
 * getter-expected prop handed a function value is the /model crash shape).
 */
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { PanelActions, PanelBody, usePanelTheme, usePanels, type PanelHandle } from "@dsh-opentui/panel-kit"
import { Keymap } from "../../context/keymap"
import { useThemeOptional } from "../../context/theme"
import type { SeamSessionSummary, SessionSeam } from "../../seams/session"
import {
	groupHistoryTurns,
	normalizeHistoryPreview,
	toolCallSummary,
	turnPrimaryUserText,
	type HistoryJournalEntry,
	type HistoryToolCall,
	type HistoryTurn,
} from "./history-data"

// ---------------------------------------------------------------------------
// Module bridge (sessions-search/agents-panel law)
// ---------------------------------------------------------------------------

const [bridgeOpen, setBridgeOpen] = createSignal(false)
// Module-scope open state: the session sidebar's priority-10 Esc layer
// yields while this panel owns the screen.
const [panelOpen, setPanelOpen] = createSignal(false)
/** Whether the /history browser is on screen. */
export const historyPanelOpen = panelOpen

/** Open the /history browser (the /history command path). */
export function openHistoryPanel(): void {
	setBridgeOpen(true)
}

/**
 * The panel's module-scope open state. Unmount resets it: the sidebar's
 * priority-10 Esc layer yields on this signal, so a stale `true` would leave
 * Esc dead for the rest of the session.
 */
export function useHistoryPanelOpenState() {
	onCleanup(() => setPanelOpen(false))
	return [historyPanelOpen, setPanelOpen] as const
}

// ---------------------------------------------------------------------------
// Pure render/decision layer (exported for the unit tests)
// ---------------------------------------------------------------------------

/** Left-list row text: `#<turn> <preview>`, one line, clipped to `width`. */
export function turnRowText(turn: HistoryTurn, width: number): string {
	const number = `#${turn.turn} `
	// The ellipsis normalizeHistoryPreview appends costs one cell beyond maxChars.
	const preview = normalizeHistoryPreview(turn.previewText, Math.max(0, width - number.length - 1))
	return `${number}${preview}`
}

/**
 * Step the turn cursor by `delta` within `count` rows, wrapping at the edges
 * (the sessions-search hitCursorStep modulo law). `count === 0` never moves.
 */
export function turnCursorStep(current: number, delta: number, count: number): number {
	if (count <= 0) return current
	return (current + delta + count) % count
}

/**
 * The scroll window of a list of `count` rows with the cursor on `cursor`
 * and a viewport of `visible` rows: `[start, end)` — the smallest window
 * containing the cursor, clamped to the list. `visible <= 0` → the whole
 * list is out of view (empty window at the cursor).
 */
export function turnWindow(count: number, cursor: number, visible: number): { start: number; end: number } {
	const size = Math.max(0, Math.min(visible, count))
	const clamped = Math.max(0, Math.min(cursor, Math.max(0, count - 1)))
	let start = Math.min(clamped, Math.max(0, count - size))
	return { start, end: start + size }
}

/** The Enter/c refill verdict for one turn (tui-pi copy semantics). */
export type RefillVerdict = { kind: "refill"; text: string } | { kind: "notice"; text: string }

/**
 * Enter/c on a turn: a turn with a human prompt refills the editor with
 * turnPrimaryUserText; an injected-only turn yields the stay-open notice
 * (the editor must never receive a notice text as a prompt).
 */
export function refillOrNotice(turn: HistoryTurn | undefined): RefillVerdict {
	if (turn === undefined) return { kind: "notice", text: "no turn selected" }
	const text = turnPrimaryUserText(turn)
	if (text === undefined) return { kind: "notice", text: `turn #${turn.turn} has no prompt to refill` }
	return { kind: "refill", text }
}

/** One marker + name line of the right pane's tool-call list. */
export function toolCallLine(call: HistoryToolCall): string {
	const marker = call.ok === undefined ? "·" : call.ok ? "✓" : "✗"
	return `${marker} ${call.name}${call.args === "" ? "" : ` ${call.args}`}`
}

/**
 * The right-pane detail lines of one turn (header, prompts, assistant
 * bodies, tools). Raw lines — the renderer clips to the pane width.
 */
export function turnDetailLines(turn: HistoryTurn): string[] {
	const lines: string[] = []
	const flags = [turn.endReason, ...(turn.interrupted ? ["interrupted"] : [])].join(" · ")
	lines.push(`turn #${turn.turn} — ${flags}`)
	if (turn.endError !== undefined) lines.push(`error: ${turn.endError}`)
	if (turn.userTexts.length > 0) {
		lines.push("")
		lines.push("prompt:")
		for (const text of turn.userTexts) lines.push(...text.split("\n"))
	}
	if (turn.assistantTexts.length > 0) {
		lines.push("")
		lines.push("assistant:")
		for (const text of turn.assistantTexts) lines.push(...text.split("\n"))
	}
	if (turn.toolCalls.length > 0) {
		lines.push("")
		lines.push(`tools — ${toolCallSummary(turn.toolCalls.map((call) => call.name))}`)
		for (const call of turn.toolCalls) lines.push(toolCallLine(call))
	}
	return lines
}

/** The success echo of a fork-at-turn (the entry's say line). */
export function forkEchoText(turn: number, forkedId: string): string {
	return `forked from turn #${turn} → ${forkedId}`
}

/** One short failure line for a rejected load/fork (sliced, key-free). */
export function historyFailureText(prefix: string, error: unknown): string {
	return `${prefix} failed — ${String(error instanceof Error ? error.message : error).slice(0, 150)}`
}

// ---------------------------------------------------------------------------
// The panel component
// ---------------------------------------------------------------------------

/** Rows visible in the left pane (the scroll window height). */
const LIST_ROWS = 12

export function HistoryPanel(props: {
	seam: SessionSeam
	/** The CURRENT session id (the live/staged one — the /history bare target). */
	sessionId: () => string | undefined
	/** Enter/c refill: write the prompt text into the composer editor. */
	onRefill?: (text: string) => void
	/** f fork success: the entry resumes the forked session (panel closes). */
	onForked?: (forkedId: string, turn: number) => void
	onClosed?: (summary?: string) => void
}) {
	const panels = usePanels()
	const kitTheme = usePanelTheme()
	const theme = useThemeOptional()
	const dimensions = useTerminalDimensions()

	const [open, setOpen] = useHistoryPanelOpenState()
	const [browsingId, setBrowsingId] = createSignal<string | undefined>(undefined)
	const [turns, setTurns] = createSignal<HistoryTurn[]>([])
	const [cursor, setCursor] = createSignal(0)
	const [status, setStatus] = createSignal<string | undefined>(undefined)
	const [busy, setBusy] = createSignal(false)
	const [sessions, setSessions] = createSignal<SeamSessionSummary[]>([])
	const [sessionCursor, setSessionCursor] = createSignal(0)
	const [showSessions, setShowSessions] = createSignal(false)
	let handle: PanelHandle | undefined
	let sequence = 0
	/** Monotonic load token: only the latest `load()` may paint (P1-4). */
	let loadSequence = 0

	const current = createMemo(() => turns()[cursor()])
	/** Pane text budget in cells (the agents-panel bodyWidth shape). */
	const bodyWidth = createMemo(() => {
		const frame = Math.min(116, dimensions().width - 2)
		return Math.max(20, Math.max(1, frame - 4))
	})
	/** The left pane's column share (~40% of the body). */
	const leftWidth = createMemo(() => Math.max(12, Math.floor(bodyWidth() * 0.4) - 1))
	const rightWidth = createMemo(() => Math.max(12, bodyWidth() - leftWidth() - 1))
	const visibleWindow = createMemo(() => turnWindow(turns().length, cursor(), LIST_ROWS))
	const detail = createMemo(() => {
		const turn = current()
		return turn === undefined ? [] : turnDetailLines(turn)
	})

	// ---- data ----
	async function load(sessionId: string | undefined) {
		// Request-sequence guard (review P1-4): two loads may overlap (a `s`
		// pick racing the previous read); only the LATEST token may paint.
		const token = ++loadSequence
		if (!sessionId) {
			setTurns([])
			setStatus("no active session to browse")
			return
		}
		if (!props.seam.sessionJournal) {
			setTurns([])
			setStatus("history unavailable in this session (no journal face)")
			return
		}
		// The switch window: drop the old session's rows NOW. `fork()` and
		// `refill()` read `current()` — with turns emptied, `f`/Enter have
		// nothing to act on while the picked session's journal is in flight
		// (the renderer shows the busy "loading turns…" line instead of the
		// old session's turns).
		setTurns([])
		setCursor(0)
		setBusy(true)
		setStatus(undefined)
		try {
			const entries: HistoryJournalEntry[] = await props.seam.sessionJournal!(sessionId)
			// A newer load took over (a later `s` pick): this response is stale.
			if (token !== loadSequence) return
			const folded = groupHistoryTurns(entries)
			setTurns(folded)
			setCursor(0)
			if (folded.length === 0) setStatus(`no completed turns in ${sessionId.slice(0, 8)}`)
		} catch (error) {
			if (token !== loadSequence) return
			setTurns([])
			setCursor(0)
			setStatus(historyFailureText("history load", error))
		} finally {
			if (token === loadSequence) setBusy(false)
		}
	}

	// ---- stack plumbing ----
	function finish() {
		setOpen(false)
		setShowSessions(false)
		setStatus(undefined)
		setTimeout(() => props.onClosed?.(), 3)
	}

	function close() {
		if (showSessions()) {
			// The session layer pops first; the browser layer stays.
			panels.close()
			return
		}
		handle?.close()
	}

	// ---- open (bridge effect; agents-panel shape) ----
	createEffect(() => {
		if (!bridgeOpen()) return
		setBridgeOpen(false)
		if (handle !== undefined) return
		const target = props.sessionId()
		setBrowsingId(target)
		setTurns([])
		setCursor(0)
		setStatus(undefined)
		setOpen(true)
		handle = panels.open(() => renderBrowser(), {
			id: `history-${++sequence}`,
			title: "History",
			size: "xlarge",
			onClose: () => {
				handle = undefined
				finish()
			},
		})
		void load(target)
	})

	// ---- interactions ----
	function moveCursor(delta: number) {
		setCursor((index) => turnCursorStep(index, delta, turns().length))
	}

	function refill() {
		const verdict = refillOrNotice(current())
		if (verdict.kind === "notice") {
			setStatus(verdict.text)
			return
		}
		props.onRefill?.(verdict.text)
		close()
	}

	function openSessions() {
		if (showSessions()) return
		void (async () => {
			try {
				const rows = await props.seam.listSessions(30)
				setSessions(rows)
				setSessionCursor(0)
				setShowSessions(rows.length > 0)
				if (rows.length === 0) {
					setStatus("no stored sessions to switch to")
					return
				}
				// The session layer opens HERE, not in a createEffect watching
				// showSessions() (review P0-2): panels.open reads the stack's
				// layers signal, so an effect that both reads showSessions() and
				// opens the layer re-triggers itself — one `s` press stacked three
				// layers into the maxDepth error. A direct call opens exactly one.
				panels.open(() => renderSessions(), {
					id: `history-sessions-${++sequence}`,
					title: "Switch session",
					size: "xlarge",
					onClose: () => setShowSessions(false),
				})
			} catch (error) {
				setStatus(historyFailureText("session list", error))
			}
		})()
	}

	function pickSession(index: number) {
		const picked = sessions()[index]
		if (!picked) return
		setShowSessions(false)
		// Pop the "Switch session" layer explicitly (review P0-2): without
		// this the layer stays up as an orphan — the main layer's
		// `handle === top` gate keeps it disabled for the rest of the browse.
		panels.close()
		setBrowsingId(picked.id)
		// Re-fold the picked session's journal; browsing continues on it (the
		// app session is NOT resumed here — tui-pi's in-browser switch).
		void load(picked.id)
	}

	function fork() {
		// The busy latch (review P1-3): fork is the one DURABLE hotkey here —
		// a second press while a fork is in flight (double-tap, key repeat)
		// would create a second orphan forked session. Same shape as load()
		// and the sessions-search enterKey gate: setBusy(true) below is
		// synchronous, so a same-tick double dispatch is caught too.
		if (busy()) return
		const turn = current()
		const id = browsingId()
		if (!props.seam.forkSession) {
			setStatus("fork unavailable — press c to refill the prompt instead")
			return
		}
		if (!turn || !id) return
		setBusy(true)
		void props.seam
			.forkSession!(id, turn.seqEnd)
			.then((forkedId) => {
				props.onForked?.(forkedId, turn.turn)
				close()
			})
			.catch((error: unknown) => {
				setStatus(historyFailureText("fork", error))
			})
			.finally(() => setBusy(false))
	}

	// ---- hotkeys: the consumer's own Keymap layer (agents-panel law) ----
	Keymap.createLayer(() => {
		const top = panels.top
		return {
			mode: "global",
			enabled: open() && handle !== undefined && top !== undefined && handle === top,
			priority: 2,
			commands: [
				{ bind: "up,k", title: "History: previous turn", group: "History", run: () => moveCursor(-1) },
				{ bind: "down,j", title: "History: next turn", group: "History", run: () => moveCursor(1) },
				{
					bind: "return,c",
					title: showSessions() ? "History: pick session" : "History: refill prompt",
					group: "History",
					run: () => (showSessions() ? pickSession(sessionCursor()) : refill()),
				},
				{ bind: "s", title: "History: switch session", group: "History", run: openSessions },
				{ bind: "f", title: "History: fork at turn", group: "History", run: fork },
			],
		}
	})

	// Session-layer keys ride a dedicated layer while the "Switch session"
	// panel is top (the main layer is parked behind its `handle === top`
	// gate then, so Enter must be rebound HERE — review P0-2 part 2).
	Keymap.createLayer(() => ({
		mode: "global",
		enabled: open() && showSessions(),
		priority: 3,
		commands: [
			{
				bind: "up,k",
				title: "History: previous session",
				group: "History",
				run: () => setSessionCursor((index) => turnCursorStep(index, -1, sessions().length)),
			},
			{
				bind: "down,j",
				title: "History: next session",
				group: "History",
				run: () => setSessionCursor((index) => turnCursorStep(index, 1, sessions().length)),
			},
			{
				bind: "return,c",
				title: "History: browse picked session",
				group: "History",
				run: () => pickSession(sessionCursor()),
			},
		],
	}))

	// ---- rendering ----
	function clip(text: string, width: number): string {
		if (width <= 0) return ""
		return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`
	}

	function renderBrowser(): JSX.Element {
		const muted = theme?.text.muted ?? kitTheme().text.muted
		const base = theme?.text.base ?? kitTheme().text.base
		const accent = kitTheme().text.accent ?? base
		return (
			<box flexDirection="column" flexGrow={1}>
				<PanelBody>
					<Show
						when={turns().length > 0}
						fallback={
							<text fg={muted} wrapMode="none">
								{busy() ? "loading turns…" : (status() ?? "no completed turns")}
							</text>
						}
					>
						<box flexDirection="row" height={LIST_ROWS + 1} flexShrink={0}>
							<box width={leftWidth()} flexDirection="column" flexShrink={0}>
								<For each={turns().slice(visibleWindow().start, visibleWindow().end)}>
									{(turn, index) => {
										const at = () => visibleWindow().start + index()
										return (
											<box height={1} flexShrink={0}>
												<text fg={at() === cursor() ? accent : muted} wrapMode="none">
													{at() === cursor() ? `› ${turnRowText(turn, leftWidth() - 2)}` : `  ${turnRowText(turn, leftWidth() - 2)}`}
												</text>
											</box>
										)
									}}
								</For>
								<Show when={turns().length > LIST_ROWS}>
									<box height={1} flexShrink={0}>
										<text fg={muted} wrapMode="none">
											{`${visibleWindow().start + 1}-${visibleWindow().end}/${turns().length}`}
										</text>
									</box>
								</Show>
							</box>
							<box flexGrow={1} flexDirection="column">
								<For each={detail().slice(0, LIST_ROWS)}>
									{(line) => (
										<box height={1} flexShrink={0}>
											<text fg={base} wrapMode="none">
												{clip(line === "" ? " " : line, rightWidth())}
											</text>
										</box>
									)}
								</For>
							</box>
						</box>
						<Show when={status() !== undefined}>
							<text fg={kitTheme().text.warning} wrapMode="none">
								{clip(status()!, bodyWidth())}
							</text>
						</Show>
					</Show>
				</PanelBody>
				<PanelActions hint="↑↓ turn · enter/c refill · s session · f fork · esc close" />
			</box>
		)
	}

	// (The session-switch layer is opened by openSessions() itself — a
	// createEffect watching showSessions() re-triggered on the stack's own
	// layers signal and stacked the layer to maxDepth. Review P0-2.)

	function renderSessions(): JSX.Element {
		const muted = theme?.text.muted ?? kitTheme().text.muted
		const accent = kitTheme().text.accent ?? muted
		return (
			<box flexDirection="column" flexGrow={1}>
				<PanelBody>
					<For each={sessions()}>
						{(row, index) => (
							<box height={1} flexShrink={0}>
								<text fg={index() === sessionCursor() ? accent : muted} wrapMode="none">
									{index() === sessionCursor() ? `› ` : `  `}
									{clip(row.title === "" ? row.id : row.title, bodyWidth() - 4)}
								</text>
							</box>
						)}
					</For>
				</PanelBody>
				<PanelActions hint="↑↓ session · enter browse · esc back" />
			</box>
		)
	}
}
