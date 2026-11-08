/**
 * Transcript — the rebuilt session transcript viewport (batch 3).
 *
 * Extracted from the vendored `routes/session/index.tsx` region at the
 * `<scrollbox>` (upstream 1514–1571): same visual structure —
 *
 *   row > flexGrow col (position relative) > scrollbox
 *   stickyScroll + stickyStart="bottom"   (prop-sensitive; NOT stickyScrollPosition)
 *   keyed marginTop=1 rows via <For>
 *   bottom slot (children) — the composer (batch 4, ./session-composer.tsx)
 *
 * with its feed cut over from `useData`/`useClient` to `SessionSeam`
 * (see ./seam-rows.ts for the row projection). Rendering follows the
 * vendored app exactly where it matters:
 *
 *   - assistant rows render `<markdown>` with `streaming` while the row is
 *     unfinished (upstream message-parts.tsx TextPart: `streaming={props.
 *     message.time.completed === undefined}` — @opentui 0.8.1 streams
 *     markdown natively; no finalize-only fallback is invented);
 *   - `renderNode` (the upstream markdown plugin hook) and `syntaxStyle`
 *     are injectable props; the vendored app passes `plugins.markdown()`
 *     and `useThemes().currentSyntax` — a host that has them passes them,
 *     the bare example renders without.
 *   - colors are vendored theme tokens (batch 6) when a ThemeProvider is
 *     mounted (`useThemeOptional()`), mapped the way the vendored route maps
 *     them (loading = feedback.info, tool status = feedback.success/warning/
 *     error, reasoning = text.muted); without a provider the pre-batch-6
 *     hex constants apply.
 *
 * OpenTUI law honored: the auto-height boxes here sit in explicit-dims
 * parents (flexGrow + minHeight=0 chain from the session route shape); the
 * bottom slot is flexShrink=0 and its child (the composer) sets an explicit
 * height — auto-height boxes collapse in flex columns.
 */
import { For, createMemo, createSignal, onCleanup, onMount, Show, type JSX } from "solid-js"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { SyntaxStyle, type ScrollBoxRenderable } from "@opentui/core"
import type { SessionSeam } from "../../seams/session"
import { createSeamRows, type SeamRow, type SeamRows } from "./seam-rows"
import { clipToWidth } from "./tool-summarize"
import { subagentMarkerSuffix } from "./subagent-markers"
import { useThemeOptional, useThemesOptional } from "../../context/theme"

export type TranscriptProps = {
	/** The seam feeding this transcript (NullSessionSeam in tests/examples). */
	seam: SessionSeam
	/** Session to project; defaults to the seam's current session. */
	sessionID?: string
	/**
	 * Shared projection (page wiring: the composer sends through the same
	 * rows). The owner calls `load()`; when omitted the transcript creates
	 * and loads its own.
	 */
	projection?: SeamRows
	/** Upstream markdown plugin hook (vendored app: `plugins.markdown()`). */
	renderNode?: (node: any) => any
	/** Upstream syntax style (vendored app: `useThemes().currentSyntax`). */
	syntaxStyle?: SyntaxStyle
		/** Bottom slot: the composer. */
		children?: JSX.Element
		/** Batch D1 widgets slot (dsh-tui-pi dock structure): the fixed
		 * Todos → Think → Tool panels rendered DIRECTLY ABOVE the bottom
		 * slot (the editor) — never in the transcript flow. See
		 * ./widgets-dock.tsx; the page wires it with the shared projection. */
		widgets?: JSX.Element
	/** Publishes the transcript scrollbox (vendored route's scrollRef prop
	 * shape; undefined on teardown). Page wiring binds scroll keys to it —
	 * the box itself is never focused (the composer holds the singleton
	 * focus); scrolling goes through `scrollBy` + native stickyScroll. */
	scrollRef?: (scroll: ScrollBoxRenderable | undefined) => void
	/** Vertical scrollbar (vendored `session.scrollbar` config; default off). */
	scrollbar?: boolean
}

