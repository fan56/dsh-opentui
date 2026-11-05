/**
 * Seam-driven transcript row projection (batch 3). The rebuilt replacement
 * for the `useData`/`useClient` halves of `rows.ts`: same shape — a Solid
 * store of transcript rows keyed by a stable `key` and reconciled by that
 * key — fed by `SessionSeam` instead of the vendored data/client contexts.
 *
 * Event contract (structural slice of the opencode server events the
 * vendored view consumed via context/event.ts; the shell adapter projects
 * its follow stream onto these):
 *
 *   message.updated     { id, role: "user", text }            → user row upsert
 *   message.part.updated { messageID, part }                  → assistant /
 *   reasoning / tool row upsert, part-shaped:
 *     { type: "text"|"reasoning", text }                      → markdown row
 *     { type: "tool", id, name, status?, output? }            → tool row
 *   session.error        { message }                          → assistant error row
 *
 * `details.sessionID`, when present, must match the active session or the
 * event is dropped (the vendored code filtered on `event.data.sessionID`).
 * Live turn rows (`send()` → `seam.turn` callbacks) reuse the same keys
 * with a `live` scope, so the viewport's `<For>` keeps one reconciliation
 * story across stored history and streaming.
 */
import { createSignal, onCleanup, type Accessor } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import type {
	SeamApprovalVerdict,
	SeamSessionEvent,
	SeamTranscriptRow,
	SeamTurnCallbacks,
	SessionSeam,
} from "../../seams/session"

/** One projected transcript row (the rebuilt `SessionRow` slice). */
export type SeamRow =
	| { key: string; kind: "user"; text: string; final: true }
	| { key: string; kind: "assistant"; text: string; final: boolean }
	| { key: string; kind: "reasoning"; text: string; final: boolean }
	| {
			key: string
			kind: "tool"
			name: string
			args: string
			status: "running" | "done" | "failed"
			output?: string
	  }

export function toStoredRow(stored: SeamTranscriptRow, index: number): SeamRow {
	const kind = stored.kind === "user" || stored.kind === "tool" ? stored.kind : "assistant"
	const key = `stored:${kind}:${index}`
	if (kind === "tool") {
		return { key, kind: "tool", name: stored.text, args: "", status: "done" }
	}
	if (kind === "user") return { key, kind: "user", text: stored.text, final: true }
	return { key, kind: "assistant", text: stored.text, final: stored.final }
}

