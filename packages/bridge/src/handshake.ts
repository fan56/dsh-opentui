/**
 * Startup capability handshake — 0.24 base task 4 (delivery plan §二 v2.1, B 条款 /
 * oldfox 裁决 A+B).
 *
 * Three states (L39): PENDING (registration not observed yet) / READY (stable
 * surface read, comparison passed) / DEGRADED (comparison found missing methods).
 * This module never reads `typert.local.list()` at apply() time — the measured
 * value there is always `[]`. The first read is deferred to the async poll loop.
 *
 * Baseline = ledger expected surface (75 ids), NOT the 257-id CapIR full set.
 * The comparison key is the CapIR method id ↔ typert descriptor.id identity map
 * from capcontract (`toTypertDescriptorId`). `CAP_DISPATCH_TABLE` is consulted
 * only to count the 182 full-only ids that are deliberately ignored.
 *
 * Service access discipline: the generated capcontract layer declares NO inject
 * and touches NO ctx service (oldfox R1/R2). The bridge owns `inject: ['typert']`
 * (index.ts:354) and the only typed typert accessor below. `ctx.get` is used for
 * the typert fallback and the six optional I-class probes (observation only).
 * I-class probes are sampled after the stable window, never at apply() time
 * (oldfox §三): their apply-time value was proven registration-time noise.
 */

import ledger from "../../../ledger/ledger.json"
import {
  CAP_DISPATCH_TABLE,
  toTypertDescriptorId,
} from "../../../capcontract/dispatch"
import type { CapMethodId } from "../../../capcontract/types"

/** Bridge-owned declarative inject surface (v2.1 clause C, oldfox R3). The
 *  generated capcontract layer no longer declares inject; index.ts:354 is the
 *  sole owner of the assembled `inject` array. */
export const HANDSHAKE_INJECT: readonly string[] = ["typert"]

/** S2 observation-only I-probe keys. These extend the six ledger I-class
 *  probes at handshake time so the two new service seams (deepseekAccount,
 *  credentialsController) are observed present/absent after the stable window.
 *  They are NOT added to the cordis `inject` array: a declared-but-absent
 *  required inject deactivates the whole plugin in cordis 4.1 (and the
 *  `credentialsController` package is not mounted in this profile). Service
 *  access stays on the `ctx.get` seam, exactly like S1's sessionController.
 *  Observation only — an absent service never degrades the W-surface state. */
export const S2_OBSERVATION_ICLASS_KEYS: readonly string[] = ["deepseekAccount", "credentialsController"]

/** The six ledger I-class service keys (base probe surface), exported so the
 *  bridge can assemble base + S2 observation keys for startCapabilityHandshake
 *  without duplicating the ledger source of truth. */
export const HANDSHAKE_ICLASS_KEYS_BASE: readonly string[] = ledger.dimensions.i_class.services.map((s) => s.key)

/** Per-ctx handle registry for headless proof/smoke tooling (no wire surface). */
const ctxHandles = new WeakMap<object, HandshakeHandle>()
export function attachHandshake(ctx: object, handle: HandshakeHandle | undefined): void {
  if (handle !== undefined) ctxHandles.set(ctx, handle)
}
export function getHandshake(ctx: object): HandshakeHandle | undefined {
  return ctxHandles.get(ctx)
}

export type HandshakeState = "PENDING" | "READY" | "DEGRADED"

export interface HandshakeSnapshot {
  state: HandshakeState
  reason: string
  /** DEGRADED subclass: "registration-timeout" when the surface was empty at timeout. */
  subclass?: "registration-timeout"
  expectedCount: number
  observedCount: number
  /** Expected ids absent from the registered surface (the only degrading diff). */
  missingExpected: string[]
  /** Registered ids outside the expected surface (ledger addition, never degrading). */
  extraOutsideExpected: string[]
  /** 257 full − 75 expected = 182; counted for the record, never reported as a diff. */
  fullOnlyIgnored: number
  stable: boolean
  timedOut: boolean
  elapsedMs: number
  sampleCount: number
  stabilitySamples: number
  /** Stable-window `ctx.get` probes of the six registered I-class services
   *  (observation only; never part of the PENDING/READY/DEGRADED decision). */
  iClass: ReadonlyArray<{ key: string; present: boolean }>
}

export interface HandshakeLogger {
  info(format: unknown, ...params: unknown[]): void
  warn(format: unknown, ...params: unknown[]): void
}

export interface HandshakeDeps {
  /** Runtime ctx; the direct `typert.local` accessor below is the only reader
   *  of its typert member (the generated layer no longer reads ctx — R1/R2). */
  ctx: unknown
  /** Cordis service lookup, used for the I-class probes and the typert fallback. */
  get?: (name: string, strict?: boolean) => unknown
  logger: HandshakeLogger
}

