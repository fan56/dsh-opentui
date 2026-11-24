/**
 * T9 STUB — the HTTP host lifecycle is retired (the stdio bridge is the sole
 * host). Kept ONLY because `packages/shell/scripts/e2e-*.mjs` (out of T9 scope)
 * still import `ensureHost`. Delete those legacy e2e scripts in T12, then
 * delete this file. Nothing in production imports it.
 */
// T9: the one definition moved to profile-constants.ts. Re-exported here so
// the out-of-scope legacy e2e scripts that still import this path keep working.
export { DEFAULT_PROFILE } from "./profile-constants.ts"
export type HostHandle = { authority: string; cookieHeader: string; dshHome: string }
export type EnsureHostOptions = { profile?: string; idleExitSec?: number; dshHome?: string }

export function resolveIdleExitMs(): number {
	return Number(process.env.DSH_OPENTUI_HOST_IDLE_MS ?? 5000) || 5000
}

export async function ensureHost(_options: EnsureHostOptions = {}): Promise<HostHandle> {
	throw new Error("HTTP host boot retired (T9); use StdioBridgeTransport + BridgeSessionSeam")
}
