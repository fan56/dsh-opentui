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
import { For, createSignal, onCleanup, onMount, Show, type JSX } from "solid-js"
import { useRenderer } from "@opentui/solid"
import { SyntaxStyle, type ScrollBoxRenderable } from "@opentui/core"
import type { SessionSeam } from "../../seams/session"
import { createSeamRows, type SeamRow, type SeamRows } from "./seam-rows"
import { clipToWidth, toolDetail, toolResultLine, toolSubject } from "./tool-summarize"
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
	const theme = useThemeOptional()
	const color = {
		text: () => theme?.text.base ?? "#e6e6e6",
		user: () => theme?.text.action.primary.base ?? "#7aa2f7",
		reasoningBorder: () => theme?.border.base ?? "#565f89",
		reasoning: () => theme?.text.muted ?? "#9aa5ce",
		done: () => theme?.text.feedback.success.base ?? "#9ece6a",
		running: () => theme?.text.feedback.warning.base ?? "#e0af68",
		failed: () => theme?.text.feedback.error.base ?? "#f7768e",
		loading: () => theme?.text.feedback.info.base ?? "#565f89",
		background: () => theme?.background.base ?? "black",
	}
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

	/** One tool row (tui-pi ToolPanel semantics, transcript-block shape):
	 * title line = spinner/✓/✗ + Name(subject); the `⎿` track line carries
	 * the arg detail while running and the result first line once settled. */
	const toolRow = (row: Extract<SeamRow, { kind: "tool" }>) => {
		const subject = toolSubject(row.args)
		const title = subject === "" ? row.name : `${row.name}(${subject})`
		const statusColor =
			row.status === "failed" ? color.failed() : row.status === "running" ? color.running() : color.done()
		const marker = row.status === "running" ? `${SPINNER_FRAMES[spin() % SPINNER_FRAMES.length]} ` : row.status === "failed" ? "✗ " : "✓ "
		// Running shows the arg summary; settled shows the result tail (the
		// collapse-to-summary: the raw JSON never renders on either line).
		const track = row.status === "running" ? toolDetail(row.args) : toolResultLine(row.output)
		return (
			<box flexShrink={0} paddingLeft={3} flexDirection="column">
				<text fg={statusColor} wrapMode="none">
					{`${marker}${title}`}
				</text>
				<Show when={track !== ""}>
					<text fg={color.reasoning()} wrapMode="none">{`  ⎿ ${clipToWidth(track, Math.max(20, renderer.width - 10))}`}</text>
				</Show>
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
			syntaxStyle={syntaxStyle()}
			fg={color.text()}
		/>
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
			case "reasoning":
				return (
					<box flexShrink={0} marginLeft={3} border={["left"]} borderColor={color.reasoningBorder()} paddingLeft={1}>
						<text fg={color.reasoning()} wrapMode="word">
							{row.text}
						</text>
					</box>
				)
			case "tool":
				return toolRow(row)
			case "assistant":
				return assistantRow(row)
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
						<For each={projection.rows as readonly SeamRow[]}>
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
			{/* bottom slot: the composer (./session-composer.tsx) sets its own explicit height */}
			<Show when={props.children}>
				<box width="100%" flexShrink={0}>
					{props.children}
				</box>
			</Show>
		</box>
	)
}

export type { SeamRow }
