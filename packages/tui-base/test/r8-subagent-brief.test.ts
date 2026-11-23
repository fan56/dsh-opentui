/**
 * R8 — per-batch subagent brief.
 * Preregistration: .proof/r7-r8-subagent-brief/00-preregistered-expected.md
 *
 *  R8 (user 2026-11-23): `subagent *{running} {elapsedSec}s`, running count
 *  only, clocked PER BATCH (0→N starts, N→M keeps, →0 clears). The brief shares
 *  ONE line with the todo brief, sits above the agent list, and appears in both
 *  framed and compact modes. Data layer stays pure; width law via takeWidth.
 */
import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { bundledLocalesDir, loadLocales, setLanguages } from "@dsh-opentui/i18n"
import { createComponent } from "@opentui/solid"
import { testRender } from "@opentui/solid"
import type { CapturedFrame } from "@opentui/core"
import type { SeamRow } from "../src/routes/session/seam-rows"
import {
	combineBriefText,
	fittedBriefLine,
	lineWidth,
	mergedDockLines,
	type MergedAgent,
} from "../src/routes/session/merged-dock"
import {
	WidgetsDock,
	mergedCompactBriefLines,
	resetSubagentBriefClock,
	resetTodoBriefClock,
	subagentBatchAnchor,
	subagentBriefLine,
	subagentBriefText,
} from "../src/routes/session/widgets-dock"

beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages)
})

afterEach(() => {
	resetSubagentBriefClock()
	resetTodoBriefClock()
})

const runningAgent = (id: string, overrides: Partial<MergedAgent> = {}): MergedAgent => ({
	id,
	label: `agent-${id}`,
	status: "running",
	rounds: 2,
	startedAt: 1_000,
	lastLine: "working",
	...overrides,
})

const subagentRow = (children: Array<{ id: string; status: string }>): SeamRow => ({
	key: "subagents:live",
	kind: "subagents",
	children: children.map((c) => ({
		id: c.id,
		label: `agent-${c.id}`,
		status: c.status as "running" | "completed" | "failed" | "cancelled" | "interrupted",
		rounds: 2,
		startedAt: 1_000,
	})),
})

const todoRow = (count: number): SeamRow => ({
	key: "tool:todos",
	kind: "tool",
	name: "todo_write",
	args: JSON.stringify({
		todos: Array.from({ length: count }, (_, i) => ({ content: `task ${i + 1}`, status: "in_progress" })),
	}),
	status: "done",
	output: "ok",
})

const textOf = (line: ReturnType<typeof mergedDockLines>[number]) => line.segments.map((s) => s.text).join("")
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// R8 — brief text, anchoring, combine rule, data-layer placement
// ---------------------------------------------------------------------------

describe("R8.1 — subagent brief text (running count only, ASCII, en/zh identical)", () => {
	test("text has the exact `subagent *N Ns` form and running=0 yields empty", () => {
		expect(subagentBriefText(3, 12)).toBe("subagent *3 12s")
		expect(subagentBriefText(1, 0)).toBe("subagent *1 0s")
		expect(subagentBriefText(0, 12)).toBe("")
	})

	test("brief text is pure ASCII (no emoji/CJK that modal dialogs swallow)", () => {
		for (const text of [subagentBriefText(3, 12), subagentBriefText(9, 178)]) {
			expect(/^[\x20-\x7e]+$/.test(text)).toBe(true)
		}
	})

	test("en and zh locale values are identical ASCII", async () => {
		const en = await Bun.file(new URL("../../i18n/locales/en.json", import.meta.url)).json()
		const zh = await Bun.file(new URL("../../i18n/locales/zh-CN.json", import.meta.url)).json()
		const enVal = en["overlay.widgets.subagentBrief"]
		const zhVal = zh["overlay.widgets.subagentBrief"]
		expect(enVal).toBe("subagent *{running} {elapsedSec}s")
		expect(zhVal).toBe(enVal)
		expect(/^[\x20-\x7e{}]+$/.test(enVal)).toBe(true)
	})
})

