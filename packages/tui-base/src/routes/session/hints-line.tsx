/**
 * HintsLine — batch D3: the keybinding hint row, the LAST row of the page
 * (dsh-tui-pi index.ts:2290-2297: the PowerlineFooter first, the FooterHint
 * single width-clipped row after it). The powerline keeps the pure segment
 * strip; every key hint (the composer's old idle footer + the powerline's
 * `Ctrl+Shift+F: search` segment) lives here.
 *
 *   idle  `⌨ enter send · alt+enter newline · ↑↓ history · ↓ subagents · ctrl+shift+f search · ctrl+pgup scroll · ctrl+c ×2 quit`
 *   busy  `⌨ enter steer · esc stop · …` (the running-turn keys lead)
 *
 * Footer-quickwins batch (tui-pi footer.ts:41-98 parity): the bar is now
 * EIGHT independently toggleable segments (send / newline / history / stop /
 * quit / scroll / search / subagents) in tui-pi's per-segment on/off shape,
 * each label localized across en / zh-CN / ja / ko (tui-pi locales'
 * `footer.hint.*` keys, vendored inline — tui-base carries no i18n
 * infrastructure, so the four languages live in one typed table instead of
 * JSON files). Toggle surface: `/hints` flips the bar (zero rows when off),
 * `/hints <segment> [on|off]` one segment, `/hints lang <locale>` the
 * language. Store law: module-level state, getter-prop busy. The busy/idle
 * two-state wording and the conditional `↓ subagents` segment (only while a
 * child runs — the SubagentsPicker toggle gate) are preserved.
 */
import { createSignal, Show, type JSX } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { clipToWidth } from "./tool-summarize"
import { useThemeOptional } from "../../context/theme"
import { subagentMarkerViews } from "./subagent-markers"

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
 * One segment's label per state: `idle` renders on the idle bar, `busy` on
 * the running-turn bar; `null` = the segment is absent from that state
 * (newline/history idle-only, stop busy-only — the pre-existing wording).
 */
type HintLabel = { idle: string | null; busy: string | null }

/**
 * The four-language label table (tui-pi locales `footer.hint.*` wording
 * where the keys overlap: send / stop / quit / search / history /
 * subagents; newline / scroll / the steer variant are opentui-specific).
 * Vendored typed table — no i18n infra to load JSON through (typecheck
 * budget carries no resolveJsonModule).
 */
const HINT_LABEL_TABLE: Record<HintLocale, Record<HintSegmentId, HintLabel>> = {
	en: {
		send: { idle: "enter send", busy: "enter steer" },
		newline: { idle: "alt+enter newline", busy: null },
		history: { idle: "↑↓ history", busy: null },
		stop: { idle: null, busy: "esc stop" },
		quit: { idle: "ctrl+c ×2 quit", busy: "ctrl+c ×2 quit" },
		scroll: { idle: "pgup/pgdn scroll", busy: "pgup/pgdn scroll" },
		search: { idle: "ctrl+shift+f search", busy: "ctrl+shift+f search" },
		subagents: { idle: "↓ subagents", busy: "↓ subagents" },
	},
	"zh-CN": {
		send: { idle: "enter 发送", busy: "enter 插话" },
		newline: { idle: "alt+enter 换行", busy: null },
		history: { idle: "↑↓ 历史", busy: null },
		stop: { idle: null, busy: "esc 停止" },
		quit: { idle: "ctrl+c ×2 退出", busy: "ctrl+c ×2 退出" },
		scroll: { idle: "pgup/pgdn 滚动", busy: "pgup/pgdn 滚动" },
		search: { idle: "ctrl+shift+f 搜索", busy: "ctrl+shift+f 搜索" },
		subagents: { idle: "↓ 子代理", busy: "↓ 子代理" },
	},
	ja: {
		send: { idle: "enter 送信", busy: "enter 割込み" },
		newline: { idle: "alt+enter 改行", busy: null },
		history: { idle: "↑↓ 履歴", busy: null },
		stop: { idle: null, busy: "esc 停止" },
		quit: { idle: "ctrl+c ×2 終了", busy: "ctrl+c ×2 終了" },
		scroll: { idle: "pgup/pgdn スクロール", busy: "pgup/pgdn スクロール" },
		search: { idle: "ctrl+shift+f 検索", busy: "ctrl+shift+f 検索" },
		subagents: { idle: "↓ サブエージェント", busy: "↓ サブエージェント" },
	},
	ko: {
		send: { idle: "enter 전송", busy: "enter 끼어넣기" },
		newline: { idle: "alt+enter 줄바꿈", busy: null },
		history: { idle: "↑↓ 기록", busy: null },
		stop: { idle: null, busy: "esc 중지" },
		quit: { idle: "ctrl+c ×2 종료", busy: "ctrl+c ×2 종료" },
		scroll: { idle: "pgup/pgdn 스크롤", busy: "pgup/pgdn 스크롤" },
		search: { idle: "ctrl+shift+f 검색", busy: "ctrl+shift+f 검색" },
		subagents: { idle: "↓ 서브에이전트", busy: "↓ 서브에이전트" },
	},
}

/** The per-segment on/off selection (module-level store, tui-pi FooterHints). */
export const [footerHints, setFooterHints] = createSignal<FooterHints>({ ...DEFAULT_FOOTER_HINTS })
/** The hint-bar language (module-level; `/hints lang <locale>`). */
export const [hintsLocale, setHintsLocale] = createSignal<HintLocale>("en")

/** One segment's label in one language; unknown locale/wording falls to en, then ''. */
export function hintLabel(id: HintSegmentId, busy: boolean, locale: HintLocale = hintsLocale()): string {
	const entry = (HINT_LABEL_TABLE[locale] ?? HINT_LABEL_TABLE.en)[id]
	return (busy ? entry.busy : entry.idle) ?? ""
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
	locale: HintLocale = hintsLocale(),
): string {
	if (!shown) return ""
	const parts: string[] = []
	for (const id of FOOTER_HINT_IDS) {
		if (id === "subagents") {
			// Batch D5b: the conditional segment — only while a child runs AND on.
			if (subagentsLive && hints.subagents) parts.push(hintLabel("subagents", busy, locale))
			continue
		}
		if (!hints[id]) continue
		const label = hintLabel(id, busy, locale)
		if (label) parts.push(label) // '' = segment absent from this state (idle drops stop, busy drops newline/history)
	}
	if (parts.length === 0) return ""
	return `⌨ ${parts.join(" · ")}`
}

export function HintsLine(props: {
	/** Turn running (getter-prop law: the page passes a getter). */
	busy: boolean
}): JSX.Element {
	const dimensions = useTerminalDimensions()
	const theme = useThemeOptional()
	return (
		<Show when={hintsShown()}>
			<box flexShrink={0} height={1} width="100%" paddingLeft={1}>
				<text fg={theme?.text.faint ?? "#565f89"} wrapMode="none">
					{clipToWidth(hintsText(props.busy, hintsShown(), subagentMarkerViews().some((v) => v.status === "running")), Math.max(8, dimensions().width - 2))}
				</text>
			</box>
		</Show>
	)
}
