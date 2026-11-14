/**
 * Incident-mapped renderer regressions, data/row class (pilot/shell-render).
 * Two incidents, each with a positive + negative case; the mapping source is
 * research/oldfox-reuse-verdict.md §3 and the corresponding chapters of
 * research/opencode-test-cases-ui.md / -core.md.
 *
 * ── Incident 1: wake-turn line joining (拼行) ────────────────────────────
 * A new turn's first line was once JOINED onto the previous turn's last
 * line (the upstream trailingNewline ownership bug). opencode counterpart:
 * packages/tui/test/mini/scrollback.surface.test.ts trailingNewline asserts
 * (research/opencode-test-cases-ui.md "Streaming scrollback surface") —
 * their externalOutputQueue does not exist in our @opentui 0.8.1, so per
 * the verdict the assertion adapts to captureCharFrame line-exact checks on
 * consecutive journal renders.
 *
 * ── Incident 4: transcript read failure treated as empty array ───────────
 * A failed session read was swallowed into [] and the transcript "vanished"
 * (research/oldfox-reuse-verdict.md §3; opencode counterpart:
 * packages/core/test/config/config.test.ts "ignores an invalid file while
 * loading valid config values" — research/opencode-test-cases-core.md §6,
 * read failure must not be treated as empty data).
 *
 * Behavior verdict 2026-11-14: both halves FIXED (seam-rows load(): a failed
 * read never clears hydrated rows, and a first read settles a visible
 * synthetic `error: …` row instead of a silent empty transcript).
 *
 * Fixture: ./shell-render-fixture.tsx (canned events + time-budget
 * waitForFrame). Scope guards: short-burst frames only — no sustained
 * streaming turn (upstream diff-paint corruption must not poison asserts).
 */
import { describe, expect, spyOn, test } from "bun:test"
import {
	assistantMessageRecord,
	createShellRenderFixture,
	userMessageRecord,
} from "./shell-render-fixture.tsx"

describe("incident regressions: row continuity (real renderer, canned events)", () => {
	// -------------------------------------------------------------------
	// Incident 1 — wake-turn line joining (positive case)
	// -------------------------------------------------------------------
	test("a new turn's first line stays on its own line (no wake-turn joining)", async () => {
		await using fixture = await createShellRenderFixture()

		// Turn 1: user question + assistant answer, then wake turn 2.
		fixture.journal(userMessageRecord("first question"))
		fixture.journal(assistantMessageRecord("first answer"))
		await fixture.waitForFrame((f) => f.includes("first answer"))

		// Negative norm BEFORE the wake turn: the second question is absent.
		expect(fixture.captureFrame()).not.toContain("second question")

		fixture.journal(userMessageRecord("second question"))
		const frame = await fixture.waitForFrame((f) => f.includes("second question"))

		// Line-exact (the adapted trailingNewline assert): the wake turn's
		// first line must NOT be glued onto turn 1's last line.
		const lines = frame.split("\n")
		const answerLine = lines.find((line) => line.includes("first answer"))
		const questionLine = lines.find((line) => line.includes("second question"))
		expect(answerLine).toBeDefined()
		expect(questionLine).toBeDefined()
		expect(answerLine).not.toBe(questionLine)
		expect(answerLine).not.toContain("second question")
		expect(questionLine).not.toContain("first answer")
	})

	// Harness-sensitivity negative: the detector above can only fire when the
	// frame really does keep separate texts on separate lines — prove the
	// line-level capture distinguishes adjacent lines at all.
	test("harness sanity: multi-line row content lands on distinct frame lines", async () => {
		await using fixture = await createShellRenderFixture()

		fixture.journal(assistantMessageRecord("answer alpha\nanswer beta"))
		const frame = await fixture.waitForFrame((f) => f.includes("answer alpha") && f.includes("answer beta"))

		const lines = frame.split("\n")
		const alphaLine = lines.find((line) => line.includes("answer alpha"))
		const betaLine = lines.find((line) => line.includes("answer beta"))
		expect(alphaLine).toBeDefined()
		expect(betaLine).toBeDefined()
		expect(alphaLine).not.toBe(betaLine)
	})

	// -------------------------------------------------------------------
	// Incident 4 — read failure ≠ empty data (the FIXED half: positive case)
	// -------------------------------------------------------------------
	test("a failed transcript read never wipes rows already on screen", async () => {
		const warn = spyOn(console, "warn")
		try {
			await using fixture = await createShellRenderFixture({
				stored: [{ kind: "assistant", text: "durable body line", final: true }],
			})
			await fixture.waitForFrame((f) => f.includes("durable body line"))

			// Inject the failure at the fake-session boundary, then reload.
			fixture.session.storedTranscript = async () => {
				throw new Error("host exploded mid-read")
			}
			await fixture.projection.load()

			// No crash, and the transcript-loss rule holds: the failed read
			// must NOT hydrate [] over the visible rows.
			const frame = fixture.captureFrame()
			expect(frame).toContain("durable body line")

			// The ONLY signal today is the warned line (documented fact; the
			// visible-signal gap is the gated test below).
			expect(warn.mock.calls.some((call) => String(call[0]).includes("transcript read failed"))).toBe(true)
		} finally {
			warn.mockRestore()
		}
	})

	// Incident 4 — the CLOSED half (fixed 2026-11-14, seam-rows load() catch):
	// a first-read failure now settles a visible synthetic `error: …` row
	// (the session.error / turn-error assistant-row form) instead of a silent
	// empty transcript. Was the desired-behavior test gated behind
	// DSH_TEST_READ_SIGNAL=1 (red against the old product); always-on now
	// that the product matches the contract.
	test(
		"a first-read failure shows a visible error signal, not a silent blank",
		async () => {
			const warn = spyOn(console, "warn")
			try {
				await using fixture = await createShellRenderFixture({
					storedFailure: new Error("journal unreadable at first read"),
				})

				// Whatever the exact wording, the user must SEE that the
				// transcript failed to load — never a silent blank.
				const frame = await fixture.waitForFrame((f) => /unreadable|failed|error/i.test(f), {
					timeoutMs: 2000,
				})
				expect(frame).toMatch(/unreadable|failed|error/i)
				expect(warn.mock.calls.some((call) => String(call[0]).includes("transcript read failed"))).toBe(true)
			} finally {
				warn.mockRestore()
			}
		},
	)
})
