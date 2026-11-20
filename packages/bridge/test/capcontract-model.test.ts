/**
 * S1 /model — additive unit coverage for the three model W methods wired into
 * createCapHostInvoke. Every case drives the bridge's REAL host adapter with a
 * stub sessionController service (same ctx.get seam used in production); no
 * generated source is copied. Existing assertions are untouched.
 */
import { describe, expect, test } from "bun:test"
import { createCapHostInvoke, CAP_HOST_WIRED_IDS } from "../src/index"
import type { CapMethodId } from "../../../capcontract/types"

const ID = {
  list: "@deepseek-ai/dsh-api-session-controller#session/list",
  catalog: "@deepseek-ai/dsh-api-session-controller#session/modelCatalog",
  select: "@deepseek-ai/dsh-api-session-controller#session/selectModel",
  init: "@deepseek-ai/dsh-api-session-controller#session/initializeDefaultModel",
  unwired: "@deepseek-ai/dsh-api-session-controller#session/create",
} as const

const CATALOG = {
  default: { provider: "p1", model: "m1" },
  routableProviders: ["p1"],
  groups: [{ id: "p1", models: [{ id: "m1", name: "M1" }] }],
  failures: [],
}

function ctxWith(controller: Record<string, unknown> | undefined): never {
  const calls: string[] = []
  const ctx = {
    get: (key: string) => (key === "sessionController" ? controller : undefined),
    __calls: calls,
  }
  return ctx as never
}

function stubController(): Record<string, unknown> {
  return {
    list: async () => ({ items: [] }),
    modelCatalog: async () => CATALOG,
    selectModel: async (r: Record<string, unknown>) => ({
      selected: { provider: r.provider, model: r.model },
    }),
    initializeDefaultModel: async () => undefined,
  }
}

describe("S1 /model — createCapHostInvoke model arms", () => {
  // S2 note: this count snapshot is slice-local (not a frozen base assertion).
  // Old criterion (verbatim): `expect(CAP_HOST_WIRED_IDS).toEqual([ID.list, ID.catalog, ID.select, ID.init])`
  // and `expect(new Set(CAP_HOST_WIRED_IDS).size).toBe(4)`. S2 expands the registry
  // to 19 (4 S1 + 12 account + 3 credentials); kept strict via exact 19-id equality.
  test("CAP_HOST_WIRED_IDS = 19 (S1 4 + S2 15), no duplicates", () => {
    expect(CAP_HOST_WIRED_IDS).toEqual([
      ID.list, ID.catalog, ID.select, ID.init,
      "@deepseek-ai/dsh-deepseek-account#account/cancelSignIn",
      "@deepseek-ai/dsh-deepseek-account#account/getBalance",
      "@deepseek-ai/dsh-deepseek-account#account/getNotificationContent",
      "@deepseek-ai/dsh-deepseek-account#account/getNotifications",
      "@deepseek-ai/dsh-deepseek-account#account/getProfile",
      "@deepseek-ai/dsh-deepseek-account#account/getState",
      "@deepseek-ai/dsh-deepseek-account#account/hasRunningAccountTasks",
      "@deepseek-ai/dsh-deepseek-account#account/reportNotificationEvent",
      "@deepseek-ai/dsh-deepseek-account#account/signOut",
      "@deepseek-ai/dsh-deepseek-account#account/startSignIn",
      "@deepseek-ai/dsh-deepseek-account#account/watch",
      "@deepseek-ai/dsh-deepseek-account#account/watchExpiry",
      "@deepseek-ai/dsh-api-settings-controller#credentials/describe",
      "@deepseek-ai/dsh-api-settings-controller#credentials/set",
      "@deepseek-ai/dsh-api-settings-controller#credentials/unset",
    ])
    expect(new Set(CAP_HOST_WIRED_IDS).size).toBe(19)
  })

  test("modelCatalog returns the host catalog verbatim", async () => {
    const invoke = createCapHostInvoke(ctxWith(stubController()))
    expect(await invoke(ID.catalog as CapMethodId, "unary", {})).toEqual(CATALOG)
  })

  test("selectModel forwards a validated request and returns the host selection", async () => {
    const seen: Record<string, unknown>[] = []
    const controller = {
      ...stubController(),
      selectModel: async (r: Record<string, unknown>) => {
        seen.push(r)
        return { selected: { provider: r.provider, model: r.model } }
      },
    }
    const invoke = createCapHostInvoke(ctxWith(controller))
    const out = await invoke(ID.select as CapMethodId, "unary", {
      sessionId: "s-1",
      provider: "p2",
      model: "m2",
      reasoningEffort: "high",
    })
    expect(seen).toEqual([{ sessionId: "s-1", provider: "p2", model: "m2", reasoningEffort: "high" }])
    expect(out).toEqual({ selected: { provider: "p2", model: "m2" } })
  })

  test("selectModel rejects BAD_PARAMS for a missing/empty field (no host call)", async () => {
    let reached = false
    const controller = {
      ...stubController(),
      selectModel: async () => { reached = true; return {} },
    }
    const invoke = createCapHostInvoke(ctxWith(controller))
    for (const params of [{ provider: "p", model: "m" }, { sessionId: "s", model: "m" }, { sessionId: "s", provider: "p", model: "" }]) {
      await expect(invoke(ID.select as CapMethodId, "unary", params)).rejects.toThrow("BAD_PARAMS:")
    }
    expect(reached).toBe(false)
  })

  test("initializeDefaultModel resolves void through the host service", async () => {
    const invoke = createCapHostInvoke(ctxWith(stubController()))
    await expect(invoke(ID.init as CapMethodId, "unary", {})).resolves.toBeUndefined()
  })

  test("wired model id with no sessionController -> NOT_WIRED (no false success)", async () => {
    const invoke = createCapHostInvoke(ctxWith(undefined))
    for (const id of [ID.catalog, ID.select, ID.init]) {
      await expect(invoke(id as CapMethodId, "unary", {})).rejects.toThrow("NOT_WIRED:")
    }
  })

  test("non-wired CapIR id stays NOT_WIRED (膨胀期望面 negative)", async () => {
    // Old criterion (verbatim): /NOT_WIRED:.*ledger in_wired=4\/257/. S2: 19/257.
    const invoke = createCapHostInvoke(ctxWith(stubController()))
    await expect(invoke(ID.unwired as CapMethodId, "unary", {})).rejects.toThrow(
      /NOT_WIRED:.*ledger in_wired=19\/257/,
    )
  })
})
