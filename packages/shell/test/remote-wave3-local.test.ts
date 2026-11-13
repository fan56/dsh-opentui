// Wave-3 client-local clusters (audit rows 30/31/35/36/37/39/41): /agents +
// /repair over a scratch dsh home, the git probe, the preset-document
// executionMode scan, the attachment upload/prompt-part + /api/file bytes
// paths, and the workspace-overlay config seam — all against tmp dirs,
// fakes, and one local HTTP server for the /api/file route.
import { afterAll, describe, expect, test } from "bun:test"
import { appendFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { zstdCompressSync } from "node:zlib"
import { listAgentFiles, repairScanSessions, repairSessionLogTail, scanBrokenSessionLogs, setAgentField } from "../src/client/remote-local-fs.ts"
import { probeGitBranch, probeGitBranchOrSha } from "../src/client/remote-git.ts"
import { toolPresentationModeFromPresetDocument } from "../src/client/remote-exec-mode.ts"
import { attachmentIdsOfPromptContent, fetchHostFile, HostFileError, imagePromptPart, readImageAttachment } from "../src/client/remote-attachments.ts"
import { RemoteHostSession } from "../src/client/remote-host-session.ts"
import { FakeConnection, FakeMuxSocket, rpcOf, snapshotFrame, eventFrame, until } from "./client-fakes.ts"
import type { ClientConnection } from "../src/client/transport.ts"
import type { TurnCallbacks } from "../src/agent/loop.ts"

// ---------------------------------------------------------------------------
// Scratch dirs
// ---------------------------------------------------------------------------

const scratchDirs: string[] = []
function scratchDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix))
	scratchDirs.push(dir)
	return dir
}
afterAll(() => {
	for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true })
})

/** The canonical 1x1 PNG (69 bytes) — the attachment round-trip fixture. */
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64")

// ---------------------------------------------------------------------------
// Row 30 — /agents client-local FS
// ---------------------------------------------------------------------------

describe("row 30 — /agents via client-local FS", () => {
	test("listAgentFiles mirrors host-session frontmatter parsing; broken files reported", () => {
		const home = scratchDir("dsh-wave3-home-")
		mkdirSync(join(home, "agents"), { recursive: true })
		writeFileSync(
			join(home, "agents", "reviewer.md"),
			`---\nname: reviewer\ndisplay_name: "Code Reviewer"\ndescription: reviews code\nmodel: zai-coding-cn/glm-5.3-flash\nthinking: high\n---\n\nBody here.\n`,
		)
		writeFileSync(join(home, "agents", "plain.md"), "no frontmatter at all\n")
		writeFileSync(join(home, "agents", "skip.txt"), "not an agent file")
		// broken: a directory where a file should be trips readFileSync → broken row
		mkdirSync(join(home, "agents", "broken.md"))
		const rows = listAgentFiles(home)
		const reviewer = rows.find((r) => r.name === "reviewer")
		expect(reviewer?.displayName).toBe("Code Reviewer")
		expect(reviewer?.description).toBe("reviews code")
		expect(reviewer?.model).toBe("zai-coding-cn/glm-5.3-flash")
		expect(reviewer?.thinking).toBe("high")
		expect(reviewer?.file).toBe(join(home, "agents", "reviewer.md"))
		expect(reviewer?.deep).toBe(1)
		expect(rows.find((r) => r.name === "plain")).toBeDefined()
		expect(rows.find((r) => r.broken !== undefined)?.broken).toBeDefined()
		expect(rows.some((r) => r.name === "skip")).toBe(false)
	})

	test("listAgentFiles on a missing agents dir is empty (no throw)", () => {
		expect(listAgentFiles(scratchDir("dsh-wave3-home-"))).toEqual([])
	})

	test("setAgentField: replace, insert into frontmatter, prepend to body-only", () => {
		const home = scratchDir("dsh-wave3-home-")
		mkdirSync(join(home, "agents"), { recursive: true })
		const file = join(home, "agents", "a.md")
		writeFileSync(file, "---\nname: a\nmodel: old/provider\n---\n\nbody\n")
		setAgentField("a", "model", "new/provider", home)
		expect(readFileSync(file, "utf8")).toContain("model: new/provider")
		expect(readFileSync(file, "utf8")).not.toContain("old/provider")

		writeFileSync(file, "---\nname: a\n---\n\nbody\n")
		setAgentField("a", "thinking", "high", home)
		// tui-pi parity: a missing key is inserted before the closing fence
		expect(readFileSync(file, "utf8")).toBe("---\nname: a\nthinking: high\n---\n\nbody\n")

		// no frontmatter: the write is refused (never invents a block)
		writeFileSync(file, "just a body\n")
		expect(setAgentField("a", "deep", "3", home)).toContain("missing frontmatter")
		expect(readFileSync(file, "utf8")).toBe("just a body\n")

		// deep is a non-negative integer; null deletes the key
		writeFileSync(file, "---\nname: a\ndeep: 2\n---\n\nbody\n")
		expect(setAgentField("a", "deep", "on", home)).toContain("non-negative integer")
		setAgentField("a", "deep", "3", home)
		expect(readFileSync(file, "utf8")).toContain("deep: 3")
		setAgentField("a", "deep", null, home)
		expect(readFileSync(file, "utf8")).not.toContain("deep:")
	})

	test("facade listAgents/agentSet ride the dshHome option", () => {
		const home = scratchDir("dsh-wave3-home-")
		mkdirSync(join(home, "agents"), { recursive: true })
		writeFileSync(join(home, "agents", "fac.md"), "---\nname: fac\nmodel: p/m\n---\n")
		const { session } = makeFacade({ dshHome: home })
		expect(session.listAgents().map((r) => r.name)).toEqual(["fac"])
		session.agentSet("fac", "thinking", "med")
		expect(listAgentFiles(home)[0]!.thinking).toBe("med")
		session.dispose()
	})
})

