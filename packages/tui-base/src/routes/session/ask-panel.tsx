/**
 * AskPanel — the ask-user surface BODY, rendered inside the in-flow dock at
 * the composer seat (`docs/ask-user-panel-spec.md` §2-§5, §8, §13).
 *
 * This file is the body only: it reads `TurnOverlayController` state and
 * paints it. NO key bindings, no Esc ladder, no digit gating and no
 * admission logic live here — that is the NEXT task (spec §5-§6, ADR-0008).
 * The only interaction the body owns is the resident inline row focusing
 * itself when the controller phase says the input holds focus, plus the
 * ensure-visible scroll that keeps the current row on screen.
 *
 * Layout, top to bottom (spec §2-§4):
 *   1. eyebrow      `question.header`, muted, only when present
 *   2. title        the prompt, wrapped to the full dock width (no truncation)
 *   3. tab strip    `[1 ✓] · 2 · 3`, 2+ questions only
 *   4. detail       `question.detail`, muted + wrapped, only when present
 *   5. options      hand-rendered numbered rows (no panel-kit List: it pages
 *                   and cannot host a resident live input row, spec §2)
 *   6. review row   `⏎ Review answers` when the batch needs the review page
 *   7. inline row   `✎ <input>` — always last and always visible
 *   8. footer       phase-derived key hint + the dock's queue indicator
 * The review phase replaces rows 5-7 with one row per question plus Submit.
 *
 * Glyph vocabulary (no new language invented):
 *   - `›`  cursor marker (accent / current-row text role)
 *   - `✔`/`✘` multi-select state — panel-kit's Check family (`check.tsx`)
 *   - `✎`  resident free-text row (spec §5)
 *   - `✓`  answered question on the tab strip and the review rows (spec §8)
 *   - `⏎`  the review/submit rows' Enter affordance (existing copy keys)
 *   - `→`  a review row's answer (spec §9's answer mark)
 */
import { createEffect, createSignal, Index, on, onCleanup, onMount, Show, type Accessor, type JSX } from "solid-js"
import type { InputRenderable, Renderable } from "@opentui/core"
import type { SeamAskOption } from "../../seams/session"
import { t } from "../../i18n"
import { useThemeOptional } from "../../context/theme"
import { useCursorStyle } from "../../config"
import { warningColor } from "../../skin/semantic"
import { askNeedsReview, askTabStrip, hasReviewRow, reviewRowIntent, splitRecommended } from "./ask-options"
import type { PendingAsk, TurnOverlayController } from "./turn-overlay-controller"
import { useDock, type DockFocusable } from "./dock-host"

/** panel-kit's compact threshold (`panel-kit/src/panel.tsx:57-61`): below it
 * the Recommended badge drops to its own continuation line (spec §2). */
export const ASK_COMPACT_COLUMNS = 64

/** The rows are painted one column in from the dock edge (the dock owns no
 * gutters — the surface inside does). */
const GUTTER = 1

export interface AskPanelProps {
	controller: TurnOverlayController
	/** Live dock width (full terminal columns — the dock is full width). */
	width: Accessor<number>
	/** Registers the panel's focus resolver with the host. The host calls it
	 * on open/head-change after layout (`DockOpenOptions.focusRef`). */
	onFocusTarget?: (resolve: (() => DockFocusable | undefined) | undefined) => void
}

interface ScrollTarget {
	scrollChildIntoView(child: Renderable | string, options?: { align?: "start" | "center" | "end" | "nearest" }): void
}

/** The resolve target the dock host focuses on open / head change. */
function resolveFocus(
	ask: PendingAsk | undefined,
	list: Renderable | undefined,
	input: InputRenderable | undefined,
): DockFocusable | undefined {
	if (ask === undefined) return undefined
	if (ask.phase === "input") return input
	return list ?? input
}

/** Nearest ancestor that can scroll a child into view. The dock host owns the
 * only scrollbox around this body and its render context exposes no scroll
 * handle, so the body walks up the renderable tree (no host edit needed). */
