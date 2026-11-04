// workspace-config contract tests against files in tmp dirs only (no real
// home-dir writes). Coverage: load (missing dir/file, empty file, valid,
// partial model, malformed yaml with path:line, wrong field types, unknown
// keys ignored, credential-key rejection), merge (env > workspace > base per
// field, partial model merge, bare/trailing-slash env routes), save (0600
// perms, dir creation, round-trip, byte idempotence, unknown-key preservation
// at every depth, presence-is-authority removal semantics, credential-key and
// unknown-key rejection, refuse-to-clobber malformed files, writability
// errors).
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
	ENV_MODEL,
	ENV_THEME,
	WorkspaceConfigCredentialError,
	WorkspaceConfigError,
	WorkspaceConfigParseError,
	WorkspaceConfigWriteError,
	loadWorkspaceConfig,
	mergeConfig,
	saveWorkspaceConfig,
	workspaceConfigPath,
	type Config,
} from "../src/client/workspace-config.ts"

let workspace: string
const configPath = () => join(workspace, ".dsh", "config.yml")

beforeEach(() => {
	workspace = mkdtempSync(join(tmpdir(), "dsh-workspace-config-"))
})

afterEach(() => {
	rmSync(workspace, { recursive: true, force: true })
})

function writeConfig(text: string): void {
	mkdirSync(join(workspace, ".dsh"), { recursive: true })
	writeFileSync(configPath(), text, { mode: 0o600 })
}

const BASE: Config = {
	theme: "base-theme",
	model: { provider: "base-provider", model: "base-model", reasoningEffort: "medium" },
}

describe("loadWorkspaceConfig", () => {
	test("missing workspace dir → empty overlay", async () => {
		const missing = join(workspace, "nope")
		expect(await loadWorkspaceConfig(missing)).toEqual({})
	})

	test("workspace dir without .dsh/config.yml → empty overlay", async () => {
		expect(await loadWorkspaceConfig(workspace)).toEqual({})
	})

	test("empty and comment-only files → empty overlay", async () => {
		writeConfig("")
		expect(await loadWorkspaceConfig(workspace)).toEqual({})
		writeConfig("# just a comment\n\n# another\n")
		expect(await loadWorkspaceConfig(workspace)).toEqual({})
	})

	test("valid file → overlay", async () => {
		writeConfig("theme: catppuccin-mocha\nmodel:\n  provider: deepseek\n  model: deepseek-chat\n  reasoningEffort: high\n")
		expect(await loadWorkspaceConfig(workspace)).toEqual({
			theme: "catppuccin-mocha",
			model: { provider: "deepseek", model: "deepseek-chat", reasoningEffort: "high" },
		})
	})

	test("partial model (only provider) → other subfields fall through at merge time, not load", async () => {
		writeConfig("model:\n  provider: deepseek\n")
		expect(await loadWorkspaceConfig(workspace)).toEqual({ model: { provider: "deepseek" } })
	})

	test("malformed yaml → WorkspaceConfigParseError with path and line", async () => {
		writeConfig("theme: dark\n\tmodel: broken\n")
		try {
			await loadWorkspaceConfig(workspace)
			expect.unreachable()
		} catch (error) {
			expect(error).toBeInstanceOf(WorkspaceConfigParseError)
			expect(error).toBeInstanceOf(WorkspaceConfigError)
			const parse = error as WorkspaceConfigParseError
			expect(parse.path).toBe(configPath())
			expect(parse.line).toBe(2)
			expect(parse.message).toContain(configPath())
			expect(parse.message).toContain(":2:")
		}
	})

	test("unsupported constructs fail closed with line info", async () => {
		writeConfig("list:\n  - a\n")
		expect(loadWorkspaceConfig(workspace)).rejects.toBeInstanceOf(WorkspaceConfigParseError)
		writeConfig("flow: {a: 1}\n")
		expect(loadWorkspaceConfig(workspace)).rejects.toBeInstanceOf(WorkspaceConfigParseError)
		writeConfig("anchor: &a x\n")
		expect(loadWorkspaceConfig(workspace)).rejects.toBeInstanceOf(WorkspaceConfigParseError)
		writeConfig("duplicate: 1\nduplicate: 2\n")
		expect(loadWorkspaceConfig(workspace)).rejects.toBeInstanceOf(WorkspaceConfigParseError)
	})

	test("theme typed wrong → parse error citing the line", async () => {
		writeConfig("theme: 123\n")
		expect(loadWorkspaceConfig(workspace)).rejects.toBeInstanceOf(WorkspaceConfigParseError)
		writeConfig("theme:\n  nested: block\n")
		expect(loadWorkspaceConfig(workspace)).rejects.toBeInstanceOf(WorkspaceConfigParseError)
	})

	test("quoted atomic theme is a string and loads", async () => {
		writeConfig('theme: "123"\n')
		expect(await loadWorkspaceConfig(workspace)).toEqual({ theme: "123" })
	})

	test("unknown keys are ignored in the overlay (and preserved by save, tested there)", async () => {
		writeConfig("theme: t\nfutureFeature:\n  flag: on\n  level: 3\n")
		expect(await loadWorkspaceConfig(workspace)).toEqual({ theme: "t" })
	})

	test("credential-shaped key in file → WorkspaceConfigCredentialError naming the key path", async () => {
		writeConfig("theme: t\nmodel:\n  provider: p\n  apiKey: leaked\n")
		try {
			await loadWorkspaceConfig(workspace)
			expect.unreachable()
		} catch (error) {
			expect(error).toBeInstanceOf(WorkspaceConfigCredentialError)
			expect(error).toBeInstanceOf(WorkspaceConfigError)
			expect((error as WorkspaceConfigCredentialError).keyPath).toBe("model.apiKey")
			expect((error as Error).message).toContain("version control")
		}
	})
})

