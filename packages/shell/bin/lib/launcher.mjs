/**
 * Launcher support for bin/dsh-opentui.mjs — the pure parts behind the
 * `--version` / `--force` flags.
 *
 * WHY A SEPARATE MODULE: the bin is a top-level script (importing it would
 * RUN it — provision, spawn, exit). Everything here is a pure function over
 * plain data so the flags can be unit-tested without a dsh, a profile or a
 * running client. The bin stays the only thing that touches the process.
 *
 * The capabilities:
 *   1. `--version` — print `dsh-opentui <version>` and exit 0, BEFORE any
 *      provision/profile work (see the bin's step 0).
 *   2. `--force`   — kill this profile's stale instances (the resident `dsh
 *      host and the bun client) before starting.
 *   3. `upgrade`   — the positional upgrade subcommand: its argv is parsed
 *      here (pure) and dispatched by the bin to scripts/upgrade.mjs. The
 *      subcommand and its flags are consumed by the bin and NEVER forwarded
 *      to the client (which would take them for a session name).
 *
 * SCOPE (requirement: never touch another profile's instances):
 * a candidate is "ours" only when BOTH hold:
 *   - the command line is the host/client shape of the `opentui` profile
 *     (`node <...>/dsh --profile opentui ...` for the host; a bun process
 *     running the client entry for the client). A `dsh plugin --profile
 *     opentui add ...` provision child is NOT a host and never matches.
 *   - the process resolves to the SAME dsh home as this launcher (DSH_HOME
 *     from the process environment, defaulting to ~/.dsh). The profile
 *     instance is identified by (dsh home, profile) — the same key the
 *     host lockfile uses — so a parallel session running the same profile
 *     under a DIFFERENT DSH_HOME is a different instance and is left alone.
 *     NOTE: the DSH_HOME read is a ps-environment lookup, not command-line
 *     matching — if it is deemed over-engineered it can be dropped by
 *     removing the `theirs !== mine` comparison in selectStaleProcesses
 *     (kill selection then degrades to pure command-line matching).
 */
import { readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

/** The one product profile (ADR-0005 decision 3). */
export const PROFILE = 'opentui'

/** The default dsh home when DSH_HOME is unset (mirrors lifecycle.ts). */
export function defaultDshHome() {
	return join(homedir(), '.dsh')
}

/**
 * Split the launcher's argv into the flags the bin consumes itself and the
 * arguments forwarded to the client bundle.
 *
 * `--version` and `--force` are BIN-level flags: they are consumed here and
 * NOT forwarded (the client must never see `--force`).
 */
export function parseLauncherArgs(argv) {
	const args = Array.isArray(argv) ? argv : []
	let version = false
	let force = false
	const rest = []
	for (const arg of args) {
		if (arg === '--version') {
			version = true
			continue
		}
		if (arg === '--force') {
			force = true
			continue
		}
		rest.push(arg)
	}
	return { version, force, rest }
}

/**
 * The launcher's own version — read from its own package.json (the package
 * root is the bin's grandparent directory). Returns undefined when the
 * manifest is missing/unreadable so the caller can report it instead of
 * printing a lie.
 */
export function readLauncherVersion(pkgRoot) {
	try {
		const parsed = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'))
		return typeof parsed?.version === 'string' && parsed.version ? parsed.version : undefined
	} catch {
		return undefined
	}
}

/**
 * Parse `ps -A -o pid=,ppid=,command=` output into process rows.
 *
 * @returns [{ pid, ppid, command }]
 */
export function parseProcessRows(psOutput) {
	const rows = []
	for (const line of String(psOutput ?? '').split('\n')) {
		const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
		if (!match) continue
		rows.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] })
	}
	return rows
}

/**
 * Parse `ps eww -A -o pid=,args=` output into a pid → DSH_HOME map.
 *
 * The environment is appended AFTER the command line, so the LAST
 * `DSH_HOME=` token on the line is the environment's own copy (a command
 * line that mentions DSH_HOME= itself therefore still resolves correctly).
 * A pid without DSH_HOME in its environment uses the default home.
 */
