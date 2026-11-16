/**
 * PluginsPanel — the /plugins manager panel (batch H3, tui-pi 77
 * plugins-manager parity; C1 upgrades the read-only listing to the
 * reference's management face).
 *
 * The panel drives the host's pluginManager face through the seam — the
 * SAME service the web profile's plugin-management page drives
 * (`ctx.remote.pluginManager` in dsh-client-ui-plugin-manager):
 * `pluginBundles()` lists the bundles with real enablement, Enter/space
 * toggles `setPluginBundleEnabled` (the host persists the selection AND
 * tries a live apply — the notice says which), `d` uninstalls
 * `removePluginBundle` behind a confirm, `i` installs a spec (inspect
 * preview → confirm → install). The state column reflects the real
 * enabled flag (on / off / available + error / read-only badges).
 *
 * NOTICE SEMANTICS (the reference's pluginChangeNotice parity): a change
 * whose `application` is `restart-required` was PERSISTED but takes effect
 * only at the next host start — the status line states that explicitly;
 * `applied` is live on the running host.
 *
 * Escape pops the filter first (if armed), then the panel; `/` engages the
 * filter (the reference's narrowing move). Rows ride the module bridge
 * signal for the open state (the /search sessions-search law); the bundle
 * rows arrive through the seam getter prop (reactive-prop law: getters,
 * never eager reads).
 */
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import type { InputRenderable } from "@opentui/core"
import { TextAttributes } from "@opentui/core"
import { Keymap } from "../../context/keymap"
import { useIsPageOwner } from "../../context/input-ownership"
import { t } from "../../i18n"
import { useDialog } from "../../ui/dialog"
import { DialogConfirm } from "../../ui/dialog-confirm"
import { useThemeOptional } from "../../context/theme"
import { successColor, warningColor } from "../../skin/semantic"
import type { SeamPluginBundleRow, SeamPluginChange, SeamPluginInspection, SessionSeam } from "../../seams/session"

const [bridgeOpen, setBridgeOpen] = createSignal(false)
// Module-scope open state: the session sidebar Esc layer (priority 10)
// yields while the panel owns the screen.
const [panelOpen, setPanelOpen] = createSignal(false)
/** Whether the /plugins manager is on screen. */
export const pluginsPanelOpen = panelOpen

/** Open the plugins manager panel (the /plugins command path). */
export function openPluginsPanel(): void {
	setBridgeOpen(true)
}

/**
 * The panel's module-scope open state. Unmount resets it: the sidebar's
 * priority-10 Esc layer yields on this signal, so a stale `true` would leave
 * Esc dead for the rest of the session.
 */
export function usePluginsPanelOpenState() {
	onCleanup(() => setPanelOpen(false))
	return [pluginsPanelOpen, setPanelOpen] as const
}

/** Legacy listing row (batch F7a): the bare name@version pair. */
export type PluginRow = { name: string; version: string }

/** The bundle face the panel renders (the seam row + derived flags). */
export type PluginBundleView = {
	name: string
	version: string
	/** Name + @version when a version is known (the BUNDLE column). */
	label: string
	enabled: boolean
	installed: boolean
	optional: boolean
	removable: boolean
	/** Enter/space may toggle (no read-only reason, no load error). */
	toggleable: boolean
	readOnlyReason?: string
	error?: string
}

/** The mutations the panel drives (structurally the seam's optional faces). */
export type PluginChange = SeamPluginChange
export type PluginInspection = SeamPluginInspection

/** One rendered table line: the name@version bundle id, then the state. */
export function formatPluginLine(row: PluginRow): string {
	return `${row.name}@${row.version}`
}

/** A rejection's short message for the status line (Error.message or the
 * stringified value, clipped to a row width). */
function errorMessage(error: unknown): string {
	return String(error instanceof Error ? error.message : error).slice(0, 90)
}

/** The rows surviving the filter: a case-insensitive substring over the
 * rendered `name@version` line (the reference's own `/` filter shape). */
export function filterPluginRows<T extends PluginRow>(rows: readonly T[], query: string): T[] {
	const needle = query.trim().toLowerCase()
	if (!needle) return [...rows]
	return rows.filter((row) => formatPluginLine(row).toLowerCase().includes(needle))
}

/** STATE column text of one bundle: on/off/available + error/readonly badges
 * (the reference's bundleStateText parity). */
