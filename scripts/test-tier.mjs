#!/usr/bin/env node
// Test taxonomy runner. See docs/testing.md.
//
//   node scripts/test-tier.mjs unit    pure logic + state machines (bun test)
//   node scripts/test-tier.mjs ft      real renderer / real assembly (bun test)
//   node scripts/test-tier.mjs ui      tmux capture + ANSI/geometry assertions
//   node scripts/test-tier.mjs e2e     real client + real host (+ mock model)
//   node scripts/test-tier.mjs all     unit -> ft -> ui -> e2e
//   node scripts/test-tier.mjs list    print the file -> tier matrix
//
// ui/e2e preflight: a missing prerequisite is an ENVIRONMENT ERROR (exit 2)
// with a named list. It never silently skips and never reports green.
//
// e2e legs: run-flows + steer-queue-repro are OFFLINE (local fake/mock model)
// and always run. The real-model legs (verify/remote-live-smoke.mjs,
// queue-flush-repro.mjs) are opt-in via DSH_E2E_LIVE=1; the /agents bun gate is
// opt-in via DSH_AGENTS_E2E=1. Every leg that does not run is printed as NOT
// RUN and tallied, so the final summary never calls a partial run a PASS.
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, delimiter, dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const PKGS = join(ROOT, "packages")
const REAL_HOME = process.env.DSH_HOME_REAL || join(homedir(), ".dsh")
const LAUNCHER = join(ROOT, "dsh-opentui")
const SHELL_SDK = join(ROOT, "packages/shell/node_modules/@deepseek-ai/dsh-client-connection")
const NODE = process.env.NODE || process.execPath
const BUN = process.env.BUN || "bun"

// Env-gated real-host bun test. It self-skips without DSH_AGENTS_E2E, so it
// must not be counted by unit/ft (a skip is not a pass); runE2e() wires it
// explicitly. The former second entry, remote-live-smoke.test.ts, never
// existed — the live harness is verify/remote-live-smoke.mjs (a script leg).
const E2E_GATED_TESTS = new Set(["agents-mount-client.test.ts"])

// The live (real model / real provider key) e2e legs are OPT-IN: the default
// `bun run test:e2e` is deterministic and key-free (the e2e-flows fake model
// + the steer-queue mock LLM). An invalid, expired or
// rate-limited provider key must not turn the whole tier red for a reason
// that is not a product regression. DSH_E2E_LIVE=1 includes the real-model
// legs (verify/remote-live-smoke.mjs + verify/queue-flush-repro.mjs); a
// provider 401/429/5xx/timeout there is an ENVIRONMENT result, reported as
// NOT RUN and never as a product pass.
const LIVE_ENABLED = process.env.DSH_E2E_LIVE === "1"

const FT_NAME = /-ft\.test\.tsx?$/
const FT_MARKERS = ["@opentui/core/testing", "testRender(", "createTestRenderer("]

const walk = (dir, out = []) => {
	let entries
	try {
		entries = readdirSync(dir, { withFileTypes: true })
	} catch {
		return out
	}
	for (const entry of entries) {
		if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
		const full = join(dir, entry.name)
		if (entry.isDirectory()) walk(full, out)
		else if (/\.test\.tsx?$/.test(entry.name)) out.push(full)
	}
	return out
}

const packageDirs = () =>
	readdirSync(PKGS, { withFileTypes: true })
		.filter((d) => d.isDirectory() && existsSync(join(PKGS, d.name, "package.json")))
		.map((d) => join(PKGS, d.name))
		.sort()

