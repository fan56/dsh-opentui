/**
 * Shared journal projector tests — migrated from session-seam-adapter.test.ts
 * in S6 Commit2 (clause 1): `projectJournalRecord` moved to journal-projection.ts
 * so the bridge path survives the legacy thin-client seam deletion. These 5
 * tests are the projector's generic-semantics coverage (A.5: migrated, not
 * retired); assertions are unchanged verbatim.
 */
import { describe, expect, test } from "bun:test"
import { projectJournalRecord } from "../src/client/journal-projection.ts"

describe("event feed (seam-rows payload contract) — shared projector", () => {
	test("projectJournalRecord: user/message → message.updated {id, role, text, sessionID}", () => {
		const events = projectJournalRecord(
			{ type: "user/message", seq: 3, time: 0, data: { messageID: "m-3", content: [{ type: "text", text: "hello" }] } },
			"ses-live",
		)
		expect(events).toEqual([{ type: "message.updated", details: { id: "m-3", role: "user", text: "hello", sessionID: "ses-live" } }])
	})

	test("D5: host-injected user/message sources never paint as ❯; relay notices paint as notice rows", () => {
		const rec = (kind: string, text: string) =>
			projectJournalRecord(
				{ type: "user/message", seq: 9, time: 0, data: { messageID: "m-9", source: { kind, form: "context" }, content: [{ type: "text", text }] } },
				"ses-live",
			)
		expect(rec("runtime-context", "Current runtime context. This snapshot supersedes…")).toEqual([])
		expect(rec("tool-registry", "You are repeating the exact same tool call")).toEqual([])
		expect(rec("system-prompt", "sys")).toEqual([])
		expect(rec("user", "hi")).toEqual([{ type: "message.updated", details: { id: "m-9", role: "user", text: "hi", sessionID: "ses-live" } }])
		expect(rec("subagent-settled", "Background subagent sa_1 finished. **阻塞点**")).toEqual([
			{ type: "message.updated", details: { id: "m-9", role: "notice", text: "Background subagent sa_1 finished. **阻塞点**", sessionID: "ses-live" } },
		])
	})

	test("D5b: a multi-block notice joins its blocks on a newline (no `finished.It`)", () => {
		const events = projectJournalRecord(
			{
				type: "user/message",
				seq: 27,
				time: 0,
				data: {
					messageID: "m-27",
					source: { kind: "subagent-settled" },
					content: [
						{ type: "text", text: "Background subagent sa_1 was stopped before it finished." },
						{ type: "text", text: "It left no closing message." },
					],
				},
			},
			"ses-live",
		)
		expect(events[0]?.details).toMatchObject({
			role: "notice",
			text: "Background subagent sa_1 was stopped before it finished.\nIt left no closing message.",
		})
	})

	test("projectJournalRecord: assistant/message → message.part.updated with a text part", () => {
		const events = projectJournalRecord(
			{ type: "assistant/message", seq: 4, time: 0, data: { messageID: "m-4", text: "answer" } },
			"ses-live",
		)
		expect(events).toEqual([
			{
				type: "message.part.updated",
				details: { messageID: "m-4", sessionID: "ses-live", part: { type: "text", id: "m-4:text", text: "answer" } },
			},
		])
	})

	test("projectJournalRecord: turn/end error → session.error; clean turn/end and tool records → none", () => {
		const error = projectJournalRecord(
			{ type: "turn/end", seq: 5, time: 0, data: { reason: { kind: "error", error: { message: "boom" } } } },
			"ses-live",
		)
		expect(error).toEqual([{ type: "session.error", details: { message: "boom", sessionID: "ses-live" } }])
		expect(projectJournalRecord({ type: "turn/end", seq: 6, time: 0, data: {} }, "ses-live")).toEqual([])
		expect(projectJournalRecord({ type: "tool/call", seq: 7, time: 0, data: { name: "bash" } }, "s")).toEqual([])
	})
})
