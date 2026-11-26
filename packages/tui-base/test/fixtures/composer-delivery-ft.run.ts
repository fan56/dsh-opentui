/**
 * FT runner — busy submit opens the injected delivery chooser, Esc keeps the
 * typed buffer, Queue clears it without sending, Steer routes to seam.steer.
 * A refused steer restores the submitted line (unless the user typed a newer
 * one) and is safe even after the component has been destroyed.
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

type SteerResult = { accepted: boolean; reason?: string; turnId?: string }

async function mount(options: { steer?: (text: string) => Promise<SteerResult> } = {}) {
	const setup = await createTestRenderer({ width: 80, height: 16, useMouse: false })
	/** Every send records the composer-supplied source; each turn is held open
	 *  until the runner releases it, so the next Enter still takes the busy
	 *  (chooser) path. */
	const sent: { text: string; source: string }[] = []
	const turnReleases: Array<() => void> = []
	const steered: string[] = []
	/** Every receipt the seam ACTUALLY returned, in call order (not the configured
	 *  fake): a refusal must be observable as accepted:false + reason, and a
	 *  late refusal after dispose must still land here. */
	const steerResults: SteerResult[] = []
	let asked = 0
	let answer: Promise<"steer" | "queue" | undefined> = Promise.resolve("steer")
	// Acceptance receipt by default. A refusal makes the controller keep the
	// draft (no receipt row, no auto-send). A legacy void seam would likewise
	// be a refusal and would re-open the chooser on a later submit.
	const seam = {
		steer: async (text: string): Promise<SteerResult> => {
			steered.push(text)
			const result = options.steer ? await options.steer(text) : { accepted: true, turnId: "t-ft" }
			steerResults.push(result)
			return result
		},
	} as any
	render(
		() =>
			createComponent(SessionComposer, {
				seam,
				send: (text: string, source?: string) =>
					new Promise<void>((resolve) => {
						sent.push({ text, source: source ?? "user" })
						turnReleases.push(resolve)
					}),
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
		steerResults: [...steerResults],
		// Last seam receipt — the assertion surface for a refused steer.
		seamResult: steerResults.at(-1),
	})
	const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
	return {
		setup,
		write,
		state,
		textarea,
		turnReleases,
		tick,
		// Textarea-free view of the last seam receipt. `state()` reads
		// textarea.plainText, which throws once the EditBuffer is destroyed,
		// so the post-dispose assertion must use this instead.
		get lastSteerResult() {
			return steerResults.at(-1)
		},
		setAnswer: (next: Promise<"steer" | "queue" | undefined>) => {
			answer = next
		},
	}
}

const report: Record<string, unknown> = {}
const ENTER = "\r"

// 1. Original chooser walk: idle send, Esc keeps the buffer, Queue clears
//    without a send, Steer reaches the accepting seam.
{
	const m = await mount()
	await m.write("first")
	await m.write(ENTER)
	report.first = m.state()

	let release: ((value: "steer" | "queue" | undefined) => void) | undefined
	m.setAnswer(new Promise((resolve) => (release = resolve)))
	await m.write("keep me")
	await m.write(ENTER)
	report.askedBeforeEsc = m.state()
	release?.(undefined)
	await m.setup.flush()
	report.afterEsc = m.state()

	// Esc preserved "keep me" by design. The queue leg tests a FRESH prompt,
	// so clear that preserved draft first; otherwise typing appends to it and
	// the buffer assertion would be testing concatenation, not queue delivery.
	// This is a fixture-only reset — production Esc semantics stay untouched.
	m.textarea.setText("")
	await m.setup.flush()
	report.beforeQueue = m.state()

	m.setAnswer(Promise.resolve("queue"))
	await m.write("queued line")
	await m.write(ENTER)
	await m.setup.flush()
	report.afterQueue = m.state()

	// First turn settles: its queued line is pumped with source="queue",
	// while the original idle Enter was source="user". Keep this new turn open
	// so the steer step below still takes the busy chooser path.
	m.turnReleases[0]?.()
	await m.setup.flush()
	report.afterQueuePump = m.state()

	// Steer: buffer clears and the line reaches seam.steer
	m.setAnswer(Promise.resolve("steer"))
	await m.write("steer line")
	await m.write(ENTER)
	await m.setup.flush()
	report.afterSteer = m.state()

	await m.setup.dispose()
}

// 2. Refused steer with an empty buffer restores the exact submitted line.
//    The chooser keeps the text while open; clearing it (the sync-clear path)
//    before the refusal lands is what makes restoration observable.
{
	const m = await mount({ steer: async () => ({ accepted: false, reason: "STEER_ENDED" }) })
	await m.write("first")
	await m.write(ENTER)
	let release: ((value: "steer" | "queue" | undefined) => void) | undefined
	m.setAnswer(new Promise((resolve) => (release = resolve)))
	await m.write("restore me")
	await m.write(ENTER)
	m.textarea.setText("")
	await m.setup.flush()
	report.beforeRejectEmpty = m.state()
	release?.("steer")
	await m.tick()
	await m.setup.flush()
	report.afterRejectEmpty = m.state()
	await m.setup.dispose()
}

// 3. The user typed a newer draft while the chooser was open: a refusal must
//    not clobber it with the line that was submitted before the dialog.
{
	const m = await mount({ steer: async () => ({ accepted: false, reason: "STEER_IDLE" }) })
	await m.write("first")
	await m.write(ENTER)
	let release: ((value: "steer" | "queue" | undefined) => void) | undefined
	m.setAnswer(new Promise((resolve) => (release = resolve)))
	await m.write("original")
	await m.write(ENTER)
	m.textarea.setText("")
	await m.write("new draft")
	report.beforeRejectNewText = m.state()
	release?.("steer")
	await m.tick()
	await m.setup.flush()
	report.afterRejectNewText = m.state()
	await m.setup.dispose()
}

// 4. Destroy the component while the chooser is pending, then refuse the
//    steer. Both the view callback and the submit continuation must bail out
//    on a destroyed editor instead of writing into it.
{
	const m = await mount({ steer: async () => ({ accepted: false, reason: "STEER_ABORTING" }) })
	await m.write("first")
	await m.write(ENTER)
	let release: ((value: "steer" | "queue" | undefined) => void) | undefined
	m.setAnswer(new Promise((resolve) => (release = resolve)))
	await m.write("destroy me")
	await m.write(ENTER)
	// Empty the buffer first: without the disposed/isDestroyed guard the view
	// would try to write the submitted line back into the dead editor.
	m.textarea.setText("")
	report.beforeDestroy = m.state()
	await m.setup.dispose()
	const destroyed = m.textarea.isDestroyed as boolean
	let crash: string | null = null
	const onUnhandled = (error: unknown) => {
		crash ??= String(error)
	}
	process.on("unhandledRejection", onUnhandled)
	try {
		release?.("steer")
		await m.tick()
		await m.tick() // let any late unhandled rejection surface before detaching
	} catch (error) {
		crash ??= String(error)
	} finally {
		process.off("unhandledRejection", onUnhandled)
	}
	report.afterDestroyReject = { crash, destroyed, seamResult: m.lastSteerResult }
}

console.log(JSON.stringify(report))
process.exit(0)
