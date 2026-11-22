/**
 * F1 (2026-11-22 real-machine收尾) — child approval integration, real seam↔bridge frame channel.
 *
 * The 2026-11-22 real-machine run showed child tools getting
 * `Error: the user rejected tool "write"` with NO child card. Root cause (see
 * .proof/f1-a1-ask-routing/01-child-approval-rejection-evidence.md): the host
 * pins a delegated child's approval policy to 'never' (source:'delegation'),
 * so `dsh-user-approval.decide()` returns 'rejected' BEFORE dispatching the
 * 'approval/request' waterfall — the bridge's F1 answerer is never invoked.
 *
 * This test drives the FULL chain over the real NDJSON frame channel:
 *   parent catalog event → bridge re-pins child policy 'never'→'ask' →
 *   child approval/request → bridge emits ask.request →
 *   real BridgeSessionSeam answers via ask.response →
 *   AskRegistry settles approved/denied → host answerer returns allowed-once/rejected.
 *
 * Two cases: Allow → approved → allowed-once (tool released), Reject → denied → rejected.
 * Plus fail-closed regressions (foreign child not re-pinned; already-explicit
 * policy not overwritten). No pure-unit shortcuts: frames actually cross the
 * seam↔bridge boundary.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { apply } from "../../bridge/src/index.ts"
import {
  BridgeSessionSeam,
  type BridgeTransport,
} from "../src/client/bridge-session-seam.ts"

const STDIO_SWITCH = "DSH_OPENTUI_BRIDGE_STDIO"
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

interface FakeChildSession {
  appended: Array<{ type: string; data: Record<string, unknown> }>
  append(type: string, data: Record<string, unknown>): void
  policy(): string | undefined
}
function makeChildSession(): FakeChildSession {
  const appended: Array<{ type: string; data: Record<string, unknown> }> = []
  return {
    appended,
    append(type, data) { appended.push({ type, data }) },
    policy() {
      for (let i = appended.length - 1; i >= 0; i--) {
        if (appended[i].type === "approval/policy") return appended[i].data.policy as string
      }
      return undefined
    },
  }
}

interface Harness {
  ctx: any
  child: FakeChildSession
  send(frame: unknown): void
  waitFor(id: number): Promise<any>
  emitSessionEvent(session: unknown, event: unknown): void
  emitHost(name: string, request: unknown): Promise<any>
  waitForEvent(type: string): Promise<any>
  dispose(): void
  nextId(): number
}

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

function makeHarness(): Harness {
  const prev = process.env[STDIO_SWITCH]
  process.env[STDIO_SWITCH] = "1"
  const originalWrite = process.stdout.write.bind(process.stdout)
  const frames: any[] = []
  const eventWaiters = new Map<string, Array<(frame: any) => void>>()
  process.stdout.write = function (this: unknown, chunk: any, ...rest: any[]) {
    const text = String(chunk)
    let parsed: any
    try { parsed = JSON.parse(text.trim()) } catch { /* noise */ }
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) &&
        ("id" in parsed || "type" in parsed)) {
      frames.push(parsed)
      if (typeof parsed.type === "string") {
        for (const w of eventWaiters.get(parsed.type) ?? []) w(parsed)
        eventWaiters.delete(parsed.type)
      }
      return true // swallow bridge protocol frames; keep the harness output clean
    }
    return originalWrite(chunk, ...rest)
  } as typeof process.stdout.write

  const stdinListeners: Record<string, Array<(data: any) => void>> = {}
  const fakeStdin: any = {
    setEncoding() {},
    on(name: string, fn: (data: any) => void) { (stdinListeners[name] ||= []).push(fn); return fakeStdin },
    off(name: string, fn: (data: any) => void) { stdinListeners[name] = (stdinListeners[name] || []).filter((f) => f !== fn); return fakeStdin },
    once(name: string, fn: (data: any) => void) { (stdinListeners[name] ||= []).push(fn); return fakeStdin },
    pause() { return fakeStdin },
    resume() { return fakeStdin },
  }
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process, "stdin")
  Object.defineProperty(process, "stdin", { value: fakeStdin, configurable: true })

  const listeners = new Map<string, Array<(...args: any[]) => any>>()
  const agent = {
    status: "idle",
    session: { seq: 0 },
    followup() {},
    steer() {},
    cancel() {},
    whenIdle() { return new Promise<void>(() => {}) }, // hold the turn open
  }
  const child = makeChildSession()
  // The bridge's syncChildApprovalPolicy now consults BOTH the child session and
  // its parent before mirroring the parent policy. Mirror the real host contract
  // in the fake: sessions.get resolves the parent too (any non-child id — the
  // catalog handler already rejects a foreign parent before sync runs), and
  // approval.effectivePolicy is `overrideOf(session) ?? config.policy ?? 'ask'`
  // (dsh-user-approval/lib/index.js:177). config.policy='ask' matches every case's
  // expected re-pin (delegation 'never' overridden → child policy 'ask').
  const fakeParentSession = { id: "fake-parent-session" }
  let disposeBridge: (() => void) | undefined

  const ctx: any = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    effect(execute: () => () => void) { disposeBridge = execute(); return { dispose: () => disposeBridge?.() } },
    on(name: string, listener: (...args: any[]) => any) {
      const next = [...(listeners.get(name) || []), listener]
      listeners.set(name, next)
      return () => listeners.set(name, next.filter((l) => l !== listener))
    },
    get(name: string) {
      if (name === "sessions") {
        return { get(id: string) { return id === "child-1" ? child : fakeParentSession } }
      }
      if (name === "approval") {
        const overrideOf = (session: FakeChildSession) => (session === child ? child.policy() : undefined)
        const configPolicy = "ask"
        return {
          overrideOf,
          effectivePolicy(session: FakeChildSession) {
            return overrideOf(session) ?? configPolicy ?? "ask"
          },
        }
      }
      return undefined
    },
    agents: {
      async create() { return { agent, dispose: async () => {} } },
      async resume() { return { agent, dispose: async () => {} } },
      get() { return undefined },
    },
  }
  apply(ctx, {})
  cleanups.push(() => {
    try { disposeBridge?.() } catch { /* already torn down */ }
    process.stdout.write = originalWrite
    if (stdinDescriptor) Object.defineProperty(process, "stdin", stdinDescriptor)
    else delete (process as any).stdin
    if (prev === undefined) delete process.env[STDIO_SWITCH]
    else process.env[STDIO_SWITCH] = prev
  })

  let idSeq = 1000
  const send = (frame: unknown) => {
    const line = `${JSON.stringify(frame)}\n`
    for (const fn of stdinListeners["data"] || []) fn(line)
  }
  const waitFor = async (id: number): Promise<any> => {
    const deadline = Date.now() + 2000
    for (;;) {
      const f = [...frames].reverse().find((x) => x?.id === id)
      if (f !== undefined) return f
      if (Date.now() > deadline) throw new Error(`no reply for id=${id}`)
      await sleep(1)
    }
  }
  const waitForEvent = async (type: string): Promise<any> => {
    const existing = frames.find((x) => x?.type === type)
    if (existing !== undefined) return existing
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no event ${type}`)), 2000)
      eventWaiters.set(type, [...(eventWaiters.get(type) ?? []), (f) => { clearTimeout(timer); resolve(f) }])
    })
  }

  return {
    ctx,
    child,
    send,
    waitFor,
    waitForEvent,
    emitSessionEvent(session, event) {
      for (const fn of listeners.get("session/event") || []) fn(session, event)
    },
    emitHost(name, request) {
      const fns = listeners.get(name) || []
      return Promise.resolve(fns[0](request, async () => { throw new Error("next() must not be reached") }))
    },
    dispose() { disposeBridge?.() },
    nextId() { return ++idSeq },
  }
}

async function startTurn(h: Harness): Promise<string> {
  const id = h.nextId()
  h.send({ id, method: "session.open", params: { mode: "new" } })
  const opened = await h.waitFor(id)
  expect(opened.ok).toBe(true)
  const parent = opened.result.sessionId as string
  h.send({ id: id + 1, method: "session.send", params: { text: "delegate" } })
  const sent = await h.waitFor(id + 1)
  expect(sent.ok).toBe(true)
  return parent
}

/** Wire a real BridgeSessionSeam to the bridge via a transport that forwards
 *  every request onto the real bridge stdin and dispatches its event frames. */
function makeSeam(h: Harness, verdict: "allow" | "deny") {
  const frameListeners: Array<(frame: any) => void> = []
  const transport: BridgeTransport = {
    async request(method, params) {
      const id = h.nextId()
      h.send({ id, method, params })
      const reply = await h.waitFor(id)
      if (!reply.ok) throw new Error(`${reply.error?.code}: ${reply.error?.message}`)
      return reply.result ?? {}
    },
    onEvent(listener) {
      frameListeners.push(listener)
      return () => { const i = frameListeners.indexOf(listener); if (i >= 0) frameListeners.splice(i, 1) }
    },
  }
  const seam = new BridgeSessionSeam({ transport, ctx: { logger: { info() {}, warn() {}, error() {} } } })
  // Answer approval asks through the seam's real ask provider (no turn needed):
  // 'allow' → verdict allowed-once, 'deny' → rejected, exactly the card's two buttons.
  seam.registerAskProvider(async (questions) => questions.map((q) => ({
    questionId: q.id,
    selected: verdict === "allow" ? "allow" : "deny",
  })))
  return {
    seam,
    pump(frame: any) { for (const l of [...frameListeners]) l(frame) },
  }
}

async function runChildApproval(verdict: "allow" | "deny"): Promise<{ outcome: string; child: FakeChildSession; askFrame: any }> {
  const h = makeHarness()
  const parent = await startTurn(h)
  const s = makeSeam(h, verdict)

  // Parent journal catalog fact → bridge indexes the child AND re-pins its policy.
  h.emitSessionEvent({ id: parent }, { type: "subagent/catalog", data: { childId: "child-1", childCreatedAt: 1 } })
  expect(h.child.policy()).toBe("ask") // the fix: delegation 'never' overridden

  // Child approval request enters the host waterfall answerer.
  const answererPromise = h.emitHost("approval/request", {
    agent: { session: { id: "child-1" } },
    toolName: "write",
    callId: "call-child-1",
    reason: "Write operations require human approval",
  })

  // The ask.request frame crosses the wire into the real seam, which answers it.
  const askFrame = await h.waitForEvent("ask.request")
  expect(askFrame.payload.childSessionId).toBe("child-1")
  expect(askFrame.payload.parentSessionId).toBe(parent)
  expect(askFrame.payload.sessionId).toBe(parent) // T5: wire addressee stays parent
  s.pump(askFrame)

  const outcome = await Promise.race([
    answererPromise,
    new Promise<string>((_, reject) => setTimeout(() => reject(new Error("answerer hung")), 2000)),
  ])
  return { outcome: String(outcome), child: h.child, askFrame }
}

describe("F1 child approval — real seam↔bridge frame channel", () => {
  test("child card Allow → ask settles approved → host returns allowed-once (tool released)", async () => {
    const { outcome, askFrame } = await runChildApproval("allow")
    expect(outcome).toBe("allowed-once")
    // The response verdict that crossed back is allowed-once for this eventId.
    expect(askFrame.payload.eventId).toBeTruthy()
  })

  test("child card Reject → ask settles denied → host returns rejected", async () => {
    const { outcome } = await runChildApproval("deny")
    expect(outcome).toBe("rejected")
  })

  test("fail-closed: a child of a FOREIGN parent is not re-pinned (no policy widening)", async () => {
    const h = makeHarness()
    await startTurn(h)
    h.emitSessionEvent({ id: "other-parent" }, { type: "subagent/catalog", data: { childId: "child-1", childCreatedAt: 1 } })
    expect(h.child.policy()).toBeUndefined() // untouched
  })

  test("idempotent: a replayed catalog row does not append a second policy event", async () => {
    const h = makeHarness()
    const parent = await startTurn(h)
    h.emitSessionEvent({ id: parent }, { type: "subagent/catalog", data: { childId: "child-1", childCreatedAt: 1 } })
    h.emitSessionEvent({ id: parent }, { type: "subagent/catalog", data: { childId: "child-1", childCreatedAt: 1 } })
    const policyEvents = h.child.appended.filter((a) => a.type === "approval/policy")
    expect(policyEvents.length).toBe(1)
  })

  test("an already-answerable ('ask') child policy is left untouched (no duplicate churn)", async () => {
    const h = makeHarness()
    const parent = await startTurn(h)
    h.child.append("approval/policy", { policy: "ask" })
    h.emitSessionEvent({ id: parent }, { type: "subagent/catalog", data: { childId: "child-1", childCreatedAt: 1 } })
    const policyEvents = h.child.appended.filter((a) => a.type === "approval/policy")
    expect(policyEvents.length).toBe(1) // the pre-existing 'ask' — no re-pin append
    expect(h.child.policy()).toBe("ask")
  })
})
