/**
 * S4 PKCE/stream — auth-URL desensitization + four-piece-set stream lifecycle.
 *
 * Every case drives the bridge's REAL exported helpers / host adapter with a
 * structural stub account service through the same ctx.get seam used in prod.
 * No generated source is copied, no existing assertion is touched.
 *
 * The synthetic AUTH_URL below is a plausible authorize URL carrying
 * code_challenge/state. It is CONSTRUCTED AT RUNTIME (never written to a file):
 * the leak control records only booleans, so the evidence package stays clean.
 */
import { describe, expect, test } from "bun:test"
import {
  ACCOUNT_WATCH_RELAY_METHOD_IDS,
  CAP_HOST_WIRED_IDS,
  classifyPushErrorCode,
  createAccountWatchRelay,
  createCapHostInvoke,
  probeOwnedAbortRelease,
  projectAccountViewForFrame,
  sanitizeFrameForWire,
} from "../src/index.ts"
import type { CapMethodId } from "../../../capcontract/types"

const CHALLENGE = "syntheticChallengeValue0123456789abcdef"
const STATE = "syntheticStateValue0123456789abcdef"
const SENTINEL = "DSHS4AUTHURL_SENTINEL_planted_negative_control"
const AUTH_URL = `https://auth.invalid/dsh/authorize?code_challenge=${CHALLENGE}&state=${STATE}&redirect_uri=https%3A%2F%2Fapp.invalid%2Foauth%2Fcallback`

const ID = {
  start: "@deepseek-ai/dsh-deepseek-account#account/startSignIn",
  cancel: "@deepseek-ai/dsh-deepseek-account#account/cancelSignIn",
  signOut: "@deepseek-ai/dsh-deepseek-account#account/signOut",
  state: "@deepseek-ai/dsh-deepseek-account#account/getState",
  watch: "@deepseek-ai/dsh-deepseek-account#account/watch",
  watchExpiry: "@deepseek-ai/dsh-deepseek-account#account/watchExpiry",
  unwired: "@deepseek-ai/dsh-cordis-host-runner#dynamicCordisRunner/resolveInspectQuery",
} as const

const CLIENT = { version: "0.24-s4-probe", locale: "en-US", timezoneOffsetSeconds: 0 }
// Use JSON value keys (`"authorizeUrl":`) rather than the bare word so the
// allowed boolean `authorizeUrlReady` field is not a false positive.
const AUTH_HITS = [SENTINEL, "code_challenge=", "state=", '"authorizeUrl":', '"authorize_url":']

/** Count how many forbidden auth strings appear in a serialized string. */
const hitCount = (s: string): number => AUTH_HITS.reduce((n, needle) => n + (s.includes(needle) ? 1 : 0), 0)

function waitingBrowserView() {
  return {
    status: "credential-stored",
    attempt: { id: "att-s4", phase: "waiting-browser", authorizeUrl: `${AUTH_URL}&nonce=${SENTINEL}`, expiresAt: 1 },
    links: { usageUrl: "https://app.invalid/usage", topUpUrl: "https://app.invalid/top_up" },
  }
}

function ctxWith(account: Record<string, unknown> | undefined): never {
  return {
    get: (key: string) => (key === "deepseekAccount" ? account : undefined),
  } as never
}

function accountWithLogin(): Record<string, unknown> {
  return {
    startSignIn: async () => waitingBrowserView(),
    cancelSignIn: async () => ({ status: "signed-out", attempt: { id: "att-s4", phase: "cancelled" } }),
    signOut: async () => ({ status: "signed-out", attempt: null }),
    getState: async () => waitingBrowserView(),
    watchState: () => ({
      async *[Symbol.asyncIterator]() {
        yield { type: "snapshot", state: waitingBrowserView() }
        yield { type: "credentials-changed", state: { status: "signed-out", attempt: null } }
      },
    }),
    watchExpiry: () => ({
      async *[Symbol.asyncIterator]() { yield "session-expired" },
    }),
  }
}