export function Transcript(props: TranscriptProps) {
	const renderer = useRenderer()
	// Gap 1 fix: the `⎿` track clip width rides the REACTIVE terminal
	// dimensions (one resize listener for the whole transcript — this component
	// mounts once; per-row reads were the warned-against pattern). renderer.
	// width was a plain property: rows kept their stale clip until next update.
	const dimensions = useTerminalDimensions()
	const theme = useThemeOptional()
	const color = {
		text: () => theme?.text.base ?? "#e6e6e6",
		user: () => theme?.text.action.primary.base ?? "#7aa2f7",
		reasoningBorder: () => theme?.border.base ?? "#565f89",
		reasoning: () => theme?.text.muted ?? "#9aa5ce",
		done: () => theme?.text.feedback.success.base ?? "#9ece6a",
		running: () => theme?.text.feedback.warning.base ?? "#e0af68",
		failed: () => theme?.text.feedback.error.base ?? "#f7768e",
		// Batch V5: the failed tool block's ⎿ track rides the error MUTED
		// variant — the red emphasis reads as one block, not a red wall.
		failedMuted: () => theme?.text.feedback.error.muted ?? "#8a4b5c",
		loading: () => theme?.text.feedback.info.base ?? "#565f89",
		background: () => theme?.background.base ?? "black",
	}
	// Batch V5 status-color family (the ONE mapping every transcript status
	// line shares — tool block, think summary, subagent tree): running=warn,
	// ok=success, fail=error, cancelled=muted. Theme tokens only; the hex
	// literals live in the fallback map above.
	const stateColor = (state: "running" | "ok" | "failed" | "cancelled") =>
		state === "running" ? color.running() : state === "ok" ? color.done() : state === "failed" ? color.failed() : color.reasoning()
	const sessionID = () => props.sessionID ?? props.seam.currentSessionId() ?? ""
	const owned = props.projection === undefined
	const projection = props.projection ?? createSeamRows(props.seam, sessionID)
	const themes = useThemesOptional()
	const syntaxStyle = () =>
		props.syntaxStyle ?? themes?.currentSyntax() ?? SyntaxStyle.fromStyles({}, renderer.nativeScene)

	// Batch V1 tool block: shared spinner tick (one interval, one signal —
	// only the running rows' text nodes re-render on the tick; settled rows
	// never re-read it). dsh-tui-pi ToolPanel semantics: braille frames while
	// pending, ✓/✗ freeze on settle.
	const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
	const [spin, setSpin] = createSignal(0)
	onMount(() => {
		const timer = setInterval(() => setSpin((s) => s + 1), 120)
		onCleanup(() => clearInterval(timer))
	})

	/** Batch D1 (dsh-tui-pi dock structure): tool blocks and think rows are
	 * GONE from the transcript — they render in the fixed widgets dock above
	 * the composer (./widgets-dock.tsx, the page wires it). The transcript
	 * paints user/assistant/echo/notice/ask blocks only. The subagent tree
	 * row stays here for batch D2 to move. */

	/** Batch V2b subagent tree row (tui-pi subagent-tree semantics,
	 * transcript-block shape): one line per child — `├─/└─` track + live
	 * status (braille spinner → ✔/✘/⊘) + label(agent/model) + duration
	 * (ticks live off startedAt while running, freezes at elapsedSec on
	 * settle) + the F6 marker suffix. The shared spinner tick re-renders
	 * only RUNNING children's text nodes (same law as the tool block). */
	const subagentsRow = (row: Extract<SeamRow, { kind: "subagents" }>) => {
		const glyphs = {
			running: () => `${SPINNER_FRAMES[spin() % SPINNER_FRAMES.length]} `,
			completed: () => "✔ ",
			failed: () => "✘ ",
			cancelled: () => "⊘ ",
		} as const
		return (
			<box flexShrink={0} paddingLeft={3} flexDirection="column">
				<For each={row.children}>
					{(child, index) => {
						const track = index() === row.children.length - 1 ? "└─ " : "├─ "
						// Batch V5: the tree's status colors route through the SAME
						// stateColor family mapping as the tool block and the think
						// summary (running=warn, completed=ok, failed=error,
						// cancelled=muted) — no per-row ad-hoc mapping left.
						const statusColor = stateColor(
							child.status === "completed" ? "ok" : child.status === "failed" ? "failed" : child.status,
						)
						const label =
							`${track}${child.label}${child.model ? `(${child.model})` : ""}` +
							subagentMarkerSuffix(child)
						const line = createMemo(() => {
							const elapsed =
								child.status === "running"
									? child.startedAt !== undefined
										? ` · ${((Date.now() - child.startedAt) / 1000).toFixed(1)}s`
										: ""
									: child.elapsedSec !== undefined
										? ` · ${child.elapsedSec.toFixed(1)}s`
										: ""
							// Display-column clip (P1-1 CJK law) — same budget as the tool block.
							return clipToWidth(`${glyphs[child.status]()}${label}${elapsed}`, Math.max(16, dimensions().width - 5))
						})
						return (
							<text fg={statusColor} wrapMode="none">
								{line()}
							</text>
						)
					}}
				</For>
			</box>
		)
	}

	onMount(() => {
		if (owned) projection.load()
	})

	const assistantRow = (row: Extract<SeamRow, { kind: "assistant" }>) => (
		<markdown
			// Vendored TextPart shape: configure plugins before content, stream
			// until finalize so completion keeps the final tokens.
			renderNode={props.renderNode}
			content={row.text}
			streaming={!row.final}
			internalBlockMode="top-level"
			// Table parity with the vendored TextPart (message-parts.tsx): without
			// an explicit style the top-level block mode falls back to borderless
			// "columns" tables — the grid borders never render.
			tableOptions={{ style: "grid", cellPaddingX: 1 }}
			syntaxStyle={syntaxStyle()}
			fg={color.text()}
		/>
	)

	// Batch D1: tool/reasoning rows stay in the store (the widgets dock reads
	// them there) but never paint in the flow — the visible feed is the
	// tui-pi chat-clean set. The subagent tree stays until D2 moves it.
	const visibleRows = createMemo(
		() => projection.rows.filter((row) => row.kind !== "tool" && row.kind !== "reasoning") as readonly SeamRow[],
	)

	const rowView = (row: SeamRow) => {
		switch (row.kind) {
			case "user":
				return (
					<box flexShrink={0} paddingLeft={3}>
						<text fg={color.user()} wrapMode="word">
							{`❯ ${row.text}`}
						</text>
					</box>
				)
			case "subagents":
				return subagentsRow(row)
			case "assistant":
				return assistantRow(row)
			default:
				return null
		}
	}

	onCleanup(() => {
		props.scrollRef?.(undefined)
	})

	return (
		<box flexDirection="column" flexGrow={1} minHeight={0} width="100%" backgroundColor={color.background()}>
			{/* session route shape: row > flexGrow col (position relative) > scrollbox */}
			<box flexDirection="row" flexGrow={1} minHeight={0}>
				<box flexGrow={1} minHeight={0} position="relative" paddingBottom={1}>
					<scrollbox
						flexGrow={1}
						/* Batch 11 (U1 layout finding): rows never shrink (flexShrink=0
						 * below) and the scroll container clips paint overflow — without
						 * the clip, overflowing content paints past the box over the
						 * composer dock (verified: flexShrink=0 alone still bleeds;
						 * +overflow hidden is clean). stickyScroll still owns vertical
						 * scrolling; this only guards the paint. */
						overflow="hidden"
						stickyScroll={true}
						stickyStart="bottom"
						/* Batch V2: the vendored route's scrollbar contract —
						 * `visible: config.session?.scrollbar ?? false` (index.tsx:251,
						 * 1540-1547) with a THEMED track. The previous always-on bar
						 * with empty track options painted OpenTUI's default gray █
						 * track (fg 154,158,163 / bg 37,37,39) down the right column. */
						viewportOptions={{ paddingRight: props.scrollbar ? 1 : 0 }}
						verticalScrollbarOptions={{
							paddingLeft: 1,
							visible: props.scrollbar ?? false,
							trackOptions: {
								backgroundColor: color.background(),
								foregroundColor: color.reasoningBorder(),
							},
						}}
						ref={(value: ScrollBoxRenderable) => {
							props.scrollRef?.(value)
						}}
					>
						<For each={visibleRows()}>
							{(row) => (
								<box id={`seam-row-${row.key}`} marginTop={1} flexShrink={0}>
									{rowView(row)}
								</box>
							)}
						</For>
						<Show when={projection.hydrated() === false}>
							<box flexShrink={0}>
								<text fg={color.loading()}>Loading session history…</text>
							</box>
						</Show>
					</scrollbox>
				</box>
			</box>
			{/* widgets slot (batch D1, ./widgets-dock.tsx): the fixed Todos →
			 * Think → Tool panels directly ABOVE the bottom slot (the editor).
			 * Each child owns its explicit height (the dock counts its lines;
			 * the composer sets its own) — auto-height boxes collapse. */}
			<Show when={props.widgets || props.children}>
				<box width="100%" flexShrink={0} flexDirection="column">
					{props.widgets}
					{props.children}
				</box>
			</Show>
		</box>
	)
}

export type { SeamRow }
