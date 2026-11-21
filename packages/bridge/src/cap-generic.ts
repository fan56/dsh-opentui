/**
 * 025 wave2 W2-0d — table-driven generic host arm (DORMANT at W2-0 base).
 *
 * This module is the bridge-internal generic dispatch promised by the plan
 * (§3.1/§3.2/§3.5/§3.6, AMEND-1/2). It is deliberately DATA-DRIVEN: every
 * decision (release whitelist, service binding, positional param order, coarse
 * validation, kind, sensitive-result exceptions) comes from injected generated
 * tables — there is no hand-copied `req.method ===` / `methodId ===` line (C5).
 *
 * At W2-0 base `CAP_GENERIC_ADAPTERS` is EMPTY, so `createCapHostInvoke` never
 * reaches this arm: observable bridge behaviour and the 28 hand-wired arms are
 * unchanged. The arm is exercised here by unit tests that inject a test config,
 * which is also how the R3 positional-order risk is forced into the open.
 *
 * Dependencies are injected (not imported) so the arm stays testable without
 * mutating any frozen generated table; the production wiring in index.ts passes
 * the generated capcontract tables verbatim.
 */

import type { CapParamRow } from '../../../capcontract/types'

/** Binding row from CAP_SERVICE_TABLE (service key + host method name). */
export interface GenericServiceBinding {
  readonly service: string
  readonly implementation: string
}

/**
 * All table data + the one bridge-owned seam (service resolution) the generic
 * arm needs. In production these are the generated capcontract tables and a
 * wrapped `ctx.get`; in tests they are small literal fixtures.
 */
export interface GenericCapConfig {
  /** Explicit per-id release whitelist (CAP_GENERIC_ADAPTERS). */
  readonly adapters: ReadonlySet<string>
  /** id -> {service, implementation} (CAP_SERVICE_TABLE). */
  readonly services: Readonly<Record<string, GenericServiceBinding>>
  /** id -> ordered coarse param rows (CAP_PARAMS_TABLE; .d.ts order is authority). */
  readonly params: Readonly<Record<string, readonly CapParamRow[]>>
  /** result-jsonSchema sensitive ids that MUST NOT use generic default projection (AMEND-2). */
  readonly projectedByHand: ReadonlySet<string>
  /** namespaces denied entry into generic dispatch (AMEND-1): account/credentials/settings. */
  readonly denyNamespaces: ReadonlySet<string>
  /** transport kind lookup (generated CAP_DISPATCH_TABLE via lookupCapKind). */
  readonly kindOf: (id: string) => 'unary' | 'stream'
  /** wrapped ctx.get(service) — try/catch lives here, never a declared inject (C-R5). */
  readonly getService: (service: string) => unknown
}

/** Namespace of a CapIR id: `<pkg>#<ns>/<name>` -> `<ns>`. */
export function capIdNamespace(id: string): string {
  const hash = id.indexOf('#')
  if (hash < 0) return ''
  const rest = id.slice(hash + 1)
  const slash = rest.indexOf('/')
  return slash < 0 ? rest : rest.slice(0, slash)
}

/**
 * AMEND-1 deny-list gate. Runs BEFORE the whitelist so a security-family id is
 * refused even if a hostile/stale generator ever writes it into the adapters
 * set. The three families keep their hand-written arms + bespoke projection.
 */
export function isDeniedGenericId(id: string, config: Pick<GenericCapConfig, 'denyNamespaces'>): boolean {
  return config.denyNamespaces.has(capIdNamespace(id))
}

/** Coarse, decidable type check; deep validation stays with the host method (A-3). */
function coarseTypeOk(type: CapParamRow['type'], value: unknown): boolean {
  switch (type) {
    case 'string': return typeof value === 'string'
    case 'boolean': return typeof value === 'boolean'
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'array': return Array.isArray(value)
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value)
    case 'union': return true // union shape is opaque at the coarse layer; host deep-validates
  }
}

/**
 * The generic unary arm (§3.1 steps 1–6). Throws the UNIFIED error surface:
 *  - NOT_WIRED: denied id / id not released / no service binding / service or
 *    method absent (full CapIR id in every message, machine-greppable);
 *  - BAD_KIND: a stream id reaching the unary arm (§3.6);
 *  - BAD_PARAMS: required missing / coarse type mismatch / enum outside set,
 *    message format `BAD_PARAMS: <id> <param> <reason>` (§3.5).
 *
 * Positional reconstruction is the R3 single point of failure: params are read
 * BY TABLE ORDER into a dense positional array. An omitted optional param still
 * contributes an `undefined` slot so later params keep their index — never
 * shift left. The host method is called with `.apply(service, positional)`.
 */
