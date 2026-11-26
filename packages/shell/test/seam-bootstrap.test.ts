/**
 * M2/T9-T11 unit tests for fail-fast bootstrap (S6: bridge is the sole seam).
 *
 * Covers the exact deliverables:
 *   - fail-fast three elements: diagnosis + repair command + mode notice
 *   - handshake/fingerprint failure is immediate + readable, NO fallback
 *   - D3 downgrade law: sync members degrade+log, async members UNSUPPORTED
 */
import { describe, expect, test } from "bun:test"
import {
	BridgeProtocolError,
	BridgeSessionSeam,
	type BridgeEventFrame,
	type BridgeTransport,
} from "../src/client/bridge-session-seam.ts"
import {
	BRIDGE_APPEND_PRESET_NOTICE,
	BRIDGE_PROTOCOL_VERSION,
	BRIDGE_REPAIR_COMMAND,
	BridgeBootstrapError,
	createBridgeSessionSeam,
	formatBridgeBootstrapMessage,
	formatDeadNotice,
	toBridgeBootstrapError,
	verifyBridgeFingerprint,
} from "../src/client/seam-bootstrap.ts"

const HELLO = {
	protocolVersion: BRIDGE_PROTOCOL_VERSION,
	bridgeVersion: "0.1.0",
	hostVersion: "0.2.2-rc.3",
}

function fakeTransport(replies: Record<string, unknown> = { "bridge.hello": HELLO, "bridge.ping": HELLO }) {
	const requests: { method: string; params?: Record<string, unknown> }[] = []
	const listeners: ((e: BridgeEventFrame) => void)[] = []
	const transport: BridgeTransport = {
		async request(method, params) {
			requests.push({ method, params })
			if (!(method in replies)) throw new BridgeProtocolError("UNSUPPORTED", `unknown method ${method}`)
			const reply = replies[method]
			if (reply instanceof Error) throw reply
			return reply
		},
		onEvent(listener) {
			listeners.push(listener)
			return () => {
				const i = listeners.indexOf(listener)
				if (i >= 0) listeners.splice(i, 1)
			}
		},
	}
	return {
		transport,
		requests,
		emit: (event: BridgeEventFrame) => {
			for (const listener of [...listeners]) listener(event)
		},
	}
}

const logger = {
	info() {},
	warn() {},
	error() {},
}

// ---------------------------------------------------------------------------
// 1. Fail-fast three elements (T11 original: 诊断 + 修复命令 + 模式说明)
// S6退役登记: the former "Default seam selection" describe (4 tests) is removed
// with the seam-selection helpers — the surface it tested no
// longer exists (A.5: 被测面消亡随删).
// ---------------------------------------------------------------------------
describe("fail-fast three elements", () => {
	test("BridgeBootstrapError message contains all three, self-contained", () => {
		const err = new BridgeBootstrapError({
			code: "VERSION_INCOMPATIBLE",
			diagnosis: "protocolVersion mismatch: client=1, bridge=2, host=0.2.2-rc.3",
		})
		// 1. diagnosis
		expect(err.message).toContain("protocolVersion mismatch: client=1, bridge=2, host=0.2.2-rc.3")
		expect(err.diagnosis).toContain("protocolVersion mismatch")
		// 2. repair command
		expect(err.message).toContain(`Fix: ${BRIDGE_REPAIR_COMMAND}`)
		expect(err.repairCommand).toBe(BRIDGE_REPAIR_COMMAND)
		// 3. mode notice — append via bridge section, presets standard only
		expect(err.message).toContain(BRIDGE_APPEND_PRESET_NOTICE)
		expect(err.message).toContain("bridge section")
		expect(err.message).toContain("presets are standard only")
		expect(err.code).toBe("VERSION_INCOMPATIBLE")
	})

	test("formatBridgeBootstrapMessage lets a caller override the repair command", () => {
		const msg = formatBridgeBootstrapMessage({
			code: "BRIDGE_TRANSPORT_MISSING",
			diagnosis: "no transport injected",
			repairCommand: "npm i -g @aiwayds/dsh-opentui",
		})
		expect(msg).toContain("no transport injected")
		expect(msg).toContain("Fix: npm i -g @aiwayds/dsh-opentui")
		expect(msg).toContain(BRIDGE_APPEND_PRESET_NOTICE)
	})

	test("toBridgeBootstrapError keeps a BridgeProtocolError's code + detail as diagnosis", () => {
		const wrapped = toBridgeBootstrapError(
			new BridgeProtocolError("VERSION_INCOMPATIBLE", "protocol mismatch", {
				clientProtocolVersion: 2,
				bridgeProtocolVersion: 1,
			}),
		)
		expect(wrapped.code).toBe("VERSION_INCOMPATIBLE")
		expect(wrapped.message).toContain("bridge handshake rejected: protocol mismatch")
		expect(wrapped.message).toContain('"clientProtocolVersion":2')
		expect(wrapped.message).toContain(BRIDGE_APPEND_PRESET_NOTICE)
	})
})