// ---------------------------------------------------------------------------
// Row 31 — /repair client-local scan
// ---------------------------------------------------------------------------

describe("row 31 — /repair via client-local scan", () => {
	test("walks buckets, checks zstd magic + jsonl tails (HostSession report parity)", () => {
		const home = scratchDir("dsh-wave3-home-")
		const good = join(home, "sessions", "ws-a", "session-1111")
		mkdirSync(good, { recursive: true })
		writeFileSync(join(good, "session.v4.jsonl.zstd"), zstdCompressSync(Buffer.from('{"type":"turn/end"}\n')))
		const empty = join(home, "sessions", "ws-a", "session-2222")
		mkdirSync(empty, { recursive: true })
		writeFileSync(join(empty, "session.v4.jsonl.zstd"), Buffer.alloc(0))
		const badMagic = join(home, "sessions", "ws-b", "session-3333")
		mkdirSync(badMagic, { recursive: true })
		writeFileSync(join(badMagic, "session.v4.jsonl.zstd"), Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]))
		const goodJsonl = join(home, "sessions", "ws-b", "session-4444")
		mkdirSync(goodJsonl, { recursive: true })
		writeFileSync(join(goodJsonl, "session.v3.jsonl"), '{"type":"turn/end"}\n')
		const badJsonl = join(home, "sessions", "ws-b", "session-5555")
		mkdirSync(badJsonl, { recursive: true })
		writeFileSync(join(badJsonl, "session.v3.jsonl"), '{"type":"turn/end"}\nnot json\n')

		const report = repairScanSessions(home)
		expect(report[0]).toBe("sessions: 5 logs scanned, 2 healthy")
		expect(report[1]).toBe("broken: 3")
		expect(report.some((l) => l.includes("session.v4.jsonl.zstd (0 bytes)"))).toBe(true)
		expect(report.some((l) => l.includes("(not a zstd frame"))).toBe(true)
		expect(report.some((l) => l.includes("(invalid jsonl tail)"))).toBe(true)
		expect(report.filter((l) => l.includes("✗")).length).toBe(3)
	})

	test("missing sessions dir → the no-sessions line; facade repairScan rides dshHome", () => {
		const home = scratchDir("dsh-wave3-home-")
		expect(repairScanSessions(home)).toEqual(["no sessions directory"])
		const { session } = makeFacade({ dshHome: home })
		expect(session.repairScan()).toEqual(["no sessions directory"])
		session.dispose()
	})
})

// ---------------------------------------------------------------------------
// Row 39 — git segment probe
// ---------------------------------------------------------------------------

describe("row 39 — git branch probe", () => {
	test("returns the real branch in a repo, empty outside one", async () => {
		const branch = await probeGitBranch(import.meta.dir)
		expect(branch).not.toBe("")
		const outside = await probeGitBranch(tmpdir())
		expect(outside).toBe("")
	})

	test("facade gitBranch defaults to the workspace cwd option", async () => {
		const { session } = makeFacade({ cwd: import.meta.dir })
		expect(await session.gitBranch()).not.toBe("")
		await session.dispose()
	})

	// Composer-context batch: the row's probe is branch-or-SHA. A regular
	// checkout answers the branch (same as the row-39 probe); a detached HEAD
	// answers the short SHA; outside a repo / on failure it stays "".
	test("branch-or-SHA probe: branch in a repo, short SHA when detached, empty outside", async () => {
		expect(await probeGitBranchOrSha(import.meta.dir)).toBe(await probeGitBranch(import.meta.dir))
		expect(await probeGitBranchOrSha(tmpdir())).toBe("")

		const repo = scratchDir("dsh-git-detached-")
		const git = (...args: string[]) =>
			spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], {
				cwd: repo,
				encoding: "utf8",
			})
		spawnSync("git", ["init", "-q"], { cwd: repo })
		writeFileSync(join(repo, "a.txt"), "one\n")
		expect(spawnSync("git", ["add", "."], { cwd: repo }).status).toBe(0)
		expect(git("commit", "-q", "-m", "one").status).toBe(0)
		const named = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim()
		expect(await probeGitBranchOrSha(repo)).toBe(named)
		expect(named).not.toBe("HEAD")
		expect(spawnSync("git", ["checkout", "-q", "--detach", "HEAD"], { cwd: repo }).status).toBe(0)
		expect(await probeGitBranchOrSha(repo)).toMatch(/^[0-9a-f]{7,}$/)
	})
})

