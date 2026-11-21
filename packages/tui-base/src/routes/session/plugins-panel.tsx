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
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type Accessor } from "solid-js"
import type { InputRenderable } from "@opentui/core"
import { TextAttributes } from "@opentui/core"
import { Keymap } from "../../context/keymap"
import { useIsPageOwner } from "../../context/input-ownership"
import { t } from "../../i18n"
import { useDialog } from "../../ui/dialog"
import { DialogConfirm } from "../../ui/dialog-confirm"
import { useThemeOptional } from "../../context/theme"
import { successColor, warningColor } from "../../skin/semantic"
import { createPluginWriteConfirm } from "../../seams/session"
import type { PluginWriteConfirm, SeamInstallProgress, SeamPluginBundleRow, SeamPluginChange, SeamPluginDetail, SeamPluginInspection, SessionSeam } from "../../seams/session"

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
	/** 025-w2-2 honest degrade: enabled is unknowable (phase-1 local fallback). */
	stateUnknown?: boolean
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
	/** 025-w2-2 honest degrade — enabled is unknowable, never paint on/off. */
	stateUnknown?: boolean
}): string {
	// W2-2: a phase-1 local-manifest fallback row has NO real enablement. Say so
	// instead of fabricating "off" (plan §5.2 honest degrade, no fake enabled).
	if (row.stateUnknown === true) return t("panel.plugins.state.unknown")
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
			// A stateUnknown (phase-1 fallback) row can never be toggled — its
			// real enablement is unknowable without the manager service.
			toggleable: bundle.stateUnknown !== true && bundle.readOnlyReason === undefined && (bundle.error === undefined || bundle.error === ""),
			readOnlyReason: bundle.readOnlyReason,
			error: bundle.error,
			stateUnknown: bundle.stateUnknown,
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

/**
 * 025-w2-3 — the three confirm-modal elements the write discipline requires
 * (plan §5.2 / review §4 item 4): the write OBJECT, its CONSEQUENCE, and an
 * explicit CANCEL item. These pure helpers make each element machine-assertable
 * in a unit test (no dialog/transport needed). Esc=cancel / enter=confirm is
 * DialogConfirm's existing keymap; the modal shows these lines.
 */
export function writeConfirmObject(operation: string, target: string): string {
	return t("panel.plugins.confirm.object", { operation: t(`panel.plugins.confirm.op.${operation}`), target })
}
export function writeConfirmConsequence(operation: string): string {
	return t(`panel.plugins.confirm.consequence.${operation}`)
}

/**
 * 025-w2-3 — `setVersionExemption(acceptRisk=true)` risk text (host manifest:
 * "Required true for grants after the user accepts possible crashes and data
 * loss"). Pure so a test can assert the risk wording is present ONLY on a grant
 * with acceptRisk=true, never on a clear or a non-risk grant.
 */
export function versionExemptionRiskLine(enabled: boolean, acceptRisk: boolean): string | undefined {
	if (enabled && acceptRisk) return t("panel.plugins.confirm.risk.versionExemption")
	return undefined
}

/** 025-w2-3 — a remove/update dry-run line from an inspected spec (review §4). */
export function writeDryRunLine(operation: "remove" | "update", inspection: PluginInspection): string {
	if (inspection.status === "refused") {
		return t("panel.plugins.dryRun.refused", { problem: inspection.problem, reason: inspection.reason })
	}
	const label = installPreviewLine(inspection)
	return t("panel.plugins.dryRun.accepted", { operation: t(`panel.plugins.confirm.op.${operation}`), spec: label })
}

/** 025-w2-3c — one-line projection of an install progress state (pure, testable).
 *  The three-semantic states are running / cancelled / failed; `done` is the
 *  successful terminal, `unknown` is the honest non-success fallback. */
export function installProgressLine(progress: SeamInstallProgress): string {
	switch (progress.state) {
		case "running": return t("panel.plugins.progress.running")
		case "cancelled": return t("panel.plugins.progress.cancelled", { target: progress.target || progress.requestId })
		case "failed": return t("panel.plugins.progress.failed", { target: progress.target || progress.requestId, error: progress.error ?? "?" })
		case "done": return t("panel.plugins.progress.done", { target: progress.target || progress.requestId })
		case "unknown": return t("panel.plugins.progress.unknown")
	}
}

/**
 * 025-w3-2 (W2-3 S-1) — bounded live-view poll over the `waitForInstall` seam
 * face. The host returns the active install's result (or null once settled and
 * evicted), so every call yields a CLOSED-state projection — no host object
 * crosses. `emit` receives each projection for the progress line; the loop
 * stops at the first terminal state, when `stop()` turns true (the primary
 * install reply or cancel landed), or after a bounded tick count — it can
 * never spin forever. `sleep` is injectable so a unit test drives multiple
 * ticks without wall-clock waits.
 */
export const PROGRESS_POLL_INTERVAL_MS = 250
export const PROGRESS_POLL_MAX_TICKS = 120
/** Bounded grace for the face-driven projection to land after the primary RPC. */
export const PROGRESS_SETTLE_GRACE_MS = 80

export async function pollInstallFace(
	wait: (requestId: string, confirm: PluginWriteConfirm) => Promise<SeamInstallProgress>,
	requestId: string,
	confirm: PluginWriteConfirm,
	emit: (progress: SeamInstallProgress) => void,
	stop: () => boolean,
	sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
	for (let tick = 0; tick < PROGRESS_POLL_MAX_TICKS; tick++) {
		if (stop()) return
		let progress: SeamInstallProgress
		try {
			progress = await wait(requestId, confirm)
		} catch {
			return // seam/transport failure: the primary install reply owns the terminal state
		}
		if (stop()) return
		emit(progress)
		if (progress.state !== "running") return
		await sleep(PROGRESS_POLL_INTERVAL_MS)
	}
}

/**
 * 025-w2-2 — the detail view's one-line preview of a `readBundleDetail`
 * document. Pure (no seam/transport), so the answer-bearing `.ans` assertion
 * and a unit test can share the exact extraction rule. Strips markdown headers
 * (they are decoration, not the document's answer-bearing content).
 */
export function pluginDetailPreview(detail: SeamPluginDetail | undefined, loading: boolean): string {
	if (loading) return t("panel.plugins.detail.loading")
	if (detail === undefined) return t("panel.plugins.detail.unavailable")
	if (detail.status === "none") return t("panel.plugins.detail.none")
	const lines = detail.markdown
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "" && !line.startsWith("#"))
	const preview = lines.slice(0, 2).join(" ").slice(0, 180)
	return preview === "" ? t("panel.plugins.detail.none") : preview
}