function nearestScroller(node: Renderable | undefined): ScrollTarget | undefined {
	let current: Renderable | null | undefined = node
	while (current !== null && current !== undefined) {
		const candidate = current as unknown as Partial<ScrollTarget>
		if (typeof candidate.scrollChildIntoView === "function") return current as unknown as ScrollTarget
		current = (current as unknown as { parent: Renderable | null }).parent
	}
	return undefined
}

export function AskPanel(props: AskPanelProps): JSX.Element {
	const theme = useThemeOptional()
	const dock = useDock()
	let configCursorStyle: (() => { style?: string; blinking?: boolean }) | undefined
	try {
		configCursorStyle = useCursorStyle()
	} catch {
		configCursorStyle = undefined
	}
	const [version, setVersion] = createSignal(0)
	onMount(() => {
		const unsubscribe = props.controller.subscribe(() => setVersion((value) => value + 1))
		onCleanup(unsubscribe)
	})

	const ask = (): PendingAsk | undefined => {
		version()
		return props.controller.pendingAsk
	}
	const questions = () => ask()?.questions ?? []
	const question = () => {
		const batch = ask()
		return batch?.questions[batch.index]
	}
	const index = () => ask()?.index ?? 0
	const phase = () => ask()?.phase ?? "questions"
	const phaseOf = (): "options" | "input" | "review" => {
		if (phase() === "review") return "review"
		return phase() === "input" ? "input" : "options"
	}
	const picks = () => {
		const batch = ask()
		return batch ? (batch.picks[batch.index] ?? []) : []
	}
	const cursor = () => {
		const batch = ask()
		return batch ? (batch.cursors[batch.index] ?? 0) : 0
	}
	const reviewCursor = () => ask()?.reviewCursor ?? 0
	const multi = () => question()?.multiSelect === true
	const compact = () => props.width() < ASK_COMPACT_COLUMNS
	const needsReview = () => askNeedsReview(questions())

	// Theme roles. The fallbacks are the pre-skin hexes, the same convention
	// the other rebuilt faces use (they only paint when no provider exists).
	const muted = () => theme?.text.muted ?? "#9aa5ce"
	const faint = () => theme?.text.faint ?? "#565f89"
	const base = () => theme?.text.base ?? "#e6e6e6"
	const accent = () => theme?.hue.interactive[500] ?? "#7aa2f7"
	const currentBg = () => theme?.background.action.primary.focused
	const currentFg = () => theme?.text.action.primary.focused ?? accent()
	// The resident input's cursor follows the skin cursor shape; a bare
	// harness has no config provider, so it degrades to the default shape
	// (search-overlay precedent).
	const cursorShape = () => {
		try {
			return configCursorStyle?.()?.style as never
		} catch {
			return undefined
		}
	}

	let listEl: Renderable | undefined
	let inputEl: InputRenderable | undefined
	let inlineRowEl: Renderable | undefined

	// Focus registration: the dock host resolves the designated focusable on
	// open and on head change (spec §10). The resolver reads the refs lazily,
	// so the host's post-layout callback always sees the live targets. It is
	// deliberately NOT cleared on cleanup: a hand-off replaces the resolver
	// before the old panel's disposal callback order could matter, and a
	// closed dock never calls it (its `focusRef` only runs for a live head).
	props.onFocusTarget?.(() => resolveFocus(ask(), listEl, inputEl))

	// --- the one focus rule the RENDERER owns (spec §5) -------------------
	// The key layer is the next task. The body only moves the renderer focus
	// when the phase says the resident input owns it, and keeps the focus
	// row on screen: `ScrollBoxRenderable` has no focus-follow (constraint 6
	// of spec §5), so rows are scrolled explicitly with `align: "nearest"`.
	function revealRow(row: Renderable | undefined): void {
		if (row === undefined || row.isDestroyed) return
		const scroller = nearestScroller(row)
		if (scroller === undefined) return
		scroller.scrollChildIntoView(row, { align: "nearest" })
	}

	function focusInputRow(): void {
		const input = inputEl
		if (input === undefined || input.isDestroyed) return
		input.focus()
		revealRow(inlineRowEl)
	}

	createEffect(on(() => phase(), (next) => (next === "input" ? focusInputRow() : undefined)))
	// A zero-option question opens on the input (spec §2); moving to another
	// question re-lands the focus if that question is input-phase too.
	createEffect(on(() => index(), () => (phase() === "input" ? focusInputRow() : undefined), { defer: true }))
	// The option-row cursor is ensure-visible work too (arrows / digit picks).
	createEffect(
		on([() => index(), cursor], () => {
			if (phaseOf() !== "options") return
			revealRow(listEl?.getChildren()[cursor()] as Renderable | undefined)
		}),
	)

	// --- row model -------------------------------------------------------

	interface OptionRowModel {
		option: SeamAskOption
		number: number
		selected: boolean
	}

	const optionRows = (): OptionRowModel[] =>
		(question()?.options ?? []).map((option, position) => ({
			option,
			number: position + 1,
			selected: picks().includes(option.label),
		}))

	/** First column of the label: gutter + cursor marker + checkbox (multi) +
	 * number gutter. Continuation lines (badge drop, description) indent here. */
	const labelColumn = (row: OptionRowModel): number => GUTTER + 2 + (multi() ? 2 : 0) + `${row.number}. `.length

	// --- footer ----------------------------------------------------------

	/** The persistent hint states what the keys do in the CURRENT phase
	 * (spec §6). The Esc ladder itself is the next task; the wording already
	 * follows its monotonic stages so swapping the ladder in does not change
	 * the copy. */
	const footerHint = (): string => {
		if (phaseOf() === "review") return t("overlay.ask.footer.review", { esc: t("overlay.ask.esc.review") })
		if (phaseOf() === "input") {
			const escKey = question()?.options.length === 0 ? "overlay.ask.esc.decline" : "overlay.ask.esc.back"
			return t("overlay.ask.footer.input", { esc: t(escKey) })
		}
		const escKey =
			questions().length > 1 && index() > 0 ? "overlay.ask.esc.prevQuestion" : "overlay.ask.esc.decline"
		return t(multi() ? "overlay.ask.footer.multi" : "overlay.ask.footer.options", { esc: t(escKey) })
	}

	// --- review page -----------------------------------------------------

	/** A question's current answer on the review page: committed custom text,
	 * else the selected labels in display order. Empty = unanswered. */
	const answerText = (qi: number): string => {
		const batch = ask()
		if (!batch) return ""
		const custom = batch.customs[qi]
		if (custom !== undefined && custom !== "") return custom
		return (batch.picks[qi] ?? []).join(", ")
	}

	const reviewRowActive = (qi: number) => reviewCursor() === qi
	// The cursor → intent mapping the key layer (next task) drives Enter
	// through: a question row edits that question, the last row submits.
	const reviewSubmitActive = () => reviewRowIntent(reviewCursor(), questions().length).kind === "submit"

	// --- render ----------------------------------------------------------

	return (
		<box flexDirection="column" width="100%" flexShrink={0}>
			{/* 1. Eyebrow: `header`, never concatenated into the prompt. */}
			<Show when={phaseOf() !== "review" ? question()?.header : undefined}>
				{(header) => (
					<box paddingLeft={GUTTER} paddingRight={GUTTER}>
						<text fg={muted()} wrapMode="none">
							{header()}
						</text>
					</box>
				)}
			</Show>
			{/* 2. Title: full-width wrapped prompt (no 70-char truncation). The
			 *    ask tone (warning) stays on the title, as the old dialog frame
			 *    carried it (spec §2 Frame). */}
			<box paddingLeft={GUTTER} paddingRight={GUTTER}>
				<text fg={warningColor(theme)} wrapMode="word">
					{phaseOf() === "review" ? t("overlay.ask.reviewTitle") : (question()?.prompt ?? "")}
				</text>
			</box>
			{/* 3. Tab strip, 2+ questions only (replaces the (i/n) title suffix). */}
			<Show when={questions().length >= 2}>
				<box paddingLeft={GUTTER} paddingRight={GUTTER}>
					<text fg={muted()} wrapMode="none">
						{askTabStrip(questions(), ask()?.picks ?? [], index(), ask()?.customs)}
					</text>
				</box>
			</Show>
			{/* 4. Detail: wrapped body text, muted, only when present. */}
			<Show when={phaseOf() !== "review" ? question()?.detail : undefined}>
				{(detail) => (
					<box paddingLeft={GUTTER} paddingRight={GUTTER}>
						<text fg={muted()} wrapMode="word">
							{detail()}
						</text>
					</box>
				)}
			</Show>

			<Show
				when={phaseOf() === "review"}
				fallback={
					<>
						{/* 5-6. Option rows + the explicit review row. The list box is the
						 *      focusable target while the list owns the cursor. */}
						<box
							ref={(value: Renderable) => {
								listEl = value
							}}
							flexDirection="column"
							width="100%"
							flexShrink={0}
							focusable={true}
						>
							<Index each={optionRows()}>
								{(row, position) => (
									<OptionRow
										row={row}
										cursor={() => phaseOf() !== "input" && position === cursor()}
										multi={() => multi()}
										compact={() => compact()}
										labelColumn={() => labelColumn(row())}
									/>
								)}
							</Index>
							<Show when={question() !== undefined && hasReviewRow(question()!, needsReview())}>
								<box
									flexDirection="row"
									width="100%"
									flexShrink={0}
									paddingLeft={GUTTER}
									backgroundColor={cursor() === (question()?.options.length ?? 0) ? currentBg() : undefined}
								>
									<text fg={accent()}>{cursor() === (question()?.options.length ?? 0) ? "› " : "  "}</text>
									<text fg={cursor() === (question()?.options.length ?? 0) ? currentFg() : muted()} wrapMode="word">
										{t("overlay.ask.reviewRow")}
									</text>
								</box>
							</Show>
						</box>

						{/* 7. Resident inline row: always last, always visible. A real
						 *    single-line input, focusable by default. The controller's
						 *    inline buffer is the value, so a committed custom answer
						 *    keeps painting with no separate mark (spec §5/§13). */}
						<box
							ref={(value: Renderable) => {
								inlineRowEl = value
							}}
							flexDirection="row"
							width="100%"
							flexShrink={0}
							paddingLeft={GUTTER}
							backgroundColor={phaseOf() === "input" ? (theme?.background.raised.base ?? undefined) : undefined}
						>
							<text fg={phaseOf() === "input" ? accent() : muted()}>{"✎ "}</text>
							<input
								ref={(value: InputRenderable) => {
									inputEl = value
								}}
								flexGrow={1}
								value={props.controller.inlineText}
								placeholder={t("overlay.ask.inputPlaceholder")}
								placeholderColor={muted()}
								textColor={base()}
								focusedTextColor={currentFg()}
								cursorColor={accent()}
								cursorStyle={cursorShape()}
								onInput={(value: string) => props.controller.setInlineText(value)}
								onSubmit={() => props.controller.commitCustom()}
							/>
						</box>
					</>
				}
			>
				{/* 8. Review page: one selectable row per question + Submit (spec §8). */}
				<box flexDirection="column" width="100%" flexShrink={0}>
					<Index each={questions()}>
						{(item, qi) => (
							<box
								flexDirection="column"
								width="100%"
								flexShrink={0}
								paddingLeft={GUTTER}
								backgroundColor={reviewRowActive(qi) ? currentBg() : undefined}
							>
								<box flexDirection="row" width="100%">
									<text fg={accent()}>{reviewRowActive(qi) ? "› " : "  "}</text>
									<text fg={reviewRowActive(qi) ? currentFg() : muted()}>{"✓ "}</text>
									<text fg={reviewRowActive(qi) ? currentFg() : base()} wrapMode="word">
										{item().prompt}
									</text>
								</box>
								{/* The answer line carries the unanswered state distinctly:
								 * the answer mark + accent when answered, faint "not answered"
								 * otherwise. */}
								<box paddingLeft={4}>
									<text fg={answerText(qi) !== "" ? accent() : faint()} wrapMode="word">
										{`→ ${answerText(qi) !== "" ? answerText(qi) : t("overlay.ask.unanswered")}`}
									</text>
								</box>
							</box>
						)}
					</Index>
					<box
						flexDirection="row"
						width="100%"
						flexShrink={0}
						paddingLeft={GUTTER}
						backgroundColor={reviewSubmitActive() ? currentBg() : undefined}
					>
						<text fg={accent()}>{reviewSubmitActive() ? "› " : "  "}</text>
						<text fg={reviewSubmitActive() ? currentFg() : base()} wrapMode="none">
							{t("overlay.ask.submitRow")}
						</text>
					</box>
				</box>
			</Show>

			{/* Footer: what the keys do right now + the host's queue depth. The
			 * count comes from the dock host; the wording is ours (spec §13). */}
			<box flexDirection="row" width="100%" justifyContent="space-between" paddingLeft={GUTTER} paddingRight={GUTTER}>
				<text fg={muted()} wrapMode="none">
					{footerHint()}
				</text>
				<Show when={dock.queueDepth() > 0}>
					<text fg={muted()} wrapMode="none">
						{t("overlay.ask.queued", { count: dock.queueDepth() })}
					</text>
				</Show>
			</box>
		</box>
	)
}

