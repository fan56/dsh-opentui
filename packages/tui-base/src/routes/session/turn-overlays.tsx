/**
 * Turn overlay host: the approval card and the ask surface.
 *
 * Component mapping:
 *   ui/dialog-confirm  DialogConfirm  → ApprovalCard  (tool approval:
 *       tool name + args summary, enter = allow, esc/cancel = reject) — still
 *       a vendored dialog, per the task split.
 *   the in-flow dock                 → AskPanel      (`ask-panel.tsx`): the
 *       ask surface left the dialog stack entirely (spec §2) and renders in
 *       the dock's composer seat instead, full width, in flow.
 *
 * One interaction slot, first-come-first-served in the sense the shipped host
 * already had: while an approval is pending it wins the slot (the old
 * `dialog.replace` behavior) and the ask waits; an ask that is ALREADY on
 * screen keeps the slot until it settles, so the two surfaces never coexist
 * and the dock is never torn down underneath a dialog (which would hand the
 * composer focus to a hidden surface after layout). The full id-ordered
 * admission slot is the next task (spec §7).
 *
 * `TurnOverlayHost.onIdle`'s 3 ms reclaim stays for the approval dialog path
 * (the vendored provider refocuses at 1 ms); the dock refocuses the composer
 * itself, by ref, after layout (spec §10).
 */
import { createEffect, createSignal, onCleanup, onMount, Show, type JSX } from "solid-js"
import { onAnimationTick } from "@opentui/solid"
import type { SeamApprovalVerdict, SeamAskPick, SeamAskQuestion } from "../../seams/session"
import { DialogConfirm } from "../../ui/dialog-confirm"
import { useDialog } from "../../ui/dialog"
import { TurnOverlayController } from "./turn-overlay-controller"
import { useThemeOptional } from "../../context/theme"
import { t } from "../../i18n"
import { motionAnimationRunning, motionDecorationsEnabled, motionFrameRate } from "../../skin/motion"
import { warningColor } from "../../skin/semantic"
import { mixSkinColor, skinPulseBrightness, SKIN_PULSE_MS } from "./widgets-dock"
import { AskPanel } from "./ask-panel"
import { estimateAskRows } from "./ask-options"
import { useDock, type DockFocusable, type DockHandle } from "./dock-host"

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
			// Reminder marker (skin contract §1 提醒脉冲): `⚠` marks the card.
			// DialogConfirm's title is a plain string, so the PULSE (3 bright/
			// dim cycles on the marker color only) rides the ask card's
			// titleView path below; here the marker is static — pulsing it
			// needs DialogConfirm to forward a titleView (vendored file, later
			// lane).
			title={t("overlay.ask.approvalTitle", { name: props.name })}
			message={summarizeArgs(props.name, props.args)}
			label={{ confirm: t("overlay.ask.allow"), cancel: t("overlay.ask.reject") }}
			onConfirm={() => props.onVerdict("allowed-once")}
			onCancel={() => props.onVerdict("rejected")}
		/>
	)
}

/** The pulsing reminder badge (skin contract §1 提醒脉冲): the `⚠` marker
 * text dips bright→dim 3 times over ≈1.2s on the shared motion clock, then
 * rests at full color. ONLY the marker text moves — the card frame never
 * changes (no border animation, §2.3). reduced/off tiers rest immediately. */
export function ReminderBadge(): JSX.Element {
	const theme = useThemeOptional()
	const [tick, setTick] = createSignal(0)
	const startedAt = Date.now()
	const pulsing = () => motionDecorationsEnabled() && Date.now() - startedAt < SKIN_PULSE_MS
	onAnimationTick(() => (pulsing() && motionAnimationRunning() ? motionFrameRate() : undefined), () => setTick((t) => t + 1))
	const fg = () => {
		tick()
		const target = warningColor(theme)
		if (!motionDecorationsEnabled()) return target
		const bright = skinPulseBrightness(Date.now() - startedAt)
		return bright >= 1 ? target : mixSkinColor(target, theme?.background.base ?? "#000000", 1 - bright)
	}
	return (
		<text fg={fg()} flexShrink={0}>
			{"⚠ "}
		</text>
	)
}

