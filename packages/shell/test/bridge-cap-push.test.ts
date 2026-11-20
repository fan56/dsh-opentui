/**
 * S3 主动推 — seam consumer unit tests.
 *
 * Machine-verifies the seam half of the push face:
 *  - delivery is scoped to the subscribed sessionId and stops on dispose;
 *  - seq must strictly increase (duplicate/regressive frames are dropped);
 *  - cap.end → degraded, bridge.dead → disconnected, resume → attached + seq 0;
 *  - malformed frames are a contained no-op.
 */
import { describe, expect, test } from "bun:test"
import {
  BridgeSessionSeam,
  type BridgeEventFrame,
  type BridgeTransport,
} from "../src/client/bridge-session-seam.ts"
import { recoverBridgeSession, type RecoverableBridgeTransport } from "../src/client/seam-bootstrap.ts"

type Reply =
  | { kind: "value"; value: unknown }
  | { kind: "error"; error: unknown }
  | { kind: "fn"; fn: (params?: Record<string, unknown>) => Reply }

function makeHarness() {
  const requests: { method: string; params?: Record<string, unknown> }[] = []
  const replies = new Map<string, Reply>()
  const listeners: ((frame: BridgeEventFrame) => void)[] = []
  const logs: unknown[][] = []
  const transport: RecoverableBridgeTransport = {
    async request(method, params) {
      requests.push({ method, params })
      const reply = replies.get(method)
      if (reply === undefined) return {}
      if (reply.kind === "error") throw reply.error
      if (reply.kind === "fn") return (reply.fn(params) as { value: unknown }).value
      return reply.value
    },
    onEvent(listener) {
      listeners.push(listener)
      return () => {
        const i = listeners.indexOf(listener)
        if (i >= 0) listeners.splice(i, 1)
      }
    },
    async recover() { requests.push({ method: "__recover__" }) },
  }
  const logger = {
    info(...args: unknown[]) { logs.push(args) },
    warn(...args: unknown[]) { logs.push(args) },
    error(...args: unknown[]) { logs.push(args) },
  }
  const seam = new BridgeSessionSeam({ transport, ctx: { logger } })
  return {
    seam,
    transport,
    requests,
    replies,
    logs,
    emit(frame: BridgeEventFrame) {
      for (const listener of [...listeners]) listener(frame)
    },
    event(seq: number, sessionId = "s-A", methodId = "observeEvent", eventType = "ready"): BridgeEventFrame {
      return { type: "cap.event", payload: { methodId, sessionId, seq, eventType } }
    },
  }
}

const push = (seq: number, sessionId = "s-A") => ({ type: "cap.event", payload: { methodId: "observeEvent", sessionId, seq, eventType: "event" } })

describe("S3 — seam onCapPush delivery + sessionId isolation", () => {
  test("only the subscribed sessionId is delivered; dispose stops further delivery", () => {
    const h = makeHarness()
    const a: number[] = []
    const b: number[] = []
    const disposeA = h.seam.onCapPush("s-A", (e) => a.push(e.seq))
    h.seam.onCapPush("s-B", (e) => b.push(e.seq))

    h.emit(push(1, "s-A"))
    h.emit(push(1, "s-B"))
    h.emit(push(2, "s-A"))
    expect(a).toEqual([1, 2])
    expect(b).toEqual([1])
    expect(h.seam.capPushStatus("s-A")).toMatchObject({ sessionId: "s-A", state: "attached", lastSeq: 2 })
    expect(h.seam.capPushStatus("s-B")?.lastSeq).toBe(1)

    disposeA()
    h.emit(push(3, "s-A"))
    h.emit(push(2, "s-B"))
    expect(a).toEqual([1, 2])
    expect(b).toEqual([1, 2])
  })

  test("seq must strictly increase: injected [1,2,2,1,3] delivers [1,2,3]", () => {
    const h = makeHarness()
    const delivered: number[] = []
    h.seam.onCapPush("s-A", (e) => delivered.push(e.seq))
    for (const seq of [1, 2, 2, 1, 3]) h.emit(push(seq))
    expect(delivered).toEqual([1, 2, 3])
    expect(h.seam.capPushStatus("s-A")?.lastSeq).toBe(3)
  })

  test("malformed frames (no sessionId / bad seq) are contained no-ops", () => {
    const h = makeHarness()
    const delivered: number[] = []
    h.seam.onCapPush("s-A", (e) => delivered.push(e.seq))
    h.emit({ type: "cap.event", payload: { methodId: "observeEvent", seq: 1 } })
    h.emit({ type: "cap.event", payload: { methodId: "observeEvent", sessionId: "s-A", seq: "x" } })
    h.emit({ type: "cap.event", payload: null })
    expect(delivered).toEqual([])
    expect(() => h.emit(push(1))).not.toThrow()
    expect(delivered).toEqual([1])
  })
})

describe("S3 — seam push degrade / recovery status", () => {
  test("cap.end flips the subscription to degraded; bridge.dead flips to disconnected", () => {
    const h = makeHarness()
    const delivered: number[] = []
    h.seam.onCapPush("s-A", (e) => delivered.push(e.seq))
    h.emit(push(1))
    expect(h.seam.capPushStatus("s-A")?.state).toBe("attached")

    h.emit({ type: "cap.end", payload: { methodId: "observeEvent", sessionId: "s-A", reason: "stream-end" } })
    expect(h.seam.capPushStatus("s-A")).toMatchObject({ state: "degraded", lastSeq: 1 })

    h.emit({ type: "bridge.dead", payload: { stage: "runtime", code: 1, signal: null, message: "child exited" } })
    expect(h.seam.capPushStatus("s-A")).toMatchObject({ state: "disconnected", lastSeq: 1 })
    expect(delivered).toEqual([1])
  })

  test("resume recovery re-arms push state to attached with seq reset to 0", async () => {
    const h = makeHarness()
    h.emit(push(5, "s-42"))
    h.emit({ type: "cap.end", payload: { methodId: "observeEvent", sessionId: "s-42", reason: "unavailable" } })
    expect(h.seam.capPushStatus("s-42")?.lastSeq).toBe(5)

    h.seam.resumeSession("s-42")
    h.replies.set("session.open", { kind: "value", value: { sessionId: "s-42", journalCursor: 0 } })
    h.replies.set("journal.replay", {
      kind: "fn",
      fn: () => ({ value: { rows: [], cursor: 1 } }) as Reply,
    })
    h.replies.set("__recover__", { kind: "value", value: {} })

    const result = await recoverBridgeSession({ transport: h.transport as RecoverableBridgeTransport, seam: h.seam })
    expect(result.state).toBe("attached")
    expect(h.seam.capPushStatus("s-42")).toEqual({ sessionId: "s-42", state: "attached", lastSeq: 0 })
    // A fresh subscription starts at seq 1 again after recovery.
    const delivered: number[] = []
    h.seam.onCapPush("s-42", (e) => delivered.push(e.seq))
    h.emit(push(1, "s-42"))
    expect(delivered).toEqual([1])
  })
})
