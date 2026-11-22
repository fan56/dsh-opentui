/**
 * 026 web-mirror — hand-written SECOND whitelist for the released
 * `@deepseek-ai/dsh-commands#commands/execute` wire id (the host's registered
 * `/permission <preset>` command runner).
 *
 * DISCIPLINE (AMEND-2 C-1 blind-spot family): the commands/execute result has
 * `jsonSchema:null`, so the static sensitive-key scan is BLIND to undeclared
 * keys. The generator therefore does NOT mark this id PROJECTED_BY_HAND, and
 * the bridge wire default (`sanitizeFrameForWire` + record wrap) would pass a
 * hostile `apiKey`/`token`/`secret` key through. This module is the load-bearing
 * SECOND defence at the seam boundary: only `ok`/`matched`/`text` cross; free
 * text is capped and control-character-stripped; every other key is dropped.
 *
 * Per-id default-projection assumption registered in
 * `.proof/026-web-mirror/00-preregistered-expected.md §1 E5`.
 */
import type { SeamPermissionSwitchResult } from "../../../tui-base/src/seams/session"

const MAX_TEXT = 4096
const MAX_SHORT = 240

function asRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: {}
}

/** The generic wire layer wraps null/primitives as `{ value: ... }`, returns
 *  plain objects directly. Accept BOTH shapes (same helper as directory/goals). */
export function unwrapWireValue(raw: unknown): unknown {
	const rec = asRecord(raw)
	if (Object.prototype.hasOwnProperty.call(rec, "value")) return rec.value
	return raw
}

/** Capped + control-character-stripped free text (single transcript line). */
function cleanText(value: unknown, max = MAX_TEXT): string | undefined {
	if (typeof value !== "string") return undefined
	// Drop C0 + DEL + C1 control characters (keeps printable UTF-8 intact).
	return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, max)
}

/**
 * Project a `commands/execute` reply into the closed seam result.
 * - `undefined` / `{value:undefined}` / `{}` -> matched=false (the host offers
 *   no matching command — web `result.value === undefined` semantics).
 * - an object with `result: {kind,text}` (or flat `kind`/`text`) -> matched=true,
 *   ok=(kind !== "error"), text capped/sanitised. All other keys are dropped.
 */
export function projectPermissionSwitch(raw: unknown): SeamPermissionSwitchResult {
	const value = unwrapWireValue(raw)
	if (value === null || value === undefined) {
		return { ok: false, matched: false, text: "" }
	}
	const rec = asRecord(value)
	const empty = Object.keys(rec).length === 0
	if (empty) return { ok: false, matched: false, text: "" }
	const result = asRecord(rec.result)
	const kind = cleanText(result.kind, MAX_SHORT) ?? cleanText(rec.kind, MAX_SHORT)
	const text = cleanText(result.text, MAX_TEXT) ?? cleanText(rec.text, MAX_TEXT) ?? ""
	// No recognised fields (e.g. a hostile-only record whose keys were all
	// dropped upstream) -> honest unmatched, never a fabricated success.
	if (kind === undefined && text === "") return { ok: false, matched: false, text: "" }
	return { ok: kind !== "error", matched: true, text }
}
