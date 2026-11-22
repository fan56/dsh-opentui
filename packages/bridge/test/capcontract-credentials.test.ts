/**
 * S2 credentials/account — unit coverage for the 15 new ids in
 * createCapHostInvoke. Every case drives the bridge's REAL host adapter with a
 * structural stub service through the same ctx.get seam used in production.
 * No generated source is copied; existing assertions are untouched.
 *
 * DESENSITIZATION: the credentials/set stub records the ref + value length but
 * NEVER the value; a case asserts no logging seam receives the value.
 */
import { describe, expect, test } from "bun:test"
import { createCapHostInvoke, CAP_HOST_WIRED_IDS } from "../src/index"
import type { CapMethodId } from "../../../capcontract/types"

const ID = {
  state: "@deepseek-ai/dsh-deepseek-account#account/getState",
  tasks: "@deepseek-ai/dsh-deepseek-account#account/hasRunningAccountTasks",
  profile: "@deepseek-ai/dsh-deepseek-account#account/getProfile",
  watch: "@deepseek-ai/dsh-deepseek-account#account/watch",
  watchExpiry: "@deepseek-ai/dsh-deepseek-account#account/watchExpiry",
  signOut: "@deepseek-ai/dsh-deepseek-account#account/signOut",
  desc: "@deepseek-ai/dsh-api-settings-controller#credentials/describe",
  set: "@deepseek-ai/dsh-api-settings-controller#credentials/set",
  unset: "@deepseek-ai/dsh-api-settings-controller#credentials/unset",
  // W2-1 round log — OLD unwired sentinel was session/create (verbatim):
  //   unwired: "@deepseek-ai/dsh-api-session-controller#session/create",
  // W2-1 releases session/create into the generic set; use a genuinely un-wired
  // CapIR id for the NOT_WIRED negative test.
  unwired: "@deepseek-ai/dsh-cordis-host-runner#dynamicCordisRunner/resolveInspectQuery",
} as const

const CLIENT = { version: "0.24-probe", locale: "en-US", timezoneOffsetSeconds: 0 }

/** ctx stub exposing deepseekAccount / credentialsController via ctx.get. */
function ctxWith(services: { account?: Record<string, unknown>; creds?: Record<string, unknown> }): never {
  return {
    get: (key: string) => {
      if (key === "deepseekAccount") return services.account
      if (key === "credentialsController") return services.creds
      return undefined
    },
  } as never
}

function stubAccount(): Record<string, unknown> {
  return {
    getState: async () => ({ status: "signed-out", links: { usageUrl: "u" } }),
    hasRunningAccountTasks: () => false,
    getProfile: async (client: unknown) => ({ client, profile: null }),
    watchState: (_signal: AbortSignal) => ({
      async *[Symbol.asyncIterator]() { yield { type: "snapshot", state: { status: "signed-out" } } },
    }),
    watchExpiry: (_signal: AbortSignal) => ({
      async *[Symbol.asyncIterator]() { /* no expiry events */ },
    }),
    signOut: async () => ({ status: "signed-out" }),
  }
}

/** In-memory stub of the credentialsController @Remote surface — DATAFLOW. */
function stubCreds() {
  const store = new Map<string, string>()
  const logged: string[] = []
  return {
    logged,
    describe: async (refs: string[]) => Object.fromEntries(refs.map((r) => [r, { present: store.has(r) }])),
    set: async (ref: string, value: string) => { store.set(ref, value); logged.push(`set:${ref}:len${value.length}`) },
    unset: async (ref: string) => { store.delete(ref); logged.push(`unset:${ref}`) },
  }
}

// Slice-local snapshot. Old criterion (verbatim): 19 ids
// (session/list + 3 model + 12 account + 3 credentials). S3 adds 3 push streams,
// S5 adds 2 settings, 025-w1b adds 2 session query ids (search/fork) → 26.
describe("S2/S3 — CAP_HOST_WIRED_IDS registry = 28", () => {
  test("28 unique ids (session/list + 3 model + 12 account + 3 credentials + 3 push + 2 settings + 2 w1b query)", () => {
    expect(CAP_HOST_WIRED_IDS.length).toBe(28)
    expect(new Set(CAP_HOST_WIRED_IDS).size).toBe(28)
    for (const id of [ID.state, ID.watch, ID.watchExpiry, ID.desc, ID.set, ID.unset]) {
      expect(CAP_HOST_WIRED_IDS).toContain(id)
    }
    for (const id of [
      "@deepseek-ai/dsh-api-session-controller#session/observeEvent",
      "@deepseek-ai/dsh-api-session-controller#session/observeState",
      "@deepseek-ai/dsh-api-session-controller#session/observeProjections",
    ]) {
      expect(CAP_HOST_WIRED_IDS).toContain(id)
    }
  })
})

