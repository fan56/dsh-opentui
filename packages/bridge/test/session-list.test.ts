/**
 * Protocol-level unit tests for `session.list` (ADR-0010 IPC frame contract).
 *
 * Same fake-cordis-ctx + fake-stdin/stdout technique as turn-abort.test.ts:
 * drive the real `apply()` through the NDJSON wire, no host package imported.
 * The fake `ctx.get('sessionController')` is a stub whose `list()` returns a
 * realistic `session/list` wire value, so these tests pin the three contract
 * branches: normal pass-through, illegal params (BAD_PARAMS), and a missing
 * service (UNSUPPORTED — distinguishable from a legitimately empty list).
 */
import { afterEach, describe, expect, test } from "bun:test"
import { apply } from "../src/index"

const STDIO_SWITCH = "DSH_OPENTUI_BRIDGE_STDIO"
type Frame = Record<string, any>

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

/** A controller stub that records every `list()` request and returns `impl`'s value. */
function makeController(impl: (request: any) => any) {
  const calls: any[] = []
  return {
    calls,
    async list(request: any) {
      calls.push(request)
      return impl(request)
    },
  }
}

interface Harness {
  frames: string[]
  readonly createCalls: number
  readonly resumeCalls: number
  send(frame: unknown): void
  latest(id: number | string): Frame | undefined
  waitFor(id: number | string): Promise<Frame>
}

/** `controller` is exactly what `ctx.get('sessionController')` returns; pass
 *  `undefined` to model a host where the service is absent. */
function makeHarness(controller: any): Harness {
  const previousSwitch = process.env[STDIO_SWITCH]
  process.env[STDIO_SWITCH] = "1"

  const originalWrite = process.stdout.write.bind(process.stdout)
  const frames: string[] = []
  const patchedWrite = function (this: unknown, chunk: any, ...rest: any[]) {
    const text = String(chunk)
    frames.push(text)
    let parsed: any
    try {
      parsed = JSON.parse(text.trim())
    } catch {
      /* plain reporter output */
    }
    const isBridgeFrame =
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      ("ok" in parsed || "type" in parsed) &&
      ("id" in parsed || "payload" in parsed || "result" in parsed || "error" in parsed)
    if (isBridgeFrame) return true
    return originalWrite(chunk, ...rest)
  } as typeof process.stdout.write
  process.stdout.write = patchedWrite

  const stdinListeners: Record<string, Array<(...args: any[]) => void>> = {}
  const fakeStdin = {
    setEncoding() {},
    on(name: string, fn: (...args: any[]) => void) {
      ;(stdinListeners[name] ||= []).push(fn)
      return fakeStdin
    },
    off(name: string, fn: (...args: any[]) => void) {
      stdinListeners[name] = (stdinListeners[name] || []).filter((f) => f !== fn)
      return fakeStdin
    },
    once(name: string, fn: (...args: any[]) => void) {
      ;(stdinListeners[name] ||= []).push(fn)
      return fakeStdin
    },
    pause() {
      return fakeStdin
    },
    resume() {
      return fakeStdin
    },
  }
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process, "stdin")
  Object.defineProperty(process, "stdin", { value: fakeStdin, configurable: true })

  let createCalls = 0
  let resumeCalls = 0
  const agent = {
    status: "idle",
    session: { seq: 0 },
    followup() {},
    steer() {},
    cancel() {},
    whenIdle() {
      return new Promise<void>(() => {})
    },
  }
  let disposeBridge: (() => void) | undefined
  const ctx: any = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    effect(execute: () => () => void) {
      disposeBridge = execute()
      return { dispose: () => disposeBridge?.() }
    },
    on() {
      return () => {}
    },
    get(name: string) {
      if (name === "sessionController") return controller
      return undefined
    },
    agents: {
      async create() {
        createCalls += 1
        return { agent, dispose: async () => {} }
      },
      async resume() {
        resumeCalls += 1
        return { agent, dispose: async () => {} }
      },
      get() {
        return undefined
      },
    },
  }
  apply(ctx, {})

  cleanups.push(() => {
    try {
      disposeBridge?.()
    } catch {
      /* already torn down */
    }
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
      } catch {
        /* non-frame stdout noise */
      }
    }
    return undefined
  }

  const waitFor = async (id: number | string): Promise<Frame> => {
    const deadline = Date.now() + 2000
    for (;;) {
      const frame = latest(id)
      if (frame !== undefined) return frame
      if (Date.now() > deadline) throw new Error(`no response frame for id=${id}`)
      await sleep(1)
    }
  }

  return {
    frames,
    get createCalls() {
      return createCalls
    },
    get resumeCalls() {
      return resumeCalls
    },
    send(frame: unknown) {
      const line = `${JSON.stringify(frame)}\n`
      for (const fn of stdinListeners["data"] || []) fn(line)
    },
    latest,
    waitFor,
  }
}

/** Realistic `session/list` wire rows — the exact shape the host controller
 *  returns (no top-level `title`/`sizeBytes`; title at `projections.values.title`). */
const WIRE_ROWS = [
  {
    sessionId: "sess-newest",
    updatedAt: 1700000000000,
    agentAvailable: false,
    formatStatus: "current",
    running: false,
    blank: false,
    cwd: "/work/alpha",
    projections: {
      kind: "cached",
      asOfSeq: 42,
      values: { title: "Newest chat", sessionListMetadata: { blank: false, lastPromptAt: 1700000000000 } },
    },
  },
  {
    sessionId: "sess-child",
    updatedAt: 1699999000000,
    agentAvailable: true,
    running: false,
    blank: true,
    parentSessionId: "sess-newest",
    origin: "subagent",
    projections: { kind: "sequenced", asOfSeq: 7, values: { title: "child turn" } },
  },
]

