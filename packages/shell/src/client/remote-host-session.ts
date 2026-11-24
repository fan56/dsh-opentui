/**
 * T9 STUB — the HTTP RemoteHostSession is retired. Kept ONLY for
 * `packages/shell/scripts/e2e-*.mjs` imports (T12 cleanup). No production code
 * imports it.
 */
export const REATTACH_RETRY_MS = 500
export const REATTACH_MAX_ATTEMPTS = 20

export class RemoteHostSession {
	constructor(_options: Record<string, unknown>) {
		throw new Error("HTTP RemoteHostSession retired (T9); use BridgeSessionSeam")
	}
}
