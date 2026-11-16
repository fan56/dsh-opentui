/**
 * Stop-everything seam leg shared by the double-Esc confirm dialog
 * (examples/v2-entry.tsx) and the /stop slash command (commands.ts).
 *
 * Cancelling the parent alone leaves independent children running, so every
 * RUNNING child is interrupted too. One child's failure must never strand the
 * rest — each interrupt is isolated and counted separately.
 */
import type { SessionSeam } from "../../seams/session"

export interface StopEverythingResult {
	/** A parent turn was active when stop ran (status().turn !== "idle") — also
	 * the gate for interrupt(): it is sent only when this is true. */
	parent: boolean
	/** Running children successfully interrupted (per-child failures isolated). */
	children: number
}

/**
 * Cancel the main turn (only when one is live), then every running subagent.
 *
 * `seam.interrupt()` maps to the host's `abort()`, which is NOT a no-op while
 * idle: it unsets the session/resume ids, resets the follow stream and ledger,
 * and makes the NEXT send open a FRESH session. Calling it on an idle parent
 * therefore silently drops the current session's context (and misleads the
 * user, who was told "nothing is running"). A children-only stop must skip it.
 * `status()` is optional here so a minimal fake seam degrades to parent=false.
 */
export async function stopEverything(seam: SessionSeam): Promise<StopEverythingResult> {
	const turn = seam.status?.().turn
	const parent = turn !== undefined && turn !== "idle"

	// Parent first — but only when a turn is actually live. Aborting an idle
	// parent would clear its session binding and disconnect the next message.
	if (parent) seam.interrupt()

	let children = 0
	for (const view of seam.subagentViews?.() ?? []) {
		if (view.status !== "running" || !seam.interruptChild) continue
		try {
			await seam.interruptChild(view.id)
			children++
		} catch {
			// A single child failure must not abort the remaining children.
		}
	}
	return { parent, children }
}
