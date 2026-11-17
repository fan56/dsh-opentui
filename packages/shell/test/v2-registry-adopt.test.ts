// P0-1 integration (the seam the two existing test halves missed):
// launcher writes a v2 `ready` registry → the client attach adopts it
// READ-ONLY → a SECOND startup adopts the SAME host (no spawn, no record
// deletion) → the registry is STILL v2 (no v1 `writeLock` downgrade).
//
// No real host, socket or signal is used: the launcher leg writes a v2
// registry via the real host-registry primitive, and the client leg injects a
// fake `launchHost` seam that mimics host-launch's adopt (read-only).
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	__internals,
	ensureHost,
	ensureV2Host,
	type V2LaunchDeps,
	type V2LaunchResult,
} from '../src/client/lifecycle.ts'
import {
	createClaimRegistry,
	readRegistry,
	registryPath,
	withPhase,
	writeRegistry,
	type HostRegistryV2,
} from '../src/client/host-registry.ts'
import { psKillHooks, registerHeartbeat, runWatchdog } from '../src/client/client-lifecycle.ts'

const PROFILE = 'opentui'
const PORT = 46021
const HOST_PID = 81234

function makeHome(): string {
	return mkdtempSync(join(tmpdir(), 'dsh-v2-adopt-'))
}

/** Launcher leg: atomically write a v2 `ready` record (as host-launch does on
 * the ready transition), using this process as the live pid anchor. */
function launchWritesV2Ready(home: string): HostRegistryV2 {
	const now = new Date().toISOString()
	const ready = withPhase(
		{ ...createClaimRegistry(home, PROFILE, HOST_PID, now), port: PORT, authority: `127.0.0.1:${PORT}` },
		'ready',
		now,
	)
	writeRegistry(home, PROFILE, ready)
	return ready
}

/** Client leg seam: mimic host-launch's healthy-attach fast path — read the
 * v2 record, return an adopted result, WRITE NOTHING. Counts launches so we
 * can assert "no second host was started". */
function adoptOnlyLauncher(calls: V2LaunchDeps[]): (deps: V2LaunchDeps) => Promise<V2LaunchResult> {
	return async (deps) => {
		calls.push(deps)
		const read = readRegistry(deps.home, deps.profile)
		if (read.kind !== 'v2') throw new Error(`launcher saw ${read.kind}, expected v2`)
		return { port: read.value.port, adopted: true, spawned: false, hostPid: read.value.pid }
	}
}

function rawRecord(home: string): Record<string, unknown> {
	return JSON.parse(readFileSync(registryPath(home, PROFILE), 'utf8')) as Record<string, unknown>
}

