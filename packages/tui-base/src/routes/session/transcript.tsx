/**
 * Transcript — the rebuilt session transcript viewport (batch 3).
 *
 * Extracted from the vendored `routes/session/index.tsx` region at the
 * `<scrollbox>` (upstream 1514–1571): same visual structure —
 *
 *   row > flexGrow col (position relative) > scrollbox
 *   stickyScroll + stickyStart="bottom"   (prop-sensitive; NOT stickyScrollPosition)
 *   keyed marginTop=1 rows via <For>
 *   bottom slot (children/footer/notices) — legacy hosts only
 *
 * The v2 page no longer uses this bottom slot: its composer, lastRequest and
 * notices moved to the page-root column so the in-flow dock can take the
 * composer seat as a sibling of this transcript (spec §2, ./dock-host.tsx).
 * The slots stay here because the bare examples mount a composer through
 * them; when a host passes none, the bottom box collapses to the status and
 * widgets slots exactly as before.
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
import { useRenderer, onAnimationTick } from "@opentui/solid"
import { useTerminalSize } from "./terminal-size"
import { BoxRenderable, SyntaxStyle, TextAttributes, type RGBA, type ScrollBoxRenderable } from "@opentui/core"
import type { SeamAskEntry, SessionSeam } from "../../seams/session"
import { createSeamRows, type SeamRow, type SeamRows } from "./seam-rows"
import { splitRecommended } from "./ask-options"
import type { ComposerPendingRow } from "./composer-state"
import { useThemeOptional, useThemesOptional } from "../../context/theme"
import { t } from "../../i18n"
import { motionAnimationRunning, motionDecorationsEnabled, motionFrameRate } from "../../skin/motion"
import { transcriptFrame, unfocusedBorderColor } from "../../skin/semantic"
import { skinFadeInColor, SKIN_FADE_IN_MS } from "./widgets-dock"

// ---------------------------------------------------------------------------
// Skin code-block form (batch δ, contract §1 代码块). Streaming paints the
// left rule `┃` (heavy border, NO extra rows); a final block gets the
// single-line frame with the language in the top border.
//
// Root-cause note (skin-codeblock fix): @opentui 0.8.x's markdown
// `context.defaultRender()` for a `code` token returns a CodeRenderable
// (extends TextBufferRenderable — NOT a box; it has NO border/borderStyle
// support at all). The original in-place border flip therefore always bailed
// on its "only bordered boxes" guard and every real code block stayed bare.
// The skin now rides a WRAPPER BOX around that default renderable:
//   - a bordered renderable (host custom renderer) is still flipped in place
//     (same instance — no node churn);
//   - a borderless default is wrapped in ONE BoxRenderable whose options
//     carry the form. Core rebuilds a custom block through renderNode only
//     while it is the actively-growing trailing block (stable blocks keep
//     token identity and never re-enter renderNode), and the inner code
//     renderable is always core's own defaultRender() product — the wrapper
//     invents no text nodes per increment.
// ---------------------------------------------------------------------------

type SkinBoxLike = {
	border?: unknown
	borderStyle?: unknown
	title?: string
}
// P2-2 (review): shared frozen side arrays — assigning a fresh array per
// call churned identities on every streaming increment.
const SIDES_RULE: string[] = ["left"]
const SIDES_FRAME: string[] = ["top", "bottom", "left", "right"]
export type CodeBlockForm = "rule" | "frame"

/** The skin form of a code block (pure): streaming → left rule, final → frame. */
export function codeBlockForm(isFinal: boolean): CodeBlockForm {
	return isFinal ? "frame" : "rule"
}

/** The streaming form's language tag (pure): `┃ lang` — exposed for tests and
 * future self-drawn variants. */
export function codeBlockRuleLabel(lang: string | undefined): string {
	return lang === undefined || lang === "" ? "┃" : `┃ ${lang}`
}

function skinBoxOptions(isFinal: boolean, lang: string | undefined, borderColor: string | RGBA | undefined): Record<string, unknown> {
	if (codeBlockForm(isFinal) === "rule") {
		return { border: SIDES_RULE, borderStyle: "heavy", ...(borderColor !== undefined ? { borderColor } : {}), width: "100%" }
	}
	return {
		border: SIDES_FRAME,
		borderStyle: "single",
		...(borderColor !== undefined ? { borderColor } : {}),
		title: lang ? ` ${lang} ` : undefined,
		width: "100%",
	}
}
/** Apply the skin form IN PLACE to a bordered renderable; wrap a borderless
 * one (the upstream code default) in the skin's wrapper box. `ctx` is the
 * renderable context the wrapper box needs; without it (bare unit tests) a
 * borderless renderable is returned untouched. Exported for tests to share
 * the exact product path. */
