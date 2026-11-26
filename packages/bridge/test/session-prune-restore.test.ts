/**
 * retention B4/C7 — unit tests for the trash restore core. Every fs primitive
 * is injected (MemoryFs): no real session, trash or lock file is touched.
 * Covers the no-path list projection, manifest/header gates, root escape,
 * refuse-if-exists, live-roster conflict and the single rename.
 */
import { describe, expect, test } from "bun:test"
import { zstdCompressSync } from "node:zlib"
import { join } from "node:path"
import {
  RestoreError,
  listRestoreEntries,
  restoreTrashEntry,
  type RestoreDeps,
  type RestoreFsLike,
  type RestoreStatLike,
} from "../src/session-prune-restore"
import { trashSessionsRoot } from "../src/session-prune-apply"
import { encodeSegment } from "../src/session-prune"

const DSH_HOME = "/home/t/.dsh"
const ROOT = join(DSH_HOME, "sessions")
const TRASH = trashSessionsRoot(DSH_HOME)
const RUN = "2026-11-20T00-00-00-000Z"
const ID = "s-restore"
const ENCODED = encodeSegment(ID)
const ENTRY = join(TRASH, RUN, ENCODED)
const ARTIFACT = join(ENTRY, "session.v4.jsonl.zstd")
const PARENT = join(ROOT, "_no-cwd")
const DEST = join(PARENT, ENCODED)
const APPLIED_AT = Date.UTC(2026, 10, 20)

function err(code: string): Error {
  return Object.assign(new Error(code), { code })
}

class MemoryFs implements RestoreFsLike {
  dirs = new Set<string>()
  files = new Map<string, string>()
  buffers = new Map<string, Buffer>()
  links = new Set<string>()
  realpathHook?: (path: string) => string
  lstatHook?: (path: string) => void
  renameCalls: Array<[string, string]> = []

  constructor() {
    for (const p of ["/", "/home", "/home/t", DSH_HOME, ROOT, PARENT, TRASH, join(TRASH, RUN), ENTRY]) this.dirs.add(p)
    this.files.set(join(ENTRY, ".applied.json"), JSON.stringify({
      id: ID, to: ENTRY, from: DEST, opId: "op-1", appliedAt: APPLIED_AT,
    }))
    this.buffers.set(ARTIFACT, zstdCompressSync(Buffer.from(JSON.stringify({ id: ID, kind: "header" }) + "\nline2\n")))
  }

  private statLike(path: string): RestoreStatLike {
    return {
      dev: 1,
      ino: 1,
      size: this.buffers.has(path) ? this.buffers.get(path)!.length : undefined,
      mtimeMs: 0,
      isDirectory: () => this.dirs.has(path),
      isSymbolicLink: () => this.links.has(path),
    }
  }
  async lstat(path: string) {
    this.lstatHook?.(path)
    if (this.dirs.has(path) || this.files.has(path) || this.buffers.has(path) || this.links.has(path)) return this.statLike(path)
    throw err("ENOENT")
  }
  async stat(path: string) { return this.lstat(path) }
  async realpath(path: string) { return this.realpathHook?.(path) ?? path }
  async readdir(path: string) {
    const prefix = path === TRASH ? `${TRASH}/` : path === join(TRASH, RUN) ? `${join(TRASH, RUN)}/` : undefined
    if (prefix === undefined) {
      if (!this.dirs.has(path)) throw err("ENOENT")
      return []
    }
    const out = new Set<string>()
    for (const dir of this.dirs) {
      if (dir.startsWith(prefix) && !dir.slice(prefix.length).includes("/")) out.add(dir.slice(prefix.length))
    }
    return [...out]
  }
  async readFile(path: string) {
    const text = this.files.get(path)
    if (text === undefined) throw err("ENOENT")
    return text
  }
  async readFileBuffer(path: string) {
    const buf = this.buffers.get(path)
    if (buf === undefined) throw err("ENOENT")
    return buf
  }
  async rename(from: string, to: string) {
    this.renameCalls.push([from, to])
    this.dirs.delete(from)
    this.dirs.add(to)
  }
}

function makeDeps(overrides: Partial<RestoreDeps> = {}): RestoreDeps {
  return {
    persistence: { async stat() { return undefined } },
    lister: { async list() { return { items: [] } } },
    lockProbe: async () => ({ status: "unlocked" }),
    now: Date.UTC(2026, 10, 26),
    opId: "op-restore",
    sessionsRoot: ROOT,
    withApplyLock: (fn) => fn(),
    ...overrides,
  }
}

