/**
 * HintsLine — batch D3: the keybinding hint row, the LAST row of the page
 * (dsh-tui-pi index.ts:2290-2297: the PowerlineFooter first, the FooterHint
 * single width-clipped row after it). The powerline keeps the pure segment
 * strip; every key hint (the composer's old idle footer + the powerline's
 * `Ctrl+Shift+F: search` segment) lives here.
 *
 *   idle  `⌨ enter send · alt+enter newline · ↑↓ history · ↓ subagents · ctrl+shift+f search · pgup/pgdn scroll · ctrl+c quit`
 *   busy  `⌨ enter steer · esc stop · …` (the running-turn keys lead)
 *
 * HUD merge (2026-11-17): the busy 🐳 comet track moved HERE — this is the
 * LAST page row, and while the turn is busy it reads
 *   busy  `[comet: 15 cols][gap][hints…]`
 *   idle  `[hints…]` (no comet, same left offset as before)
 * The busy status TEXT (verb / elapsed seconds / phase icon / detail) was
 * deleted entirely; the comet renderable/bounce math come shared from
 * ./comet-track (no fork with the retained StatusBar).
 *
 * Footer-quickwins batch (tui-pi footer.ts:41-98 parity): the bar is now
 * NINE independently toggleable hint segments (send / newline / history / stop /
 * subagentPanel / quit / scroll / search / subagents) in tui-pi's per-segment on/off shape,
 * each label a `footer.hint.*` key in the i18n registry (T8 fold: the vendored
 * four-language typed tables are gone — wording now rides the unified
 * language through `t()`, and a `/hints lang` pick persists the unified
 * language and flips the live language signal immediately; ja/ko have no
 * bundled file and degrade to en). Toggle surface: `/hints` flips the bar (zero rows when off),
 * `/hints <segment> [on|off]` one segment, `/hints lang <locale>` the
 * language. Store law: module-level state, getter-prop busy. The busy/idle
 * two-state wording and the conditional `↓ subagents` segment (only while a
 * child runs — the SubagentsPicker toggle gate) are preserved.
 */
import { createSignal, Show, type JSX } from "solid-js"
import { onAnimationTick } from "@opentui/solid"
import { t } from "../../i18n"
import { useTerminalSize } from "./terminal-size"
import { clipToWidth } from "./tool-summarize"
import { stringWidth } from "../../util/string-width"
import { useThemeOptional } from "../../context/theme"
import { motionDecorationsEnabled } from "../../skin/motion"
import { subagentMarkerViews } from "./subagent-markers"
import { cometFps, cometHeadColor, COMET_FALLBACK_TRACK, COMET_TRACK_COLS } from "./comet-track"
import type { Pane } from "./pane-focus"

export const [hintsShown, setHintsShown] = createSignal(true)

/** Gap between the comet track and the first hint segment on the busy row. */
export const COMET_HINT_GAP = 1

/** The nine toggleable hint segments (tui-pi FooterHints parity, opentui keys). */
export type HintSegmentId = "send" | "newline" | "history" | "stop" | "subagentPanel" | "quit" | "scroll" | "search" | "subagents"

export interface FooterHints {
	send: boolean
	newline: boolean
	history: boolean
	stop: boolean
	subagentPanel: boolean
	quit: boolean
	scroll: boolean
	search: boolean
	subagents: boolean
}

/** Every hint on — the footer hint bar renders all its segments. */
export const DEFAULT_FOOTER_HINTS: Readonly<FooterHints> = Object.freeze({
	send: true,
	newline: true,
	history: true,
	stop: true,
	subagentPanel: true,
	quit: true,
	scroll: true,
	search: true,
	subagents: true,
})

/** Display order for `/hints` usage output and per-segment iteration — the
 * pre-quickwins bar order: state leads (idle: send/newline/history, busy:
 * steer/stop), then the conditional subagents segment, then the common tail. */
export const FOOTER_HINT_IDS: readonly HintSegmentId[] = [
	"send",
	"newline",
	"history",
	"stop",
	"subagentPanel",
	"subagents",
	"search",
	"scroll",
	"quit",
]

/**
 * Width-folding priority (lower number = kept longer as the terminal narrows).
 * Trade-off: the keys needed to ACT and to LEAVE are core and survive first;
 * discovery/navigation conveniences are optional and disappear whole. Ties are
 * broken by display order (FOOTER_HINT_IDS), so the surviving row always reads
 * core → optional in a stable order.
 *
 * subagentPanel sits immediately after the core tier (15) rather than inside
 * it: ctrl+g is the only discovery path to the subagent activity panel, so it
 * must survive an 80-column bar alongside ctrl+c quit. At 40 columns the
 * 22-column label is too wide and it yields to the core pair, which keeps the
 * "leave" key reachable. Putting it in the 10 tier instead would let it win
 * the display-order tie against quit and push quit off the 40-column bar.
 * Beyond core, the tail is ordered history → newline → subagents → search →
 * scroll, so scroll is always the first optional segment to go.
 */
