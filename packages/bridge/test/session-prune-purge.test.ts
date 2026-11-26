/**
 * retention P3 — unit tests for the trash-only purge core. Every fs primitive
 * is injected (MemoryFs): no real session, trash, lock or secret file is touched.
 * Covers token mint/verify/expiry/tamper/replay, residence boundary, root
 * escape, symlink (candidate + nested), restore conflict, live-path conflict,
 * partial-failure batch continuation and the crash manifest.
 *
 * These tests are WRITTEN, not run, in the P3 implementation slice.
 */
import { describe, expect, test } from "bun:test"
import { zstdCompressSync } from "node:zlib"
import {
  DEFAULT_PURGE_RETENTION_DAYS,
  PurgeError,
  assessTrashEntry,
  issuePurgeToken,
  preparePurge,
  purgeTrashSessions,
  recoverPurgeIntents,
  removeTrashTree,
  verifyPurgeToken,
  type PurgeCandidate,
  type PurgeDeps,
  type PurgeErrorCode,
  type PurgeFsLike,
  type PurgeStatLike,
} from "../src/session-prune-purge"
import { trashJournalRoot, trashSessionsRoot } from "../src/session-prune-apply"
import { encodeSegment } from "../src/session-prune"

const DSH_HOME = "/home/test/.dsh"
const TRASH = trashSessionsRoot(DSH_HOME)
const RUN = "2026-11-19T00-00-00-000Z"
const ID = "s-purge"
const ID2 = "s-purge-2"
const ID3 = "s-purge-3"
const LIVE = "/home/test/.dsh/sessions/live-place/session.v4.jsonl.zstd"
const NOW = Date.UTC(2026, 11, 26, 0, 0, 0)
const DAY = 86_400_000
const SECRET = "host-local-test-secret"

interface FakeStat extends PurgeStatLike {
  readonly isDirectory: () => boolean
  readonly isSymbolicLink: () => boolean
}

function err(code: string): Error {
  return Object.assign(new Error(code), { code })
}

/** In-memory fs with fault hooks; all delete primitives are explicit. */
class MemoryFs implements PurgeFsLike {
  dirs = new Set<string>()
  files = new Map<string, string>()
  links = new Map<string, string>()
  lstatCalls: string[] = []
  unlinkCalls: string[] = []
  rmdirCalls: string[] = []
  unlinkHook?: (path: string) => void
  realpathHook?: (path: string) => string

  constructor() {
    for (const p of ["/", "/home", "/home/test", DSH_HOME, trashJournalRoot(DSH_HOME), TRASH, `${TRASH}/${RUN}`]) {
      this.dirs.add(p)
    }
  }

  private statLike(path: string, directory: boolean): FakeStat {
    return {
      dev: 1,
      ino: 1,
      mtimeMs: 0,
      isDirectory: () => directory,
      isSymbolicLink: () => this.links.has(path),
    }
  }

  dir(path: string): void {
    this.dirs.add(path)
  }
  file(path: string, data = ""): void {
    const parent = path.slice(0, path.lastIndexOf("/"))
    if (parent !== "") this.dir(parent)
    this.files.set(path, data)
  }
  symlink(path: string, target: string): void {
    const parent = path.slice(0, path.lastIndexOf("/"))
    if (parent !== "") this.dir(parent)
    this.links.set(path, target)
  }

