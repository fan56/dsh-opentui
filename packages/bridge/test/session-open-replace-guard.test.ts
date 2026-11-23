/**
 * W3 /new fix — guard coverage for `session.open{replace:true}`.
 *
 * The bridge guard at src/index.ts:3920-3923 rejects replace unless it is
 * `mode:"resume"` with an explicitly named id. That guard had NO test: the old
 * client sent `{mode:"new", replace:true}` after /new, got BAD_PARAMS, and the
 * staged intent was dropped. These tests pin the guard itself, independently
 * of the client fix in the shell seam.
 *
 * Same fake-cordis-ctx + fake-stdin/stdout technique as the sibling bridge
 * tests: the real `apply()` is driven through the NDJSON wire, no host package
 * is imported.
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

interface Harness {
  frames: string[]
  disposeCalls: string[]
  send(frame: unknown): void
  waitFor(id: number | string): Promise<Frame>
}

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
  const disposeCalls: string[] = []
  const idlePromise = new Promise<void>(() => { /* never settles: no turn terminal needed here */ })
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
      disposeCalls.push(sessionId)
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
    disposeCalls,
    send(frame: unknown) {
      const line = `${JSON.stringify(frame)}\n`
      for (const fn of stdinListeners["data"] || []) fn(line)
    },
    waitFor,
  }
}

describe("W3 — session.open replace guard ({mode:new, replace:true} is BAD_PARAMS)", () => {
  test("with a binding open, {mode:new, replace:true} -> BAD_PARAMS and the original binding survives", async () => {
    const h = makeHarness()

    // Open session A on the real bridge handler.
    h.send({ id: 1, method: "session.open", params: { mode: "new" } })
    const opened = await h.waitFor(1)
    expect(opened.ok).toBe(true)
    const sessionA = opened.result.sessionId as string
    expect(typeof sessionA).toBe("string")

    // The exact frame the buggy client used to send after /new.
    h.send({ id: 2, method: "session.open", params: { mode: "new", replace: true } })
    const rejected = await h.waitFor(2)
    expect(rejected.ok).toBe(false)
    expect(rejected.error.code).toBe("BAD_PARAMS")

    // The guard rejects BEFORE disposeBinding: A must still be open.
    expect(h.disposeCalls).toEqual([])

    // Original binding is still usable: an idempotent resume names A and a
    // session.send still reaches it (no new id minted, no previousSessionId).
    h.send({ id: 3, method: "session.open", params: { mode: "resume", id: sessionA } })
    const resumed = await h.waitFor(3)
    expect(resumed.ok).toBe(true)
    expect(resumed.result.sessionId).toBe(sessionA)
    expect(resumed.result).not.toHaveProperty("previousSessionId")

    h.send({ id: 4, method: "session.send", params: { text: "still-A" } })
    const sent = await h.waitFor(4)
    expect(sent.ok).toBe(true)
    expect(h.disposeCalls).toEqual([])
  })
})
