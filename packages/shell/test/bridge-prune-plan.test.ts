/**
 * retention P1 — seam face for the READ-ONLY `session.prune.plan` frame.
 * Fake transport only; no host, no delete frame, no filesystem mutation.
 */
import { describe, expect, test } from "bun:test"
import {
  BridgeProtocolError,
  BridgeSessionSeam,
  projectBridgePrunePlan,
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
})
