/**
 * /settings on the panel-kit modal stack: the real layer chain, not a stand-in.
 *
 * Mounted through @opentui/solid testRender with the production host wiring
 * (Keymap.Provider → PanelKitProvider + PanelStack → SettingsModalHost), so
 * keys travel the real path: the kit's modal table for Escape/arrows/Enter,
 * the focused input for number/text rows, and the kit's confirm layer for the
 * exit dialog.
 *
 * Semantics under test (instant-save model): choosing a value writes it
 * immediately through the production writers; there is no draft buffer, no
 * 确定 control and no Ctrl+S binding; Esc walks editor → section → 退出设置？
 * confirmation (default focus 取消).
 */
import { beforeEach, describe, expect, test } from "bun:test"
import { onMount } from "solid-js"
import { testRender } from "@opentui/solid"
import {
	FALLBACK_THEME,
	PanelKitProvider,
	PanelStack,
	STATIC_MOTION,
	createHostKeyAdapter,
	resolvePanelChrome,
	usePanels,
	withContrastFloor,
	type PanelStackApi,
} from "@dsh-opentui/panel-kit"
import { Keymap } from "../src/context/keymap"
import { createTuiPanelKeymapHost, projectPanelTheme } from "../src/context/panel-kit-host"
import { contrastRatio, relativeLuminance } from "../src/routes/session/powerline"
import { createComponentTheme } from "../src/theme/component"
import { getDshBlueTheme, parseTheme } from "../src/theme/index"
import { resolveThemeDocument } from "../src/vendor/theme/src/tui/resolve"
import gruvboxJson from "../src/theme/assets/gruvbox.json"
import tokyonightJson from "../src/theme/assets/tokyonight.json"
import {
	GENERAL_ROW_COUNT,
	SETTINGS_SECTIONS,
	SettingsModalHost,
	bodyPageSize,
	buildGeneralRows,
	buildHostRows,
	buildOpentuiRows,
	buildSectionRows,
	settingsBackView,
	settingsPanelRows,
	settingsRowWidth,
	writeSetting,
	type SettingsRowContext,
} from "../src/routes/session/settings-modal"
import {
	openSettingsPanel,
	setSettingsBridge,
	settingsPanelOpen,
	type SettingsThemeFace,
} from "../src/routes/session/settings-panel"
import type { SeamSettingsDocument, SessionSeam } from "../src/seams/session"

const keymapConfig = {
	keybinds: { get: () => [] },
} as unknown as Parameters<typeof Keymap.Provider>[0]["config"]

const document: SeamSettingsDocument = {
	writable: true,
	hasDocument: true,
	namespaces: [
		{ ns: "subagent", revision: 3, value: { maxActiveSubagents: 8, maxDepth: 1 } },
		{ ns: "permission", revision: 2, value: { defaultPreset: "workspaceWrite" } },
		{ ns: "session-log-deepseek", revision: 4, value: { enabled: true } },
		{ ns: "ui-theme", revision: 1, value: { preference: "dark" } },
	],
}

const catalog = {
	defaultPreset: "workspaceWrite",
	defaultOptions: [
		{ value: "readOnly", label: "readOnly" },
		{ value: "workspaceWrite", label: "workspaceWrite" },
		{ value: "fullAccess", label: "fullAccess" },
	],
}

function context(overrides: Partial<SettingsRowContext> = {}): SettingsRowContext {
	return {
		merged: { theme: "dsh-blue", motion: "auto" },
		profile: { themeMode: "dark" },
		workspace: {},
		document,
		catalog,
		themeNames: ["dsh-blue"],
		local: true,
		host: true,
		version: "9.9.9",
		...overrides,
	}
}

interface FakeSeamOptions {
	/** Namespace whose mutate fails (non-conflict). */
	failNs?: string
	configSave?: (patch: Record<string, unknown>) => void
}

function fakeSeam(calls: string[], options: FakeSeamOptions = {}): SessionSeam {
	return {
		configLoad: () => ({ theme: "dsh-blue", motion: "auto" }),
		configRaw: () => ({ themeMode: "dark" }),
		workspaceConfig: () => ({}),
		configSave: (patch: Record<string, unknown>) => {
			calls.push(`configSave:${JSON.stringify(patch)}`)
			options.configSave?.(patch)
		},
		settings: {
			describe: async () => document,
			mutate: async (ns: string, ops: unknown[]) => {
				calls.push(`mutate:${ns}:${JSON.stringify(ops)}`)
				if (options.failNs === ns) return { ok: false, conflict: false, error: "settings/rejected: nope" }
				return { ok: true }
			},
			permissionCatalog: async () => catalog,
		},
	} as unknown as SessionSeam
}

/**
 * Seam backed by a real mutable config bag. `configSave` replaces each
 * top-level key with the patch value exactly like the shell's
 * remote-host-session (a `footerHints` patch carries the WHOLE hint object),
 * so a patch built from a stale snapshot clobbers the earlier write.
 */
function persistingSeam(store: Record<string, unknown>, calls: string[]): SessionSeam {
	return {
		configLoad: () => ({ ...store }),
		configRaw: () => ({ ...store }),
		workspaceConfig: () => ({}),
		configSave: (patch: Record<string, unknown>) => {
			calls.push(`configSave:${JSON.stringify(patch)}`)
			for (const [key, value] of Object.entries(patch)) {
				if (value === undefined) delete store[key]
				else store[key] = value
			}
		},
		settings: {
			describe: async () => document,
			mutate: async (ns: string, ops: unknown[]) => {
				calls.push(`mutate:${ns}:${JSON.stringify(ops)}`)
				return { ok: true }
			},
			permissionCatalog: async () => catalog,
		},
	} as unknown as SessionSeam
}

// ------------------------------------------------------------- harness ----

function StackProbe(props: { onApi: (api: PanelStackApi) => void }) {
	const panels = usePanels()
	onMount(() => props.onApi(panels))
	return null
}

function Harness(props: {
	seam: SessionSeam
	themes?: SettingsThemeFace
	onClosed?: (summary?: string) => void
	/** Command-jump dispatch spy (the big sections' one row). */
	onCommand?: (command: string) => void
	/** Spy for the layer BELOW settings (the session's global pager). */
	onSessionPageDown?: () => void
	onStack?: (api: PanelStackApi) => void
}) {
	const keymap = Keymap.use()
	const keys = createHostKeyAdapter(createTuiPanelKeymapHost(keymap))
	// Stand-in for the session's global `pagedown` binding: it must receive the
	// key whenever the settings layer does not consume it.
	Keymap.createLayer(() => ({
		mode: "global",
		commands: [
			{
				bind: "pagedown",
				title: "test session pager",
				run: () => {
					props.onSessionPageDown?.()
					return true
				},
			},
		],
	}))
	return (
		<PanelKitProvider theme={FALLBACK_THEME} motion={STATIC_MOTION} keys={keys}>
			<PanelStack>
				<SettingsModalHost
					seam={props.seam}
					{...(props.themes !== undefined ? { themes: props.themes } : {})}
					{...(props.onCommand !== undefined ? { onCommand: props.onCommand } : {})}
					{...(props.onClosed !== undefined ? { onClosed: props.onClosed } : {})}
				/>
				{props.onStack !== undefined ? <StackProbe onApi={props.onStack} /> : null}
			</PanelStack>
		</PanelKitProvider>
	)
}

type Setup = Awaited<ReturnType<typeof testRender>>

/** Flush the bridge effect, layout, async describe and the 1 ms focus tick. */
async function settle(setup: Setup, rounds = 5): Promise<void> {
	for (let index = 0; index < rounds; index += 1) {
		await new Promise((resolve) => setTimeout(resolve, 5))
		await setup.renderOnce()
	}
}

/** Poll until `predicate` holds (close goes through the fade driver). */
async function settleUntil(setup: Setup, predicate: () => boolean): Promise<void> {
	for (let index = 0; index < 100; index += 1) {
		await new Promise((resolve) => setTimeout(resolve, 5))
		await setup.renderOnce()
		if (predicate()) return
	}
}

function text(frame: string): string {
	return frame.replace(/\s+/g, " ")
}