// ---------------------------------------------------------------------------
// Row 37 — executionMode preset-document scan
// ---------------------------------------------------------------------------

const PTC_DOC = [
	"- id: tools",
	'  name: "@deepseek-ai/dsh-tools"',
	"- id: pres",
	'  name: "@deepseek-ai/dsh-agent-tool-presentation"',
	"  config:",
	"    mode: ptc",
].join("\n")

describe("row 37 — executionMode discriminator", () => {
	test("reads the tool-presentation row's mode", () => {
		expect(toolPresentationModeFromPresetDocument(PTC_DOC)).toBe("ptc")
		expect(toolPresentationModeFromPresetDocument(PTC_DOC.replace("mode: ptc", "mode: native"))).toBe("native")
	})
	test("no row → undefined (deployment default); unreadable mode → undefined", () => {
		expect(toolPresentationModeFromPresetDocument('- name: "@deepseek-ai/dsh-tools"\n  config:\n    a: b\n')).toBeUndefined()
		expect(toolPresentationModeFromPresetDocument(PTC_DOC.replace("mode: ptc", "mode: banana"))).toBeUndefined()
		expect(toolPresentationModeFromPresetDocument("")).toBeUndefined()
	})
	test("facade probes on preset adoption (ptc)", async () => {
		const { session, connection } = makeFacade({
			rpcHandler: (method) => (method === "agentPresets/read" ? { agentPreset: "ptc-set", content: PTC_DOC } : defaultRpc(method)),
		})
		expect(session.executionMode()).toBe("native")
		session.switchPreset("ptc-set")
		await until(() => session.executionMode() === "ptc")
		expect(rpcOf(connection, "agentPresets/read")!.agentPreset).toBe("ptc-set")
		await session.dispose()
	})
	test("no active preset → native (documented deployment-default assumption)", async () => {
		const { session } = makeFacade()
		await session.start()
		await new Promise((r) => setTimeout(r, 30))
		expect(session.executionMode()).toBe("native")
		await session.dispose()
	})
})

// ---------------------------------------------------------------------------
// Rows 35 + 36 — attachments
// ---------------------------------------------------------------------------

