/**
 * /btw side-question overlay (feature batch F3) — the tui-base session-route
 * face over the shell facade's `btwAsk` (remote-btw.ts second-session flow;
 * interaction shape ported from dsh-tui-pi's btw.ts + btw-overlay.ts).
 *
 * Split (same as the reference): the controller is renderer-free and
 * unit-testable; the panel is pure rendering; the opener is the dialog-stack
 * glue. Concurrency: at most one side call runs (the facade rejects a second
 * concurrent btwAsk); further submits queue behind it (bounded). The main
 * line is never touched — btwAsk rides a throwaway session, so a mid-turn
 * submit queues/streams alongside without interrupting the main stream.
 * Esc closes through the vendored dialog stack's onClose (the focus law the
 * rest of the overlay family uses) — closing never stops the run; the
 * settled answer lands in the Last-btw slot, reviewable via bare `/btw`.
 */
import { Show, createSignal } from "solid-js"
import type { JSX } from "solid-js"
import { useThemeOptional } from "../../context/theme"
import { DialogPrompt } from "../../ui/dialog-prompt"

/** One side-call exchange: streaming while the answer grows, then settled
 * (or error — the facade resolves turn-level failures as `error: …` text). */
export interface BtwRunState {
	question: string
	answer: string
	status: "streaming" | "settled" | "error"
}

/** The SessionSeam.btwAsk slice the controller needs (structural). */
export type BtwAskFn = (
	question: string,
	snapshot: string[],
	onDelta: (full: string) => void,
) => Promise<string>

/** Max queued questions behind a running side call (reference parity: bounded). */
export const BTW_QUEUE_CAPACITY = 3

/** Snapshot sizing (remote-btw host-session parity: recent context only). */
export const BTW_SNAPSHOT_ROWS = 6
export const BTW_SNAPSHOT_ROW_CHARS = 1000

/**
 * Renderer-free controller: submit/queue/settle state machine over Solid
 * signals. `close()` only hides the overlay — the run continues and its
 * result still lands in the Last-btw slot (reference Esc contract).
 */
export class BtwController {
	#ask: BtwAskFn
	#snapshot: () => Promise<string[]>
	#capacity: number
	#run = createSignal<BtwRunState | undefined>(undefined)
	#last = createSignal<BtwRunState | undefined>(undefined)
	#queue = createSignal<string[]>([])
	#visible = createSignal(false)

	constructor(deps: { ask: BtwAskFn; snapshot: () => Promise<string[]>; capacity?: number }) {
		this.#ask = deps.ask
		this.#snapshot = deps.snapshot
		this.#capacity = deps.capacity ?? BTW_QUEUE_CAPACITY
	}

	/** The live run, if any. */
	run(): BtwRunState | undefined {
		return this.#run[0]()
	}
	/** The most recent settled exchange (bare /btw review slot). */
	last(): BtwRunState | undefined {
		return this.#last[0]()
	}
	/** Queued questions behind the live run. */
	queueDepth(): number {
		return this.#queue[0]().length
	}
	/** Overlay visibility (open/esc state — orthogonal to the run). */
	visible(): boolean {
		return this.#visible[0]()
	}
	/** A side call is in flight (streaming or queued behind one). */
	get busy(): boolean {
		return this.run()?.status === "streaming" || this.queueDepth() > 0
	}

	/**
	 * Submit a question: starts the side call, or queues it behind the live
	 * run, or rejects when the queue is full. Never throws.
	 */
	submit(question: string): "started" | "queued" | "full" {
		const text = question.trim()
		if (text === "") return "full"
		if (this.run()?.status === "streaming") {
			const queue = this.#queue[0]()
			if (queue.length >= this.#capacity) return "full"
			this.#queue[1]([...queue, text])
			return "queued"
		}
		this.#start(text)
		return "started"
	}

	/** Esc-equivalent: hide the overlay; the run is unaffected. */
	close(): void {
		this.#visible[1](false)
	}

	/** Mark the overlay shown (the opener calls this after dialog.replace). */
	markVisible(): void {
		this.#visible[1](true)
	}

	/** Drop the queue (main-line disruption parity); the live run's own
	 * 120s facade timeout settles it — nothing to abort from here. */
	dropQueue(): void {
		this.#queue[1]([])
	}

	#start(question: string): void {
		const runState: BtwRunState = { question, answer: "", status: "streaming" }
		this.#run[1](runState)
		void this.#snapshot()
			.catch(() => [] as string[])
			.then((snapshot) =>
				this.#ask(question, snapshot, (full) => {
					this.#run[1]((prev) => (prev === undefined ? prev : { ...prev, answer: full }))
				}),
			)
			.then((answer) => {
				this.#settle(answer.startsWith("error:") ? "error" : "settled", answer)
			})
			.catch((error: unknown) => {
				this.#settle("error", `error: ${error instanceof Error ? error.message : String(error)}`)
			})
	}

	#settle(status: "settled" | "error", answer: string): void {
		const finished = this.#run[0]()
		if (finished !== undefined) {
			this.#last[1]({ ...finished, answer, status })
			this.#run[1](undefined)
		}
		const [next, ...rest] = this.#queue[0]()
		this.#queue[1](rest)
		if (next !== undefined) this.#start(next)
	}
}