const homes: string[] = []
afterEach(() => {
	// Drop in-process manager state between "startups" so each boot re-reads
	// the registry from disk instead of reusing a cached handle.
	__internals.registry.clear()
	__internals.pendingBoots.clear()
	for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe('P0-1 v2 registry adopt integration', () => {
	test('launcher writes v2 ready → client ensureV2Host adopts read-only (registry stays v2, no adopt bump)', async () => {
		const home = makeHome()
		homes.push(home)
		const before = launchWritesV2Ready(home)
		const calls: V2LaunchDeps[] = []

		const handle = await ensureV2Host({
			dshHome: home,
			profile: PROFILE,
			mintCookie: () => 'adopt-cookie',
			launchHost: adoptOnlyLauncher(calls),
		})

		expect(handle.v2Managed).toBe(true)
		expect(handle.adopted).toBe(true)
		expect(handle.pid).toBe(HOST_PID)
		expect(handle.port).toBe(PORT)
		expect(calls).toHaveLength(1)

		// The decisive P0-1 assertion: adopting a v2 record must NOT rewrite
		// it as a v1 lock. version/phase/clients survive and no field is bumped.
		const after = readRegistry(home, PROFILE)
		expect(after.kind).toBe('v2')
		if (after.kind === 'v2') {
			expect(after.value).toEqual(before)
			expect(after.value.version).toBe(2)
			expect(after.value.phase).toBe('ready')
			expect(Array.isArray(after.value.clients)).toBe(true)
		}
		const raw = rawRecord(home)
		expect(raw.version).toBe(2)
		expect(raw.startedAt).toBe(before.startedAt)
		expect(raw.updatedAt).toBe(before.updatedAt)
		expect(raw.booting).toBeUndefined() // no v1 placeholder field written
	})

	test('second startup adopts the SAME host — no new launch, no record deletion', async () => {
		const home = makeHome()
		homes.push(home)
		const before = launchWritesV2Ready(home)
		const calls: V2LaunchDeps[] = []
		const launch = adoptOnlyLauncher(calls)

		const first = await ensureV2Host({ dshHome: home, profile: PROFILE, mintCookie: () => 'c', launchHost: launch })
		// Simulate a brand-new client process: drop the in-process manager cache.
		__internals.registry.clear()
		__internals.pendingBoots.clear()
		const second = await ensureV2Host({ dshHome: home, profile: PROFILE, mintCookie: () => 'c', launchHost: launch })

		expect(second.adopted).toBe(true)
		expect(second.pid).toBe(first.pid)
		expect(second.port).toBe(first.port)
		// Both launches adopted; neither spawned a host.
		expect(calls).toHaveLength(2)
		expect(calls.every((c) => c.home === home && c.profile === PROFILE)).toBe(true)
		// The registry record is intact and still v2 after both attaches.
		const after = readRegistry(home, PROFILE)
		expect(after.kind).toBe('v2')
		if (after.kind === 'v2') expect(after.value).toEqual(before)
	})

	test('legacy ensureHost on a v2 registry never runs the v1 boot path or downgrades the record', async () => {
		const home = makeHome()
		homes.push(home)
		const before = launchWritesV2Ready(home)
		let v1SpawnCalled = false

		// A legacy caller (v1 ensureHost) meeting a v2 registry must delegate to
		// the v2 path: the v1 spawnDsh must never fire and the record stays v2.
		const handle = await ensureHost({
			dshHome: home,
			profile: PROFILE,
			mintCookie: () => 'c',
			spawnDsh: () => {
				v1SpawnCalled = true
				throw new Error('v1 spawn must not run against a v2 registry')
			},
			launchHost: adoptOnlyLauncher([]),
		})

		expect(handle.v2Managed).toBe(true)
		expect(v1SpawnCalled).toBe(false)
		const after = readRegistry(home, PROFILE)
		expect(after.kind).toBe('v2')
		if (after.kind === 'v2') {
			expect(after.value).toEqual(before)
			expect(after.value.version).toBe(2)
		}
	})

	test('watchdog reads the v2 registry on the live path (no host-gone self-exit)', async () => {
		const home = makeHome()
		homes.push(home)
		launchWritesV2Ready(home)
		const hb = registerHeartbeat(home, { pid: process.pid, workspace: home })
		hb.start()
		const ticks: { tick: number; freshCount: number; hostPid: number }[] = []
		try {
			const result = await runWatchdog(home, {
				profile: PROFILE,
				maxTicks: 1,
				sleep: async () => {},
				pollMs: 0,
				graceMs: 10,
				hooks: { ...psKillHooks, pidAlive: () => true },
				onTick: (info) => ticks.push(info),
			})
			// A v2 record keeps the watchdog alive: it observes the host and
			// continues (bounded by maxTicks) instead of bailing 'host-gone'.
			expect(result.reason).toBe('max-ticks')
			expect(ticks).toHaveLength(1)
			expect(ticks[0].hostPid).toBe(HOST_PID)
			expect(ticks[0].freshCount).toBeGreaterThan(0)
		} finally {
			hb.stop()
			hb.remove()
		}
	})
})