export const HINT_SEGMENT_PRIORITY: Readonly<Record<HintSegmentId, number>> = Object.freeze({
	send: 10, // enter send / steer — the primary action
	stop: 10, // esc stop — the only way to halt a running turn
	quit: 10, // ctrl+c quit — the only way to leave
	subagentPanel: 15, // ctrl+g — core-adjacent: fits 80 cols beside quit, yields to quit at 40
	history: 20, // ↑↓ history — recall the last input
	newline: 30, // alt+enter newline — multiline input
	subagents: 40, // ↓ subagents — contextual: only while a child runs
	search: 60, // ctrl+shift+f — full-text search
	scroll: 70, // pgup/pgdn — page the transcript (first to go)
})

/** Supported hint-bar languages (tui-pi locales parity). */
export type HintLocale = "en" | "zh-CN" | "ja" | "ko"
export const HINT_LOCALES: readonly HintLocale[] = ["en", "zh-CN", "ja", "ko"]

/**
 * One segment's label keys per state: `idle` renders on the idle bar, `busy`
 * on the running-turn bar; `null` = the segment is absent from that state
 * (newline/history idle-only, stop busy-only — the pre-existing wording).
 * Segments whose two states share one wording point both states at the same
 * bare key. Locale-neutral structure (keys, not copy).
 */
type HintLabelKeys = { idle: string | null; busy: string | null }

/** The `footer.hint.*` key map — the tui-pi locales wording where the keys
 * overlap (send / stop / quit / search / history / subagents); newline /
 * scroll / the steer variant are opentui-specific. */
const HINT_LABEL_KEYS: Record<HintSegmentId, HintLabelKeys> = {
	send: { idle: "footer.hint.send.idle", busy: "footer.hint.send.busy" },
	newline: { idle: "footer.hint.newline.idle", busy: null },
	history: { idle: "footer.hint.history.idle", busy: null },
	stop: { idle: null, busy: "footer.hint.stop.busy" },
	subagentPanel: { idle: "footer.hint.subagentPanel", busy: "footer.hint.subagentPanel" },
	// Busy ctrl+c interrupts the running turn; only idle ctrl+c opens the quit
	// confirm (see turn-cancel.tsx). The two states need different wording.
	quit: { idle: "footer.hint.quit", busy: "footer.hint.quit.busy" },
	scroll: { idle: "footer.hint.scroll", busy: "footer.hint.scroll" },
	search: { idle: "footer.hint.search", busy: "footer.hint.search" },
	subagents: { idle: "footer.hint.subagents", busy: "footer.hint.subagents" },
}

/** The per-segment on/off selection (module-level store, tui-pi FooterHints). */
export const [footerHints, setFooterHints] = createSignal<FooterHints>({ ...DEFAULT_FOOTER_HINTS })
/**
 * The hint-bar language (module-level). T8 fold: the labels render through
 * the unified registry instead, so this signal is the persistence mirror of
 * the stored language only — `/hints lang`, `/language` and the settings
 * language rows keep it in step with the persisted value (so a later segment
 * toggle re-saves the same language) and also flip the i18n language signal
 * live, so the new wording lands immediately (no restart).
 */
export const [hintsLocale, setHintsLocale] = createSignal<HintLocale>("en")

/**
 * The persisted `footerHints` config key (profile config.json — /hints
 * writes it through the same configSave chain /theme and /motion use):
 * a partial segment→boolean record; missing keys keep the default (on),
 * unknown keys and non-boolean values are ignored. Returns undefined when
 * nothing valid is stored (fresh profile / corrupt value → the default bar).
 */
export function footerHintsFromConfig(value: unknown): FooterHints | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
	const stored = value as Record<string, unknown>
	let hints: FooterHints | undefined
	for (const id of FOOTER_HINT_IDS) {
		const flag = stored[id]
		if (typeof flag !== "boolean") continue
		hints ??= { ...DEFAULT_FOOTER_HINTS }
		hints[id] = flag
	}
	return hints
}

/**
 * The persisted language config value: one of the four canonical spellings;
 * anything else (legacy value, typo) → undefined → boot keeps the en
 * default. T14: the WRITE surface is the unified `lang` key (/language, /hints
 * lang, the settings rows); `hintsLocale` stays a READ-ONLY legacy fallback —
 * the stored values share the same canonical spellings, so one validator
 * serves both keys.
 */
export function hintsLocaleFromConfig(value: unknown): HintLocale | undefined {
	return typeof value === "string" && (HINT_LOCALES as readonly string[]).includes(value) ? (value as HintLocale) : undefined
}