describe("rows 35 + 36 — attachment staging, receipts, /api/file bytes", () => {
	test("readImageAttachment: media-type map + base64 + leaf name; unsupported ext throws", async () => {
		const dir = scratchDir("dsh-wave3-img-")
		const path = join(dir, "pixel.png")
		writeFileSync(path, PNG_1PX)
		const staged = await readImageAttachment(path)
		expect(staged.mediaType).toBe("image/png")
		expect(staged.name).toBe("pixel.png")
		expect(staged.bytes).toBe(PNG_1PX.byteLength)
		expect(Buffer.from(staged.data, "base64").equals(PNG_1PX)).toBe(true)
		await expect(readImageAttachment(join(dir, "notes.txt"))).rejects.toThrow(/unsupported image type/)
	})

	test("imagePromptPart + attachmentIdsOfPromptContent round-trip the admitted ref", () => {
		const part = imagePromptPart({ data: "QUJD", mediaType: "image/png", name: "pixel.png", bytes: 3 })
		expect(part).toEqual({ type: "image", mediaType: "image/png", data: "QUJD", name: "pixel.png" })
		expect(
			attachmentIdsOfPromptContent([
				{ type: "text", text: "caption" },
				{ type: "image", attachment: { attachmentId: "att-1", mediaType: "image/png" } },
				{ type: "image" },
			]),
		).toEqual(["att-1"])
		expect(attachmentIdsOfPromptContent(undefined)).toEqual([])
	})

	test("attachImage stages and the next turn carries the inline image part (admitted id read-back)", async () => {
		const dir = scratchDir("dsh-wave3-img-")
		const imagePath = join(dir, "pixel.png")
		writeFileSync(imagePath, PNG_1PX)
		const { session, connection } = makeFacade({ rpcHandler: (method) => defaultRpc(method) })
		const echo = await session.attachImage(imagePath)
		expect(echo).toBe(`pixel.png (${Math.round(PNG_1PX.byteLength / 1024)} KB)`)
		expect(session.lastAttachmentIds()).toEqual([]) // nothing sent yet

		const { cb } = callbacks()
		const pending = session.turn("what is this", cb)
		await until(() => lastSocket(connection) !== undefined)
		lastSocket(connection)!.item(snapshotFrame("sess-1")) // attach completes on the snapshot
		await until(() => rpcOf(connection, "session/prompt") !== undefined)
		const prompt = rpcOf(connection, "session/prompt")!.request as { content: Record<string, unknown>[] }
		expect(prompt.content[0]).toEqual({ type: "text", text: "what is this" })
		// the inline image part (chosen wire route — remote-attachments.ts)
		expect(prompt.content[1]).toMatchObject({ type: "image", mediaType: "image/png", name: "pixel.png" })
		expect(Buffer.from(prompt.content[1]!.data as string, "base64").equals(PNG_1PX)).toBe(true)

		// the admitted ref arrives on the durable user/message journal record
		lastSocket(connection)!.item(
			eventFrame(
				"user/message",
				{ content: [{ type: "text", text: "what is this" }, { type: "image", attachment: { attachmentId: "att-1", mediaType: "image/png", bytes: PNG_1PX.byteLength, width: 1, height: 1 } }] },
				1,
			),
		)
		lastSocket(connection)!.item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 2))
		await pending
		expect(session.lastAttachmentIds()).toEqual(["att-1"])

		// consumed: the staged image does NOT ride a second turn
		connection.rpcCalls.length = 0
		const pending2 = session.turn("again", cb)
		await until(() => rpcOf(connection, "session/prompt") !== undefined)
		const prompt2 = rpcOf(connection, "session/prompt")!.request as { content: unknown[] }
		expect(prompt2.content).toEqual([{ type: "text", text: "again" }])
		lastSocket(connection)!.item(eventFrame("turn/end", { turn: 2, reason: { kind: "completed" } }, 3))
		await pending2
		// the read-back surface still reports the last admitted ref
		expect(session.lastAttachmentIds()).toEqual(["att-1"])
		await session.dispose()
	})

	test("fetchHostFile reads bytes via GET /api/file (413/404 typed)", async () => {
		const server = Bun.serve({
			port: 0,
			fetch: (request) => {
				const path = new URL(request.url).searchParams.get("path") ?? ""
				if (request.headers.get("cookie") !== "dsh-auth-x=v1.test") return new Response("no", { status: 401 })
				if (path === "/big.bin") return new Response("too large", { status: 413 })
				if (path === "/missing.bin") return new Response("nope", { status: 404 })
				return new Response(PNG_1PX)
			},
		})
		try {
			const base = `http://127.0.0.1:${server.port}`
			const bytes = await fetchHostFile(base, "dsh-auth-x=v1.test", "/tmp/tool-image.png")
			expect(Buffer.from(bytes).equals(PNG_1PX)).toBe(true)
			await expect(fetchHostFile(base, "dsh-auth-x=v1.test", "/big.bin")).rejects.toThrow(HostFileError)
			await expect(fetchHostFile(base, "dsh-auth-x=v1.test", "/missing.bin")).rejects.toThrow(/HTTP 404/)
		} finally {
			server.stop(true)
		}
	})
})

// ---------------------------------------------------------------------------
// Row 41 — config seam (workspace overlay ⊕ profile base ⊕ env)
// ---------------------------------------------------------------------------

