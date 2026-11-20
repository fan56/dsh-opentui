#!/usr/bin/env bun
/**
 * Headless proof for the 024 base task 4 startup handshake (V2 evidence).
 *
 *   bun scripts/verify-capability-handshake.ts
 *
 * Drives the real `startCapabilityHandshake()` with a fake cordis ctx (no host
 * package, no dsh install). Prints every state transition as raw log lines and
 * asserts: PENDING → READY on a stable expected surface; no degradation during
 * PENDING; inflated expected surface degrades only after stability (READY
 * semantics, L41); empty-at-timeout degrades with the registration-timeout
 * subclass; extra-outside-expected never degrades; six I-class probes run.
 */
import ledger from "../ledger/ledger.json"
import {
  attachHandshake,
  getHandshake,
  startCapabilityHandshake,
  type HandshakeDeps,
  type HandshakeSnapshot,
} from "../packages/bridge/src/handshake"

const EXPECTED: string[] = [...ledger.dimensions.expected.method_ids]
const I_KEYS: string[] = ledger.dimensions.i_class.services.map((s) => s.key)
const lines: string[] = []
const logger = {
  info(...args: unknown[]) {
    lines.push("INFO  " + args.map(String).join(" "))
  },
  warn(...args: unknown[]) {
    lines.push("WARN  " + args.map(String).join(" "))
  },
}

let failures = 0
function assert(cond: boolean, label: string, detail = ""): void {
  if (cond) console.log(`PASS  ${label}${detail ? " — " + detail : ""}`)
  else {
    failures++
    console.log(`FAIL  ${label}${detail ? " — " + detail : ""}`)
  }
}

function makeDeps(listImpl: () => string[], present: ReadonlySet<string> = new Set(I_KEYS)): HandshakeDeps {
  return {
    ctx: { typert: { local: { list: () => listImpl().map((id) => ({ id })) } } },
    get: (name: string) => (present.has(name) ? {} : undefined),
    logger,
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function case1_ready(): Promise<void> {
  lines.length = 0
  let surface: string[] = []
  const h = startCapabilityHandshake(makeDeps(() => surface), {
    timeoutMs: 2000,
    pollIntervalMs: 40,
    stabilitySamples: 2,
  })
  assert(h.snapshot.state === "PENDING", "case1: state is PENDING at start")
  await sleep(60)
  assert(h.snapshot.state === "PENDING", "case1: still PENDING while list is empty")
  surface = [...EXPECTED]
  const result = await h.result
  assert(result.state === "READY", "case1: stable expected surface → READY", result.reason)
  assert(result.missingExpected.length === 0 && result.extraOutsideExpected.length === 0, "case1: zero diff")
  assert(result.stable && !result.timedOut, "case1: reached via stability window, not timeout")
  assert(result.iClass.length === 6, "case1: six I-class probes", `got ${result.iClass.length}`)
  console.log("--- case1 raw logs ---\n" + lines.join("\n") + "\n--- end case1 raw logs ---")
}

async function case2_inflated_expected(): Promise<void> {
  lines.length = 0
  // Negative is injected in READY semantics: surface is stable and non-empty;
  // only the expected baseline is inflated by one synthetic id.
  const inflated = [...EXPECTED, "@deepseek-ai/dsh-nonexistent#probe/ghost"]
  let surface: string[] = []
  const h = startCapabilityHandshake(makeDeps(() => surface), {
    expectedIds: inflated,
    timeoutMs: 2000,
    pollIntervalMs: 40,
    stabilitySamples: 2,
  })
  await sleep(60)
  assert(h.snapshot.state === "PENDING", "case2: no degradation during PENDING (L41)")
  surface = [...EXPECTED]
  const result = await h.result
  assert(result.state === "DEGRADED", "case2: inflated expected on stable surface → DEGRADED", result.reason)
  assert(result.missingExpected.length === 1, "case2: exactly one expected-side miss")
  assert(result.extraOutsideExpected.length === 0, "case2: no extra-side false positive")
  assert(result.subclass === undefined, "case2: regular DEGRADED, not registration-timeout")
  console.log("--- case2 raw logs ---\n" + lines.join("\n") + "\n--- end case2 raw logs ---")
}

async function case3_timeout_empty(): Promise<void> {
  lines.length = 0
  const h = startCapabilityHandshake(makeDeps(() => []), {
    timeoutMs: 180,
    pollIntervalMs: 40,
  })
  const result = await h.result
  assert(result.state === "DEGRADED", "case3: empty at timeout → DEGRADED", result.reason)
  assert(result.subclass === "registration-timeout", "case3: registration-timeout subclass")
  assert(result.timedOut && !result.stable, "case3: judged at timeout, not via stability")
  console.log("--- case3 raw logs ---\n" + lines.join("\n") + "\n--- end case3 raw logs ---")
}

async function case4_extra(): Promise<void> {
  lines.length = 0
  const extraId = "@deepseek-ai/dsh-nonexistent#probe/extra"
  const h = startCapabilityHandshake(makeDeps(() => [...EXPECTED, extraId]), {
    timeoutMs: 2000,
    pollIntervalMs: 40,
    stabilitySamples: 2,
  })
  const result = await h.result
  assert(result.state === "READY", "case4: extra registered method does not degrade")
  assert(result.extraOutsideExpected.length === 1, "case4: extra recorded for ledger addition")
  assert(result.fullOnlyIgnored === 182, "case4: 257−75 full-only counted as 182, never a diff", String(result.fullOnlyIgnored))
  console.log("--- case4 raw logs ---\n" + lines.join("\n") + "\n--- end case4 raw logs ---")
}

async function case5_ctx_registry(): Promise<void> {
  lines.length = 0
  const ctx = { logger, get: () => undefined }
  const h = startCapabilityHandshake(makeDeps(() => []), { timeoutMs: 300, pollIntervalMs: 40 })
  attachHandshake(ctx, h)
  assert(getHandshake(ctx) === h, "case5: per-ctx handle registered for proof tooling")
  h.cancel()
  console.log("--- case5 raw logs ---\n" + lines.join("\n") + "\n--- end case5 raw logs ---")
}

console.log("=== 024 base task 4: capability handshake headless proof ===")
console.log(`expected=${EXPECTED.length} iClass=${I_KEYS.join(",")}`)
await case1_ready()
await case2_inflated_expected()
await case3_timeout_empty()
await case4_extra()
await case5_ctx_registry()
console.log("")
console.log(`summary: FAIL=${failures}`)
process.exit(failures === 0 ? 0 : 1)

// keep the imported type referenced for TS surface documentation
export type { HandshakeSnapshot }
