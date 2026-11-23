/**
 * B1 S1 — inproc host settings adapter (C2, design 05 §3.4 / §4.3).
 *
 * Projects the host `ctx.settings` (dsh-settings `SettingsForms`) onto the same
 * `describe`/`mutate` shape the bridge settings arm consumes. It is a
 * controller-ABSENT fallback only: the real `settingsController` is resolved
 * first in index.ts (`resolveSettingsSurface`); this adapter is used only when
 * that controller is unavailable — the inproc `dsh-base` host mounts
 * `config-editor` + `settings` but NOT `dsh-api-settings-controller`.
 *
 * Load-bearing discipline (see .proof/b1-s1-adapter/00-preregistered-expected.md):
 * - describe(): `writable` from host; `hasDocument` pinned `true` (same as the
 *   controller's hardcoded true, design §8.1.3 — no fs stat, no env coupling);
 *   `namespaces` is a FIELD-LEVEL projection of `describe({redactSecrets:true})`
 *   onto the controller's namespaceView shape `{ns,revision,schema,value,base,
 *   user,applies,secrets}`. Missing fields stay missing (never guessed).
 *   Secrets keep only `{path,set}` — no secret VALUE ever reaches a frame.
 * - mutate(): forwarded verbatim to host; any error (SETTINGS_CONFLICT / home
 *   patch override / host throw) propagates UNCHANGED — never swallowed,
 *   rewritten, or converted to an "unavailable" message.
 * - This file introduces no new "unavailable" error text (capcontract #16
 *   text-union discipline): a missing host method yields a descriptive
 *   HOST_UNAVAILABLE error; a fully absent host service keeps the arm's
 *   existing absence-path error verbatim (adapter returns undefined).
 */

/** Fixed namespaceView field set (controller parity, dsh-api-settings-controller/src/index.ts:46-62). */
const NS_FIELDS = ['ns', 'revision', 'schema', 'value', 'base', 'user', 'applies', 'secrets'] as const

/** Structural slice of the inproc host `ctx.settings` (SettingsForms). */
interface HostSettingsForms {
  writable?: unknown
  describe?: (options?: { redactSecrets?: boolean }) => unknown | Promise<unknown>
  mutate?: (ns: string, ops: unknown[], expectedRevision?: number) => unknown | Promise<unknown>
}

/** Structural mirror of index.ts `SettingsDescribeValueLike` (kept local so the
 *  adapter stays a standalone, cycle-free pure module; shapes are identical). */
interface SettingsDescribeValueLike {
  writable?: boolean
  hasDocument?: boolean
  namespaces?: unknown[]
}

/** Structural mirror of index.ts `SettingsControllerLike` (same shape). */
interface SettingsSurfaceLike {
  describe?(): SettingsDescribeValueLike | Promise<SettingsDescribeValueLike>
  mutate?(ns: string, ops: unknown[], expectedRevision?: number): Promise<unknown>
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** Project one host namespace onto the controller's fixed field set. */
function projectNamespace(raw: unknown): Record<string, unknown> {
  if (!isObject(raw)) return {}
  const out: Record<string, unknown> = {}
  for (const key of NS_FIELDS) {
    if (key === 'secrets') {
      const secrets = raw.secrets
      if (Array.isArray(secrets)) {
        out.secrets = secrets.filter(isObject).map((s) => ({ path: s.path, set: s.set }))
      }
      continue
    }
    if (key in raw) out[key] = raw[key]
  }
  return out
}

/** Extract the namespace list from a host describe result (tolerant shape). */
function extractNamespaces(result: unknown): unknown[] {
  if (Array.isArray(result)) return result
  if (isObject(result) && Array.isArray(result.namespaces)) return result.namespaces
  return []
}

/**
 * Adapt a RESOLVED host `ctx.settings` service to the controller surface.
 * Returns `undefined` for a non-object so the arm keeps its existing absence
 * path unchanged — this is what makes the absent state byte-for-byte identical
 * to today's behavior.
 */
export function adaptSettingsForms(settings: unknown): SettingsSurfaceLike | undefined {
  if (!isObject(settings)) return undefined
  const host = settings as HostSettingsForms
  return {
    describe: async () => {
      if (typeof host.describe !== 'function') {
        throw new Error('HOST_UNAVAILABLE: settings.describe is not available on the inproc host')
      }
      const result = await host.describe({ redactSecrets: true })
      return {
        writable: typeof host.writable === 'boolean' ? host.writable : false,
        hasDocument: true,
        namespaces: extractNamespaces(result).map(projectNamespace),
      }
    },
    mutate: async (ns: string, ops: unknown[], expectedRevision?: number) => {
      if (typeof host.mutate !== 'function') {
        throw new Error('HOST_UNAVAILABLE: settings.mutate is not available on the inproc host')
      }
      return host.mutate(ns, ops, expectedRevision)
    },
  }
}
