/**
 * 029 A — protocol-level tests for the bridge-owned `session.steer` frame.
 *
 * Drives the real `apply()` over the stdio NDJSON wire with a fake cordis ctx
 * and fake stdin/stdout, exactly like turn-abort.test.ts. No host package is
 * imported and no model turn is run: the in-flight turn is held open by a
 * never-settling `whenIdle()` and terminated through the fake firehose.
 *
 * Locked semantics:
 *  - accepts ONLY a live, non-aborting turn whose agent.status === 'running';
 *  - calls agent.steer(createBridgeUserMessage(text)) directly — no followup
 *    downgrade, no new turn id, no inFlightTurnId mutation, no turn.start;
 *  - idle / ended / aborting refusals are typed and never touch the host;
 *  - an accepted-but-unconsumed steer is NOT removed on abort (no host API):
 *    the regression pins cancel({kind:'user'},{keepInbox:true}) and zero
 *    message-removal calls rather than pretending cleanup exists.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { apply } from "../src/index"

const STDIO_SWITCH = "DSH_OPENTUI_BRIDGE_STDIO"
type Frame = Record<string, any>
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

interface Harness {
  frames: string[]
  steerCalls: any[]
  followupCalls: any[]
  cancelCalls: Array<{ cause: any; opts: any }>
  removalCalls: any[]
  agent: any
  send(frame: unknown): void
  latest(id: number | string): Frame | undefined
  waitFor(id: number | string): Promise<Frame>
  emitSessionEvent(session: unknown, event: unknown): void
  framesOf(type: string, turnId?: string): Frame[]
}

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

function makeHarness(steerImpl?: (message: any) => void): Harness {
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
      /* reporter output */
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

  const eventListeners = new Map<string, Array<(...args: any[]) => void>>()
  const steerCalls: any[] = []
  const followupCalls: any[] = []
  const cancelCalls: Array<{ cause: any; opts: any }> = []
  const removalCalls: any[] = []
  const agent: any = {
    status: "running",
    session: { seq: 0 },
    followup(message: any) {
      followupCalls.push(message)
    },
    steer(message: any) {
      steerCalls.push(message)
      steerImpl?.(message)
    },
    cancel(cause: any, opts: any) {
      cancelCalls.push({ cause, opts })
    },
    whenIdle() {
      return new Promise<void>(() => {}) // hold the turn open
    },
    // Host has no such API today; the bridge must never call it. Present here
    // only to make an accidental removal attempt observable.
    removeMessage(...args: any[]) {
      removalCalls.push(args)
    },
  }
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
    agents: {
      async create() {
        return { agent, dispose: async () => {} }
      },
      async resume() {
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
        /* ignore */
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
    steerCalls,
    followupCalls,
    cancelCalls,
    removalCalls,
    agent,
    send(frame: unknown) {
      const line = `${JSON.stringify(frame)}\n`
      for (const fn of stdinListeners["data"] || []) fn(line)
    },
    latest,
    waitFor,
    emitSessionEvent(session: unknown, event: unknown) {
      for (const fn of eventListeners.get("session/event") || []) fn(session, event)
    },
    framesOf(type: string, turnId?: string) {
      const out: Frame[] = []
      for (const line of frames) {
        try {
          const frame = JSON.parse(line)
          if (frame?.type === type && (turnId === undefined || frame?.payload?.turnId === turnId)) out.push(frame)
        } catch {
          /* ignore */
        }
      }
      return out
    },
  }
}

async function startTurn(h: Harness, id = 10): Promise<{ sessionId: string; turnId: string }> {
  h.send({ id, method: "session.open", params: { mode: "new" } })
  const opened = await h.waitFor(id)
  expect(opened.ok).toBe(true)
  h.send({ id: id + 1, method: "session.send", params: { text: "hello" } })
  const sent = await h.waitFor(id + 1)
  expect(sent.ok).toBe(true)
  return { sessionId: opened.result.sessionId as string, turnId: sent.result.turnId as string }
}

