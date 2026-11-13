/**
 * Key routing regression (pilot/shell-render, T4) — opencode input-scope-style
 * keymap tests against the REAL shell render path.
 *
 * The historical incident this guards: PgDn/Home/End were eaten by a higher
 * key-handling layer and never reached their consumer — CI stayed green, real
 * terminals broke. These cases mount the REAL key chain the page wires
 * (Keymap.Provider + TranscriptScrollKeys over the Transcript scrollbox, with
 * a focused textarea standing in for the composer) and assert the ROUTING:
 * which consumer a key lands on per focus state, by observable effect
 * (scrollbox scrollTop / visible frame rows / editor cursor & buffer).
 *
 * Real key chain (source-verified):
 *   - pagedown/pageup → TranscriptScrollKeys keymap layer (mode "global"),
 *     scrollBy(delta, "viewport") on the transcript scrollbox
 *     (tui-base/src/routes/session/transcript-scroll.tsx:52-70); bindings come
 *     from "session.page.up"/"session.page.down" in the vendored keybind
 *     config (tui-base/src/config/keybind.ts:183-187).
 *   - The keymap layer runs on renderer.keyInput BEFORE the focused editor
 *     and consumes matches — pagedown must scroll the transcript even while
 *     the composer textarea holds focus, and must NOT corrupt the editor
 *     buffer (transcript-scroll.tsx docblock, "Focus stays in the composer").
 *   - The layer is gated on "no overlay open" (enabled); with the gate closed
 *     pagedown must not move the transcript (transcript-scroll.tsx:15-23).
 *   - home/end while the composer is focused are EDITOR keys: the textarea's
 *     native bindings map home→buffer-home, end→buffer-end
 *     (@opentui/core defaultTextareaKeyBindings) — the transcript must not
 *     move and the cursor must land at the buffer ends.
 *   - plain home/end with NO editor focus have no consumer in the rebuilt
 *     shell view: session.first/session.last are bound ONLY in the vendored
 *     route (tui-base/src/routes/session/index.tsx:997,1065), which the shell
 *     page does not mount (gap note at the bottom).
 *
 * Assertions: scrollTop state + normalized frame row visibility (the visible
 * displacement), never whole-frame equality. Short stored burst only — no
 * streaming frames (scope guard, per shell-render-smoke-ft).
 */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { TestRendererSetup } from "@opentui/core/testing"
import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { createBindingLookup } from "@opentui/keymap/extras"
import { Transcript } from "../../tui-base/src/routes/session/transcript"
import { TranscriptScrollKeys } from "../../tui-base/src/routes/session/transcript-scroll"
import { Keymap } from "../../tui-base/src/context/keymap"
import { TuiKeybind } from "../../tui-base/src/config/keybind"
import type { SessionSeam } from "../../tui-base/src/seams/session"
import { RemoteSessionSeam } from "../src/client/session-seam-adapter"
import type { RemoteHostSession } from "../src/client/remote-host-session"
import { normalizeFrame } from "./shell-render-fixture.tsx"

// ---------------------------------------------------------------------------
// Fake session (same double shape as shell-render-fixture — canned stored
// transcript, no transport).
// ---------------------------------------------------------------------------

const ROWS = 48
const storedRows = () =>
	Array.from({ length: ROWS }, (_, i) => ({
		kind: "assistant" as const,
		text: `row-${String(i + 1).padStart(2, "0")}`,
		final: true,
	}))

function fakeStoredSession(stored: { kind: "assistant"; text: string; final: boolean }[]) {
	const base = {
		label: "dsh-host",
		usage: { prompt: 3, completion: 5, cacheRead: 0, cacheWrite: 0 },
		lastTurnStats: { ms: 0, chars: 0, tokens: 0, tps: null, estimated: false, startedAt: 0, endedAt: 0 },
		status: { connection: "connected" as const, turn: "idle" as const, sessionAttached: true, tailActive: false },
		currentSessionId: () => "ses-keys",
		storedTranscript: async () => stored,
		listSessions: async () => [],
		searchSessions: async () => [],
		resumeSession: () => "ok" as const,
		newSession: () => {},
		renameSession: async (title: string) => ({ title, seq: 1 }),
		turn: async () => {},
		steer: () => {},
		abort: () => {},
		steerChild: () => false,
		registerAskProvider: () => {},
		listProviders: async () => [],
		modelCatalog: async () => ({ groups: [] }),
		currentModelSelection: async () => ({ provider: "prov-a", model: "ma1", reasoningEffort: "high" }),
		selectModel: async (s: unknown) => s,
		usageSummary: () => [],
		onJournalRecord: (_listener: unknown) => () => {},
		subagentViews: () => [],
		onSubagentViews: (_listener: unknown) => () => {},
		dispose: async () => {},
	}
	return base as unknown as RemoteHostSession
}