describe("row 41 — config seam wiring", () => {
	test("configLoad = profile config.json ⊕ workspace config.yml ⊕ env", async () => {
		const home = scratchDir("dsh-wave3-home-")
		const workspace = scratchDir("dsh-wave3-ws-")
		mkdirSync(join(home, "profiles", "opentui"), { recursive: true })
		writeFileSync(join(home, "profiles", "opentui", "config.json"), JSON.stringify({ retentionDays: 7, theme: "base", dockRows: 3 }))
		mkdirSync(join(workspace, ".dsh"), { recursive: true })
		writeFileSync(join(workspace, ".dsh", "config.yml"), `# overlay\ntheme: tokyo-night\nmodel:\n  provider: deepseek\n  model: deepseek-chat\n`)
		const { session } = makeFacade({ dshHome: home, workspaceDir: workspace })
		await session.refreshWorkspaceConfig()
		const cfg = session.configLoad()
		expect(cfg.retentionDays).toBe(7) // base-only key passes through
		expect(cfg.dockRows).toBe(3)
		expect(cfg.theme).toBe("tokyo-night") // overlay wins over base
		expect(cfg.model).toEqual({ provider: "deepseek", model: "deepseek-chat" })

		// env layer wins over the overlay (bucket-(d) precedence)
		const previousTheme = process.env.DSH_OPENTUI_THEME
		process.env.DSH_OPENTUI_THEME = "dracula"
		try {
			expect(session.configLoad().theme).toBe("dracula")
		} finally {
			if (previousTheme === undefined) delete process.env.DSH_OPENTUI_THEME
			else process.env.DSH_OPENTUI_THEME = previousTheme
		}
		await session.dispose()
	})

	test("configSave splits: theme + plugin keys → profile config.json, model → config.yml", async () => {
		const home = scratchDir("dsh-wave3-home-")
		const workspace = scratchDir("dsh-wave3-ws-")
		const { session } = makeFacade({ dshHome: home, workspaceDir: workspace })
		session.configSave({ retentionDays: 3, favoriteModels: ["a/b"] })
		const profilePath = join(home, "profiles", "opentui", "config.json")
		const profile = JSON.parse(readFileSync(profilePath, "utf8")) as Record<string, unknown>
		expect(profile.retentionDays).toBe(3)
		expect(profile.favoriteModels).toEqual(["a/b"])

		// 67-theme regression (batch F7b contract): theme persists as the
		// PROFILE config.json `"theme"` key (host-face parity) — the
		// pre-fix workspace-overlay routing left the scratch home without
		// any theme key and broke the persistence/restart e2e arms.
		session.configSave({ theme: "catppuccin-mocha" })
		const themed = JSON.parse(readFileSync(profilePath, "utf8")) as Record<string, unknown>
		expect(themed.theme).toBe("catppuccin-mocha")
		expect(session.configLoad().theme).toBe("catppuccin-mocha")

		// the model key still rides the workspace overlay (async write)
		session.configSave({ model: { provider: "deepseek", model: "deepseek-chat" } })
		const overlayPath = join(workspace, ".dsh", "config.yml")
		await until(() => {
			try {
				return readFileSync(overlayPath, "utf8").includes("deepseek-chat")
			} catch {
				return false
			}
		})
		const overlayText = readFileSync(overlayPath, "utf8")
		expect(overlayText).toContain("provider: deepseek")
		// theme never leaks into the workspace overlay (scope guard; the
		// baked header comment mentions the word — match the key form)
		expect(overlayText).not.toMatch(/^theme:/m)
		expect(overlayText).not.toContain("retentionDays")
		await session.dispose()
	})

	test("configSave with an undefined value DELETES the key (settings empty = unset)", async () => {
		const home = scratchDir("dsh-wave3-home-")
		const { session } = makeFacade({ dshHome: home })
		session.configSave({ retentionDays: 30, maxRounds: 4 })
		const profilePath = join(home, "profiles", "opentui", "config.json")
		expect((JSON.parse(readFileSync(profilePath, "utf8")) as Record<string, unknown>).retentionDays).toBe(30)
		// planLocalWrite's empty number input builds `{ [key]: undefined }`;
		// the profile writer merges the patch and JSON drops undefined keys —
		// the key must be GONE from the file (not null, not present).
		session.configSave({ retentionDays: undefined })
		const after = JSON.parse(readFileSync(profilePath, "utf8")) as Record<string, unknown>
		expect("retentionDays" in after).toBe(false)
		expect(after.maxRounds).toBe(4) // sibling keys survive
		await session.dispose()
	})

	test("keybindingsLoad reads the profile root (HostSession path semantics)", () => {
		const home = scratchDir("dsh-wave3-home-")
		mkdirSync(join(home, "profiles", "opentui"), { recursive: true })
		writeFileSync(join(home, "profiles", "opentui", "keybindings.json"), JSON.stringify({ viewer: "ctrl+g" }))
		const { session } = makeFacade({ dshHome: home })
		expect(session.keybindingsLoad()).toEqual({ viewer: "ctrl+g" })
		expect(session.configPath("keybindings.json")).toBe(join(home, "profiles", "opentui", "keybindings.json"))
		session.dispose()
	})

	test("listSessions filters btw:-titled throwaway rows (row 32 pollution cap)", async () => {
		const { session } = makeFacade({
			rpcHandler: (method) => {
				if (method === "session/list") {
					return {
						items: [
							{ sessionId: "btw-1", updatedAt: Date.now(), running: false, blank: false, projections: { values: { title: "btw: what is a pec" } } },
							{ sessionId: "real-1", updatedAt: Date.now(), running: false, blank: false, projections: { values: { title: "real work" } } },
						],
					}
				}
				return defaultRpc(method)
			},
		})
		const rows = await session.listSessions()
		expect(rows.map((r) => r.id)).toEqual(["real-1"])
		await session.dispose()
	})
})

// ---------------------------------------------------------------------------
// Shared facade harness (fake connection + fake mux sockets)
// ---------------------------------------------------------------------------

interface Facade {
	connection: FakeConnection
	session: RemoteHostSession
}

const socketRegistry = new WeakMap<object, FakeMuxSocket[]>()

function makeFacade(
	options: { cwd?: string; dshHome?: string; workspaceDir?: string; rpcHandler?: (method: string, args: Record<string, unknown>) => unknown } = {},
): Facade {
	const connection = new FakeConnection()
	if (options.rpcHandler) connection.rpcHandler = options.rpcHandler
	const session = new RemoteHostSession({
		connection: connection as unknown as ClientConnection,
		cookieHeader: "dsh-auth-x=v1.test",
		cwd: options.cwd ?? "/tmp/workspace",
		...(options.dshHome !== undefined ? { dshHome: options.dshHome } : {}),
		...(options.workspaceDir !== undefined ? { workspaceDir: options.workspaceDir } : {}),
		socketFactory: () => {
			const socket = new FakeMuxSocket()
			const list = socketRegistry.get(connection) ?? []
			list.push(socket)
			socketRegistry.set(connection, list)
			return socket
		},
	})
	return { connection, session }
}