export function bundleStateText(row: {
	installed: boolean
	optional: boolean
	enabled: boolean
	readOnlyReason?: string
	error?: string
}): string {
	const base =
		!row.installed && row.optional ? t("panel.plugins.state.available") : row.enabled ? t("panel.plugins.state.on") : t("panel.plugins.state.off")
	if (row.error !== undefined && row.error !== "") return t("panel.plugins.state.error", { state: base })
	if (row.readOnlyReason !== undefined && row.readOnlyReason !== "") return t("panel.plugins.state.readOnly", { state: base })
	return base
}

/**
 * Bundle rows for the table: alphabetical by name (the reference's own
 * ordering), with the derived toggleable flag (the host's readOnlyReason or
 * a listing error forbids a toggle).
 */
export function pluginBundleViews(bundles: readonly SeamPluginBundleRow[]): PluginBundleView[] {
	return [...bundles]
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((bundle) => ({
			name: bundle.name,
			version: bundle.version ?? "",
			label:
				bundle.version !== undefined && bundle.version !== "" ? `${bundle.name}@${bundle.version}` : bundle.name,
			enabled: bundle.enabled === true,
			installed: bundle.installed === true,
			optional: bundle.optional === true,
			removable: bundle.removable === true,
			toggleable: bundle.readOnlyReason === undefined && (bundle.error === undefined || bundle.error === ""),
			readOnlyReason: bundle.readOnlyReason,
			error: bundle.error,
		}))
}

/** Legacy rows → views (a seam without the bundle face keeps the F7a
 * listing honest: loaded plugins render "on" and nothing is toggleable —
 * the enablement truth is unknowable without the bundle face, so the
 * derived toggleable flag is forced off). */
export function legacyPluginViews(rows: readonly PluginRow[]): PluginBundleView[] {
	return pluginBundleViews(
		[...rows].map((row) => ({
			name: row.name,
			version: row.version,
			enabled: true,
			installed: true,
			optional: false,
			removable: false,
		})),
	).map((view) => ({ ...view, toggleable: false }))
}

/**
 * Status-line wording of one ChangeResult — the reference's
 * pluginChangeNotice parity. `restart-required` states the host-restart
 * limitation explicitly (the change was saved, the running host keeps the
 * old set until it restarts).
 */
export function pluginChangeNotice(change: PluginChange): string {
	const target = change.target
	switch (change.application) {
		case "applied":
			return t("panel.plugins.notice.applied", { target })
		case "restart-required":
			return t("panel.plugins.notice.restartRequired", { target })
		case "overridden":
			return t("panel.plugins.notice.overridden", { target })
		case "failed":
			return change.error
				? t("panel.plugins.notice.failed", { target, error: change.error })
				: t("panel.plugins.notice.failedNoError", { target })
		case "cancelled":
			return t("panel.plugins.notice.cancelled", { target })
	}
}

/** The install confirm's body from an accepted inspection. */
export function installPreviewLine(inspection: Extract<PluginInspection, { status: "accepted" }>): string {
	const spec = `${inspection.name ?? "spec"}${inspection.version !== undefined && inspection.version !== "" ? `@${inspection.version}` : ""}`
	return inspection.bundle === false ? t("panel.plugins.preview.notBundle", { spec }) : spec
}