describe("session.list — normal pass-through", () => {
  test("returns host wire rows verbatim, calls controller once, no session side effects", async () => {
    const controller = makeController(() => ({ items: WIRE_ROWS }))
    const h = makeHarness(controller)

    h.send({ id: 1, method: "session.list" })
    const reply = await h.waitFor(1)

    expect(reply.ok).toBe(true)
    // Non-trivial assertion: exact row contents, not just a non-empty array.
    expect(reply.result.items).toEqual(WIRE_ROWS)
    expect(reply.result.items[0].sessionId).toBe("sess-newest")
    expect(reply.result.items[0].projections.values.title).toBe("Newest chat")
    expect(reply.result.items[1].origin).toBe("subagent")
    expect(reply.result.items[1].parentSessionId).toBe("sess-newest")
    expect(reply.result.items[0]).not.toHaveProperty("title")
    expect(reply.result.items[0]).not.toHaveProperty("sizeBytes")
    // Called the same way the thin client calls `session/list`.
    expect(controller.calls).toEqual([{ _request: {} }])
    // Read-only: no create/resume, works with no session open.
    expect(h.createCalls).toBe(0)
    expect(h.resumeCalls).toBe(0)
  })

  test("an empty store is a SUCCESS with empty items (not service-unavailable)", async () => {
    const controller = makeController(() => ({ items: [] }))
    const h = makeHarness(controller)

    h.send({ id: 2, method: "session.list" })
    const reply = await h.waitFor(2)

    expect(reply.ok).toBe(true)
    expect(reply.result).toEqual({ items: [] })
  })

  test("a string cursor is validated and forwarded in _request", async () => {
    const controller = makeController(() => ({ items: WIRE_ROWS }))
    const h = makeHarness(controller)

    h.send({ id: 3, method: "session.list", params: { cursor: "next-page" } })
    const reply = await h.waitFor(3)

    expect(reply.ok).toBe(true)
    expect(controller.calls).toEqual([{ _request: { cursor: "next-page" } }])
  })
})

describe("session.list — parameter validation", () => {
  test("non-string cursor -> BAD_PARAMS, controller never called", async () => {
    const controller = makeController(() => ({ items: WIRE_ROWS }))
    const h = makeHarness(controller)

    h.send({ id: 10, method: "session.list", params: { cursor: 123 } })
    const reply = await h.waitFor(10)

    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("BAD_PARAMS")
    expect(controller.calls).toHaveLength(0)
    expect(h.createCalls).toBe(0)
    expect(h.resumeCalls).toBe(0)
  })
})

describe("session.list — service missing", () => {
  test("ctx.get('sessionController') undefined -> UNSUPPORTED detail, never an empty success", async () => {
    const h = makeHarness(undefined)

    h.send({ id: 20, method: "session.list" })
    const reply = await h.waitFor(20)

    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("UNSUPPORTED")
    expect(reply.error.detail).toEqual({ capability: "session.list", service: "sessionController" })
    // The capability-unavailable reply must carry no success result at all.
    expect(reply.result).toBeUndefined()
  })

  test("a service without list() is treated as missing, not as an empty store", async () => {
    const h = makeHarness({ name: "sessionController" })

    h.send({ id: 21, method: "session.list" })
    const reply = await h.waitFor(21)

    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("UNSUPPORTED")
    expect(reply.result).toBeUndefined()
  })
})

describe("session.list — host errors", () => {
  test("a controller throw maps through the host error table (default INTERNAL)", async () => {
    const controller = makeController(() => {
      throw new Error("controller exploded")
    })
    const h = makeHarness(controller)

    h.send({ id: 30, method: "session.list" })
    const reply = await h.waitFor(30)

    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("INTERNAL")
    expect(reply.result).toBeUndefined()
  })
})

describe("session.list — malformed host value is INTERNAL, never a flattened empty success (P1-2)", () => {
  const cases: Array<{ name: string; id: number; value: unknown; reason: string }> = [
    { name: "null value", id: 40, value: null, reason: "returned null" },
    { name: "object with no items", id: 41, value: { sessions: [] }, reason: "without an items array" },
    { name: "items not an array", id: 42, value: { items: "not-an-array" }, reason: "without an items array" },
  ]

  for (const c of cases) {
    test(`${c.name} -> INTERNAL with a reason, distinguishable from UNSUPPORTED and from {items:[]}`, async () => {
      const controller = makeController(() => c.value)
      const h = makeHarness(controller)

      h.send({ id: c.id, method: "session.list" })
      const reply = await h.waitFor(c.id)

      expect(reply.ok).toBe(false)
      expect(reply.error.code).toBe("INTERNAL")
      // "host is broken" carries a reason — it is not the UNSUPPORTED shape
      // ({capability,service}), nor a success result at all.
      expect(String(reply.error.message)).toContain("malformed")
      expect(reply.error.detail.reason).toContain(c.reason)
      expect(reply.error.detail.capability).toBeUndefined()
      expect(reply.result).toBeUndefined()
      expect(controller.calls).toEqual([{ _request: {} }])
    })
  }

  test("a non-object value -> INTERNAL with a reason", async () => {
    const controller = makeController(() => "garbage")
    const h = makeHarness(controller)

    h.send({ id: 43, method: "session.list" })
    const reply = await h.waitFor(43)

    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("INTERNAL")
    expect(reply.error.detail.reason).toContain("non-object")
    expect(reply.result).toBeUndefined()
  })
})
