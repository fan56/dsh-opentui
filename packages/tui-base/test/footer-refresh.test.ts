/**
 * First-turn footer fix: the 💬 count is authoritative from sessionInfo(),
 * which is undefined until the first turn binds the live session id. These
 * tests pin the one-shot re-read guard (unknown window + delta/tool burst
 * collapse), the settle/release semantics (success, race-undefined, rejection)
 * and the retry throttle — without booting the page/harness.
 */
import { describe, expect, test } from "bun:test"
import { bundledLocalesDir, loadLocales, setLanguages } from "@dsh-opentui/i18n"
import {
	FOOTER_PROBE_MAX_ATTEMPTS,
	FOOTER_PROBE_MIN_INTERVAL_MS,
	initialFooterProbeState,
	markFooterProbeStarted,
	settleFooterProbe,
	shouldRefreshFooter,
	shouldStartFooterProbe,
	type FooterRemoteInfo,
	type FooterProbeState,
} from "../src/routes/session/footer-refresh"
import { sessionFooterSegments } from "../src/routes/session/powerline"

// The 💬 label rides the i18n registry (t() fail-open → bare key otherwise).
setLanguages(loadLocales({ bundledDir: bundledLocalesDir() }).languages)

describe("shouldRefreshFooter (first-turn one-shot re-read guard)", () => {
	test("unknown count + bound session id + no probe in flight → probe", () => {
		expect(shouldRefreshFooter(undefined, "session-1", false)).toBe(true)
	})

	test("no live id yet → no probe (the read would answer undefined again)", () => {
		expect(shouldRefreshFooter(undefined, undefined, false)).toBe(false)
	})

	test("a probe already in flight collapses the same-turn event burst", () => {
		expect(shouldRefreshFooter(undefined, "session-1", true)).toBe(false)
	})

	test("a known count (including an explicit 0) → no re-probe (idempotent)", () => {
		expect(shouldRefreshFooter({ messageCount: 0 }, "session-1", false)).toBe(false)
		expect(shouldRefreshFooter({ messageCount: 3 }, "session-1", false)).toBe(false)
	})
})

const SESSION = "session-1"
/** Run one probe attempt at time `now`, returning the post-settle state. */
function attempt(
	remoteInfo: FooterRemoteInfo | undefined,
	state: FooterProbeState,
	now: number,
	infoObtained: boolean,
): { started: boolean; state: FooterProbeState } {
	if (!shouldStartFooterProbe(remoteInfo, SESSION, state, now)) return { started: false, state }
	const started = markFooterProbeStarted(state, now)
	return { started: true, state: settleFooterProbe(started, infoObtained) }
}

describe("first-turn probe settle (in-flight MUST be released)", () => {
	test("fresh state is idle and never attempted", () => {
		expect(initialFooterProbeState()).toEqual({ inFlight: false, attempts: 0, lastAttemptAt: 0 })
	})

	test("successful read releases in-flight AND clears the budget", () => {
		const started = markFooterProbeStarted(initialFooterProbeState(), 1000)
		expect(started.inFlight).toBe(true)
		const settled = settleFooterProbe(started, true)
		expect(settled.inFlight).toBe(false)
		expect(settled).toEqual(initialFooterProbeState())
	})

	test("sessionInfo() answered undefined (bound id, info race) releases in-flight too", () => {
		const started = markFooterProbeStarted(initialFooterProbeState(), 1000)
		// infoObtained=false is exactly the `!info` arm of sessionInfo().then().
		const settled = settleFooterProbe(started, false)
		expect(settled.inFlight).toBe(false)
		// The count stays unknown, so the NEXT delta can retry — the guard is
		// what must not strand; the throttle is handled below.
		expect(shouldRefreshFooter(undefined, SESSION, settled.inFlight)).toBe(true)
	})

	test("a rejecting sessionInfo() releases in-flight too", () => {
		const started = markFooterProbeStarted(initialFooterProbeState(), 1000)
		// The .catch() arm calls onSettled(false) — same settle semantics.
		const settled = settleFooterProbe(started, false)
		expect(settled.inFlight).toBe(false)
		expect(shouldStartFooterProbe(undefined, SESSION, settled, 1000 + FOOTER_PROBE_MIN_INTERVAL_MS)).toBe(true)
	})
})

describe("first-turn probe throttle (no sessionInfo() per delta)", () => {
	test("a failed probe's guard is released but the immediate next delta is throttled", () => {
		const first = attempt(undefined, initialFooterProbeState(), 1000, false)
		expect(first.started).toBe(true)
		// Same turn, next token 10ms later: guard is free, but spacing blocks it.
		const second = attempt(undefined, first.state, 1010, false)
		expect(second.started).toBe(false)
		expect(second.state).toEqual(first.state)
	})

	test("after the retry interval a failed probe may try again", () => {
		const first = attempt(undefined, initialFooterProbeState(), 1000, false)
		const retry = attempt(undefined, first.state, 1000 + FOOTER_PROBE_MIN_INTERVAL_MS, true)
		expect(retry.started).toBe(true)
		// Success clears the budget entirely.
		expect(retry.state).toEqual(initialFooterProbeState())
	})

	test("attempts are capped within a turn until the budget is reset", () => {
		let state = initialFooterProbeState()
		let now = 1000
		let started = 0
		for (let i = 0; i < FOOTER_PROBE_MAX_ATTEMPTS + 2; i++) {
			const r = attempt(undefined, state, now, false) // all fail (race)
			if (r.started) started++
			state = r.state
			now += FOOTER_PROBE_MIN_INTERVAL_MS
		}
		expect(started).toBe(FOOTER_PROBE_MAX_ATTEMPTS)
		// A turn boundary / session switch resets the budget, enabling a retry.
		const reset = attempt(undefined, initialFooterProbeState(), now, true)
		expect(reset.started).toBe(true)
	})

	test("while in flight, deltas collapse to a single probe regardless of time", () => {
		const started = markFooterProbeStarted(initialFooterProbeState(), 1000)
		expect(shouldStartFooterProbe(undefined, SESSION, started, 9999)).toBe(false)
	})
})

test("first-turn transition: unknown count hides 💬; one re-read paints the msg readout", () => {
	let remote: FooterRemoteInfo | undefined
	let state = initialFooterProbeState()

	// Mount paint: count unknown → the segment is absent.
	expect(sessionFooterSegments({ msg: remote?.msgCount }).some((s) => s.text.startsWith("💬"))).toBe(false)

	// First streamed delta → exactly one probe is allowed.
	expect(shouldStartFooterProbe(remote, SESSION, state, 1000)).toBe(true)
	state = markFooterProbeStarted(state, 1000)

	// More deltas in the same turn → collapsed while the probe is in flight.
	expect(shouldStartFooterProbe(remote, SESSION, state, 1010)).toBe(false)

	// The re-read lands → the guard releases and the segment appears.
	state = settleFooterProbe(state, true)
	expect(state.inFlight).toBe(false)
	remote = { messageCount: 11, msgCount: 9 }
	expect(sessionFooterSegments({ msg: remote.msgCount }).some((s) => s.text === "💬 9 msgs")).toBe(true)
})
