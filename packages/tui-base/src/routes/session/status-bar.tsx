/**
 * StatusBar — the busy-state line (Kimi/opencode-style): one animated row
 * below the composer showing WHAT the agent is doing right now. Ported
 * from the old stack's `@dsh-opentui/kit` status-bar.tsx (batch 7).
 *
 * Anatomy: [comet track: 🐳 head + ▓▒░ tail] [verb… elapsed · detail]
 * - VERB ROTATES through a per-phase pool every ~2.5s
 * - phases: think (reasoning), tool (a tool is running),
 *   stream (reply text streaming), approve (waiting on the approval card)
 * - idle → the line is gone (mount-on-busy); the caller unmounts it when
 *   the turn ends
 *
 * Colors: vendored theme tokens via `useThemeOptional()` — per-phase head
 * color (think/stream = accent hues, tool = success, approve = warning),
 * comet track = border.base; the kit-era hex constants are the
 * no-provider fallback (same injectable law as the composer).
 */
import { createSignal, onCleanup, For, Show, type JSX } from "solid-js"
import type { RGBA } from "@opentui/core"
import { useThemeOptional } from "../../context/theme"

/** Token RGBA or fallback hex — style colors accept both. */
type StatusColor = string | RGBA

export type StatusPhase = "think" | "tool" | "stream" | "approve"

/** Rotating verb pools per phase. */
const DEFAULT_VERBS: Record<StatusPhase, string[]> = {
	think: ["Thinking", "Pondering", "Reasoning", "Reflecting", "Deliberating", "Mulling"],
	tool: ["Executing", "Running", "Processing", "Building"],
	stream: ["Writing", "Composing", "Typing", "Drafting"],
	approve: ["Waiting"],
}

// the BRAND WHALE is the comet head for every phase (emoji cannot be
// horizontally mirrored in terminals — direction reads from the tail
// side + movement; phases still differ by color and verb)
const PHASE_ICON: Record<StatusPhase, string> = {
	think: "🧠",
	tool: "🛠",
	stream: "📝",
	approve: "⏳",
}

const TAIL = 5
const RAMP = ["█", "▓", "▒", "░"]
const BAR_MS = 80
const VERB_MS = 2500

const FALLBACK_TRACK = "#565f89"
const FALLBACK_HEAD = "#7aa2f7"

export function StatusBar(props: {
	/** Current busy phase (null = idle → renders nothing). */
	phase: StatusPhase | null
	/** Seconds since the turn started (drives the timer readout). */
	elapsed: () => number
	/** Short phase detail (e.g. the running tool's name). */
	detail?: () => string
	/** Verb pool override: { think?: string[], tool?: string[], … }. */
	verbs?: Partial<Record<StatusPhase, string[]>>
}): JSX.Element {
	const theme = useThemeOptional()
	const [tick, setTick] = createSignal(0)
	const timer = setInterval(() => setTick((t) => t + 1), BAR_MS)
	onCleanup(() => clearInterval(timer))

	const pools = (): Record<StatusPhase, string[]> => ({
		think: props.verbs?.think ?? DEFAULT_VERBS.think,
		tool: props.verbs?.tool ?? DEFAULT_VERBS.tool,
		stream: props.verbs?.stream ?? DEFAULT_VERBS.stream,
		approve: props.verbs?.approve ?? DEFAULT_VERBS.approve,
	})

	const headFg = (): StatusColor => {
		switch (props.phase) {
			case "think":
				return theme?.hue.accent[400] ?? FALLBACK_HEAD
			case "tool":
				return theme?.text.feedback.success.base ?? "#4caf50"
			case "approve":
				return theme?.text.feedback.warning.base ?? "#e0af68"
			default:
				return theme?.hue.accent[500] ?? FALLBACK_HEAD
		}
	}

	/** Fixed-width comet track (15 display columns; 🐳 spans two). */
	const TRACK_COLS = 15
	const ASSEMBLY = 2
	const row = (): { text: string; fg: StatusColor }[] => {
		const phase = props.phase
		if (phase === null) return []
		const pool = pools()[phase]
		const verb = pool[Math.floor((tick() * BAR_MS) / VERB_MS) % pool.length]
		const detail = props.detail?.() ?? ""
		const label = `${PHASE_ICON[phase]} ${verb}... ${props.elapsed()}s${detail ? ` · ${detail}` : ""}`
		const trackFg: StatusColor = theme?.border.base ?? FALLBACK_TRACK
		const head = headFg()

		const span = TRACK_COLS - ASSEMBLY
		const step = Math.floor(tick() % (span * 2))
		const start = step < span ? step : span * 2 - step
		const dirRight = step < span
		const stern = dirRight ? start : start + ASSEMBLY // first tail column
		const tailEnd = dirRight ? stern - TAIL : stern + TAIL // exclusive

		const runs: { text: string; fg: StatusColor }[] = []
		let buf = ""
		let bufFg: StatusColor = trackFg
		const flush = (f: StatusColor) => {
			if (buf) runs.push({ text: buf, fg: bufFg })
			buf = ""
			bufFg = f
		}
		for (let c = 0; c < TRACK_COLS; c++) {
			if (c === start) {
				flush(head)
				runs.push({ text: "🐳", fg: head })
				bufFg = trackFg
				c += 1 // whale spans two display columns
				continue
			}
			const behind = dirRight ? stern - c : c - stern
			const inTail = dirRight ? c < stern && c > tailEnd : c > stern && c < tailEnd
			if (inTail && behind >= 0) {
				const ch = RAMP[Math.min(RAMP.length - 1, Math.floor(behind / 2) + 1)]!
				if (head !== bufFg) flush(head)
				buf += ch
			} else {
				if (trackFg !== bufFg) flush(trackFg)
				buf += "░"
			}
		}
		flush(trackFg)
		runs.push({ text: ` ${label}`, fg: head })
		return runs
	}

	return (
		<Show when={props.phase !== null}>
			<box style={{ flexDirection: "row", paddingLeft: 1, paddingRight: 1, height: 1, flexGrow: 0 }}>
				<For each={row()}>
					{(r) => (
						<text style={{ fg: r.fg }} wrapMode="none">
							{r.text}
						</text>
					)}
				</For>
			</box>
		</Show>
	)
}
