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

function setup(seam: FakeSeam) {
	let dispose!: () => void
	const projection = createRoot((d) => {
		dispose = d
		return createSeamRows(seam, () => "s1")
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
			expect(await cb.onApprove("grep", {})).toBe(true)
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

	test("dependency direction: rebuilt transcript path uses the seam, not data/client", async () => {
		for (const file of ["seam-rows.ts", "transcript.tsx"]) {
			const source = await Bun.file(new URL(`../src/routes/session/${file}`, import.meta.url)).text()
			expect(source).not.toMatch(/context\/(data|client)/)
			expect(source).not.toMatch(/from "@opencode\/client"/)
			expect(source).not.toMatch(/from "@dsh-opentui\//)
		}
	})
})
