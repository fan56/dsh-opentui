/**
 * dock-host.test.tsx — the in-flow dock host contract (spec §2, §7, §10;
 * ADR-0008 decision 4/7). Pinned here against the real @opentui test
 * renderer:
 *
 *  - queued requests render first-come-first-served; only the head paints;
 *  - `queueDepth()` counts the requests behind the head (the surface's
 *    "N more waiting" footer hint);
 *  - one `dock` ownership frame exists exactly while the queue is non-empty;
 *  - the composer keeps its component (hidden, not unmounted) while the dock
 *    is up and gets the seat back when the queue drains;
 *  - the height cap is `min(60% of live terminal rows, content rows)` with a
 *    visible overflow indicator, and a resize re-clamps without replacing the
 *    content;
 *  - narrow terminals keep the full width and truncate nothing;
 *  - focus: designated focusable on open/head-change, the composer ref on
 *    drain (once per settlement, never while a queued request takes the slot)
 *    — called from a post-layout frame callback, so the renderer focus has
 *    actually moved when the assertion runs.
 */
import { describe, expect, test } from "bun:test"
import { For, onMount } from "solid-js"
import { testRender } from "@opentui/solid"
import type { BoxRenderable } from "@opentui/core"
import { InputOwnershipProvider, useInputOwnership } from "../src/context/input-ownership"
import { DockProvider, DockSeat, useDock, type DockApi } from "../src/routes/session/dock-host"

type Setup = Awaited<ReturnType<typeof testRender>>

interface HarnessHandles {
	api?: DockApi
	topKind: () => string
	composerMounts: () => number
	composerEl: () => BoxRenderable | undefined
}

function CaptureDock(props: { done: (api: DockApi) => void }) {
	props.done(useDock())
	return <box height={0} />
}

function CaptureOwnership(props: { done: (ownership: ReturnType<typeof useInputOwnership>) => void }) {
	props.done(useInputOwnership())
	return <box height={0} />
}

function Composer(props: {
	mounts: (value: number) => void
	element: (value: BoxRenderable | undefined) => void
}) {
	let count = 0
	let el: BoxRenderable | undefined
	onMount(() => props.mounts(++count))
	return (
		<box
			ref={(value: BoxRenderable) => {
				el = value
				props.element(value)
			}}
			width="100%"
			height={1}
			focusable={true}
			title="seat"
		>
			<text wrapMode="none">composer seat</text>
		</box>
	)
}

async function mount(options: { width: number; height: number }): Promise<{ setup: Setup; handles: HarnessHandles }> {
	let composerEl: BoxRenderable | undefined
	const handles: HarnessHandles = {
		topKind: () => "page",
		composerMounts: () => 0,
		composerEl: () => composerEl,
	}
	const setup = await testRender(
		() => (
			<InputOwnershipProvider>
				<DockProvider>
					<CaptureDock
						done={(api) => {
							handles.api = api
							// The page wiring under test (spec §10): the refocus runs by
							// ref. Individual tests may override it with a spy.
							api.bindComposerFocus(() => handles.composerEl()?.focus())
						}}
					/>
					<CaptureOwnership done={(ownership) => (handles.topKind = () => ownership.top().kind)} />
					<DockSeat
						composer={() => (
							<Composer
								mounts={(value) => (handles.composerMounts = () => value)}
								element={(value) => {
									composerEl = value
									handles.composerEl = () => value
								}}
							/>
						)}
					/>
					{/* Page-root sibling below the seat (the powerline/hints stand-in):
					 * proves the dock occupies the seat in flow, above it. */}
					<box height={1} width="100%">
						<text wrapMode="none">below-seat</text>
					</box>
				</DockProvider>
			</InputOwnershipProvider>
		),
		{ width: options.width, height: options.height, exitOnCtrlC: false },
	)
	await settle(setup)
	return { setup, handles }
}

/** Flush Solid effects, layout, the frame event (the dock's after-layout
 * hook) and the paint. */
async function settle(setup: Setup, rounds = 6): Promise<void> {
	for (let index = 0; index < rounds; index += 1) {
		await new Promise((resolve) => setTimeout(resolve, 5))
		await setup.renderOnce()
	}
}

const frame = (setup: Setup): string => setup.captureCharFrame()

