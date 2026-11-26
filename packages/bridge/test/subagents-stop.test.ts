/**
 * Protocol-level tests for the L1 stop capability (0.23.1):
 *   subagents.interrupt     {parentSessionId, childId}
 *   subagents.stopChildren  {parentSessionId}
 * plus the additive `capabilities` field on the handshake.
 *
 * Fake cordis ctx + fake stdin/stdout drives the real `apply()` through the
 * NDJSON wire (same technique as session-list.test.ts). `session.list` is a
 * stub returning configurable rows; `ctx.agents.get(childId)` returns a child
 * agent with a cancel spy so we can assert exactly which children were stopped
 * and that a failing child stays isolated from the rest of the batch.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { apply } from "../src/index"
import { getSubagentIndex } from "../src/subagent-index"

const STDIO_SWITCH = "DSH_OPENTUI_BRIDGE_STDIO"
type Frame = Record<string, any>
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

const childRow = (sessionId: string, parentSessionId: string, running = true) => ({
  sessionId,
  updatedAt: 1000,
  agentAvailable: running,
  running,
  blank: false,
  parentSessionId,
  origin: "subagent",
})

interface ChildSpec {
  failWith?: string
}

function makeHarness(options: { rows?: Frame[]; children?: Record<string, ChildSpec> } = {}) {
  const previousSwitch = process.env[STDIO_SWITCH]
  process.env[STDIO_SWITCH] = "1"

  const originalWrite = process.stdout.write.bind(process.stdout)
  const frames: string[] = []
  const patchedWrite = function (this: unknown, chunk: any, ...rest: any[]) {
    frames.push(String(chunk))
    let parsed: any
    try { parsed = JSON.parse(String(chunk).trim()) } catch { /* reporter noise */ }
    const isBridgeFrame =
      parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) &&
      ("ok" in parsed || "type" in parsed) &&
      ("id" in parsed || "payload" in parsed || "result" in parsed || "error" in parsed)
    if (isBridgeFrame) return true
    return originalWrite(chunk, ...rest)
  } as typeof process.stdout.write
  process.stdout.write = patchedWrite

  const stdinListeners: Record<string, Array<(...args: any[]) => void>> = {}
  const fakeStdin = {
    setEncoding() {},
    on(name: string, fn: (...args: any[]) => void) { (stdinListeners[name] ||= []).push(fn); return fakeStdin },
    off(name: string, fn: (...args: any[]) => void) { stdinListeners[name] = (stdinListeners[name] || []).filter((f) => f !== fn); return fakeStdin },
    pause() { return fakeStdin },
    resume() { return fakeStdin },
  }
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process, "stdin")
  Object.defineProperty(process, "stdin", { value: fakeStdin, configurable: true })

  // Mutable authoritative host list.
  let rows: Frame[] = [...(options.rows ?? [])]
  const controller = {
    calls: [] as any[],
    async list(request: any) {
      controller.calls.push(request)
      return { items: rows }
    },
  }

  // Child agents keyed by childId, each with a cancel spy.
  const childAgents = new Map<string, { cancelCalls: Array<{ cause: any; options: any }>; failWith?: string }>()
  for (const [id, spec] of Object.entries(options.children ?? {})) {
    childAgents.set(id, { cancelCalls: [], failWith: spec.failWith })
  }

  const idlePromise = new Promise<void>(() => { /* never resolves */ })
  const parentAgent = {
    status: "idle",
    session: { seq: 0 },
    followup() {},
    steer() {},
    cancel() {},
    whenIdle() { return idlePromise },
  }
  const agents = {
    async create() { return { agent: parentAgent, dispose: async () => {} } },
    async resume() { return { agent: parentAgent, dispose: async () => {} } },
    get(id: string) {
      const child = childAgents.get(id)
      if (child === undefined) return undefined
      // AgentsLike.get returns the agent directly (not a {agent,dispose} handle).
      return {
        ...parentAgent,
        cancel(cause: any, cancelOptions: any) {
          child.cancelCalls.push({ cause, options: cancelOptions })
          if (child.failWith !== undefined) throw new Error(child.failWith)
        },
      }
    },
  }

  const eventListeners = new Map<string, Array<(...args: any[]) => void>>()
  let disposeBridge: (() => void) | undefined
  const ctx: any = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    effect(execute: () => () => void) {
      disposeBridge = execute()
      return { dispose: () => disposeBridge?.() }
    },
    on(name: string, listener: (...args: any[]) => void) {
      const next = [...(eventListeners.get(name) || []), listener]
      eventListeners.set(name, next)
      return () => eventListeners.set(name, next.filter((l) => l !== listener))
    },
    get(name: string) {
      if (name === "sessionController") return controller
      if (name === "agents") return agents
      return undefined
    },
    agents,
  }
  apply(ctx, {})

  cleanups.push(() => {
    try { disposeBridge?.() } catch { /* already torn down */ }
    process.stdout.write = originalWrite
    if (stdinDescriptor) Object.defineProperty(process, "stdin", stdinDescriptor)
    else delete (process as any).stdin
    if (previousSwitch === undefined) delete process.env[STDIO_SWITCH]
    else process.env[STDIO_SWITCH] = previousSwitch
  })

  const latest = (id: number): Frame | undefined => {
    for (let i = frames.length - 1; i >= 0; i--) {
      try {
        const frame = JSON.parse(frames[i])
        if (frame !== null && typeof frame === "object" && frame.id === id) return frame
      } catch { /* noise */ }
    }
    return undefined
  }
  const waitFor = async (id: number): Promise<Frame> => {
    const deadline = Date.now() + 2000
    for (;;) {
      const frame = latest(id)
      if (frame !== undefined) return frame
      if (Date.now() > deadline) throw new Error(`no response for id=${id}`)
      await sleep(1)
    }
  }

  return {
    ctx,
    controller,
    childAgents,
    frames,
    latest,
    waitFor,
    setRows(next: Frame[]) { rows = next },
    cancelCallsOf(id: string) { return childAgents.get(id)?.cancelCalls ?? [] },
    emitSessionEvent(session: unknown, event: unknown) {
      for (const fn of eventListeners.get("session/event") || []) fn(session, event)
    },
    send(frame: unknown) {
      for (const fn of stdinListeners["data"] || []) fn(`${JSON.stringify(frame)}\n`)
    },
  }
}