describe("session.prune.restore — core", () => {
  test("list projects only id/movedAt/size (never a host path)", async () => {
    const fs = new MemoryFs()
    const list = await listRestoreEntries(fs, DSH_HOME)
    expect(list.entries.length).toBe(1)
    expect(list.entries[0]).toEqual({ id: ID, movedAt: APPLIED_AT, size: expect.any(Number) })
    const wire = JSON.stringify(list)
    expect(wire).not.toContain(DSH_HOME)
    expect(wire).not.toContain(ENTRY)
    expect(wire).not.toContain(RUN)
    expect(list.rejected.length).toBe(0)
  })

  test("restore by id performs one rename back to the manifest from-path", async () => {
    const fs = new MemoryFs()
    const result = await restoreTrashEntry(fs, makeDeps(), DSH_HOME, ID)
    expect(result).toEqual({ id: ID, restored: true, opId: "op-restore" })
    expect(fs.renameCalls).toEqual([[ENTRY, DEST]])
    expect(fs.dirs.has(DEST)).toBe(true)
    expect(fs.dirs.has(ENTRY)).toBe(false)
  })

  test("refuse-if-exists: a live destination is a CONFLICT, no rename", async () => {
    const fs = new MemoryFs()
    fs.dirs.add(DEST)
    await expect(restoreTrashEntry(fs, makeDeps(), DSH_HOME, ID)).rejects.toMatchObject({ code: "CONFLICT" })
    expect(fs.renameCalls).toEqual([])
  })

  test("live roster conflict refuses before any rename", async () => {
    const fs = new MemoryFs()
    const deps = makeDeps({ lister: { async list() { return { items: [{ sessionId: ID, agentAvailable: false }] } } } })
    await expect(restoreTrashEntry(fs, deps, DSH_HOME, ID)).rejects.toMatchObject({ code: "CONFLICT" })
    expect(fs.renameCalls).toEqual([])
  })

  test("artifact header.id mismatch makes the entry unrestorable", async () => {
    const fs = new MemoryFs()
    fs.buffers.set(ARTIFACT, zstdCompressSync(Buffer.from(JSON.stringify({ id: "someone-else" }) + "\n")))
    const list = await listRestoreEntries(fs, DSH_HOME)
    expect(list.entries.length).toBe(0)
    expect(list.rejected[0]?.code).toBe("BAD_MANIFEST")
    await expect(restoreTrashEntry(fs, makeDeps(), DSH_HOME, ID)).rejects.toBeInstanceOf(RestoreError)
    await expect(restoreTrashEntry(fs, makeDeps(), DSH_HOME, ID)).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  test("trash realpath escape rejects the entry", async () => {
    const fs = new MemoryFs()
    fs.realpathHook = (path) => path === ENTRY ? "/elsewhere/s-restore" : path
    const list = await listRestoreEntries(fs, DSH_HOME)
    expect(list.entries.length).toBe(0)
    expect(list.rejected[0]?.code).toBe("BAD_PATH")
  })

  test("missing lock probe capability is UNSUPPORTED, never assume-unlocked", async () => {
    const fs = new MemoryFs()
    const deps = makeDeps()
    delete (deps as { lockProbe?: unknown }).lockProbe
    await expect(restoreTrashEntry(fs, deps, DSH_HOME, ID)).rejects.toMatchObject({ code: "UNSUPPORTED" })
    expect(fs.renameCalls).toEqual([])
  })

  test("concurrent purge: an entry vanishing between scan and assessment is skipped, not fatal", async () => {
    const fs = new MemoryFs()
    fs.lstatHook = (path) => { if (path === ENTRY) throw Object.assign(new Error(`ENOENT: no such file or directory, lstat '${ENTRY}'`), { code: "ENOENT" }) }
    const list = await listRestoreEntries(fs, DSH_HOME)
    expect(list.entries).toEqual([])
    expect(list.rejected).toEqual([])
    // Restore of a different (still-present) id must not be interrupted either.
    // Here the vanished entry IS the target, so it reports fixed NOT_FOUND.
    await expect(restoreTrashEntry(fs, makeDeps(), DSH_HOME, ID)).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(fs.renameCalls).toEqual([])
  })

  test("§4 path leakage negative: raw fs messages and absolute paths never enter list/restore wire data", async () => {
    const fs = new MemoryFs()
    const rawMessage = `EACCES: permission denied, scandir '${ENTRY}'`
    fs.lstatHook = (path) => { if (path === ENTRY) throw Object.assign(new Error(rawMessage), { code: "EACCES" }) }

    const list = await listRestoreEntries(fs, DSH_HOME)
    const listWire = JSON.stringify(list)
    for (const leak of [rawMessage, DSH_HOME, ENTRY, RUN, "EACCES", "scandir"]) {
      expect(listWire).not.toContain(leak)
    }
    expect(list.rejected[0]?.code).toBe("BAD_PATH")

    let caught: unknown
    try { await restoreTrashEntry(fs, makeDeps(), DSH_HOME, ID) } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(RestoreError)
    const err = caught as RestoreError
    // Mirror the RPC projection: code + message + detail are what go onchain.
    const wire = JSON.stringify({ code: err.code, message: err.message, detail: err.detail })
    for (const leak of [rawMessage, DSH_HOME, ENTRY, RUN, "EACCES", "scandir"]) {
      expect(wire).not.toContain(leak)
    }
    expect(fs.renameCalls).toEqual([])
  })

  test("a client-supplied path is never accepted as an id", async () => {
    const fs = new MemoryFs()
    await expect(restoreTrashEntry(fs, makeDeps(), DSH_HOME, ENTRY)).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(fs.renameCalls).toEqual([])
    await expect(restoreTrashEntry(fs, makeDeps(), DSH_HOME, 42)).rejects.toMatchObject({ code: "BAD_PARAMS" })
  })
})
