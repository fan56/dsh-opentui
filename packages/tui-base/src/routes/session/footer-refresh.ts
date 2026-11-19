/**
 * One-shot guard for the footer's authoritative 💬 message-count re-read.
 *
 * The count is only authoritative once a session id is bound: the adapter's
 * `sessionInfo()` returns undefined until the first turn binds the live id
 * (a resumed session already has a staged id). At mount of a brand-new
 * session the count is therefore unknown, and the normal turn-end refresh is
 * gated off by `turnBusy()` for the whole first turn — the segment stays
 * hidden until the turn ends. A durable first-turn trigger proves the id is
 * bound, so it can perform ONE re-read during the turn.
 *
 * The trigger is the first STREAMED delta of the turn (thinking/content), not
 * a journal message event: the real adapter drops journal projections for the
 * whole turn await (`session-seam-adapter.ts:771 if (this.#turnInFlight)
 * return`, no buffer/replay), whereas the delta callbacks fire while the turn
 * is in flight (`shell/src/agent/loop.ts:198/202`, passed through the adapter
 * at `:344-345`). A settled tool run (`onToolRun`) is the earlier, tool-path
 * trigger and is kept as a double guard. The guard collapses the delta burst
 * into a single read, and the retry budget keeps a failed probe from turning
 * that burst into a `sessionInfo()` call per delta.
 *
 * Pure so the first-turn timing is unit-testable without booting the page.
 */

/** Minimal shape the guard needs from the remote footer snapshot. */
export interface FooterRemoteInfo {
	messageCount?: number
	msgCount?: number
	tps?: number | null
}

/**
 * True when a first-turn re-read should run: the count is still unknown, a
 * session id is bound (otherwise the read would answer undefined again), and
 * no re-read is already in flight.
 */
export function shouldRefreshFooter(
	remoteInfo: FooterRemoteInfo | undefined,
	sessionId: string | undefined,
	inFlight: boolean,
): boolean {
	return !inFlight && remoteInfo === undefined && sessionId !== undefined
}

/** Default retry cap for first-turn probes within one turn. */
export const FOOTER_PROBE_MAX_ATTEMPTS = 3
/** Default minimum spacing between two first-turn probes (ms). */
export const FOOTER_PROBE_MIN_INTERVAL_MS = 400

/** Mutable-by-assignment state of the one-shot first-turn probe. */
export interface FooterProbeState {
	/** A probe's sessionInfo() is awaiting — further triggers collapse into it. */
	inFlight: boolean
	/** Probes started since the budget was last reset (per-turn cap). */
	attempts: number
	/** Timestamp (ms) of the last probe start; 0 = never. */
	lastAttemptAt: number
}

/** Fresh state for mount / a session switch / a turn boundary. */
export function initialFooterProbeState(): FooterProbeState {
	return { inFlight: false, attempts: 0, lastAttemptAt: 0 }
}

/** Optional overrides for the retry budget (defaults keep production sane). */
export interface FooterProbeBudget {
	maxAttempts?: number
	minIntervalMs?: number
}

/**
 * Gate a new probe on top of `shouldRefreshFooter`: still unknown/bound/idle,
 * under the per-turn attempt cap, and spaced at least `minIntervalMs` after
 * the previous attempt. The spacing + cap are what stop a stream's delta
 * burst from issuing a sessionInfo() on every token when an earlier probe
 * answered undefined or rejected.
 */
export function shouldStartFooterProbe(
	remoteInfo: FooterRemoteInfo | undefined,
	sessionId: string | undefined,
	state: FooterProbeState,
	now: number,
	budget: FooterProbeBudget = {},
): boolean {
	if (!shouldRefreshFooter(remoteInfo, sessionId, state.inFlight)) return false
	if (state.attempts >= (budget.maxAttempts ?? FOOTER_PROBE_MAX_ATTEMPTS)) return false
	if (state.lastAttemptAt !== 0 && now - state.lastAttemptAt < (budget.minIntervalMs ?? FOOTER_PROBE_MIN_INTERVAL_MS)) {
		return false
	}
	return true
}

/** Record a probe start (marks in-flight, bumps the cap, stamps the time). */
export function markFooterProbeStarted(state: FooterProbeState, now: number): FooterProbeState {
	return { ...state, inFlight: true, attempts: state.attempts + 1, lastAttemptAt: now }
}

/**
 * Settle a probe. ALWAYS releases `inFlight` — success, an undefined snapshot
 * from a sessionInfo()/id-binding race, or a rejection all clear the guard so
 * a later delta can retry (a stuck guard would swallow every probe for this
 * turn AND later sessions, including /new's first turn). Only a successful
 * read clears the retry budget; a failed read keeps the attempt count and
 * last-attempt stamp so the throttle still applies to the next delta.
 */
export function settleFooterProbe(state: FooterProbeState, infoObtained: boolean): FooterProbeState {
	if (infoObtained) return initialFooterProbeState()
	return { ...state, inFlight: false }
}
