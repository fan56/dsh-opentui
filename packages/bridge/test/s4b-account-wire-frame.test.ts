/**
 * S4b (R1) — bridge BINARY frame-level test (helper level -> path level).
 *
 * Spawns a separate OS process (`helpers/account-wire-bridge-host.mjs`) that
 * imports the SHIPPED bridge bundle and speaks the stdio NDJSON protocol over
 * real pipes. A structural `deepseekAccount` stub (injected via ctx.get, the
 * production seam) returns an AccountView carrying a synthetic authorize URL
 * plus link URLs / attempt.id / expiresAt — the sensitive neighbours that
 * key-name stripping alone would let cross a frame.
 *
 * Assertions are on the bytes the parent reads from the child's STDOUT:
 *  - reply.result is the fixed four-field projection (F1–F3);
 *  - the raw auth URL / challenge / state / sentinel / link URLs NEVER appear
 *    in any stdout line (the negative case the review demanded);
 *  - non-view methods reply with bounded shapes only (F4);
 *  - error paths echo only bounded codes, never values (F5);
 *  - existing model wire entry still works through the same process (F6).
 *
 * The synthetic URL is assembled at runtime in the helper; evidence here
 * records only booleans / key names, never the value.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { spawn, type ChildProcess } from "node:child_process"
import { fileURLToPath } from "node:url"

const HELPER = fileURLToPath(new URL("./helpers/account-wire-bridge-host.mjs", import.meta.url))
const SENTINEL = "S4BAUTHURL_SENTINEL_planted_negative"
const CHALLENGE = "s4bChallengeValue0123456789abcdef"
const STATE = "s4bStateValue0123456789abcdef"
// JSON-key probes avoid the `authorizeUrlReady` false positive.
const FORBIDDEN = [
  SENTINEL,
  "code_challenge=",
  "state=",
  '"authorizeUrl":',
  '"authorize_url":',
  "usageUrl",
  "topUpUrl",
  "https://app.invalid/usage",
  "https://app.invalid/top_up",
  "att-s4b-secret-id",
]

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

interface Harness {
  child: ChildProcess
  stdout: string
  send(id: number, method: string, params?: unknown): void
  reply(id: number): Promise<Record<string, any> | undefined>
}

function startHarness(env: Record<string, string> = {}): Harness {
  const child = spawn(process.execPath, [HELPER], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  })
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (c) => { stdout += c })
  child.stderr.on("data", (c) => { stderr += c })

  const send = (id: number, method: string, params: unknown = {}) => {
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  }
  const reply = async (id: number): Promise<Record<string, any> | undefined> => {
    const deadline = Date.now() + 4000
    for (;;) {
      for (const line of stdout.split("\n")) {
        try {
          const f = JSON.parse(line)
          if (f && typeof f === "object" && f.id === id) return f
        } catch { /* non-frame line */ }
      }
      if (Date.now() > deadline) throw new Error(`no reply for id=${id}; stderr=${stderr.slice(0, 300)}`)
      await sleep(5)
    }
  }
  return { child, get stdout() { return stdout }, send, reply }
}

/** Wait until the child has registered its stdin listeners (readiness on stderr). */
async function ready(h: Harness): Promise<void> {
  // The helper writes S4B_READY to stderr right after apply(). Poll child.stderr
  // via the accumulated buffer is private, so use a short fixed settle instead —
  // apply() registers listeners synchronously before the write, and Node pipes
  // buffer early writes, so a single send after this is race-free.
  await sleep(300)
}

function forbiddenHits(stdout: string): string[] {
  return FORBIDDEN.filter((needle) => stdout.includes(needle))
}

const PROJECTED_KEYS = ["attemptPhase", "authorizeUrlReady", "linksPresent", "status"]

