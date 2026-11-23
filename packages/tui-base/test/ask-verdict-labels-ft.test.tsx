/**
 * 真机审批卡 [a]/[s] 文案折行缺陷的渲染级回归。
 *
 * 真机帧：审批卡按钮行把「写操作」拦腰折行（卡片内宽 60 列）。本测试锁住两件事：
 *   1. i18n 四键的最终文案 + 显示宽度预算（每个标签 ≤ 半个卡宽 = 30 列）；
 *   2. 真实渲染链上两个标签整串出现、不被折成两行。
 *
 * 挂载的是生产 ApprovalCard（→ DialogConfirm 的 legacy footer），不是镜像：
 * 文案走 t() 的已装载 registry，按钮走 dialog.replace，帧走 captureCharFrame。
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { onMount } from "solid-js"
import { testRender } from "@opentui/solid"
import { bundledLocalesDir, loadLocales, setLanguages, setLanguage } from "@dsh-opentui/i18n"
import { ConfigProvider, resolve } from "../src/config"
import { ThemeProvider, createThemeSource } from "../src/context/theme"
import { Keymap } from "../src/context/keymap"
import { ClipboardProvider, type ClipboardService } from "../src/context/clipboard"
import { ToastProvider } from "../src/ui/toast"
import { DialogProvider, dialogWidth, useDialog } from "../src/ui/dialog"
import { ApprovalCard } from "../src/routes/session/turn-overlays"
import { stringWidth } from "../src/util/string-width"

beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages)
})
afterAll(() => setLanguages(new Map()))

type Setup = Awaited<ReturnType<typeof testRender>>
const keymapConfig = { keybinds: { get: () => [] } } as unknown as Parameters<typeof Keymap.Provider>[0]["config"]
const clipboard: ClipboardService = { read: async () => undefined, write: async () => {} }

const locale = (id: "en" | "zh-CN"): Record<string, string> =>
	JSON.parse(readFileSync(new URL(`../../i18n/locales/${id}.json`, import.meta.url), "utf8"))

const ZH_ALWAYS = "此工具本会话免问"
const ZH_SESSION = "写操作本会话全放行"
const EN_ALWAYS = "this tool, this session"
const EN_SESSION = "all write tools, this session"

function ApprovalProbe() {
	const dialog = useDialog()
	onMount(() => {
		dialog.replace(
			() => (
				<ApprovalCard
					name="bash"
					args={{ command: "git status" }}
					escalation
					onVerdict={() => {}}
				/>
			),
			() => {},
		)
	})
	return <text>base</text>
}

async function mountCard() {
	const setup = await testRender(
		() => (
			<ConfigProvider config={resolve({}, { terminalSuspend: true })}>
				<ThemeProvider mode="dark" source={createThemeSource("")}>
					<Keymap.Provider config={keymapConfig}>
						<ClipboardProvider value={clipboard}>
							<ToastProvider>
								<DialogProvider>
									<ApprovalProbe />
								</DialogProvider>
							</ToastProvider>
						</ClipboardProvider>
					</Keymap.Provider>
				</ThemeProvider>
			</ConfigProvider>
		),
		// 80-col terminal → the medium dialog renders at its full 60 columns
		// (maxWidth = terminal-2 would clip it if the terminal were only 60).
		{ width: 80, height: 24, exitOnCtrlC: false },
	)
	for (let index = 0; index < 6; index += 1) {
		await new Promise((resolveTick) => setTimeout(resolveTick, 5))
		await setup.renderOnce()
	}
	return setup
}

describe("审批卡 verdict 文案：值、宽度预算、渲染整串", () => {
	test("i18n 四键是最终短文案，且每个标签显示宽度 ≤ 半个卡宽", () => {
		const en = locale("en")
		const zh = locale("zh-CN")
		expect(en["overlay.ask.allowAlways"]).toBe(EN_ALWAYS)
		expect(en["overlay.ask.allowSession"]).toBe(EN_SESSION)
		expect(zh["overlay.ask.allowAlways"]).toBe(ZH_ALWAYS)
		expect(zh["overlay.ask.allowSession"]).toBe(ZH_SESSION)
		const budget = dialogWidth("medium") / 2 // 60 / 2 = 30
		for (const label of [EN_ALWAYS, EN_SESSION, ZH_ALWAYS, ZH_SESSION]) {
			expect(stringWidth(label)).toBeLessThanOrEqual(budget)
		}
	})

	test("zh 卡：两个新标签整串出现在渲染帧，不再拦腰折行", async () => {
		setLanguage("zh-CN")
		const setup = await mountCard()
		try {
			const frame = setup.captureCharFrame()
			expect(frame).toContain("审批：bash")
			// 真机缺陷是「写操作」被拦腰折成「写操 / 作」。新标签必须整串落在帧里。
			expect(frame).toContain(ZH_ALWAYS)
			expect(frame).toContain(ZH_SESSION)
			expect(frame).toContain("[a]")
			expect(frame).toContain("[s]")
			// 旧长文案必须已退场，避免新旧同帧并存。
			expect(frame).not.toContain("本会话此工具不再问")
			expect(frame).not.toContain("本会话放行全部写操作")
			// 每个标签的显示宽度预算：≤ 半卡宽；此预算与渲染整串共同构成机器判据。
			const budget = dialogWidth("medium") / 2
			expect(stringWidth(ZH_ALWAYS)).toBeLessThanOrEqual(budget)
			expect(stringWidth(ZH_SESSION)).toBeLessThanOrEqual(budget)
		} finally {
			await setup.dispose()
			setLanguage("en")
		}
	})

	test("en 卡：新标签文本 + 键提示出现在渲染帧，旧长文案退场", async () => {
		setLanguage("en")
		const setup = await mountCard()
		try {
			const frame = setup.captureCharFrame()
			// en 标签在 60 列卡里有空格可断点，行内按词折；这里断言词元与键提示都在帧里。
			for (const word of EN_ALWAYS.split(" ")) expect(frame).toContain(word)
			for (const word of EN_SESSION.split(" ")) expect(frame).toContain(word)
			expect(frame).toContain("[a]")
			expect(frame).toContain("[s]")
			expect(frame).not.toContain("always allow this tool")
			expect(frame).not.toContain("allow all write tools")
		} finally {
			await setup.dispose()
		}
	})
})
