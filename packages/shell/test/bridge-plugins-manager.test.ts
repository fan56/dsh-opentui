/**
 * 025 W2-2b — hand-written plugin-manager read projection (E5 SENTINEL).
 * Every SENTINEL is a fixed synthetic string; no real credential value appears.
 * The assertions are "never in output", not "does not throw".
 */
import { describe, expect, test } from "bun:test"
import {
	projectBundleRows,
	projectCancellation,
	projectChange,
	projectDetail,
	projectInstallProgress,
	projectInspection,
	projectPluginRows,
	projectRegistries,
	projectVersionExemptions,
	projectVersions,
	unwrapWireValue,
} from "../src/client/bridge-plugins-manager.ts"

const SENTINEL = "W22_SENTINEL_synthetic_no_real_credential"

describe("W2-2b plugin-manager read projection — second whitelist (E5)", () => {
	test("unwrapWireValue accepts both wrapped {value} and direct object forms", () => {
		expect(unwrapWireValue({ value: [1, 2] })).toEqual([1, 2])
		const direct = { status: "found" }
		expect(unwrapWireValue(direct)).toBe(direct)
	})

	test("E5 — listBundles: hostile keys + oversized text never cross; whitelist only", () => {
		const hostile = [
			{
				name: "safe-bundle",
				version: "1.2.3",
				description: "ok".repeat(5000),
				enabled: true,
				installed: true,
				optional: false,
				removable: true,
				readOnlyReason: "unmanaged-plugin",
				apiKey: SENTINEL,
				token: SENTINEL,
				secret: SENTINEL,
				password: SENTINEL,
				nested: { access_token: SENTINEL },
			},
			{ name: 42 }, // malformed name row is dropped
		]
		const rows = projectBundleRows({ value: hostile })
		expect(rows).toHaveLength(1)
		const row = rows[0]!
		expect(row).toEqual({
			name: "safe-bundle",
			version: "1.2.3",
			description: "ok".repeat(5000).slice(0, 4096),
			enabled: true,
			installed: true,
			optional: false,
			removable: true,
			readOnlyReason: "unmanaged-plugin",
		})
		const text = JSON.stringify(rows)
		for (const key of ["apiKey", "token", "secret", "password", "access_token", "nested"]) {
			expect(text).not.toContain(key)
		}
		expect(text).not.toContain(SENTINEL)
	})

	test("E5 — readBundleDetail: only status/origin/path/markdown cross; markdown capped", () => {
		const hostile = {
			status: "found",
			origin: "locale",
			path: "/README.md",
			markdown: "W22PONG detail line\n" + "x".repeat(9000),
			apiKey: SENTINEL,
			hostObject: { token: SENTINEL },
		}
		const detail = projectDetail(hostile)
		expect(detail.status).toBe("found")
		if (detail.status !== "found") throw new Error("expected found")
		expect(detail.origin).toBe("locale")
		expect(detail.path).toBe("/README.md")
		expect(detail.markdown.startsWith("W22PONG detail line")).toBe(true)
		expect(detail.markdown.length).toBe(4096)
		const text = JSON.stringify(detail)
		expect(text).not.toContain(SENTINEL)
		expect(text).not.toContain("hostObject")
		expect(text).not.toContain("apiKey")
	})

	test("E5 — listPlugins / registries / versions / exemptions / inspect all whitelist", () => {
		const plugins = projectPluginRows({ value: [{ name: "p", version: "1", apiKey: SENTINEL }] })
		expect(plugins).toEqual([{ name: "p", version: "1" }])
		expect(JSON.stringify(plugins)).not.toContain(SENTINEL)

		const regs = projectRegistries({ registry: "https://r", fallbackRegistries: ["https://f"], resolved: null, apiKey: SENTINEL })
		expect(regs).toEqual({ registry: "https://r", fallbackRegistries: ["https://f"], resolved: null })
		expect(JSON.stringify(regs)).not.toContain(SENTINEL)

		expect(projectVersions({ value: ["1.0", 42, "2.0"] })).toEqual(["1.0", "2.0"])
		const ex = projectVersionExemptions({ exemptions: { "@s/p": ["1.0", 99] }, warnings: ["w"], apiKey: SENTINEL })
		expect(ex).toEqual({ exemptions: { "@s/p": ["1.0"] }, warnings: ["w"] })
		expect(JSON.stringify(ex)).not.toContain(SENTINEL)

		const accepted = projectInspection({ status: "accepted", name: "pkg", version: "2", description: "d", bundle: true, apiKey: SENTINEL })
		expect(accepted).toEqual({ status: "accepted", bundle: true, name: "pkg", version: "2", description: "d" })
		expect(JSON.stringify(accepted)).not.toContain(SENTINEL)
		const refused = projectInspection({ status: "refused", problem: "not-found", reason: "r", apiKey: SENTINEL })
		expect(refused).toEqual({ status: "refused", problem: "not-found", reason: "r" })
	})
})