async function mount(options: {
	preselect?: string
	calls?: string[]
	seamOptions?: FakeSeamOptions
	seam?: SessionSeam
	themes?: SettingsThemeFace
	onClosed?: (summary?: string) => void
	onCommand?: (command: string) => void
	onSessionPageDown?: () => void
	onStack?: (api: PanelStackApi) => void
	width?: number
	height?: number
}): Promise<{ setup: Setup; calls: string[]; frame: () => string }> {
	const calls = options.calls ?? []
	const seam = options.seam ?? fakeSeam(calls, options.seamOptions ?? {})
	const setup = await testRender(
		() => (
			<Keymap.Provider config={keymapConfig}>
				<Harness
					seam={seam}
					{...(options.themes !== undefined ? { themes: options.themes } : {})}
					{...(options.onCommand !== undefined ? { onCommand: options.onCommand } : {})}
					{...(options.onClosed !== undefined ? { onClosed: options.onClosed } : {})}
					{...(options.onSessionPageDown !== undefined
						? { onSessionPageDown: options.onSessionPageDown }
						: {})}
					{...(options.onStack !== undefined ? { onStack: options.onStack } : {})}
				/>
			</Keymap.Provider>
		),
		{ width: options.width ?? 120, height: options.height ?? 34 },
	)
	await settle(setup)
	openSettingsPanel(options.preselect)
	await settle(setup)
	return { setup, calls, frame: () => text(setup.captureCharFrame()) }
}

beforeEach(() => {
	setSettingsBridge(undefined)
})

// ------------------------------------------------------ frame geometry ----

/** Display cells of a string (CJK/emoji are two), matching the frame grid. */
function cells(value: string): number {
	let width = 0
	for (const ch of value) {
		const cp = ch.codePointAt(0) ?? 0
		const wide =
			(cp >= 0x1100 && cp <= 0x115f) ||
			(cp >= 0x2e80 && cp <= 0xa4cf) ||
			(cp >= 0xac00 && cp <= 0xd7a3) ||
			(cp >= 0xf900 && cp <= 0xfaff) ||
			(cp >= 0xfe30 && cp <= 0xfe4f) ||
			(cp >= 0xff00 && cp <= 0xff60) ||
			(cp >= 0xffe0 && cp <= 0xffe6)
		width += wide ? 2 : 1
	}
	return width
}

/**
 * Labels painted inside the 20-cell nav column: heavy-border cell + 3 panel
 * inset + 1 body inset = border + 5, width NAV_WIDTH (20). Read off the styled
 * frame per cell so a blank column can never be mistaken for content text
 * (the old gate matched the whole frame, and `通用` also names the section
 * title).
 */
function navLabels(setup: Setup): string[] {
	const frame = setup.captureSpans()
	const lines = frame.lines.map((line) => line.spans.map((span) => span.text).join(""))
	const headerIndex = lines.findIndex((line) => line.includes("Settings"))
	if (headerIndex < 0) return []
	let borderCell = -1
	let scan = 0
	for (const span of frame.lines[headerIndex]!.spans) {
		if (borderCell < 0 && span.text.includes("┃")) borderCell = scan + span.text.indexOf("┃")
		scan += span.width
	}
	if (borderCell < 0) return []
	const start = borderCell + 5
	const out: string[] = []
	for (const line of frame.lines) {
		const chars: string[] = []
		let cell = 0
		for (const span of line.spans) {
			let offset = 0
			for (const ch of span.text) {
				if (cell + offset >= start && cell + offset < start + 20) chars.push(ch)
				offset += cells(ch)
			}
			cell += span.width
		}
		const text = chars.join("").replace(/[┃│\s]/g, "")
		if (text.length > 0) out.push(text)
	}
	return out
}

/** Cell run painted with the active-row background on the line holding `needle`. */
function highlightRun(setup: Setup, needle: string): { start: number; end: number } | undefined {
	const frame = setup.captureSpans()
	const activeBg = FALLBACK_THEME.row.activeBg
	for (const line of frame.lines) {
		if (!line.spans.map((span) => span.text).join("").includes(needle)) continue
		let cell = 0
		let start: number | undefined
		let end = -1
		for (const span of line.spans) {
			if (span.bg.equals(activeBg)) {
				if (start === undefined) start = cell
				end = cell + span.width - 1
			}
			cell += span.width
		}
		if (start !== undefined) return { start, end }
	}
	return undefined
}


/** Frame border rows/columns of the painted modal (top/bottom border glyphs). */
function frameEdges(setup: Setup): { top: number; bottom: number; left: number; right: number } {
	const lines = setup.captureCharFrame().split("\n")
	const top = lines.findIndex((line) => line.includes("┏"))
	const bottom = lines.findLastIndex((line) => line.includes("┗"))
	const topLine = lines[top] ?? ""
	return { top, bottom, left: topLine.indexOf("┏"), right: topLine.lastIndexOf("┓") }
}

interface CellSpan {
	cell: number
	width: number
	text: string
	bg: { equals(other: { toInts(): readonly number[] }): boolean; toInts(): readonly number[] }
	fg: { equals(other: { toInts(): readonly number[] }): boolean; toInts(): readonly number[] }
}

/** Captured spans per frame line, with absolute cell offsets. */
function lineSpans(setup: Setup): CellSpan[][] {
	return setup.captureSpans().lines.map((line) => {
		let cell = 0
		return line.spans.map((span) => {
			const entry = { cell, width: span.width, text: span.text, bg: span.bg, fg: span.fg }
			cell += span.width
			return entry
		})
	})
}

/** First span of a line containing `needle`, or undefined. */
function spanOf(setup: Setup, needle: string): CellSpan | undefined {
	for (const line of lineSpans(setup)) {
		for (const span of line) {
			if (span.text.includes(needle)) return span
		}
	}
	return undefined
}

/** True when a line containing `needle` paints `bg` on any of its spans. */
function linePaintsBg(setup: Setup, needle: string, bg: { toInts(): readonly number[] }): boolean {
	const line = lineSpans(setup).find((entry) => entry.map((span) => span.text).join("").includes(needle))
	return line !== undefined && line.some((span) => span.bg.toInts().join() === bg.toInts().join())
}

/** Frame line index containing `needle`, or -1. */
function lineIndexOf(setup: Setup, needle: string): number {
	return setup.captureCharFrame().split("\n").findIndex((line) => line.includes(needle))
}

// ------------------------------------------------------ pure data layer ----

