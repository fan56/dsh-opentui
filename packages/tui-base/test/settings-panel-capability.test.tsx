/**
 * /settings runtime capability gate: bridge mode (no readable host settings
 * document) hides every row the user cannot change; remote mode keeps the
 * complete row set unchanged. Complements settings-panel-panelkit.test.tsx —
 * this file owns ONLY the capability-gate assertions so it can run beside the
 * panel-kit suite without sharing its edit surface.
 */
import { beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import {
	FALLBACK_THEME,
	PanelKitProvider,
	PanelStack,
	STATIC_MOTION,
	createHostKeyAdapter,
} from "@dsh-opentui/panel-kit"
import { bundledLocalesDir, loadLocales, setLanguages } from "@dsh-opentui/i18n"
import { Keymap } from "../src/context/keymap"
import { createTuiPanelKeymapHost } from "../src/context/panel-kit-host"
import {
	SETTINGS_SECTIONS,
	SettingsModalHost,
	buildGeneralRows,
	buildHostRows,
	buildOpentuiRows,
	buildSectionRows,
	settingsRowsForMode,
	visibleSettingsSections,
	type SettingsRowContext,
} from "../src/routes/session/settings-modal"
import {
	openSettingsPanel,
	setSettingsBridge,
} from "../src/routes/session/settings-panel"
import type { SeamSettingsDocument, SessionSeam } from "../src/seams/session"

beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages)
})
beforeEach(() => setSettingsBridge(undefined))

const hostDocument: SeamSettingsDocument = {
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
	],
}

/** Remote mode: describe() succeeded and `settingsWritable` says host is writable. */
function remoteContext(): SettingsRowContext {
	return {
		merged: { theme: "dsh-blue", motion: "auto" },
		profile: { themeMode: "dark" },
		workspace: {},
		document: hostDocument,
		catalog,
		themeNames: ["dsh-blue"],
		local: true,
		host: true,
		version: "9.9.9",
	}
}

/** Bridge mode: no settings face → no document, `host: false`, local still true. */
function bridgeContext(): SettingsRowContext {
	return { ...remoteContext(), document: undefined, catalog: undefined, host: false }
}

const NA_IDS = [
	"general.font-size",
	"general.transcript-view",
	"general.developer-tools",
	"general.link-opening",
	"general.performance-usage",
]

describe("settings capability gate: data layer", () => {
	test("remote mode keeps every General row including N/A placeholders", () => {
		const rows = buildGeneralRows(remoteContext())
		expect(rows).toHaveLength(12)
		for (const id of NA_IDS) expect(rows.map((row) => row.id)).toContain(id)
	})

	test("bridge mode drops all N/A rows and host-unavailable mirrors, keeps editable rows", () => {
		const rows = buildGeneralRows(bridgeContext())
		const ids = rows.map((row) => row.id)
		for (const id of NA_IDS) expect(ids).not.toContain(id)
		// The two host-derived General mirrors show "host settings unavailable"
		// in bridge mode and have no live write path — they go too.
		expect(ids).not.toContain("general.permission")
		expect(ids).not.toContain("general.session-log")
		// Real, settable local rows survive.
		expect(ids).toContain("general.language")
		expect(ids).toContain("general.appearance")
		expect(rows.every((row) => row.editable && row.write !== undefined)).toBe(true)
	})

	test("bridge mode empties Host rows; remote mode keeps four whitelist rows", () => {
		expect(buildHostRows(bridgeContext())).toEqual([])
		expect(buildSectionRows("host", bridgeContext())).toEqual([])
		const remote = buildHostRows(remoteContext())
		expect(remote.map((row) => row.id)).toEqual([
			"subagent.maxActiveSubagents",
			"subagent.maxDepth",
			"permission.defaultPreset",
			"session-log-deepseek.enabled",
		])
	})

	test("bridge mode keeps all 18 TUI-specific rows (local config stays settable)", () => {
		const rows = buildOpentuiRows(bridgeContext())
		expect(rows).toHaveLength(18)
		expect(rows.every((row) => row.editable && row.write?.via === "config")).toBe(true)
	})

	test("command-jump rows survive in both modes (commands are not configuration)", () => {
		for (const ctx of [remoteContext(), bridgeContext()]) {
			expect(buildSectionRows("account", ctx).map((row) => row.command)).toEqual(["/login"])
			expect(buildSectionRows("models", ctx)[0]?.command).toBe("/model")
			expect(buildSectionRows("plugins", ctx)[0]?.command).toBe("/plugins")
			expect(buildSectionRows("presets", ctx)[0]?.command).toBe("/preset")
		}
	})

	test("Host nav entry is hidden in bridge mode, restored in remote mode", () => {
		expect(visibleSettingsSections(bridgeContext()).map((s) => s.id)).toEqual(
			SETTINGS_SECTIONS.filter((s) => s.id !== "host").map((s) => s.id),
		)
		expect(visibleSettingsSections(remoteContext()).map((s) => s.id)).toEqual(
			SETTINGS_SECTIONS.map((s) => s.id),
		)
	})

	test("settingsRowsForMode is a pure filter (row definitions stay intact)", () => {
		const all = buildGeneralRows(remoteContext())
		expect(settingsRowsForMode(all, remoteContext())).toHaveLength(all.length)
		expect(all).toHaveLength(12)
	})
})

