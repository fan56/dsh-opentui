/**
 * Same-port host restart for /reload (ADR-0005 bucket (b) wave 3; audit
 * row 29 + gap 2).
 *
 * No remote live-plugin reload exists (pluginManager offers
 * install/enable/remove; applying a plugin change to a running tree needs
 * a host restart — audit gap 2). The ADR-0005 user decision is the
 * workaround: restart the host and let the TUI auto-reconnect. The
 * connection carrier (P1's ClientConnection) keeps retrying its authority
 * forever, and the wave-2 re-attach machinery re-opens the follow and
 * replays the missed durable rows — so the ONLY thing a restart must
 * guarantee is that the SAME authority (host:port) comes back. This module
 * restarts the host in place, on the same port:
 *
 * 1. read the lifecycle lockfile (`<dshHome>/opentui-host.<profile>.json`,
 *    the single-instance contract of lifecycle.ts) for pid + port;
 * 2. SIGTERM the pid (SIGKILL escalation, terminateHost parity);
 * 3. remove the stale lockfile (it described the dead pid; the next
 *    ensureHost boots fresh — this path does not fake a managed handle);
 * 4. respawn `dsh --profile <p> --no-open --port <same>` detached;
 * 5. wait for the listener (lifecycle's isListening probe) and re-mint
 *    the owner cookie (cookie-mint, with the first-boot grant retry
 *    window — lifecycle's mintCookieWithRetry parity).
 *
 * Port-reuse race (documented): between SIGTERM-completion and the fresh
 * listener, another process could bind the port — a narrow local window,
 * accepted for v1; the full lifecycle-managed restart (dispose +
 * ensureHost + a new ClientConnection at the ShellHostDeps injection
 * point) remains the P3 rendering-decouple path, and RemoteHostSession
 * accepts a `restartHost` override seam for exactly that.
 *
 * Cookie persistence (documented): the carrier holds the cookie it was
 * constructed with. The grant record in `<dshHome>/.credentials.yaml`
 * survives a restart, so the carrier's cookie stays valid against the
 * fresh host; this module still re-mints (same authority, current grant)
 * and returns the header for the P3 swap path. A deployment that ROTATES
 * the browser-session grant on every boot would need the P3 swap — not
 * observed on this host version.
 */

