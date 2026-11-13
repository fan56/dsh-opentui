/**
 * Shell render fixture (opencode-style, pilot/shell-render): a canned event
 * stream drives the REAL shell render path — RemoteSessionSeam over a fake
 * RemoteHostSession → tui-base's seam-rows projection → Transcript +
 * WidgetsDock mounted through @opentui/solid's `testRender`. Captured frames
 * assert what actually reached the renderer buffer.
 *
 * Pure repo tooling, not a generic API: it wires the pieces the shell client
 * already has (the adapter, the projection, the vendored view components) and
 * adds the three things opencode's fixture layer teaches:
 *   1. canned event data builders (durable journal records; live turns are
 *      scripted through the fake session's TurnCallbacks),
 *   2. wait primitives over the renderer (`waitForFrame` predicate /
 *      `waitForVisualIdle` — opencode naming, thin wrappers over the
 *      @opentui/core/testing setup),
 *   3. normalized frame capture (trimEnd per line — the substring-assertion
 *      norm, never whole-frame equality).
 *
 * The fake session doubles the RemoteHostSession surface the adapter reads
 * (same shape as test/session-seam-adapter.test.ts's facade) and holds a
 * journal-listener registry: `journal(record)` replays a canned durable
 * record through the adapter's projectJournalRecord feed. Live turns run a
 * `turnScript` — the scripted callbacks (onToolStart/onToolRun/…) flow
 * through the adapter's real callback adaptation into the row store.
 *
 * NOT covered here (deliberate): the real ClientConnection/SDK transport —
 * faked at the RemoteHostSession boundary exactly like the protocol tests,
 * so the fixture never needs the global dsh closure (CI-stub safe).
 */
import { testRender } from "@opentui/solid"
import type { TestRendererSetup } from "@opentui/core/testing"
import { Transcript } from "../../tui-base/src/routes/session/transcript"
import { WidgetsDock } from "../../tui-base/src/routes/session/widgets-dock"
import { createSeamRows, type SeamRows } from "../../tui-base/src/routes/session/seam-rows"
import type { SessionSeam, SeamTranscriptRow } from "../../tui-base/src/seams/session"
import { RemoteSessionSeam } from "../src/client/session-seam-adapter"
import type { RemoteHostSession } from "../src/client/remote-host-session"
import type { RemoteJournalEntry } from "../src/client/remote-session-ops"

/** The turn-callback shape the fake session hands its script (structural —
 * the adapter adapts between this and SeamTurnCallbacks). */
export type FakeTurnCallbacks = {
	onThinkingDelta: (text: string) => void
	onContentDelta: (text: string) => void
	onTurnEnd: () => void
	onApprove: (name: string, args: Record<string, unknown>) => Promise<"allowed-once" | "rejected">
	onToolStart?: (start: { callId?: string; name: string; args: string }) => void
	onToolRun?: (run: { callId?: string; name: string; argsPretty: string; output: string; ok: boolean }) => void
	onError: (message: string) => void
}

export type TurnScript = (cb: FakeTurnCallbacks, userText: string) => Promise<void> | void

export interface ShellRenderFixtureOptions {
	width?: number
	height?: number
	/** Canned durable transcript the fake session answers storedTranscript with. */
	stored?: SeamTranscriptRow[]
	/** Scripted live turn; `fixture.send()` awaits it. */
	turnScript?: TurnScript
}

// ---------------------------------------------------------------------------
// Canned journal-record builders (payload contracts of projectJournalRecord
// in src/client/session-seam-adapter.ts).
// ---------------------------------------------------------------------------

let journalSeq = 0

export function userMessageRecord(text: string, messageID?: string): RemoteJournalEntry {
	journalSeq += 1
	return {
		type: "user/message",
		seq: journalSeq,
		time: Date.now(),
		data: {
			messageID: messageID ?? `msg-user-${journalSeq}`,
			content: [{ type: "text", text }],
			source: { kind: "user" },
		},
	}
}

