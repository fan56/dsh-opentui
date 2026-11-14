/**
 * /search overlay on the REAL render stack: Keymap.Provider → DialogProvider
 * → SessionsSearch, keys traveling the production path (the keymap engine,
 * then the focused input).
 *
 * Why here: the P0-1 review defect lived exactly in the "focused input ×
 * global keymap layer" interaction the pure-function tests cannot see — the
 * old `down,j`/`up,k` bindings preventDefaulted every j/k BEFORE the focused
 * query input received it, so `typeText("json kit")` landed as "son it".
 * These tests pin the real-machine semantics:
 *
 *   - letters (including j/k) ALWAYS reach the query input, with and without
 *     hits on screen;
 *   - with hits visible, ↑/↓ move the wrapping hit cursor;
 *   - a rejected resume keeps the overlay OPEN with its `resume failed — …`
 *     status line (never a silent close, never a fake success).
 */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { DialogProvider } from "../src/ui/dialog"
import { ToastProvider } from "../src/ui/toast"
import { ClipboardProvider, type ClipboardService } from "../src/context/clipboard"
import { ConfigProvider, resolve } from "../src/config"
import { Keymap } from "../src/context/keymap"
import {
	SessionsSearch,
	formatSearchHitLine,
	openSessionsSearch,
	sessionsSearchOpen,
	type SessionSearchHit,
} from "../src/routes/session/sessions-search"
import type { SessionSeam } from "../src/seams/session"

const keymapConfig = {
	keybinds: { get: () => [] },
} as unknown as Parameters<typeof Keymap.Provider>[0]["config"]

const HITS: SessionSearchHit[] = [
	{ id: "ses_json", snippet: "json kit notes" },
	{ id: "ses_other", snippet: "an unrelated session" },
]

interface FakeOptions {
	/** The resume path rejects (the P1-2 failed-resume repro). */
	failResume?: boolean
}

type FakeSeam = SessionSeam & {
	resume: (sessionId: string) => Promise<void>
	calls: { searched: string[]; resumed: string[] }
}

function fakeSeam(options: FakeOptions = {}): FakeSeam {
	const calls = { searched: [] as string[], resumed: [] as string[] }
	const seam = {
		searchSessions: async (query: string) => {
			calls.searched.push(query)
			return HITS
		},
		// The B1 resume hook the entry wires (v2-entry's resumeFromSearch): the
		// fake stands in for the seam path, rejection included.
		resume: async (sessionId: string) => {
			calls.resumed.push(sessionId)
			if (options.failResume === true) throw new Error("journal gone")
		},
		calls,
	} as unknown as FakeSeam
	return seam
}

const clipboard: ClipboardService = {
	read: async () => undefined,
	write: async () => {},
}

function Harness(props: { seam: FakeSeam }) {
	return (
		<ClipboardProvider value={clipboard}>
			<ToastProvider>
				<DialogProvider>
					<SessionsSearch seam={props.seam} onResumed={(sessionId: string) => props.seam.resume(sessionId)} />
				</DialogProvider>
			</ToastProvider>
		</ClipboardProvider>
	)
}

// The config the DialogProvider reads (dialog sizes/motions): the resolved
// defaults, the same shape the app mounts.
const config = resolve({}, { terminalSuspend: true })

async function mount(options: FakeOptions = {}) {
	const seam = fakeSeam(options)
	const setup = await testRender(
		() => (
			<ConfigProvider config={config}>
				<Keymap.Provider config={keymapConfig}>
					<Harness seam={seam} />
				</Keymap.Provider>
			</ConfigProvider>
		),
		{ width: 100, height: 20 },
	)
	await settle(setup)
	openSessionsSearch()
	await settle(setup)
	return { setup, seam }
}

/** Flush the open-bridge effect, layout and the deferred 1 ms focus tick. */
async function settle(setup: Awaited<ReturnType<typeof testRender>>, rounds = 4): Promise<void> {
	for (let index = 0; index < rounds; index += 1) {
		await new Promise((resolve) => setTimeout(resolve, 5))
		await setup.renderOnce()
	}
}

function frame(setup: Awaited<ReturnType<typeof testRender>>): string {
	return setup.captureCharFrame().replace(/\s+/g, " ")
}

describe("/search overlay on the real stack (P0-1 + P1-2 regressions)", () => {
	test("letters including j/k reach the query input and build the full query", async () => {
		const { setup } = await mount()
		try {
			expect(frame(setup)).toContain("Search sessions")
			expect(sessionsSearchOpen()).toBe(true)

			// The P0-1 repro: this typed "son it" while the global layer ate j/k.
			await setup.mockInput.typeText("json kit")
			await settle(setup)
			expect(frame(setup)).toContain("json kit")

			// Enter runs the query and paints the hit list.
			setup.mockInput.pressEnter()
			await settle(setup)
			expect(frame(setup)).toContain("ses_json")
			expect(frame(setup)).toContain(formatSearchHitLine(HITS[0]!))

			// STILL letters, now with hits on screen: j/k are no list bindings,
			// so the refinement "json kitj" must land in the input untouched.
			await setup.mockInput.typeText("j")
			await settle(setup)
			expect(frame(setup)).toContain("json kitj")
			// The cursor never moved: the first hit keeps the `›` marker.
			expect(frame(setup)).toContain(`› ${formatSearchHitLine(HITS[0]!)}`)
			expect(frame(setup)).not.toContain(`› ${formatSearchHitLine(HITS[1]!)}`)
		} finally {
			await setup.dispose()
		}
	})

	test("with hits on screen the arrows move the wrapping hit cursor", async () => {
		const { setup } = await mount()
		try {
			await setup.mockInput.typeText("json")
			setup.mockInput.pressEnter()
			await settle(setup)
			expect(frame(setup)).toContain(`› ${formatSearchHitLine(HITS[0]!)}`)

			setup.mockInput.pressArrow("down")
			await settle(setup)
			expect(frame(setup)).toContain(`› ${formatSearchHitLine(HITS[1]!)}`)

			setup.mockInput.pressArrow("up")
			await settle(setup)
			expect(frame(setup)).toContain(`› ${formatSearchHitLine(HITS[0]!)}`)
		} finally {
			await setup.dispose()
		}
	})

	test("a rejected resume keeps the overlay OPEN on its `resume failed` line", async () => {
		const { setup, seam } = await mount({ failResume: true })
		try {
			await setup.mockInput.typeText("json")
			setup.mockInput.pressEnter()
			await settle(setup)
			expect(frame(setup)).toContain("ses_json")

			setup.mockInput.pressEnter()
			await settle(setup)

			// P1-2's reachable failure path: the status line is loud, the hit
			// list and the overlay stay on screen (never a silent close).
			const flat = frame(setup)
			expect(flat).toContain("resume failed — journal gone")
			expect(flat).toContain("ses_json")
			expect(sessionsSearchOpen()).toBe(true)
			expect(seam.calls.resumed).toEqual(["ses_json"])
		} finally {
			await setup.dispose()
		}
	})

	test("a successful resume closes the overlay", async () => {
		const { setup, seam } = await mount()
		try {
			await setup.mockInput.typeText("json")
			setup.mockInput.pressEnter()
			await settle(setup)
			setup.mockInput.pressEnter()
			await settle(setup)
			expect(sessionsSearchOpen()).toBe(false)
			expect(seam.calls.resumed).toEqual(["ses_json"])
		} finally {
			await setup.dispose()
		}
	})
})