describe("session.steer — capability + accept gate", () => {
  test("bridge.hello advertises session.steer", async () => {
    const h = makeHarness()
    h.send({ id: 1, method: "bridge.hello", params: {} })
    const reply = await h.waitFor(1)
    expect(reply.ok).toBe(true)
    expect(reply.result.capabilities).toContain("session.steer")
  })

  test("accepted: direct agent.steer, correct result, no new turn / turn.start / followup", async () => {
    const h = makeHarness()
    const { turnId } = await startTurn(h)
    const startsBefore = h.framesOf("turn.start").length
    h.send({ id: 12, method: "session.steer", params: { text: "go left" } })
    const reply = await h.waitFor(12)
    expect(reply.ok).toBe(true)
    expect(reply.result.accepted).toBe(true)
    expect(reply.result.turnId).toBe(turnId)
    expect(typeof reply.result.messageId).toBe("string")
    expect(h.steerCalls).toHaveLength(2) // send itself steers when agent is running
    const steered = h.steerCalls[1]
    expect(steered).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "go left" }],
      source: { kind: "user" },
    })
    expect(typeof steered.id).toBe("string")
    expect(h.followupCalls).toHaveLength(0)
    // No ghost turn: steer did not take inFlightTurnId or emit turn.start.
    expect(h.framesOf("turn.start").length).toBe(startsBefore)
    h.send({ id: 13, method: "session.send", params: { text: "again" } })
    expect((await h.waitFor(13)).error.code).toBe("TURN_BUSY")
  })

  test("no binding → SESSION_NOT_OPEN, no host call", async () => {
    const h = makeHarness()
    h.send({ id: 20, method: "session.steer", params: { text: "x" } })
    const reply = await h.waitFor(20)
    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("SESSION_NOT_OPEN")
    expect(h.steerCalls).toHaveLength(0)
    expect(h.followupCalls).toHaveLength(0)
  })

  test("empty / non-string text → BAD_PARAMS, no host call", async () => {
    for (const [id, text] of [
      [21, ""],
      [22, "   "],
      [23, 42],
    ] as const) {
      const h = makeHarness()
      await startTurn(h)
      h.send({ id, method: "session.steer", params: { text } })
      const reply = await h.waitFor(id)
      expect(reply.error.code).toBe("BAD_PARAMS")
      expect(h.steerCalls).toHaveLength(1) // the send's own steer only
      expect(h.followupCalls).toHaveLength(0)
    }
  })

  test("idle: no in-flight turn → STEER_IDLE; agent not running → STEER_IDLE, no host call", async () => {
    const h = makeHarness()
    h.send({ id: 23, method: "session.open", params: { mode: "new" } })
    expect((await h.waitFor(23)).ok).toBe(true)
    h.send({ id: 24, method: "session.steer", params: { text: "x" } })
    const reply = await h.waitFor(24)
    expect(reply.error.code).toBe("STEER_IDLE")
    expect(reply.error.detail.turnId).toBe(null)
    expect(h.steerCalls).toHaveLength(0)
    expect(h.followupCalls).toHaveLength(0)

    const h2 = makeHarness()
    const { turnId } = await startTurn(h2)
    h2.agent.status = "idle"
    h2.send({ id: 25, method: "session.steer", params: { text: "x" } })
    const reply2 = await h2.waitFor(25)
    expect(reply2.error.code).toBe("STEER_IDLE")
    expect(reply2.error.detail.turnId).toBe(turnId)
    expect(h2.steerCalls).toHaveLength(1)
  })

  test("ended: terminal frame arrived → STEER_ENDED, no host call", async () => {
    const h = makeHarness()
    const { sessionId, turnId } = await startTurn(h)
    h.emitSessionEvent({ id: sessionId }, { type: "turn/end", data: { reason: {} }, turnId })
    h.send({ id: 32, method: "session.steer", params: { text: "x" } })
    const reply = await h.waitFor(32)
    expect(reply.error.code).toBe("STEER_ENDED")
    expect(h.steerCalls).toHaveLength(1)
    expect(h.followupCalls).toHaveLength(0)
  })

  test("aborting → STEER_ABORTING, no host call", async () => {
    const h = makeHarness()
    const { turnId } = await startTurn(h)
    h.send({ id: 26, method: "turn.abort", params: { turnId } })
    expect((await h.waitFor(26)).ok).toBe(true)
    h.send({ id: 27, method: "session.steer", params: { text: "x" } })
    const reply = await h.waitFor(27)
    expect(reply.error.code).toBe("STEER_ABORTING")
    expect(reply.error.detail.turnId).toBe(turnId)
    expect(h.steerCalls).toHaveLength(1)
    expect(h.followupCalls).toHaveLength(0)
  })

  test("agent.steer throws → INTERNAL, no followup fallback, no ghost turn", async () => {
    let steerCount = 0
    const h = makeHarness(() => {
      if (++steerCount === 2) throw new Error("host rejected steer") // only the explicit steer fails
    })
    const { turnId } = await startTurn(h)
    const startsBefore = h.framesOf("turn.start").length
    h.send({ id: 28, method: "session.steer", params: { text: "x" } })
    const reply = await h.waitFor(28)
    expect(reply.error.code).toBe("INTERNAL")
    expect(reply.error.message).toContain("host rejected steer")
    expect(h.followupCalls).toHaveLength(0)
    expect(h.framesOf("turn.start").length).toBe(startsBefore)
    h.send({ id: 29, method: "session.send", params: { text: "again" } })
    expect((await h.waitFor(29)).error.code).toBe("TURN_BUSY")
    expect(turnId).toBeTruthy()
  })

  test("abort after an accepted steer keeps the inbox: no message removal API exists", async () => {
    const h = makeHarness()
    const { turnId } = await startTurn(h)
    h.send({ id: 30, method: "session.steer", params: { text: "queued-but-unconsumed" } })
    expect((await h.waitFor(30)).ok).toBe(true)
    const steersBeforeAbort = h.steerCalls.length
    h.send({ id: 31, method: "turn.abort", params: { turnId } })
    expect((await h.waitFor(31)).ok).toBe(true)
    // The bridge only cancels with keepInbox:true; it never removes the
    // accepted steer. This is a documented residual risk (ADR-0010), not a
    // cleanup claim.
    expect(h.cancelCalls).toEqual([{ cause: { kind: "user" }, opts: { keepInbox: true } }])
    expect(h.steerCalls).toHaveLength(steersBeforeAbort)
    expect(h.removalCalls).toHaveLength(0)
  })

  test("agent without steer(): session.steer -> UNSUPPORTED with capability detail, no followup/cancel", async () => {
    const h = makeHarness()
    const { turnId } = await startTurn(h)
    expect(turnId).toBeTruthy()
    // The turn stays live and running; only the missing host seam changes.
    h.agent.steer = undefined
    const steersBefore = h.steerCalls.length
    const followupsBefore = h.followupCalls.length
    const cancelsBefore = h.cancelCalls.length
    h.send({ id: 40, method: "session.steer", params: { text: "x" } })
    const reply = await h.waitFor(40)
    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("UNSUPPORTED")
    expect(reply.error.detail).toEqual({ capability: "session.steer" })
    expect(h.steerCalls).toHaveLength(steersBefore)
    expect(h.followupCalls).toHaveLength(followupsBefore)
    expect(h.cancelCalls).toHaveLength(cancelsBefore)
  })

  test("session.close clears terminal ids: a fresh session's idle steer -> STEER_IDLE, not STEER_ENDED", async () => {
    const h = makeHarness()
    const { sessionId, turnId } = await startTurn(h)
    h.emitSessionEvent({ id: sessionId }, { type: "turn/end", data: { reason: {} }, turnId })
    // Before close the terminal-id FIFO is what makes steer answer STEER_ENDED.
    h.send({ id: 41, method: "session.steer", params: { text: "x" } })
    expect((await h.waitFor(41)).error.code).toBe("STEER_ENDED")

    h.send({ id: 42, method: "session.close", params: {} })
    expect((await h.waitFor(42)).ok).toBe(true)
    h.send({ id: 43, method: "session.open", params: { mode: "new" } })
    expect((await h.waitFor(43)).ok).toBe(true)
    h.send({ id: 44, method: "session.steer", params: { text: "x" } })
    const reply = await h.waitFor(44)
    expect(reply.error.code).toBe("STEER_IDLE")
    expect(reply.error.detail.turnId).toBe(null)
    expect(h.steerCalls).toHaveLength(1) // only session.send's own steer
    expect(h.followupCalls).toHaveLength(0)
  })

  test("session.open{replace:true} clears terminal ids: idle steer -> STEER_IDLE, not STEER_ENDED", async () => {
    const h = makeHarness()
    const { sessionId, turnId } = await startTurn(h)
    h.emitSessionEvent({ id: sessionId }, { type: "turn/end", data: { reason: {} }, turnId })
    h.send({ id: 45, method: "session.steer", params: { text: "x" } })
    expect((await h.waitFor(45)).error.code).toBe("STEER_ENDED")

    h.send({ id: 46, method: "session.open", params: { mode: "resume", id: "session-B", replace: true } })
    const replaced = await h.waitFor(46)
    expect(replaced.ok).toBe(true)
    expect(replaced.result.sessionId).toBe("session-B")
    expect(replaced.result.previousSessionId).toBe(sessionId)
    h.send({ id: 47, method: "session.steer", params: { text: "x" } })
    const reply = await h.waitFor(47)
    expect(reply.error.code).toBe("STEER_IDLE")
    expect(reply.error.detail.turnId).toBe(null)
    expect(h.steerCalls).toHaveLength(1)
    expect(h.followupCalls).toHaveLength(0)
  })
})
