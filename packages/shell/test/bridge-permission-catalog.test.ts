/**
 * ADR-0011 T8/Q4 — `BridgeSessionSeam.permissionCatalog()` probe + the
 * process-once fail-closed notice.
 *
 * Probe basis (verified against source, never guessed): the bridge has NO
 * capability declaration (bridge.hello/ping reply only versions) and NO
 * `permissionPresets/catalog` route, so `undefined` is the honest "cannot
 * confirm an approval provider" answer — the SAME meaning the remote host
 * gives a failed/malformed catalog read (remote-host-session.ts:1346-1355).
 * These tests pin both the confirmed (catalog) and unconfirmed (undefined +
 * one-shot sink) branches, plus no-regression of the existing ask fail-closed
 * `unavailable` answer that triggers the notice in the real runtime.
 */
import { describe, expect, test } from "bun:test"
import {
	BridgeSessionSeam,
	type BridgeEventFrame,
	type BridgeTransport,
	type PermissionUnavailableReason,
} from "../src/client/bridge-session-seam.ts"

function harness() {
	const requests: { method: string; params?: Record<string, unknown> }[] = []
	const listeners: ((frame: BridgeEventFrame) => void)[] = []
	const notices: PermissionUnavailableReason[] = []
	const transport: BridgeTransport = {
		async request(method, params) {
			requests.push({ method, params })
			return {}
		},
		onEvent(listener) {
			listeners.push(listener)
			return () => {
				const i = listeners.indexOf(listener)
				if (i >= 0) listeners.splice(i, 1)
			}
		},
	}
	const logger = {
		info() {},
		warn() {},
		error() {},
	}
	const seam = new BridgeSessionSeam({
		transport,
		ctx: { logger },
		onPermissionUnavailable: (reason) => notices.push(reason),
	})
	return {
		seam,
		requests,
		notices,
		async online() {
			await seam.connect() // bridge.ping → {} ⇒ connection="connected"
		},
		emit(frame: BridgeEventFrame) {
			for (const l of [...listeners]) l(frame)
		},
		askRequest(eventId = "t1:ask-1", kind: "approval" | "questions" = "approval") {
			this.emit({
				type: "ask.request",
				payload: {
					eventId,
					sessionId: "s1",
					kind,
					...(kind === "approval" ? { toolName: "write" } : { questions: [] }),
				},
			})
		},
	}
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe("permissionCatalog probe shape", () => {
	test("confirmed provider returns a shape-valid SeamPermissionCatalog (same shape as remote)", async () => {
		const h = harness()
		await h.online()
		h.seam.registerAskProvider(async () => [])
		const catalog = await h.seam.permissionCatalog()
		expect(catalog).toEqual({ options: [], defaultOptions: [], defaultPreset: "" })
		// Remote returns a NON-empty catalog from the real RPC; both share the
		// {options, defaultOptions, defaultPreset} shape and both use `undefined`
		// for the absent/failed case (asserted below). No preset values invented.
		expect(Array.isArray(catalog?.options)).toBe(true)
		expect(Array.isArray(catalog?.defaultOptions)).toBe(true)
		expect(typeof catalog?.defaultPreset).toBe("string")
	})

	test("unconfirmed provider returns undefined (remote's absent-service semantics)", async () => {
		const h = harness()
		await h.online()
		expect(await h.seam.permissionCatalog()).toBeUndefined()
	})
})

describe("one-shot fail-closed notice", () => {
	test("no provider → notice fires exactly once across repeated probes and session changes", async () => {
		const h = harness()
		await h.online()

		// First probe: undefined + exactly one sink call.
		expect(await h.seam.permissionCatalog()).toBeUndefined()
		expect(h.notices).toEqual(["no-provider"])

		// Repeated probes and ask-frame / turn changes never fire it again.
		for (let i = 0; i < 3; i++) expect(await h.seam.permissionCatalog()).toBeUndefined()
		h.askRequest("t1:ask-1")
		h.askRequest("t2:ask-2", "questions")
		h.emit({ type: "ask.pending", payload: { sessionId: "s1", asks: [] } })
		await tick()
		expect(await h.seam.permissionCatalog()).toBeUndefined()
		expect(h.notices).toHaveLength(1)
	})

	test("real runtime path: a fail-closed ask with no answerer triggers the notice once", async () => {
		const h = harness()
		await h.online()
		h.askRequest("t1:ask-1")
		await tick()

		// Existing fail-closed behaviour is intact: exactly one unavailable answer.
		const answers = h.requests.filter((r) => r.method === "ask.response")
		expect(answers).toHaveLength(1)
		expect(answers[0]?.params?.verdict).toBe("unavailable")
		// ...and the notice fired once with the degrading reason.
		expect(h.notices).toEqual(["ask-no-provider"])
	})

	test("confirmed provider → no notice even after repeated probes", async () => {
		const h = harness()
		await h.online()
		h.seam.registerAskProvider(async () => [])
		for (let i = 0; i < 3; i++) expect(await h.seam.permissionCatalog()).toBeDefined()
		expect(h.notices).toHaveLength(0)
	})

	test("bridge offline → no provider with an offline reason, still once", async () => {
		const h = harness()
		// no connect(): #connection stays at its initial non-connected value
		expect(await h.seam.permissionCatalog()).toBeUndefined()
		expect(await h.seam.permissionCatalog()).toBeUndefined()
		expect(h.notices).toEqual(["bridge-offline"])
	})
})
