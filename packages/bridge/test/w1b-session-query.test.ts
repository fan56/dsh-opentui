/**
 * 025-w1b B/C — hostInvoke arms for the two newly-wired session CapIR ids
 * (session/search, session/fork). Exercises the REAL createCapHostInvoke with a
 * structurally-typed mock host controller: parameter validation, the happy path,
 * and the NOT_WIRED / BAD_PARAMS branches. Frozen surfaces are untouched.
 */
import { describe, expect, test } from "bun:test"
import { createCapHostInvoke, type BridgeContext } from "../src/index"

const SEARCH = "@deepseek-ai/dsh-api-session-controller#session/search" as const
const FORK = "@deepseek-ai/dsh-api-session-controller#session/fork" as const

function ctxWith(controller: unknown): BridgeContext {
  return {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    effect: () => () => {},
    get: (name: string) => (name === "sessionController" ? controller : undefined),
  }
}

describe("025-w1b session.search / session.fork hostInvoke", () => {
  test("search: forwards {query} to the host and returns whitelisted {items}", async () => {
    let got: unknown
    const controller = {
      list: async () => ({ items: [] }), // membership test for resolveSessionController
      search: async (request: { query: string }, signal: AbortSignal) => {
        got = request
        expect(signal).toBeInstanceOf(AbortSignal)
        return { items: [{ sessionId: "s1", snippet: "hello world" }], hasMore: false }
      },
    }
    const out = await createCapHostInvoke(ctxWith(controller))(SEARCH, "unary", { query: "hello" })
    expect(got).toEqual({ query: "hello" })
    expect(out).toEqual({ items: [{ sessionId: "s1", snippet: "hello world" }], hasMore: false })
  })

  test("search: BAD_PARAMS when query is not a string", async () => {
    const controller = { list: async () => ({ items: [] }), search: async () => ({ items: [] }) }
    await expect(createCapHostInvoke(ctxWith(controller))(SEARCH, "unary", {})).rejects.toThrow("BAD_PARAMS")
  })

  test("search: NOT_WIRED when the host has no search method", async () => {
    const controller = { list: async () => ({ items: [] }) } // no search()
    await expect(createCapHostInvoke(ctxWith(controller))(SEARCH, "unary", { query: "x" })).rejects.toThrow("NOT_WIRED")
  })

  test("fork: forwards {sessionId,atSeq} and returns {sessionId}", async () => {
    let got: unknown
    const controller = {
      list: async () => ({ items: [] }),
      fork: async (request: { sessionId: string; atSeq?: number }) => {
        got = request
        return { sessionId: "forked-1" }
      },
    }
    const out = await createCapHostInvoke(ctxWith(controller))(FORK, "unary", { sessionId: "src", atSeq: 12 })
    expect(got).toEqual({ sessionId: "src", atSeq: 12 })
    expect(out).toEqual({ sessionId: "forked-1" })
  })

  test("fork: BAD_PARAMS when sessionId missing", async () => {
    const controller = { list: async () => ({ items: [] }), fork: async () => ({ sessionId: "x" }) }
    await expect(createCapHostInvoke(ctxWith(controller))(FORK, "unary", {})).rejects.toThrow("BAD_PARAMS")
  })

  test("fork: NOT_WIRED when the host has no fork method", async () => {
    const controller = { list: async () => ({ items: [] }) }
    await expect(createCapHostInvoke(ctxWith(controller))(FORK, "unary", { sessionId: "src" })).rejects.toThrow("NOT_WIRED")
  })
})

describe("025-w1b D — subagents.prompt / interruptByUser hostInvoke", () => {
  const PROMPT = "@deepseek-ai/dsh-subagent#subagents/prompt" as const
  const INTERRUPT = "@deepseek-ai/dsh-subagent#subagents/interruptByUser" as const

  function ctxWithSub(runtime: unknown): BridgeContext {
    return {
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      effect: () => () => {},
      get: (name: string) => (name === "subagents" ? runtime : undefined),
    }
  }

  test("prompt: forwards a validated text-only request, returns {messageId}", async () => {
    let got: any
    const runtime = {
      prompt: async (request: unknown, signal: AbortSignal) => {
        got = { request, signal }
        expect(signal).toBeInstanceOf(AbortSignal)
        return { messageId: "m-1" }
      },
    }
    const out = await createCapHostInvoke(ctxWithSub(runtime))(PROMPT, "unary", {
      requestId: "req-1", childSessionId: "child-1", delivery: "steer", content: [{ type: "text", text: "go on" }],
    })
    expect(got.request).toEqual({
      requestId: "req-1", childSessionId: "child-1", delivery: "steer", content: [{ type: "text", text: "go on" }],
    })
    expect(out).toEqual({ messageId: "m-1" })
  })

  test("prompt: BAD_PARAMS for missing child/content (no host call)", async () => {
    let calls = 0
    const runtime = { prompt: async () => { calls++; return { messageId: "x" } } }
    const invoke = createCapHostInvoke(ctxWithSub(runtime))
    await expect(invoke(PROMPT, "unary", { requestId: "r" })).rejects.toThrow("BAD_PARAMS")
    await expect(invoke(PROMPT, "unary", { requestId: "r", childSessionId: "c", content: [] })).rejects.toThrow("BAD_PARAMS")
    expect(calls).toBe(0)
  })

  test("prompt: NOT_WIRED when the subagents service is absent", async () => {
    await expect(createCapHostInvoke(ctxWithSub(undefined))(PROMPT, "unary", {})).rejects.toThrow("NOT_WIRED")
  })

  test("interruptByUser: forwards childSessionId, returns {accepted}", async () => {
    let got: unknown
    const runtime = { interruptByUser: (child: string) => { got = child; return { accepted: true as const } } }
    const out = await createCapHostInvoke(ctxWithSub(runtime))(INTERRUPT, "unary", { childSessionId: "child-1" })
    expect(got).toBe("child-1")
    expect(out).toEqual({ accepted: true })
  })

  test("interruptByUser: BAD_PARAMS / NOT_WIRED branches", async () => {
    const runtime = { interruptByUser: () => ({ accepted: true as const }) }
    const invoke = createCapHostInvoke(ctxWithSub(runtime))
    await expect(invoke(INTERRUPT, "unary", {})).rejects.toThrow("BAD_PARAMS")
    await expect(createCapHostInvoke(ctxWithSub({}))(INTERRUPT, "unary", { childSessionId: "c" })).rejects.toThrow("NOT_WIRED")
  })
})
