/**
 * B1 (gap C2): /search Enter-on-a-hit resumes the selected session.
 *
 * Two faces, per the codebase's testable-surface law:
 * 1. The lifted orchestration (`resumeSearchHit`) + routing helpers — the
 *    component delegates to these, so the contract (sessionId passes
 *    UNCHANGED to onResumed; success closes; a rejection keeps the overlay
 *    open with the `resume failed — …` status line) is pinned without a
 *    renderer.
 * 2. The overlay's open-layer bindings, exercised against the REAL
 *    @opentui/keymap engine (the subagents-picker-keys law): return routes
 *    by hit count, up/down move the wrapping cursor.
 */
import { describe, expect, test } from "bun:test"
import { registerCommaBindings, registerDefaultKeys, registerEnabledFields } from "@opentui/keymap/addons"
import { createTestKeymap } from "@opentui/keymap/testing"
import {
	enterAction,
	hitCursorStep,
	resumeFailureText,
	resumeSearchHit,
	type SessionSearchHit,
} from "../src/routes/session/sessions-search"

const HITS: SessionSearchHit[] = [
	{ id: "ses_alpha", snippet: "first hit" },
	{ id: "ses_beta", snippet: "second hit" },
	{ id: "ses_gamma", snippet: "third hit" },
]

describe("enterAction routing", () => {
	test("a hit list routes Enter to resume", () => {
		expect(enterAction(HITS.length)).toBe("resume")
	})

	test("an empty list routes Enter to (re)run the query", () => {
		expect(enterAction(0)).toBe("search")
	})
})

describe("hitCursorStep", () => {
	test("steps down and up within bounds", () => {
		expect(hitCursorStep(0, 1, 3)).toBe(1)
		expect(hitCursorStep(1, -1, 3)).toBe(0)
	})

	test("wraps past both edges (the subagents-picker modulo law)", () => {
		expect(hitCursorStep(2, 1, 3)).toBe(0)
		expect(hitCursorStep(0, -1, 3)).toBe(2)
	})

	test("an empty hit list never moves", () => {
		expect(hitCursorStep(0, 1, 0)).toBe(0)
	})
})

describe("resumeSearchHit orchestration", () => {
	test("passes the selected sessionId UNCHANGED to onResumed, then closes", async () => {
		const seen: string[] = []
		let closed = 0
		await resumeSearchHit({
			sessionId: HITS[1]!.id,
			onResumed: (id) => {
				seen.push(id)
			},
			onSuccess: () => {
				closed++
			},
			onFailure: () => {
				throw new Error("onFailure must not fire on a resolved resume")
			},
		})
		expect(seen).toEqual(["ses_beta"])
		expect(closed).toBe(1)
	})

	test("a rejected resume fires the failure status line and never closes", async () => {
		let closed = 0
		let statusLine = ""
		await resumeSearchHit({
			sessionId: "ses_dead",
			onResumed: () => Promise.reject(new Error("seam dead")),
			onSuccess: () => {
				closed++
			},
			onFailure: (line) => {
				statusLine = line
			},
		})
		expect(closed).toBe(0)
		expect(statusLine).toBe("resume failed — seam dead")
	})

	test("the failure line slices long messages (the /login commit convention)", async () => {
		let statusLine = ""
		await resumeSearchHit({
			sessionId: "s",
			onResumed: () => Promise.reject(new Error("x".repeat(200))),
			onSuccess: () => {},
			onFailure: (line) => {
				statusLine = line
			},
		})
		expect(statusLine.startsWith("resume failed — ")).toBe(true)
		expect(statusLine.length).toBeLessThanOrEqual("resume failed — ".length + 150)
	})
})

describe("resumeFailureText", () => {
	test("an Error contributes its message", () => {
		expect(resumeFailureText(new Error("store offline"))).toBe("resume failed — store offline")
	})

	test("a non-Error stringifies", () => {
		expect(resumeFailureText("boom")).toBe("resume failed — boom")
	})
})

