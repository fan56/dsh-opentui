/**
 * retention P1 — pure planner unit tests (dry run only).
 *
 * Every case drives the real `planSessionPrune` / `listAllSessions` through
 * injected in-memory fs + persistence stubs from ./fixtures. NO real file is
 * created, renamed, unlinked or removed, and no test calls a delete API.
 */
import { describe, expect, test } from "bun:test"
import {
  DEFAULT_RETENTION_DAYS,
  encodeSegment,
  hasStatCapability,
  listAllSessions,
  planSessionPrune,
  type PrunePlan,
  type SessionListPageLike,
} from "../src/session-prune"
import {
  artifactPathFor,
  fsStub,
  persistenceStub,
  pruneConfig,
  row,
  sessionDirFor,
  snapshot,
  TEST_NOW,
  TEST_ROOT,
} from "./fixtures/session-prune-fixtures"

/** Awaitable helper (planSessionPrune is async; keep the table tests terse). */
async function decide(
  id: string,
  rowOverrides: Parameters<typeof row>[1] = {},
  persistOptions: Parameters<typeof persistenceStub>[0] = {},
  fsOptions: Parameters<typeof fsStub>[0] = {},
  configOverrides: Parameters<typeof pruneConfig>[0] = {},
): Promise<PrunePlan> {
  return planSessionPrune(
    [row(id, rowOverrides)],
    persistenceStub({ snapshots: { [id]: snapshot(id) }, ...persistOptions }),
    fsStub({ dirs: [id], ...fsOptions }),
    pruneConfig(configOverrides),
  )
}