export function assistantMessageRecord(text: string, messageID?: string): RemoteJournalEntry {
	journalSeq += 1
	return {
		type: "assistant/message",
		seq: journalSeq,
		time: Date.now(),
		data: { messageID: messageID ?? `msg-assistant-${journalSeq}`, text },
	}
}

/** A failed turn (`turn/end` with an error reason) — projects to a
 * `session.error` seam event (the error row / error notice). */
export function turnEndErrorRecord(message: string): RemoteJournalEntry {
	journalSeq += 1
	return {
		type: "turn/end",
		seq: journalSeq,
		time: Date.now(),
		data: { reason: { kind: "error", error: { message } } },
	}
}

// ---------------------------------------------------------------------------
// Fake session (RemoteHostSession double, adapter-facing subset)
// ---------------------------------------------------------------------------

/** Minimal RemoteHostSession double: canned reads + a journal-listener
 * registry + a scripted live turn. Same pattern as the protocol fakes in
 * test/client-fakes.ts — no network, no SDK, CI-stub safe. */
function fakeSession(options: ShellRenderFixtureOptions) {
	const calls: { method: string; args: unknown }[] = []
	const journalListeners: ((entry: RemoteJournalEntry) => void)[] = []
	const stored = options.stored ?? []
	let turnScript: TurnScript | undefined = options.turnScript

	const base = {
		label: "dsh-host",
		usage: { prompt: 3, completion: 5, cacheRead: 0, cacheWrite: 0 },
		lastTurnStats: { ms: 0, chars: 0, tokens: 0, tps: null, estimated: false, startedAt: 0, endedAt: 0 },
		status: {
			connection: "connected" as const,
			turn: "idle" as const,
			sessionAttached: true,
			tailActive: false,
		},
		currentSessionId: () => "ses-fixture",
		storedTranscript: async (id: string, _skip?: number) => {
			calls.push({ method: "storedTranscript", args: id })
			return stored
		},
		listSessions: async (_limit?: number) => [] as { id: string; title: string }[],
		searchSessions: async (_query: string) => [] as { id: string; snippet: string }[],
		resumeSession: (_id: string) => "ok" as const,
		newSession: () => calls.push({ method: "newSession", args: undefined }),
		renameSession: async (title: string) => ({ title, seq: 1 }),
		turn: async (userText: string, cb: FakeTurnCallbacks) => {
			calls.push({ method: "turn", args: userText })
			await turnScript?.(cb, userText)
		},
		steer: (text: string) => calls.push({ method: "steer", args: text }),
		abort: () => calls.push({ method: "abort", args: undefined }),
		steerChild: (_id: string, _text: string) => false,
		registerAskProvider: (_provider: unknown) => calls.push({ method: "registerAskProvider", args: undefined }),
		listProviders: async () => [] as { provider: string; models: string[] }[],
		modelCatalog: async () => ({ groups: [] as { id: string; models: { id: string }[] }[] }),
		currentModelSelection: async () => ({ provider: "prov-a", model: "ma1", reasoningEffort: "high" }),
		selectModel: async (selection: unknown) => selection,
		usageSummary: () => [] as string[],
		onJournalRecord: (listener: (entry: RemoteJournalEntry) => void) => {
			journalListeners.push(listener)
			return () => {
				journalListeners.splice(journalListeners.indexOf(listener), 1)
			}
		},
		subagentViews: () => [] as unknown[],
		onSubagentViews: (_listener: unknown) => () => {},
		dispose: async () => calls.push({ method: "dispose", args: undefined }),
	}
	return {
		session: base as unknown as RemoteHostSession & {
			setTurnScript(script: TurnScript | undefined): void
		},
		calls,
		/** Replay one canned durable journal record through every listener. */
		journal(entry: RemoteJournalEntry) {
			for (const listener of [...journalListeners]) listener(entry)
		},
	}
}

