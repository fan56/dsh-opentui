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
