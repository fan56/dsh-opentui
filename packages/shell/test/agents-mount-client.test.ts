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
// It skips when tmux / bun / the opentui profile are unavailable.
import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const RUN = process.env.DSH_AGENTS_E2E === "1"
const REPO = join(import.meta.dir, "..", "..", "..")
const SCRIPT = join(REPO, "verify", "agents-mount-repro.mjs")
const REAL_HOME = process.env.DSH_HOME_REAL || join(homedir(), ".dsh")

const missing = !existsSync(SCRIPT)
	? `repro script missing: ${SCRIPT}`
	: spawnSync("which", ["tmux"], { encoding: "utf8" }).status !== 0
		? "no tmux on PATH"
		: spawnSync("which", ["bun"], { encoding: "utf8" }).status !== 0
			? "no bun on PATH"
			: !existsSync(join(REAL_HOME, "profiles", "opentui"))
				? `profile 'opentui' not provisioned under ${REAL_HOME}`
				: null

describe("real client: /agents mount + slash palette", () => {
	test.skipIf(!RUN || missing !== null)(
		`./dsh-opentui opens the /agents panel and completes /thi (skip: ${missing ?? "DSH_AGENTS_E2E not set"})`,
		() => {
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
