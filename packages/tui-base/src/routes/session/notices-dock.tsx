/**
 * NoticesDock — batch D3: the transient notices slot (dsh-tui-pi tui.ts:256
 * `notices` container + `showNotice`). Pinned BELOW the lastRequest slot,
 * directly above the powerline footer (tui-pi dock order: status → widgets
 * → editor → lastRequest → notices → footer). Zero rows while empty.
 *
 * Semantics (tui-pi parity):
 *   - lines STACK (a burst keeps every line visible), each retires on its
 *     OWN timer (NOTICE_AUTO_DISMISS_MS) — timer-driven only, never on a
 *     keypress;
 *   - the stack is capped (NOTICE_MAX_LINES): the OLDEST line drops so the
 *     freshest keeps its full window.
 *
 * Store law: a MODULE-level signal (no component-scope state the render
 * closures capture — the widgets-dock closure law); producers call
 * `showNotice(text)` from anywhere (the steer feedback bridge is the first).
 */
import { For, createSignal, Show, type JSX } from "solid-js"
import { useTerminalDimensions, onAnimationTick } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import { clipToWidth } from "./tool-summarize"
import { useThemeOptional } from "../../context/theme"
import { motionAnimationRunning, motionDecorationsEnabled, motionFrameRate } from "../../skin/motion"
import {
	mixSkinColor,
	skinFadeInColor,
	skinNoticeFadeProgress,
	skinPulseBrightness,
	SKIN_FADE_IN_MS,
	SKIN_NOTICE_FADE_MS,
	SKIN_PULSE_MS,
} from "./widgets-dock"

export const NOTICE_AUTO_DISMISS_MS = 8000
export const NOTICE_MAX_LINES = 8

export type Notice = {
	id: number
	text: string
	/** δ: error notices paint a pulsing `⚠` marker (3 bright/dim cycles ≈
	 * 1.2s then静止, marker text only — the frame never moves). */
	kind?: "error"
	/** δ: view-side fade anchor — entrance fade-in and the TTL-tail fade-out
	 * derive progress from this timestamp; the removal timer is untouched. */
	startedAt: number
	ttlMs: number
}

const [notices, setNotices] = createSignal<Notice[]>([])
const timers = new Map<number, ReturnType<typeof setTimeout>>()
let ordinal = 0

/** The live notice list (read-only accessor). */
export const noticeList = notices

/** Retire one notice (idempotent). */
export function retireNotice(id: number): void {
	const timer = timers.get(id)
	if (timer !== undefined) clearTimeout(timer)
	timers.delete(id)
	setNotices((list) => list.filter((notice) => notice.id !== id))
}

/** Stack one transient line; it retires after `ttlMs`. Returns its id.
 * δ: `kind: "error"` adds the pulsing warning marker (purely visual). */
export function showNotice(text: string, ttlMs: number = NOTICE_AUTO_DISMISS_MS, kind?: "error"): number {
	const line = text.replace(/\r?\n/g, " ").trim()
	if (line === "") return -1
	const id = ++ordinal
	while (notices().length >= NOTICE_MAX_LINES) {
		const oldest = notices()[0]
		if (oldest === undefined) break
		retireNotice(oldest.id)
	}
	setNotices((list) => [...list, { id, text: line, kind, startedAt: Date.now(), ttlMs }])
	const timer = setTimeout(() => retireNotice(id), ttlMs)
	;(timer as { unref?: () => void }).unref?.()
	timers.set(id, timer)
	return id
}

/** Drop every notice (dispose / tests). */
export function clearNotices(): void {
	for (const id of [...timers.keys()]) retireNotice(id)
	setNotices([])
}

/** The dock line set (pure): one clipped line per live notice (the BODY
 * text; error markers render as their own pulsing <text> beside it). */
export function noticeLines(list: readonly Notice[], width: number): string[] {
	return list.map((notice) => clipToWidth(notice.text, Math.max(8, width)))
}

/** Whether a notice is mid-animation RIGHT NOW (pure, δ): entrance fade
 * (0.4s), the error marker pulse (≈1.2s), or the TTL-tail fade (last
 * 0.5s). Drives the shared-clock gate — no ticking once all lines rest. */
export function noticeAnimating(notice: Notice, now: number = Date.now()): boolean {
	const elapsed = now - notice.startedAt
	if (elapsed < SKIN_FADE_IN_MS) return true
	if (notice.kind === "error" && elapsed < SKIN_PULSE_MS) return true
	return elapsed >= notice.ttlMs - SKIN_NOTICE_FADE_MS && elapsed < notice.ttlMs
}

/** The slot. Explicit height = live line count (auto-height collapse law).
 * δ: entrance fade-in on every line, TTL-tail fade-out (remove moment
 * unchanged), error markers pulse 3× then rest — all color interpolation
 * on the shared motion clock (no opacity, no timers). */
export function NoticesDock(): JSX.Element {
	const dimensions = useTerminalDimensions()
	const theme = useThemeOptional()
	const [tick, setTick] = createSignal(0)
	onAnimationTick(
		() => (motionAnimationRunning() && notices().some((notice) => noticeAnimating(notice)) ? motionFrameRate() : undefined),
		() => setTick((t) => t + 1),
	)
	const bg = () => theme?.background.base ?? "#000000"
	const muted = () => theme?.text.muted ?? "#9aa5ce"
	const warning = () => theme?.text.feedback.warning.base ?? "#e0af68"
	const decorated = () => motionDecorationsEnabled()
	/** Body color: entrance fade → static muted → TTL-tail fade toward bg. */
	const bodyFg = (notice: Notice): string | RGBA => {
		tick()
		const target = muted()
		if (!decorated()) return target
		const elapsed = Date.now() - notice.startedAt
		const out = skinNoticeFadeProgress(elapsed, notice.ttlMs)
		if (out > 0) return mixSkinColor(target, bg(), out)
		const t = Math.min(1, elapsed / SKIN_FADE_IN_MS)
		return t >= 1 ? target : skinFadeInColor(target, bg(), t * SKIN_FADE_IN_MS)
	}
	/** Marker color: the ONLY thing the reminder pulse moves (3 dips ≈1.2s
	 * then静止 at full warning color; the border is never touched). */
	const markerFg = (notice: Notice): string | RGBA => {
		tick()
		const target = warning()
		if (!decorated()) return target
		const bright = skinPulseBrightness(Date.now() - notice.startedAt)
		return bright >= 1 ? target : mixSkinColor(target, bg(), 1 - bright)
	}
	const width = () => Math.max(8, dimensions().width - 2)
	return (
		<box flexShrink={0} flexDirection="column" width="100%" height={notices().length} paddingLeft={1}>
			<For each={noticeList()}>
				{(notice) => (
					<box flexDirection="row" height={1} width="100%">
						<Show when={notice.kind === "error"} fallback={null}>
							<text fg={markerFg(notice)} wrapMode="none">
								{`⚠ `}
							</text>
						</Show>
						<text fg={bodyFg(notice)} wrapMode="none">
							{clipToWidth(notice.text, width() - (notice.kind === "error" ? 2 : 0))}
						</text>
					</box>
				)}
			</For>
		</box>
	)
}
