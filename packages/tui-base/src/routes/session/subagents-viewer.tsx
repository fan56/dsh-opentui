/**
 * SubagentsViewer — the /subagents large-window transcript viewer (gap C3,
 * dsh-tui-pi subagent-viewer.ts parity).
 *
 * tui-pi's Ctrl+G surface, two levels, both on the panel-kit stack (the
 * /history browser law):
 *
 *   LIST LAYER (xlarge) — the bridge's child views, running first, then the
 *   most recent settled rows (the SETTLED_CAP slice). A row reads
 *   `⠋ label · rounds N · elapsed · model` with the F6 marker suffix
 *   (`⚡ injected` / `⏻ hard-stopped @N`, subagent-markers.ts shapes). Enter
 *   pushes the transcript layer for the selected child; `s` toggles the
 *   rounds-descending sort (tui-pi's `s`); `K` stop-all interrupts every
 *   RUNNING child (tui-pi's `K` — cancelAllChildren parity, one interrupt RPC
 *   per running child); esc closes. tui-pi's `r` (attention ranking) is
 *   deliberately absent — this stack carries no attention face, so there is
 *   nothing honest to sort by.
 *
 *   TRANSCRIPT LAYER (xlarge) — the child's buffered log (the client's child
 *   follow pump folds it live: tool ▶/⎿ rows, assistant text lines —
 *   remote-subagents.ts #foldChildEvent). Re-read per ~500ms tick while the
 *   layer is top, following the tail like tui-pi's follow:'end'; an explicit
 *   scroll-up detaches, reaching the bottom re-attaches. Enter opens the
 *   steer prompt (the picker's DialogPrompt shape; the text rides
 *   seam.steerChild — the registered steerChild face, NOT a re-implementation
 *   of the subagents/prompt wire). `x` twice within the double-press window
 *   interrupts a RUNNING child (seam.interruptChild — the
 *   subagents/interruptByParent RPC); a settled child reports that there is
 *   nothing left to stop. esc pops back to the list layer.
 *
 * Data faces are the EXISTING seam surface — subagentViews/onSubagentViews
 * (batch F6), steerChild (batch G2) plus the two new 1:1 forwards
 * subagentTranscript/interruptChild; nothing here re-implements the wire.
 * Missing optional faces degrade to honest notices (the /plugins contract).
 *
 * Open state rides the module bridge signal (the /plugins panel law); the
 * sidebar priority-10 Esc layer yields on subagentsViewerOpen.
 */
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import {
	PanelActions,
	PanelBody,
	usePanelTheme,
	usePanels,
	type PanelHandle,
} from "@dsh-opentui/panel-kit"
import { Keymap } from "../../context/keymap"
import { useDialog } from "../../ui/dialog"
import { DialogPrompt } from "../../ui/dialog-prompt"
import { useThemeOptional } from "../../context/theme"
import { Locale } from "../../util/locale"
import { clipToWidth } from "./tool-summarize"
import { subagentHardStopGlyph, subagentMarkerSuffix } from "./subagent-markers"
import type { SeamSubagentView, SessionSeam } from "../../seams/session"

/** Rows of the list layer visible without scrolling (the history law). */
const LIST_ROWS = 12
/** How many settled children appear after the running ones (tui-pi parity). */
const SETTLED_CAP = 5
/** Live-refresh interval of the transcript layer while it is top. */
const TRANSCRIPT_TICK_MS = 500
/** The transcript tail window rendered under the header (xlarge body budget). */
const TRANSCRIPT_ROWS = 14
/** The `x ×2` stop gesture window (ms) — a deliberate double press only. */
const DOUBLE_PRESS_MS = 600
/** The minimum gap between the two `x` presses (ms) — a held key's
 * auto-repeat (~30-50ms apart) must never complete the double press and
 * interrupt a RUNNING child (tui-pi keymap MIN_DOUBLE_PRESS_GAP_MS parity). */
export const MIN_DOUBLE_PRESS_GAP_MS = 80