  async lstat(path: string): Promise<PurgeStatLike> {
    this.lstatCalls.push(path)
    if (this.links.has(path)) return this.statLike(path, false)
    if (this.dirs.has(path)) return this.statLike(path, true)
    if (this.files.has(path)) return this.statLike(path, false)
    throw err("ENOENT")
  }
  async stat(path: string): Promise<PurgeStatLike> {
    return this.lstat(path)
  }
  async realpath(path: string): Promise<string> {
    if (this.realpathHook) return this.realpathHook(path)
    if (this.dirs.has(path) || this.files.has(path) || this.links.has(path)) return path
    throw err("ENOENT")
  }
  async mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown> {
    if (options?.recursive) {
      const parts = path.split("/").filter(Boolean)
      let current = ""
      for (const part of parts) {
        current += "/" + part
        this.dir(current)
      }
      return path
    }
    if (this.dirs.has(path) || this.files.has(path)) throw err("EEXIST")
    this.dir(path)
    return path
  }
  async readdir(path: string): Promise<string[]> {
    const prefix = path.endsWith("/") ? path : path + "/"
    const names = new Set<string>()
    const collect = (full: string) => {
      if (!full.startsWith(prefix)) return
      const rest = full.slice(prefix.length)
      if (rest === "" || rest.includes("/")) return
      names.add(rest)
    }
    for (const key of [...this.dirs, ...this.files.keys(), ...this.links.keys()]) collect(key)
    return [...names].sort()
  }
  async readFile(path: string): Promise<string> {
    const value = this.files.get(path)
    if (value === undefined) throw err("ENOENT")
    return value
  }
  async readFileBuffer(path: string): Promise<Buffer> {
    const value = this.files.get(path)
    if (value === undefined) throw err("ENOENT")
    return Buffer.from(value, "latin1")
  }
  async writeFile(path: string, data: string, options: { flag: "wx" }): Promise<void> {
    if (options.flag === "wx" && (this.files.has(path) || this.dirs.has(path) || this.links.has(path))) throw err("EEXIST")
    this.file(path, data)
  }
  async appendFile(path: string, data: string): Promise<void> {
    this.file(path, (this.files.get(path) ?? "") + data)
  }
  async unlink(path: string): Promise<void> {
    this.unlinkCalls.push(path)
    this.unlinkHook?.(path)
    if (!this.files.has(path) && !this.links.has(path)) throw err("ENOENT")
    this.files.delete(path)
    this.links.delete(path)
  }
  async rmdir(path: string): Promise<void> {
    this.rmdirCalls.push(path)
    if (!this.dirs.has(path)) throw err("ENOENT")
    if (this.children(path).length > 0) throw err("ENOTEMPTY")
    this.dirs.delete(path)
  }
  private children(path: string): string[] {
    const prefix = path.endsWith("/") ? path : path + "/"
    return [...this.dirs, ...this.files.keys(), ...this.links.keys()].filter((k) =>
      k.startsWith(prefix) && !k.slice(prefix.length).includes("/") && k !== path,
    )
  }
}

function candidateDir(id: string): string {
  return `${TRASH}/${RUN}/${encodeSegment(id)}`
}

function artifactFrame(id: string): string {
  return zstdCompressSync(Buffer.from(JSON.stringify({ type: "session", version: 4, id }) + "\n", "utf8")).toString("latin1")
}

function seed(fs: MemoryFs, id: string, appliedAt = NOW - 8 * DAY): void {
  const dir = candidateDir(id)
  fs.dir(dir)
  fs.file(`${dir}/session.v4.jsonl.zstd`, artifactFrame(id))
  fs.file(`${dir}/session.lock`, "")
  fs.file(`${dir}/.applied.json`, JSON.stringify({
    id,
    to: dir,
    opId: `apply-${id}`,
    appliedAt,
    phase: "applied",
  }))
}

interface DepsOptions {
  readonly ids?: readonly string[]
  readonly live?: ReadonlyMap<string, "LIVE_AGENT" | "CONFLICT">
  readonly status?: "unlocked" | "lock-held" | "no-lock" | "unknown"
  readonly noLockProbe?: boolean
  readonly retentionDays?: number
  readonly now?: number
  readonly locations?: ReadonlyMap<string, string>
}

function makeDeps(fs: MemoryFs, options: DepsOptions = {}): PurgeDeps {
  const liveIds = options.live ?? new Map<string, "LIVE_AGENT" | "CONFLICT">()
  const rows = [...liveIds.keys()].map((sessionId) => ({
    sessionId,
    agentAvailable: liveIds.get(sessionId) === "LIVE_AGENT",
  }))
  return {
    persistence: {
      async stat(id: string) {
        if (options.ids !== undefined && !options.ids.includes(id)) return undefined
        const location = options.locations?.get(id) ?? LIVE
        return { header: { id }, location: { kind: "jsonl", path: location } }
      },
    },
    lister: {
      async list() {
        return { items: rows, nextCursor: undefined }
      },
    },
    lockProbe: options.noLockProbe
      ? undefined
      : async () => ({ status: options.status ?? "unlocked" as const }),
    now: options.now ?? NOW,
    opId: "purge-op",
    secret: SECRET,
    retentionDays: options.retentionDays ?? DEFAULT_PURGE_RETENTION_DAYS,
    tokenTtlMs: 120_000,
    newSecret: () => "nonce-entropy",
    withApplyLock: async <T>(fn: () => Promise<T>) => fn(),
  }
}

function liveMapFor(ids: readonly string[], state: "LIVE_AGENT" | "CONFLICT"): Map<string, "LIVE_AGENT" | "CONFLICT"> {
  return new Map(ids.map((id) => [id, state] as const))
}

async function expectCode(code: PurgeErrorCode, fn: () => Promise<unknown>): Promise<PurgeError> {
  try {
    await fn()
  } catch (err) {
    expect(err).toBeInstanceOf(PurgeError)
    const pe = err as PurgeError
    expect(pe.code).toBe(code)
    return pe
  }
  throw new Error(`expected PurgeError(${code}) but call resolved`)
}

