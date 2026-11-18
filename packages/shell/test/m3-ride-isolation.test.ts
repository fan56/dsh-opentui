/**
 * M3-07 — ride path isolation (scope-limited). LOCK-IN-PLACE tests.
 *
 * The legacy append "ride" (roster probe `agentPresets/list` at
 * remote-host-session.ts:1132-1158, `session/create.agentPreset` at :2370-2381,
 * ask-btw throwaway create at :2011, echo guards at :2396-2399/:2427, and
 * remote-btw.ts:53) lives ONLY in the RemoteSessionSeam implementation.
 *
 * BridgeSessionSeam is a separate implementation that speaks ADR-0010 bridge
 * frames (`bridge.hello`/`bridge.ping`/`session.open`/`session.send`/...). It
 * never imports append-system.ts and has no `agentPreset` / roster code. These
 * tests pin that fact on the WIRE (the transport's recorded request log), so a
 * future change that accidentally routes the inproc path through the ride
 * fails here — without changing any product code.
 *
 * `--remote` behavior is untouched: its append resume/create regression tests
 * live in remote-host-session.test.ts and append-system.test.ts and stay green.
 */
import { describe, expect, test } from "bun:test"
import {
	BridgeSessionSeam,
	type BridgeEventFrame,
	type BridgeTransport,
} from "../src/client/bridge-session-seam.ts"
import {
	BRIDGE_PROTOCOL_VERSION,
	createBridgeSessionSeam,
	createSessionSeam,
	selectSeamKind,
} from "../src/client/seam-bootstrap.ts"
import { APPEND_SYSTEM_PRESET_ID, APPEND_SYSTEM_ROW_ID } from "../src/client/append-system.ts"

const HELLO = {
	protocolVersion: BRIDGE_PROTOCOL_VERSION,
	bridgeVersion: "0.1.0",
	hostVersion: "0.2.2-rc.3",
}
const logger = { info() {}, warn() {}, error() {} }

interface RecordedRequest {
	method: string
	params?: Record<string, unknown>
}

