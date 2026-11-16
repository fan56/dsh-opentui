/**
 * DockHost — the in-flow interaction dock at the composer seat
 * (`docs/ask-user-panel-spec.md` §2, §7, §10; ADR-0008 decisions 4 and 7).
 *
 * The dock is NOT a panel-kit panel and NOT a vendored dialog. It is a plain
 * member of the page-root column, a sibling of `Transcript`, so a dock renders
 * ABOVE the powerline/hints, takes the composer's seat while it is up, and
 * lets the transcript reflow into the rows it leaves. No scrim, no absolute
 * layer, no dialog entry.
 *
 * Two pieces:
 *
 *   - `DockProvider` owns the queue, the `dock` ownership frame, and the focus
 *     lifecycle. It must live ABOVE the page component so the page (and the
 *     surface that opens the dock) can call `useDock()`.
 *   - `DockSeat` is the in-flow seat: it keeps the composer mounted and
 *     hidden while the dock is up (the composer's draft/history live in its
 *     component-scoped controller, so unmounting it would lose them), renders
 *     the head request full-width with the live 60% height cap, and hands the
 *     composer the seat back when the queue drains.
 *
 * Semantics pinned here:
 *
 *   - requests queue first-come-first-served; only the head renders;
 *   - `queueDepth()` counts the requests BEHIND the shown head (the surface's
 *     "N more waiting" footer hint; the host never renders that text);
 *   - a `dock` frame is pushed when the first request arrives and popped when
 *     the queue drains — the only frame bookkeeping, both idempotent;
 *   - height = `min(60% of the live terminal rows, content rows)`, content
 *     over the cap scrolls with a one-line overflow indicator;
 *   - on open/head-change focus goes to the request's designated focusable
 *     (falling back to the first focusable inside the body); on drain the
 *     composer is refocused through the page's ref (`bindComposerFocus`) in a
 *     post-layout frame callback — never a microtask or timer, and never while
 *     a queued request takes the slot (spec §10).
 *
 * EXTENSION POINT (ask surface — later task; see docs/ask-user-panel-spec.md
 * §2, §6, §7, §10). This file intentionally contains no ask content, option
 * rows, inline input, Esc ladder or admission logic. The only integration is:
 *
 *   const dock = useDock()
 *   const handle = dock.open((ctx) => <AskPanel width={ctx.width} ... />, {
 *     kind: "ask",
 *     focusRef: () => panelFocus,   // the panel's list or inline input
 *     overflowLabel: (n) => t("overlay.ask.overflow", { count: n }),
 *   })
 *
 * and calls `handle.close()` on settlement. The host deliberately knows
 * nothing about options, keys or admission order between ask and approval:
 * that belongs to the controller/surface (spec §6, §7). No ask surface is
 * wired here.
 */
import {
	createContext,
	createEffect,
	createSignal,
	on,
	onCleanup,
	Show,
	useContext,
	type Accessor,
	type JSX,
	type ParentProps,
} from "solid-js"
import { useRenderer } from "@opentui/solid"
import type { Renderable, ScrollBoxRenderable } from "@opentui/core"
import { useInputOwnershipOptional, type OwnerFrame } from "../../context/input-ownership"
import { useThemeOptional } from "../../context/theme"
import { useTerminalSize } from "./terminal-size"

/** The dock never takes more than 60% of the terminal rows (spec §2). */
export const DOCK_MAX_ROWS_RATIO = 0.6

/** The dock's designated focusable (a textarea, a list, any Renderable). */
export interface DockFocusable {
	focus(): void
}

/** Per-render geometry handed to the content. Accessors, not numbers: the
 * content reads them inside its own tracking scopes, so a resize reflows the
 * mounted panel instead of remounting it (internal state survives). */
export interface DockRenderContext {
	/** Stable request id (same value for every render of this request). */
	readonly id: number
	/** Close this request (settlement). Idempotent. */
	close(): void
	/** Live terminal columns — the dock is always full width. */
	readonly width: Accessor<number>
	/** Live row cap for the dock (60% of terminal rows). */
	readonly maxHeight: Accessor<number>
}

