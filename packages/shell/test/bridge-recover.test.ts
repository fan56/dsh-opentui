/**
 * A3 — transport recovery (same-instance respawn + three-check re-handshake).
 *
 * A fresh fake child is returned on EVERY spawn call (unlike the framing tests
 * which reuse one child), so a respawn cannot accidentally inherit the dead
 * child's stdout listeners. The clock is injected to exercise the 5s cooldown
 * without sleeping.
 */
import { describe, expect, test } from "bun:test"
import { PassThrough } from "node:stream"
import {
	type BridgeEventFrame,
} from "../src/client/bridge-session-seam.ts"
import {
	StdioBridgeTransport,
	type BridgeSpawnFn,
	type BridgeTransportState,
	type SpawnedBridgeChild,
} from "../src/client/bridge-transport.ts"

interface TestChild {
	stdout: PassThrough
	stderr: PassThrough
	writes: string[]
	killCount: number
	emitExit(code: number, signal?: string | null): void
	emitError(err: Error): void
	reply(id: number, result: unknown): void
}

interface TestHarness {
	spawnFn: BridgeSpawnFn
	children: TestChild[]
	spawnArgs: { command: string; args: readonly string[]; env: NodeJS.ProcessEnv }[]
	failNextSpawn(err: Error): void
}

function fakeSpawn(): TestHarness {
	const children: TestChild[] = []
	const spawnArgs: TestHarness["spawnArgs"] = []
	let nextFailure: Error | undefined
	const spawnFn: BridgeSpawnFn = (command, args, options) => {
		spawnArgs.push({ command, args, env: options.env })
		if (nextFailure !== undefined) {
			const err = nextFailure
			nextFailure = undefined
			throw err
		}
		const stdout = new PassThrough()
		const stderr = new PassThrough()
		const writes: string[] = []
		const lifecycle: Record<string, ((arg: never) => void)[]> = {}
		let killCount = 0
		const child: SpawnedBridgeChild = {
			stdin: {
				write(chunk: string) {
					writes.push(chunk)
					return true
				},
			},
			stdout,
			stderr,
			on(event, listener) {
				;(lifecycle[event] ??= []).push(listener as (arg: never) => void)
				return child
			},
			kill() {
				killCount++
				return true
			},
		}
		children.push({
			stdout,
			stderr,
			writes,
			get killCount() { return killCount },
			emitExit(code, signal) {
				for (const listener of lifecycle.exit ?? []) listener(code as never, signal as never)
			},
			emitError(err) {
				for (const listener of lifecycle.error ?? []) listener(err as never)
			},
			reply(id, result) {
				stdout.write(`${JSON.stringify({ id, ok: true, result })}\n`)
			},
		})
		return child
	}
	return { spawnFn, children, spawnArgs, failNextSpawn: (err) => { nextFailure = err } }
}

const OK_HELLO = { protocolVersion: 1, bridgeVersion: "0.1.0", hostVersion: "0.2.2-rc.4" }

function deadTransport(harness: TestHarness) {
	const clock = { now: 0 }
	const states: BridgeTransportState[] = []
	const frames: BridgeEventFrame[] = []
	const t = new StdioBridgeTransport({
		spawnFn: harness.spawnFn,
		now: () => clock.now,
		recoverCooldownMs: 5_000,
		onStateChange: (state) => states.push(state),
	})
	t.onEvent((frame) => frames.push(frame))
	void t.request("bridge.ping").catch(() => { /* expected on exit */ })
	harness.children[0]!.emitExit(1)
	return { t, clock, states, frames }
}

