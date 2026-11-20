/**
 * Batch 1 — protocol-level unit tests for the seven new bridge wires:
 *   agent.steer / subagents.steer / session.selectModel / session.search /
 *   credentials.set / credentials.unset / credentials.describe
 *
 * Fake-cordis-ctx + fake-stdin/stdout discipline (same as session-list.test.ts):
 * drive the real `apply()` over the NDJSON wire; no host package imported, no
 * model turn. Each stub host service records its calls and can be made to throw
 * a host-shaped error (`{ code, details }`) to pin verbatim error passthrough.
 *
 * Locked behaviour:
 *  - agent.steer is INDEPENDENT of handleSend (works while a turn is in flight)
 *    and fails explicitly (AGENT_NOT_RUNNING) when the agent is not running;
 *  - subagents.steer calls ctx.subagents.sendMessage (delivery:'steer' path)
 *    and forwards TURN_BUSY-class host refusals verbatim;
 *  - session.selectModel passes the request through (incl. reasoningEffort);
 *  - session.search projects {sessionId,snippet} -> {id,snippet} and forwards
 *    SESSION_QUERY_SEARCH_DISABLED verbatim (never an empty success);
 *  - credentials set/unset/describe use the host ref grammar, describe takes
 *    refs[] and projects only public fields, and no list wire is invented.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { apply } from "../src/index"
import { ALL_WIRE_IDS, WIRE, isWireId } from "../src/wires"

const STDIO_SWITCH = "DSH_OPENTUI_BRIDGE_STDIO"
type Frame = Record<string, any>

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

interface Harness {
  frames: string[]
  ctx: any
  agent: any
  services: Record<string, any>
  steerCalls: any[]
  send(frame: unknown): void
  latest(id: number | string): Frame | undefined
  waitFor(id: number | string): Promise<Frame>
  setStatus(status: string): void
  open(id: number): Promise<string>
}

/** `services` is exactly what `ctx.get(name)` returns for each host service. */
function makeHarness(services: Record<string, any> = {}): Harness {
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
    pause() { return fakeStdin },
    resume() { return fakeStdin },
  }
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process, "stdin")
  Object.defineProperty(process, "stdin", { value: fakeStdin, configurable: true })

  const status = { value: "idle" as string }
  const steerCalls: any[] = []
  const agent: any = {
    get status() { return status.value },
    session: { seq: 0 },
    followup() {},
    steer(message: any) { steerCalls.push(message) },
    cancel() {},
    whenIdle() { return new Promise<void>(() => {}) }, // hold turns open
  }
  let disposeBridge: (() => void) | undefined
  const ctx: any = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    effect(execute: () => () => void) {
      disposeBridge = execute()
      return { dispose: () => disposeBridge?.() }
    },
    on() { return () => {} },
    get(name: string) { return services[name] },
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
    if (previousSwitch === undefined) delete process.env[STDIO_SWITCH]
    else process.env[STDIO_SWITCH] = previousSwitch
  })

  const latest = (id: number | string): Frame | undefined => {
    for (let i = frames.length - 1; i >= 0; i--) {
      try {
        const frame = JSON.parse(frames[i])
        if (frame !== null && typeof frame === "object" && frame.id === id) return frame
      } catch { /* non-frame stdout noise */ }
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
  const send = (frame: unknown) => {
    const line = `${JSON.stringify(frame)}\n`
    for (const fn of stdinListeners["data"] || []) fn(line)
  }

  return {
    frames,
    ctx,
    agent,
    services,
    steerCalls,
    send,
    latest,
    waitFor,
    setStatus(s: string) { status.value = s },
    async open(id: number): Promise<string> {
      send({ id, method: WIRE.SESSION_OPEN, params: { mode: "new" } })
      const reply = await waitFor(id)
      expect(reply.ok).toBe(true)
      return reply.result.sessionId as string
    },
  }
}

/** A host-shaped error carrying a stable code + details (RemoteError-like). */
function hostError(code: string, message = code, details: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { code, details })
}

