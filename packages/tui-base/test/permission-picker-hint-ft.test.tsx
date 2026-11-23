/**
 * oldfox B: the /permission default-marker hint and the /resume column header
 * are painted through the pickOne `headerLine` → DialogSelect `description`
 * slot (examples/v2-entry.tsx forwards it; DialogSelect renders an explicit
 * description ungated). The title is a PURE title — 98a5341's title-merge is
 * reverted. A 60-col en frame, a /resume header frame and a zh frame pin it.
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
import { resumePickerOptions } from "../src/routes/session/resume-picker"

beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages)
})
afterAll(() => setLanguages(new Map()))

type Setup = Awaited<ReturnType<typeof testRender>>
const keymapConfig = { keybinds: { get: () => [] } } as unknown as Parameters<typeof Keymap.Provider>[0]["config"]
const clipboard: ClipboardService = { read: async () => undefined, write: async () => {} }

/** Run the real command; capture the exact pickOne title/headerLine/currentValue. */
async function capturePick(commandName: string, lang: "en" | "zh-CN") {
	setLanguage(lang)
	const call: { title?: string; headerLine?: string; currentValue?: string } = {}
	const seam = {
		currentSessionId: () => "s-1",
		stagedSessionId: () => undefined,
		listSessions: async () => [
			{ id: "s-1", title: "alpha session", updatedAt: "2026-11-23T05:00:00Z", cwd: "/repo/alpha" },
		],
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
	const cmd = coreCommands().find((entry) => entry.name === commandName)!
	await cmd.run(ctx as any, "")
	return call
}

/** Mirrors pickOne: forwards title AND headerLine → DialogSelect description. */
function PickerProbe(props: { title: string; description?: string }) {
	const dialog = useDialog()
	onMount(() => {
		dialog.replace(
			() => (
				<DialogSelect<string>
					title={props.title}
					description={props.description}
					renderFilter={false}
					options={[
						{ title: "Workspace write", value: "workspace-write", description: "sandboxed" },
						{ title: "Full access", value: "danger-full-access", description: "unrestricted" },
					]}
					onSelect={() => {}}
					onCancel={() => {}}
				/>
			),
			() => {},
		)
	})
	return <text>base</text>
}

async function renderPicker(title: string, description: string | undefined, width = 60) {
	const setup = await testRender(
		() => (
			<ConfigProvider config={resolve({}, { terminalSuspend: true })}>
				<ThemeProvider mode="dark" source={createThemeSource("")}>
					<Keymap.Provider config={keymapConfig}>
						<ClipboardProvider value={clipboard}>
							<ToastProvider>
								<DialogProvider>
									<PickerProbe title={title} description={description} />
								</DialogProvider>
							</ToastProvider>
						</ClipboardProvider>
					</Keymap.Provider>
				</ThemeProvider>
			</ConfigProvider>
		),
		{ width, height: 24, exitOnCtrlC: false },
	)
	for (let index = 0; index < 6; index += 1) {
		await new Promise((resolveTick) => setTimeout(resolveTick, 5))
		await setup.renderOnce()
	}
	return setup
}

describe("/permission 提示走 description 槽，title 为纯标题", () => {
	test("en 60 列：提示在 description 行、title 不含提示、title 不折行", async () => {
		const call = await capturePick("/permission", "en")
		expect(call.title).toBe("Select permission preset")
		expect(call.title).not.toContain("host-side")
		expect(call.headerLine).toContain("default preset")
		expect(call.headerLine).toContain("host-side")
		expect(call.currentValue).toBe("workspace-write")
		const setup = await renderPicker(call.title!, call.headerLine)
		try {
			const frame = setup.captureCharFrame()
			const lines = frame.split("\n")
			// 不折行 = the pure title stays on ONE frame row with no hint folded
			// into it (98a5341's merged title wrapped at 60 cols).
			const titleRows = lines.filter((row) => row.includes("Select permission preset"))
			expect(titleRows).toHaveLength(1)
			expect(titleRows[0]).not.toContain("host-side")
			expect(titleRows[0]).not.toContain("default preset")
			// The whole hint renders in the description block below the title.
			const descriptionLines = lines.filter((row) => row.includes("default preset") || row.includes("host-side"))
			expect(descriptionLines.length).toBeGreaterThan(0)
			expect(frame).toContain("host-side")
		} finally {
			await setup.dispose()
		}
	})

	test("zh：同样 title 纯标题、提示走 description 一帧", async () => {
		const call = await capturePick("/permission", "zh-CN")
		expect(call.title).toBe("选择权限预设")
		expect(call.title).not.toContain("当前档以宿主为准")
		expect(call.headerLine).toContain("当前档以宿主为准")
		const setup = await renderPicker(call.title!, call.headerLine)
		try {
			const frame = setup.captureCharFrame()
			const titleLine = frame.split("\n").find((row) => row.includes("选择权限预设")) ?? ""
			expect(titleLine).not.toContain("当前档以宿主为准")
			expect(frame).toContain("当前档以宿主为准")
		} finally {
			await setup.dispose()
			setLanguage("en")
		}
	})

	test("/resume：列头 UPDATED/DIR/SESSION 走 description 行渲染", async () => {
		const { header } = resumePickerOptions(
			[{ id: "s-1", title: "alpha", updatedAt: "2026-11-23T05:00:00Z", cwd: "/repo/alpha" }],
			Date.parse("2026-11-23T06:00:00Z"),
		)
		expect(header).toContain("UPDATED")
		expect(header).toContain("DIR")
		expect(header).toContain("SESSION")
		const setup = await renderPicker("Resume session", header)
		try {
			const frame = setup.captureCharFrame()
			const descriptionLines = linesWith(frame, "UPDATED")
			expect(descriptionLines.length).toBeGreaterThan(0)
			expect(frame).toContain("DIR")
			expect(frame).toContain("SESSION")
		} finally {
			await setup.dispose()
		}
	})
})

function linesWith(frame: string, needle: string) {
	return frame.split("\n").filter((row) => row.includes(needle))
}