const isFt = (file) => {
	if (FT_NAME.test(file)) return true
	const src = readFileSync(file, "utf8")
	if (FT_MARKERS.some((m) => src.includes(m))) return true
	// Assembly contracts carry the `verify:` test-name prefix (docs/testing.md).
	return /["'`]verify:/.test(src)
}

const classify = () => {
	const tiers = { unit: [], ft: [], e2e: [] }
	for (const pkg of packageDirs()) {
		for (const file of walk(pkg)) {
			if (E2E_GATED_TESTS.has(basename(file))) tiers.e2e.push(file)
			else if (isFt(file)) tiers.ft.push(file)
			else tiers.unit.push(file)
		}
	}
	return tiers
}

const banner = (text) => console.log(`\n== ${text} ==`)

// A leg that does not run is explicitly NOT RUN, never a silent green. The
// tally is printed in the final summary so a partial run cannot be reported
// as a plain PASS.
const notRunLegs = []
const markNotRun = (label, reason) => {
	notRunLegs.push(label)
	console.log(`SKIP ${label} — NOT RUN: ${reason}`)
}

const run = (cmd, args, opts = {}) => {
	const result = spawnSync(cmd, args, { stdio: "inherit", ...opts })
	if (result.error) {
		console.error(`test-tier: failed to spawn ${cmd}: ${result.error.message}`)
		return 1
	}
	return result.status ?? 1
}

// Combine a leg status into the running `failed` value. The status argument is
// ALWAYS evaluated (every leg runs), and the FIRST nonzero wins: a later exit 2
// (environment / NOT RUN) must not overwrite an earlier product FAIL (exit 1).
// Do not use `failed || run(...)` — that would short-circuit and skip legs.
const keepFirst = (current, status) => (current !== 0 ? current : status)

const runBunTier = (name, files) => {
	banner(`test:${name} (${files.length} files)`)
	if (files.length === 0) {
		console.error(`test:${name}: no test files matched — refusing to pass an empty tier`)
		return 1
	}
	const byPackage = new Map()
	for (const file of files) {
		const pkg = packageDirs().find((p) => file.startsWith(p + "/"))
		if (!pkg) {
			console.error(`test:${name}: ${file} is outside every workspace package`)
			return 1
		}
		if (!byPackage.has(pkg)) byPackage.set(pkg, [])
		byPackage.get(pkg).push(relative(pkg, file))
	}
	let failed = 0
	for (const pkg of [...byPackage.keys()].sort()) {
		const rels = byPackage.get(pkg).sort()
		console.log(`\n$ bun test ${rels.join(" ")}    (cwd: ${relative(ROOT, pkg)})`)
		const status = run(BUN, ["test", ...rels], { cwd: pkg })
		// Keep the FIRST nonzero (a product FAIL) as the aggregate result: a
		// later exit 2 (environment / NOT RUN) must not overwrite it.
		if (status !== 0 && failed === 0) failed = status
	}
	return failed
}

const commandExists = (cmd) => {
	const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""]
	for (const dir of (process.env.PATH || "").split(delimiter)) {
		if (!dir) continue
		for (const ext of exts) if (existsSync(join(dir, cmd + ext))) return true
	}
	return false
}

const envMissing = (kind) => {
	const missing = []
	if (process.platform === "win32") missing.push("tmux-based gates require macOS or Linux (Windows is unsupported)")
	for (const cmd of ["tmux", "bun", "dsh"]) {
		if (!commandExists(cmd)) missing.push(`${cmd} not on PATH`)
	}
	if (!existsSync(LAUNCHER)) missing.push(`launcher missing: ${LAUNCHER}`)
	if (!existsSync(SHELL_SDK))
		missing.push(
			`${relative(ROOT, SHELL_SDK)} missing (needs a global dsh install or the CI stub; the client cannot boot without it)`,
		)
	if (kind === "e2e" && LIVE_ENABLED && !existsSync(join(REAL_HOME, ".credentials.yaml")))
		missing.push(`no provider credentials at ${join(REAL_HOME, ".credentials.yaml")} (DSH_E2E_LIVE=1 needs a real model turn)`)
	// 025-w3-2: the podman container suite (e2e/run-e2e.sh + e2e/scenarios/) is
	// retired — its still-valid coverage was taken over by families/verify70/
	// unit tests before deletion (.proof/025-w3-2/01-legacy-retirement/).
	// No podman/bash prerequisite is required by the e2e tier any more.
	return missing
}

