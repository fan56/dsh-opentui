/**
 * A3b+A8 — DEAD recovery UI: R key, composer disable, three-state footer,
 * recovered/failed/locked notices + persistent banner.
 *
 * The controller is pure (no renderer); the R key is exercised through the
 * REAL @opentui/keymap engine with the same layer shape v2-entry registers.
 * Fake seam events drive every transition — no shell import, no live bridge.
 */
import { registerDefaultKeys, registerEnabledFields } from "@opentui/keymap/addons"
import { createTestKeymap } from "@opentui/keymap/testing"
import { beforeEach, describe, expect, jest, test } from "bun:test"
import { TuiKeybind } from "../src/config/keybind"
import { ComposerController } from "../src/routes/session/composer-state"
import { clearNotices, noticeList, showNotice } from "../src/routes/session/notices-dock"
import { widthSafeBannerReason } from "../src/routes/session/recovery-banner"
import {
	RECOVERY_NOTICE_TTL_MS,
	RECOVERY_RECONNECT_BIND,
	RecoveryUiController,
	recoveryBannerLines,
	type RecoveryUiOptions,
	type RecoveryTexts,
} from "../src/routes/session/recovery-ui"

const texts: RecoveryTexts = {
	transient: () => "reconnecting...",
	recovered: (count) => `caught up ${count} events`,
	failedReason: (reason) => `failed: ${reason}`,
	// Mirror the real i18n templates (recovery.locked{.reason,.holder}).
	locked: (reason, holder) =>
		reason === undefined
			? "writer-held"
			: holder === undefined
				? `writer-held: ${reason}`
				: `writer-held: ${reason} (held by ${holder})`,
	cooldown: (remainingMs) => `cooling down, ${remainingMs} ms left`,
	reconnect: () => "Reconnect [R]",
	retry: () => "Retry [R]",
	newSession: () => "New session",
	quit: () => "Quit",
}

type Notice = { text: string; ttl: number; kind?: "error" }

function setup() {
	const state = {
		recovers: 0,
		newSessions: 0,
		quits: 0,
		notices: [] as Notice[],
	}
	const controller = new RecoveryUiController({
		recover: async () => {
			state.recovers++
		},
		texts,
		onNotice: (text, ttl, kind) => state.notices.push({ text, ttl, kind }),
		onNewSession: () => state.newSessions++,
		onQuit: () => state.quits++,
	} satisfies RecoveryUiOptions)
	return { controller, state }
}

/** Compose the same page layer shape as v2-entry and press the real key. */
function pressReconnect(controller: RecoveryUiController) {
	const harness = createTestKeymap({ defaultKeys: false })
	registerDefaultKeys(harness.keymap)
	registerEnabledFields(harness.keymap)
	const command = controller.reconnectCommand()
	harness.keymap.registerLayer({
		enabled: () => true,
		commands: [{ name: command.id, enabled: command.enabled, run: command.run }],
		bindings: [{ key: command.bind, cmd: command.id }],
	})
	harness.host.press(RECOVERY_RECONNECT_BIND)
	harness.cleanup()
}

beforeEach(() => {
	clearNotices()
})

