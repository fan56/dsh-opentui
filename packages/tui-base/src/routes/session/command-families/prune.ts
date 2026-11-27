import { t } from "../../../i18n"
import type { SessionPrunePlan, SessionPruneRestoreList, SessionPurgePrepareResult } from "../../../seams/session"

// --------------------------------------------------------- retention UI helpers --
// Pure + table-testable. No absolute path is ever formatted here: the plan's
// `location` is deliberately ignored and only session ids / ages / counts /
// sizes are shown. `stagedIds` is NOT used as a safety gate — apply safety is
// the host's fresh-plan fingerprints and purge safety is its signed token.

/** Machine skip reason → locale key (the backend's closed PruneReason set). */
const PRUNE_REASON_KEYS: Readonly<Record<string, string>> = {
	"retention-disabled": "command.prune.reason.retentionDisabled",
	"field-anomaly": "command.prune.reason.fieldAnomaly",
	current: "command.prune.reason.current",
	staged: "command.prune.reason.staged",
	"agent-available": "command.prune.reason.agentAvailable",
	running: "command.prune.reason.running",
	"missing-time": "command.prune.reason.missingTime",
	"future-time": "command.prune.reason.futureTime",
	"subtree-running": "command.prune.reason.subtreeRunning",
	unknown: "command.prune.reason.unknown",
	"no-location": "command.prune.reason.noLocation",
	"header-mismatch": "command.prune.reason.headerMismatch",
	"basename-mismatch": "command.prune.reason.basenameMismatch",
	"not-directory": "command.prune.reason.notDirectory",
	"escaped-root": "command.prune.reason.escapedRoot",
	"lock-fresh": "command.prune.reason.lockFresh",
	"lock-held": "command.prune.reason.lockHeld",
	"fresh-mtime": "command.prune.reason.freshMtime",
	"blank-grace": "command.prune.reason.blankGrace",
	"within-retention": "command.prune.reason.withinRetention",
}

export function pruneReasonLabel(reason: string): string {
	const key = PRUNE_REASON_KEYS[reason]
	return key === undefined ? t("command.prune.reason.other", { reason }) : t(key)
}

/** Short byte count for the plan summary (no locale grouping, no path). */
export function formatPruneBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
	const units = ["B", "KB", "MB", "GB", "TB"]
	let value = bytes
	let unit = 0
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024
		unit++
	}
	const shown = unit === 0 || value >= 10 ? String(Math.round(value)) : value.toFixed(1)
	return `${shown} ${units[unit]}`
}

/** Sum the prune candidates' on-disk sizes from the already-wired session list. */
export function pruneBytes(
	plan: SessionPrunePlan,
	sizeById: ReadonlyMap<string, number>,
): number {
	let total = 0
	for (const entry of plan.entries) {
		if (entry.decision !== "prune") continue
		const size = sizeById.get(entry.sessionId)
		if (typeof size === "number" && Number.isFinite(size) && size > 0) total += size
	}
	return total
}

/** The transcript rows /prune prints before asking for the typed confirm. */
export function formatPrunePlanRows(
	plan: SessionPrunePlan,
	sizeById: ReadonlyMap<string, number> = new Map(),
): string[] {
	const rows = [
		t("command.prune.summary", {
			count: String(plan.counts.prune),
			skipped: String(plan.counts.skip),
			bytes: formatPruneBytes(pruneBytes(plan, sizeById)),
			days: String(plan.retentionDays),
		}),
	]
	const candidates = plan.entries.filter(
		(entry): entry is typeof entry & { ageDays: number } =>
			entry.decision === "prune" && typeof entry.ageDays === "number" && Number.isFinite(entry.ageDays),
	)
	if (candidates.length > 0) {
		const oldest = candidates.reduce((a, b) => (b.ageDays > a.ageDays ? b : a))
		const newest = candidates.reduce((a, b) => (b.ageDays < a.ageDays ? b : a))
		rows.push(t("command.prune.oldest", { id: oldest.sessionId, days: oldest.ageDays.toFixed(1) }))
		rows.push(t("command.prune.newest", { id: newest.sessionId, days: newest.ageDays.toFixed(1) }))
	}
	const reasons = Object.entries(plan.counts.byReason).sort((a, b) => b[1] - a[1]).slice(0, 5)
	if (reasons.length > 0) {
		rows.push(t("command.prune.skipSummary", {
			list: reasons.map(([reason, count]) => `${pruneReasonLabel(reason)}:${count}`).join(", "),
		}))
	}
	return rows
}

/** The transcript rows /prune-purge prints before asking for the typed confirm. */
export function formatPurgePrepareRows(result: SessionPurgePrepareResult): string[] {
	const rows = [t("command.prunePurge.count", { count: String(result.candidates.length) })]
	for (const candidate of result.candidates) {
		rows.push(t("command.prunePurge.entry", {
			id: candidate.id,
			days: candidate.ageDays.toFixed(1),
		}))
	}
	if (result.rejected.length > 0) {
		rows.push(t("command.prunePurge.rejected", {
			count: String(result.rejected.length),
			codes: [...new Set(result.rejected.map((row) => row.code))].join(", "),
		}))
	}
	return rows
}

/** The transcript rows /prune-restore prints. NO path is formatted here: the
 *  seam projects only id / movedAt / optional size, never a host path. */
export function formatRestoreListRows(list: SessionPruneRestoreList): string[] {
	const rows = [t("command.pruneRestore.count", { count: String(list.entries.length) })]
	for (const entry of list.entries) {
		rows.push(t("command.pruneRestore.entry", {
			id: entry.id,
			movedAt: new Date(entry.movedAt).toISOString(),
			size: entry.size === undefined ? t("command.pruneRestore.unknownSize") : formatPruneBytes(entry.size),
		}))
	}
	if (list.rejected.length > 0) {
		rows.push(t("command.pruneRestore.rejected", {
			count: String(list.rejected.length),
			codes: [...new Set(list.rejected.map((row) => row.code))].join(", "),
		}))
	}
	return rows
}