describe("retention P1 — pure planner (no deletion surface)", () => {
  test("default retention is 90 days (真删除留给后续切片)", () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(90)
  })

  test("feature probe: only a host with stat() is usable", () => {
    expect(hasStatCapability({ open: async () => ({}) })).toBe(false)
    expect(hasStatCapability(undefined)).toBe(false)
    expect(hasStatCapability({ stat: async () => undefined })).toBe(true)
  })

  test("retentionDays=0 skips every row", async () => {
    const plan = await decide("s0", {}, {}, {}, { retentionDays: 0 })
    expect(plan.counts.prune).toBe(0)
    expect(plan.entries[0]).toMatchObject({ decision: "skip", reason: "retention-disabled" })
  })

  test("a valid old session is planned for prune (decision only, no mutation)", async () => {
    const fs = fsStub({ dirs: ["s1"] })
    const plan = await planSessionPrune(
      [row("s1")],
      persistenceStub({ snapshots: { s1: snapshot("s1") } }),
      fs,
      pruneConfig(),
    )
    expect(plan.entries[0]).toMatchObject({ sessionId: "s1", decision: "prune" })
    expect(plan.counts).toMatchObject({ prune: 1, skip: 0 })
    expect(fs.calls.every((c) => c.op === "lstat" || c.op === "realpath" || c.op === "stat")).toBe(true)
    // B1: lstat/realpath run on dirname(location.path), never on the artifact file.
    // OLD CRITERION (SUPERSEDED): expected exactly
    // [sessionDirFor("s1"), sessionDirFor("s1")], omitting the leading
    // `realpath(config.sessionsRoot)` that planSessionPrune performs once before
    // the per-row gates. The product is correct; the old expectation was stale.
    expect(fs.calls.filter((c) => c.op === "lstat" || c.op === "realpath").map((c) => c.path))
      .toEqual([TEST_ROOT, sessionDirFor("s1"), sessionDirFor("s1")])
    expect(fs.calls.some((c) => c.path === artifactPathFor("s1"))).toBe(false)
    expect(fs.calls.some((c) => c.path.endsWith("/session.lock"))).toBe(true)
  })

  test("B1 host probe: encoded directory basename (~XXXX) prunes instead of always skip", async () => {
    // Illegal `~` in the id forces the host encoder to produce `probe~007E1`.
    // The old raw-id basename gate skipped this (and every real) session.
    const id = "probe~1"
    expect(encodeSegment(id)).toBe("probe~007E1")
    const fs = fsStub({ dirs: [id] })
    const plan = await planSessionPrune(
      [row(id)],
      persistenceStub({ snapshots: { [id]: snapshot(id) } }),
      fs,
      pruneConfig(),
    )
    expect(plan.entries[0]).toMatchObject({ sessionId: id, decision: "prune" })
    expect(plan.counts).toMatchObject({ prune: 1, skip: 0 })
    expect(fs.calls.find((c) => c.op === "lstat")?.path).toBe(sessionDirFor(id))
  })

  test("stat missing / throwing => unknown skip, never a prune", async () => {
    const missing = await decide("s2", {}, { snapshots: {} })
    expect(missing.entries[0].reason).toBe("unknown")
    const thrown = await decide("s3", {}, { errors: ["s3"], snapshots: { s3: snapshot("s3") } })
    expect(thrown.entries[0].reason).toBe("unknown")
  })

  test("four path gates each skip for the right reason", async () => {
    // symlink -> not-directory
    const symlink = await decide("s4", {}, {}, { symlinks: ["s4"] })
    expect(symlink.entries[0].reason).toBe("not-directory")

    // realpath outside root -> escaped-root
    const escaped = await decide("s5", {}, {}, { escapes: ["s5"] })
    expect(escaped.entries[0].reason).toBe("escaped-root")

    // header id mismatch
    const header = await decide("s6", {}, { snapshots: { s6: snapshot("other") } })
    expect(header.entries[0].reason).toBe("header-mismatch")

    // basename mismatch (artifact path lives in another session's encoded dir)
    const basenamePlan = await decide("s7", {}, { snapshots: { s7: snapshot("s7", { location: { kind: "jsonl", path: artifactPathFor("other") } }) } })
    expect(basenamePlan.entries[0].reason).toBe("basename-mismatch")

    // missing location
    const noLocation = await decide("s8", {}, { snapshots: { s8: snapshot("s8", { location: undefined }) } })
    expect(noLocation.entries[0].reason).toBe("no-location")
  })

  test("exclusion table: current/staged/running/missing/future/anomaly/subtree", async () => {
    expect((await decide("s9", {}, {}, {}, { currentSessionId: "s9" })).entries[0].reason).toBe("current")
    expect((await decide("s10", {}, {}, {}, { stagedIds: new Set(["s10"]) })).entries[0].reason).toBe("staged")
    expect((await decide("s11", { running: true })).entries[0].reason).toBe("running")
    expect((await decide("s12", { updatedAt: undefined })).entries[0].reason).toBe("missing-time")
    expect((await decide("s13", { updatedAt: TEST_NOW + 1 })).entries[0].reason).toBe("future-time")
    expect((await decide("s14", { updatedAt: Number.NaN })).entries[0].reason).toBe("field-anomaly")

    const withChild = await planSessionPrune(
      [row("parent"), row("child", { running: true, parentSessionId: "parent" })],
      persistenceStub(),
      fsStub(),
      pruneConfig(),
    )
    expect(withChild.entries.find((e) => e.sessionId === "parent")?.reason).toBe("subtree-running")
  })

  test("missing running / blank is a field anomaly (only explicit running===false is a candidate)", async () => {
    expect((await decide("nr", { running: undefined })).entries[0].reason).toBe("field-anomaly")
    expect((await decide("nb", { blank: undefined })).entries[0].reason).toBe("field-anomaly")
    expect((await decide("null-b", { blank: null as any })).entries[0].reason).toBe("field-anomaly")
    // explicit false + valid booleans still reach the path gates
    const ok = await decide("ok", { running: false, blank: false })
    expect(ok.entries[0].decision).toBe("prune")
  })

  test("P2: agentAvailable=true skips; missing/non-boolean is a field anomaly", async () => {
    expect(await decide("ag1", { agentAvailable: true })).toMatchObject({
      entries: [{ decision: "skip", reason: "agent-available" }],
    })
    // The host capability floor is a REQUIRED boolean; an older host that
    // never emitted the field must never be read as "no agent => deletable".
    const missing = await planSessionPrune(
      [row("ag2", { agentAvailable: undefined })],
      persistenceStub({ snapshots: { ag2: snapshot("ag2") } }),
      fsStub({ dirs: ["ag2"] }),
      pruneConfig(),
    )
    expect(missing.entries[0].reason).toBe("field-anomaly")
    expect((await decide("ag3", { agentAvailable: "false" as any })).entries[0].reason).toBe("field-anomaly")
    // explicit false stays eligible — no silent capability downgrade is used.
    expect((await decide("ag4", { agentAvailable: false })).entries[0].decision).toBe("prune")
  })

  test("P2: flock lock-held/unknown skip; unlocked/no-lock continue with read-only calls only", async () => {
    expect((await decide("lk1", {}, {}, { lockProbes: { lk1: { status: "lock-held" } } })).entries[0].reason)
      .toBe("lock-held")
    expect((await decide("lk2", {}, {}, { lockProbes: { lk2: { status: "unknown" } } })).entries[0].reason)
      .toBe("unknown")
    expect((await decide("lk3", {}, {}, { lockProbeErrors: ["lk3"] })).entries[0].reason).toBe("unknown")
    expect((await decide("lk4", {}, {}, { lockProbes: { lk4: { status: "no-lock" } } })).entries[0].decision)
      .toBe("prune")

    const fs = fsStub({ dirs: ["lk5"], lockProbes: { lk5: { status: "unlocked" } } })
    const plan = await planSessionPrune(
      [row("lk5")],
      persistenceStub({ snapshots: { lk5: snapshot("lk5") } }),
      fs,
      pruneConfig(),
    )
    expect(plan.entries[0].decision).toBe("prune")
    expect(fs.calls.every((c) => ["lstat", "realpath", "stat", "lockProbe"].includes(c.op))).toBe(true)
    expect(fs.calls.find((c) => c.op === "lockProbe")?.path).toBe(sessionDirFor("lk5") + "/session.lock")
  })

  test("fresh artifact mtime skips when the gate is enabled (read-only stat)", async () => {
    const fs = fsStub({ dirs: ["fm"], artifactMtimes: { fm: TEST_NOW - 1_000 } })
    const plan = await planSessionPrune(
      [row("fm")],
      persistenceStub({ snapshots: { fm: snapshot("fm") } }),
      fs,
      pruneConfig({ freshMtimeGraceMs: 300_000 }),
    )
    expect(plan.entries[0].reason).toBe("fresh-mtime")
    expect(fs.calls.every((c) => c.op === "lstat" || c.op === "realpath" || c.op === "stat")).toBe(true)
    expect(fs.calls.filter((c) => c.op === "stat").map((c) => c.path)).toEqual([
      sessionDirFor("fm") + "/session.lock",
      artifactPathFor("fm"),
    ])
  })

  test("fresh lock mtime skips; ENOENT lock allows; unreadable lock => unknown", async () => {
    const fresh = await decide("s15", {}, {}, { lockMtimes: { s15: TEST_NOW - 1_000 } })
    expect(fresh.entries[0].reason).toBe("lock-fresh")
    const old = await decide("s16", {}, {}, { lockMtimes: { s16: TEST_NOW - 10 * 86_400_000 } })
    expect(old.entries[0].decision).toBe("prune")
    const unreadable = await decide("s17", {}, {}, { lockErrors: ["s17"] })
    expect(unreadable.entries[0].reason).toBe("unknown")
  })

  test("blank needs grace; non-blank of the same age prunes", async () => {
    const age = 100 * 86_400_000 // > 90 but < 90 + 30 blank grace
    const blank = await decide("s18", { blank: true, updatedAt: TEST_NOW - age })
    expect(blank.entries[0].reason).toBe("blank-grace")
    const normal = await decide("s19", { updatedAt: TEST_NOW - age })
    expect(normal.entries[0].decision).toBe("prune")
  })

  test("unknown session id row is reported as a field anomaly", async () => {
    const plan = await planSessionPrune([row("")], persistenceStub(), fsStub(), pruneConfig())
    expect(plan.entries[0].reason).toBe("field-anomaly")
  })
})