/** Open a session and return its id (the bound parent for subagent frames). */
async function openParent(h: ReturnType<typeof makeHarness>, id: number): Promise<string> {
  h.send({ id, method: "session.open", params: { mode: "new" } })
  const opened = await h.waitFor(id)
  expect(opened.ok).toBe(true)
  return opened.result.sessionId as string
}

describe("handshake capabilities (additive)", () => {
  test("bridge.hello advertises the stop capabilities and session.steer", async () => {
    const h = makeHarness()
    h.send({ id: 1, method: "bridge.hello", params: { protocolVersion: 1 } })
    const hello = await h.waitFor(1)
    expect(hello.ok).toBe(true)
    expect(hello.result.protocolVersion).toBe(1)
    expect(hello.result.capabilities).toEqual(["subagents.interrupt", "subagents.stopChildren", "session.steer"])
  })

  test("bridge.ping advertises the same capabilities", async () => {
    const h = makeHarness()
    h.send({ id: 2, method: "bridge.ping" })
    const ping = await h.waitFor(2)
    expect(ping.ok).toBe(true)
    expect(ping.result.capabilities).toEqual(["subagents.interrupt", "subagents.stopChildren", "session.steer"])
  })
})

describe("subagents.stopChildren — normal", () => {
  test("cancels only RUNNING children of the bound parent, with the host cancel cause", async () => {
    const h = makeHarness({ children: { c1: {}, c2: {} } })
    const parent = await openParent(h, 10)
    h.setRows([
      childRow(parent, undefined, true), // parent row (not a subagent)
      childRow("c1", parent, true),
      childRow("c2", parent, true),
      childRow("c3", parent, false), // settled — must NOT be enumerated
    ])

    h.send({ id: 11, method: "subagents.stopChildren", params: { parentSessionId: parent } })
    const reply = await h.waitFor(11)

    expect(reply.ok).toBe(true)
    expect(reply.result.children.map((c: Frame) => c.childId).sort()).toEqual(["c1", "c2"])
    for (const c of reply.result.children) expect(c.disposition).toBe("cancel-issued")
    expect(h.cancelCallsOf("c1")).toHaveLength(1)
    expect(h.cancelCallsOf("c2")).toHaveLength(1)
    expect(h.cancelCallsOf("c1")[0]).toEqual({ cause: { kind: "user" }, options: { keepInbox: true } })
    expect(h.cancelCallsOf("c3")).toHaveLength(0)
    // One authoritative list snapshot per stop action.
    expect(h.controller.calls).toEqual([{ _request: {} }])
  })

  test("never enumerates a child of a different parent (no global stop)", async () => {
    const h = makeHarness({ children: { c1: {}, cOther: {} } })
    const parent = await openParent(h, 20)
    h.setRows([
      childRow("c1", parent, true),
      childRow("cOther", "SOME_OTHER_PARENT", true),
    ])

    h.send({ id: 21, method: "subagents.stopChildren", params: { parentSessionId: parent } })
    const reply = await h.waitFor(21)

    expect(reply.ok).toBe(true)
    expect(reply.result.children.map((c: Frame) => c.childId)).toEqual(["c1"])
    expect(h.cancelCallsOf("cOther")).toHaveLength(0)
  })

  test("an empty index yields an empty children list (no error, no cancel)", async () => {
    const h = makeHarness()
    const parent = await openParent(h, 22)
    h.setRows([])
    h.send({ id: 23, method: "subagents.stopChildren", params: { parentSessionId: parent } })
    const reply = await h.waitFor(23)
    expect(reply.ok).toBe(true)
    expect(reply.result).toEqual({ children: [] })
  })
})

