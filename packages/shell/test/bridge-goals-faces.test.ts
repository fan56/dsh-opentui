/**
 * 025 W2-5b — bridge seam goals-face integration (E1/E3/E5, R4 honest degrade).
 * Drives BridgeSessionSeam with a fake transport: a bound session supplies the
 * agentId, real wire replies -> hand-projected views/refs; service absence /
 * no active session -> UNSUPPORTED (never a fake-empty goal); hostile reply ->
 * no key/value leak; business errors keep their code (W2-3 C-2 classification).
 */
import { describe, expect, test } from "bun:test"
import {
	BridgeProtocolError,
	BridgeSessionSeam,
	type BridgeEventFrame,
	type BridgeTransport,
} from "../src/client/bridge-session-seam.ts"

const SENTINEL = "W2_5_SENTINEL_synthetic_no_real_credential"
const AGENT = "session-agent-1"

type Reply = { kind: "value"; value: unknown } | { kind: "error"; error: Error }

async function harness(replies: Record<string, Reply> = {}, bindSession = true) {
	const requests: { method: string; params?: Record<string, unknown> }[] = []
	const allReplies: Record<string, Reply> = { ...replies }
	const listeners: ((frame: BridgeEventFrame) => void)[] = []
	const transport: BridgeTransport = {
		async request(method, params) {
			requests.push({ method, params })
			if (Object.prototype.hasOwnProperty.call(allReplies, method)) {
				const r = allReplies[method]!
				if (r.kind === "error") throw r.error
				return r.value
			}
			throw new BridgeProtocolError("UNSUPPORTED", `${method} unavailable`, { capability: method })
		},
		onEvent(listener: (frame: BridgeEventFrame) => void) {
			listeners.push(listener)
			return () => {}
		},
	}
	const emit = (frame: BridgeEventFrame) => { for (const l of [...listeners]) l(frame) }
	const seam = new BridgeSessionSeam({ transport, ctx: { logger: { info() {}, warn() {}, error() {} } } })
	if (bindSession) {
		// Bind the session through the REAL resume+turn path so currentSessionId()
		// (the goals scope agentId source) is set — no private-field poking.
		allReplies["session.open"] = value({ sessionId: AGENT, journalCursor: 0 })
		allReplies["session.send"] = value({ turnId: "t-bind" })
		seam.resumeSession(AGENT)
		const done = seam.turn("bind", {
			onThinkingDelta() {}, onContentDelta() {},
			onApprove: async () => "allowed-once", onError() {},
		})
		await Bun.sleep(0)
		emit({ type: "turn.end", payload: { turnId: "t-bind", text: "ok" } } as BridgeEventFrame)
		await done
	}
	return { seam, requests, emit, lastRequest(method: string) {
		return [...requests].reverse().find((r) => r.method === method)
	} }
}

const value = (v: unknown): Reply => ({ kind: "value", value: v })
const GOAL = {
	id: "g-1", revision: 2, objective: "Reach 100% green", phase: "active", activation: "armed",
	roundsStarted: 3, maxGoalRounds: 8, createdAt: 1, updatedAt: 2,
}