/** Record EVERY outgoing request + emit helper — the seam's wire log. */
function makeIsolationHarness() {
	const requests: RecordedRequest[] = []
	const listeners: ((frame: BridgeEventFrame) => void)[] = []
	const replies: Record<string, unknown> = {
		"bridge.hello": HELLO,
		"bridge.ping": {},
		"session.open": { sessionId: "s-iso" },
		"session.send": { turnId: "t-iso" },
	}
	const transport: BridgeTransport = {
		async request(method, params) {
			requests.push({ method, params })
			const reply = replies[method]
			if (reply instanceof Error) throw reply
			return reply ?? {}
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
		emit(frame: BridgeEventFrame) {
			for (const l of [...listeners]) l(frame)
		},
	}
}

/** Assert the recorded wire log carries NO trace of the legacy append ride. */
function expectNoRideOnWire(requests: RecordedRequest[]): void {
	// 1. The roster probe RPC is never issued on the inproc path.
	expect(requests.map((r) => r.method)).not.toContain("agentPresets/list")
	// 2. The legacy create RPC (which carries agentPreset) is never used — the
	//    bridge binds sessions with `session.open` instead.
	expect(requests.map((r) => r.method)).not.toContain("session/create")
	// 3. No request params carry an `agentPreset` field (or any append-named key).
	for (const r of requests) {
		const params = r.params ?? {}
		expect(Object.keys(params)).not.toContain("agentPreset")
		expect(Object.keys(params).some((k) => /append|preset|roster/i.test(k))).toBe(false)
	}
	// 4. The synthetic id / row id never appears anywhere in the serialized wire.
	const wire = JSON.stringify(requests)
	expect(wire).not.toContain(APPEND_SYSTEM_PRESET_ID) // "opentui-append-system"
	expect(wire).not.toContain(APPEND_SYSTEM_ROW_ID) // "preset-opentui-append-system"
}

const turnCallbacks = {
	onThinkingDelta() {},
	onContentDelta() {},
	onApprove: async () => "allowed-once" as const,
	onError() {},
}

// ---------------------------------------------------------------------------
// 1. Full seam lifecycle: init → create → resume → dispose carries no ride
// ---------------------------------------------------------------------------
describe("M3-07 inproc wire isolation: BridgeSessionSeam never rides append", () => {
	test("full lifecycle (connect/newSession/create/resume/dispose) emits no agentPresets/list and no agentPreset field", async () => {
		const h = makeIsolationHarness()
		const seam = new BridgeSessionSeam({ transport: h.transport, ctx: { logger } })

		// init / connect
		await seam.connect()
		// fresh create: newSession() + first turn binds via session.open{mode:new}
		seam.newSession()
		const first = seam.turn("hello", turnCallbacks)
		await Bun.sleep(0)
		h.emit({ type: "turn.end", payload: { turnId: "t-iso", text: "ok" } })
		await first

		// resume: resumeSession() + turn binds via session.open{mode:resume}
		seam.resumeSession("s-stored")
		const second = seam.turn("again", turnCallbacks)
		await Bun.sleep(0)
		h.emit({ type: "turn.end", payload: { turnId: "t-iso", text: "ok" } })
		await second

		// teardown
		await seam.dispose()

		// Sanity: the lifecycle really did exercise the bridge wire, so the
		// negative assertions below are non-trivial (not an empty log).
		const methods = h.requests.map((r) => r.method)
		expect(methods).toContain("bridge.ping")
		expect(methods).toContain("session.open")
		expect(methods).toContain("session.send")
		expect(methods).toContain("session.close")
		expect(methods.filter((m) => m === "session.open")).toHaveLength(2)
		expect(h.requests.find((r) => r.method === "session.open")?.params).toEqual({ mode: "new" })
		expect(h.requests.filter((r) => r.method === "session.open")[1]?.params).toEqual({
			mode: "resume",
			id: "s-stored",
			replace: true,
		})

		// The boundary assertions (the point of this test).
		expectNoRideOnWire(h.requests)
	})

	test("bootstrap init (createBridgeSessionSeam) issues only hello/ping — no roster probe", async () => {
		const h = makeIsolationHarness()
		const seam = await createBridgeSessionSeam({ transport: h.transport, ctx: { logger } })
		expect(seam).toBeInstanceOf(BridgeSessionSeam)
		expect(h.requests.map((r) => r.method)).toEqual(["bridge.hello", "bridge.ping"])
		expect(h.requests[0]?.params).toEqual({ protocolVersion: BRIDGE_PROTOCOL_VERSION })
		expectNoRideOnWire(h.requests)
	})
})

// ---------------------------------------------------------------------------
// 2. Seam selection keeps the two paths disjoint (inproc=bridge, --remote=remote)
// ---------------------------------------------------------------------------
describe("M3-07 seam selection keeps the ride on --remote only", () => {
	test("inproc → bridge seam; --remote → remote seam (ride remains reachable only via remote)", async () => {
		const h = makeIsolationHarness()
		expect(selectSeamKind({ inproc: true, remote: false })).toBe("bridge")
		expect(selectSeamKind({ inproc: true, remote: true })).toBe("remote")

		let bridgeBuilt = false
		const remoteSeam = { marker: "remote" } as never
		const selected = await createSessionSeam({
			kind: selectSeamKind({ inproc: true, remote: false }),
			createBridge: () => {
				bridgeBuilt = true
				return createBridgeSessionSeam({ transport: h.transport, ctx: { logger } })
			},
			createRemote: () => remoteSeam,
		})
		expect(bridgeBuilt).toBe(true)
		expect(selected).toBeInstanceOf(BridgeSessionSeam)
		expectNoRideOnWire(h.requests)

		// Explicit --remote dispatches to the retained remote factory (where the
		// append ride code lives in 0.22.0; it is NOT deleted by this task).
		const remoteSelected = await createSessionSeam({
			kind: selectSeamKind({ inproc: true, remote: true }),
			createBridge: () => Promise.reject(new Error("bridge must not be built for --remote")),
			createRemote: () => remoteSeam,
		})
		expect(remoteSelected).toBe(remoteSeam)
	})
})
