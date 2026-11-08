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
import { Show, type JSX } from "solid-js"
import { pickDailyQuote } from "./quotes"

/** The DSH brand blue for the wordmark (old-stack POWERLINE brand). */
export const DSH_BRAND = "#4D6BFE"

/** Reactive handle the entry owns; accessors ride the stable identity. */
export interface WelcomeHeroState {
	/** False once the first message lands (transcript takes over). */
	visible: () => boolean
	/** Model label; undefined keeps the cwd-only line while the boot label is pending. */
	model: () => string | undefined
	/** Dim color for the info/quote lines (theme.text.muted). */
	muted?: () => string | undefined
}

/** The user's home, shortened to "~" in the info line. */
const home = (typeof process !== "undefined" && process.env.HOME) || ""

function shortenCwd(cwd: string): string {
	const short = home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd
	if (short.length <= 60) return short
	return `…${short.slice(-59)}`
}

export function WelcomeHero(props: { state: WelcomeHeroState; cwd: string }): JSX.Element {
	const quote = pickDailyQuote()
	return (
		<Show when={props.state.visible()}>
			<box flexDirection="column" flexShrink={0} width="100%" paddingLeft={1} paddingTop={1}>
				<ascii_font text="DSH OPENTUI" font="block" color={DSH_BRAND} selectable={false} />
				<box height={1} flexShrink={0} />
				<text fg={props.state.muted?.()} selectable={false}>
					{`${props.state.model() ? `${props.state.model()} · ` : ""}${shortenCwd(props.cwd)}`}
				</text>
				<text fg={props.state.muted?.()} selectable={false}>{`「${quote}」`}</text>
			</box>
		</Show>
	)
}
