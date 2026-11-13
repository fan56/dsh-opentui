/**
 * Shell render smoke (pilot/shell-render): the FIRST renderer-level tests in
 * packages/shell. Drives the canned-event fixture (./shell-render-fixture)
 * through the real shell render path — RemoteSessionSeam → seam-rows store →
 * Transcript + WidgetsDock on the real @opentui renderer — and asserts known
 * text reached the buffer via normalized captureCharFrame substrings (the
 * opencode norm; never whole-frame equality).
 *
 * Scope guards (pilot verdict §7): short-burst frames only — no sustained
 * streaming turn, so the upstream diff-paint corruption cannot poison the
 * assertions.
 *
 * SELF-PROOF OF THE FALSE-GREEN CANARY lives in
 * test/solid-reactivity-canary-ft.test.tsx (how to break the preload and the
 * expected red).
 */
import { describe, expect, test } from "bun:test"
import {
	assistantMessageRecord,
	createShellRenderFixture,
	turnEndErrorRecord,
	userMessageRecord,
} from "./shell-render-fixture.tsx"
import type { FakeTurnCallbacks } from "./shell-render-fixture.tsx"

describe("shell render fixture (real renderer, canned events)", () => {
	test("stored journal rows reach the transcript frame", async () => {
		await using fixture = await createShellRenderFixture({
			stored: [
				{ kind: "user", text: "stored user question" },
				{ kind: "assistant", text: "stored assistant answer", final: true },
			],
		})

		const frame = await fixture.waitForFrame(
			(f) => f.includes("stored user question") && f.includes("stored assistant answer"),
		)
		expect(frame).toContain("stored user question")
		expect(frame).toContain("stored assistant answer")
		// Negative norm: content never fed must never appear.
		expect(frame).not.toContain("never-rendered-token")
	})

	test("a canned journal record repaints the live frame (replay path)", async () => {
		await using fixture = await createShellRenderFixture()
		// No journal events yet: the record text must be absent.
		expect(fixture.captureFrame()).not.toContain("replayed user line")

		fixture.journal(userMessageRecord("replayed user line"))
		const frame = await fixture.waitForFrame((f) => f.includes("replayed user line"))
		expect(frame).toContain("replayed user line")

		fixture.journal(assistantMessageRecord("replayed assistant body"))
		await fixture.waitForFrame((f) => f.includes("replayed assistant body"))
		// The projection store holds what the frame paints.
		const assistant = fixture.projection.rows.find((row) => row.text === "replayed assistant body")
		expect(assistant?.kind).toBe("assistant")
	})

	test("a live scripted turn paints the dock tool line while running", async () => {
		// The turn script opens a tool and parks it RUNNING until the test
		// has observed the frame (the dock drops settled tool rows after the
		// fade window, so the assertion samples the running phase).
		let releaseTool: (() => void) | undefined
		const toolParked = new Promise<void>((resolve) => {
			releaseTool = resolve
		})
		const script = async (cb: FakeTurnCallbacks) => {
			cb.onToolStart?.({ callId: "call-1", name: "bash", args: "{}" })
			await toolParked
			cb.onToolRun?.({ callId: "call-1", name: "bash", argsPretty: "{}", output: "ok", ok: true })
			cb.onContentDelta?.("turn answer body")
		}

		await using fixture = await createShellRenderFixture({ turnScript: script })
		const pending = fixture.send("run the tool")

		const frame = await fixture.waitForFrame((f) => f.includes("bash"))
		expect(frame).toContain("bash")
		expect(fixture.projection.rows.some((row) => row.kind === "tool" && row.status === "running")).toBe(true)

		releaseTool?.()
		await pending

		// Settle converge: the turn end converges the assistant row to the
		// durable body (storedTranscript) — here the canned stored rows.
		await fixture.waitForVisualIdle({ quietFrames: 2 })
		expect(fixture.captureFrame()).toContain("bash")
	})

	test("a turn/end error journal record lands as an error row", async () => {
		await using fixture = await createShellRenderFixture()
		fixture.journal(turnEndErrorRecord("the turn exploded"))

		await fixture.waitForFrame((f) => f.includes("the turn exploded"))
		const errorRow = fixture.projection.rows.find((row) => row.text.includes("the turn exploded"))
		expect(errorRow).toBeDefined()
		expect(errorRow?.key.startsWith("error")).toBe(true)
	})
})
