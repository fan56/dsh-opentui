/**
 * Injectable host health validation (ADR-0009 decision 5; DESIGN-redesign §3
 * step 4 — the three-signal readiness gate's TCP + HTTP legs).
 *
 * A host is "healthy" for attachment only when BOTH hold:
 *   1. TCP connect to `authority` succeeds (the listener is up), AND
 *   2. `GET /` carrying the owner cookie answers 2xx/3xx (it is OUR host,
 *      not a foreign home / a wedge that lost its connection service).
 *
 * The decision is a PURE function of two injectable probes:
 *   - `connectTcp(authority)`         → boolean
 *   - `requestStatus(authority, cookie)` → number | null
 * No sockets are opened unless the caller uses the default probes. Unit tests
 * inject fakes and assert the 2xx/3xx boundary, the short-circuit order, and
 * that the cookie/authority are forwarded — no real host is started.
 *
 * Reuse: the default probes delegate to `lifecycle.isListening` (bounded
 * loopback connect) and `host-probe.probeHostHttpStatus` (the authenticated
 * GET / that already backs `probeHostHttp`). This module adds only the
 * composition + injectable seam, not a second HTTP implementation.
 */

import { isListening } from './lifecycle.ts'
import { probeHostHttpStatus } from './host-probe.ts'

/** Lowest healthy HTTP status (inclusive). */
export const HEALTH_STATUS_MIN = 200
/** Highest healthy HTTP status (exclusive) — 3xx redirects count. */
export const HEALTH_STATUS_MAX_EXCLUSIVE = 400

/** The two probe seams. Inject to make health checking pure/testable. */
export interface HealthProbes {
  /** `true` when a TCP connect to `authority` (`host:port`) succeeds. */
  connectTcp: (authority: string) => Promise<boolean>
  /** HTTP status of the owner-cookie `GET /`, or `null` on no response. */
  requestStatus: (authority: string, cookieHeader: string) => Promise<number | null>
}

export interface HealthTarget {
  /** `host:port` exactly as the host binds it. */
  authority: string
  /** Full `Cookie` header value minted for this authority. */
  cookieHeader: string
}

export type HealthReason =
  | 'ok'
  | 'tcp-failed'
  | 'http-no-response'
  | 'http-unhealthy-status'

export interface HealthCheck {
  healthy: boolean
  /** TCP connect result (false when short-circuited by a malformed authority). */
  tcp: boolean
  /** HTTP status from `requestStatus`, or null when it was not called / failed. */
  httpStatus: number | null
  reason: HealthReason
}

/** Extract the port from a `host:port` authority. IPv6 brackets are supported. */
export function authorityPort(authority: string): number | null {
  if (typeof authority !== 'string' || authority.length === 0) return null
  let host = authority
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    if (end === -1) return null
    host = host.slice(end + 1)
    if (!host.startsWith(':')) return null
    host = host.slice(1)
  } else {
    const colon = host.lastIndexOf(':')
    if (colon === -1) return null
    host = host.slice(colon + 1)
  }
  if (!/^\d+$/.test(host)) return null
  const port = Number(host)
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null
}

/** True for any 2xx/3xx status. */
export function isHealthyStatus(status: number | null): boolean {
  return status !== null && status >= HEALTH_STATUS_MIN && status < HEALTH_STATUS_MAX_EXCLUSIVE
}

/** Default probes: bounded TCP connect + authenticated GET / status. */
export const defaultHealthProbes: HealthProbes = {
  async connectTcp(authority) {
    const port = authorityPort(authority)
    return port === null ? false : isListening(port)
  },
  async requestStatus(authority, cookieHeader) {
    return probeHostHttpStatus({ authority, cookieHeader })
  },
}

/**
 * Decide host health from the injected probes. TCP is checked first; the
 * HTTP probe is skipped when TCP fails (an unreachable listener cannot serve
 * HTTP). Never throws — a throwing probe is treated as a failed one.
 */
export async function checkHostHealth(target: HealthTarget, probes: HealthProbes = defaultHealthProbes): Promise<HealthCheck> {
  let tcp = false
  try {
    tcp = await probes.connectTcp(target.authority)
  } catch {
    tcp = false
  }
  if (!tcp) return { healthy: false, tcp: false, httpStatus: null, reason: 'tcp-failed' }

  let status: number | null = null
  try {
    status = await probes.requestStatus(target.authority, target.cookieHeader)
  } catch {
    status = null
  }
  if (status === null) return { healthy: false, tcp: true, httpStatus: null, reason: 'http-no-response' }
  if (!isHealthyStatus(status)) return { healthy: false, tcp: true, httpStatus: status, reason: 'http-unhealthy-status' }
  return { healthy: true, tcp: true, httpStatus: status, reason: 'ok' }
}
