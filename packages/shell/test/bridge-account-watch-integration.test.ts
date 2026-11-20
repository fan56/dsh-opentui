/**
 * S4 / E5 — ACCOUNT WATCH relay → seam INTEGRATION tests.
 *
 * Same gap as S3/BL-1 but for the PKCE completion channels: `account/watch` and
 * `account/watchExpiry` are two concurrent streams in ONE session. A real
 * `createAccountWatchRelay` is wired into a real `BridgeSessionSeam` event pump
 * and driven with deliberately interleaved frames. This proves the BL-1
 * composite-key fix (seq per (sessionId,methodId)) covers the new stream arms.
 *
 * The synthetic URL lives only in memory; the pre/post control records booleans
 * and counts, never the value, so the evidence package stays desensitized.
 */
import { describe, expect, test } from "bun:test"
import {
  ACCOUNT_WATCH_RELAY_METHOD_IDS,
  createAccountWatchRelay,
} from "../../bridge/src/index.ts"
import {
  BridgeSessionSeam,
  type BridgeEventFrame,
  type BridgeTransport,
  type CapPushEvent,
} from "../src/client/bridge-session-seam.ts"

const [WATCH, EXPIRY] = ACCOUNT_WATCH_RELAY_METHOD_IDS as readonly [string, string]
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const SENTINEL = "DSHS4AUTHURL_SENTINEL_planted_negative_control"
const AUTH_URL = `https://auth.invalid/dsh/authorize?code_challenge=syntheticChallengeValue0123456789&state=${SENTINEL}`
const FORBIDDEN = [SENTINEL, "code_challenge=", "state=", '"authorizeUrl":']
const hitCount = (s: string): number => FORBIDDEN.reduce((n, needle) => n + (s.includes(needle) ? 1 : 0), 0)

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
    if (waiting !== undefined && waiting.length > 0) { waiting.shift()!(value); return }
    const buffered = this.buffered.get(methodId) ?? []
    buffered.push(value)
    this.buffered.set(methodId, buffered)
  }
  end(methodId: string): void { this.push(methodId, null) }
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
    pump(frame: BridgeEventFrame) { for (const listener of [...listeners]) listener(frame) },
  }
}

describe("S4 / E5 — account watch + watchExpiry interleaved integration", () => {
  test("one session, two concurrent account streams, 8 interleaved frames: both seq 1..4 intact, zero drop", async () => {
    const session = "sess-s4-account-interleave"
    const host = makeSeamCapture(session)
    const gate = new InterleaveGate()
    const relay = createAccountWatchRelay({
      invoke: async ({ methodId }) => {
        const method = methodId as string
        return {
          async *[Symbol.asyncIterator]() {
            for (;;) {
              const value = await gate.next(method)
              if (value === null) return
              // S4 review C1: watchExpiry yields the BARE STRING
              // 'session-expired' (rc.5 index.ts:585-590), never an object.
              // The relay must map that string to eventType='expiry'.
              if (method === EXPIRY) yield "session-expired"
              // watch items carry a raw auth URL — must never reach the seam.
              else yield { type: value, state: { status: "signed-out", attempt: { authorizeUrl: AUTH_URL } } }
            }
          },
        }
      },
      emit: (type, payload) => host.pump({ type, payload }),
    })

    relay.start(session)
    await tick(); await tick()

    const plan: Array<[string, string]> = [
      [WATCH, "snapshot"], [EXPIRY, "expiry"],
      [WATCH, "credentials-changed"], [EXPIRY, "expiry"],
      [EXPIRY, "expiry"], [WATCH, "snapshot"],
      [WATCH, "credentials-changed"], [EXPIRY, "expiry"],
    ]
    for (const [method, type] of plan) gate.push(method, type)
    await tick(); await tick()
    for (const method of [WATCH, EXPIRY]) gate.end(method)
    for (let i = 0; i < 10 && relay.activeCount() > 0; i++) await tick()

    const byMethod = new Map<string, number[]>()
    for (const event of host.delivered) {
      byMethod.set(event.methodId, [...(byMethod.get(event.methodId) ?? []), event.seq])
    }
    expect(byMethod.size).toBe(2)
    expect(byMethod.get(WATCH)).toEqual([1, 2, 3, 4])
    expect(byMethod.get(EXPIRY)).toEqual([1, 2, 3, 4])
    // C1 proof: the bare 'session-expired' string maps to the 'expiry' enum.
    expect(host.delivered.filter((e) => e.methodId === EXPIRY).map((e) => e.eventType))
      .toEqual(["expiry", "expiry", "expiry", "expiry"])
    expect(host.delivered).toHaveLength(8)
    expect(new Set(host.delivered.map((e) => `${e.methodId}:${e.seq}`)).size).toBe(8)
    expect(host.seam.capPushDropCount(session)).toBe(0)
    expect(host.seam.capPushStatus(session)).toMatchObject({ state: "degraded", lastSeq: 4 })

    // S4 auth-URL ban: eventType is a bounded enum; no raw URL reaches the seam.
    for (const event of host.delivered) {
      expect(["snapshot", "credentials-changed", "expiry"]).toContain(event.eventType)
    }
    expect(hitCount(JSON.stringify(host.delivered))).toBe(0)
    expect(hitCount(host.logs.map((args) => args.join(" ")).join("\n"))).toBe(0)

    // PRE/POST control: a legacy single-session-key order filter (the BL-1
    // pre-fix shape) drops half the frames under the SAME plan. Booleans only.
    let legacyLastSeq = 0
    let legacyDelivered = 0
    for (const [method, _type] of plan) {
      const seq = legacySeqByMethod.get(method)!
      legacySeqByMethod.set(method, seq + 1)
      if (seq <= legacyLastSeq) continue // pre-fix: shared sessionId key
      legacyLastSeq = seq
      legacyDelivered++
    }
    expect(legacyDelivered).toBe(4) // pre-fix: 4 of 8 starved
    expect(host.delivered.length).toBe(8) // post-fix: all 8 delivered
  })

  test("LOG layer: cap.end code reaches the degrade log as a bounded enum, no URL", async () => {
    const session = "sess-s4-degrade-log"
    const host = makeSeamCapture(session)
    const relay = createAccountWatchRelay({
      invoke: async () => { throw new Error(`NOT_WIRED: ${AUTH_URL}`) },
      emit: (type, payload) => host.pump({ type, payload }),
    })
    relay.start(session)
    for (let i = 0; i < 10 && relay.activeCount() > 0; i++) await tick()

    expect(host.seam.capPushStatus(session)?.state).toBe("degraded")
    const logText = host.logs.map((args) => args.join(" ")).join("\n")
    expect(logText).toContain("code=NOT_WIRED")
    expect(hitCount(logText)).toBe(0)
  })
})

// Mutable seq counters for the legacy control above (per method, independent —
// exactly the shape the pre-fix seam FAILED to use for ordering).
const legacySeqByMethod = new Map<string, number>([[WATCH, 1], [EXPIRY, 1]])
