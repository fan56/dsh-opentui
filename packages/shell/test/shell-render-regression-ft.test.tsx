/**
 * Shell render regression battery (pilot/shell-render): width matrix, resize
 * reflow, empty state, dock hide (D5), error-row preservation. Same norms as
 * ./shell-render-smoke-ft.test.tsx — canned events through the REAL renderer,
 * normalized substring assertions, fixture time-budget waits only.
 *
 * Width/overflow discipline (opencode multi-width matrix): a prose row is
 * captured at every column count and (a) every fed token must survive the
 * wrap, (b) no painted line may exceed the terminal width (wrapMode="word"
 * must reflow, never spill). Resize cases run the same overflow guard after
 * narrow→wide and wide→narrow — a stale wide fragment would exceed the new
 * width and trip the guard.
 *
 * Scope guards (pilot verdict §7): no sustained streaming frames (upstream
 * diff-paint corruption), no whole-frame snapshots.
 */
import { describe, expect, test } from "bun:test"
import {
	createShellRenderFixture,
	turnEndErrorRecord,
	userMessageRecord,
} from "./shell-render-fixture.tsx"
import type { FakeTurnCallbacks } from "./shell-render-fixture.tsx"

/** Longest painted line in a normalized frame (ASCII content only, so
 * string length == display width; the fixture never feeds wide chars). */
function maxLineWidth(frame: string): number {
	return Math.max(...frame.split("\n").map((line) => line.length))
}

/** Prose long enough to reflow at every matrix width; tokens stay short so
 * wrapMode="word" never needs a mid-word break. */
const WRAP_PROSE =
	"wrap matrix alpha token sits beside bravo token and charlie token while filler words keep the paragraph long enough to bend at every column count"
const WRAP_TOKENS = ["alpha", "bravo", "charlie"]

