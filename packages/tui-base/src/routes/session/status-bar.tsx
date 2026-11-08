/**
 * StatusBar — the busy-state line (Kimi/opencode-style): one animated row
 * below the composer showing WHAT the agent is doing right now. Ported
 * from the old stack's `@dsh-opentui/kit` status-bar.tsx (batch 7), then
 * reskinned per the skin contract §1 "彗星": the 15-column track is ONE
 * self-drawn Renderable (the tab-pulse/spinner-renderable `animationFps`
 * pattern, H8 fix — no per-tick For/text rebuilds) with a 🐳 head and an
 * identity-gradient tail; reduced/non-truecolor falls back to the old
 * ▓▒░ ramp and tier off freezes it.
 *
 * Clock: the old module ran `setInterval(80ms)` even while invisible; the
 * comet now rides the renderer's SHARED animation clock via
 * `onAnimationTick` at the skin/motion.ts frame gate, and the accessor
 * returns undefined (clock paused) whenever the phase is null or the tier
 * is off — no ticking while idle, no setInterval (contract §2.2).
 *
 * Anatomy: [comet track: 🐳 head + tail] [verb… elapsed · detail]
 * - VERB ROTATES through a per-phase pool every ~2.5s (same tick source)
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
import { createEffect, createSignal, onCleanup, Show, type JSX } from "solid-js"
import { parseColor, Renderable, type RGBA, type OptimizedBuffer, type RenderableOptions, type RenderContext } from "@opentui/core"
import { extend, onAnimationTick } from "@opentui/solid"
import { useThemeOptional } from "../../context/theme"
import { STREAM_FPS, getMotionTier, motionDecorationsEnabled, setMotionBusy } from "../../skin/motion"
import { identityHexAt, type SkinColorMode } from "../../skin/identity"

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

/** Fixed-width comet track (15 display columns; 🐳 spans two). */
const TRACK_COLS = 15
const ASSEMBLY = 2

/** Bounce math shared by the old runs-based painter and the renderable. */
export function cometPosition(step: number): {
	start: number
	dirRight: boolean
	stern: number
	tailEnd: number
} {
	const span = TRACK_COLS - ASSEMBLY
	const s = ((step % (span * 2)) + span * 2) % (span * 2)
	const start = s < span ? s : span * 2 - s
	const dirRight = s < span
	const stern = dirRight ? start : start + ASSEMBLY
	const tailEnd = dirRight ? stern - TAIL : stern + TAIL
	return { start, dirRight, stern, tailEnd }
}

/** Tail glyph for the legacy ramp: distance behind the head → ▓▒░. */
export function cometRampChar(behind: number): string {
	return RAMP[Math.min(RAMP.length - 1, Math.floor(behind / 2) + 1)]!
}

type CometTrackOptions = RenderableOptions<CometTrackRenderable> & {
	/** Bounce phase (one unit per 80ms tick). */
	step?: number
	/** Whale head color (phase token or hex). */
	headFg?: StatusColor
	/** Track fill color (border.base token or hex). */
	trackFg?: StatusColor
	/** Identity ramp mode for the gradient tail. */
	mode?: SkinColorMode
	/** True → identity-gradient █ tail; false → legacy ▓▒░ ramp. */
	gradient?: boolean
}

/**
 * One self-drawn 15x1 comet track (H8: a single renderable replaces the
 * per-tick text-run rebuild). No `animationFps` here — the solid side
 * pauses/plays the renderer's shared animation clock via the fps accessor.
 */
export class CometTrackRenderable extends Renderable {
	private _step = 0
	private _headFg: RGBA
	private _trackFg: RGBA
	private _mode: SkinColorMode
	private _gradient: boolean

	constructor(ctx: RenderContext, options: CometTrackOptions = {} as CometTrackOptions) {
		super(ctx, options)
		this._headFg = parseColor(options.headFg ?? FALLBACK_HEAD)
		this._trackFg = parseColor(options.trackFg ?? FALLBACK_TRACK)
		this._mode = options.mode ?? "dark"
		this._gradient = options.gradient ?? false
		this.setMeasureProvider(() => ({ width: TRACK_COLS, height: 1 }))
	}