export interface HandshakeOptions {
  /** Defaults to ledger.dimensions.expected.method_ids (75). */
  expectedIds?: readonly string[]
  /** Defaults to the six ledger I-class service keys (incl. systemPrompt). */
  iClassKeys?: readonly string[]
  /** Default 10000ms; overridable via option or DSH_OPENTUI_HANDSHAKE_TIMEOUT_MS. */
  timeoutMs?: number
  pollIntervalMs?: number
  /** Consecutive equal, non-empty samples required for stability (min 2). */
  stabilitySamples?: number
}

export interface HandshakeHandle {
  readonly snapshot: HandshakeSnapshot
  readonly result: Promise<HandshakeSnapshot>
  /** Stop polling and release the timer (called from the bridge teardown). */
  cancel(): void
}

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_POLL_INTERVAL_MS = 100
const DEFAULT_STABILITY_SAMPLES = 2

function resolveLocal(deps: HandshakeDeps): { list(): ReadonlyArray<{ id: string }> } | undefined {
  // Preferred: direct property access on the bridge-owned inject surface
  // (index.ts:354 declares inject: ['agents', 'typert']). The generated
  // capcontract layer no longer provides a ctx accessor (oldfox R1/R2).
  try {
    const local = (deps.ctx as { typert?: { local?: { list(): ReadonlyArray<{ id: string }> } } }).typert?.local
    if (typeof local?.list === "function") return local
  } catch {
    // fall through to the ctx.get route below
  }
  // v2.1 C clause permits ctx.get('typert') as the no-declaration route.
  try {
    const svc = deps.get?.("typert") as { local?: { list(): ReadonlyArray<{ id: string }> } } | undefined
    return typeof svc?.local?.list === "function" ? svc.local : undefined
  } catch {
    return undefined
  }
}

function readIds(deps: HandshakeDeps): string[] {
  try {
    const local = resolveLocal(deps)
    if (local === undefined) return []
    return [...(local.list() ?? [])]
      .map((d) => d?.id)
      .filter((id): id is string => typeof id === "string")
      .sort()
  } catch {
    // A throwing list() is indistinguishable from "not registered yet" during
    // PENDING; containment is mandatory (plugin must never crash on startup).
    return []
  }
}

function compare(
  ids: string[],
  timedOut: boolean,
  expectedIds: readonly string[],
): Omit<HandshakeSnapshot, "state" | "reason" | "subclass" | "stable" | "timedOut" | "elapsedMs" | "sampleCount" | "stabilitySamples" | "iClass"> & {
  state: HandshakeState
  reason: string
  subclass?: "registration-timeout"
} {
  const observed = new Set(ids.map((id) => toTypertDescriptorId(id as CapMethodId)))
  const expected = new Set(expectedIds.map((id) => toTypertDescriptorId(id as CapMethodId)))
  const missingExpected = [...expected].filter((id) => !observed.has(id)).sort()
  const extraOutsideExpected = [...observed].filter((id) => !expected.has(id)).sort()
  // 257 full set is used only for this count — never as the comparison baseline.
  const fullOnlyIgnored = Object.keys(CAP_DISPATCH_TABLE).filter((id) => !expected.has(id as CapMethodId)).length

  if (observed.size === 0) {
    return {
      state: "DEGRADED",
      subclass: timedOut ? "registration-timeout" : undefined,
      reason: timedOut ? "registration timeout: empty descriptor list at deadline" : "empty descriptor list",
      expectedCount: expected.size,
      observedCount: 0,
      missingExpected,
      extraOutsideExpected,
      fullOnlyIgnored,
    }
  }
  if (missingExpected.length > 0) {
    return {
      state: "DEGRADED",
      reason: timedOut
        ? "missing expected methods at deadline (non-empty surface)"
        : "missing expected methods on stable surface",
      expectedCount: expected.size,
      observedCount: observed.size,
      missingExpected,
      extraOutsideExpected,
      fullOnlyIgnored,
    }
  }
  return {
    state: "READY",
    reason: timedOut
      ? "expected surface matched at deadline (stability window not reached)"
      : "expected surface matched on stable surface",
    expectedCount: expected.size,
    observedCount: observed.size,
    missingExpected,
    extraOutsideExpected,
    fullOnlyIgnored,
  }
}

/**
 * Begin the startup handshake. Returns immediately (the first list() read is
 * asynchronous). `PENDING` is reported at start; no degradation decision is
 * made until the stability window is reached or the timeout fires (L41).
 */
