/**
 * ComposerContext — the one-line context strip DIRECTLY above the composer
 * (user feedback batch): the current working directory, plus the git branch
 * when the directory is a repository.
 *
 *   ~/repo/dsh-opentui · feature/foo
 *   …/very/long/path/dsh-opentui          (no git → directory only)
 *
 * Data source & refresh (no polling): the page hands a stable `cwd` getter
 * (the session's workspace) and an optional async `probeBranch`; a `revision`
 * ordinal re-runs the probe after a session switch (/new, /fork, /resume).
 * One async read per mount/revision — a failed probe (non-repo, git missing,
 * timeout) resolves "" and silently degrades to the directory-only row.
 *
 * Width law: one fixed row, `wrapMode="none"`, clipped to the terminal width
 * from the LEFT (the tail — and the branch — is what matters). At 80 columns
 * the row never wraps and never steals height from the composer: the box is
 * height={1}, flexShrink={0}, exactly like the hints row.
 *
 * Colors: the skin's muted token (no-provider fallback = the kit #565f89).
 */
import { createEffect, createSignal, on, Show, type JSX } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { homedir } from "node:os"
import { useThemeOptional } from "../../context/theme"
import { abbreviateHome } from "../../util/path-format"
import { stringWidth } from "../../util/string-width"

/**
 * Clip `text` to `limit` display columns from the LEFT, prefixing the
 * single-column ellipsis: the tail survives, the head is dropped. Pure.
 */
export function truncateLeft(text: string, limit: number): string {
	if (limit <= 0) return ""
	if (stringWidth(text) <= limit) return text
	if (limit === 1) return "…"
	const chars = Array.from(text)
	let width = 0
	let index = chars.length
	for (let i = chars.length - 1; i >= 0; i--) {
		const cell = stringWidth(chars[i]!)
		if (width + cell > limit - 1) break
		width += cell
		index = i
	}
	return `…${chars.slice(index).join("")}`
}

/**
 * The rendered context row: `{dir} · {branch}` (branch omitted when empty),
 * the directory home-abbreviated and the WHOLE row left-clipped to
 * `maxColumns`. Pure and unit-tested.
 */
export function composerContextLabel(input: {
	cwd: string
	branch?: string
	/** Home directory for `~/` abbreviation; omitted = raw path. */
	home?: string
	/** Total display columns available for the row. */
	maxColumns: number
}): string {
	const cwd = input.cwd.trim()
	if (!cwd) return ""
	const dir = input.home ? abbreviateHome(cwd, input.home) : cwd
	const branch = (input.branch ?? "").trim()
	return truncateLeft(branch ? `${dir} · ${branch}` : dir, input.maxColumns)
}

export type ComposerContextProps = {
	/** Workspace directory (getter-prop law: a stable function value). */
	cwd: () => string
	/** Async branch probe; resolves "" outside a repo / on failure. */
	probeBranch?: (cwd: string) => Promise<string>
	/** Refresh ordinal — a bump re-reads the branch (session switch / /new). */
	revision?: () => number
}

export function ComposerContext(props: ComposerContextProps): JSX.Element {
	const dimensions = useTerminalDimensions()
	const theme = useThemeOptional()
	const [branch, setBranch] = createSignal("")

	// One read per mount and per revision bump; a stale answer can never
	// overwrite a newer one. Failures are swallowed (silent degrade).
	let seq = 0
	createEffect(
		on(
			() => [props.cwd(), props.revision?.() ?? 0] as const,
			([cwd]) => {
				const mine = ++seq
				const probe = props.probeBranch
				if (!probe || !cwd.trim()) {
					setBranch("")
					return
				}
				void probe(cwd)
					.then((value) => {
						if (mine === seq) setBranch(value.trim())
					})
					.catch(() => {
						if (mine === seq) setBranch("")
					})
			},
		),
	)

	const label = () =>
		composerContextLabel({
			cwd: props.cwd(),
			branch: branch(),
			home: safeHome(),
			// The row carries one column of left padding (the composer's skin
			// frame), so stop one cell short of the viewport.
			maxColumns: Math.max(1, dimensions().width - 1),
		})

	return (
		<Show when={label().length > 0}>
			<box flexShrink={0} height={1} width="100%" paddingLeft={1}>
				<text fg={theme?.text.muted ?? "#565f89"} wrapMode="none">
					{label()}
				</text>
			</box>
		</Show>
	)
}

/** `~` abbreviation is cosmetic: no home (or a throwing lookup) = raw path. */
function safeHome(): string | undefined {
	try {
		return homedir()
	} catch {
		return undefined
	}
}