/**
 * Reactive visibility of the honest-degrade banner (W2-2 C-1). The seam's
 * `available()` is a PLAIN probe, not a signal, so a memo whose body reads only
 * `available()` has zero reactive dependencies: it computes once at open
 * (available undefined -> false) and never recomputes when the async refresh
 * flips availability to false — the "manager unavailable" banner then never
 * appears. Reading `refreshTick()` in the body gives the memo a real tracked
 * dependency (the panel bumps the tick after every refresh settles), so the
 * banner repaints in BOTH directions. Exported so the flip-state regression
 * test drives the exact production predicate.
 */
export function createDegradedMemo(
	available: () => boolean | undefined,
	refreshTick: Accessor<number>,
): Accessor<boolean> {
	return createMemo(() => {
		void refreshTick()
		return available() === false
	})
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
	// 025-w2-2 — detail view state + a refresh tick that re-reads the async
	// plugin-manager bundle cache after each panel open.
	const [detail, setDetail] = createSignal<SeamPluginDetail | undefined>(undefined)
	const [detailLoading, setDetailLoading] = createSignal(false)
	const [refreshTick, setRefreshTick] = createSignal(0)
	// 025-w2-3c — install progress + in-flight request id for cancel.
	const [installProgress, setInstallProgress] = createSignal<SeamInstallProgress | undefined>(undefined)
	const [cancelArmed, setCancelArmed] = createSignal(false)
	let statusTimer: ReturnType<typeof setTimeout> | undefined
	let progressTimer: ReturnType<typeof setInterval> | undefined
	onCleanup(() => {
		clearTimeout(statusTimer)
		if (progressTimer !== undefined) clearInterval(progressTimer)
	})

	createEffect(() => {
		if (bridgeOpen()) {
			setBridgeOpen(false)
			setFilter("")
			setFilterOpen(false)
			setInstallOpen(false)
			setInstallText("")
			setCursor(0)
			setDetail(undefined)
			setOpen(true)
			// The cache fills ASYNC (pluginManager.listBundles over the generic
			// arm); bump the tick when it settles so the rows memo re-reads.
			const seam = props.seam
			if (typeof seam.refreshPluginBundles === "function") {
				void seam.refreshPluginBundles()
					.then(() => setRefreshTick((n) => n + 1))
					.catch(() => setRefreshTick((n) => n + 1))
			}
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
		void refreshTick()
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

	// 025-w2-2 — the selected row's detail document via the real manager face.
	// Language pinned to "en" (the gate's locale pin; the doc source picks the
	// nearest available translation). A stale-response guard prevents an older
	// row's detail from painting after the cursor moved.
	createEffect(() => {
		const row = current()
		const manager = props.seam.pluginsManager
		if (row === undefined || typeof manager?.readBundleDetail !== "function" || manager.available?.() !== true) {
			setDetail(undefined)
			setDetailLoading(false)
			return
		}
		const name = row.name
		let stale = false
		onCleanup(() => { stale = true })
		setDetailLoading(true)
		void manager.readBundleDetail(name, "en")
			.then((d) => { if (!stale) setDetail(d) })
			.catch(() => { if (!stale) setDetail(undefined) })
			.finally(() => { if (!stale) setDetailLoading(false) })
	})

	/** Honest-degrade banner visibility. The memo's body reads refreshTick() so
	 *  Solid tracks it across the async refresh flip (W2-2 C-1): a memo reading
	 *  ONLY the seam's non-reactive available() has zero deps, caches false at
	 *  open, and never repaints when the refresh marks the manager unavailable.
	 *  The detail lines instead render unconditionally and gate their TEXT on
	 *  the `detail()` signal directly (W2-2c render-gap finding). */
	const degraded = createDegradedMemo(
		() => props.seam.pluginsManager?.available?.(),
		refreshTick,
	)

	function moveCursor(delta: number) {
		const count = visible().length
		if (count === 0) return
		const next = Math.max(0, Math.min(cursor() + delta, count - 1))
		setCursor(next)
	}

	/** Enter/space: toggle the selected bundle on/off — ALWAYS behind a confirm
	 *  modal (plan §5.2: setEnabled must not fire silently / R6). The confirm
	 *  token is minted ONLY in onConfirm, so Escape/cancel cannot fire a write. */
	function toggle(row: PluginBundleView | undefined) {
		if (row === undefined || busy()) return
		if (typeof props.seam.setPluginBundleEnabled !== "function") {
			flash(t("panel.plugins.status.toggleUnavailable", { name: row.name }), 4000)
			return
		}
		if (!row.toggleable) {
			flash(
				row.readOnlyReason
					? t("panel.plugins.status.readOnlyReason", { name: row.name, reason: row.readOnlyReason })
					: t("panel.plugins.status.readOnly", { name: row.name }),
				4000,
			)
			return
		}
		const name = row.name
		const enabled = !row.enabled
		const operation = "setBundleEnabled"
		dialog.replace(
			() => (
				<DialogConfirm
					title={t("panel.plugins.dialog.actionTitle", { operation: t(`panel.plugins.confirm.op.${operation}`) })}
					message={`${writeConfirmObject(operation, name)}\n${writeConfirmConsequence(operation)}`}
					label={{ confirm: t("panel.plugins.dialog.actionConfirm"), cancel: t("panel.plugins.dialog.cancel") }}
					onConfirm={() => void toggleApply(name, enabled, operation)}
				/>
			),
			undefined,
			{ tone: "warning" },
		)
	}

	async function toggleApply(name: string, enabled: boolean, operation: string) {
		if (busy()) return
		if (typeof props.seam.setPluginBundleEnabled !== "function") return
		setBusy(true)
		flash(t(enabled ? "panel.plugins.status.enabling" : "panel.plugins.status.disabling", { name }))
		try {
			const change = await props.seam.setPluginBundleEnabled(name, enabled, createPluginWriteConfirm(operation))
			flash(pluginChangeNotice(change), 6000)
		} catch (error) {
			flash(t("panel.plugins.status.changeFailed", { name, error: errorMessage(error) }), 8000)
		} finally {
			setBusy(false)
		}
	}

	/** `d`: uninstall behind a confirm (the reference's PluginConfirm shape).
	 *  The confirm shows the object + consequence + a dry-run line (the local
	 *  bundle row we already have); the token is minted only on accept (R6). */
	function confirmRemove(row: PluginBundleView | undefined) {
		if (row === undefined || busy()) return
		if (!row.removable) {
			flash(t("panel.plugins.status.notRemovable", { name: row.name }), 4000)
			return
		}
		const name = row.name
		const operation = "removeBundle"
		const dryRun = t("panel.plugins.dryRun.remove", { name, version: row.version || "?" })
		dialog.replace(
			() => (
				<DialogConfirm
					title={t("panel.plugins.dialog.uninstallTitle", { name })}
					message={`${writeConfirmObject(operation, name)}\n${writeConfirmConsequence(operation)}\n${dryRun}`}
					label={{ confirm: t("panel.plugins.dialog.uninstallConfirm"), cancel: t("panel.plugins.dialog.keep") }}
					onConfirm={() => void remove(name, operation)}
				/>
			),
			undefined,
			{ tone: "warning" },
		)
	}

	async function remove(name: string, operation: string) {
		if (busy()) return
		if (typeof props.seam.removePluginBundle !== "function") return
		setBusy(true)
		flash(t("panel.plugins.status.uninstalling", { name }))
		try {
			const change = await props.seam.removePluginBundle(name, createPluginWriteConfirm(operation))
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
		const operation = "installBundle"
		// Inspect result = the dry-run info shown before the write (review §4).
		const dryRun = t("panel.plugins.dryRun.install", { spec: installPreviewLine(accepted) })
		dialog.replace(
			() => (
				<DialogConfirm
					title={t("panel.plugins.dialog.installTitle")}
					message={
						`${writeConfirmObject(operation, installPreviewLine(accepted))}\n` +
						`${writeConfirmConsequence(operation)}\n${dryRun}` +
						(accepted.description ? `\n${accepted.description}` : "")
					}
					label={{ confirm: t("panel.plugins.dialog.installConfirm"), cancel: t("panel.plugins.dialog.cancel") }}
					onConfirm={() => void install(spec, operation)}
				/>
			),
			undefined,
			{ tone: "warning" },
		)
	}

	async function install(spec: string, operation: string) {
		if (busy()) return
		if (typeof props.seam.installPluginSpec !== "function") return
		const requestId = `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
		setBusy(true)
		setInstallProgress({ state: "running", requestId })
		setCancelArmed(true)
		flash(t("panel.plugins.status.installing", { spec }))

		// 025-w3-2 (W2-3 S-1): consume the waitForInstall face for the progress
		// line. The face projection and the primary install ChangeResult both
		// land through `land` — first terminal state wins, so a late reply can
		// never flip a settled line. The face gets a bounded grace window to
		// land before the primary result is used as the fallback.
		const confirm = createPluginWriteConfirm(operation)
		let terminalLanded = false
		let pollStopped = false
		const land = (progress: SeamInstallProgress) => {
			if (terminalLanded) return
			setInstallProgress(progress)
			if (progress.state !== "running") terminalLanded = true
		}
		const pollDone = typeof props.seam.waitForInstall === "function"
			? pollInstallFace(
					(rid, cf) => props.seam.waitForInstall!(rid, cf),
					requestId,
					createPluginWriteConfirm("waitForInstall"),
					land,
					() => pollStopped,
				)
			: Promise.resolve()
		try {
			const change = await props.seam.installPluginSpec(spec, confirm, requestId)
			// Let the face-driven projection win when it is available (including
			// the reply-lost recovery case); bounded, so a hanging face cannot
			// stall the primary result.
			await Promise.race([
				pollDone,
				new Promise<void>((resolve) => setTimeout(resolve, PROGRESS_SETTLE_GRACE_MS)),
			])
			pollStopped = true
			land(terminalProgress(change, requestId))
			flash(pluginChangeNotice(change), 8000)
		} catch (error) {
			pollStopped = true
			land({ state: "failed", requestId, target: spec, error: errorMessage(error) })
			flash(t("panel.plugins.status.changeFailed", { name: spec, error: errorMessage(error) }), 8000)
		} finally {
			pollStopped = true
			// Release the poll reference; it is bounded and self-terminating.
			void pollDone
			setCancelArmed(false)
			setBusy(false)
			// Clear the terminal progress line after a beat so the panel returns
			// to its normal height; the status line keeps the durable notice.
			if (progressTimer !== undefined) clearInterval(progressTimer)
			progressTimer = setInterval(() => {
				setInstallProgress(undefined)
				if (progressTimer !== undefined) clearInterval(progressTimer)
				progressTimer = undefined
			}, 6000)
		}
	}

	/** Pure seam-agnostic terminal mapping from a ChangeResult to progress. */
	function terminalProgress(change: SeamPluginChange, requestId: string): SeamInstallProgress {
		if (change.application === "cancelled") return { state: "cancelled", requestId, target: change.target }
		if (change.application === "failed") return { state: "failed", requestId, target: change.target, error: change.error }
		return { state: "done", requestId, target: change.target }
	}

	/** cancel key: cancel an in-flight install via cancelInstall (R6 gated). */
	function cancelActiveInstall() {
		const progress = installProgress()
		if (!cancelArmed() || progress === undefined || typeof props.seam.cancelInstall !== "function") return
		const requestId = progress.requestId
		void props.seam.cancelInstall(requestId, createPluginWriteConfirm("cancelInstall"))
			.then((result) => {
				flash(t("panel.plugins.progress.cancelResult", { status: result.status }), 6000)
				if (result.status === "cancelled") setInstallProgress({ state: "cancelled", requestId, target: requestId })
			})
			.catch((error) => flash(t("panel.plugins.status.changeFailed", { name: requestId, error: errorMessage(error) }), 8000))
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
				bind: "x",
				title: t("panel.plugins.keymap.cancelInstall"),
				group: "Plugins",
				// Only armed while an install is in flight (review §4 item 4:
				// cancelInstall bound to the cancel action).
				enabled: () => !filterOpen() && !installOpen() && cancelArmed(),
				run: cancelActiveInstall,
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
				height={1 + 1 + (degraded() ? 1 : 0) + Math.min(visible().length || 1, 12) + 2 + (installProgress() !== undefined ? 1 : 0) + (status() !== undefined ? 1 : 0) + 1}
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
				<Show when={degraded()}>
					<box height={1} flexShrink={0}>
						<text fg={warningColor(theme ?? undefined)} wrapMode="none">
							{t("panel.plugins.degrade.unavailable")}
						</text>
					</box>
				</Show>
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
				{/* 025-w2-2 — selected bundle detail from the real manager's
				    readBundleDetail. Two ALWAYS-present fixed-height lines whose
				    text is reactive (a plain <Show when={fn()}> was NOT tracked
				    by the compiler — render-gap adjudication, W2-2c). */}
				<box height={1} flexShrink={0}>
					<text fg={theme?.text.base ?? "#e6e6e6"} attributes={TextAttributes.BOLD} wrapMode="none">
						{detail() !== undefined ? t("panel.plugins.detail.title", { name: current()?.name ?? "" }) : ""}
					</text>
				</box>
				<box height={1} flexShrink={0}>
					<text fg={theme?.text.muted ?? "#565f89"} wrapMode="none">
						{detail() !== undefined ? pluginDetailPreview(detail(), detailLoading()) : ""}
					</text>
				</box>
					{/* 025-w2-3c — install progress line (fixed height when present;
				    text reads installProgress() signal directly — W2-2 render-gap law). */}
					<Show when={installProgress() !== undefined}>
						<box height={1} flexShrink={0}>
							<text fg={warningColor(theme ?? undefined)} wrapMode="none">
								{installProgress() !== undefined ? installProgressLine(installProgress()!) : ""}
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
