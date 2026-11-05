import { describe, expect, test } from "bun:test"
import { TuiKeybind } from "../src/config/keybind"
import { composerKeyBindings, parseStroke, strokesOf } from "../src/routes/session/composer-keybinds"

describe("composer keybinds derive from the vendored keybind config", () => {
	test("defaults: enter submits; shift/ctrl/alt+enter and ctrl+j insert a newline", () => {
		const bindings = composerKeyBindings()
		const submit = bindings.filter((b) => b.action === "submit")
		const newline = bindings.filter((b) => b.action === "newline")
		expect(submit).toEqual([
			{ name: "return", action: "submit" },
			{ name: "kpenter", action: "submit" },
		])
		expect(newline).toContainEqual({ name: "return", shift: true, action: "newline" })
		expect(newline).toContainEqual({ name: "return", ctrl: true, action: "newline" })
		expect(newline).toContainEqual({ name: "return", meta: true, action: "newline" }) // alt+return
		expect(newline).toContainEqual({ name: "kpenter", meta: true, action: "newline" })
		expect(newline).toContainEqual({ name: "j", ctrl: true, action: "newline" })
		// pre-batch-6 literal list is a subset of the derived one (no regression)
		for (const old of [
			{ name: "return", action: "submit" },
			{ name: "kpenter", action: "submit" },
			{ name: "return", meta: true, action: "newline" },
			{ name: "kpenter", meta: true, action: "newline" },
			{ name: "return", shift: true, action: "newline" },
			{ name: "return", ctrl: true, action: "newline" },
			{ name: "j", ctrl: true, action: "newline" },
		]) {
			expect(bindings).toContainEqual(old)
		}
	})

	test("source of truth is TuiKeybind.Definitions", () => {
		expect(TuiKeybind.defaultValue("input.submit")).toBe("return")
		expect(TuiKeybind.defaultValue("input.newline")).toBe("shift+return,ctrl+return,alt+return,ctrl+j")
	})

	test("overrides flow through (config vocabulary)", () => {
		const bindings = composerKeyBindings({ "input.submit": "ctrl+s", "input.newline": "return" })
		expect(bindings).toEqual([
			{ name: "s", ctrl: true, action: "submit" },
			{ name: "return", action: "newline" },
			{ name: "kpenter", action: "newline" },
		])
		expect(composerKeyBindings({ "input.newline": "none" }).some((b) => b.action === "newline")).toBe(false)
		expect(composerKeyBindings({ "input.newline": false }).some((b) => b.action === "newline")).toBe(false)
	})

	test("parsed config values feed the composer (TuiKeybind.parse → composerKeyBindings)", () => {
		const parsed = TuiKeybind.parse({ "input.newline": [{ key: "alt+j" }, { name: "return", shift: true }] })
		expect(composerKeyBindings(parsed)).toContainEqual({ name: "j", meta: true, action: "newline" })
		expect(composerKeyBindings(parsed)).toContainEqual({ name: "return", shift: true, action: "newline" })
	})

	test("TuiKeybind.parse rejects unknown keybind names", () => {
		expect(() => TuiKeybind.parse({ "input.bogus": "x" } as never)).toThrow(/Unrecognized keybind/)
	})

	test("stroke parser: modifiers, leader chords and sequences", () => {
		expect(parseStroke("alt+return")).toEqual({ name: "return", meta: true })
		expect(parseStroke("ctrl+shift+e")).toEqual({ name: "e", ctrl: true, shift: true })
		expect(parseStroke("<leader>e")).toBeUndefined()
		expect(parseStroke("hyperx+e")).toBeUndefined()
		expect(strokesOf("escape,q")).toEqual([{ name: "escape" }, { name: "q" }])
	})
})
