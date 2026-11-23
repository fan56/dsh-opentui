/**
 * 审批卡按钮行 + 正文图例（真机打回后的布局裁决回归）。
 *
 * 真机 80 列英文帧证明：60 列卡内 4 按钮行可用约 54 列，放不下带短句的
 * a/s 标签，连 Reject / Allow 都被拦腰折断。裁决后：
 *   - 按钮回退短词 always / session（键名，en/zh 同值）；
 *   - 大白话语义移到卡片正文图例两行（只在 escalation 授予时出现）；
 *   - 任何语言、80 列下四个按钮都必须完整落在同一行。
 *
 * 挂载生产 ApprovalCard（→ DialogConfirm legacy footer），帧走 captureCharFrame。
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
import { DialogProvider, useDialog } from "../src/ui/dialog"
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

const ZH_HINT_A = "[a] 此工具本会话不再问"
const ZH_HINT_S = "[s] 本会话放行全部写操作"
const EN_HINT_A = "[a] this tool: no more asks this session"
const EN_HINT_S = "[s] all write tools: no more asks this session"

function ApprovalProbe(props: { escalation?: boolean }) {
	const dialog = useDialog()
	onMount(() => {
		dialog.replace(
			() => (
				<ApprovalCard
					name="bash"
					args={{ command: "git status" }}
					escalation={props.escalation}
					onVerdict={() => {}}
				/>
			),
			() => {},
		)
	})
	return <text>base</text>
}

async function mountCard(escalation = true) {
	const setup = await testRender(
		() => (
			<ConfigProvider config={resolve({}, { terminalSuspend: true })}>
				<ThemeProvider mode="dark" source={createThemeSource("")}>
					<Keymap.Provider config={keymapConfig}>
						<ClipboardProvider value={clipboard}>
							<ToastProvider>
								<DialogProvider>
									<ApprovalProbe escalation={escalation} />
								</DialogProvider>
							</ToastProvider>
						</ClipboardProvider>
					</Keymap.Provider>
				</ThemeProvider>
			</ConfigProvider>
		),
		// 真机 80 列：medium dialog 满宽 60 列（maxWidth = terminal-2）。
		{ width: 80, height: 24, exitOnCtrlC: false },
	)
	for (let index = 0; index < 6; index += 1) {
		await new Promise((resolveTick) => setTimeout(resolveTick, 5))
		await setup.renderOnce()
	}
	return setup
}

/** The single legacy-footer row that carries all four buttons. */
function buttonLine(frame: string): string {
	const line = frame.split("\n").find((row) => row.includes("always [a]"))
	expect(line).toBeDefined()
	return line!
}

describe("审批卡：短按钮行 + 正文图例（真机布局裁决）", () => {
	test("i18n：按钮回退短词，图例键双语就位且每行 ≤ 50 显示列", () => {
		const en = locale("en")
		const zh = locale("zh-CN")
		for (const dict of [en, zh]) {
			expect(dict["overlay.ask.allowAlways"]).toBe("always")
			expect(dict["overlay.ask.allowSession"]).toBe("session")
		}
		expect(en["overlay.ask.alwaysHint"]).toBe(EN_HINT_A)
		expect(en["overlay.ask.sessionHint"]).toBe(EN_HINT_S)
		expect(zh["overlay.ask.alwaysHint"]).toBe(ZH_HINT_A)
		expect(zh["overlay.ask.sessionHint"]).toBe(ZH_HINT_S)
		for (const hint of [EN_HINT_A, EN_HINT_S, ZH_HINT_A, ZH_HINT_S]) {
			expect(stringWidth(hint)).toBeLessThanOrEqual(50)
		}
	})

	test("en 80 列：always / session / Reject / Allow 四项完整同一行；图例两行在正文", async () => {
		setLanguage("en")
		const setup = await mountCard()
		try {
			const frame = setup.captureCharFrame()
			const row = buttonLine(frame)
			expect(row).toContain("always [a]")
			expect(row).toContain("session [s]")
			// 真机缺陷形态：Rej / ect 与 All / ow 分两行；这里必须整词同一行。
			expect(row).toContain("Reject")
			expect(row).toContain("Allow")
			expect(frame).toContain(EN_HINT_A)
			expect(frame).toContain(EN_HINT_S)
			// 旧长句按钮标签不得回归。
			expect(frame).not.toContain("this tool, this session")
			expect(frame).not.toContain("all write tools, this session")
		} finally {
			await setup.dispose()
		}
	})

	test("zh 80 列：always / session / 拒绝 / 允许 四项完整同一行；图例两行在正文", async () => {
		setLanguage("zh-CN")
		const setup = await mountCard()
		try {
			const frame = setup.captureCharFrame()
			const row = buttonLine(frame)
			expect(row).toContain("always [a]")
			expect(row).toContain("session [s]")
			expect(row).toContain("拒绝")
			expect(row).toContain("允许")
			expect(frame).toContain(ZH_HINT_A)
			expect(frame).toContain(ZH_HINT_S)
			expect(frame).not.toContain("此工具本会话免问")
			expect(frame).not.toContain("写操作本会话全放行")
		} finally {
			await setup.dispose()
			setLanguage("en")
		}
	})

	test("no escalation: no a/s buttons and no legend lines", async () => {
		setLanguage("en")
		const setup = await mountCard(false)
		try {
			const frame = setup.captureCharFrame()
			expect(frame).not.toContain("always [a]")
			expect(frame).not.toContain(EN_HINT_A)
			expect(frame).not.toContain(EN_HINT_S)
		} finally {
			await setup.dispose()
		}
	})
})
