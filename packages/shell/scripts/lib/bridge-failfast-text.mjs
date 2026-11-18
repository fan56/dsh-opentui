/**
 * Single source of the inproc bridge fail-fast message text (P0 3-element fix).
 *
 * Both failure paths MUST print the same three elements (T11 original:
 * "错误自包含诊断 + 修复命令 + '该模式无 append'提示"):
 *   1. diagnosis       — what failed, with expected/actual values
 *   2. repair command  — the concrete command to fix it
 *   3. no-append notice — inproc mode has no append-system support yet (M3)
 *
 * They used to be split across two hard-coded sources that never met:
 *   - `src/client/seam-bootstrap.ts` BridgeBootstrapError (handshake path) had
 *     all three via `formatBridgeBootstrapMessage`;
 *   - `scripts/provision-inproc-profile.mjs` ProvisionError (fingerprint path)
 *     had diagnosis + repair hint but NO no-append notice.
 *
 * This module lives under `scripts/` (the only source dir the npm `files`
 * allowlist publishes) so BOTH the shipped provision script and the bundled
 * client can import it. Do not re-declare these strings in either consumer.
 */

/** Concrete repair command carried by every bridge bootstrap/provision error. */
export const BRIDGE_REPAIR_COMMAND = 'dsh-opentui --repair-bridge'

/** The "no append in this mode" half of the error text (T11 #3). */
export const BRIDGE_NO_APPEND_NOTICE =
  'inproc bridge mode has no append-system support in 0.22.0 (M3 section not landed); presets are standard only.'

/** The repair element with the link-vs-content caveat (provision-script wording). */
export const BRIDGE_REPAIR_HINT =
  `Run \`${BRIDGE_REPAIR_COMMAND}\` to rebuild the bridge symlink / manifest (it fixes links, not corrupted artifact contents).`

/**
 * Compose the three elements into one copy-pasteable, self-contained message.
 * `diagnosis` is element 1 (already carrying expected/actual where available);
 * element 2 is the shared repair command; element 3 is the shared notice.
 */
export function formatBridgeFailFastMessage(diagnosis, repairCommand = BRIDGE_REPAIR_COMMAND) {
  return [diagnosis, `Fix: ${repairCommand}`, BRIDGE_NO_APPEND_NOTICE].join('\n')
}
