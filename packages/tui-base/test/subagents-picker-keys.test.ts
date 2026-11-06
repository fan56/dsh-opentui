/**
 * The SubagentsPicker Enter-routing contract, exercised against the REAL
 * @opentui/keymap engine (batch D7).
 *
 * The composer's managed-textarea layer (context/keymap.tsx:
 * registerManagedTextareaLayer, priority 0, `input.submit` = return) and the
 * picker's open layer (subagents-picker.tsx, priority 2, inline `return`)
 * both bind Enter while the picker is open and the composer textarea is
 * focused. The engine dispatches layers highest-priority first and only
 * falls through to a lower layer when the higher layer's binding cmd returns
 * FALSE — so the picker's return must consume the key (handled → stop) and
 * the textarea submit must never also fire. These tests pin that ordering;
 * they also pin the inverse: with the picker closed (its layer `enabled:
 * false` — a REAL engine gate, registered by createDefaultOpenTuiKeymap's
 * registerEnabledFields) Enter reaches the textarea submit as usual.
 */
import { describe, expect, test } from "bun:test"
import { Keymap } from "@opentui/keymap"
import { registerDefaultKeys, registerEnabledFields } from "@opentui/keymap/addons"
import { registerManagedTextareaLayer } from "@opentui/keymap/addons/opentui"
import { createTestKeymap } from "@opentui/keymap/testing"

type Harness = ReturnType<typeof createTestKeymap>

/** Compose the two layers exactly as the app does (minus Solid reactivity —
 * the `enabled` accessors are plain functions, which registerEnabledFields
 * accepts). `open` stands in for the picker's `open() && dialog.stack.length
 * === 0` gate. */
function composeLayers(harness: Harness, open: () => boolean, pickerSelect: () => unknown) {
	const { keymap } = harness
	const submitted = { n: 0 }
	const editor = { traits: {}, isDestroyed: false, submit: () => { submitted.n++; return true } }
	const renderer = { isDestroyed: false, currentFocusedEditor: editor, on: () => {}, off: () => {} }

	// context/keymap.tsx: the managed textarea layer, priority unset (0).
	registerManagedTextareaLayer(keymap, renderer as never, {
		enabled: () => true,
		bindings: [{ key: "return", cmd: "input.submit" }],
	})

	// subagents-picker.tsx: the picker's open layer, priority 2. The cmd wraps
	// select() the way Keymap.createLayer's inline wrapper does (run's return
	// value becomes the cmd's return value).
	keymap.registerLayer({
		priority: 2,
		enabled: open,
		bindings: [{ key: "return", cmd: () => pickerSelect() }],
	})

	return submitted
}

describe("subagents picker Enter routing (real keymap engine)", () => {
	test("picker open: Enter consumes at the picker layer; textarea submit never fires", () => {
		const harness = createTestKeymap({ defaultKeys: false })
		const { keymap, host } = harness
		registerDefaultKeys(keymap)
		registerEnabledFields(keymap)

		let pickerRuns = 0
		// select() returns true (the D7 contract: handled → stop).
		const submitted = composeLayers(harness, () => true, () => {
			pickerRuns++
			return true
		})

		host.press("return")
		expect(pickerRuns).toBe(1)
		expect(submitted.n).toBe(0)
	})

	test("picker open with a void select(): STILL consumed (undefined ≠ rejected)", () => {
		const harness = createTestKeymap({ defaultKeys: false })
		const { keymap, host } = harness
		registerDefaultKeys(keymap)
		registerEnabledFields(keymap)

		let pickerRuns = 0
		const submitted = composeLayers(harness, () => true, () => {
			pickerRuns++
			return undefined // the pre-D7 select() shape
		})

		host.press("return")
		expect(pickerRuns).toBe(1)
		expect(submitted.n).toBe(0)
	})

	test("picker closed: Enter reaches the textarea submit (normal send path intact)", () => {
		const harness = createTestKeymap({ defaultKeys: false })
		const { keymap, host } = harness
		registerDefaultKeys(keymap)
		registerEnabledFields(keymap)

		let pickerRuns = 0
		const submitted = composeLayers(
			harness,
			() => false, // picker closed — the layer's enabled gate is false
			() => {
				pickerRuns++
				return true
			},
		)

		host.press("return")
		expect(pickerRuns).toBe(0)
		expect(submitted.n).toBe(1)
	})
})
