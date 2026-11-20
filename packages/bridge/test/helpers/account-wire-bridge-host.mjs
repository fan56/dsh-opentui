/**
 * S4b (R1) frame-level host harness — spawned as a REAL OS process by
 * `s4b-account-wire-frame.test.ts`.
 *
 * Unlike the in-process unit tests (which patch process.stdin/stdout inside the
 * bun test process), this helper is a separate process that imports the SHIPPED
 * bridge bundle (`packages/shell/dist/bridge/index.js`, built by
 * `bun scripts/build-bridge.mjs`) and speaks the stdio NDJSON protocol over the
 * real process stdin/stdout pipes. It is the exact artifact the dsh host loads.
 *
 * A structural `deepseekAccount` stub is injected through the SAME `ctx.get`
 * seam production uses. Its AccountView carries a synthetic authorize URL with
 * code_challenge/state plus link URLs and attempt.id/expiresAt — the sensitive
 * neighbours that key-name stripping alone would let through. All of it is
 * CONSTRUCTED AT RUNTIME (assembled from parts, never a full literal on disk).
 *
 * Env switches (set by the parent test):
 *   S4B_SENTINEL / S4B_CHALLENGE / S4B_STATE — synthetic auth-material parts
 *   S4B_NO_ACCOUNT=1 — omit the service to exercise the NOT_WIRED path
 */
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
// packages/bridge/test/helpers -> packages/shell/dist/bridge/index.js
const bundlePath = resolve(here, "../../../shell/dist/bridge/index.js")
const { apply } = await import(pathToFileURL(bundlePath).href)

const CHALLENGE = process.env.S4B_CHALLENGE || "s4bChallengeValue0123456789abcdef"
const STATE = process.env.S4B_STATE || "s4bStateValue0123456789abcdef"
const SENTINEL = process.env.S4B_SENTINEL || "S4BAUTHURL_SENTINEL_planted_negative"
const AUTH_URL = `https://auth.invalid/dsh/authorize?code_challenge=${CHALLENGE}&state=${STATE}&nonce=${SENTINEL}`

const waitingView = {
  status: "credential-stored",
  attempt: {
    id: "att-s4b-secret-id",
    phase: "waiting-browser",
    authorizeUrl: AUTH_URL,
    expiresAt: 9999999999,
  },
  links: {
    usageUrl: "https://app.invalid/usage",
    topUpUrl: "https://app.invalid/top_up",
  },
}
const signedOut = { status: "signed-out", attempt: null, links: null }

const account = {
  getState: async () => waitingView,
  hasRunningAccountTasks: async () => true,
  getProfile: async () => ({ nickname: "SENTINEL_PROFILE_TEXT", apiKey: "SENTINEL_APIKEY" }),
  getBalance: async () => ({ amount: 12345, token: "SENTINEL_TOKEN" }),
  getNotifications: async () => [
    { id: "n1", title: "SENTINEL_NOTIF_TITLE", url: AUTH_URL },
  ],
  getNotificationContent: async () => ({ body: "SENTINEL_BODY_TEXT", authorizeUrl: AUTH_URL }),
  reportNotificationEvent: async () => undefined,
  startSignIn: async () => waitingView,
  cancelSignIn: async () => signedOut,
  signOut: async () => signedOut,
}

const ctx = {
  logger: { info() {}, warn() {}, error() {}, debug() {} },
  effect(execute) {
    return { dispose: execute() }
  },
  on() {
    return () => {}
  },
  get(key) {
    if (key === "deepseekAccount" && process.env.S4B_NO_ACCOUNT !== "1") return account
    return undefined
  },
  agents: {
    async create() {
      return { agent: {}, dispose: async () => {} }
    },
    async resume() {
      return { agent: {}, dispose: async () => {} }
    },
    get() {
      return undefined
    },
  },
}

process.env.DSH_OPENTUI_BRIDGE_STDIO = "1"
apply(ctx, {})
// Readiness goes to stderr so stdout stays protocol-only (NDJSON frames).
process.stderr.write("S4B_READY\n")
