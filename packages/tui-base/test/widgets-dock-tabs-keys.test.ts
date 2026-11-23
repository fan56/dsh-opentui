/**
 * R2 activity-panel tabs — REAL key-path test (renderer + keymap + ownership).
 *
 * Unlike widgets-dock-tabs-r2.test.ts (pure state / default-value assertions),
 * this file drives actual ESC+digit bytes through the renderer input parser
 * (`mockInput.pressKey("2", { meta: true })` -> `\x1B2`) into the real keymap
 * dispatch, under the same provider tree the client uses
 * (ConfigProvider -> Keymap.Provider -> InputOwnershipProvider). It asserts the
 * activity tab SIGNAL flips, not just that a default binding string exists.
 *
 * Preregistered expectations: .proof/alt-dock-tabs/00-preregistered-expected.md
 *   D1 ESC+digit parses to meta+digit; D3 alt+2/alt+1 flip the tab signal;
 *   D4 mouse path stays green; F1 frozen surface untouched.
 */
import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { bundledLocalesDir, loadLocales, setLanguages } from "@dsh-opentui/i18n"
import { createComponent, testRender } from "@opentui/solid"
import type { JSX } from "solid-js"
import { ConfigProvider, resolve } from "../src/config"
import { Keymap } from "../src/context/keymap"
import { InputOwnershipProvider, useInputOwnership, type InputOwnership } from "../src/context/input-ownership"
import {
	WidgetsDock,
	activityDockTab,
	resetActivityDockTab,
	selectActivityDockTab,
} from "../src/routes/session/widgets-dock"
import type { SeamRow } from "../src/routes/session/seam-rows"

beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages)
})

afterEach(() => {
	resetActivityDockTab()
})

const WIDTH = 72
const HEIGHT = 60

/** Mount the REAL dock under the client provider tree and hand back a keyed harness. */
async function mountDockWithKeys(rows: () => readonly SeamRow[]) {
	let ownership: InputOwnership | undefined
	function Capture() {
		ownership = useInputOwnership()
		return null
	}
	const setup = await testRender(
		() =>
			createComponent(ConfigProvider, {
				config: resolve({} as Parameters<typeof resolve>[0], { terminalSuspend: true }),
				get children() {
					return createComponent(Keymap.Provider, {
						get children() {
							return createComponent(InputOwnershipProvider, {
								get children() {
									return [
										createComponent(Capture, {}),
										createComponent(WidgetsDock, {
											get rows() {
												return rows()
											},
											turnActive: () => true,
										}),
									] as unknown as JSX.Element
								},
							})
						},
					})
				},
			}),
		{ width: WIDTH, height: HEIGHT, useMouse: false },
	)
	return {
		setup,
		/** Feed an actual ESC+digit byte sequence: meta = alt in the TUI modifier model. */
		pressAltDigit: (digit: "1" | "2") => setup.mockInput.pressKey(digit, { meta: true }),
		titleOf: () => setup.captureSpans().lines[0]?.spans.map((s) => s.text).join("") ?? "",
		get ownership() {
			return ownership
		},
	}
}

describe("D3 — alt+2 / alt+1 flip the activity tab signal through the real key path", () => {
	test("ESC+2 -> todo, ESC+1 -> main (real ESC bytes -> keymap -> signal)", async () => {
		const now = Date.now()
		const rows: SeamRow[] = [
			{
				key: "tool:live:tabkeys",
				kind: "tool",
				name: "todo_write",
				args: JSON.stringify({ todos: [{ content: "write tests", status: "in_progress" }] }),
				status: "done",
				output: "ok",
				startedAt: now,
			} as SeamRow,
		]
		const h = await mountDockWithKeys(() => rows)
		try {
			resetActivityDockTab()
			await h.setup.renderOnce()
			expect(activityDockTab()).toBe("main")

			// Real ESC+2 bytes through renderer input -> parseKeypress -> keymap dispatch.
			h.pressAltDigit("2")
			await h.setup.renderOnce()
			expect(activityDockTab()).toBe("todo")

			// Real ESC+1 bytes flip back.
			h.pressAltDigit("1")
			await h.setup.renderOnce()
			expect(activityDockTab()).toBe("main")
		} finally {
			await h.setup.dispose()
		}
	})

	test("page-owner guard: alt+2 is a no-op while a dialog owns the keyboard", async () => {
		const rows: SeamRow[] = []
		const h = await mountDockWithKeys(() => rows)
		try {
			resetActivityDockTab()
			await h.setup.renderOnce()
			expect(activityDockTab()).toBe("main")

			const frame = h.ownership!.push("dialog")
			h.pressAltDigit("2")
			await h.setup.renderOnce()
			expect(activityDockTab()).toBe("main")

			h.ownership!.pop(frame)
			h.pressAltDigit("2")
			await h.setup.renderOnce()
			expect(activityDockTab()).toBe("todo")
		} finally {
			await h.setup.dispose()
		}
	})
})
