/**
 * Client-local UI state: the gear-class /settings row (`session.activity_panel_height`)
 * is persisted in the CLIENT's state directory, not in the profile config.
 * These pin the storage roundtrip, malformed-file tolerance, and the boot
 * replay's local-first resolution (local gear beats the config fallback).
 */
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
	applyActivityPanelConfig,
	activityPanelGear,
	setActivityPanelGear,
} from "../src/routes/session/widgets-dock"
import {
	decodeUiState,
	localActivityPanelGear,
	readUiState,
	readUiStateSync,
	resolveBootGear,
	writeUiState,
} from "../src/util/ui-state"

const dirs: string[] = []
async function scratch(): Promise<string> {
	const dir = await mkdtemp(path.join(tmpdir(), "dsh-ui-state-"))
	dirs.push(dir)
	return path.join(dir, "ui-state.json")
}

afterEach(async () => {
	setActivityPanelGear(undefined)
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("decodeUiState", () => {
	test("accepts only a valid config-shaped activity-panel gear", () => {
		expect(decodeUiState({ session: { activity_panel_height: "7" } })).toEqual({
			session: { activity_panel_height: "7" },
		})
		expect(localActivityPanelGear({ session: { activity_panel_height: "all" } })).toBe("all")
	})

	test("malformed shapes and invalid gears collapse to the empty state", () => {
		expect(decodeUiState(undefined)).toEqual({})
		expect(decodeUiState(null)).toEqual({})
		expect(decodeUiState([])).toEqual({})
		expect(decodeUiState({ session: "nope" })).toEqual({})
		expect(decodeUiState({ session: { activity_panel_height: 7 } })).toEqual({})
		expect(decodeUiState({ session: { activity_panel_height: "3" } })).toEqual({})
	})
})

describe("ui-state file I/O", () => {
	test("async + sync read roundtrip with a nested directory", async () => {
		const file = await scratch()
		await writeUiState(file, { session: { activity_panel_height: "10" } })
		expect((await readUiState(file)).session?.activity_panel_height).toBe("10")
		expect(readUiStateSync(file).session?.activity_panel_height).toBe("10")
	})

	test("a corrupt JSON file is ignored (both readers return the empty state)", async () => {
		const file = await scratch()
		await writeUiState(file, { session: { activity_panel_height: "5" } })
		await writeFile(file, "{ not json")
		expect(await readUiState(file)).toEqual({})
		expect(readUiStateSync(file)).toEqual({})
	})

	test("a missing file degrades to empty state, never throws", async () => {
		const file = await scratch()
		expect(await readUiState(file)).toEqual({})
		expect(readUiStateSync(file)).toEqual({})
	})
})

describe("boot replay (local first)", () => {
	test("a local gear wins over a different config value", () => {
		expect(resolveBootGear({ session: { activity_panel_height: "1" } }, { session: { activity_panel_height: "7" } })).toBe("7")
	})

	test("without a local gear the config fallback applies", () => {
		expect(resolveBootGear({ session: { activity_panel_height: "10" } }, {})).toBe("10")
		expect(resolveBootGear(undefined, {})).toBeUndefined()
	})

	test("an invalid local gear falls back to config", () => {
		expect(resolveBootGear({ session: { activity_panel_height: "5" } }, decodeUiState({ session: { activity_panel_height: "3" } }))).toBe("5")
	})

	test("boot applies the resolved local gear to the live signal", () => {
		const config = { session: { activity_panel_height: "1" } }
		const local = { session: { activity_panel_height: "7" } }
		const gear = resolveBootGear(config, local)
		expect(gear).toBe("7")
		if (gear !== undefined) applyActivityPanelConfig({ session: { activity_panel_height: gear } })
		expect(activityPanelGear()).toBe("7")
	})
})