function lastSocket(connection: object): FakeMuxSocket | undefined {
	const list = socketRegistry.get(connection) ?? []
	return list.length > 0 ? list[list.length - 1] : undefined
}

/** Accept session/create + session/prompt with a stable session id. */
function defaultRpc(method: string): unknown {
	if (method === "session/create") return { sessionId: "sess-1" }
	if (method === "session/prompt") return { accepted: true }
	if (method === "session/cancel") return { accepted: true }
	return {}
}

function callbacks(overrides: Partial<TurnCallbacks> = {}): { cb: TurnCallbacks } {
	return {
		cb: {
			onThinkingDelta: () => {},
			onContentDelta: () => {},
			onTurnEnd: () => {},
			onApprove: async () => true,
			onToolRun: () => {},
			onError: () => {},
			...overrides,
		},
	}
}

// ---------------------------------------------------------------------------
// C13 — /resume corrupt-log repair flow (client-local scan + guarded tail
// repair beside the row-31 scan base; the base itself is untouched)
// ---------------------------------------------------------------------------

describe("C13 — scanBrokenSessionLogs (structured row-31 sibling)", () => {
	test("reports broken logs with paths + owning session ids (same criteria as repairScanSessions)", () => {
		const home = scratchDir("dsh-c13-home-")
		const good = join(home, "sessions", "ws-a", "session-aaa1")
		mkdirSync(good, { recursive: true })
		writeFileSync(
			join(good, "session.v4.jsonl.zstd"),
			zstdCompressSync(Buffer.from('{"type":"turn/start"}\n{"type":"turn/end"}\n')),
		)
		const badTail = join(home, "sessions", "ws-a", "session-bbb2")
		mkdirSync(badTail, { recursive: true })
		writeFileSync(join(badTail, "session.v3.jsonl"), '{"type":"turn/end"}\nnot json\n')
		const noDir = join(home, "sessions", "loose.v3.jsonl")
		mkdirSync(join(home, "sessions"), { recursive: true })
		writeFileSync(noDir, '{"type":"x"}\njunk\n')

		const broken = scanBrokenSessionLogs(home)
		const bbb2 = broken.find((r) => r.name === "session.v3.jsonl" && r.path.includes("session-bbb2"))
		expect(bbb2?.reason).toBe("invalid jsonl tail")
		expect(bbb2?.sessionId).toBe("bbb2")
		// a log directly under sessions/ carries no session id
		const loose = broken.find((r) => r.path === noDir)
		expect(loose?.sessionId).toBeUndefined()
		// healthy logs are absent
		expect(broken.some((r) => r.path.includes("session-aaa1"))).toBe(false)
	})

	test("missing sessions dir → empty (never throws)", () => {
		expect(scanBrokenSessionLogs(scratchDir("dsh-c13-empty-"))).toEqual([])
	})
})

describe("C13 — repairSessionLogTail (guarded plain-jsonl tail repair)", () => {
	test("bad tail: original moves to .corrupt-bak, canonical file parses, no in-place edit", () => {
		const home = scratchDir("dsh-c13-repair-")
		const dir = join(home, "sessions", "session-ccc3")
		mkdirSync(dir, { recursive: true })
		const log = join(dir, "session.v3.jsonl")
		writeFileSync(log, '{"type":"turn/start"}\n{"type":"turn/end"}\n{"seq":3}\n{"seq":\n')

		const result = repairSessionLogTail(log)
		expect(result.kind).toBe("repaired")
		if (result.kind !== "repaired") return
		expect(result.backupPath).toBe(`${log}.corrupt-bak`)
		// the canonical name parses again
		const repaired = readFileSync(log, "utf8")
		for (const line of repaired.trim().split("\n")) expect(() => JSON.parse(line)).not.toThrow()
		expect(repaired).toContain('"turn/start"')
		// the original content survives verbatim in the backup
		expect(readFileSync(result.backupPath, "utf8")).toBe('{"type":"turn/start"}\n{"type":"turn/end"}\n{"seq":3}\n{"seq":\n')
	})

	test("clean log → clean (nothing written); a taken backup name gets the epoch suffix", () => {
		const home = scratchDir("dsh-c13-clean-")
		const dir = join(home, "sessions", "session-ddd4")
		mkdirSync(dir, { recursive: true })
		const log = join(dir, "session.v3.jsonl")
		writeFileSync(log, '{"type":"turn/end"}\n')
		writeFileSync(`${log}.corrupt-bak`, "earlier backup\n")
		const before = readFileSync(log, "utf8")

		expect(repairSessionLogTail(log)).toEqual({ kind: "clean" })
		expect(readFileSync(log, "utf8")).toBe(before)

		// a real repair under a taken .corrupt-bak name epoch-suffixes it
		writeFileSync(log, '{"type":"turn/end"}\njunk\n')
		const result = repairSessionLogTail(log)
		expect(result.kind).toBe("repaired")
		if (result.kind !== "repaired") return
		expect(result.backupPath.split("/").pop()).toMatch(/^session\.v3\.jsonl\.corrupt-bak\.\d+$/)
	})

	test("zstd log → failed, file untouched (client-side repair cannot rewrite frames)", () => {
		const home = scratchDir("dsh-c13-zstd-")
		const dir = join(home, "sessions", "session-eee5")
		mkdirSync(dir, { recursive: true })
		const log = join(dir, "session.v4.jsonl.zstd")
		writeFileSync(log, Buffer.from([0x00, 0x01]))
		const before = readFileSync(log)
		const result = repairSessionLogTail(log)
		expect(result.kind).toBe("failed")
		expect(readFileSync(log)).toEqual(before)
	})

	test("all lines unparseable → failed, log never emptied; facade rides dshHome", () => {
		const home = scratchDir("dsh-c13-empty-guard-")
		const dir = join(home, "sessions", "session-fff6")
		mkdirSync(dir, { recursive: true })
		const log = join(dir, "session.v3.jsonl")
		writeFileSync(log, 'junk\nmore junk\n')
		const before = readFileSync(log, "utf8")
		const result = repairSessionLogTail(log)
		expect(result.kind).toBe("failed")
		expect(readFileSync(log, "utf8")).toBe(before)

		// facade parity: repairScanBroken + repairSessionLog ride the
		// configured dshHome, the same single-machine topology as /repair
		const { session } = makeFacade({ dshHome: home })
		const broken = session.repairScanBroken()
		expect(broken.map((r) => r.sessionId)).toEqual(["fff6"])
		const throughFacade = session.repairSessionLog(broken[0]!.path)
		expect(throughFacade.kind).toBe("failed")
		session.dispose()
	})
})

