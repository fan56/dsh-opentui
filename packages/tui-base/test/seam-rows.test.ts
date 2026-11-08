import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { NullSessionSeam, type SeamTranscriptRow, type SeamTurnCallbacks } from "../src/seams/session"
import { createSeamRows, toStoredRow } from "../src/routes/session/seam-rows"

class FakeSeam extends NullSessionSeam {
	stored: SeamTranscriptRow[] = []
	script?: (cb: SeamTurnCallbacks) => Promise<void>
	override async storedTranscript(): Promise<SeamTranscriptRow[]> {
		return this.stored
	}
	override currentSessionId() {
		return "s1"
	}
	override async turn(_text: string, cb: SeamTurnCallbacks): Promise<void> {
		await this.script?.(cb)
	}
}

function setup(seam: FakeSeam, options?: { thinkFadeMs?: number }) {
	let dispose!: () => void
	const projection = createRoot((d) => {
		dispose = d
		return createSeamRows(seam, () => "s1", options)
	})
	return { projection, dispose }
}

describe("seam rows projection", () => {
	test("stored rows map to typed rows with stable keys", () => {
		expect(toStoredRow({ kind: "user", text: "hi", final: true }, 0)).toEqual({
			key: "stored:user:0",
			kind: "user",
			text: "hi",
			final: true,
		})
		expect(toStoredRow({ kind: "assistant", text: "yo", final: false }, 1).kind).toBe("assistant")
		expect(toStoredRow({ kind: "tool", text: "read", final: true }, 2)).toMatchObject({ kind: "tool", name: "read" })
	})

	test("batch V1: durable tool rows carry args/output/ok; legacy rows degrade to a bare name", () => {
		// Gap 3: the journal projection pairs call→result — the replayed block
		// shows its args brief and result summary, failed rows keep the ✗.
		expect(
			toStoredRow({ kind: "tool", text: "bash", final: true, args: '{"command":"ls"}', output: '{"content":[]}', ok: true }, 0),
		).toMatchObject({ kind: "tool", name: "bash", args: '{"command":"ls"}', status: "done", output: '{"content":[]}' })
		expect(
			toStoredRow({ kind: "tool", text: "bash", final: true, args: "{}", output: "boom", ok: false }, 1),
		).toMatchObject({ status: "failed", output: "boom" })
		// Older journals (no tool slice): no fabricated args/output/elapsed.
		const legacy = toStoredRow({ kind: "tool", text: "read", final: true }, 2)
		expect(legacy).toMatchObject({ kind: "tool", name: "read", args: "", status: "done" })
		expect(legacy.kind === "tool" && legacy.startedAt === undefined && legacy.elapsedSec === undefined).toBe(true)
	})

	test("batch V1: onToolRun settles the tool row live with output and frozen elapsed", async () => {
		const seam = new FakeSeam()
		seam.script = async (cb) => {
			cb.onToolStart?.({ callId: "c1", name: "bash", args: '{"command":"sleep 0.05"}' })
			await Bun.sleep(60)
			cb.onToolRun?.({ callId: "c1", name: "bash", argsPretty: '{"command":"sleep 0.05"}', output: '{"ok":true}', ok: true })
			cb.onContentDelta("done")
		}
		const { projection, dispose } = setup(seam)
		await projection.send("run it")
		const tool = projection.rows.find((r) => r.kind === "tool")
		expect(tool).toBeDefined()
		// Settled DURING the turn (not swept at finalize): status, output and
		// the frozen elapsed all ride the row.
		expect(tool).toMatchObject({ status: "done", output: '{"ok":true}' })
		expect(tool!.kind === "tool" && tool!.elapsedSec !== undefined).toBe(true)
		expect(tool!.kind === "tool" && (tool!.elapsedSec ?? 0) >= 0.05).toBe(true)
		dispose()
	})

	test("batch V1: a result racing a row-less store still lands; failed keeps ✗ semantics", async () => {
		const seam = new FakeSeam()
		seam.script = async (cb) => {
			// No onToolStart — the result arrives for an unseen callId.
			cb.onToolRun?.({ callId: "cx", name: "bash", argsPretty: "", output: "boom", ok: false })
		}
		const { projection, dispose } = setup(seam)
		await projection.send("go")
		expect(projection.rows.find((r) => r.kind === "tool")).toMatchObject({ status: "failed", output: "boom" })
		dispose()
	})

	test("hydrate reconciles by key: unchanged rows keep store identity", async () => {
		const seam = new FakeSeam()
		const { projection, dispose } = setup(seam)
		projection.hydrate([
			{ kind: "user", text: "a", final: true },
			{ kind: "assistant", text: "b", final: true },
		])
		const keys = projection.rows.map((r) => r.key)
		projection.hydrate([
			{ kind: "user", text: "a", final: true },
			{ kind: "assistant", text: "b2", final: true },
		])
		// Keys stable across re-hydrate → the client-build reconcile patches in
		// place. (bun test resolves solid-js's server build, whose reconcile
		// ignores `key`, so object identity is asserted by the live example.)
		expect(projection.rows.map((r) => r.key)).toEqual(keys)
		expect(projection.rows[1]).toMatchObject({ text: "b2" })
		expect(projection.hydrated()).toBe(true)
		dispose()
	})

	test("load pulls storedTranscript through the seam", async () => {
		const seam = new FakeSeam()
		seam.stored = [{ kind: "user", text: "from seam", final: true }]
		const { projection, dispose } = setup(seam)
		projection.load()
		await Bun.sleep(0)
		expect(projection.rows.map((r) => r.kind)).toEqual(["user"])
		dispose()
	})

	test("seam events stream into keyed rows; deltas patch one row in place", () => {
		const seam = new FakeSeam()
		const { projection, dispose } = setup(seam)
		seam.emit({ type: "message.updated", details: { id: "u1", role: "user", text: "q", sessionID: "s1" } })
		const part = (text: string, completed?: number) => ({
			type: "message.part.updated",
			details: { sessionID: "s1", messageID: "m1", part: { type: "text", id: "p1", text, time: { completed } } },
		})
		seam.emit(part("Hello "))
		const key = projection.rows[1]?.key
		seam.emit(part("world"))
		expect(projection.rows).toHaveLength(2)
		expect(projection.rows[1]?.key).toBe(key)
		expect(projection.rows[1]).toMatchObject({ kind: "assistant", text: "Hello world", final: false })
		seam.emit(part("", 1))
		expect(projection.rows[1]).toMatchObject({ final: true })
		seam.emit({
			type: "message.part.updated",
			details: { messageID: "m1", part: { type: "tool", id: "t1", name: "read", status: "done" } },
		})
		expect(projection.rows[2]).toMatchObject({ kind: "tool", name: "read", status: "done" })
		// other-session events are dropped
		seam.emit({ type: "message.updated", details: { id: "u9", role: "user", text: "x", sessionID: "s2" } })
		expect(projection.rows).toHaveLength(3)
		dispose()
		expect(seam.listeners).toHaveLength(0) // onCleanup unsubscribed
	})

	test("send streams through seam.turn and finalizes rows", async () => {
		const seam = new FakeSeam()
		seam.script = async (cb) => {
			cb.onThinkingDelta("thinking")
			cb.onContentDelta("one ")
			cb.onToolStart?.({ callId: "c1", name: "grep", args: "x" })
			expect(await cb.onApprove("grep", {})).toBe("allowed-once")
			cb.onContentDelta("two")
		}
		const { projection, dispose } = setup(seam)
		const pending = projection.send("go")
		expect(projection.rows[0]).toMatchObject({ kind: "user", text: "go" })
		await pending
		const kinds = projection.rows.map((r) => r.kind)
		expect(kinds).toEqual(["user", "reasoning", "assistant", "tool"])
		expect(projection.rows[2]).toMatchObject({ text: "one two", final: true })
		expect(projection.rows[1]).toMatchObject({ final: true })
		expect(projection.rows[3]).toMatchObject({ status: "done" })
		dispose()
	})

	test("settle supersede: journal body replaces the streamed turn — one body, no live leftovers", async () => {
		const seam = new FakeSeam()
		seam.script = async (cb) => {
			cb.onThinkingDelta("drafting")
			// Streamed wording carries leaked self-talk the durable body fixes.
			cb.onContentDelta("42. hail - let me write: Hailstorms occasionally pelt the city")
		}
		const { projection, dispose } = setup(seam)
		await projection.send("weather")
		expect(projection.rows.map((r) => r.key)).toEqual(["user:local-1", "reasoning:live-2", "assistant:live-2"])

		// Post-turn journal replay (adapter projection): real ids, sessionID
		// stamped — prompt record first, then the settled body.
		seam.emit({ type: "message.updated", details: { id: "m-u1", role: "user", text: "weather", sessionID: "s1" } })
		seam.emit({
			type: "message.part.updated",
			details: {
				messageID: "m-a1",
				sessionID: "s1",
				part: { type: "text", id: "m-a1:text", text: "42. Hailstorms occasionally pelt the city during summer thunderstorms." },
			},
		})

		// ONE body, ONE prompt — the settled row took the streamed row's place
		// (fv-07: scrolled view served the stale streamed copy otherwise).
		expect(projection.rows.map((r) => r.key)).toEqual(["user:m-u1", "assistant:m-a1:m-a1:text"])
		expect(projection.rows[1]).toMatchObject({
			kind: "assistant",
			final: true,
			text: "42. Hailstorms occasionally pelt the city during summer thunderstorms.",
		})
		expect(projection.rows.some((r) => r.key.includes("live-"))).toBe(false)
		dispose()
	})

	test("settle supersede: two streamed turns replay oldest-first — one settled body each, order kept", async () => {
		const seam = new FakeSeam()
		let turn = 0
		seam.script = async (cb) => {
			turn += 1
			cb.onContentDelta(turn === 1 ? "streamed body one" : "streamed body two with self-talk:")
		}
		const { projection, dispose } = setup(seam)
		await projection.send("q1")
		await projection.send("q2")
		const user = (id: string, text: string) => ({
			type: "message.updated",
			details: { id, role: "user", text, sessionID: "s1" },
		})
		const body = (id: string, text: string) => ({
			type: "message.part.updated",
			details: { messageID: id, sessionID: "s1", part: { type: "text", id: `${id}:text`, text } },
		})
		seam.emit(user("mu1", "q1"))
		seam.emit(body("ma1", "settled body one"))
		seam.emit(user("mu2", "q2"))
		seam.emit(body("ma2", "settled body two"))
		expect(projection.rows.map((r) => [r.kind, r.text])).toEqual([
			["user", "q1"],
			["assistant", "settled body one"],
			["user", "q2"],
			["assistant", "settled body two"],
		])
		expect(projection.rows.some((r) => r.key.includes("live-") || r.key.includes("local-"))).toBe(false)
		dispose()
	})

	test("page-injected feedback (no sessionID) never supersedes a settled turn", async () => {
		const seam = new FakeSeam()
		seam.script = async (cb) => {
			cb.onContentDelta("streamed body")
		}
		const { projection, dispose } = setup(seam)
		await projection.send("q")
		const before = projection.rows.map((r) => [r.key, r.text])
		// The slash hosts' say() shape: messageID "cmd", NO sessionID stamp.
		projection.apply({
			type: "message.part.updated",
			details: { messageID: "cmd", part: { type: "text", id: "cmd-1", text: "model switched feedback" } },
		})
		expect(projection.rows.slice(0, before.length).map((r) => [r.key, r.text])).toEqual(before)
		expect(projection.rows.at(-1)).toMatchObject({ kind: "assistant", text: "model switched feedback" })
		dispose()
	})

	test("settle converge: streamed body/self-talk/reasoning drafts converge to the durable shape", async () => {
		const seam = new FakeSeam()
		seam.stored = [
			{ kind: "user", text: "weather", final: true },
			{
				kind: "assistant",
				text: "42. Hailstorms occasionally pelt the city during summer thunderstorms.",
				final: true,
			},
		]
		seam.script = async (cb) => {
			// The raw stream: reasoning drafts, leaked self-talk, a rewritten
			// rendition — all in the streamed rows.
			cb.onThinkingDelta("44. draft wording: smog can briefly accumulate")
			cb.onContentDelta("42. hail - let me write: Hailstorms…\n\n1. rewritten list")
		}
		const { projection, dispose } = setup(seam, { thinkFadeMs: 0 })
		await projection.send("weather")
		// One assistant body — the DURABLE text — patched into the live row's
		// key; the streamed reasoning drafts drop (stored transcripts carry
		// no reasoning; batch V2a's fade linger is off here — the default
		// linger is covered by the think-panel tests below). Settled view ==
		// reload view.
		expect(projection.rows.map((r) => r.kind)).toEqual(["user", "assistant"])
		expect(projection.rows[1]).toMatchObject({
			key: "assistant:live-2",
			final: true,
			text: "42. Hailstorms occasionally pelt the city during summer thunderstorms.",
		})
		expect(projection.rows.some((r) => r.kind === "reasoning")).toBe(false)
		dispose()
	})

	test("settle converge: an error turn keeps its error row (no durable body fetch patch)", async () => {
		const seam = new FakeSeam()
		seam.stored = [
			{ kind: "user", text: "q", final: true },
			{ kind: "assistant", text: "older turn body", final: true },
		]
		seam.script = async (cb) => {
			cb.onContentDelta("partial")
			cb.onError("ask failed")
		}
		const { projection, dispose } = setup(seam)
		await projection.send("q")
		expect(projection.rows[1]).toMatchObject({ kind: "assistant", text: "error: ask failed", final: true })
		dispose()
	})

	test("settle converge: session arms DURING the turn — undefined at send, real id at settle", async () => {
		// Live finding (batch V4): the remote facade's currentSessionId() is
		// still undefined when send() starts — the session attaches inside
		// seam.turn. An id captured at send entry fetches no transcript, so
		// the converge must read it at settle.
		const seam = new FakeSeam()
		seam.stored = [{ kind: "assistant", text: "durable clean body", final: true }]
		let sessionId: string | undefined
		let dispose!: () => void
		const projection = createRoot((d) => {
			dispose = d
			// thinkFadeMs 0: this test asserts the converge shape, not the V2a
			// summary linger (the default linger has its own tests).
			return createSeamRows(seam, () => sessionId ?? "", { thinkFadeMs: 0 })
		})
		seam.script = async (cb) => {
			cb.onThinkingDelta("reasoning drafts")
			sessionId = "s1" // the facade arms the session mid-turn
			cb.onContentDelta("streamed blob with self-talk")
		}
		try {
			await projection.send("q")
			expect(projection.rows.map((r) => r.kind)).toEqual(["user", "assistant"])
			expect(projection.rows[1]).toMatchObject({ text: "durable clean body", final: true })
			expect(projection.rows.some((r) => r.kind === "reasoning")).toBe(false)
		} finally {
			dispose()
		}
	})

	test("settle converge: survives the remote facade's detach-at-settle (empty sessionID)", async () => {
		const seam = new FakeSeam()
		seam.stored = [{ kind: "assistant", text: "durable clean body", final: true }]
		let attached = true
		let dispose!: () => void
		const projection = createRoot((d) => {
			dispose = d
			return createSeamRows(seam, () => (attached ? "s1" : ""))
		})
		seam.script = async (cb) => {
			cb.onContentDelta("streamed blob with self-talk")
			attached = false // session gone by settle: the empty read must not void the patch
		}
		try {
			await projection.send("q")
			expect(projection.rows[1]).toMatchObject({ key: "assistant:live-2", text: "durable clean body", final: true })
		} finally {
			dispose()
		}
	})

	test("dependency direction: rebuilt transcript path uses the seam, not data/client", async () => {
		for (const file of ["seam-rows.ts", "transcript.tsx"]) {
			const source = await Bun.file(new URL(`../src/routes/session/${file}`, import.meta.url)).text()
			expect(source).not.toMatch(/context\/(data|client)/)
			expect(source).not.toMatch(/from "@opencode\/client"/)
			expect(source).not.toMatch(/from "@dsh-opentui\//)
		}
	})

	test("batch V2a think panel: first delta opens streaming, text first char collapses, turn end fades", async () => {
		const seam = new FakeSeam()
		let release!: () => void
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		seam.script = async (cb) => {
			cb.onThinkingDelta("draft one")
			cb.onThinkingDelta("draft two")
			await gate
			cb.onContentDelta("answer")
		}
		const { projection, dispose } = setup(seam, { thinkFadeMs: 40 })
		const pending = projection.send("go")
		await Bun.sleep(10)
		// Mid-stream: the live bordered panel row (streaming, startedAt set).
		expect(projection.rows[1]).toMatchObject({ key: "reasoning:live-2", kind: "reasoning", streaming: true, text: "draft onedraft two" })
		const startedAt = (projection.rows[1] as { startedAt?: number }).startedAt
		expect(typeof startedAt).toBe("number")
		release()
		await pending
		// Text first char collapsed it: the one-line summary, elapsed frozen.
		const collapsed = projection.rows.find((r) => r.kind === "reasoning") as
			| { streaming?: boolean; elapsedSec?: number; text: string }
			| undefined
		expect(collapsed).toMatchObject({ streaming: false, text: "draft onedraft two" })
		expect(typeof collapsed?.elapsedSec).toBe("number")
		// 轮末渐隐: the summary lingers past the settle, then clears.
		expect(projection.rows.some((r) => r.kind === "reasoning")).toBe(true)
		await Bun.sleep(80)
		expect(projection.rows.some((r) => r.kind === "reasoning")).toBe(false)
		dispose()
	})

	test("batch V2a think panel: a new think inside the fade window clears the old summary (clear old, show new)", async () => {
		const seam = new FakeSeam()
		seam.script = async (cb) => {
			cb.onThinkingDelta("round one")
			cb.onContentDelta("answer one")
		}
		const { projection, dispose } = setup(seam, { thinkFadeMs: 10_000 })
		await projection.send("q1")
		expect(projection.rows.some((r) => r.kind === "reasoning")).toBe(true)
		// Second turn's FIRST delta clears the lingering summary immediately.
		seam.script = async (cb) => {
			cb.onThinkingDelta("round two")
		}
		const pending = projection.send("q2")
		expect(projection.rows.map((r) => r.key)).toEqual(["user:local-1", "assistant:live-2", "user:local-3", "reasoning:live-4"])
		expect(projection.rows[3]).toMatchObject({ kind: "reasoning", streaming: true, text: "round two" })
		await pending
		dispose()
	})

	test("batch V2a think panel: thinking-only turn collapses at finalize; a tool call collapses the segment", async () => {
		const seam = new FakeSeam()
		seam.script = async (cb) => {
			cb.onThinkingDelta("pre-tool thought")
			cb.onToolStart?.({ callId: "c1", name: "grep", args: "x" })
		}
		const { projection, dispose } = setup(seam, { thinkFadeMs: 0 })
		await projection.send("go")
		// The tool call collapsed the segment; fade 0 dropped it at turn end.
		expect(projection.rows.some((r) => r.kind === "reasoning")).toBe(false)
		// Thinking-only turn (no text/tool): the finalize pass collapses it.
		seam.script = async (cb) => {
			cb.onThinkingDelta("only thought")
		}
		await projection.send("q2")
		expect(projection.rows.some((r) => r.kind === "reasoning")).toBe(false)
		dispose()
	})
})

describe("batch V2b: subagent tree row", () => {
	test("the subagent marker face drives one live tree row; empty roster drops it", () => {
		const seam = new FakeSeam()
		const { projection, dispose } = setup(seam)
		const unsub = seam.onSubagentViews(() => {})
		// NullSessionSeam's onSubagentViews just registers — drive the
		// projection through its exposed fold (the seam feed path is the
		// same function the subscription calls).
		projection.applySubagentViews([
			{
				id: "child-1",
				label: "looper",
				model: "glm-4-flash",
				status: "running",
				rounds: 2,
				startedAt: Date.now() - 1500,
			},
		])
		const row = projection.rows.find((r) => r.kind === "subagents")
		expect(row).toBeDefined()
		if (row?.kind === "subagents") {
			expect(row.key).toBe("subagents:live")
			expect(row.children).toHaveLength(1)
			expect(row.children[0]).toMatchObject({ id: "child-1", label: "looper", model: "glm-4-flash", status: "running" })
		}
		// Settled child replaces in place (same key, frozen elapsed).
		projection.applySubagentViews([
			{
				id: "child-1",
				label: "looper",
				status: "completed",
				rounds: 3,
				elapsedSec: 4.2,
			},
		])
		expect(projection.rows.filter((r) => r.kind === "subagents")).toHaveLength(1)
		const settled = projection.rows.find((r) => r.kind === "subagents")
		if (settled?.kind === "subagents") {
			expect(settled.children[0]).toMatchObject({ status: "completed", elapsedSec: 4.2 })
			expect(settled.children[0].startedAt).toBeUndefined()
		}
		// Empty roster drops the row.
		projection.applySubagentViews([])
		expect(projection.rows.some((r) => r.kind === "subagents")).toBe(false)
		unsub?.()
		dispose()
	})

	test("a seam without the subagent face renders no tree row", () => {
		const seam = new FakeSeam()
		const { projection, dispose } = setup(seam)
		// No emission ever arrives (no face wired) — the store holds no tree.
		expect(projection.rows.some((r) => r.kind === "subagents")).toBe(false)
		dispose()
	})
})