describe("S4b account stdio wire — binary frame-level (real process/stdio)", () => {
  let h: Harness
  beforeAll(async () => {
    h = startHarness({ S4B_SENTINEL: SENTINEL, S4B_CHALLENGE: CHALLENGE, S4B_STATE: STATE })
    await ready(h)
  })
  afterAll(() => {
    try { h?.child.kill("SIGTERM") } catch { /* already gone */ }
  })

  test("F1 account.getState reply is the fixed four-field projection; URL never crosses stdout", async () => {
    h.send(1, "account.getState")
    const f = await h.reply(1)
    expect(f?.ok).toBe(true)
    expect(Object.keys(f!.result).sort()).toEqual(PROJECTED_KEYS)
    expect(f!.result).toEqual({
      status: "credential-stored",
      attemptPhase: "waiting-browser",
      authorizeUrlReady: true,
      linksPresent: true,
    })
    expect(forbiddenHits(h.stdout)).toEqual([])
  })

  test("F2 account.startSignIn (waiting-browser) — auth URL negative case", async () => {
    h.send(2, "account.startSignIn", {
      client: { version: "0.24-s4b", locale: "en-US", timezoneOffsetSeconds: 0 },
      callbackOrigin: "https://app.invalid/cb",
      loginSource: "desktop",
    })
    const f = await h.reply(2)
    expect(f?.ok).toBe(true)
    expect(Object.keys(f!.result).sort()).toEqual(PROJECTED_KEYS)
    expect(f!.result.authorizeUrlReady).toBe(true)
    expect(forbiddenHits(h.stdout)).toEqual([])
  })

  test("F3 cancelSignIn / signOut projection carries no URL", async () => {
    const CLIENT = { client: { version: "0.24-s4b", locale: "en-US", timezoneOffsetSeconds: 0 } }
    h.send(3, "account.cancelSignIn", { attemptId: "att-s4b-secret-id" })
    const c = await h.reply(3)
    expect(c?.ok).toBe(true)
    expect(Object.keys(c!.result).sort()).toEqual(PROJECTED_KEYS)
    expect(c!.result.status).toBe("signed-out")
    h.send(4, "account.signOut", CLIENT)
    const s = await h.reply(4)
    expect(s?.ok).toBe(true)
    expect(Object.keys(s!.result).sort()).toEqual(PROJECTED_KEYS)
    expect(forbiddenHits(h.stdout)).toEqual([])
  })

  test("F4 non-view methods reply with bounded shapes (no host text/URL)", async () => {
    const CLIENT = { client: { version: "0.24-s4b", locale: "en-US", timezoneOffsetSeconds: 0 } }
    h.send(5, "account.hasRunningAccountTasks")
    expect((await h.reply(5))!.result).toEqual({ running: true })
    h.send(6, "account.getProfile", CLIENT)
    expect((await h.reply(6))!.result).toEqual({ present: true })
    h.send(7, "account.getBalance", CLIENT)
    expect((await h.reply(7))!.result).toEqual({ present: true })
    h.send(8, "account.getNotifications", CLIENT)
    expect((await h.reply(8))!.result).toEqual({ count: 1 })
    h.send(9, "account.getNotificationContent", { id: "n1", ...CLIENT })
    expect((await h.reply(9))!.result).toEqual({ present: true })
    h.send(10, "account.reportNotificationEvent", { id: "n1", event: "displayed", ...CLIENT })
    expect((await h.reply(10))!.result).toEqual({ ok: true })
    expect(forbiddenHits(h.stdout)).toEqual([])
  })

  test("F5 unknown method is UNSUPPORTED with no echoed value", async () => {
    h.send(11, "account.notAMethod", { secret: SENTINEL })
    const f = await h.reply(11)
    expect(f?.ok).toBe(false)
    expect(f!.error.code).toBe("UNSUPPORTED")
    expect(forbiddenHits(h.stdout)).toEqual([])
  })

  test("F6 existing model wire entry still works through the same process", async () => {
    h.send(12, "model.currentSelection")
    const f = await h.reply(12)
    // modelCatalog host service is absent in this stub -> graceful UNSUPPORTED
    // with NOT_WIRED (never an unhandled crash / unknown-method error). This
    // proves the pre-existing model wire entry is still reached in the same
    // process after adding the account table (no regression, no @manual drift).
    expect(f?.ok).toBe(false)
    expect(f!.error.code).toBe("UNSUPPORTED")
    expect(String(f!.error.message)).toContain("NOT_WIRED")
  })
})

describe("S4b account stdio wire — NOT_WIRED negative (no host service)", () => {
  let h2: Harness
  beforeAll(async () => {
    h2 = startHarness({ S4B_NO_ACCOUNT: "1" })
    await ready(h2)
  })
  afterAll(() => {
    try { h2?.child.kill("SIGTERM") } catch { /* already gone */ }
  })

  test("F5b missing account service -> UNSUPPORTED/NOT_WIRED, never a value echo", async () => {
    h2.send(20, "account.getState")
    const f = await h2.reply(20)
    expect(f?.ok).toBe(false)
    expect(f!.error.code).toBe("UNSUPPORTED")
    expect(String(f!.error.message)).toContain("NOT_WIRED")
    expect(forbiddenHits(h2.stdout)).toEqual([])
  })
})
