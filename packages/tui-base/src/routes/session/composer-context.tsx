/**
 * ComposerContext — the composer info bar DATA (steer/dir/branch batch,
 * final user spec): the input box's top border line IS the context display,
 *
 *   ┏━ ⠋ steer · ~/repo/dsh-opentui · main ━━┓   (steering a live turn:
 *   ┏━ ~/repo/dsh-opentui · main ━━━━━━━┓        braille frame animates)
 *                                                 (idle: no steer segment)
 *
 * NO dash run of our own (user feedback: the `───` prefix read as a stray
 * thin line) — the corner + the renderer's inset char + the border fill
 * provide all the rule; the title is the segments only, each side of the
 * text wrapped in one space (the original `" steer "` precedent), joined by
 * a single-width middle dot (` · `).
 *
 * This component renders NOTHING (user feedback: not even a separator line —
 * between the transcript's bottom edge and the composer frame there are ZERO
 * extra rows). It is the data + formatting provider: it probes the git
 * branch and publishes the reactive frame title via `attachTitle`; the page
 * hands that getter to SessionComposer's `frameTitle`, which embeds it in
 * the composer's own top border. Compact heights (composer drops its top
 * side, skin/semantic.ts COMPOSER_COMPACT_TERMINAL_ROWS) simply have no bar.
 *
 * Data source & refresh (no polling): the page hands a stable `cwd` getter
 * (the session's workspace) and an optional async `probeBranch`; a
 * `revision` ordinal re-runs the probe after a session switch (/new, /fork,
 * /resume). One async read per mount/revision — a failed probe (non-repo,
 * git missing, timeout) resolves "" and silently degrades to the
 * directory-only bar. `steer` is the page's composer-busy mirror (the
 * existing steer window; no new state).
 *
 * Width law: the title is ONE line fitted to the terminal (pure
 * `composerFrameTitle`, unit-tested): segments joined by ` · `, one space
 * before and after the text; the steer segment gains a braille frame prefix
 * while busy (`⠋ steer`, 7 cells). When tight, the DIRECTORY is clipped
 * from the left (truncateLeft — the tail, and the branch, survive); when
 * even the segments cannot fit, the bar degrades to the directory alone
 * (tail kept). The composer colors the whole line with its own frame face
 * (warning while steering, border token otherwise — one titleColor per
 * border, per-segment coloring is not supported by the framework).
 */
import { createEffect, createSignal, on } from "solid-js"
import { onAnimationTick } from "@opentui/solid"
import { useTerminalSize } from "./terminal-size"
import { homedir } from "node:os"
import { SPINNER_FRAMES } from "../../component/spinner-frames"
import { motionFrameRate } from "../../skin/motion"
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
 * The rendered context label: `{dir} · {branch}` (branch omitted when
 * empty), the directory home-abbreviated and the WHOLE label left-clipped
 * to `maxColumns`. Pure and unit-tested. Still the dir/branch text producer
 * — `composerFrameTitle` takes its directory text from here.
 */
export function composerContextLabel(input: {
	cwd: string
	branch?: string
	/** Home directory for `~/` abbreviation; omitted = raw path. */
	home?: string
	/** Total display columns available for the label. */
	maxColumns: number
}): string {
	const cwd = input.cwd.trim()
	if (!cwd) return ""
	const dir = input.home ? abbreviateHome(cwd, input.home) : cwd
	const branch = (input.branch ?? "").trim()
	return truncateLeft(branch ? `${dir} · ${branch}` : dir, input.maxColumns)
}

/** The frame-title law (pure): ONE space on each side of the segment text
 * (the original `" steer "` precedent — no dash runs of our own; the border
 * corner, its inset char and its fill provide the rule), segments joined by
 * a single-width middle dot. The trailing space keeps the text off the
 * border fill. */
const FRAME_HEAD = " "
const FRAME_TAIL = " "
const FRAME_SEP = " · "
/** Busy steer segment with its braille frame prefix: 1 + 1 + 5 = 7 cells. */
const STEER_TEXT = "steer"
/** Cells the composer border spends around the title: left edge/corner, the
 * renderer's one-cell title inset after it, right edge/corner, plus the
 * native draw's own margin — EMPIRICAL LAW (verify/ui-matrix probes): a
 * border title wider than `boxWidth - 4` is silently NOT drawn by the
 * native box (117 wide on a 120 box → bare border; 116 draws). */
const FRAME_EDGE_CELLS = 4

/**
 * The braille frame for spinner tick `index`, wrapping in both directions
 * (pure, unit-tested): `spinnerFrame(SPINNER_FRAMES.length)` lands back on
 * the first frame. Shared by the composer steer segment's busy animation.
 */
export function spinnerFrame(index: number): string {
	const count = SPINNER_FRAMES.length
	return SPINNER_FRAMES[(((index % count) + count) % count)]!
}