/**
 * One option row (spec §2 row anatomy, §4 glyphs):
 *
 *   › 1. Option label                                [Recommended]
 *       Muted, wrapped, indented description continuation line.
 *
 * The gutter (marker + checkbox + number) is never truncated and the label
 * wraps. Below `ASK_COMPACT_COLUMNS` the badge drops to its own line,
 * indented to the label column.
 */
function OptionRow(props: {
	row: Accessor<{ option: SeamAskOption; number: number; selected: boolean }>
	cursor: Accessor<boolean>
	multi: Accessor<boolean>
	compact: Accessor<boolean>
	labelColumn: Accessor<number>
}): JSX.Element {
	const theme = useThemeOptional()
	const muted = () => theme?.text.muted ?? "#9aa5ce"
	const faint = () => theme?.text.faint ?? "#565f89"
	const base = () => theme?.text.base ?? "#e6e6e6"
	const accent = () => theme?.hue.interactive[500] ?? "#7aa2f7"
	const success = () => theme?.text.feedback.success.base ?? "#9ece6a"
	const currentBg = () => theme?.background.action.primary.focused
	const currentFg = () => theme?.text.action.primary.focused ?? accent()
	const label = () => splitRecommended(props.row().option.label)
	const number = () => `${props.row().number}. `
	const badge = () => `[${t("overlay.ask.recommended")}]`
	const labelColor = () => {
		if (props.cursor()) return currentFg()
		// A picked single-select row stays visibly chosen without a checkbox
		// (multi-select carries the Check glyph instead).
		if (!props.multi() && props.row().selected) return accent()
		return base()
	}

	return (
		<box
			flexDirection="column"
			width="100%"
			flexShrink={0}
			backgroundColor={props.cursor() ? currentBg() : undefined}
		>
			<box flexDirection="row" width="100%" paddingLeft={GUTTER}>
				<text fg={accent()}>{props.cursor() ? "› " : "  "}</text>
				<Show when={props.multi()}>
					<text fg={props.row().selected ? success() : faint()}>{props.row().selected ? "✔ " : "✘ "}</text>
				</Show>
				<text fg={props.cursor() ? currentFg() : faint()}>{number()}</text>
				<text fg={labelColor()} wrapMode="word" flexGrow={1}>
					{label().label}
				</text>
				<Show when={label().recommended && !props.compact()}>
					<text fg={success()}>{badge()}</text>
				</Show>
			</box>
			<Show when={label().recommended && props.compact()}>
				<box paddingLeft={props.labelColumn()}>
					<text fg={success()} wrapMode="none">
						{badge()}
					</text>
				</box>
			</Show>
			<Show when={props.row().option.description}>
				{(description) => (
					<box paddingLeft={props.labelColumn()}>
						<text fg={muted()} wrapMode="word">
							{description()}
						</text>
					</box>
				)}
			</Show>
		</box>
	)
}