// ---------------------------------------------------------------------------
// Harness: the page wiring under test — Keymap.Provider → Transcript (with
// scrollRef) + TranscriptScrollKeys layer + a composer-stand-in textarea.
// Escape-sequence keys, same norm as packages/panel-kit/test/list-cursor-page.
// ---------------------------------------------------------------------------

const PGUP = "\u001b[5~"
const PGDN = "\u001b[6~"
const HOME = "\u001b[H"
const END = "\u001b[F"

const keybindsConfig = () => ({
	keybinds: createBindingLookup(TuiKeybind.toBindingConfig(TuiKeybind.parse({})), {
		bindingDefaults: TuiKeybind.bindingDefaults(),
	}),
	leader: { timeout: 2000 },
})

async function createKeyHarness(options: { enabled?: () => boolean } = {}) {
	const seam = new RemoteSessionSeam(fakeStoredSession(storedRows())) as unknown as SessionSeam
	let scroll: ScrollBoxRenderable | undefined
	let textarea: TextareaRenderable | undefined
	const enabled = options.enabled ?? (() => true)

	const setup: TestRendererSetup = await testRender(() => {
		return (
			<Keymap.Provider config={keybindsConfig()}>
				<box width="100%" height="100%" flexDirection="column">
					<Transcript seam={seam} focused={() => false} scrollRef={(value) => (scroll = value)} />
					{/* The page wiring shape (tui-base examples/session.tsx:308): the
					    layer lives beside the transcript, gated on the dialog stack. */}
					<TranscriptScrollKeys scroll={() => scroll} enabled={() => enabled()} />
					{/* Composer stand-in (explicit height — auto-height collapses). */}
					<box width="100%" flexShrink={0} height={3}>
						<textarea placeholder="composer" height={3} width="100%" ref={(value: TextareaRenderable) => (textarea = value)} />
					</box>
				</box>
			</Keymap.Provider>
		)
	}, { width: 80, height: 32, useMouse: false })

	const captureFrame = () => normalizeFrame(setup.captureCharFrame())
	/** Sorted distinct row-NN tokens visible in the frame. */
	const visibleRows = (frame: string) =>
		[...new Set([...frame.matchAll(/row-(\d{2})/g)].map((m) => Number(m[1])))].sort((a, b) => a - b)

	/** stdin parsing is deferred by a tick in the test renderer (panel-kit norm). */
	const press = async (key: string, modifiers?: { ctrl?: boolean }) => {
		setup.mockInput.pressKey(key, modifiers)
		await Bun.sleep(30)
		await setup.renderOnce()
	}

	/** Editor focus = the composer's permanent state (OpenTUI focus-singleton). */
	const focusEditor = () => {
		textarea?.focus()
	}

	/** Wait until the stored rows have painted (hydration + markdown paint). */
	const settle = async () => {
		for (let i = 0; i < 40; i++) {
			await setup.renderOnce()
			const frame = captureFrame()
			if (frame.includes(`row-${String(ROWS).padStart(2, "0")}`)) return frame
			await Bun.sleep(25)
		}
		throw new Error(`key-routing harness: stored rows never painted\nlast frame:\n${captureFrame()}`)
	}

	return {
		setup,
		seam,
		get scroll() {
			return scroll
		},
		editorText: () => textarea?.plainText ?? "",
		editorCursor: () => textarea?.cursorOffset ?? -1,
		focusEditor,
		captureFrame,
		visibleRows,
		press,
		settle,
		maxScroll: () => {
			const box = scroll!
			return Math.max(0, box.scrollHeight - box.viewport.height)
		},
		async dispose() {
			await setup.dispose()
		},
		async [Symbol.asyncDispose]() {
			await this.dispose()
		},
	}
}

