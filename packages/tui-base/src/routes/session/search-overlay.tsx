/**
 * SearchOverlay — the seam-native transcript search (batch H1, tui-pi
 * 22-search parity).
 *
 * Reference semantics (dsh-tui-pi scenario 22 / pi-tui alt-screen search):
 * Ctrl+Shift+F opens the find bar ("Find in transcript" placeholder), the
 * query live-counts matches over the transcript, Enter / shift+Enter walk
 * the matches (n/N), escape closes, and reopening starts a FRESH query.
 * This port counts matches over the CURRENT seam transcript rows (the
 * `projection` the page already shares with its Transcript — both faces,
 * client remote and plugin host, feed the same SeamRows store, so the
 * search source is the same settled/live row list the viewport paints).
 *
 * Jump navigation rides the scrollbox's `scrollChildIntoView(id)` — the
 * rows carry stable `seam-row-<key>` ids (transcript.tsx) — so Enter
 * scrolls the matched row to the viewport top. Match highlighting inside
 * row text is NOT ported (the rebuilt rows are markdown/tool renderables;
 * the reference's span-level highlight needs a paint seam we don't have) —
 * the counter + scroll jump is the minimal parity surface.
 *
 * Keybind: `session.search` (config/keybind.ts Definitions, default
 * ctrl+shift+f) — the vendored Definitions table had no such binding, so
 * H1 adds it. Open state is internal; while open a priority-2 modal layer
 * (target = the find input) owns escape/return/shift+return — the same
 * layer law as the SubagentsPicker (subagents-picker.tsx): the keymap runs
 * layers highest-priority first and an explicit handled key TERMINATES
 * dispatch, so TurnCancelKeys' esc and the composer's submit layer never
 * also fire while the overlay is open.
 *
 * Getter-prop law: `scroll` is an accessor (the scrollbox ref is published
 * by the page after mount); `projection` is a stable handle the page
 * re-uses with its Transcript, so a plain prop keeps ONE reactive source.
 *
 * OpenTUI law: the find strip carries an explicit height (1 line), never
 * auto-height in a flex column.
 */
import { createEffect, createMemo, createSignal, Show } from "solid-js"
import type { InputRenderable, ScrollBoxRenderable } from "@opentui/core"
import { Keymap } from "../../context/keymap"
import { useDialog } from "../../ui/dialog"
import { useThemeOptional } from "../../context/theme"
import type { SeamRow } from "./seam-rows"
import type { SeamRows } from "./seam-rows"

export type SearchOverlayProps = {
	/** The page's transcript row projection (the same handle its
	 * Transcript mounts with — both rebuilt faces feed one store). */
	projection: SeamRows
	/** The transcript scrollbox (Transcript's scrollRef product). A getter:
	 * the ref arrives after mount and may be undefined on teardown. */
	scroll?: () => ScrollBoxRenderable | undefined
}

/** The searchable text of one transcript row (lowercased by the matcher). */
export function rowSearchText(row: SeamRow): string {
	switch (row.kind) {
		case "user":
		case "assistant":
		case "reasoning":
			return row.text
		case "tool":
			return `${row.name}${row.args ? `(${row.args})` : ""}${row.output ? ` ${row.output}` : ""}`
	}
}

/** Indices (into `rows`) of the rows matching `query`, in order. The
 * matcher is a case-insensitive substring over the row's searchable text —
 * the reference's find bar counts line matches the same coarse way. */
export function findMatchRowIndices(rows: readonly SeamRow[], query: string): number[] {
	const needle = query.trim().toLowerCase()
	if (!needle) return []
	const hits: number[] = []
	for (let i = 0; i < rows.length; i++) {
		if (rowSearchText(rows[i]!).toLowerCase().includes(needle)) hits.push(i)
	}
	return hits
}

/** The find bar's status label: "" (no query), "N/M" (current/total), or
 * the reference's "No matches" for a live query with zero hits. */
