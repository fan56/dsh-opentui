/**
 * Batch-close — shell ↔ bridge conflict判定口径统一 (E4).
 *
 * The bridge classifies settings conflicts by STRUCTURED code/name only
 * (classifySettingsFrameCode, packages/bridge/src/index.ts), and its wire error
 * carries that code. This pins the shell seam side to the SAME口径: code/name
 * → conflict:true; a message that merely mentions "conflict" → conflict:false.
 * The old `/conflict/i` fallback went the opposite direction and mislabelled
 * ordinary errors (the exact N2 trap recorded in settings-conflict-classification.test.ts).
 */
import { readFileSync } from "node:fs"
import { describe, expect, test } from "bun:test"
import { hostMutateError, projectHostMutateResult } from "../src/client/bridge-settings-route.ts"

describe("settings conflict: shell display layer mirrors bridge code/name classification", () => {
	test("thrown SETTINGS_CONFLICT code → conflict true (message has no conflict word)", () => {
		const err = Object.assign(new Error("stale revision"), { code: "SETTINGS_CONFLICT" })
		expect(err.message).not.toMatch(/conflict/i)
		expect(hostMutateError(err).conflict).toBe(true)
	})

	test("thrown SettingsConflictError name alone → conflict true", () => {
		const err = Object.assign(new Error("stale revision"), { name: "SettingsConflictError" })
		expect(hostMutateError(err).conflict).toBe(true)
	})

	test("thrown wire code 'settings/conflict' → conflict true", () => {
		expect(hostMutateError(Object.assign(new Error("stale"), { code: "settings/conflict" })).conflict).toBe(true)
	})

	test("message mentions conflict but no code/name → conflict false (bridge: INTERNAL)", () => {
		expect(hostMutateError(new Error("conflict in an unrelated subsystem")).conflict).toBe(false)
		expect(hostMutateError("CONFLICT: generic failure").conflict).toBe(false)
	})

	test("wire reply classified by code/name, not message — both error shapes", () => {
		const nested = projectHostMutateResult({ ok: false, error: { code: "settings/conflict", message: "stale" } })
		expect(nested.conflict).toBe(true)
		const flat = projectHostMutateResult({ ok: false, code: "SETTINGS_CONFLICT", message: "stale" })
		expect(flat.conflict).toBe(true)
		const byName = projectHostMutateResult({ ok: false, error: { name: "SettingsConflictError", message: "stale" } })
		expect(byName.conflict).toBe(true)
		// The old fallback mislabelled this one — now aligned with bridge.
		const messageOnly = projectHostMutateResult({ ok: false, message: "conflict happened" })
		expect(messageOnly.conflict).toBe(false)
		expect(projectHostMutateResult({ ok: true })).toEqual({ ok: true })
	})

	test("shell route source no longer carries the /conflict/i message fallback", () => {
		const src = readFileSync(new URL("../src/client/bridge-settings-route.ts", import.meta.url), "utf8")
		expect(src).not.toContain("/conflict/i")
	})
})