const requireEnv = (kind) => {
	const missing = envMissing(kind)
	if (missing.length === 0) return true
	console.error(`\ntest:${kind}: environment missing — NOT RUN (this is not a pass):`)
	for (const item of missing) console.error(`  - ${item}`)
	console.error(`\nInstall the missing prerequisites, then re-run: bun run test:${kind}`)
	process.exit(2)
}

const runUi = () => {
	requireEnv("ui")
	banner("test:ui — UI layer (tmux capture + ANSI/geometry)")
	let failed = 0
	failed = keepFirst(failed, run(NODE, ["verify/ui-matrix.mjs"], { cwd: ROOT }))
	failed = keepFirst(failed, run(NODE, ["verify/agents-mount-repro.mjs"], { cwd: ROOT }))
	// Locale text-leak audit: every UI string on real-client frames (en + zh-CN
	// boots, five faces each) is checked against the locale dictionaries — the
	// gate that catches the `t()` fail-open key-on-screen bug shape.
	failed = keepFirst(failed, run(NODE, ["verify/text-leak-audit.mjs"], { cwd: ROOT }))
	return failed
}

const runE2e = () => {
	requireEnv("e2e")
	let failed = 0

	// Offline legs: real client + real resident host, LOCAL fake/mock model.
	// They run on every e2e invocation; DSH_E2E_LIVE never gates them.
	banner("test:e2e — offline legs (real client + real host, local model)")
	failed = keepFirst(failed, run(NODE, ["verify/e2e-flows/run-flows.mjs"], { cwd: ROOT }))
	// steer/queue-repro uses e2e/lib/mock-llm.mjs (no key, no network). It was
	// wrongly hidden behind DSH_E2E_LIVE; it is an offline leg and now always
	// runs here. queue-flush-repro stays on the live leg below.
	failed = keepFirst(failed, run(NODE, ["verify/steer-queue-repro.mjs"], { cwd: ROOT }))

	// Real-model legs are opt-in. Exit 2 from these legs means ENVIRONMENT /
	// NOT RUN (bad key, 401/429/5xx, timeout): never count it as a pass.
	// With the default (live NOT requested) it does not turn the deterministic
	// tier red for a non-product reason. With DSH_E2E_LIVE=1 the user ASKED for
	// the live legs, so a leg that did not run is a non-green outcome: propagate
	// exit 2 instead of settling for INCOMPLETE/exit 0.
	const runLiveLeg = (label, cmd, args, opts) => {
		const status = run(cmd, args, opts)
		if (status === 2) {
			markNotRun(label, "environment/provider error (exit 2) — see leg output")
			if (LIVE_ENABLED) failed = keepFirst(failed, status)
		} else if (status !== 0 && failed === 0) failed = status
	}
	if (LIVE_ENABLED) {
		banner("test:e2e — live real model (opt-in: DSH_E2E_LIVE=1)")
		runLiveLeg("verify/remote-live-smoke.mjs", NODE, ["verify/remote-live-smoke.mjs"], { cwd: ROOT })
		runLiveLeg("verify/queue-flush-repro.mjs", NODE, ["verify/queue-flush-repro.mjs"], { cwd: ROOT })
	} else {
		markNotRun("verify/remote-live-smoke.mjs", "opt-in via DSH_E2E_LIVE=1 (real provider key)")
		markNotRun("verify/queue-flush-repro.mjs", "opt-in via DSH_E2E_LIVE=1 (real provider key)")
	}

	// The bun wrapper for the /agents mount gate is wired here, not left as a
	// matrix-only entry. It self-skips without its own flag; print NOT RUN
	// ourselves so the skip is never a silent green.
	if (process.env.DSH_AGENTS_E2E === "1") {
		banner("test:e2e — real-client /agents gate (DSH_AGENTS_E2E=1)")
		const status = run(BUN, ["test", "test/agents-mount-client.test.ts"], { cwd: join(ROOT, "packages/shell") })
		if (status === 2) {
			markNotRun("agents-mount-client.test.ts", "environment error (exit 2)")
			// The user opted in (DSH_AGENTS_E2E=1): an exit 2 means NOT RUN, so it
			// must make the tier nonzero too — never a silent green.
			if (failed === 0) failed = status
		} else if (status !== 0 && failed === 0) failed = status
	} else {
		markNotRun("agents-mount-client.test.ts", "opt-in via DSH_AGENTS_E2E=1 (CI self-hosted gate)")
	}

	// 025-w3-2: the container suite is retired (old e2e/scenarios/ podman
	// layer). Its still-valid coverage is taken over by the host families /
	// verify70 / unit gates and the CI pack-cold-start job — see
	// .proof/025-w3-2/01-legacy-retirement/takeover-table.md. NOT RUN here is
	// NOT a pass and is not counted.
	markNotRun("retired container suite", "025-w3-2: legacy e2e/scenarios offlined (no podman leg)")
	return failed
}

