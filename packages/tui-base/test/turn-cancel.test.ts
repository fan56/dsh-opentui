/**
 * Batch V2: cancel contract + scrollbar style guard.
 *
 * 1. createCtrlCGate / createTurnCancel — the pure key decisions:
 *    esc interrupts a running turn (and falls through when idle or while
 *    the slash palette is open); ctrl+c interrupts + arms, a second press
 *    inside the window quits, a late second press re-arms.
 * 2. Source guards — the client render passes exitOnCtrlC:false (OpenTUI's
 *    default `true` exits ahead of every keymap layer and wiped the frame),
 *    the cancel layer is wired into the v2 page, and the transcript
 *    scrollbar follows the vendored default (off, themed track) instead of
 *    the always-on default-gray track.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CTRL_C_QUIT_WINDOW_MS, createCtrlCGate, createTurnCancel } from "../src/routes/session/turn-cancel"

const src = (file: string) => readFileSync(join(import.meta.dir, "..", file), "utf8")

describe("ctrl+c double-press gate", () => {
	test("window is inside the tui-pi 150-500ms contract", () => {
		expect(CTRL_C_QUIT_WINDOW_MS).toBeGreaterThanOrEqual(150)
		expect(CTRL_C_QUIT_WINDOW_MS).toBeLessThanOrEqual(500)
	})
	test("first press arms, second inside the window quits, late press re-arms", () => {
		let t = 1000
		const gate = createCtrlCGate(500, () => t)
		expect(gate.press()).toBe("arm")
		t += 300
		expect(gate.press()).toBe("quit")
		expect(gate.press()).toBe("arm") // quit consumed the arm
		t += 900
		expect(gate.press()).toBe("arm") // late: re-arms, never quits
		t += 100
		expect(gate.press()).toBe("quit")
	})
})

function harness(opts: { busy?: boolean; palette?: boolean } = {}) {
	const calls: string[] = []
	const armed: boolean[] = []
	let busy = opts.busy ?? false
	const cancel = createTurnCancel(
		{
			busy: () => busy,
			interrupt: () => {
				calls.push("interrupt")
				busy = false // the seam settles the turn → page busy → false
			},
			quit: () => calls.push("quit"),
			enabled: () => true,
			escapeYields: () => opts.palette ?? false,
			windowMs: 400,
		},
		(value) => armed.push(value),
	)
	return { cancel, calls, armed, isBusy: () => busy }
}

describe("turn cancel decisions", () => {
	test("esc on a running turn interrupts and the page returns idle", () => {
		const h = harness({ busy: true })
		expect(h.cancel.escape()).toBe(true)
		expect(h.calls).toEqual(["interrupt"])
		expect(h.isBusy()).toBe(false)
		h.cancel.dispose()
	})
	test("esc when idle is NOT consumed (falls through to the composer)", () => {
		const h = harness({ busy: false })
		expect(h.cancel.escape()).toBe(false)
		expect(h.calls).toEqual([])
	})
	test("esc yields to an open slash palette even mid-turn", () => {
		const h = harness({ busy: true, palette: true })
		expect(h.cancel.escape()).toBe(false)
		expect(h.calls).toEqual([])
	})
	test("ctrl+c once: interrupts the running turn and shows the quit affordance, no quit", () => {
		const h = harness({ busy: true })
		expect(h.cancel.ctrlC()).toBe(true)
		expect(h.calls).toEqual(["interrupt"])
		expect(h.armed).toEqual([true])
		h.cancel.dispose()
	})
	test("ctrl+c twice inside the window quits exactly once", () => {
		const h = harness({ busy: false })
		h.cancel.ctrlC()
		h.cancel.ctrlC()
		expect(h.calls).toEqual(["quit"])
		expect(h.armed).toEqual([true, false])
	})
	test("the affordance disarms after the window", async () => {
		const h = harness()
		h.cancel.ctrlC()
		await new Promise((resolve) => setTimeout(resolve, 450))
		expect(h.armed).toEqual([true, false])
		h.cancel.ctrlC() // window expired: re-arm, no quit
		expect(h.calls).toEqual([])
		h.cancel.dispose()
	})
})

describe("wiring source guards", () => {
	test("client render disables OpenTUI's ctrl+c exit and mounts the cancel layer", () => {
		const entry = src("examples/v2-entry.tsx")
		expect(entry).toMatch(/\{\s*useMouse:\s*true,\s*exitOnCtrlC:\s*false\s*\}/)
		expect(entry).toContain("createComponent(TurnCancelKeys")
		// The steer/queue batch needs the abort signal too: interrupt() resolves
		// the seam turn without an error, so the page marks it before cancelling.
		expect(entry).toContain("turnAborted = true")
		expect(entry).toContain("seam.interrupt()")
		expect(entry).toContain("escapeYields: () => slash.controller.open")
	})
	test("cancel layer binds escape + ctrl+c on a global, gated layer", () => {
		const cancel = src("src/routes/session/turn-cancel.tsx")
		expect(cancel).toContain('bind: "escape"')
		expect(cancel).toContain('bind: "ctrl+c"')
		expect(cancel).toContain('mode: "global"')
		expect(cancel).toContain("enabled: props.enabled()")
	})
	test("transcript scrollbar: vendored default off + themed track (no default-gray column)", () => {
		const transcript = src("src/routes/session/transcript.tsx")
		expect(transcript).not.toContain("visible: true")
		expect(transcript).not.toContain("trackOptions: {}")
		expect(transcript).toContain("visible: props.scrollbar ?? false")
		expect(transcript).toMatch(/trackOptions:\s*\{\s*backgroundColor:/)
	})
})