export function PluginsPanel(props: { seam: SessionSeam; onClosed?: () => void }) {
	const theme = useThemeOptional()
	const dialog = useDialog()
	// ADR-0008: this manager is a page surface (it pushes no ownership frame);
	// its keys are off whenever a dialog, panel or dock owns the keyboard.
	const pageOwns = useIsPageOwner()

	const [open, setOpen] = usePluginsPanelOpenState()
	const [filterOpen, setFilterOpen] = createSignal(false)
	const [filter, setFilter] = createSignal("")
	const [cursor, setCursor] = createSignal(0)
	const [busy, setBusy] = createSignal(false)
	const [status, setStatus] = createSignal<string | undefined>(undefined)
	const [installOpen, setInstallOpen] = createSignal(false)
	const [installText, setInstallText] = createSignal("")
	let statusTimer: ReturnType<typeof setTimeout> | undefined
	onCleanup(() => clearTimeout(statusTimer))

	createEffect(() => {
		if (bridgeOpen()) {
			setBridgeOpen(false)
			setFilter("")
			setFilterOpen(false)
			setInstallOpen(false)
			setInstallText("")
			setCursor(0)
			setOpen(true)
		}
	})

	/** One status line; notices auto-clear (the reference's flash parity). */
	function flash(message: string, autoClearMs?: number) {
		clearTimeout(statusTimer)
		setStatus(message)
		if (autoClearMs !== undefined) {
			statusTimer = setTimeout(() => setStatus(undefined), autoClearMs)
		}
	}

	function close() {
		if (installOpen()) {
			// First escape pops the install input (the filter's two-stage esc).
			setInstallOpen(false)
			setInstallText("")
			return
		}
		if (filterOpen()) {
			// First escape pops the filter (the reference's two-stage esc).
			setFilterOpen(false)
			setFilter("")
			return
		}
		setOpen(false)
		// Refocus AFTER the teardown (the SearchOverlay H1 law — the destroyed
		// filter input leaves nothing focused; the page reclaims its composer).
		// C15: without this the plugins panel's Esc-close left the composer
		// unfocused (71-search's post-close editor probe failed 3/3).
		setTimeout(() => props.onClosed?.(), 3)
	}

	// Rows come from the seam bundle face (C1) with the F7a listing as the
	// fallback: a sync read — the adapters keep both cached. A seam without
	// either renders the empty copy. Re-read on every OPEN transition (the
	// `open()` read below): the client adapter's cache warms ASYNC after boot
	// (the pluginManager/listPlugins boot warm), so a boot-time eager
	// evaluation sees 0 rows — and the adapter's revision signal lives in
	// shell's solid-js, a DIFFERENT module instance than this package's
	// solid-js, so its bump cannot invalidate this memo. Tracking open() makes
	// every panel open re-read the cache.
	const bundles = createMemo<PluginBundleView[]>(() => {
		void open()
		try {
			const seam = props.seam
			if (typeof seam.pluginBundles === "function") return pluginBundleViews(seam.pluginBundles())
			if (typeof seam.plugins === "function") return legacyPluginViews(seam.plugins())
			return []
		} catch {
			return []
		}
	})
	const visible = createMemo(() => filterPluginRows(bundles(), filter()))
	/** The cursor, clamped into the current window (filters shrink it). */
	const current = createMemo(() => {
		const rows = visible()
		return rows[Math.min(cursor(), rows.length - 1)]
	})
	/** The selected row's index within the painted window (−1 = none). */
	const cursorIndex = createMemo(() => visible().slice(0, 12).indexOf(current()))

	function moveCursor(delta: number) {
		const count = visible().length
		if (count === 0) return
		const next = Math.max(0, Math.min(cursor() + delta, count - 1))
		setCursor(next)
	}

	/** Enter/space: toggle the selected bundle on/off (guarded, busy-safe). */
	async function toggle(row: PluginBundleView | undefined) {
		if (row === undefined) return
		if (busy()) return
		if (!row.toggleable || typeof props.seam.setPluginBundleEnabled !== "function") {
			flash(
				row.readOnlyReason
					? t("panel.plugins.status.readOnlyReason", { name: row.name, reason: row.readOnlyReason })
					: t("panel.plugins.status.readOnly", { name: row.name }),
				4000,
			)
			return
		}
		setBusy(true)
		flash(row.enabled ? t("panel.plugins.status.disabling", { name: row.name }) : t("panel.plugins.status.enabling", { name: row.name }))
		try {
			const change = await props.seam.setPluginBundleEnabled(row.name, !row.enabled)
			flash(pluginChangeNotice(change), 6000)
		} catch (error) {
			// P2-3: RemoteHostSession folds throws into failed Changes, but a
			// rejecting seam adapter (local/test) would surface as an unhandled
			// rejection with no panel feedback — flash it instead.
			flash(t("panel.plugins.status.changeFailed", { name: row.name, error: errorMessage(error) }), 8000)
		} finally {
			setBusy(false)
		}
	}

	/** `d`: uninstall behind a confirm (the reference's PluginConfirm shape). */
	function confirmRemove(row: PluginBundleView | undefined) {
		if (row === undefined || busy()) return
		if (!row.removable) {
			flash(t("panel.plugins.status.notRemovable", { name: row.name }), 4000)
			return
		}
		const name = row.name
		dialog.replace(
			() => (
				<DialogConfirm
					title={t("panel.plugins.dialog.uninstallTitle", { name })}
					message={t("panel.plugins.dialog.uninstallMessage", { name })}
					label={{ confirm: t("panel.plugins.dialog.uninstallConfirm"), cancel: t("panel.plugins.dialog.keep") }}
					onConfirm={() => void remove(name)}
				/>
			),
			undefined,
			{ tone: "warning" },
		)
	}

	async function remove(name: string) {
		if (busy()) return
		if (typeof props.seam.removePluginBundle !== "function") return
		setBusy(true)
		flash(t("panel.plugins.status.uninstalling", { name }))
		try {
			const change = await props.seam.removePluginBundle(name)
			flash(pluginChangeNotice(change), 8000)
		} catch (error) {
			flash(t("panel.plugins.status.changeFailed", { name, error: errorMessage(error) }), 8000)
		} finally {
			setBusy(false)
		}
	}

	/** `i`: spec input → inspect preview → confirm → install. */
	function beginInstall() {
		if (busy()) return
		if (typeof props.seam.installPluginSpec !== "function") {
			flash(t("panel.plugins.status.installUnavailable"), 4000)
			return
		}
		setInstallText("")
		setInstallOpen(true)
	}

	/** The install input's commit: inspect, preview, then confirm-install. */
	async function commitInstall() {
		const spec = installText().trim()
		if (spec === "") {
			flash(t("panel.plugins.status.specRequired"), 4000)
			return
		}
		setInstallOpen(false)
		setInstallText("")
		if (busy()) return
		if (typeof props.seam.inspectPluginSpec !== "function") return
		setBusy(true)
		flash(t("panel.plugins.status.inspecting", { spec }))
		let inspection: PluginInspection
		try {
			inspection = await props.seam.inspectPluginSpec(spec)
		} catch (error) {
			flash(t("panel.plugins.status.cannotInstall", { spec, error: errorMessage(error) }), 8000)
			return
		} finally {
			setBusy(false)
		}
		if (inspection.status === "refused") {
			flash(t("panel.plugins.status.cannotInstallRefused", { spec, problem: inspection.problem, reason: inspection.reason }), 8000)
			return
		}
		const accepted = inspection
		dialog.replace(
			() => (
				<DialogConfirm
					title={t("panel.plugins.dialog.installTitle")}
					message={
						accepted.description
							? t("panel.plugins.dialog.installBodyDescription", { preview: installPreviewLine(accepted), description: accepted.description })
							: t("panel.plugins.dialog.installBody", { preview: installPreviewLine(accepted) })
					}
					label={{ confirm: t("panel.plugins.dialog.installConfirm"), cancel: t("panel.plugins.dialog.cancel") }}
					onConfirm={() => void install(spec)}
				/>
			),
			undefined,
			{ tone: "warning" },
		)
	}

	async function install(spec: string) {
		if (busy()) return
		if (typeof props.seam.installPluginSpec !== "function") return
		setBusy(true)
		flash(t("panel.plugins.status.installing", { spec }))
		try {
			const change = await props.seam.installPluginSpec(spec)
			flash(pluginChangeNotice(change), 8000)
		} catch (error) {
			flash(t("panel.plugins.status.changeFailed", { name: spec, error: errorMessage(error) }), 8000)
		} finally {
			setBusy(false)
		}
	}

	Keymap.createLayer(() => ({
		mode: "global",
		// ADR-0008: page-ownership gate (subsumes the old dialog-stack check:
		// a dialog pushes its own frame above the page, as does a kit panel).
		enabled: open() && pageOwns(),
		priority: 2,
		commands: [
			{ bind: "escape", title: t("panel.plugins.keymap.close"), group: "Plugins", run: close },
			{
				bind: "/",
				title: t("panel.plugins.keymap.filter"),
				group: "Plugins",
				// Letter/arrow binds are gated OFF while an input owns the keys —
				// the SearchOverlay P0-1 law (a keymap hit preventDefaults the key
				// before the focused input sees it; ungated j/k swallowed query
				// text there). A synchronously-false `enabled` REJECTS the binding,
				// so the key falls through to the filter/install input untouched.
				enabled: () => !filterOpen() && !installOpen(),
				run: () => {
					setFilterOpen(true)
					return true
				},
			},
			{
				bind: "return",
				title: t("panel.plugins.keymap.commit"),
				group: "Plugins",
				run: () => {
					if (installOpen()) {
						void commitInstall()
						return true
					}
					if (filterOpen()) {
						setFilterOpen(false)
						setFilter("")
						return true
					}
					void toggle(current())
					return true
				},
			},
			{
				bind: "space",
				title: t("panel.plugins.keymap.toggle"),
				group: "Plugins",
				enabled: () => !filterOpen() && !installOpen(),
				run: () => {
					void toggle(current())
					return true
				},
			},
			{
				bind: "d",
				title: t("panel.plugins.keymap.uninstall"),
				group: "Plugins",
				enabled: () => !filterOpen() && !installOpen(),
				run: () => confirmRemove(current()),
			},
			{
				bind: "i",
				title: t("panel.plugins.keymap.install"),
				group: "Plugins",
				enabled: () => !filterOpen() && !installOpen(),
				run: beginInstall,
			},
			{
				bind: "up,k",
				title: t("panel.plugins.keymap.previous"),
				group: "Plugins",
				enabled: () => !filterOpen() && !installOpen(),
				run: () => moveCursor(-1),
			},
			{
				bind: "down,j",
				title: t("panel.plugins.keymap.next"),
				group: "Plugins",
				enabled: () => !filterOpen() && !installOpen(),
				run: () => moveCursor(1),
			},
		],
	}))

	return (
		<Show when={open()}>
			<box
				flexShrink={0}
				width="100%"
				height={1 + 1 + Math.min(visible().length || 1, 12) + (status() !== undefined ? 1 : 0) + 1}
				flexDirection="column"
				border={["left"]}
				borderColor={theme?.border.base ?? "#7aa2f7"}
				backgroundColor={theme?.background.raised.base ?? "#1a1b26"}
				paddingLeft={1}
				paddingRight={1}
			>
				<box height={1} flexShrink={0} flexDirection="row">
					<text fg={theme?.text.base ?? "#e6e6e6"} attributes={TextAttributes.BOLD} wrapMode="none">
						{t("panel.plugins.header.title")}
					</text>
					<text fg={theme?.text.muted ?? "#565f89"} wrapMode="none">
						{t("panel.plugins.header.bar", { visible: String(visible().length), total: String(bundles().length) })}
					</text>
				</box>
				<Show
					when={!installOpen()}
					fallback={
						<box height={1} flexShrink={0} flexDirection="row">
							<input
								flexGrow={1}
								placeholder={t("panel.plugins.placeholder.install")}
								placeholderColor={theme?.text.muted ?? "#565f89"}
								value={installText()}
								onInput={(value: string) => setInstallText(value)}
								ref={(renderable: InputRenderable) => {
									setTimeout(() => {
										if (!renderable.isDestroyed) renderable.focus()
									}, 1)
								}}
							/>
						</box>
					}
				>
					<Show
						when={filterOpen()}
						fallback={
							<box height={1} flexShrink={0}>
								<text fg={theme?.text.muted ?? "#565f89"} wrapMode="none">
									{`${t("panel.plugins.header.bundleColumn").padEnd(36)}${t("panel.plugins.header.stateColumn")}`}
								</text>
							</box>
						}
					>
						<box height={1} flexShrink={0} flexDirection="row">
							<input
								flexGrow={1}
								placeholder={t("panel.plugins.placeholder.filter")}
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
					</Show>
				</Show>
				<Show
					when={visible().length > 0}
					fallback={
						<box height={1} flexShrink={0}>
							<text fg={theme?.text.muted ?? "#565f89"} wrapMode="none">
								{bundles().length === 0 ? t("panel.plugins.empty.noPlugins") : t("panel.plugins.empty.noMatch")}
							</text>
						</box>
					}
				>
					<For each={visible().slice(0, 12)}>
						{(row, index) => (
							<box height={1} flexShrink={0} flexDirection="row">
								<text fg={index() === cursorIndex() ? (theme?.text.base ?? "#e6e6e6") : (theme?.text.muted ?? "#565f89")} wrapMode="none">
									{`${index() === cursorIndex() ? "› " : "  "}${formatPluginLine(row).padEnd(34)}`}
								</text>
								<text
									fg={row.enabled ? successColor(theme ?? undefined) : (theme?.text.muted ?? "#565f89")}
									wrapMode="none"
								>
									{bundleStateText(row)}
								</text>
							</box>
						)}
					</For>
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
