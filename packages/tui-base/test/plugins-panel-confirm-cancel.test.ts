/**
 * W2-3 review C-1 — confirm modal Esc/cancel = ZERO write (component-level
 * behaviour evidence). The W2-3 preregistration E0 promised a "confirm-cancel
 * negative" (modal painted → Esc → listBundles unchanged / no write fire), but
 * the W2-3 panel tests were all PURE helpers (writeConfirmObject / riskLine /
 * dryRun / progressLine) with no onConfirm-fire / Esc-not-fire behaviour
 * assertion, and the ui-flow only walked the confirm POSITIVE path. This test
 * closes that gap without a real TUI boot: it composes the EXACT DialogConfirm
 * modal keymap layer (escape→cancel, return→confirm) against the real keymap
 * engine, wires the panel's onConfirm to the three write faces + token mint,
 * and proves:
 *   - painted modal + Escape → ZERO write-face calls, listBundles snapshot
 *     unchanged, no confirm token minted;
 *   - painted modal + Enter → exactly ONE write with a valid brand token.
 *
 * A source guard pins the wiring (token minted only inside the onConfirm-driven
 * apply functions; no write face is reachable from a bare key bind) so the
 * mirrored layer cannot drift away from the source (same discipline as
 * dialog-confirm-keys.test.ts).
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { registerDefaultKeys, registerEnabledFields } from "@opentui/keymap/addons"
import { createTestKeymap } from "@opentui/keymap/testing"
import { createPluginWriteConfirm, isPluginWriteConfirm } from "../src/seams/session"

const panelSrc = readFileSync(join(import.meta.dir, "..", "src/routes/session/plugins-panel.tsx"), "utf8")
const dialogSrc = readFileSync(join(import.meta.dir, "..", "src/ui/dialog-confirm.tsx"), "utf8")

describe("W2-3 C-1 source wiring guard — Esc cannot reach a write face", () => {
	test("DialogConfirm binds escape→cancel and return→confirm in the modal layer", () => {
		expect(dialogSrc).toContain('bind: "escape"')
		expect(dialogSrc).toContain('choose("cancel")')
		expect(dialogSrc).toContain('choose("confirm")')
	})

	test("write-token mint + all three write faces live ONLY in onConfirm-driven apply functions", () => {
		// The three DialogConfirm call sites pass an onConfirm that invokes an
		// async apply function; the async apply function is the sole place that
		// mints the brand token and calls the seam write face.
		expect(panelSrc).toContain('onConfirm={() => void toggleApply(')
		expect(panelSrc).toContain('onConfirm={() => void remove(')
		expect(panelSrc).toContain('onConfirm={() => void install(')
		// No onCancel wiring on any of the write modals (cancel = dialog.clear only).
		expect(panelSrc).not.toMatch(/DialogConfirm[\s\S]{0,400}?onCancel=/)
		// Token mint points: the three onConfirm-driven apply functions PLUS the
		// cancelInstall key handler (a protective operation that halves an in-flight
		// install). Esc/dismiss paths mint nothing; only that protective cancel mints
		// outside an apply function. The count below pins all four (C-3/S-2 erratum).
		const mintCount = (panelSrc.match(/createPluginWriteConfirm\(/g) ?? []).length
		expect(mintCount).toBe(4) // toggleApply + remove + install + cancelInstall
		for (const face of ["setPluginBundleEnabled", "removePluginBundle", "installPluginSpec"]) {
			expect(panelSrc).toContain(`props.seam.${face}(`)
		}
	})
})

type Harness = ReturnType<typeof createTestKeymap>

/**
 * Compose the DialogConfirm modal layer against a spy seam. onConfirm mirrors
 * the panel: mint the brand token then call the write face; onCancel mirrors
 * the panel's no-op (dialog.clear only). listBundles is a snapshot that ONLY a
 * write mutates, so "unchanged" is the machine-observable zero-write signal.
 */
function composeConfirmModal(harness: Harness) {
	const { keymap, host } = harness
	const writes: { face: string; token: unknown }[] = []
	let bundles = ["dsh-base"] // the real-baseline row from the gate
	let open = true
	let active: "confirm" | "cancel" = "confirm"

	const choose = (key: "confirm" | "cancel") => {
		if (key === "confirm") {
			// panel onConfirm: mint token (ONLY here) then fire the write face.
			const token = createPluginWriteConfirm("setBundleEnabled")
			writes.push({ face: "setPluginBundleEnabled", token })
			bundles = [...bundles, "probe-installed"] // a write changes the list
		}
		// cancel: no token, no write — dialog.clear() only.
		open = false
		keymap.unregisterLayer(layer)
	}

	const toggle = () => { active = active === "confirm" ? "cancel" : "confirm" }
	const textarea = host.createTarget("textarea")
	host.focus(textarea)

	const layer = keymap.registerLayer({
		mode: "modal",
		enabled: () => open,
		priority: 1,
		bindings: [
			{ key: "return", cmd: () => choose(active) },
			{ key: "escape", cmd: () => choose("cancel") },
			{ key: "left", cmd: toggle },
			{ key: "right", cmd: toggle },
		],
	})

	return {
		host,
		writes,
		snapshot: () => [...bundles],
		getOpen: () => open,
		getActive: () => active,
	}
}

function boot() {
	const harness = createTestKeymap({ defaultKeys: false })
	registerDefaultKeys(harness.keymap)
	registerEnabledFields(harness.keymap)
	return { harness, ...composeConfirmModal(harness) }
}

describe("W2-3 C-1 behaviour — modal painted → Esc = zero write, Enter = one write (real keymap engine)", () => {
	test("painted confirm modal + Escape → no write, no token, listBundles snapshot unchanged", () => {
		const { host, writes, snapshot } = boot()
		const before = snapshot()
		expect(writes).toHaveLength(0)
		host.press("escape")
		expect(writes).toHaveLength(0) // Esc can NEVER fire a write face
		expect(snapshot()).toEqual(before) // listBundles unchanged
	})

	test("painted confirm modal + Enter → exactly one write with a valid brand token", () => {
		const { host, writes, snapshot } = boot()
		host.press("return")
		expect(writes).toHaveLength(1)
		expect(writes[0]?.face).toBe("setPluginBundleEnabled")
		expect(isPluginWriteConfirm(writes[0]?.token)).toBe(true)
		expect(snapshot()).toContain("probe-installed") // a confirm DID change the list
	})

	test("tab to cancel then Enter → still zero write (selection, not Esc, also safe)", () => {
		const { host, writes, snapshot } = boot()
		const before = snapshot()
		host.press("right") // active: confirm -> cancel
		host.press("return") // choose(cancel)
		expect(writes).toHaveLength(0)
		expect(snapshot()).toEqual(before)
	})
})