describe("retention P1 — full session.list drain", () => {
  function lister(pages: readonly SessionListPageLike[]) {
    const calls: Array<{ cursor?: string }> = []
    let i = 0
    return {
      calls,
      async list(request: { _request: { cursor?: string } }) {
        calls.push(request._request)
        return pages[i++] ?? { items: [] }
      },
    }
  }

  test("current host shape (no cursor token) => single page", async () => {
    const stub = lister([{ items: [row("a"), row("b")] }])
    const result = await listAllSessions(stub)
    expect(result.pages).toBe(1)
    expect(result.rows.map((r) => r.sessionId)).toEqual(["a", "b"])
    expect(stub.calls).toEqual([{}])
  })

  test("multi-page cursor walk dedups by sessionId", async () => {
    const stub = lister([
      { items: [row("a"), row("b")], hasMore: true, nextCursor: "c1" },
      { items: [row("b"), row("c")], hasMore: true, nextCursor: "c2" },
      { items: [row("c"), row("d")] },
    ])
    const result = await listAllSessions(stub)
    expect(result.pages).toBe(3)
    expect(result.rows.map((r) => r.sessionId)).toEqual(["a", "b", "c", "d"])
    expect(stub.calls).toEqual([{}, { cursor: "c1" }, { cursor: "c2" }])
  })

  test("repeated cursor brakes and flags truncation", async () => {
    const stub = lister([
      { items: [row("a")], hasMore: true, nextCursor: "same" },
      { items: [row("b")], hasMore: true, nextCursor: "same" },
    ])
    const result = await listAllSessions(stub)
    expect(result.truncated).toBe(true)
    expect(result.rows.map((r) => r.sessionId)).toEqual(["a", "b"])
    expect(stub.calls.length).toBe(2)
  })

  test("hasMore with no usable cursor flags truncation (no silent half roster)", async () => {
    const stub = lister([{ items: [row("a")], hasMore: true }])
    const result = await listAllSessions(stub)
    expect(result.truncated).toBe(true)
    expect(stub.calls.length).toBe(1)
  })

  test("malformed reply throws (never a fake empty list)", async () => {
    const stub = lister([{ items: "not-an-array" }])
    await expect(listAllSessions(stub)).rejects.toThrow(/BAD_REPLY/)
  })
})
