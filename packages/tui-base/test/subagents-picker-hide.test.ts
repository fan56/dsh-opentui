/**
 * Batch D5b hide-law for the Subagents ▸ bar (./subagents-picker.tsx):
 *   - ↓ opens the bar only while a child is RUNNING (else ↓ = history);
 *   - an open bar closes itself once no child runs (no esc needed).
 * The engine test pins the fall-through: with the toggle layer's gate off,
 * ↓ reaches the lower (composer) handler.
 */
import { describe, expect, test } from "bun:test"
import { registerDefaultKeys, registerEnabledFields } from "@opentui/keymap/addons"
import { createTestKeymap } from "@opentui/keymap/testing"
import { pickerShouldAutoClose, pickerToggleEnabled } from "../src/routes/session/subagents-picker"
import type { SubagentMarkerView } from "../src/routes/session/subagent-markers"

const view = (status: SubagentMarkerView["status"]): SubagentMarkerView => ({ id: status, label: "looper", status, rounds: 1 })

describe("subagents bar gates (D5b)", () => {
	test("no children: ↓ does not open; bar closes", () => {
		expect(pickerToggleEnabled([])).toBe(false)
		expect(pickerShouldAutoClose([])).toBe(true)
	})
	test("only finished children: ↓ does not open; open bar closes", () => {
		const views = [view("completed"), view("failed"), view("cancelled")]
		expect(pickerToggleEnabled(views)).toBe(false)
		expect(pickerShouldAutoClose(views)).toBe(true)
	})
	test("a running child: ↓ opens; bar stays", () => {
		const views = [view("completed"), view("running")]
		expect(pickerToggleEnabled(views)).toBe(true)
		expect(pickerShouldAutoClose(views)).toBe(false)
	})
})

describe("↓ routing (real keymap engine)", () => {
	function harness(running: boolean) {
		const h = createTestKeymap({ defaultKeys: false })
		registerDefaultKeys(h.keymap)
		registerEnabledFields(h.keymap)
		const hits = { history: 0, picker: 0 }
		h.keymap.registerLayer({ bindings: [{ key: "down", cmd: () => { hits.history++; return true } }] })
		h.keymap.registerLayer({
			priority: 1,
			enabled: () => pickerToggleEnabled(running ? [view("running")] : [view("completed")]),
			bindings: [{ key: "down", cmd: () => { hits.picker++; return true } }],
		})
		return { ...h, hits }
	}
	test("no running child: ↓ falls through to history", () => {
		const { host, hits } = harness(false)
		host.press("down")
		expect(hits).toEqual({ history: 1, picker: 0 })
	})
	test("running child: ↓ opens the bar", () => {
		const { host, hits } = harness(true)
		host.press("down")
		expect(hits).toEqual({ history: 0, picker: 1 })
	})
})
