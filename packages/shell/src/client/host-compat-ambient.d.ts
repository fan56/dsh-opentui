/**
 * A3: `scripts/lib/host-compat.mjs` is the single source of truth for the
 * supported host window, but it ships without a sibling `.d.mts` and `scripts/`
 * is frozen for this task. Declare only the two symbols the recovery handshake
 * consumes so `tsc --noEmit` stays clean under `strict` without duplicating the
 * policy in TypeScript.
 */
declare module "*/scripts/lib/host-compat.mjs" {
	export const HOST_PEER_RANGE: string
	export function isHostVersionSupported(version: string): boolean
}