const [bridgeOpen, setBridgeOpen] = createSignal(false)
// Module-scope open state: the session sidebar Esc layer (priority 10)
// yields while the viewer owns the screen (the skills-panel law).
const [panelOpen, setPanelOpen] = createSignal(false)
/** Whether the /subagents viewer is on screen. */
export const subagentsViewerOpen = panelOpen

/** Open the subagents viewer (the /subagents command path). */
export function openSubagentsViewer(): void {
	setBridgeOpen(true)
}

/**
 * The panel's module-scope open state. Unmount resets it: the sidebar's
 * priority-10 Esc layer yields on this signal, so a stale `true` would leave
 * Esc dead for the rest of the session.
 */
export function useSubagentsViewerOpenState() {
	onCleanup(() => setPanelOpen(false))
	return [subagentsViewerOpen, setPanelOpen] as const
}

// ------------------------------------------------------------- pure helpers --

/**
 * The list rows: running children first (the live items the viewer is for),
 * then the most recent settled slice (capped). Settled rows sort by `endedAt`
 * descending — the spawn-order Map behind `views()` keeps insertion order, so
 * a plain slice surfaced the OLDEST five ended children once the cap engaged
 * (tui-pi sorts by endedAt before slicing, subagent-viewer.ts:368-374).
 * Rows without `endedAt` (legacy producers) sort oldest — they lose to dated
 * rows. Pure and unit-tested.
 */
export function viewerRows(views: readonly SeamSubagentView[]): SeamSubagentView[] {
	const running = views.filter((view) => view.status === "running")
	const settled = views
		.filter((view) => view.status !== "running")
		.sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
		.slice(0, SETTLED_CAP)
	return [...running, ...settled]
}

/**
 * One list row: `⠋ Label · rounds N[/cap] · elapsed · model` with the F6
 * marker suffix. `elapsedText` arrives precomputed (the caller ticks it).
 */
export function viewerRowText(
	view: SeamSubagentView,
	roundCap: number | undefined,
	elapsedText: string | undefined,
): string {
	const glyph = view.status === "running" ? "⠋" : view.status === "completed" ? "✓" : view.status === "failed" ? "✗" : "—"
	const stop = subagentHardStopGlyph(view)
	const label = `${stop ? `${stop} ` : ""}${Locale.titlecase(view.label)}`
	const suffix = subagentMarkerSuffix(view)
	const cap = roundCap !== undefined && roundCap > 0 ? `/${roundCap}` : ""
	const elapsed = elapsedText !== undefined && elapsedText !== "" ? ` · ${elapsedText}` : ""
	const model = view.model !== undefined ? ` · ${view.model}` : ""
	return `${glyph} ${label} · rounds ${view.rounds}${cap}${elapsed}${model}${suffix ? ` ${suffix.trim()}` : ""}`
}

/** Human elapsed display (tui-pi formatElapsed parity): `42.1s`, then `3m12s`. */
export function formatViewerElapsed(ms: number): string {
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
	const total = Math.floor(ms / 1000)
	return `${Math.floor(total / 60)}m${String(total % 60).padStart(2, "0")}s`
}

/** One row's elapsed text: running rows tick live off startedAt, settled rows
 * read the frozen elapsedSec; absent facts render nothing (never a guess). */
export function rowElapsedText(view: SeamSubagentView, now: number): string | undefined {
	if (view.status === "running" && view.startedAt !== undefined) {
		return formatViewerElapsed(Math.max(0, now - view.startedAt))
	}
	if (view.elapsedSec !== undefined) return `${view.elapsedSec.toFixed(1)}s`
	return undefined
}

/**
 * The next scroll offset after one scroll step (P1-3, tui-pi followEnd
 * re-location parity, subagent-viewer.ts:744-750): a saturating follow
 * offset (MAX_SAFE_INTEGER pins the tail at open) first lands on the real
 * window's bottom, then steps — so ↑/k detaches instead of re-clamping to
 * the tail every press, and scrolling back to the bottom re-follows
 * (transcriptWindow's `follow` flips when the offset reaches maxScroll).
 * Pure and unit-tested.
 */