export interface DockOpenOptions {
	/** Extension-point label ("ask", "approval", ...). Never rendered. */
	kind?: string
	/** Expected content rows before the host measures the body. Avoids one
	 * cap-sized frame on open; the measurement wins once it lands. */
	contentRows?: number
	/** The dock's designated focusable. Called on open and on head-change;
	 * when it returns undefined the host focuses the first focusable inside
	 * the body. */
	focusRef?: () => DockFocusable | undefined
	/** Overflow indicator text; default `↑↓ <hidden rows>`. The ask surface
	 * passes its i18n key here (spec §13 `overlay.ask.overflow`). */
	overflowLabel?: (hiddenRows: number) => string
}

export interface DockHandle {
	readonly id: number
	/** Idempotent: settles this request; the queue advances to the next head. */
	close(): void
}

/** One queued request. Exposed to `DockSeat` (the only consumer). */
export interface DockEntry {
	readonly id: number
	readonly kind?: string
	readonly options: DockOpenOptions
	readonly close: () => void
	render(context: DockRenderContext): JSX.Element
}

export interface DockApi {
	/** Queue a dock request (FCFS). Only the head renders; the slot, the
	 * ownership frame and the focus live until the queue drains. */
	open(render: (context: DockRenderContext) => JSX.Element, options?: DockOpenOptions): DockHandle
	/** Requests pending BEHIND the shown head ("N more waiting"). Reactive. */
	queueDepth(): number
	/** True while the dock takes the composer seat. */
	isOpen(): boolean
	/** The shown request's `kind` (undefined while closed). */
	currentKind(): string | undefined
	/** Host wiring — `DockSeat` only. */
	current(): DockEntry | undefined

	/* --- page wiring (spec §10) ------------------------------------------ */
	/** The page registers its composer refocus by ref. The host calls it
	 * exactly once per settlement that drains the queue, after layout. */
	bindComposerFocus(refocus: (() => void) | undefined): void
	/** `DockSeat` registers the focus resolver (designated ref → first
	 * focusable inside the body). */
	bindFocusTarget(resolve: (() => DockFocusable | undefined) | undefined): void
}

const Context = createContext<DockApi | undefined>(undefined)

let ordinal = 0

function firstFocusable(node: Renderable | undefined): DockFocusable | undefined {
	if (node === undefined) return undefined
	for (const child of node.getChildren()) {
		if (child.focusable) return child
		const nested = firstFocusable(child)
		if (nested !== undefined) return nested
	}
	return undefined
}

