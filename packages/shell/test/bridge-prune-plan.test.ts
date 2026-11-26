/**
 * retention P1 — seam face for the READ-ONLY `session.prune.plan` frame.
 * Fake transport only; no host, no delete frame, no filesystem mutation.
 */
import { describe, expect, test } from "bun:test"
import {
  BridgeProtocolError,
  BridgeSessionSeam,
  projectBridgePrunePlan,
  projectBridgePruneApply,
  projectBridgePurgeCommit,
  projectBridgePurgePrepare,
  type BridgeEventFrame,
  type BridgeTransport,
} from "../src/client/bridge-session-seam.ts"

type Reply = { kind: "value"; value: unknown } | { kind: "error"; error: unknown }

function makeSeam(reply: Reply, calls: Array<{ method: string; params: unknown }>) {
  const transport: BridgeTransport = {
    async request(method, params) {
      calls.push({ method, params })
      if (reply.kind === "error") throw reply.error
      return reply.value
    },
    onEvent(_listener: (frame: BridgeEventFrame) => void) { return () => {} },
  }
  return new BridgeSessionSeam({ transport, ctx: { logger: { info() {}, warn() {}, error() {}, debug() {} } } })
}

const PLAN_REPLY = {
  generatedAt: 1,
  retentionDays: 90,
  entries: [
    { sessionId: "old", decision: "prune", location: "/sessions/_no-cwd/old/session.v4.jsonl.zstd", ageDays: 120 },
    { sessionId: "active", decision: "skip", reason: "running" },
    { sessionId: "bad", decision: "unknown" },
  ],
  counts: { prune: 1, skip: 1, byReason: { running: 1 } },
}

describe("session.prune.plan seam face", () => {
  test("uses the same frame name and projects a whitelist plan", async () => {
    const calls: Array<{ method: string; params: unknown }> = []
    const seam = makeSeam({ kind: "value", value: PLAN_REPLY }, calls)
    const plan = await seam.planPrune({ retentionDays: 0 })
    expect(calls[0].method).toBe("session.prune.plan")
    expect(calls[0].params).toEqual({ retentionDays: 0 })
    expect(plan.retentionDays).toBe(90)
    expect(plan.entries.length).toBe(2) // malformed "bad" row dropped by whitelist
    expect(plan.entries[0]).toEqual({ sessionId: "old", decision: "prune", location: "/sessions/_no-cwd/old/session.v4.jsonl.zstd", ageDays: 120 })
    expect(plan.counts).toEqual({ prune: 1, skip: 1, byReason: { running: 1 } })
  })

  test("UNSUPPORTED propagates (never a fake empty plan)", async () => {
    const err = new BridgeProtocolError("UNSUPPORTED", "no stat capability")
    const seam = makeSeam({ kind: "error", error: err }, [])
    await expect(seam.planPrune()).rejects.toBe(err)
  })

  test("malformed reply throws INTERNAL", () => {
    expect(() => projectBridgePrunePlan({ entries: "no" })).toThrow(/no entries array/)
  })

  test("missing generatedAt / retentionDays / counts throws a protocol error (never a fake 0)", () => {
    const base = { ...PLAN_REPLY }
    expect(() => projectBridgePrunePlan({ ...base, generatedAt: undefined })).toThrow(/no valid generatedAt/)
    expect(() => projectBridgePrunePlan({ ...base, retentionDays: undefined })).toThrow(/no valid retentionDays/)
    expect(() => projectBridgePrunePlan({ ...base, counts: undefined })).toThrow(/no valid counts/)
    expect(() => projectBridgePrunePlan({ ...base, counts: { prune: 1, skip: 1 } })).toThrow(/no valid counts/)
  })

  test("counts are recomputed from POST-FILTER entries, not copied from the wire", () => {
    const wire = {
      ...PLAN_REPLY,
      // deliberately bogus wire counts: the filtered "bad" row must not be
      // counted, and the stale numbers must not leak through.
      counts: { prune: 99, skip: 99, byReason: { bogus: 99 } },
    }
    const plan = projectBridgePrunePlan(wire)
    expect(plan.entries.length).toBe(2)
    expect(plan.counts).toEqual({ prune: 1, skip: 1, byReason: { running: 1 } })
  })

  test("wire params carry the REAL stagedSessionId and never a sessionsRoot", async () => {
    const calls: Array<{ method: string; params: any }> = []
    const seam = makeSeam({ kind: "value", value: PLAN_REPLY }, calls)
    seam.resumeSession("s-staged-before-turn")
    await seam.planPrune({ stagedIds: ["caller-extra"] })
    expect(calls[0].params.stagedIds).toEqual(["caller-extra", "s-staged-before-turn"])
    expect(Object.keys(calls[0].params)).not.toContain("sessionsRoot")
  })

  test("plan receipts are whitelisted through to applyPrune", async () => {
    const calls: Array<{ method: string; params: unknown }> = []
    const seam = makeSeam({ kind: "value", value: {
      ...PLAN_REPLY, fingerprint: "fp", configFingerprint: "cfp", secret: "leak",
    } }, calls)
    const plan = await seam.planPrune()
    expect(plan.fingerprint).toBe("fp")
    expect(plan.configFingerprint).toBe("cfp")
    expect(Object.keys(plan)).not.toContain("secret")
  })
})

