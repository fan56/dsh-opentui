// Transcript tear check (batch 3): the REAL rebuilt Transcript component
// (src/routes/session/transcript.tsx) fed by a fake SessionSeam that streams
// 60 numbered sentences plus a few tool rows. Fixed bottom input box must
// stay intact while sticky-bottom follows the stream.
// Run from packages/tui-base: bun examples/transcript.tsx
import { render } from "@opentui/solid"
import { NullSessionSeam, type SeamTranscriptRow, type SeamTurnCallbacks } from "../src/seams/session"
import { Transcript } from "../src/routes/session/transcript"

const SENTENCES = Number(process.env.T_SENTENCES ?? 60)
const INTERVAL_MS = Number(process.env.T_INTERVAL_MS ?? 80)
const SETTLE_MS = Number(process.env.T_SETTLE_MS ?? 6000)
const TOOL_EVERY = 15

class FakeSeam extends NullSessionSeam {
	override currentSessionId() {
		return "demo"
	}
	override async storedTranscript(): Promise<SeamTranscriptRow[]> {
		return [
			{ kind: "user", text: "earlier question (stored history)", final: true },
			{ kind: "assistant", text: "Earlier **answer** from stored history.", final: true },
		]
	}
	override async turn(_text: string, cb: SeamTurnCallbacks): Promise<void> {
		const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
		cb.onThinkingDelta("Planning a numbered list of sentences.")
		for (let n = 1; n <= SENTENCES; n++) {
			cb.onContentDelta(`${n}. Deterministic streamed sentence number ${n} for the tear check.\n\n`)
			if (n % TOOL_EVERY === 0) {
				// Tool rows interleave like a real turn: start → approve → continue.
				cb.onToolStart?.({ callId: `c${n}`, name: "read", args: `file-${n}.ts` })
				await cb.onApprove("read", { path: `file-${n}.ts` })
			}
			await sleep(INTERVAL_MS)
		}
	}
}

const seam = new FakeSeam()

// Typing in the input + Enter runs FakeSeam.turn through the component's own
// send() path. The scripted check drives the same projection via seam events
// (the adapter's push path): text parts split by tool parts, like opencode's
// text:0 / tool / text:1 part order.
render(() => <Transcript seam={seam} />)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const textPart = (seg: number, text: string, completed?: number) =>
	seam.emit({
		type: "message.part.updated",
		details: { messageID: "m1", part: { type: "text", id: `p${seg}`, text, time: { completed } } },
	})

setTimeout(async () => {
	seam.emit({ type: "message.updated", details: { id: "u1", role: "user", text: "stream 60 sentences please" } })
	let seg = 0
	for (let n = 1; n <= SENTENCES; n++) {
		textPart(seg, `${n}. Deterministic streamed sentence number ${n} for the tear check.\n\n`)
		if (n % TOOL_EVERY === 0 && n < SENTENCES) {
			textPart(seg, "", Date.now())
			seam.emit({
				type: "message.part.updated",
				details: { messageID: "m1", part: { type: "tool", id: `t${n}`, name: "read", input: `file-${n}.ts`, status: "done" } },
			})
			seg++
		}
		await sleep(INTERVAL_MS)
	}
	textPart(seg, "", Date.now())
	setTimeout(() => process.exit(0), SETTLE_MS)
}, 500)