/** The framed exchange panel: question + streaming/settled answer + hint. */
export function BtwPanel(props: { controller: BtwController }) {
	const theme = useThemeOptional()
	const muted = () => theme?.text.muted ?? "#565f89"
	const accent = () => theme?.border.base ?? "#7aa2f7"
	const shown = () => props.controller.run() ?? props.controller.last()
	return (
		<box flexDirection="column" gap={1} paddingBottom={1}>
			<text fg={accent()}>btw — side question</text>
			<Show when={shown()} fallback={<text fg={muted()}>no side question yet</text>}>
				{(run) => (
					<>
						<text>{run().question}</text>
						<Show
							when={run().status === "streaming" && run().answer === ""}
							fallback={<text>{run().answer}</text>}
						>
							<text fg={muted()}>Thinking…</text>
						</Show>
					</>
				)}
			</Show>
			<text fg={muted()}>
				{shown()?.status === "streaming"
					? `Running alongside the main task · Esc close${
							props.controller.queueDepth() > 0 ? ` · ${props.controller.queueDepth()} queued` : ""
						}`
					: `Not kept in the session · /btw reopens this answer${
							props.controller.queueDepth() > 0 ? ` · ${props.controller.queueDepth()} queued` : ""
						}`}
			</text>
		</box>
	)
}

/** The dialog-stack face the opener needs (structural useDialog slice). */
export interface BtwDialogHost {
	replace(input: () => JSX.Element, onClose?: () => void): unknown
	clear(): void
}

/** A queued question the opener rejected (queue full) reports through. */
export type BtwOpenOutcome = "usage" | "review" | "input" | "started" | "queued" | "full"

/**
 * The `/btw` opener: argument form submits + shows the panel; bare form
 * reopens the last answer (review), or falls back to an input prompt.
 * Esc/cancel route through the vendored stack's onClose → controller.close()
 * (focus law: the stack owns capture/refocus, the panel binds no keys).
 */
export function createBtwOpener(deps: {
	controller: BtwController
	dialog: BtwDialogHost
}): (argText: string) => BtwOpenOutcome {
	const showPanel = () => {
		deps.controller.markVisible()
		deps.dialog.replace(
			() => <BtwPanel controller={deps.controller} />,
			() => {
				deps.controller.close()
			},
		)
	}
	return (argText: string): BtwOpenOutcome => {
		const question = argText.trim()
		if (question !== "") {
			const outcome = deps.controller.submit(question)
			if (outcome === "full") return "full"
			showPanel()
			return outcome
		}
		if (deps.controller.last() !== undefined) {
			showPanel()
			return "review"
		}
		deps.dialog.replace(
			() => (
				<DialogPrompt
					title="/btw"
					placeholder="Ask anything"
					onConfirm={(text) => {
						const outcome = deps.controller.submit(text)
						if (outcome === "full") {
							deps.dialog.clear()
							return
						}
						showPanel()
					}}
					onCancel={() => {
								deps.controller.close()
					}}
				/>
			),
			() => {
				deps.controller.close()
			},
		)
		return "input"
	}
}

/** Snapshot builder over the seam's transcript reads (recent rows only). */
export function createBtwSnapshotBuilder(seam: {
	currentSessionId(): string | undefined
	storedTranscript(id: string): Promise<{ kind: string; text: string }[]>
}): () => Promise<string[]> {
	return async () => {
		const id = seam.currentSessionId()
		if (id === undefined) return []
		try {
			const rows = await seam.storedTranscript(id)
			return rows
				.slice(-BTW_SNAPSHOT_ROWS)
				.map((row) => `${row.kind}: ${row.text}`.slice(0, BTW_SNAPSHOT_ROW_CHARS))
		} catch {
			return []
		}
	}
}
