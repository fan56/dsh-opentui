import { describe, expect, test } from "bun:test"
import { NullSessionSeam, type SeamSessionEvent, type SessionSeam } from "../src/seams/session"

describe("SessionSeam", () => {
	test("NullSessionSeam satisfies the interface and resolves empty reads", async () => {
		const seam: SessionSeam = new NullSessionSeam()
		expect(await seam.listSessions()).toEqual([])
		expect(await seam.storedTranscript("s1")).toEqual([])
		expect(await seam.searchSessions("x")).toEqual([])
		expect(seam.currentSessionId()).toBeUndefined()
		expect(seam.status()).toEqual({ connection: "disconnected", turn: "idle", sessionAttached: false })
		await expect(seam.turn("hi", {
			onThinkingDelta: () => {},
			onContentDelta: () => {},
			onApprove: async () => true,
			onError: () => {},
		})).resolves.toBeUndefined()
		await seam.dispose()
	})

	test("event listeners subscribe, receive, and unsubscribe", async () => {
		const seam = new NullSessionSeam()
		const seen: SeamSessionEvent[] = []
		const off = seam.onSessionEvent((event) => seen.push(event))
		seam.emit({ type: "session.updated", details: { id: "s1" } })
		expect(seen).toEqual([{ type: "session.updated", details: { id: "s1" } }])
		off()
		seam.emit({ type: "session.updated", details: { id: "s2" } })
		expect(seen).toHaveLength(1)
		expect(seam.listeners).toHaveLength(0)
	})

	test("dependency direction: seam module imports nothing outside the package", async () => {
		const source = await Bun.file(new URL("../src/seams/session.ts", import.meta.url)).text()
		expect(source).not.toMatch(/from "@dsh-opentui\//)
		expect(source).not.toMatch(/from "\.\.\/\.\./)
	})
})