// ---------------------------------------------------------------------------
// 3. Handshake / fingerprint failure: immediate, readable, no fallback
// ---------------------------------------------------------------------------
describe("handshake / fingerprint verification fails fast", () => {
	test("wrong protocolVersion throws a three-element bootstrap error", () => {
		expect(() => verifyBridgeFingerprint({ ...HELLO, protocolVersion: 2 })).toThrow(BridgeBootstrapError)
		try {
			verifyBridgeFingerprint({ ...HELLO, protocolVersion: 2 })
			expect.unreachable("must throw")
		} catch (err) {
			const e = err as BridgeBootstrapError
			expect(e.code).toBe("VERSION_INCOMPATIBLE")
			expect(e.message).toContain("client=1, bridge=2")
			expect(e.message).toContain(`Fix: ${BRIDGE_REPAIR_COMMAND}`)
			expect(e.message).toContain(BRIDGE_APPEND_PRESET_NOTICE)
		}
	})

	test("missing fingerprint fields throw instead of degrading", () => {
		expect(() => verifyBridgeFingerprint({ protocolVersion: 1 })).toThrow(/bridgeVersion/)
		expect(() => verifyBridgeFingerprint({ protocolVersion: 1, bridgeVersion: "0.1.0" })).toThrow(/hostVersion/)
	})

	test("a VERSION_INCOMPATIBLE frame fails the whole bridge seam creation (no fallback)", async () => {
		const { transport, requests } = fakeTransport({
			"bridge.hello": new BridgeProtocolError("VERSION_INCOMPATIBLE", "protocol mismatch", {
				clientProtocolVersion: 2,
				bridgeProtocolVersion: 1,
			}),
		})
		// S6: createBridgeSessionSeam is the sole path; a handshake rejection is
		// terminal (no other seam to fall back to — that seam no longer exists).
		await expect(createBridgeSessionSeam({ transport, ctx: { logger } })).rejects.toBeInstanceOf(BridgeBootstrapError)
		expect(requests.filter((r) => r.method === "bridge.hello")).toHaveLength(1)
	})

	test("a successful handshake returns a real BridgeSessionSeam", async () => {
		const { transport, requests } = fakeTransport()
		const seam = await createBridgeSessionSeam({ transport, ctx: { logger } })
		expect(seam).toBeInstanceOf(BridgeSessionSeam)
		expect(requests.map((r) => r.method)).toEqual(["bridge.hello", "bridge.ping"])
		expect(requests[0]?.params).toEqual({ protocolVersion: 1 })
	})
})