export function parseProcessHomes(psEwwOutput) {
	const homes = new Map()
	for (const line of String(psEwwOutput ?? '').split('\n')) {
		const trimmed = line.trim()
		if (!trimmed) continue
		const pid = Number(trimmed.split(/\s+/)[0])
		if (!Number.isInteger(pid) || pid <= 0) continue
		const tokens = trimmed.split(/\s+/)
		let home
		for (let i = tokens.length - 1; i >= 1; i--) {
			if (tokens[i].startsWith('DSH_HOME=')) {
				home = tokens[i].slice('DSH_HOME='.length)
				break
			}
		}
		homes.set(pid, home)
	}
	return homes
}

/**
 * Classify a process command line.
 *
 * @returns 'host' | 'client' | null
 *   host   — the resident dsh host of the opentui profile
 *   client — a dsh-opentui client process (source tree entry or the
 *            published bundle)
 *   null   — anything else (the shell/tmux wrapper, a `dsh plugin ...`
 *            provision run, a grep over these paths, another profile).
 */
export function classifyProcess(command) {
	const tokens = String(command ?? '')
		.split(/\s+/)
		.filter(Boolean)
	if (tokens.length === 0) return null

	const exe = basename(tokens[0])
	// Only a real runtime may be the process itself — a shell that merely
	// mentions these paths (`sh -c "dsh --profile opentui"`, a tmux command
	// line) is NOT the host.
	if (exe !== 'node' && exe !== 'bun' && exe !== 'dsh') return null

	// The host: the dsh binary IS the process or sits right after the
	// runtime (node/bun + script), and is followed by `--profile opentui`.
	// Only the first two tokens may be the dsh binary — a wrapper script
	// (`node wrapper.js dsh --profile opentui`) merely MENTIONS it.
	for (let i = 0; i < Math.min(tokens.length, 2); i++) {
		if (basename(tokens[i]) !== 'dsh') continue
		const next = tokens[i + 1]
		if (next === '--profile' && tokens[i + 2] === PROFILE) return 'host'
		if (next === `--profile=${PROFILE}`) return 'host'
		// `dsh plugin --profile opentui add ...` (provision) and
		// `dsh opentui --dump-config` are not the host.
		return null
	}

	// The client: the published bundle (`dist/client/index.js`) or the
	// source-tree entry (`client-entry.tsx`).
	for (const token of tokens) {
		if (token.endsWith('client-entry.tsx')) return 'client'
		if (token.endsWith('dist/client/index.js')) return 'client'
	}
	return null
}

/** Normalize a home path for comparison (absolute, symlinks resolved when
 *  the path exists — macOS maps /tmp to /private/tmp). */
export function normalizeHome(path) {
	if (!path) return undefined
	let out = resolve(path)
	try {
		out = realpathSync(out)
	} catch {
		/* not present on disk — the resolved path is what we compare */
	}
	return out
}

/**
 * Pick the stale instances that belong to THIS profile instance.
 *
 * @param rows  [{ pid, ppid, command }]
 * @param homes pid → DSH_HOME (from `ps eww`)
 * @param home  the launcher's own dsh home
 * @param excludePids pids that must never be killed (this process, its
 *        ancestors) — killing the launcher would kill the kill.
 */
export function selectStaleProcesses(rows, { homes = new Map(), home, excludePids = [] } = {}) {
	const excluded = new Set(excludePids.filter((pid) => typeof pid === 'number'))
	const mine = normalizeHome(home || defaultDshHome())
	const stale = []
	for (const row of rows ?? []) {
		if (!row || typeof row.pid !== 'number') continue
		if (excluded.has(row.pid)) continue
		const kind = classifyProcess(row.command)
		if (!kind) continue
		const theirs = normalizeHome(homes.get(row.pid) || defaultDshHome())
		if (theirs !== mine) continue
		stale.push({ pid: row.pid, kind })
	}
	return stale
}

