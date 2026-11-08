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
import { For, createSignal, type JSX } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { clipToWidth } from "./tool-summarize"
import { useThemeOptional } from "../../context/theme"

export const NOTICE_AUTO_DISMISS_MS = 8000
export const NOTICE_MAX_LINES = 8

export type Notice = { id: number; text: string }

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

/** Stack one transient line; it retires after `ttlMs`. Returns its id. */
export function showNotice(text: string, ttlMs: number = NOTICE_AUTO_DISMISS_MS): number {
	const line = text.replace(/\r?\n/g, " ").trim()
	if (line === "") return -1
	const id = ++ordinal
	while (notices().length >= NOTICE_MAX_LINES) {
		const oldest = notices()[0]
		if (oldest === undefined) break
		retireNotice(oldest.id)
	}
	setNotices((list) => [...list, { id, text: line }])
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

/** The dock line set (pure): one clipped line per live notice. */
export function noticeLines(list: readonly Notice[], width: number): string[] {
	return list.map((notice) => clipToWidth(notice.text, Math.max(8, width)))
}

/** The slot. Explicit height = live line count (auto-height collapse law). */
export function NoticesDock(): JSX.Element {
	const dimensions = useTerminalDimensions()
	const theme = useThemeOptional()
	return (
		<box flexShrink={0} flexDirection="column" width="100%" height={notices().length} paddingLeft={1}>
			<For each={noticeLines(notices(), dimensions().width - 2)}>
				{(line) => (
					<text fg={theme?.text.muted ?? "#9aa5ce"} wrapMode="none">
						{line}
					</text>
				)}
			</For>
		</box>
	)
}
