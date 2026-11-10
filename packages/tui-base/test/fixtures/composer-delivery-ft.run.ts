/**
 * FT runner — busy submit opens the injected delivery chooser, Esc keeps the
 * typed buffer, Queue clears it without sending, Steer routes to seam.steer.
 *
 * Run by test/composer-delivery-ft.test.ts in a child `bun --conditions
 * browser` process (solid-js client build — see composer-palette-ft.run.ts).
 */
import { createTestRenderer } from "@opentui/core/testing"
import { createComponent, render } from "@opentui/solid"
import { SessionComposer } from "../../src/routes/session/session-composer"

function findTextarea(node: any): any {
	if (!node) return undefined
	if (node.constructor?.name === "TextareaRenderable") return node
	for (const child of node.getChildren?.() ?? []) {
		const hit = findTextarea(child)
		if (hit) return hit
	}
	return undefined
}

async function main() {
	const setup = await createTestRenderer({ width: 80, height: 16, useMouse: false })
	const sent: string[] = []
	const steered: string[] = []
	let asked = 0
	let answer: Promise<"steer" | "queue" | undefined> = Promise.resolve("steer")
	const seam = { steer: (text: string) => void steered.push(text) } as any
	render(
		() =>
			createComponent(SessionComposer, {
				seam,
				// The first turn never settles during the run: the composer stays busy.
				send: (text: string) => {
					sent.push(text)
					return new Promise<void>(() => {})
				},
				chooseDelivery: () => {
					asked += 1
					return answer
				},
			}),
		setup.renderer,
	)
	await setup.flush()
	const textarea = findTextarea(setup.renderer.root)
	if (!textarea) throw new Error("FT mount: no TextareaRenderable")
	const write = async (bytes: string) => {
		setup.renderer.stdin.emit("data", Buffer.from(bytes))
		await setup.flush()
	}
	const state = () => ({
		buffer: textarea.plainText as string,
		asked,
		sent: [...sent],
		steered: [...steered],
	})

	const report: Record<string, unknown> = {}

	// 1. idle submit starts the turn (busy from here on)
	await write("first")
	await write("\r")
	report.first = state()

	// 2. busy submit asks; Esc (undefined) keeps the buffer
	let release: ((value: "steer" | "queue" | undefined) => void) | undefined
	answer = new Promise((resolve) => (release = resolve))
	await write("keep me")
	await write("\r")
	report.askedBeforeEsc = state()
	release?.(undefined)
	await setup.flush()
	report.afterEsc = state()

	// 3. Queue: buffer clears, no send (still busy)
	answer = Promise.resolve("queue")
	await write("queued line")
	await write("\r")
	await setup.flush()
	report.afterQueue = state()

	// 4. Steer: buffer clears and the line reaches seam.steer
	answer = Promise.resolve("steer")
	await write("steer line")
	await write("\r")
	await setup.flush()
	report.afterSteer = state()

	console.log(JSON.stringify(report))
	await setup.dispose()
	process.exit(0)
}

await main()
