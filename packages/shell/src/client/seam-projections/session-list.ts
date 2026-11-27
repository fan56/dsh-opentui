import type { SeamSessionSummary } from "../../../../tui-base/src/seams/session"

function asRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {}
}

/**
 * `session.list` wire rows → `SeamSessionSummary[]`.
 *
 * Mirrors remote-session-ops.ts:271-305 (retention filter, origin subagent out,
 * title at `projections.values.title` sliced to 40, cwd/sizeBytes/blank
 * pass-through, updatedAt-desc sort, `slice(0, limit)`) and
 * session-seam-adapter.ts:174-184 (RemoteSessionRow → SeamSessionSummary).
 * The seam has no `retentionDays` arm, so the cutoff is off (retentionDays=0).
 */
export function projectBridgeSessionList(items: unknown, limit = 12): SeamSessionSummary[] {
	const rows = Array.isArray(items) ? items : []
	const out: SeamSessionSummary[] = []
	for (const item of rows) {
		const row = asRecord(item)
		// subagent children are not user-resumable (same rule as remote).
		if (row.origin === "subagent") continue
		const id = typeof row.sessionId === "string" ? row.sessionId : ""
		if (!id) continue
		const updatedAt = typeof row.updatedAt === "number" ? String(row.updatedAt) : ""
		const values = asRecord(asRecord(row.projections).values)
		const title = typeof values.title === "string" ? values.title : ""
		out.push({
			id,
			title: title.slice(0, 40),
			...(updatedAt ? { updatedAt } : {}),
			...(typeof row.cwd === "string" && row.cwd ? { cwd: row.cwd } : {}),
			...(typeof row.sizeBytes === "number" && Number.isFinite(row.sizeBytes) ? { sizeBytes: row.sizeBytes } : {}),
			...(typeof row.blank === "boolean" ? { blank: row.blank } : {}),
		})
	}
	return out.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""))).slice(0, limit)
}

/**
 * 026 — `session/list` wire rows -> the current session's working directory.
 * SECOND whitelist: only a non-empty string `cwd` on the row whose `sessionId`
 * equals the bound current session crosses; the row's other fields / a hostile
 * object / an empty string are dropped (undefined = honest absence). The wire
 * is already hand-wired (`session/list`), so this adds NO capability id.
 */
export function projectCurrentCwd(items: unknown, sessionId: string | undefined): string | undefined {
	if (sessionId === undefined || sessionId === "" || !Array.isArray(items)) return undefined
	for (const item of items) {
		const row = asRecord(item)
		if (row.sessionId !== sessionId) continue
		return typeof row.cwd === "string" && row.cwd !== "" ? row.cwd : undefined
	}
	return undefined
}
