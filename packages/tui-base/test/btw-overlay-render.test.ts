/**
 * Render-path pin for the /btw empty-answer placeholder (render-gap
 * adjudication): a settled slot whose answer is "" must paint the visible
 * `(empty answer)` marker, so "badge but no body" distinguishes H-B (the
 * pump settled with an empty answer) from H-A (the body arrived but the
 * diff-paint dropped the line). Mounted through @opentui/solid testRender
 * like widgets-dock-render.test.ts — no pure-function stand-in.
 */
import { describe, expect, test } from "bun:test"
import { createComponent, testRender } from "@opentui/solid"
import type { CapturedFrame, CapturedSpan } from "@opentui/core"
import { BtwController, BtwPanel, type BtwAskFn } from "../src/routes/session/btw-overlay"

const tick = () => new Promise((r) => setTimeout(r, 0))

/** Manually-settled ask: one parked call whose result the test controls. */
function deferredAsk(): { ask: BtwAskFn; resolve: (answer: string) => void } {
	const state: { resolve?: (answer: string) => void } = {}
	const ask: BtwAskFn = () => new Promise<string>((res) => (state.resolve = res))
	return { ask, resolve: (answer) => state.resolve!(answer) }
}

function frameText(frame: CapturedFrame): string {
	return frame.lines.flatMap((line: { spans: CapturedSpan[] }) => line.spans.map((span) => span.text)).join("\n")
}

async function renderPanel(controller: BtwController) {
	const setup = await testRender(() => createComponent(BtwPanel, { controller }), {
		width: 72,
		height: 20,
		useMouse: false,
	})
	await setup.renderOnce()
	return setup
}

describe("BtwPanel empty-answer placeholder (render gap adjudication)", () => {
	test("a settled slot with an empty answer paints the (empty answer) placeholder", async () => {
		const fake = deferredAsk()
		const btw = new BtwController({ ask: fake.ask, snapshot: async () => [] })
		btw.submit("q1")
		await tick()
		// Mounted while streaming, the pump settles EMPTY under it (the e2e
		// gap shape) — the LIVE repaint must show the placeholder. Under the
		// no-op server-build solid this frame flip cannot happen, so a pass
		// here also certifies real reactivity (the known bare-bun trap).
		const setup = await renderPanel(btw)
		try {
			expect(frameText(setup.captureSpans())).toContain("Thinking…")
			fake.resolve("") // H-B shape: settled with no text at all
			await tick()
			await setup.renderOnce()
			const text = frameText(setup.captureSpans())
			expect(text).toContain("(empty answer)")
			expect(text).toContain("q1")
			expect(text).not.toContain("Thinking…")
		} finally {
			await setup.dispose()
		}
	})

	test("a settled slot with a real answer paints the body, not the placeholder", async () => {
		const fake = deferredAsk()
		const btw = new BtwController({ ask: fake.ask, snapshot: async () => [] })
		btw.submit("q1")
		await tick()
		const setup = await renderPanel(btw)
		try {
			expect(frameText(setup.captureSpans())).toContain("Thinking…")
			fake.resolve("E2E-BTW-ANSWER-TWO — rollback is one command away.")
			await tick()
			await setup.renderOnce()
			const text = frameText(setup.captureSpans())
			expect(text).toContain("E2E-BTW-ANSWER-TWO — rollback is one command away.")
			expect(text).not.toContain("(empty answer)")
		} finally {
			await setup.dispose()
		}
	})

	test("streaming with no text yet still paints Thinking… (three states untouched)", async () => {
		const fake = deferredAsk()
		const btw = new BtwController({ ask: fake.ask, snapshot: async () => [] })
		btw.submit("q1")
		await tick()
		const setup = await renderPanel(btw)
		try {
			const text = frameText(setup.captureSpans())
			expect(text).toContain("Thinking…")
			expect(text).not.toContain("(empty answer)")
		} finally {
			await setup.dispose()
		}
	})

	test("no run and no last: the badge paints but the placeholder does not (§4 trap pinned)", async () => {
		// shown() === undefined paints the settled badge string on its own —
		// the placeholder must NOT ride along, or "badge" would again be
		// unreadable as "last() exists with an empty answer".
		const fake = deferredAsk()
		const btw = new BtwController({ ask: fake.ask, snapshot: async () => [] })
		btw.markVisible()
		const setup = await renderPanel(btw)
		try {
			const text = frameText(setup.captureSpans())
			expect(text).toContain("Not kept in the session")
			expect(text).toContain("no side question yet")
			expect(text).not.toContain("(empty answer)")
		} finally {
			await setup.dispose()
		}
	})
})
