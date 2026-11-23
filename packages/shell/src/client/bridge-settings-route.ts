/**
 * B1 S4/S5 — pure, synthetic-testable projection for the seam's host-first
 * settings route (design 05 §4.2 / §4.4). The seam tries the host wire
 * `settings.describe`/`settings.mutate` first; this module:
 *
 * - `projectHostSettingsDocument()` FIELD-LEVEL whitelists a host describe
 *   reply into the same `SeamSettingsDocument` shape the panel consumes. Only
 *   the enumerated value fields cross the seam; other namespaces keep `ns` +
 *   `revision` only; secrets keep `{path,set}` (never a secret value).
 * - `officialCapsFromDocument()` derives /agents caps from that SAME document,
 *   so caps can never disagree with the settings panel or fall back to local
 *   file numbers when the host is unavailable.
 * - failure helpers turn host errors into short sanitized reasons / mutate
 *   results without inventing another host-unavailable error string.
 */

import type {
	SeamAgentOfficialCaps,
	SeamSettingsDocument,
	SeamSettingsMutateResult,
	SeamSettingsRow,
} from "../../../tui-base/src/seams/session"

/** The ONLY value fields allowed per whitelisted namespace (mirrors
 *  local-config-faces.ts NS_VALUE_FIELDS — the two tables must stay in sync). */
const SETTINGS_NS_VALUE_FIELDS: Readonly<Record<string, readonly string[]>> = {
	subagent: ["maxActiveSubagents", "maxDepth"],
	permission: ["defaultPreset", "presets"],
	"session-log-deepseek": ["enabled"],
}

function asRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {}
}

/** A short single-line reason (no stack / no newline / bounded length). */
export function settingsFailureReason(err: unknown): string {
	const message = err instanceof Error ? err.message : String(err)
	return message.replace(/\s+/g, " ").trim().slice(0, 160) || "host settings unavailable"
}

/** Project one host namespace onto a field-level-whitelisted seam row. */
function projectRow(raw: unknown): SeamSettingsRow | undefined {
	const source = asRecord(raw)
	const ns = source.ns
	if (typeof ns !== "string") return undefined
	const revision = typeof source.revision === "number" ? source.revision : undefined
	const fields = SETTINGS_NS_VALUE_FIELDS[ns]
	if (fields === undefined) {
		// Non-whitelisted namespace: ns + revision ONLY — zero value fields.
		return { ns, ...(revision !== undefined ? { revision } : {}) }
	}
	const rawValue = asRecord(source.value)
	const value: Record<string, unknown> = {}
	for (const field of fields) if (field in rawValue) value[field] = rawValue[field]
	// Minimal schema reconstructed from the allow-list (never a host schema
	// subtree, which may carry nodes the /settings whitelist does not consume).
	const schema: Record<string, unknown> = {}
	for (const field of fields) schema[field] = { type: typeof value[field] }
	if (ns === "permission" && typeof value.presets === "object" && value.presets !== null) {
		schema.defaultPreset = { type: "string", enum: Object.keys(value.presets as object) }
	}
	const row: SeamSettingsRow = { ns, value, schema, secrets: [] }
	if (revision !== undefined) row.revision = revision
	for (const layer of ["base", "user"] as const) {
		const rawLayer = asRecord(source[layer])
		const projected: Record<string, unknown> = {}
		for (const field of fields) if (field in rawLayer) projected[field] = rawLayer[field]
		if (Object.keys(projected).length > 0) row[layer] = projected
	}
	if (Array.isArray(source.secrets)) {
		row.secrets = source.secrets.filter((s) => s !== null && typeof s === "object").map((s) => {
			const secret = asRecord(s)
			return {
				path: Array.isArray(secret.path) ? secret.path.map(String) : [],
				set: secret.set === true,
			}
		})
	}
	return row
}

/** Host `settings.describe` wire reply → authoritative field-level-whitelisted document. */
export function projectHostSettingsDocument(raw: unknown): SeamSettingsDocument {
	const root = asRecord(raw)
	const sourceNs = Array.isArray(root.namespaces) ? root.namespaces : []
	const rows = sourceNs.map(projectRow).filter((row): row is SeamSettingsRow => row !== undefined)
	// Keep the "other" zone stable: agent-default-model first (the keyboard-nav
	// invariant LocalSettingsStore.describe already pins).
	const whitelisted = new Set(Object.keys(SETTINGS_NS_VALUE_FIELDS))
	const ordered = rows.sort((a, b) => {
		if (whitelisted.has(a.ns) !== whitelisted.has(b.ns)) return whitelisted.has(a.ns) ? -1 : 1
		if (!whitelisted.has(a.ns) && !whitelisted.has(b.ns)) {
			if (a.ns === "agent-default-model") return -1
			if (b.ns === "agent-default-model") return 1
		}
		return 0
	})
	return {
		writable: root.writable === true,
		hasDocument: root.hasDocument === true,
		namespaces: ordered,
		source: "host",
	}
}

/** /agents official caps from the same settings document. `local-file` (or a
 *  missing document) yields NO numeric fields — the panel renders n/a. */
export function officialCapsFromDocument(document: SeamSettingsDocument | undefined): SeamAgentOfficialCaps {
	if (document === undefined || document.source !== "host") {
		return { source: "unavailable", ...(document?.sourceDetail?.reason ? { reason: document.sourceDetail.reason } : {}) }
	}
	const row = document.namespaces.find((candidate) => candidate.ns === "subagent")
	const value = asRecord(row?.value)
	const caps: SeamAgentOfficialCaps = { source: "host" }
	if (typeof value.maxActiveSubagents === "number" && Number.isFinite(value.maxActiveSubagents)) {
		caps.maxActiveSubagents = value.maxActiveSubagents
	}
	if (typeof value.maxDepth === "number" && Number.isFinite(value.maxDepth)) {
		caps.maxDepth = value.maxDepth
	}
	return caps
}

/** Conflict is a STRUCTURED code/name decision, mirroring the bridge's
 *  `classifySettingsFrameCode` (packages/bridge/src/index.ts) — the two seam
 *  sides must share ONE判定口径. Never a message regex: the host's real
 *  `SettingsConflictError` message deliberately has NO "conflict" word, and an
 *  ordinary error that merely mentions it must NOT be labelled a conflict
 *  (that was the exact N2 trap the bridge side already fixed). */
function isConflictError(err: unknown): boolean {
	const rec = asRecord(err)
	return rec.code === "SETTINGS_CONFLICT" || rec.code === "settings/conflict" || rec.name === "SettingsConflictError"
}

/** A thrown host mutate error → seam mutate result. The bridge always emits a
 *  structured code (`BridgeProtocolError.code`), so conflict is decided by that
 *  code/name only — never by the message text. */
export function hostMutateError(err: unknown): SeamSettingsMutateResult {
	const message = settingsFailureReason(err)
	return { ok: false, conflict: isConflictError(err), error: message }
}

/** Host mutate wire reply → seam mutate result. The bridge arm resolves void
 *  on success (undefined / `{}` reply) and throws on failure, so any non-error
 *  reply counts as success. A `{ok:false, error:{code,message}}` reply and the
 *  flat `{ok:false, code, message}` seam shape are both classified by code/name. */
export function projectHostMutateResult(raw: unknown): SeamSettingsMutateResult {
	const result = asRecord(raw)
	if (result.ok === false) {
		const failure = result.error ?? result.message
		const message = settingsFailureReason(failure)
		return { ok: false, conflict: isConflictError(result) || isConflictError(failure), error: message }
	}
	return { ok: true }
}
