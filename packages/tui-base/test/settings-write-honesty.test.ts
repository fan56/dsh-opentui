/**
 * Honest /settings writes under the bridge seam (the default mode): that seam
 * has no `configSave`, so a profile-config write is a silent no-op. A config
 * row must now FAIL LOUDLY (ok:false, i18n notice) while the pure-UI gear row
 * persists to the client-local state file and still succeeds.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { bundledLocalesDir, loadLocales, setLanguages } from "@dsh-opentui/i18n"
import { writeSetting, type SettingsRow } from "../src/routes/session/settings-modal"
import { readUiStateSync } from "../src/util/ui-state"
import type { SessionSeam } from "../src/seams/session"

const bundled = () => loadLocales({ bundledDir: bundledLocalesDir() }).languages
beforeEach(() => setLanguages(bundled()))
afterEach(() => setLanguages(new Map()))

const dirs: string[] = []
afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function seamWithoutConfigSave(): SessionSeam {
	return {
		configLoad: () => ({}),
		configRaw: () => ({}),
		workspaceConfig: () => ({}),
		settings: {
			describe: async () => ({}),
			mutate: async () => ({ ok: true }),
			permissionCatalog: async () => ({}),
		},
	} as unknown as SessionSeam
}

function seamWithConfigSave(calls: string[]): SessionSeam {
	return {
		...seamWithoutConfigSave(),
		configSave: (patch: Record<string, unknown>) => calls.push(JSON.stringify(patch)),
	} as unknown as SessionSeam
}

function configRow(id: string, key: string): SettingsRow {
	return { id, label: id, value: "default", kind: "enum", editable: true, write: { via: "config", key } }
}

const gearRow = () => configRow("activityPanelHeight", "session.activity_panel_height")

describe("writeSetting: bridge seam has no configSave", () => {
	test("a config row returns ok:false with an i18n notice (en)", async () => {
		const result = await writeSetting(configRow("general.language", "lang"), "zh-CN", {
			seam: seamWithoutConfigSave(),
			merged: {},
			local: true,
			host: true,
		})
		expect(result.ok).toBe(false)
		expect(result.error).toContain("Not persistable in this mode")
		expect(result.patch).toBeUndefined()
	})

	test("the same notice is localized (zh-CN)", async () => {
		setLanguages(bundled(), "zh-CN")
		const result = await writeSetting(configRow("general.language", "lang"), "zh-CN", {
			seam: seamWithoutConfigSave(),
			merged: {},
			local: true,
			host: true,
		})
		expect(result.ok).toBe(false)
		expect(result.error).toContain("当前模式不支持持久化")
	})

	test("a pure-UI gear row still succeeds via client-local persistence", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "dsh-gear-write-"))
		dirs.push(dir)
		const file = path.join(dir, "ui-state.json")
		const result = await writeSetting(gearRow(), "7", {
			seam: seamWithoutConfigSave(),
			merged: {},
			local: true,
			host: true,
			uiStatePath: file,
		})
		expect(result.ok).toBe(true)
		expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ session: { activity_panel_height: "7" } })
		expect(readUiStateSync(file).session?.activity_panel_height).toBe("7")
	})

	test("default unsets the stored gear", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "dsh-gear-write-"))
		dirs.push(dir)
		const file = path.join(dir, "ui-state.json")
		await writeSetting(gearRow(), "5", {
			seam: seamWithoutConfigSave(),
			merged: {},
			local: true,
			host: true,
			uiStatePath: file,
		})
		const result = await writeSetting(gearRow(), "default", {
			seam: seamWithoutConfigSave(),
			merged: {},
			local: true,
			host: true,
			uiStatePath: file,
		})
		expect(result.ok).toBe(true)
		expect(readUiStateSync(file)).toEqual({})
	})

	test("with a configSave seam the gear is written BOTH locally and to config", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "dsh-gear-write-"))
		dirs.push(dir)
		const file = path.join(dir, "ui-state.json")
		const calls: string[] = []
		const result = await writeSetting(gearRow(), "10", {
			seam: seamWithConfigSave(calls),
			merged: {},
			local: true,
			host: true,
			uiStatePath: file,
		})
		expect(result.ok).toBe(true)
		expect(calls).toHaveLength(1)
		expect(calls[0]).toContain("activity_panel_height")
		expect(readUiStateSync(file).session?.activity_panel_height).toBe("10")
	})

	test("an invalid gear is still rejected before any write", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "dsh-gear-write-"))
		dirs.push(dir)
		const file = path.join(dir, "ui-state.json")
		const result = await writeSetting(gearRow(), "3", {
			seam: seamWithoutConfigSave(),
			merged: {},
			local: true,
			host: true,
			uiStatePath: file,
		})
		expect(result.ok).toBe(false)
		expect(result.error).toContain("invalid activity panel gear")
	})
})
