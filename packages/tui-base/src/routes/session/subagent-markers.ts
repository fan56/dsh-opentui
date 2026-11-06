/**
 * Subagent hard-stop markers (feature batch F6) — the pure string shapes and
 * the reactive store that carries the policy markers from the session layer
 * (both faces) to the picker/viewer rows. Shapes align with dsh-tui-pi's
 * viewer (`⚡ injected` / `⏻ hard-stopped @N`); the picker row shows the bare
 * `⏻` next to a hard-stopped child. E2E scenario 62 asserts these strings.
 */
import { createSignal } from "solid-js"

/** The marker-bearing subagent row slice (SessionSeam.subagentViews rows). */
export interface SubagentMarkerView {
	id: string
	label: string
	status: "running" | "completed" | "failed" | "cancelled"
	rounds: number
	injectedRound?: number
	hardStopRound?: number
	/** Spin-detected early force-stop round (`⏻!` — dsh-tui-pi parity,
	 * "spin-detected early"; exclusive with the classic hardStopRound). */
	spinStopRound?: number
}

/**
 * The row suffix for one subagent view: ` ⏻ hard-stopped @N` (N = the round
 * the policy force-stopped it at) and/or ` ⚡ injected` (the wrap-up landed —
 * shown even when the child LLM then ignored it). Empty string when neither
 * marker fired.
 */
export function subagentMarkerSuffix(view: Pick<SubagentMarkerView, "injectedRound" | "hardStopRound" | "spinStopRound">): string {
	let suffix = ""
	if (view.spinStopRound !== undefined) {
		// The early variant replaces the classic marker: the stop fired
		// BEFORE the grace window (reference "spin-detected early").
		suffix += ` ⏻! spin-detected early @${view.spinStopRound}`
	} else if (view.hardStopRound !== undefined) {
		suffix += ` ⏻ hard-stopped @${view.hardStopRound}`
	}
	if (view.injectedRound !== undefined) suffix += ` ⚡ injected`
	return suffix
}

/** The bare glyph a picker row shows for a hard-stopped child (`⏻`), or "". */
export function subagentHardStopGlyph(view: Pick<SubagentMarkerView, "hardStopRound" | "spinStopRound">): string {
	if (view.spinStopRound !== undefined) return "⏻!"
	return view.hardStopRound !== undefined ? "⏻" : ""
}

// ---- the store: one module-level snapshot fed by the seam adapters ----
// The vendored picker (SubagentsTab) predates the seam and reads contexts;
// a module-level snapshot lets BOTH session faces (whose adapters forward
// the seam's marker face 1:1) paint the picker without re-plumbing worlds.

const [subagentViews, setSubagentViews] = createSignal<SubagentMarkerView[]>([])

/** Reactive snapshot of the live subagent rows (picker/viewer read side). */
export const subagentMarkerViews = subagentViews

/** The seam-adapter write side: fold one full snapshot in (1:1 rows). */
export function foldSubagentMarkerViews(views: SubagentMarkerView[]): void {
	setSubagentViews(views)
}

/** Look one child's markers up by session id (picker row helper). */
export function subagentMarkersFor(id: string): SubagentMarkerView | undefined {
	return subagentViews().find((v) => v.id === id)
}
