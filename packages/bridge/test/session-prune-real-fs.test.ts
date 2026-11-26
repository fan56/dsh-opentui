/**
 * Real-fs invariants for the retain/apply/restore wire surface. Unlike the
 * MemoryFs unit suites, these tests run the core against a real temp directory
 * through injected node:fs adapters — no mock can hide a marker that travels
 * back into a live session dir or a path that leaks onto the wire.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import * as fsp from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { zstdCompressSync } from "node:zlib"
import {
  applyTrashPlan,
  computePlanFingerprint,
  trashJournalRoot,
  trashSessionsRoot,
  type ApplyFsLike,
} from "../src/session-prune-apply"
import {
  listRestoreEntries,
  restoreTrashEntry,
  restoredMarkerPath,
  type RestoreFsLike,
} from "../src/session-prune-restore"
import { encodeSegment, type PrunePlan } from "../src/session-prune"

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

const ID = "s-real-fs"
const ENCODED = encodeSegment(ID)
const NOW = Date.UTC(2026, 10, 26, 9, 0, 0)

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "dsh-prune-real-"))
  cleanups.push(() => rmSync(home, { recursive: true, force: true }))
  const sessionsRoot = join(home, "sessions")
  const liveDir = join(sessionsRoot, ENCODED)
  const artifact = join(liveDir, "session.v4.jsonl.zstd")
  mkdirSync(liveDir, { recursive: true })
  writeFileSync(artifact, zstdCompressSync(Buffer.from(JSON.stringify({ id: ID, kind: "header" }) + "\nline2\n")))
  writeFileSync(join(liveDir, "session.lock"), "")

  const applyFs: ApplyFsLike = {
    lstat: (p) => fsp.lstat(p),
    stat: (p) => fsp.stat(p),
    realpath: (p) => fsp.realpath(p),
    mkdir: (p, o) => fsp.mkdir(p, o),
    rename: (p, to) => fsp.rename(p, to),
    writeFile: (p, data, o) => fsp.writeFile(p, data, o),
    appendFile: (p, data) => fsp.appendFile(p, data),
    readdir: (p) => fsp.readdir(p),
    readFile: (p) => fsp.readFile(p, "utf8"),
  }
  const restoreFs: RestoreFsLike = {
    lstat: (p) => fsp.lstat(p),
    stat: (p) => fsp.stat(p),
    realpath: (p) => fsp.realpath(p),
    readdir: (p) => fsp.readdir(p),
    readFile: (p) => fsp.readFile(p, "utf8"),
    readFileBuffer: (p) => fsp.readFile(p),
    rename: (p, to) => fsp.rename(p, to),
  }
  const persistence = {
    async stat(id: string) {
      return id === ID ? { header: { id }, location: { kind: "jsonl", path: artifact } } : undefined
    },
  }
  const lister = { async list() { return { items: [] } } }
  const lockProbe = async () => ({ status: "unlocked" as const })
  const withApplyLock = async <T>(fn: () => Promise<T>) => fn()
  const plan = (): PrunePlan => ({
    generatedAt: NOW,
    retentionDays: 30,
    entries: [{ sessionId: ID, decision: "prune", location: artifact, ageDays: 100 }],
    counts: { prune: 1, skip: 0, byReason: {} },
  })
  const config = { dshHome: home, sessionsRoot, planFingerprint: computePlanFingerprint(plan()) }
  const applyDeps = (opId: string, now = NOW) => ({ persistence, lockProbe, now, opId, withApplyLock })
  const restoreDeps = (opId: string) => ({ persistence, lister, lockProbe, now: NOW, opId, sessionsRoot, withApplyLock })
  return {
    home, sessionsRoot, liveDir, artifact, applyFs, restoreFs, persistence, plan, config, applyDeps, restoreDeps,
  }
}

function trashRuns(home: string): string[] {
  const root = trashSessionsRoot(home)
  return existsSync(root) ? readdirSync(root) : []
}

describe("session.prune — real-fs invariants", () => {
  test("apply → restore → apply succeeds and the live dir stays marker-free", async () => {
    const f = fixture()
    const first = await applyTrashPlan(f.applyFs, f.applyDeps("op-1"), f.plan(), f.config)
    expect(first.failed).toEqual([])
    expect(first.applied).toHaveLength(1)
    expect(existsSync(join(f.liveDir, ".applied.json"))).toBe(false)
    expect(existsSync(join(first.applied[0].to, ".applied.json"))).toBe(true)

    const restored = await restoreTrashEntry(f.restoreFs, f.restoreDeps("restore-1"), f.home, ID)
    expect(restored).toEqual({ id: ID, restored: true, opId: "restore-1" })
    expect(existsSync(f.liveDir)).toBe(true)
    expect(existsSync(join(f.liveDir, ".applied.json"))).toBe(false)
    expect(existsSync(restoredMarkerPath(f.home, "restore-1", ENCODED))).toBe(true)

    const second = await applyTrashPlan(f.applyFs, f.applyDeps("op-2", NOW + 60_000), f.plan(), f.config)
    expect(second.failed).toEqual([])
    expect(second.applied).toHaveLength(1)
    expect(existsSync(join(f.liveDir, ".applied.json"))).toBe(false)
    expect(existsSync(join(second.applied[0].to, ".applied.json"))).toBe(true)
  })

  test("marker create-then-ENOSPC reverses the rename with no residue, then a retry succeeds", async () => {
    const f = fixture()
    let failMarker = false
    let createdThenFailed = false
    const hookFs: ApplyFsLike = {
      ...f.applyFs,
      writeFile: async (p, data, o) => {
        if (failMarker && p.endsWith("/.applied.json")) {
          if (!createdThenFailed) {
            // The marker was really created, THEN the write reported ENOSPC.
            await f.applyFs.writeFile(p, data, o)
            createdThenFailed = true
          }
          throw Object.assign(
            new Error(`ENOSPC: no space left on device, write '${p}'`),
            { code: "ENOSPC" },
          )
        }
        return f.applyFs.writeFile(p, data, o)
      },
    }
    failMarker = true
    const failed = await applyTrashPlan(hookFs, f.applyDeps("op-1"), f.plan(), f.config)
    expect(failed.applied).toEqual([])
    expect(failed.failed).toHaveLength(1)
    expect(failed.failed[0].code).toBe("JOURNAL_FAILED")
    // The raw fs error (with its absolute path) never reaches the wire field.
    expect(failed.failed[0].message).not.toContain(f.home)
    expect(existsSync(f.liveDir)).toBe(true)
    expect(existsSync(join(f.liveDir, ".applied.json"))).toBe(false)
    for (const run of trashRuns(f.home)) {
      expect(existsSync(join(trashSessionsRoot(f.home), run, ENCODED))).toBe(false)
    }

    failMarker = false
    const retry = await applyTrashPlan(f.applyFs, f.applyDeps("op-2", NOW + 60_000), f.plan(), f.config)
    expect(retry.failed).toEqual([])
    expect(retry.applied).toHaveLength(1)
    expect(existsSync(join(f.liveDir, ".applied.json"))).toBe(false)
  })

  test("an existing marker with matching {id,to} makes the apply write idempotent; a mismatched one fails", async () => {
    const matched = fixture()
    let seeded = false
    const matchingFs: ApplyFsLike = {
      ...matched.applyFs,
      appendFile: async (p, data) => {
        if (p.endsWith("manifest.jsonl") && !seeded) {
          seeded = true
          const trashPath = join(dirname(p), ENCODED)
          await matched.applyFs.writeFile(join(trashPath, ".applied.json"), JSON.stringify({
            id: ID, to: trashPath,
          }), { flag: "wx", mode: 0o600 })
        }
        return matched.applyFs.appendFile(p, data)
      },
    }
    const ok = await applyTrashPlan(matchingFs, matched.applyDeps("op-1"), matched.plan(), matched.config)
    expect(ok.failed).toEqual([])
    expect(ok.applied).toHaveLength(1)

    const mismatched = fixture()
    let seededBad = false
    const badFs: ApplyFsLike = {
      ...mismatched.applyFs,
      appendFile: async (p, data) => {
        if (p.endsWith("manifest.jsonl") && !seededBad) {
          seededBad = true
          const trashPath = join(dirname(p), ENCODED)
          await mismatched.applyFs.writeFile(join(trashPath, ".applied.json"), JSON.stringify({
            id: ID, to: "/somewhere/else",
          }), { flag: "wx", mode: 0o600 })
        }
        return mismatched.applyFs.appendFile(p, data)
      },
    }
    const bad = await applyTrashPlan(badFs, mismatched.applyDeps("op-1"), mismatched.plan(), mismatched.config)
    expect(bad.applied).toEqual([])
    expect(bad.failed[0].code).toBe("JOURNAL_FAILED")
    expect(bad.failed[0].message).not.toContain(mismatched.home)
    expect(existsSync(join(mismatched.liveDir, ".applied.json"))).toBe(false)
  })

  test("a complete same-run manifest with no in-place marker still restores", async () => {
    const f = fixture()
    const applied = await applyTrashPlan(f.applyFs, f.applyDeps("op-1"), f.plan(), f.config)
    expect(applied.failed).toEqual([])
    const runDir = dirname(join(applied.applied[0].to))
    const marker = join(applied.applied[0].to, ".applied.json")
    expect(existsSync(marker)).toBe(true)
    // Simulate a restore that retired the marker but did not finish the reverse
    // rename: only the apply manifest row remains as identity authority.
    const retired = restoredMarkerPath(f.home, "restore-partial", ENCODED)
    await fsp.rename(marker, retired)
    expect(existsSync(marker)).toBe(false)
    expect(readFileSync(join(runDir, "manifest.jsonl"), "utf8")).toContain('"phase":"applied"')

    const list = await listRestoreEntries(f.restoreFs, f.home)
    expect(list.entries).toEqual([{ id: ID, movedAt: NOW, size: expect.any(Number) }])
    expect(list.rejected).toEqual([])

    const restored = await restoreTrashEntry(f.restoreFs, f.restoreDeps("restore-2"), f.home, ID)
    expect(restored).toEqual({ id: ID, restored: true, opId: "restore-2" })
    expect(existsSync(f.liveDir)).toBe(true)
    expect(existsSync(join(f.liveDir, ".applied.json"))).toBe(false)
  })

  test("retiring the marker refuses restore before the reverse rename", async () => {
    const f = fixture()
    await applyTrashPlan(f.applyFs, f.applyDeps("op-1"), f.plan(), f.config)
    mkdirSync(trashJournalRoot(f.home), { recursive: true })
    writeFileSync(restoredMarkerPath(f.home, "restore-1", ENCODED), "prior record")
    const result = await restoreTrashEntry(f.restoreFs, f.restoreDeps("restore-1"), f.home, ID).catch((e) => e)
    expect(result).toMatchObject({ code: "RESTORE_FAILED" })
    const wire = JSON.stringify({ code: result.code, message: result.message, detail: result.detail })
    expect(wire).not.toContain(f.home)
    expect(wire).not.toContain(trashSessionsRoot(f.home))
  })

  test("wire projections carry no absolute paths", async () => {
    const f = fixture()
    const failed = await applyTrashPlan(
      {
        ...f.applyFs,
        writeFile: async (p, data, o) => {
          if (p.endsWith(".post.json")) {
            throw Object.assign(new Error(`EACCES: permission denied, open '${p}'`), { code: "EACCES" })
          }
          return f.applyFs.writeFile(p, data, o)
        },
      },
      f.applyDeps("op-1"), f.plan(), f.config,
    )
    expect(failed.failed).toHaveLength(1)
    expect(JSON.stringify(failed.failed)).not.toContain(f.home)
    expect(JSON.stringify(failed.failed)).not.toContain(f.sessionsRoot)

    const applied = await applyTrashPlan(f.applyFs, f.applyDeps("op-2", NOW + 60_000), f.plan(), f.config)
    expect(applied.failed).toEqual([])
    const listed = await listRestoreEntries(f.restoreFs, f.home)
    const restored = await restoreTrashEntry(f.restoreFs, f.restoreDeps("restore-2"), f.home, ID)
    // `applied[]` carries host-derived location metadata by contract; the
    // hard no-path fields are failure messages, rejection rows and restore
    // results. None of those may embed the temp home.
    for (const wire of [JSON.stringify(failed.failed), JSON.stringify(listed), JSON.stringify(restored)]) {
      expect(wire).not.toContain(f.home)
      expect(wire).not.toContain(f.sessionsRoot)
    }
  })
})
