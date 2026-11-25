/**
 * Launcher support for bin/dsh-opentui.mjs — the pure parts behind the
 * `--version` / deprecated `--force` / `--yes` flags.
 *
 * WHY A SEPARATE MODULE: the bin is a top-level script (importing it would
 * RUN it — provision, spawn, exit). Everything here is a pure function over
 * plain data so the flags can be unit-tested without a dsh, a profile or a
 * running client. The bin stays the only thing that touches the process.
 *
 * The capabilities:
 *   1. `--version` — print `dsh-opentui <version>` and exit 0, BEFORE any
 *      provision/profile work (see the bin's step 0).
 *   2. `--force` / `--yes` — deprecated no-ops in this in-process-only build.
 *      They remain parsed for compatibility but do not kill or reset anything;
 *      stale-instance cleanup belongs to `--repair-bridge`. Both flags will be
 *      removed in the next minor release.
 *
 * SCOPE (requirement: never touch another profile's instances):
 * a candidate is "ours" only when BOTH hold:
 *   - the command line is the host/client shape of the active in-process
 *     profile (`node <...>/dsh --profile opentui-monday ...` for the host; a
 *     bun process running the client entry for the client). A `dsh plugin
 *     --profile opentui-monday add ...` provision child is NOT a host and
 *     never matches.
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
import { DEFAULT_PROFILE } from '../../scripts/lib/profile-name.mjs'

/** The one active in-process host profile (shared with the provisioner). */
export const PROFILE = DEFAULT_PROFILE

/** The default dsh home when DSH_HOME is unset. */
export function defaultDshHome() {
	return join(homedir(), '.dsh')
}

/**
 * Split the launcher's argv into the flags the bin consumes itself and the
 * arguments forwarded to the client bundle.
 *
 * `-v`/`--version`, `--force` and `--repair-bridge` are BIN-level flags: they
 * are consumed here and NOT forwarded (the client must never see them).
 * `--repair-bridge` is a terminal maintenance command: the bin runs the
 * in-process bridge self-heal and exits without launching the TUI.
 *
 * A standalone `--` ends launcher parsing: every token after it (even one that
 * spells a launcher flag) goes to `passthrough` verbatim and is never
 * interpreted by the bin. `passthrough` is always a string array; it is empty
 * when no separator appears, so callers never have to handle a union type.
 */
export function parseLauncherArgs(argv) {
	const args = Array.isArray(argv) ? argv : []
	let version = false
	let force = false
	let repairBridge = false
	let yes = false
	const rest = []
	const passthrough = []
	let separatorSeen = false
	for (const arg of args) {
		if (separatorSeen) {
			passthrough.push(arg)
			continue
		}
		if (arg === '--') {
			separatorSeen = true
			continue
		}
		if (arg === '--version' || arg === '-v') {
			version = true
			continue
		}
		if (arg === '--force') {
			force = true
			continue
		}
		if (arg === '--repair-bridge') {
			repairBridge = true
			continue
		}
		// Deprecated alongside `--force`; no kill/reset side effect. Consumed by
		// the bin, never forwarded to dsh/the client.
		if (arg === '--yes') {
			yes = true
			continue
		}
		rest.push(arg)
	}
	return { version, force, repairBridge, yes, rest, passthrough }
}

/**
 * Flags the launcher itself consumes before the client starts. Kept here so
 * every flag is validated by exactly one owner: the bin rejects these before
 * the client sees them, and `validateLauncherArgs` ignores them via `skip`.
 */
export const LAUNCHER_TIMEOUT_FLAGS = ['--boot-timeout', '--mux-timeout', '--connect-timeout']

/** Allowed argv tokens/patterns: client launch. */
export const KNOWN_CLIENT_ARGS = [
	'--new',
	'--resume-last',
	'--session',
	'--session=',
]

/**
 * Parse the launcher-only timeout flags out of `rest`.
 *
 * Both `--flag 45` and `--flag=45` are accepted for each flag; the last
 * occurrence of a flag wins. No printing and no exit: errors come back as a
 * marker (`missing-value` / `invalid-value`) plus the offending flag and value
 * so the bin can render its message and usage.
 */
