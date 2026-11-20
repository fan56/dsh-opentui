/**
 * S3 主动推 — bridge-side unit tests.
 *
 * Machine-verifies the S3 capability face and the S2 review B2 fix:
 *  - withOwnedAbort releases a self-created controller on return / throw /
 *    natural completion, and never aborts a caller-owned signal;
 *  - createCapHostInvoke's session push stream arms route through the generated
 *    kind table, carry sessionId, reject bad params/kind, and release ownership;
 *  - createPushRelay assigns strictly-increasing seq, emits an explicit cap.end
 *    on stream end / failure, and aborts every subscription on stop/stopAll.
 *
 * All host surfaces are structural fakes (no @deepseek-ai runtime import).
 */
import { describe, expect, test } from "bun:test"
import {
  createCapHostInvoke,
  createPushRelay,
  PUSH_RELAY_METHOD_IDS,
  probeOwnedAbortRelease,
  withOwnedAbort,
} from "../src/index"

const OBSERVE_EVENT = "@deepseek-ai/dsh-api-session-controller#session/observeEvent"
const OBSERVE_STATE = "@deepseek-ai/dsh-api-session-controller#session/observeState"
const OBSERVE_PROJECTIONS = "@deepseek-ai/dsh-api-session-controller#session/observeProjections"
const UNWIRED_STREAM = "@deepseek-ai/dsh-api-session-controller#session/control"

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function fakeSource<T>(items: readonly T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item
    },
  }
}

// ---------------------------------------------------------------------------
// B2 — owned AbortController release
// ---------------------------------------------------------------------------