describe("mergeConfig", () => {
	test("theme precedence: env > workspace > base", () => {
		expect(mergeConfig(BASE, { theme: "ws" }, { [ENV_THEME]: "env" }).theme).toBe("env")
		expect(mergeConfig(BASE, { theme: "ws" }).theme).toBe("ws")
		expect(mergeConfig(BASE, {}).theme).toBe("base-theme")
	})

	test("partial model merge: workspace sets only provider → model/reasoningEffort fall through", () => {
		expect(mergeConfig(BASE, { model: { provider: "ws-provider" } }).model).toEqual({
			provider: "ws-provider",
			model: "base-model",
			reasoningEffort: "medium",
		})
	})

	test("overlay wins field-by-field over base", () => {
		expect(mergeConfig(BASE, { model: { reasoningEffort: "high" } }).model).toEqual({
			provider: "base-provider",
			model: "base-model",
			reasoningEffort: "high",
		})
	})

	test("env model as provider/model overrides the pair; reasoningEffort falls through", () => {
		const merged = mergeConfig(BASE, { model: { provider: "ws-provider" } }, { [ENV_MODEL]: "env-provider/env-model" })
		expect(merged.model).toEqual({ provider: "env-provider", model: "env-model", reasoningEffort: "medium" })
	})

	test("env model split keeps everything after the first slash", () => {
		expect(mergeConfig(BASE, {}, { [ENV_MODEL]: "p/openrouter/vendor/model-x" })?.model?.model).toBe("openrouter/vendor/model-x")
		expect(mergeConfig(BASE, {}, { [ENV_MODEL]: "p/openrouter/vendor/model-x" })?.model?.provider).toBe("p")
	})

	test("bare env model overrides only model.model; provider falls through", () => {
		expect(mergeConfig(BASE, { model: { provider: "ws-provider" } }, { [ENV_MODEL]: "env-model" }).model).toEqual({
			provider: "ws-provider",
			model: "env-model",
			reasoningEffort: "medium",
		})
	})

	test("trailing-slash env model sets provider only", () => {
		expect(mergeConfig(BASE, {}, { [ENV_MODEL]: "env-provider/" }).model).toEqual({
			provider: "env-provider",
			model: "base-model",
			reasoningEffort: "medium",
		})
	})

	test("blank env values are unset at every layer", () => {
		expect(mergeConfig(BASE, {}, { [ENV_THEME]: "", [ENV_MODEL]: "  " }).theme).toBe("base-theme")
		expect(mergeConfig(BASE, { theme: " " }).theme).toBe("base-theme")
	})

	test("no env argument → pure overlay-over-base merge", () => {
		expect(mergeConfig({ theme: "b" }, { theme: "o" })).toEqual({ theme: "o" })
	})

	test("all layers empty → empty result (no empty model branch)", () => {
		expect(mergeConfig({}, {})).toEqual({})
		expect(mergeConfig(BASE, {})).toEqual(BASE)
	})
})