const printMatrix = () => {
	const tiers = classify()
	for (const name of ["unit", "ft", "ui", "e2e"]) {
		const files =
			name === "ui"
				? ["verify/ui-matrix.mjs", "verify/agents-mount-repro.mjs", "verify/text-leak-audit.mjs"]
					: name === "e2e"
						? [
								"verify/e2e-flows/run-flows.mjs", // offline: local fake model
								"verify/steer-queue-repro.mjs", // offline: local mock LLM
								...tiers.e2e, // agents-mount-client.test.ts (DSH_AGENTS_E2E=1)
								"verify/remote-live-smoke.mjs", // live: DSH_E2E_LIVE=1
								"verify/queue-flush-repro.mjs", // live: DSH_E2E_LIVE=1
							]
						: tiers[name]
			console.log(`\n# ${name} (${files.length})`)
			for (const file of files.sort()) console.log(`  ${relative(ROOT, file)}`)
		}
	console.log("\n# e2e leg flags (unset legs are NOT RUN, not passes)")
	console.log("  offline (always): run-flows.mjs (all in-tree scenarios), steer-queue-repro.mjs (mock LLM)")
	console.log("  DSH_E2E_LIVE=1:   verify/remote-live-smoke.mjs, verify/queue-flush-repro.mjs")
	console.log("  DSH_AGENTS_E2E=1: packages/shell/test/agents-mount-client.test.ts")
}

const main = () => {
	const tier = process.argv[2] || "all"
	if (tier === "list") return printMatrix(), 0
	const tiers = classify()
	let failed = 0
	if (tier === "unit" || tier === "all") failed = keepFirst(failed, runBunTier("unit", tiers.unit))
	if (tier === "ft" || tier === "all") failed = keepFirst(failed, runBunTier("ft", tiers.ft))
	if (tier === "ui" || tier === "all") failed = keepFirst(failed, runUi())
	if (tier === "e2e" || tier === "all") failed = keepFirst(failed, runE2e())
	if (!["unit", "ft", "ui", "e2e", "all"].includes(tier)) {
		console.error(`test-tier: unknown tier '${tier}' (unit|ft|ui|e2e|all|list)`)
		return 2
	}
	if (failed) {
		console.error(`\ntest:${tier}: FAILED${notRunLegs.length ? ` (${notRunLegs.length} leg(s) NOT RUN)` : ""}`)
		return failed
	}
	if (notRunLegs.length) {
		// Opt-in / retired legs are explicitly not run: say so in the summary.
		// Exit 0 keeps the default deterministic tier green, but the banner is
		// deliberately NOT "PASS" — a partial run is not a full pass.
		console.log(`\ntest:${tier}: INCOMPLETE — ${notRunLegs.length} leg(s) NOT RUN (see SKIP lines); NOT a full PASS`)
		return 0
	}
	console.log(`\ntest:${tier}: PASS`)
	return 0
}

process.exit(main())
