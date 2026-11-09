// ---------------------------------------------------------------------------
// Regression: the deferred activity-frame latch under the REAL reactive
// runtime (flicker mitigation 1, research/skin-flicker-analysis.md).
//
// Why a dedicated file: before the [test].preload bunfig fix, a bare
// `bun test` resolved the bare specifier "solid-js" to the cached server
// build, whose createEffect is a no-op and whose untrack is a pass-through
// — the latch then behaved "fine" in tests while the production client (bun
// --preload @opentui/solid, which rewrites server.js to the real solid.js)
// ran the real reactivity. 2554f8a shipped exactly that blind spot:
//
//   createEffect(() => activityFrameLatch.push(turnActive()))   // dock body
//   push: frameLatchNext(latch(), target) ... setLatch(next.latch)
//
// A TRACKED latch() read inside push makes the effect subscribe to the very
// signal push writes; frameLatchNext returns a FRESH object per flip, so
// Object.is always reports a change, the effect re-fires synchronously,
// re-clears the just-armed timer and re-arms it — runaway recursion. In the
// app the render layer swallows it and the latch never leaves `pending`:
// the activity frame never mounts (the 2554f8a regression this file pins).
//
// With bunfig [test].preload in place the test runner loads the real
// runtime, so this file imports "solid-js" plainly — the dock's
// createFrameLatch and the driver effect below share one reactive module,
// and the `expect(runs).toBe(1)` assertion doubles as a guard: under a
// no-op server build the effect never runs and the test goes red.
// ---------------------------------------------------------------------------
import { describe, expect, test } from "bun:test"
import { createEffect, createSignal } from "solid-js"
import { createFrameLatch } from "../src/routes/session/widgets-dock"

describe("deferred activity frame latch — real reactive runtime (regression 2554f8a)", () => {
	const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

	test("createEffect-driven push terminates and defers (no feedback loop)", async () => {
		const latch = createFrameLatch(10)
		const [busy, setBusy] = createSignal(false)
		let runs = 0
		createEffect(() => {
			runs += 1
			latch.push(busy())
		})
		await wait(20) // solid effects fire on the microtask queue
		expect(runs).toBe(1) // initial idle run settles (a loop blows the stack here)
		expect(latch.shown()).toBe(false)
		setBusy(true)
		expect(latch.shown()).toBe(false) // still deferred this tick
		await wait(40)
		expect(latch.shown()).toBe(true) // timer fired → mounted
		expect(runs).toBeLessThan(20) // no re-fire storm
		setBusy(false)
		expect(latch.shown()).toBe(true) // deferred unmount
		await wait(40)
		expect(latch.shown()).toBe(false)
		expect(runs).toBeLessThan(20)
		latch.dispose()
	})
})
