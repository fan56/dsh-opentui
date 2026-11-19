/**
 * Protocol-level unit tests for `mapHostError` (ADR-0010 error-code table).
 *
 * `mapHostError` is exercised through the real `apply()` NDJSON wire rather
 * than by exporting it: `session.open{mode:"resume"}` calls `ctx.agents.resume`,
 * and a thrown host error (classified by its stable `this.name`) is mapped to
 * a protocol code + detail by the catch in `handleOpen`. No host package is
 * imported and no model turn runs — the fake `resume` throws synchronously.
 *
 * Covers the four mapped names (including SESSION_LOCKED's holder detail) plus
 * the unknown-name INTERNAL fallback documented in the ADR table.
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

/** An Error carrying the stable host `name` mapHostError classifies on. */
function hostError(name: string, message: string, extra: Record<string, unknown> = {}): Error {
  const err = new Error(message)
  err.name = name
  Object.assign(err, extra)
  return err
}

interface Harness {
  send(frame: unknown): void
  waitFor(id: number | string): Promise<Frame>
}

function makeHarness(resumeThrows: () => never): Harness {
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
      return originalWrite(chunk, ...rest)
    }
    const isBridgeFrame =
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      "id" in parsed &&
      "ok" in parsed
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

  let disposeBridge: (() => void) | undefined
  const ctx: any = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    effect(execute: () => () => void) {
      disposeBridge = execute()
      return { dispose: () => disposeBridge?.() }
    },
    agents: {
      async create() {
        throw new Error("create must not be called for resume")
      },
      async resume() {
        return resumeThrows()
      },
      get() {
        return undefined // force the eager-resume arm
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

  return {
    send(frame: unknown) {
      const line = `${JSON.stringify(frame)}\n`
      for (const fn of stdinListeners["data"] || []) fn(line)
    },
    waitFor: async (id: number | string): Promise<Frame> => {
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

/** Drive one resume-open that fails with `err`, returning the error frame. */
async function openWithHostError(err: Error): Promise<Frame> {
  const h = makeHarness(() => {
    throw err
  })
  h.send({ id: 1, method: "session.open", params: { mode: "resume", id: "target-session" } })
  const reply = await h.waitFor(1)
  expect(reply.ok).toBe(false)
  return reply.error
}

describe("mapHostError — host error name mapping (ADR-0010)", () => {
  test("SessionPersistenceNotFoundError -> SESSION_NOT_FOUND (no detail)", async () => {
    const error = await openWithHostError(hostError("SessionPersistenceNotFoundError", "no such log"))
    expect(error.code).toBe("SESSION_NOT_FOUND")
    expect(error.message).toBe("no such log")
    expect(error.detail).toBeUndefined()
  })

  test("SessionPersistenceCorruptionError -> JOURNAL_CORRUPT (no detail)", async () => {
    const error = await openWithHostError(hostError("SessionPersistenceCorruptionError", "bad seq"))
    expect(error.code).toBe("JOURNAL_CORRUPT")
    expect(error.message).toBe("bad seq")
    expect(error.detail).toBeUndefined()
  })

  test("SessionFormatUnsupportedError -> VERSION_INCOMPATIBLE (no detail)", async () => {
    const error = await openWithHostError(hostError("SessionFormatUnsupportedError", "future format"))
    expect(error.code).toBe("VERSION_INCOMPATIBLE")
    expect(error.message).toBe("future format")
    expect(error.detail).toBeUndefined()
  })

  test("SessionAlreadyOwnedError -> SESSION_LOCKED with detail.holder = sessionId", async () => {
    const error = await openWithHostError(
      hostError("SessionAlreadyOwnedError", "writer held", { sessionId: "holder-session-42" }),
    )
    expect(error.code).toBe("SESSION_LOCKED")
    expect(error.message).toBe("writer held")
    expect(error.detail).toEqual({ holder: "holder-session-42" })
  })

  test("unknown host error name -> INTERNAL (no detail)", async () => {
    const error = await openWithHostError(hostError("SomeUnmappedHostError", "mystery"))
    expect(error.code).toBe("INTERNAL")
    expect(error.message).toBe("mystery")
    expect(error.detail).toBeUndefined()
  })
})
