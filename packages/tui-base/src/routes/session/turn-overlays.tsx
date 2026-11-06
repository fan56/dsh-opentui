/**
 * Turn overlay surfaces (batch 5): the rebuilt approval + ask surfaces on
 * the VENDORED dialog components, wired through SessionSeam.
 *
 * Component mapping (vendored → our surface):
 *   ui/dialog-confirm  DialogConfirm  → ApprovalCard  (tool approval:
 *       tool name + args summary, enter = allow, esc/cancel = reject)
 *   ui/dialog-select   DialogSelect   → AskPicker      (one question +
 *       its options, arrows + enter; esc declines the whole batch)
 *
 * Both mount through the vendored DialogProvider stack (`dialog.replace`),
 * which captures the currently focused renderable on open and refocuses it
 * when the stack drains — that is the OpenTUI focus law. `TurnOverlayHost`
 * additionally re-asserts composer focus on the controller's idle hook
 * (belt and braces against the login-era bug: overlay closed, editor
 * stayed blurred because a stale focused flag said otherwise).
 */
import { createEffect, createSignal, onCleanup, onMount, untrack, Show } from "solid-js"
import type { SeamApprovalVerdict, SeamAskPick, SeamAskQuestion } from "../../seams/session"
import { DialogConfirm } from "../../ui/dialog-confirm"
import { DialogSelect, type DialogSelectOption, type DialogSelectRef } from "../../ui/dialog-select"
import { useDialog } from "../../ui/dialog"
import { TurnOverlayController, type PendingAsk } from "./turn-overlay-controller"

/** One-line args summary for the approval card message. */
export function summarizeArgs(name: string, args: Record<string, unknown>, limit = 160): string {
	let body = JSON.stringify(args)
	if (body === undefined) body = ""
	body = body.trim()
	if (body.length > limit) body = body.slice(0, limit - 1) + "…"
	return `${name} ${body}`.trim()
}

export function ApprovalCard(props: {
	name: string
	args: Record<string, unknown>
	onVerdict: (verdict: SeamApprovalVerdict) => void
}) {
	return (
		<DialogConfirm
			title={`Approval: ${props.name}`}
			message={summarizeArgs(props.name, props.args)}
			label={{ confirm: "allow", cancel: "reject" }}
			onConfirm={() => props.onVerdict("allowed-once")}
			onCancel={() => props.onVerdict("rejected")}
		/>
	)
}

/**
 * One-line tab strip for a multi-question batch (tui-pi parity):
 * `[1] · 2✓ · 3` — brackets mark the focused tab, ✓ an answered one.
 * Pure so tests and the renderer share one vocabulary.
 */
export function askTabStrip(questions: SeamAskQuestion[], picks: readonly (readonly string[])[], index: number): string {
	return questions
		.map((_, qi) => {
			const answered = (picks[qi]?.length ?? 0) > 0
			const label = `${qi + 1}${answered ? "✓" : ""}`
			return qi === index ? `[${label}]` : label
		})
		.join(" · ")
}

/** Progress title: `(i/n)` prefix once the batch has ≥ 2 questions. */
export function askProgressTitle(questions: SeamAskQuestion[], index: number): string {
	if (questions.length < 2) return "Question"
	return `Question (${index + 1}/${questions.length})`
}

/** Whether the picker needs the explicit review row (≥ 2 questions or any multiSelect). */
export function askNeedsReview(questions: SeamAskQuestion[]): boolean {
	return questions.length >= 2 || questions.some((question) => question.multiSelect === true)
}

function truncate70(text: string): string {
	return text.length > 70 ? text.slice(0, 69) + "…" : text
}

/**
 * The ask surface (feature batch F5, tui-pi parity): ONE dialog over the
 * whole question batch. Per question: a `(i/n)` progress title, a tab strip
 * (`[1] · 2✓ · 3`), ←/→ to switch tabs (questions ≥ 2), space/enter to
 * toggle — single-select replaces and auto-advances, multiSelect toggles in
 * place — and a `⏎ Review answers` row once the batch needs one. The review
 * page lists every question with its picks, ← returns to edit, enter on the
 * submit row settles the batch. Esc at ANY point still declines the whole
 * batch (unchanged contract).
 *
 * Reactivity: the dialog mounts once per ask batch (the host keys by batch
 * id) and re-renders from controller state through its own subscription;
 * every DialogSelect prop reads the batch through a getter so the fine-
 * grained updates track (getter props rule).
 */
