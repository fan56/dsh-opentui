/**
 * 025 W2-2b — hand-written plugin-manager read projection (E5 SENTINEL).
 * Every SENTINEL is a fixed synthetic string; no real credential value appears.
 * The assertions are "never in output", not "does not throw".
 */
import { describe, expect, test } from "bun:test"
import {
	projectBundleRows,
	projectDetail,
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
