/**
 * CJK-aware token estimation for the client facade's context-occupancy
 * display (the 🧠 footer segment's numerator). Ported from dsh-tui-pi's
 * `src/tokens.ts` (`estimateTextTokens`, itself from @aiwayds/dsh-dcp
 * `lib/summarizer.js`) — the SAME pricing the tui-pi footer uses, so the
 * two footers read identically on the same transcript:
 *
 *   tokens = ceil(cjkCount / 2 + (length - cjkCount) / 4)
 *
 * A CJK character encodes roughly one token in real tokenizers while ASCII
 * runs ~4 chars/token, so CJK is priced at ~2 chars/token (denser) and the
 * default mode stays identical to a flat 4-chars/token meter on pure-ASCII
 * text. `Math.ceil` mirrors the host meter's per-character rounding.
 */

/** CJK scripts + full-width forms (Han, kana, hangul, CJK punctuation, full-width). */
const CJK_CHAR = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef\uac00-\ud7af]/g

/**
 * Estimate the token count of a text (CJK mode, see the header).
 * @returns the estimated token count (never negative; empty text → 0).
 */
export function estimateTextTokens(text: string): number {
	const source = String(text)
	if (source.length === 0) return 0
	const cjk = (source.match(CJK_CHAR) ?? []).length
	return Math.ceil(cjk / 2 + (source.length - cjk) / 4)
}

/**
 * The 🧠 segment's context-occupancy accumulator (tui-pi `BridgeStats.
 * contextTokens` semantics, session.ts:1885-1894 reference): the LATEST
 * billed request's input + output plus a CJK estimate of everything
 * appended after it (it enters the next request). Deliberately NOT a
 * session-cumulative total — the value tracks the current request so the
 * display follows the latest usage frame and drops after a compaction or
 * route change.
 *
 * - `notePending(text)`: CJK-estimates every message text the client sees
 *   between billed frames (user turn text, streamed deltas, tool output
 *   slices) — the pending gap the next request will price exactly.
 * - `noteUsage(prompt, cacheRead, cacheWrite, outputDelta)`: one usage
 *   frame landed. Billed input = uncached prompt + cacheRead + cacheWrite
 *   (cache-splitting adapters report prompt UNCACHED — remote-host-session
 *   onUsage wire fact). The frame prices everything pending, so pending
 *   resets to 0 and only the frame's own output delta is kept on top.
 * - `noteExactOutput(n)`: an output-only frame (no billed input) — exact
 *   tokens added to the pending pool (they are context, not an estimate).
 * - `reset()`: fresh session — the occupancy restarts from zero.
 */
export class ContextTokenMeter {
	#billedInput = 0
	#billedOutput = 0
	#pending = 0

	notePending(text: string): void {
		this.#pending += estimateTextTokens(text)
	}

	/** Exact (non-estimated) tokens seen between billed frames. */
	noteExactOutput(tokens: number): void {
		if (Number.isFinite(tokens) && tokens > 0) this.#pending += tokens
	}

	noteUsage(prompt: number, cacheRead: number, cacheWrite: number, outputDelta: number): void {
		const billed = (Number(prompt) || 0) + (Number(cacheRead) || 0) + (Number(cacheWrite) || 0)
		if (billed > 0) {
			this.#billedInput = billed
			this.#billedOutput = Number(outputDelta) || 0
			this.#pending = 0
			return
		}
		// No billed input in the frame (output-only chunk): the exact output
		// joins the pending pool, the previous base stands.
		this.noteExactOutput(outputDelta)
	}

	reset(): void {
		this.#billedInput = 0
		this.#billedOutput = 0
		this.#pending = 0
	}

	/** The current occupancy estimate (the 🧠 numerator). */
	get tokens(): number {
		return this.#billedInput + this.#billedOutput + this.#pending
	}
}
