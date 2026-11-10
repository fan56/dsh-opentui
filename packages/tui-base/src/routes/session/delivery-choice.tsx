/**
 * Busy-submit delivery choice (steer/queue batch) — the dialog-stack face of
 * `ComposerController.chooseDelivery`.
 *
 * Two rows, Steer first (the vendored default and therefore the default
 * highlight: DialogSelect selects option 0). Enter runs the highlighted row,
 * Esc cancels and the composer keeps the typed text. The dialog goes through
 * the page's ONE dialog stack (`dialog.replace`), so approvals/ask cards
 * opened elsewhere keep their place and this prompt auto-yields.
 *
 * `openDeliveryChoice` never stacks a second overlay on top of an existing
 * one: while any dialog is open the busy submit keeps the vendored behaviour
 * (immediate steer) instead of stealing the screen.
 */
import { DialogSelect } from "../../ui/dialog-select"
import type { DialogContext } from "../../ui/dialog"
import type { ComposerDelivery } from "./composer-state"

export interface DeliveryOption {
	title: string
	value: ComposerDelivery
	description: string
}

/** Steer first = the default highlight (DialogSelect selects option 0). */
export const DELIVERY_OPTIONS: readonly DeliveryOption[] = [
	{
		title: "Steer",
		value: "steer",
		description: "Inject this message into the running turn now",
	},
	{
		title: "Queue",
		value: "queue",
		description: "Send it as the next turn after this one finishes",
	},
]

export function openDeliveryChoice(
	dialog: Pick<DialogContext, "replace" | "clear" | "stack">,
	text: string,
): Promise<ComposerDelivery | undefined> {
	// An approval/ask/other card owns the screen: do not stack a second
	// dialog on top of it. The vendored busy behaviour applies.
	if (dialog.stack.length > 0) return Promise.resolve("steer")
	return new Promise<ComposerDelivery | undefined>((resolveChoice) => {
		let settled = false
		const done = (value: ComposerDelivery | undefined) => {
			if (settled) return
			settled = true
			dialog.clear()
			resolveChoice(value)
		}
		const preview = text.length > 60 ? `${text.slice(0, 57)}…` : text
		dialog.replace(
			() => (
				<DialogSelect<ComposerDelivery>
					title="Turn running — steer or queue?"
					description={`“${preview}”`}
					renderFilter={false}
					options={DELIVERY_OPTIONS.map((option) => ({
						title: option.title,
						value: option.value,
						description: option.description,
					}))}
					onSelect={(option) => done(option.value)}
					onCancel={() => done(undefined)}
				/>
			),
			() => done(undefined),
		)
	})
}
