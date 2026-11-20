/**
 * Shell render fixture (opencode-style, pilot/shell-render): a canned event
 * stream drives the REAL shell render path — BridgeSessionSeam (the 0.23.0
 * production default) over a fake BridgeTransport → tui-base's seam-rows
 * projection → Transcript + WidgetsDock mounted through @opentui/solid's
 * `testRender`. Captured frames assert what actually reached the renderer
 * buffer.
 *
 * S6 "先建" (adjudication 024-s6-conflict-adjudication-oldfox.md §A.4): the
 * fixture used to drive the real render path through the legacy thin-client
 * seam (only reachable via an env escape hatch, now removed). Since the 0.23.0
 * flip the production seam IS BridgeSessionSeam, so this fixture now uses it —
 * the render chain downstream (seam-rows → Transcript/WidgetsDock →
 * buffer) and every canned projector are unchanged. The five `-ft` tests that
 * consume this fixture keep their assertions verbatim.
 *
 * Pure repo tooling, not a generic API: it wires the pieces the shell client
 * already has (the bridge seam, the projection, the vendored view components)
 * and adds the three things opencode's fixture layer teaches:
 *   1. canned event data builders (durable journal records; live turns are
 *      scripted as fake-transport frames),
 *   2. wait primitives over the renderer (`waitForFrame` predicate /
 *      `waitForVisualIdle` — opencode naming, thin wrappers over the
 *      @opentui/core/testing setup),
 *   3. normalized frame capture (trimEnd per line — the substring-assertion
 *      norm, never whole-frame equality).
 *
 * The fake transport doubles the `BridgeTransport` request/onEvent surface
 * (`bridge-session-seam.ts:132-138`). All durable transcript reads go through
 * the seam's REAL `storedTranscript` → `journal.replay` → `bridgeReplayRowsToSeamTranscript`
 * path; live turns drive the seam's real frame state machine (`#onBridgeEvent`).
 * A SCRATCH dshHome/workspaceDir is injected so the seam's S5 local config/
 * settings/agents faces never read the operator's real `~/.dsh` (no global
 * dsh/profile dependency — CI-stub safe, no cross-run contamination).
 */
import { testRender } from "@opentui/solid"
import type { TestRendererSetup } from "@opentui/core/testing"
import type { CapturedFrame } from "@opentui/core"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { applyI18nConfig } from "../../i18n/src/index"
import { Transcript } from "../../tui-base/src/routes/session/transcript"
import { WidgetsDock } from "../../tui-base/src/routes/session/widgets-dock"
import { createSeamRows, type SeamRows } from "../../tui-base/src/routes/session/seam-rows"
import type { SessionSeam, SeamSessionEvent } from "../../tui-base/src/seams/session"
import {
	BridgeSessionSeam,
	bridgeReplayRowsToSeamEvents,
	type BridgeEventFrame,
	type BridgeReplayRow,
	type BridgeTransport,
} from "../src/client/bridge-session-seam.ts"
import type { StoredTranscriptRow } from "../src/client/seam-types.ts"
import type { RemoteJournalEntry } from "../src/client/remote-session-ops"

/** The turn-callback shape the fake transport hands its script (structural —
 * the bridge seam adapts between these and SeamTurnCallbacks via frames). */
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
	/** Canned durable transcript. StoredTranscriptRow is the seam-level shape
	 * the bridge's `journal.replay` → `bridgeReplayRowsToSeamTranscript`
	 * projection yields; the fixture converts each stored row into an
	 * equivalent `{seq,type,payload}` replay row so the REAL storedTranscript
	 * path runs during `projection.load()`. Fine-grained projection coverage
	 * lives in test/bridge-session-seam.test.ts. */
	stored?: StoredTranscriptRow[]
	/** When set, every journal.replay read REJECTS with this error — the
	 * incident injection point for the read-failure cases (research/
	 * oldfox-reuse-verdict.md §3: read failure must not be treated as empty
	 * data). */
	storedFailure?: Error
	/** Scripted live turn; `fixture.send()` awaits it. */
	turnScript?: TurnScript
}

// ---------------------------------------------------------------------------
// Canned journal-record builders (payload contracts of projectJournalRecord
// in src/client/session-seam-adapter.ts, reused by the bridge seam).
// ---------------------------------------------------------------------------

// i18n boot parity with the real client (examples/v2-entry.tsx calls
// `applyI18nConfig(seam.configLoad?.())` before mounting): the fixture mounts
// tui-base view components directly, so without this boot every `t()` call
// (e.g. WidgetsDock's activity frame title) fail-opens to the raw key and the
// en-literal frame assertions never see translated copy. Fixed language, no
// config → the bundled en default, matching the boot contract.
applyI18nConfig()

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

