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
import { DialogSelect } from "../../ui/dialog-select"
import { useDialog } from "../../ui/dialog"
import { TurnOverlayController } from "./turn-overlay-controller"

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

export function AskPicker(props: {
	question: SeamAskQuestion
	onPick: (selected: string | undefined) => void
}) {
	return (
		<DialogSelect<string>
			title={props.question.prompt.length > 70 ? props.question.prompt.slice(0, 69) + "…" : props.question.prompt}
			renderFilter={false}
			options={props.question.options.map((option) => ({ title: option, value: option }))}
			onSelect={(option) => props.onPick(option.value)}
			onCancel={() => props.onPick(undefined)}
		/>
	)
}

/**
 * Renders the controller's pending overlays through the vendored dialog
 * stack: one approval card or one ask picker at a time (multi-question
 * asks advance picker by picker via `dialog.replace`). `reclaimFocus`
 * fires after each drain — pass the composer's focused-flag ref there.
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
				? `ask:${ask.id}:${ask.index}`
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
		const question = ask?.questions[ask.index]
		if (question) {
			const atOpen = key
			dialog.replace(
				() => (
					<AskPicker
						question={question}
						onPick={(selected) => {
							if (selected === undefined) props.controller.decline()
							else props.controller.pick(selected)
						}}
					/>
				),
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