export function AskPicker(props: {
	controller: TurnOverlayController
	onDecline: () => void
}) {
	const [version, setVersion] = createSignal(0)
	onMount(() => {
		const unsubscribe = props.controller.subscribe(() => setVersion((v) => v + 1))
		onCleanup(unsubscribe)
	})
	const ask = (): PendingAsk | undefined => {
		version()
		return props.controller.pendingAsk
	}

	return (
		<Show
			when={ask()?.phase === "review"}
			fallback={<AskQuestionsView ask={ask} controller={props.controller} onDecline={props.onDecline} />}
		>
			<AskReviewView ask={ask} controller={props.controller} onDecline={props.onDecline} />
		</Show>
	)
}

/** Review-row discriminator: a question row (enter = edit it) or the submit row. */
type AskRowValue = { kind: "question"; qi: number } | { kind: "submit" } | { kind: "review" }

/** The questions phase: focused question's options + tab strip + ←/→/space. */
function AskQuestionsView(props: {
	ask: () => PendingAsk | undefined
	controller: TurnOverlayController
	onDecline: () => void
}) {
	const batch = () => props.ask()
	const question = () => {
		const b = batch()
		return b?.questions[b.index]
	}
	const multi = () => question()?.multiSelect === true
	const picked = () => {
		const b = batch()
		return b?.picks[b.index] ?? []
	}
	const options = (): DialogSelectOption<string | AskRowValue>[] => {
		const q = question()
		const p = picked()
		if (!q) return []
		const rows: DialogSelectOption<string | AskRowValue>[] = q.options.map((option) => ({
			title: multi() ? (p.includes(option) ? `[x] ${option}` : `[ ] ${option}`) : option,
			value: option,
		}))
		if (askNeedsReview(batch()?.questions ?? [])) rows.push({ title: "⏎ Review answers", value: { kind: "review" } })
		return rows
	}
	const description = (): string | undefined => {
		const b = batch()
		if (!b) return undefined
		const parts: string[] = []
		if (b.questions.length >= 2) parts.push(askTabStrip(b.questions, b.picks, b.index))
		if (multi()) parts.push("space: toggle")
		return parts.join("  ·  ") || undefined
	}
	const toggleHighlighted = () => {
		const option = selectRefRef?.selected
		if (option && typeof option.value === "string") props.controller.toggle(option.value)
	}
	const bindings = () => {
		const b = batch()
		return [
			...(b && b.questions.length >= 2
				? [
						{ id: "ask.prev_question", title: "Previous question", group: "Dialog", bind: "left", run: () => props.controller.switchFocus(-1) },
						{ id: "ask.next_question", title: "Next question", group: "Dialog", bind: "right", run: () => props.controller.switchFocus(1) },
					]
				: []),
			{ id: "ask.toggle", title: "Toggle option", group: "Dialog", bind: "space", run: toggleHighlighted },
		]
	}
	const title = () => {
		const b = batch()
		const q = question()
		if (!b || !q) return ""
		return `${askProgressTitle(b.questions, b.index)}: ${truncate70(q.prompt)}`
	}
	let selectRefRef: DialogSelectRef<string | AskRowValue> | undefined
	return (
		<DialogSelect<string | AskRowValue>
			title={title()}
			description={description()}
			renderFilter={false}
			options={options()}
			current={multi() ? undefined : picked()[0]}
			ref={(r) => (selectRefRef = r)}
			bindings={bindings()}
			onSelect={(option) => {
				if (typeof option.value === "string") props.controller.toggle(option.value)
				else props.controller.enterReview()
			}}
			onCancel={props.onDecline}
		/>
	)
}

