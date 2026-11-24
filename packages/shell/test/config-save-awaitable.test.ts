/**
 * P1 — workspace config write-back is awaitable and disk-assertable.
 *
 * Before the fix `configSave()` launched `saveWorkspaceConfig()` as a bare
 * `void ... .catch(...)` and wrote the skinMigration marker synchronously, so
 * (a) the disk write could not be awaited/asserted, and (b) the marker could
 * land while the workspace config had not (or never did). These tests pin the
 * ordering: workspace config first, marker only on its success, and the
 * failure visible through `await configSave()` / `flushWorkspaceWrites()`.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LocalConfigStore } from "../src/client/local-config-faces.ts"
import { WorkspaceConfigParseError } from "../src/client/workspace-config.ts"

function scratch(tag: string) {
	const home = mkdtempSync(join(tmpdir(), tag))
	const workspace = mkdtempSync(join(tmpdir(), `${tag}-ws-`))
	mkdirSync(join(home, "profiles", "opentui"), { recursive: true })
	mkdirSync(join(workspace, ".dsh"), { recursive: true })
	return {
		home,
		workspace,
		configPath: join(home, "profiles", "opentui", "config.json"),
		wsPath: join(workspace, ".dsh", "config.yml"),
		cleanup: () => {
			rmSync(home, { recursive: true, force: true })
			rmSync(workspace, { recursive: true, force: true })
		},
	}
}

describe("configSave — awaitable workspace write + marker ordering", () => {
	test("await waits for BOTH layers, and the workspace file lands before the marker", async () => {
		const s = scratch("cfg-await-")
		const store = new LocalConfigStore(s.home, "opentui", s.workspace)
		const pending = store.configSave({
			skinMigration: 1,
			workspaceTheme: "dsh-blue",
			workspaceThemeMode: "dark",
		})
		// Synchronous return: the workspace file (atomic tmp+rename) is already
		// on disk, but the profile marker is deferred until that write settles.
		expect(existsSync(s.wsPath)).toBe(true)
		expect(readFileSync(s.wsPath, "utf8")).toContain("theme: dsh-blue")
		expect(existsSync(s.configPath)).toBe(false)

		await pending

		const profile = JSON.parse(readFileSync(s.configPath, "utf8"))
		expect(profile.skinMigration).toBe(1)
		expect(readFileSync(s.wsPath, "utf8")).toContain("themeMode: dark")
		s.cleanup()
	})

	test("workspace write failure rejects the await, rolls back the cache, writes NO marker", async () => {
		const s = scratch("cfg-fail-")
		// Malformed existing file: saveWorkspaceConfig refuses to clobber it.
		writeFileSync(s.wsPath, "theme: t\n\tbroken\n")
		const store = new LocalConfigStore(s.home, "opentui", s.workspace)
		const before = store.workspaceConfig()

		const originalError = console.error
		const logged: unknown[][] = []
		console.error = (...args: unknown[]) => { logged.push(args) }
		let caught: unknown
		try {
			await store.configSave({ skinMigration: 1, workspaceTheme: "x" })
		} catch (error) {
			caught = error
		} finally {
			console.error = originalError
		}

		expect(caught).toBeInstanceOf(WorkspaceConfigParseError)
		expect(store.workspaceConfig()).toEqual(before)
		expect(existsSync(s.configPath)).toBe(false) // marker must not survive a failed workspace write
		expect(logged.length).toBeGreaterThan(0)
		s.cleanup()
	})

	test("configSaveAsync and flushWorkspaceWrites expose the settled write", async () => {
		const s = scratch("cfg-async-")
		const store = new LocalConfigStore(s.home, "opentui", s.workspace)
		const view = await store.configSaveAsync({ workspaceTheme: "dracula", workspaceThemeMode: "light" })
		expect(view.theme).toBe("dracula")
		await store.flushWorkspaceWrites()
		const text = readFileSync(s.wsPath, "utf8")
		expect(text).toContain("theme: dracula")
		expect(text).toContain("themeMode: light")
		s.cleanup()
	})

	test("profile-only configSave keeps its original synchronous behaviour", () => {
		const s = scratch("cfg-sync-")
		const store = new LocalConfigStore(s.home, "opentui", s.workspace)
		store.configSave({ skinMigration: "done", theme: "catppuccin-mocha" })
		const onDisk = JSON.parse(readFileSync(s.configPath, "utf8"))
		expect(onDisk.skinMigration).toBe("done")
		expect(onDisk.theme).toBe("catppuccin-mocha")
		expect(existsSync(s.wsPath)).toBe(false)
		s.cleanup()
	})
})