import { spawn } from "node:child_process"
import { existsSync, readFileSync, rmSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { isListening, pidAlive, type HostChildProcess, type SpawnDsh } from "./lifecycle.ts"
import { resolveDshHome } from "./remote-local-fs.ts"

/** The owner-cookie mint (cookie-mint.ts contract). */
export type RestartMintCookie = (opts: { home: string; authority: string; maxAgeMs?: number }) => string

/** Typed restart failure (message names the step). */
export class HostRestartError extends Error {
	readonly code: string
	constructor(code: string, message: string) {
		super(message)
		this.name = "HostRestartError"
		this.code = code
	}
}

export interface SamePortRestartOptions {
	/** Host profile (default `opentui` — the ADR-0005 product profile). */
	profile?: string
	/** dsh home (default $DSH_HOME or ~/.dsh). */
	dshHome?: string
	/** Injectable spawn (tests); default: real `dsh` from PATH, detached. */
	spawnDsh?: SpawnDsh
	/** Injectable cookie mint (tests); default: ./cookie-mint.ts. */
	mintCookie?: RestartMintCookie
	/** Listener-wait budget (default 30_000). */
	readinessTimeoutMs?: number
}

export interface SamePortRestartResult {
	/** `127.0.0.1:<port>` — unchanged from before the restart. */
	authority: string
	port: number
	/** Freshly minted Cookie header for the fresh host. */
	cookieHeader: string
	/** The new host process id. */
	pid: number
}

const KILL_GRACE_MS = 5_000
const KILL_ESCALATE_MS = 2_000
/** Extra seconds for the OS to release the dying host's listening socket. */
const LISTEN_RELEASE_GRACE_MS = 3_000
const POLL_MS = 200
const COOKIE_RETRY_BUDGET_MS = 15_000
const COOKIE_RETRY_INTERVAL_MS = 250
/** Mint failures meaning "the fresh host has not written its grant yet". */
const RETRYABLE_MINT_ERRORS = new Set(["CredentialsFileMissingError", "CredentialsGrantMissingError"])

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function defaultSpawnDsh(argv: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): HostChildProcess {
	const child = spawn("dsh", argv, {
		cwd: options.cwd,
		env: options.env,
		detached: true, // resident host must survive this client process
		stdio: ["ignore", "pipe", "pipe"],
	})
	child.unref()
	for (const pipe of [child.stdout, child.stderr]) {
		;(pipe as unknown as { unref?: () => void }).unref?.()
	}
	return child as unknown as HostChildProcess
}

/**
 * Restart the resident host of `<dshHome>`/`<profile>` ON THE SAME PORT so
 * an existing client carrier reconnects without re-pointing. See the
 * module header for the contract and the documented races.
 */
export async function restartSamePortHost(options: SamePortRestartOptions = {}): Promise<SamePortRestartResult> {
	const profile = options.profile ?? "opentui"
	const home = resolveDshHome(options.dshHome)
	const lockPath = join(home, `opentui-host.${profile}.json`)

	// 1. the lockfile is the single-instance contract: pid + port.
	interface Lock {
		pid: number
		port: number
	}
	let lock: Lock | undefined
	try {
		const raw = JSON.parse(readFileSync(lockPath, "utf8")) as Partial<Lock>
		if (typeof raw.pid === "number" && typeof raw.port === "number") lock = { pid: raw.pid, port: raw.port }
	} catch {
		/* missing or corrupt → nothing we manage */
	}
	if (lock === undefined) {
		throw new HostRestartError("no-lock", `no host lockfile at ${lockPath} — nothing to restart (is the host lifecycle-managed?)`)
	}
	const { pid, port } = lock

	// 2. stop the old host (terminateHost escalation parity). The dsh bin is
	//    a node wrapper that may hold the server in a child — signal the
	//    whole PROCESS GROUP (the detached spawn made the wrapper a group
	//    leader), falling back to the single pid.
	const deadline = (ms: number) => Date.now() + ms
	let waitUntil = deadline(KILL_GRACE_MS)
	try {
		process.kill(-pid, "SIGTERM")
	} catch {
		try {
			process.kill(pid, "SIGTERM")
		} catch {
			/* already gone */
		}
	}
	while (pidAlive(pid) && Date.now() < waitUntil) await sleep(POLL_MS)
	if (pidAlive(pid)) {
		try {
			process.kill(-pid, "SIGKILL")
		} catch {
			try {
				process.kill(pid, "SIGKILL")
			} catch {
				/* gone */
			}
		}
		waitUntil = deadline(KILL_ESCALATE_MS)
		while (pidAlive(pid) && Date.now() < waitUntil) await sleep(POLL_MS)
	}

	// 3. the lockfile described a dead pid — clear it (never clobbers a
	//    newer host's lock: we verified pid/port above and just killed it).
	try {
		const current = JSON.parse(readFileSync(lockPath, "utf8")) as Partial<Lock>
		if (current.pid === pid && current.port === port) rmSync(lockPath, { force: true })
	} catch {
		try {
			unlinkSync(lockPath)
		} catch {
			/* nothing to clear */
		}
	}

	// 4. wait for the port to go QUIET before respawning: pid death precedes
	//    socket release, and a readiness probe against the DYING host's
	//    listener would answer success spuriously (the respawn would then
	//    fail EADDRINUSE or bind late).
	const quietDeadline = deadline(KILL_GRACE_MS + KILL_ESCALATE_MS + LISTEN_RELEASE_GRACE_MS)
	while ((await isListening(port)) && Date.now() < quietDeadline) await sleep(POLL_MS)
	if (await isListening(port)) {
		throw new HostRestartError("port-held", `port ${port} is still held after the old host died — refusing to spawn into EADDRINUSE`)
	}

	// 5. respawn on the SAME port, detached (bootHost argv parity).
	const profileDir = join(home, "profiles", profile)
	if (!existsSync(profileDir)) {
		throw new HostRestartError("profile-missing", `profile '${profile}' is not provisioned (${profileDir} missing)`)
	}
	const spawnDsh = options.spawnDsh ?? defaultSpawnDsh
	const child = spawnDsh(["--profile", profile, "--no-open", "--port", String(port)], {
		cwd: profileDir,
		env: { ...process.env, DSH_HOME: home },
	})

	// 6. wait for the listener, then re-mint the cookie for the same authority.
	const budget = options.readinessTimeoutMs ?? 30_000
	const listenDeadline = deadline(budget)
	while (Date.now() < listenDeadline) {
		if (await isListening(port)) break
		await sleep(POLL_MS)
	}
	if (!(await isListening(port))) {
		throw new HostRestartError("boot-timeout", `restarted dsh host did not listen on ${port} within ${budget}ms`)
	}
	const authority = `127.0.0.1:${port}`
	const cookieHeader = await mintWithRetry(options.mintCookie, home, authority)
	return { authority, port, cookieHeader, pid: child.pid }
}

/** Owner-cookie mint with the first-boot grant retry (lifecycle parity). */
async function mintWithRetry(mint: RestartMintCookie | undefined, home: string, authority: string): Promise<string> {
	let mintFn = mint
	if (mintFn === undefined) {
		const mod = (await import("./cookie-mint.ts")) as { mintOwnerCookie?: RestartMintCookie }
		if (typeof mod.mintOwnerCookie !== "function") {
			throw new HostRestartError("mint-unavailable", "mintOwnerCookie is unavailable: ./cookie-mint.ts failed to load")
		}
		mintFn = mod.mintOwnerCookie
	}
	const retryDeadline = Date.now() + COOKIE_RETRY_BUDGET_MS
	for (;;) {
		try {
			return mintFn({ home, authority })
		} catch (error) {
			const retryable = error instanceof Error && RETRYABLE_MINT_ERRORS.has(error.name)
			if (!retryable || Date.now() >= retryDeadline) throw error
			await sleep(COOKIE_RETRY_INTERVAL_MS)
		}
	}
}
