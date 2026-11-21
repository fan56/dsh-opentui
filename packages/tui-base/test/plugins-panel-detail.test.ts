/**
 * 025 W2-2b — /plugins detail view + honest-degrade state (pure functions).
 * The answer-bearing preview extraction is shared with the real-machine gate.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { bundledLocalesDir, loadLocales, setLanguages } from "@dsh-opentui/i18n"
import {
	bundleStateText,
	pluginBundleViews,
	pluginDetailPreview,
	versionExemptionRiskLine,
	writeConfirmConsequence,
	writeConfirmObject,
	writeDryRunLine,
} from "../src/routes/session/plugins-panel.tsx"

// Boot the bundled locale registry so `t()` resolves real copy (not raw keys).
beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages)
})

describe("W2-2b /plugins detail + honest degrade", () => {
	test("pluginDetailPreview: strips markdown headers, joins first 2 content lines, caps", () => {
		const preview = pluginDetailPreview(
			{ status: "found", origin: "readme", path: "/README.md", markdown: "# Title\nW22PONG detail line\nsecond detail line\n" + "x".repeat(500) },
			false,
		)
		expect(preview).toContain("W22PONG detail line")
		expect(preview).toContain("second detail line")
		expect(preview).not.toContain("# Title")
		expect(preview.length).toBeLessThanOrEqual(180)
	})

	test("pluginDetailPreview: loading / none / unavailable / empty markdown states", () => {
		expect(pluginDetailPreview(undefined, true)).toContain("loading")
		expect(pluginDetailPreview({ status: "none" }, false)).toContain("no detail")
		expect(pluginDetailPreview(undefined, false)).toContain("unavailable")
		expect(pluginDetailPreview({ status: "found", origin: "readme", path: "", markdown: "# only a header" }, false)).toContain("no detail")
	})

	test("bundleStateText: stateUnknown never paints a fake on/off", () => {
		const unknown = bundleStateText({ installed: true, optional: false, enabled: false, stateUnknown: true })
		expect(unknown).toContain("unknown")
		expect(unknown).not.toBe("on")
		expect(unknown).not.toBe("off")
		// normal rows keep the original on/off/available semantics
		expect(bundleStateText({ installed: true, optional: false, enabled: true })).toBe("on")
		expect(bundleStateText({ installed: true, optional: false, enabled: false })).toBe("off")
	})

	test("pluginBundleViews: a stateUnknown row is never toggleable", () => {
		const views = pluginBundleViews([
			{ name: "local-plugin", version: "9.9.9", enabled: false, installed: true, optional: false, removable: false, stateUnknown: true },
			{ name: "real-bundle", version: "1", enabled: true, installed: true, optional: false, removable: true },
		])
		const local = views.find((v) => v.name === "local-plugin")!
		const real = views.find((v) => v.name === "real-bundle")!
		expect(local.toggleable).toBe(false)
		expect(local.stateUnknown).toBe(true)
		expect(real.toggleable).toBe(true)
	})
})

// 025-w2-3b — confirm-modal elements + acceptRisk risk wording (pure helpers).
describe("W2-3b write confirm modal helpers", () => {
	test("writeConfirmObject/Consequence: object + consequence are non-empty and distinct per operation", () => {
		const obj = writeConfirmObject("installBundle", "@scope/pkg")
		const cons = writeConfirmConsequence("installBundle")
		expect(obj).toContain("@scope/pkg")
		expect(obj).not.toBe("")
		expect(cons).not.toBe("")
		expect(cons).not.toContain("{") // interpolation resolved
		expect(writeConfirmConsequence("removeBundle")).not.toBe(cons)
	})

	test("versionExemptionRiskLine: risk text ONLY on grant with acceptRisk=true", () => {
		expect(versionExemptionRiskLine(true, true)).toBeTruthy()
		expect(versionExemptionRiskLine(true, true)).toContain("crash")
		expect(versionExemptionRiskLine(true, false)).toBeUndefined()
		expect(versionExemptionRiskLine(false, true)).toBeUndefined()
		expect(versionExemptionRiskLine(false, false)).toBeUndefined()
	})

	test("writeDryRunLine: accepted inspection carries spec; refused carries problem+reason", () => {
		const accepted = writeDryRunLine("update", { status: "accepted", bundle: true, name: "@s/p", version: "2" })
		expect(accepted).toContain("@s/p")
		expect(accepted).toContain("2")
		const refused = writeDryRunLine("remove", { status: "refused", problem: "not-bundle", reason: "no bundle" })
		expect(refused).toContain("not-bundle")
		expect(refused).toContain("no bundle")
	})
})