describe("S4 / E1 — PKCE/auth id registry + one-hand service seam", () => {
  // Old criterion (verbatim): "registry count stays 24". 025-w1b adds
  // session/search + session/fork → 26; the six PKCE ids stay wired unchanged.
  test("all six PKCE/auth ids stay wired; registry count stays 28", () => {
    for (const id of [ID.start, ID.cancel, ID.signOut, ID.state, ID.watch, ID.watchExpiry]) {
      expect(CAP_HOST_WIRED_IDS).toContain(id)
    }
    expect(CAP_HOST_WIRED_IDS.length).toBe(28)
    expect(new Set(CAP_HOST_WIRED_IDS).size).toBe(28)
  })

  test("host adapter reads the verified `deepseekAccount` ctx.get key", async () => {
    let askedKey: string | undefined
    const ctx = {
      get: (key: string) => { askedKey = key; return accountWithLogin() },
    } as never
    const invoke = createCapHostInvoke(ctx)
    await invoke(ID.state as CapMethodId, "unary", {})
    expect(askedKey).toBe("deepseekAccount")
  })
})

describe("S4 / E2 — PKCE projection + pre/post leak control", () => {
  test("PRE-CHANGE: raw host view leaks the authorize URL (negative baseline)", () => {
    const raw = JSON.stringify(waitingBrowserView())
    expect(hitCount(raw)).toBeGreaterThan(0)
    expect(raw.includes(SENTINEL)).toBe(true)
    expect(raw.includes("code_challenge=")).toBe(true)
  })

  test("POST-CHANGE: projection is a fixed bounded shape with zero auth-value hits", () => {
    const projected = projectAccountViewForFrame(waitingBrowserView())
    expect(Object.keys(projected).sort()).toEqual([
      "attemptPhase", "authorizeUrlReady", "linksPresent", "status",
    ])
    expect(projected.status).toBe("credential-stored")
    expect(projected.attemptPhase).toBe("waiting-browser")
    expect(projected.authorizeUrlReady).toBe(true)
    expect(hitCount(JSON.stringify(projected))).toBe(0)
  })

  test("PKCE stages: start -> project -> cancel -> project, no URL at any stage", async () => {
    const invoke = createCapHostInvoke(ctxWith(accountWithLogin()))
    const started = await invoke(ID.start as CapMethodId, "unary", { client: CLIENT, callbackOrigin: "http://127.0.0.1:12345", loginSource: "desktop" })
    expect(projectAccountViewForFrame(started).attemptPhase).toBe("waiting-browser")
    expect(hitCount(JSON.stringify(projectAccountViewForFrame(started)))).toBe(0)
    const cancelled = await invoke(ID.cancel as CapMethodId, "unary", { attemptId: "att-s4" })
    expect(projectAccountViewForFrame(cancelled).attemptPhase).toBe("cancelled")
    expect(projectAccountViewForFrame(cancelled).authorizeUrlReady).toBe(false)
    expect(hitCount(JSON.stringify(projectAccountViewForFrame(cancelled)))).toBe(0)
  })
})

