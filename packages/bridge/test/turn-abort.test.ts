/**
 * Protocol-level unit tests for `turn.abort` (ADR-0010 I3 + error-code table).
 *
 * The bridge is a stdio JSON-lines plugin: `apply()` starts listening on
 * `process.stdin` and answers by writing NDJSON frames to `process.stdout`.
 * These tests install a fake cordis ctx plus a fake stdin/stdout for the
 * lifetime of each case, then drive the real `apply()` through the same wire
 * protocol the dsh host uses. No host package is imported and no model turn is
 * run — the in-flight turn is held open by a never-settling `whenIdle()` and
 * terminated by injecting a fake `session/event` firehose frame.
 *
 * Locked behaviour (fix b8877c9):
 *  - missing / empty / non-string turnId -> BAD_PARAMS, never reaching cancel;
 *  - a malformed abort must not disturb a live turn (the D1 regression);
 *  - unknown id -> TURN_NOT_FOUND with detail {requestedTurnId, activeTurnId};
 *  - terminal ids are remembered in a bounded 64-entry FIFO for idempotency;
 *  - a live abort answers aborted:true and emits exactly one terminal frame.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { apply } from "../src/index"

const STDIO_SWITCH = "DSH_OPENTUI_BRIDGE_STDIO"
type Frame = Record<string, any>

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

interface Harness {
  frames: string[]
  cancelCalls: Array<{ cause: any; opts: any }>
  send(frame: unknown): void
  latest(id: number | string): Frame | undefined
  waitFor(id: number | string): Promise<Frame>
  emitSessionEvent(session: unknown, event: unknown): void
  terminalFrames(turnId: string): Frame[]
}

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

/**
 * Fresh bridge instance per test. The switch, stdin and stdout are all
 * process-global, so each harness snapshots and restores them in afterEach.
 */