// ---------------------------------------------------------------------------
// Frame helpers (the opencode normalization norm: substring assertions over
// trimEnd-normalized frames, never whole-frame equality).
// ---------------------------------------------------------------------------

export function normalizeFrame(frame: string): string {
	return frame
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.trimEnd()
}

export interface ShellRenderFixture {
	/** The real shell adapter under test (RemoteSessionSeam implements SessionSeam). */
	seam: RemoteSessionSeam
	/** The seam-rows store feeding both view components. */
	projection: SeamRows
	/** Test-only reach-through: canned stored data, call counts, turn script. */
	session: RemoteHostSession & { setTurnScript(script: TurnScript | undefined): void }
	/** Replay one canned durable journal record through the adapter feed. */
	journal(entry: RemoteJournalEntry): void
	/** Send a live turn through the projection (rows.send → seam.turn). */
	send(text: string): Promise<void>
	/** The renderer facade (opencode naming), plus a normalized capture. */
	renderOnce(): Promise<void>
	waitForFrame(predicate?: (frame: string) => boolean, options?: { timeoutMs?: number }): Promise<string>
	waitForVisualIdle(options?: { quietFrames?: number }): Promise<void>
	captureFrame(): string
	resize(width: number, height: number): void
	dispose(): Promise<void>
	[Symbol.asyncDispose](): Promise<void>
}

export async function createShellRenderFixture(options: ShellRenderFixtureOptions = {}): Promise<ShellRenderFixture> {
	const width = options.width ?? 80
	const height = options.height ?? 32
	const { session, journal: dispatchJournal } = fakeSession(options)
	const seam = new RemoteSessionSeam(session)
	const projection = createSeamRows(seam as unknown as SessionSeam, () => "ses-fixture")

	const setup: TestRendererSetup = await testRender(() => {
		return (
			<box width="100%" height="100%" flexDirection="column">
				{/* Shared projection: transcript + dock paint the same rows the
				    page wires. The getter prop keeps the STORE ARRAY reactive. */}
				<Transcript seam={seam as unknown as SessionSeam} projection={projection} focused={() => false} />
				<WidgetsDock {...{ get rows() { return projection.rows } }} />
			</box>
		)
	}, { width, height, useMouse: false })

	// Hydrate the canned stored transcript before the test body runs, so
	// assertions never race the initial load.
	await projection.load()

	const captureFrame = () => normalizeFrame(setup.captureCharFrame())

	/** Time-based poll (opencode waitForFrame semantics): render, capture,
	 * test the predicate on the NORMALIZED frame, retry on wall-clock budget.
	 * The upstream setup.waitForFrame counts render PASSES, which can outpace
	 * async markdown painting — a real-time budget is the robust primitive. */
	const waitForFrame = async (
		predicate?: (frame: string) => boolean,
		waitOptions?: { timeoutMs?: number },
	): Promise<string> => {
		const timeoutMs = waitOptions?.timeoutMs ?? 4000
		const deadline = Date.now() + timeoutMs
		for (;;) {
			await setup.renderOnce()
			const frame = captureFrame()
			if (predicate?.(frame) ?? true) return frame
			if (Date.now() > deadline) {
				throw new Error(`shell-render-fixture.waitForFrame: timed out after ${timeoutMs}ms\nlast frame:\n${frame}`)
			}
			await new Promise((resolve) => setTimeout(resolve, 25))
		}
	}

	return {
		seam,
		projection,
		session,
		journal: dispatchJournal,
		send: (text) => projection.send(text),
		renderOnce: () => setup.renderOnce(),
		waitForFrame,
		waitForVisualIdle: (idleOptions) => setup.waitForVisualIdle(idleOptions),
		captureFrame,
		resize: (w, h) => setup.resize(w, h),
		async dispose() {
			await setup.dispose()
			await session.dispose()
		},
		async [Symbol.asyncDispose]() {
			await this.dispose()
		},
	}
}
