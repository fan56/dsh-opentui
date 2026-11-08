/**
 * ThinkPanelRow — batch V2a: the live think panel as a transcript row.
 *
 * The old-stack dock law (dsh-tui-pi ThinkPanel phase machine, transcript
 * shape): the first reasoning delta OPENS the bordered live panel — spinner
 * + streaming tail refresh per tick; the first text char / a tool call
 * COLLAPSES it to the one-line summary (`💭 thought · Xs · <first line>`);
 * turn end fades the summary (the fade timer lives in seam-rows.ts). A
 * silent thinking period paints nothing — no delta, no panel, no empty box.
 *
 * Getter-props law: every prop is an accessor and the derived text nodes
 * are memos reading them lazily — a spinner tick re-renders only the tick
 * text nodes of the ONE streaming row; settled rows and the rest of the
 * transcript never re-read `spin`.
 *
 * Batch V5 (UI polish, semantics unchanged): the streaming spinner and the
 * collapsed summary's `💭 thought · Xs` prefix join the transcript's shared
 * status-color family (running=warn, ok=success) — colors are caller-injected
 * accessors; this component never hardcodes one.
 */
import { For, Show, createMemo, type JSX } from "solid-js"
import type { RGBA } from "@opentui/core"
import type { SeamRow } from "./seam-rows"
import { clipToWidth } from "./tool-summarize"
import { stringWidth } from "../../util/string-width"

export type ThinkRow = Extract<SeamRow, { kind: "reasoning" }>

/** Braille spinner cycle (same frames as the tool rows). */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

/** Body tail budget: the streaming panel shows at most the last 3 lines. */
const TAIL_LINES = 3

export function ThinkPanelRow(props: {
	row: () => ThinkRow
	/** Shared transcript spinner tick (transcript.tsx owns the interval). */
	spin: () => number
	/** Reactive terminal width, for display-column clipping. */
	width: () => number
	color: {
		border: () => string | RGBA
		spinner: () => string | RGBA
		text: () => string | RGBA
		/** Batch V5: the collapsed summary's `💭 thought · Xs` prefix rides the
		 * shared ok-state family (success) — the same stateColor mapping the
		 * tool block and the subagent tree use; the preview tail stays muted. */
		summaryAccent?: () => string | RGBA
	}
}): JSX.Element {
	// Live while streaming (re-reads the tick so the elapsed column moves);
	// frozen at the settle seconds once collapsed.
	const elapsed = () => {
		const row = props.row()
		if (row.streaming === true && row.startedAt !== undefined) {
			void props.spin()
			return `${((Date.now() - row.startedAt) / 1000).toFixed(1)}s`
		}
		return row.elapsedSec !== undefined ? `${row.elapsedSec.toFixed(1)}s` : undefined
	}
	// The streaming tail: last TAIL_LINES non-blank lines, display-clipped.
	const tail = createMemo(() => {
		const lines = props.row()
			.text.replace(/\r/g, "")
			.split("\n")
			.filter((line) => line.trim() !== "")
		return lines.slice(-TAIL_LINES).map((line) => clipToWidth(line, Math.max(16, props.width() - 8)))
	})
	// The collapsed summary (`💭 thought · Xs · <first line>`), clipped whole
	// so the line never wraps. Batch V5: split at the prefix boundary so the
	// `💭 thought · Xs` state token can carry the accent color while the
	// preview tail stays muted — one line budget, prefix clipped first and
	// the tail gets whatever columns remain (never overflows the pane). The
	// ` · ` separator lives OUTSIDE the clipped strings (clipToWidth
	// normalizes whitespace, so it would eat the padding).
	const summary = createMemo(() => {
		const first = props.row().text.replace(/\r/g, "").split("\n").find((line) => line.trim() !== "") ?? ""
		const secs = elapsed() ?? "0.0s"
		const budget = Math.max(16, props.width() - 5)
		const prefix = clipToWidth(`💭 thought · ${secs}`, budget)
		const rest = clipToWidth(first, Math.max(0, budget - stringWidth(prefix) - 3))
		return { prefix, rest }
	})
	return (
		<Show
			when={props.row().streaming === true}
			fallback={
				<box flexShrink={0} paddingLeft={3}>
					<text wrapMode="none">
						<span style={{ fg: props.color.summaryAccent?.() ?? props.color.text() }}>{summary().prefix}</span>
						<span style={{ fg: props.color.text() }}>{summary().rest === "" ? "" : ` · ${summary().rest}`}</span>
					</text>
				</box>
			}
		>
			<box
				flexShrink={0}
				marginLeft={2}
				marginRight={2}
				border={["top", "right", "bottom", "left"]}
				borderColor={props.color.border()}
				paddingLeft={1}
				paddingRight={1}
				flexDirection="column"
			>
				<text fg={props.color.spinner()} wrapMode="none">
					{`${SPINNER_FRAMES[props.spin() % SPINNER_FRAMES.length]} thinking · ${elapsed() ?? "0.0s"}`}
				</text>
				<For each={tail()}>
					{(line) => (
						<text fg={props.color.text()} wrapMode="none">
							{line}
						</text>
					)}
				</For>
			</box>
		</Show>
	)
}