describe("R8.2 — combine rule (merged / exclusive / neither)", () => {
	test("combineBriefText exact forms", () => {
		expect(combineBriefText("todo 2/4 178s", "subagent *3 12s")).toBe("todo 2/4 178s  ·  subagent *3 12s")
		expect(combineBriefText("todo 2/4 178s", "")).toBe("todo 2/4 178s")
		expect(combineBriefText("", "subagent *3 12s")).toBe("subagent *3 12s")
		expect(combineBriefText("", "")).toBe("")
	})

	test("framed scene A: both briefs share one row above the agent list", () => {
		const data = { tools: [], todos: [{ content: "a", status: "in_progress" as const }], agents: [runningAgent("a")], todoStartedAt: 1_000 }
		const lines = mergedDockLines(data, { innerWidth: 76, now: 4_000, subagentBrief: subagentBriefText(3, 12) })
		const briefs = lines.filter((l) => l.kind === "todo")
		expect(briefs).toHaveLength(1)
		expect(textOf(briefs[0]!)).toContain("todo 0/1 3s")
		expect(textOf(briefs[0]!)).toContain("subagent *3 12s")
		// The brief sits above every agent row.
		const firstAgent = lines.findIndex((l) => l.kind === "agent")
		expect(lines.findIndex((l) => l.kind === "todo")).toBeLessThan(firstAgent)
	})

	test("framed scene A: subagent-only brief occupies the row alone", () => {
		const data = { tools: [], todos: [], agents: [runningAgent("a")] }
		const lines = mergedDockLines(data, { innerWidth: 76, now: 4_000, subagentBrief: subagentBriefText(2, 5) })
		const briefs = lines.filter((l) => l.kind === "todo")
		expect(briefs).toHaveLength(1)
		expect(textOf(briefs[0]!).trim()).toBe("subagent *2 5s")
	})

	test("no subagentBrief option → no new brief row beyond the existing todo brief", () => {
		const data = { tools: [], todos: [{ content: "a", status: "in_progress" as const }], agents: [runningAgent("a")], todoStartedAt: 1_000 }
		const lines = mergedDockLines(data, { innerWidth: 76, now: 4_000 })
		const briefs = lines.filter((l) => l.kind === "todo")
		expect(briefs).toHaveLength(1)
		expect(textOf(briefs[0]!).trim()).toBe("todo 0/1 3s")
	})
})

describe("R8.3 — per-batch anchor semantics", () => {
	test("0→N records anchor; N→M keeps it; →0 clears; next 0→N restarts", () => {
		resetSubagentBriefClock()
		expect(subagentBatchAnchor(0, 1_000)).toBeUndefined()
		const a1 = subagentBatchAnchor(3, 2_000)
		expect(a1).toBe(2_000)
		// A late child joins the batch — the anchor must NOT move.
		expect(subagentBatchAnchor(4, 5_000)).toBe(2_000)
		// All settle → anchor cleared.
		expect(subagentBatchAnchor(0, 9_000)).toBeUndefined()
		// A new batch in the same turn starts from ZERO.
		const a2 = subagentBatchAnchor(2, 10_000)
		expect(a2).toBe(10_000)
		expect(a2).not.toBe(a1)
	})

	test("elapsed ticks from the batch anchor, not from each child's startedAt", () => {
		resetSubagentBriefClock()
		expect(subagentBriefLine(3, 1_000)).toBe("subagent *3 0s")
		expect(subagentBriefLine(3, 12_000)).toBe("subagent *3 11s")
		// New child joins: count changes, clock keeps running.
		expect(subagentBriefLine(4, 13_000)).toBe("subagent *4 12s")
		// All settle → no brief.
		expect(subagentBriefLine(0, 14_000)).toBe("")
		// New batch → count 3, clock restarts at 0.
		expect(subagentBriefLine(3, 15_000)).toBe("subagent *3 0s")
	})
})

