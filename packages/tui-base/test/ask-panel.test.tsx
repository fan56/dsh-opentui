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
import type { CapturedFrame, CapturedSpan } from "@opentui/core"
import { bundledLocalesDir, loadLocales, setLanguage, setLanguages } from "@dsh-opentui/i18n"
import { ConfigProvider, resolve } from "../src/config"
import { ThemeProvider, createThemeSource } from "../src/context/theme"
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

async function mount(options: { width: number; height: number; themed?: boolean }): Promise<{ setup: Setup; api: DockApi }> {
	let api: DockApi | undefined
	const tree = () => (
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
	)
	const setup = await testRender(
		() =>
			options.themed === true ? (
				<ConfigProvider config={resolve({}, { terminalSuspend: true })}>
					<ThemeProvider mode="dark" source={createThemeSource("")}>
						{tree()}
					</ThemeProvider>
				</ConfigProvider>
			) : (
				tree()
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

/** The painted span that carries `needle` (colours included). */
function spanWith(setup: Setup, needle: string): CapturedSpan | undefined {
	for (const line of setup.captureSpans().lines) {
		for (const span of line.spans) {
			if (span.text.includes(needle)) return span
		}
	}
	return undefined
}

/** RGBA equality with a tolerance (captured channels are floats). */
function sameColor(
	a: CapturedSpan["bg"] | undefined,
	b: CapturedSpan["bg"] | undefined,
): boolean {
	if (a === undefined || b === undefined) return false
	return (
		Math.abs(a.r - b.r) < 0.01 &&
		Math.abs(a.g - b.g) < 0.01 &&
		Math.abs(a.b - b.b) < 0.01 &&
		Math.abs(a.a - b.a) < 0.01
	)
}

describe("ask panel body (spec §2-§5, §8)", () => {
	/** D1: the surface opens with one full-width single rule, the divider
	 * grammar `/settings` uses (panel-kit `resolvePanelChrome().divider`).
	 * Without it the panel merged into the widgets dock's `┗━━┛` box. */
	test("D1: a full-width top rule opens the panel", async () => {
		const { setup, api } = await mount({ width: 80, height: 24 })
		try {
			const controller = new TurnOverlayController()
			controller.answer([{ id: "q1", prompt: "pick one", options: [{ label: "a" }] }])
			const handle = openAsk(api, controller)
			await settle(setup)

			const lines = frame(setup).split("\n")
			const rule = lines[0] ?? ""
			expect(rule).toBe("─".repeat(80))
			// Content inset: the transcript's feed starts at column 3, so the
			// panel keeps a two-column gutter under the full-width rule.
			expect(lines[1]?.startsWith("  pick one")).toBe(true)
			handle.close()
		} finally {
			await setup.dispose()
		}
	})

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
			expect(painted).toContain("› ● 1. postgres")
			expect(painted).toContain("[Recommended]")
			expect(painted).not.toContain("(Recommended)")
			// D2: the badge is a label attribute with a fixed 2-cell gap — not
			// a right-aligned column at the terminal edge.
			expect(painted).toContain("postgres  [Recommended]")
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
			// The list keeps a muted marker on its last position while the
			// inline input owns the focus (never a marker-less list).
			expect(frame(setup)).toContain("› ○ 1. a")

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

	test("multi-select rows use the hollow/filled box vocabulary; footer says space toggle", async () => {
		const { setup, api } = await mount({ width: 80, height: 24 })
		try {
			const controller = new TurnOverlayController()
			controller.answer([
				{ id: "q1", prompt: "checks?", options: [{ label: "lint" }, { label: "smoke" }], multiSelect: true },
			])
			const handle = openAsk(api, controller)
			await settle(setup)
			// Unchecked = hollow box, checked = filled box. `✔`/`✘` are the
			// confirm/fail family and must not mean "unchecked" here.
			expect(frame(setup)).toContain("□ 1. lint")
			expect(frame(setup)).toContain("□ 2. smoke")
			expect(frame(setup)).not.toContain("✘")
			expect(frame(setup)).toContain("space toggle")

			controller.toggle("lint")
			await settle(setup)
			const painted = frame(setup)
			expect(painted).toContain("■ 1. lint")
			expect(painted).toContain("□ 2. smoke")
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

	test("P2-4: a zero-option question past the first advertises the previous-question stage", async () => {
		const { setup, api } = await mount({ width: 80, height: 20 })
		try {
			const controller = new TurnOverlayController()
			controller.answer([
				{ id: "q1", prompt: "first question", options: [{ label: "a" }] },
				{ id: "q2", prompt: "anything else?", options: [] },
			])
			const handle = openAsk(api, controller)
			await settle(setup)
			controller.switchFocus(1)
			await settle(setup)
			expect(controller.pendingAsk?.index).toBe(1)
			expect(controller.pendingAsk?.phase).toBe("input")
			const painted = frame(setup)
			// Esc from here walks to question 1 (ask-keys `backOut`), it does
			// NOT decline the batch.
			expect(painted).toContain("esc: previous question")
			expect(painted).not.toContain("esc: decline")
			handle.close()
		} finally {
			await setup.dispose()
		}
	})

	test("P2-7: a header-only payload (header === prompt) paints the string once", async () => {
		const { setup, api } = await mount({ width: 80, height: 24 })
		try {
			const controller = new TurnOverlayController()
			controller.answer([{ id: "q1", prompt: "Same heading", header: "Same heading", options: [{ label: "a" }] }])
			const handle = openAsk(api, controller)
			await settle(setup)
			// The eyebrow is suppressed; the title still paints.
			expect(frame(setup).split("Same heading").length - 1).toBe(1)
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
			expect(painted).toContain("cut off at the")
			expect(painted).toContain("edge")
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

	/** Focus grammar: the row under the cursor must read as strongly as the
	 * inline input. Both paint the SAME theme pair — the panel-kit row theme
	 * projection (`background.action.primary.focused` +
	 * `text.action.primary.focused`, panel-kit-host.tsx:96-98), which is also
	 * what `/settings`' List highlight uses. */
	test("focus grammar: the cursor row carries the same band as the inline input", async () => {
		const { setup, api } = await mount({ width: 80, height: 24, themed: true })
		try {
			const controller = new TurnOverlayController()
			controller.answer([{ id: "q1", prompt: "pick one", options: [{ label: "alpha" }, { label: "bravo" }] }])
			const handle = openAsk(api, controller)
			await settle(setup)

			// Options phase: row 1 owns the cursor and must be banded; row 2 not.
			const cursorBand = spanWith(setup, "alpha")?.bg
			const plainBand = spanWith(setup, "bravo")?.bg
			expect(cursorBand).toBeDefined()
			expect(plainBand).toBeDefined()
			expect(sameColor(cursorBand, plainBand)).toBe(false)

			// The focused text token is used on that band (dark-on-band), not the
			// raised/muted role: the cursor label differs from the idle label.
			const idleLabelFg = spanWith(setup, "bravo")?.fg
			expect(sameColor(spanWith(setup, "alpha")?.fg, idleLabelFg)).toBe(false)

			// The inline input's focused row is the reference: same band.
			controller.focusInput()
			await settle(setup)
			const inputBand = spanWith(setup, "Type something.")?.bg
			expect(inputBand).toBeDefined()
			expect(sameColor(cursorBand, inputBand)).toBe(true)
			handle.close()
		} finally {
			await setup.dispose()
		}
	})

	/** Cursor ≠ selected: selection is a GLYPH (●/○ single, ■/□ multi), so a
	 * selected row that does NOT hold the cursor is still legible, and the
	 * label tone of a selected idle row equals a plain idle row (no
	 * colour-only selection). */
	test("selection is a glyph: selected-but-not-cursor is distinguishable without colour", async () => {
		const { setup, api } = await mount({ width: 80, height: 24, themed: true })
		try {
			const controller = new TurnOverlayController()
			controller.answer([
				{
					id: "q1",
					prompt: "pick one",
					options: [{ label: "alpha (Recommended)" }, { label: "bravo" }, { label: "charlie" }],
				},
			])
			const handle = openAsk(api, controller)
			await settle(setup)

			// Cursor and selection coincide on row 1 → both markers on the band.
			expect(frame(setup)).toContain("› ● 1. alpha")

			// Move the cursor away: row 1 stays selected through the filled dot.
			controller.setCursor(2)
			await settle(setup)
			const painted = frame(setup)
			expect(painted).toContain("● 1. alpha")
			expect(painted).toContain("○ 2. bravo")
			expect(painted).toContain("› ○ 3. charlie")

			// The idle selected label and the idle plain label share one tone:
			// the dot, not the colour, is what says "selected".
			expect(sameColor(spanWith(setup, "alpha")?.fg, spanWith(setup, "bravo")?.fg)).toBe(true)
			handle.close()
		} finally {
			await setup.dispose()
		}
	})

	test("a row that is both cursor and selected keeps the selection glyph on the band", async () => {
		const { setup, api } = await mount({ width: 80, height: 24 })
		try {
			const controller = new TurnOverlayController()
			controller.answer([{ id: "q1", prompt: "pick one", options: [{ label: "alpha (Recommended)" }, { label: "bravo" }] }])
			const handle = openAsk(api, controller)
			await settle(setup)
			expect(frame(setup)).toContain("› ● 1. alpha")
			// Back from row 2: the cursor row is still the selected one.
			controller.setCursor(1)
			await settle(setup)
			controller.setCursor(0)
			await settle(setup)
			expect(frame(setup)).toContain("› ● 1. alpha")
			handle.close()
		} finally {
			await setup.dispose()
		}
	})

	/** Inset: the panel's content starts at column 3 like the transcript feed,
	 * continuation lines line up with the label column, and the bottom rule
	 * mirrors the full-width top rule so the panel closes against the surface
	 * below it (both share `background.base`). */
	test("content inset and bottom closure match the transcript grammar", async () => {
		const { setup, api } = await mount({ width: 80, height: 24 })
		try {
			const controller = new TurnOverlayController()
			controller.answer([
				{
					id: "q1",
					prompt: "pick one",
					options: [{ label: "alpha", description: "desc text" }, { label: "bravo" }],
				},
			])
			const handle = openAsk(api, controller)
			await settle(setup)

			const lines = frame(setup).split("\n")
			// Full-width top rule, two-column content inset.
			expect(lines[0]).toBe("─".repeat(80))
			expect(lines[1]?.startsWith("  pick one")).toBe(true)
			// Gutter(2) + cursor(2) + state(2) + number(3) -> label at column 10.
			const optionLine = lineWith(setup, "1. alpha")
			expect(optionLine).toBeDefined()
			expect(optionLine!.startsWith("  › ○ 1. alpha")).toBe(true)
			// Continuation lines indent at the label column (9 cells).
			const descriptionLine = lineWith(setup, "desc text")
			expect(descriptionLine).toBeDefined()
			expect(descriptionLine!.startsWith(" ".repeat(9) + "desc text")).toBe(true)
			// The bottom rule closes the panel right under the footer hint.
			const footerIndex = lines.findIndex((line) => line.includes("esc: decline"))
			expect(footerIndex).toBeGreaterThan(0)
			expect(lines[footerIndex + 1]).toBe("─".repeat(80))
			handle.close()
		} finally {
			await setup.dispose()
		}
	})

	/** 50 columns: number, marker, state glyph, label, badge and description
	 * must all still read; the badge drops to its continuation line and the
	 * question text wraps without truncation. */
	test("50 columns: marker, dot, label, badge and description stay readable", async () => {
		const { setup, api } = await mount({ width: 50, height: 30 })
		try {
			const controller = new TurnOverlayController()
			controller.answer([
				{
					id: "q1",
					prompt: "a long question that must wrap instead of being cut off at the edge",
					options: [
						{
							label: "a long option label that wraps (Recommended)",
							description: "a description that also wraps inside the narrow dock",
						},
						{ label: "second option" },
					],
				},
			])
			const handle = openAsk(api, controller)
			await settle(setup)

			const painted = frame(setup)
			expect(painted).not.toContain("…")
			expect(painted).toContain("cut off at the")
			expect(painted).toContain("edge")
			// Number column aligned across rows: both labels start at column 10.
			expect(lineWith(setup, "1. a long option")?.startsWith("  › ● 1. a long option")).toBe(true)
			expect(lineWith(setup, "2. second option")?.startsWith("    ○ 2. second option")).toBe(true)
			// Badge drops to its own line at the label column.
			const badgeLine = lineWith(setup, "[Recommended]")
			expect(badgeLine).toBeDefined()
			expect(badgeLine!.startsWith(" ".repeat(9) + "[Recommended]")).toBe(true)
			// Description wraps on its own continuation line.
			expect(lineWith(setup, "a description that also")).toBeDefined()
			handle.close()
		} finally {
			await setup.dispose()
		}
	})

	/** D2: the badge stays adjacent to a short label; when the label plus the
	 * 2-cell gap and the badge genuinely do not fit (still above the compact
	 * threshold), the badge moves to its own continuation line. */
	test("D2: badge drops to its own line only when label + badge do not fit", async () => {
		const { setup, api } = await mount({ width: 80, height: 24 })
		try {
			const controller = new TurnOverlayController()
			controller.answer([
				{
					id: "q1",
					prompt: "pick",
					options: [{ label: "a long option label that cannot share its row with the badge at this width (Recommended)" }],
				},
			])
			const handle = openAsk(api, controller)
			await settle(setup)
			const badgeLine = lineWith(setup, "[Recommended]")
			expect(badgeLine).toBeDefined()
			expect(badgeLine).not.toContain("a long option label")
			handle.close()
		} finally {
			await setup.dispose()
		}
	})

	/** D4: the resident inline buffer is per question. A draft typed on Q1 and
	 * left uncommitted (Esc stage 1) must never paint on Q2. */
	test("D4: an uncommitted draft never leaks across questions", async () => {
		const { setup, api } = await mount({ width: 80, height: 24 })
		try {
			const controller = new TurnOverlayController()
			controller.answer([
				{ id: "q1", prompt: "first question", options: [{ label: "a" }] },
				{ id: "q2", prompt: "second question", options: [{ label: "x" }] },
			])
			const handle = openAsk(api, controller)
			await settle(setup)

			controller.setInlineText("draft-one")
			await settle(setup)
			expect(frame(setup)).toContain("draft-one")

			// Esc stage 1 (list owns keys again), then → to question 2.
			controller.focusOptions()
			controller.switchFocus(1)
			await settle(setup)
			expect(controller.pendingAsk?.index).toBe(1)
			expect(controller.inlineText).toBe("")
			expect(frame(setup)).not.toContain("draft-one")
			expect(frame(setup)).toContain("second question")

			// Back on Q1 the draft is still its own.
			controller.switchFocus(-1)
			await settle(setup)
			expect(frame(setup)).toContain("draft-one")
			handle.close()
		} finally {
			await setup.dispose()
		}
	})

	/** D5: the review page paints the SAME normalized label the option row
	 * showed — no raw `(Recommended)` suffix. */
	test("D5: review answers carry no raw (Recommended) suffix", async () => {
		const { setup, api } = await mount({ width: 80, height: 24 })
		try {
			const controller = new TurnOverlayController()
			controller.answer([
				{ id: "q1", prompt: "which engine?", options: [{ label: "SQLite (Recommended)" }] },
				{ id: "q2", prompt: "which extras?", options: [{ label: "Cache" }] },
			])
			const handle = openAsk(api, controller)
			await settle(setup)
			expect(controller.enterReview()).toBe(true)
			await settle(setup)
			const painted = frame(setup)
			expect(painted).toContain("→ SQLite")
			expect(painted).not.toContain("(Recommended)")
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
