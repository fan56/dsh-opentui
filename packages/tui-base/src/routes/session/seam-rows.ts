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
 *
 * SETTLE SUPERSEDE (batch V4): a streamed turn paints `user:local-N` /
 * `reasoning:live-N` / `assistant:live-N` rows whose assistant text is the
 * RAW stream — which can differ from the durable body. Verified live
 * (fv-07 follow-up): a model can stream a first rendition, leaked
 * self-talk, then a rewritten list — all into ONE turn (one live row,
 * one turn/end bracket). The durable journal body is the CLEAN single
 * rendition. The vendored view finalizes against the server's message
 * state, so scrolled history shows the durable text; keeping the raw
 * stream instead is the fv-07 defect (scrolled `42. hail - let me
 * write: Hailstorms…` vs settled `42. Hailstorms occasionally pelt…`).
 * Two mechanisms, one law — after a turn settles the store holds the
 * DURABLE body, once:
 *
 *   1. CONVERGE (healthy path): on settle, `send()` pulls
 *      `storedTranscript` and patches the live assistant row's text to
 *      the durable body in place (same key — no remount), and drops the
 *      streamed reasoning row — the stored transcript carries neither a
 *      reasoning kind nor the streamed wording, so the settled view
 *      equals the reload view. Error turns keep their `error: …` row (a
 *      failed turn persists no body).
 *   2. JOURNAL SETTLE (replay path): post-turn wire events — gap replay
 *      after a mid-turn stream death, reattach, resume — arrive under
 *      real message-id keys; a plain upsert would APPEND a second body.
 *      So a wire-journal assistant text event landing while no send() is
 *      in flight supersedes the oldest streamed group atomically (one
 *      `produce`): the live rows are removed and the settled row takes
 *      the streamed body's position. Wire provenance is the presence of
 *      `details.sessionID`: both adapters stamp every projected journal
 *      event with it (the session filter reads it), while page-injected
 *      feedback (the slash hosts' `say`) does not — command feedback must
 *      never rewrite a settled turn.
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

/** One streamed turn's replaceable rows (see SETTLE SUPERSEDE in the header). */
interface LiveTurnGroup {
	userKey: string
	reasoningKey: string
	assistantKey: string
	/** A journal prompt row replaced the optimistic local one (replay). */
	userSuperseded: boolean
}

export function createSeamRows(
	seam: SessionSeam,
	sessionID: Accessor<string>,
	options?: { onApprove?: SeamTurnCallbacks["onApprove"] },
) {
	const [rows, setRows] = createStore<SeamRow[]>([])
	const [hydrated, setHydrated] = createSignal(false)
	let liveOrdinal = 0
	/** A send()'s turn is awaiting the seam (journal events during this
	 * window are the suppression contract's other half — the adapters). */
	let turnOpen = false
	/** Streamed turns awaiting their journal settle, oldest first. */
	const pendingTurns: LiveTurnGroup[] = []

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

	/** Remove rows by key, highest index first (one produce). */
	function dropRows(keys: ReadonlySet<string>) {
		setRows(
			produce((draft) => {
				for (let i = draft.length - 1; i >= 0; i--) {
					if (keys.has(draft[i]!.key)) draft.splice(i, 1)
				}
			}),
		)
	}

	/** Journal settle for the oldest streamed turn: drop its live rows and
	 * take the settled body's place — one produce, so the store never
	 * renders two bodies for the turn. Tool blocks stay (the journal does
	 * not project them); reasoning drops like a reload (stored transcripts
	 * carry no reasoning rows). A journal prompt row that replayed BELOW the
	 * streamed body moves up so [prompt, body] order holds. */
	function supersedeSettledTurn(group: LiveTurnGroup, settled: SeamRow | undefined) {
		setRows(
			produce((draft) => {
				const assistantAt = draft.findIndex((row) => row.key === group.assistantKey)
				// The prompt row is owned by the user-event handler (a replayed
				// journal prompt removed `user:local` on arrival; with no journal
				// prompt the local one stays as the prompt). Never doomed here.
				const doomed = new Set([group.reasoningKey, group.assistantKey])
				let removedBefore = 0
				for (let i = draft.length - 1; i >= 0; i--) {
					if (!doomed.has(draft[i]!.key)) continue
					draft.splice(i, 1)
					if (i < assistantAt) removedBefore += 1
				}
				if (settled === undefined) return
				let insertAt = assistantAt === -1 ? draft.length : assistantAt - removedBefore
				// Replay order parked the journal prompt at the tail (below the
				// streamed body this produce just removed) — keep it above the body.
				// Journal user keys are `user:<id>`; stored history (`stored:user:N`)
				// and optimistic locals (`user:local-N`) are neither. Scanned from
				// the tail at/below the insert point: earlier turns' prompts sit
				// above and stay put.
				let journalUserAt = -1
				for (let i = draft.length - 1; i >= insertAt; i--) {
					const row = draft[i]!
					if (row.kind === "user" && row.key.startsWith("user:") && !row.key.startsWith("user:local")) {
						journalUserAt = i
						break
					}
				}
				if (journalUserAt !== -1) {
					const prompt = draft[journalUserAt]!
					draft.splice(journalUserAt, 1)
					draft.splice(insertAt, 0, prompt)
					insertAt += 1
				}
				draft.splice(insertAt, 0, settled)
			}),
		)
	}

	function apply(event: SeamSessionEvent) {
		const details = (event.details ?? {}) as Record<string, unknown>
		if (typeof details.sessionID === "string" && details.sessionID !== sessionID()) return
		if (event.type === "message.updated" && details.role === "user") {
			const id = typeof details.id === "string" ? details.id : `local-${++liveOrdinal}`
			const text = typeof details.text === "string" ? details.text : ""
			// Journal prompt for a streamed turn (replay order: prompt record
			// first): retire the optimistic `user:local-N` copy so the store
			// holds one prompt; the keyed journal row becomes THE prompt row
			// (stable on re-delivery). Same text by construction — guard anyway.
			if (!turnOpen && pendingTurns.length > 0 && typeof details.sessionID === "string") {
				const group = pendingTurns[0]!
				const local = rows.find((row) => row.key === group.userKey)
				if (!local || local.kind !== "user" || local.text.trim() === text.trim()) {
					group.userSuperseded = true
					dropRows(new Set([group.userKey]))
				}
			}
			upsert({
				key: `user:${id}`,
				kind: "user",
				text,
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
			// SETTLE SUPERSEDE: a wire-journal assistant body arriving while no
			// send() is in flight is the durable body of the oldest streamed
			// turn — replace that turn's live rows instead of appending a
			// second body (header note; fv-07 double-body defect).
			if (partType === "text" && !turnOpen && pendingTurns.length > 0 && typeof details.sessionID === "string") {
				const group = pendingTurns.shift()!
				const settled: SeamRow | undefined = text.trim()
					? { key: `${kind}:${messageID}:${partID}`, kind: "assistant", text, final: true }
					: undefined
				supersedeSettledTurn(group, settled)
				return
			}
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
		const userKey = `user:local-${++liveOrdinal}`
		upsert({ key: userKey, kind: "user", text: prompt, final: true })
		const assistantKey = `assistant:live-${++liveOrdinal}`
		const reasoningKey = `reasoning:live-${liveOrdinal}`
		const group: LiveTurnGroup = { userKey, reasoningKey, assistantKey, userSuperseded: false }
		pendingTurns.push(group)
		let assistantText = ""
		let reasoningText = ""
		let turnErrored = false
		turnOpen = true
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
			// Batch V1: the follow stream's tool/result settles the row live —
			// status flips here (not only at turn finalize) and the result brief
			// rides the row for the `⎿` track. Unknown callId (result racing a
			// fresh begin) still lands keyed by callId so it is findable.
			onToolRun: (run) => {
				upsert({
					key: `tool:live:${run.callId ?? run.name}`,
					kind: "tool",
					name: run.name,
					args: run.argsPretty,
					status: run.ok ? "done" : "failed",
					output: run.output,
				})
			},
			onApprove: options?.onApprove ?? approveThrough,
			onError: (message) => {
				turnErrored = true
				upsert({ key: assistantKey, kind: "assistant", text: `error: ${message}`, final: true })
			},
		})
			.finally(() => {
				// The await is over: journal events from here on are post-turn
				// (the settle supersede in apply() arms against them). Flips
				// before the finalize pass so no event window opens between.
				turnOpen = false
			})
			.then(() => {
				// Finalize: the vendored `<markdown streaming>` flips off when the
				// message completes, keeping the final tokens (M4 law: streaming
				// lightweight, markdown at finalize is unnecessary — 0.8.1 streams).
				const finalize = (key: string, kind: "assistant" | "reasoning", text: string) => {
					if (kind === "assistant" && turnErrored) return // the error row IS the final body
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
				// SETTLE CONVERGE (batch V4, mechanism 1): the streamed text can
				// differ from the durable body (mid-stream revisions, leaked
				// self-talk — the fv-07 defect), and the streamed reasoning
				// block holds the model's DRAFTS with their own numbered
				// rewrites — the fv-07 "second body" (scrolled gray rows said
				// `44. … smog can briefly accumulate…` while the settled body
				// said `44. … haze can briefly accumulate…`). The stored
				// transcript carries neither (journalToTranscriptRows keeps
				// user/assistant/tool only), so post-settle the turn converges
				// to the durable shape: body text patched to the durable copy
				// IN PLACE (same key, no remount) and the streamed reasoning
				// row dropped — settled view == reload view. A failed turn
				// persists no assistant body — its `error: …` row stands.
				if (turnErrored) return
				// The session id exists only AFTER the turn arms (the facade
				// attaches during seam.turn — at send() start it is still
				// undefined), so capture here, not at send() entry. The id
				// stays attached across a COMPLETED turn; abort detaches it.
				const id = sessionID()
				return seam
					.storedTranscript(id)
					.then((stored) => {
						// A session switch to ANOTHER session voids the patch; an
						// empty read (abort-detached facade) fails open below.
						const nowId = sessionID()
						if (turnOpen || (nowId !== id && nowId !== "")) return
						const durable = [...stored].reverse().find((row) => row.kind === "assistant" && row.text.trim())
						// No durable body (empty/erroring store) — leave the rows as
						// streamed; the reasoning drop rides a successful converge
						// only, never a half-converge.
						if (!durable) return
						const live = rows.find((row) => row.key === assistantKey)
						setRows(
							produce((draft) => {
								for (let i = draft.length - 1; i >= 0; i--) {
									if (draft[i]!.key === reasoningKey) draft.splice(i, 1)
								}
								if (durable && live && live.kind === "assistant" && live.text !== durable.text) {
									const index = draft.findIndex((row) => row.key === assistantKey)
									if (index !== -1) Object.assign(draft[index], { text: durable.text, final: true })
								}
							}),
						)
					})
					.catch(() => undefined)
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
