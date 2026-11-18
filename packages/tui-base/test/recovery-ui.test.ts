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
	locked: () => "writer-held",
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
		sessions: [] as (string | undefined)[],
	}
	const controller = new RecoveryUiController({
		recover: async () => {
			state.recovers++
		},
		texts,
		onNotice: (text, ttl, kind) => state.notices.push({ text, ttl, kind }),
		onSessionId: (id) => state.sessions.push(id),
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
			steer: () => {},
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

describe("recovered / failed / locked surfaces", () => {
	test("bridge.recovered: notice carries N, retires after 4s, sessionId linked", () => {
		const { controller, state } = setup()
		controller.handleEvent({ type: "bridge.recovered", details: { applied: 7, sessionId: "sess-7" } })
		expect(state.notices).toEqual([{ text: "caught up 7 events", ttl: RECOVERY_NOTICE_TTL_MS, kind: undefined }])
		expect(state.sessions).toEqual(["sess-7"])
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

	test("bridge.recovery.locked: notice + retry/new actions + sessionId, no quit", () => {
		const { controller, state } = setup()
		controller.handleEvent({
			type: "bridge.recovery.locked",
			details: { sessionId: "sess-locked", error: { code: "SESSION_LOCKED", message: "busy" } },
		})
		expect(controller.phase).toBe("locked")
		expect(state.notices).toEqual([{ text: "writer-held", ttl: RECOVERY_NOTICE_TTL_MS, kind: undefined }])
		expect(state.sessions).toEqual(["sess-locked"])
		const lines = recoveryBannerLines(controller.banner, texts)
		expect(lines[0]).toContain("writer-held")
		expect(lines[1]).toContain("Retry [R]")
		expect(lines[1]).toContain("New session")
		expect(lines[1]).not.toContain("Quit")
	})

	test("banner new-session / quit actions call the page callbacks and clear the banner", () => {
		const { controller, state } = setup()
		controller.handleEvent({ type: "bridge.recovery.failed", details: { error: { message: "x" } } })
		controller.newSession()
		expect(state.newSessions).toBe(1)
		expect(controller.banner).toBeUndefined()
		expect(controller.phase).toBe("ready")
		expect(state.sessions[state.sessions.length - 1]).toBeUndefined()
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
})
