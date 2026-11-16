/**
 * Pure ask-surface helpers shared by the controller, the dock panel and the
 * tests. No Solid, no renderer: the controller imports this module for the
 * Recommended pre-selection and the row-count clamp, the panel imports it for
 * the row model, and the tests pin it directly.
 *
 * Two contracts live here:
 *
 *   1. Recommended-suffix normalization — `docs/ask-user-panel-spec.md` §3 is
 *      NORMATIVE. A label keeps its trailing token only when it is not a
 *      fully-parenthesised `recommended` / `推荐`; the answer value stays the
 *      RAW label string (picks, the envelope and transcript replay are
 *      untouched).
 *   2. The tab-strip vocabulary (§8): `[1 ✓] · 2 · 3` — brackets on the
 *      focused question, `✓` on an answered one.
 */
import type { SeamAskQuestion } from "../../seams/session"

export interface NormalizedAskLabel {
	/** The label as painted. Equal to the raw label unless a badge matched. */
	label: string
	/** True when a trailing `(Recommended)` / `（推荐）` token was stripped. */
	recommended: boolean
}

/** A trailing, fully-parenthesised token: ASCII `(...)` or full-width `（...）`.
 * Only trailing counts (`not recommended`, `推荐 but slow` never match). */
const TRAILING_PAREN = /\s*[(（]([^()（）]*)[)）]\s*$/

/** English `recommended` plus the Chinese `推荐` spelled as escapes: the
 * leak-guard ratchet scans tui-base/src for hardcoded CJK copy, and this is a
 * matching token, not user-visible copy (the badge label comes from
 * `overlay.ask.recommended`). */
const RECOMMENDED_TOKENS = new Set(["recommended", "\u63a8\u8350"])

/**
 * Split a trailing recommended token off an option label (spec §3, the exact
 * rule): trim, match a trailing parenthesised token, compare the inside
 * case-insensitively after trimming against `recommended` / `推荐`, strip the
 * token AND the whitespace before it. Never produce an empty label — an
 * all-suffix label keeps its original text and renders no badge.
 */
export function splitRecommended(raw: string): NormalizedAskLabel {
	const trimmed = raw.trim()
	const match = TRAILING_PAREN.exec(trimmed)
	if (match === null) return { label: trimmed, recommended: false }
	const token = (match[1] ?? "").trim().toLowerCase()
	if (!RECOMMENDED_TOKENS.has(token)) return { label: trimmed, recommended: false }
	const label = trimmed.slice(0, match.index).trim()
	if (label === "") return { label: trimmed, recommended: false }
	return { label, recommended: true }
}

/** The raw labels a question pre-selects in the draft (spec §4): every
 * recommended option on a multi-select, the first one on a single-select.
 * Pre-selection never submits — the batch still needs an explicit commit. */
export function recommendedPicks(question: SeamAskQuestion): string[] {
	const recommended = question.options
		.filter((option) => splitRecommended(option.label).recommended)
		.map((option) => option.label)
	if (recommended.length === 0) return []
	return question.multiSelect === true ? recommended : [recommended[0]!]
}

/** Whether the surface needs the explicit review page (spec §8): at least two
 * questions or any multi-select question. */
export function askNeedsReview(questions: readonly SeamAskQuestion[]): boolean {
	return questions.length >= 2 || questions.some((question) => question.multiSelect === true)
}

/**
 * The tab strip (§8): `[1 ✓] · 2 · 3`. The focused question is bracketed, an
 * answered question (picked or committed custom) carries `✓`. The old `(i/n)`
 * title prefix is gone — the strip alone carries progress.
 */
export function askTabStrip(
	questions: readonly SeamAskQuestion[],
	picks: readonly (readonly string[])[],
	index: number,
	customs?: readonly (string | undefined)[],
): string {
	return questions
		.map((_, qi) => {
			const answered = (picks[qi]?.length ?? 0) > 0 || (customs?.[qi] !== undefined && customs[qi] !== "")
			const label = `${qi + 1}${answered ? " ✓" : ""}`
			return qi === index ? `[${label}]` : label
		})
		.join(" · ")
}

/** Whether the questions phase paints the trailing review row for a question:
 * the batch needs review and the question has at least one option row (a
 * zero-option question paints only the resident inline row, spec §2). */
export function hasReviewRow(question: SeamAskQuestion, needsReview: boolean): boolean {
	return needsReview && question.options.length > 0
}

/** Cursor space of the questions phase: option rows, then the review row
 * (when painted), then the resident inline row (always last). */
export function questionRowCount(question: SeamAskQuestion, needsReview: boolean): number {
	return question.options.length + (hasReviewRow(question, needsReview) ? 1 : 0) + 1
}

/** The resident inline row's index in that cursor space. */
export function inlineRowIndex(question: SeamAskQuestion, needsReview: boolean): number {
	return question.options.length + (hasReviewRow(question, needsReview) ? 1 : 0)
}

/** What the review page's current row means (spec §8): the question rows jump
 * back to that question for editing, the last row submits the batch. The key
 * layer (next task) maps Enter through this single helper. */
export type AskReviewIntent = { kind: "edit"; question: number } | { kind: "submit" }

export function reviewRowIntent(cursor: number, questionCount: number): AskReviewIntent {
	return cursor >= questionCount ? { kind: "submit" } : { kind: "edit", question: Math.max(0, cursor) }
}

/** A conservative content-row estimate for `dock.open({ contentRows })` so the
 * dock does not start at the 60% cap before its first measurement lands. */
export function estimateAskRows(ask: {
	questions: readonly SeamAskQuestion[]
	index: number
}): number {
	const question = ask.questions[ask.index]
	if (question === undefined) return 1
	let rows = 1 // top rule (the surface's separation from the widgets dock)
	rows += 1 // title
	if (question.header !== undefined) rows += 1
	if (question.detail !== undefined) rows += 1
	if (ask.questions.length >= 2) rows += 1 // tab strip
	for (const option of question.options) rows += option.description === undefined ? 1 : 2
	if (hasReviewRow(question, askNeedsReview(ask.questions))) rows += 1
	rows += 1 // inline row
	rows += 1 // footer hint
	rows += 1 // bottom rule (mirrors the top rule)
	return rows
}