/** The review phase: every question + its picks, ← back, enter submits. */
function AskReviewView(props: {
	ask: () => PendingAsk | undefined
	controller: TurnOverlayController
	onDecline: () => void
}) {
	const options = (): DialogSelectOption<string | AskRowValue>[] => {
		const b = props.ask()
		if (!b) return []
		const rows: DialogSelectOption<string | AskRowValue>[] = b.questions.map((question, qi) => {
			const picks = b.picks[qi] ?? []
			return {
				title: `${truncate70(question.prompt)}  ${picks.length > 0 ? picks.join(", ") : "—"}`,
				value: { kind: "question", qi },
			}
		})
		rows.push({ title: "⏎ Submit answers", value: { kind: "submit" } })
		return rows
	}
	return (
		<DialogSelect<string | AskRowValue>
			title="Review answers"
			description="←: edit · enter: submit"
			renderFilter={false}
			options={options()}
			bindings={[
				{ id: "ask.back_to_questions", title: "Edit answers", group: "Dialog", bind: "left", run: () => props.controller.backToQuestions() },
			]}
			onSelect={(option) => {
				if (typeof option.value === "string") return
				if (option.value.kind === "submit") props.controller.submit()
				else if (option.value.kind === "question") props.controller.backToQuestions(option.value.qi)
			}}
			onCancel={props.onDecline}
		/>
	)
}

/**
 * Renders the controller's pending overlays through the vendored dialog
 * stack: one approval card or one ask picker at a time (a multi-question
 * ask mounts ONE batch picker, F5). `reclaimFocus` fires after each drain
 * — pass the composer's focused-flag ref there.
 */
export function TurnOverlayHost(props: {
	controller: TurnOverlayController
	reclaimFocus?: () => void
}) {
	const dialog = useDialog()
	const [version, setVersion] = createSignal(0)
	onMount(() => {
		const unsubscribe = props.controller.subscribe(() => setVersion((v) => v + 1))
		onCleanup(unsubscribe)
	})
	// Every drain to empty: re-assert editor focus after the vendored
	// DialogProvider's own refocus (it schedules at 1 ms; we check at 3 ms).
	props.controller.onIdle(() => {
		setTimeout(() => props.reclaimFocus?.(), 3)
	})

	// Diff by overlay descriptor: `dialog.replace` itself mutates the tracked
	// dialog stack, so an effect that reads the stack re-triggers itself and
	// remounts the card every frame (keymap layers churn, dispatch dies).
	// Only replace when the shown overlay actually changed; the stack read
	// for the final clear is untracked.
	//
	// Each replace registers the stack item's `onClose` (what the vendored
	// DialogProvider modal escape/ctrl+c invoke when the surface itself has
	// no escape binding — legacy DialogConfirm doesn't). It settles only if
	// its overlay is still the shown one, so replace-over (question
	// advance, next queued approval) never settles the NEW head by proxy.
	let shown: string | undefined
	createEffect(() => {
		version()
		const approval = props.controller.pendingApproval
		const ask = props.controller.pendingAsk
		const key = approval
			? `approval:${approval.id}`
			: ask
				? `ask:${ask.id}`
				: ""
		if (key === shown) return
		shown = key
		if (approval) {
			const atOpen = key
			dialog.replace(
				() => (
					<ApprovalCard
						name={approval.name}
						args={approval.args}
						onVerdict={(verdict) => {
							if (verdict === "allowed-once") props.controller.confirmApproval()
							else props.controller.rejectApproval()
						}}
					/>
				),
				() => {
					if (shown === atOpen) props.controller.rejectApproval()
				},
			)
			return
		}
		if (ask) {
			// One dialog per ask BATCH (F5): the picker reacts to controller
			// state internally (tab switches, toggles, review phase) instead
			// of remounting per question.
			const atOpen = key
			dialog.replace(
				() => <AskPicker controller={props.controller} onDecline={() => props.controller.decline()} />,
				() => {
					if (shown === atOpen) props.controller.decline()
				},
			)
			return
		}
		if (untrack(() => dialog.stack.length) > 0) dialog.clear()
	})
	// The overlays render through the vendored dialog stack, not this slot.
	return <Show when={false}>{null}</Show>
}

/** Register both surfaces on a seam: approval routes through the view's
 * turn callbacks, ask through the seam's ask provider. */
export function registerTurnOverlays(seam: {
	registerAskProvider(onAsk: (questions: SeamAskQuestion[]) => Promise<SeamAskPick[]>): void
}, controller: TurnOverlayController): void {
	seam.registerAskProvider((questions) => controller.answer(questions))
}
