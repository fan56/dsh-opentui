// Real-client end-to-end gate for the /agents mount (env-gated, like the
// remote live smoke — NEVER part of the default suite):
//
//   DSH_AGENTS_E2E=1 bun test test/agents-mount-client.test.ts
//
// Runs verify/agents-mount-repro.mjs: the REAL `./dsh-opentui` launcher in a
// tmux pane against a SCRATCH DSH_HOME (seeded from ~/.dsh; nothing is written
// to the real home) and checks that
//   - `/agents` opens the manager panel (table, or the limits layer on an
//     empty corpus) instead of "/agents: the manager panel is not mounted in
//     this entry",
//   - Enter / Esc / `l` drive the panel layers,
//   - `/thi` + Tab completes to `/think `,
//   - the slash palette fits 80x24 (input row stays on screen) and reports
//     the overflow ("… N more").
// It skips ONLY when DSH_AGENTS_E2E is not set. With the env intent set, a
// missing prerequisite is a FAILURE (never a skip): a green job that silently
// skipped the real-machine gate is the exact false-positive this file guards.
import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const RUN = process.env.DSH_AGENTS_E2E === "1"
const REPO = join(import.meta.dir, "..", "..", "..")
const SCRIPT = join(REPO, "verify", "agents-mount-repro.mjs")
const REAL_HOME = process.env.DSH_HOME_REAL || join(homedir(), ".dsh")

function missingPrereqs(): string[] {
	const out: string[] = []
	if (!existsSync(SCRIPT)) out.push(`repro script missing: ${SCRIPT}`)
	if (spawnSync("which", ["tmux"], { encoding: "utf8" }).status !== 0) out.push("tmux not on PATH")
	if (spawnSync("which", ["bun"], { encoding: "utf8" }).status !== 0) out.push("bun not on PATH")
	if (!existsSync(join(REAL_HOME, "profiles", "opentui")))
		out.push(`profile 'opentui' not provisioned under ${REAL_HOME}`)
	return out
}

// Only probe when there is intent to run; default suites stay cheap and skip.
const missing = RUN ? missingPrereqs() : []

describe("real client: /agents mount + slash palette", () => {
	test.skipIf(!RUN)(
		RUN
			? "./dsh-opentui opens the /agents panel and completes /thi"
			: "./dsh-opentui opens the /agents panel and completes /thi (skipped: DSH_AGENTS_E2E not set)",
		() => {
			if (missing.length > 0) {
				throw new Error(
					`DSH_AGENTS_E2E=1 requires the real-machine prerequisites, missing:\n- ${missing.join("\n- ")}`,
				)
			}
			const run = spawnSync("node", [SCRIPT], { cwd: REPO, encoding: "utf8", timeout: 420_000 })
			const out = `${run.stdout ?? ""}\n${run.stderr ?? ""}`
			// surface the per-check table on failure
			expect(run.status, out.slice(-4000)).toBe(0)
			expect(out).toContain("PASS  /agents opens the manager panel")
			expect(out).not.toContain("not mounted in this entry")
		},
		450_000,
	)
})
