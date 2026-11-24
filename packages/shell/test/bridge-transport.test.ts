/**
 * StdioBridgeTransport framing/correlation tests. A fake child process makes
 * the NDJSON wire contract unit-testable without a real dsh host (which is
 * the separate real-machine acceptance task).
 */
import { describe, expect, test } from "bun:test"
import { PassThrough } from "node:stream"
import { DEFAULT_PROFILE } from "../scripts/lib/profile-name.mjs"
import {
	BridgeProtocolError,
	type BridgeEventFrame,
} from "../src/client/bridge-session-seam.ts"
import {
	StdioBridgeTransport,
	type BridgeSpawnFn,
	type SpawnedBridgeChild,
} from "../src/client/bridge-transport.ts"

interface FakeBridge {
	child: SpawnedBridgeChild
	stdout: PassThrough
	stderr: PassThrough
	writes: string[]
	spawnCalls: { command: string; args: readonly string[]; env: NodeJS.ProcessEnv }[]
	killed: () => number
	emitExit: (code: number, signal?: string | null) => void
	emitError: (err: Error) => void
}

function fakeSpawn(): { spawnFn: BridgeSpawnFn; bridge: FakeBridge } {
	const stdout = new PassThrough()
	const stderr = new PassThrough()
	const writes: string[] = []
	const spawnCalls: FakeBridge["spawnCalls"] = []
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
	const spawnFn: BridgeSpawnFn = (command, args, options) => {
		spawnCalls.push({ command, args, env: options.env })
		return child
	}
	return {
		spawnFn,
		bridge: {
			child,
			stdout,
			stderr,
			writes,
			spawnCalls,
			killed: () => killCount,
			emitExit: (code, signal) => {
				for (const listener of lifecycle.exit ?? []) listener(code as never, signal as never)
			},
			emitError: (err) => {
				for (const listener of lifecycle.error ?? []) listener(err as never)
			},
		},
	}
}