/**
 * Mounts the controller's pending overlays: one approval card on the vendored
 * dialog stack, one ask panel in the in-flow dock. `reclaimFocus` fires after
 * each drain for the dialog path (the dock owns its own refocus).
 *
 * SEAM (next task): the dock's key layer, the staged Esc/Ctrl+C ladder, digit
 * gating and the id-ordered admission slot. This host only mounts and
 * unmounts surfaces; `AskPanel` owns the body and registers its focus target.
 */
export function TurnOverlayHost(props: {
	controller: TurnOverlayController
	reclaimFocus?: () => void
}) {
	const dialog = useDialog()
	const dock = useDock()
	const [version, setVersion] = createSignal(0)
	onMount(() => {
		const unsubscribe = props.controller.subscribe(() => setVersion((value) => value + 1))
		onCleanup(unsubscribe)
	})
	// Approval path only: the DialogProvider's own refocus runs at 1 ms; we
	// check at 3 ms. The dock does NOT use this timer (spec §10).
	props.controller.onIdle(() => {
		setTimeout(() => props.reclaimFocus?.(), 3)
	})

	/** The ask panel's focus resolver, registered by the mounted body. */
	let panelFocus: (() => DockFocusable | undefined) | undefined
	let askHandle: DockHandle | undefined
	let askId: number | undefined
	let shown: string | undefined

	function closeAsk(): void {
		askHandle?.close()
		askHandle = undefined
		askId = undefined
	}

	// Diff by overlay descriptor: `dialog.replace` mutates the tracked stack,
	// so an effect reading it re-triggers itself and remounts the card every
	// frame (keymap layers churn, dispatch dies). Only act when the SHOWN
	// overlay actually changed. Each dialog entry's `onClose` settles only if
	// its overlay is still the shown one, so replace-over never settles the
	// NEW head by proxy.
	createEffect(() => {
		version()
		const approval = props.controller.pendingApproval
		const ask = props.controller.pendingAsk
		// An ask already on screen holds the slot until it settles: closing the
		// dock to open a dialog would refocus the composer under that dialog.
		const askShowing = askHandle !== undefined && ask !== undefined && askId === ask.id
		const key = approval !== undefined && !askShowing ? `approval:${approval.id}` : ask ? `ask:${ask.id}` : ""
		if (key === shown) return
		shown = key

		if (approval !== undefined && !askShowing) {
			// Approval wins the slot (today's serialization). The ask stays
			// queued in the controller and reopens when the approval settles.
			closeAsk()
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
				{ tone: "warning" },
			)
			return
		}

		if (ask !== undefined) {
			if (askHandle !== undefined && askId === ask.id) return
			// A new head (or the first one). The dock slot is REUSED: open the
			// next request first, then settle the previous one, so the queue
			// never empties (no frame pop/push churn, and the composer is not
			// refocused between two interactions — spec §7 hand-off, §10).
			const previous = askHandle
			askId = ask.id
			askHandle = dock.open(
				(ctx) => (
					<AskPanel
						controller={props.controller}
						width={ctx.width}
						onFocusTarget={(resolve) => {
							panelFocus = resolve
						}}
					/>
				),
				{
					kind: "ask",
					contentRows: estimateAskRows(ask),
					focusRef: () => panelFocus?.(),
					overflowLabel: (hidden) => t("overlay.ask.overflow", { count: hidden }),
				},
			)
			previous?.close()
			return
		}

		// No overlay left: release the dock seat. The trailing `dialog.clear()`
		// is gone (spec §7): with approval and ask off the dialog stack it
		// would close whatever dialog the page itself opened.
		closeAsk()
	})
	onCleanup(closeAsk)
	// The overlays render through the dialog stack (approval) and the dock
	// (ask), not this slot.
	return <Show when={false}>{null}</Show>
}

/** Register both surfaces on a seam: approval routes through the view's
 * turn callbacks, ask through the seam's ask provider. */
export function registerTurnOverlays(seam: {
	registerAskProvider(onAsk: (questions: SeamAskQuestion[]) => Promise<SeamAskPick[]>): void
}, controller: TurnOverlayController): void {
	seam.registerAskProvider((questions) => controller.answer(questions))
}