describe("S4 / E3 — four-layer auth-URL ban", () => {
  test("WIRE layer: writeFrame's central guard strips auth keys even from a raw result", () => {
    const frame = { id: 7, ok: true, result: waitingBrowserView() }
    expect(hitCount(JSON.stringify(frame))).toBeGreaterThan(0) // pre-guard
    const safe = JSON.stringify(sanitizeFrameForWire(frame))
    expect(hitCount(safe)).toBe(0)
    expect(safe.includes('"authorizeUrl":')).toBe(false)
    expect(JSON.parse(safe).result).toEqual({ status: "credential-stored", attempt: { id: "att-s4", phase: "waiting-browser", expiresAt: 1 }, links: (waitingBrowserView() as { links: unknown }).links })
  })

  test("EMIT layer: relay cap.event payloads are a fixed four-field whitelist, zero auth hits", async () => {
    const emitted: Array<{ type: string; payload: Record<string, unknown> }> = []
    const relay = createAccountWatchRelay({
      invoke: async () => ({
        async *[Symbol.asyncIterator]() {
          yield { type: "snapshot", state: waitingBrowserView() } // carries AUTH_URL
          yield { type: "credentials-changed", state: { status: "signed-out" } }
        },
      }),
      emit: (type, payload) => { emitted.push({ type, payload }) },
    })
    relay.start("sess-s4-emit")
    for (let i = 0; i < 10 && relay.activeCount() > 0; i++) await new Promise((r) => setTimeout(r, 0))
    const events = emitted.filter((e) => e.type === "cap.event")
    expect(events.length).toBe(4) // both methods, 2 items each
    for (const e of events) {
      expect(Object.keys(e.payload).sort()).toEqual(["eventType", "methodId", "seq", "sessionId"])
    }
    expect(hitCount(JSON.stringify(emitted))).toBe(0)
  })

  test("LOG layer: classifyPushErrorCode degrades to a bounded enum, never an error body", () => {
    expect(classifyPushErrorCode(new Error(`NOT_WIRED: ${AUTH_URL}`))).toBe("NOT_WIRED")
    expect(classifyPushErrorCode(new Error(`HOST_ERROR: ${SENTINEL}`))).toBe("HOST_ERROR")
    expect(classifyPushErrorCode("anything else")).toBe("HOST_ERROR")
  })
})

describe("S4 / E4 — stream four-piece-set", () => {
  test("(a) owned controller released on return; caller signal never aborted by us", async () => {
    expect(await probeOwnedAbortRelease()).toBe(true)
    let seenSignal: AbortSignal | undefined
    const invoke = createCapHostInvoke(ctxWith({
      watch: (signal: AbortSignal) => {
        seenSignal = signal
        return { async *[Symbol.asyncIterator]() { yield { type: "snapshot" } } }
      },
    }))
    const ac = new AbortController()
    const iterable = await invoke(ID.watch as CapMethodId, "stream", { signal: ac.signal })
    const it = (iterable as AsyncIterable<unknown>)[Symbol.asyncIterator]()
    await it.next()
    await it.return?.(undefined)
    expect(seenSignal).toBe(ac.signal)
    expect(ac.signal.aborted).toBe(false)
  })

  test("(b) BAD_KIND for stream id via unary; NOT_WIRED for missing host method", async () => {
    const invoke = createCapHostInvoke(ctxWith(accountWithLogin()))
    await expect(invoke(ID.watch as CapMethodId, "unary", {})).rejects.toThrow("BAD_KIND:")
    const bare = createCapHostInvoke(ctxWith({ getState: async () => ({}) }))
    await expect(bare(ID.watch as CapMethodId, "stream", {})).rejects.toThrow("NOT_WIRED: deepseekAccount.watch unavailable")
  })

  test("(c) cap.end carries only a bounded code; (d) each subscription seq starts at 1", async () => {
    const emitted: Array<{ type: string; payload: Record<string, unknown> }> = []
    const relay = createAccountWatchRelay({
      invoke: async ({ methodId }) => {
        if (String(methodId).endsWith("/watchExpiry")) throw new Error(`NOT_WIRED: ${AUTH_URL}`)
        return { async *[Symbol.asyncIterator]() { yield { type: "snapshot" } } }
      },
      emit: (type, payload) => { emitted.push({ type, payload }) },
    })
    relay.start("sess-s4-four")
    for (let i = 0; i < 10 && relay.activeCount() > 0; i++) await new Promise((r) => setTimeout(r, 0))
    const ends = emitted.filter((e) => e.type === "cap.end")
    expect(ends.length).toBe(2)
    for (const e of ends) {
      const keys = Object.keys(e.payload).sort()
      // Natural end has no code; error end carries one bounded code (C-1).
      expect(keys).toEqual(
        e.payload.reason === "unavailable"
          ? ["code", "methodId", "reason", "sessionId"]
          : ["methodId", "reason", "sessionId"],
      )
      if (e.payload.reason === "unavailable") {
        expect(["NOT_WIRED", "BAD_PARAMS", "BAD_KIND", "HOST_ERROR"]).toContain(e.payload.code)
      }
    }
    expect(ends.some((e) => e.payload.code === "NOT_WIRED")).toBe(true)
    expect(hitCount(JSON.stringify(ends))).toBe(0)
    const watchSeqs = emitted.filter((e) => e.type === "cap.event" && String(e.payload.methodId).endsWith("/watch")).map((e) => e.payload.seq)
    expect(watchSeqs).toEqual([1])
    expect(ACCOUNT_WATCH_RELAY_METHOD_IDS.length).toBe(2)
  })

  test("explicit stop releases both subscriptions; re-start is idempotent and resets seq", async () => {
    const relay = createAccountWatchRelay({
      invoke: async () => ({ async *[Symbol.asyncIterator]() { await new Promise(() => { /* parked */ }) } }),
      emit: () => {},
    })
    relay.start("sess-s4-stop")
    await new Promise((r) => setTimeout(r, 0))
    expect(relay.activeCount()).toBe(2)
    relay.start("sess-s4-stop") // idempotent
    expect(relay.activeCount()).toBe(2)
    relay.stop("sess-s4-stop")
    expect(relay.activeCount()).toBe(0)
    relay.stopAll()
    expect(relay.activeCount()).toBe(0)
  })
})

