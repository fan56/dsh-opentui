/**
 * retention P2 — unit tests for the trash-apply core. Every fs primitive is
 * injected (MemoryFs): no real session, no real trash and no real lock file is
 * touched. Covers TOCTOU, EXDEV, symlink, rename rollback, restore conflict,
 * crash manifest and fingerprint mismatch.
 */
import { describe, expect, test } from "bun:test"
import {
  ApplyError,
  applyTrashPlan,
  computeConfigFingerprint,
  computePlanFingerprint,
  recoverTrashOrphans,
  restoreFromTrash,
  trashSessionsRoot,
  type ApplyFsLike,
  type ApplyStatLike,
} from "../src/session-prune-apply"
import type { PrunePlan } from "../src/session-prune"

const DSH_HOME = "/home/test/.dsh"
const SESSIONS_ROOT = "/home/test/.dsh/sessions"
const ID = "s-prune"
const SESSION_DIR = `${SESSIONS_ROOT}/${ID}`
const ARTIFACT = `${SESSION_DIR}/session.v4.jsonl.zstd`
const NOW = Date.UTC(2026, 10, 25, 12, 0, 0)

interface FakeStat extends ApplyStatLike {
  readonly dev: number
  readonly ino: number
  readonly isDirectory: () => boolean
  readonly isSymbolicLink: () => boolean
}

function err(code: string): Error {
  return Object.assign(new Error(code), { code })
}

/** In-memory fs with injectable fault hooks; NO unlink/rm primitive exists. */
class MemoryFs implements ApplyFsLike {
  files = new Map<string, string>()
  dirs = new Map<string, FakeStat>()
  symlinks = new Set<string>()
  renameCalls: Array<[string, string]> = []
  lstatCalls: string[] = []
  lstatHook?: (path: string, count: number) => void
  renameHook?: (from: string, to: string) => void
  writeFileHook?: (path: string, data: string) => void
  appendFileHook?: (path: string, data: string) => void
  devFor?: (path: string) => number
  private ino = 1

  constructor() {
    this.dir(DSH_HOME)
    this.dir(SESSIONS_ROOT)
    this.dir(SESSION_DIR)
    this.file(ARTIFACT, "journal")
    this.file(`${SESSION_DIR}/session.lock`, "")
  }

  private statLike(path: string, directory: boolean): FakeStat {
    const dev = this.devFor?.(path) ?? 1
    return {
      dev,
      ino: this.ino++,
      mtimeMs: 0,
      isDirectory: () => directory,
      isSymbolicLink: () => this.symlinks.has(path),
    }
  }
  dir(path: string): void {
    if (!this.dirs.has(path)) this.dirs.set(path, this.statLike(path, true))
  }
  file(path: string, data: string): void {
    this.dir(path.slice(0, path.lastIndexOf("/")))
    this.files.set(path, data)
  }
  private movePrefix(from: string, to: string): void {
    for (const key of [...this.dirs.keys()]) {
      if (key === from || key.startsWith(from + "/")) {
        const value = this.dirs.get(key)!
        this.dirs.delete(key)
        this.dirs.set(key.replace(from, to), value)
      }
    }
    for (const key of [...this.files.keys()]) {
      if (key.startsWith(from + "/")) {
        const value = this.files.get(key)!
        this.files.delete(key)
        this.files.set(key.replace(from, to), value)
      }
    }
  }

