/**
 * FALSE-GREEN CANARY (pilot/shell-render): guards the bun-test resolve of
 * solid-js against the SSR build. Without the `[test].preload` of
 * `@opentui/solid/preload` (packages/shell/bunfig.toml), bun resolves
 * "solid-js" to dist/server.js, whose `createEffect` is a NO-OP — reactive
 * tests then render nothing and still pass ("every reactive test silently
 * vacuums", bunfig comments; research/oldfox-reuse-verdict.md §6). The
 * defense exists; until this file nothing VERIFIED it.
 *
 * Canary dimensions (fails under the server-build resolve):
 *   1. LOADED BUILD IDENTITY: import("solid-js") must carry the client
 *      build's `cancelCallback` export (the plugin swaps server.js→solid.js
 *      at load time; identity is checked through the loaded module).
 *   2. EFFECT EXECUTION: a createEffect registered in createRoot must RUN
 *      on a signal write (no-op under SSR).
 *   3. REACTIVE PROPAGATION TO THE FRAME: a signal-driven component mounted
 *      through testRender must repaint when the signal changes (a no-op
 *      effect pins the first frame forever).
 *
 * HOW TO SELF-PROVE (deliberate break, do this once by hand):
 *   1. Neutralize the preload, e.g.
 *        cd packages/shell
 *        sed -i.bak 's/preload = \["@opentui\/solid\/preload"\]/preload = []/g' bunfig.toml
 *      (both the top-level and the [test] section matter: `bun test` only
 *      reads the [test] one, but break BOTH to prove the file is the guard).
 *   2. Run: bun test test/solid-reactivity-canary-ft.test.tsx
 *      EXPECTED RED: all three dimensions fail — the identity test misses
 *      `cancelCallback` (server build loaded), the effect test sees 0 runs,
 *      the frame test times out waiting for the repainted text.
 *   3. Restore bunfig.toml (delete the .bak), re-run: EXPECTED GREEN.
 * A run that goes red on 1+2+3 and green after restore proves the canary
 * watches the actual defense, not something adjacent.
 */
import { describe, expect, test } from "bun:test"
import { createRoot, createSignal, createEffect } from "solid-js"
import { testRender } from "@opentui/solid"

/** Dimension 1 — the loaded build identity. The preload's bun plugin
 * intercepts the LOAD of solid-js/dist/server.js and swaps in the client
 * dist/solid.js; without it, `import("solid-js")` really loads the server
 * build. Resolution is unchanged by the plugin (import.meta.resolve still
 * points at dist/server.js either way), so identity is checked through an
 * export only the client build carries: `cancelCallback`. */
test("canary: import('solid-js') loads the client build, not the server build", async () => {
	const mod: Record<string, unknown> = await import("solid-js")
	// Under the broken preload the server build loads — this assert is the line that goes red.
	expect(mod.cancelCallback).toBeTypeOf("function")
})

/** Dimension 2 — createEffect must actually run under bun test. */
test("canary: createEffect executes on a signal write", async () => {
	let effectRuns = 0
	let observed = ""

	await createRoot(async (dispose) => {
		const [value, setValue] = createSignal("initial")
		createEffect(() => {
			observed = value()
			effectRuns += 1
		})
		// Solid effects are batched to a microtask; yield once.
		await Promise.resolve()
		await Promise.resolve()
		expect(effectRuns).toBeGreaterThan(0)
		expect(observed).toBe("initial")

		setValue("updated")
		await Promise.resolve()
		await Promise.resolve()
		dispose()
	})

	// Under the SSR build effectRuns stays 0 forever — this assert is the line that goes red.
	expect(effectRuns).toBeGreaterThan(0)
	expect(observed).toBe("updated")
})

/** Dimension 3 — reactivity must propagate through the real renderer frame. */
test("canary: a signal write repaints the real renderer frame", async () => {
	const [text, setText] = createSignal("canary-frame-v1")
	const setup = await testRender(() => <text>marker {text()}</text>, {
		width: 40,
		height: 6,
		useMouse: false,
	})
	try {
		await setup.renderOnce()
		expect(setup.captureCharFrame()).toContain("canary-frame-v1")

		setText("canary-frame-v2")
		const frame = await setup.waitForFrame((frame) => frame.includes("canary-frame-v2"))
		expect(normalize(frame)).toContain("canary-frame-v2")
		// And the old value is gone (no stale pin).
		expect(normalize(frame)).not.toContain("canary-frame-v1")
	} finally {
		await setup.dispose()
	}
})

function normalize(frame: string): string {
	return frame
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.trimEnd()
}
