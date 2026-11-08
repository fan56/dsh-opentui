import { describe, expect, test } from "bun:test"
import {
	SKIN_MIGRATION_NOTICE,
	SKIN_MIGRATION_THEME,
	skinMigrationPlan,
	themeModeFromConfig,
} from "../src/client/boot-shared.ts"
import type { ShellSessionSurface } from "../src/client/shell-session.ts"

function fakeSession(config: Record<string, unknown>): ShellSessionSurface {
	return { configLoad: () => config } as unknown as ShellSessionSurface
}

describe("skin migration plan (α skin layer, one-shot, layered)", () => {
	test("a legacy PROFILE theme key with no marker migrates once, at the profile layer", () => {
		const plan = skinMigrationPlan({ profileConfig: { theme: "aura" }, workspaceConfig: {} })
		expect(plan).toBeDefined()
		expect(plan?.layer).toBe("profile")
		expect(plan?.theme).toBe(SKIN_MIGRATION_THEME)
		expect(plan?.skinMigration).toBe(1)
		expect(plan?.notice).toBe(SKIN_MIGRATION_NOTICE)
		expect(SKIN_MIGRATION_NOTICE).toContain("dsh-blue")
	})

	test("a legacy WORKSPACE theme key migrates once, written back to the workspace layer", () => {
		const plan = skinMigrationPlan({
			profileConfig: {},
			workspaceConfig: { theme: "tokyonight" },
		})
		expect(plan).toBeDefined()
		expect(plan?.layer).toBe("workspace")
		expect(plan?.theme).toBe(SKIN_MIGRATION_THEME)
	})

	test("no stored theme key (fresh user) → no migration, no notice", () => {
		expect(skinMigrationPlan({ profileConfig: {}, workspaceConfig: {} })).toBeUndefined()
		expect(skinMigrationPlan({ profileConfig: { theme: "" }, workspaceConfig: {} })).toBeUndefined()
		expect(skinMigrationPlan({ profileConfig: { theme: 42 }, workspaceConfig: {} })).toBeUndefined()
	})

	test("an existing marker (any value) → never re-migrates", () => {
		expect(skinMigrationPlan({ profileConfig: { theme: "aura", skinMigration: 1 }, workspaceConfig: {} })).toBeUndefined()
		expect(
			skinMigrationPlan({ profileConfig: { skinMigration: 2 }, workspaceConfig: { theme: "tokyonight" } }),
		).toBeUndefined()
	})

	test("already on dsh-blue (either layer) → no migration (no pointless notice)", () => {
		expect(skinMigrationPlan({ profileConfig: { theme: SKIN_MIGRATION_THEME }, workspaceConfig: {} })).toBeUndefined()
		expect(skinMigrationPlan({ profileConfig: {}, workspaceConfig: { theme: SKIN_MIGRATION_THEME } })).toBeUndefined()
	})

	test("an env-pinned theme (DSH_OPENTUI_THEME) skips the migration — not a stored choice", () => {
		expect(
			skinMigrationPlan({ profileConfig: { theme: "aura" }, workspaceConfig: {}, envTheme: "dracula" }),
		).toBeUndefined()
		// empty string = unset (the mergeConfig convention) → migration proceeds
		const plan = skinMigrationPlan({ profileConfig: { theme: "aura" }, workspaceConfig: {}, envTheme: "" })
		expect(plan?.layer).toBe("profile")
	})

	test("profile-layer theme wins the layer decision when both layers carry one", () => {
		const plan = skinMigrationPlan({ profileConfig: { theme: "aura" }, workspaceConfig: { theme: "tokyonight" } })
		expect(plan?.layer).toBe("profile")
	})
})

describe("themeModeFromConfig (α skin layer, auto/dark/light)", () => {
	test("dark/light pin, anything else (incl. auto) stays undefined", () => {
		expect(themeModeFromConfig(fakeSession({ themeMode: "dark" }))).toBe("dark")
		expect(themeModeFromConfig(fakeSession({ themeMode: "light" }))).toBe("light")
		expect(themeModeFromConfig(fakeSession({ themeMode: "auto" }))).toBeUndefined()
		expect(themeModeFromConfig(fakeSession({ themeMode: "system" }))).toBeUndefined()
		expect(themeModeFromConfig(fakeSession({}))).toBeUndefined()
		expect(themeModeFromConfig(fakeSession({ themeMode: 3 }))).toBeUndefined()
	})

	test("a throwing configLoad degrades to auto", () => {
		const throwing = { configLoad: () => { throw new Error("no host") } } as unknown as ShellSessionSurface
		expect(themeModeFromConfig(throwing)).toBeUndefined()
	})
})