const lines = (count: number, prefix = "dock-row"): string[] =>
	Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(2, "0")}`)

function Content(props: { rows: readonly string[]; focusable?: boolean }) {
	return (
		<box flexDirection="column" width="100%">
			<For each={props.rows}>{(row) => <text wrapMode="none">{row}</text>}</For>
			<box
				height={props.focusable ? 1 : 0}
				focusable={props.focusable === true}
			/>
		</box>
	)
}

describe("dock host (spec §2/§7/§10)", () => {
	test("FCFS queue, depth count, frame push/pop and composer seat restore", async () => {
		const { setup, handles } = await mount({ width: 80, height: 24 })
		try {
			const api = handles.api
			expect(api).toBeDefined()
			if (api === undefined) return

			expect(frame(setup)).toContain("composer seat")
			expect(api.isOpen()).toBe(false)
			expect(api.queueDepth()).toBe(0)
			expect(handles.topKind()).toBe("page")

			const first = api.open(() => <Content rows={["dock-A"]} />, { kind: "ask" })
			const second = api.open(() => <Content rows={["dock-B"]} />, { kind: "approval" })
			const third = api.open(() => <Content rows={["dock-C"]} />)
			await settle(setup)

			// Only the head renders; the other two wait in order.
			expect(frame(setup)).toContain("dock-A")
			expect(frame(setup)).not.toContain("dock-B")
			expect(frame(setup)).not.toContain("dock-C")
			expect(api.queueDepth()).toBe(2)
			expect(api.currentKind()).toBe("ask")
			expect(handles.topKind()).toBe("dock")

			first.close()
			await settle(setup)
			expect(frame(setup)).toContain("dock-B")
			expect(frame(setup)).not.toContain("dock-C")
			expect(api.queueDepth()).toBe(1)
			expect(api.currentKind()).toBe("approval")
			// The frame is still ours: hand-off happens in the same slot.
			expect(handles.topKind()).toBe("dock")

			second.close()
			await settle(setup)
			expect(frame(setup)).toContain("dock-C")
			expect(api.queueDepth()).toBe(0)

			third.close()
			await settle(setup)
			expect(api.isOpen()).toBe(false)
			expect(frame(setup)).toContain("composer seat")
			expect(frame(setup)).not.toContain("dock-")
			// Frame popped in the same close that drained the queue.
			expect(handles.topKind()).toBe("page")
			// close() is idempotent and never re-pushes.
			third.close()
			await settle(setup)
			expect(handles.topKind()).toBe("page")
			// The composer was hidden, never unmounted (draft/controller state).
			expect(handles.composerMounts()).toBe(1)
		} finally {
			await setup.dispose()
		}
	})

	test("height cap is 60% of the live terminal, overflow scrolls with an indicator", async () => {
		const { setup, handles } = await mount({ width: 80, height: 24 })
		try {
			const api = handles.api
			if (api === undefined) return
			const handle = api.open(() => <Content rows={lines(30)} />)
			await settle(setup)

			const painted = frame(setup)
			// 24 rows → cap 14; the indicator takes one row → 13 content rows.
			expect(painted).toContain("dock-row-01")
			expect(painted).toContain("dock-row-13")
			expect(painted).not.toContain("dock-row-14")
			expect(painted).not.toContain("dock-row-30")
			expect(painted).toContain("↑↓ 17")

			handle.close()
			await settle(setup)
			expect(frame(setup)).not.toContain("↑↓")
		} finally {
			await setup.dispose()
		}
	})

	test("hand-off keeps the measured height correct when the next request shrinks", async () => {
		const { setup, handles } = await mount({ width: 80, height: 24 })
		try {
			const api = handles.api
			if (api === undefined) return
			const rowIndex = (needle: string): number => frame(setup).split("\n").findIndex((line) => line.includes(needle))

			const first = api.open(() => <Content rows={["handoff-A1", "handoff-A2", "handoff-A3"]} />)
			await settle(setup)
			expect(rowIndex("below-seat") - rowIndex("handoff-A1")).toBe(3)

			void api.open(() => <Content rows={["handoff-B1"]} />)
			await settle(setup)
			first.close()
			await settle(setup)
			// The mounted slot shrank to the new body: one content row, then the
			// page-root sibling immediately below the seat (no cap-sized gap).
			expect(rowIndex("below-seat") - rowIndex("handoff-B1")).toBe(1)
		} finally {
			await setup.dispose()
		}
	})

	test("resize re-clamps the live cap without replacing the content", async () => {
		const { setup, handles } = await mount({ width: 80, height: 24 })
		try {
			const api = handles.api
			if (api === undefined) return
			const handle = api.open(() => <Content rows={lines(30)} />)
			await settle(setup)
			expect(frame(setup)).not.toContain("dock-row-20")

			setup.resize(80, 40)
			await settle(setup)
			// 40 rows → cap 24 → 23 content rows: the same mounted content now
			// exposes rows that were below the old cap.
			expect(frame(setup)).toContain("dock-row-20")
			expect(frame(setup)).toContain("dock-row-23")
			expect(frame(setup)).not.toContain("dock-row-24")
			expect(frame(setup)).toContain("↑↓ 7")

			handle.close()
			await settle(setup)
		} finally {
			await setup.dispose()
		}
	})

	test("narrow terminal keeps full width and truncates nothing", async () => {
		const { setup, handles } = await mount({ width: 50, height: 24 })
		try {
			const api = handles.api
			if (api === undefined) return
			const wide = "W".repeat(50)
			const long = "a long option label that must wrap instead of being cut off"
			const handle = api.open((ctx) => (
				<box flexDirection="column" width="100%">
					<text wrapMode="none">{wide}</text>
					<text wrapMode="word">{long}</text>
					<text wrapMode="none">{`ctx-width-${ctx.width()}`}</text>
				</box>
			))
			await settle(setup)
			const painted = frame(setup)
			expect(painted).toContain(wide)
			expect(painted).toContain("ctx-width-50")
			// Wrapped, not truncated: the tail of the label is still painted.
			expect(painted).toContain("cut off")
			handle.close()
			await settle(setup)
		} finally {
			await setup.dispose()
		}
	})

	test("focus: designated focusable on open, composer ref on drain, once per settlement", async () => {
		const { setup, handles } = await mount({ width: 80, height: 24 })
		try {
			const api = handles.api
			if (api === undefined) return
			const dockFocus: string[] = []
			const composerFocus: string[] = []
			api.bindComposerFocus(() => {
				composerFocus.push("composer")
				handles.composerEl()?.focus()
			})
			const focusFor = (name: string) => () => ({
				focus: () => dockFocus.push(name),
			})

			const first = api.open(() => <Content rows={["focus-A"]} />, { focusRef: focusFor("A") })
			await settle(setup)
			expect(dockFocus).toEqual(["A"])
			expect(composerFocus).toEqual([])

			const second = api.open(() => <Content rows={["focus-B"]} />, { focusRef: focusFor("B") })
			await settle(setup)
			first.close()
			await settle(setup)
			// Hand-off: the next head owns focus; the composer is NOT refocused.
			expect(dockFocus).toEqual(["A", "B"])
			expect(composerFocus).toEqual([])

			second.close()
			await settle(setup)
			// Exactly one composer focus call for the settlement...
			expect(composerFocus).toEqual(["composer"])
			// ...and it really moved the renderer focus after layout.
			expect(handles.composerEl()?.focused).toBe(true)

			const third = api.open(() => <Content rows={["focus-C"]} />, { focusRef: focusFor("C") })
			await settle(setup)
			third.close()
			await settle(setup)
			expect(composerFocus).toEqual(["composer", "composer"])
		} finally {
			await setup.dispose()
		}
	})

	test("without a focusRef the host focuses the first focusable inside the body", async () => {
		const { setup, handles } = await mount({ width: 80, height: 24 })
		try {
			const api = handles.api
			if (api === undefined) return
			const handle = api.open(() => <Content rows={["auto-focus"]} focusable={true} />)
			await settle(setup)
			const focused = setup.renderer.currentFocusedRenderable
			expect(focused).not.toBeNull()
			expect(focused).not.toBe(handles.composerEl())
			handle.close()
			await settle(setup)
			expect(setup.renderer.currentFocusedRenderable).toBe(handles.composerEl())

			// No focusable inside the surface: the hidden composer must not keep
			// the renderer focus and swallow the dock's raw typing.
			const bare = api.open(() => <Content rows={["no-focus"]} />)
			await settle(setup)
			expect(setup.renderer.currentFocusedRenderable).toBeNull()
			bare.close()
			await settle(setup)
			expect(setup.renderer.currentFocusedRenderable).toBe(handles.composerEl())
		} finally {
			await setup.dispose()
		}
	})
})
