// T9 retarget — the client-local clusters that survive the HTTP host removal:
// /agents + /repair over a scratch dsh home, the git probe, the preset-document
// executionMode scan, attachment staging helpers, and the LOCAL config seam
// (LocalConfigStore replaces legacy HTTP facade.configLoad/configSave). The
// HTTP-backed facade cases were deleted with legacy HTTP facade.
import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { zstdCompressSync } from "node:zlib"

import { listAgentFiles, repairScanSessions, scanBrokenSessionLogs, setAgentField } from "../src/client/remote-local-fs.ts"
import { probeGitBranchOrSha } from "../src/client/remote-git.ts"
import { toolPresentationModeFromPresetDocument } from "../src/client/remote-exec-mode.ts"
import { attachmentIdsOfPromptContent, imagePromptPart } from "../src/client/remote-attachments.ts"
import { LocalConfigStore } from "../src/client/local-config-faces.ts"

const scratchDirs: string[] = []
function scratchDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix))
	scratchDirs.push(dir)
	return dir
}
afterAll(() => { for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true }) })

describe("row 30 — /agents via client-local FS", () => {
	test("listAgentFiles parses frontmatter", () => {
		const home = scratchDir("wave3-agents-")
		mkdirSync(join(home, "agents"), { recursive: true })
		writeFileSync(join(home, "agents", "fac.md"), "---\nname: fac\ndescription: test agent\n---\nbody\n")
		const rows = listAgentFiles(home)
		expect(rows.map((r) => r.name)).toContain("fac")
		expect(rows.find((r) => r.name === "fac")?.description).toBe("test agent")
	})

	test("setAgentField inserts a frontmatter field", () => {
		const home = scratchDir("wave3-agent-set-")
		mkdirSync(join(home, "agents"), { recursive: true })
		writeFileSync(join(home, "agents", "fac.md"), "---\nname: fac\n---\nbody\n")
		expect(setAgentField("fac", "thinking", "med", home)).toBeUndefined()
		expect(readFileSync(join(home, "agents", "fac.md"), "utf8")).toContain("thinking: med")
	})
})

describe("row 31 + C13 — /repair via client-local scan", () => {
	test("repairScanSessions walks buckets and flags bad tails/magic", () => {
		const home = scratchDir("wave3-repair-")
		const good = join(home, "sessions", "ws-a", "session-1111")
		const empty = join(home, "sessions", "ws-a", "session-2222")
		const badMagic = join(home, "sessions", "ws-b", "session-3333")
		const badJsonl = join(home, "sessions", "ws-b", "session-5555")
		for (const dir of [good, empty, badMagic, badJsonl]) mkdirSync(dir, { recursive: true })
		writeFileSync(join(good, "session.v4.jsonl.zstd"), zstdCompressSync(Buffer.from('{"type":"turn/end"}\n')))
		writeFileSync(join(empty, "session.v4.jsonl.zstd"), Buffer.alloc(0))
		writeFileSync(join(badMagic, "session.v4.jsonl.zstd"), Buffer.from([0, 1, 2, 3, 4]))
		writeFileSync(join(badJsonl, "session.v3.jsonl"), '{"type":"turn/end"}\nnot json\n')
		const report = repairScanSessions(home)
		expect(report.some((line) => line.includes("(0 bytes)"))).toBe(true)
		expect(report.some((line) => line.includes("not a zstd frame"))).toBe(true)
		expect(report.some((line) => line.includes("invalid jsonl tail"))).toBe(true)
	})

	test("scanBrokenSessionLogs reports paths + owning session ids", () => {
		const home = scratchDir("wave3-c13-")
		const dir = join(home, "sessions", "ws-a", "session-bbb2")
		mkdirSync(dir, { recursive: true })
		writeFileSync(join(dir, "session.v3.jsonl"), '{"type":"turn/end"}\nnot json\n')
		const rows = scanBrokenSessionLogs(home)
		expect(rows.find((r) => r.name === "session.v3.jsonl")?.sessionId).toBe("bbb2")
	})
})

