// ---------------------------------------------------------------------------
// Regression: the deferred activity-frame latch under the REAL reactive
// runtime (flicker mitigation 1, research/skin-flicker-analysis.md).
//
// Why a dedicated file with mock.module: under a bare `bun test`, the bare
// specifier "solid-js" resolves to the cached server build, whose
// createEffect is a no-op and whose untrack is a pass-through — the latch
// then behaves "fine" in tests while the production client (bun --preload
// @opentui/solid, which rewrites server.js to the real solid.js) runs the
// real reactivity. 2554f8a shipped exactly that blind spot:
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
// This file mocks "solid-js" to the real dist/solid.js BEFORE importing the
// dock, so createFrameLatch and the driver effect share one reactive module.
// ---------------------------------------------------------------------------
import { describe, expect, mock, test } from "bun:test"

const real = await import("../node_modules/solid-js/dist/solid.js")
mock.module("solid-js", () => real)

const { createFrameLatch } = await import("../src/routes/session/widgets-dock")

describe("deferred activity frame latch — real reactive runtime (regression 2554f8a)", () => {
	const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

	test("createEffect-driven push terminates and defers (no feedback loop)", async () => {
		const latch = createFrameLatch(10)
		const [busy, setBusy] = real.createSignal(false)
		let runs = 0
		real.createEffect(() => {
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