	set step(value: number) {
		if (value === this._step) return
		this._step = value
		this.requestRender()
	}

	set headFg(value: StatusColor) {
		const next = parseColor(value)
		if (next.equals(this._headFg)) return
		this._headFg = next
		this.requestRender()
	}

	set trackFg(value: StatusColor) {
		const next = parseColor(value)
		if (next.equals(this._trackFg)) return
		this._trackFg = next
		this.requestRender()
	}

	set mode(value: SkinColorMode) {
		if (value === this._mode) return
		this._mode = value
		this.requestRender()
	}

	set gradient(value: boolean) {
		if (value === this._gradient) return
		this._gradient = value
		this.requestRender()
	}

	protected override renderSelf(buffer: OptimizedBuffer): void {
		if (!this.visible || this.isDestroyed) return
		const bg = parseColor("transparent")
		const { start, dirRight, stern, tailEnd } = cometPosition(this._step)
		let c = 0
		while (c < TRACK_COLS) {
			if (c === start) {
				buffer.drawText("🐳", this.screenX + c, this.screenY, this._headFg, bg)
				c += ASSEMBLY // whale spans two display columns
				continue
			}
			const behind = dirRight ? stern - c : c - stern
			const inTail = dirRight ? c < stern && c > tailEnd : c > stern && c < tailEnd
			if (inTail && behind >= 0) {
				if (this._gradient) {
					// identity gradient tail: brand blue at the head fading to
					// purple along the tail (skin contract §1 "彗星")
					const color = parseColor(identityHexAt(Math.min(1, behind / TAIL), this._mode))
					buffer.drawText("█", this.screenX + c, this.screenY, color, bg)
				} else {
					buffer.drawText(cometRampChar(behind), this.screenX + c, this.screenY, this._trackFg, bg)
				}
			} else {
				buffer.drawText("░", this.screenX + c, this.screenY, this._trackFg, bg)
			}
			c += 1
		}
	}
}

extend({ comet_track: CometTrackRenderable })

declare module "@opentui/solid" {
	interface OpenTUIComponents {
		comet_track: typeof CometTrackRenderable
	}
}

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

	// Busy wiring for the shared motion clock: the StatusBar mounts exactly
	// during busy phases, so it doubles as the host's setMotionBusy entry
	// (idle elsewhere drops to the 24fps cap; the contract's v2-entry wiring
	// can move this to the host later).
	createEffect(() => setMotionBusy(props.phase !== null))
	onCleanup(() => setMotionBusy(false))

	// Shared animation clock (contract §2.2: no setInterval, explicit fps).
	// Undefined pauses the clock: invisible (phase null) or tier off.
	const fps = () => (props.phase === null || getMotionTier() === "off" ? undefined : STREAM_FPS)
	onAnimationTick(fps, () => setTick((t) => t + 1))

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

	const label = (): string => {
		const phase = props.phase
		if (phase === null) return ""
		const pool = pools()[phase]
		const verb = pool[Math.floor((tick() * BAR_MS) / VERB_MS) % pool.length]
		const detail = props.detail?.() ?? ""
		return `${PHASE_ICON[phase]} ${verb}... ${props.elapsed()}s${detail ? ` · ${detail}` : ""}`
	}

	return (
		<Show when={props.phase !== null}>
			<box style={{ flexDirection: "row", paddingLeft: 1, paddingRight: 1, height: 1, flexGrow: 0, flexShrink: 0 }}>
				<comet_track
					step={tick()}
					headFg={headFg()}
					trackFg={theme?.border.base ?? FALLBACK_TRACK}
					gradient={motionDecorationsEnabled()}
				/>
				<text style={{ fg: headFg() }} wrapMode="none">
					{` ${label()}`}
				</text>
			</box>
		</Show>
	)
}