describe("shell render regression battery (widths / resize / empty / dock-hide / error)", () => {
	// ------------------------------------------------------------------
	// 1. Width matrix — long-line wrap keeps content, never spills.
	// ------------------------------------------------------------------
	for (const width of [50, 80, 160]) {
		test(`width ${width}: wrapped prose keeps every token and stays inside the columns`, async () => {
			await using fixture = await createShellRenderFixture({
				width,
				height: 32,
				stored: [{ kind: "assistant", text: WRAP_PROSE, final: true }],
			})

			const frame = await fixture.waitForFrame((f) => f.includes("alpha"))
			for (const token of WRAP_TOKENS) {
				expect(frame).toContain(token)
			}
			// Negative norm: an unfed token must never appear at any width.
			expect(frame).not.toContain("unfed-token")
			// No horizontal overflow: every painted line fits the columns.
			expect(maxLineWidth(frame)).toBeLessThanOrEqual(width)
		})
	}

	// ------------------------------------------------------------------
	// 2. Resize reflow — content survives, no stale wide fragments.
	// ------------------------------------------------------------------
	test("resize narrow→wide→narrow reflows the transcript without losing content", async () => {
		await using fixture = await createShellRenderFixture({
			width: 60,
			height: 32,
			stored: [{ kind: "assistant", text: WRAP_PROSE, final: true }],
		})
		// Only "bravo token" spans a wrap edge at 60 columns when the prose
		// bends there; the exact break is renderer-owned, the TOKENS are the
		// contract. Sanity-check the narrow baseline first.
		const narrow = await fixture.waitForFrame((f) => f.includes("alpha"))
		expect(maxLineWidth(narrow)).toBeLessThanOrEqual(60)

		// Narrow → wide: content stays, lines may now run wider than 60 but
		// never past the new columns.
		fixture.resize(160, 32)
		const wide = await fixture.waitForFrame((f) => f.includes("bravo"))
		for (const token of WRAP_TOKENS) expect(wide).toContain(token)
		expect(maxLineWidth(wide)).toBeLessThanOrEqual(160)

		// Wide → narrow: the stale-wide-fragment guard — a leftover 160-wide
		// line would blow the 44-column budget. Tokens are SINGLE WORDS so a
		// wrap break between words can never mask content loss.
		fixture.resize(44, 32)
		const narrower = await fixture.waitForFrame((f) => f.includes("charlie"))
		for (const token of WRAP_TOKENS) expect(narrower).toContain(token)
		expect(maxLineWidth(narrower)).toBeLessThanOrEqual(44)
	})

	// ------------------------------------------------------------------
	// 3. Empty state — first frame is stable, no placeholder debris.
	// ------------------------------------------------------------------
	test("empty session renders a stable first frame with no placeholder debris", async () => {
		await using fixture = await createShellRenderFixture({ width: 80, height: 32 })
		await fixture.renderOnce()

		const first = fixture.captureFrame()
		const second = fixture.captureFrame()
		// Stable: two immediate captures agree byte-for-byte.
		expect(second).toBe(first)
		// No placeholder/error debris on the virgin frame.
		expect(first).not.toContain("undefined")
		expect(first).not.toContain("NaN")
		expect(first).not.toContain("error:")
		expect(first).not.toContain("loading")
	})

	// ------------------------------------------------------------------
	// 4. Dock hide (D5) — activity frame appears with a live turn, hides
	//    after the turn ends and the linger window expires.
	// ------------------------------------------------------------------
	test("dock activity frame appears during a turn and hides after end + linger", async () => {
		let releaseTool: (() => void) | undefined
		const toolParked = new Promise<void>((resolve) => {
			releaseTool = resolve
		})
		const script = async (cb: FakeTurnCallbacks) => {
			cb.onToolStart?.({ callId: "call-d5", name: "grep", args: "{}" })
			await toolParked
			cb.onToolRun?.({ callId: "call-d5", name: "grep", argsPretty: "{}", output: "ok", ok: true })
			cb.onContentDelta?.("d5 turn answer body")
		}

		await using fixture = await createShellRenderFixture({ turnScript: script })
		const pending = fixture.send("d5 probe")

		// Positive: the turn is live → the bordered activity frame is up.
		const live = await fixture.waitForFrame((f) => f.includes("activity"))
		expect(live).toContain("activity")
		expect(live).toContain("grep")

		releaseTool?.()
		await pending

		// D5: end of turn + 2s linger + 300ms sweep → the frame and every
		// settled dock line are hidden. Wait out the linger, then require a
		// frame WITHOUT the activity title.
		await new Promise((resolve) => setTimeout(resolve, 2800))
		const settled = await fixture.waitForFrame((f) => !f.includes("activity"), { timeoutMs: 8000 })
		expect(settled).not.toContain("activity")
	})

	// ------------------------------------------------------------------
	// 5. Error row — turn/end error is visible and never eats the prior
	//    transcript.
	// ------------------------------------------------------------------
	test("turn/end error row is visible and the stored transcript survives it", async () => {
		await using fixture = await createShellRenderFixture({
			width: 80,
			height: 32,
			stored: [
				{ kind: "user", text: "pre-error user question" },
				{ kind: "assistant", text: "pre-error assistant answer", final: true },
			],
		})
		const baseline = await fixture.waitForFrame((f) => f.includes("pre-error assistant answer"))
		expect(baseline).not.toContain("regression boom")

		fixture.journal(turnEndErrorRecord("regression boom"))
		const frame = await fixture.waitForFrame((f) => f.includes("regression boom"))
		// The error surfaced…
		expect(frame).toContain("regression boom")
		// …and the prior transcript is intact (not swallowed by the error).
		expect(frame).toContain("pre-error user question")
		expect(frame).toContain("pre-error assistant answer")
		// Negative norm: an unfed error message never appears.
		expect(frame).not.toContain("unfed failure")
	})

	test("a live-turn onError lands as an error row next to the user line", async () => {
		const script = async (cb: FakeTurnCallbacks) => {
			cb.onContentDelta?.("partial body before failure")
			cb.onError("live stream failure")
			cb.onTurnEnd()
		}
		await using fixture = await createShellRenderFixture({ turnScript: script, width: 80, height: 32 })
		await fixture.send("asked before the failure")

		const frame = await fixture.waitForFrame((f) => f.includes("live stream failure"))
		expect(frame).toContain("live stream failure")
		expect(frame).toContain("asked before the failure")
		// The failed turn's row reads as an error, not a silent ok body.
		expect(frame).toContain("error: live stream failure")
	})

	// Replay-path parity: the canned assistant record keeps tokens intact at
	// the smallest matrix width (guards the markdown paint of journal rows).
	test("replayed journal records survive the 50-column wrap", async () => {
		await using fixture = await createShellRenderFixture({ width: 50, height: 32 })
		fixture.journal(userMessageRecord("journal replay probe at narrow width"))
		const frame = await fixture.waitForFrame((f) => f.includes("journal replay probe"))
		expect(frame).toContain("journal replay probe")
		expect(frame).not.toContain("unfed-token")
		expect(maxLineWidth(frame)).toBeLessThanOrEqual(50)
	})
})
