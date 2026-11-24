/**
 * P1 — the per-namespace settings value-field whitelists must stay in sync.
 *
 * SCOPE NOTE (reported to the coordinator): this worktree has exactly TWO
 * per-namespace value-field tables — the two CLIENT tables below. The host-side
 * bridge `settings-adapter.ts` has no such table: it projects a fixed
 * namespaceView field set (`NS_FIELDS`), not per-namespace value fields. So a
 * three-way value-field comparison is not expressible here.
 */
import { describe, expect, test } from "bun:test"
import { NS_VALUE_FIELDS } from "../src/client/local-config-faces.ts"
import { SETTINGS_NS_VALUE_FIELDS } from "../src/client/bridge-settings-route.ts"

type Whitelist = Readonly<Record<string, readonly string[]>>

const LEFT = {
	name: "local-config-faces.NS_VALUE_FIELDS",
	table: NS_VALUE_FIELDS as Whitelist,
}
const RIGHT = {
	name: "bridge-settings-route.SETTINGS_NS_VALUE_FIELDS",
	table: SETTINGS_NS_VALUE_FIELDS,
}

/** Namespaces present on exactly one side — named, never a bare boolean. */
function namespaceDiff(a: Whitelist, b: Whitelist, aName: string, bName: string): string[] {
	const out: string[] = []
	for (const ns of Object.keys(a)) {
		if (!(ns in b)) out.push(`namespace "${ns}" is in ${aName} but MISSING in ${bName}`)
	}
	for (const ns of Object.keys(b)) {
		if (!(ns in a)) out.push(`namespace "${ns}" is in ${bName} but MISSING in ${aName}`)
	}
	return out
}

/** Field SET difference for a namespace (order-insensitive, fields reported). */
function fieldDiff(a: Whitelist, b: Whitelist, aName: string, bName: string): string[] {
	const out: string[] = []
	for (const ns of Object.keys(a)) {
		if (!(ns in b)) continue // namespaceDiff reports this
		const aFields = [...(a[ns] ?? [])]
		const bFields = [...(b[ns] ?? [])]
		const aSet = new Set(aFields)
		const bSet = new Set(bFields)
		const missing = aFields.filter((f) => !bSet.has(f))
		const extra = bFields.filter((f) => !aSet.has(f))
		if (missing.length > 0 || extra.length > 0) {
			out.push(
				`namespace "${ns}": ` +
				`${aName}=[${aFields.join(", ")}], ${bName}=[${bFields.join(", ")}]` +
				` — missing in ${bName}: [${missing.join(", ") || "none"}]; ` +
				`extra in ${bName}: [${extra.join(", ") || "none"}]`,
			)
		}
	}
	return out
}

describe("settings whitelist — two client tables stay in sync", () => {
	test("namespace sets are identical (an extra or missing namespace fails)", () => {
		const diff = namespaceDiff(LEFT.table, RIGHT.table, LEFT.name, RIGHT.name)
		expect(diff.join("\n")).toBe("")
	})

	test("each namespace exposes the same field set (order-insensitive, fields reported)", () => {
		const diff = fieldDiff(LEFT.table, RIGHT.table, LEFT.name, RIGHT.name)
		expect(diff.join("\n")).toBe("")
	})
})
