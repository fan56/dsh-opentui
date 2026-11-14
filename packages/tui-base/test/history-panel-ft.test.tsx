/**
 * /history on the panel-kit modal stack: the real layer chain (review
 * P0-2/P1-3/P1-4 repros — the pure-function tests in history-panel.test.ts
 * cannot see any of this).
 *
 * Mounted through @opentui/solid testRender with the production host wiring
 * (Keymap.Provider → PanelKitProvider + PanelStack, the same shape
 * PanelKitHost mounts in examples/v2-entry.tsx), so keys travel the real
 * path: the kit's modal table for Escape, the consumer's own Keymap layers
 * for s/f/Enter/arrows.
 *
 * Covers: `s` opens EXACTLY one "Switch session" layer (the old
 * showSessions effect re-triggered on the stack's layers signal and stacked
 * three into the maxDepth error), Enter picks the session and pops the
 * layer (the main layer's `handle === top` gate parks the hotkeys while the
 * session layer is top), the double-`f` busy latch (fork is the one durable
 * hotkey here), and the session-switch window where `f` has nothing to act
 * on while the picked journal is in flight.
 */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createComponent, onMount } from "solid-js"
import {
	FALLBACK_THEME,
	PanelKitProvider,
	PanelStack,
	STATIC_MOTION,
	createHostKeyAdapter,
	usePanels,
	type PanelStackApi,
} from "@dsh-opentui/panel-kit"
import { Keymap } from "../src/context/keymap"
import { createTuiPanelKeymapHost } from "../src/context/panel-kit-host"
import { HistoryPanel, openHistoryPanel, historyPanelOpen } from "../src/routes/session/history-panel"
import type { HistoryJournalEntry } from "../src/routes/session/history-data"
import type { SeamSessionSummary, SessionSeam } from "../src/seams/session"

const keymapConfig = {
	keybinds: { get: () => [] },
} as unknown as Parameters<typeof Keymap.Provider>[0]["config"]

/** Journal for one session. sess-b starts at seq 100 (real journals do not
 * count from 0 — the deleted turnSeedSlice assumed they do). */
function journal(prompt: string, firstSeq: number): HistoryJournalEntry[] {
	return [
		{ type: "turn/start", seq: firstSeq, time: 1000, data: { turn: 1 } },
		{ type: "user/message", seq: firstSeq + 1, time: 1010, data: { content: [{ type: "text", text: prompt }] } },
		{ type: "assistant/message", seq: firstSeq + 2, time: 1020, data: { message: { content: [{ type: "text", text: `reply to ${prompt}` }] } } },
		{ type: "turn/end", seq: firstSeq + 3, time: 1100, data: { reason: { kind: "completed" } } },
	]
}

const SESSION_A = "sess-a"
const SESSION_B = "sess-b"

interface FakeHistory {
	seam: SessionSeam
	forks: { id: string; seqEnd?: number }[]
	/** Resolves the (deferred) sess-b journal read — the switch window. */
	landSessB: () => void
}

function fakeSeam(): FakeHistory {
	const forks: { id: string; seqEnd?: number }[] = []
	const sessA = journal("alpha prompt", 0)
	// The picked session's read is DEFERRED: the switch window is observable.
	let releaseB: (() => void) | undefined
	const sessB = new Promise<HistoryJournalEntry[]>((resolve) => {
		releaseB = () => resolve(journal("beta prompt", 100))
	})
	const seam = {
		listSessions: async (): Promise<SeamSessionSummary[]> => [{ id: SESSION_B, title: "Session B" }],
		sessionJournal: async (sessionId: string) => {
			if (sessionId === SESSION_A) return sessA
			return sessB
		},
		forkSession: async (sessionId: string, seqEnd?: number) => {
			forks.push({ id: sessionId, seqEnd })
			return "sess-fork"
		},
	} as unknown as SessionSeam
	return { seam, forks, landSessB: () => releaseB?.() }
}

function PanelsProbe(props: { onReady: (api: PanelStackApi) => void }) {
	onMount(() => props.onReady(usePanels()))
	return null
}

function Harness(props: {
	seam: SessionSeam
	sessionId: () => string | undefined
	onForked?: (forkedId: string, turn: number) => void
	onPanels?: (api: PanelStackApi) => void
}) {
	const keymap = Keymap.use()
	const keys = createHostKeyAdapter(createTuiPanelKeymapHost(keymap))
	return (
		<PanelKitProvider theme={FALLBACK_THEME} motion={STATIC_MOTION} keys={keys}>
			<PanelStack>
				{createComponent(HistoryPanel, {
					get seam() {
						return props.seam
					},
					sessionId: props.sessionId,
					onForked: props.onForked,
				})}
				{props.onPanels === undefined ? undefined : <PanelsProbe onReady={props.onPanels} />}
			</PanelStack>
		</PanelKitProvider>
	)
}

function text(frame: string): string {
	return frame.replace(/\s+/g, " ")
}

/** Frame wait per docs/test-framework.md §4.4: predicate over the normalized
 * frame against a wall-clock budget, no fixed-round settle. The upstream
 * setup.waitForFrame counts render PASSES, which can outpace async painting,
 * and a render-FIRST poll races stdin parsing (mock input is parsed a tick
 * after the emit — the key-routing-ft press norm: sleep, THEN renderOnce), so
 * this poll sleeps before rendering. A timeout throws with the last frame. */
