/**
 * Settings + credentials Remote operations for the client-mode session layer
 * (ADR-0005 bucket (b) wave 2; audit rows 24 + 25).
 *
 * Mapping notes against the in-process HostSession (host-session.ts:288-304,
 * 444-448, 602-618):
 *
 * - `settings/describe` returns the DOCUMENT view
 *   ({writable, hasDocument, namespaces[]}) while the in-process
 *   settings.describe() handed the UI a flat ARRAY of namespace entries.
 *   `describe()` here performs that shaping (rows {ns, revision, value}) so
 *   the login feature's route-registration double-write and the /settings
 *   browser consume the same shapes as plugin mode.
 * - `settings/mutate` / `update` / `replace` take the revision seen at read
 *   time as `expectedRevision` (a stale editor is refused rather than
 *   silently overwriting a concurrent change) and answer the mutated
 *   namespace view.
 * - Credentials: the read half crosses the wire value-free —
 *   `credentials/describe(refs)` answers {configured, source?, writable}
 *   per ref; writes are `credentials/set` / `credentials/unset`. The
 *   /login route registration (login.tsx double-write) stays client-side:
 *   settings.mutate('llm-pi-ai', [providers path ops]) + credentials.set.
 *
 * Push events (`$events` emit frames) are routed by the session facade —
 * `settings/document-updated` (ns, revision) and
 * `credentials/reference-updated` (ref) reach their listeners there.
 */

/** One settings namespace row in the shape the UI seams consume. */
export interface RemoteSettingsRow {
	ns: string
	revision?: number
	value?: unknown
	autoGenerate?: boolean
	schema?: unknown
	user?: unknown
	secrets?: { path: string[]; set: boolean }[]
}

/** Credential source/writability facts (CredentialInfo — never the value). */
export interface RemoteCredentialInfo {
	configured: boolean
	source?: string
	writable: boolean
}

export interface RemoteSettingsOptions {
	rpc(method: string, args?: Record<string, unknown>): Promise<unknown>
}

export class RemoteSettingsClient {
	readonly #rpc: RemoteSettingsOptions["rpc"]

	constructor(options: RemoteSettingsOptions) {
		this.#rpc = options.rpc
	}

	/** The raw document view (SettingsDescribeValue). */
	async describeDocument(): Promise<{ writable: boolean; hasDocument: boolean; namespaces: RemoteSettingsRow[] }> {
		const value = (await this.#rpc("settings/describe")) as Record<string, unknown>
		const namespaces = Array.isArray(value.namespaces) ? value.namespaces : []
		return {
			writable: value.writable !== false,
			hasDocument: value.hasDocument === true,
			namespaces: namespaces.map((n) => asRow(n)),
		}
	}

	/**
	 * The flat namespace rows the in-process settings.describe() handed the
	 * UI (login.tsx reads `.ns`/`.revision` off this array).
	 */
	async describe(): Promise<RemoteSettingsRow[]> {
		return (await this.describeDocument()).namespaces
	}

	/** Path-addressed edits (SettingsPathOpView[]) with optimistic-lock revision. */
	async mutate(ns: string, ops: unknown[], revision?: number): Promise<RemoteSettingsRow> {
		const value = (await this.#rpc("settings/mutate", {
			ns,
			ops,
			...(revision !== undefined ? { expectedRevision: revision } : {}),
		})) as unknown
		return asRow(value)
	}

	/** Section patch (shallow merge per key) with optimistic-lock revision. */
	async update(ns: string, patch: Record<string, unknown>, revision?: number): Promise<RemoteSettingsRow> {
		const value = (await this.#rpc("settings/update", {
			ns,
			patch,
			...(revision !== undefined ? { expectedRevision: revision } : {}),
		})) as unknown
		return asRow(value)
	}

	/** Whole-section replace with optimistic-lock revision. */
	async replace(ns: string, section: Record<string, unknown>, revision?: number): Promise<RemoteSettingsRow> {
		const value = (await this.#rpc("settings/replace", {
			ns,
			section,
			...(revision !== undefined ? { expectedRevision: revision } : {}),
		})) as unknown
		return asRow(value)
	}

	/** Source/writability facts for the given refs (never values). */
	async credentialInfo(refs: string[]): Promise<Record<string, RemoteCredentialInfo>> {
		const value = (await this.#rpc("credentials/describe", { refs })) as Record<string, unknown>
		const out: Record<string, RemoteCredentialInfo> = {}
		for (const [ref, info] of Object.entries(value)) {
			const row = (typeof info === "object" && info !== null ? info : {}) as Record<string, unknown>
			out[ref] = {
				configured: row.configured === true,
				...(typeof row.source === "string" ? { source: row.source } : {}),
				writable: row.writable !== false,
			}
		}
		return out
	}

	/** Store one credential value (credentials/set). */
	async setCredential(ref: string, value: string): Promise<void> {
		await this.#rpc("credentials/set", { ref, value })
	}

	/** Remove one credential (credentials/unset). */
	async unsetCredential(ref: string): Promise<void> {
		await this.#rpc("credentials/unset", { ref })
	}
}

function asRow(value: unknown): RemoteSettingsRow {
	const row = (typeof value === "object" && value !== null && !Array.isArray(value) ? value : {}) as Record<string, unknown>
	const secrets = Array.isArray(row.secrets) ? row.secrets : []
	return {
		ns: String(row.ns ?? ""),
		...(typeof row.revision === "number" ? { revision: row.revision } : {}),
		...(row.value !== undefined ? { value: row.value } : {}),
		...(row.autoGenerate !== undefined ? { autoGenerate: row.autoGenerate === true } : {}),
		...(row.schema !== undefined ? { schema: row.schema } : {}),
		...(row.user !== undefined ? { user: row.user } : {}),
		...(secrets.length > 0
			? {
					secrets: secrets.map((s) => {
						const secret = (typeof s === "object" && s !== null ? s : {}) as Record<string, unknown>
						return {
							path: Array.isArray(secret.path) ? secret.path.map(String) : [],
							set: secret.set === true,
						}
					}),
				}
			: {}),
	}
}
