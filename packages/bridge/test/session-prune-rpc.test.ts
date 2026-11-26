/**
 * retention P1 — protocol-level tests for the READ-ONLY `session.prune.plan`
 * frame. Same fake-cordis-ctx + fake-stdio technique as session-list.test.ts;
 * no host package is imported. The positive case uses a checked-in fixture
 * ARTIFACT FILE as the backend-resolved location and a `stat` stub — no real
 * deletion, no rename, no session.lock write.
 *
 * B1: `location.path` is the artifact file (`session.v4.jsonl.zstd`); the
 * session directory is its dirname and its basename is `encodeSegment(id)`.
 * The probe id below contains `~`, so its directory is `probe~007E1` — this
 * reproduces the real host layout rather than a raw-id directory name.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { apply } from "../src/index"
import { setFlockTryLockExclusiveForTest } from "../src/prune-lock-probe"
import { computeConfigFingerprint } from "../src/session-prune-apply"
import { encodeSegment } from "../src/session-prune"

const STDIO_SWITCH = "DSH_OPENTUI_BRIDGE_STDIO"
const FIXTURE_ROOT = resolve(import.meta.dir, "fixtures/session-prune-sessions")
const FIXTURE_PROJECT = "_no-cwd"
const ARTIFACT_FILENAME = "session.v4.jsonl.zstd"
const FIXTURE_ID = "s-prune"
const PROBE_ID = "probe~1" // real-host probe: encodeSegment -> probe~007E1
const fixtureArtifact = (id: string) =>
  resolve(FIXTURE_ROOT, FIXTURE_PROJECT, encodeSegment(id), ARTIFACT_FILENAME)
const FIXTURE_LOCATION = fixtureArtifact(FIXTURE_ID) // backend-resolved artifact file, not built by the planner
const PROBE_LOCATION = fixtureArtifact(PROBE_ID)
const OLD_UPDATED = Date.UTC(2026, 0, 1, 0, 0, 0) // >90 days before "now"

type Frame = Record<string, any>
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

interface Harness {
  send(frame: unknown): void
  waitFor(id: number | string): Promise<Frame>
}

/** The sessions root enters through HOST config (apply's second argument),
 *  never through the client wire params. Tests inject a fixture root here. */
