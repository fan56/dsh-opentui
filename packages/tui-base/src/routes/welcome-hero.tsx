/**
	* DSH startup hero: the "DSH OPENTUI" wordmark in ascii_font "block" (the
	* ANSI-Shadow letters) painted in the brand blue, with the model/cwd line
	* and the session's daily quote under it (see quotes.ts). Painted top-left
	* above the transcript while the session is empty — the start screen is a
	* transition state: the first message hides it and the normal transcript
	* takes over (old-stack welcome semantics).
	*
	* No context deps on purpose: the v2 client entry (examples/v2-entry.tsx)
	* composes through createComponent OUTSIDE the app.tsx provider stack.
	* PROP RECAST LAW (proven empirically on the first hero boot): getter props
	* handed to a createComponent call from the entry's children getter are
	* eagerly evaluated and baked into VALUES before the component body runs —
	* signal accessors arrive here as plain booleans/undefined. The reactive
	* handle therefore rides a STABLE OBJECT (`state`, identity never recast);
	* this component reads its accessors inside its own JSX prop getters
	* (babel compiles them to tracked scopes: Show's `when` memo, the text
	* insert effects), which re-run on the underlying signals.
	*
	* The quote is drawn once per hero creation, so re-layouts and theme
	* switches re-render the same line; only a fresh session rolls a new one.
	*/
import { For, Show, type JSX } from "solid-js"
import { pickDailyQuote } from "./quotes"
import { GradientAsciiText } from "../component/gradient-text"
import type { SkinColorMode } from "../skin/identity"
import { t } from "../i18n"

/** The DSH brand blue for the wordmark ramp start (skin/identity.ts). */
export const DSH_BRAND = "#4D6BFE"

/**
 * Rendered plugin-row cap (the splash spec §5.2 — no tui-pi precedent, an
 * opentui addition): 8 rows fit 120x40 with the 6-row wordmark. Overflow
 * renders the first cap−1 rows plus one `└─ … +{k} more` line (tui-pi
 * clips, never wraps).
 *
 * The cap is HEIGHT-AWARE: the hero is fixed content above a bottom-anchored
 * composer, so an oversized block pushes the composer off-screen on compact
 * viewports (the agents-mount 80x24 geometry law: the composer box must end
 * strictly above the powerline). A 24-row terminal gets 1 row + the
 * more/counts lines; 30-39 rows get 4; 40+ get the spec's 8. Boot-time read —
 * the hero repaints on mount/resize only, and the palette checks boot at a
 * fixed size.
 */
function splashRowCap(): number {
	const rows = (typeof process !== "undefined" && process.stdout?.rows) || 40
	if (rows >= 40) return 8
	if (rows >= 30) return 4
	return 1
}

/** One installed user plugin row off the seam's plugins() cache. */
export type WelcomePluginRow = { name: string; version: string }

/** Reactive handle the entry owns; accessors ride the stable identity. */
export interface WelcomeHeroState {
	/** False once the first message lands (transcript takes over). */
	visible: () => boolean
	/** Model label; undefined keeps the cwd-only line while the boot label is pending. */
	model: () => string | undefined
	/** Dim color for the info/quote lines (theme.text.muted). */
	muted?: () => string | undefined
	/**
	 * Active theme color mode for the identity gradient (skin contract §1);
	 * dark default until the theme lane passes it through.
	 */
	mode?: () => SkinColorMode
	/** Tree-root label of the plugin block (the profile name, "opentui");
	 * undefined keeps the block headless. */
	title?: () => string | undefined
	/**
	 * Installed user plugins ({name, version}, loader order as the host
	 * returned it — the seam's plugins() cache, boot-warmed + push-refreshed
	 * through onPluginsChanged). undefined/empty keeps today's two-line hero.
	 */
	plugins?: () => readonly WelcomePluginRow[]
}

/** The user's home, shortened to "~" in the info line. */
const home = (typeof process !== "undefined" && process.env.HOME) || ""

function shortenCwd(cwd: string): string {
	const short = home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd
	if (short.length <= 60) return short
	return `…${short.slice(-59)}`
}