export function createSeamRows(
	seam: SessionSeam,
	sessionID: Accessor<string>,
	options?: { onApprove?: SeamTurnCallbacks["onApprove"] },
) {
	const [rows, setRows] = createStore<SeamRow[]>([])
	const [hydrated, setHydrated] = createSignal(false)
	let liveOrdinal = 0

	/** Full replace on a keyed reconcile: matching keys patch in place, so a
	 * re-hydrate (older page prepended) never remounts the whole transcript. */
	function hydrate(stored: SeamTranscriptRow[]) {
		setRows(reconcile(stored.map(toStoredRow), { key: "key" }))
		setHydrated(true)
	}

	/** Re-hydrate from the seam. Returns the settle promise so callers can
	 * sequence post-hydrate rows after it (a command feedback row appended
	 * before hydrate would be wiped by the keyed reconcile). */
	function load(): Promise<void> {
		const id = sessionID()
		return seam
			.storedTranscript(id)
			.then((stored) => {
				if (sessionID() === id) hydrate(stored)
			})
			.catch(() => undefined)
	}

	/** Upsert one row by key. Reconcile semantics per row would remount on
	 * every delta; instead patch the matching index in place via produce. */
	function upsert(row: SeamRow) {
		setRows(
			produce((draft) => {
				const index = draft.findIndex((existing) => existing.key === row.key)
				if (index === -1) {
					// Live rows append after stored history; a queued start position
					// is not modeled until compaction rows exist on the seam.
					draft.push(row)
					return
				}
				// Patch in place: replacing the object would remount the row's
				// renderable on every streaming delta (keyed-row law).
				Object.assign(draft[index], row)
			}),
		)
	}

	function apply(event: SeamSessionEvent) {
		const details = (event.details ?? {}) as Record<string, unknown>
		if (typeof details.sessionID === "string" && details.sessionID !== sessionID()) return
		if (event.type === "message.updated" && details.role === "user") {
			const id = typeof details.id === "string" ? details.id : `local-${++liveOrdinal}`
			upsert({
				key: `user:${id}`,
				kind: "user",
				text: typeof details.text === "string" ? details.text : "",
				final: true,
			})
			return
		}
		if (event.type === "message.part.updated") {
			const messageID = typeof details.messageID === "string" ? details.messageID : "live"
			const part = (details.part ?? {}) as Record<string, unknown>
			const partType = typeof part.type === "string" ? part.type : "text"
			const partID = typeof part.id === "string" ? part.id : `${partType}:${messageID}`
			if (partType === "tool") {
				upsert({
					key: `tool:${messageID}:${partID}`,
					kind: "tool",
					name: typeof part.name === "string" ? part.name : "generic",
					args: typeof part.input === "string" ? part.input : "",
					status: part.status === "done" || part.status === "failed" ? part.status : "running",
					output: typeof part.output === "string" ? part.output : undefined,
				})
				return
			}
			if (partType !== "text" && partType !== "reasoning") return
			const text = typeof part.text === "string" ? part.text : ""
			// Empty deltas are dropped like the vendored `event.data.delta.trim()` guard.
			const kind = partType === "text" ? "assistant" : "reasoning"
			const key = `${kind}:${messageID}:${partID}`
			const existing = rows.find((row) => row.key === key)
			if (!existing && !text.trim()) return
			upsert({
				key,
				kind,
				text: existing && existing.kind === kind ? existing.text + text : text,
				final: (part.time as { completed?: number } | undefined)?.completed !== undefined,
			})
			return
		}
		if (event.type === "session.error") {
			const message = typeof details.message === "string" ? details.message : "unknown error"
			upsert({ key: `error:local-${++liveOrdinal}`, kind: "assistant", text: `error: ${message}`, final: true })
		}
	}

	const unsubscribe = seam.onSessionEvent(apply)
	onCleanup(unsubscribe)

	/** Send a user prompt: optimistic user row, then stream via seam.turn. */
	async function send(text: string): Promise<void> {
		const prompt = text.trim()
		if (!prompt) return
		upsert({ key: `user:local-${++liveOrdinal}`, kind: "user", text: prompt, final: true })
		const assistantKey = `assistant:live-${++liveOrdinal}`
		const reasoningKey = `reasoning:live-${liveOrdinal}`
		let assistantText = ""
		let reasoningText = ""
		return seam.turn(prompt, {
			onThinkingDelta: (delta) => {
				reasoningText += delta
				if (reasoningText.trim()) upsert({ key: reasoningKey, kind: "reasoning", text: reasoningText, final: false })
			},
			onContentDelta: (delta) => {
				assistantText += delta
				upsert({ key: assistantKey, kind: "assistant", text: assistantText, final: false })
			},
			onToolStart: (start) => {
				upsert({
					key: `tool:live:${start.callId ?? start.name}`,
					kind: "tool",
					name: start.name,
					args: start.args,
					status: "running",
				})
			},
			onApprove: options?.onApprove ?? approveThrough,
			onError: (message) => {
				upsert({ key: assistantKey, kind: "assistant", text: `error: ${message}`, final: true })
			},
		}).then(() => {
			// Finalize: the vendored `<markdown streaming>` flips off when the
			// message completes, keeping the final tokens (M4 law: streaming
			// lightweight, markdown at finalize is unnecessary — 0.8.1 streams).
			const finalize = (key: string, kind: "assistant" | "reasoning", text: string) => {
				const existing = rows.find((row) => row.key === key)
				if (existing && existing.kind === kind) upsert({ ...existing, text, final: true })
			}
			finalize(reasoningKey, "reasoning", reasoningText)
			finalize(assistantKey, "assistant", assistantText)
			setRows(
				produce((draft) => {
					for (const row of draft) {
						if (row.kind === "tool" && row.status === "running" && row.key.startsWith("tool:live:"))
							row.status = "done"
					}
				}),
			)
		})
	}

	return { rows, hydrated, load, hydrate, apply, send }
}

/** The projection handle a page shares between transcript and composer. */
export type SeamRows = ReturnType<typeof createSeamRows>

/** The approve callback the seam turn asks for when the page wires no
 * overlay surface (batch 5 default). Auto-approving would let tools run
 * silently, rejecting stalls real turns — the shell adapter's host already
 * gates approvals, and pages pass `options.onApprove` to route through the
 * approval card instead. */
async function approveThrough(_name: string, _args: Record<string, unknown>): Promise<SeamApprovalVerdict> {
	return "allowed-once"
}
