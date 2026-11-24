/**
 * T9 STUB — the HTTP host lifecycle is retired (the stdio bridge is the sole
 * host). Kept ONLY because `packages/shell/scripts/e2e-*.mjs` (out of T9 scope)
 * still import `ensureHost`. Delete those legacy e2e scripts in T12, then
 * delete this file. Nothing in production imports it.
 */
export const DEFAULT_PROFILE = "opentui"
export type HostHandle = { authority: string; cookieHeader: string; dshHome: string }
export type EnsureHostOptions = { profile?: string; idleExitSec?: number; dshHome?: string }

export function resolveIdleExitMs(): number {
	return Number(process.env.DSH_OPENTUI_HOST_IDLE_MS ?? 5000) || 5000
}

export async function ensureHost(_options: EnsureHostOptions = {}): Promise<HostHandle> {
	throw new Error("HTTP host boot retired (T9); use StdioBridgeTransport + BridgeSessionSeam")
}
