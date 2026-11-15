/**
 * The /language picker focus contract on the REAL render stack (live-language
 * picker regression, 2026-11-15).
 *
 * Real machine: the picker rows are [en, zh-CN] with the current zh-CN row
 * carrying the `●` marker, but the SELECTION stayed on row 0 (en) —
 * `focusCurrent: false` in the v2-entry pickOne wiring. ↑ from the marked row
 * wrapped AWAY and Enter resolved zh-CN again ("语言未改变" ×2). The fix arms
 * focus-current for this picker, so the selection STARTS on the marked row and
 * ↑ moves OFF it.
 *
 * Mounted through the client provider tree (ConfigProvider → Keymap.Provider →
 * Clipboard/Toast/DialogProvider) with the exact DialogSelect prop shape the
 * fixed pickOne passes for /language, driven with real stdin strokes.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { onMount } from "solid-js"
import { testRender } from "@opentui/solid"
import { createComponent, createSignal, type Accessor } from "solid-js"
import { bundledLocalesDir, loadLocales, setLanguages } from "@dsh-opentui/i18n"
import { DialogSelect, type DialogSelectRef } from "../src/ui/dialog-select"
import { DialogProvider, useDialog } from "../src/ui/dialog"
import { ToastProvider } from "../src/ui/toast"
import { ClipboardProvider, type ClipboardService } from "../src/context/clipboard"
import { ConfigProvider, resolve } from "../src/config"
import { ThemeProvider, createThemeSource } from "../src/context/theme"
import { Keymap } from "../src/context/keymap"

beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages)
})
afterAll(() => setLanguages(new Map()))

const clipboard: ClipboardService = {
	read: async () => undefined,
	write: async () => {},
}

// The /language picker wiring (v2-entry pickOne, post-fix shape): rows over
// the installed ids, the current id marked, focus-current ARMED.
function LanguagePickerProbe(props: { picked: (value: string) => void; ref?: (ref: DialogSelectRef<string>) => void }) {
	const dialog = useDialog()
	onMount(() => {
		dialog.replace(
			() =>
				createComponent(DialogSelect<string>, {
					title: "Select language",
					renderFilter: false,
					options: [
						{ title: "en", value: "en" },
						{ title: "zh-CN", value: "zh-CN" },
					],
					current: "zh-CN",
					focusCurrent: true,
					ref: (r) => props.ref?.(r),
					onSelect: (option: { value: string }) => props.picked(option.value),
					onCancel: () => {},
				}),
			() => {},
		)
	})
	return <text>base</text>
}

/** Flush effects, layout and the deferred stdin parse tick (panelkit norm:
 * sleep THEN renderOnce, several rounds — a bare waitForVisualIdle races the
 * onMount dialog.replace and the post-key selection effect). */
async function settle(setup: Awaited<ReturnType<typeof testRender>>, rounds = 5) {
	for (let index = 0; index < rounds; index += 1) {
		await new Promise((resolveTick) => setTimeout(resolveTick, 20))
		await setup.renderOnce()
	}
}

async function mountPicker() {
	const picked: string[] = []
	const [ref, setRef] = createSignal<DialogSelectRef<string> | undefined>()
	const setup = await testRender(
		() => (
			<ConfigProvider config={resolve({}, { terminalSuspend: true })}>
				<ThemeProvider mode="dark" source={createThemeSource("")}>
					<Keymap.Provider>
						<ClipboardProvider value={clipboard}>
							<ToastProvider>
								<DialogProvider>
									<LanguagePickerProbe picked={(value) => picked.push(value)} ref={setRef} />
								</DialogProvider>
							</ToastProvider>
						</ClipboardProvider>
					</Keymap.Provider>
				</ThemeProvider>
			</ConfigProvider>
		),
		{ width: 80, height: 16 },
	)
	await settle(setup)
	return { setup, picked, ref: ref as Accessor<DialogSelectRef<string> | undefined> }
}

describe("/language picker focus on the real stack (live-lang ↑ regression)", () => {
	test("the picker opens ON the marked current row; ↑ moves off it; Enter commits the moved row", async () => {
		const { setup, picked, ref } = await mountPicker()
		try {
			// focus-current armed: the selection starts on the marked zh-CN row,
			// NOT row 0 — the regression had it silently on en.
			expect(ref()?.selected?.value).toBe("zh-CN")

			// ↑ from the current row moves to en (the only other row).
			setup.mockInput.pressArrow("up")
			await settle(setup)
			expect(ref()?.selected?.value).toBe("en")

			// Enter commits the moved row: the pick is en, not zh-CN.
			setup.mockInput.pressEnter()
			await settle(setup)
			expect(picked).toEqual(["en"])
		} finally {
			await setup.dispose()
		}
	})

	test("bare Enter commits the marked current row (unchanged semantics stay predictable)", async () => {
		const { setup, picked, ref } = await mountPicker()
		try {
			expect(ref()?.selected?.value).toBe("zh-CN")
			setup.mockInput.pressEnter()
			await settle(setup)
			expect(picked).toEqual(["zh-CN"])
		} finally {
			await setup.dispose()
		}
	})
})
