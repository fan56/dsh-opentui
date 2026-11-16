/**
 * ask-panel.test.tsx — the ask surface BODY rendered inside the in-flow dock
 * against the real @opentui test renderer (spec §2-§5, §8, §13):
 *
 *  - eyebrow / wrapped title / detail / numbered option rows;
 *  - the Recommended badge is extracted from `(Recommended)` and `（推荐）`
 *    (spec §3) and drops to its own line below 64 columns;
 *  - option descriptions wrap onto an indented continuation line;
 *  - the tab strip `[1 ✓] · 2 · 3` (no `(i/n)` title suffix);
 *  - the resident inline row is always last and always visible, and takes the
 *    renderer focus when the phase says so;
 *  - the review page rows (+ Submit, unanswered state) and the phase-derived
 *    footer hints;
 *  - the dock's queue indicator.
 *
 * This is a RENDERING test: no key bindings are exercised (the key layer is
 * the next task). Controller mutations stand in for the keys.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { onMount } from "solid-js"
import { testRender } from "@opentui/solid"
import { bundledLocalesDir, loadLocales, setLanguage, setLanguages } from "@dsh-opentui/i18n"
import { DockProvider, DockSeat, useDock, type DockApi, type DockHandle } from "../src/routes/session/dock-host"
import { AskPanel } from "../src/routes/session/ask-panel"
import { TurnOverlayController } from "../src/routes/session/turn-overlay-controller"

beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages)
})

type Setup = Awaited<ReturnType<typeof testRender>>

function CaptureDock(props: { done: (api: DockApi) => void }) {
	props.done(useDock())
	return <box height={0} />
}

async function mount(options: { width: number; height: number }): Promise<{ setup: Setup; api: DockApi }> {
	let api: DockApi | undefined
	const setup = await testRender(
		() => (
			<DockProvider>
				<CaptureDock done={(value) => (api = value)} />
				<DockSeat
					composer={() => (
						<box width="100%" height={1}>
							<text wrapMode="none">composer seat</text>
						</box>
					)}
				/>
			</DockProvider>
		),
		{ width: options.width, height: options.height, exitOnCtrlC: false },
	)
	await settle(setup)
	if (api === undefined) throw new Error("dock api missing")
	return { setup, api }
}

/** Flush Solid effects, layout, the dock's after-layout focus and the paint. */
async function settle(setup: Setup, rounds = 6): Promise<void> {
	for (let index = 0; index < rounds; index += 1) {
		await new Promise((resolve) => setTimeout(resolve, 5))
		await setup.renderOnce()
	}
}

const frame = (setup: Setup): string => setup.captureCharFrame()

function openAsk(api: DockApi, controller: TurnOverlayController): DockHandle {
	return api.open(
		(ctx) => (
			<AskPanel
				controller={controller}
				width={ctx.width}
				onFocusTarget={() => {
					// The host's designated focus resolution is exercised by
					// dock-host.test.tsx; rendering does not depend on it here.
				}}
			/>
		),
		{ kind: "ask" },
	)
}

const lineWith = (setup: Setup, needle: string): string | undefined =>
	frame(setup)
		.split("\n")
		.find((line) => line.includes(needle))