// -------------------------------------------------------- rendered panel ----

const keymapConfig = { keybinds: { get: () => [] } } as unknown as Parameters<typeof Keymap.Provider>[0]["config"]

function bridgeSeam(): SessionSeam {
	return {
		configLoad: () => ({}),
		configRaw: () => ({}),
		workspaceConfig: () => ({}),
		// No configSave, no settings face — the real in-process bridge degrade.
	} as unknown as SessionSeam
}

function remoteSeam(): SessionSeam {
	return {
		configLoad: () => ({ theme: "dsh-blue", motion: "auto" }),
		configRaw: () => ({ themeMode: "dark" }),
		workspaceConfig: () => ({}),
		configSave: () => ({}),
		settings: {
			describe: async () => hostDocument,
			mutate: async () => ({ ok: true }),
			permissionCatalog: async () => catalog,
		},
	} as unknown as SessionSeam
}

type Mounted = { dispose: () => Promise<void>; frame: () => string }

async function mount(seam: SessionSeam): Promise<Mounted> {
	const setup = await testRender(
		() => (
			<Keymap.Provider config={keymapConfig}>
				<PanelKitProvider
					theme={FALLBACK_THEME}
					motion={STATIC_MOTION}
					keys={createHostKeyAdapter(createTuiPanelKeymapHost(Keymap.use()))}
				>
					<PanelStack>
						<SettingsModalHost seam={seam} />
					</PanelStack>
				</PanelKitProvider>
			</Keymap.Provider>
		),
		{ width: 120, height: 40 },
	)
	const settle = async () => {
		for (let index = 0; index < 6; index += 1) {
			await new Promise((resolve) => setTimeout(resolve, 5))
			await setup.renderOnce()
		}
	}
	await settle()
	openSettingsPanel()
	await settle()
	return {
		dispose: () => setup.dispose(),
		frame: () => setup.captureCharFrame().replace(/\s+/g, " "),
	}
}

describe("settings capability gate: rendered panel", () => {
	test("bridge panel paints no N/A rows and no Host section", async () => {
		const mounted = await mount(bridgeSeam())
		try {
			const painted = mounted.frame()
			for (const needle of ["Font size", "Working steps", "Developer tools", "Link opening", "Performance & usage"]) {
				expect(painted).not.toContain(needle)
			}
			expect(painted).not.toContain("Host")
			// Supported surfaces are still there.
			expect(painted).toContain("General")
			expect(painted).toContain("TUI-specific")
			expect(painted).toContain("Account")
			expect(painted).toContain("Language")
			expect(painted).toContain("Appearance")
		} finally {
			await mounted.dispose()
		}
	})

	test("remote panel still paints N/A rows and the Host section", async () => {
		const mounted = await mount(remoteSeam())
		try {
			const painted = mounted.frame()
			expect(painted).toContain("Font size")
			expect(painted).toContain("Developer tools")
			expect(painted).toContain("Host")
		} finally {
			await mounted.dispose()
		}
	})
})
