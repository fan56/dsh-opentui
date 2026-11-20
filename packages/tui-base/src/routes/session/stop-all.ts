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
	/** Running children successfully interrupted (per-child failures isolated).
	 * On the capability path this counts only `cancel-issued` dispositions. */
	children: number
	/**
	 * 0.23.1 capability path only: the raw per-child dispositions returned by
	 * `stopChildren()` when the bridge advertised `subagents.stopChildren`.
	 * Absent on the legacy roster-walk path. Optional so existing callers
	 * (`commands.ts`, the confirm dialog) keep working unchanged.
	 */
	dispositions?: Array<{ childId: string; disposition: string }>
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

	// 0.23.1 capability path: a bridge that advertises `subagents.stopChildren`
	// stops host-side children in ONE call — it sees children before the client
	// roster fills in (the Stop-moment empty-roster gap). The parent leg above
	// is identical; only the child leg differs. A whole-call failure degrades to
	// "no children stopped" rather than breaking /stop.
	if (seam.hasBridgeCapability?.("subagents.stopChildren") === true && seam.stopChildren) {
		let dispositions: Array<{ childId: string; disposition: string }> = []
		try {
			dispositions = await seam.stopChildren()
		} catch {
			// Bridge call failed entirely — report zero children, keep parent.
		}
		return {
			parent,
			children: dispositions.filter((row) => row.disposition === "cancel-issued").length,
			dispositions,
		}
	}

	// Legacy path (remote seam, old bridges): roster walk + per-child interrupt.
	// Behavior is intentionally byte-for-byte unchanged — the remote seam
	// depends on this isolation (one failure must not strand the rest).
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
