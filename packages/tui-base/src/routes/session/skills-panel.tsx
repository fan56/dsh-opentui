/**
 * SkillsPanel — the /skills manager panel (gap C3, tui-pi skills-manager
 * parity).
 *
 * One combined Installed/Available view over the local skill roots (the
 * host has NO skills management RPC — see skills-manage.ts): the source
 * root is the agents home's `skills/`, the curated root is
 * `<dshHome>/skills/`, and a row is `installed` when the curated root holds
 * a symlink for it. The reference's shipped shape is this single list with
 * the installed flag per row (its header comment says "dual mode", but the
 * code has no Tab view switch — parity follows the CODE).
 *
 * ACTIONS (tui-pi semantics): space toggles the selected row's pending
 * state, enter applies the whole pending batch as symlink create/deletes
 * (or toggles when nothing is pending), `/` filters, esc pops the filter
 * first and asks before discarding pending changes (the reference's Y/N
 * confirm, rendered through DialogConfirm). Batch feedback is the
 * reference's one-line summary: `applied ok/total — ok: … · failed: name
 * (reason)` with the short-reason collapse; the list rescans after every
 * batch either way (a failed batch must not leave a dead panel).
 *
 * Rows ride the module bridge signal for the open state (the /plugins
 * panel law); the roots ride GETTER props (the reactive-prop law).
 */
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import type { InputRenderable } from "@opentui/core"
import { TextAttributes } from "@opentui/core"
import { Keymap } from "../../context/keymap"
import { useDialog } from "../../ui/dialog"
import { DialogConfirm } from "../../ui/dialog-confirm"
import { useThemeOptional } from "../../context/theme"
import { successColor, warningColor } from "../../skin/semantic"
import {
	applyOneSkillChange,
	ensureCuratedDir,
	filterSkillRows,
	scanAvailableSkills,
	skillApplySummary,
	skillStateText,
	type SkillApplyResult,
	type SkillManageRow,
} from "./skills-manage"

const [bridgeOpen, setBridgeOpen] = createSignal(false)
// Module-scope open state: the session sidebar Esc layer (priority 10)
// yields while the panel owns the screen.
const [panelOpen, setPanelOpen] = createSignal(false)
/** Whether the /skills manager is on screen. */
export const skillsPanelOpen = panelOpen

/** Open the skills manager panel (the /skills command path). */
export function openSkillsPanel(): void {
	setBridgeOpen(true)
}

/**
 * The panel's module-scope open state. Unmount resets it: the sidebar's
 * priority-10 Esc layer yields on this signal, so a stale `true` would leave
 * Esc dead for the rest of the session.
 */
export function useSkillsPanelOpenState() {
	onCleanup(() => setPanelOpen(false))
	return [skillsPanelOpen, setPanelOpen] as const
}

/** One rendered table line: the marker + padded skill name. */
export function formatSkillLine(row: { name: string }, selected: boolean): string {
	return `${selected ? "› " : "  "}${row.name.padEnd(30)}`
}

