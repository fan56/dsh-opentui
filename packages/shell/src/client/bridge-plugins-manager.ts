/**
 * 025 W2-2b — hand-written seam projection for the seven pluginManager READ
 * ids released into the generic arm in W2-2a (plan §5.2).
 *
 * DISCIPLINE (W2-1 review carry-in #4 / R2): this is a SECOND whitelist, applied
 * on top of the bridge wire sanitizer. No host object, no out-of-scope key and
 * no free text beyond a cap crosses into the seam — a hostile/bloated host
 * reply cannot smuggle `apiKey`/`token`/`secret` or an oversized markdown blob
 * into the TUI. Every function is pure and unit-testable without a live host.
 */
import type {
	PluginRowView,
	SeamPluginBundleRow,
	SeamPluginDetail,
	SeamPluginInspection,
	SeamPluginRegistries,
	SeamVersionExemptions,
} from "../../../tui-base/src/seams/session"

const MAX_TEXT = 4096
const MAX_SHORT = 240

/** Structural record guard (no prototype tricks, no array). */
function asRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: {}
}

/**
 * The generic wire layer wraps arrays/primitives as `{ value: ... }` and
 * returns plain objects directly. Accept BOTH shapes so the seam never depends
 * on that subtlety (and stays correct if the wrap convention changes).
 */
export function unwrapWireValue(raw: unknown): unknown {
	const rec = asRecord(raw)
	if (Object.prototype.hasOwnProperty.call(rec, "value")) return rec.value
	return raw
}

/** Bounded free text — never a host object, never unbounded. */
function text(value: unknown, max = MAX_TEXT): string | undefined {
	return typeof value === "string" ? value.slice(0, max) : undefined
}

function bool(value: unknown): boolean {
	return value === true
}

/** One `listBundles` row -> the封闭 enum whitelist the panel renders. */
export function projectBundleRows(raw: unknown): SeamPluginBundleRow[] {
	const value = unwrapWireValue(raw)
	if (!Array.isArray(value)) return []
	const out: SeamPluginBundleRow[] = []
	for (const entry of value) {
		const row = asRecord(entry)
		const name = text(row.name, MAX_SHORT)
		if (name === undefined || name === "") continue
		const version = text(row.version, MAX_SHORT) ?? ""
		const description = text(row.description)
		const readOnlyReason = text(row.readOnlyReason, MAX_SHORT)
		const errorRaw = row.error
		// `error` may be a host object; only a short diagnostic string crosses.
		const error = typeof errorRaw === "string"
			? errorRaw.slice(0, MAX_SHORT)
			: text(asRecord(errorRaw).message, MAX_SHORT)
		const projected: SeamPluginBundleRow = {
			name,
			version,
			enabled: bool(row.enabled),
			installed: bool(row.installed),
			optional: bool(row.optional),
			removable: bool(row.removable),
		}
		if (description !== undefined) projected.description = description
		if (readOnlyReason !== undefined) projected.readOnlyReason = readOnlyReason
		if (error !== undefined) projected.error = error
		out.push(projected)
	}
	return out
}

/** `listPlugins` rows — name/version only; NO fabricated enabled flag. */
export function projectPluginRows(raw: unknown): PluginRowView[] {
	const value = unwrapWireValue(raw)
	if (!Array.isArray(value)) return []
	const out: PluginRowView[] = []
	for (const entry of value) {
		const row = asRecord(entry)
		const name = text(row.name, MAX_SHORT) ?? text(row.id, MAX_SHORT)
		if (name === undefined || name === "") continue
		out.push({ name, version: text(row.version, MAX_SHORT) ?? "" })
	}
	return out
}

/** One `readBundleDetail` result -> a bounded detail document. */
export function projectDetail(raw: unknown): SeamPluginDetail {
	const value = unwrapWireValue(raw)
	const row = asRecord(value)
	if (row.status === "found") {
		const origin = row.origin === "locale" || row.origin === "readme" ? row.origin : "readme"
		return {
			status: "found",
			origin,
			path: text(row.path, MAX_SHORT) ?? "",
			markdown: text(row.markdown) ?? "",
		}
	}
	return { status: "none" }
}

/** `registries` — URL text is data, never a credential value; all capped. */
export function projectRegistries(raw: unknown): SeamPluginRegistries {
	const row = asRecord(unwrapWireValue(raw))
	const fallback = Array.isArray(row.fallbackRegistries)
		? row.fallbackRegistries.map((v) => text(v, MAX_SHORT) ?? "").filter((v) => v !== "")
		: []
	return {
		registry: text(row.registry, MAX_SHORT) ?? null,
		fallbackRegistries: fallback,
		resolved: text(row.resolved, MAX_SHORT) ?? null,
	}
}

export function projectVersionExemptions(raw: unknown): SeamVersionExemptions {
	const row = asRecord(unwrapWireValue(raw))
	const exemptions: Record<string, string[]> = {}
	const src = asRecord(row.exemptions)
	for (const [key, versions] of Object.entries(src)) {
		exemptions[text(key, MAX_SHORT) ?? ""] = Array.isArray(versions)
			? versions.map((v) => text(v, MAX_SHORT) ?? "").filter((v) => v !== "")
			: []
	}
	const warnings = Array.isArray(row.warnings)
		? row.warnings.map((v) => text(v, MAX_SHORT) ?? "").filter((v) => v !== "")
		: []
	return { exemptions, warnings }
}

/** `inspect` — the install-dialog preview, restricted to the panel's shape. */
export function projectInspection(raw: unknown): SeamPluginInspection {
	const row = asRecord(unwrapWireValue(raw))
	if (row.status === "refused") {
		return {
			status: "refused",
			problem: text(row.problem, MAX_SHORT) ?? "unknown",
			reason: text(row.reason) ?? "",
		}
	}
	const bundle = row.bundle === true ? true : row.bundle === false ? false : null
	const accepted: Extract<SeamPluginInspection, { status: "accepted" }> = { status: "accepted", bundle }
	const name = text(row.name, MAX_SHORT)
	const version = text(row.version, MAX_SHORT)
	const description = text(row.description)
	if (name !== undefined) accepted.name = name
	if (version !== undefined) accepted.version = version
	if (description !== undefined) accepted.description = description
	return accepted
}

/** `listVersions` — a bounded array of version strings. */
export function projectVersions(raw: unknown): string[] {
	const value = unwrapWireValue(raw)
	if (!Array.isArray(value)) return []
	return value.map((v) => text(v, MAX_SHORT) ?? "").filter((v) => v !== "")
}