describe("settings modal: section model", () => {
	test("nav has the 7 entries including the Host section (P0-1)", () => {
		expect(SETTINGS_SECTIONS.map((section) => section.id)).toEqual([
			"general",
			"opentui",
			"host",
			"models",
			"plugins",
			"presets",
			"account",
		])
	})

	test("General is exactly 12 rows in web order", () => {
		const rows = buildGeneralRows(context())
		expect(rows).toHaveLength(GENERAL_ROW_COUNT)
		expect(rows.map((row) => row.label)).toEqual([
			"权限默认预设",
			"语言",
			"外观",
			"字号",
			"工作步骤",
			"开发工具",
			"快捷键",
			"链接打开方式",
			"忙碌时 Enter",
			"性能与用量",
			"Session Log 上传",
			"当前版本",
		])
		expect(rows.find((row) => row.id === "general.current-version")?.value).toBe("9.9.9")
	})

	test("N/A rows are not editable and carry a note", () => {
		const rows = buildGeneralRows(context())
		const naIds = [
			"general.font-size",
			"general.transcript-view",
			"general.developer-tools",
			"general.link-opening",
			"general.performance-usage",
		]
		for (const id of naIds) {
			const row = rows.find((entry) => entry.id === id)
			expect(row).toBeDefined()
			expect(row!.editable).toBe(false)
			expect(row!.write).toBeUndefined()
			expect(row!.note).toBeDefined()
		}
		// 工作步骤 stays one top-level row with the three N/A fields beneath.
		const steps = rows.find((row) => row.id === "general.transcript-view")!
		expect(steps.detail).toHaveLength(3)
		expect(steps.detail!.every((entry) => entry.editable === false && entry.value === "N/A")).toBe(true)
	})

	test("busyEnter and shortcuts are read-only explanation rows", () => {
		const rows = buildGeneralRows(context())
		for (const id of ["general.composer-enter", "general.shortcuts", "general.current-version"]) {
			const row = rows.find((entry) => entry.id === id)!
			expect(row.editable).toBe(false)
			expect(row.write).toBeUndefined()
		}
	})

	test("opentui group is 16 rows (hintsLocale lives in General's language row)", () => {
		const rows = buildOpentuiRows(context())
		expect(rows).toHaveLength(16)
		expect(rows.some((row) => row.id === "hintsLocale")).toBe(false)
		expect(rows.some((row) => row.id === "motion")).toBe(true)
		expect(rows.at(-1)?.id).toBe("maxRoundsGrace")
	})

	test("host section carries all four whitelist rows plus describe-only namespaces", () => {
		const rows = buildSectionRows("host", context())
		const ids = rows.map((row) => row.id)
		for (const id of [
			"subagent.maxActiveSubagents",
			"subagent.maxDepth",
			"permission.defaultPreset",
			"session-log-deepseek.enabled",
		]) {
			expect(ids).toContain(id)
		}
		// The two subagent rows are editable numbers (the review's P0-1 gap).
		const depth = rows.find((row) => row.id === "subagent.maxDepth")!
		expect(depth.kind).toBe("number")
		expect(depth.editable).toBe(true)
		expect(buildHostRows(context())).toHaveLength(4)
		// Describe-only namespaces trail the whitelist, read-only.
		const other = rows.find((row) => row.id === "other.ui-theme")!
		expect(other.kind).toBe("readonly")
		expect(other.editable).toBe(false)
	})

	/**
	 * The reported bug: 模型 listed subagent definitions. Agent definitions are
	 * NOT settings — their home is /agents — so all four big sections must stay
	 * the contract's single command-jump row (§3.5), with no agent data source
	 * anywhere in the builders.
	 */
	test("big sections are one jump row each and never carry agent definitions", () => {
		const agentNames = ["Minimal Subagent", "老法师", "PTC Subagent", "小黄鸭", "牛马狗"]
		const bigSections = [
			["models", "/model"],
			["plugins", "/plugins"],
			["presets", "/preset"],
			["account", "/login"],
		] as const
		for (const [id, command] of bigSections) {
			const rows = buildSectionRows(id, context())
			expect(rows).toHaveLength(1)
			const row = rows[0]!
			expect(row.id).toBe(`jump.${id}`)
			expect(row.kind).toBe("jump")
			expect(row.command).toBe(command)
			expect(row.value).toBe(command)
			const painted = `${row.label} ${row.value} ${row.note ?? ""}`
			for (const name of agentNames) expect(painted).not.toContain(name)
			// No table language either: the agents table's NAME/MODEL/THINK/
			// DEEP/LIMITS header must never leak into a settings section.
			expect(painted).not.toMatch(/THINK|DEEP|LIMITS/)
		}
	})
})

describe("settings modal: Esc ladder", () => {
	test("editor → browse → close, one level per press", () => {
		expect(settingsBackView("editor")).toBe("browse")
		expect(settingsBackView("browse")).toBe("close")
	})
})

describe("settings modal: instant writes", () => {
	test("a local value lands in configSave exactly once with the new value", async () => {
		const calls: string[] = []
		const row = buildGeneralRows(context()).find((entry) => entry.id === "general.language")!
		const result = await writeSetting(row, "zh-CN", {
			seam: fakeSeam(calls),
			merged: { theme: "dsh-blue" },
			local: true,
			host: true,
		})
		expect(result.ok).toBe(true)
		expect(result.label).toBe("语言")
		expect(result.patch).toEqual({ hintsLocale: "zh-CN" })
		expect(calls).toHaveLength(1)
		expect(calls[0]).toContain("configSave:")
		expect(calls[0]).toContain("zh-CN")
	})

	test("a footer hint patch carries the whole map from the live snapshot", async () => {
		const calls: string[] = []
		const row = buildOpentuiRows(context()).find((entry) => entry.id === "footerHints.send")!
		const result = await writeSetting(row, true, {
			seam: fakeSeam(calls),
			merged: { footerHints: { send: false, search: false } },
			local: true,
			host: true,
		})
		expect(result.ok).toBe(true)
		const patch = result.patch as { footerHints: Record<string, boolean> }
		// The patch is the WHOLE hint object (one config key), built from the
		// live snapshot: the edited hint flips, the rest keep their values.
		expect(patch.footerHints.send).toBe(true)
		expect(patch.footerHints.search).toBe(false)
		expect(Object.keys(patch.footerHints).length).toBeGreaterThan(2)
	})

	test("rows sharing a write target write exactly once per action", async () => {
		const calls: string[] = []
		const seam = fakeSeam(calls)
		const appearance = buildGeneralRows(context()).find((row) => row.id === "general.appearance")!
		const opentuiThemeMode = buildOpentuiRows(context()).find((row) => row.id === "themeMode")!
		expect(appearance.write).toEqual(opentuiThemeMode.write)
		const first = await writeSetting(appearance, "light", { seam, merged: {}, local: true, host: true })
		expect(first.ok).toBe(true)
		const second = await writeSetting(opentuiThemeMode, "auto", { seam, merged: {}, local: true, host: true })
		expect(second.ok).toBe(true)
		const saves = calls.filter((call) => call.startsWith("configSave:"))
		expect(saves).toHaveLength(2)
		expect(saves[0]).toContain('"themeMode":"light"')
		expect(saves[1]).toContain('"themeMode":"auto"')
	})

	test("a local write failure is returned verbatim", async () => {
		const calls: string[] = []
		const result = await writeSetting(
			buildGeneralRows(context()).find((row) => row.id === "general.language")!,
			"ja",
			{
				seam: fakeSeam(calls, {
					configSave: () => {
						throw new Error("disk full")
					},
				}),
				merged: {},
				local: true,
				host: true,
			},
		)
		expect(result.ok).toBe(false)
		expect(result.error).toContain("写入失败")
		expect(result.error).toContain("disk full")
		expect(result.patch).toBeUndefined()
	})

	test("a host value writes path ops through commitHostWrite", async () => {
		const calls: string[] = []
		const row = buildSectionRows("host", context()).find(
			(entry) => entry.id === "session-log-deepseek.enabled",
		)!
		const result = await writeSetting(row, false, {
			seam: fakeSeam(calls),
			merged: {},
			document,
			local: true,
			host: true,
		})
		expect(result.ok).toBe(true)
		const mutates = calls.filter((call) => call.startsWith("mutate:session-log-deepseek:"))
		expect(mutates).toHaveLength(1)
		expect(mutates[0]).toContain('value":false')
		expect(result.document).toBeDefined()
	})

	test("a failed host mutate surfaces settings.mutate's message", async () => {
		const seam = fakeSeam([])
		;(seam.settings as unknown as { mutate: () => Promise<unknown> }).mutate = async () => ({
			ok: false,
			conflict: false,
			error: "settings/rejected: bad preset",
		})
		const result = await writeSetting(
			buildGeneralRows(context()).find((row) => row.id === "general.session-log")!,
			true,
			{
				seam,
				merged: {},
				document,
				local: true,
				host: true,
			},
		)
		expect(result.ok).toBe(false)
		expect(result.error).toContain("settings/rejected: bad preset")
	})

	test("a read-only row never writes", async () => {
		const calls: string[] = []
		const row = buildGeneralRows(context()).find((entry) => entry.id === "general.font-size")!
		const result = await writeSetting(row, "12", {
			seam: fakeSeam(calls),
			merged: {},
			local: true,
			host: true,
		})
		expect(result.ok).toBe(false)
		expect(result.error).toContain("不可编辑")
		expect(calls).toHaveLength(0)
	})
})

// ----------------------------------------------------- rendered key paths ----