export function formatMatchStatus(query: string, matchCount: number, matchIndex: number): string {
	if (!query.trim()) return ""
	if (matchCount === 0) return "No matches"
	const current = ((matchIndex % matchCount) + matchCount) % matchCount
	return `${current + 1}/${matchCount}`
}

const MATCH_ROW_ID_PREFIX = "seam-row-"

export function SearchOverlay(props: SearchOverlayProps) {
	const theme = useThemeOptional()
	const dialog = useDialog()

	const [open, setOpen] = createSignal(false)
	const [query, setQuery] = createSignal("")
	const [index, setIndex] = createSignal(0)
	const [inputTarget, setInputTarget] = createSignal<InputRenderable>()
	let input: InputRenderable | undefined

	const matches = createMemo(() => findMatchRowIndices(props.projection.rows as readonly SeamRow[], query()))
	const count = createMemo(() => matches().length)
	const status = createMemo(() => formatMatchStatus(query(), count(), index()))

	// Reopening (and typing) starts the walk over: the reference reopens a
	// FRESH query, and a changed query invalidates the current ordinal.
	createEffect(() => {
		if (!open()) return
		void query()
		setIndex(0)
	})

	// Jump: scroll the current match's row to the viewport top. The rows
	// carry stable `seam-row-<key>` ids; sticky follow must yield first or
	// it pulls the viewport back to the bottom (transcript-scroll law).
	createEffect(() => {
		if (!open()) return
		const rowIndex = matches()[index()]
		if (rowIndex === undefined) return
		const scroll = props.scroll?.()
		if (!scroll) return
		const row = props.projection.rows[rowIndex]
		if (!row) return
		scroll.stickyScroll = false
		scroll.scrollChildIntoView(`${MATCH_ROW_ID_PREFIX}${row.key}`, { align: "start" })
	})

	function openBar() {
		setQuery("")
		setIndex(0)
		setOpen(true)
	}

	function close() {
		setOpen(false)
	}

	function move(delta: number) {
		const total = count()
		if (total === 0) return
		setIndex((previous) => (((previous + delta) % total) + total) % total)
	}

	// Active layer (priority 2, above TurnCancelKeys' esc and the
	// composer's submit layer): modal on the find input so the typed query
	// reaches the input while the walk keys stay owned here.
	Keymap.createLayer(() => ({
		mode: "modal",
		target: inputTarget,
		enabled: open() && inputTarget() !== undefined && dialog.stack.length === 0,
		priority: 2,
		commands: [
			{ bind: "escape", title: "Close transcript search", group: "Search", run: close },
			{ bind: "return", title: "Next match", group: "Search", run: () => move(1) },
			{ bind: "shift+return", title: "Previous match", group: "Search", run: () => move(-1) },
		],
	}))

	// Toggle layer (closed): the `session.search` command id resolves its
	// configured binding (ctrl+shift+f) from the shared keybind config.
	Keymap.createLayer(() => ({
		mode: "global",
		enabled: !open() && dialog.stack.length === 0,
		commands: [
			{
				id: "session.search",
				title: "Search transcript",
				group: "Session",
				run: openBar,
			},
		],
	}))

	return (
		<Show when={open()}>
			<box
				flexShrink={0}
				width="100%"
				height={1}
				flexDirection="row"
				paddingLeft={1}
				paddingRight={1}
				backgroundColor={theme?.background.raised.base ?? "#1a1b26"}
			>
				<input
					flexGrow={1}
					placeholder="Find in transcript"
					placeholderColor={theme?.text.muted ?? "#565f89"}
					onInput={(value: string) => setQuery(value)}
					ref={(renderable: InputRenderable) => {
						input = renderable
						setInputTarget(renderable)
						setTimeout(() => {
							if (!input || input.isDestroyed) return
							input.focus()
						}, 1)
					}}
				/>
				<Show when={status()}>
					<text fg={theme?.text.muted ?? "#565f89"} wrapMode="none">
						{` ${status()}`}
					</text>
				</Show>
			</box>
		</Show>
	)
}