describe("S2 — account unary arms", () => {
  test("getState returns the host view verbatim", async () => {
    const invoke = createCapHostInvoke(ctxWith({ account: stubAccount() }))
    expect(await invoke(ID.state as CapMethodId, "unary", {})).toEqual({ status: "signed-out", links: { usageUrl: "u" } })
  })

  test("hasRunningAccountTasks returns boolean", async () => {
    const invoke = createCapHostInvoke(ctxWith({ account: stubAccount() }))
    expect(await invoke(ID.tasks as CapMethodId, "unary", {})).toBe(false)
  })

  test("getProfile forwards validated client metadata", async () => {
    const invoke = createCapHostInvoke(ctxWith({ account: stubAccount() }))
    const out = await invoke(ID.profile as CapMethodId, "unary", { client: CLIENT }) as { client: unknown }
    expect(out.client).toEqual(CLIENT)
  })

  test("bad/missing client metadata -> BAD_PARAMS, no host call", async () => {
    let reached = false
    const account = { ...stubAccount(), getProfile: async () => { reached = true; return null } }
    const invoke = createCapHostInvoke(ctxWith({ account }))
    await expect(invoke(ID.profile as CapMethodId, "unary", {})).rejects.toThrow("BAD_PARAMS:")
    await expect(invoke(ID.profile as CapMethodId, "unary", { client: { version: 1 } })).rejects.toThrow("BAD_PARAMS:")
    expect(reached).toBe(false)
  })

  test("wired account id with no deepseekAccount service -> NOT_WIRED", async () => {
    const invoke = createCapHostInvoke(ctxWith({}))
    await expect(invoke(ID.state as CapMethodId, "unary", {})).rejects.toThrow("NOT_WIRED: deepseekAccount unavailable")
  })
})

describe("S2 — account stream arms (kind table)", () => {
  test("watch with kind=stream returns an AsyncIterable; first item is snapshot", async () => {
    const invoke = createCapHostInvoke(ctxWith({ account: stubAccount() }))
    const ac = new AbortController()
    const val = await invoke(ID.watch as CapMethodId, "stream", { signal: ac.signal })
    expect(typeof (val as AsyncIterable<unknown>)[Symbol.asyncIterator]).toBe("function")
    const it = (val as AsyncIterable<{ type: string }>)[Symbol.asyncIterator]()
    expect((await it.next()).value?.type).toBe("snapshot")
    ac.abort()
  })

  test("watchExpiry stream returns an AsyncIterable (no events in stub)", async () => {
    const invoke = createCapHostInvoke(ctxWith({ account: stubAccount() }))
    const val = await invoke(ID.watchExpiry as CapMethodId, "stream", {})
    expect(typeof (val as AsyncIterable<unknown>)[Symbol.asyncIterator]).toBe("function")
  })

  test("stream id with kind=unary -> BAD_KIND (kind table enforced)", async () => {
    const invoke = createCapHostInvoke(ctxWith({ account: stubAccount() }))
    await expect(invoke(ID.watch as CapMethodId, "unary", {})).rejects.toThrow("BAD_KIND:")
  })

  test("bad signal param -> BAD_PARAMS", async () => {
    const invoke = createCapHostInvoke(ctxWith({ account: stubAccount() }))
    await expect(invoke(ID.watch as CapMethodId, "stream", { signal: "not-a-signal" })).rejects.toThrow("BAD_PARAMS:")
  })

  test("stream id with missing host method -> NOT_WIRED (no silent empty stream)", async () => {
    const invoke = createCapHostInvoke(ctxWith({ account: { getState: async () => ({}) } }))
    await expect(invoke(ID.watch as CapMethodId, "stream", {})).rejects.toThrow("NOT_WIRED: deepseekAccount.watch unavailable")
  })
})

