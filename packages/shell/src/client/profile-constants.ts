/**
 * Profile-name constants extracted from the retired `lifecycle.ts` (T9).
 * The value currently tracks the in-process host profile; the final rename to
 * `opentui-monday` is a separate T11 commit. T11 is a one-line edit HERE.
 *
 * SINGLE SOURCE OF TRUTH: every client profile-directory access (settings,
 * config, presets, login credentials) and the bridge host's `--profile` argv
 * must read this constant. Never re-declare the name in another module — the
 * guard test in `test/profile-consistency.test.ts` fails when this value and
 * the provisioner's `PROFILE` drift apart.
 */

/** Profile whose files the client owns and the in-process host loads. */
export const DEFAULT_PROFILE = "opentui-inproc"