function makeHarness(
  services: Record<string, unknown>,
  config: Record<string, unknown> = { sessionsRoot: FIXTURE_ROOT, freshMtimeGraceMs: 0 },
): Harness {
  const previousSwitch = process.env[STDIO_SWITCH]
  process.env[STDIO_SWITCH] = "1"
  const originalWrite = process.stdout.write.bind(process.stdout)
  const frames: string[] = []
  process.stdout.write = function (this: unknown, chunk: any, ...rest: any[]) {
    const text = String(chunk)
    frames.push(text)
    let parsed: any
    try { parsed = JSON.parse(text.trim()) } catch { /* reporter noise */ }
    const isBridgeFrame = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) &&
      ("ok" in parsed || "type" in parsed) && ("id" in parsed || "payload" in parsed || "result" in parsed || "error" in parsed)
    if (isBridgeFrame) return true
    return originalWrite(chunk, ...rest)
  } as typeof process.stdout.write

  const stdinListeners: Record<string, Array<(...a: any[]) => void>> = {}
  const fakeStdin = {
    setEncoding() {},
    on(name: string, fn: (...a: any[]) => void) { (stdinListeners[name] ||= []).push(fn); return fakeStdin },
    off(name: string, fn: (...a: any[]) => void) {
      stdinListeners[name] = (stdinListeners[name] ?? []).filter((f) => f !== fn)
      return fakeStdin
    },
    once(name: string, fn: (...a: any[]) => void) { (stdinListeners[name] ||= []).push(fn); return fakeStdin },
    pause() { return fakeStdin },
    resume() { return fakeStdin },
  }
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process, "stdin")
  Object.defineProperty(process, "stdin", { value: fakeStdin, configurable: true })

  let disposeBridge: (() => void) | undefined
  const agent = { status: "idle", session: { seq: 0 }, followup() {}, steer() {}, cancel() {}, whenIdle: () => new Promise<void>(() => {}) }
  const ctx: any = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    effect(execute: () => () => void) { disposeBridge = execute(); return { dispose: () => disposeBridge?.() } },
    on() { return () => {} },
    get(name: string) { return services[name] },
    agents: {
      async create() { return { agent, dispose: async () => {} } },
      async resume() { return { agent, dispose: async () => {} } },
      get() { return undefined },
    },
  }
  // Protocol tests have no host addon closure. Force a deterministic,
  // read-only capability stub; the real addon is covered by the canary test.
  setFlockTryLockExclusiveForTest(async () => {})
  apply(ctx, config)

  cleanups.push(() => {
    setFlockTryLockExclusiveForTest(undefined)
    try { disposeBridge?.() } catch { /* already torn down */ }
    process.stdout.write = originalWrite
    if (stdinDescriptor) Object.defineProperty(process, "stdin", stdinDescriptor)
    else delete (process as any).stdin
    if (previousSwitch === undefined) delete process.env[STDIO_SWITCH]
    else process.env[STDIO_SWITCH] = previousSwitch
  })

  const latest = (id: number | string): Frame | undefined => {
    for (let i = frames.length - 1; i >= 0; i--) {
      try {
        const frame = JSON.parse(frames[i])
        if (frame !== null && typeof frame === "object" && frame.id === id) return frame
      } catch { /* non-frame output */ }
    }
    return undefined
  }
  return {
    send(frame: unknown) {
      for (const fn of stdinListeners.data ?? []) fn(JSON.stringify(frame) + "\n")
    },
    async waitFor(id: number | string): Promise<Frame> {
      const deadline = Date.now() + 2000
      for (;;) {
        const frame = latest(id)
        if (frame !== undefined) return frame
        if (Date.now() > deadline) throw new Error(`no response frame for id=${id}`)
        await sleep(1)
      }
    },
  }
}

function controller(items: unknown[]) {
  return { async list() { return { items } } }
}

const statCapable = {
  async open() { throw new Error("plan must never open a handle") },
  async stat(id: string) {
    const path = id === FIXTURE_ID ? FIXTURE_LOCATION : id === PROBE_ID ? PROBE_LOCATION : undefined
    if (path === undefined) return undefined
    return { header: { id, createdAt: OLD_UPDATED }, location: { kind: "jsonl", path } }
  },
}