describe("S2 — credentials arms + DATAFLOW + desensitization", () => {
  test("set -> describe(present:true) -> unset -> describe(present:false) DATAFLOW", async () => {
    const creds = stubCreds()
    const invoke = createCapHostInvoke(ctxWith({ creds }))
    const ref = "dsh_s2_probe_ref"
    const sentinel = "DSHS2CRED_SENTINEL_unit_probe"
    await invoke(ID.desc as CapMethodId, "unary", { refs: [ref] })
    const before = await invoke(ID.desc as CapMethodId, "unary", { refs: [ref] }) as Record<string, { present: boolean }>
    expect(before[ref].present).toBe(false)
    await invoke(ID.set as CapMethodId, "unary", { ref, value: sentinel })
    const afterSet = await invoke(ID.desc as CapMethodId, "unary", { refs: [ref] }) as Record<string, { present: boolean }>
    expect(afterSet[ref].present).toBe(true)
    await invoke(ID.unset as CapMethodId, "unary", { ref })
    const afterUnset = await invoke(ID.desc as CapMethodId, "unary", { refs: [ref] }) as Record<string, { present: boolean }>
    expect(afterUnset[ref].present).toBe(false)
  })

  test("credentials/set log seam carries ref + length but NEVER the value", () => {
    const creds = stubCreds()
    creds.set("probe_ref", "TOP_SECRET_SENTINEL_VALUE") as unknown
    // The stub's log line is 'set:probe_ref:len23' — the value string is absent.
    expect(creds.logged.some((l) => l.includes("TOP_SECRET"))).toBe(false)
    expect(creds.logged.some((l) => l.startsWith("set:probe_ref:len"))).toBe(true)
  })

  test("credentials/set BAD_PARAMS (bad ref grammar / empty value) never reaches host", async () => {
    let reached = false
    const creds = { ...stubCreds(), set: async () => { reached = true } }
    const invoke = createCapHostInvoke(ctxWith({ creds }))
    await expect(invoke(ID.set as CapMethodId, "unary", { ref: "bad-ref!", value: "x" })).rejects.toThrow("BAD_PARAMS:")
    await expect(invoke(ID.set as CapMethodId, "unary", { ref: "good_ref", value: "" })).rejects.toThrow("BAD_PARAMS:")
    expect(reached).toBe(false)
  })

  test("wired credentials id with no service -> NOT_WIRED", async () => {
    const invoke = createCapHostInvoke(ctxWith({}))
    await expect(invoke(ID.set as CapMethodId, "unary", { ref: "r", value: "v" })).rejects.toThrow("NOT_WIRED: credentialsController unavailable")
  })
})

describe("S2/S3 — negative control", () => {
  // Old criterion (verbatim): /NOT_WIRED:.*ledger in_wired=19\/257/. S3: 22/257; S5: 24/257; 025-w1b: 28/257.
  // W2-1 round log — OLD W2-0 base criterion kept VERBATIM (do not delete):
  //   /NOT_WIRED:.*ledger in_wired=28\/257/
  // W2-1 releases 3 generic ids -> union count 28 + 3 = 31. Test name keeps the
  // old count for the round log; assertion checks the new union count.
  // W2-2 round log — OLD W2-1 criterion kept VERBATIM (do not delete):
  //   /NOT_WIRED:.*ledger in_wired=31\/257/
    // W2-2 releases 7 pluginManager read ids -> union count 28 + 10 = 38.
  // W2-3 round log — OLD W2-2 criterion kept VERBATIM (do not delete):
  //   /NOT_WIRED:.*ledger in_wired=38\/257/
  // W2-3 releases 8 pluginManager write ids -> union count 28 + 18 = 46.
  // W2-4 round log — OLD W2-3 criterion kept VERBATIM (do not delete):
  //   /NOT_WIRED:.*ledger in_wired=46\/257/
  // W2-4 releases 5 directory ids -> union count 28 + 23 = 51.
  // W2-5 round log — OLD W2-4 criterion kept VERBATIM (do not delete):
  //   /NOT_WIRED:.*ledger in_wired=51\/257/
  // W2-5 releases 7 goals ids -> union count 28 + 30 = 58.
  // 026 round log — OLD W2-5 criterion kept VERBATIM (do not delete):
  //   /NOT_WIRED:.*ledger in_wired=58\/257/
  // 026 releases 1 commands id -> union count 28 + 31 = 59.
  test("non-wired CapIR id stays NOT_WIRED with ledger in_wired=28/257", async () => {
    const invoke = createCapHostInvoke(ctxWith({ account: stubAccount(), creds: stubCreds() }))
    await expect(invoke(ID.unwired as CapMethodId, "unary", {})).rejects.toThrow(
      /NOT_WIRED:.*ledger in_wired=59\/257/,
    )
  })
})