describe("ask panel body (spec §2-§5, §8)", () => {
	test("eyebrow, wrapped title, detail, numbered rows, description line, badge", async () => {
		const { setup, api } = await mount({ width: 80, height: 30 })
		try {
			const controller = new TurnOverlayController()
			controller.answer([
				{
					id: "q1",
					prompt: "Which database should the migration target for the next release cycle?",
					header: "Storage",
					detail: "Pick the engine the ops team already runs.",
					options: [
						{ label: "postgres (Recommended)", description: "managed, battle tested" },
						{ label: "sqlite" },
					],
				},
			])
			const handle = openAsk(api, controller)
			await settle(setup)

			const painted = frame(setup)
			expect(painted).toContain("Storage")
			expect(painted).toContain("Which database should the migration target")
			expect(painted).toContain("Pick the engine the ops team already runs.")
			expect(painted).toContain("› 1. postgres")
			expect(painted).toContain("[Recommended]")
			expect(painted).not.toContain("(Recommended)")
			expect(painted).toContain("2. sqlite")
			expect(painted).toContain("managed, battle tested")
			// The description lives on its own continuation line.
			const label = lineWith(setup, "1. postgres")
			const description = lineWith(setup, "managed, battle tested")
			expect(label).toBeDefined()
			expect(description).toBeDefined()
			expect(description).not.toBe(label)
			handle.close()
		} finally {
			await setup.dispose()
		}
	})

	test("badge extraction: （推荐） is stripped and re-rendered as the badge", async () => {
		setLanguage("zh-CN")
		const { setup, api } = await mount({ width: 80, height: 24 })
		try {
			const controller = new TurnOverlayController()
			controller.answer([
				{ id: "q1", prompt: "engine?", options: [{ label: "sqlite（推荐）" }, { label: "duckdb（beta）" }] },
			])
			const handle = openAsk(api, controller)
			await settle(setup)
			const painted = frame(setup)
			expect(painted).toContain("1. sqlite")
			expect(painted).toContain("[推荐]")
			expect(painted).not.toContain("（推荐）")
			// Only the recommended token is stripped: a `（beta）` stays.
			expect(painted).toContain("duckdb（beta）")
			handle.close()
		} finally {
			setLanguage("en")
			await setup.dispose()
		}
	})

	test("tab strip marks answered tabs and the title has no (i/n) suffix", async () => {
		const { setup, api } = await mount({ width: 80, height: 24 })
		try {
			const controller = new TurnOverlayController()
			controller.answer([
				{ id: "q1", prompt: "first question", options: [{ label: "a" }] },
				{ id: "q2", prompt: "second question", options: [{ label: "b" }] },
				{ id: "q3", prompt: "third question", options: [{ label: "c" }] },
			])
			const handle = openAsk(api, controller)
			await settle(setup)
			expect(frame(setup)).toContain("[1] · 2 · 3")

			// Answer question 1: the controller auto-advances to tab 2.
			controller.toggle("a")
			await settle(setup)
			const painted = frame(setup)
			expect(painted).toContain("1 ✓ · [2] · 3")
			expect(painted).toContain("second question")
			expect(painted).not.toContain("(2/3)")
			handle.close()
		} finally {
			await setup.dispose()
		}
	})

	test("inline row: always last, shows the placeholder, takes focus on the input phase", async () => {
		const { setup, api } = await mount({ width: 80, height: 24 })
		try {
			const controller = new TurnOverlayController()
			controller.answer([{ id: "q1", prompt: "pick one", options: [{ label: "a" }, { label: "b" }] }])
			const handle = openAsk(api, controller)
			await settle(setup)

			const painted = frame(setup)
			expect(painted).toContain("✎")
			expect(painted).toContain("Type something.")
			// The inline row is below every option row.
			const inline = frame(setup).split("\n").findIndex((line) => line.includes("✎"))
			const firstOption = frame(setup).split("\n").findIndex((line) => line.includes("1. a"))
			expect(inline).toBeGreaterThan(firstOption)

			// Options phase: the footer talks about picking.
			expect(painted).toContain("1-9 pick")
			expect(painted).toContain("esc: decline")
			expect(setup.renderer.currentFocusedRenderable).not.toBeNull()
			const listFocus = setup.renderer.currentFocusedRenderable

			controller.focusInput()
			await settle(setup)
			expect(frame(setup)).toContain("esc: back to options")
			expect(frame(setup)).toContain("⏎ confirm")

			// The resident row paints the live buffer (a real input, value-bound).
			controller.setInlineText("free text answer")
			await settle(setup)
			expect(frame(setup)).toContain("free text answer")
			// The renderer focus moved to the resident input.
			const focused = setup.renderer.currentFocusedRenderable
			expect(focused).not.toBeNull()
			expect(focused).not.toBe(listFocus)
			handle.close()
		} finally {
			await setup.dispose()
		}
	})

	test("multi-select rows use the Check glyph vocabulary; footer says space toggle", async () => {
		const { setup, api } = await mount({ width: 80, height: 24 })
		try {
			const controller = new TurnOverlayController()
			controller.answer([
				{ id: "q1", prompt: "checks?", options: [{ label: "lint" }, { label: "smoke" }], multiSelect: true },
			])
			const handle = openAsk(api, controller)
			await settle(setup)
			expect(frame(setup)).toContain("✘ 1. lint")
			expect(frame(setup)).toContain("space toggle")

			controller.toggle("lint")
			await settle(setup)
			const painted = frame(setup)
			expect(painted).toContain("✔ 1. lint")
			expect(painted).toContain("✘ 2. smoke")
			handle.close()
		} finally {
			await setup.dispose()
		}
	})

	test("review page renders a row per question, answers, unanswered state and Submit", async () => {
		const { setup, api } = await mount({ width: 80, height: 30 })
		try {
			const controller = new TurnOverlayController()
			controller.answer([
				{ id: "q1", prompt: "first question", options: [{ label: "a" }, { label: "b" }] },
				{ id: "q2", prompt: "second question", options: [{ label: "x" }, { label: "y" }] },
			])
			const handle = openAsk(api, controller)
			await settle(setup)

			controller.toggle("a") // answers q1, advances to q2
			expect(controller.enterReview()).toBe(true)
			await settle(setup)

			const painted = frame(setup)
			expect(painted).toContain("Review answers")
			expect(painted).toContain("✓ first question")
			expect(painted).toContain("→ a")
			expect(painted).toContain("✓ second question")
			expect(painted).toContain("→ not answered")
			expect(painted).toContain("⏎ Submit answers")
			expect(painted).toContain("esc: back to question")
			handle.close()
		} finally {
			await setup.dispose()
		}
	})

	test("zero-option question: inline row only, input focused, Esc hint declines", async () => {
		const { setup, api } = await mount({ width: 80, height: 20 })
		try {
			const controller = new TurnOverlayController()
			controller.answer([{ id: "q1", prompt: "anything else?", options: [] }])
			const handle = openAsk(api, controller)
			await settle(setup)

			const painted = frame(setup)
			expect(painted).toContain("anything else?")
			expect(painted).toContain("✎")
			expect(painted).not.toContain("1. ")
			expect(painted).toContain("esc: decline")
			expect(painted).not.toContain("1-9 pick")
			handle.close()
		} finally {
			await setup.dispose()
		}
	})

	test("queue indicator comes from the dock host", async () => {
		const { setup, api } = await mount({ width: 80, height: 24 })
		try {
			const controller = new TurnOverlayController()
			controller.answer([{ id: "q1", prompt: "pick one", options: [{ label: "a" }] }])
			const handle = openAsk(api, controller)
			const queued = openAsk(api, new TurnOverlayController())
			await settle(setup)
			expect(frame(setup)).toContain("1 more waiting")
			handle.close()
			queued.close()
		} finally {
			await setup.dispose()
		}
	})

	test("narrow terminal: the badge drops to its own line, nothing truncates", async () => {
		const { setup, api } = await mount({ width: 50, height: 24 })
		try {
			const controller = new TurnOverlayController()
			controller.answer([
				{
					id: "q1",
					prompt: "a long question that must wrap instead of being cut off at the edge",
					options: [{ label: "a long option label that wraps (Recommended)" }],
				},
			])
			const handle = openAsk(api, controller)
			await settle(setup)

			const painted = frame(setup)
			// Wrapped title, not truncated.
			expect(painted).toContain("cut off at the edge")
			expect(painted).not.toContain("…")
			// Badge on its own continuation line, indented under the label.
			const badgeLine = lineWith(setup, "[Recommended]")
			expect(badgeLine).toBeDefined()
			expect(badgeLine).not.toContain("long option label")
			expect(painted).toContain("wraps")
			handle.close()
		} finally {
			await setup.dispose()
		}
	})

	test("composer seat is hidden while the ask panel takes the dock", async () => {
		const { setup, api } = await mount({ width: 80, height: 24 })
		try {
			const controller = new TurnOverlayController()
			controller.answer([{ id: "q1", prompt: "pick one", options: [{ label: "a" }] }])
			const handle = openAsk(api, controller)
			await settle(setup)
			expect(frame(setup)).not.toContain("composer seat")
			handle.close()
			await settle(setup)
			expect(frame(setup)).toContain("composer seat")
		} finally {
			await setup.dispose()
		}
	})
})
