// 025 wave2 W2-1 — side-session lifecycle module tests (seam-side, A-2).
// Synthetic RPC only: no host service, no real credential value (SENTINEL fake).
import { describe, expect, test } from "bun:test"
import {
  projectWaitAnswer,
  runSideSession,
  SideSessionError,
  type SideSessionRpc,
} from "../src/client/bridge-side-session"

const SENTINEL = "W21_SENTINEL_synthetic_no_real_credential"

const assistantRecord = (text: string, seq: number) => ({
  type: "event",
  event: { type: "assistant/message", seq, time: seq, data: { text } },
})

describe("W2-1 side-session (create -> prompt -> wait, no destroy)", () => {
  test("lifecycle order + wire names + bounded result", async () => {
    const calls: { method: string; params: unknown }[] = []
    const rpc: SideSessionRpc = async (method, params) => {
      calls.push({ method, params })
      if (method === "session.create") return { sessionId: "side-1" }
      if (method === "session.prompt") return { accepted: true }
      if (method === "session.wait") {
        return { reason: "idle", state: {}, output: { records: [assistantRecord("answer text", 2)], truncated: false } }
      }
      throw new Error("unexpected method " + method)
    }
    const result = await runSideSession({ rpc, question: "q?", snapshot: ["ctx"], sessionId: "req-1", requestId: () => "rid-1" })
    expect(calls.map((c) => c.method)).toEqual(["session.create", "session.prompt", "session.wait"])
    expect(result).toEqual({ answer: "answer text", sessionId: "side-1", reason: "idle", truncated: false })

    const createParams = (calls[0]!.params as { request: Record<string, unknown> }).request
    expect(createParams).toEqual({ sessionId: "req-1" }) // blank throwaway, no cwd/workspace
    const promptParams = (calls[1]!.params as { request: Record<string, unknown> }).request
    expect(promptParams.requestId).toBe("rid-1")
    expect(promptParams.sessionId).toBe("side-1")
    expect(promptParams.mode).toBe("queue")
    expect(JSON.stringify(promptParams.content)).toContain("q?")
    expect(JSON.stringify(promptParams.content)).toContain("ctx")
    expect(JSON.stringify(promptParams.content)).toContain("for reference only")
    const waitParams = (calls[2]!.params as { request: Record<string, unknown> }).request
    expect(waitParams.sessionId).toBe("side-1")
    expect(waitParams.timeoutMs).toBe(120_000)
  })

  test("text projection: newest-first records restored, only text blocks, length capped", () => {
    const wait = {
      output: {
        records: [
          assistantRecord("newest", 3),
          assistantRecord("oldest", 1),
          { type: "event", event: { type: "tool/result", seq: 2, data: { tool: "x" } } },
        ],
        truncated: false,
      },
    }
    const out = projectWaitAnswer(wait, 100)
    expect(out.answer).toBe("oldest\n\nnewest")
    expect(out.truncated).toBe(false)

    const capped = projectWaitAnswer({ output: { records: [assistantRecord("x".repeat(50), 1)], truncated: false } }, 10)
    expect(capped.answer).toHaveLength(10)
    expect(capped.truncated).toBe(true)
  })

  test("E5 SENTINEL: hostile sensitive keys in wait reply never reach the projected answer", () => {
    const hostile = {
      reason: "idle",
      apiKey: SENTINEL,
      token: SENTINEL,
      output: {
        records: [{
          type: "event",
          event: {
            type: "assistant/message",
            seq: 1,
            data: { text: "safe answer", apiKey: SENTINEL, secret: SENTINEL, content: [{ type: "image", data: SENTINEL }] },
          },
        }],
        truncated: false,
      },
    }
    const out = projectWaitAnswer(hostile, 100)
    const json = JSON.stringify(out)
    expect(out.answer).toBe("safe answer") // flat text wins; image block ignored
    expect(json).not.toContain(SENTINEL)
    expect(json).not.toMatch(/apiKey|"token"|secret/i)
  })

  test("E3 degrade保真: NOT_WIRED at any stage rejects with UNAVAILABLE (never a fake answer)", async () => {
    for (const failStage of ["session.create", "session.prompt", "session.wait"]) {
      let calls = 0
      const rpc: SideSessionRpc = async (method) => {
        calls++
        if (method === failStage) throw new Error("NOT_WIRED: sessionController unavailable")
        if (method === "session.create") return { sessionId: "side-1" }
        if (method === "session.prompt") return { accepted: true }
        return { reason: "idle", output: { records: [], truncated: false } }
      }
      const err = await runSideSession({ rpc, question: "q" }).then(() => undefined, (e) => e)
      expect(err).toBeInstanceOf(SideSessionError)
      expect((err as SideSessionError).code).toBe("SIDE_SESSION_UNAVAILABLE")
      expect((err as SideSessionError).message).toContain(failStage === "session.create" ? "create" : failStage === "session.prompt" ? "prompt" : "wait")
      expect(calls).toBeGreaterThan(0)
    }
  })

  test("empty/timeout wait resolves with empty answer (no fabricated model reply)", async () => {
    const rpc: SideSessionRpc = async (method) => {
      if (method === "session.create") return { sessionId: "side-1" }
      if (method === "session.prompt") return { accepted: true }
      return { reason: "timeout", output: { records: [], truncated: false } }
    }
    const result = await runSideSession({ rpc, question: "q" })
    expect(result.answer).toBe("")
    expect(result.reason).toBe("timeout")
  })
})