describe("subagents.interrupt — normal", () => {
  test("a running child -> cancel-issued with exactly one cancel", async () => {
    const h = makeHarness({ children: { c1: {}, c2: {} } })
    const parent = await openParent(h, 30)
    h.setRows([childRow("c1", parent, true), childRow("c2", parent, true)])

    h.send({ id: 31, method: "subagents.interrupt", params: { parentSessionId: parent, childId: "c1" } })
    const reply = await h.waitFor(31)

    expect(reply.ok).toBe(true)
    expect(reply.result).toEqual({ childId: "c1", disposition: "cancel-issued" })
    expect(h.cancelCallsOf("c1")).toHaveLength(1)
    expect(h.cancelCallsOf("c2")).toHaveLength(0)
  })

  test("a settled child -> already-settled, zero cancels", async () => {
    const h = makeHarness({ children: { c3: {} } })
    const parent = await openParent(h, 32)
    h.setRows([childRow("c3", parent, false)])

    h.send({ id: 33, method: "subagents.interrupt", params: { parentSessionId: parent, childId: "c3" } })
    const reply = await h.waitFor(33)

    expect(reply.ok).toBe(true)
    expect(reply.result).toEqual({ childId: "c3", disposition: "already-settled" })
    expect(h.cancelCallsOf("c3")).toHaveLength(0)
  })
})

describe("ownership — zero enumeration, zero cancel on mismatch", () => {
  test("stopChildren with a non-bound parent -> OWNERSHIP_MISMATCH, no list call, no cancel", async () => {
    const h = makeHarness({ children: { c1: {} } })
    await openParent(h, 40)
    h.setRows([childRow("c1", "BOUND", true)])

    h.send({ id: 41, method: "subagents.stopChildren", params: { parentSessionId: "ATTACKER" } })
    const reply = await h.waitFor(41)

    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("OWNERSHIP_MISMATCH")
    expect(h.controller.calls).toHaveLength(0)
    expect(h.cancelCallsOf("c1")).toHaveLength(0)
  })

  test("interrupt with a non-bound parent -> OWNERSHIP_MISMATCH, no list call, no cancel", async () => {
    const h = makeHarness({ children: { c1: {} } })
    await openParent(h, 42)
    h.setRows([childRow("c1", "BOUND", true)])

    h.send({ id: 43, method: "subagents.interrupt", params: { parentSessionId: "ATTACKER", childId: "c1" } })
    const reply = await h.waitFor(43)

    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("OWNERSHIP_MISMATCH")
    expect(h.controller.calls).toHaveLength(0)
    expect(h.cancelCallsOf("c1")).toHaveLength(0)
  })

  test("a stop with no session open -> NO_SESSION, no list call, no cancel", async () => {
    const h = makeHarness({ children: { c1: {} } })
    h.setRows([childRow("c1", "any", true)])

    h.send({ id: 44, method: "subagents.stopChildren", params: { parentSessionId: "any" } })
    const reply = await h.waitFor(44)

    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("NO_SESSION")
    expect(h.controller.calls).toHaveLength(0)
    expect(h.cancelCallsOf("c1")).toHaveLength(0)
  })

  test("row-level gate: interrupt of a child belonging to another parent -> OWNERSHIP_MISMATCH, zero cancel", async () => {
    const h = makeHarness({ children: { cOther: {} } })
    const parent = await openParent(h, 45)
    h.setRows([childRow("cOther", "ANOTHER_PARENT", true)])

    h.send({ id: 46, method: "subagents.interrupt", params: { parentSessionId: parent, childId: "cOther" } })
    const reply = await h.waitFor(46)

    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("OWNERSHIP_MISMATCH")
    expect(h.cancelCallsOf("cOther")).toHaveLength(0)
  })
})