/** The pids of this process and its ancestors — never kill targets. */
export function ancestorPids(rows, selfPid) {
	const byPid = new Map((rows ?? []).map((row) => [row.pid, row.ppid]))
	const chain = []
	let pid = selfPid
	for (let i = 0; i < 64 && typeof pid === 'number' && pid > 0; i++) {
		chain.push(pid)
		const parent = byPid.get(pid)
		if (parent === undefined || parent === pid) break
		pid = parent
	}
	return chain
}

/**
 * TERM every target, wait for the grace window, then KILL the survivors.
 * The injected `kill`/`sleep`/`isAlive` keep this testable without signals.
 */
export async function killStaleProcesses(targets, options = {}) {
	const {
		kill = (pid, signal) => process.kill(pid, signal),
		sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
		isAlive = (pid) => {
			try {
				process.kill(pid, 0)
				return true
			} catch {
				return false
			}
		},
		termWaitMs = 2000,
		killWaitMs = 500,
		pollMs = 50,
	} = options

	const pids = (targets ?? []).map((t) => t.pid)
	if (pids.length === 0) return { terminated: 0, killed: 0, survivors: [] }

	for (const pid of pids) {
		try {
			kill(pid, 'SIGTERM')
		} catch {
			/* already gone */
		}
	}

	const termDeadline = Date.now() + termWaitMs
	while (Date.now() < termDeadline) {
		if (pids.every((pid) => !isAlive(pid))) break
		await sleep(pollMs)
	}

	const survivors = pids.filter((pid) => isAlive(pid))
	for (const pid of survivors) {
		try {
			kill(pid, 'SIGKILL')
		} catch {
			/* already gone */
		}
	}
	if (survivors.length > 0) {
		const killDeadline = Date.now() + killWaitMs
		while (Date.now() < killDeadline) {
			if (survivors.every((pid) => !isAlive(pid))) break
			await sleep(pollMs)
		}
	}
	return {
		terminated: pids.length,
		killed: survivors.length,
		survivors: survivors.filter((pid) => isAlive(pid)),
	}
}

/** The dist-tag `upgrade` resolves against when none is given. */
export const UPGRADE_DEFAULT_TAG = 'latest'
// The tag becomes an argv value for `npm view` and must never be able to look
// like a flag or carry shell/URL syntax: npm dist-tags are [A-Za-z0-9._-].
const TAG_PATTERN = /^[A-Za-z0-9._-]+$/

/**
 * Parse the argv of the `upgrade` subcommand.
 *
 * The subcommand is POSITIONAL and must be the first argument the launcher
 * sees after `parseLauncherArgs` consumed `--version`/`--force`. A `upgrade`
 * anywhere else (`foo upgrade`, `--model upgrade`) is NOT the subcommand: the
 * argument vector is forwarded to the client exactly as before (requirement:
 * an old release silently ignores a stray positional, and this release must
 * not turn that into an error).
 *
 * `--force` is deliberately absent here — `parseLauncherArgs` consumes it
 * before this function runs, so it can never reach an upgrade flag parse. The
 * bin rejects the `--force upgrade` combination itself (a usage error).
 *
 * Unknown flags are reported once as `error: 'unknown-flag'` with the offending
 * tokens in `unknownFlags`; the caller prints the usage and exits 2 without
 * doing anything. `--reset-overrides` is a terminal action and is incompatible
 * with every flag that shapes an upgrade (`--no-self`/`--no-plugins`/`--yes`
 * and a non-default `--tag`): combining them would silently ignore one intent.
 *
 * @param {string[]} argv arguments after the bin-level flags
 * @returns {{ isUpgrade: boolean, opts: {
 *   dryRun: boolean, yes: boolean, tag: string, noSelf: boolean,
 *   noPlugins: boolean, resetOverrides: boolean, help: boolean,
 * }, error: null | 'unknown-flag' | 'missing-tag-value' | 'invalid-tag' |
 *   'reset-overrides-conflict', unknownFlags?: string[], invalidTag?: string }}
 */
