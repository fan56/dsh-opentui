/**
 * StatusBar — RETAINED for the transcript `status` slot and its own tests;
 * NOT mounted on the main v2 path any more (the 🐳 comet now rides the LAST
 * page row inside HintsLine, to the left of the key hints). Kept exported so
 * the comet-math tests and any legacy transcript status host still resolve.
 *
 * The busy status LINE was one animated row below/above the composer showing
 * WHAT the agent was doing (verb pool + elapsed seconds + phase icon + tool
 * detail). That whole label is GONE: no `Writing… 12s`, no phase icon, no
 * detail — the code paths that built it were deleted, not hidden. The only
 * busy feedback is the shared comet (./comet-track), painted in ONE
 * deliberate accent colour; a real phase→colour mapping is a separate
 * follow-up (see comet-track.tsx `cometHeadColor`).
 */
import { createSignal, Show, type JSX } from "solid-js"
import { onAnimationTick } from "@opentui/solid"
import { useThemeOptional } from "../../context/theme"
import { motionDecorationsEnabled } from "../../skin/motion"
import { cometFps, cometHeadColor, COMET_FALLBACK_TRACK } from "./comet-track"

// Re-exported so existing comet-math tests keep their import path.
export { cometPosition, cometRampChar, CometTrackRenderable } from "./comet-track"

export type StatusPhase = "think" | "tool" | "stream" | "approve"

/**
 * Legacy shim. `phase !== null` still gates the (now label-less) comet for
 * the transcript status slot; `elapsed` / `detail` / `verbs` are ignored —
 * they used to build the status label that was removed by design.
 */
export function StatusBar(props: {
	/** Non-null = busy (comet shown); null = idle (renders nothing). */
	phase: StatusPhase | null
	/** @deprecated ignored — the busy label (and its Ns timer) was removed. */
	elapsed?: () => number
	/** @deprecated ignored — the busy label (and its detail) was removed. */
	detail?: () => string
	/** @deprecated ignored — the verb pools were removed with the label. */
	verbs?: Partial<Record<StatusPhase, string[]>>
}): JSX.Element {
	const theme = useThemeOptional()
	const [tick, setTick] = createSignal(0)

	// Shared animation clock (contract §2.2: no setInterval, explicit fps).
	// Undefined pauses the clock: idle (phase null) or tier off.
	onAnimationTick(() => cometFps(props.phase !== null), () => setTick((t) => t + 1))

	return (
		<Show when={props.phase !== null}>
			<box style={{ flexDirection: "row", paddingLeft: 1, paddingRight: 1, height: 1, flexGrow: 0, flexShrink: 0 }}>
				<comet_track
					step={tick()}
					headFg={cometHeadColor(theme)}
					trackFg={theme?.border.base ?? COMET_FALLBACK_TRACK}
					gradient={motionDecorationsEnabled()}
				/>
			</box>
		</Show>
	)
}