export function startCapabilityHandshake(deps: HandshakeDeps, options: HandshakeOptions = {}): HandshakeHandle {
  const expectedIds = options.expectedIds ?? ledger.dimensions.expected.method_ids
  const iClassKeys = options.iClassKeys ?? ledger.dimensions.i_class.services.map((s) => s.key)
  const envTimeout = Number(process.env.DSH_OPENTUI_HANDSHAKE_TIMEOUT_MS)
  const timeoutMs = options.timeoutMs ?? (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : DEFAULT_TIMEOUT_MS)
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const stabilitySamples = Math.max(2, options.stabilitySamples ?? DEFAULT_STABILITY_SAMPLES)
  const startedAt = Date.now()

  // I-class probes (oldfox §三): sampled AFTER the stable window, never at
  // apply() time. The apply-time values were proven registration-time noise
  // (sessionController present=false@apply → true@1500ms in 05/07/09). Probes
  // remain observations only — an absent optional I service never degrades the
  // W-surface state.
  const probeIClass = (): ReadonlyArray<{ key: string; present: boolean }> =>
    iClassKeys.map((key) => {
      let present = false
      try {
        present = deps.get?.(key) !== undefined
      } catch {
        present = false
      }
      return { key, present }
    })

  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let wake: (() => void) | undefined
  let snapshot: HandshakeSnapshot = {
    state: "PENDING",
    reason: "waiting for a non-empty stable typert.local descriptor set",
    expectedCount: expectedIds.length,
    observedCount: 0,
    missingExpected: [],
    extraOutsideExpected: [],
    fullOnlyIgnored: 0,
    stable: false,
    timedOut: false,
    elapsedMs: 0,
    sampleCount: 0,
    stabilitySamples,
    iClass: [],
  }

  let settle!: (s: HandshakeSnapshot) => void
  const result = new Promise<HandshakeSnapshot>((resolve) => {
    settle = resolve
  })

  deps.logger.info(
    "[dsh-opentui-bridge][handshake] PENDING timeout=%dms expected=%d poll=%dms stability=%d",
    timeoutMs,
    expectedIds.length,
    pollIntervalMs,
    stabilitySamples,
  )

  const delay = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      wake = resolve
      timer = setTimeout(() => {
        timer = undefined
        wake = undefined
        resolve()
      }, ms)
    })

  const finish = (next: HandshakeSnapshot): void => {
    snapshot = next
    const extra = next.extraOutsideExpected
    if (next.state === "DEGRADED") {
      deps.logger.warn(
        "[dsh-opentui-bridge][handshake] DEGRADED%s reason=%s observed=%d expected=%d missing=%d extra=%d fullOnlyIgnored=%d",
        next.subclass ? ` subclass=${next.subclass}` : "",
        next.reason,
        next.observedCount,
        next.expectedCount,
        next.missingExpected.length,
        extra.length,
        next.fullOnlyIgnored,
      )
    } else {
      deps.logger.info(
        "[dsh-opentui-bridge][handshake] READY observed=%d expected=%d missing=0 extra=%d fullOnlyIgnored=%d elapsed=%dms samples=%d",
        next.observedCount,
        next.expectedCount,
        extra.length,
        next.fullOnlyIgnored,
        next.elapsedMs,
        next.sampleCount,
      )
    }
    // I-probes are recorded once, after the stable-window verdict, as a pure
    // observation line (oldfox §三): no new DEGRADED semantics, no apply-time
    // double point.
    deps.logger.info(
      "[dsh-opentui-bridge][handshake] I-probes@stable %s",
      JSON.stringify(next.iClass),
    )
    settle(next)
  }

  const run = async (): Promise<void> => {
    let lastSignature: string | undefined
    let streak = 0
    let sampleCount = 0
    const deadline = startedAt + timeoutMs

    while (!cancelled) {
      await delay(pollIntervalMs)
      if (cancelled) return
      const ids = readIds(deps)
      sampleCount++
      const signature = ids.length > 0 ? ids.join("\n") : ""
      if (signature !== "" && signature === lastSignature) streak++
      else streak = 1
      lastSignature = signature

      const timedOut = Date.now() >= deadline
      const stable = ids.length > 0 && streak >= stabilitySamples
      if (stable || timedOut) {
        const verdict = compare(ids, timedOut, expectedIds)
        finish({
          ...verdict,
          stable,
          timedOut,
          elapsedMs: Date.now() - startedAt,
          sampleCount,
          stabilitySamples,
          iClass: probeIClass(),
        })
        return
      }
    }
  }
  void run()

  return {
    get snapshot() {
      return snapshot
    },
    result,
    cancel() {
      if (cancelled) return
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      wake?.()
      wake = undefined
    },
  }
}