async function waitForFrame(
	setup: Awaited<ReturnType<typeof testRender>>,
	predicate: (flat: string) => boolean,
	options: { timeoutMs?: number } = {},
): Promise<string> {
	const timeoutMs = options.timeoutMs ?? 4000
	const deadline = Date.now() + timeoutMs
	for (;;) {
		const flat = text(setup.captureCharFrame())
		if (predicate(flat)) return flat
		if (Date.now() > deadline) {
			throw new Error(`waitForFrame: timed out after ${timeoutMs}ms\nlast frame:\n${flat}`)
		}
		await new Promise((resolve) => setTimeout(resolve, 25))
		await setup.renderOnce()
	}
}

async function mount(options: {
	seam: SessionSeam
	sessionId?: () => string | undefined
	onForked?: (forkedId: string, turn: number) => void
}): Promise<{ setup: Awaited<ReturnType<typeof testRender>>; panels: PanelStackApi; frame: () => string }> {
	let panels: PanelStackApi | undefined
	const setup = await testRender(
		() => (
			<Keymap.Provider config={keymapConfig}>
				<Harness
					seam={options.seam}
					sessionId={options.sessionId ?? (() => SESSION_A)}
					onForked={options.onForked}
					onPanels={(api) => (panels = api)}
				/>
			</Keymap.Provider>
		),
		{ width: 120, height: 34 },
	)
	// Settle convergence for the bare mount (upstream idle wait, §3); the open
	// wait below is a predicate + time budget (docs/test-framework.md §4.4).
	await setup.waitForVisualIdle()
	openHistoryPanel()
	await waitForFrame(setup, (flat) => flat.includes("alpha prompt"))
	if (panels === undefined) throw new Error("panels probe never mounted")
	return { setup, panels, frame: () => setup.captureCharFrame() }
}

describe("/history panel-kit modal (review P0-2/P1-3/P1-4)", () => {
	test("s opens exactly one session layer; Enter picks it and pops it (depth 1→2→1)", async () => {
		const fake = fakeSeam()
		const { setup, panels, frame } = await mount({ seam: fake.seam })
		try {
			// The browser is open on sess-a with its turn rendered.
			expect(text(frame())).toContain("alpha prompt")
			expect(historyPanelOpen()).toBe(true)

			setup.mockInput.pressKey("s")
			await waitForFrame(setup, (flat) => flat.includes("Session B"))
			// Exactly ONE layer pushed (the old effect stacked three into the
			// maxDepth error, which leaked into the status line).
			expect(panels.depth).toBe(2)
			expect(text(frame())).toContain("enter browse")
			expect(text(frame())).not.toContain("maxDepth")
			expect(text(frame())).not.toContain("session list failed")

			setup.mockInput.pressEnter()
			// The pick pops the session layer AND switches the fold target to
			// the picked session's journal (its deferred read lands here).
			await waitForFrame(setup, (flat) => flat.includes("loading turns…"))
			expect(panels.depth).toBe(1)
			fake.landSessB()
			await waitForFrame(setup, (flat) => flat.includes("beta prompt"))
			expect(text(frame())).not.toContain("alpha prompt")
		} finally {
			await setup.dispose()
		}
	})

	test("double f calls forkSession exactly once (the durable busy latch)", async () => {
		const fake = fakeSeam()
		const forked: { id: string; turn: number }[] = []
		const { setup, frame } = await mount({ seam: fake.seam, onForked: (id, turn) => forked.push({ id, turn }) })
		try {
			expect(text(frame())).toContain("alpha prompt")
			// Two dispatches in one tick (double-tap / key repeat).
			setup.mockInput.pressKey("f")
			setup.mockInput.pressKey("f")
			await waitForFrame(setup, () => fake.forks.length === 1)
			await setup.waitForVisualIdle()
			expect(fake.forks).toEqual([{ id: SESSION_A, seqEnd: 3 }])
			expect(forked).toEqual([{ id: "sess-fork", turn: 1 }])
		} finally {
			await setup.dispose()
		}
	})

	test("the switch window: f/Enter have nothing to act on while the picked journal is in flight", async () => {
		const fake = fakeSeam()
		const { setup, panels, frame } = await mount({ seam: fake.seam })
		try {
			// s → the session layer; Enter → pick sess-b (its read hangs).
			setup.mockInput.pressKey("s")
			await waitForFrame(setup, (flat) => flat.includes("Session B"))
			expect(panels.depth).toBe(2)
			setup.mockInput.pressEnter()
			await waitForFrame(setup, (flat) => flat.includes("loading turns…"))
			expect(panels.depth).toBe(1)

			// The old session's turns are GONE while the read is pending — the
			// busy "loading turns…" line replaces them.
			expect(text(frame())).toContain("loading turns…")
			expect(text(frame())).not.toContain("alpha prompt")

			// f in this window: no browsing turns, no fork (the old code would
			// have forked sess-b at sess-a's seqEnd). A predicate cannot tell
			// "handler ran and declined" from "handler has not run yet", so this
			// negative check is a settle convergence followed by the assertion.
			setup.mockInput.pressKey("f")
			await setup.waitForVisualIdle()
			expect(fake.forks).toEqual([])

			// The read lands: the picked session's turns render and f works.
			fake.landSessB()
			await waitForFrame(setup, (flat) => flat.includes("beta prompt"))
			setup.mockInput.pressKey("f")
			await waitForFrame(setup, () => fake.forks.length === 1)
			expect(fake.forks).toEqual([{ id: SESSION_B, seqEnd: 103 }])
		} finally {
			await setup.dispose()
		}
	})
})