  async lstat(path: string): Promise<ApplyStatLike> {
    this.lstatCalls.push(path)
    this.lstatHook?.(path, this.lstatCalls.filter((p) => p === path).length)
    if (this.dirs.has(path)) return this.statLike(path, true)
    if (this.files.has(path)) return this.statLike(path, false)
    throw err("ENOENT")
  }
  async stat(path: string): Promise<ApplyStatLike> {
    if (this.dirs.has(path)) return this.statLike(path, true)
    if (this.files.has(path)) return this.statLike(path, false)
    throw err("ENOENT")
  }
  async realpath(path: string): Promise<string> {
    if (!this.dirs.has(path) && !this.files.has(path)) throw err("ENOENT")
    return path
  }
  async mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown> {
    if (this.dirs.has(path)) {
      if (options?.recursive) return path
      throw err("EEXIST")
    }
    if (options?.recursive) {
      const parts = path.split("/").filter(Boolean)
      let current = ""
      for (const part of parts) {
        current += "/" + part
        this.dir(current)
      }
      return path
    }
    this.dir(path)
    return path
  }
  async rename(from: string, to: string): Promise<void> {
    this.renameCalls.push([from, to])
    this.renameHook?.(from, to)
    if (!this.dirs.has(from) && !this.files.has(from)) throw err("ENOENT")
    if (this.dirs.has(to) || this.files.has(to)) throw err("EEXIST")
    const value = this.dirs.get(from)
    this.dirs.delete(from)
    if (value) this.dirs.set(to, value)
    this.movePrefix(from, to)
  }
  async writeFile(path: string, data: string, options: { flag: "wx" }): Promise<void> {
    this.writeFileHook?.(path, data)
    if (options.flag === "wx" && (this.files.has(path) || this.dirs.has(path))) throw err("EEXIST")
    this.files.set(path, data)
  }
  async appendFile(path: string, data: string): Promise<void> {
    this.appendFileHook?.(path, data)
    this.files.set(path, (this.files.get(path) ?? "") + data)
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
    for (const key of [...this.dirs.keys(), ...this.files.keys()]) collect(key)
    return [...names].sort()
  }
  async readFile(path: string): Promise<string> {
    return this.files.get(path) ?? (() => { throw err("ENOENT") })()
  }
}

function plan(): PrunePlan {
  return {
    generatedAt: NOW,
    retentionDays: 30,
    entries: [{ sessionId: ID, decision: "prune", location: ARTIFACT, ageDays: 100 }],
    counts: { prune: 1, skip: 0, byReason: {} },
  }
}

interface DepsOptions {
  lock?: (path: string) => Promise<{ status: "unlocked" | "lock-held" | "no-lock" | "unknown" }>
  opId?: string
}

function deps(fs: MemoryFs, options: DepsOptions = {}) {
  let heldCount = 0
  return {
    persistence: {
      async stat(id: string) {
        return id === ID ? { header: { id }, location: { kind: "jsonl", path: ARTIFACT } } : undefined
      },
    },
    lockProbe: async (path: string) => {
      if (options.lock) return options.lock(path)
      heldCount += 1
      // First probe (source) is clean; a later probe at the trash path is held.
      return heldCount > 1 ? { status: "lock-held" as const } : { status: "unlocked" as const }
    },
    now: NOW,
    opId: options.opId ?? "op-test",
    withApplyLock: async <T>(fn: () => Promise<T>) => fn(),
  }
}

async function applyWith(fs: MemoryFs, options: DepsOptions = {}) {
  return applyTrashPlan(fs, deps(fs, options), plan(), {
    dshHome: DSH_HOME,
    sessionsRoot: SESSIONS_ROOT,
    planFingerprint: computePlanFingerprint(plan()),
  })
}

