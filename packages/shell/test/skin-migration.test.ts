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

describe("skin migration plan (α skin layer, one-shot)", () => {
	test("a legacy theme key with no marker migrates to dsh-blue once", () => {
		const plan = skinMigrationPlan({ theme: "aura" })
		expect(plan).toBeDefined()
		expect(plan?.theme).toBe(SKIN_MIGRATION_THEME)
		expect(plan?.skinMigration).toBe(1)
		expect(plan?.notice).toBe(SKIN_MIGRATION_NOTICE)
		expect(SKIN_MIGRATION_NOTICE).toContain("dsh-blue")
	})

	test("no theme key (fresh user) → no migration, no notice", () => {
		expect(skinMigrationPlan({})).toBeUndefined()
		expect(skinMigrationPlan({ theme: "" })).toBeUndefined()
		expect(skinMigrationPlan({ theme: 42 })).toBeUndefined()
	})

	test("an existing marker (any value) → never re-migrates", () => {
		expect(skinMigrationPlan({ theme: "aura", skinMigration: 1 })).toBeUndefined()
		expect(skinMigrationPlan({ theme: "tokyonight", skinMigration: 2 })).toBeUndefined()
	})

	test("already on dsh-blue → no migration (no pointless notice)", () => {
		expect(skinMigrationPlan({ theme: SKIN_MIGRATION_THEME })).toBeUndefined()
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