// ---------------------------------------------------------------------------
// wire table
// ---------------------------------------------------------------------------
describe("wire id table (single source of truth)", () => {
  test("contains the 12 pre-existing + 7 batch-1 ids, all dotted and unique", () => {
    expect(ALL_WIRE_IDS.length).toBe(19)
    expect(new Set(ALL_WIRE_IDS).size).toBe(19)
    for (const id of ALL_WIRE_IDS) expect(id).toMatch(/^[a-z][a-z0-9]*\.[a-z][A-Za-z0-9]*$/)
    for (const id of [
      WIRE.AGENT_STEER, WIRE.SUBAGENTS_STEER, WIRE.SESSION_SELECT_MODEL,
      WIRE.SESSION_SEARCH, WIRE.CREDENTIALS_SET, WIRE.CREDENTIALS_UNSET, WIRE.CREDENTIALS_DESCRIBE,
    ]) expect(isWireId(id)).toBe(true)
    expect(isWireId("bogus.wire")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// agent.steer
// ---------------------------------------------------------------------------
describe("agent.steer", () => {
  test("injects into a running turn and is independent of handleSend TURN_BUSY", async () => {
    const h = makeHarness()
    await h.open(1)
    // Hold a turn in flight: session.send would answer TURN_BUSY for any new send.
    h.send({ id: 2, method: WIRE.SESSION_SEND, params: { text: "first" } })
    const sent = await h.waitFor(2)
    expect(sent.ok).toBe(true)

    h.setStatus("running")
    h.send({ id: 3, method: WIRE.AGENT_STEER, params: { text: "steer now" } })
    const reply = await h.waitFor(3)

    expect(reply.ok).toBe(true)
    expect(reply.result).toEqual({ injected: true })
    expect(h.steerCalls.length).toBe(1)
    expect(h.steerCalls[0].content[0].text).toBe("steer now")
  })

  test("not running -> AGENT_NOT_RUNNING, steer never called, never a silent success", async () => {
    const h = makeHarness()
    await h.open(1)
    h.setStatus("idle")
    h.send({ id: 2, method: WIRE.AGENT_STEER, params: { text: "x" } })
    const reply = await h.waitFor(2)

    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("AGENT_NOT_RUNNING")
    expect(h.steerCalls.length).toBe(0)
  })

  test("no open session -> SESSION_NOT_OPEN", async () => {
    const h = makeHarness()
    h.send({ id: 1, method: WIRE.AGENT_STEER, params: { text: "x" } })
    const reply = await h.waitFor(1)
    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("SESSION_NOT_OPEN")
  })

  test("host steer throw -> error code forwarded verbatim", async () => {
    const h = makeHarness()
    await h.open(1)
    h.setStatus("running")
    h.agent.steer = () => { throw hostError("STEER_REJECTED", "driver refused") }
    h.send({ id: 2, method: WIRE.AGENT_STEER, params: { text: "x" } })
    const reply = await h.waitFor(2)
    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("STEER_REJECTED")
  })
})

// ---------------------------------------------------------------------------
// subagents.steer
// ---------------------------------------------------------------------------
describe("subagents.steer", () => {
  test("calls ctx.subagents.sendMessage on the steer path and returns the receipt", async () => {
    const calls: any[] = []
    const h = makeHarness({
      subagents: {
        async sendMessage(...args: any[]) { calls.push(args); return "msg-1" },
      },
    })
    const sessionId = await h.open(1)
    h.send({ id: 2, method: WIRE.SUBAGENTS_STEER, params: { childId: "child-9", text: "do this" } })
    const reply = await h.waitFor(2)

    expect(reply.ok).toBe(true)
    expect(reply.result).toEqual({ childId: "child-9", messageId: "msg-1" })
    expect(calls.length).toBe(1)
    const [sender, targetId, content, options] = calls[0]
    expect(sender).toBe(h.agent)
    expect(targetId).toBe("child-9")
    expect(content).toEqual([{ type: "text", text: "do this" }])
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(typeof sessionId).toBe("string")
  })

  test("TURN_BUSY-class host refusal is forwarded verbatim", async () => {
    const h = makeHarness({
      subagents: {
        async sendMessage() { throw hostError("TURN_BUSY", "child is busy", { turnId: "t-1" }) },
      },
    })
    await h.open(1)
    h.send({ id: 2, method: WIRE.SUBAGENTS_STEER, params: { childId: "child-9", text: "x" } })
    const reply = await h.waitFor(2)
    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("TURN_BUSY")
    expect(reply.error.detail).toEqual({ turnId: "t-1" })
  })

  test("host subagent/delivery-unavailable refusal is forwarded verbatim", async () => {
    const h = makeHarness({
      subagents: {
        async sendMessage() { throw hostError("subagent/delivery-unavailable", "at capacity") },
      },
    })
    await h.open(1)
    h.send({ id: 2, method: WIRE.SUBAGENTS_STEER, params: { childId: "child-9", text: "x" } })
    const reply = await h.waitFor(2)
    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("subagent/delivery-unavailable")
  })

  test("missing service -> UNSUPPORTED; bad params -> BAD_PARAMS", async () => {
    const h = makeHarness()
    await h.open(1)
    h.send({ id: 2, method: WIRE.SUBAGENTS_STEER, params: { childId: "c", text: "x" } })
    expect((await h.waitFor(2)).error.code).toBe("UNSUPPORTED")
    h.send({ id: 3, method: WIRE.SUBAGENTS_STEER, params: { text: "x" } })
    expect((await h.waitFor(3)).error.code).toBe("BAD_PARAMS")
  })
})

// ---------------------------------------------------------------------------
// session.selectModel
// ---------------------------------------------------------------------------
describe("session.selectModel", () => {
  test("passes the request through verbatim (incl. reasoningEffort) and returns host value", async () => {
    const calls: any[] = []
    const h = makeHarness({
      sessionController: {
        async list() { return { items: [] } },
        async selectModel(request: any) { calls.push(request); return { selected: request } },
      },
    })
    const sessionId = await h.open(1)
    h.send({
      id: 2,
      method: WIRE.SESSION_SELECT_MODEL,
      params: { provider: "deepseek", model: "v4", reasoningEffort: "high" },
    })
    const reply = await h.waitFor(2)

    expect(reply.ok).toBe(true)
    expect(calls).toEqual([{ sessionId, provider: "deepseek", model: "v4", reasoningEffort: "high" }])
    expect(reply.result.selected).toEqual(calls[0])
  })

  test("host model-unavailable code forwarded verbatim; bad params -> BAD_PARAMS", async () => {
    const h = makeHarness({
      sessionController: {
        async list() { return { items: [] } },
        async selectModel() { throw hostError("session/model-unavailable", "no such model") },
      },
    })
    await h.open(1)
    h.send({ id: 2, method: WIRE.SESSION_SELECT_MODEL, params: { provider: "p", model: "m" } })
    expect((await h.waitFor(2)).error.code).toBe("session/model-unavailable")
    h.send({ id: 3, method: WIRE.SESSION_SELECT_MODEL, params: { provider: "p" } })
    expect((await h.waitFor(3)).error.code).toBe("BAD_PARAMS")
  })
})

// ---------------------------------------------------------------------------
// session.search
// ---------------------------------------------------------------------------
describe("session.search", () => {
  test("projects host {sessionId,snippet} rows to {id,snippet}", async () => {
    const calls: any[] = []
    const h = makeHarness({
      sessionController: {
        async list() { return { items: [] } },
        async search(request: any, signal: any) {
          calls.push({ request, signal })
          return {
            items: [
              { sessionId: "s1", snippet: "first hit" },
              { sessionId: "s2", snippet: "second hit" },
            ],
            hasMore: true,
          }
        },
      },
    })
    h.send({ id: 1, method: WIRE.SESSION_SEARCH, params: { query: "needle" } })
    const reply = await h.waitFor(1)

    expect(reply.ok).toBe(true)
    expect(reply.result).toEqual({
      items: [{ id: "s1", snippet: "first hit" }, { id: "s2", snippet: "second hit" }],
      hasMore: true,
    })
    expect(calls[0].request).toEqual({ query: "needle" })
    expect(calls[0].signal).toBeInstanceOf(AbortSignal)
  })

  test("SESSION_QUERY_SEARCH_DISABLED forwarded verbatim (not swallowed into empty)", async () => {
    const h = makeHarness({
      sessionController: {
        async list() { return { items: [] } },
        async search() {
          throw hostError(
            "SESSION_QUERY_SEARCH_DISABLED",
            'session search is disabled: openAt "never"',
          )
        },
      },
    })
    h.send({ id: 1, method: WIRE.SESSION_SEARCH, params: { query: "needle" } })
    const reply = await h.waitFor(1)
    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("SESSION_QUERY_SEARCH_DISABLED")
  })

  test("bad query -> BAD_PARAMS; missing service -> UNSUPPORTED", async () => {
    const withService = makeHarness({
      sessionController: {
        async list() { return { items: [] } },
        async search() { return { items: [], hasMore: false } },
      },
    })
    withService.send({ id: 1, method: WIRE.SESSION_SEARCH, params: { query: "" } })
    expect((await withService.waitFor(1)).error.code).toBe("BAD_PARAMS")

    const withoutService = makeHarness()
    withoutService.send({ id: 2, method: WIRE.SESSION_SEARCH, params: { query: "x" } })
    expect((await withoutService.waitFor(2)).error.code).toBe("UNSUPPORTED")
  })
})

// ---------------------------------------------------------------------------
// credentials.*
// ---------------------------------------------------------------------------
describe("credentials.set / unset / describe", () => {
  test("set and unset call the provider with grammar-valid refs", async () => {
    const calls: any[] = []
    const h = makeHarness({
      credentials: {
        async set(ref: string, value: string) { calls.push(["set", ref, value]) },
        async unset(ref: string) { calls.push(["unset", ref]) },
        async describe() { return { configured: false, writable: true } },
      },
    })
    h.send({ id: 1, method: WIRE.CREDENTIALS_SET, params: { ref: "DEEPSEEK_API_KEY", value: "secret" } })
    expect((await h.waitFor(1)).ok).toBe(true)
    h.send({ id: 2, method: WIRE.CREDENTIALS_UNSET, params: { ref: "DEEPSEEK_API_KEY" } })
    expect((await h.waitFor(2)).ok).toBe(true)
    expect(calls).toEqual([
      ["set", "DEEPSEEK_API_KEY", "secret"],
      ["unset", "DEEPSEEK_API_KEY"],
    ])
  })

  test("describe(refs[]) fans out to the provider and projects only public fields", async () => {
    const seen: string[] = []
    const h = makeHarness({
      credentials: {
        async set() {},
        async unset() {},
        async describe(ref: string) {
          seen.push(ref)
          return { configured: true, source: "env", writable: false, masked: "sk-***", secret: "LEAK" }
        },
      },
    })
    h.send({ id: 1, method: WIRE.CREDENTIALS_DESCRIBE, params: { refs: ["A_KEY", "B_KEY"] } })
    const reply = await h.waitFor(1)

    expect(reply.ok).toBe(true)
    expect(seen).toEqual(["A_KEY", "B_KEY"])
    expect(reply.result).toEqual({
      A_KEY: { configured: true, source: "env", writable: false, masked: "sk-***" },
      B_KEY: { configured: true, source: "env", writable: false, masked: "sk-***" },
    })
    expect(reply.result.A_KEY).not.toHaveProperty("secret")
  })

  test("describe prefers the mounted controller's batched contract", async () => {
    const calls: any[] = []
    const h = makeHarness({
      credentialsController: {
        async describe(refs: string[]) { calls.push(refs); return { A: { configured: true, writable: true } } },
        async set() {},
        async unset() {},
      },
      credentials: {
        async describe() { throw new Error("provider describe should not be called") },
        async set() {},
        async unset() {},
      },
    })
    h.send({ id: 1, method: WIRE.CREDENTIALS_DESCRIBE, params: { refs: ["A"] } })
    const reply = await h.waitFor(1)
    expect(reply.ok).toBe(true)
    expect(calls).toEqual([["A"]])
    expect(reply.result).toEqual({ A: { configured: true, writable: true } })
  })

  test("invalid ref grammar -> BAD_PARAMS for set/unset/describe (no list invented)", async () => {
    const h = makeHarness({
      credentials: {
        async set() {}, async unset() {}, async describe() { return {} },
      },
    })
    h.send({ id: 1, method: WIRE.CREDENTIALS_SET, params: { ref: "a/b", value: "x" } })
    expect((await h.waitFor(1)).error.code).toBe("BAD_PARAMS")
    h.send({ id: 2, method: WIRE.CREDENTIALS_UNSET, params: { ref: "9bad" } })
    expect((await h.waitFor(2)).error.code).toBe("BAD_PARAMS")
    h.send({ id: 3, method: WIRE.CREDENTIALS_DESCRIBE, params: { refs: ["GOOD", "bad-ref"] } })
    expect((await h.waitFor(3)).error.code).toBe("BAD_PARAMS")
    // No credentials.list wire exists.
    h.send({ id: 4, method: "credentials.list" })
    expect((await h.waitFor(4)).error.code).toBe("UNSUPPORTED")
  })

  test("host credential refusal forwarded verbatim; missing service -> UNSUPPORTED", async () => {
    const h = makeHarness({
      credentials: {
        async set() { throw hostError("gateway/bad-request", "ref not writable") },
        async unset() {},
        async describe() { return {} },
      },
    })
    h.send({ id: 1, method: WIRE.CREDENTIALS_SET, params: { ref: "A_KEY", value: "x" } })
    expect((await h.waitFor(1)).error.code).toBe("gateway/bad-request")

    const absent = makeHarness()
    absent.send({ id: 2, method: WIRE.CREDENTIALS_UNSET, params: { ref: "A_KEY" } })
    expect((await absent.waitFor(2)).error.code).toBe("UNSUPPORTED")
  })
})

// ---------------------------------------------------------------------------
// unknown wire
// ---------------------------------------------------------------------------
describe("unknown wire id", () => {
  test("returns an explicit UNSUPPORTED error, never ignored", async () => {
    const h = makeHarness()
    h.send({ id: 1, method: "no.such.wire", params: {} })
    const reply = await h.waitFor(1)
    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("UNSUPPORTED")
    expect(String(reply.error.message)).toContain("unknown wire id")
  })
})
