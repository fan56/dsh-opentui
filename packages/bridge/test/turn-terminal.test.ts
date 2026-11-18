/**
 * Protocol-level unit tests for terminal-frame emission on binding teardown
 * (P0-1: session.open replace / session.close) and on the idle safety net
 * (P2-1: whenIdle resolved but no host terminal).
 *
 * Same fake-cordis-ctx + fake-stdin/stdout technique as the sibling tests: the
 * real `apply()` is driven through the NDJSON wire, no host package is imported.
 * The fake handle's `dispose()` snapshots every terminal frame on the wire at
 * the instant it is invoked — this is the ordering proof that the terminal
 * frame precedes dispose (not merely "a frame exists somewhere").
 */
import { afterEach, describe, expect, jest, test } from "bun:test"
import { apply } from "../src/index"

const STDIO_SWITCH = "DSH_OPENTUI_BRIDGE_STDIO"
type Frame = Record<string, any>

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const flushMicrotasks = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

interface Harness {
  frames: string[]
  /** One entry per handle.dispose() call: terminal frames visible at that moment. */
  disposeSnapshots: Frame[][]
  disposeCalls: string[]
  send(frame: unknown): void
  latest(id: number | string): Frame | undefined
  waitFor(id: number | string): Promise<Frame>
  terminalFrames(turnId: string): Frame[]
  emitSessionEvent(session: unknown, event: unknown): void
  /** Resolve whenIdle() so the 2s safety timer is armed. */
  resolveIdle(): void
}

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

function makeHarness(): Harness {
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

  const eventListeners = new Map<string, Array<(...args: any[]) => void>>()
  const disposeSnapshots: Frame[][] = []
  const disposeCalls: string[] = []
  const terminalFramesAll = (): Frame[] => {
    const out: Frame[] = []
    for (const line of frames) {
      try {
        const frame = JSON.parse(line)
        if (frame?.type === "turn.end" || frame?.type === "turn.error") out.push(frame)
      } catch {
        /* ignore */
      }
    }
    return out
  }

  let resolveIdleFn: (() => void) | undefined
  const idlePromise = new Promise<void>((resolve) => {
    resolveIdleFn = resolve
  })
  const agent = {
    status: "idle",
    session: { seq: 0 },
    followup() {},
    steer() {},
    cancel() {},
    whenIdle() {
      return idlePromise
    },
  }

  const makeHandle = (sessionId: string) => ({
    agent,
    async dispose() {
      // Snapshot at call time — before any await — so the recorded frames are
      // exactly what was on the wire when dispose() was invoked.
      disposeCalls.push(sessionId)
      disposeSnapshots.push(terminalFramesAll())
    },
  })

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
      async create(options: any) {
        return makeHandle(String(options.sessionId))
      },
      async resume(options: any) {
        return makeHandle(String(options.resumeSessionId))
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
    disposeSnapshots,
    disposeCalls,
    send(frame: unknown) {
      const line = `${JSON.stringify(frame)}\n`
      for (const fn of stdinListeners["data"] || []) fn(line)
    },
    latest,
    waitFor,
    emitSessionEvent(session: unknown, event: unknown) {
      for (const fn of eventListeners.get("session/event") || []) fn(session, event)
    },
    resolveIdle() {
      resolveIdleFn?.()
    },
    terminalFrames(turnId: string) {
      return terminalFramesAll().filter((f) => f?.payload?.turnId === turnId)
    },
  }
}

/** Open a session and start one live turn; returns its sessionId and turnId. */
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

describe("P0-1 — disposing a binding with a streaming turn emits one terminal frame first", () => {
  test("session.open replace: turn.error(SESSION_CLOSED) is on the wire BEFORE old handle.dispose()", async () => {
    const h = makeHarness()
    const { sessionId: sessionA, turnId } = await startTurn(h, 1)

    h.send({
      id: 10,
      method: "session.open",
      params: { mode: "resume", id: "session-B", replace: true },
    })
    const reply = await h.waitFor(10)

    expect(reply.ok).toBe(true)
    expect(reply.result.sessionId).toBe("session-B")
    expect(reply.result.previousSessionId).toBe(sessionA)

    const terminals = h.terminalFrames(turnId)
    // Exactly one terminal frame for A — no turn.end, no duplicate turn.error.
    expect(terminals).toHaveLength(1)
    expect(terminals[0].type).toBe("turn.error")
    expect(terminals[0].payload.code).toBe("SESSION_CLOSED")
    expect(terminals[0].payload.turnId).toBe(turnId)

    // Ordering proof: dispose() was called for A, and at that exact instant the
    // single terminal frame for A was already present on stdout.
    expect(h.disposeCalls).toEqual([sessionA])
    expect(h.disposeSnapshots).toHaveLength(1)
    expect(h.disposeSnapshots[0].map((f) => `${f.type}:${f.payload.turnId}`)).toEqual([
      `turn.error:${turnId}`,
    ])

    // A late host terminal for the replaced session cannot produce a 2nd frame.
    h.emitSessionEvent({ id: sessionA }, { type: "turn/end", data: { reason: "completed" } })
    await flushMicrotasks()
    expect(h.terminalFrames(turnId)).toHaveLength(1)
  })

  test("session.close: turn.error(SESSION_CLOSED) is on the wire BEFORE handle.dispose()", async () => {
    const h = makeHarness()
    const { sessionId, turnId } = await startTurn(h, 1)

    h.send({ id: 10, method: "session.close" })
    const reply = await h.waitFor(10)

    expect(reply.ok).toBe(true)
    expect(reply.result.sessionId).toBe(sessionId)

    const terminals = h.terminalFrames(turnId)
    expect(terminals).toHaveLength(1)
    expect(terminals[0].type).toBe("turn.error")
    expect(terminals[0].payload.code).toBe("SESSION_CLOSED")

    expect(h.disposeCalls).toEqual([sessionId])
    expect(h.disposeSnapshots[0].map((f) => `${f.type}:${f.payload.turnId}`)).toEqual([
      `turn.error:${turnId}`,
    ])
  })
})

describe("P2-1 — idle safety net emits a terminal frame instead of silently dropping the turn", () => {
  test("whenIdle resolves with no host terminal: turn.error(INTERNAL) then state cleared", async () => {
    const h = makeHarness()
    const { turnId } = await startTurn(h, 1)

    jest.useFakeTimers()
    try {
      h.resolveIdle()
      // Let whenIdle().then(...) run so it arms the 2s safety timer.
      await flushMicrotasks()
      jest.advanceTimersByTime(2000)
    } finally {
      jest.useRealTimers()
    }

    const terminals = h.terminalFrames(turnId)
    expect(terminals).toHaveLength(1)
    expect(terminals[0].type).toBe("turn.error")
    expect(terminals[0].payload.code).toBe("INTERNAL")
    expect(String(terminals[0].payload.message)).toContain("no terminal frame")

    // finalizeTurn released the guards: the next send is accepted, not TURN_BUSY.
    h.send({ id: 20, method: "session.send", params: { text: "second" } })
    const sent = await h.waitFor(20)
    expect(sent.ok).toBe(true)
    expect(sent.result.turnId).not.toBe(turnId)
  })
})