describe("reconnect key binding and gate", () => {
	test("plain r is free in the base keybind config (ctrl+r / <leader>r are distinct strokes)", () => {
		expect(RECOVERY_RECONNECT_BIND).toBe("r")
		const parsed = TuiKeybind.parse({}) as Record<string, unknown>
		for (const value of Object.values(parsed)) {
			const strokes = String(value)
				.split(",")
				.map((stroke) => stroke.trim())
			expect(strokes, `no bare r binding in ${String(value)}`).not.toContain("r")
		}
	})

	test("dead state: R dispatches recover once (recovering gate blocks a second press)", async () => {
		const { controller, state } = setup()
		controller.handleEvent({ type: "bridge.dead" })
		expect(controller.phase).toBe("dead")
		pressReconnect(controller)
		await Promise.resolve()
		expect(state.recovers).toBe(1)
		expect(controller.phase).toBe("recovering")
		pressReconnect(controller)
		await Promise.resolve()
		expect(state.recovers).toBe(1)
	})

	test("ready state: R is a no-op (never starts a recovery)", async () => {
		const { controller, state } = setup()
		pressReconnect(controller)
		await Promise.resolve()
		expect(state.recovers).toBe(0)
		expect(controller.phase).toBe("ready")
	})

	test("failed and locked states also accept R; recovering / ready refuse it", async () => {
		for (const event of ["bridge.recovery.failed", "bridge.recovery.locked"] as const) {
			const { controller, state } = setup()
			controller.handleEvent({ type: event, details: { error: { message: "x" } } })
			expect(controller.canRecover()).toBe(true)
			pressReconnect(controller)
			await Promise.resolve()
			expect(state.recovers).toBe(1)
		}
	})

	/**
	 * RM-2b V3 real-device BLOCKED case: a pending approval card owns the modal
	 * mode + an ownership frame, so `pageOwns()` is false. On bridge.dead the
	 * card becomes a terminal "已失效" card that STAYS visible, so the modal is
	 * never released. R must still reach recover() under that modal.
	 *
	 * The layer below mirrors the FIX in examples/v2-entry.tsx: `mode:"global"`
	 * (no mode requirement -> dispatches under modal mode) and
	 * `enabled: () => pageOwns() || controller.canRecover()`.
	 */
	function pressReconnectWithModal(controller: RecoveryUiController, pageOwns: () => boolean) {
		const harness = createTestKeymap({ defaultKeys: false })
		registerDefaultKeys(harness.keymap)
		registerEnabledFields(harness.keymap)
		const MODE_KEY = "opencode.mode"
		harness.keymap.registerLayerFields({
			mode(value: string, context: { require: (key: string, value: string) => void }) {
				context.require(MODE_KEY, value)
			},
		})
		// Simulate the lingering terminal-card dialog: modal mode active, and
		// the page does NOT own the keyboard (pageOwns() === false).
		harness.keymap.setData(MODE_KEY, "modal")
		harness.keymap.registerLayer({
			mode: "modal",
			enabled: true,
			bindings: [{ key: "escape", cmd: () => true }],
		})

		const command = controller.reconnectCommand()
		harness.keymap.registerLayer({
			enabled: () => pageOwns() || controller.canRecover(),
			commands: [{ name: command.id, enabled: command.enabled, run: command.run }],
			bindings: [{ key: command.bind, cmd: command.id }],
		})
		harness.host.press(RECOVERY_RECONNECT_BIND)
		harness.cleanup()
	}

	test("dead state: R reaches recover even with a modal card owning input (RM-2b V3)", async () => {
		const { controller, state } = setup()
		controller.handleEvent({ type: "bridge.dead", details: { stage: "runtime", signal: "SIGKILL" } })
		const modalOwnsInput = () => false
		expect(controller.canRecover()).toBe(true)
		pressReconnectWithModal(controller, modalOwnsInput)
		await Promise.resolve()
		expect(state.recovers).toBe(1)
	})

	test("non-dead state with a modal owning input: R stays gated (no accidental recovery)", async () => {
		const { controller, state } = setup()
		const modalOwnsInput = () => false
		pressReconnectWithModal(controller, modalOwnsInput)
		await Promise.resolve()
		expect(state.recovers).toBe(0)
	})
})

describe("three-state footer + composer disable", () => {
	test("footer maps dead → dead, recovering → recovering, recovered → ready", async () => {
		const { controller } = setup()
		expect(controller.footerStatus).toBe("ready")
		controller.handleEvent({ type: "bridge.dead" })
		expect(controller.footerStatus).toBe("dead")
		await controller.recover()
		expect(controller.footerStatus).toBe("recovering")
		controller.handleEvent({ type: "bridge.recovered", details: { applied: 0 } })
		expect(controller.footerStatus).toBe("ready")
	})

	test("RECOVERING disables the composer AND preserves the typed draft", async () => {
		const { controller } = setup()
		const sent: string[] = []
		const composer = new ComposerController({
			send: (text) => {
				sent.push(text)
				return Promise.resolve()
			},
			steer: async () => ({ accepted: false as const, reason: "UNSUPPORTED" }),
			disabled: () => controller.composerDisabled,
		})
		controller.handleEvent({ type: "bridge.dead" })
		await controller.recover()
		expect(controller.composerDisabled).toBe(true)
		const draft = "half-typed draft"
		expect(composer.submit(draft)).toBe("ignored")
		expect(sent).toEqual([])
		// The draft was never committed to history either — caller keeps it.
		expect(composer.history.move(-1, draft)).toBeUndefined()
		// Once recovery settles, the same draft is sendable.
		controller.handleEvent({ type: "bridge.recovered", details: { applied: 0 } })
		expect(controller.composerDisabled).toBe(false)
		expect(composer.submit(draft)).toBe("sent")
		expect(sent).toEqual([draft])
	})
})

