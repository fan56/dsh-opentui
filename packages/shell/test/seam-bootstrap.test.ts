/**
 * M2/T9-T11 unit tests for seam selection + fail-fast bootstrap.
 *
 * Covers the exact deliverables:
 *   - default seam selection: inproc → bridge, non-inproc → remote (each branch)
 *   - fail-fast three elements: diagnosis + repair command + mode notice
 *   - handshake/fingerprint failure is immediate + readable, NO fallback
 *   - --remote still selects the legacy seam + one-shot deprecation notice
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
	createSessionSeam,
	formatBridgeBootstrapMessage,
	isInprocMode,
	selectSeamKind,
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
	return { transport, requests }
}

const logger = {
	info() {},
	warn() {},
	error() {},
}

// ---------------------------------------------------------------------------
// 1. Default seam selection — both branches
// ---------------------------------------------------------------------------
describe("selectSeamKind: default path switch", () => {
	test("inproc mode → BridgeSessionSeam is the default", () => {
		expect(selectSeamKind({ inproc: true, remote: false })).toBe("bridge")
	})

	test("non-inproc mode → legacy RemoteSessionSeam stays the default", () => {
		expect(selectSeamKind({ inproc: false, remote: false })).toBe("remote")
	})

	test("explicit --remote overrides inproc mode (escape hatch retained)", () => {
		expect(selectSeamKind({ inproc: true, remote: true })).toBe("remote")
	})

	test("isInprocMode reads only DSH_OPENTUI_INPROC=1", () => {
		expect(isInprocMode({ DSH_OPENTUI_INPROC: "1" })).toBe(true)
		expect(isInprocMode({ DSH_OPENTUI_INPROC: "0" })).toBe(false)
		expect(isInprocMode({})).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// 2. Fail-fast three elements (T11 original: 诊断 + 修复命令 + 模式说明)
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

	test("a VERSION_INCOMPATIBLE frame fails the whole bridge seam creation (no remote seam)", async () => {
		const { transport, requests } = fakeTransport({
			"bridge.hello": new BridgeProtocolError("VERSION_INCOMPATIBLE", "protocol mismatch", {
				clientProtocolVersion: 2,
				bridgeProtocolVersion: 1,
			}),
		})
		let remoteCreated = false
		await expect(
			createSessionSeam({
				kind: "bridge",
				createBridge: () => createBridgeSessionSeam({ transport, ctx: { logger } }),
				createRemote: () => {
					remoteCreated = true
					return new BridgeSessionSeam({ transport, ctx: { logger } }) // stands in for the remote seam
				},
			}),
		).rejects.toBeInstanceOf(BridgeBootstrapError)
		// The critical "no silent fallback" assertions:
		expect(remoteCreated).toBe(false)
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
// 4. createSessionSeam dispatch — no fallback, --remote retained
// ---------------------------------------------------------------------------
describe("createSessionSeam: no fallback, --remote retained", () => {
	test("bridge factory failure propagates and the remote factory is never called", async () => {
		let remoteCalls = 0
		const boom = new BridgeBootstrapError({ code: "X", diagnosis: "boom" })
		await expect(
			createSessionSeam({
				kind: "bridge",
				createBridge: () => Promise.reject(boom),
				createRemote: () => {
					remoteCalls++
					return {} as never
				},
			}),
		).rejects.toBe(boom)
		expect(remoteCalls).toBe(0)
	})

	test("--remote selects the remote factory and never touches the bridge", async () => {
		let bridgeCalls = 0
		const remote = new BridgeSessionSeam({ transport: fakeTransport().transport, ctx: { logger } })
		const seam = await createSessionSeam({
			kind: "remote",
			createBridge: () => {
				bridgeCalls++
				return Promise.resolve({} as never)
			},
			createRemote: () => remote as never,
		})
		expect(seam).toBe(remote)
		expect(bridgeCalls).toBe(0)
	})
})

// ---------------------------------------------------------------------------
// 5. D3 downgrade law (user-decided, not to be violated by fail-fast)
// ---------------------------------------------------------------------------
describe("D3 downgrade law stays intact", () => {
	test("sync members degrade + log, never throw", () => {
		const { transport } = fakeTransport()
		const warns: string[] = []
		const seam = new BridgeSessionSeam({
			transport,
			ctx: { logger: { info() {}, warn: (...args: unknown[]) => warns.push(args.map(String).join(" ")), error() {} } },
		})
		expect(seam.status()).toHaveProperty("connection")
		expect(seam.usageSummary()).toEqual([])
		expect(() => seam.steer("x")).not.toThrow()
		expect(warns.some((w) => w.includes("steer"))).toBe(true)
	})

	test("async unsupported members reject with UNSUPPORTED, never fake success", async () => {
		const { transport } = fakeTransport()
		const seam = new BridgeSessionSeam({ transport, ctx: { logger } })
		await expect(seam.searchSessions("q")).rejects.toMatchObject({ code: "UNSUPPORTED" })
		await expect(seam.renameSession("t")).rejects.toMatchObject({ code: "UNSUPPORTED" })
	})
})
