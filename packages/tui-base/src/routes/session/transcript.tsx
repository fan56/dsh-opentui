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
 *
 * OpenTUI law honored: the auto-height boxes here sit in explicit-dims
 * parents (flexGrow + minHeight=0 chain from the session route shape); the
 * bottom slot is flexShrink=0 and its child (the composer) sets an explicit
 * height — auto-height boxes collapse in flex columns.
 */
import { For, onMount, Show, type JSX } from "solid-js"
import { useRenderer } from "@opentui/solid"
import { SyntaxStyle } from "@opentui/core"
import type { SessionSeam } from "../../seams/session"
import { createSeamRows, type SeamRow, type SeamRows } from "./seam-rows"

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
}

export function Transcript(props: TranscriptProps) {
	const renderer = useRenderer()
	const sessionID = () => props.sessionID ?? props.seam.currentSessionId() ?? ""
	const owned = props.projection === undefined
	const projection = props.projection ?? createSeamRows(props.seam, sessionID)
	const syntaxStyle = () => props.syntaxStyle ?? SyntaxStyle.fromStyles({}, renderer.nativeScene)

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
			fg="#e6e6e6"
		/>
	)

	const rowView = (row: SeamRow) => {
		switch (row.kind) {
			case "user":
				return (
					<box flexShrink={0} paddingLeft={3}>
						<text fg="#7aa2f7" wrapMode="word">
							{`❯ ${row.text}`}
						</text>
					</box>
				)
			case "reasoning":
				return (
					<box flexShrink={0} marginLeft={3} border={["left"]} borderColor="#565f89" paddingLeft={1}>
						<text fg="#9aa5ce" wrapMode="word">
							{row.text}
						</text>
					</box>
				)
			case "tool":
				return (
					<box flexShrink={0} paddingLeft={3}>
						<text
							fg={row.status === "failed" ? "#f7768e" : row.status === "running" ? "#e0af68" : "#9ece6a"}
							wrapMode="none"
						>
							{`${row.status === "done" ? "✓" : row.status === "failed" ? "✗" : "*"} ${row.name}${
								row.args ? `(${row.args})` : ""
							}`}
						</text>
					</box>
				)
			case "assistant":
				return assistantRow(row)
		}
	}

	return (
		<box flexDirection="column" flexGrow={1} minHeight={0} width="100%" backgroundColor="black">
			{/* session route shape: row > flexGrow col (position relative) > scrollbox */}
			<box flexDirection="row" flexGrow={1} minHeight={0}>
				<box flexGrow={1} minHeight={0} position="relative" paddingBottom={1}>
					<scrollbox
						flexGrow={1}
						stickyScroll={true}
						stickyStart="bottom"
						verticalScrollbarOptions={{ paddingLeft: 1, visible: true, trackOptions: {} }}
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
								<text fg="#565f89">Loading session history…</text>
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
