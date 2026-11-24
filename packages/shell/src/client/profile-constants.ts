/**
 * Profile-name constants extracted from the retired `lifecycle.ts` (T9).
 * T11 changes only `scripts/lib/profile-name.mjs`; this module re-exports that
 * single source for the client and the provisioner imports it directly.
 *
 * Every client profile-directory access (settings, config, presets, login
 * credentials) and the bridge host's `--profile` argv must read this constant.
 * Never re-declare the name in another module — the guard test in
 * `test/profile-consistency.test.ts` checks both consumers use the shared source.
 */

/** Profile whose files the client owns and the in-process host loads. */
export { DEFAULT_PROFILE } from "../../scripts/lib/profile-name.mjs"