describe("settings modal: real keys", () => {
	test("open frame paints all 7 nav labels, hint follows the pane, highlight stays in budget", async () => {
		const { setup, frame } = await mount({ width: 120, height: 40 })
		try {
			// 1. The nav column is painted head to tail (not just `通用`, which also
			//    names the section title; the old gate matched the whole frame).
			const labels = navLabels(setup)
			for (const section of SETTINGS_SECTIONS) {
				expect(labels.some((line) => line.startsWith(section.label.replace(/\s+/g, "")))).toBe(true)
			}
			// 2. At open the nav owns the cursor: the hint says so and the row list
			//    must not paint a competing highlight.
			expect(frame()).toContain("↑↓ 选择分节")
			expect(highlightRun(setup, "权限默认预设")).toBeUndefined()
			const navRun = highlightRun(setup, "通用 12")
			expect(navRun).toBeDefined()
			expect(navRun!.end - navRun!.start + 1).toBeLessThanOrEqual(20)

			// 3. → hands the cursor to the rows: hint and highlight agree, and the
			//    bar is exactly the rowWidth budget (84 at 120x40), clear of the
			//    panel's right padding and border.
			setup.mockInput.pressArrow("right")
			await settle(setup)
			expect(frame()).toContain("↑↓ 选择行")
			expect(frame()).not.toContain("↑↓ 选择分节")
			const run = highlightRun(setup, "权限默认预设")
			expect(run).toBeDefined()
			expect(run!.end - run!.start + 1).toBe(settingsRowWidth(120, 40))
			expect(settingsRowWidth(120, 40)).toBe(84)
			const header = setup
				.captureCharFrame()
				.split("\n")
				.find((line) => line.includes("Settings"))!
			const rightBorder = cells(header.slice(0, header.lastIndexOf("┃")))
			expect(rightBorder - 1 - run!.end).toBeGreaterThanOrEqual(3)
		} finally {
			await setup.dispose()
		}
	})

	test("模型 paints the /model jump, no agent rows, and dispatches after closing", async () => {
		const names = ["Minimal Subagent", "老法师", "PTC Subagent", "小黄鸭", "牛马狗"]
		// The seam deliberately exposes the real /agents corpus: the settings
		// modal must never read it (agent definitions live in /agents).
		const seam = {
			...fakeSeam([]),
			agents: {
				list: () =>
					names.map((name) => ({
						name,
						model: "zai-coding-cn/glm-5.3-flash",
						thinking: "high",
						deep: 0,
						file: `/tmp/agents/${name}.md`,
					})),
			},
		} as unknown as SessionSeam
		const dispatched: string[] = []
		const stacks: PanelStackApi[] = []
		let topAtDispatch: string | undefined
		const { setup, frame } = await mount({
			width: 120,
			height: 40,
			seam,
			onStack: (api) => stacks.push(api),
			onCommand: (command) => {
				dispatched.push(command)
				topAtDispatch = stacks[0]?.top?.id
			},
		})
		try {
			// Walk every big section (模型 / 插件 / Agent 预设 / 账号): each is one
			// command jump, and none may paint the agent corpus the seam exposes.
			const bigSections = ["打开 /model", "打开 /plugins", "打开 /preset", "打开 /login"]
			let cursor = 0 // nav starts on 通用
			for (let target = 3; target <= 6; target += 1) {
				while (cursor < target) {
					setup.mockInput.pressArrow("down")
					cursor += 1
				}
				await settle(setup)
				expect(frame()).toContain(bigSections[target - 3]!)
				for (const name of names) expect(frame()).not.toContain(name)
				expect(frame()).not.toMatch(/THINK|DEEP|LIMITS/)
			}

			// Back to 模型 (the section the report named) and enter its rows.
			while (cursor > 3) {
				setup.mockInput.pressArrow("up")
				cursor -= 1
			}
			await settle(setup)
			expect(frame()).toContain("打开 /model")

			setup.mockInput.pressEnter() // nav → rows
			await settle(setup)
			expect(frame()).toContain("↑↓ 选择行")
			setup.mockInput.pressEnter() // the single jump row
			await settle(setup)

			// Dispatched exactly once, and only after the modal layer is gone
			// (contract §3.5: close first, then run the command).
			expect(dispatched).toEqual(["/model"])
			expect(topAtDispatch).not.toBe("settings-modal")
			expect(frame()).not.toContain("分节导航")
		} finally {
			await setup.dispose()
		}
	})

	test("a stray printable key never filters the section nav away", async () => {
		const { setup, frame } = await mount({ width: 120, height: 40 })
		try {
			setup.mockInput.pressKey("z")
			setup.mockInput.pressKey("z")
			await settle(setup)
			const labels = navLabels(setup)
			for (const section of SETTINGS_SECTIONS) {
				expect(labels.some((line) => line.startsWith(section.label.replace(/\s+/g, "")))).toBe(true)
			}
			expect(frame()).not.toContain("No items")
			expect(frame()).not.toContain("/zz")
		} finally {
			await setup.dispose()
		}
	})

	test("Esc walks editor → section → exit confirmation, one level per press", async () => {
		const closed: (string | undefined)[] = []
		const { setup, frame } = await mount({ onClosed: (summary) => closed.push(summary) })
		try {
			expect(frame()).toContain("通用")
			setup.mockInput.pressEnter() // nav → General rows
			await settle(setup)
			expect(frame()).toContain("权限默认预设")
			setup.mockInput.pressEnter() // row → enum editor
			await settle(setup)
			expect(frame()).toContain("权限默认预设 — 选择值")
			setup.mockInput.pressEscape() // editor → browse
			await settle(setup)
			expect(frame()).toContain("↑↓ 选择行")
			expect(frame()).not.toContain("选择值")
			expect(settingsPanelOpen()).toBe(true)

			// browse → exit confirmation. The panel is still there behind it.
			setup.mockInput.pressEscape()
			await settle(setup)
			expect(frame()).toContain("退出设置？")
			expect(settingsPanelOpen()).toBe(true)

			// Default focus is 取消: Esc cancels, panel stays.
			setup.mockInput.pressEscape()
			await settle(setup)
			expect(frame()).not.toContain("退出设置？")
			expect(frame()).toContain("↑↓ 选择行")
			expect(settingsPanelOpen()).toBe(true)

			// Reopen and Enter: focus is still 取消, so Enter also cancels.
			setup.mockInput.pressEscape()
			await settle(setup)
			expect(frame()).toContain("退出设置？")
			setup.mockInput.pressEnter()
			await settle(setup)
			expect(frame()).not.toContain("退出设置？")
			expect(settingsPanelOpen()).toBe(true)

			// Tab moves the focus to 退出; Enter confirms and closes.
			setup.mockInput.pressEscape()
			await settle(setup)
			expect(frame()).toContain("退出设置？")
			setup.mockInput.pressTab()
			await settle(setup, 1)
			setup.mockInput.pressEnter()
			await settleUntil(setup, () => !settingsPanelOpen())
			expect(settingsPanelOpen()).toBe(false)
			expect(closed).toHaveLength(1)
		} finally {
			await setup.dispose()
		}
	})

	test("enum editor is fully keyboard driven: ↓ moves the marker, Enter saves (P0-2)", async () => {
		const calls: string[] = []
		const { setup, frame } = await mount({ preselect: "general.appearance", calls })
		try {
			setup.mockInput.pressEnter() // appearance → editor (cursor on "dark")
			await settle(setup)
			expect(frame()).toContain("外观 — 选择值")
			expect(frame()).toContain("▸ dark")
			setup.mockInput.pressArrow("down")
			await settle(setup)
			expect(frame()).toContain("▸ light")
			setup.mockInput.pressArrow("down") // wraps back to the first option
			await settle(setup)
			expect(frame()).toContain("▸ auto")
			setup.mockInput.pressEnter() // save "auto" immediately and leave the editor
			await settle(setup)
			expect(frame()).not.toContain("选择值")
			// Instant save: the status line flashes the row, the panel stays open.
			expect(frame()).toContain("已保存 · 外观")
			expect(settingsPanelOpen()).toBe(true)
			const saves = calls.filter((call) => call.startsWith("configSave:"))
			expect(saves).toHaveLength(1)
			expect(saves[0]).toContain('"themeMode":"auto"')

			// The flash is transient: after 1.5 s the resting text is back.
			await new Promise((resolve) => setTimeout(resolve, 1600))
			await setup.renderOnce()
			expect(frame()).not.toContain("已保存")
			expect(frame()).toContain("改动已即时保存")
		} finally {
			await setup.dispose()
		}
	})

	test("Host section exists and subagent.maxActiveSubagents preselect lands on it (P0-1)", async () => {
		const { setup, frame } = await mount({ preselect: "subagent.maxActiveSubagents" })
		try {
			expect(frame()).toContain("Host")
			expect(frame()).toContain("subagent.maxActiveSubagents")
			expect(frame()).toContain("subagent.maxDepth")
			expect(frame()).toContain("permission.defaultPreset")
			expect(frame()).toContain("session-log-deepseek.enabled")
			// The preselect also puts the cursor on that row: Enter opens ITS editor.
			setup.mockInput.pressEnter()
			await settle(setup)
			expect(frame()).toContain("subagent.maxActiveSubagents — 输入整数")
		} finally {
			await setup.dispose()
		}
	})

	test("opentui's 16 rows are all reachable with ↓ (P0-3, row 16 included)", async () => {
		// 24 terminal rows => an 18-row fixed frame => page size 6, so the
		// 16-row section pages.
		const { setup, frame } = await mount({ height: 24 })
		try {
			setup.mockInput.pressArrow("down") // nav: general → opentui
			await settle(setup, 1)
			setup.mockInput.pressArrow("right") // nav → rows
			await settle(setup, 1)
			for (let index = 0; index < 16; index += 1) {
				setup.mockInput.pressArrow("down")
				await settle(setup, 1)
			}
			// 16 rows, page 6: the cursor window flipped to the last page.
			expect(frame()).toContain("maxRoundsGrace")
			expect(frame()).toContain("13-16/16")
			expect(frame()).not.toContain("themeMode")
			setup.mockInput.pressEnter() // the LAST row opens its editor
			await settle(setup)
			expect(frame()).toContain("maxRoundsGrace — 输入整数")
		} finally {
			await setup.dispose()
		}
	})

	test("120x40 shows all 12 General rows at once (no page indicator)", async () => {
		const { setup, frame } = await mount({ preselect: "general.permission", height: 40 })
		try {
			for (const label of [
				"权限默认预设",
				"语言",
				"外观",
				"字号",
				"工作步骤",
				"开发工具",
				"快捷键",
				"链接打开方式",
				"忙碌时 Enter",
				"性能与用量",
				"Session Log 上传",
				"当前版本",
			]) {
				expect(frame()).toContain(label)
			}
			// pageSize(40) = 16 >= 12: no "a-b/12" indicator and no List pager.
			expect(frame()).not.toMatch(/\d+-\d+\/12/)
		} finally {
			await setup.dispose()
		}
	})

	test("120x24 pages a long section and the indicator follows the window", async () => {
		const { setup, frame } = await mount({ preselect: "general.permission", height: 24 })
		try {
			// 24 rows => 18-row frame => pageSize 6 < 12
			expect(frame()).toMatch(/1-6\/12/)
			setup.mockInput.pressKey("\u001b[F") // End
			await settle(setup)
			expect(frame()).toContain("当前版本")
			expect(frame()).toMatch(/7-12\/12/)
		} finally {
			await setup.dispose()
		}
	})

	test("PgUp/PgDn page the rows when over-window and fall through when they fit", async () => {
		let sessionPages = 0
		const tall = await mount({
			preselect: "general.permission",
			height: 40,
			onSessionPageDown: () => {
				sessionPages += 1
			},
		})
		try {
			// General fits (12 <= 18): the session pager must keep pagedown.
			tall.setup.mockInput.pressKey("\u001b[6~") // PgDn
			await settle(tall.setup)
			expect(sessionPages).toBe(1)
			expect(tall.frame()).not.toMatch(/\d+-\d+\/12/)
		} finally {
			await tall.setup.dispose()
		}

		const short = await mount({
			preselect: "footerHints.send",
			height: 24,
			onSessionPageDown: () => {
				sessionPages += 1
			},
		})
		try {
			expect(short.frame()).toMatch(/1-6\/16/)
			short.setup.mockInput.pressKey("\u001b[6~") // PgDn → next page
			await settle(short.setup)
			expect(sessionPages).toBe(1) // still 1: consumed by settings
			expect(short.frame()).toMatch(/7-12\/16/)
			short.setup.mockInput.pressKey("\u001b[5~") // PgUp → previous page
			await settle(short.setup)
			expect(short.frame()).toMatch(/1-6\/16/)
			expect(sessionPages).toBe(1)
		} finally {
			await short.setup.dispose()
		}
	})

	test("Ctrl+S has no commit side effect (instant model)", async () => {
		const calls: string[] = []
		const { setup, frame } = await mount({ preselect: "general.appearance", calls })
		try {
			setup.mockInput.pressKey("s", { ctrl: true })
			await settle(setup)
			expect(calls).toHaveLength(0)
			expect(settingsPanelOpen()).toBe(true)
			expect(frame()).toContain("改动已即时保存")
			expect(frame()).not.toContain("ctrl+s")
		} finally {
			await setup.dispose()
		}
	})

	test("a failed write shows the error and the exit confirmation still works", async () => {
		const calls: string[] = []
		const { setup, frame } = await mount({
			preselect: "general.session-log",
			calls,
			seamOptions: { failNs: "session-log-deepseek" },
		})
		try {
			setup.mockInput.pressKey(" ") // toggle → immediate host write, rejected
			await settle(setup)
			expect(settingsPanelOpen()).toBe(true)
			expect(frame()).toContain("settings/rejected")
			expect(frame()).not.toContain("已保存")
			expect(calls.filter((call) => call.startsWith("mutate:session-log-deepseek:"))).toHaveLength(1)

			// The panel still navigates, and the exit dialog is still available.
			setup.mockInput.pressEscape()
			await settle(setup)
			expect(frame()).toContain("退出设置？")
			setup.mockInput.pressTab()
			await settle(setup, 1)
			setup.mockInput.pressEnter()
			await settleUntil(setup, () => !settingsPanelOpen())
			expect(settingsPanelOpen()).toBe(false)
		} finally {
			await setup.dispose()
		}
	})

	test("a failed number write keeps its editor open for correction", async () => {
		const calls: string[] = []
		const { setup, frame } = await mount({
			preselect: "subagent.maxDepth",
			calls,
			seamOptions: { failNs: "subagent" },
		})
		try {
			setup.mockInput.pressEnter() // number editor, value 1
			await settle(setup)
			expect(frame()).toContain("subagent.maxDepth — 输入整数")
			setup.mockInput.pressArrow("right") // 1 → 2
			await settle(setup, 1)
			setup.mockInput.pressEnter() // submit → rejected
			await settle(setup)
			expect(frame()).toContain("settings/rejected")
			// The editor is still open with the attempted value, so it can be
			// corrected or left with Esc.
			expect(frame()).toContain("subagent.maxDepth — 输入整数")
			expect(frame()).toContain("数值: 2")
			const mutates = calls.filter((call) => call.startsWith("mutate:subagent:"))
			expect(mutates).toHaveLength(1)
			expect(mutates[0]).toContain('"value":2')
			expect(settingsPanelOpen()).toBe(true)
		} finally {
			await setup.dispose()
		}
	})

	test("the appearance row live-applies themes.mode.set on save (P1-1)", async () => {
		const modeSets: { mode: string; options: unknown }[] = []
		const themes: SettingsThemeFace = {
			current: () => "dsh-blue",
			list: () => ["dsh-blue"],
			set: () => true,
			mode: () => ({
				current: () => "dark",
				set: (mode, options) => {
					modeSets.push({ mode, options })
					return true
				},
			}),
		}
		const calls: string[] = []
		const { setup } = await mount({ preselect: "general.appearance", calls, themes })
		try {
			setup.mockInput.pressEnter() // → enum editor (cursor on "dark")
			await settle(setup)
			setup.mockInput.pressArrow("down") // dark → light
			await settle(setup, 1)
			setup.mockInput.pressEnter() // save light immediately
			await settle(setup)
			expect(calls.some((call) => call.includes('"themeMode":"light"'))).toBe(true)
			expect(modeSets).toEqual([{ mode: "light", options: { persist: false } }])
		} finally {
			await setup.dispose()
		}
	})

	test("one edit writes once, persists, and the reopened UI shows the saved value", async () => {
		const store: Record<string, unknown> = {
			theme: "dsh-blue",
			motion: "auto",
			footerHints: { send: false, search: false },
		}
		const calls: string[] = []
		const closed: (string | undefined)[] = []
		const seam = persistingSeam(store, calls)
		const { setup, frame } = await mount({
			preselect: "footerHints.send",
			seam,
			onClosed: (summary) => closed.push(summary),
		})
		try {
			setup.mockInput.pressKey(" ") // toggle send on → write on the spot
			await settle(setup)
			expect(frame()).toContain("已保存 · footerHints.send")
			expect(settingsPanelOpen()).toBe(true)

			const saves = calls.filter((call) => call.startsWith("configSave:"))
			expect(saves).toHaveLength(1)
			expect(saves[0]).toContain('"send":true')
			expect((store.footerHints as Record<string, boolean>).send).toBe(true)

			// Close through the exit dialog, then reopen: the UI reads the
			// reloaded snapshot (instant model has no draft to show).
			setup.mockInput.pressEscape()
			await settle(setup)
			setup.mockInput.pressTab()
			await settle(setup, 1)
			setup.mockInput.pressEnter()
			await settleUntil(setup, () => !settingsPanelOpen())
			// The exit summary contract is unchanged: onClosed receives the
			// settingsSummary of everything this session saved.
			expect(closed).toEqual(["Settings updated: footerHints.send"])
			openSettingsPanel("footerHints.send")
			await settle(setup)
			expect(frame()).toContain("footerHints.send on")
		} finally {
			await setup.dispose()
		}
	})

	test("two footer hints saved back-to-back do not clobber each other", async () => {
		const store: Record<string, unknown> = {
			theme: "dsh-blue",
			motion: "auto",
			footerHints: { send: false, search: false },
		}
		const calls: string[] = []
		const seam = persistingSeam(store, calls)
		const { setup, frame } = await mount({ preselect: "footerHints.send", seam })
		try {
			setup.mockInput.pressKey(" ") // send = on (writes immediately)
			await settle(setup, 1)
			for (let index = 0; index < 5; index += 1) {
				setup.mockInput.pressArrow("down") // send(4) → search(9)
				await settle(setup, 1)
			}
			setup.mockInput.pressKey(" ") // search = on (second write)
			await settle(setup)

			// Each action wrote the WHOLE hint map built from the fresh snapshot:
			// the second patch still carries send=true.
			const hints = store.footerHints as Record<string, boolean>
			expect(hints.send).toBe(true)
			expect(hints.search).toBe(true)
			const saves = calls.filter((call) => call.startsWith("configSave:"))
			expect(saves).toHaveLength(2)
			const last = JSON.parse(saves.at(-1)!.slice("configSave:".length)) as {
				footerHints: Record<string, boolean>
			}
			expect(last.footerHints.send).toBe(true)
			expect(last.footerHints.search).toBe(true)

			// Reopen: both values come from the persisted snapshot.
			setup.mockInput.pressEscape()
			await settle(setup)
			setup.mockInput.pressTab()
			await settle(setup, 1)
			setup.mockInput.pressEnter()
			await settleUntil(setup, () => !settingsPanelOpen())
			openSettingsPanel("footerHints.send")
			await settle(setup)
			expect(frame()).toContain("footerHints.send on")
			expect(frame()).toContain("footerHints.search on")
		} finally {
			await setup.dispose()
		}
	})

	test("paging yields to a foreign top layer and recovers when it pops (§3.1)", async () => {
		const store: Record<string, unknown> = {
			theme: "dsh-blue",
			motion: "auto",
			footerHints: { send: false, search: false },
		}
		const calls: string[] = []
		let stack: PanelStackApi | undefined
		let sessionPages = 0
		const { setup, frame } = await mount({
			preselect: "footerHints.send",
			seam: persistingSeam(store, calls),
			height: 24,
			onStack: (api) => {
				stack = api
			},
			onSessionPageDown: () => {
				sessionPages += 1
			},
		})
		try {
			setup.mockInput.pressKey(" ") // send = on → one immediate write
			await settle(setup)
			expect(frame()).toMatch(/1-6\/16/)
			expect(calls.filter((call) => call.startsWith("configSave:"))).toHaveLength(1)

			// A foreign layer on top: our handle is no longer `panels.top`.
			const popup = stack!.open(() => <text>foreign popup</text>, {
				id: "foreign-top",
				title: "Foreign",
				size: "medium",
				height: 10,
				fadeIn: false,
			})
			await settle(setup)
			expect(frame()).toContain("Foreign")

			setup.mockInput.pressKey("\u001b[6~") // PgDn must fall through
			await settle(setup)
			expect(sessionPages).toBe(1)
			// The foreign layer covers the settings hint line, so "settings did
			// not page" is proven below: the FIRST PgDn after the pop must land
			// on page 2 (7-12/16), never page 3.

			// Ctrl+S has no binding at all, top or not: no extra write.
			setup.mockInput.pressKey("s", { ctrl: true })
			await settle(setup)
			expect(calls.filter((call) => call.startsWith("configSave:"))).toHaveLength(1)
			expect(settingsPanelOpen()).toBe(true)

			// Pop it: the same handle is top again, so paging works.
			popup.close()
			await settle(setup)
			setup.mockInput.pressKey("\u001b[6~")
			await settle(setup)
			expect(sessionPages).toBe(1)
			expect(frame()).toMatch(/7-12\/16/)
		} finally {
			await setup.dispose()
		}
	})

	test("a long enum (themes) windows its options with a x-y/N indicator (§3.2)", async () => {
		const names = Array.from({ length: 20 }, (_, index) => `theme-${String(index + 1).padStart(2, "0")}`)
		const themes: SettingsThemeFace = {
			current: () => names[0]!,
			list: () => names,
			set: () => true,
			mode: () => ({ current: () => "dark", set: () => true }),
		}
		// 24 rows => an 18-row frame => page size 6 => 4 option rows per window.
		const { setup, frame } = await mount({ preselect: "theme", themes, height: 24 })
		try {
			setup.mockInput.pressEnter() // theme row → enum editor
			await settle(setup)
			expect(frame()).toContain("theme — 选择值")
			expect(frame()).toContain("▸ theme-01")
			expect(frame()).toMatch(/1-4\/20/)
			expect(frame()).not.toContain("theme-09")

			for (let index = 0; index < 19; index += 1) {
				setup.mockInput.pressArrow("down")
				await settle(setup, 1)
			}
			// Cursor sits on the last option and the window followed it there.
			expect(frame()).toContain("▸ theme-20")
			expect(frame()).toMatch(/17-20\/20/)
			expect(frame()).not.toContain("theme-05")
		} finally {
			await setup.dispose()
		}
	})
})

