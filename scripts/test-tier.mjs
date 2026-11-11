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
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, delimiter, dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const PKGS = join(ROOT, "packages")
const REAL_HOME = process.env.DSH_HOME_REAL || join(homedir(), ".dsh")
const PROFILE = process.env.DSH_UI_PROFILE || "opentui"
const LAUNCHER = join(ROOT, "dsh-opentui")
const SHELL_SDK = join(ROOT, "packages/shell/node_modules/@deepseek-ai/dsh-client-connection")
const NODE = process.env.NODE || process.execPath
const BUN = process.env.BUN || "bun"

// Env-gated real-host tests. They skip without their env flag, so they must
// not be counted by unit/ft (a skip is not a pass); the e2e tier runs them
// with the flag set, where a missing prerequisite becomes a failure.
const LIVE_TESTS = new Set(["agents-mount-client.test.ts", "remote-live-smoke.test.ts"])

// The live (real model / real provider key) e2e legs are OPT-IN: the default
// `bun run test:e2e` is deterministic and key-free (the local e2e-flows fake
// model + the container suite's mock model). An invalid, expired or
// rate-limited provider key must not turn the whole tier red for a reason
// that is not a product regression. DSH_E2E_LIVE=1 includes the real-model
// legs, where they hard-fail.
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
			if (LIVE_TESTS.has(basename(file))) tiers.e2e.push(file)
			else if (isFt(file)) tiers.ft.push(file)
			else tiers.unit.push(file)
		}
	}
	return tiers
}

const banner = (text) => console.log(`\n== ${text} ==`)

const run = (cmd, args, opts = {}) => {
	const result = spawnSync(cmd, args, { stdio: "inherit", ...opts })
	if (result.error) {
		console.error(`test-tier: failed to spawn ${cmd}: ${result.error.message}`)
		return 1
	}
	return result.status ?? 1
}

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
		if (status !== 0) failed = status
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
	if (!existsSync(join(REAL_HOME, "profiles", PROFILE)))
		missing.push(`profile '${PROFILE}' not provisioned under ${REAL_HOME} (run from a machine with a dsh install)`)
	if (!existsSync(SHELL_SDK))
		missing.push(
			`${relative(ROOT, SHELL_SDK)} missing (needs a global dsh install or the CI stub; the client cannot boot without it)`,
		)
	if (kind === "e2e" && LIVE_ENABLED && !existsSync(join(REAL_HOME, ".credentials.yaml")))
		missing.push(`no provider credentials at ${join(REAL_HOME, ".credentials.yaml")} (DSH_E2E_LIVE=1 needs a real model turn)`)
	if (kind === "e2e" && process.env.DSH_E2E_PODMAN !== "0" && !commandExists("podman"))
		missing.push("podman not on PATH (the container e2e suite; set DSH_E2E_PODMAN=0 to run only the local legs — that is a partial result, exit 2)")
	if (!commandExists("bash") && kind === "e2e") missing.push("bash not on PATH (the container e2e driver is a bash script)")
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
	failed = run(NODE, ["verify/ui-matrix.mjs"], { cwd: ROOT }) || failed
	failed = run(NODE, ["verify/agents-mount-repro.mjs"], { cwd: ROOT }) || failed
	return failed
}

const runE2e = () => {
	requireEnv("e2e")
	const podman = process.env.DSH_E2E_PODMAN !== "0"
	let failed = 0

	// Default leg: local flows — real client + real resident host + a local
	// fake model in a per-scenario scratch DSH_HOME. No provider key, no
	// network, so it is the deterministic e2e baseline for every default run.
	banner("test:e2e — local flows (real client + real host + local fake model)")
	failed = run(NODE, ["verify/e2e-flows/run-flows.mjs"], { cwd: ROOT }) || failed

	if (LIVE_ENABLED) {
		banner("test:e2e — live real model (opt-in: DSH_E2E_LIVE=1)")
		failed =
			run(BUN, ["test", "test/remote-live-smoke.test.ts"], {
				cwd: join(ROOT, "packages/shell"),
				env: { ...process.env, DSH_REMOTE_SMOKE: "1", DSH_SMOKE_PROFILE: process.env.DSH_SMOKE_PROFILE || PROFILE },
			}) || failed
		failed = run(NODE, ["verify/steer-queue-repro.mjs"], { cwd: ROOT }) || failed
		failed = run(NODE, ["verify/queue-flush-repro.mjs"], { cwd: ROOT }) || failed
	} else {
		banner("test:e2e — live real model: SKIPPED (opt-in)")
		console.log("SKIP live real-model legs — explicitly NOT RUN, not counted as passed:")
		console.log("  - packages/shell/test/remote-live-smoke.test.ts (host lifecycle, model catalog, real turns)")
		console.log("  - verify/steer-queue-repro.mjs (busy Enter steer/queue + abort)")
		console.log("  - verify/queue-flush-repro.mjs (/flush delivery order)")
		console.log("  reason: opt-in via DSH_E2E_LIVE=1 (needs a valid provider key; the default run stays deterministic)")
	}

	if (podman) {
		banner("test:e2e — container suite (real client + scratch DSH_HOME + mock model)")
		failed = run("bash", ["e2e/run-e2e.sh"], { cwd: ROOT, env: { ...process.env, E2E_FACE: "client" } }) || failed
	} else {
		console.error(
			"\ntest:e2e: container suite disabled by DSH_E2E_PODMAN=0 — NOT RUN (this is not a pass; the container suite is the mock-model baseline)",
		)
		return 2
	}
	return failed
}

const printMatrix = () => {
	const tiers = classify()
	for (const name of ["unit", "ft", "ui", "e2e"]) {
		const files =
			name === "ui"
				? ["verify/ui-matrix.mjs", "verify/agents-mount-repro.mjs"]
				: name === "e2e"
					? ["verify/e2e-flows/run-flows.mjs", ...tiers.e2e, "verify/steer-queue-repro.mjs", "verify/queue-flush-repro.mjs", "e2e/run-e2e.sh"]
					: tiers[name]
		console.log(`\n# ${name} (${files.length})`)
		for (const file of files.sort()) console.log(`  ${relative(ROOT, file)}`)
	}
}

const main = () => {
	const tier = process.argv[2] || "all"
	if (tier === "list") return printMatrix(), 0
	const tiers = classify()
	let failed = 0
	if (tier === "unit" || tier === "all") failed = runBunTier("unit", tiers.unit) || failed
	if (tier === "ft" || tier === "all") failed = runBunTier("ft", tiers.ft) || failed
	if (tier === "ui" || tier === "all") failed = runUi() || failed
	if (tier === "e2e" || tier === "all") failed = runE2e() || failed
	if (!["unit", "ft", "ui", "e2e", "all"].includes(tier)) {
		console.error(`test-tier: unknown tier '${tier}' (unit|ft|ui|e2e|all|list)`)
		return 2
	}
	if (failed) {
		console.error(`\ntest:${tier}: FAILED`)
		return failed
	}
	console.log(`\ntest:${tier}: PASS`)
	return 0
}

process.exit(main())
