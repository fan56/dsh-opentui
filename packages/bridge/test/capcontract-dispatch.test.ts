/**
 * Resident dataflow test for the generated capcontract call chain (oldfox R4.2).
 *
 * This is the permanent consumer that keeps the generated dispatch/binder code
 * compiled into the shipped bundle (tree-shake can no longer drop it) and gives
 * the static gate a runtime counterpart: the mock hostInvoke exercises the full
 * chain createProjectionBinder -> createCapDispatcher -> lookupCapKind ->
 * injected hostInvoke, including the unknown-id and NOT_WIRED branches.
 */
import { describe, expect, test } from "bun:test"
import { createProjectionBinder, BINDER_METHOD_COUNT } from "../../../capcontract/binder"
import {
  CAP_DISPATCH_TABLE,
  createCapDispatcher,
  lookupCapKind,
  type CapHostInvoke,
} from "../../../capcontract/dispatch"
import type { CapMethodId } from "../../../capcontract/types"
import { createCapHostInvoke } from "../src/index"

const UNARY_ID = "@deepseek-ai/dsh-api-session-controller#session/list" as CapMethodId
const STREAM_ID = "@deepseek-ai/dsh-deepseek-account#account/watch" as CapMethodId
const UNKNOWN_ID = "@deepseek-ai/dsh-nonexistent#probe/ghost" as CapMethodId

describe("capcontract dispatch dataflow (generated binder + injected hostInvoke)", () => {
  test("BINDER_METHOD_COUNT and CAP_DISPATCH_TABLE cover the 257-method CapIR set", () => {
    expect(BINDER_METHOD_COUNT).toBe(257)
    expect(Object.keys(CAP_DISPATCH_TABLE).length).toBe(257)
    expect(CAP_DISPATCH_TABLE[UNARY_ID]).toBe("unary")
    expect(CAP_DISPATCH_TABLE[STREAM_ID]).toBe("stream")
  })

  test("unary: legal id forwards params with kind=unary and returns hostInvoke value", async () => {
    const calls: Array<{ id: string; kind: string; params: unknown }> = []
    const hostInvoke: CapHostInvoke = async (id, kind, params) => {
      calls.push({ id, kind, params })
      return { items: [{ id: "s1" }] }
    }
    const binder = createProjectionBinder(hostInvoke)
    const params = { cursor: "cursor-1" }
    const out = await binder({ methodId: UNARY_ID, params })
    expect(calls).toEqual([{ id: UNARY_ID, kind: "unary", params }])
    expect(out).toEqual({ items: [{ id: "s1" }] })
  })

  test("stream: legal id forwards params with kind=stream", async () => {
    const calls: Array<{ id: string; kind: string; params: unknown }> = []
    const hostInvoke: CapHostInvoke = async (id, kind, params) => {
      calls.push({ id, kind, params })
      return undefined
    }
    const binder = createProjectionBinder(hostInvoke)
    await binder({ methodId: STREAM_ID, params: { since: 0 } })
    expect(calls).toEqual([{ id: STREAM_ID, kind: "stream", params: { since: 0 } }])
  })

  test("unknown id (in binder): rejected before reaching hostInvoke", async () => {
    let reached = false
    const hostInvoke: CapHostInvoke = async () => {
      reached = true
      return undefined
    }
    const binder = createProjectionBinder(hostInvoke)
    await expect(binder({ methodId: UNKNOWN_ID, params: {} })).rejects.toThrow(
      "capcontract: method id not in CapIR set:",
    )
    expect(reached).toBe(false)
  })

  test("unknown id (lookupCapKind): verbatim 'capcontract: unknown method id' error", () => {
    expect(() => lookupCapKind(UNKNOWN_ID)).toThrow("capcontract: unknown method id " + UNKNOWN_ID)
  })

  test("dispatcher delegates to hostInvoke after kind lookup", async () => {
    const seen: Array<[string, string]> = []
    const hostInvoke: CapHostInvoke = async (id, kind) => {
      seen.push([id, kind])
      return id
    }
    const dispatch = createCapDispatcher(hostInvoke)
    expect(await dispatch(UNARY_ID, {})).toBe(UNARY_ID)
    expect(seen).toEqual([[UNARY_ID, "unary"]])
  })

  test("NOT_WIRED: unwired id is rejected explicitly by the bridge host adapter", async () => {
    const hostInvoke = createCapHostInvoke({} as never)
    await expect(hostInvoke(UNKNOWN_ID, "unary", {})).rejects.toThrow("NOT_WIRED:")
  })

  test("NOT_WIRED: wired id with unavailable sessionController fails loudly (no false success)", async () => {
    const hostInvoke = createCapHostInvoke({} as never)
    await expect(hostInvoke(UNARY_ID, "unary", {})).rejects.toThrow("NOT_WIRED:")
  })
})
