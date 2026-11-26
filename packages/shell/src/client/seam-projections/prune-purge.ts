import type {
	SessionPruneApplyResult,
	SessionPruneRestoreList,
	SessionPruneRestoreResult,
	SessionPurgeCommitResult,
	SessionPurgePrepareResult,
} from "../../../../tui-base/src/seams/session.ts"
import { BridgeProtocolError } from "./bridge-protocol-error.ts"

function asRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {}
}

/** retention P1 — read-only prune plan (dry run). The wire reply is projected
 *  through a whitelist: no host path or extra field leaks past these shapes,
 *  and a malformed reply is a protocol error (never a fake empty plan). */
export interface BridgePrunePlanEntry {
	sessionId: string
	decision: "prune" | "skip"
	reason?: string
	location?: string
	ageDays?: number
}
export interface BridgePrunePlan {
	generatedAt: number
	retentionDays: number
	entries: readonly BridgePrunePlanEntry[]
	counts: { prune: number; skip: number; byReason: Record<string, number> }
	/** Opaque host receipts echoed verbatim by applyPrune (never re-minted). */
	fingerprint?: string
	configFingerprint?: string
}

export function projectBridgePrunePlan(value: unknown): BridgePrunePlan {
	const record = asRecord(value)
	if (!Array.isArray(record.entries)) {
		throw new BridgeProtocolError("INTERNAL", "session.prune.plan returned no entries array")
	}
	const entries: BridgePrunePlanEntry[] = []
	for (const raw of record.entries) {
		const row = asRecord(raw)
		if (typeof row.sessionId !== "string" || (row.decision !== "prune" && row.decision !== "skip")) continue
		const entry: BridgePrunePlanEntry = { sessionId: row.sessionId, decision: row.decision }
		if (typeof row.reason === "string") entry.reason = row.reason
		if (typeof row.location === "string") entry.location = row.location
		if (typeof row.ageDays === "number" && Number.isFinite(row.ageDays)) entry.ageDays = row.ageDays
		entries.push(entry)
	}
	// OLD CRITERION (SUPERSEDED, oldfox P1 CONCERN): a missing generatedAt /
	// retentionDays / counts was filled with 0, and counts were copied from
	// the wire AFTER entries were silently filtered. Both hid protocol and
	// dataflow faults. Missing/invalid required fields now throw a protocol
	// error (never a fake 0), and counts are recomputed from POST-FILTER
	// entries so the plan is always internally consistent.
	if (typeof record.generatedAt !== "number" || !Number.isFinite(record.generatedAt)) {
		throw new BridgeProtocolError("INTERNAL", "session.prune.plan returned no valid generatedAt")
	}
	if (typeof record.retentionDays !== "number" || !Number.isFinite(record.retentionDays)) {
		throw new BridgeProtocolError("INTERNAL", "session.prune.plan returned no valid retentionDays")
	}
	const countsRaw = record.counts
	if (
		countsRaw === null || typeof countsRaw !== "object" || Array.isArray(countsRaw) ||
		typeof (countsRaw as Record<string, unknown>).prune !== "number" ||
		typeof (countsRaw as Record<string, unknown>).skip !== "number" ||
		(countsRaw as Record<string, unknown>).byReason === null ||
		typeof (countsRaw as Record<string, unknown>).byReason !== "object" ||
		Array.isArray((countsRaw as Record<string, unknown>).byReason)
	) {
		throw new BridgeProtocolError("INTERNAL", "session.prune.plan returned no valid counts")
	}
	const byReason: Record<string, number> = {}
	let prune = 0
	let skip = 0
	for (const entry of entries) {
		if (entry.decision === "prune") {
			prune += 1
		} else {
			skip += 1
			const reason = entry.reason ?? "unknown"
			byReason[reason] = (byReason[reason] ?? 0) + 1
		}
	}
	return {
		generatedAt: record.generatedAt,
		retentionDays: record.retentionDays,
		entries,
		counts: { prune, skip, byReason },
		...(typeof record.fingerprint === "string" ? { fingerprint: record.fingerprint } : {}),
		...(typeof record.configFingerprint === "string" ? { configFingerprint: record.configFingerprint } : {}),
	}
}

// ---------------------------------------------------------------------------
// retention P2/P3 — SECOND whitelists for the write-side replies. Every host
// path / journal / manifest field is DROPPED here: the TUI never displays an
// absolute path, and a malformed reply is a protocol error (never a fake OK).
// Transport errors are NOT caught by the seam faces — they propagate as-is.
// ---------------------------------------------------------------------------

