/**
 * The DialogConfirm legacy-variant selection-key contract, exercised against
 * the REAL @opentui/keymap engine (mirrors the layer composition of
 * dialog-confirm.tsx exactly, minus Solid reactivity — the same approach as
 * dialog-prompt-keys.test.ts).
 *
 * FB fix under test: the legacy variant binds tab/shift+tab in the SAME
 * modal layer as ←/→. Before the fix Tab was not bound in the modal layer,
 * fell through to the page's base layer (page focus moved, the dialog's
 * active button did not) — the on-device "Tab does nothing" symptom.
 *
 * Pinned behavior:
 *   - the default active is "confirm" (tui-pi parity: stop-dialog preselects
 *     STOP on purpose; Enter with no selection must confirm);
 *   - tab / shift+tab / ← / → toggle confirm↔cancel, and Enter follows the
 *     toggled active (tab then Enter cancels);
 *   - while the modal layer is up, Tab never leaks to the base layer.
 *
 * The mirrored layer cannot fail when the source loses a binding, so a
 * wiring guard below reads the source and pins the tab/shift+tab bindings
 * (same granularity as the turn-cancel wiring source guards).
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { registerDefaultKeys, registerEnabledFields } from "@opentui/keymap/addons"
import { createTestKeymap } from "@opentui/keymap/testing"

const src = (file: string) => readFileSync(join(import.meta.dir, "..", file), "utf8")

describe("dialog-confirm legacy tab wiring source guards", () => {
	test("legacy variant binds tab and shift+tab in the modal layer, default active stays confirm", () => {
		const source = src("src/ui/dialog-confirm.tsx")
		expect(source).toContain('bind: "tab"')
		expect(source).toContain('bind: "shift+tab"')
		// tui-pi parity: the preselected button is confirm (stop-dialog.ts
		// selected:0 = STOP preselect is intentional; do not "fix" this).
		expect(source).toContain('active: "confirm" as "confirm" | "cancel"')
	})
})

const MODE_KEY = "opencode.mode"

type Harness = ReturnType<typeof createTestKeymap>

/** Compose the DialogConfirm legacy selection layer exactly as the component
 *  does: one modal layer with return/left/right/tab/shift+tab, over a base
 *  layer that also wants tab (the page focus move the leak used to hit). */
function composeDialogConfirmLayers(harness: Harness) {
	const { keymap, host } = harness
	const counts = { confirm: 0, cancel: 0, baseTab: 0 }
	let active: "confirm" | "cancel" = "confirm"
	let open = true

	const toggle = () => {
		active = active === "confirm" ? "cancel" : "confirm"
	}
	const choose = (key: "confirm" | "cancel") => {
		counts[key] += 1
		open = false // dialog.clear(): the modal layer goes away with it
		keymap.unregisterLayer(base)
	}

	const textarea = host.createTarget("textarea")
	host.focus(textarea)

	keymap.registerLayerFields({
		mode(value: string, context: { require: (key: string, value: string) => void }) {
			context.require(MODE_KEY, value)
		},
	})
	keymap.setData(MODE_KEY, "modal")

	// dialog-confirm.tsx legacy branch (newDesigns off): inline binds.
	keymap.registerLayer({
		mode: "modal",
		enabled: () => open,
		priority: 1,
		bindings: [
			{ key: "return", cmd: () => choose(active) },
			{ key: "left", cmd: toggle },
			{ key: "right", cmd: toggle },
			{ key: "tab", cmd: toggle },
			{ key: "shift+tab", cmd: toggle },
		],
	})

	// The page base layer that owns Tab when no dialog is open.
	const base = keymap.registerLayer({
		enabled: () => true,
		priority: 0,
		bindings: [{ key: "tab", cmd: () => { counts.baseTab += 1 } }],
	})

	return { counts, host, getActive: () => active }
}

function boot() {
	const harness = createTestKeymap({ defaultKeys: false })
	registerDefaultKeys(harness.keymap)
	registerEnabledFields(harness.keymap)
	return { harness, ...composeDialogConfirmLayers(harness) }
}

describe("DialogConfirm legacy selection keys (real keymap engine)", () => {
	test("default Enter confirms — the preselected button stays confirm", () => {
		const { counts, host } = boot()
		host.press("return")
		expect(counts.confirm).toBe(1)
		expect(counts.cancel).toBe(0)
	})

	test("tab toggles to cancel; Enter then cancels instead of confirming", () => {
		const { counts, host } = boot()
		host.press("tab")
		host.press("return")
		expect(counts.cancel).toBe(1)
		expect(counts.confirm).toBe(0)
	})

	test("tab twice cycles back to confirm", () => {
		const { counts, host } = boot()
		host.press("tab")
		host.press("tab")
		host.press("return")
		expect(counts.confirm).toBe(1)
		expect(counts.cancel).toBe(0)
	})

	test("shift+tab toggles in the reverse (same two-option) direction", () => {
		const { counts, host } = boot()
		// The engine parses the "shift+tab" binding into key+modifiers, so the
		// synthetic event must send them separately (press("shift+tab") as a
		// literal key name matches nothing).
		host.press("tab", { shift: true })
		host.press("return")
		expect(counts.cancel).toBe(1)
		expect(counts.confirm).toBe(0)
	})

	test("left/right keep toggling (regression: the pre-existing binding)", () => {
		const { counts, host } = boot()
		host.press("left")
		host.press("return")
		expect(counts.cancel).toBe(1)
		expect(counts.confirm).toBe(0)
	})

	test("while the dialog is open, Tab never leaks to the page's base layer", () => {
		const { counts, host } = boot()
		host.press("tab")
		host.press("tab", { shift: true })
		expect(counts.baseTab).toBe(0)
	})
})