/** A failed turn (`turn/end` with an error reason) — projects via the
 * `session.error` seam event to the error row / error notice. */
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
// StoredTranscriptRow → BridgeReplayRow conversion (feeds the REAL bridge
// storedTranscript projection; see createShellRenderFixture).
// ---------------------------------------------------------------------------

function storedRowToReplay(row: StoredTranscriptRow, seq: number): BridgeReplayRow[] {
	if (row.kind === "tool") {
		const callId = `stored-tool-${seq}`
		return [
			{ seq, type: "tool/call", payload: { callId, name: row.name, arguments: row.args } },
			{
				seq: seq + 1,
				type: "tool/result",
				payload: { callId, output: row.brief, isError: row.ok === false },
			},
		]
	}
	if (row.kind === "user") {
		return [{ seq, type: "user/message", payload: { content: [{ type: "text", text: row.text }], source: { kind: "user" } } }]
	}
	if (row.kind === "assistant") {
		return [{ seq, type: "assistant/message", payload: { message: { content: [{ type: "text", text: row.text }] } } }]
	}
	// ask rows carry structured Q&A entries; the remote projection yields an
	// `ask` SeamTranscriptRow with empty text + entries. The bridge replay
	// projector handles ask via an `ask_user_question` tool call/result pair;
	// no ft test currently stores ask rows, so degrade to an assistant text row
	// rather than fabricate a wire contract.
	return [{ seq, type: "assistant/message", payload: { message: { content: [{ type: "text", text: row.text }] } } }]
}