/** tui-pi startup-info row shape: `name@version`; an unresolved version
 * renders the bare name (tui-pi startup-info.ts:141 semantics — the /plugins
 * panel's formatPluginLine keeps its `name@` shape and stays panel-owned). */
function pluginLabel(row: WelcomePluginRow): string {
	return row.version === "" ? row.name : `${row.name}@${row.version}`
}

/** Per-line width clip (tui-pi startup-info clips, never wraps): terminal
 * columns − 2 when the width is known, else the 120-col baseline. Plugin
 * labels are npm names + semvers (ASCII), so a plain slice is mono-safe. */
function clipRow(line: string): string {
	const cols = (typeof process !== "undefined" && process.stdout?.columns) || 120
	const max = Math.max(20, cols - 2)
	return line.length <= max ? line : `${line.slice(0, max - 1)}…`
}

export function WelcomeHero(props: { state: WelcomeHeroState; cwd: string }): JSX.Element {
	const quote = pickDailyQuote()
	const pluginRows = () => props.state.plugins?.() ?? []
	const cap = splashRowCap()
	// Overflow always leaves at least ONE example row above the more-line
	// (a bare `└─ … +k more` under the tree root would show no plugin at all).
	const overflowCount = () => (pluginRows().length > cap ? pluginRows().length - Math.max(1, cap - 1) : 0)
	const visibleRows = () => (overflowCount() > 0 ? pluginRows().slice(0, Math.max(1, cap - 1)) : pluginRows())
	const heroTitle = () => props.state.title?.()
	return (
		<Show when={props.state.visible()}>
			<box flexDirection="column" flexShrink={0} width="100%" paddingLeft={1} paddingTop={1}>
				{/* Skin contract §1: per-cell horizontal identity gradient; the
				    component falls back to tiny when the measured block width
				    exceeds the terminal and repaints only on mount/resize. */}
				<GradientAsciiText text="DSH OPENTUI" mode={props.state.mode?.() ?? "dark"} />
				<box height={1} flexShrink={0} />
				{/* Installed-plugin tree (tui-pi welcome parity): profile-name
				    root, one `├─ name@version` per user plugin in loader order
				    (not sorted, not deduplicated), the `└─` terminator on the last
				    rendered row (the `+k more` line on overflow), then the counts
				    line. The whole block — trailing blank spacer included — only
				    exists when plugins are known, so a pluginless boot keeps the
				    exact previous layout. mcp/skills counts and the collapsed
				    `dsh-base (N)` row stay out (no seam face; splash spec §5.6). */}
				<Show when={pluginRows().length > 0}>
					<Show when={heroTitle() !== undefined && heroTitle() !== ""}>
						<text fg={props.state.muted?.()} selectable={false}>
							{heroTitle()}
						</text>
					</Show>
					<For each={visibleRows()}>
						{(row, index) => (
							<text fg={props.state.muted?.()} selectable={false}>
								{clipRow(`${index() === visibleRows().length - 1 && overflowCount() === 0 ? "└─" : "├─"} ${pluginLabel(row)}`)}
							</text>
						)}
					</For>
					<Show when={overflowCount() > 0}>
						<text fg={props.state.muted?.()} selectable={false}>
							{clipRow(`└─ ${t("hero.plugins.more", { count: overflowCount() })}`)}
						</text>
					</Show>
					<text fg={props.state.muted?.()} selectable={false}>
						{clipRow(t("hero.plugins.count", { count: pluginRows().length }))}
					</text>
					{/* Trailing spacer follows the tui-pi blank-line rhythm — but
					    compact viewports (cap ≤ 1) need the row for the composer
					    geometry law, so the decorative blank yields first. */}
					<Show when={cap > 1}>
						<box height={1} flexShrink={0} />
					</Show>
				</Show>
				<text fg={props.state.muted?.()} selectable={false}>
					{`${props.state.model() ? `${props.state.model()} · ` : ""}${shortenCwd(props.cwd)}`}
				</text>
				<text fg={props.state.muted?.()} selectable={false}>{`「${quote}」`}</text>
			</box>
		</Show>
	)
}
