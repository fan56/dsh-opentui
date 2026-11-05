// Session page skeleton (batch 4): the REAL rebuilt Transcript above the
// REAL SessionComposer, both on one fake SessionSeam sharing one projection.
// Enter starts a fake streamed turn; Enter mid-turn steers it (the fake seam
// echoes steers into the stream so they are visible); ↑/↓ recall history.
// Run from packages/tui-base: bun examples/session.tsx   (ctrl+c quits)
import { createSignal, onMount } from "solid-js"
import { render } from "@opentui/solid"
import { NullSessionSeam, type SeamTranscriptRow, type SeamTurnCallbacks } from "../src/seams/session"
import { createSeamRows } from "../src/routes/session/seam-rows"
import { Transcript } from "../src/routes/session/transcript"
import { SessionComposer } from "../src/routes/session/session-composer"

const SENTENCES = Number(process.env.S_SENTENCES ?? 24)
const INTERVAL_MS = Number(process.env.S_INTERVAL_MS ?? 250)
const EXIT_AFTER_MS = Number(process.env.S_EXIT_AFTER_MS ?? 0)

class FakeSeam extends NullSessionSeam {
	private steers: string[] = []
	override currentSessionId() {
		return "demo"
	}
	override async storedTranscript(): Promise<SeamTranscriptRow[]> {
		return [
			{ kind: "user", text: "earlier question (stored history)", final: true },
			{ kind: "assistant", text: "Earlier **answer** from stored history.", final: true },
		]
	}
	override steer(text: string): void {
		this.steers.push(text)
	}
	override async turn(text: string, cb: SeamTurnCallbacks): Promise<void> {
		const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
		cb.onThinkingDelta(`Answering: ${text}`)
		for (let n = 1; n <= SENTENCES; n++) {
			for (const steer of this.steers.splice(0)) cb.onContentDelta(`**[steer received: ${steer}]**\n\n`)
			cb.onContentDelta(`${n}. Streamed sentence ${n}.\n\n`)
			await sleep(INTERVAL_MS)
		}
		for (const steer of this.steers.splice(0)) cb.onContentDelta(`**[steer received: ${steer}]**\n\n`)
	}
}

function SessionPage(props: { seam: FakeSeam }) {
	const projection = createSeamRows(props.seam, () => props.seam.currentSessionId() ?? "")
	const [, setBusy] = createSignal(false)
	onMount(() => projection.load())
	return (
		<box flexDirection="column" width="100%" height="100%" backgroundColor="black">
			<Transcript seam={props.seam} projection={projection}>
				<SessionComposer seam={props.seam} send={projection.send} onBusyChange={setBusy} />
			</Transcript>
		</box>
	)
}

render(() => <SessionPage seam={new FakeSeam()} />, { exitOnCtrlC: true })
if (EXIT_AFTER_MS > 0) setTimeout(() => process.exit(0), EXIT_AFTER_MS)
