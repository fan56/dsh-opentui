/**
 * Single source of the inproc bridge fail-fast message text (P0 3-element fix).
 *
 * Both failure paths MUST print the same three elements (T11 original:
 * "错误自包含诊断 + 修复命令 + 模式说明"):
 *   1. diagnosis      — what failed, with expected/actual values
 *   2. repair command — the concrete command to fix it
 *   3. mode notice    — append-system is injected via the bridge section;
 *                       presets are standard only (M3 landed)
 *
 * The third element used to say append was unavailable in this mode. That was
 * true before M3 but is now false: M3-04 registers the append section through
 * session.open setup, and M3-05b keeps the legacy append preset id as inert
 * metadata (the `standard` mapping from 8e0e847 was reverted in a45a052) —
 * append text is injected by the bridge section, not by a preset. The notice
 * is kept (it is still useful context) with corrected semantics — do not
 * restore the stale "no append" claim.
 *
 * They used to be split across two hard-coded sources that never met:
 *   - `src/client/seam-bootstrap.ts` BridgeBootstrapError (handshake path) had
 *     all three via `formatBridgeBootstrapMessage`;
 *   - `scripts/provision-inproc-profile.mjs` ProvisionError (fingerprint path)
 *     had diagnosis + repair hint but NO mode notice.
 *
 * This module lives under `scripts/` (the only source dir the npm `files`
 * allowlist publishes) so BOTH the shipped provision script and the bundled
 * client can import it. Do not re-declare these strings in either consumer.
 */

/** Concrete repair command carried by every bridge bootstrap/provision error. */
export const BRIDGE_REPAIR_COMMAND = 'dsh-opentui --repair-bridge'

/** The current-mode append/preset half of the error text (T11 #3, rewritten in M3-08). */
export const BRIDGE_APPEND_PRESET_NOTICE =
  'inproc bridge mode injects append-system via the bridge section; presets are standard only.'

/** The escape-hatch line carried by EVERY bridge failure: a launch-level opt
 *  out of the default inproc bridge back to the legacy remote thin client. Kept
 *  as its own constant so the host gate and the shared repair hint cannot drift. */
export const BRIDGE_LEGACY_REMOTE_HINT =
  'To keep the legacy remote thin client for this launch: DSH_OPENTUI_INPROC=0'

/** The repair element with the link-vs-content caveat (provision-script wording). */
export const BRIDGE_REPAIR_HINT =
  `Run \`${BRIDGE_REPAIR_COMMAND}\` to rebuild the bridge symlink / manifest (it fixes links, not corrupted artifact contents).\n${BRIDGE_LEGACY_REMOTE_HINT}`

/**
 * Compose the three elements into one copy-pasteable, self-contained message.
 * `diagnosis` is element 1 (already carrying expected/actual where available);
 * element 2 is the shared repair command; element 3 is the shared mode notice.
 */
export function formatBridgeFailFastMessage(diagnosis, repairCommand = BRIDGE_REPAIR_COMMAND) {
  return [diagnosis, `Fix: ${repairCommand}`, BRIDGE_APPEND_PRESET_NOTICE].join('\n')
}