describe("StdioBridgeTransport wire contract", () => {
	test("spawns dsh with the inproc profile and stdio switch", async () => {
		const { spawnFn, bridge } = fakeSpawn()
		const t = new StdioBridgeTransport({ spawnFn, dshHome: "/tmp/shared-home" })
		const p = t.request("bridge.ping")
		expect(bridge.spawnCalls).toHaveLength(1)
		expect(bridge.spawnCalls[0]?.command).toBe("dsh")
		expect(bridge.spawnCalls[0]?.args).toEqual(["--profile", DEFAULT_PROFILE])
		expect(bridge.spawnCalls[0]?.env.DSH_OPENTUI_BRIDGE_STDIO).toBe("1")
		expect(bridge.spawnCalls[0]?.env.DSH_HOME).toBe("/tmp/shared-home")
		bridge.stdout.write('{"id":1,"ok":true,"result":{"protocolVersion":1}}\n')
		expect(await p).toEqual({ protocolVersion: 1 })
	})

	test("correlates out-of-order responses to their requests", async () => {
		const { spawnFn, bridge } = fakeSpawn()
		const t = new StdioBridgeTransport({ spawnFn })
		const p1 = t.request("bridge.hello", { protocolVersion: 1 })
		const p2 = t.request("session.list")
		expect(bridge.writes[0]).toContain('"method":"bridge.hello"')
		expect(bridge.writes[0]).toContain('"protocolVersion":1')
		expect(bridge.writes[1]).toContain('"method":"session.list"')
		// reply to id 2 first
		bridge.stdout.write('{"id":2,"ok":true,"result":{"items":[]}}\n')
		bridge.stdout.write('{"id":1,"ok":true,"result":{"protocolVersion":1}}\n')
		expect(await p1).toEqual({ protocolVersion: 1 })
		expect(await p2).toEqual({ items: [] })
	})

	test("error frames reject with BridgeProtocolError carrying code/message/detail", async () => {
		const { spawnFn, bridge } = fakeSpawn()
		const t = new StdioBridgeTransport({ spawnFn })
		const p = t.request("session.open", { mode: "resume", id: "missing" })
		bridge.stdout.write(
			'{"id":1,"ok":false,"error":{"code":"SESSION_NOT_FOUND","message":"no such session","detail":{"id":"missing"}}}\n',
		)
		try {
			await p
			expect.unreachable("must reject")
		} catch (err) {
			expect(err).toBeInstanceOf(BridgeProtocolError)
			const e = err as BridgeProtocolError
			expect(e.code).toBe("SESSION_NOT_FOUND")
			expect(e.message).toBe("no such session")
			expect(e.detail).toEqual({ id: "missing" })
		}
	})

	test("event frames are forwarded; the disposer unsubscribes", async () => {
		const { spawnFn, bridge } = fakeSpawn()
		const t = new StdioBridgeTransport({ spawnFn })
		const events: BridgeEventFrame[] = []
		const off = t.onEvent((e) => events.push(e))
		// Start the child (the stdout pump attaches on first request).
		const boot = t.request("bridge.ping")
		bridge.stdout.write('{"id":1,"ok":true,"result":{}}\n')
		await boot
		bridge.stdout.write('{"type":"turn.start","payload":{"turnId":"t1"}}\n')
		expect(events).toEqual([{ type: "turn.start", payload: { turnId: "t1" } }])
		off()
		bridge.stdout.write('{"type":"turn.end","payload":{"turnId":"t1"}}\n')
		expect(events).toHaveLength(1)
	})

	test("non-JSON host chatter is ignored, not mistaken for a frame", async () => {
		const { spawnFn, bridge } = fakeSpawn()
		const t = new StdioBridgeTransport({ spawnFn })
		const p = t.request("bridge.ping")
		bridge.stdout.write("[dsh-opentui-bridge] stdio protocol active\n")
		bridge.stdout.write('{"id":1,"ok":true,"result":{"ok":true}}\n')
		expect(await p).toEqual({ ok: true })
	})

	test("bridge death rejects all in-flight requests with BRIDGE_DEAD", async () => {
		const { spawnFn, bridge } = fakeSpawn()
		const t = new StdioBridgeTransport({ spawnFn })
		const p = t.request("bridge.ping")
		bridge.emitExit(1)
		try {
			await p
			expect.unreachable("must reject")
		} catch (err) {
			expect(err).toBeInstanceOf(BridgeProtocolError)
			expect((err as BridgeProtocolError).code).toBe("BRIDGE_DEAD")
		}
	})

	test("child exit records a structured deadCause (code/signal/stage=runtime)", () => {
		const { spawnFn, bridge } = fakeSpawn()
		const t = new StdioBridgeTransport({ spawnFn })
		void t.request("bridge.ping").catch(() => { /* expected on exit */ })
		bridge.emitExit(42, "SIGKILL")
		expect(t.deadCause).toEqual({
			stage: "runtime",
			code: 42,
			signal: "SIGKILL",
			message: "bridge host exited (code 42, signal SIGKILL)",
		})
	})

	test("spawn error records stage=spawn with no exit code", () => {
		const { spawnFn, bridge } = fakeSpawn()
		const t = new StdioBridgeTransport({ spawnFn })
		void t.request("bridge.ping").catch(() => { /* expected on error */ })
		bridge.emitError(new Error("spawn dsh ENOENT"))
		expect(t.deadCause).toEqual({
			stage: "spawn",
			code: null,
			signal: null,
			message: "bridge host error: spawn dsh ENOENT",
		})
	})

	test("DEAD is published once on the existing onEvent subscription", () => {
		const { spawnFn, bridge } = fakeSpawn()
		const t = new StdioBridgeTransport({ spawnFn })
		const dead: BridgeEventFrame[] = []
		t.onEvent((e) => {
			if (e.type === "bridge.dead") dead.push(e)
		})
		void t.request("bridge.ping").catch(() => { /* expected on exit */ })
		bridge.emitExit(1)
		bridge.emitExit(2) // second exit must NOT re-publish (permanent DEAD)
		expect(dead).toHaveLength(1)
		expect(dead[0]?.payload).toEqual(t.deadCause)
	})

	test("close() is idempotent and kills the child", () => {
		const { spawnFn, bridge } = fakeSpawn()
		const t = new StdioBridgeTransport({ spawnFn })
		void t.request("bridge.ping").catch(() => { /* expected on close */ })
		t.close()
		t.close()
		expect(bridge.killed()).toBe(1)
	})
})
