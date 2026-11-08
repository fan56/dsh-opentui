// V1 tool-block demo (batch V1 verification): the REAL Transcript rendering
// a tool row through its lifecycle via seam events — RUNNING (spinner + args
// summary) for ~6s, then SETTLED (✓ + ⎿ result track). Scratch evidence for
// the tui-pi shape parity; not part of the test suite.
// Run from packages/tui-base: bun examples/tool-spin-demo.tsx
import { render } from "@opentui/solid"
import { NullSessionSeam } from "../src/seams/session"
import { Transcript } from "../src/routes/session/transcript"

const seam = new NullSessionSeam()
render(() => <Transcript seam={seam} />)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const toolPart = (part: Record<string, unknown>) =>
	seam.emit({
		type: "message.part.updated",
		details: { messageID: "m1", part: { id: "t1", ...part } },
	})

setTimeout(async () => {
	seam.emit({ type: "message.updated", details: { id: "u1", role: "user", text: "build the workspace" } })
	// RUNNING: spinner frames + `⎿` args summary line.
	toolPart({ type: "tool", name: "bash", input: '{"command":"cargo build --release --workspace"}', status: "running" })
	await sleep(6000)
	// SETTLE: ✓ + `⎿` result first line (+N lines) — envelope-shaped brief.
	toolPart({
		type: "tool",
		name: "bash",
		input: '{"command":"cargo build --release --workspace"}',
		status: "done",
		output: JSON.stringify({
			turn: 1,
			message: { content: [{ type: "text", text: "Compiling dsh-opentui v2.2.5\nFinished release [optimized] in 41.22s\none more line" }] },
		}),
	})
}, 400)
