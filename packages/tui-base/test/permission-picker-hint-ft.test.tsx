/**
 * 2a 真机缺陷：/permission picker 的默认档提示不显示。
 *
 * 根因：真机 host entry（examples/v2-entry.tsx 的 pickOne）接收 `headerLine`
 * 第 3 参却从未转发给 DialogSelect（源码注释「v2 does not paint it」），
 * 而 DialogSelect 只有在收到 description/title 时才画提示。修法把提示并入
 * title（pickOne 确实转发 title），headerLine 第 3 参保持不动。
 *
 * 本测试：先跑生产 /permission 命令捕获真实 title，再用真实 DialogSelect
 * 渲染这个 title，断言提示文字出现在 captureCharFrame 里。
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { onMount } from "solid-js"
import { testRender } from "@opentui/solid"
import { bundledLocalesDir, loadLocales, setLanguages, setLanguage } from "@dsh-opentui/i18n"
import { ConfigProvider, resolve } from "../src/config"
import { ThemeProvider, createThemeSource } from "../src/context/theme"
import { Keymap } from "../src/context/keymap"
import { ClipboardProvider, type ClipboardService } from "../src/context/clipboard"
import { ToastProvider } from "../src/ui/toast"
import { DialogProvider, useDialog } from "../src/ui/dialog"
import { DialogSelect } from "../src/ui/dialog-select"
import { coreCommands } from "../src/routes/session/commands"

beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages)
})
afterAll(() => setLanguages(new Map()))

type Setup = Awaited<ReturnType<typeof testRender>>
const keymapConfig = { keybinds: { get: () => [] } } as unknown as Parameters<typeof Keymap.Provider>[0]["config"]
const clipboard: ClipboardService = { read: async () => undefined, write: async () => {} }

/** Run the real `/permission` command; capture the exact pickOne title/headerLine. */
async function capturePicker(lang: "en" | "zh-CN") {
	setLanguage(lang)
	const call: { title?: string; headerLine?: string; currentValue?: string } = {}
	const seam = {
		currentSessionId: () => "s-1",
		stagedSessionId: () => undefined,
		permission: {
			catalog: async () => ({
				options: [
					{ value: "workspace-write", name: "Workspace write", description: "sandboxed" },
					{ value: "danger-full-access", name: "Full access", description: "unrestricted" },
				],
				defaultOptions: [],
				defaultPreset: "workspace-write",
			}),
			switch: async () => ({ ok: true, matched: true, text: "ok" }),
		},
	}
	const ctx = {
		seam,
		say: () => {},
		clear: () => {},
		reload: () => {},
		quit: () => {},
		refreshFooter: () => {},
		invalidateFooter: () => {},
		pickOne: async (title: string, _options: unknown, headerLine?: string, currentValue?: string) => {
			call.title = title
			call.headerLine = headerLine
			call.currentValue = currentValue
			return undefined // cancel: no switch, no risk confirm
		},
	}
	const cmd = coreCommands().find((entry) => entry.name === "/permission")!
	await cmd.run(ctx as any, "")
	return call
}

function PickerProbe(props: { title: string }) {
	const dialog = useDialog()
	onMount(() => {
		dialog.replace(
			() =>
				<DialogSelect<string>
					title={props.title}
					renderFilter={false}
					options={[
						{ title: "Workspace write", value: "workspace-write", description: "sandboxed" },
						{ title: "Full access", value: "danger-full-access", description: "unrestricted" },
					]}
					onSelect={() => {}}
					onCancel={() => {}}
				/>,
			() => {},
		)
	})
	return <text>base</text>
}

async function renderPicker(title: string) {
	const setup = await testRender(
		() => (
			<ConfigProvider config={resolve({}, { terminalSuspend: true })}>
				<ThemeProvider mode="dark" source={createThemeSource("")}>
					<Keymap.Provider config={keymapConfig}>
						<ClipboardProvider value={clipboard}>
							<ToastProvider>
								<DialogProvider>
									<PickerProbe title={title} />
								</DialogProvider>
							</ToastProvider>
						</ClipboardProvider>
					</Keymap.Provider>
				</ThemeProvider>
			</ConfigProvider>
		),
		{ width: 80, height: 24, exitOnCtrlC: false },
	)
	for (let index = 0; index < 6; index += 1) {
		await new Promise((resolveTick) => setTimeout(resolveTick, 5))
		await setup.renderOnce()
	}
	return setup
}

describe("/permission 默认档提示渲染可见（2a）", () => {
	test("en：提示并入 title 且 headerLine 第 3 参仍在；DialogSelect 渲染出 host-side", async () => {
		const call = await capturePicker("en")
		expect(call.title).toContain("Select permission preset")
		expect(call.title).toContain("host-side")
		expect(call.headerLine).toContain("default preset")
		expect(call.currentValue).toBe("workspace-write")
		const setup = await renderPicker(call.title!)
		try {
			expect(setup.captureCharFrame()).toContain("host-side")
		} finally {
			await setup.dispose()
		}
	})

	test("zh：提示并入 title；DialogSelect 渲染出「当前档以宿主为准」", async () => {
		const call = await capturePicker("zh-CN")
		expect(call.title).toContain("选择权限预设")
		expect(call.title).toContain("当前档以宿主为准")
		expect(call.headerLine).toContain("当前档以宿主为准")
		const setup = await renderPicker(call.title!)
		try {
			expect(setup.captureCharFrame()).toContain("当前档以宿主为准")
		} finally {
			await setup.dispose()
			setLanguage("en")
		}
	})
})