// ---------------------------------------------------------------------------
// C13 review fixes — probe coverage, hot-path cost, swap safety
// ---------------------------------------------------------------------------

describe("C13 probe — zstd coverage is accurate about repairability", () => {
	test("truncated zstd frame (valid magic, torn body) is flagged as NOT repairable client-side", () => {
		const home = scratchDir("dsh-c13-zstd-trunc-")
		const dir = join(home, "sessions", "session-ggg7")
		mkdirSync(dir, { recursive: true })
		const frame = zstdCompressSync(
			Buffer.from(Array.from({ length: 50 }, (_, i) => `{"type":"event","seq":${i}}\n`).join("")),
		)
		const log = join(dir, "session.v4.jsonl.zstd")
		writeFileSync(log, frame.subarray(0, frame.length - 10)) // torn tail, magic intact

		const broken = scanBrokenSessionLogs(home)
		const row = broken.find((r) => r.path === log)
		expect(row?.reason).toContain("truncated or corrupt zstd frame")
		expect(row?.reason).toContain("not repairable client-side")
		expect(row?.sessionId).toBe("ggg7")
	})

	test("bad-magic zstd is flagged as not repairable; a healthy frame stays clean", () => {
		const home = scratchDir("dsh-c13-zstd-magic-")
		const badDir = join(home, "sessions", "session-hhh8")
		const okDir = join(home, "sessions", "session-iii9")
		mkdirSync(badDir, { recursive: true })
		mkdirSync(okDir, { recursive: true })
		writeFileSync(join(badDir, "session.v4.jsonl.zstd"), Buffer.from([0x00, 0x01, 0x02]))
		writeFileSync(join(okDir, "session.v4.jsonl.zstd"), zstdCompressSync(Buffer.from('{"type":"turn/end"}\n')))

		const broken = scanBrokenSessionLogs(home)
		expect(broken.find((r) => r.path.includes("hhh8"))?.reason).toContain("not a zstd frame")
		expect(broken.some((r) => r.path.includes("iii9"))).toBe(false)
	})
})

describe("C13 probe — hot-path cost and per-entry tolerance", () => {
	test("300 logs scan well under the 117ms baseline; a warm re-scan (mtime cache) stays in the <30ms band", () => {
		const home = scratchDir("dsh-c13-perf-")
		const root = join(home, "sessions")
		mkdirSync(root, { recursive: true })
		for (let i = 0; i < 300; i++) {
			const dir = join(root, `session-perf-${i}`)
			mkdirSync(dir)
			writeFileSync(
				join(dir, "session.v3.jsonl"),
				`{"type":"turn/start"}\n{"type":"turn/end","seq":${i}}\n`,
			)
		}
		const coldStart = performance.now()
		expect(scanBrokenSessionLogs(home)).toEqual([])
		const coldMs = performance.now() - coldStart
		expect(coldMs).toBeLessThan(117) // the measured full-read baseline
		const warmStart = performance.now()
		expect(scanBrokenSessionLogs(home)).toEqual([])
		expect(performance.now() - warmStart).toBeLessThan(30)
	})

	test("a dangling symlink (or any single failing entry) is skipped, never aborts the scan", () => {
		const home = scratchDir("dsh-c13-dangling-")
		const dir = join(home, "sessions", "session-jjj1")
		mkdirSync(dir, { recursive: true })
		symlinkSync(join(dir, "vanished-target"), join(dir, "session.v3.jsonl"))
		const sibling = join(home, "sessions", "session-jjj2")
		mkdirSync(sibling, { recursive: true })
		writeFileSync(join(sibling, "session.v3.jsonl"), '{"type":"turn/end"}\njunk\n')

		const broken = scanBrokenSessionLogs(home)
		expect(broken.map((r) => r.sessionId)).toEqual(["jjj2"]) // the scan survived the dangling entry
	})
})