describe("single-child failure isolation", () => {
  test("stopChildren: a failing child is 'failed' but the batch continues", async () => {
    const h = makeHarness({ children: { c1: { failWith: "cancel exploded" }, c2: {} } })
    const parent = await openParent(h, 50)
    h.setRows([childRow("c1", parent, true), childRow("c2", parent, true)])

    h.send({ id: 51, method: "subagents.stopChildren", params: { parentSessionId: parent } })
    const reply = await h.waitFor(51)

    expect(reply.ok).toBe(true)
    const byId = new Map(reply.result.children.map((c: Frame) => [c.childId, c]))
    expect(byId.get("c1")?.disposition).toBe("failed")
    expect(String(byId.get("c1")?.detail)).toContain("cancel exploded")
    expect(byId.get("c2")?.disposition).toBe("cancel-issued")
    // Both cancels were attempted — the failure did not abort the batch.
    expect(h.cancelCallsOf("c1")).toHaveLength(1)
    expect(h.cancelCallsOf("c2")).toHaveLength(1)
  })

  test("interrupt: a missing agent in the registry -> failed with detail", async () => {
    const h = makeHarness() // no children registered
    const parent = await openParent(h, 52)
    h.setRows([childRow("ghost", parent, true)])

    h.send({ id: 53, method: "subagents.interrupt", params: { parentSessionId: parent, childId: "ghost" } })
    const reply = await h.waitFor(53)

    expect(reply.ok).toBe(true)
    expect(reply.result.childId).toBe("ghost")
    expect(reply.result.disposition).toBe("failed")
    expect(reply.result.detail).toBeTruthy()
  })
})

describe("incremental index feeds the stop window", () => {
  test("a catalog-born child not yet in session.list can still be stopped", async () => {
    const h = makeHarness({ children: { cLive: {} } })
    const parent = await openParent(h, 60)
    h.setRows([]) // list does not yet know about cLive

    h.emitSessionEvent(
      { id: parent },
      { type: "subagent/catalog", data: { version: 3, childId: "cLive", childCreatedAt: 1795074915408 } },
    )
    h.send({ id: 61, method: "subagents.stopChildren", params: { parentSessionId: parent } })
    const reply = await h.waitFor(61)

    expect(reply.ok).toBe(true)
    expect(reply.result.children.map((c: Frame) => c.childId)).toEqual(["cLive"])
    expect(h.cancelCallsOf("cLive")).toHaveLength(1)
  })

  test("a child turn/end flips it to settled -> interrupt answers already-settled", async () => {
    const h = makeHarness({ children: { cLive: {} } })
    const parent = await openParent(h, 62)
    h.setRows([])

    h.emitSessionEvent(
      { id: parent },
      { type: "subagent/catalog", data: { version: 3, childId: "cLive", childCreatedAt: 1 } },
    )
    h.emitSessionEvent(
      { id: "cLive" },
      { type: "turn/end", data: { reason: { kind: "completed" }, seq: 9 } },
    )
    h.send({ id: 63, method: "subagents.interrupt", params: { parentSessionId: parent, childId: "cLive" } })
    const reply = await h.waitFor(63)

    expect(reply.ok).toBe(true)
    expect(reply.result).toEqual({ childId: "cLive", disposition: "already-settled" })
    expect(h.cancelCallsOf("cLive")).toHaveLength(0)
    expect(getSubagentIndex(h.ctx).get("cLive")?.lastSeq).toBe(9)
  })
})