export function parseLauncherOptions(rest) {
	const parsed = {
		bootTimeoutSec: undefined,
		muxTimeoutSec: undefined,
		connectTimeoutSec: undefined,
		error: null,
	}
	const specs = [
		{ flag: '--boot-timeout', key: 'bootTimeoutSec' },
		{ flag: '--mux-timeout', key: 'muxTimeoutSec' },
		{ flag: '--connect-timeout', key: 'connectTimeoutSec' },
	]
	const args = Array.isArray(rest) ? rest : []
	for (let i = 0; i < args.length; i++) {
		const arg = args[i]
		if (arg === '--') break
		let spec
		let value
		for (const candidate of specs) {
			if (arg === candidate.flag) {
				spec = candidate
				value = args[i + 1]
				if (value === undefined) {
					parsed.error = 'missing-value'
					parsed.errorFlag = candidate.flag
					return parsed
				}
				if (value.startsWith('-')) {
					// A negative number IS a supplied value (the user gave one),
					// just an invalid one — report it as such, not as a missing
					// value. A flag-looking token is a genuinely missing value.
					if (/^-\d+$/.test(value)) {
						parsed.error = 'invalid-value'
						parsed.errorFlag = candidate.flag
						parsed.errorValue = value
					} else {
						parsed.error = 'missing-value'
						parsed.errorFlag = candidate.flag
					}
					return parsed
				}
				i++
				break
			}
			if (arg.startsWith(`${candidate.flag}=`)) {
				spec = candidate
				value = arg.slice(candidate.flag.length + 1)
				break
			}
		}
		if (!spec) continue
		if (value === '' || !/^\d+$/.test(value)) {
			parsed.error = value === '' ? 'missing-value' : 'invalid-value'
			parsed.errorFlag = spec.flag
			if (value !== '') parsed.errorValue = value
			return parsed
		}
		const seconds = Number(value)
		if (seconds < 1 || seconds > 3600) {
			parsed.error = 'invalid-value'
			parsed.errorFlag = spec.flag
			parsed.errorValue = value
			return parsed
		}
		parsed[spec.key] = seconds
	}
	return parsed
}

/** Levenshtein distance — small, dependency-free, only used for flag hints. */
function levenshtein(a, b) {
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
	for (let i = 1; i <= a.length; i++) {
		const curr = [i]
		for (let j = 1; j <= b.length; j++) {
			curr[j] = Math.min(
				curr[j - 1] + 1,
				prev[j] + 1,
				prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
			)
		}
		prev = curr
	}
	return prev[b.length]
}

/**
 * Reject unknown launcher-level flags before provisioning runs.
 *
 * Positional tokens and flag values (anything not starting with `-`) are left
 * alone. Tokens after a standalone `--` are never validated. `skip` names
 * launcher flags already consumed elsewhere (the timeout flags), so they are
 * not mistaken for client options. A space-form value-taking flag consumes the
 * token right after it — even one starting with `-` — unless that token is
 * itself a known flag, so `--session -x` is not mistaken for an unknown flag
 * while `--session --new` leaves `--new` to be validated on its own. Each
 * unknown flag may carry a spelling hint when it is at least 3 characters long
 * and within edit distance 2 of a known flag; one-character typos such as `-x`
 * get no misleading hint.
 */
export function validateLauncherArgs(rest, { skip = [] } = {}) {
	const skipped = Array.isArray(skip) ? skip : []
	const knownFlags = [
		'--version',
		'-v',
		'--force',
		'--repair-bridge',
		...LAUNCHER_TIMEOUT_FLAGS,
		'-h',
		'--help',
		...KNOWN_CLIENT_ARGS.filter((known) => !known.endsWith('=')),
	]
	const isKnown = (token) =>
		knownFlags.includes(token) ||
		skipped.some((s) => token === s || token.startsWith(`${s}=`)) ||
		KNOWN_CLIENT_ARGS.some((known) => known.endsWith('=') && token.startsWith(known))
	// Space-form flags whose immediately following token is always their value.
	const valueTaking = ['--session']
	const unknown = []
	const args = Array.isArray(rest) ? rest : []
	for (let i = 0; i < args.length; i++) {
		const arg = args[i]
		if (arg === '--') break
		if (!arg.startsWith('-')) continue
		if (valueTaking.includes(arg)) {
			const next = args[i + 1]
			if (next !== undefined && next !== '--' && !isKnown(next)) i++
			continue
		}
		if (isKnown(arg)) continue
		unknown.push(arg)
	}

	const suggestions = {}
	for (const flag of unknown) {
		if (flag.length < 3) continue
		let best
		let bestDistance = 3
		for (const known of knownFlags) {
			const distance = levenshtein(flag, known)
			if (distance < bestDistance) {
				bestDistance = distance
				best = known
			}
		}
		if (best) suggestions[flag] = best
	}
	return {
		unknown,
		suggestions,
		suggestion: unknown.length > 0 ? suggestions[unknown[0]] : undefined,
	}
}

