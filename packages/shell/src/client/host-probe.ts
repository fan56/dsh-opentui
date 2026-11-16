/**
 * Host liveness probes used by the lifecycle manager before it hands an
 * authority to the client carrier.
 *
 * Two distinct questions:
 *
 * - `probeHostHttp` — "is this authority OUR dsh host?" A `GET /` carrying
 *   the cookie minted from this home's grant must answer with a web-app
 *   response (2xx/3xx). A live process that merely holds the TCP port (a
 *   foreign home's host, a test server, a wedge that lost its connection
 *   service) answers 401/404/5xx and must NOT be adopted: adopting it makes
 *   the carrier reconnect forever against an authority it can never
 *   authenticate.
 *
 * - `probeHostMux` — "is the client mux actually serving?" The carrier's
 *   readiness gate is the validated `$events` ready item, so the lifecycle
 *   uses the same handshake (upgrade + open `$events` + first item) before
 *   returning from a cold boot. Without it, readiness can resolve on a bare
 *   TCP listener and the first carrier attempt is rejected while the HTTP
 *   stack is still mounting — the `[connection] connection lost, retry #n`
 *   burst this module exists to eliminate.
 *
 * Both probes are bounded and never throw: the caller decides what a false
 * result means (stale lock vs. boot failure).
 */

import { randomUUID } from "node:crypto"
import WS from "ws"
import { openEventsStreamFrame, parseMuxFrame } from "./mux-frame.ts"

/** Default bound for one probe. */
export const DEFAULT_HOST_PROBE_TIMEOUT_MS = 2_000

/** Minimal socket seam the probe drives; defaults to a real `ws` socket.
 * Tests inject a fake that reproduces ws's async CONNECTING-close error. */
export type HostProbeSocketFactory = () => WS

export interface HostProbeOptions {
  /** `host:port` (scheme omitted) exactly as the host binds it. */
  authority: string
  /** Full `Cookie` header value minted for this authority. */
  cookieHeader: string
  /** Bound for the whole probe; defaults to 2s. */
  timeoutMs?: number
  /** Injectable socket factory (tests). Default: real `ws` to the mux path. */
  socketFactory?: HostProbeSocketFactory
}

function validAuthority(authority: string): boolean {
  return typeof authority === "string" && authority.length > 0 && !/[\r\n/]/.test(authority)
}

/**
 * Authenticated liveness: `GET /` with the owner cookie must reach the web
 * app. Any 2xx/3xx counts; 401/403 (cookie not accepted), 404 (something
 * else holds the port) and 5xx (broken host) all mean "not usable".
 */
export async function probeHostHttp(options: HostProbeOptions): Promise<boolean> {
  if (!validAuthority(options.authority)) return false
  const timeoutMs = options.timeoutMs ?? DEFAULT_HOST_PROBE_TIMEOUT_MS
  try {
    const response = await fetch(`http://${options.authority}/`, {
      headers: { cookie: options.cookieHeader },
      signal: AbortSignal.timeout(timeoutMs),
    })
    // The body is irrelevant; drop it so the socket is released promptly.
    try {
      await response.body?.cancel()
    } catch {
      /* already consumed/closed */
    }
    return response.status >= 200 && response.status < 400
  } catch {
    return false
  }
}

/**
 * Full client-generation handshake: upgraded mux WebSocket + `$events` open
 * frame + the validated ready item. This is exactly what the carrier's
 * `createEventsPumpSource` gates on, so a true result guarantees the first
 * carrier attempt has something to attach to.
 */
export async function probeHostMux(options: HostProbeOptions): Promise<boolean> {
  if (!validAuthority(options.authority)) return false
  const timeoutMs = options.timeoutMs ?? DEFAULT_HOST_PROBE_TIMEOUT_MS
  const makeSocket: HostProbeSocketFactory =
    options.socketFactory ??
    (() => new WS(`ws://${options.authority}/api/remote.mux`, { headers: { cookie: options.cookieHeader } }))
  return await new Promise<boolean>((resolve) => {
    let settled = false
    let socket: WS | undefined
    const timer = setTimeout(() => done(false), timeoutMs)
    function done(ok: boolean): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        socket?.removeAllListeners()
        // Closing a still-CONNECTING socket makes `ws` emit 'error' ("closed
        // before established") ASYNCHRONOUSLY, after removeAllListeners() has
        // removed the probe's own listeners — keep a noop handler attached so
        // it can never surface as an uncaught exception (events-source.ts and
        // remote-stream.ts fixed the identical race the same way). Every
        // settlement path funnels through done(), so all of them are covered.
        socket?.on("error", () => {})
        socket?.terminate()
      } catch {
        /* already gone */
      }
      resolve(ok)
    }
    try {
      socket = makeSocket()
    } catch {
      done(false)
      return
    }
    socket.on("open", () => {
      try {
        socket?.send(JSON.stringify(openEventsStreamFrame(randomUUID())))
      } catch {
        done(false)
      }
    })
    socket.on("message", (data) => {
      try {
        const frame = parseMuxFrame(String(data))
        if (frame.type !== "item") {
          done(false)
          return
        }
        const value = frame.value as { type?: unknown } | undefined
        done(value?.type === "ready")
      } catch {
        done(false)
      }
    })
    socket.on("unexpected-response", (_request, response) => {
      try {
        response.resume()
      } catch {
        /* already drained */
      }
      done(false)
    })
    socket.on("error", () => done(false))
    socket.on("close", () => done(false))
  })
}
