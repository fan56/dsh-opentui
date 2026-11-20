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
 * Service access discipline: the generated capcontract bundle declares
 * `inject: ['typert']` and its `resolveTypertLocal()` is the one typed accessor;
 * there is no bare `ctx.<service>` property read below. `ctx.get` is used only
 * for the six optional I-class probes (v2.1 C clause, apply-time available).
 */

import ledger from "../../../ledger/ledger.json"
import {
  CAP_DISPATCH_TABLE,
  CAPCONTRACT_BUNDLE,
  resolveTypertLocal,
  toTypertDescriptorId,
  type CapMethodId,
  type CapRuntimeCtx,
} from "../../../capcontract/dispatch"

/** Declarative inject surface shared with the bridge bundle (v2.1 clause C). */
export const HANDSHAKE_INJECT: readonly string[] = CAPCONTRACT_BUNDLE.inject

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
  /** apply-time `ctx.get` probes of the six registered I-class services. */
  iClass: ReadonlyArray<{ key: string; present: boolean }>
}

export interface HandshakeLogger {
  info(format: unknown, ...params: unknown[]): void
  warn(format: unknown, ...params: unknown[]): void
}

export interface HandshakeDeps {
  /** Runtime ctx; `resolveTypertLocal` is the only accessor of its typert member. */
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
  // Preferred: generated, inject-declared accessor (ctx.typert.local lives inside
  // capcontract and is covered by CAPCONTRACT_BUNDLE.inject: ['typert']).
  try {
    return resolveTypertLocal(deps.ctx as CapRuntimeCtx)
  } catch {
    // v2.1 C clause permits ctx.get('typert') as the no-declaration route.
    try {
      const svc = deps.get?.("typert") as { local?: { list(): ReadonlyArray<{ id: string }> } } | undefined
      return typeof svc?.local?.list === "function" ? svc.local : undefined
    } catch {
      return undefined
    }
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

  // I-class probes: cordis resolves inject before apply, so ctx.get is usable
  // here (L43). Probes are observations only — an absent optional I service is
  // not a W-surface degradation.
  const iClass = iClassKeys.map((key) => {
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
    iClass,
  }

  let settle!: (s: HandshakeSnapshot) => void
  const result = new Promise<HandshakeSnapshot>((resolve) => {
    settle = resolve
  })

  deps.logger.info(
    "[dsh-opentui-bridge][handshake] PENDING timeout=%dms expected=%d poll=%dms stability=%d I-probes=%s",
    timeoutMs,
    expectedIds.length,
    pollIntervalMs,
    stabilitySamples,
    JSON.stringify(iClass),
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
          iClass,
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