describe("session.prune.plan — read-only RPC", () => {
  test("stat capability missing => UNSUPPORTED (not a fake empty plan)", async () => {
    const h = makeHarness({ sessionController: controller([]), sessionPersistence: { async open() { throw new Error("unused") } } })
    h.send({ id: 1, method: "session.prune.plan", params: {} })
    const reply = await h.waitFor(1)
    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("UNSUPPORTED")
  })

  test("sessionController missing => UNSUPPORTED", async () => {
    const h = makeHarness({ sessionPersistence: statCapable })
    h.send({ id: 2, method: "session.prune.plan", params: {} })
    const reply = await h.waitFor(2)
    expect(reply.error.code).toBe("UNSUPPORTED")
  })

  test("bad retentionDays => BAD_PARAMS", async () => {
    const h = makeHarness({ sessionController: controller([]), sessionPersistence: statCapable })
    h.send({ id: 3, method: "session.prune.plan", params: { retentionDays: -1 } })
    const reply = await h.waitFor(3)
    expect(reply.error.code).toBe("BAD_PARAMS")
  })

  test("HOST config retentionDays=0 => every row skipped, zero prune (wire cannot set it)", async () => {
    const h = makeHarness({
      sessionController: controller([{ sessionId: FIXTURE_ID, updatedAt: OLD_UPDATED, agentAvailable: false, running: false, blank: false }]),
      sessionPersistence: statCapable,
    }, { sessionsRoot: FIXTURE_ROOT, freshMtimeGraceMs: 0, retentionDays: 0 })
    h.send({ id: 4, method: "session.prune.plan", params: {} })
    const reply = await h.waitFor(4)
    expect(reply.ok).toBe(true)
    expect(reply.result.retentionDays).toBe(0)
    expect(reply.result.counts.prune).toBe(0)
    expect(reply.result.entries[0].reason).toBe("retention-disabled")

    // The same value over the wire is rejected: policy is host-only.
    const wire = makeHarness({ sessionController: controller([]), sessionPersistence: statCapable })
    wire.send({ id: 40, method: "session.prune.plan", params: { retentionDays: 0 } })
    expect((await wire.waitFor(40)).error.code).toBe("BAD_PARAMS")
  })

  test("valid plan reply has entries/counts and never a delete frame", async () => {
    const h = makeHarness({
      sessionController: controller([{ sessionId: FIXTURE_ID, updatedAt: OLD_UPDATED, agentAvailable: false, running: false, blank: false }]),
      sessionPersistence: statCapable,
    })
    h.send({ id: 5, method: "session.prune.plan", params: {} })
    const reply = await h.waitFor(5)
    expect(reply.ok).toBe(true)
    expect(reply.result.retentionDays).toBe(90)
    expect(reply.result.entries[0]).toMatchObject({ sessionId: FIXTURE_ID, decision: "prune" })
    expect(reply.result.counts).toMatchObject({ prune: 1, skip: 0 })
  })

  test("host/plugin config overrides policy; summary + configFingerprint match apply's resolver", async () => {
    const config = {
      sessionsRoot: FIXTURE_ROOT, freshMtimeGraceMs: 0,
      retentionDays: 30, blankGraceDays: 7, lockGraceMs: 1_000,
    }
    const h = makeHarness({
      sessionController: controller([{ sessionId: FIXTURE_ID, updatedAt: OLD_UPDATED, agentAvailable: false, running: false, blank: false }]),
      sessionPersistence: statCapable,
    }, config)
    h.send({ id: 41, method: "session.prune.plan", params: {} })
    const reply = await h.waitFor(41)
    expect(reply.ok).toBe(true)
    // /prune's summary reads plan.retentionDays — it must be the effective
    // host setting, not the wire default.
    expect(reply.result.retentionDays).toBe(30)
    expect(reply.result.configFingerprint).toBe(computeConfigFingerprint({
      retentionDays: 30, blankGraceDays: 7, lockGraceMs: 1_000,
      freshMtimeGraceMs: 0, sessionsRoot: FIXTURE_ROOT,
    }))
  })

  test("§2 real profile config.json is authoritative; apply(ctx,config) cannot spoof retentionDays", async () => {
    // Investigated surfaces (host 0.2.2-rc.5): settingsController exposes only
    // redacted settings namespaces (no top-level retentionDays); ctx.get('config')
    // is not a provided service. The real surface is profileContext.dir/config.json.
    const profileDir = mkdtempSync(join(tmpdir(), "dsh-prune-profile-"))
    cleanups.push(() => rmSync(profileDir, { recursive: true, force: true }))
    writeFileSync(join(profileDir, "config.json"), JSON.stringify({ retentionDays: 14, theme: "carbonfox" }))
    const h = makeHarness({
      sessionController: controller([{ sessionId: FIXTURE_ID, updatedAt: OLD_UPDATED, agentAvailable: false, running: false, blank: false }]),
      sessionPersistence: statCapable,
      profileContext: { name: "opentui-monday", dir: profileDir, home: profileDir },
    }, { sessionsRoot: FIXTURE_ROOT, freshMtimeGraceMs: 0, retentionDays: 90 })
    h.send({ id: 42, method: "session.prune.plan", params: {} })
    const reply = await h.waitFor(42)
    expect(reply.ok).toBe(true)
    expect(reply.result.retentionDays).toBe(14)
    expect(reply.result.configFingerprint).toBe(computeConfigFingerprint({
      retentionDays: 14, blankGraceDays: 30, lockGraceMs: 300_000,
      freshMtimeGraceMs: 0, sessionsRoot: FIXTURE_ROOT,
    }))
  })

  test("§2 local profile config.json currently declares retentionDays=14", () => {
    const configPath = join(homedir(), ".dsh", "profiles", "opentui-monday", "config.json")
    if (!existsSync(configPath)) return
    const parsed = JSON.parse(readFileSync(configPath, "utf8"))
    expect(typeof parsed.retentionDays).toBe("number")
    expect(parsed.retentionDays).toBe(14)
  })

  test("B1 real-host probe: artifact file + encoded dir basename prunes, not always skip", async () => {
    const h = makeHarness({
      sessionController: controller([{ sessionId: PROBE_ID, updatedAt: OLD_UPDATED, agentAvailable: false, running: false, blank: false }]),
      sessionPersistence: statCapable,
    })
    h.send({ id: 6, method: "session.prune.plan", params: {} })
    const reply = await h.waitFor(6)
    expect(reply.ok).toBe(true)
    expect(encodeSegment(PROBE_ID)).toBe("probe~007E1")
    expect(reply.result.entries[0]).toMatchObject({ sessionId: PROBE_ID, decision: "prune" })
    expect(reply.result.counts).toMatchObject({ prune: 1, skip: 0 })
    expect(PROBE_LOCATION).toContain("/probe~007E1/session.v4.jsonl.zstd")
  })

  test("client-supplied sessionsRoot is rejected (root is host-derived)", async () => {
    const h = makeHarness({ sessionController: controller([]), sessionPersistence: statCapable })
    h.send({ id: 7, method: "session.prune.plan", params: { sessionsRoot: "/tmp/evil" } })
    const reply = await h.waitFor(7)
    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("BAD_PARAMS")
    expect(reply.result).toBeUndefined()
  })

  test("missing running / blank is a field anomaly, never a prune candidate", async () => {
    const h = makeHarness({
      sessionController: controller([
        { sessionId: "no-running", updatedAt: OLD_UPDATED, agentAvailable: false, blank: false },
        { sessionId: "no-blank", updatedAt: OLD_UPDATED, agentAvailable: false, running: false },
      ]),
      sessionPersistence: statCapable,
    })
    h.send({ id: 8, method: "session.prune.plan", params: {} })
    const reply = await h.waitFor(8)
    expect(reply.ok).toBe(true)
    expect(reply.result.entries.map((e: any) => [e.sessionId, e.reason])).toEqual([
      ["no-running", "field-anomaly"],
      ["no-blank", "field-anomaly"],
    ])
    expect(reply.result.counts.prune).toBe(0)
  })

  test("truncated roster aborts the whole plan (BLOCKED, no partial decision table)", async () => {
    const h = makeHarness({
      sessionController: {
        async list() {
          return {
            items: [{ sessionId: FIXTURE_ID, updatedAt: OLD_UPDATED, agentAvailable: false, running: false, blank: false }],
            hasMore: true,
            nextCursor: "same",
          }
        },
      },
      sessionPersistence: statCapable,
    })
    h.send({ id: 9, method: "session.prune.plan", params: {} })
    const reply = await h.waitFor(9)
    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("BLOCKED")
    expect(reply.error.detail.reason).toBe("incomplete-roster")
    expect(reply.result).toBeUndefined()
  })

  test("session.list cursor failure propagates to the wire (INTERNAL, no silent plan)", async () => {
    const h = makeHarness({
      sessionController: {
        async list() { throw new Error("cursor backend blew up") },
      },
      sessionPersistence: statCapable,
    })
    h.send({ id: 10, method: "session.prune.plan", params: {} })
    const reply = await h.waitFor(10)
    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("INTERNAL")
    expect(reply.result).toBeUndefined()
  })

  test("flock capability missing => UNSUPPORTED (never assume no writer holds the lock)", async () => {
    const h = makeHarness({
      sessionController: controller([{ sessionId: FIXTURE_ID, updatedAt: OLD_UPDATED, agentAvailable: false, running: false, blank: false }]),
      sessionPersistence: statCapable,
    })
    // makeHarness installs a deterministic stub; clear it AFTER setup so the
    // capability probe sees a host without the addon.
    setFlockTryLockExclusiveForTest(undefined)
    h.send({ id: 11, method: "session.prune.plan", params: {} })
    const reply = await h.waitFor(11)
    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("UNSUPPORTED")
    expect(reply.result).toBeUndefined()
  })

  test("P2 agentAvailable gate on the wire: true skips, absent/non-boolean is a field anomaly", async () => {
    const h = makeHarness({
      sessionController: controller([
        { sessionId: FIXTURE_ID, updatedAt: OLD_UPDATED, agentAvailable: true, running: false, blank: false },
      ]),
      sessionPersistence: statCapable,
    })
    h.send({ id: 12, method: "session.prune.plan", params: {} })
    const attached = await h.waitFor(12)
    expect(attached.ok).toBe(true)
    expect(attached.result.entries[0]).toMatchObject({ sessionId: FIXTURE_ID, decision: "skip", reason: "agent-available" })
    expect(attached.result.counts.prune).toBe(0)

    const h2 = makeHarness({
      sessionController: controller([
        { sessionId: FIXTURE_ID, updatedAt: OLD_UPDATED, running: false, blank: false },
      ]),
      sessionPersistence: statCapable,
    })
    h2.send({ id: 13, method: "session.prune.plan", params: {} })
    const absent = await h2.waitFor(13)
    expect(absent.ok).toBe(true)
    expect(absent.result.entries[0].reason).toBe("field-anomaly")
    expect(absent.result.counts.prune).toBe(0)
  })
})