export async function invokeGenericCap(
  config: GenericCapConfig,
  methodId: string,
  kind: 'unary' | 'stream',
  params: unknown,
): Promise<unknown> {
  // deny-list beats whitelist (AMEND-1)
  if (isDeniedGenericId(methodId, config)) {
    throw new Error(`NOT_WIRED: ${methodId} is a hand-projection family, generic dispatch denied`)
  }
  if (!config.adapters.has(methodId)) {
    throw new Error(`NOT_WIRED: ${methodId} not in generic release whitelist`)
  }
  // §3.6: generic arm is unary only. Both the dispatcher kind and the static
  // kind table must say unary; a stream id never enters the unary arm.
  if (kind === 'stream' || config.kindOf(methodId) === 'stream') {
    throw new Error(`BAD_KIND: ${methodId} stream transport not supported by generic arm`)
  }

  const binding = config.services[methodId]
  if (binding === undefined || binding.service === '' || binding.implementation === '') {
    throw new Error(`NOT_WIRED: ${methodId} has no service binding`)
  }
  let service: Record<string, unknown> | undefined
  try {
    const resolved = config.getService(binding.service)
    if (resolved !== null && (typeof resolved === 'object' || typeof resolved === 'function')) {
      service = resolved as Record<string, unknown>
    }
  } catch {
    service = undefined
  }
  if (service === undefined) {
    throw new Error(`NOT_WIRED: ${binding.service} service unavailable for ${methodId}`)
  }
  const fn = service[binding.implementation]
  if (typeof fn !== 'function') {
    throw new Error(`NOT_WIRED: ${binding.service}.${binding.implementation} unavailable for ${methodId}`)
  }

  const rows = config.params[methodId] ?? []
  const named = (params !== null && typeof params === 'object' && !Array.isArray(params))
    ? params as Record<string, unknown>
    : {}
  const positional: unknown[] = []
  for (const row of rows) {
    const value = named[row.name]
    if (value === undefined || value === null) {
      if (row.required) throw new Error(`BAD_PARAMS: ${methodId} ${row.name} required`)
      // Preserve the slot: shifting would misalign every later parameter (R3).
      positional.push(undefined)
      continue
    }
    if (!coarseTypeOk(row.type, value)) {
      throw new Error(`BAD_PARAMS: ${methodId} ${row.name} must be ${row.type}`)
    }
    if (row.enum !== undefined && !row.enum.includes(value as never)) {
      throw new Error(`BAD_PARAMS: ${methodId} ${row.name} outside enum`)
    }
    positional.push(value)
  }
  return (fn as (...args: unknown[]) => unknown).apply(service, positional)
}

/**
 * §3.2 wire-name lookup over the GENERATED table, with the AMEND-1 deny-list
 * enforced again at the wire layer. A hostile wire table that includes a
 * denied id is still refused (returns undefined) — the generator itself also
 * omits these rows (check-capcontract #14/#16), so this is defence in depth.
 */
export function resolveGenericWireMethod(
  wireName: string,
  wireTable: Readonly<Record<string, string>>,
  config: Pick<GenericCapConfig, 'denyNamespaces'>,
): string | undefined {
  const id = wireTable[wireName]
  if (id === undefined) return undefined
  if (isDeniedGenericId(id, config)) return undefined
  return id
}

/**
 * §3.2 reply projection for the generic wire branch. Default ids use the
 * bridge-wide `sanitizeFrameForWire` then a record wrap (settings-branch style).
 *
 * AMEND-2: ids in CAP_PROJECTED_BY_HAND (result jsonSchema carries
 * token/secret/password/... keys) MUST NOT use this generic default projection —
 * they require a batch-specific hand-written projection. At W2-0 base no such
 * id is released, so the safe behaviour is to REFUSE with
 * `HAND_PROJECTION_REQUIRED: <id>`; the wire handler maps that to UNSUPPORTED
 * and emits no value frame. Sensitive keys / hostile values therefore cannot
 * appear in any frame for these ids.
 */
export function projectGenericWireReply(
  config: GenericCapConfig,
  methodId: string,
  value: unknown,
  sanitize: (frame: unknown) => unknown,
): Record<string, unknown> {
  if (config.projectedByHand.has(methodId)) {
    throw new Error(`HAND_PROJECTION_REQUIRED: ${methodId}`)
  }
  const cleaned = sanitize(value)
  return cleaned !== null && typeof cleaned === 'object' && !Array.isArray(cleaned)
    ? cleaned as Record<string, unknown>
    : { value: cleaned }
}
