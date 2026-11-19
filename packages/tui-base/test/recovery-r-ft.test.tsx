/**
 * P2-4 (oldfox review) — pin the plain-R recovery key against a FOCUSED TEXT
 * INPUT on the real render/keymap chain (tui-base FT bench).
 *
 * DECISION (recorded): keep the CURRENT behaviour — in dead/failed/locked the
 * global R layer dispatches recovery and SWALLOWS the stroke even while the
 * composer textarea holds focus and even if a terminal ask card owns the modal
 * frame. This is an intentional escape-hatch priority, NOT an oversight:
 *
 *   1. `examples/v2-entry.tsx:1070-1077` registers R with `mode:"global"` and
 *      `enabled: pageOwns() || canRecover()` precisely so R stays reachable
 *      after RM-2b V3 turns every pending ask into a terminal "已失效" card —
 *      that card KEEPS the modal ownership frame, so a base-mode or
 *      focus-gated layer would gate R out on the exact real-device BLOCKED
 *      case the fix addressed.
 *   2. R is the ONLY recovery entry (ADR-0010 phase 1, no auto-reconnect).
 *      Gating it on "no focused editor" would strand a dead session whenever
 *      the user had typed into the composer before the crash (the composer is
 *      NOT disabled in `dead` — only in `recovering`, recovery-ui.ts:117-121).
 *   3. The keymap layer runs on `renderer.keyInput` BEFORE the focused editor
 *      and consumes matches; there is no cheap per-layer "yield to focused
 *      editor" switch in `Keymap.createLayer` (only mode/enabled/bindings).
 *      A custom gating layer would have to re-derive the whole modal/ownership
 *      ladder and would regress (1).
 *
 * Normal (ready) state still types `r` into the composer safely: the layer is
 * disabled, the editor consumes the stroke. Both halves are asserted here.
 */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { TestRendererSetup } from "@opentui/core/testing"
import type { TextareaRenderable } from "@opentui/core"
import { Keymap } from "../src/context/keymap"
import { RecoveryUiController, type RecoveryTexts } from "../src/routes/session/recovery-ui"

const texts: RecoveryTexts = {
	transient: () => "reconnecting...",
	recovered: (count) => `caught up ${count} events`,
	failedReason: (reason) => `failed: ${reason}`,
	locked: () => "writer-held",
	cooldown: (ms) => `cooling down, ${ms} ms left`,
	reconnect: () => "Reconnect [R]",
	retry: () => "Retry [R]",
	newSession: () => "New session",
	quit: () => "Quit",
}

const keymapConfig = {
	keybinds: { get: () => [] },
} as unknown as Parameters<typeof Keymap.Provider>[0]["config"]

function RecoveryKeys(props: { controller: RecoveryUiController }) {
	// The exact layer shape v2-entry registers (minus `pageOwns()` — the
	// canRecover() arm alone reproduces the dead-state escape hatch).
	Keymap.createLayer(() => ({
		mode: "global",
		enabled: () => props.controller.canRecover(),
		commands: [props.controller.reconnectCommand()],
	}))
	return <box height={0} />
}

async function harness() {
	let textarea: TextareaRenderable | undefined
	let recovers = 0
	const controller = new RecoveryUiController({
		recover: async () => { recovers += 1 },
		texts,
	})
	const setup: TestRendererSetup = await testRender(
		() => (
			<Keymap.Provider config={keymapConfig}>
				<box width="100%" height="100%" flexDirection="column">
					<box width="100%" height={3} flexShrink={0}>
						<textarea
							placeholder="composer"
							height={3}
							width="100%"
							ref={(value: TextareaRenderable) => (textarea = value)}
						/>
					</box>
					<RecoveryKeys controller={controller} />
				</box>
			</Keymap.Provider>
		),
		{ width: 80, height: 12, useMouse: false },
	)
	const press = async (key: string) => {
		setup.mockInput.pressKey(key)
		await Bun.sleep(30)
		await setup.renderOnce()
	}
	return {
		setup,
		controller,
		editorText: () => textarea?.plainText ?? "",
		focusEditor: () => textarea?.focus(),
		recovers: () => recovers,
		press,
		async dispose() { await setup.dispose() },
		async [Symbol.asyncDispose]() { await this.dispose() },
	}
}

describe("P2-4: plain R vs a focused text input (escape-hatch priority)", () => {
	test("dead state + focused composer: r triggers recovery and is swallowed (not typed)", async () => {
		await using h = await harness()
		h.controller.handleEvent({ type: "bridge.dead" })
		expect(h.controller.canRecover()).toBe(true)
		h.focusEditor()
		// A draft already in the composer before the crash.
		await h.press("a")
		expect(h.editorText()).toBe("a")

		await h.press("r")

		// The global layer consumed the stroke: recovery ran, no `r` in the
		// draft, so the user never has to defocus the composer to escape DEAD.
		expect(h.recovers()).toBe(1)
		expect(h.editorText()).toBe("a")
		expect(h.controller.phase).toBe("recovering")
	})

	test("ready state + focused composer: r is typed normally, no recovery", async () => {
		await using h = await harness()
		expect(h.controller.canRecover()).toBe(false)
		h.focusEditor()
		await h.press("r")

		// The disabled layer does not steal the key: normal text input wins.
		expect(h.editorText()).toBe("r")
		expect(h.recovers()).toBe(0)
		expect(h.controller.phase).toBe("ready")
	})
})