// ------------------------------------------- fixed frame + layered chrome ----

describe("settings modal: fixed frame (v1.2)", () => {
	test("75% of the terminal, clamped to [18, rows - 4]", () => {
		expect(settingsPanelRows(40)).toBe(30)
		expect(settingsPanelRows(34)).toBe(26)
		expect(settingsPanelRows(24)).toBe(18)
		// 18 is the floor; rows - 4 is the ceiling, and it wins on short screens.
		expect(settingsPanelRows(20)).toBe(16)
		expect(settingsPanelRows(12)).toBe(8)
		expect(settingsPanelRows(Number.NaN)).toBe(18)
	})

	test("page size derives from the fixed frame, never from the section", () => {
		expect(bodyPageSize(30)).toBe(18)
		expect(bodyPageSize(18)).toBe(6)
		// Small frames keep at least 4 rows + the indicator row.
		expect(bodyPageSize(12)).toBe(4)
		expect(bodyPageSize(40)).toBe(24)
	})

	test("switching all 7 sections never moves the frame (120x40)", async () => {
		const { setup } = await mount({ width: 120, height: 40 })
		try {
			const edges = [frameEdges(setup)]
			for (let index = 1; index < SETTINGS_SECTIONS.length; index += 1) {
				setup.mockInput.pressArrow("down")
				await settle(setup, 1)
				edges.push(frameEdges(setup))
			}
			const first = edges[0]!
			expect(first.bottom - first.top + 1).toBe(settingsPanelRows(40))
			for (const edge of edges) expect(edge).toEqual(first)
		} finally {
			await setup.dispose()
		}
	})

	test("80x24 keeps the same fixed frame across all 7 sections", async () => {
		const { setup } = await mount({ width: 80, height: 24 })
		try {
			const edges = [frameEdges(setup)]
			for (let index = 1; index < SETTINGS_SECTIONS.length; index += 1) {
				setup.mockInput.pressArrow("down")
				await settle(setup, 1)
				edges.push(frameEdges(setup))
			}
			const first = edges[0]!
			expect(first.bottom - first.top + 1).toBe(18)
			expect(first.top).toBe(3)
			for (const edge of edges) expect(edge).toEqual(first)
		} finally {
			await setup.dispose()
		}
	})

	test("the editor view keeps the frame edges (row editor and enum editor)", async () => {
		const { setup } = await mount({ preselect: "general.permission", width: 120, height: 40 })
		try {
			const browse = frameEdges(setup)
			setup.mockInput.pressArrow("right") // nav → rows
			await settle(setup, 1)
			setup.mockInput.pressEnter() // enum editor
			await settle(setup)
			expect(frameEdges(setup)).toEqual(browse)

			setup.mockInput.pressEscape() // editor → browse
			await settle(setup)
			setup.mockInput.pressArrow("down") // 语言
			await settle(setup, 1)
			expect(frameEdges(setup)).toEqual(browse)
		} finally {
			await setup.dispose()
		}
	})
})

