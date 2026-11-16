/**
 * stopEverything() unit tests — the shared stop leg behind /stop and the
 * double-Esc confirm. The parent is interrupted first AND ONLY when a turn is
 * actually live (aborting an idle parent drops the session binding — P0);
 * only RUNNING children are cancelled; a single child failure is isolated and
 * never strands the rest.
 */
import { describe, expect, test } from "bun:test"
import type { SeamStatus, SeamSubagentView, SessionSeam } from "../src/seams/session"
import { stopEverything } from "../src/routes/session/stop-all"

function child(id: string, status: SeamSubagentView["status"]): SeamSubagentView {
	return { id, label: id, status, rounds: 0 }
}

interface FakeOpts {
	turn?: SeamStatus["turn"]
	views?: SeamSubagentView[]
	withStatus?: boolean
	withInterruptChild?: boolean
	childFailsFor?: string
}

function fakeSeam(opts: FakeOpts = {}) {
	const calls: string[] = []
	const seam = {
		status:
			opts.withStatus === false
				? undefined
				: () => ({ connection: "connected" as const, turn: opts.turn ?? ("idle" as const), sessionAttached: true }),
		interrupt: () => {
			calls.push("parent")
		},
		subagentViews: () => opts.views ?? [],
		interruptChild:
			opts.withInterruptChild === false
				? undefined
				: (id: string) => {
						calls.push(`child:${id}`)
						return id === opts.childFailsFor ? Promise.reject(new Error(`child ${id} failed`)) : Promise.resolve()
					},
	}
	return { seam: seam as unknown as SessionSeam, calls }
}

describe("stopEverything", () => {
	test("interrupts the parent first, once, then each RUNNING child", async () => {
		const { seam, calls } = fakeSeam({
			turn: "running",
			views: [child("a", "running"), child("b", "running"), child("done", "completed"), child("dead", "failed")],
		})
		const result = await stopEverything(seam)
		expect(result).toEqual({ parent: true, children: 2 })
		expect(calls).toEqual(["parent", "child:a", "child:b"])
	})

	test("all settled children + an idle parent → no interrupt at all", async () => {
		const { seam, calls } = fakeSeam({
			turn: "idle",
			views: [child("done", "completed"), child("dead", "cancelled")],
		})
		const result = await stopEverything(seam)
		expect(result).toEqual({ parent: false, children: 0 })
		expect(calls).toEqual([])
	})

	test("children-only stop: an idle parent is NOT interrupted, only the running child", async () => {
		const { seam, calls } = fakeSeam({ turn: "idle", views: [child("a", "running")] })
		const result = await stopEverything(seam)
		expect(result).toEqual({ parent: false, children: 1 })
		expect(calls).toEqual(["child:a"])
	})

	test("P0 regression: idle parent with several running children never calls interrupt (which would drop the session binding)", async () => {
		const { seam, calls } = fakeSeam({
			turn: "idle",
			views: [child("a", "running"), child("b", "running"), child("done", "completed")],
		})
		const result = await stopEverything(seam)
		expect(result).toEqual({ parent: false, children: 2 })
		expect(calls).toEqual(["child:a", "child:b"])
	})

	test("a failing child is isolated — the rest are still interrupted and counted", async () => {
		const { seam, calls } = fakeSeam({
			turn: "running",
			views: [child("bad", "running"), child("good", "running"), child("done", "completed")],
			childFailsFor: "bad",
		})
		const result = await stopEverything(seam)
		expect(result).toEqual({ parent: true, children: 1 })
		expect(calls).toEqual(["parent", "child:bad", "child:good"])
	})

	test("a seam without status/interruptChild faces degrades safely", async () => {
		const { seam, calls } = fakeSeam({ withStatus: false, withInterruptChild: false, views: [child("a", "running")] })
		const result = await stopEverything(seam)
		expect(result).toEqual({ parent: false, children: 0 })
		expect(calls).toEqual([])
	})

	test("nothing running reports parent=false and zero children, no interrupt", async () => {
		const { seam, calls } = fakeSeam({ turn: "idle", views: [] })
		const result = await stopEverything(seam)
		expect(result).toEqual({ parent: false, children: 0 })
		expect(calls).toEqual([])
	})
})