describe("overlay open-layer bindings (real keymap engine)", () => {
	/**
	 * Compose the sessions-search open layer EXACTLY as the component
	 * registers it (priority 2, global mode), with the run bodies driving the
	 * same lifted helpers the component closes over. `hits` and `cursor` are
	 * plain locals standing in for the component's signals; the busy gate is
	 * replicated because the double-dispatch law depends on it. P0-1 (review):
	 * the arrow bindings carry the component's `hits > 0` enabled gate (the
	 * component passes it as a command `enabled` fn; here as a cmd-side
	 * guard) and there are NO letter bindings — j/k must reach the query
	 * input.
	 */
	function composeOpenLayer(harness: ReturnType<typeof createTestKeymap>, state: {
		hits: SessionSearchHit[]
		cursor: number
		busy: boolean
	}) {
		const calls = { resumed: [] as string[], searched: 0 }
		const { keymap, host } = harness

		const enterKey = () => {
			if (state.busy) return
			if (enterAction(state.hits.length) === "resume") {
				const hit = state.hits[state.cursor]
				if (!hit) return
				state.busy = true
				void resumeSearchHit({
					sessionId: hit.id,
					onResumed: (sessionId) => {
						calls.resumed.push(sessionId)
					},
					onSuccess: () => {
						state.busy = false
					},
					onFailure: () => {
						state.busy = false
					},
				})
				return
			}
			calls.searched++
		}

		const hasHits = () => state.hits.length > 0

		keymap.registerLayer({
			priority: 2,
			enabled: () => true,
			bindings: [
				{ key: "return", cmd: () => enterKey() },
				{
					key: "down",
					enabled: hasHits,
					cmd: () => {
						state.cursor = hitCursorStep(state.cursor, 1, state.hits.length)
					},
				},
				{
					key: "up",
					enabled: hasHits,
					cmd: () => {
						state.cursor = hitCursorStep(state.cursor, -1, state.hits.length)
					},
				},
			],
		})
		return { calls, host }
	}

	async function harness() {
		const h = createTestKeymap({ defaultKeys: false })
		registerDefaultKeys(h.keymap)
		registerEnabledFields(h.keymap)
		// context/keymap.tsx:79 — the comma-bindings expander the app registers
		// on TOP of the defaults (the "down,j"/"up,k" binds need it).
		registerCommaBindings(h.keymap)
		return h
	}

	test("Enter with hits resumes the SELECTED hit; the query never re-runs", async () => {
		const h = await harness()
		const state = { hits: HITS, cursor: 0, busy: false }
		const { calls, host } = composeOpenLayer(h, state)
		host.press("return")
		await Promise.resolve()
		expect(calls.resumed).toEqual(["ses_alpha"])
		expect(calls.searched).toBe(0)
	})

	test("down then Enter resumes the second hit (cursor reaches onResumed)", async () => {
		const h = await harness()
		const state = { hits: HITS, cursor: 0, busy: false }
		const { calls, host } = composeOpenLayer(h, state)
		host.press("down")
		host.press("return")
		await Promise.resolve()
		expect(calls.resumed).toEqual(["ses_beta"])
	})

	test("up wraps from the first hit to the last", async () => {
		const h = await harness()
		const state = { hits: HITS, cursor: 0, busy: false }
		const { calls, host } = composeOpenLayer(h, state)
		host.press("up")
		host.press("return")
		await Promise.resolve()
		expect(calls.resumed).toEqual(["ses_gamma"])
	})

	test("Enter with NO hits re-runs the query instead of resuming", async () => {
		const h = await harness()
		const state = { hits: [], cursor: 0, busy: false }
		const { calls, host } = composeOpenLayer(h, state)
		host.press("return")
		expect(calls.searched).toBe(1)
		expect(calls.resumed).toEqual([])
	})

	test("a second Enter while a resume is in flight no-ops (the busy gate)", async () => {
		const h = await harness()
		const state = { hits: HITS, cursor: 0, busy: false }
		const { calls, host } = composeOpenLayer(h, state)
		host.press("return")
		// The orchestrator awaited nothing yet — busy is still latched.
		expect(state.busy).toBe(true)
		host.press("return")
		await Promise.resolve()
		expect(calls.resumed).toEqual(["ses_alpha"])
	})

	test("j and k are NOT list bindings (P0-1: they belong to the query input)", async () => {
		const h = await harness()
		const state = { hits: HITS, cursor: 0, busy: false }
		const { calls, host } = composeOpenLayer(h, state)
		host.press("j")
		host.press("k")
		expect(state.cursor).toBe(0)
		expect(calls.resumed).toEqual([])
		expect(calls.searched).toBe(0)
	})

	test("down/up with NO hits are gated off and move nothing (P0-1: the keys fall through)", async () => {
		const h = await harness()
		const state = { hits: [] as SessionSearchHit[], cursor: 0, busy: false }
		const { calls, host } = composeOpenLayer(h, state)
		host.press("down")
		host.press("up")
		expect(state.cursor).toBe(0)
		expect(calls.searched).toBe(0)
	})
})
