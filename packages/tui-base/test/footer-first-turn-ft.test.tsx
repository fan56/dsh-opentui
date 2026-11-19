/**
 * Render-path coverage for the first-turn footer fix: the first STREAMED delta
 * of a turn (onThinkingDelta / onContentDelta) must drive the one-shot
 * authoritative 💬 re-read and paint `💬 N msgs` in the LIVE footer frame while
 * the turn is STILL OPEN — not after turn end. Mounts the real PowerlineFooter
 * through @opentui/solid testRender (not a pure-function stand-in), with a
 * getter-fed `left` like the page uses, and drives the probe through the SAME
 * pure helpers v2-entry.tsx uses (footer-refresh.ts).
 *
 * Boundary of this test: it does not mount V2SessionPage itself. That entry is
 * @ts-nocheck, boots a real renderer, and has no headless page harness (the
 * shell fixture mounts only Transcript + WidgetsDock, no footer/remoteInfo
 * chain) — the one untested seam is the two-line `seam.turn` wrapper that calls
 * `refreshFooterIfUnknown()` on the first delta. Everything downstream of that
 * call — the probe guard, the settle/release, the footer repaint — is driven
 * here for real.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { createComponent, testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { CapturedFrame, CapturedSpan } from "@opentui/core"
import { bundledLocalesDir, loadLocales, setLanguages } from "@dsh-opentui/i18n"
import {
	FOOTER_PROBE_MIN_INTERVAL_MS,
	initialFooterProbeState,
	markFooterProbeStarted,
	settleFooterProbe,
	shouldStartFooterProbe,
	type FooterProbeState,
	type FooterRemoteInfo,
} from "../src/routes/session/footer-refresh"
import { PowerlineFooter, sessionFooterSegments } from "../src/routes/session/powerline"

beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages)
})
afterAll(() => setLanguages(new Map()))

const tick = async () => {
	await Promise.resolve()
	await new Promise((r) => setTimeout(r, 0))
}
const frameText = (frame: CapturedFrame): string =>
	frame.lines.flatMap((line: { spans: CapturedSpan[] }) => line.spans.map((span) => span.text)).join("")

/** Minimal in-turn probe harness mirroring v2-entry's refreshFooterIfUnknown. */
function createProbeHarness() {
	const [remoteInfo, setRemoteInfo] = createSignal<FooterRemoteInfo | undefined>()
	let liveSessionId: string | undefined
	let serverMsgs: number | undefined
	let sessionInfoCalls = 0
	let turnEndRefreshes = 0
	let deltas = 0
	let probe: FooterProbeState = initialFooterProbeState()
	let clock = 1_000

	const sessionInfo = async () => {
		sessionInfoCalls++
		// The real adapter answers undefined until the turn binds the live id.
		if (liveSessionId === undefined || serverMsgs === undefined) return undefined
		return { messageCount: serverMsgs, msgCount: serverMsgs }
	}
	const refreshFooterData = async (onSettled?: (infoObtained: boolean) => void) => {
		const info = await sessionInfo()
		onSettled?.(!!info)
		setRemoteInfo(info ? { msgCount: info.msgCount } : undefined)
	}
	/** The exact shape of v2-entry's refreshFooterIfUnknown(). */
	const refreshFooterIfUnknown = () => {
		const now = clock
		if (!shouldStartFooterProbe(remoteInfo(), liveSessionId, probe, now)) return
		probe = markFooterProbeStarted(probe, now)
		void refreshFooterData((ok) => {
			probe = settleFooterProbe(probe, ok)
		})
	}
	const firstDelta = () => {
		deltas++
		refreshFooterIfUnknown()
	}
	const turnEnd = () => {
		// v2-entry's turn-end effect resets the budget and refreshes unconditionally.
		probe = initialFooterProbeState()
		turnEndRefreshes++
		void refreshFooterData()
	}
	return {
		remoteInfo,
		bind(id: string) {
			liveSessionId = id
		},
		setMsgCount(msg: number) {
			serverMsgs = msg
		},
		firstDelta,
		turnEnd,
		advance(ms: number) {
			clock += ms
		},
		stats: () => ({ sessionInfoCalls, turnEndRefreshes, deltas, probe }),
	}
}

async function mountFooter(remoteInfo: () => FooterRemoteInfo | undefined) {
	const setup = await testRender(
		() =>
			createComponent(PowerlineFooter, {
				get left() {
					return sessionFooterSegments({ provider: "p", model: "m", msg: remoteInfo()?.msgCount })
				},
				right: "12:00:00",
			}),
		{ width: 90, height: 6, useMouse: false },
	)
	await setup.renderOnce()
	return setup
}

describe("first-turn 💬 segment (real footer frame, in-turn delta trigger)", () => {
	test("first delta paints 💬 N msgs while the turn is still open (no turn-end refresh)", async () => {
		const h = createProbeHarness()
		const setup = await mountFooter(h.remoteInfo)
		try {
			expect(frameText(setup.captureSpans())).not.toContain("💬")

			// The turn opens and binds the live id. No turn-end has happened, and
			// binding the id alone must NOT paint the count (that was the bug).
			h.bind("session-1")
			h.setMsgCount(9)
			await tick()
			await setup.renderOnce()
			expect(frameText(setup.captureSpans())).not.toContain("💬")

			// First streamed delta (onContentDelta / onThinkingDelta) fires INSIDE
			// the open turn → probe → authoritative count → footer repaint.
			h.firstDelta()
			await tick()
			await setup.renderOnce()
			expect(frameText(setup.captureSpans())).toContain("💬 9 msgs")
			expect(h.stats().turnEndRefreshes).toBe(0) // genuinely turn-internal

			// Subsequent deltas in the same turn collapse: no extra sessionInfo().
			h.firstDelta()
			h.firstDelta()
			await tick()
			expect(h.stats().sessionInfoCalls).toBe(1)
		} finally {
			await setup.dispose()
		}
	})

	test("a failed (undefined) probe releases the guard so a later delta retries and paints", async () => {
		const h = createProbeHarness()
		const setup = await mountFooter(h.remoteInfo)
		try {
			// Turn binds the id, but the first delta lands in the sessionInfo()/id
			// race window: the count has not landed yet, so the answer is undefined.
			h.bind("session-1")
			h.firstDelta()
			await tick()
			await setup.renderOnce()
			expect(frameText(setup.captureSpans())).not.toContain("💬")
			expect(h.stats().probe.inFlight).toBe(false) // guard released, not stranded

			// Immediate retry is throttled (no sessionInfo() per delta)…
			h.firstDelta()
			await tick()
			expect(h.stats().sessionInfoCalls).toBe(1)

			// …but after the retry interval a delta can try again and paint
			// (the snapshot has landed by now).
			h.setMsgCount(12)
			h.advance(FOOTER_PROBE_MIN_INTERVAL_MS)
			h.firstDelta()
			await tick()
			await setup.renderOnce()
			expect(frameText(setup.captureSpans())).toContain("💬 12 msgs")
		} finally {
			await setup.dispose()
		}
	})
})
