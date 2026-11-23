/**
 * B1 S5/S6 — source-aware panel UI (design 05 §4.2/§4.4/§9 Q1/Q3/Q4).
 * Synthetic documents only: local-file numbers must NEVER surface as host
 * values; host numeric rows block empty commits; maxDepth stays read-only.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { bundledLocalesDir, loadLocales, setLanguages } from "@dsh-opentui/i18n"
import {
	buildHostItems,
	planHostWrite,
	settingsWriteStatus,
	settingsWritable,
} from "../src/routes/session/settings-panel"
import { agentLimitsRows } from "../src/routes/session/agents-panel"
import type { SeamAgentOfficialCaps, SeamSettingsDocument, SeamSettingsRow } from "../src/seams/session"

beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages)
})

function doc(source: SeamSettingsDocument["source"], namespaces: SeamSettingsRow[], reason?: string): SeamSettingsDocument {
	return {
		writable: true,
		hasDocument: true,
		source,
		namespaces,
		...(reason !== undefined ? { sourceDetail: { reason } } : {}),
	}
}

const SUB_ROW: SeamSettingsRow = { ns: "subagent", revision: 3, value: { maxActiveSubagents: 5, maxDepth: 1 } }

describe("B1 S5 — local-file degrade renders n/a, never local numbers", () => {
	test("E4 every host row is n/a + read-only with the sanitized reason", () => {
		const items = buildHostItems(doc("local-file", [SUB_ROW], "host offline TEST_REASON"), true)
		for (const item of items) {
			expect(item.value).toBe("n/a")
			expect(item.editable).toBe(false)
			expect(item.note).toContain("TEST_REASON")
		}
	})

	test("E4 settingsWritable disables the host half in local-file mode", () => {
		const verdict = settingsWritable(doc("local-file", [SUB_ROW], "offline"), undefined, true)
		expect(verdict.local).toBe(true)
		expect(verdict.host).toBe(false)
		expect(verdict.reason).toContain("offline")
	})

	test("E4 unavailable caps render n/a with no local-file numbers", () => {
		const caps: SeamAgentOfficialCaps = { source: "unavailable", reason: "offline" }
		const rows = agentLimitsRows(undefined, caps)
		const active = rows.find((row) => row.key === "maxActiveSubagents")!
		const depth = rows.find((row) => row.key === "maxDepth")!
		expect(active.value).toBe("n/a")
		expect(depth.value).toBe("n/a")
		expect(active.note).toContain("offline")
	})
})

describe("B1 S6 — host numeric rows: empty blocked, maxDepth read-only", () => {
	// Build INSIDE each test: t() needs the beforeAll-loaded locale, and a
	// describe-body fixture would run at collection time before that hook.
	const hostItems = () => buildHostItems(doc("host", [SUB_ROW]), true)
	const active = () => hostItems().find((item) => item.id === "subagent.maxActiveSubagents")!
	const depth = () => hostItems().find((item) => item.id === "subagent.maxDepth")!

	test("E5 empty/whitespace commit is blocked with the inherit-value reason", () => {
		for (const raw of ["", "   "]) {
			const plan = planHostWrite(active(), raw)
			expect(plan.ok).toBe(false)
			if (!plan.ok) expect(plan.error).toContain("falls back to the inherited value")
		}
		// a real number still plans a plain set op (no unset ever)
		const ok = planHostWrite(active(), "5")
		expect(ok.ok).toBe(true)
		if (ok.ok) expect(ok.ops).toEqual([{ op: "set", path: ["maxActiveSubagents"], value: 5 }])
	})

	test("E6 maxDepth is read-only with the pinned reason; maxActive stays editable", () => {
		expect(depth().editable).toBe(false)
		expect(depth().note).toContain("pinned")
		expect(active().editable).toBe(true)
	})

	test("E7 success flash is source-aware (live vs local-file restart)", () => {
		expect(settingsWriteStatus("host", "row")).toContain("applied live")
		const local = settingsWriteStatus("local-file", "row")
		expect(local).toContain("written to the local file")
		expect(local).toContain("restart the host")
	})
})