describe("settings modal: layered chrome (v1.2)", () => {
	const chrome = () => resolvePanelChrome(FALLBACK_THEME)

	test("title band + rule, nav band, divider and content surface are distinct", async () => {
		const { setup } = await mount({ width: 120, height: 40 })
		try {
			// 1. Title band: the Settings line paints the title-band token, and the
			//    row under it is the theme-border rule.
			expect(linePaintsBg(setup, "Settings", chrome().titleBand)).toBe(true)
			const titleRow = lineIndexOf(setup, "Settings")
			const ruleRow = setup.captureCharFrame().split("\n")[titleRow + 1] ?? ""
			expect(ruleRow).toContain("─")

			// 2. Nav band: an UNSELECTED nav row paints the raised band (the
			//    selected row is covered by the accent highlight), and the divider
			//    column (theme border token) is painted on that same line.
			expect(linePaintsBg(setup, "账号", chrome().navBand)).toBe(true)
			expect(linePaintsBg(setup, "账号", chrome().divider)).toBe(true)
			const navLine = lineSpans(setup).find((line) => line.map((span) => span.text).join("").includes("账号"))!
			const dividerCell = navLine.find((span) => span.bg.toInts().join() === chrome().divider.toInts().join())
			expect(dividerCell?.width).toBe(1)

			// 3. A content row stays on the surface (the frame line also carries
			//    the nav cells, so assert on the row's own span).
			expect(spanOf(setup, "权限默认预设")?.bg.toInts()).toEqual(chrome().content.toInts())
		} finally {
			await setup.dispose()
		}
	})

	test("nav selection is accent-filled and the count badge stays muted", async () => {
		const { setup } = await mount({ width: 120, height: 40 })
		try {
			// Selected section: full accent row (the kit's active row token).
			const navRun = highlightRun(setup, "通用 12")
			expect(navRun).toBeDefined()
			expect(navRun!.end - navRun!.start + 1).toBeLessThanOrEqual(20)
			// Unselected sections still paint their row-count badge muted.
			expect(spanOf(setup, "TUI 专有")?.fg.toInts()).toEqual(FALLBACK_THEME.text.base.toInts())
		} finally {
			await setup.dispose()
		}
	})

	test("the action band is the esc affordance plus the status line, no commit control", async () => {
		const { setup, frame } = await mount({ width: 120, height: 40 })
		try {
			expect(frame()).toContain("esc 返回")
			expect(frame()).toContain("改动已即时保存")
			// The old 确定 / ctrl+s control and its 未提交 counter are gone.
			expect(frame()).not.toContain("确定")
			expect(frame()).not.toContain("ctrl+s")
			expect(frame()).not.toContain("未提交")

			const lines = lineSpans(setup)
			const actionLine = lines.find((line) => line.map((span) => span.text).join("").includes("esc 返回"))!
			const text = actionLine.map((span) => span.text).join("")
			// The esc affordance still owns a one-cell rule on each side.
			expect(text).toContain("│")
			expect(text.split("│").length - 1).toBeGreaterThanOrEqual(2)

			// The status line is system text (v1.2: not faint, which used to be
			// an alias of muted and therefore carried no hierarchy).
			const hint = spanOf(setup, "改动已即时保存")
			expect(hint?.fg.toInts()).toEqual(FALLBACK_THEME.text.system.toInts())
		} finally {
			await setup.dispose()
		}
	})

	test("dsh-blue: every layered text pair clears 4.5:1 (default theme)", () => {
		const theme = createComponentTheme(() => resolveThemeDocument(getDshBlueTheme(), "dark"))
		const panel = projectPanelTheme(theme)
		const layers = resolvePanelChrome(panel)
		const pairs: readonly [string, typeof panel.text.base, typeof panel.text.base][] = [
			["title on title band", panel.text.base, layers.titleBand],
			["esc hint on title band", panel.text.muted, layers.titleBand],
			["nav label on nav band", panel.text.base, layers.navBand],
			["nav count on nav band", panel.text.system, layers.navBand],
			["content label on surface", panel.text.base, layers.content],
			["content value on surface", panel.text.code, layers.content],
			["editable badge on surface", panel.text.user, layers.content],
			["readonly row on surface", panel.text.system, layers.content],
			["section title on surface", panel.text.heading, layers.content],
			["error line on surface", panel.text.danger, layers.content],
			["selected row on accent", panel.row.activeFg, panel.row.activeBg],
		]
		for (const [name, fg, bg] of pairs) {
			// Name is part of the assertion so a failure says WHICH pair broke.
			expect({ pair: name, ok: contrastRatio(fg, bg) >= 4.5 }).toEqual({ pair: name, ok: true })
		}
		// The divider is a non-text rule, but it must still out-shine the scrim.
		expect(contrastRatio(layers.divider, layers.content)).toBeGreaterThanOrEqual(1.5)
		expect(relativeLuminance(layers.divider)).toBeGreaterThan(relativeLuminance(panel.background.scrim))
		// Every band clears the scrim too (the panel is never "a black box").
		for (const band of [layers.titleBand, layers.navBand, layers.content]) {
			expect(relativeLuminance(band)).toBeGreaterThan(relativeLuminance(panel.background.scrim))
		}
	})

	test("the layered projection follows the theme (tokyonight / gruvbox too)", () => {
		const make = (source: unknown, name: string) => {
			const document = parseTheme(source as never, name)
			return createComponentTheme(() => resolveThemeDocument(document, "dark"))
		}
		for (const [name, source] of [
			["tokyonight", tokyonightJson],
			["gruvbox", gruvboxJson],
		] as const) {
			const panel = projectPanelTheme(make(source, name))
			const layers = resolvePanelChrome(panel)
			expect({ name, nav: layers.navBand.toInts().join() }).not.toEqual({
				name,
				nav: layers.content.toInts().join(),
			})
			// Primary text keeps AA contrast on the raised band. (muted-on-base
			// is the THEME's own pairing — gruvbox sits at 4.0 — so only the band
			// we introduce is asserted here; dsh-blue is fully pinned above.)
			expect({ name, ratio: contrastRatio(panel.text.base, layers.navBand) >= 4.5 }).toEqual({
				name,
				ratio: true,
			})
		}
	})
})