export function DockProvider(props: ParentProps): JSX.Element {
	const renderer = useRenderer()
	// ADR-0008: the frame is pushed only while the dock is up. A harness
	// mounted without the ownership provider keeps the pre-ownership behavior
	// (no frame to leak, nothing to gate).
	const ownership = useInputOwnershipOptional()
	const [queue, setQueue] = createSignal<readonly DockEntry[]>([])

	let frame: OwnerFrame | undefined
	let composerFocus: (() => void) | undefined
	let focusTarget: (() => DockFocusable | undefined) | undefined
	let cancelAfterLayout: (() => void) | undefined

	const hasRequests = () => queue().length > 0

	/**
	 * Run `callback` after the next laid-out frame. OpenTUI's `frame` event is
	 * emitted after `nativeScene.paint` (layout) and the present, so this is a
	 * layout guarantee — not a microtask, not a `setTimeout` race with the
	 * dialog's 1 ms refocus or the overlay host's 3 ms reclaim.
	 */
	function afterLayout(callback: () => void): void {
		cancelAfterLayout?.()
		if (renderer.isDestroyed) return
		let done = false
		const handler = () => {
			if (done) return
			done = true
			renderer.off("frame", handler)
			if (cancelAfterLayout === cancel) cancelAfterLayout = undefined
			callback()
		}
		const cancel = () => {
			if (done) return
			done = true
			renderer.off("frame", handler)
			if (cancelAfterLayout === cancel) cancelAfterLayout = undefined
		}
		cancelAfterLayout = cancel
		renderer.on("frame", handler)
	}

	function focusDock(): void {
		afterLayout(() => {
			if (!hasRequests()) return
			const target = focusTarget?.()
			if (target !== undefined) {
				target.focus()
				return
			}
			// No focusable inside the surface (yet): the composer is hidden in
			// this transition, so it must not keep the renderer focus — a hidden
			// textarea would swallow raw typing the dock layer never sees.
			renderer.currentFocusedRenderable?.blur()
		})
	}

	function remove(entry: DockEntry): void {
		const before = queue()
		if (!before.includes(entry)) return
		const next = before.filter((item) => item !== entry)
		setQueue(next)
		if (next.length > 0) {
			// The next head takes the same mounted slot: no dock unmount/remount,
			// no frame churn, and the composer is NOT refocused (spec §10).
			if (before[0] !== next[0]) focusDock()
			return
		}
		// The queue drained: release the frame in the same call that empties
		// the slot, then hand focus back after layout. Exactly one owner per
		// transition.
		if (frame !== undefined) {
			ownership?.pop(frame)
			frame = undefined
		}
		afterLayout(() => {
			if (hasRequests()) return
			composerFocus?.()
		})
	}

	const api: DockApi = {
		open(render, options = {}) {
			const id = ++ordinal
			const entry: DockEntry = {
				id,
				kind: options.kind,
				options,
				close: () => remove(entry),
				render,
			}
			const before = queue()
			setQueue([...before, entry])
			if (before.length === 0) {
				// Push before the first paint of the content (ADR-0008: the dock
				// cannot leak page keys, even on its opening frame).
				frame = ownership?.push("dock")
				focusDock()
			}
			return { id, close: entry.close }
		},
		queueDepth: () => Math.max(0, queue().length - 1),
		isOpen: () => hasRequests(),
		currentKind: () => queue()[0]?.kind,
		current: () => queue()[0],
		bindComposerFocus(refocus) {
			composerFocus = refocus
		},
		bindFocusTarget(resolve) {
			focusTarget = resolve
		},
	}

	onCleanup(() => {
		cancelAfterLayout?.()
		if (frame !== undefined) {
			ownership?.pop(frame)
			frame = undefined
		}
		setQueue([])
	})

	return <Context.Provider value={api}>{props.children}</Context.Provider>
}

/** The dock API. Requires `DockProvider` above the page body (v2-entry
 * mounts it at the page boundary, inside the ownership provider and the
 * renderer, with the page body as its child). */
export function useDock(): DockApi {
	const value = useContext(Context)
	if (!value) throw new Error("Dock.Provider is missing")
	return value
}

export interface DockSeatProps {
	/** The composer slot. Called once: the composer stays mounted for the
	 * page's lifetime — hidden while the dock is up, so its draft, history
	 * and delivery queue survive the dock (spec §2: "the draft lives in
	 * composer state"). */
	composer: () => JSX.Element
}

/**
 * The in-flow seat. With an empty queue it renders exactly the composer it is
 * given; with a request it renders the dock above it inside the same column,
 * full width, and hides the composer (display:none — no rows).
 */