// ---------------------------------------------------------------------------
// 3b. No silent fallback (S6): the seam selection surface is gone; handshake
// failure propagates unchanged. S6退役登记: the former seam-factory dispatch describe's remote-factory
// tests are removed with the selection
// mechanism (A.5: 被测面消亡); the "failure propagates" semantic is retained
// here against the sole creation path.
// ---------------------------------------------------------------------------
describe("createBridgeSessionSeam: failure propagates, no silent degrade", () => {
	test("a handshake rejection propagates unchanged (no other seam exists)", async () => {
		const boom = new BridgeProtocolError("VERSION_INCOMPATIBLE", "protocol mismatch")
		const { transport } = fakeTransport({ "bridge.hello": boom })
		const err = await createBridgeSessionSeam({ transport, ctx: { logger } }).catch((e) => e)
		// The bridge failure surfaces as a typed bootstrap error carrying the
		// original diagnosis — never swallowed into a degraded seam.
		expect(err).toBeInstanceOf(BridgeBootstrapError)
		expect(String(err.message)).toContain("protocol mismatch")
	})
})

// ---------------------------------------------------------------------------
// 5. D3 downgrade law (user-decided, not to be violated by fail-fast)
// ---------------------------------------------------------------------------
describe("D3 downgrade law stays intact", () => {
	test("sync members degrade + log, never throw; steer is an explicit rejected result", async () => {
		const { transport } = fakeTransport()
		const warns: string[] = []
		const seam = new BridgeSessionSeam({
			transport,
			ctx: { logger: { info() {}, warn: (...args: unknown[]) => warns.push(args.map(String).join(" ")), error() {} } },
		})
		expect(seam.status()).toHaveProperty("connection")
		expect(seam.usageSummary()).toEqual([])
		// 029 A: steer no longer silently no-ops — without a capability it
		// returns an explicit UNSUPPORTED refusal and sends no frame.
		expect(await seam.steer("x")).toEqual({ accepted: false, reason: "UNSUPPORTED" })
	})

	test("async unsupported members reject with UNSUPPORTED, never fake success", async () => {
		const { transport } = fakeTransport()
		const seam = new BridgeSessionSeam({ transport, ctx: { logger } })
		await expect(seam.searchSessions("q")).rejects.toMatchObject({ code: "UNSUPPORTED" })
		await expect(seam.renameSession("t")).rejects.toMatchObject({ code: "UNSUPPORTED" })
	})
})

// ---------------------------------------------------------------------------
// 6. A2 — DEAD event-driven on-screen notice (idle crash included)
// ---------------------------------------------------------------------------
describe("DEAD state is published and surfaced without a turn", () => {
	const cause = { stage: "runtime" as const, code: 7, signal: "SIGTERM", message: "bridge host exited (code 7)" }

	test("bridge.dead event → bridge=dead, one notice callback, one SeamSessionEvent", async () => {
		const { transport, emit } = fakeTransport()
		const notices: unknown[] = []
		const seam = await createBridgeSessionSeam({
			transport,
			ctx: { logger },
			onDead: (c) => notices.push(c),
		})
		const events: { type: string; details: unknown }[] = []
		seam.onSessionEvent((e) => events.push(e))

		// No turn in flight — the idle-period crash case.
		expect(seam.status().turn).toBe("idle")
		emit({ type: "bridge.dead", payload: cause })

		expect(seam.status().bridge).toBe("dead")
		expect(notices).toHaveLength(1)
		expect(notices[0]).toEqual(cause)
		expect(events.filter((e) => e.type === "bridge.dead")).toHaveLength(1)
		expect(events[0]?.details).toEqual(cause)
	})

	test("notice text carries the cause summary + stage", () => {
		expect(formatDeadNotice(cause)).toContain("连接已断开")
		expect(formatDeadNotice(cause)).toContain("bridge host exited (code 7)")
		expect(formatDeadNotice(cause)).toContain("exit 7")
		expect(formatDeadNotice(cause)).toContain("stage runtime")
	})

	test("handshake failure over a DEAD transport notifies with stage=handshake", async () => {
		const { transport } = fakeTransport({
			"bridge.hello": new BridgeProtocolError("BRIDGE_DEAD", "dead during hello", cause),
		})
		const notices: { stage: string }[] = []
		await expect(
			createBridgeSessionSeam({ transport, ctx: { logger }, onDead: (c) => notices.push(c) }),
		).rejects.toBeInstanceOf(BridgeBootstrapError)
		expect(notices).toEqual([{ ...cause, stage: "handshake" }])
	})
})