describe("row 37 + 39 — local probes", () => {
	const PTC_DOC = [
		"- id: tools",
		'  name: "@deepseek-ai/dsh-tools"',
		"- id: pres",
		'  name: "@deepseek-ai/dsh-agent-tool-presentation"',
		"  config:",
		"    mode: ptc",
	].join("\n")

	test("toolPresentationModeFromPresetDocument reads the row", () => {
		expect(toolPresentationModeFromPresetDocument(PTC_DOC)).toBe("ptc")
		expect(toolPresentationModeFromPresetDocument(PTC_DOC.replace("mode: ptc", "mode: native"))).toBe("native")
		expect(toolPresentationModeFromPresetDocument("")).toBeUndefined()
	})

	test("git probe resolves to a string in a repo", async () => {
		expect(typeof (await probeGitBranchOrSha(process.cwd()))).toBe("string")
	})
})

describe("rows 35/36 — attachment helpers", () => {
	test("imagePromptPart + attachmentIdsOfPromptContent round-trip an admitted ref", () => {
		const part = imagePromptPart({ data: "QUJD", mediaType: "image/png", name: "pixel.png", bytes: 3 })
		expect(part).toEqual({ type: "image", mediaType: "image/png", data: "QUJD", name: "pixel.png" })
		expect(attachmentIdsOfPromptContent([
			{ type: "text", text: "caption" },
			{ type: "image", attachment: { attachmentId: "att-1", mediaType: "image/png" } },
			{ type: "image" },
		])).toEqual(["att-1"])
	})
})

describe("row 41 — LOCAL config seam (T9: was legacy HTTP facade)", () => {
	test("configLoad = profile config.json ⊕ workspace config.yml", () => {
		const home = scratchDir("wave3-config-")
		const workspace = scratchDir("wave3-ws-")
		mkdirSync(join(home, "profiles", "opentui"), { recursive: true })
		mkdirSync(join(workspace, ".dsh"), { recursive: true })
		writeFileSync(join(home, "profiles", "opentui", "config.json"), JSON.stringify({ theme: "dsh-blue", motion: "full" }))
		writeFileSync(join(workspace, ".dsh", "config.yml"), "theme: dracula\nthemeMode: dark\nmodel:\n  provider: deepseek\n  model: deepseek-chat\n")
		const cfg = new LocalConfigStore(home, "opentui", workspace)
		expect(cfg.configLoad().theme).toBe("dracula")
		expect(cfg.configLoad().themeMode).toBe("dark")
		expect((cfg.configLoad().model as Record<string, string>).provider).toBe("deepseek")
		expect(cfg.configLoad().motion).toBe("full")
	})

	test("configSave writes the migration marker + profile theme to config.json", () => {
		const home = scratchDir("wave3-config-save-")
		mkdirSync(join(home, "profiles", "opentui"), { recursive: true })
		const store = new LocalConfigStore(home, "opentui", home)
		store.configSave({ skinMigration: "done", theme: "catppuccin-mocha" })
		const onDisk = JSON.parse(readFileSync(join(home, "profiles", "opentui", "config.json"), "utf8"))
		expect(onDisk.skinMigration).toBe("done")
		expect(onDisk.theme).toBe("catppuccin-mocha")
	})

	test("configSave routes workspaceTheme/themeMode into the workspace overlay", () => {
		const home = scratchDir("wave3-config-overlay-")
		const workspace = scratchDir("wave3-overlay-ws-")
		mkdirSync(join(home, "profiles", "opentui"), { recursive: true })
		const store = new LocalConfigStore(home, "opentui", workspace)
		store.configSave({ workspaceTheme: "dracula", workspaceThemeMode: "light" })
		expect(store.workspaceConfig().theme).toBe("dracula")
		expect(store.workspaceConfig().themeMode).toBe("light")
		// No profile write when the patch only targets the workspace layer.
		expect(existsSync(join(home, "profiles", "opentui", "config.json"))).toBe(false)
	})
})