/**
 * Boot replay (/motion's `motionFromConfig` parity): apply the persisted
 * hint-bar selection onto the module signals BEFORE the first paint so a
 * restart keeps the user's toggles. The language folds in through the SAME
 * precedence the i18n registry applies (applyI18nConfig — T8 report's
 * storage-key split): the unified `lang` key first, the legacy `hintsLocale`
 * key as the read-only fallback when no unified value exists. Unknown/missing
 * keys leave the signals at their defaults; never throws.
 */
export function applyHintsConfig(config?: Record<string, unknown>): void {
	try {
		const hints = config && footerHintsFromConfig(config.footerHints)
		if (hints) setFooterHints(hints)
		const stored = config?.lang !== undefined ? config.lang : config?.hintsLocale
		const locale = config && hintsLocaleFromConfig(stored)
		if (locale) setHintsLocale(locale)
	} catch {
		/* replay is best-effort: a bad config read keeps the defaults */
	}
}

/**
 * One segment's label in the active language (t() — the registry's
 * fail-open chain runs active → en → key; the language signal is read at
 * call time, so tracked call sites re-render on a live switch). A segment
 * absent from the given state, or a key missing from the registry too,
 * renders '' (the caller drops it). Getter-law note: this reads registry
 * state at CALL time — every call site is inside the HintsLine `row()`
 * getter / a pure helper, so the wording is never baked flat outside the
 * render scope.
 */
export function hintLabel(id: HintSegmentId, busy: boolean): string {
	const keys = HINT_LABEL_KEYS[id]
	const key = busy ? keys.busy : keys.idle
	if (key === null) return ""
	const label = t(key)
	return label === key ? "" : label
}

/** Is a segment present in the given state at all (newline/history idle-only, stop busy-only)? */
export function hintInState(id: HintSegmentId, busy: boolean): boolean {
	return hintLabel(id, busy) !== ""
}

/** One rendered segment: its id (priority lookup) and its localized label. */
interface HintPart {
	id: HintSegmentId
	label: string
}

/**
 * The present segments in display order (busy/idle leads → conditional
 * `↓ subagents` → common tail). Batch D5b: `↓ subagents` only while a child
 * runs AND its segment is on. Shared by the unclipped and width-fitted rows so
 * wording and order semantics stay identical — folding only removes segments.
 */
function hintParts(busy: boolean, shown: boolean, subagentsLive: boolean, hints: FooterHints): HintPart[] {
	if (!shown) return []
	const parts: HintPart[] = []
	for (const id of FOOTER_HINT_IDS) {
		if (id === "subagents") {
			// Batch D5b: the conditional segment — only while a child runs AND on.
			if (subagentsLive && hints.subagents) {
				const label = hintLabel("subagents", busy)
				if (label) parts.push({ id, label })
			}
			continue
		}
		if (!hints[id]) continue
		const label = hintLabel(id, busy)
		// '' = segment absent from this state (idle drops stop, busy drops newline/history).
		if (label) parts.push({ id, label })
	}
	return parts
}

/** Render parts as the `⌨ seg · seg` row; '' when nothing survives. */
function joinHintParts(parts: HintPart[]): string {
	if (parts.length === 0) return ""
	return `⌨ ${parts.map((p) => p.label).join(" · ")}`
}

/**
 * The full, unclipped hint row (pure): `''` when the bar is toggled off; only
 * the per-segment ON segments render, in the fixed display order. Width-unaware
 * — renderers that own a viewport use `hintsTextAtWidth` so a narrow terminal
 * folds whole segments instead of cutting one mid-glyph.
 */
export function hintsText(
	busy: boolean,
	shown = true,
	subagentsLive = false,
	hints: FooterHints = footerHints(),
): string {
	return joinHintParts(hintParts(busy, shown, subagentsLive, hints))
}

/**
 * The width-fitted hint row (pure). Segments are taken highest-priority first
 * until the next one would overflow: that segment AND every lower-priority one
 * after it are dropped WHOLE (never cut). Survivors are sorted back into display
 * order — the visible row always reads core → optional, and a lower-priority
 * segment is never shown while a higher-priority one is missing. `columns` is
 * the terminal width (the same -2 the viewport applies). Everything fitting
 * needs no folding. If not even one whole segment fits (extreme narrow), fall
 * back to `clipToWidth` so the row stays bounded.
 */
