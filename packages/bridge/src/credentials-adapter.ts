/**
 * Inproc host credentials adapter (mirrors `settings-adapter.ts`).
 *
 * Adapts the host `ctx.credentials` (`@deepseek-ai/dsh-credentials-local`,
 * which operates on a single `CredentialRef` per call) onto the batched
 * `CredentialsControllerLike` (`describe(refs)` / `set(ref, value)` /
 * `unset(ref)`) surface consumed by the bridge's `credentials/*` arm.
 *
 * Security / desensitization discipline:
 * - `projectCredentialInfoForWire()` keeps ONLY `{ configured, source?, writable }`;
 *   `masked` and any unknown fields are dropped so no secret prefix ever crosses
 *   a bridge frame.
 * - `set()` errors never embed the secret `value`.
 * - No bridge unwired-error literal is introduced here (capcontract #16 text-union).
 */

const MAX_DESCRIBE_REFS = 64
const CREDENTIAL_REF_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Host-redacted wire view for one credential reference (never carries values or `masked`). */
export type WireCredentialInfo = {
	configured: boolean
	source?: string
	writable: boolean
}

/** Structural slice of the inproc host `ctx.credentials` (`CredentialProvider`). */
interface HostCredentialProvider {
	describe?: (ref: string) => unknown | Promise<unknown>
	set?: (ref: string, value: string) => void | Promise<void>
	unset?: (ref: string) => void | Promise<void>
}

/** Structural mirror of `CredentialsControllerLike` in `index.ts`. */
export interface CredentialsSurfaceLike {
	describe(refs: string[]): Promise<Record<string, WireCredentialInfo>>
	set(ref: string, value: string): Promise<void>
	unset(ref: string): Promise<void>
}

function isObject(v: unknown): v is Record<string, unknown> {
	return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Project one host `CredentialInfo` (or stub row) onto the safe wire shape.
 * Strips `masked` and any extra properties so no secret material crosses.
 */
export function projectCredentialInfoForWire(raw: unknown): WireCredentialInfo {
	if (!isObject(raw)) return { configured: false, writable: false }
	const configured = raw.configured === true || raw.present === true
	const writable = raw.writable !== false
	const out: WireCredentialInfo = { configured, writable }
	if (typeof raw.source === 'string' && raw.source.length > 0) {
		out.source = raw.source
	}
	return out
}

/**
 * Scrub any occurrence of a non-empty secret value from an error message so
 * `credentials.set` failures never echo the submitted secret.
 */
export function sanitizeCredentialErrorMessage(err: unknown, ref: string, secretValue?: string): string {
	const raw = err instanceof Error ? err.message : String(err)
	if (secretValue && secretValue.length > 0 && raw.includes(secretValue)) {
		return `credentials.set failed for ${ref}`
	}
	return raw || `credentials operation failed for ${ref}`
}

/**
 * Adapt a resolved host `ctx.credentials` provider to the controller surface.
 * Returns `undefined` for a non-object so the arm preserves its existing
 * absence-path error (`credentialsController unavailable`).
 */
export function adaptCredentialsProvider(credentials: unknown): CredentialsSurfaceLike | undefined {
	if (!isObject(credentials)) return undefined
	const host = credentials as HostCredentialProvider
	return {
		describe: async (refs: string[]) => {
			if (!Array.isArray(refs) || refs.length > MAX_DESCRIBE_REFS) {
				throw new Error(`BAD_PARAMS: credentials.describe accepts at most ${MAX_DESCRIBE_REFS} refs`)
			}
			for (const ref of refs) {
				if (typeof ref !== 'string' || !CREDENTIAL_REF_RE.test(ref)) {
					throw new Error('BAD_PARAMS: credentials.describe ref must match credential grammar')
				}
			}
			if (typeof host.describe !== 'function') {
				throw new Error('HOST_UNAVAILABLE: credentials.describe is not available on the inproc host')
			}
			const entries = await Promise.all(
				refs.map(async (ref) => [ref, projectCredentialInfoForWire(await host.describe!(ref))] as const),
			)
			return Object.fromEntries(entries)
		},
		set: async (ref: string, value: string) => {
			if (typeof host.set !== 'function') {
				throw new Error('HOST_UNAVAILABLE: credentials.set is not available on the inproc host')
			}
			try {
				await host.set(ref, value)
			} catch (err) {
				throw new Error(sanitizeCredentialErrorMessage(err, ref, value))
			}
		},
		unset: async (ref: string) => {
			if (typeof host.unset !== 'function') {
				throw new Error('HOST_UNAVAILABLE: credentials.unset is not available on the inproc host')
			}
			await host.unset(ref)
		},
	}
}