describe("session.prune.apply — wire contract (no mutation exercised)", () => {
  const row = () => ({ sessionId: FIXTURE_ID, updatedAt: OLD_UPDATED, agentAvailable: false, running: false, blank: false })

  test("client entries / policy are rejected with BAD_PARAMS (stagedIds is exclusion-only, allowed)", async () => {
    for (const [id, extra] of [
      [20, { entries: [] }],
      [21, { retentionDays: 1 }],
      [22, { blankGraceDays: 0 }],
      [23, { lockGraceMs: 0 }],
      [24, { freshMtimeGraceMs: 0 }],
      [25, { sessionsRoot: "/tmp/evil" }],
      [26, { dshHome: "/tmp/evil" }],
    ] as Array<[number, Record<string, unknown>]>) {
      const h = makeHarness({ sessionController: controller([row()]), sessionPersistence: statCapable })
      h.send({ id, method: "session.prune.apply", params: {
        fingerprint: "x", configFingerprint: "y", generatedAt: Date.now(), ...extra,
      } })
      const reply = await h.waitFor(id)
      expect(reply.ok).toBe(false)
      expect(reply.error.code).toBe("BAD_PARAMS")
      expect(reply.result).toBeUndefined()
    }
  })

  test("plan fingerprints are echoed; a wrong plan fingerprint is STALE_PLAN", async () => {
    const h = makeHarness({ sessionController: controller([row()]), sessionPersistence: statCapable })
    h.send({ id: 30, method: "session.prune.plan", params: {} })
    const planned = await h.waitFor(30)
    expect(planned.ok).toBe(true)
    expect(typeof planned.result.fingerprint).toBe("string")
    expect(typeof planned.result.configFingerprint).toBe("string")

    h.send({ id: 31, method: "session.prune.apply", params: {
      fingerprint: "deadbeef", configFingerprint: planned.result.configFingerprint,
      generatedAt: planned.result.generatedAt,
    } })
    const applied = await h.waitFor(31)
    expect(applied.ok).toBe(false)
    expect(applied.error.code).toBe("STALE_PLAN")
    expect(applied.error.detail.reason).toBe("plan-fingerprint")
    expect(applied.result).toBeUndefined()
  })

  test("config fingerprint mismatch and stale plan are both STALE_PLAN", async () => {
    const h = makeHarness({ sessionController: controller([row()]), sessionPersistence: statCapable })
    h.send({ id: 32, method: "session.prune.plan", params: {} })
    const planned = await h.waitFor(32)

    h.send({ id: 33, method: "session.prune.apply", params: {
      fingerprint: planned.result.fingerprint, configFingerprint: "deadbeef",
      generatedAt: planned.result.generatedAt,
    } })
    expect((await h.waitFor(33)).error.detail.reason).toBe("config-fingerprint")

    h.send({ id: 34, method: "session.prune.apply", params: {
      fingerprint: planned.result.fingerprint, configFingerprint: planned.result.configFingerprint,
      generatedAt: 0,
    } })
    expect((await h.waitFor(34)).error.detail.reason).toBe("max-age")
  })

  test("stagedIds is an exclusion-only echo: /resume then /prune can apply", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "dsh-prune-staged-"))
    const config = { sessionsRoot: FIXTURE_ROOT, freshMtimeGraceMs: 0, dshHome: tmpHome }
    const stagedRow = { sessionId: "staged-id", updatedAt: OLD_UPDATED, agentAvailable: false, running: false, blank: false }
    const h = makeHarness({ sessionController: controller([stagedRow]), sessionPersistence: statCapable }, config)
    h.send({ id: 50, method: "session.prune.plan", params: { stagedIds: ["staged-id"] } })
    const planned = await h.waitFor(50)
    expect(planned.ok).toBe(true)
    expect(planned.result.entries[0]).toMatchObject({ sessionId: "staged-id", decision: "skip", reason: "staged" })

    // The seam echoes the staged id on apply too; the recomputed plan then
    // carries the same skip, so the fingerprint matches and nothing is renamed.
    h.send({ id: 51, method: "session.prune.apply", params: {
      fingerprint: planned.result.fingerprint,
      configFingerprint: planned.result.configFingerprint,
      generatedAt: planned.result.generatedAt,
      stagedIds: ["staged-id"],
    } })
    const applied = await h.waitFor(51)
    expect(applied.ok).toBe(true)
    expect(applied.result.applied).toEqual([])

    // Without the echo the recomputed plan differs -> STALE_PLAN; staged ids
    // can only ADD skips, never widen the delete set.
    h.send({ id: 52, method: "session.prune.apply", params: {
      fingerprint: planned.result.fingerprint,
      configFingerprint: planned.result.configFingerprint,
      generatedAt: planned.result.generatedAt,
    } })
    const noEcho = await h.waitFor(52)
    expect(noEcho.ok).toBe(false)
    expect(noEcho.error.detail.reason).toBe("plan-fingerprint")
    rmSync(tmpHome, { recursive: true, force: true })
  })

  test("apply-lock throws with dshHome in the message => fixed wire text, no path", async () => {
    // retentionDays=0 makes the recomputed plan skip every row before the
    // lock probe, so the echo fingerprint still matches; applyTrashPlan then
    // takes the host apply lock, which is where the throwing flock surfaces.
    const home = mkdtempSync(join(tmpdir(), "dsh-prune-apply-lock-"))
    const config = { sessionsRoot: FIXTURE_ROOT, freshMtimeGraceMs: 0, retentionDays: 0, dshHome: home }
    const h = makeHarness({ sessionController: controller([row()]), sessionPersistence: statCapable }, config)
    h.send({ id: 60, method: "session.prune.plan", params: {} })
    const planned = await h.waitFor(60)
    expect(planned.ok).toBe(true)
    expect(planned.result.entries[0].reason).toBe("retention-disabled")

    const secret = `${home}/trash/.apply.lock`
    setFlockTryLockExclusiveForTest(async () => { throw new Error(`EACCES: cannot lock ${secret}`) })
    h.send({ id: 61, method: "session.prune.apply", params: {
      fingerprint: planned.result.fingerprint,
      configFingerprint: planned.result.configFingerprint,
      generatedAt: planned.result.generatedAt,
    } })
    const applied = await h.waitFor(61)
    expect(applied.ok).toBe(false)
    expect(applied.error.code).toBe("INTERNAL")
    expect(applied.error.message).toBe("session.prune.apply failed")
    expect(applied.error.detail).toBeUndefined()
    expect(JSON.stringify(applied)).not.toContain(secret)
    expect(JSON.stringify(applied)).not.toContain(home)
    rmSync(home, { recursive: true, force: true })
  })
})