describe("retention P2/P3 — write-side seam faces", () => {
  const APPLY_REPLY = {
    opId: "op-1",
    runDir: "/home/user/.dsh/trash/sessions/2026-01-01T00-00-00-000Z",
    applied: [{ id: "a", from: "/sessions/a", to: "/trash/a" }],
    failed: [{ id: "b", code: "LOCKED", message: "lock held" }],
    markedOrphans: ["/trash/orphan"],
  }
  const PREPARE_REPLY = {
    opId: "op-2",
    token: "signed-token",
    candidates: [{
      id: "trashed", encoded: "trashed", run: "2026-01-01T00-00-00-000Z",
      path: "/home/user/.dsh/trash/sessions/2026-01-01T00-00-00-000Z/trashed",
      ageDays: 9, appliedAt: 1, manifest: { id: "trashed", to: "/trash/trashed", opId: "op-1", appliedAt: 1 },
    }],
    rejected: [{ path: "/trash/fresh", code: "FRESH", message: "too fresh" }],
  }
  const COMMIT_REPLY = {
    opId: "op-2",
    purged: [{ id: "trashed", path: "/trash/trashed" }],
    failed: [{ code: "LOCKED", message: "lock held" }],
    manifestPath: "/home/user/.dsh/trash/journal/purge-op-2.jsonl",
  }

  test("applyPrune sends ONLY the three opaque receipts and projects no paths", async () => {
    const calls: Array<{ method: string; params: unknown }> = []
    const seam = makeSeam({ kind: "value", value: APPLY_REPLY }, calls)
    const result = await seam.applyPrune({ fingerprint: "fp", configFingerprint: "cfp", generatedAt: 7 })
    expect(calls).toEqual([{
      method: "session.prune.apply",
      params: { fingerprint: "fp", configFingerprint: "cfp", generatedAt: 7 },
    }])
    expect(result).toEqual({
      opId: "op-1", applied: [{ id: "a" }],
      failed: [{ id: "b", code: "LOCKED", message: "lock held" }], markedOrphans: 1,
    })
    expect(JSON.stringify(result)).not.toContain("/home/")
  })

  test("applyPrune echoes the REAL staged id as an exclusion-only wire param", async () => {
    const calls: Array<{ method: string; params: any }> = []
    const seam = makeSeam({ kind: "value", value: APPLY_REPLY }, calls)
    seam.resumeSession("s-staged-before-turn")
    await seam.applyPrune({
      fingerprint: "fp", configFingerprint: "cfp", generatedAt: 7,
      stagedIds: ["caller-extra"],
    })
    expect(calls[0].method).toBe("session.prune.apply")
    expect(calls[0].params.stagedIds).toEqual(["caller-extra", "s-staged-before-turn"])
    expect(Object.keys(calls[0].params).sort()).toEqual([
      "configFingerprint", "fingerprint", "generatedAt", "stagedIds",
    ])
  })

  test("preparePurge sends phase=prepare and drops paths/manifests", async () => {
    const calls: Array<{ method: string; params: unknown }> = []
    const seam = makeSeam({ kind: "value", value: PREPARE_REPLY }, calls)
    const result = await seam.preparePurge()
    expect(calls).toEqual([{ method: "session.prune.purge", params: { phase: "prepare" } }])
    expect(result).toEqual({
      opId: "op-2", token: "signed-token",
      candidates: [{ id: "trashed", ageDays: 9, appliedAt: 1 }],
      rejected: [{ code: "FRESH", message: "too fresh" }],
    })
    expect(JSON.stringify(result)).not.toContain("/trash/")
  })

  test("commitPurge sends phase=commit + token only; a host error propagates unchanged", async () => {
    const calls: Array<{ method: string; params: unknown }> = []
    const seam = makeSeam({ kind: "value", value: COMMIT_REPLY }, calls)
    const result = await seam.commitPurge({ token: "signed-token" })
    expect(calls).toEqual([{
      method: "session.prune.purge", params: { phase: "commit", token: "signed-token" },
    }])
    expect(result).toEqual({
      opId: "op-2", purged: [{ id: "trashed" }],
      failed: [{ code: "LOCKED", message: "lock held" }],
    })

    const refusal = new BridgeProtocolError("STALE_TOKEN", "expired")
    const failing = makeSeam({ kind: "error", error: refusal }, [])
    await expect(failing.commitPurge({ token: "signed-token" })).rejects.toBe(refusal)
  })

  test("malformed write replies throw a protocol error (never a fake OK)", () => {
    expect(() => projectBridgePruneApply({ opId: "x", applied: null, failed: [] })).toThrow(/no applied\/failed/)
    expect(() => projectBridgePurgePrepare({ opId: "x" })).toThrow(/no opId\/token/)
    expect(() => projectBridgePurgeCommit({ opId: "x", purged: [], failed: null })).toThrow(/no purged\/failed/)
  })
})
