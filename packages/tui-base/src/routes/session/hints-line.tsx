/**
 * HintsLine — batch D3: the keybinding hint row, the LAST row of the page
 * (dsh-tui-pi index.ts:2290-2297: the PowerlineFooter first, the FooterHint
 * single width-clipped row after it). The powerline keeps the pure segment
 * strip; every key hint (the composer's old idle footer + the powerline's
 * `Ctrl+Shift+F: search` segment) lives here.
 *
 *   idle  `⌨ enter send · alt+enter newline · ↑↓ history · ↓ subagents · ctrl+shift+f search · pgup/pgdn scroll · ctrl+c ×2 quit`
 *   busy  `⌨ enter steer · esc stop · …` (the running-turn keys lead)
 *
 * Footer-quickwins batch (tui-pi footer.ts:41-98 parity): the bar is now
 * EIGHT independently toggleable segments (send / newline / history / stop /
 * quit / scroll / search / subagents) in tui-pi's per-segment on/off shape,
 * each label a `footer.hint.*` key in the i18n registry (T8 fold: the vendored
 * four-language typed tables are gone — wording now rides the boot-fixed
 * unified language through `t()`, and a `/hints lang` pick persists the
 * unified language for the next boot; ja/ko have no bundled file and degrade
 * to en). Toggle surface: `/hints` flips the bar (zero rows when off),
 * `/hints <segment> [on|off]` one segment, `/hints lang <locale>` the
 * language. Store law: module-level state, getter-prop busy. The busy/idle
 * two-state wording and the conditional `↓ subagents` segment (only while a
 * child runs — the SubagentsPicker toggle gate) are preserved.
 */
import { createSignal, Show, type JSX } from "solid-js"
import { t } from "../../i18n"
import { useTerminalSize } from "./terminal-size"
import { clipToWidth } from "./tool-summarize"
import { useThemeOptional } from "../../context/theme"
import { subagentMarkerViews } from "./subagent-markers"
import type { Pane } from "./pane-focus"

export const [hintsShown, setHintsShown] = createSignal(true)

/** The eight toggleable hint segments (tui-pi FooterHints parity, opentui keys). */
export type HintSegmentId = "send" | "newline" | "history" | "stop" | "quit" | "scroll" | "search" | "subagents"

export interface FooterHints {
	send: boolean
	newline: boolean
	history: boolean
	stop: boolean
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
	"subagents",
	"search",
	"scroll",
	"quit",
]

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
	quit: { idle: "footer.hint.quit", busy: "footer.hint.quit" },
	scroll: { idle: "footer.hint.scroll", busy: "footer.hint.scroll" },
	search: { idle: "footer.hint.search", busy: "footer.hint.search" },
	subagents: { idle: "footer.hint.subagents", busy: "footer.hint.subagents" },
}

/** The per-segment on/off selection (module-level store, tui-pi FooterHints). */
export const [footerHints, setFooterHints] = createSignal<FooterHints>({ ...DEFAULT_FOOTER_HINTS })
/**
 * The hint-bar language (module-level). T8 fold: the labels render through
 * the boot-fixed unified registry instead, so this signal is the persistence
 * mirror of the stored `hintsLocale` config key only — `/hints lang` keeps it
 * in step with the persisted value (so a later segment toggle re-saves the
 * same language) and the new wording lands on the next boot.
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
 * The persisted `hintsLocale` config key (/hints lang): one of the four
 * canonical spellings; anything else (legacy value, typo) → undefined →
 * boot keeps the en default.
 */
export function hintsLocaleFromConfig(value: unknown): HintLocale | undefined {
	return typeof value === "string" && (HINT_LOCALES as readonly string[]).includes(value) ? (value as HintLocale) : undefined
}

/**
 * Boot replay (/motion's `motionFromConfig` parity): apply the persisted
 * hint-bar selection onto the module signals BEFORE the first paint so a
 * restart keeps the user's toggles. Unknown/missing keys leave the
 * signals at their defaults; never throws.
 */
export function applyHintsConfig(config?: Record<string, unknown>): void {
	try {
		const hints = config && footerHintsFromConfig(config.footerHints)
		if (hints) setFooterHints(hints)
		const locale = config && hintsLocaleFromConfig(config.hintsLocale)
		if (locale) setHintsLocale(locale)
	} catch {
		/* replay is best-effort: a bad config read keeps the defaults */
	}
}

/**
 * One segment's label in the boot-fixed language (t() — the registry's
 * fail-open chain runs active → en → key). A segment absent from the given
 * state, or a key missing from the registry too, renders '' (the caller
 * drops it). Getter-law note: this reads registry state at CALL time —
 * every call site is inside the HintsLine `row()` getter / a pure helper,
 * so the wording is never baked flat outside the render scope.
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

/**
 * The hint row text (pure): `''` when the bar is toggled off; only the
 * per-segment ON segments render, in the fixed order busy/idle leads →
 * conditional `↓ subagents` → common. Batch D5b: `↓ subagents` only while
 * a child runs AND its segment is on.
 */
export function hintsText(
	busy: boolean,
	shown = true,
	subagentsLive = false,
	hints: FooterHints = footerHints(),
): string {
	if (!shown) return ""
	const parts: string[] = []
	for (const id of FOOTER_HINT_IDS) {
		if (id === "subagents") {
			// Batch D5b: the conditional segment — only while a child runs AND on.
			if (subagentsLive && hints.subagents) parts.push(hintLabel("subagents", busy))
			continue
		}
		if (!hints[id]) continue
		const label = hintLabel(id, busy)
		if (label) parts.push(label) // '' = segment absent from this state (idle drops stop, busy drops newline/history)
	}
	if (parts.length === 0) return ""
	return `⌨ ${parts.join(" · ")}`
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
	/** Turn running (getter-prop law: the page passes a getter). */
	busy: boolean
	/** Focused pane (pane-focus batch): the transcript swaps the composer's
	 * send/history wording for its scroll keys. Undefined (dialog focus /
	 * startup) keeps the composer wording. */
	pane?: () => Pane | undefined
}): JSX.Element {
	const dimensions = useTerminalSize()
	const theme = useThemeOptional()
	// The rendered row (getter: tracks busy / focus pane / segment toggles /
	// locale / live subagents / width). All segments off → '' → the row drops.
	const row = () =>
		clipToWidth(
			props.pane?.() === "transcript"
				? transcriptHintsText(hintsShown())
				: hintsText(props.busy, hintsShown(), subagentMarkerViews().some((v) => v.status === "running")),
			Math.max(8, dimensions().width - 2),
		)
	// All-off parity (tui-pi): '' renders ZERO rows — the fixed-height box
	// must unmount with the text, not linger as a blank line above the
	// composer.
	return (
		<Show when={hintsShown() && row().length > 0}>
			<box flexShrink={0} height={1} width="100%" paddingLeft={1}>
				<text fg={theme?.text.faint ?? "#565f89"} wrapMode="none">
					{row()}
				</text>
			</box>
		</Show>
	)
}