describe("S4 / E6 — negative controls", () => {
  test("BAD_PARAMS never reaches the host for malformed startSignIn client/origin", async () => {
    let reached = false
    const account = { ...accountWithLogin(), startSignIn: async () => { reached = true; return waitingBrowserView() } }
    const invoke = createCapHostInvoke(ctxWith(account))
    await expect(invoke(ID.start as CapMethodId, "unary", {})).rejects.toThrow("BAD_PARAMS:")
    await expect(invoke(ID.start as CapMethodId, "unary", { client: CLIENT, callbackOrigin: "" })).rejects.toThrow("BAD_PARAMS:")
    await expect(invoke(ID.start as CapMethodId, "unary", { client: CLIENT, callbackOrigin: "http://localhost", loginSource: "kiosk" })).rejects.toThrow("BAD_PARAMS:")
    expect(reached).toBe(false)
  })

  test("NOT_WIRED for absent account service and for an unwired CapIR id", async () => {
    const absent = createCapHostInvoke(ctxWith(undefined))
    await expect(absent(ID.start as CapMethodId, "unary", { client: CLIENT, callbackOrigin: "http://localhost", loginSource: "desktop" })).rejects.toThrow("NOT_WIRED: deepseekAccount unavailable")
    const invoke = createCapHostInvoke(ctxWith(accountWithLogin()))
    // W2-1 round log — OLD W2-0 base criterion kept VERBATIM (do not delete):
    //   /NOT_WIRED:.*ledger in_wired=28\/257/
    // W2-1 releases 3 generic ids -> union count 28 + 3 = 31.
    // W2-2 round log — OLD W2-1 criterion kept VERBATIM (do not delete):
    //   /NOT_WIRED:.*ledger in_wired=31\/257/
    // W2-2 releases 7 pluginManager read ids -> union count 28 + 10 = 38.
    // W2-3 round log — OLD W2-2 criterion kept VERBATIM (do not delete):
    //   /NOT_WIRED:.*ledger in_wired=38\/257/
    // W2-3 releases 8 pluginManager write ids -> union count 28 + 18 = 46.
    // W2-4 round log — OLD W2-3 criterion kept VERBATIM (do not delete):
    //   /NOT_WIRED:.*ledger in_wired=46\/257/
    // W2-4 releases 5 directory ids -> union count 28 + 23 = 51.
    await expect(invoke(ID.unwired as CapMethodId, "unary", {})).rejects.toThrow(/NOT_WIRED:.*ledger in_wired=51\/257/)
  })

  test("bad signal param -> BAD_PARAMS (never reaches host stream)", async () => {
    const invoke = createCapHostInvoke(ctxWith(accountWithLogin()))
    await expect(invoke(ID.watchExpiry as CapMethodId, "stream", { signal: "not-a-signal" })).rejects.toThrow("BAD_PARAMS:")
  })
})