export function DockSeat(props: DockSeatProps): JSX.Element {
	const dock = useDock()
	const dimensions = useTerminalSize()
	const theme = useThemeOptional()

	let scroll: ScrollBoxRenderable | undefined
	let body: Renderable | undefined
	let disposed = false
	/** Measured content rows; undefined = not measured yet (use the hint/cap). */
	const [measured, setMeasured] = createSignal<number | undefined>(undefined)

	const resolveFocus = (): DockFocusable | undefined => {
		const designated = dock.current()?.options.focusRef?.()
		return designated ?? firstFocusable(body)
	}
	dock.bindFocusTarget(resolveFocus)
	onCleanup(() => {
		disposed = true
		dock.bindFocusTarget(undefined)
	})

	/** Live 60% cap — a function of the terminal height, so a resize
	 * re-clamps on the next layout pass. */
	const capRows = () => Math.max(1, Math.floor(dimensions().height * DOCK_MAX_ROWS_RATIO))
	const contentRows = () => measured() ?? dock.current()?.options.contentRows ?? capRows()
	// The footer indicator needs one row; it exists only when the content
	// exceeds the cap (a dock that fits exactly shows no padding, no footer).
	const overflows = () => contentRows() > capRows() && capRows() > 1
	const viewportRows = () => Math.max(1, Math.min(contentRows(), capRows() - (overflows() ? 1 : 0)))
	const hiddenRows = () => Math.max(0, contentRows() - viewportRows())
	const indicatorText = () => {
		const label = dock.current()?.options.overflowLabel
		return label ? label(hiddenRows()) : `↑↓ ${hiddenRows()}`
	}

	const muted = () => theme?.text.muted ?? "#9aa5ce"
	const background = () => theme?.background.base ?? "black"

	// Hand-off: the next request starts at the top. The mounted slot (box +
	// scrollbox) is reused and the measured height is kept: if the new body
	// has a different height, `onSizeChange` corrects it on the next layout;
	// if it has the same height, the kept value is already right (resetting
	// would leave the dock at the cap because no size change would fire).
	createEffect(
		on(
			() => dock.current()?.id,
			() => {
				if (scroll !== undefined && !scroll.isDestroyed) scroll.scrollTo(0)
			},
			{ defer: true },
		),
	)

	// Resize: the cap drops, and the only thing a resize may do to the body is
	// clamp the scroll position (the batch, cursor and draft are untouched).
	createEffect(
		on(
			capRows,
			() => {
				if (scroll === undefined || scroll.isDestroyed) return
				scroll.afterLayout(() => {
					if (scroll === undefined || scroll.isDestroyed) return
					const max = Math.max(0, scroll.scrollHeight - scroll.viewport.height)
					if (scroll.scrollTop > max) scroll.scrollTo(max)
				})
			},
			{ defer: true },
		),
	)

	return (
		<box width="100%" flexShrink={0} flexDirection="column">
			{/* The composer keeps its component (and controller) alive; only its
			 * rows are hidden while the dock owns the seat (visible=false sets
			 * Yoga display:none). */}
			<box width="100%" flexShrink={0} visible={!dock.isOpen()}>
				{props.composer()}
			</box>
			<Show when={dock.current()}>
				{(request) => (
					<box width="100%" flexShrink={0} flexDirection="column" backgroundColor={background()}>
						{/* No horizontal scroll and no truncation: content wraps at the
						 * full terminal width. The dock owns no gutters — the surface
						 * inside does. */}
						<scrollbox
							ref={(value: ScrollBoxRenderable) => {
								scroll = value
							}}
							width="100%"
							height={viewportRows()}
							flexShrink={0}
							// The box must never become a landing spot for the raw
							// typing lane: the surface's own list/input is the only
							// focus target inside the dock.
							focusable={false}
							scrollY={true}
							scrollX={false}
							overflow="hidden"
							verticalScrollbarOptions={{ visible: false }}
						>
							<box
								ref={(value: Renderable) => {
									body = value
								}}
								width="100%"
								flexDirection="column"
								onSizeChange={function (this: Renderable) {
									if (disposed) return
									const next = Math.max(0, Math.floor(this.height))
									if (next !== measured()) setMeasured(next)
								}}
							>
								{request().render({
									id: request().id,
									close: request().close,
									width: () => dimensions().width,
									maxHeight: capRows,
								})}
							</box>
						</scrollbox>
						<Show when={overflows() && hiddenRows() > 0}>
							<text fg={muted()} wrapMode="none" paddingLeft={1}>
								{indicatorText()}
							</text>
						</Show>
					</box>
				)}
			</Show>
		</box>
	)
}
