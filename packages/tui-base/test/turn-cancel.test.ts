/**
 * Batch V2: cancel contract + scrollbar style guard.
 *
 * 1. createCtrlCGate / createTurnCancel — the pure key decisions:
 *    ctrl+c interrupts + arms, a second press inside the window quits, a
 *    late second press re-arms. Esc falls through when idle or while the
 *    slash palette is open. WITHOUT `confirmStop` the legacy single-press
 *    interrupt stays; WITH it (U6 stop-confirm contract) the first Esc only
 *    ARMS, the second inside the window opens the confirmation (confirmStop),
 *    and a late second press re-arms — a stray Esc can never kill a turn.
 * 2. Source guards — the client render passes exitOnCtrlC:false (OpenTUI's
 *    default `true` exits ahead of every keymap layer and wiped the frame),
 *    the cancel layer is wired into the v2 page with the stop-confirm dialog
 *    (main turn + every live subagent), and the transcript scrollbar follows
 *    the vendored default (off, themed track) instead of the always-on
 *    default-gray track.
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

type ArmRecord = { armed: boolean; key: "escape" | "ctrl-c" }

function harness(
	opts: { busy?: boolean; palette?: boolean; confirmStop?: boolean } = {},
) {
	const calls: string[] = []
	const armed: ArmRecord[] = []
	let busy = opts.busy ?? false
	const cancel = createTurnCancel(
		{
			busy: () => busy,
			interrupt: () => {
				calls.push("interrupt")
				busy = false // the seam settles the turn → page busy → false
			},
			...(opts.confirmStop === false ? {} : { confirmStop: () => calls.push("confirmStop") }),
			quit: () => calls.push("quit"),
			enabled: () => true,
			escapeYields: () => opts.palette ?? false,
			windowMs: 400,
		},
		(armedValue, key) => armed.push({ armed: armedValue, key }),
	)
	return { cancel, calls, armed, isBusy: () => busy }
}

describe("turn cancel decisions — legacy single-esc (no confirmStop)", () => {
	test("esc on a running turn interrupts and the page returns idle", () => {
		const h = harness({ confirmStop: false, busy: true })
		expect(h.cancel.escape()).toBe(true)
		expect(h.calls).toEqual(["interrupt"])
		expect(h.isBusy()).toBe(false)
		h.cancel.dispose()
	})
	test("esc when idle is NOT consumed (falls through to the composer)", () => {
		const h = harness({ confirmStop: false })
		expect(h.cancel.escape()).toBe(false)
		expect(h.calls).toEqual([])
	})
	test("esc yields to an open slash palette even mid-turn", () => {
		const h = harness({ confirmStop: false, palette: true })
		expect(h.cancel.escape()).toBe(false)
		expect(h.calls).toEqual([])
	})
})

describe("turn cancel decisions — U6 stop-confirm double-esc", () => {
	test("first esc on a running turn only ARMS (no interrupt, esc hint)", () => {
		const h = harness({ busy: true })
		expect(h.cancel.escape()).toBe(true)
		expect(h.calls).toEqual([])
		expect(h.armed).toEqual([{ armed: true, key: "escape" }])
		h.cancel.dispose()
	})
	test("second esc inside the window opens the confirmation, turn untouched", () => {
		const h = harness({ busy: true })
		h.cancel.escape()
		h.cancel.escape()
		expect(h.calls).toEqual(["confirmStop"])
		expect(h.isBusy()).toBe(true) // the dialog decides — nothing fired yet
		expect(h.armed).toEqual([
			{ armed: true, key: "escape" },
			{ armed: false, key: "escape" },
		])
		h.cancel.dispose()
	})
	test("late second esc (window expired) re-arms instead of confirming", async () => {
		const h = harness({ busy: true })
		h.cancel.escape()
		await new Promise((resolve) => setTimeout(resolve, 450))
		expect(h.armed).toEqual([{ armed: true, key: "escape" }, { armed: false, key: "escape" }])
		h.cancel.escape() // expired arm: this press re-arms, never confirms
		expect(h.calls).toEqual([])
		expect(h.armed.at(-1)).toEqual({ armed: true, key: "escape" })
		h.cancel.dispose()
	})
	test("the armed esc disarms after the window", async () => {
		const h = harness({ busy: true })
		h.cancel.escape()
		await new Promise((resolve) => setTimeout(resolve, 450))
		expect(h.armed.at(-1)).toEqual({ armed: false, key: "escape" })
		h.cancel.dispose()
	})
	test("idle esc still falls through and never arms the stop", () => {
		const h = harness({ busy: false })
		expect(h.cancel.escape()).toBe(false)
		expect(h.cancel.escape()).toBe(false)
		expect(h.calls).toEqual([])
		expect(h.armed).toEqual([])
	})
	test("esc yields to an open slash palette even mid-turn (no arm)", () => {
		const h = harness({ busy: true, palette: true })
		expect(h.cancel.escape()).toBe(false)
		expect(h.calls).toEqual([])
		expect(h.armed).toEqual([])
	})
	test("an armed esc window is cleared by the ctrl+c chain (no chain mixing)", () => {
		const h = harness({ busy: true })
		h.cancel.escape()
		h.cancel.ctrlC() // interrupts + arms the quit affordance
		expect(h.calls).toEqual(["interrupt"])
		expect(h.armed).toEqual([
			{ armed: true, key: "escape" },
			{ armed: false, key: "escape" },
			{ armed: true, key: "ctrl-c" },
		])
		// The cleared esc arm cannot confirm on the next press: the interrupt
		// already settled the turn, so the page is idle and esc falls through
		// (idle esc is a no-op — never a stale-arm confirm).
		expect(h.cancel.escape()).toBe(false)
		expect(h.calls).toEqual(["interrupt"])
		expect(h.armed.at(-1)).toEqual({ armed: true, key: "ctrl-c" })
		h.cancel.dispose()
	})
	test("dispose clears a pending arm", () => {
		const h = harness({ busy: true })
		h.cancel.escape()
		h.cancel.dispose()
		expect(h.armed.at(-1)).toEqual({ armed: false, key: "escape" })
	})
})

describe("turn cancel decisions — ctrl+c chain (unchanged by U6)", () => {
	test("ctrl+c once: interrupts the running turn and shows the quit affordance, no quit", () => {
		const h = harness({ busy: true })
		expect(h.cancel.ctrlC()).toBe(true)
		expect(h.calls).toEqual(["interrupt"])
		expect(h.armed).toEqual([{ armed: true, key: "ctrl-c" }])
		h.cancel.dispose()
	})
	test("ctrl+c twice inside the window quits exactly once", () => {
		const h = harness()
		h.cancel.ctrlC()
		h.cancel.ctrlC()
		expect(h.calls).toEqual(["quit"])
		expect(h.armed).toEqual([
			{ armed: true, key: "ctrl-c" },
			{ armed: false, key: "ctrl-c" },
		])
	})
	test("the affordance disarms after the window", async () => {
		const h = harness()
		h.cancel.ctrlC()
		await new Promise((resolve) => setTimeout(resolve, 450))
		expect(h.armed).toEqual([
			{ armed: true, key: "ctrl-c" },
			{ armed: false, key: "ctrl-c" },
		])
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
	test("the v2 page wires the U6 stop-confirm dialog over the seam's stop faces", () => {
		const entry = src("examples/v2-entry.tsx")
		expect(entry).toContain("confirmStop:")
		expect(entry).toContain("confirmStopAll()")
		expect(entry).toContain("DialogConfirm")
		// The everything-stop: the main turn AND every live subagent
		// (interruptChild per running row — the viewer's stop-all leg).
		expect(entry).toMatch(/interruptChild\?\.\(/)
		expect(entry).toMatch(/status !== "running"[\s\S]*?continue/)
	})
	test("cancel layer binds escape + ctrl+c on a global, gated layer", () => {
		const cancel = src("src/routes/session/turn-cancel.tsx")
		expect(cancel).toContain('bind: "escape"')
		expect(cancel).toContain('bind: "ctrl+c"')
		expect(cancel).toContain('mode: "global"')
		expect(cancel).toContain("enabled: props.enabled()")
	})
	test("the esc arm hint is localized (U6 prompt bar)", () => {
		const cancel = src("src/routes/session/turn-cancel.tsx")
		expect(cancel).toContain('t("turn.stop.escHint")')
	})
	test("transcript scrollbar: vendored default off + themed track (no default-gray column)", () => {
		const transcript = src("src/routes/session/transcript.tsx")
		expect(transcript).not.toContain("visible: true")
		expect(transcript).not.toContain("trackOptions: {}")
		expect(transcript).toContain("visible: props.scrollbar ?? false")
		expect(transcript).toMatch(/trackOptions:\s*\{\s*backgroundColor:/)
	})
})