// 025-w2-3b — write ChangeResult projection (E5 second whitelist).
describe("W2-3b plugin-manager write projection — second whitelist (E5)", () => {
	test("projectChange: only closed enum + bounded target/error/requestId cross; host object keys dropped", () => {
		const raw = {
			changed: true,
			application: "restart-required",
			stage: "install",
			target: "@scope/pkg",
			requestId: "w23-req-1",
			error: { code: "incompatible-version", diagnostic: "needs rc.6", incompatible: [{ name: "x" }] },
			apiKey: "W22_SENTINEL_synthetic", token: "W22_SENTINEL_synthetic",
			packageResult: { nested: "host object must not cross" }, pendingBuilds: ["a"],
		}
		const out = projectChange(raw)
		expect(out).toEqual({
			changed: true,
			application: "restart-required",
			target: "@scope/pkg",
			requestId: "w23-req-1",
			error: "needs rc.6",
		})
		const text = JSON.stringify(out)
		expect(text).not.toContain("W22_SENTINEL_synthetic")
		for (const key of ["apiKey", "token", "packageResult", "pendingBuilds", "incompatible", "stage"]) {
			expect(text).not.toContain(key)
		}
	})

	test("projectChange: hostile application value falls back to failed (never painted success)", () => {
		const out = projectChange({ application: "totally-fine", target: "pkg", changed: true })
		expect(out.application).toBe("failed")
		expect(out.changed).toBe(false)
	})

	test("projectChange: error.code fallback when no diagnostic; string error; wrapped {value} shape", () => {
		expect(projectChange({ value: { application: "cancelled", target: "p", error: { code: "stopped" } } }).error).toBe("stopped")
		expect(projectChange({ application: "failed", target: "p", error: "plain-diagnostic" }).error).toBe("plain-diagnostic")
	})

	test("projectChange: long diagnostic capped; empty target normalised", () => {
		const out = projectChange({ application: "failed", error: { diagnostic: "x".repeat(9000) } })
		expect(out.target).toBe("")
		expect(out.error!.length).toBe(240)
	})
})

// 025-w2-3c — waitForInstall progress + cancelInstall projection (closed states).
describe("W2-3c install progress/cancel projection — second whitelist (E5)", () => {
	test("projectInstallProgress: null (settled/evicted) -> done; ChangeResult by application", () => {
		expect(projectInstallProgress(null, "r1")).toEqual({ state: "done", requestId: "r1" })
		expect(projectInstallProgress({ value: null }, "r1")).toEqual({ state: "done", requestId: "r1" })
		expect(projectInstallProgress({ application: "applied", target: "@s/p" }, "r1")).toEqual({ state: "done", requestId: "r1", target: "@s/p" })
		expect(projectInstallProgress({ application: "restart-required", target: "@s/p" }, "r1").state).toBe("done")
		expect(projectInstallProgress({ application: "cancelled", target: "@s/p" }, "r1")).toEqual({ state: "cancelled", requestId: "r1", target: "@s/p" })
		expect(projectInstallProgress({ application: "failed", target: "@s/p", error: { diagnostic: "boom" } }, "r1")).toEqual({
			state: "failed", requestId: "r1", target: "@s/p", error: "boom",
		})
	})

	test("projectInstallProgress: hostile application/keys -> unknown, no SENTINEL leak", () => {
		const out = projectInstallProgress({
			application: "totally-success", target: "p", apiKey: "W22_SENTINEL_synthetic",
			packageResult: { nested: "x" },
		}, "r1")
		expect(out.state).toBe("unknown")
		const text = JSON.stringify(out)
		expect(text).not.toContain("W22_SENTINEL_synthetic")
		expect(text).not.toContain("apiKey")
		expect(text).not.toContain("packageResult")
	})

	test("projectCancellation: closed enum, hostile -> not-running", () => {
		expect(projectCancellation({ status: "cancelled" })).toEqual({ status: "cancelled" })
		expect(projectCancellation({ status: "too-late" })).toEqual({ status: "too-late" })
		expect(projectCancellation({ status: "not-running" })).toEqual({ status: "not-running" })
		expect(projectCancellation({ status: "totally-cancelled", apiKey: "W22_SENTINEL_synthetic" })).toEqual({ status: "not-running" })
	})
})