export function parseUpgradeArgs(argv) {
	const args = Array.isArray(argv) ? argv : []
	const opts = {
		dryRun: false,
		yes: false,
		tag: UPGRADE_DEFAULT_TAG,
		noSelf: false,
		noPlugins: false,
		resetOverrides: false,
		help: false,
	}
	// Positional contract: only argv[0] selects the subcommand.
	if (args[0] !== 'upgrade') return { isUpgrade: false, opts, error: null }

	const unknownFlags = []
	// Presence, not value: `--reset-overrides --tag latest` is still two
	// intents, and the conflict report must not depend on the tag's spelling.
	let tagGiven = false
	for (let i = 1; i < args.length; i++) {
		const arg = args[i]
		if (arg === '--dry-run') {
			opts.dryRun = true
		} else if (arg === '-y' || arg === '--yes') {
			opts.yes = true
		} else if (arg === '--no-self') {
			opts.noSelf = true
		} else if (arg === '--no-plugins') {
			opts.noPlugins = true
		} else if (arg === '--reset-overrides') {
			opts.resetOverrides = true
		} else if (arg === '-h' || arg === '--help') {
			opts.help = true
		} else if (arg === '--tag') {
			const value = args[i + 1]
			if (value === undefined || value.startsWith('-')) {
				return { isUpgrade: true, opts, error: 'missing-tag-value' }
			}
			if (!TAG_PATTERN.test(value)) {
				return { isUpgrade: true, opts, error: 'invalid-tag', invalidTag: value }
			}
			opts.tag = value
			tagGiven = true
			i++
		} else if (arg.startsWith('--tag=')) {
			const value = arg.slice('--tag='.length)
			if (value === '') return { isUpgrade: true, opts, error: 'missing-tag-value' }
			if (!TAG_PATTERN.test(value)) {
				return { isUpgrade: true, opts, error: 'invalid-tag', invalidTag: value }
			}
			opts.tag = value
			tagGiven = true
		} else {
			unknownFlags.push(arg)
		}
	}

	if (unknownFlags.length > 0) {
		return { isUpgrade: true, opts, error: 'unknown-flag', unknownFlags }
	}
	if (opts.resetOverrides && (opts.noSelf || opts.noPlugins || opts.yes || tagGiven)) {
		return { isUpgrade: true, opts, error: 'reset-overrides-conflict' }
	}
	return { isUpgrade: true, opts, error: null }
}

/** Usage text for `dsh-opentui upgrade` (also the `--help` body). Plain text,
 *  one flag per line; the exit-code block is part of the contract. */
export function formatUpgradeUsage() {
	return [
		'dsh-opentui upgrade — upgrade the launcher and the opentui profile plugins',
		'',
		'Usage: dsh-opentui upgrade [options]',
		'',
		'Options:',
		'  --dry-run             print the plan and exit; write nothing',
		'  -y, --yes             do not ask for confirmation',
		'  --tag <name>          dist-tag to resolve (default: latest)',
		'  --no-self             skip the dsh-opentui launcher itself',
		'  --no-plugins          skip the opentui profile plugins',
		'  --reset-overrides     delete upgrade-overrides.json and exit (terminal;',
		'                        conflicts with --no-self/--no-plugins/--yes/--tag)',
		'  -h, --help            print this help and exit',
		'',
		'Exit codes:',
		'  0  already up to date, nothing to do, --dry-run, or --help',
		'  1  hard failure (e.g. self-upgrade did not verify); profile untouched/rolled back',
		'  2  usage error, or another upgrade is already running (profile lock held)',
		'  3  partial: a package did not reach the target version, or overrides could not be recorded',
	].join('\n')
}
