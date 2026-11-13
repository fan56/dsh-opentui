/**
 * /settings on the panel-kit modal stack: the real layer chain, not a stand-in.
 *
 * Mounted through @opentui/solid testRender with the production host wiring
 * (Keymap.Provider → PanelKitProvider + PanelStack → SettingsModalHost), so
 * keys travel the real path: the kit's modal table for Escape/arrows/Enter,
 * the focused input for number/text rows, and the consumer's global Ctrl+S.
 *
 * Covers the review findings: the Host section (P0-1 preselect hit), the enum
 * editor keyboard path (P0-2), the 16-row opentui walk (P0-3), the dirty-Esc
 * confirmation and partial-failure draft retention (P1-3), the write-key based
 * live apply (P1-1) and the shared draft for two rows writing one key (P2-5).
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
	commitSettingsDrafts,
	displayValue,
	draftKey,
	settingsBackView,
	settingsPanelRows,
	settingsRowWidth,
	stageDraft,
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
})

describe("settings modal: Esc ladder", () => {
	test("editor → browse → close, one level per press", () => {
		expect(settingsBackView("editor")).toBe("browse")
		expect(settingsBackView("browse")).toBe("close")
	})
})

describe("settings modal: drafts", () => {
	test("drafts key on the write target, so two rows writing one key share it (P2-5)", () => {
		const general = buildGeneralRows(context())
		const appearance = general.find((row) => row.id === "general.appearance")!
		const opentuiThemeMode = buildOpentuiRows(context()).find((row) => row.id === "themeMode")!
		expect(draftKey(appearance)).toBe("config:themeMode")
		expect(draftKey(opentuiThemeMode)).toBe("config:themeMode")
		const drafts = stageDraft({}, appearance, "light")
		expect(drafts).toEqual({ "config:themeMode": "light" })
		expect(displayValue(drafts, opentuiThemeMode)).toBe("light")
	})

	test("no footerHints row falls back to its display label (§3.4)", () => {
		for (const section of SETTINGS_SECTIONS) {
			for (const row of buildSectionRows(section.id, context())) {
				const write = row.write
				if (write?.via !== "config" || write.key !== "footerHints") continue
				// Every footer-hint row is id-addressed; the label branch is gone.
				expect(row.id.startsWith("footerHints.")).toBe(true)
				expect(draftKey(row)).toBe(`footerHints.${row.id.slice("footerHints.".length)}`)
			}
		}
	})

	test("cancel discards: staging a draft writes nothing", () => {
		const calls: string[] = []
		void fakeSeam(calls)
		const row = buildGeneralRows(context()).find((entry) => entry.id === "general.language")!
		const drafts = stageDraft({}, row, "zh-CN")
		expect(drafts).toEqual({ "config:hintsLocale": "zh-CN" })
		expect(calls).toHaveLength(0)
	})

	test("确定 commits local + host drafts through the existing writers", async () => {
		const calls: string[] = []
		const rows = buildGeneralRows(context())
		const result = await commitSettingsDrafts({
			seam: fakeSeam(calls),
			rows,
			drafts: { "config:hintsLocale": "zh-CN", "settings:session-log-deepseek.enabled": false },
			merged: { theme: "dsh-blue" },
			document,
			local: true,
			host: true,
		})
		expect(result.ok).toBe(true)
		expect(result.saved).toEqual(["语言", "Session Log 上传"])
		expect(result.attempted).toEqual(["config:hintsLocale", "settings:session-log-deepseek.enabled"])
		expect(calls[0]).toContain("configSave:")
		expect(calls[0]).toContain("zh-CN")
		expect(calls[1]).toContain("mutate:session-log-deepseek:")
		expect(calls[1]).toContain('value":false')
	})

	test("a local write failure is returned verbatim and nothing else is claimed", async () => {
		const calls: string[] = []
		const result = await commitSettingsDrafts({
			seam: fakeSeam(calls, {
				configSave: () => {
					throw new Error("disk full")
				},
			}),
			rows: buildGeneralRows(context()),
			drafts: { "config:hintsLocale": "ja" },
			merged: {},
			document,
			local: true,
			host: true,
		})
		expect(result.ok).toBe(false)
		expect(result.error).toContain("写入失败")
		expect(result.error).toContain("disk full")
		expect(result.saved).toEqual([])
		expect(result.attempted).toEqual(["config:hintsLocale"])
	})

	test("a failed host mutate surfaces settings.mutate's message", async () => {
		const seam = fakeSeam([])
		;(seam.settings as unknown as { mutate: () => Promise<unknown> }).mutate = async () => ({
			ok: false,
			conflict: false,
			error: "settings/rejected: bad preset",
		})
		const result = await commitSettingsDrafts({
			seam,
			rows: buildGeneralRows(context()),
			drafts: { "settings:session-log-deepseek.enabled": true },
			merged: {},
			document,
			local: true,
			host: true,
		})
		expect(result.ok).toBe(false)
		expect(result.error).toContain("settings/rejected: bad preset")
	})

	test("a partial failure reports only the attempted keys (untried stay dirty)", async () => {
		const rows = [...buildSectionRows("general", context()), ...buildSectionRows("host", context())]
		const result = await commitSettingsDrafts({
			seam: fakeSeam([], { failNs: "session-log-deepseek" }),
			rows,
			drafts: {
				"settings:session-log-deepseek.enabled": false,
				"settings:subagent.maxDepth": 2,
			},
			merged: {},
			document,
			local: true,
			host: true,
		})
		expect(result.ok).toBe(false)
		expect(result.saved).toEqual([])
		expect(result.attempted).toEqual(["settings:session-log-deepseek.enabled"])
	})

	test("a key shared by two rows is written exactly once", async () => {
		const calls: string[] = []
		const rows = [...buildSectionRows("general", context()), ...buildSectionRows("host", context())]
		const result = await commitSettingsDrafts({
			seam: fakeSeam(calls),
			rows,
			drafts: { "settings:permission.defaultPreset": "readOnly" },
			merged: {},
			document,
			local: true,
			host: true,
		})
		expect(result.ok).toBe(true)
		expect(result.saved).toEqual(["权限默认预设"])
		expect(calls.filter((call) => call.startsWith("mutate:permission:"))).toHaveLength(1)
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

	test("Esc walks editor → section → close, one level per press (P1 ladder)", async () => {
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
			setup.mockInput.pressEscape() // browse → close (clean buffer)
			await settleUntil(setup, () => !settingsPanelOpen())
			expect(settingsPanelOpen()).toBe(false)
			expect(closed).toHaveLength(1)
		} finally {
			await setup.dispose()
		}
	})

	test("enum editor is fully keyboard driven: ↓ moves the marker, Enter stages (P0-2)", async () => {
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
			setup.mockInput.pressEnter() // stage "auto" and leave the editor
			await settle(setup)
			expect(frame()).toContain("未提交：1 项")
			expect(frame()).not.toContain("选择值")
			setup.mockInput.pressKey("s", { ctrl: true })
			await settleUntil(setup, () => !settingsPanelOpen())
			expect(calls.some((call) => call.includes('"themeMode":"auto"'))).toBe(true)
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

	test("dirty Esc asks first: cancel keeps drafts + panel, discard closes without writes (P1-3)", async () => {
		const calls: string[] = []
		const { setup, frame } = await mount({ preselect: "general.session-log", calls })
		try {
			setup.mockInput.pressKey(" ") // toggle session-log → draft
			await settle(setup)
			expect(frame()).toContain("未提交：1 项")

			setup.mockInput.pressEscape() // dirty → confirmation
			await settle(setup)
			expect(frame()).toContain("丢弃未保存的改动")
			expect(frame()).toContain("1 项未保存")
			expect(settingsPanelOpen()).toBe(true)

			setup.mockInput.pressEscape() // confirm's Esc = cancel
			await settle(setup)
			expect(frame()).not.toContain("丢弃未保存的改动")
			expect(frame()).toContain("未提交：1 项")
			expect(settingsPanelOpen()).toBe(true)

			setup.mockInput.pressEscape() // dirty again
			await settle(setup)
			expect(frame()).toContain("丢弃未保存的改动")
			setup.mockInput.pressArrow("right") // destructive default focus: cancel → discard
			await settle(setup, 1)
			setup.mockInput.pressEnter()
			await settleUntil(setup, () => !settingsPanelOpen())
			expect(settingsPanelOpen()).toBe(false)
			expect(calls).toHaveLength(0) // 取消/丢弃 never writes
		} finally {
			await setup.dispose()
		}
	})

	test("a partial commit failure keeps the untried drafts (P1-3)", async () => {
		const calls: string[] = []
		const { setup, frame } = await mount({
			preselect: "general.session-log",
			calls,
			seamOptions: { failNs: "session-log-deepseek" },
		})
		try {
			setup.mockInput.pressKey(" ") // draft 1: session-log (host, will fail)
			await settle(setup)
			setup.mockInput.pressArrow("left") // rows → nav
			await settle(setup, 1)
			setup.mockInput.pressArrow("down") // general → opentui
			await settle(setup, 1)
			setup.mockInput.pressArrow("down") // opentui → host
			await settle(setup, 1)
			setup.mockInput.pressArrow("right") // nav → rows (maxActiveSubagents)
			await settle(setup, 1)
			setup.mockInput.pressArrow("down") // → maxDepth
			await settle(setup, 1)
			setup.mockInput.pressEnter() // → number editor
			await settle(setup)
			setup.mockInput.pressArrow("right") // 1 → 2, staged
			await settle(setup, 1)
			setup.mockInput.pressKey("s", { ctrl: true })
			await settle(setup)

			expect(settingsPanelOpen()).toBe(true)
			expect(frame()).toContain("settings/rejected")
			// The failed row was attempted (and rolled back); the untried draft
			// (maxDepth=2, staged by →) survives the failure: the editor still
			// shows it because the panel keeps the failed buffer open.
			expect(frame()).toContain("subagent.maxDepth — 输入整数")
			expect(frame()).toContain("数值: 2")
			expect(calls.filter((call) => call.startsWith("mutate:subagent:"))).toHaveLength(0)
			expect(calls.filter((call) => call.startsWith("mutate:session-log-deepseek:"))).toHaveLength(1)
		} finally {
			await setup.dispose()
		}
	})

	test("the appearance row live-applies themes.mode.set on commit (P1-1)", async () => {
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
			setup.mockInput.pressEnter() // stage light
			await settle(setup)
			setup.mockInput.pressKey("s", { ctrl: true })
			await settleUntil(setup, () => !settingsPanelOpen())
			expect(calls.some((call) => call.includes('"themeMode":"light"'))).toBe(true)
			expect(modeSets).toEqual([{ mode: "light", options: { persist: false } }])
		} finally {
			await setup.dispose()
		}
	})

	test("one commit writes once, persists, and the reopened UI shows the saved value", async () => {
		const store: Record<string, unknown> = {
			theme: "dsh-blue",
			motion: "auto",
			footerHints: { send: false, search: false },
		}
		const calls: string[] = []
		const seam = persistingSeam(store, calls)
		const { setup, frame } = await mount({ preselect: "footerHints.send", seam })
		try {
			setup.mockInput.pressKey(" ") // stage send = on
			await settle(setup)
			expect(frame()).toContain("未提交：1 项")
			// Two presses in the same turn: the busy guard drops the second one.
			setup.mockInput.pressKey("s", { ctrl: true })
			setup.mockInput.pressKey("s", { ctrl: true })
			await settleUntil(setup, () => !settingsPanelOpen())

			const saves = calls.filter((call) => call.startsWith("configSave:"))
			expect(saves).toHaveLength(1)
			expect(saves[0]).toContain('"send":true')
			// On disk: the first 确定 really persisted.
			expect((store.footerHints as Record<string, boolean>).send).toBe(true)

			// Reopen: the UI reads the reloaded snapshot, never a stale draft.
			openSettingsPanel("footerHints.send")
			await settle(setup)
			expect(frame()).toContain("footerHints.send on")
		} finally {
			await setup.dispose()
		}
	})

	test("two footer hints in one commit do not clobber each other (first-submit bug)", async () => {
		const store: Record<string, unknown> = {
			theme: "dsh-blue",
			motion: "auto",
			footerHints: { send: false, search: false },
		}
		const calls: string[] = []
		const seam = persistingSeam(store, calls)
		const { setup, frame } = await mount({ preselect: "footerHints.send", seam })
		try {
			setup.mockInput.pressKey(" ") // send = on
			await settle(setup, 1)
			for (let index = 0; index < 5; index += 1) {
				setup.mockInput.pressArrow("down") // send(4) → search(9)
				await settle(setup, 1)
			}
			setup.mockInput.pressKey(" ") // search = on
			await settle(setup)
			expect(frame()).toContain("未提交：2 项")
			setup.mockInput.pressKey("s", { ctrl: true })
			await settleUntil(setup, () => !settingsPanelOpen())

			// Both writes landed: the send patch is not rewritten by a stale
			// footerHints object built from the pre-commit snapshot.
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

			openSettingsPanel("footerHints.send")
			await settle(setup)
			expect(frame()).toContain("footerHints.send on")
			expect(frame()).toContain("footerHints.search on")
		} finally {
			await setup.dispose()
		}
	})

	test("paging/Ctrl+S yield to a foreign top layer and recover when it pops (§3.1)", async () => {
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
			setup.mockInput.pressKey(" ") // stage a draft (send = on)
			await settle(setup)
			expect(frame()).toMatch(/1-6\/16/)

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

			setup.mockInput.pressKey("s", { ctrl: true }) // must not commit
			await settle(setup)
			expect(calls.filter((call) => call.startsWith("configSave:"))).toHaveLength(0)
			expect(settingsPanelOpen()).toBe(true)

			// Pop it: the same handle is top again, so both keys work.
			popup.close()
			await settle(setup)
			setup.mockInput.pressKey("\u001b[6~")
			await settle(setup)
			expect(sessionPages).toBe(1)
			expect(frame()).toMatch(/7-12\/16/)

			setup.mockInput.pressKey("s", { ctrl: true })
			await settleUntil(setup, () => !settingsPanelOpen())
			const saves = calls.filter((call) => call.startsWith("configSave:"))
			expect(saves).toHaveLength(1)
			expect(saves[0]).toContain('"send":true')
			expect((store.footerHints as Record<string, boolean>).send).toBe(true)
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

	test("the action band is two bordered buttons with their key hints", async () => {
		const { setup, frame } = await mount({ width: 120, height: 40 })
		try {
			expect(frame()).toContain("取消 esc")
			expect(frame()).toContain("确定 ctrl+s")
			expect(frame()).toContain("无未提交改动")

			const lines = lineSpans(setup)
			const buttonLine = lines.find((line) => line.map((span) => span.text).join("").includes("确定"))!
			const text = buttonLine.map((span) => span.text).join("")
			// A rule cell on each side of each action: │ 取消 esc │   │ 确定 ctrl+s │
			expect(text).toContain("│")
			expect(text.split("│").length - 1).toBeGreaterThanOrEqual(4)
			// 确定 is the primary button: accent fill + dark foreground.
			const confirm = buttonLine.find((span) => span.text.includes("确定"))!
			expect(confirm.bg.toInts()).toEqual(FALLBACK_THEME.row.activeBg.toInts())
			expect(confirm.fg.toInts()).toEqual(FALLBACK_THEME.row.activeFg.toInts())

			// The status line is muted, not faint/hidden.
			const hint = spanOf(setup, "无未提交改动")
			expect(hint?.fg.toInts()).toEqual(FALLBACK_THEME.text.muted.toInts())
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
			["nav count on nav band", panel.text.muted, layers.navBand],
			["content label on surface", panel.text.base, layers.content],
			["content value on surface", panel.text.muted, layers.content],
			["editable badge on surface", panel.text.accent, layers.content],
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