export function projectBridgePruneApply(value: unknown): SessionPruneApplyResult {
	const record = asRecord(value)
	if (typeof record.opId !== "string" || record.opId === "") {
		throw new BridgeProtocolError("INTERNAL", "session.prune.apply returned no valid opId")
	}
	if (!Array.isArray(record.applied) || !Array.isArray(record.failed)) {
		throw new BridgeProtocolError("INTERNAL", "session.prune.apply returned no applied/failed arrays")
	}
	const applied: { id: string }[] = []
	for (const raw of record.applied) {
		const row = asRecord(raw)
		if (typeof row.id === "string" && row.id !== "") applied.push({ id: row.id })
	}
	const failed: { id: string; code: string; message: string }[] = []
	for (const raw of record.failed) {
		const row = asRecord(raw)
		if (typeof row.id !== "string" || typeof row.code !== "string" || typeof row.message !== "string") continue
		failed.push({ id: row.id, code: row.code, message: row.message.slice(0, 300) })
	}
	return {
		opId: record.opId,
		applied,
		failed,
		markedOrphans: Array.isArray(record.markedOrphans) ? record.markedOrphans.length : 0,
	}
}

export function projectBridgePurgePrepare(value: unknown): SessionPurgePrepareResult {
	const record = asRecord(value)
	if (typeof record.opId !== "string" || typeof record.token !== "string" || record.token === "") {
		throw new BridgeProtocolError("INTERNAL", "session.prune.purge prepare returned no opId/token")
	}
	if (!Array.isArray(record.candidates) || !Array.isArray(record.rejected)) {
		throw new BridgeProtocolError("INTERNAL", "session.prune.purge prepare returned no candidates/rejected arrays")
	}
	const candidates: Array<SessionPurgePrepareResult["candidates"][number]> = []
	for (const raw of record.candidates) {
		const row = asRecord(raw)
		if (typeof row.id !== "string" || row.id === "") continue
		if (typeof row.ageDays !== "number" || !Number.isFinite(row.ageDays)) continue
		if (typeof row.appliedAt !== "number" || !Number.isFinite(row.appliedAt)) continue
		candidates.push({ id: row.id, ageDays: row.ageDays, appliedAt: row.appliedAt })
	}
	const rejected: Array<SessionPurgePrepareResult["rejected"][number]> = []
	for (const raw of record.rejected) {
		const row = asRecord(raw)
		if (typeof row.code !== "string" || typeof row.message !== "string") continue
		rejected.push({
			...(typeof row.id === "string" ? { id: row.id } : {}),
			code: row.code,
			message: row.message.slice(0, 300),
		})
	}
	return { opId: record.opId, token: record.token, candidates, rejected }
}

export function projectBridgePurgeCommit(value: unknown): SessionPurgeCommitResult {
	const record = asRecord(value)
	if (typeof record.opId !== "string" || record.opId === "") {
		throw new BridgeProtocolError("INTERNAL", "session.prune.purge commit returned no valid opId")
	}
	if (!Array.isArray(record.purged) || !Array.isArray(record.failed)) {
		throw new BridgeProtocolError("INTERNAL", "session.prune.purge commit returned no purged/failed arrays")
	}
	const purged: { id: string }[] = []
	for (const raw of record.purged) {
		const row = asRecord(raw)
		if (typeof row.id === "string" && row.id !== "") purged.push({ id: row.id })
	}
	const failed: Array<SessionPurgeCommitResult["failed"][number]> = []
	for (const raw of record.failed) {
		const row = asRecord(raw)
		if (typeof row.code !== "string" || typeof row.message !== "string") continue
		failed.push({
			...(typeof row.id === "string" ? { id: row.id } : {}),
			code: row.code,
			message: row.message.slice(0, 300),
		})
	}
	return { opId: record.opId, purged, failed }
}

// ---------------------------------------------------------------------------
// retention B4/C7 — SECOND whitelist for the restore replies. Every host path /
// run / manifest / journal field is DROPPED: the TUI sees only id + time +
// optional size, and a malformed reply is a protocol error (never a fake list).
// ---------------------------------------------------------------------------

export function projectBridgePruneRestoreList(value: unknown): SessionPruneRestoreList {
	const record = asRecord(value)
	if (!Array.isArray(record.entries) || !Array.isArray(record.rejected)) {
		throw new BridgeProtocolError("INTERNAL", "session.prune.restore list returned no entries/rejected arrays")
	}
	const entries: SessionPruneRestoreList["entries"][number][] = []
	for (const raw of record.entries) {
		const row = asRecord(raw)
		if (typeof row.id !== "string" || row.id === "") continue
		if (typeof row.movedAt !== "number" || !Number.isFinite(row.movedAt)) continue
		entries.push({
			id: row.id,
			movedAt: row.movedAt,
			...(typeof row.size === "number" && Number.isFinite(row.size) && row.size > 0 ? { size: row.size } : {}),
		})
	}
	const rejected: SessionPruneRestoreList["rejected"][number][] = []
	for (const raw of record.rejected) {
		const row = asRecord(raw)
		if (typeof row.code !== "string" || typeof row.message !== "string") continue
		rejected.push({ code: row.code, message: row.message.slice(0, 300) })
	}
	return { entries, rejected }
}

export function projectBridgePruneRestore(value: unknown): SessionPruneRestoreResult {
	const record = asRecord(value)
	if (typeof record.id !== "string" || record.id === "" || record.restored !== true ||
		typeof record.opId !== "string" || record.opId === "") {
		throw new BridgeProtocolError("INTERNAL", "session.prune.restore returned no valid id/restored/opId")
	}
	return { id: record.id, restored: true, opId: record.opId }
}