export function applyCodeBlockSkin(renderable: unknown, isFinal: boolean, lang: string | undefined, ctx?: unknown, borderColor?: string | RGBA): unknown {
	const box = renderable as (SkinBoxLike & { marginTop?: number; marginBottom?: number }) | null
	if (box === null || typeof box !== "object") return renderable
	if (typeof box.border !== "undefined" || typeof box.borderStyle !== "undefined") {
		// bordered renderable (host custom renderer / bordered default): flip
		// the sides in place — the same instance crosses every increment.
		if (codeBlockForm(isFinal) === "rule") {
			box.border = SIDES_RULE
			box.borderStyle = "heavy"
			box.title = undefined
		} else {
			box.border = SIDES_FRAME
			box.borderStyle = "single"
			box.title = lang ? ` ${lang} ` : undefined
		}
		return renderable
	}
	if (ctx === undefined) return renderable
	// Borderless upstream default (CodeRenderable): wrap once in the skin box.
	// Margins are inter-block concerns core manages on the wrapper — zero the
	// child's so the frame hugs the code.
	box.marginTop = 0
	box.marginBottom = 0
	const wrapper = new BoxRenderable(ctx as never, skinBoxOptions(isFinal, lang, borderColor) as never)
	wrapper.add(box as never)
	return wrapper
}

/** Per-row renderNode cache (module level): stable function identity per
 * row phase so the markdown component never sees a fresh closure per
 * streaming render (identity churn would rebuild blocks per increment).
 * P2-1 (review): capped FIFO — long sessions with many code rows must not
 * grow the map without bound. */
const CODE_RENDER_NODE_CACHE_MAX = 256
const codeRenderNodeCache = new Map<string, (token: any, context: any) => any>()
function skinRenderNode(
	rowKey: string,
	isFinal: boolean,
	hostRenderNode: ((node: any) => any) | undefined,
	ctx?: unknown,
	borderColor?: string | RGBA,
): (token: any, context: any) => any {
	const cacheKey = `${rowKey}:${isFinal ? "final" : "streaming"}`
	let fn = codeRenderNodeCache.get(cacheKey)
	if (fn === undefined) {
		fn = (token: any, context: any) => {
			const host = (hostRenderNode as ((token: any, context: any) => any) | undefined)?.(token, context)
			if (host !== undefined && host !== null) return host
			if (token?.type === "code") {
				const defaulted = context.defaultRender()
				if (defaulted)
					return applyCodeBlockSkin(defaulted, isFinal, typeof token.lang === "string" ? token.lang : undefined, ctx, borderColor)
			}
			return undefined // undefined = markdown's own default rendering
		}
		if (codeRenderNodeCache.size >= CODE_RENDER_NODE_CACHE_MAX) {
			const oldest = codeRenderNodeCache.keys().next().value
			if (oldest !== undefined) codeRenderNodeCache.delete(oldest)
		}
		codeRenderNodeCache.set(cacheKey, fn)
	}
	return fn
}

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
		/** Bottom slot: the composer (legacy hosts). The v2 page passes the
		 * composer to the page-root dock seat instead, so a dock can take this
		 * position as a sibling of the transcript (spec §2). */
		children?: JSX.Element
		/** Batch D3 status slot (dsh-tui-pi dock top, index.ts:846 Loader):
		 * the running indicator rendered ABOVE the widgets slot — the page
		 * wires the 🐳 comet StatusBar (mount-on-busy, zero rows idle). */
		status?: JSX.Element
		/** Batch D3 notices slot (dsh-tui-pi tui.ts:256 transient notices):
		 * stacked auto-dismissing lines BELOW the lastRequest slot (directly
		 * above the page's powerline) — see ./notices-dock.tsx. */
		notices?: JSX.Element
		/** Batch D1 widgets slot (dsh-tui-pi dock structure): the fixed
		 * Todos → Think → Tool panels rendered DIRECTLY ABOVE the bottom
		 * slot (the editor) — never in the transcript flow. See
		 * ./widgets-dock.tsx; the page wires it with the shared projection. */
		widgets?: JSX.Element
		/** Batch D2 lastRequest slot (dsh-tui-pi live-widgets structure): the
		 * `●` last-request echo + the running-children lines rendered DIRECTLY
		 * BELOW the composer (the editor) — see ./lastrequest-dock.tsx; the
		 * page wires it with the shared projection + its lastRequest signal. */
			footer?: JSX.Element
		/** Busy-submit delivery lines (steer/queue batch): queued waits paint
		 * as muted italic `⏸ 排队等待 #N` rows, injected steers as brand
		 * `⤵ 已注入当前回合` rows that flip to `✓ 已投递` when the turn settles.
		 * Rendered INSIDE the scrollbox after the projection rows, so they
		 * always sit at the bottom of the live transcript. Static text only —
		 * nothing animates, so `/motion off` needs no gate here. */
		pending?: () => readonly ComposerPendingRow[]
	/** Publishes the transcript scrollbox (vendored route's scrollRef prop
	 * shape; undefined on teardown). Page wiring binds scroll keys and the
	 * pane-focus classification to it; the box is focusable and receives
	 * focus on F6/click (pane-focus batch). Scrolling stays `scrollBy` +
	 * native stickyScroll. */
	scrollRef?: (scroll: ScrollBoxRenderable | undefined) => void
	/** Vertical scrollbar (vendored `session.scrollbar` config; default off). */
	scrollbar?: boolean
	/** Pane focus (pane-focus batch): true while the transcript owns the
	 * renderer focus. Real renderer focus is the truth source — the page
	 * feeds this from `createPaneFocus().transcriptFocused`; no guessed
	 * flag. Focus flips WEIGHT + color only (heavy/accent ↔ single/
	 * border.base); static, never animated. */
	focused?: () => boolean
}