describe("W2-5b goals face — status/read (real data / honest degrade)", () => {
	test("goals.get -> hand-projected view; agentId injected from session (scope wire)", async () => {
		const { seam, lastRequest } = await harness({ "goals.get": value({ value: GOAL }) })
		const view = await seam.goals!.status()
		expect(view).toEqual({
			id: "g-1", revision: 2, objective: "Reach 100% green", phase: "active", activation: "armed",
			roundsStarted: 3, maxGoalRounds: 8, createdAt: 1, updatedAt: 2,
		})
		expect(lastRequest("goals.get")?.params).toEqual({ agentId: AGENT })
		expect(seam.goals!.available()).toBe(true)
	})

	test("E3 — no current goal (null/undefined reply) -> undefined, not a fake row", async () => {
		const { seam } = await harness({ "goals.get": value({ value: null }) })
		expect(await seam.goals!.status()).toBeUndefined()
	})

	test("E3 — service absent -> UNSUPPORTED rejection (never fake-empty)", async () => {
		const { seam } = await harness({})
		let code = ""
		try { await seam.goals!.status() } catch (e) { code = e instanceof BridgeProtocolError ? e.code : "" }
		expect(code).toBe("UNSUPPORTED")
		expect(seam.goals!.available()).toBe(false)
	})

	test("E3 — no active session (agentId missing) -> UNSUPPORTED, no fabricated id", async () => {
		const { seam, requests } = await harness({ "goals.get": value(GOAL) }, false)
		let code = ""
		try { await seam.goals!.status() } catch (e) { code = e instanceof BridgeProtocolError ? e.code : "" }
		expect(code).toBe("UNSUPPORTED")
		expect(requests.length).toBe(0) // no wire call with a fabricated agentId
	})

	test("E5 — hostile goal reply: SENTINEL/sensitive keys never cross", async () => {
		const { seam } = await harness({ "goals.get": value({ value: {
			...GOAL, apiKey: SENTINEL, token: SENTINEL, password: SENTINEL,
		} }) })
		const view = await seam.goals!.status()
		const text = JSON.stringify(view)
		expect(text).not.toContain(SENTINEL)
		expect(text).not.toMatch(/"apiKey"|"token"|"password"|"secret"|"credential"/i)
		expect(view!.objective).toBe("Reach 100% green")
	})
})

describe("W2-5b goals face — write ops (explicit intent, hole-free projection)", () => {
	test("all write faces ride generated wire names with agentId + params", async () => {
		const created = { ref: { id: "g-2", revision: 1 } }
		const { seam, lastRequest } = await harness({
			"goals.create": value({ value: created }),
			"goals.edit": value({ value: GOAL }),
			"goals.complete": value({ value: GOAL }),
			"goals.pause": value({ value: GOAL }),
			"goals.resume": value({ value: GOAL }),
			"goals.clear": value({ value: { id: "g-1", revision: 3 } }),
		})
		const ref = { id: "g-1", revision: 2 }
		expect(await seam.goals!.create("make it green", 12)).toEqual({ id: "g-2", revision: 1 })
		expect(lastRequest("goals.create")?.params).toEqual({ agentId: AGENT, request: { objective: "make it green", maxGoalRounds: 12 } })

		expect((await seam.goals!.edit(ref, { objective: "v2" }))?.objective).toBe("Reach 100% green")
		expect(lastRequest("goals.edit")?.params).toEqual({ agentId: AGENT, ref, request: { objective: "v2" } })

		await seam.goals!.complete(ref); expect(lastRequest("goals.complete")?.params).toEqual({ agentId: AGENT, ref })
		await seam.goals!.pause(ref); expect(lastRequest("goals.pause")?.params).toEqual({ agentId: AGENT, ref })
		await seam.goals!.resume(ref); expect(lastRequest("goals.resume")?.params).toEqual({ agentId: AGENT, ref })
		expect(await seam.goals!.clear(ref)).toEqual({ id: "g-1", revision: 3 })
		expect(lastRequest("goals.clear")?.params).toEqual({ agentId: AGENT, ref })
	})

	test("C-2 classification: business error keeps its code; availability not poisoned", async () => {
		const { seam } = await harness({
			"goals.get": value({ value: GOAL }),
			"goals.complete": { kind: "error", error: new BridgeProtocolError("INTERNAL", "stale revision") },
		})
		await seam.goals!.status() // available=true
		let code = ""
		try { await seam.goals!.complete({ id: "g-1", revision: 99 }) } catch (e) {
			code = e instanceof BridgeProtocolError ? e.code : ""
		}
		expect(code).toBe("INTERNAL")
		expect(seam.goals!.available()).toBe(true) // a single refusal is not "service gone"
	})

	test("E5 hostile create result: no SENTINEL crosses", async () => {
		const { seam } = await harness({ "goals.create": value({ value: { ref: { id: "g-9", revision: 1, apiKey: SENTINEL } } }) })
		const ref = await seam.goals!.create("x")
		expect(JSON.stringify(ref)).not.toContain(SENTINEL)
		expect(ref).toEqual({ id: "g-9", revision: 1 })
	})
})