export function scrollTarget(delta: number, offset: number, lineCount: number, visible: number): number {
	const maxScroll = Math.max(0, lineCount - visible)
	const start = Math.min(offset, maxScroll) // rebase a saturating follow offset onto the real window
	return Math.max(0, Math.min(start + delta, maxScroll)) // the bottom edge re-follows
}

/**
 * The transcript scroll window: `offset` clamped into [0, maxScroll], and the
 * follow flag — pinned to the tail when the offset sits at maxScroll (tui-pi
 * follow:'end' + scroll-detach semantics). Pure and unit-tested.
 */
export function transcriptWindow(
	lineCount: number,
	offset: number,
	visible: number,
): { start: number; end: number; follow: boolean } {
	const maxScroll = Math.max(0, lineCount - visible)
	const start = Math.max(0, Math.min(offset, maxScroll))
	return { start, end: Math.min(lineCount, start + visible), follow: start === maxScroll }
}

/** The steer outcome echo (the picker's e2e-asserted shapes). */
export function steerEchoText(sent: boolean, label: string): string {
	const agent = Locale.titlecase(label)
	return sent ? `steered ${agent.toLowerCase()}` : `steer rejected — ${agent} is not running`
}

/** The stop-all summary (tui-pi viewer.stopAllOne/Many parity). */
export function stopAllSummary(stopped: number): string {
	return stopped === 1 ? "stop requested — 1 subagent" : `stop requested — ${stopped} subagents`
}

/** Whether a second `x` press within the window completes the double press.
 * The gap must be deliberate: fast enough to be a human double tap (≤600ms),
 * slow enough that a held key's auto-repeat never completes it (≥80ms). */
export function doublePressArmed(lastPress: number, now: number): boolean {
	const gap = now - lastPress
	return lastPress > 0 && gap >= MIN_DOUBLE_PRESS_GAP_MS && gap <= DOUBLE_PRESS_MS
}

// ---------------------------------------------------------------- component --