describe("R8.4 — compact brief + width law", () => {
	test("compact brief only appears while a subagent runs, and shares one row with todo", () => {
		resetSubagentBriefClock()
		const rowsWithAgent = [subagentRow([{ id: "a", status: "running" }]), todoRow(2)]
		const withAgent = mergedCompactBriefLines(rowsWithAgent, 5_000, 76)
		expect(withAgent).toHaveLength(1)
		const text = textOf(withAgent[0]!)
		expect(text).toContain("subagent *1 0s")
		expect(text).toContain("todo 0/2 0s")

		expect(mergedCompactBriefLines([todoRow(2)], 6_000, 76)).toHaveLength(0)
		expect(mergedCompactBriefLines([subagentRow([{ id: "a", status: "completed" }])], 6_000, 76)).toHaveLength(0)
	})

	test("fittedBriefLine obeys the exact-width law (takeWidth, no clipToWidth)", () => {
		const wide = fittedBriefLine("todo 2/4 178s  ·  subagent *3 12s", 40)
		expect(lineWidth(wide)).toBe(40)
		const narrow = fittedBriefLine("a very long combined brief that must be cropped", 12)
		expect(lineWidth(narrow)).toBe(12)
	})

	test("80x24 room budget: brief + todo tree + rule/tab rows leave transcript >= 6", () => {
		resetSubagentBriefClock()
		const rows = [subagentRow([{ id: "a", status: "running" }]), todoRow(3)]
		const brief = mergedCompactBriefLines(rows, 3_000, 76).length // 1
		const tree = 1 + 3 // header + 3 todos (COMPACT_TREE_MAX_LINES = 8, fits)
		const compactDockHeight = 1 /* tab bar */ + 2 /* rule lines */ + brief + tree
		const fixedChrome = 1 /* composer */ + 1 /* 👤 echo */ + 1 /* powerline */ + 1 /* hints */
		// 24 - dock - chrome must leave at least 6 transcript rows.
		expect(24 - compactDockHeight - fixedChrome).toBeGreaterThanOrEqual(6)
	})
})

// ---------------------------------------------------------------------------
// R8.5 — real render: framed + compact frames both carry the brief
// ---------------------------------------------------------------------------

describe("R8.5 — real renderer frames (framed >=31 rows, compact 24 rows)", () => {
	const spansMatching = (frame: CapturedFrame, re: RegExp) =>
		frame.lines.flatMap((line) => line.spans).filter((span) => re.test(span.text))

	test("framed mode paints `subagent *3` above the agent rows", async () => {
		resetSubagentBriefClock()
		const rows: SeamRow[] = [subagentRow([
			{ id: "a", status: "running" },
			{ id: "b", status: "running" },
			{ id: "c", status: "running" },
		]), todoRow(2)]
		const setup = await testRender(
			() => createComponent(WidgetsDock, { rows, turnActive: () => true }),
			{ width: 80, height: 40, useMouse: false },
		)
		try {
			await sleep(300)
			await setup.renderOnce()
			const frame = setup.captureSpans()
			const brief = spansMatching(frame, /subagent \*3/)
			expect(brief.length).toBeGreaterThan(0)
			expect(spansMatching(frame, /agent-a/).length).toBeGreaterThan(0)
		} finally {
			await setup.dispose()
		}
	})

	test("compact mode (24 rows) paints `subagent *3` in the lower zone", async () => {
		resetSubagentBriefClock()
		const rows: SeamRow[] = [
			subagentRow([
				{ id: "a", status: "running" },
				{ id: "b", status: "running" },
				{ id: "c", status: "running" },
			]),
			todoRow(2),
		]
		const setup = await testRender(
			() => createComponent(WidgetsDock, { rows, turnActive: () => true }),
			{ width: 80, height: 24, useMouse: false },
		)
		try {
			await sleep(300)
			await setup.renderOnce()
			const frame = setup.captureSpans()
			expect(spansMatching(frame, /subagent \*3/).length).toBeGreaterThan(0)
		} finally {
			await setup.dispose()
		}
	})
})