describe("saveWorkspaceConfig", () => {
	test("round trip: save → load returns the overlay", async () => {
		const overlay = { theme: "catppuccin-mocha", model: { provider: "deepseek", model: "deepseek-chat", reasoningEffort: "high" } }
		await saveWorkspaceConfig(workspace, overlay)
		expect(await loadWorkspaceConfig(workspace)).toEqual(overlay)
	})

	test("writes the file 0600 and .dsh 0700", async () => {
		await saveWorkspaceConfig(workspace, { theme: "t" })
		expect(statSync(configPath()).mode & 0o777).toBe(0o600)
		expect(statSync(join(workspace, ".dsh")).mode & 0o777).toBe(0o700)
	})

	test("creates .dsh when the workspace dir exists but .dsh is missing", async () => {
		const fresh = join(workspace, "plain-ws")
		mkdirSync(fresh)
		await saveWorkspaceConfig(fresh, { theme: "t" })
		expect(await loadWorkspaceConfig(fresh)).toEqual({ theme: "t" })
	})

	test("missing workspace dir → WriteError (save never invents a workspace)", async () => {
		const missing = join(workspace, "does-not-exist")
		try {
			await saveWorkspaceConfig(missing, { theme: "t" })
			expect.unreachable()
		} catch (error) {
			expect(error).toBeInstanceOf(WorkspaceConfigWriteError)
			expect((error as Error).message).toMatch(/workspace directory/)
		}
	})

	test("preserves unknown keys at every depth on rewrite", async () => {
		writeConfig("theme: old\nfuture:\n  flag: on\n  count: 3\nmodel:\n  provider: old\n  customHint: keepme\n")
		await saveWorkspaceConfig(workspace, { theme: "new", model: { provider: "new" } })
		const text = await Bun.file(configPath()).text()
		expect(text).toContain("future:")
		expect(text).toContain("flag: on")
		expect(text).toContain("count: 3")
		expect(text).toContain("customHint: keepme")
		expect(await loadWorkspaceConfig(workspace)).toEqual({ theme: "new", model: { provider: "new" } })
	})

	test("byte-idempotent on rewrite", async () => {
		const overlay = { theme: "t", model: { provider: "p", model: "m" } }
		await saveWorkspaceConfig(workspace, overlay)
		const first = await Bun.file(configPath()).text()
		await saveWorkspaceConfig(workspace, overlay)
		expect(await Bun.file(configPath()).text()).toBe(first)
	})

	test("presence is authority: absent keys untouched, explicit undefined removes", async () => {
		writeConfig("theme: t\nother: keep\nmodel:\n  provider: p\n  model: m\n")
		await saveWorkspaceConfig(workspace, {}) // nothing managed → nothing changes
		expect(await loadWorkspaceConfig(workspace)).toEqual({ theme: "t", model: { provider: "p", model: "m" } })

		await saveWorkspaceConfig(workspace, { model: { reasoningEffort: undefined } }) // model block untouched
		expect(await loadWorkspaceConfig(workspace)).toEqual({ theme: "t", model: { provider: "p", model: "m" } })

		await saveWorkspaceConfig(workspace, { theme: undefined }) // explicit removal
		const text = await Bun.file(configPath()).text()
		expect(text).not.toContain("theme:")
		expect(text).toContain("other: keep")
		expect(text).toContain("model:")
		expect(await loadWorkspaceConfig(workspace)).toEqual({ model: { provider: "p", model: "m" } })

		await saveWorkspaceConfig(workspace, { model: { provider: undefined } }) // subfield removal
		expect(await loadWorkspaceConfig(workspace)).toEqual({ model: { model: "m" } })
	})

	test("removing the last managed model subfield drops the block; unknown siblings stay", async () => {
		writeConfig("model:\n  provider: p\n  customHint: keepme\n")
		await saveWorkspaceConfig(workspace, { model: { provider: undefined } })
		const text = await Bun.file(configPath()).text()
		expect(text).toContain("customHint: keepme")
		expect(await loadWorkspaceConfig(workspace)).toEqual({})
	})

	test("refuses to rewrite a malformed file", async () => {
		writeConfig("theme: t\n\tbroken\n")
		try {
			await saveWorkspaceConfig(workspace, { theme: "x" })
			expect.unreachable()
		} catch (error) {
			expect(error).toBeInstanceOf(WorkspaceConfigParseError)
		}
		expect(await Bun.file(configPath()).text()).toContain("\tbroken")
	})

	test("credential-shaped key in the existing file → rejected on save", async () => {
		writeConfig("theme: t\napiKey: leaked\n")
		expect(saveWorkspaceConfig(workspace, { theme: "x" })).rejects.toBeInstanceOf(WorkspaceConfigCredentialError)
		writeConfig("theme: t\nmodel:\n  provider: p\n  api_key: leaked\n")
		expect(saveWorkspaceConfig(workspace, { theme: "x" })).rejects.toBeInstanceOf(WorkspaceConfigCredentialError)
	})

	test("credential-shaped and unknown keys in the overlay itself → rejected with clear errors", async () => {
		expect(saveWorkspaceConfig(workspace, { theme: "t", secret: "x" } as never)).rejects.toBeInstanceOf(
			WorkspaceConfigCredentialError,
		)
		expect(saveWorkspaceConfig(workspace, { model: { provider: "p", apiKey: "x" } as never })).rejects.toBeInstanceOf(
			WorkspaceConfigCredentialError,
		)
		expect(saveWorkspaceConfig(workspace, { theme: "t", futureFeature: true } as never)).rejects.toBeInstanceOf(
			WorkspaceConfigError,
		)
		expect(saveWorkspaceConfig(workspace, { theme: "" })).rejects.toBeInstanceOf(WorkspaceConfigError)
		expect(saveWorkspaceConfig(workspace, { model: { provider: "" } })).rejects.toBeInstanceOf(WorkspaceConfigError)
	})

	test("unwritable .dsh → actionable WorkspaceConfigWriteError", async () => {
		mkdirSync(join(workspace, ".dsh"), { mode: 0o500 })
		try {
			await saveWorkspaceConfig(workspace, { theme: "t" })
			expect.unreachable()
		} catch (error) {
			expect(error).toBeInstanceOf(WorkspaceConfigWriteError)
			expect(error).toBeInstanceOf(WorkspaceConfigError)
			expect((error as Error).message).toMatch(/not writable/)
		} finally {
			chmodSync(join(workspace, ".dsh"), 0o700)
		}
	})

	test("missing workspace dir handled; file (not dir) workspace → WriteError", async () => {
		const notADir = join(workspace, "file")
		writeFileSync(notADir, "")
		expect(saveWorkspaceConfig(notADir, { theme: "t" })).rejects.toBeInstanceOf(WorkspaceConfigWriteError)
	})

	test("file (not dir) at .dsh → WriteError", async () => {
		writeFileSync(join(workspace, ".dsh"), "")
		expect(saveWorkspaceConfig(workspace, { theme: "t" })).rejects.toBeInstanceOf(WorkspaceConfigWriteError)
	})

	test("written file carries the scope header comment", async () => {
		await saveWorkspaceConfig(workspace, { theme: "t" })
		const text = await Bun.file(configPath()).text()
		expect(text).toContain("theme + model preferences ONLY")
		expect(text).toContain("version control")
	})
})

describe("workspaceConfigPath", () => {
	test("joins <workspace>/.dsh/config.yml", () => {
		expect(workspaceConfigPath("/ws")).toBe(join("/ws", ".dsh", "config.yml"))
	})
})
