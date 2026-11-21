/**
 * W2-2 C-1 — degrade banner flip-state regression (real reactive runtime).
 *
 * The seam's `available()` is a PLAIN probe, not a signal. Before the fix the
 * banner memo body read only `available()`, so it had zero reactive deps: it
 * cached `false` at open and never repainted when the async refresh flipped
 * availability to `false` — the "manager unavailable" banner never appeared.
 *
 * This drives the EXACT production predicate (`createDegradedMemo`) through a
 * `<Show when={...}>` render and asserts BOTH directions, plus the zero-dependency
 * trap: a non-reactive flip with no refreshTick bump must NOT repaint.
 */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal, Show, type Accessor } from "solid-js"
import { createDegradedMemo } from "../src/routes/session/plugins-panel.tsx"

function BannerProbe(props: {
	available: () => boolean | undefined
	tick: Accessor<number>
}) {
	const degraded = createDegradedMemo(props.available, props.tick)
	return (
		<Show when={degraded()}>
			<text>DEGRADE_BANNER</text>
		</Show>
	)
}

describe("W2-2 C-1 — degrade banner reactivity (flip-state)", () => {
	test("service present -> no banner; refresh flips available to false -> banner; recovery -> no banner", async () => {
		// Plain, non-reactive availability probe (same shape as the seam field).
		let avail: boolean | undefined = undefined // open: not probed yet
		const [tick, setTick] = createSignal(0)
		const renderer = await testRender(
			() => <BannerProbe available={() => avail} tick={tick} />,
			{ width: 60, height: 4 },
		)
		try {
			await renderer.renderOnce()
			// 1) open, not probed -> no banner
			expect(renderer.captureCharFrame()).not.toContain("DEGRADE_BANNER")

			// 2) NON-reactive flip with NO tick bump -> still no banner. This is
			//    the exact zero-dependency bug: available() is not a signal.
			avail = false
			await renderer.renderOnce()
			expect(renderer.captureCharFrame()).not.toContain("DEGRADE_BANNER")

			// 3) refresh settles (tick bump) -> memo re-runs -> banner appears.
			setTick((n) => n + 1)
			await renderer.renderOnce()
			expect(renderer.captureCharFrame()).toContain("DEGRADE_BANNER")

			// 4) service recovers + refresh settles -> banner disappears.
			avail = true
			setTick((n) => n + 1)
			await renderer.renderOnce()
			expect(renderer.captureCharFrame()).not.toContain("DEGRADE_BANNER")
		} finally {
			await renderer.dispose()
		}
	})
})