describe("footer follows controller phase via subscription (v2-entry wiring)", () => {
	test("bridge.dead drives the footer to dead immediately (auto event path, no regression)", () => {
		const { controller } = setup()
		const seen: string[] = []
		controller.subscribe(() => seen.push(controller.footerStatus))
		controller.handleEvent({ type: "bridge.dead" })
		expect(seen.at(-1)).toBe("dead")
		expect(controller.footerStatus).toBe("dead")
	})

	test("R transition drives footer recovering → ready through the phase subscription, no seam event needed", async () => {
		const { controller } = setup()
		const seen: string[] = []
		controller.subscribe(() => seen.push(controller.footerStatus))
		controller.handleEvent({ type: "bridge.dead" })
		pressReconnect(controller)
		await Promise.resolve()
		// No bridge.recovered event yet — the R path alone must show recovering.
		expect(seen.at(-1)).toBe("recovering")
		expect(controller.canRecover()).toBe(false)
		controller.handleEvent({ type: "bridge.recovered", details: { applied: 0 } })
		expect(seen.at(-1)).toBe("ready")
		expect(seen.indexOf("recovering")).toBeLessThan(seen.lastIndexOf("ready"))
	})
})

describe("recovered / failed / locked surfaces", () => {
	test("bridge.recovered: notice carries N, retires after 4s", () => {
		const { controller, state } = setup()
		controller.handleEvent({ type: "bridge.recovered", details: { applied: 7, sessionId: "sess-7" } })
		expect(state.notices).toEqual([{ text: "caught up 7 events", ttl: RECOVERY_NOTICE_TTL_MS, kind: undefined }])
		expect(controller.banner).toBeUndefined()
	})

	test("recovered notice actually retires after 4000ms (fake timer)", () => {
		jest.useFakeTimers()
		try {
			const id = showNotice(`caught up ${3} events`, RECOVERY_NOTICE_TTL_MS)
			expect(noticeList().some((notice) => notice.id === id)).toBe(true)
			jest.advanceTimersByTime(RECOVERY_NOTICE_TTL_MS)
			expect(noticeList().some((notice) => notice.id === id)).toBe(false)
		} finally {
			clearNotices()
			jest.useRealTimers()
		}
	})

	test("bridge.recovery.failed: persistent banner with reason + reconnect/new/quit actions", () => {
		const { controller, state } = setup()
		controller.handleEvent({
			type: "bridge.recovery.failed",
			details: { error: { code: "JOURNAL_REPLAY_FAILED", message: "replay broke" } },
		})
		expect(controller.phase).toBe("failed")
		expect(controller.banner?.kind).toBe("failed")
		expect(controller.banner?.reason).toContain("replay broke")
		const lines = recoveryBannerLines(controller.banner, texts)
		expect(lines[0]).toContain("replay broke")
		expect(lines[1]).toContain("Reconnect [R]")
		expect(lines[1]).toContain("New session")
		expect(lines[1]).toContain("Quit")
		expect(state.notices).toHaveLength(0) // failure is a banner, not a transient notice
	})

	test("bridge.recovery.locked: banner + notice show the host reason and the holder id", () => {
		const { controller, state } = setup()
		controller.handleEvent({
			type: "bridge.recovery.locked",
			details: {
				sessionId: "sess-locked",
				message: "busy",
				holder: "holder-9",
				error: { code: "SESSION_LOCKED", message: "busy", detail: { holder: "holder-9" } },
			},
		})
		expect(controller.phase).toBe("locked")
		expect(controller.banner?.sessionId).toBe("sess-locked")
		expect(controller.banner?.holder).toBe("holder-9")
		// P2-1: the holder id substring is user-visible in the banner AND the
		// transient notice; the host reason is no longer discarded.
		expect(controller.banner?.reason).toContain("holder-9")
		expect(controller.banner?.reason).toContain("busy")
		expect(state.notices[0]?.text).toContain("holder-9")
		expect(state.notices[0]).toEqual({
			text: "writer-held: busy (held by holder-9)",
			ttl: RECOVERY_NOTICE_TTL_MS,
			kind: undefined,
		})
		const lines = recoveryBannerLines(controller.banner, texts)
		expect(lines[0]).toContain("writer-held")
		expect(lines[0]).toContain("holder-9")
		expect(lines[1]).toContain("Retry [R]")
		expect(lines[1]).toContain("New session")
		expect(lines[1]).not.toContain("Quit")
	})

	test("bridge.recovery.locked: holder already named in the message is not repeated", () => {
		const { controller } = setup()
		controller.handleEvent({
			type: "bridge.recovery.locked",
			details: { message: "session holder-9 is owned elsewhere", holder: "holder-9" },
		})
		const reason = controller.banner?.reason ?? ""
		expect(reason).toContain("holder-9")
		expect(reason.match(/holder-9/g)).toHaveLength(1)
	})

	test("bridge.recovery.locked: a bare event still renders the base copy", () => {
		const { controller } = setup()
		controller.handleEvent({ type: "bridge.recovery.locked", details: {} })
		expect(controller.banner?.reason).toBe("writer-held")
	})

	test("writer-held banner clips an over-long holder id to 8 chars (display width)", () => {
		const longId = "holder-abcdefghijklmnop"
		expect(
			widthSafeBannerReason({
				kind: "locked",
				reason: `writer-held: busy (held by ${longId})`,
				holder: longId,
			}),
		).toBe(`writer-held: busy (held by ${longId.slice(0, 8)}…)`)
		// Short ids are left untouched.
		expect(
			widthSafeBannerReason({
				kind: "locked",
				reason: "writer-held: busy (held by other)",
				holder: "other",
			}),
		).toBe("writer-held: busy (held by other)")
	})

	test("banner new-session / quit actions call the page callbacks and clear the banner", () => {
		const { controller, state } = setup()
		controller.handleEvent({ type: "bridge.recovery.failed", details: { error: { message: "x" } } })
		controller.newSession()
		expect(state.newSessions).toBe(1)
		expect(controller.banner).toBeUndefined()
		expect(controller.phase).toBe("ready")
		controller.handleEvent({ type: "bridge.recovery.failed", details: { error: { message: "y" } } })
		controller.quit()
		expect(state.quits).toBe(1)
	})

	test("a thrown transport recover() degrades to a failed banner", async () => {
		const controller = new RecoveryUiController({
			recover: async () => {
				throw new Error("spawn failed")
			},
			texts,
		})
		controller.handleEvent({ type: "bridge.dead" })
		await controller.recover()
		expect(controller.phase).toBe("failed")
		expect(controller.banner?.reason).toContain("spawn failed")
	})

	// P2-2: a cooldown is transient — keep DEAD (R still available), no failed
	// banner, and show only a retiring notice with the remaining milliseconds.
	test("BRIDGE_RECOVERY_COOLDOWN stays dead with a transient ms notice, no failed banner", async () => {
		const notices: Notice[] = []
		const controller = new RecoveryUiController({
			recover: async () => {
				throw Object.assign(new Error("recover() cooling down; retry in 3200ms"), {
					code: "BRIDGE_RECOVERY_COOLDOWN",
					detail: { remainingMs: 3200 },
				})
			},
			texts,
			onNotice: (text, ttl, kind) => notices.push({ text, ttl, kind }),
		})
		controller.handleEvent({ type: "bridge.dead" })
		await controller.recover()

		expect(controller.phase).toBe("dead")
		expect(controller.banner).toBeUndefined()
		expect(controller.canRecover()).toBe(true)
		// recover() first paints the generic "reconnecting" transient; the
		// cooldown notice is the last one and carries the remaining ms.
		expect(notices.length).toBeGreaterThanOrEqual(1)
		expect(notices[notices.length - 1]!.text).toBe("cooling down, 3200 ms left")
	})
})
