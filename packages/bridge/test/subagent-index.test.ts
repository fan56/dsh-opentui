/**
 * Unit tests for the L1 session→sub-agents index (packages/bridge/src/subagent-index.ts).
 *
 * The index is a cache of `session.list` rows: these tests pin the four rules
 * the stop capability relies on — build filter (`origin === 'subagent'`),
 * incremental insert/settle, reconcile (list is truth, parent immutable,
 * incremental-only rows preserved), and per-parent running enumeration with no
 * global-stop path.
 */
import { describe, expect, test } from "bun:test"
import { getSubagentIndex, SubagentIndex, type SubagentListRowLike } from "../src/subagent-index"

const row = (
  sessionId: string,
  parentSessionId: string | undefined,
  running: boolean,
  origin: string | undefined = "subagent",
  updatedAt = 1000,
): SubagentListRowLike => ({
  sessionId,
  updatedAt,
  origin,
  parentSessionId,
  running,
})

describe("SubagentIndex — build from a full session.list snapshot", () => {
  test("filters origin==='subagent', keys by sessionId, maps parent/time/status", () => {
    const idx = new SubagentIndex()
    const count = idx.syncFromList([
      row("parent", undefined, true, "root"), // ordinary session — skipped
      row("c1", "parent", true, "subagent", 1111),
      row("c2", "parent", false, "subagent", 2222),
    ])

    expect(count).toBe(2)
    expect(idx.built).toBe(true)
    expect([...idx.rows.keys()]).toEqual(["c1", "c2"])
    expect(idx.get("c1")).toEqual({ parentSessionId: "parent", startedAt: 1111, status: "running" })
    expect(idx.get("c2")).toEqual({ parentSessionId: "parent", startedAt: 2222, status: "settled" })
    expect(idx.has("parent")).toBe(false)
  })

  test("a subagent row without parentSessionId is still indexed with an empty parent", () => {
    const idx = new SubagentIndex()
    idx.syncFromList([row("orphan", undefined, true)])
    expect(idx.get("orphan")).toEqual({ parentSessionId: "", startedAt: 1000, status: "running" })
  })
})

describe("SubagentIndex — incremental catalog insert + turn/end settle", () => {
  test("noteCatalog inserts a running child with host wall clock; noteSettled flips it", () => {
    const idx = new SubagentIndex()
    idx.noteCatalog("c-new", "parent", 1795074915408)
    expect(idx.get("c-new")).toEqual({ parentSessionId: "parent", startedAt: 1795074915408, status: "running" })

    idx.noteSettled("c-new", 7)
    expect(idx.get("c-new")).toEqual({ parentSessionId: "parent", startedAt: 1795074915408, status: "settled", lastSeq: 7 })
  })

  test("noteCatalog keeps parent immutable and does not downgrade a settled child", () => {
    const idx = new SubagentIndex()
    idx.noteCatalog("c", "parent-A", 100)
    idx.noteSettled("c")
    // A late/duplicate catalog event for the same child must NOT rebind parent
    // (换绑代际 guard) nor resurrect a settled child.
    idx.noteCatalog("c", "parent-B", 999)
    expect(idx.get("c")).toEqual({ parentSessionId: "parent-A", startedAt: 100, status: "settled" })
  })

  test("noteSettled on an unknown child is a no-op (no ghost row)", () => {
    const idx = new SubagentIndex()
    idx.noteSettled("never-seen", 3)
    expect(idx.has("never-seen")).toBe(false)
  })
})

describe("SubagentIndex — reconcile: list is truth, parent immutable", () => {
  test("list rows replace cached status (running truth), incremental-only rows survive", () => {
    const idx = new SubagentIndex()
    idx.noteCatalog("c1", "parent", 100) // incremental only, not yet in list
    idx.noteCatalog("c-fresh", "parent", 200) // spawned after the snapshot
    idx.syncFromList([
      row("c1", "parent", false, "subagent", 500), // host now says settled
    ])

    expect(idx.get("c1")).toEqual({ parentSessionId: "parent", startedAt: 500, status: "settled" })
    expect(idx.get("c-fresh")).toEqual({ parentSessionId: "parent", startedAt: 200, status: "running" })
  })

  test("list parentSessionId wins over a stale cached parent, but incremental never rebinds", () => {
    const idx = new SubagentIndex()
    idx.syncFromList([row("c", "old-parent", true)])
    // A fresh authoritative snapshot with a different parent replaces the row.
    // (Real hosts never reparent a child; this pins that the LIST is the source.)
    idx.syncFromList([row("c", "new-parent", true)])
    expect(idx.get("c")!.parentSessionId).toBe("new-parent")
  })

  test("reset drops every row and forgets the build", () => {
    const idx = new SubagentIndex()
    idx.syncFromList([row("c", "parent", true)])
    idx.reset()
    expect(idx.built).toBe(false)
    expect(idx.rows.size).toBe(0)
  })
})

describe("SubagentIndex — per-parent running enumeration (no global stop)", () => {
  test("runningChildrenOf returns only running children of the named parent", () => {
    const idx = new SubagentIndex()
    idx.syncFromList([
      row("a1", "A", true),
      row("a2", "A", false),
      row("b1", "B", true),
    ])
    expect(idx.runningChildrenOf("A").map((x) => x.childId)).toEqual(["a1"])
    expect(idx.runningChildrenOf("B").map((x) => x.childId)).toEqual(["b1"])
    expect(idx.runningChildrenOf("C")).toEqual([])
    // There is no method that enumerates across all parents.
    expect((idx as unknown as { stopAll?: unknown }).stopAll).toBeUndefined()
  })
})

describe("getSubagentIndex — one table per ctx", () => {
  test("same ctx returns the same instance; a different ctx gets a fresh one", () => {
    const ctxA = {}
    const ctxB = {}
    expect(getSubagentIndex(ctxA)).toBe(getSubagentIndex(ctxA))
    expect(getSubagentIndex(ctxA)).not.toBe(getSubagentIndex(ctxB))
  })
})