describe("key routing vs focus scopes (PgDn/PgUp)", () => {
	test("pagedown scrolls the transcript while the editor is focused — buffer untouched (anti-swallow)", async () => {
		await using h = await createKeyHarness()
		await h.settle()
		h.focusEditor()
		await h.press("h")
		await h.press("i")
		expect(h.editorText()).toBe("hi") // the focused editor receives typing

		// stickyScroll pins the viewport at the bottom on mount — page up
		// first to give pagedown headroom (the reader scrolled away).
		await h.press(PGUP)
		const before = h.scroll!.scrollTop
		const rowsBefore = h.visibleRows(h.captureFrame())
		expect(rowsBefore.length).toBeGreaterThan(0)
		expect(before).toBeLessThan(h.maxScroll())

		await h.press(PGDN)

		// The keymap layer consumed pagedown BEFORE the focused editor and
		// scrolled the transcript by one viewport (the page unit).
		const after = h.scroll!.scrollTop
		expect(after).toBeGreaterThan(before)
		const expected = Math.min(h.maxScroll(), before + h.scroll!.viewport.height)
		expect(Math.abs(after - expected)).toBeLessThanOrEqual(1)
		// Visible displacement: the top of the frame window moved down.
		const rowsAfter = h.visibleRows(h.captureFrame())
		expect(rowsAfter[0]).toBeGreaterThan(rowsBefore[0])
		// The editor buffer survived the key (swallowed-then-misdelivered check).
		expect(h.editorText()).toBe("hi")
	})

	test("pageup scrolls back up from the bottom; pagedown re-pins (positive + return leg)", async () => {
		await using h = await createKeyHarness()
		await h.settle()
		h.focusEditor()
		await h.setup.renderOnce()
		expect(h.scroll!.scrollTop).toBe(h.maxScroll()) // stickyScroll pinned at bottom

		await h.press(PGUP)
		const up = h.scroll!.scrollTop
		expect(up).toBeLessThan(h.maxScroll())
		expect(Math.abs(up - (h.maxScroll() - h.scroll!.viewport.height))).toBeLessThanOrEqual(1)

		await h.press(PGDN)
		expect(h.scroll!.scrollTop).toBe(h.maxScroll()) // clamped, follow re-engages
	})

	test("gate closed (overlay open): pagedown does not move the transcript (negative)", async () => {
		await using h = await createKeyHarness({ enabled: () => false })
		await h.settle()
		h.focusEditor()
		await h.setup.renderOnce()
		const before = h.scroll!.scrollTop

		await h.press(PGDN)

		expect(h.scroll!.scrollTop).toBe(before)
		expect(h.editorText()).toBe("") // the editor did not misconsume it either
	})

	test("no scroll headroom: pagedown past the bottom clamps without crashing", async () => {
		await using h = await createKeyHarness()
		await h.settle()
		h.focusEditor()
		await h.setup.renderOnce()
		const bottom = h.maxScroll()

		// Two pagedowns past the end — must clamp, never throw, never overscroll.
		await h.press(PGDN)
		await h.press(PGDN)
		expect(h.scroll!.scrollTop).toBe(bottom)
		expect(h.captureFrame()).toContain(`row-${String(ROWS).padStart(2, "0")}`)
	})
})

describe("key routing vs focus scopes (Home/End)", () => {
	test("home/end with the editor focused are editor keys: buffer-home/buffer-end, transcript untouched", async () => {
		await using h = await createKeyHarness()
		await h.settle()
		h.focusEditor()
		for (const ch of "abcdef") await h.press(ch)
		expect(h.editorText()).toBe("abcdef")
		await h.setup.renderOnce()
		const scrollBefore = h.scroll!.scrollTop

		await h.press(HOME)
		expect(h.editorCursor()).toBe(0)
		await h.press(END)
		expect(h.editorCursor()).toBe(6)

		// The transcript did not scroll for editor-scope keys.
		expect(h.scroll!.scrollTop).toBe(scrollBefore)
	})

	test("scope isolation: typed characters land in the editor, never painted as transcript rows", async () => {
		await using h = await createKeyHarness()
		await h.settle()
		h.focusEditor()
		await h.press("x")
		await h.press("y")
		expect(h.editorText()).toBe("xy")
		// The transcript flow never paints editor input as a feed row.
		expect(h.visibleRows(h.captureFrame()).every((n) => n <= ROWS)).toBe(true)
	})
})

/**
 * GAP NOTE (not a test): plain home/end ("session.first"/"session.last",
 * config/keybind.ts:192-193) have NO consumer in the rebuilt shell view when
 * nothing editor-focused holds them — TranscriptScrollKeys binds only
 * pageup/pagedown (transcript-scroll.tsx:55-68), and session.first/
 * session.last run in the vendored route (routes/session/index.tsx:997,1065)
 * which the shell page does not mount. With the composer focused (the
 * permanent state) home/end land in the editor as buffer-home/buffer-end, so
 * the historical "Home/End eaten by a higher layer" symptom cannot recur as a
 * silent swallow; they are consumed by the editor. If the shell page later
 * wants jump-to-first/last-message, it must wire its own layer; until then
 * this documents the routing table honestly.
 */