export function hintsTextAtWidth(
	busy: boolean,
	shown: boolean,
	subagentsLive: boolean,
	columns: number,
	hints: FooterHints = footerHints(),
): string {
	const parts = hintParts(busy, shown, subagentsLive, hints)
	const full = joinHintParts(parts)
	if (!full) return ""
	const usable = Math.max(8, columns - 2)
	if (stringWidth(full) <= usable) return full

	// Rank high → low priority; ties keep display order. Keep each part's
	// display index so survivors can be restored to stable core → optional order.
	const ranked = parts
		.map((part, index) => ({ part, index }))
		.sort((a, b) => HINT_SEGMENT_PRIORITY[a.part.id] - HINT_SEGMENT_PRIORITY[b.part.id] || a.index - b.index)

	const kept: typeof ranked = []
	let width = 0 // the ⌨ prefix is counted once, when the first segment lands
	for (const candidate of ranked) {
		const added = stringWidth(candidate.part.label) + (kept.length > 0 ? stringWidth(" · ") : stringWidth("⌨ "))
		if (width + added > usable) break // this segment AND all lower-priority ones are dropped whole
		width += added
		kept.push(candidate)
	}
	if (kept.length === 0) return clipToWidth(full, usable) // extreme narrow: bounded hard-cut fallback
	kept.sort((a, b) => a.index - b.index)
	return joinHintParts(kept.map((k) => k.part))
}

/**
 * Pane-focus hint bar (transcript owns the keys): the composer's send/history
 * segments no longer apply, so the row switches to the transcript's own keys.
 * One `footer.hint.transcript` key per language, same `⌨ <segments>` shape
 * as `hintsText`; the `/hints` master toggle (`hintsShown`) still zeroes the
 * row.
 */
const TRANSCRIPT_HINT_KEY = "footer.hint.transcript"

/** The transcript-focused hint row (pure; '' when the bar is toggled off). */
export function transcriptHintsText(shown = true): string {
	if (!shown) return ""
	const body = t(TRANSCRIPT_HINT_KEY)
	return body === TRANSCRIPT_HINT_KEY ? "" : `⌨ ${body}`
}

export function HintsLine(props: {
	/**
	 * Turn running. GETTER-PROP LAW: a STABLE FUNCTION value (`busy: () => busy()`),
	 * not a baked `get busy()` accessor or a `busy={busy()}` value — the latter
	 * are recast to a snapshot before the component body runs (the WidgetsDock
	 * turnActive trap), so `props.busy()` must be called at render time.
	 */
	busy: () => boolean
	/** Focused pane (pane-focus batch): the transcript swaps the composer's
	 * send/history wording for its scroll keys. Undefined (dialog focus /
	 * startup) keeps the composer wording. */
	pane?: () => Pane | undefined
}): JSX.Element {
	const dimensions = useTerminalSize()
	const theme = useThemeOptional()
	// The comet shows ONLY while the turn is busy AND the bar is on (/hints
	// off keeps the tui-pi zero-row parity), and it is the only thing driving
	// the animation clock — idle plumbs undefined, so nothing ticks.
	const cometActive = () => props.busy() && hintsShown()
	const [tick, setTick] = createSignal(0)
	onAnimationTick(() => cometFps(cometActive()), () => setTick((t) => t + 1))

	// The rendered row (getter: tracks busy / focus pane / segment toggles /
	// locale / live subagents / width). All segments off → '' → the row drops,
	// UNLESS busy (the comet still owns the row). The composer bar folds whole
	// segments by priority to the viewport width; the transcript row is a
	// single key string, so it keeps the plain clip.
	//
	// Width budget: the hints get the same `columns - 2` the plain line always
	// used (1 left pad + 1 right reserve), MINUS the comet's fixed 15 display
	// columns and the 1-column gap when busy. Subtracting from `columns`
	// before `hintsTextAtWidth` applies its own -2 keeps the existing folding /
	// clipping behaviour byte-for-byte; the row never overflows the pane.
	const row = () => {
		const busy = cometActive()
		const columns = dimensions().width - (busy ? COMET_TRACK_COLS + COMET_HINT_GAP : 0)
		return props.pane?.() === "transcript"
			? clipToWidth(transcriptHintsText(hintsShown()), Math.max(8, columns - 2))
			: hintsTextAtWidth(
					props.busy(),
					hintsShown(),
					subagentMarkerViews().some((v) => v.status === "running"),
					columns,
				)
	}
	// All-off parity (tui-pi): '' and idle renders ZERO rows — the fixed-height
	// box must unmount with the text, not linger as a blank line above the
	// composer. A busy turn keeps the row alive for the comet alone.
	return (
		<Show when={hintsShown() && (cometActive() || row().length > 0)}>
			<box flexShrink={0} height={1} width="100%" paddingLeft={1} flexDirection="row">
				<Show when={cometActive()}>
					<comet_track
						step={tick()}
						headFg={cometHeadColor(theme)}
						trackFg={theme?.border.base ?? COMET_FALLBACK_TRACK}
						gradient={motionDecorationsEnabled()}
					/>
				</Show>
				<text fg={theme?.text.faint ?? "#565f89"} wrapMode="none">
					{cometActive() && row().length > 0 ? `${" ".repeat(COMET_HINT_GAP)}${row()}` : row()}
				</text>
			</box>
		</Show>
	)
}