describe("session.prune.apply — trash core", () => {
  test("fingerprints are stable and change with policy / decisions", () => {
    const base = { retentionDays: 30, blankGraceDays: 30, lockGraceMs: 1, freshMtimeGraceMs: 1, sessionsRoot: SESSIONS_ROOT }
    const a = computeConfigFingerprint(base)
    expect(a).toBe(computeConfigFingerprint({ ...base }))
    expect(a).not.toBe(computeConfigFingerprint({ ...base, retentionDays: 31 }))
    const first = computePlanFingerprint(plan())
    expect(first).toBe(computePlanFingerprint(plan()))
    const changed: PrunePlan = { ...plan(), entries: [{ sessionId: ID, decision: "skip", reason: "running" }] }
    expect(first).not.toBe(computePlanFingerprint(changed))
  })

  test("happy path: rename to trash, 0700, journal + manifest, header marker", async () => {
    const fs = new MemoryFs()
    // No lock held anywhere: explicit unlocked probes.
    const result = await applyWith(fs, { lock: async () => ({ status: "unlocked" }) })
    expect(result.failed).toEqual([])
    expect(result.applied).toHaveLength(1)
    expect(result.applied[0].to).toContain(`${trashSessionsRoot(DSH_HOME)}/`)
    expect(fs.dirs.has(SESSION_DIR)).toBe(false)
    expect(fs.files.has(`${result.applied[0].to}/session.v4.jsonl.zstd`)).toBe(true)
    expect(fs.files.has(`${result.applied[0].to}/.applied.json`)).toBe(true)
    expect([...fs.files.keys()].some((p) => p.endsWith(".pre.json"))).toBe(true)
    expect([...fs.files.keys()].some((p) => p.endsWith(".post.json"))).toBe(true)
    expect([...fs.files.keys()].some((p) => p.endsWith("manifest.jsonl"))).toBe(true)
  })

  test("post-rename journal write failure (.applied/.post/manifest) reverses rename and reports the original error", async () => {
    for (const surface of ["applied", "post", "manifest"] as const) {
      const fs = new MemoryFs()
      const original = Object.assign(new Error(`write failed on ${surface}`), { code: "ENOSPC" })
      if (surface === "applied") {
        fs.writeFileHook = (path) => { if (path.endsWith("/.applied.json")) throw original }
      } else if (surface === "post") {
        fs.writeFileHook = (path) => { if (path.endsWith(".post.json")) throw original }
      } else {
        fs.appendFileHook = (path) => { if (path.endsWith("manifest.jsonl")) throw original }
      }
      const result = await applyWith(fs, { lock: async () => ({ status: "unlocked" }) })
      expect(result.applied).toEqual([])
      expect(result.failed).toHaveLength(1)
      // JOURNAL_FAILED is distinct from a rename/LOCKED failure, and the
      // ORIGINAL write error (not the rollback) is what reaches `failed`.
      expect(result.failed[0].code).toBe("JOURNAL_FAILED")
      expect(result.failed[0].message).toBe(original.message)
      // The session is back at its live source; the trash entry is gone.
      expect(fs.dirs.has(SESSION_DIR)).toBe(true)
      const trashPaths = [...fs.dirs.keys()].filter((p) => p.startsWith(trashSessionsRoot(DSH_HOME)) && p.includes(ID))
      expect(trashPaths).toEqual([])
      expect(fs.renameCalls).toHaveLength(2)
      expect(fs.renameCalls[0][1]).toBe(fs.renameCalls[1][0])
      expect([...fs.files.keys()].some((p) => p.endsWith(".rollback.json"))).toBe(true)
    }
  })

  test("TOCTOU: source flips to symlink before rename => no rename", async () => {
    const fs = new MemoryFs()
    fs.lstatHook = (path, count) => {
      if (path === SESSION_DIR && count >= 2) fs.symlinks.add(SESSION_DIR)
    }
    const result = await applyWith(fs, { lock: async () => ({ status: "unlocked" }) })
    expect(result.applied).toEqual([])
    expect(result.failed[0].code).toBe("BAD_PATH")
    expect(fs.renameCalls).toEqual([])
  })

  test("TOCTOU: source flips to symlink after rename => reverse rename, not applied", async () => {
    const fs = new MemoryFs()
    fs.renameHook = (from, to) => {
      if (from === SESSION_DIR) fs.symlinks.add(to)
    }
    const result = await applyWith(fs, { lock: async () => ({ status: "unlocked" }) })
    expect(result.applied).toEqual([])
    expect(result.failed[0].code).toBe("BAD_PATH")
    expect(fs.dirs.has(SESSION_DIR)).toBe(true)
    expect(fs.renameCalls).toHaveLength(2)
    expect(fs.renameCalls[0][1]).toBe(fs.renameCalls[1][0])
    expect([...fs.files.keys()].some((p) => p.endsWith(".rollback.json"))).toBe(true)
  })

  test("EXDEV: cross-device source is rejected before rename", async () => {
    const fs = new MemoryFs()
    fs.devFor = (path) => (path.startsWith(trashSessionsRoot(DSH_HOME)) ? 2 : 1)
    const result = await applyWith(fs, { lock: async () => ({ status: "unlocked" }) })
    expect(result.applied).toEqual([])
    expect(result.failed[0].code).toBe("EXDEV")
    expect(fs.renameCalls).toEqual([])
  })

  test("EXDEV from the rename syscall is surfaced, never copy-fallback", async () => {
    const fs = new MemoryFs()
    fs.renameHook = () => { throw err("EXDEV") }
    const result = await applyWith(fs, { lock: async () => ({ status: "unlocked" }) })
    expect(result.failed[0].code).toBe("EXDEV")
    expect(fs.files.has(`${fs.renameCalls[0][1]}/session.v4.jsonl.zstd`)).toBe(false)
  })

  test("symlink source is rejected (lstat gate)", async () => {
    const fs = new MemoryFs()
    fs.symlinks.add(SESSION_DIR)
    const result = await applyWith(fs, { lock: async () => ({ status: "unlocked" }) })
    expect(result.failed[0].code).toBe("BAD_PATH")
    expect(fs.renameCalls).toEqual([])
  })

  test("lock held at trash path => immediate reverse rename rollback", async () => {
    const fs = new MemoryFs()
    const result = await applyWith(fs)
    expect(result.applied).toEqual([])
    expect(result.failed[0].code).toBe("ROLLED_BACK")
    expect(fs.dirs.has(SESSION_DIR)).toBe(true)
    const trashPaths = [...fs.dirs.keys()].filter((p) => p.startsWith(trashSessionsRoot(DSH_HOME)) && p.includes(ID))
    expect(trashPaths).toEqual([])
    expect([...fs.files.keys()].some((p) => p.endsWith(".rollback.json"))).toBe(true)
    // two renames: forward then reverse
    expect(fs.renameCalls).toHaveLength(2)
    expect(fs.renameCalls[0][1]).toBe(fs.renameCalls[1][0])
  })

  test("restore refuses to overwrite an existing source (header still valid)", async () => {
    const fs = new MemoryFs()
    const trashPath = `${trashSessionsRoot(DSH_HOME)}/2026-11-25T12-00-00-000Z/${ID}`
    fs.dir(trashPath)
    const p = deps(fs)
    let caught: unknown
    try {
      await restoreFromTrash(fs, {
        sourceDir: SESSION_DIR, trashPath, id: ID,
        persistence: p.persistence, skipLock: true,
      })
    } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(ApplyError)
    expect((caught as ApplyError).code).toBe("CONFLICT")
    expect(fs.renameCalls).toEqual([])
  })

  test("restore re-validates the header before reverse rename", async () => {
    const fs = new MemoryFs()
    fs.dirs.delete(SESSION_DIR)
    const trashPath = `${trashSessionsRoot(DSH_HOME)}/2026-11-25T12-00-00-000Z/${ID}`
    fs.dir(trashPath)
    fs.file(`${trashPath}/session.v4.jsonl.zstd`, "journal")
    let caught: unknown
    try {
      await restoreFromTrash(fs, {
        sourceDir: SESSION_DIR, trashPath, id: "different-id",
        persistence: deps(fs).persistence, skipLock: true,
      })
    } catch (e) { caught = e }
    expect((caught as ApplyError).code).toBe("BAD_PATH")
    expect(fs.renameCalls).toEqual([])
  })

  test("crash manifest: orphan trash is MARKED only, never deleted", async () => {
    const fs = new MemoryFs()
    const runDir = `${trashSessionsRoot(DSH_HOME)}/2026-11-25T12-00-00-000Z`
    const orphan = `${runDir}/${ID}`
    fs.dir(runDir)
    fs.dir(orphan)
    fs.file(`${orphan}/session.v4.jsonl.zstd`, "journal")
    const marked = await recoverTrashOrphans(fs, DSH_HOME)
    expect(marked).toEqual([orphan])
    expect(fs.dirs.has(orphan)).toBe(true)
    expect(fs.files.has(`${orphan}/.orphan.json`)).toBe(true)
    expect(fs.files.has(`${orphan}/session.v4.jsonl.zstd`)).toBe(true)
    // second pass is idempotent (marker already exists)
    expect(await recoverTrashOrphans(fs, DSH_HOME)).toEqual([])
  })

  test("no-write invariant: apply never unlinks and never writes session.lock", async () => {
    const fs = new MemoryFs()
    await applyWith(fs, { lock: async () => ({ status: "unlocked" }) })
    const lockWrites = [...fs.files.keys()].filter((p) => p.endsWith("session.lock") && p.includes("/trash/"))
    // The lock file is only ever opened read-only by the probe; no write here.
    expect(lockWrites.every((p) => fs.files.get(p) === "")).toBe(true)
  })
})