describe("C13 repair — active-writer defense and reference-order swap", () => {
	function tornLog(home: string, session: string): string {
		const dir = join(home, "sessions", session)
		mkdirSync(dir, { recursive: true })
		const log = join(dir, "session.v3.jsonl")
		writeFileSync(log, '{"type":"turn/start"}\n{"type":"turn/end"}\n{"seq":\n')
		return log
	}

	function tmpLeftovers(log: string): string[] {
		return readdirSync(join(log, "..")).filter((name) => name.includes(".repair-tmp-"))
	}

	test("a log still being written (mtime/size moves between samples) is abandoned untouched", () => {
		const home = scratchDir("dsh-c13-writer-")
		const log = tornLog(home, "session-kkk2")
		const before = readFileSync(log, "utf8")

		const result = repairSessionLogTail(log, {
			// The injected pause doubles as the live writer: an append lands
			// between the two stability samples.
			delayFn: () => appendFileSync(log, '{"type":"more"}\n'),
		})
		expect(result.kind).toBe("failed")
		if (result.kind !== "failed") return
		expect(result.detail).toContain("still being written")
		// only the simulated writer's own append landed — the repair touched nothing
		expect(readFileSync(log, "utf8")).toBe(`${before}{"type":"more"}\n`)
		expect(existsSync(`${log}.corrupt-bak`)).toBe(false)
		expect(tmpLeftovers(log)).toEqual([])
	})

	test("the repaired copy is written to a temp name with 0600 at creation — never the canonical name", () => {
		const home = scratchDir("dsh-c13-mode-")
		const log = tornLog(home, "session-lll3")

		const writes: { path: string; mode: unknown }[] = []
		const spyWrite = ((p: Parameters<typeof writeFileSync>[0], data: Parameters<typeof writeFileSync>[1], opts?: Parameters<typeof writeFileSync>[2]) => {
			writes.push({ path: String(p), mode: (opts as { mode?: number } | undefined)?.mode })
			return writeFileSync(p, data, opts)
		}) as typeof writeFileSync

		const result = repairSessionLogTail(log, { writeFn: spyWrite })
		expect(result.kind).toBe("repaired")
		expect(writes).toHaveLength(1)
		expect(writes[0]!.mode).toBe(0o600)
		expect(writes[0]!.path).not.toBe(log)
		expect(writes[0]!.path.startsWith(log)).toBe(true)
		// and the swapped-in canonical log ends up owner-only
		expect(statSync(log).mode & 0o777).toBe(0o600)
	})

	test("swap-in failure restores the original and the detail names the backup (previously untestable branch)", () => {
		const home = scratchDir("dsh-c13-swapfail-")
		const log = tornLog(home, "session-mmm4")
		const before = readFileSync(log, "utf8")

		let renameCalls = 0
		const failingSwapIn = ((from: string, to: string) => {
			renameCalls += 1
			// call 1: original → backup (succeeds); call 2: repaired copy → canonical (fails); call 3: the restore
			if (renameCalls === 2) throw new Error("EACCES: simulated swap-in failure")
			return renameSync(from, to)
		}) as typeof renameSync

		const result = repairSessionLogTail(log, { renameFn: failingSwapIn })
		expect(result.kind).toBe("failed")
		if (result.kind !== "failed") return
		expect(result.detail).toContain("swap failed")
		expect(result.detail).toContain(".corrupt-bak")
		// the canonical log was RESTORED to its original content
		expect(readFileSync(log, "utf8")).toBe(before)
		// and the backup was moved back — no copies left behind
		expect(existsSync(`${log}.corrupt-bak`)).toBe(false)
		expect(tmpLeftovers(log)).toEqual([])
	})

	test("a failing swap-in write leaves the canonical log untouched and creates no backup", () => {
		const home = scratchDir("dsh-c13-writefail-")
		const log = tornLog(home, "session-nnn5")
		const before = readFileSync(log, "utf8")

		const result = repairSessionLogTail(log, {
			writeFn: (() => {
				throw new Error("ENOSPC: simulated write failure")
			}) as typeof writeFileSync,
		})
		expect(result.kind).toBe("failed")
		if (result.kind !== "failed") return
		expect(result.detail).toContain("cannot write the repaired copy")
		expect(readFileSync(log, "utf8")).toBe(before)
		expect(existsSync(`${log}.corrupt-bak`)).toBe(false)
	})
})
