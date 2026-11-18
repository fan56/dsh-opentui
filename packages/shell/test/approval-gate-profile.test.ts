/**
 * T9 profile-default guard (ADR-0011).
 *
 * The shipped inproc profile must default to the confined + ask preset with a
 * live pre-execute write gate. Reads the provision script as text because
 * PATCH_TEMPLATE is a literal inside a .mjs with no export; this pins the exact
 * keys so a future "temporary" revert cannot silently ship an inert gate.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const SCRIPT = fileURLToPath(new URL("../scripts/provision-inproc-profile.mjs", import.meta.url))
const src = readFileSync(SCRIPT, "utf8")

describe("shipped inproc profile: T9 approval defaults", () => {
  test("default preset resolves to workspace-write unless the escape hatch is set", () => {
    expect(src).toContain(
      "defaultPreset: !!js process.env.DSH_OPENTUI_APPROVAL_GATE === 'off' && 'danger-full-access' || 'workspace-write'",
    )
    expect(src).toContain("workspace-write:\n        sandbox: workspace-write\n        approval: ask")
  })

  test("gate is enabled by default and gates the write tools registered by the host", () => {
    expect(src).toContain("enabled: !!js process.env.DSH_OPENTUI_APPROVAL_GATE !== 'off'")
    for (const name of ["bash", "write", "edit", "apply_patch"]) {
      expect(src).toContain(`          ${name}: ask`)
    }
    // The old inert default must not come back.
    expect(src).not.toContain("        tools: {}")
  })

  test("a single, documented escape hatch exists and is not defaulted to off", () => {
    expect(src).toContain("DSH_OPENTUI_APPROVAL_GATE=off")
    expect(src).not.toContain("enabled: false\n        reason:")
  })
})
