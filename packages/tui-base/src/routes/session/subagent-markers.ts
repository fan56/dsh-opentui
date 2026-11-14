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

// ---- the steer slot (batch G2, tui-pi 70-steer parity) ----
// Same bridge shape as the marker snapshot: the seam adapters (both faces)
// register their steerChild here and the vendored SubagentsTab — which
// predates the seam and reads contexts — calls through the module slot.

let steerImpl: ((id: string, text: string) => boolean) | undefined

/** The seam-adapter write side: register the face's steerChild (1:1). */
export function registerSubagentSteer(fn: (id: string, text: string) => boolean): void {
	steerImpl = fn
}

/**
 * Steer one running child through the registered face. Returns undefined
 * when no seam registered a steerChild (steer path dark — the picker's
 * Enter falls back to plain navigation), else the face's boolean outcome.
 */
export function steerSubagent(id: string, text: string): boolean | undefined {
	return steerImpl?.(id, text)
}

/** Whether a face registered a steerChild (the picker's steer hint gate). */
export function subagentSteerWired(): boolean {
	return steerImpl !== undefined
}

// ---- the steer feedback slot (batch D9) ----
// The steer outcome used to ride useToast() — which never paints in the
// rebuilt faces (the unpainted-toast family: 68-resume rejection, 70-steer
// success echo). The transcript print path that DOES paint is the slash
// command feedback row (SlashCommandContext.say → projection.apply, the
// /help print path), but it lives on the page, unreachable from either
// steer component (the picker sits outside the composer; the vendored tab
// predates the seam). Same bridge shape as steerChild above: the pages
// register their say() here and both onConfirm arms print through the slot.

let steerFeedbackImpl: ((line: string) => void) | undefined

/** The page write side: register the transcript print path (the say seam). */
export function registerSubagentSteerFeedback(fn: (line: string) => void): void {
	steerFeedbackImpl = fn
}

/**
 * Print one steer feedback line into the transcript (success echo or
 * rejection). A no-op when no page registered a printer — the previous
 * behavior was also zero feedback (the toast never painted).
 */
export function printSteerFeedback(line: string): void {
	steerFeedbackImpl?.(line)
}

/**
 * Test-only: clear both module slots so isolation-sensitive specs observe a
 * fresh (unwired) bridge. bun test runs every file in one process, so a
 * shell spec that constructed a seam adapter would otherwise leave the
 * steer slot registered for the later tui-base specs. Production never
 * resets — a seam adapter registers once per process and lives forever.
 */
export function resetSubagentSlotsForTests(): void {
	steerImpl = undefined
	steerFeedbackImpl = undefined
}