/** Skin user-message entrance (contract §1 入场淡入): the text color runs
 * faint → target over 0.4s on the shared motion clock; the frame stays
 * static (thin border, NEVER animated — §2.3, and the transcript never
 * holds focus so恒细线). Ticks only while the fade runs; reduced/off paint
 * the target color immediately. Component-local clock so the row list and
 * the scrollbox never re-render for the fade. */
function UserMessageFade(props: { target: string | RGBA; background: string | RGBA; text: string }): JSX.Element {
	const [tick, setTick] = createSignal(0)
	const startedAt = Date.now()
	const fading = () => motionDecorationsEnabled() && Date.now() - startedAt < SKIN_FADE_IN_MS
	onAnimationTick(() => (fading() && motionAnimationRunning() ? motionFrameRate() : undefined), () => setTick((t) => t + 1))
	const fg = () => {
		tick()
		if (!motionDecorationsEnabled()) return props.target
		const t = Math.min(1, (Date.now() - startedAt) / SKIN_FADE_IN_MS)
		return t >= 1 ? props.target : skinFadeInColor(props.target, props.background, t * SKIN_FADE_IN_MS)
	}
	return (
		<text fg={fg()} wrapMode="word">
			{`❯ ${props.text}`}
		</text>
	)
}

export function Transcript(props: TranscriptProps) {
	const renderer = useRenderer()	// Batch D2: the ⎿ track clip and the tree clip left with the tool block
	// and the subagent tree (the docks own their width budgets now) — the
	// transcript's reactive-dimensions read left with them.
	const theme = useThemeOptional()
	const dimensions = useTerminalSize()
	// Pane-focus frame: the SAME compact rule as the composer (≤30 rows →
	// left/right rules only, zero rows; >30 rows → full frame + title).
	const frame = () =>
		transcriptFrame({
			focused: props.focused?.() ?? false,
			terminalRows: dimensions().height,
			theme: theme ?? undefined,
		})
	const color = {
		text: () => theme?.text.base ?? "#e6e6e6",
		user: () => theme?.text.action.primary.base ?? "#7aa2f7",
		reasoningBorder: () => theme?.border.base ?? "#565f89",
		// Ask replay (spec §9) paints through `AskReplayBlock`, which owns its
		// own theme read (muted question line + accent answer line).
		done: () => theme?.text.feedback.success.base ?? "#9ece6a",
		running: () => theme?.text.feedback.warning.base ?? "#e0af68",
		failed: () => theme?.text.feedback.error.base ?? "#f7768e",
		// Batch V5: the failed tool block's ⎿ track rides the error MUTED
		// variant — the red emphasis reads as one block, not a red wall.
		failedMuted: () => theme?.text.feedback.error.muted ?? "#8a4b5c",
		loading: () => theme?.text.feedback.info.base ?? "#565f89",
		background: () => theme?.background.base ?? "black",
		// Busy-submit delivery lines: queue waits are low-saturation (muted +
		// italic); steer receipts use the brand/action tier.
		pendingQueue: () => theme?.text.muted ?? "#9aa5ce",
		pendingSteer: () => theme?.text.action.primary.base ?? "#7aa2f7",
	}
	// Batch V5 status-color family — D2: the tool block, think summary and
	// subagent tree all left the transcript flow (the docks render them);
	// the user/assistant feed below needs no status colors.
	const sessionID = () => props.sessionID ?? props.seam.currentSessionId() ?? ""
	const owned = props.projection === undefined
	const projection = props.projection ?? createSeamRows(props.seam, sessionID)
	const themes = useThemesOptional()
	const syntaxStyle = () =>
		props.syntaxStyle ?? themes?.currentSyntax() ?? SyntaxStyle.fromStyles({}, renderer.nativeScene)

	/** Batch D1 (dsh-tui-pi dock structure): tool blocks and think rows are
	 * GONE from the transcript — they render in the fixed widgets dock above
	 * the composer (./widgets-dock.tsx, the page wires it). The transcript
	 * paints user/assistant/echo/notice/ask blocks only. */

	/** Batch D2 (dsh-tui-pi live-widgets structure): the subagent tree row
	 * is GONE from the transcript too — running children render in the
	 * lastRequest dock BELOW the editor (./lastrequest-dock.tsx, the page
	 * wires it as the `footer` slot). The row stays in the store; the dock
	 * reads it there. */

	onMount(() => {
		if (owned) projection.load()
	})

	const assistantRow = (row: Extract<SeamRow, { kind: "assistant" }>) => (
		<markdown
			// Vendored TextPart shape: configure plugins before content, stream
			// until finalize so completion keeps the final tokens.
			// Skin (batch δ): the code-block restyle wrapper (heavy left rule
			// while streaming, single frame + language title once final) — host
			// renderNode still wins for the tokens it handles.
			renderNode={skinRenderNode(row.key, row.final, props.renderNode, renderer, theme?.border.base)}
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

	/** Spec §9 ask replay: one block per settled ask, one pair per question —
	 * muted `✓ <question>` (header eyebrow above, detail context below) then
	 * the accent `  → <answer>`. Multi-select joins on ", "; a free-text answer
	 * is its own value; a declined question shows the declined marker (muted:
	 * distinct from an answer, no accent emphasis). Offered options stay
	 * carried in the row but are not repeated here — the record is what was
	 * asked and what was answered, not the menu.
	 *
	 * The answer VALUE stays the raw pick label (it is what the tool returned),
	 * but the painted line runs the same `splitRecommended` normalization the
	 * option list used, so replay never shows `SQLite (Recommended)` next to a
	 * picker that showed `SQLite [推荐]` (D5). No badge here: the replay is a
	 * record, and a second badge token in scrollback would compete with the
	 * answer text. See `AskReplayBlock`. */
	const askRow = (row: Extract<SeamRow, { kind: "ask" }>) => <AskReplayBlock row={row} />

	// Batch D1: tool/reasoning rows stay in the store (the widgets dock reads
	// them there) but never paint in the flow — the visible feed is the
	// tui-pi chat-clean set. Batch D2: the subagent tree moved to the
	// lastRequest dock below the editor — never painted in the flow.
	const visibleRows = createMemo(
		() =>
			projection.rows.filter((row) => row.kind !== "tool" && row.kind !== "reasoning" && row.kind !== "subagents") as readonly SeamRow[],
	)

	const rowView = (row: SeamRow) => {
		switch (row.kind) {
			case "user":
				return (
					<box
						flexShrink={0}
						paddingLeft={2}
						border={["top", "bottom", "left", "right"]}
						borderStyle="single"
						borderColor={unfocusedBorderColor(theme)}
					>
						<UserMessageFade target={color.user()} background={color.background()} text={row.text} />
					</box>
				)
			case "assistant":
				return assistantRow(row)
			case "ask":
				return askRow(row)
			default:
				return null
		}
	}

	onCleanup(() => {
		props.scrollRef?.(undefined)
	})

	return (
		<box flexDirection="column" flexGrow={1} minHeight={0} width="100%" backgroundColor={color.background()}>
			{/* session route shape: row > flexGrow col (position relative) > scrollbox.
			 * Pane-focus frame: the border wraps the REPLY viewport only — the
			 * composer dock below stays outside it. Focused = heavy + accent +
			 * accent title; unfocused = single + border.base + text.faint title.
			 * Compact terminals (≤30 rows) keep only left/right rules. */}
			<box
				flexDirection="row"
				flexGrow={1}
				minHeight={0}
				border={frame().border}
				borderStyle={frame().borderStyle}
				borderColor={frame().borderColor}
				title={frame().title}
				titleColor={frame().titleColor}
			>
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
								<text fg={color.loading()}>{t("transcript.loading")}</text>
							</box>
						</Show>
						{/* Busy-submit delivery lines: below the projected feed so a
						 * queued prompt reads as "waiting behind the current turn".
						 * Queue = muted italic `⏸`; steer = brand `⤵`/`✓`. */}
						<For each={props.pending?.() ?? []}>
							{(row) => (
								<box id={`pending-row-${row.id}`} marginTop={1} flexShrink={0}>
									{row.kind === "queue" ? (
										<text
											fg={color.pendingQueue()}
											attributes={TextAttributes.ITALIC}
											wrapMode="word"
										>
											{row.state === "paused"
											? t("transcript.pending.queue.paused", { order: row.order ?? 1, text: row.text })
											: t("transcript.pending.queue.waiting", { order: row.order ?? 1, text: row.text })}
										</text>
									) : (
										<text fg={color.pendingSteer()} wrapMode="word">
											{row.state === "delivered"
											? t("transcript.pending.steer.delivered", { text: row.text })
											: t("transcript.pending.steer.injected", { text: row.text })}
										</text>
									)}
								</box>
							)}
						</For>
					</scrollbox>
				</box>
			</box>
			{/* widgets slot (batch D1, ./widgets-dock.tsx): the fixed Todos →
			 * Think → Tool panels directly ABOVE the bottom slot (the editor).
			 * Batch D2: the `footer` (./lastrequest-dock.tsx) paints UNDER the
			 * editor — the lastRequest `●` echo + running-children lines.
			 * Each child owns its explicit height (the dock counts its lines;
			 * the composer sets its own) — auto-height boxes collapse. */}
			<Show when={props.status || props.widgets || props.children || props.footer || props.notices}>
				<box width="100%" flexShrink={0} flexDirection="column">
					{props.status}
					{props.widgets}
					{props.children}
					{props.footer}
					{props.notices}
				</box>
			</Show>
		</box>
	)
}

/**
 * The replay block a settled ask paints in the transcript flow (spec §9).
 * Exported so the D5 rendering test can mount the exact component without
 * seam/projection scaffolding. The answer line runs `splitRecommended` on
 * every picked label, matching the option list's normalized label; no badge
 * is painted here (the replay is a record, not a picker).
 */
export function AskReplayBlock(props: { row: Extract<SeamRow, { kind: "ask" }> }): JSX.Element {
	const theme = useThemeOptional()
	const reasoning = () => theme?.text.muted ?? "#9aa5ce"
	const answer = () => theme?.text.action.primary.base ?? "#7aa2f7"
	const askAnswerOf = (entry: SeamAskEntry): string =>
		entry.selected.map((label) => splitRecommended(label).label).join(", ") ||
		entry.custom ||
		t("transcript.ask.declined")
	const askDeclinedOf = (entry: SeamAskEntry): boolean =>
		entry.declined || (entry.selected.length === 0 && !entry.custom)
	return (
		<box flexDirection="column" gap={1}>
			<For each={props.row.entries}>
				{(entry) => (
					<box flexDirection="column">
						<Show when={entry.header}>{(header) => <text fg={reasoning()}>{header()}</text>}</Show>
						<text fg={reasoning()}>{`✓ ${entry.question}`}</text>
						<Show when={entry.detail}>{(detail) => <text fg={reasoning()}>{detail()}</text>}</Show>
						<text fg={askDeclinedOf(entry) ? reasoning() : answer()}>{`  → ${askAnswerOf(entry)}`}</text>
					</box>
				)}
			</For>
		</box>
	)
}

export type { SeamRow }
