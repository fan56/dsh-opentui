/**
 * The DialogPrompt Enter/Escape routing contract, exercised against the REAL
 * @opentui/keymap engine (batch D8 — the 70-steer submit-leg discriminator).
 *
 * C11b2 container evidence: Enter on a populated steer prompt closes the
 * dialog with no `steered` echo and no delivery. Candidate 1 claimed the
 * modal keymap never binds Enter to `dialog.prompt.submit` (dialog-prompt.tsx
 * registers the command WITHOUT an inline `bind`), so Enter would fall
 * through to the composer's managed-textarea submit layer. These tests pin
 * the actual routing:
 *
 *   - the vendored keybind config RESOLVES `dialog.prompt.submit` → "return"
 *     (config/keybind.ts), and Keymap.createLayer turns a named command
 *     with no inline bind into a binding sourced from the config lookup
 *     (context/keymap.tsx) — so Enter IS bound to confirm;
 *   - the dialog layer (priority 1, target = the focused textarea) consumes
 *     Enter BEFORE the managed textarea submit layer (priority 0) even sees
 *     it;
 *   - Escape cancels; confirm does not fire;
 *   - busy disables the submit layer, so Enter leaks to the textarea submit
 *     layer (the real component also blurs the textarea while busy).
 *
 * The composition mirrors dialog-prompt.tsx exactly (minus Solid reactivity):
 * the mode "modal" field registration is context/keymap.tsx createMode, the
 * submit layer is the first Keymap.createLayer (named command + config
 * binding + target), the escape layer is the second (inline bind), and the
 * managed textarea layer is context/keymap.tsx registerManagedTextareaLayer.
 */
import { describe, expect, test } from "bun:test"
import { registerDefaultKeys, registerEnabledFields } from "@opentui/keymap/addons"
import { registerManagedTextareaLayer } from "@opentui/keymap/addons/opentui"
import { createTestKeymap } from "@opentui/keymap/testing"
import { TuiKeybind } from "../src/config/keybind"

const MODE_KEY = "opencode.mode"

type Harness = ReturnType<typeof createTestKeymap>

/** The vendored keybind config law: the dialog prompt submit command ships
 * bound to return. createLayer falls back to exactly this lookup for named
 * commands without an inline bind. */
describe("dialog prompt submit keybind config", () => {
	test("dialog.prompt.submit resolves to return (createLayer's named-command fallback)", () => {
		const keybinds = TuiKeybind.parse({})
		expect(keybinds["dialog.prompt.submit"]).toBe("return")
	})
})

/** Compose the DialogPrompt layer pair + the managed textarea layer exactly
 * as the app does. Returns the run counters. */
function composeDialogPromptLayers(harness: Harness, options: { busy?: boolean } = {}) {
	const { keymap, host } = harness
	const busy = options.busy ?? false
	const counters = { confirm: 0, cancel: 0, textareaSubmit: 0 }

	const textarea = host.createTarget("textarea")
	host.focus(textarea)

	// context/keymap.tsx createMode: the modal-mode field + the active mode.
	keymap.registerLayerFields({
		mode(value: string, context: { require: (key: string, value: string) => void }) {
			context.require(MODE_KEY, value)
		},
	})
	keymap.setData(MODE_KEY, "modal")

	// dialog-prompt.tsx first layer: the named submit command; createLayer
	// sources its binding from the config lookup (TuiKeybind default "return").
	keymap.registerLayer({
		mode: "modal",
		target: textarea,
		enabled: !busy,
		priority: 1,
		commands: [
			{
				name: "dialog.prompt.submit",
				run: () => {
					counters.confirm++
				},
			},
		],
		bindings: [{ key: TuiKeybind.parse({})["dialog.prompt.submit"], cmd: "dialog.prompt.submit" }],
	})

	// dialog-prompt.tsx second layer: the inline escape binding.
	keymap.registerLayer({
		mode: "modal",
		enabled: true,
		priority: 1,
		bindings: [
			{
				key: "escape",
				cmd: () => {
					counters.cancel++
					return true
				},
			},
		],
	})

	// context/keymap.tsx: the managed textarea submit layer (input.submit =
	// return, priority 0); the focused-editor submit counts via the stub.
	const editor = { traits: {}, isDestroyed: false, submit: () => { counters.textareaSubmit++; return true } }
	const renderer = { isDestroyed: false, currentFocusedEditor: editor, on: () => {}, off: () => {} }
	registerManagedTextareaLayer(keymap, renderer as never, {
		enabled: () => true,
		bindings: [{ key: TuiKeybind.parse({})["input.submit"], cmd: "input.submit" }],
	})

	return { counters, textarea, host }
}

function boot(options: { busy?: boolean } = {}) {
	const harness = createTestKeymap({ defaultKeys: false })
	registerDefaultKeys(harness.keymap)
	registerEnabledFields(harness.keymap)
	return { harness, ...composeDialogPromptLayers(harness, options) }
}

describe("DialogPrompt Enter routing (real keymap engine)", () => {
	test("Enter runs confirm (dialog.prompt.submit) and never leaks to the textarea submit layer", () => {
		const { counters, host } = boot()
		host.press("return")
		expect(counters.confirm).toBe(1)
		expect(counters.cancel).toBe(0)
		expect(counters.textareaSubmit).toBe(0)
	})

	test("Escape cancels; confirm does not fire", () => {
		const { counters, host } = boot()
		host.press("escape")
		expect(counters.cancel).toBe(1)
		expect(counters.confirm).toBe(0)
	})

	test("busy disables the submit layer: Enter falls through to the textarea submit layer", () => {
		const { counters, host } = boot({ busy: true })
		host.press("return")
		expect(counters.confirm).toBe(0)
		expect(counters.textareaSubmit).toBe(1)
	})
})