/**
 * P3-3 — explicit handling of launcher flag combinations that previously fell
 * into dead corners (silently ignored one flag or ran the wrong branch). Pure
 * so the bin's reject/notice decisions are unit-testable without spawning.
 *
 * Returns a conflict code, or null when the combination is fine:
 *   'repair-force'      --repair-bridge + --force → mutually exclusive
 *   'yes-without-force' --yes without --force (under
 *                       --repair-bridge, --yes is tolerated and ignored — the
 *                       repair branch never reads it — and is allowed through)
 */
export function launcherFlagConflict({ force, repairBridge, yes } = {}) {
  if (repairBridge && force) return 'repair-force'
  if (yes && !force && !repairBridge) return 'yes-without-force'
  return null
}

/** Usage text for the normal launcher. */
export function formatUsage() {
	return [
		'dsh-opentui — terminal client for the dsh harness',
		'',
		'Usage: dsh-opentui [options] [-- <client args>]',
		'',
		'Options:',
		'  -v, --version              print the launcher version and exit',
		'  --force                    deprecated no-op; use --repair-bridge to clear stale instances; removed in the next minor release',
		'  --yes                      deprecated no-op; only accepted with --force; use --repair-bridge to clear stale instances; removed in the next minor release',
		'  --repair-bridge            kill stale instances, repair the in-process bridge symlink / manifest, re-verify its identity, then exit (no TUI)',
		'  --boot-timeout <sec>       seconds to wait for the host to cold-start (default: 30; /reload keeps its own 30s)',
		'  --mux-timeout <sec>        seconds to wait for the host mux to serve (default: 20)',
		'  --connect-timeout <sec>    seconds to wait for the first connection (default: 30)',
		'  -h, --help                 print this help and exit',
		'',
		'Commands:',
		'  upgrade [--tag <dist-tag>] [--dry-run]',
		'                             upgrade the launcher package itself (npm global install required;',
		'                             otherwise use npm i -g @aiwayds/dsh-opentui);',
		'                             --dry-run only resolves and prints the command, no install',
		'',
		'Environment:',
		'  DSH_OPENTUI_BOOT_TIMEOUT_MS      host cold-start budget in ms (CLI flag wins)',
		'  DSH_OPENTUI_MUX_TIMEOUT_MS       mux readiness budget in ms (CLI flag wins)',
		'  DSH_OPENTUI_CONNECT_TIMEOUT_MS   first-connect budget in ms (CLI flag wins)',
		'  DSH_UPGRADE_REGISTRY             --registry <url> for both npm view and npm i -g in upgrade',
		'  Precedence: CLI flag > environment variable > default.',
		'',
		'Client options (passed through; put them after -- to skip validation):',
		'  --new, --resume-last, --session <id>',
		'',
		'Exit codes:',
		'  0  success, --version, or --help',
		'  1  launcher startup failure',
		'  2  usage error (unknown option, invalid timeout value)',
		"  other  the client's own exit code is passed through (e.g. 130 on SIGINT)",
	].join('\n')
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
 *   host   — the resident dsh host of the active in-process profile
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
	// mentions these paths (`sh -c "dsh --profile opentui-monday"`, a tmux command
	// line) is NOT the host.
	if (exe !== 'node' && exe !== 'bun' && exe !== 'dsh') return null

	// The host: the dsh binary IS the process or sits right after the
	// runtime (node/bun + script), and is followed by the active profile flag.
	// Only the first two tokens may be the dsh binary — a wrapper script
	// (`node wrapper.js dsh --profile opentui-monday`) merely MENTIONS it.
	for (let i = 0; i < Math.min(tokens.length, 2); i++) {
		if (basename(tokens[i]) !== 'dsh') continue
		const next = tokens[i + 1]
		if (next === '--profile' && tokens[i + 2] === PROFILE) return 'host'
		if (next === `--profile=${PROFILE}`) return 'host'
		// `dsh plugin --profile <active> add ...` (provision) and
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