describe("A3 recover(): state transitions + respawn + three-check handshake", () => {
	test("DEAD → recover() → RECOVERING→HANDSHAKE→READY, respawning with the same argv/env", async () => {
		const h = fakeSpawn()
		const { t, clock, states } = deadTransport(h)
		expect(t.state).toBe("dead")
		expect(t.attempts).toBe(1)

		clock.now = 5_000
		const p = t.recover()
		// recover() runs synchronously up to the awaited hello reply.
		expect(t.state).toBe("handshake")
		expect(states).toContain("recovering")
		expect(states).toContain("handshake")
		expect(h.children).toHaveLength(2)
		expect(h.spawnArgs[1]?.command).toBe(h.spawnArgs[0]?.command)
		expect(h.spawnArgs[1]?.args).toEqual(h.spawnArgs[0]?.args)
		expect(h.spawnArgs[1]?.env.DSH_HOME).toBe(h.spawnArgs[0]?.env.DSH_HOME)
		expect(h.spawnArgs[1]?.env.DSH_OPENTUI_BRIDGE_STDIO).toBe("1")
		expect(h.children[1]!.writes[0]).toContain('"method":"bridge.hello"')

		h.children[1]!.reply(1, OK_HELLO)
		await p
		expect(t.state).toBe("ready")
		expect(states.at(-1)).toBe("ready")
		expect(t.deadCause).toBeUndefined()
	})

	test("respawn failure → DEAD, attempts increments, deadCause.stage=spawn", async () => {
		const h = fakeSpawn()
		const { t, clock } = deadTransport(h)
		clock.now = 5_000
		h.failNextSpawn(new Error("spawn dsh ENOENT"))
		await expect(t.recover()).rejects.toThrow("spawn dsh ENOENT")
		expect(t.state).toBe("dead")
		expect(t.attempts).toBe(2)
		expect(t.deadCause).toMatchObject({
			stage: "spawn", code: null, signal: null, message: "spawn dsh ENOENT",
		})
	})

	const mismatches = [
		{
			name: "protocolVersion",
			hello: { protocolVersion: 999, bridgeVersion: "0.1.0", hostVersion: "0.2.2-rc.4" },
			code: "VERSION_INCOMPATIBLE",
			needle: "protocolVersion mismatch",
		},
		{
			name: "fingerprint",
			hello: { protocolVersion: 1, hostVersion: "0.2.2-rc.4" },
			code: "FINGERPRINT_MISSING",
			needle: "bridgeVersion",
		},
		{
			name: "host-compat",
			hello: { protocolVersion: 1, bridgeVersion: "0.1.0", hostVersion: "0.3.0" },
			code: "HOST_INCOMPATIBLE",
			needle: "outside the supported window",
		},
	] as const

	for (const c of mismatches) {
		test(`handshake ${c.name} mismatch → DEAD + PERMANENT + concrete reason`, async () => {
			const h = fakeSpawn()
			const { t, clock, frames } = deadTransport(h)
			clock.now = 5_000
			const p = t.recover()
			h.children[1]!.reply(1, c.hello)
			await expect(p).rejects.toThrow(c.needle)

			expect(t.state).toBe("dead")
			expect(t.attempts).toBe(2)
			expect(t.deadCause?.stage).toBe("handshake")
			expect(t.deadCause?.recoverability).toBe("permanent")
			expect(t.deadCause?.mismatches).toEqual([c.code])
			expect(t.deadCause?.message).toContain(c.needle)
			const deadFrames = frames.filter((frame) => frame.type === "bridge.dead")
			expect(deadFrames.at(-1)?.payload).toMatchObject({
				stage: "handshake", recoverability: "permanent", mismatches: [c.code],
			})
		})
	}

	test("recover() inside the 5s cooldown is refused; allowed at the boundary", async () => {
		const h = fakeSpawn()
		const { t, clock } = deadTransport(h) // DEAD at now=0
		clock.now = 4_999
		await expect(t.recover()).rejects.toMatchObject({ code: "BRIDGE_RECOVERY_COOLDOWN" })
		expect(t.state).toBe("dead")
		expect(h.children).toHaveLength(1)

		clock.now = 5_000
		const p = t.recover()
		h.children[1]!.reply(1, OK_HELLO)
		await p
		expect(t.state).toBe("ready")
	})

	test("recover() after close() is refused (closed is terminal)", async () => {
		const h = fakeSpawn()
		const t = new StdioBridgeTransport({ spawnFn: h.spawnFn })
		void t.request("bridge.ping").catch(() => { /* expected on close */ })
		t.close()
		expect(t.state).toBe("closed")
		await expect(t.recover()).rejects.toMatchObject({ code: "BRIDGE_CLOSED" })
		expect(t.state).toBe("closed")
		expect(h.children).toHaveLength(1)
	})

	test("ordinary request() during recovery is rejected with BRIDGE_RECOVERING", async () => {
		const h = fakeSpawn()
		const { t, clock } = deadTransport(h)
		clock.now = 5_000
		const p = t.recover()
		await expect(t.request("session.list")).rejects.toMatchObject({ code: "BRIDGE_RECOVERING" })
		// Only the transport's own handshake frame was written on the new child.
		expect(h.children[1]!.writes).toHaveLength(1)
		h.children[1]!.reply(1, OK_HELLO)
		await p
		expect(t.state).toBe("ready")
	})

	test("recover() while not DEAD is refused with BRIDGE_NOT_DEAD", async () => {
		const h = fakeSpawn()
		const t = new StdioBridgeTransport({ spawnFn: h.spawnFn })
		await expect(t.recover()).rejects.toMatchObject({ code: "BRIDGE_NOT_DEAD" })
		expect(t.state).toBe("initializing")
		expect(h.children).toHaveLength(0)
	})
})