function journalRecordToReplay(entry: RemoteJournalEntry): BridgeReplayRow {
	return { seq: entry.seq, type: entry.type, payload: entry.data }
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

export function normalizeFrame(frame: string): string {
	return frame
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.trimEnd()
}

export interface ShellRenderFixture {
	/** The real bridge seam under test (the 0.23.0 production default seam). */
	seam: BridgeSessionSeam
	/** The seam-rows store feeding both view components. */
	projection: SeamRows
	/** Test-only reach-through: the seam's read boundary (reassignable to inject
	 * read failures) + turn-script control. */
	session: {
		setTurnScript(script: TurnScript | undefined): void
		storedTranscript(): Promise<BridgeReplayRow[]>
	}
	/** Replay one canned durable journal record through the seam's event feed. */
	journal(entry: RemoteJournalEntry): void
	/** Send a live turn through the projection (rows.send → seam.turn). */
	send(text: string): Promise<void>
	/** The renderer facade (opencode naming), plus a normalized capture. */
	renderOnce(): Promise<void>
	waitForFrame(predicate?: (frame: string) => boolean, options?: { timeoutMs?: number }): Promise<string>
	waitForVisualIdle(options?: { quietFrames?: number }): Promise<void>
	captureFrame(): string
	/** Span-level capture (colors/attributes per cell) — for fade assertions
	 * where the char frame cannot see the gradient. */
	captureSpans(): CapturedFrame
	resize(width: number, height: number): void
	dispose(): Promise<void>
	[Symbol.asyncDispose](): Promise<void>
}

export async function createShellRenderFixture(options: ShellRenderFixtureOptions = {}): Promise<ShellRenderFixture> {
	const width = options.width ?? 80
	const height = options.height ?? 32

	// SCRATCH home/workspace — the bridge seam ctor builds S5 local config/
	// settings/agents faces that read dshHome files. Never read ~/.dsh here.
	const scratch = mkdtempSync(join(tmpdir(), "shell-render-fixture-"))

	// Replayable journal state. `stored` seeds the durable log; `journal(entry)`
	// appends a canned record and re-runs the seam's storedTranscript path.
	let replayRows: BridgeReplayRow[] = []
	let seq = 1
	for (const row of options.stored ?? []) {
		const converted = storedRowToReplay(row, seq)
		replayRows = replayRows.concat(converted)
		seq += converted.length
	}
	let turnScript: TurnScript | undefined = options.turnScript

	const eventListeners: ((frame: BridgeEventFrame) => void)[] = []

	// The fake session's storedTranscript is the seam's read boundary — the
	// transport's journal.replay delegates to it. Tests reassign it to inject a
	// mid-session read failure (transcript-loss rule), so it must stay mutable.
	const session = {
		setTurnScript(script: TurnScript | undefined) { turnScript = script },
		async storedTranscript(): Promise<BridgeReplayRow[]> {
			if (options.storedFailure) throw options.storedFailure
			return replayRows
		},
	}

	const transport: BridgeTransport = {
		async request(method, params) {
			switch (method) {
				case "journal.replay": {
					const rows = await session.storedTranscript()
					return { rows, cursor: rows.length + 1 }
				}
				case "session.open":
					return { sessionId: "ses-fixture" }
				case "session.list":
					return { items: [] }
				case "modelCatalog":
					return { groups: [] }
				case "model.currentSelection":
					return { provider: "prov-a", model: "ma1", reasoningEffort: "high" }
				case "bridge.ping":
					return { ok: true, capabilities: [] }
				case "session.send": {
					// The bridge seam registers #activeCallbacks + the #turnDone
					// waiter BEFORE this request (bridge-session-seam.ts:3083-3089),
					// so frames emitted here reach the live turn callbacks.
					const text = typeof params?.text === "string" ? params.text : ""
					emit({ type: "turn.start", payload: { turnId: "turn-fixture" } })
					const cb: FakeTurnCallbacks = {
						onThinkingDelta: (t) => emit({ type: "turn.token", payload: { kind: "reasoning", text: t } }),
						onContentDelta: (t) => emit({ type: "turn.token", payload: { text: t } }),
						onError: (m) => emit({ type: "turn.error", payload: { message: m } }),
						onTurnEnd: () => emit({ type: "turn.end", payload: { turnId: "turn-fixture" } }),
						onApprove: async () => "allowed-once",
						onToolStart: (s) => emit({
							type: "turn.tool",
							payload: { name: s.name, callId: s.callId, input: safeParseArgs(s.args) },
						}),
						onToolRun: (r) => emit({
							type: "turn.tool",
							payload: { name: r.name, callId: r.callId, output: r.output, isError: !r.ok },
						}),
					}
					await turnScript?.(cb, text)
					// Terminal frame settles #turnDone so seam.turn resolves (the
					// old fixture relied on the script calling onTurnEnd; emitting
					// here as well is idempotent for the seam's terminal path).
					emit({ type: "turn.end", payload: { turnId: "turn-fixture" } })
					return { turnId: "turn-fixture" }
				}
				default:
					return {}
			}
		},
		onEvent(listener) {
			eventListeners.push(listener)
			return () => {
				const i = eventListeners.indexOf(listener)
				if (i >= 0) eventListeners.splice(i, 1)
			}
		},
	}

	function emit(frame: BridgeEventFrame): void {
		for (const l of [...eventListeners]) l(frame)
	}

	const logger = { info() {}, warn() {}, error() {}, debug() {} }
	const seam = new BridgeSessionSeam({
		transport,
		ctx: { logger },
		dshHome: scratch,
		workspaceDir: scratch,
		profile: "opentui",
	})

	// Capture the seam's onSessionEvent subscribers (createSeamRows registers its
	// `apply` here). Durable journal records have NO live bridge frame type — in
	// production they reach the view through `bridgeReplayRowsToSeamEvents` fed
	// to these same listeners by the recovery drain (bridge-session-seam.ts:1858).
	// The fixture's `journal()` uses the identical projector + listener path so
	// the render chain and projector coverage are byte-identical to production.
	const replayListeners: ((event: SeamSessionEvent) => void)[] = []
	const realOnSessionEvent = seam.onSessionEvent.bind(seam)
	seam.onSessionEvent = (listener: (event: SeamSessionEvent) => void) => {
		replayListeners.push(listener)
		return realOnSessionEvent(listener)
	}

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
	const captureSpans = () => setup.captureSpans()

	/** Time-based poll (opencode waitForFrame semantics): render, capture,
	 * test the predicate on the NORMALIZED frame, retry on wall-clock budget. */
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
		journal: (entry: RemoteJournalEntry) => {
			replayRows = replayRows.concat(journalRecordToReplay(entry))
			// The production recovery drain applies durable rows via
			// bridgeReplayRowsToSeamEvents → onSessionEvent listeners → seam-rows
			// apply (bridge-session-seam.ts:1858). Feed the same projector + the
			// same listener set here so the render chain and projector coverage
			// are identical to production — including turn/end → session.error.
			const events = bridgeReplayRowsToSeamEvents([journalRecordToReplay(entry)], "ses-fixture")
			for (const event of events) {
				for (const listener of [...replayListeners]) listener(event)
			}
		},
		send: (text) => projection.send(text),
		renderOnce: () => setup.renderOnce(),
		waitForFrame,
		waitForVisualIdle: (idleOptions) => setup.waitForVisualIdle(idleOptions),
		captureFrame,
		captureSpans,
		resize: (w, h) => setup.resize(w, h),
		async dispose() {
			await setup.dispose()
			await seam.dispose()
			rmSync(scratch, { recursive: true, force: true })
		},
		async [Symbol.asyncDispose]() {
			await this.dispose()
		},
	}
}

/** Parse a tool-call args string into the frame `input` value; invalid JSON
 * stays a raw string (the seam JSON.stringifies `input` back to args). */
function safeParseArgs(args: string): unknown {
	if (typeof args !== "string" || args === "") return {}
	try {
		return JSON.parse(args)
	} catch {
		return args
	}
}