async function assess(fs: MemoryFs, deps: PurgeDeps, id: string, live = new Map<string, "LIVE_AGENT" | "CONFLICT">()) {
  return assessTrashEntry(fs, deps, DSH_HOME, RUN, encodeSegment(id), live)
}

describe("session.prune.purge — trash-only core", () => {
  test("first purge: missing trash/sessions yields an empty preparation, not INTERNAL", async () => {
    const fs = new MemoryFs()
    fs.dirs.delete(TRASH)
    fs.dirs.delete(`${TRASH}/${RUN}`)
    const prepared = await preparePurge(fs, makeDeps(fs), DSH_HOME)
    expect(prepared.candidates).toEqual([])
    expect(prepared.rejected).toEqual([])
    expect(typeof prepared.token).toBe("string")
    expect(prepared.tokenPayload.root).toBe(TRASH)
    expect(prepared.tokenPayload.ids).toEqual([])
  })

  test("token: mint/verify, tamper, wrong secret, expiry and replay", async () => {
    const input = {
      opId: "op-1", ids: [ID], paths: [candidateDir(ID)], root: TRASH,
      retentionDays: 7, issuedAt: NOW, nonce: "nonce-1",
    }
    const issued = issuePurgeToken(input, SECRET, 120_000)
    expect(verifyPurgeToken(issued.token, SECRET, NOW + 1)).toEqual(issued.payload)
    expect(issued.payload.expiresAt).toBe(NOW + 120_000)

    // Reordered keys / altered bytes are a signature mismatch.
    const tampered = issued.token.slice(0, -1) + (issued.token.endsWith("a") ? "b" : "a")
    await expectCode("BAD_TOKEN", async () => verifyPurgeToken(tampered, SECRET, NOW))
    await expectCode("BAD_TOKEN", async () => verifyPurgeToken(issued.token, "other-secret", NOW))
    await expectCode("BAD_TOKEN", async () => verifyPurgeToken("not-a-token", SECRET, NOW))
    await expectCode("STALE_TOKEN", async () => verifyPurgeToken(issued.token, SECRET, NOW + 120_000))

    // Single-use: the wallet claim file makes a second commit a REPLAY.
    const fs = new MemoryFs()
    seed(fs, ID)
    const deps = makeDeps(fs)
    const prepared = await preparePurge(fs, deps, DSH_HOME)
    const first = await purgeTrashSessions(fs, deps, DSH_HOME, prepared.token)
    expect(first.purged.map((p) => p.id)).toEqual([ID])
    await expectCode("REPLAY", async () => purgeTrashSessions(fs, deps, DSH_HOME, prepared.token))
  })

  test("residence period: 7-day default, boundary is inclusive, host can override", async () => {
    const fs = new MemoryFs()
    seed(fs, ID, NOW - 7 * DAY)
    expect((await assess(fs, makeDeps(fs), ID)).id).toBe(ID)

    seed(fs, ID2, NOW - 7 * DAY + 1)
    await expectCode("FRESH", async () => assess(fs, makeDeps(fs), ID2))

    // Host override 30d: an 8-day-old entry is still fresh.
    await expectCode("FRESH", async () => assess(fs, makeDeps(fs, { retentionDays: 30 }), ID))
    expect(DEFAULT_PURGE_RETENTION_DAYS).toBe(7)
  })

  test("marker missing: the same-run manifest.jsonl applied row is identity authority", async () => {
    const fs = new MemoryFs()
    seed(fs, ID)
    const dir = candidateDir(ID)
    fs.files.delete(`${dir}/.applied.json`)
    fs.file(`${TRASH}/${RUN}/manifest.jsonl`, JSON.stringify({
      id: ID, to: dir, opId: `apply-${ID}`, appliedAt: NOW - 8 * DAY, phase: "applied",
    }) + "\n")
    expect((await assess(fs, makeDeps(fs), ID)).id).toBe(ID)
    // A row for a different entry is never accepted as identity.
    fs.file(`${TRASH}/${RUN}/manifest.jsonl`, JSON.stringify({
      id: ID, to: candidateDir(ID2), opId: `apply-${ID}`, appliedAt: NOW - 8 * DAY, phase: "applied",
    }) + "\n")
    await expectCode("BAD_MANIFEST", async () => assess(fs, makeDeps(fs), ID))
  })

  test("root escape: manifest to outside trash / realpath outside trash", async () => {
    const fs = new MemoryFs()
    seed(fs, ID)
    const dir = candidateDir(ID)
    fs.file(`${dir}/.applied.json`, JSON.stringify({
      id: ID, to: "/etc/passwd", opId: "apply-x", appliedAt: NOW - 8 * DAY,
    }))
    await expectCode("BAD_MANIFEST", async () => assess(fs, makeDeps(fs), ID))

    seed(fs, ID2)
    fs.realpathHook = (path) => path === candidateDir(ID2) ? "/etc/passwd" : path
    await expectCode("BAD_PATH", async () => assess(fs, makeDeps(fs), ID2))
  })

  test("symlink: candidate symlink rejected; nested symlink is unlinked, not followed", async () => {
    const fs = new MemoryFs()
    const dir = candidateDir(ID)
    fs.symlink(dir, "/etc")
    fs.file(`${dir}/.applied.json`, JSON.stringify({
      id: ID, to: dir, opId: "apply-x", appliedAt: NOW - 8 * DAY,
    }))
    await expectCode("BAD_PATH", async () => assess(fs, makeDeps(fs), ID))

    const fs2 = new MemoryFs()
    seed(fs2, ID2)
    const outside = "/home/test/outside.txt"
    fs2.file(outside, "must survive")
    const inside = `${candidateDir(ID2)}/escape`
    fs2.symlink(inside, outside)
    const deps = makeDeps(fs2)
    const candidate: PurgeCandidate = await assess(fs2, deps, ID2)
    await removeTrashTree(fs2, candidate)
    expect(fs2.files.has(outside)).toBe(true)
    expect(fs2.links.has(inside)).toBe(false)
  })

  test("restore conflict and live agent block purge", async () => {
    const fs = new MemoryFs()
    seed(fs, ID)
    await expectCode("CONFLICT", async () =>
      assess(fs, makeDeps(fs, { live: liveMapFor([ID], "CONFLICT") }), ID, liveMapFor([ID], "CONFLICT")))
    const fs2 = new MemoryFs()
    seed(fs2, ID)
    await expectCode("LIVE_AGENT", async () =>
      assess(fs2, makeDeps(fs2, { live: liveMapFor([ID], "LIVE_AGENT") }), ID, liveMapFor([ID], "LIVE_AGENT")))
  })

  test("live path conflict: id reappears on a non-trash path", async () => {
    const fs = new MemoryFs()
    seed(fs, ID)
    fs.file(LIVE, "live again")
    await expectCode("CONFLICT", async () => assess(fs, makeDeps(fs, { locations: new Map([[ID, LIVE]]) }), ID))

    // Missing flock capability closes the whole gate.
    const fs2 = new MemoryFs()
    seed(fs2, ID)
    await expectCode("UNSUPPORTED", async () => assess(fs2, makeDeps(fs2, { noLockProbe: true }), ID))
  })

  test("partial failure: one fresh sibling is recorded, the other is still purged", async () => {
    const fs = new MemoryFs()
    seed(fs, ID)
    seed(fs, ID2)
    const deps = makeDeps(fs, { ids: [ID, ID2] })
    const prepared = await preparePurge(fs, deps, DSH_HOME)
    expect(prepared.candidates.map((c) => c.id)).toEqual([ID, ID2])

    // Between prepare and commit the second entry is written again -> FRESH.
    seed(fs, ID2, NOW - 1 * DAY)
    const result = await purgeTrashSessions(fs, deps, DSH_HOME, prepared.token)
    expect(result.purged.map((p) => p.id)).toEqual([ID])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].id).toBe(ID2)
    expect(result.failed[0].code).toBe("FRESH")
    expect(fs.dirs.has(candidateDir(ID2))).toBe(true)
  })

  test("crash manifest: intent row survives a failed delete and recovery only marks it", async () => {
    const fs = new MemoryFs()
    seed(fs, ID3)
    fs.unlinkHook = (path) => {
      if (path.endsWith("session.lock")) throw err("EIO")
    }
    const deps = makeDeps(fs, { ids: [ID3] })
    const prepared = await preparePurge(fs, deps, DSH_HOME)
    const result = await purgeTrashSessions(fs, deps, DSH_HOME, prepared.token)
    expect(result.purged).toEqual([])
    expect(result.failed[0].id).toBe(ID3)

    const manifest = fs.files.get(result.manifestPath) ?? ""
    expect(manifest).toContain('"phase":"intent"')
    expect(manifest).not.toContain('"phase":"done"')
    const marked = await recoverPurgeIntents(fs, DSH_HOME)
    expect(marked).toEqual([`${candidateDir(ID3)}.purge-crash.json`])
    expect(fs.dirs.has(candidateDir(ID3))).toBe(true)
  })
})
