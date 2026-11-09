import { describe, expect, test } from "bun:test"
import { ComposerController, ComposerHistory, MAX_HISTORY_ENTRIES } from "../src/routes/session/composer-state"

function deferred() {
	let resolve!: () => void
	let reject!: (error: unknown) => void
	const promise = new Promise<void>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

function setup() {
	const sent: string[] = []
	const steered: string[] = []
	const busy: boolean[] = []
	let turn = deferred()
	const controller = new ComposerController({
		send: (text) => {
			sent.push(text)
			turn = deferred()
			return turn.promise
		},
		steer: (text) => steered.push(text),
		onBusyChange: (value) => busy.push(value),
	})
	return { controller, sent, steered, busy, turn: () => turn }
}

describe("composer submit → send wiring", () => {
	test("idle submit trims and sends once; empty/blank is ignored", () => {
		const { controller, sent } = setup()
		expect(controller.submit("   ")).toBe("ignored")
		expect(controller.submit("")).toBe("ignored")
		expect(controller.submit("  hello  ")).toBe("sent")
		expect(sent).toEqual(["hello"])
	})

	test("multi-line text is sent intact (alt+enter newlines survive)", () => {
		const { controller, sent } = setup()
		controller.submit("line one\nline two")
		expect(sent).toEqual(["line one\nline two"])
	})
})

describe("composer busy gating (vendored: busy submit routes as steer)", () => {
	test("submit while a turn runs steers instead of starting a turn", async () => {
		const { controller, sent, steered, busy, turn } = setup()
		controller.submit("first")
		expect(controller.busy).toBe(true)
		expect(controller.submit("keep it short")).toBe("steered")
		expect(sent).toEqual(["first"])
		expect(steered).toEqual(["keep it short"])
		turn().resolve()
		await controller.turn
		expect(controller.busy).toBe(false)
		expect(busy).toEqual([true, false])
		expect(controller.submit("second")).toBe("sent")
		expect(sent).toEqual(["first", "second"])
	})

	test("a rejected turn still clears busy", async () => {
		const { controller, turn } = setup()
		controller.submit("boom")
		turn().reject(new Error("x"))
		await controller.turn
		expect(controller.busy).toBe(false)
	})
})

describe("composer history recall (shell-style, pi editor navigateHistory parity)", () => {
	test("↑ walks newest → oldest from an empty draft; ↓ returns to the draft and stops", () => {
		const history = new ComposerHistory()
		history.append("a")
		history.append("b")
		history.append("c")
		expect(history.browsing).toBe(false)
		expect(history.move(-1, "")?.text).toBe("c")
		expect(history.browsing).toBe(true)
		expect(history.move(-1, "c")?.text).toBe("b")
		expect(history.move(-1, "b")?.text).toBe("a")
		expect(history.move(-1, "a")).toBeUndefined() // past oldest: stop, no wrap
		expect(history.move(1, "a")?.text).toBe("b")
		expect(history.move(1, "b")?.text).toBe("c")
		expect(history.move(1, "c")?.text).toBe("") // back to the (empty) draft slot
		expect(history.browsing).toBe(false)
		expect(history.move(1, "")).toBeUndefined() // nothing newer than the draft
	})

	test("a typed draft is stashed on the first ↑ and restored on ↓ past the newest", () => {
		const history = new ComposerHistory()
		history.append("a")
		history.append("b")
		expect(history.move(-1, "my draft")?.text).toBe("b")
		expect(history.move(-1, "b")?.text).toBe("a")
		expect(history.move(1, "a")?.text).toBe("b")
		expect(history.move(1, "b")?.text).toBe("my draft") // the draft, not ""
		expect(history.browsing).toBe(false)
	})

	test("the draft cursor rides along: stashed on the first ↑, restored with the draft", () => {
		const history = new ComposerHistory()
		history.append("a")
		history.append("b")
		const draft = "line one\nline two"
		const cursor = "line one\nli".length // mid second line, not the end
		// First ↑: committed entry lands at its start (cursor 0), Draft stashed whole.
		expect(history.move(-1, draft, cursor)).toEqual({ text: "b", cursor: 0 })
		// Committed entries leave the cursor to the caller (0 for ↑ / end for ↓).
		expect(history.move(-1, "b")).toEqual({ text: "a" })
		expect(history.move(1, "a")).toEqual({ text: "b" })
		// Past the newest: the draft comes back with the exact original cursor.
		expect(history.move(1, "b")).toEqual({ text: draft, cursor })
	})

	test("a multi-line draft round-trips intact through the walk", () => {
		const history = new ComposerHistory()
		history.append("old")
		const draft = "line one\nline two\nline three"
		expect(history.move(-1, draft)?.text).toBe("old")
		expect(history.move(-1, "old")).toBeUndefined()
		expect(history.move(1, "old")?.text).toBe(draft)
	})

	test("editing a recalled entry keeps walking; the stashed draft still wins on ↓", () => {
		const history = new ComposerHistory()
		history.append("a")
		history.append("b")
		expect(history.move(-1, "draft")?.text).toBe("b")
		expect(history.move(-1, "b edited")?.text).toBe("a") // browsing ignores buffer edits
		expect(history.move(1, "a")?.text).toBe("b")
		expect(history.move(1, "b")?.text).toBe("draft")
	})

	test("the draft slot is per walk: a new submit resets it", () => {
		const history = new ComposerHistory()
		history.append("a")
		expect(history.move(-1, "draft")?.text).toBe("a")
		history.append("c") // submit resets the walk + stash
		expect(history.browsing).toBe(false)
		expect(history.move(-1, "")?.text).toBe("c")
		expect(history.move(1, "c")?.text).toBe("") // a fresh empty draft, not "draft"
	})

	test("empty history recalls nothing; duplicates collapse; cap is enforced", () => {
		const history = new ComposerHistory()
		expect(history.move(-1, "")).toBeUndefined()
		history.append("same")
		history.append("same")
		expect(history.size).toBe(1)
		for (let i = 0; i < MAX_HISTORY_ENTRIES + 5; i++) history.append(`p${i}`)
		expect(history.size).toBe(MAX_HISTORY_ENTRIES)
		expect(history.move(-1, "")?.text).toBe(`p${MAX_HISTORY_ENTRIES + 4}`)
	})

	test("submits (sent and steered) commit to history and reset the walk", async () => {
		const { controller, turn } = setup()
		controller.submit("first")
		controller.submit("steer line")
		turn().resolve()
		await controller.turn
		expect(controller.history.move(-1, "")?.text).toBe("steer line")
		expect(controller.history.move(-1, "steer line")?.text).toBe("first")
		controller.submit("third")
		// append resets the walk to the draft slot
		expect(controller.history.move(-1, "")?.text).toBe("third")
	})
})

describe("composer dependency direction", () => {
	test("rebuilt composer path uses the seam, not the vendored data/client contexts", async () => {
		for (const file of ["session-composer.tsx", "composer-state.ts"]) {
			const source = await Bun.file(new URL(`../src/routes/session/${file}`, import.meta.url)).text()
			// The optional Keymap context is allowed (history recall must outrank
			// the managed textarea cursor layer — see session-composer's module
			// comment); the vendored data/client contexts stay forbidden.
			expect(source).not.toMatch(/context\/(data|client)/)
			expect(source).not.toMatch(/from "@opencode\/client"/)
			expect(source).not.toMatch(/from "@dsh-opentui\//)
		}
	})
})