// ------------------------------------------------ semantic roles (v1.2) ----

describe("settings modal: semantic roles (v1.2)", () => {
	/** All three stock themes in both modes, with the role SOURCE tokens. */
	function panels() {
		const entries: {
			name: string
			mode: "dark" | "light"
			panel: ReturnType<typeof projectPanelTheme>
			raw: { code: unknown; user: unknown; system: unknown; heading: unknown; danger: unknown }
		}[] = []
		const sources = [
			["dsh-blue", getDshBlueTheme()],
			["tokyonight", parseTheme(tokyonightJson as never, "tokyonight")],
			["gruvbox", parseTheme(gruvboxJson as never, "gruvbox")],
		] as const
		for (const [name, document] of sources) {
			for (const mode of ["dark", "light"] as const) {
				const theme = createComponentTheme(() => resolveThemeDocument(document, mode))
				entries.push({
					name,
					mode,
					panel: projectPanelTheme(theme),
					raw: {
						code: theme.markdown.code,
						user: theme.text.action.primary.base,
						system: theme.text.feedback.info.base,
						heading: theme.markdown.heading,
						danger: theme.text.feedback.error.base,
					},
				})
			}
		}
		return entries
	}

	test("every role follows the theme: same element, different color per theme", () => {
		const entries = panels()
		for (const mode of ["dark", "light"] as const) {
			for (const role of ["code", "user", "system", "heading", "danger"] as const) {
				const values = entries
					.filter((entry) => entry.mode === mode)
					.map((entry) => ({
						theme: entry.name,
						color: entry.panel.text[role].toInts().join(),
					}))
				// Two of the three differ => the projection is not a constant.
				expect({ mode, role, distinct: new Set(values.map((v) => v.color)).size }).toEqual({
					mode,
					role,
					distinct: 3,
				})
			}
		}
		// Dark and light of the SAME theme also differ (mode is projected too).
		for (const name of ["dsh-blue", "tokyonight", "gruvbox"] as const) {
			const dark = entries.find((entry) => entry.name === name && entry.mode === "dark")!
			const light = entries.find((entry) => entry.name === name && entry.mode === "light")!
			expect(dark.panel.text.code.toInts().join()).not.toEqual(light.panel.text.code.toInts().join())
			expect(dark.panel.background.content.toInts().join()).not.toEqual(
				light.panel.background.content.toInts().join(),
			)
		}
	})

	test("roles clear 4.5:1 on the content surface, falling back to text.base below it", () => {
		for (const entry of panels()) {
			const { panel, raw } = entry
			const content = panel.background.content
			for (const role of ["code", "user", "system", "heading", "danger"] as const) {
				const projected = panel.text[role]
				const label = `${entry.name}/${entry.mode}/${role}`
				// The guard never lands below the theme's own primary text: AA
				// where text.base clears it, base's own ratio where the THEME's
				// light palette sits under 4.5 (tokyonight light = 4.03).
				const floor = Math.min(4.5, contrastRatio(panel.text.base, content))
				expect({ label, ok: contrastRatio(projected, content) >= floor - 1e-9 }).toEqual({
					label,
					ok: true,
				})
				// The guard is exact: below 4.5 the projection IS the primary
				// text token; at or above it the theme's own token survives.
				const sourceOk = contrastRatio(raw[role] as never, content) >= 4.5
				const expected = sourceOk ? (raw[role] as never) : panel.text.base
				expect({ label, color: projected.toInts().join() }).toEqual({
					label,
					color: (expected as { toInts(): number[] }).toInts().join(),
				})
			}
		}
	})

	test("withContrastFloor drops a role below AA and keeps a legible one", () => {
		const base = resolveThemeDocument(getDshBlueTheme(), "dark")
		const content = base.background.raised.base
		// The destructive token is a BACKGROUND in every stock theme: as text it
		// is invisible, so the guard must return the primary-text fallback.
		expect(withContrastFloor(base.text.action.destructive.base, content, base.text.base).toInts()).toEqual(
			base.text.base.toInts(),
		)
		// markdown.code clears AA on the content surface, so the guard keeps it.
		expect(withContrastFloor(base.markdown.code, content, base.text.base).toInts()).toEqual(
			base.markdown.code.toInts(),
		)
	})

	test("a theme missing the v1.2 tokens falls back instead of throwing", () => {
		const base = resolveThemeDocument(getDshBlueTheme(), "dark")
		// Copy the resolved view, then strip every field v1.2 introduced: this is
		// what a theme projected before the slots existed looks like at runtime.
		const legacy = {
			...base,
			markdown: { ...base.markdown },
			text: { ...base.text, feedback: { ...base.text.feedback } },
			background: { ...base.background, raised: { ...base.background.raised } },
			hue: { ...base.hue, interactive: { ...base.hue.interactive } },
		}
		delete (legacy.markdown as Record<string, unknown>).code
		delete (legacy.markdown as Record<string, unknown>).heading
		delete (legacy.text.feedback as Record<string, unknown>).info
		delete (legacy.background.raised as Record<string, unknown>).base
		delete (legacy.hue.interactive as Record<string, unknown>)[500]
		const panel = projectPanelTheme(createComponentTheme(() => legacy as never))
		// Content falls back to the page surface; code/heading to primary text.
		expect(panel.background.content.toInts()).toEqual(base.background.base.toInts())
		expect(panel.text.code.toInts()).toEqual(base.text.base.toInts())
		expect(panel.text.heading.toInts()).toEqual(base.text.base.toInts())
		// system falls back to muted, floored the same way the projection floors.
		expect(panel.text.system.toInts()).toEqual(
			withContrastFloor(base.text.muted, base.background.base, base.text.base).toInts(),
		)
		// Focus falls back to the idle border (visible), never to a literal.
		expect(panel.border.focused.color.toInts()).toEqual(base.border.base.toInts())
	})

	test("the content surface is raised above the page in every theme", () => {
		for (const entry of panels()) {
			const { panel } = entry
			const layers = resolvePanelChrome(panel)
			const label = `${entry.name}/${entry.mode}`
			// Never the near-black page surface: the content layer is its own step.
			expect({ label, same: layers.content.toInts().join() === panel.background.surface.toInts().join() }).toEqual({
				label,
				same: false,
			})
			expect(layers.content.toInts().join()).not.toEqual(layers.navBand.toInts().join())
		}
	})

	test("render: values are code, ✎ is user, N/A rows are system, counts are system", async () => {
		const { setup } = await mount({ width: 120, height: 40 })
		try {
			const line = (needle: string) => lineSpans(setup).find((entry) => entry.map((span) => span.text).join("").includes(needle))
			// ✎ editable marker: the user role, not the accent.
			expect(spanOf(setup, "✎")?.fg.toInts()).toEqual(FALLBACK_THEME.text.user.toInts())
			// Read-only row (字号): the label is system and its value is code.
			const naLine = line("字号")!
			const naText = naLine.map((span) => span.text).join("")
			expect(naText).toContain("N/A")
			expect(naLine.find((span) => span.text.includes("字号"))?.fg.toInts()).toEqual(
				FALLBACK_THEME.text.system.toInts(),
			)
			expect(naLine.find((span) => span.text.includes("N/A"))?.fg.toInts()).toEqual(
				FALLBACK_THEME.text.code.toInts(),
			)
			// Nav row count (unselected section) is system text.
			const navLine = line("TUI 专有")!
			expect(
				navLine.some((span) => span.fg.toInts().join() === FALLBACK_THEME.text.system.toInts().join()),
			).toBe(true)
			// Section title is the heading role.
			// Section title is the heading role (the nav copy of the same label is
			// base/activeFg, so a heading-colored 通用 can only be the title).
			expect(
				lineSpans(setup).some((entry) =>
					entry.some(
						(span) =>
							span.text.includes("通用") &&
							span.fg.toInts().join() === FALLBACK_THEME.text.heading.toInts().join(),
					),
				),
			).toBe(true)
			// The content pane paints the raised content token, not the page.
			expect(spanOf(setup, "权限默认预设")?.bg.toInts()).toEqual(
				resolvePanelChrome(FALLBACK_THEME).content.toInts(),
			)
		} finally {
			await setup.dispose()
		}
	})

	test("render: the enum editor colors options (code), cursor (accent) and current (system)", async () => {
		const { setup, frame } = await mount({ preselect: "general.language", width: 120, height: 40 })
		try {
			setup.mockInput.pressEnter() // 语言 → enum editor
			await settle(setup)
			expect(frame()).toContain("语言 — 选择值")
			expect(spanOf(setup, "语言 — 选择值")?.fg.toInts()).toEqual(
				FALLBACK_THEME.text.heading.toInts(),
			)
			// Cursor glyph.
			expect(spanOf(setup, "▸")?.fg.toInts()).toEqual(FALLBACK_THEME.text.accent.toInts())
			// One option literal carries the code role.
			const options = lineSpans(setup).filter((entry) =>
				entry.some((span) => span.fg.toInts().join() === FALLBACK_THEME.text.code.toInts().join()),
			)
			expect(options.length).toBeGreaterThanOrEqual(1)
			// The current-value suffix is system text.
			expect(spanOf(setup, "(current)")?.fg.toInts()).toEqual(FALLBACK_THEME.text.system.toInts())
		} finally {
			await setup.dispose()
		}
	})
})
