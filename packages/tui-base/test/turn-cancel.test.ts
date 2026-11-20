/**
 * Batch V2: cancel contract + scrollbar style guard.
 *
 * 1. createTurnCancel — the pure key decisions:
 *    ctrl+c on idle OPENS the quit dialog (confirmQuit), on a busy turn the
 *    1st press only interrupts and the NEXT press (any time later, no timing
 *    gate) opens the quit dialog; a fresh turn restarts the cycle. Esc falls
 *    through when idle or while the slash palette is open. WITHOUT `confirmStop`
 *    the legacy single-press interrupt stays; WITH it (U6 stop-confirm contract)
 *    the first Esc only ARMS, the second inside the window opens the confirmation
 *    (confirmStop), and a late second press re-arms — a stray Esc can never kill
 *    a turn.
 * 2. Source guards — the client render passes exitOnCtrlC:false (OpenTUI's
 *    default `true` exits ahead of every keymap layer and wiped the frame),
 *    the cancel layer is wired into the v2 page with the stop-confirm dialog
 *    (main turn + every live subagent), the quit dialog reuses DialogConfirm
 *    and calls props.quit, and the transcript scrollbar follows the vendored
 *    default (off, themed track) instead of the always-on default-gray track.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CTRL_C_QUIT_WINDOW_MS, createTurnCancel } from "../src/routes/session/turn-cancel"

const src = (file: string) => readFileSync(join(import.meta.dir, "..", file), "utf8")

type ArmRecord = { armed: boolean; key: "escape" }

function harness(
	opts: { busy?: boolean; palette?: boolean; confirmStop?: boolean; settleOnInterrupt?: boolean } = {},
) {
	const calls: string[] = []
	const armed: ArmRecord[] = []
	let busy = opts.busy ?? false
	const cancel = createTurnCancel(
		{
			busy: () => busy,
			interrupt: () => {
				calls.push("interrupt")
				// The seam settles the turn → page busy → false; `false` models an
				// async interrupt whose settle lands later (busy stays true).
				if (opts.settleOnInterrupt !== false) busy = false
			},
			...(opts.confirmStop === false ? {} : { confirmStop: () => calls.push("confirmStop") }),
			quit: () => calls.push("quit"),
			enabled: () => true,
			escapeYields: () => opts.palette ?? false,
			windowMs: 400,
		},
		(armedValue, key) => armed.push({ armed: armedValue, key }),
		() => calls.push("confirmQuit"),
	)
	return { cancel, calls, armed, isBusy: () => busy, setBusy: (value: boolean) => { busy = value } }
}

describe("esc arm window", () => {
	test("window is inside the tui-pi 150-500ms contract", () => {
		expect(CTRL_C_QUIT_WINDOW_MS).toBeGreaterThanOrEqual(150)
		expect(CTRL_C_QUIT_WINDOW_MS).toBeLessThanOrEqual(500)
	})
})

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
		h.cancel.ctrlC() // interrupts the busy turn; the esc arm is cleared
		expect(h.calls).toEqual(["interrupt"])
		expect(h.armed).toEqual([
			{ armed: true, key: "escape" },
			{ armed: false, key: "escape" },
		])
		// The cleared esc arm cannot confirm on the next press: the interrupt
		// already settled the turn, so the page is idle and esc falls through.
		expect(h.cancel.escape()).toBe(false)
		expect(h.calls).toEqual(["interrupt"])
		h.cancel.dispose()
	})
	test("dispose clears a pending arm", () => {
		const h = harness({ busy: true })
		h.cancel.escape()
		h.cancel.dispose()
		expect(h.armed.at(-1)).toEqual({ armed: false, key: "escape" })
	})
})

describe("turn cancel decisions — ctrl+c quit dialog (no timing gate)", () => {
	test("idle: a single ctrl+c opens the quit dialog (no interrupt, no quit yet)", () => {
		const h = harness({ busy: false })
		expect(h.cancel.ctrlC()).toBe(true)
		expect(h.calls).toEqual(["confirmQuit"])
		expect(h.armed).toEqual([])
	})
	test("busy: the first ctrl+c interrupts only — no dialog", () => {
		const h = harness({ busy: true })
		expect(h.cancel.ctrlC()).toBe(true)
		expect(h.calls).toEqual(["interrupt"])
		expect(h.calls).not.toContain("confirmQuit")
	})
	test("busy: the second ctrl+c opens the quit dialog", () => {
		const h = harness({ busy: true })
		h.cancel.ctrlC() // interrupt
		h.cancel.ctrlC() // dialog
		expect(h.calls).toEqual(["interrupt", "confirmQuit"])
	})
	test("busy: the second press opens the dialog even if busy has not settled (no timing gate)", () => {
		// settleOnInterrupt:false — the seam's abort is async, so busy stays true.
		const h = harness({ busy: true, settleOnInterrupt: false })
		h.cancel.ctrlC()
		h.cancel.ctrlC()
		expect(h.calls).toEqual(["interrupt", "confirmQuit"])
	})
	test("busy: a late third press also opens the dialog (any time later)", async () => {
		const h = harness({ busy: true })
		h.cancel.ctrlC()
		await new Promise((resolve) => setTimeout(resolve, 600)) // outlive the old 500ms gate
		h.cancel.ctrlC()
		expect(h.calls).toEqual(["interrupt", "confirmQuit"])
	})
	test("a fresh turn restarts the cycle: busy interrupt → dialog, then a NEW turn interrupts again", () => {
		const h = harness({ busy: true })
		h.cancel.ctrlC() // interrupt turn #1
		h.cancel.ctrlC() // quit dialog, latch cleared
		h.setBusy(true) // a NEW turn starts
		h.cancel.ctrlC() // interrupts the new turn, NOT another dialog
		expect(h.calls).toEqual(["interrupt", "confirmQuit", "interrupt"])
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
	test("the v2 page wires the U6 stop-confirm dialog to the shared stop-everything helper", () => {
		const entry = src("examples/v2-entry.tsx")
		expect(entry).toContain("confirmStop:")
		expect(entry).toContain("confirmStopAll()")
		expect(entry).toContain("DialogConfirm")
		// The seam stop faces moved into stop-all.ts so /stop can share the
		// exact same leg; the page delegates instead of re-implementing them.
		expect(entry).toContain('from "../src/routes/session/stop-all"')
		expect(entry).toContain("void stopEverything(seam)")
		const helper = src("src/routes/session/stop-all.ts")
		// Parent first, then interruptChild per RUNNING row, with per-child
		// failure isolation (the viewer's stop-all leg).
		expect(helper).toMatch(/seam\.interrupt\(\)/)
		expect(helper).toContain("seam.subagentViews")
		expect(helper).toMatch(/status !== "running"[\s\S]*?continue/)
		expect(helper).toContain("seam.interruptChild")
		expect(helper).toContain("catch")
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
	test("no double-press quit gate; quit reuses DialogConfirm and calls props.quit", () => {
		const cancel = src("src/routes/session/turn-cancel.tsx")
		// The 500ms quit gate and its hint are gone: a dialog is now the step.
		expect(cancel).not.toContain("createCtrlCGate")
		expect(cancel).not.toContain("Press Ctrl+C again to quit")
		expect(cancel).toContain("DialogConfirm")
		expect(cancel).toContain('title={t("turn.quit.confirmTitle")}')
		expect(cancel).toContain("onConfirm={props.quit}")
	})
	test("transcript scrollbar: vendored default off + themed track (no default-gray column)", () => {
		const transcript = src("src/routes/session/transcript.tsx")
		expect(transcript).not.toContain("visible: true")
		expect(transcript).not.toContain("trackOptions: {}")
		expect(transcript).toContain("visible: props.scrollbar ?? false")
		expect(transcript).toMatch(/trackOptions:\s*\{\s*backgroundColor:/)
	})
})