export function SubagentsViewer(props: {
	/** GETTER prop (reactive-prop law): the session seam (faces read live). */
	seam: SessionSeam
	onClosed?: () => void
}) {
	const panels = usePanels()
	const kitTheme = usePanelTheme()
	const theme = useThemeOptional()
	const dialog = useDialog()

	const [open, setOpen] = useSubagentsViewerOpenState()
	const [views, setViews] = createSignal<SeamSubagentView[]>([])
	const [cursor, setCursor] = createSignal(0)
	const [sortByRounds, setSortByRounds] = createSignal(false)
	const [browsingId, setBrowsingId] = createSignal<string | undefined>(undefined)
	const [tick, setTick] = createSignal(0)
	const [scrollOffset, setScrollOffset] = createSignal(0)
	const [status, setStatus] = createSignal<string | undefined>(undefined)
	let handle: PanelHandle | undefined
	let transcriptHandle: PanelHandle | undefined
	let sequence = 0
	/** Timestamp of the last `x` press on the transcript layer (0 = none). */
	let lastXPress = 0
	let tickTimer: ReturnType<typeof setInterval> | undefined
	let statusTimer: ReturnType<typeof setTimeout> | undefined
	/** P2-4: shift+k latch — one stop-all sweep per keypress, no repeats. */
	let stopAllLatch = false
	onCleanup(() => {
		clearInterval(tickTimer)
		clearTimeout(statusTimer)
	})

	// Live rows: the snapshot now + a push listener for every fold (adoption,
	// round, marker, settle) — the same subscription the picker rides.
	function refreshViews() {
		setViews(props.seam.subagentViews?.() ?? [])
	}

	/** One transient status line (undefined clears); notices auto-clear. */
	function flash(message: string | undefined, autoClearMs?: number) {
		clearTimeout(statusTimer)
		setStatus(message)
		if (autoClearMs !== undefined) {
			statusTimer = setTimeout(() => setStatus(undefined), autoClearMs)
		}
	}

	// ---- list layer ----
	const rows = createMemo(() => {
		void tick() // elapsed re-render on the tick
		const list = [...viewerRows(views())]
		if (sortByRounds()) list.sort((a, b) => b.rounds - a.rounds)
		return list
	})

	function moveCursor(delta: number) {
		const count = rows().length
		if (count === 0) return
		setCursor((index) => (index + delta + count) % count)
	}

	/** K stop-all: one interrupt RPC per RUNNING child (best-effort each).
	 * Latched until the roster shows no more running children — a repeated
	 * shift+k must not re-fire the interrupts (P2-4). */
	function stopAll() {
		const seam = props.seam
		if (seam.interruptChild === undefined) {
			flash("stop unavailable — no interrupt face in this session")
			return
		}
		const targets = views().filter((view) => view.status === "running")
		if (targets.length === 0) {
			stopAllLatch = false
			flash("no running subagents to stop")
			return
		}
		if (stopAllLatch) {
			flash(stopAllSummary(targets.length))
			return
		}
		stopAllLatch = true
		for (const target of targets) {
			void seam.interruptChild(target.id).catch((error: unknown) => {
				flash(`stop failed — ${String(error instanceof Error ? error.message : error).slice(0, 120)}`)
			})
		}
		flash(stopAllSummary(targets.length))
	}

	// ---- transcript layer ----
	const browsing = createMemo(() => views().find((view) => view.id === browsingId()))
	/** The child's buffered log, re-read per tick (the pump folds underneath). */
	const transcript = createMemo(() => {
		void tick()
		const id = browsingId()
		if (id === undefined) return []
		const face = props.seam.subagentTranscript
		if (face === undefined) return []
		return face(id)
	})
	const window = createMemo(() => transcriptWindow(transcript().length, scrollOffset(), TRANSCRIPT_ROWS))

	function startTicking() {
		if (tickTimer !== undefined) return
		tickTimer = setInterval(() => {
			try {
				refreshViews()
				setTick((n) => n + 1)
			} catch {
				/* a throwing tick must never take the process down — skip the frame */
			}
		}, TRANSCRIPT_TICK_MS)
	}

	function stopTicking() {
		clearInterval(tickTimer)
		tickTimer = undefined
	}

	function scrollBy(delta: number) {
		// P1-3: rebase a saturating follow offset onto the real window before
		// stepping (scrollTarget) — a bare `offset + delta` from MAX_SAFE_INTEGER
		// re-clamped to the tail forever and made scroll-up a visual no-op.
		setScrollOffset((offset) => scrollTarget(delta, offset, transcript().length, TRANSCRIPT_ROWS))
	}

	function openTranscript(id: string) {
		setBrowsingId(id)
		setScrollOffset(Number.MAX_SAFE_INTEGER) // start pinned to the tail
		lastXPress = 0
		setStatus(undefined)
		// A direct call opens exactly one layer (the history-panel P0-2 law:
		// an effect watching a signal would re-trigger on the stack's layers).
		transcriptHandle = panels.open(() => renderTranscript(), {
			id: `subagents-transcript-${++sequence}`,
			title: "Subagent transcript",
			size: "xlarge",
			onClose: () => {
				transcriptHandle = undefined
				stopTicking()
			},
		})
		startTicking()
	}

	/** Enter on the transcript: the steer prompt (the picker's DialogPrompt). */
	function openSteer() {
		const view = browsing()
		const id = browsingId()
		if (view === undefined || id === undefined) return
		if (view.status !== "running") {
			flash("this subagent has ended — steering unavailable")
			return
		}
		if (props.seam.steerChild === undefined) {
			flash("steer unavailable in this session")
			return
		}
		const agent = Locale.titlecase(view.label)
		dialog.replace(() => (
			<DialogPrompt
				title={`Steer ${agent}`}
				placeholder="Steer message"
				onConfirm={(value) => {
					const text = value.trim()
					dialog.clear()
					if (!text) return
					const sent = props.seam.steerChild!(id, text)
					flash(steerEchoText(sent, view.label))
				}}
				onCancel={() => dialog.clear()}
			/>
		))
	}

	/** `x` on the transcript: a deliberate double press stops the child. */
	function stopChild() {
		const view = browsing()
		const id = browsingId()
		if (view === undefined || id === undefined) return
		const now = Date.now()
		if (!doublePressArmed(lastXPress, now)) {
			lastXPress = now
			flash("press x again to stop this subagent")
			return
		}
		lastXPress = 0
		if (view.status !== "running") {
			flash("nothing to stop — this subagent has ended")
			return
		}
		const face = props.seam.interruptChild
		if (face === undefined) {
			flash("stop unavailable — no interrupt face in this session")
			return
		}
		void face(id)
			.then(() => flash(`stop requested — ${Locale.titlecase(view.label)}`))
			.catch((error: unknown) => {
				flash(`stop failed — ${String(error instanceof Error ? error.message : error).slice(0, 120)}`)
			})
	}

	// ---- open / close (the agents-panel bridge shape) ----
	function finish() {
		stopTicking()
		setOpen(false)
		setStatus(undefined)
		setTimeout(() => props.onClosed?.(), 3)
	}

	createEffect(() => {
		if (!bridgeOpen()) return
		setBridgeOpen(false)
		if (handle !== undefined) return
		refreshViews()
		setCursor(0)
		setSortByRounds(false)
		setBrowsingId(undefined)
		setStatus(undefined)
		stopAllLatch = false
		setOpen(true)
		handle = panels.open(() => renderList(), {
			id: `subagents-${++sequence}`,
			title: "Subagents",
			size: "xlarge",
			onClose: () => {
				handle = undefined
				// Closing the list layer from outside (esc pops the stack top —
				// which is the list only when no transcript is up) tears the
				// whole viewer down; the transcript layer pops first on its own.
				if (transcriptHandle === undefined) finish()
			},
		})
	})

	// ---- hotkeys: the consumer's own Keymap layer (history-panel law) ----
	Keymap.createLayer(() => {
		const top = panels.top
		return {
			mode: "global",
			enabled: open() && transcriptHandle === undefined && handle !== undefined && handle === top && dialog.stack.length === 0,
			priority: 2,
			commands: [
				{ bind: "up,k", title: "Subagents: previous child", group: "Subagents", run: () => moveCursor(-1) },
				{ bind: "down,j", title: "Subagents: next child", group: "Subagents", run: () => moveCursor(1) },
				{
					bind: "return",
					title: "Subagents: open transcript",
					group: "Subagents",
					run: () => {
						const row = rows()[cursor()]
						if (row !== undefined) openTranscript(row.id)
						return true
					},
				},
				{
					bind: "s",
					title: "Subagents: sort by rounds",
					group: "Subagents",
					run: () => {
						setSortByRounds((value) => !value)
						return true
					},
				},
				{ bind: "shift+k", title: "Subagents: stop all running", group: "Subagents", run: stopAll },
			],
		}
	})

	Keymap.createLayer(() => {
		const top = panels.top
		return {
			mode: "global",
			enabled: open() && transcriptHandle !== undefined && transcriptHandle === top && dialog.stack.length === 0,
			priority: 2,
			commands: [
				{ bind: "up,k", title: "Transcript: scroll up", group: "Subagents", run: () => scrollBy(-1) },
				{ bind: "down,j", title: "Transcript: scroll down", group: "Subagents", run: () => scrollBy(1) },
				{ bind: "return", title: "Transcript: steer subagent", group: "Subagents", run: openSteer },
				{ bind: "x", title: "Transcript: press twice to stop", group: "Subagents", run: stopChild },
			],
		}
	})

	// ---- rendering ----
	function clip(text: string, width: number): string {
		if (width <= 0) return ""
		return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`
	}

	const bodyWidth = 110

	function headerText(view: SeamSubagentView | undefined, now: number): string {
		if (view === undefined) return "subagent"
		const status =
			view.status === "running" ? "running" : view.status === "completed" ? "completed" : view.status === "failed" ? "failed" : "cancelled"
		const elapsed = rowElapsedText(view, now)
		const parts = [`${Locale.titlecase(view.label)} · ${status} · rounds ${view.rounds}`]
		if (elapsed !== undefined) parts.push(elapsed)
		if (view.model !== undefined) parts.push(view.model)
		return clip(parts.join(" · "), bodyWidth)
	}

	function renderList() {
		const muted = theme?.text.muted ?? kitTheme().text.muted
		const accent = kitTheme().text.accent ?? muted
		const list = rows()
		const start = Math.max(0, Math.min(cursor() - LIST_ROWS + 1, Math.max(0, list.length - LIST_ROWS)))
		return (
			<box flexDirection="column" flexGrow={1}>
				<PanelBody>
					<Show
						when={list.length > 0}
						fallback={
							<text fg={muted} wrapMode="none">
								{`no subagents in this session — spawn one and it shows up here`}
							</text>
						}
					>
						<For each={list.slice(start, start + LIST_ROWS)}>
							{(row, index) => {
								const at = () => start + index()
								return (
									<box height={1} flexShrink={0}>
										<text fg={at() === cursor() ? accent : muted} wrapMode="none">
											{clipToWidth(
												`${at() === cursor() ? "› " : "  "}${viewerRowText(row, undefined, rowElapsedText(row, Date.now()))}`,
												bodyWidth,
											)}
										</text>
									</box>
								)
							}}
						</For>
					</Show>
					<Show when={status() !== undefined}>
						<text fg={kitTheme().text.warning} wrapMode="none">
							{clip(status()!, bodyWidth)}
						</text>
					</Show>
				</PanelBody>
				<PanelActions hint={sortByRounds() ? "↑↓ select · enter transcript · s start order · shift+k stop all · esc close" : "↑↓ select · enter transcript · s sort by rounds · shift+k stop all · esc close"} />
			</box>
		)
	}

	function renderTranscript() {
		const muted = theme?.text.muted ?? kitTheme().text.muted
		const base = theme?.text.base ?? kitTheme().text.base
		const view = browsing()
		const facePresent = props.seam.subagentTranscript !== undefined
		const lines = transcript()
		const win = window()
		return (
			<box flexDirection="column" flexGrow={1}>
				<PanelBody>
					<text fg={kitTheme().text.accent ?? base} wrapMode="none">
						{clipToWidth(headerText(view, Date.now()), bodyWidth)}
					</text>
					<Show
						when={facePresent}
						fallback={
							<text fg={muted} wrapMode="none">
								{`transcript unavailable in this session (no subagent transcript face)`}
							</text>
						}
					>
						<Show
							when={lines.length > 0}
							fallback={
								<text fg={muted} wrapMode="none">
									{`no activity yet — the child's events land here live`}
								</text>
							}
						>
							<For each={lines.slice(win.start, win.end)}>
								{(line) => (
									<box height={1} flexShrink={0}>
										<text fg={base} wrapMode="none">
											{clipToWidth(line === "" ? " " : line, bodyWidth)}
										</text>
									</box>
								)}
							</For>
							<Show when={lines.length > TRANSCRIPT_ROWS}>
								<box height={1} flexShrink={0}>
									<text fg={muted} wrapMode="none">
										{`${win.start + 1}-${win.end}/${lines.length}${win.follow ? " (following)" : " (detached — scroll to the bottom to re-follow)"}`}
									</text>
								</box>
							</Show>
						</Show>
					</Show>
					<Show when={status() !== undefined}>
						<text fg={kitTheme().text.warning} wrapMode="none">
							{clip(status()!, bodyWidth)}
						</text>
					</Show>
				</PanelBody>
				<PanelActions hint="↑↓ scroll · enter steer · x×2 stop · esc back" />
			</box>
		)
	}

	// Mount-time subscription (the picker law): subscribing keeps THIS face's
	// adapter folding the live snapshot; the body also feeds the local rows.
	if (props.seam.onSubagentViews) {
		onCleanup(
			props.seam.onSubagentViews((next) => {
				setViews(next)
			}),
		)
	}

	// The component paints nothing itself — the layers ride the panel stack
	// (the history-panel shape; renderList/renderTranscript are the payloads).
}