export function SkillsPanel(props: {
	/** GETTER props (reactive-prop law): the source (public) skill root. */
	source: () => string
	/** The curated (user) root the symlinks are written into. */
	curated: () => string
	onClosed?: () => void
}) {
	const theme = useThemeOptional()
	const dialog = useDialog()

	const [open, setOpen] = useSkillsPanelOpenState()
	const [filterOpen, setFilterOpen] = createSignal(false)
	const [filter, setFilter] = createSignal("")
	const [cursor, setCursor] = createSignal(0)
	const [busy, setBusy] = createSignal(false)
	const [rows, setRows] = createSignal<SkillManageRow[]>([])
	const [status, setStatus] = createSignal<string | undefined>(undefined)
	/** Pending changes: name → target state (true=install, false=uninstall). */
	const [pending, setPending] = createSignal<Map<string, boolean>>(new Map())
	let statusTimer: ReturnType<typeof setTimeout> | undefined
	onCleanup(() => clearTimeout(statusTimer))

	createEffect(() => {
		if (bridgeOpen()) {
			setBridgeOpen(false)
			setFilter("")
			setFilterOpen(false)
			setCursor(0)
			setPending(new Map())
			setOpen(true)
			void rescan()
		}
	})

	/** One status line (undefined clears); notices auto-clear. */
	function flash(message: string | undefined, autoClearMs?: number) {
		clearTimeout(statusTimer)
		setStatus(message)
		if (autoClearMs !== undefined) {
			statusTimer = setTimeout(() => setStatus(undefined), autoClearMs)
		}
	}

	/** Rescan both roots; an empty source root renders the empty copy. */
	async function rescan(notice?: string) {
		if (notice === undefined) flash("scanning…")
		const scanned = await scanAvailableSkills(props.source(), props.curated())
		setRows(scanned)
		if (notice !== undefined) {
			// The reference's preserved-notice parity: the batch summary rides
			// above the rebuilt rows (a failed batch must stay visible).
			flash(notice, 10000)
		} else {
			flash(undefined)
		}
	}

	function close() {
		if (filterOpen()) {
			// First escape pops the filter (the reference's two-stage esc).
			setFilterOpen(false)
			setFilter("")
			return
		}
		if (pending().size > 0) {
			// The reference's ESC-with-unsaved-changes confirm.
			const count = pending().size
			dialog.replace(
				() => (
					<DialogConfirm
						title={`Discard ${count} pending change${count === 1 ? "" : "s"}?`}
						message="Pending install/uninstall marks are not applied yet."
						label={{ confirm: "Discard", cancel: "Keep editing" }}
						onConfirm={() => {
							setPending(new Map())
							setOpen(false)
							setTimeout(() => props.onClosed?.(), 3)
						}}
					/>
				),
				undefined,
				{ tone: "warning" },
			)
			return
		}
		setOpen(false)
		// Refocus AFTER the teardown (the SearchOverlay H1 law — see the
		// /plugins panel's C15 note).
		setTimeout(() => props.onClosed?.(), 3)
	}

	const visible = createMemo(() => filterSkillRows(rows(), filter()))
	/** The cursor, clamped into the current window (filters shrink it). */
	const current = createMemo(() => {
		const list = visible()
		return list[Math.min(cursor(), list.length - 1)]
	})
	/** The selected row's index within the painted window (−1 = none). */
	const cursorIndex = createMemo(() => visible().slice(0, 12).indexOf(current()))

	function moveCursor(delta: number) {
		const count = visible().length
		if (count === 0) return
		setCursor(Math.max(0, Math.min(cursor() + delta, count - 1)))
	}

	/** Space: mark the selected row's opposite target state (busy-safe). */
	function togglePending(row: SkillManageRow | undefined) {
		if (row === undefined || busy()) return
		const effective = pending().get(row.name) ?? row.installed
		const next = new Map(pending())
		next.set(row.name, !effective)
		setPending(next)
	}

	/**
	 * Enter: apply the whole pending batch as symlink create/deletes (or
	 * toggle the current row's pending mark when nothing is pending). Items
	 * run one by one; a failure is collected into the end-of-batch summary
	 * instead of aborting the remaining items. The list rescans either way.
	 */
	async function applyPending() {
		if (busy() || pending().size === 0) return
		setBusy(true)
		const source = props.source()
		const curated = props.curated()
		await ensureCuratedDir(curated)
		const results: SkillApplyResult[] = []
		for (const [name, targetState] of pending()) {
			const error = await applyOneSkillChange(name, targetState, source, curated)
			results.push({ name, error })
		}
		setPending(new Map())
		setBusy(false)
		const summary = skillApplySummary(results)
		void rescan(summary === "" ? undefined : summary)
	}

	function onReturn() {
		if (filterOpen()) {
			setFilterOpen(false)
			setFilter("")
			return
		}
		if (pending().size > 0) {
			void applyPending()
			return
		}
		togglePending(current())
	}

	Keymap.createLayer(() => ({
		mode: "global",
		enabled: open() && dialog.stack.length === 0,
		priority: 2,
		commands: [
			{ bind: "escape", title: "Close skills manager", group: "Skills", run: close },
			{
				bind: "/",
				title: "Filter skills",
				group: "Skills",
				// Letter/arrow binds are gated OFF while the filter input owns the
				// keys — the SearchOverlay P0-1 law (see the /plugins panel).
				enabled: () => !filterOpen(),
				run: () => {
					setFilterOpen(true)
					return true
				},
			},
			{
				bind: "space",
				title: "Mark install/uninstall",
				group: "Skills",
				enabled: () => !filterOpen(),
				run: () => {
					togglePending(current())
					return true
				},
			},
			{
				bind: "return",
				title: "Commit input / apply batch",
				group: "Skills",
				run: () => {
					onReturn()
					return true
				},
			},
			{
				bind: "up,k",
				title: "Previous skill",
				group: "Skills",
				enabled: () => !filterOpen(),
				run: () => moveCursor(-1),
			},
			{
				bind: "down,j",
				title: "Next skill",
				group: "Skills",
				enabled: () => !filterOpen(),
				run: () => moveCursor(1),
			},
		],
	}))

	const selected = createMemo(() => current())

	return (
		<Show when={open()}>
			<box
				flexShrink={0}
				width="100%"
				height={
					1 +
					1 +
					Math.min(visible().length || 1, 12) +
					(selected() !== undefined && selected().description !== "" ? 1 : 0) +
					(status() !== undefined ? 1 : 0) +
					1
				}
				flexDirection="column"
				border={["left"]}
				borderColor={theme?.border.base ?? "#7aa2f7"}
				backgroundColor={theme?.background.raised.base ?? "#1a1b26"}
				paddingLeft={1}
				paddingRight={1}
			>
				<box height={1} flexShrink={0} flexDirection="row">
					<text fg={theme?.text.base ?? "#e6e6e6"} attributes={TextAttributes.BOLD} wrapMode="none">
						🛠 Skills
					</text>
					<text fg={theme?.text.muted ?? "#565f89"} wrapMode="none">
						{` ${visible().length}/${rows().length}  / filter  space mark  enter apply  esc close`}
					</text>
				</box>
				<Show
					when={!filterOpen()}
					fallback={
						<box height={1} flexShrink={0} flexDirection="row">
							<input
								flexGrow={1}
								placeholder="filter"
								placeholderColor={theme?.text.muted ?? "#565f89"}
								value={filter()}
								onInput={(value: string) => setFilter(value)}
								ref={(renderable: InputRenderable) => {
									setTimeout(() => {
										if (!renderable.isDestroyed) renderable.focus()
									}, 1)
								}}
							/>
						</box>
					}
				>
					<box height={1} flexShrink={0}>
						<text fg={theme?.text.muted ?? "#565f89"} wrapMode="none">
							{`${"SKILL".padEnd(32)}STATE`}
						</text>
					</box>
				</Show>
				<Show
					when={visible().length > 0}
					fallback={
						<box height={1} flexShrink={0}>
							<text fg={theme?.text.muted ?? "#565f89"} wrapMode="none">
								{rows().length === 0
									? `no skills in ${props.source()}`
									: "no skills match the filter"}
							</text>
						</box>
					}
				>
					<For each={visible().slice(0, 12)}>
						{(row, index) => {
							const effective = createMemo(() => pending().get(row.name))
							return (
								<box height={1} flexShrink={0} flexDirection="row">
									<text
										fg={
											index() === cursorIndex()
												? (theme?.text.base ?? "#e6e6e6")
												: (theme?.text.muted ?? "#565f89")
										}
										wrapMode="none"
									>
										{formatSkillLine(row, index() === cursorIndex())}
									</text>
									<text
										fg={
											(effective() ?? row.installed)
												? successColor(theme ?? undefined)
												: (theme?.text.muted ?? "#565f89")
										}
										wrapMode="none"
									>
										{skillStateText(row, effective())}
									</text>
								</box>
							)
						}}
					</For>
				</Show>
				<Show when={selected() !== undefined && selected().description !== ""}>
					<box height={1} flexShrink={0}>
						<text fg={theme?.text.muted ?? "#565f89"} wrapMode="none">
							{`  ${selected().description}`}
						</text>
					</box>
				</Show>
				<Show when={status() !== undefined}>
					<box height={1} flexShrink={0}>
						<text fg={warningColor(theme ?? undefined)} wrapMode="none">
							{status()}
						</text>
					</box>
				</Show>
			</box>
		</Show>
	)
}