/**
 * The composer top-border title (pure, unit-tested): `[steer?] dir [branch]`
 * joined by ` · `, the whole text wrapped in one space on each side — NO
 * dash prefix (user feedback: it read as a stray thin line). `frame` is the
 * busy spinner's current braille char: a non-empty value prefixes the steer
 * segment (`⠋ steer`, 7 cells); undefined/empty = the bare `steer` word.
 * Fitted to `cols` terminal columns. When the full form is too wide the
 * DIRECTORY is left-clipped (steer + branch survive verbatim — the tail and
 * the state marker matter most); when even that cannot fit, the bar
 * degrades to the directory alone (tail kept). No dir at all → "" (the
 * caller hides the title). `cols` is the full terminal width; the function
 * reserves `FRAME_EDGE_CELLS` for the border frame itself.
 */
export function composerFrameTitle(input: {
	/** Steer window (composer busy): prepends the steer segment. */
	steer?: boolean
	/** Current spinner frame char (busy animation); undefined/empty = the
	 * bare `steer` word with no frame prefix. */
	frame?: string
	cwd: string
	branch?: string
	/** Home directory for `~/` abbreviation; omitted = raw path. */
	home?: string
	/** Terminal width in display columns. */
	cols: number
}): string {
	const interior = Math.max(0, input.cols - FRAME_EDGE_CELLS)
	if (interior <= 0) return ""
	const dir = composerContextLabel({ cwd: input.cwd, home: input.home, maxColumns: Number.MAX_SAFE_INTEGER })
	// dir 必有 (the data source guarantees a workspace): without it the bar
	// is meaningless — "" hides the title (the caller falls back / omits).
	if (!dir) return ""
	const branch = (input.branch ?? "").trim()
	const frame = input.frame ?? ""
	const steerSeg = input.steer ? (frame ? `${frame} ${STEER_TEXT}` : STEER_TEXT) : ""
	const segments = [steerSeg, dir, branch].filter((s) => s !== "")
	if (segments.length === 0) return ""
	const render = (segs: string[]) => FRAME_HEAD + segs.join(FRAME_SEP) + FRAME_TAIL
	if (stringWidth(render(segments)) <= interior) return render(segments)
	// Narrow: keep steer + branch verbatim, clip the directory from the left.
	const fixed =
		stringWidth(FRAME_HEAD) +
		(steerSeg ? stringWidth(steerSeg + FRAME_SEP) : 0) +
		(branch ? stringWidth(FRAME_SEP + branch) : 0) +
		stringWidth(FRAME_TAIL)
	const dirBudget = interior - fixed
	if (dir && dirBudget >= 1) {
		return render([steerSeg, truncateLeft(dir, dirBudget), branch].filter((s) => s !== ""))
	}
	// Segments cannot fit at all: degrade to the directory alone (tail kept).
	const lone = truncateLeft(dir, interior - stringWidth(FRAME_HEAD) - stringWidth(FRAME_TAIL))
	return lone ? FRAME_HEAD + lone + FRAME_TAIL : ""
}

export type ComposerContextProps = {
	/** Workspace directory (getter-prop law: a stable function value). */
	cwd: () => string
	/** Async branch probe; resolves "" outside a repo / on failure. */
	probeBranch?: (cwd: string) => Promise<string>
	/** Refresh ordinal — a bump re-reads the branch (session switch / /new). */
	revision?: () => number
	/** The steer window (page's composer-busy mirror): adds the `steer`
	 * segment to the bar while a turn is running. */
	steer?: () => boolean
	/** Publishes the reactive frame title; the page hands it to
	 * SessionComposer's `frameTitle` so the composer's own top border embeds
	 * the segments. Called once at setup. */
	attachTitle?: (get: () => string) => void
}

/** Renders nothing by design (see module doc): data + title publish only. */
export function ComposerContext(props: ComposerContextProps) {
	const dimensions = useTerminalSize()
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

	// Busy steer spinner: the frame index rides a signal so the attached
	// title getter recomposes (and the composer's top border repaints) per
	// tick. Shared animation clock ONLY (contract §2.2, template
	// widgets-dock.tsx:1026 — `onAnimationTick(rate, onTick)`):
	// the rate accessor returns undefined whenever the steer window is
	// CLOSED (props.steer() false) — `undefined` PAUSES the clock entirely,
	// so an idle composer performs ZERO ticks (motion.ts idle-exposure
	// contract; never a setInterval). While busy, motionFrameRate() maps the
	// motion tier (off → paused, reduced/full → STREAM_FPS).
	const [spin, setSpin] = createSignal(0)
	onAnimationTick(
		() => (props.steer?.() ? motionFrameRate() : undefined),
		() => setSpin((s) => (s + 1) % SPINNER_FRAMES.length),
	)

	// The reactive frame title: steer?(+braille frame) + dir + branch, fitted
	// to the terminal width. Reading it from SessionComposer's top-border
	// expression keeps the border live on branch/width/steer/tick changes.
	props.attachTitle?.(() =>
		composerFrameTitle({
			steer: props.steer?.() ?? false,
			frame: props.steer?.() ? spinnerFrame(spin()) : undefined,
			cwd: props.cwd(),
			branch: branch(),
			home: safeHome(),
			cols: dimensions().width,
		}),
	)

	return undefined
}

/** `~` abbreviation is cosmetic: no home (or a throwing lookup) = raw path. */
function safeHome(): string | undefined {
	try {
		return homedir()
	} catch {
		return undefined
	}
}
