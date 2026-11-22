/**
 * Full-access-inherit R2-3 profile guard.
 *
 * The shipped inproc patch must pin the host subagent `maxDepth` to 1 so a
 * grandchild (absolute depth 2) is rejected instead of silently passing the
 * delegation gate. Reads the provision script as text because PATCH_TEMPLATE
 * is a literal inside a .mjs with no export (same shape as
 * approval-gate-profile.test.ts); this pins the exact config block so a future
 * "temporary" removal cannot silently reopen the hole.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const SCRIPT = fileURLToPath(new URL("../scripts/provision-inproc-profile.mjs", import.meta.url))
const src = readFileSync(SCRIPT, "utf8")

describe("shipped inproc profile: subagent delegation depth", () => {
  // 0 is unusable: the host treats depth as absolute (lead=0, direct child=1),
  // so a direct child is 1 > 0 and every delegation is refused (dispatch dead).
  // Pin 1 allows direct children but rejects grandchildren (2 > 1), closing
  // R2-3; volatile() means this is only the initial default, not a runtime lock.
  // The trailing \n is a LINE ANCHOR: without it "maxDepth: 1" is a substring
  // of "maxDepth: 10", so a tampered pin of 10 falsely passes.
  test("the subagent config block pins maxDepth to 1 (0 would kill all dispatch)", () => {
    expect(src).toContain(
      "- id: subagent\n  name: \"@deepseek-ai/dsh-subagent\"\n  config:\n    maxActiveSubagents: 3\n    maxDepth: 1\n",
    )
  })

  // Negative assertion: the UNANCHORED needle is deliberately stronger here —
  // it also catches "maxDepth: 0.5" and a value at EOF, which an anchored
  // "maxDepth: 0\n" would miss. There is no prefix-substring false-green risk
  // for not.toContain, so no line anchor is needed on this one.
  test("the pin is never 0 (direct child depth 1 > 0 => dispatch dead)", () => {
    expect(src).not.toContain("maxDepth: 0")
  })

  test("the comment records the absolute-depth semantics and the R2-3 rationale", () => {
    expect(src).toContain("ABSOLUTE depth: lead=0, direct child=1")
    expect(src).toContain("NEVER use 0 here")
    expect(src).toContain("R2-3 silent-pass")
    expect(src).toContain("dispatch dead")
    expect(src).toContain("volatile()")
  })
})