describe("S3 / B2 — owned AbortController release", () => {
  test("aborts on iterator return()", async () => {
    const owned = new AbortController()
    const iterator = withOwnedAbort(fakeSource([1, 2, 3]), owned)[Symbol.asyncIterator]()
    await iterator.next()
    expect(owned.signal.aborted).toBe(false)
    await iterator.return?.(undefined)
    expect(owned.signal.aborted).toBe(true)
  })

  test("aborts on iterator throw()", async () => {
    const owned = new AbortController()
    const iterator = withOwnedAbort(fakeSource([1]), owned)[Symbol.asyncIterator]()
    await iterator.next()
    try {
      await iterator.throw?.(new Error("consumer failed"))
    } catch {
      /* source may rethrow; release must still have happened */
    }
    expect(owned.signal.aborted).toBe(true)
  })

  test("aborts on natural completion", async () => {
    const owned = new AbortController()
    const values: number[] = []
    for await (const value of withOwnedAbort(fakeSource([1, 2]), owned)) values.push(value)
    expect(values).toEqual([1, 2])
    expect(owned.signal.aborted).toBe(true)
  })

  test("never aborts a caller-owned signal (ownership is explicit)", async () => {
    const caller = new AbortController()
    const wrapped = withOwnedAbort(fakeSource([1]), undefined)
    for await (const _ of wrapped) { /* consume */ }
    expect(caller.signal.aborted).toBe(false)
    const iterator = wrapped[Symbol.asyncIterator]()
    await iterator.next()
    await iterator.return?.(undefined)
    expect(caller.signal.aborted).toBe(false)
  })

  test("shipped-bundle self-check probeOwnedAbortRelease() === true", async () => {
    expect(await probeOwnedAbortRelease()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// hostInvoke stream arms — generated-kind routing, validation, B2 integration
// ---------------------------------------------------------------------------

interface FakeSessionController {
  calls: Array<{ method: string; sessionId: string; signal: AbortSignal | undefined }>
  list(): Promise<{ items: unknown[] }>
  observeEvent?(request: { address: { kind: string; sessionId: string } }, signal: AbortSignal): AsyncIterable<{ type: string }>
  observeState?(request: { sessionId: string }, signal: AbortSignal): AsyncIterable<unknown>
  observeProjections?(request: { sessionId: string }, signal: AbortSignal): AsyncIterable<unknown>
}

function makeCtx(controller: FakeSessionController): never {
  return {
    get: (name: string) => (name === "sessionController" ? controller : undefined),
  } as never
}

function makeController(): FakeSessionController {
  const calls: FakeSessionController["calls"] = []
  return {
    calls,
    async list() { return { items: [] } },
    observeEvent(request, signal) {
      calls.push({ method: "observeEvent", sessionId: request.address.sessionId, signal })
      return fakeSource([{ type: "ready" }, { type: "event" }])
    },
    observeState(request, signal) {
      calls.push({ method: "observeState", sessionId: request.sessionId, signal })
      return fakeSource([{ type: "state" }])
    },
    observeProjections(request, signal) {
      calls.push({ method: "observeProjections", sessionId: request.sessionId, signal })
      return fakeSource([{ type: "projection" }])
    },
  }
}

describe("S3 — createCapHostInvoke push arms", () => {
  test("all three push ids are wired in the registry", async () => {
    const hostInvoke = createCapHostInvoke(makeCtx(makeController()))
    for (const id of [OBSERVE_EVENT, OBSERVE_STATE, OBSERVE_PROJECTIONS]) {
      const value = await hostInvoke(id as never, "stream", { sessionId: "sess-1" })
      expect(typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator]).toBe("function")
    }
  })

  test("observeEvent forwards sessionId and releases its owned signal on return", async () => {
    const controller = makeController()
    const hostInvoke = createCapHostInvoke(makeCtx(controller))
    const value = await hostInvoke(OBSERVE_EVENT as never, "stream", {
      address: { kind: "session", sessionId: "sess-2" },
    })
    expect(controller.calls).toHaveLength(1)
    expect(controller.calls[0]!.sessionId).toBe("sess-2")
    const ownedSignal = controller.calls[0]!.signal!
    expect(ownedSignal.aborted).toBe(false)
    const iterator = (value as AsyncIterable<unknown>)[Symbol.asyncIterator]()
    const first = await iterator.next()
    expect(first.value).toEqual({ type: "ready" })
    await iterator.return?.(undefined)
    expect(ownedSignal.aborted).toBe(true)
  })

  test("caller-supplied signal is used verbatim and is not aborted by the wrapper", async () => {
    const controller = makeController()
    const hostInvoke = createCapHostInvoke(makeCtx(controller))
    const caller = new AbortController()
    const value = await hostInvoke(OBSERVE_EVENT as never, "stream", {
      sessionId: "sess-3",
      signal: caller.signal,
    })
    expect(controller.calls[0]!.signal).toBe(caller.signal)
    const iterator = (value as AsyncIterable<unknown>)[Symbol.asyncIterator]()
    await iterator.next()
    await iterator.return?.(undefined)
    expect(caller.signal.aborted).toBe(false)
  })

  test("BAD_PARAMS: missing/empty sessionId never reaches the host", async () => {
    const controller = makeController()
    const hostInvoke = createCapHostInvoke(makeCtx(controller))
    await expect(hostInvoke(OBSERVE_EVENT as never, "stream", {})).rejects.toThrow("BAD_PARAMS")
    await expect(
      hostInvoke(OBSERVE_EVENT as never, "stream", { address: { kind: "session", sessionId: "" } }),
    ).rejects.toThrow("BAD_PARAMS")
    expect(controller.calls).toHaveLength(0)
  })

  test("BAD_PARAMS: a non-AbortSignal signal is rejected before the host", async () => {
    const controller = makeController()
    const hostInvoke = createCapHostInvoke(makeCtx(controller))
    await expect(
      hostInvoke(OBSERVE_STATE as never, "stream", { sessionId: "sess-4", signal: "not-a-signal" }),
    ).rejects.toThrow("BAD_PARAMS")
    expect(controller.calls).toHaveLength(0)
  })

  test("BAD_KIND: a push id invoked with unary transport is rejected", async () => {
    const controller = makeController()
    const hostInvoke = createCapHostInvoke(makeCtx(controller))
    await expect(
      hostInvoke(OBSERVE_PROJECTIONS as never, "unary", { sessionId: "sess-5" }),
    ).rejects.toThrow("BAD_KIND")
    expect(controller.calls).toHaveLength(0)
  })

  test("NOT_WIRED: an unwired stream id rejects explicitly (no silent empty stream)", async () => {
    const hostInvoke = createCapHostInvoke(makeCtx(makeController()))
    await expect(hostInvoke(UNWIRED_STREAM as never, "stream", {})).rejects.toThrow("NOT_WIRED")
  })
})

// ---------------------------------------------------------------------------
// relay — seq ordering, degrade, ownership
// ---------------------------------------------------------------------------

describe("S3 — createPushRelay", () => {
  test("emits strictly increasing seq 1,2,3 then cap.end stream-end", async () => {
    const frames: Array<{ type: string; payload: Record<string, unknown> }> = []
    const relay = createPushRelay({
      invoke: async ({ params }) => {
        const sessionId = (params as { sessionId: string }).sessionId
        return fakeSource([{ type: "ready" }, { type: "a" }, { type: "b" }].map((type) => ({ type, sessionId })))
      },
      emit: (type, payload) => { frames.push({ type, payload }) },
    })
    expect(PUSH_RELAY_METHOD_IDS).toHaveLength(3)
    relay.start("sess-1")
    for (let i = 0; i < 30 && relay.activeCount() > 0; i++) await tick()
    const events = frames.filter((f) => f.type === "cap.event")
    // 3 subscriptions × 3 items; each subscription's seq restarts at 1.
    expect(events).toHaveLength(9)
    const byMethod = new Map<string, number[]>()
    for (const f of events) {
      const method = f.payload.methodId as string
      byMethod.set(method, [...(byMethod.get(method) ?? []), f.payload.seq as number])
    }
    for (const seqs of byMethod.values()) expect(seqs).toEqual([1, 2, 3])
    expect(frames.filter((f) => f.type === "cap.end" && f.payload.reason === "stream-end")).toHaveLength(3)
    expect(relay.activeCount()).toBe(0)
  })

  test("stop() aborts and forgets every subscription for one session", async () => {
    const seenSignals: AbortSignal[] = []
    const relay = createPushRelay({
      invoke: async ({ params }) => {
        const signal = (params as { signal: AbortSignal }).signal
        seenSignals.push(signal)
        return {
          async *[Symbol.asyncIterator]() {
            while (!signal.aborted) {
              await tick()
              yield { type: "event" }
            }
          },
        }
      },
      emit: () => { /* no-op */ },
    })
    relay.start("sess-a")
    relay.start("sess-b")
    expect(relay.activeCount()).toBe(6)
    relay.stop("sess-a")
    await tick()
    expect(relay.activeCount()).toBe(3)
    expect(seenSignals.filter((s) => s.aborted)).toHaveLength(3)
    relay.stopAll()
    await tick()
    expect(relay.activeCount()).toBe(0)
    expect(seenSignals.every((s) => s.aborted)).toBe(true)
  })

  test("invoke failure degrades to cap.end unavailable (never fabricates events)", async () => {
    const frames: Array<{ type: string; payload: Record<string, unknown> }> = []
    const relay = createPushRelay({
      invoke: async () => { throw new Error("NOT_WIRED: host observe* absent") },
      emit: (type, payload) => { frames.push({ type, payload }) },
    })
    relay.start("sess-x")
    for (let i = 0; i < 30 && relay.activeCount() > 0; i++) await tick()
    expect(frames.filter((f) => f.type === "cap.event")).toHaveLength(0)
    const ends = frames.filter((f) => f.type === "cap.end")
    expect(ends).toHaveLength(3)
    expect(ends.every((f) => f.payload.reason === "unavailable")).toBe(true)
  })
})
