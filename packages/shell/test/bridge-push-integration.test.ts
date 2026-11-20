/**
 * S3 / BL-1 — relay→seam INTEGRATION tests (the gap between the two halves).
 *
 * The bridge unit test only checks that each relay subscription counts its own
 * seq (1,2,3 per method); the seam unit test only injects one method's frames.
 * Neither can see that the seam used to key ordering by sessionId alone, which
 * silently starved the 2nd and 3rd streams of a session. This file wires a real
 * `createPushRelay` straight into a real `BridgeSessionSeam`'s event pump and
 * drives all three subscriptions CONCURRENTLY with deliberately interleaved
 * frames — one test, full chain, no per-half shortcuts.
 */
import { describe, expect, test } from "bun:test"
import { createPushRelay, PUSH_RELAY_METHOD_IDS } from "../../bridge/src/index.ts"
import {
  BridgeSessionSeam,
  type BridgeEventFrame,
  type BridgeTransport,
  type CapPushEvent,
} from "../src/client/bridge-session-seam.ts"

const [EVENT, STATE, PROJ] = PUSH_RELAY_METHOD_IDS as readonly [string, string, string]
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * Per-method barrier: each relay subscription's async generator parks on
 * `next()` until the test pushes its next frame. This removes timing races from
 * the interleave — the exact emission order is decided by `plan`, not by luck.
 */
class InterleaveGate {
  readonly waiting = new Map<string, Array<(value: string | null) => void>>()
  readonly buffered = new Map<string, Array<string | null>>()

  next(methodId: string): Promise<string | null> {
    const buffered = this.buffered.get(methodId)
    if (buffered !== undefined && buffered.length > 0) return Promise.resolve(buffered.shift()!)
    return new Promise((resolve) => {
      const waiting = this.waiting.get(methodId) ?? []
      waiting.push(resolve)
      this.waiting.set(methodId, waiting)
    })
  }

  push(methodId: string, value: string | null): void {
    const waiting = this.waiting.get(methodId)
    if (waiting !== undefined && waiting.length > 0) {
      waiting.shift()!(value)
      return
    }
    const buffered = this.buffered.get(methodId) ?? []
    buffered.push(value)
    this.buffered.set(methodId, buffered)
  }

  end(methodId: string): void {
    this.push(methodId, null)
  }
}

function makeSeamCapture(sessionId: string) {
  const listeners: Array<(frame: BridgeEventFrame) => void> = []
  const transport: BridgeTransport = {
    async request() { return {} },
    onEvent(listener) {
      listeners.push(listener)
      return () => {
        const i = listeners.indexOf(listener)
        if (i >= 0) listeners.splice(i, 1)
      }
    },
  }
  const logs: unknown[][] = []
  const logger = {
    info(...args: unknown[]) { logs.push(args) },
    warn(...args: unknown[]) { logs.push(args) },
    error(...args: unknown[]) { logs.push(args) },
  }
  const seam = new BridgeSessionSeam({ transport, ctx: { logger } })
  const delivered: CapPushEvent[] = []
  seam.onCapPush(sessionId, (event) => delivered.push(event))
  return {
    seam,
    delivered,
    logs,
    pump(frame: BridgeEventFrame) {
      for (const listener of [...listeners]) listener(frame)
    },
  }
}

describe("S3 / BL-1 — relay → seam interleaved integration", () => {
  test("one session, three concurrent streams, interleaved frames: each stream's own seq 1..4 intact, no loss / no duplicate", async () => {
    const session = "sess-bl1-interleave"
    const host = makeSeamCapture(session)
    const gate = new InterleaveGate()
    const relay = createPushRelay({
      invoke: async ({ methodId }) => {
        const method = methodId as string
        return {
          async *[Symbol.asyncIterator]() {
            for (;;) {
              const value = await gate.next(method)
              if (value === null) return // relay emits cap.end stream-end
              yield { type: value }
            }
          },
        }
      },
      emit: (type, payload) => host.pump({ type, payload }),
    })

    relay.start(session)
    await tick(); await tick() // all three subscriptions park on gate.next()

    // 4 frames per method, deliberately rotated so no two consecutive frames
    // belong to the same stream. Pre-fix seam (single sessionId lastSeq) would
    // deliver only EVENT's 4 frames and silently drop all 8 STATE/PROJ frames.
    const plan: Array<[string, string]> = [
      [EVENT, "ready"], [STATE, "ready"], [PROJ, "ready"],
      [EVENT, "a"], [PROJ, "a"], [STATE, "a"],
      [STATE, "b"], [EVENT, "b"], [PROJ, "b"],
      [PROJ, "c"], [STATE, "c"], [EVENT, "c"],
    ]
    for (const [method, type] of plan) gate.push(method, type)
    await tick(); await tick()

    for (const method of [EVENT, STATE, PROJ]) gate.end(method)
    for (let i = 0; i < 10 && relay.activeCount() > 0; i++) await tick()

    const byMethod = new Map<string, number[]>()
    for (const event of host.delivered) {
      byMethod.set(event.methodId, [...(byMethod.get(event.methodId) ?? []), event.seq])
    }
    expect(byMethod.size).toBe(3)
    for (const method of [EVENT, STATE, PROJ]) {
      expect(byMethod.get(method)).toEqual([1, 2, 3, 4])
    }
    expect(host.delivered).toHaveLength(12)
    expect(new Set(host.delivered.map((e) => `${e.methodId}:${e.seq}`)).size).toBe(12)
    // C-2: nothing was silently dropped on the happy path.
    expect(host.seam.capPushDropCount(session)).toBe(0)
    // Per subscription cap.end stream-end → each degraded; aggregate lastSeq 4.
    expect(host.seam.capPushStatus(session)).toMatchObject({ state: "degraded", lastSeq: 4 })
  })

  test("C-1 end-to-end: relay error code survives into the seam's degrade log (no swallowed detail)", async () => {
    const session = "sess-c1-chain"
    const host = makeSeamCapture(session)
    const relay = createPushRelay({
      invoke: async () => { throw new Error("NOT_WIRED: host observe* absent") },
      emit: (type, payload) => host.pump({ type, payload }),
    })
    relay.start(session)
    for (let i = 0; i < 10 && relay.activeCount() > 0; i++) await tick()

    expect(host.seam.capPushStatus(session)?.state).toBe("degraded")
    const logText = host.logs.map((args) => args.join(" ")).join("\n")
    expect(logText).toContain("code=NOT_WIRED")
  })
})
