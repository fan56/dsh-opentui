/**
 * PluginsPanel — the /plugins manager panel (batch H3, tui-pi 77
 * plugins-manager parity).
 *
 * `/plugins` upgrades from the F7a transcript listing to a panel: the
 * "🔌 Plugins" title, the bundle table (name@version + a state column),
 * and the panel's own `/` filter (the reference's narrowing move — a
 * deployment carries ~30 bundles, so the filter is how a row surfaces).
 * Escape pops the filter first (if armed), then the panel.
 *
 * STATE-COLUMN GAP (recorded, not hidden): the reference carries on/off
 * labels backed by a pluginManager enable/disable seam. THIS stack's
 * plugins face (seam.plugins — HostSession.listPlugins 1:1 / the client
 * cached pluginManager/listPlugins rows) carries ONLY {name, version}:
 * there is no enabled flag and no toggle seam anywhere on either adapter,
 * so the state column renders the static "on" (installed = loaded) and no
 * toggle exists. Adding the column shape keeps the render surface
 * reference-parity for when the seam grows the flag.
 *
 * Rows ride the module bridge signal for the open state (the /search
 * sessions-search law); the plugin rows arrive through the seam getter
 * prop (reactive-prop law: getters, never eager reads).
 */
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import type { InputRenderable } from "@opentui/core"
import { TextAttributes } from "@opentui/core"
import { Keymap } from "../../context/keymap"
import { useDialog } from "../../ui/dialog"
import { useThemeOptional } from "../../context/theme"
import type { SessionSeam } from "../../seams/session"

const [bridgeOpen, setBridgeOpen] = createSignal(false)

/** Open the plugins manager panel (the /plugins command path). */
export function openPluginsPanel(): void {
	setBridgeOpen(true)
}

export type PluginRow = { name: string; version: string }

/** A rendered table line: the name@version bundle id, then the state. */
export function formatPluginLine(row: PluginRow): string {
	return `${row.name}@${row.version}`
}

/** The rows surviving the filter: a case-insensitive substring over the
 * rendered `name@version` line (the reference's own `/` filter shape). */
export function filterPluginRows(rows: readonly PluginRow[], query: string): PluginRow[] {
	const needle = query.trim().toLowerCase()
	if (!needle) return [...rows]
	return rows.filter((row) => formatPluginLine(row).toLowerCase().includes(needle))
}

export function PluginsPanel(props: { seam: SessionSeam; onClosed?: () => void }) {
	const theme = useThemeOptional()
	const dialog = useDialog()

	const [open, setOpen] = createSignal(false)
	const [filterOpen, setFilterOpen] = createSignal(false)
	const [filter, setFilter] = createSignal("")

	createEffect(() => {
		if (bridgeOpen()) {
			setBridgeOpen(false)
			setFilter("")
			setFilterOpen(false)
			setOpen(true)
		}
	})

	function close() {
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

	// Rows come from the seam plugins face (F7a): a sync read — the adapters
	// keep it cached. A seam without the face renders the empty copy.
	// Re-read on every OPEN transition (the `open()` read below): the client
	// adapter's cache warms ASYNC after boot (the pluginManager/listPlugins
	// boot warm), so a boot-time eager evaluation sees 0 rows — and the
	// adapter's revision signal lives in shell's solid-js, a DIFFERENT module
	// instance than this package's solid-js, so its bump cannot invalidate
	// this memo. Tracking open() makes every panel open re-read the cache.
	const rows = createMemo<PluginRow[]>(() => {
		void open()
		try {
			return props.seam.plugins?.() ?? []
		} catch {
			return []
		}
	})
	const visible = createMemo(() => filterPluginRows(rows(), filter()))

	Keymap.createLayer(() => ({
		mode: "global",
		enabled: open() && dialog.stack.length === 0,
		priority: 2,
		commands: [
			{ bind: "escape", title: "Close plugins manager", group: "Plugins", run: close },
			{
				bind: "/",
				title: "Filter bundles",
				group: "Plugins",
				run: () => {
					setFilterOpen(true)
					return true
				},
			},
		],
	}))

	return (
		<Show when={open()}>
			<box
				flexShrink={0}
				width="100%"
				height={1 + 1 + Math.min(visible().length || 1, 12) + 1}
				flexDirection="column"
				border={["left"]}
				borderColor={theme?.border.base ?? "#7aa2f7"}
				backgroundColor={theme?.background.raised.base ?? "#1a1b26"}
				paddingLeft={1}
				paddingRight={1}
			>
				<box height={1} flexShrink={0} flexDirection="row">
					<text fg={theme?.text.base ?? "#e6e6e6"} attributes={TextAttributes.BOLD} wrapMode="none">
						🔌 Plugins
					</text>
					<text fg={theme?.text.muted ?? "#565f89"} wrapMode="none">
						{` ${visible().length}/${rows().length}  / filter  esc close`}
					</text>
				</box>
				<Show
					when={filterOpen()}
					fallback={
						<box height={1} flexShrink={0}>
							<text fg={theme?.text.muted ?? "#565f89"} wrapMode="none">
								{`${"BUNDLE".padEnd(36)}STATE`}
							</text>
						</box>
					}
				>
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
				</Show>
				<Show
					when={visible().length > 0}
					fallback={
						<box height={1} flexShrink={0}>
							<text fg={theme?.text.muted ?? "#565f89"} wrapMode="none">
								{rows().length === 0 ? "no plugins installed" : "no bundles match the filter"}
							</text>
						</box>
					}
				>
					<For each={visible().slice(0, 12)}>
						{(row) => (
							<box height={1} flexShrink={0} flexDirection="row">
								<text fg={theme?.text.base ?? "#e6e6e6"} wrapMode="none">
									{formatPluginLine(row).padEnd(36)}
								</text>
								<text fg="#9ece6a" wrapMode="none">
									on
								</text>
							</box>
						)}
					</For>
				</Show>
			</box>
		</Show>
	)
}