function makeHarness(cancelImpl?: (cause: any, opts: any) => void): Harness {
  const previousSwitch = process.env[STDIO_SWITCH]
  process.env[STDIO_SWITCH] = "1"

  const originalWrite = process.stdout.write.bind(process.stdout)
  const frames: string[] = []
  const patchedWrite = function (this: unknown, chunk: any, ...rest: any[]) {
    const text = String(chunk)
    frames.push(text)
    // Swallow bridge NDJSON frames (they are test data), but forward
    // everything else so bun's test reporter keeps working.
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

  const eventListeners = new Map<string, Array<(...args: any[]) => void>>()
  const cancelCalls: Array<{ cause: any; opts: any }> = []
  const agent = {
    status: "idle",
    session: { seq: 0 },
    followup() {},
    steer() {},
    cancel(cause: any, opts: any) {
      cancelCalls.push({ cause, opts })
      cancelImpl?.(cause, opts)
    },
    whenIdle() {
      return new Promise<void>(() => {}) // hold the turn open
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
        /* non-frame stdout noise (e.g. test reporter output) */
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
    cancelCalls,
    send(frame: unknown) {
      const line = `${JSON.stringify(frame)}\n`
      for (const fn of stdinListeners["data"] || []) fn(line)
    },
    latest,
    waitFor,
    emitSessionEvent(session: unknown, event: unknown) {
      for (const fn of eventListeners.get("session/event") || []) fn(session, event)
    },
    terminalFrames(turnId: string) {
      const out: Frame[] = []
      for (const line of frames) {
        try {
          const frame = JSON.parse(line)
          if (
            (frame?.type === "turn.end" || frame?.type === "turn.error") &&
            frame?.payload?.turnId === turnId
          ) out.push(frame)
        } catch {
          /* ignore */
        }
      }
      return out
    },
  }
}

/** Open a session and start one live turn; returns its turnId. */
async function startTurn(h: Harness, id: number): Promise<{ sessionId: string; turnId: string }> {
  h.send({ id, method: "session.open", params: { mode: "new" } })
  const opened = await h.waitFor(id)
  expect(opened.ok).toBe(true)
  const sessionId = opened.result.sessionId as string

  h.send({ id: id + 1, method: "session.send", params: { text: "hello" } })
  const sent = await h.waitFor(id + 1)
  expect(sent.ok).toBe(true)
  return { sessionId, turnId: sent.result.turnId as string }
}

/** Deliver a terminal turn/end frame through the fake firehose. */
function terminate(h: Harness, sessionId: string, reason: unknown) {
  h.emitSessionEvent({ id: sessionId }, { type: "turn/end", data: { reason } })
}

describe("turn.abort — turnId validation", () => {
  test("missing turnId -> BAD_PARAMS", async () => {
    const h = makeHarness()
    h.send({ id: 10, method: "turn.abort", params: {} })
    const reply = await h.waitFor(10)
    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("BAD_PARAMS")
    expect(h.cancelCalls).toHaveLength(0)
  })

  test("empty turnId -> BAD_PARAMS", async () => {
    const h = makeHarness()
    h.send({ id: 11, method: "turn.abort", params: { turnId: "" } })
    const reply = await h.waitFor(11)
    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("BAD_PARAMS")
    expect(h.cancelCalls).toHaveLength(0)
  })

  test("non-string turnId -> BAD_PARAMS", async () => {
    const h = makeHarness()
    h.send({ id: 12, method: "turn.abort", params: { turnId: 123 } })
    const reply = await h.waitFor(12)
    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("BAD_PARAMS")
    expect(h.cancelCalls).toHaveLength(0)
  })

  test("missing turnId while a turn is in flight -> BAD_PARAMS, no cancel, turn STILL RUNNING", async () => {
    const h = makeHarness()
    const { turnId } = await startTurn(h, 1)

    h.send({ id: 10, method: "turn.abort", params: {} })
    const reply = await h.waitFor(10)

    // Observable proof the turn survived comes FIRST: no cancel() was issued,
    // and the bridge still treats the session as busy with the SAME turn id.
    // A regression that lets a malformed abort reach cancel() goes red here,
    // not merely on the error code below.
    expect(h.cancelCalls).toHaveLength(0)
    h.send({ id: 11, method: "session.send", params: { text: "again" } })
    const busy = await h.waitFor(11)
    expect(busy.ok).toBe(false)
    expect(busy.error.code).toBe("TURN_BUSY")
    expect(busy.error.detail).toEqual({ turnId })
    expect(h.cancelCalls).toHaveLength(0)

    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("BAD_PARAMS")
  })
})

describe("turn.abort — unknown ids", () => {
  test("unknown turnId while in flight -> TURN_NOT_FOUND with ADR detail shape", async () => {
    const h = makeHarness()
    const { turnId } = await startTurn(h, 1)

    h.send({ id: 13, method: "turn.abort", params: { turnId: "never-seen" } })
    const reply = await h.waitFor(13)
    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("TURN_NOT_FOUND")
    expect(reply.error.detail).toEqual({ requestedTurnId: "never-seen", activeTurnId: turnId })
    expect(h.cancelCalls).toHaveLength(0)
  })

  test("unknown turnId with no in-flight turn -> TURN_NOT_FOUND, activeTurnId null", async () => {
    const h = makeHarness()
    const { sessionId, turnId } = await startTurn(h, 1)
    terminate(h, sessionId, "completed")
    await sleep(0)

    h.send({ id: 13, method: "turn.abort", params: { turnId: "ghost" } })
    const reply = await h.waitFor(13)
    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("TURN_NOT_FOUND")
    expect(reply.error.detail).toEqual({ requestedTurnId: "ghost", activeTurnId: null })
    expect(h.cancelCalls).toHaveLength(0)
    // The turn id we just finished is still remembered, so a ghost id is the
    // only kind of id that should reach TURN_NOT_FOUND here.
    expect(turnId.length).toBeGreaterThan(0)
  })
})

describe("turn.abort — idempotency and terminal frame", () => {
  test("repeat abort before terminal -> noop, cancel issued once", async () => {
    const h = makeHarness()
    const { turnId } = await startTurn(h, 1)

    h.send({ id: 10, method: "turn.abort", params: { turnId } })
    const first = await h.waitFor(10)
    expect(first.ok).toBe(true)
    expect(first.result.aborted).toBe(true)
    expect(first.result.turnId).toBe(turnId)
    expect(h.cancelCalls).toHaveLength(1)

    h.send({ id: 11, method: "turn.abort", params: { turnId } })
    const second = await h.waitFor(11)
    expect(second.ok).toBe(true)
    expect(second.result.noop).toBe(true)
    expect(h.cancelCalls).toHaveLength(1)
  })

  test("re-abort a terminal turn after another turn ran -> noop, live turn untouched", async () => {
    const h = makeHarness()
    const { sessionId, turnId: t1 } = await startTurn(h, 1)
    terminate(h, sessionId, "completed")
    await sleep(0)

    h.send({ id: 20, method: "session.send", params: { text: "second" } })
    const sent = await h.waitFor(20)
    expect(sent.ok).toBe(true)
    const t2 = sent.result.turnId as string
    expect(t2).not.toBe(t1)

    h.send({ id: 21, method: "turn.abort", params: { turnId: t1 } })
    const reply = await h.waitFor(21)
    expect(reply.ok).toBe(true)
    expect(reply.result.noop).toBe(true)
    expect(reply.result.turnId).toBe(t1)
    expect(h.cancelCalls).toHaveLength(0) // T2 was not cancelled

    h.send({ id: 22, method: "session.send", params: { text: "third" } })
    const busy = await h.waitFor(22)
    expect(busy.ok).toBe(false)
    expect(busy.error.code).toBe("TURN_BUSY")
    expect(busy.error.detail).toEqual({ turnId: t2 })
    expect(h.cancelCalls).toHaveLength(0)
  })

  test("normal abort -> aborted:true, correct cancel args, exactly one terminal frame", async () => {
    const h = makeHarness()
    const { sessionId, turnId } = await startTurn(h, 1)

    h.send({ id: 10, method: "turn.abort", params: { turnId } })
    const reply = await h.waitFor(10)
    expect(reply.ok).toBe(true)
    expect(reply.result).toEqual({ turnId, aborted: true })
    expect(h.cancelCalls).toHaveLength(1)
    expect(h.cancelCalls[0].cause).toEqual({ kind: "user" })
    expect(h.cancelCalls[0].opts).toEqual({ keepInbox: true })

    // The host delivers the aborted terminal on the existing firehose. Firing
    // it twice must still produce exactly one terminal frame for this turn.
    const aborted = { kind: "aborted", reason: { code: "USER_ABORT" } }
    terminate(h, sessionId, aborted)
    terminate(h, sessionId, aborted)
    await sleep(0)

    const terminals = h.terminalFrames(turnId)
    expect(terminals).toHaveLength(1)
    expect(terminals[0].type).toBe("turn.error")
    expect(terminals[0].payload.code).toBe("USER_ABORT")
    expect(terminals.some((f) => f.type === "turn.end")).toBe(false)
  })
})

describe("turn.abort — cancel error resets abortRequested (P1-1)", () => {
  test("cancel() throwing INTERNAL resets the guard so a retry reissues cancel", async () => {
    let attempts = 0
    const h = makeHarness(() => {
      attempts += 1
      if (attempts === 1) throw new Error("cancel exploded")
    })
    const { turnId } = await startTurn(h, 1)

    h.send({ id: 10, method: "turn.abort", params: { turnId } })
    const first = await h.waitFor(10)
    expect(first.ok).toBe(false)
    expect(first.error.code).toBe("INTERNAL")
    expect(h.cancelCalls).toHaveLength(1)

    // Without the guard reset this retry is swallowed as `{noop:true}` and the
    // turn can never be cancelled. The retry must reach cancel() again.
    h.send({ id: 11, method: "turn.abort", params: { turnId } })
    const second = await h.waitFor(11)
    expect(second.ok).toBe(true)
    expect(second.result).toEqual({ turnId, aborted: true })
    expect(second.result.noop).toBeUndefined()
    expect(h.cancelCalls).toHaveLength(2)
  })
})

describe("turn.abort — bounded terminal-id FIFO (64)", () => {
  test("65 finalized turns evict the oldest: first -> TURN_NOT_FOUND, last -> noop", async () => {
    const h = makeHarness()
    const { sessionId } = await startTurn(h, 1)
    const ids: string[] = []

    // Turn 1 is already live; finalize it, then add 64 more (65 total) so the
    // FIFO cap is exceeded by exactly one id.
    terminate(h, sessionId, "completed")
    await sleep(0)

    for (let i = 0; i < 65; i++) {
      const requestId = 100 + i
      h.send({ id: requestId, method: "session.send", params: { text: "x" } })
      const sent = await h.waitFor(requestId)
      expect(sent.ok).toBe(true)
      ids.push(sent.result.turnId as string)
      terminate(h, sessionId, "completed")
      await sleep(0)
    }

    const oldest = ids[0]
    const newest = ids[ids.length - 1]

    h.send({ id: 1000, method: "turn.abort", params: { turnId: oldest } })
    const evicted = await h.waitFor(1000)
    expect(evicted.ok).toBe(false)
    expect(evicted.error.code).toBe("TURN_NOT_FOUND")
    expect(evicted.error.detail).toEqual({ requestedTurnId: oldest, activeTurnId: null })

    h.send({ id: 1001, method: "turn.abort", params: { turnId: newest } })
    const remembered = await h.waitFor(1001)
    expect(remembered.ok).toBe(true)
    expect(remembered.result.noop).toBe(true)
    expect(h.cancelCalls).toHaveLength(0)
  }, 5000)
})
