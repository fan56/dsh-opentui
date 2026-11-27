/**
 * Merged activity dock — Path 1 pure-function contract tests.
 * Spec: docs/activity-merged-widget.md (D4–D8, D13).
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { bundledLocalesDir, loadLocales, setLanguages } from "@dsh-opentui/i18n"
import type { Todo } from "../src/util/todo"
import { stringWidth } from "../src/util/string-width"
import { thinkBlockLines, toolMarker } from "../src/routes/session/widgets-dock"
import {
	MERGED_DOCK_TOTAL_LINES,
	TODO_STATUS_GLYPHS,
	activeTodos,
	attributeAgents,
	lineWidth,
	mergedDockLines,
	mergedPositionSuffix,
	mergedTitle,
	mergedWindowInfo,
	type MergedAgent,
	type MergedThinkRow,
	type MergedToolRow,
} from "../src/routes/session/merged-dock"

const todo = (content: string, status: Todo["status"]): Todo => ({ content, status })

const agent = (id: string, overrides: Partial<MergedAgent> = {}): MergedAgent => ({
	id,
	label: `agent-${id}`,
	status: "running",
	rounds: 3,
	startedAt: 1_000,
	lastLine: "working on the task",
	...overrides,
})

/** A scrollable subagent list (scene A's lower zone) with labels that mirror
 * the old todo-based window fixtures (`task 1`, `task 2`, …). */
const manyAgents = (n: number): MergedAgent[] =>
	Array.from({ length: n }, (_, i) => agent(`a${i}`, { label: `task ${i + 1}` }))

const tool = (name: string, overrides: Partial<MergedToolRow> = {}): MergedToolRow => ({
	key: `tool:${name}`,
	kind: "tool",
	name,
	args: "{}",
	status: "running",
	startedAt: 1_000,
	...overrides,
})

const think = (overrides: Partial<MergedThinkRow> = {}): MergedThinkRow => ({
	key: "reasoning:live:1",
	kind: "reasoning",
	text: "planning the merge",
	final: false,
	streaming: true,
	startedAt: 1_000,
	...overrides,
})

const textOf = (line: ReturnType<typeof mergedDockLines>[number]) => line.segments.map((segment) => segment.text).join("")

beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages)
})

describe("activeTodos — active-only, original plan index (D6/D7)", () => {
	test("keeps only in_progress, with original 1-based indices (not renumbered)", () => {
		const todos = [
			todo("pending", "pending"),
			todo("A", "in_progress"),
			todo("done", "completed"),
			todo("B", "in_progress"),
			todo("cancelled", "cancelled"),
		]
		const active = activeTodos(todos)
		expect(active.map((t) => t.content)).toEqual(["A", "B"])
		expect(active.map((t) => t.index)).toEqual([2, 4])
	})

	test("empty when no in_progress", () => {
		expect(activeTodos([todo("x", "pending"), todo("y", "completed")])).toEqual([])
	})
})

describe("attributeAgents — last-in_progress rule (D7)", () => {
	const agents = [agent("a"), agent("b")]

	test("no in_progress → parent null, agents flat", () => {
		const result = attributeAgents([todo("x", "pending"), todo("y", "completed")], agents)
		expect(result.parent).toBeNull()
		expect(result.agents).toHaveLength(2)
	})

	test("one in_progress → all agents under it, with correct original index", () => {
		const todos = [todo("x", "pending"), todo("only", "in_progress"), todo("z", "completed")]
		const result = attributeAgents(todos, agents)
		expect(result.parent?.todo.content).toBe("only")
		expect(result.parent?.index).toBe(2)
	})

	test("multiple in_progress → all agents under the LAST one", () => {
		const todos = [todo("first", "in_progress"), todo("middle", "pending"), todo("last", "in_progress")]
		const result = attributeAgents(todos, agents)
		expect(result.parent?.todo.content).toBe("last")
		expect(result.parent?.index).toBe(3)
	})

	test("only running agents are kept", () => {
		const result = attributeAgents([todo("x", "in_progress")], [agent("a"), agent("b", { status: "completed" })])
		expect(result.agents.map((a) => a.id)).toEqual(["a"])
	})

	test("parent completes → re-attach to new last in_progress, or flat if none", () => {
		const before = [todo("A", "in_progress"), todo("B", "in_progress")]
		expect(attributeAgents(before, agents).parent?.index).toBe(2)

		// B completes: agents now attach to A.
		const after = [todo("A", "in_progress"), todo("B", "completed")]
		expect(attributeAgents(after, agents).parent?.index).toBe(1)

		// A completes too: no in_progress → flat.
		const flat = [todo("A", "completed"), todo("B", "completed")]
		expect(attributeAgents(flat, agents).parent).toBeNull()
	})
})

describe("mergedTitle — D4 table (never 'todo')", () => {
	test("full selection table", () => {
		const cases: Array<[{ tool: boolean; subagent: boolean; think: boolean }, string]> = [
			[{ tool: true, subagent: true, think: false }, "🔧 tool · 🤖 subagent"],
			[{ tool: true, subagent: false, think: false }, "🔧 tool"],
			[{ tool: false, subagent: true, think: false }, "🤖 subagent"],
			[{ tool: false, subagent: true, think: true }, "🤖 subagent"],
			[{ tool: false, subagent: false, think: true }, "💭 think"],
			[{ tool: true, subagent: false, think: true }, "🔧 tool"],
			[{ tool: false, subagent: false, think: false }, "🧩 activity"],
		]
		for (const [parts, expected] of cases) {
			expect(mergedTitle(parts)).toBe(expected)
		}
	})

	test("tool glyph is U+1F527 without VS16 and no branch contains 'todo'", () => {
		for (const tool of [false, true]) {
			for (const subagent of [false, true]) {
				for (const think of [false, true]) {
					const title = mergedTitle({ tool, subagent, think })
					expect(title.toLowerCase()).not.toContain("todo")
					if (tool) {
						expect(title).toContain("\u{1F527}")
						expect(title).not.toContain("\uFE0F")
					}
				}
			}
		}
	})
})

describe("mergedDockLines — tool zone two states (D5/D8)", () => {
	const now = 4_000 // 3.0s elapsed for entries started at 1000

	test("scene A (running subagent) pins exactly 1 trimmed tool line (latest only)", () => {
		const lines = mergedDockLines(
			{
				tools: [
					tool("old", { args: '{"command":"echo FIRST"}' }),
					tool("latest", { args: '{"command":"echo SECRET"}', output: "DETAIL_BLOB" }),
				],
				todos: [todo("active item", "in_progress")],
				agents: [agent("a")], // running subagent → scene A
			},
			{ innerWidth: 60, now },
		)
		const toolLines = lines.filter((line) => line.kind === "tool")
		expect(toolLines).toHaveLength(1)
		const text = textOf(toolLines[0]!)
		expect(text).toContain("⚙ latest")
		expect(text).toContain("3.0s")
		expect(text).not.toContain("SECRET")
		expect(text).not.toContain("echo")
		expect(text).not.toContain("DETAIL_BLOB")
		expect(text).not.toContain("old")
	})

	test("scene A tool marker follows toolMarker (done → ✔)", () => {
		const lines = mergedDockLines(
			{
				tools: [tool("bash", { status: "done", elapsedSec: 2.5 })],
				todos: [todo("active", "in_progress")],
				agents: [agent("a")],
			},
			{ innerWidth: 40, now },
		)
		expect(textOf(lines.find((line) => line.kind === "tool")!)).toContain("✔ bash · 2.5s")
	})

	test("tool-only: up to 3 lines with FULL subject/detail format", () => {
		const tools = Array.from({ length: 5 }, (_, i) =>
			tool(`bash${i}`, { args: '{"command":"echo hello"}' }),
		)
		const lines = mergedDockLines({ tools, todos: [], agents: [] }, { innerWidth: 80, now })
		expect(lines.every((line) => line.kind === "tool")).toBe(true)
		expect(lines).toHaveLength(3)
		const text = textOf(lines[0]!)
		// toolSubject head word + toolDetail "$ echo hello" survive in tool-only mode.
		expect(text).toContain("echo")
		expect(text).toContain("$ echo hello")
	})

	test("tool-only with no tools → no lines", () => {
		expect(mergedDockLines({ tools: [], todos: [], agents: [] }, { innerWidth: 40 })).toEqual([])
	})
})

describe("mergedDockLines — active-only bodies, agents, 10-line cap (D6/D7/D8)", () => {
	test("scene A: todo is ONE compact brief above the subagent list; per-todo rows are gone", () => {
		const lines = mergedDockLines(
			{
				tools: [],
				todos: [todo("pending", "pending"), todo("A", "in_progress"), todo("B", "in_progress"), todo("done", "completed")],
				agents: [agent("a"), agent("b")],
				todoStartedAt: 1_000,
			},
			{ innerWidth: 60, now: 4_000 },
		)
		const body = lines.map(textOf).join("\n")
		// 指令4: `todo done/total Ns`, no current-task text, 3 seconds elapsed.
		expect(body).toContain("todo 1/4 3s")
		expect(body).not.toContain("● 2 A")
		expect(body).not.toContain("● 3 B")
		expect(body).not.toContain("pending")
		expect(body).not.toContain("done")
		expect(lines.filter((line) => line.kind === "todo")).toHaveLength(1)
		const agentLines = lines.filter((line) => line.kind === "agent")
		expect(agentLines).toHaveLength(2)
		expect(textOf(agentLines[0]!)).toContain("├─ ")
		expect(textOf(agentLines[1]!)).toContain("└─ ")
		expect(textOf(agentLines[0]!)).toContain("round 3")
	})

	test("scene A with a running agent keeps the brief + flat agent row (no parent todo row)", () => {
		const lines = mergedDockLines(
			{ tools: [], todos: [todo("done", "completed")], agents: [agent("a")], todoStartedAt: 1_000 },
			{ innerWidth: 60, now: 4_000 },
		)
		expect(lines.filter((line) => line.kind === "todo")).toHaveLength(1)
		expect(textOf(lines.find((line) => line.kind === "todo")!)).toContain("todo 1/1 3s")
		expect(lines.filter((line) => line.kind === "agent")).toHaveLength(1)
	})

	test("scene C: no agent, no think → todo tree (header + ├─/└─ rows)", () => {
		const lines = mergedDockLines(
			{ tools: [], todos: [todo("x", "pending")], agents: [] },
			{ innerWidth: 60 },
		)
		expect(lines).toHaveLength(2)
		expect(lines.every((line) => line.kind === "todo")).toBe(true)
		expect(textOf(lines[0]!)).toContain("● Todos (0/1)")
		expect(textOf(lines[1]!)).toContain("└─ ○ x")
	})

	test("scene A: 10-line cap and ▼/▲ counts are self-consistent on the subagent list", () => {
		const agents = Array.from({ length: 12 }, (_, i) => agent(`a${i}`))
		const todos = [todo("active", "in_progress")]
		const base = { tools: [tool("bash")], todos, agents, todoStartedAt: 1_000 }

		// Top of the window: one bottom indicator, no top indicator. The pinned
		// tool + todo brief occupy the first two rows, above the list.
		const top = mergedDockLines(base, { innerWidth: 60, now: 4_000, cursor: 0 })
		expect(top).toHaveLength(MERGED_DOCK_TOTAL_LINES)
		expect(top[0]!.kind).toBe("tool")
		expect(top[1]!.kind).toBe("todo")
		expect(top[top.length - 1]!.kind).toBe("more-bottom")
		expect(top.some((line) => line.kind === "more-top")).toBe(false)

		// Bottom of the window: one top indicator, right after the pinned rows.
		const bottom = mergedDockLines(base, { innerWidth: 60, now: 4_000, cursor: 11 })
		expect(bottom).toHaveLength(MERGED_DOCK_TOTAL_LINES)
		expect(bottom[0]!.kind).toBe("tool")
		expect(bottom[2]!.kind).toBe("more-top")
		expect(bottom.some((line) => line.kind === "more-bottom")).toBe(false)

		// Middle: both indicators; counts + visible agents must equal the total.
		const middle = mergedDockLines(base, { innerWidth: 60, now: 4_000, cursor: 2 })
		expect(middle).toHaveLength(MERGED_DOCK_TOTAL_LINES)
		const topLine = middle.find((line) => line.kind === "more-top")!
		const bottomLine = middle.find((line) => line.kind === "more-bottom")!
		const topCount = Number(/▲ (\d+) more/.exec(textOf(topLine))![1])
		const bottomCount = Number(/▼ (\d+) more/.exec(textOf(bottomLine))![1])
		const visibleAgents = middle.filter((line) => line.kind === "agent").length
		expect(topCount + visibleAgents + bottomCount).toBe(12)
		expect(middle.filter((line) => line.kind === "todo")).toHaveLength(1)
	})

	test("retained glyph definitions (cancelled ⊘ is distinct from pending ○)", () => {
		expect(TODO_STATUS_GLYPHS.in_progress).toBe("●")
		expect(TODO_STATUS_GLYPHS.pending).toBe("○")
		expect(TODO_STATUS_GLYPHS.completed).toBe("✓")
		expect(TODO_STATUS_GLYPHS.cancelled).toBe("⊘")
		expect(TODO_STATUS_GLYPHS.cancelled).not.toBe(TODO_STATUS_GLYPHS.pending)
	})
})

describe("mergedDockLines — agent name (F5)", () => {
	const agentLinesFor = (a: MergedAgent) =>
		mergedDockLines({ tools: [], todos: [], agents: [a] }, { innerWidth: 80, now: 4_000 })
			.filter((line) => line.kind === "agent")

	test("a distinct child name renders as a muted prefix before the label", () => {
		const line = agentLinesFor(agent("a", { name: "child-7", label: "workhorse" }))[0]!
		expect(textOf(line)).toContain("child-7: workhorse")
		const nameSegment = line.segments.find((segment) => segment.text === "child-7: ")
		expect(nameSegment?.tone).toBe("muted")
		expect(nameSegment?.accent).toBeUndefined()
	})

	test("name===label or absent falls back to label alone (no prefix segment)", () => {
		for (const a of [agent("a", { name: "workhorse", label: "workhorse" }), agent("a", { label: "workhorse" })]) {
			const line = agentLinesFor(a)[0]!
			expect(textOf(line)).toContain("workhorse")
			expect(textOf(line)).not.toContain(":")
			expect(line.segments.some((segment) => segment.text.includes(": "))).toBe(false)
		}
	})
})

describe("mergedDockLines — agent last-line preview budget", () => {
	const now = 4_000
	const head = "└─ agent-a · 3.0s · round 3"
	const renderAgent = (lastLine: string | undefined, innerWidth: number, overrides: Partial<MergedAgent> = {}) =>
		mergedDockLines(
			{ tools: [], todos: [], agents: [agent("a", { lastLine, ...overrides })] },
			{ innerWidth, now },
		).find((line) => line.kind === "agent")!

	test("uses the remaining terminal width for a long ASCII preview", () => {
		const innerWidth = 103
		const lastLine = `${"0123456789".repeat(12)}-VISIBLE-LONG-PREVIEW-END`
		const text = textOf(renderAgent(lastLine, innerWidth)).trimEnd()
		expect(stringWidth(text)).toBeGreaterThanOrEqual(innerWidth - 1)
		expect(text.endsWith("-VISIBLE-LONG-PREVIEW-END")).toBe(true)
	})

	test("keeps a grapheme-safe CJK/emoji suffix at the cutoff", () => {
		const innerWidth = 61
		const lastLine = `${"前".repeat(20)}👩🏽‍💻e\u0301`
		const text = textOf(renderAgent(lastLine, innerWidth)).trimEnd()
		const prefix = `${head} · `
		expect(text.startsWith(prefix)).toBe(true)
		const tail = text.slice(prefix.length)
		const budget = innerWidth - stringWidth(head) - stringWidth(" · ")
		const suffix = "👩🏽‍💻e\u0301"
		const n = Math.floor((budget - stringWidth(suffix)) / stringWidth("前"))
		expect(tail).toBe(`${"前".repeat(n)}${suffix}`)
		expect(stringWidth(tail)).toBe(budget)
		expect(stringWidth(`前${tail}`)).toBeGreaterThan(budget)
		expect(lastLine.endsWith(tail)).toBe(true)
		expect(stringWidth(text)).toBe(innerWidth)
	})

	test("does not throw and still fits when a long CJK label makes the tail budget negative", () => {
		const innerWidth = 40
		const render = () => renderAgent("visible tail", innerWidth, { label: "界".repeat(80) })
		expect(render).not.toThrow()
		expect(stringWidth(textOf(render()))).toBe(innerWidth)
	})

	test("omits the dangling separator for missing or whitespace-only tails", () => {
		for (const lastLine of [undefined, "", " \t\r\n \r\n"]) {
			const text = textOf(renderAgent(lastLine, 80)).trimEnd()
			expect(text).toBe(head)
			expect(text.endsWith(" · ")).toBe(false)
		}
	})

	test("keeps a short tail without a dangling separator", () => {
		const text = textOf(renderAgent("done", 80)).trimEnd()
		expect(text).toBe(`${head} · done`)
		expect(text.endsWith(" · ")).toBe(false)
	})

	test("shows only the last non-empty streamed line with whitespace folded", () => {
		const lastLine = "stale first line\r\n  final   token\t sequence  \r\n \t\r\n"
		const text = textOf(renderAgent(lastLine, 80)).trimEnd()
		expect(text).toBe(`${head} · final token sequence`)
		expect(text).not.toContain("stale first line")
		expect(text).not.toMatch(/[\r\n\t]/u)
		expect(text).not.toContain("  ")
	})
})

describe("mergedDockLines — think row above tool (D1/D5)", () => {
	const now = 4_000 // 3.0s elapsed for entries started at 1000

	test("scene B: visible think hides tool and todo (think exclusive)", () => {
		const row = think()
		const lines = mergedDockLines(
			{
				think: [row],
				tools: [tool("bash")],
				todos: [todo("active item", "in_progress")],
				agents: [],
			},
			{ innerWidth: 60, now },
		)
		expect(lines.map((line) => line.kind)).toEqual(["think"])
		// The text is the shared thinkBlockLines output verbatim (trimmed of the
		// right-padding fitLine adds to reach innerWidth) — reuse, not a second
		// hand-rolled think format (spec D5 / task A).
		expect(textOf(lines[0]!).trimEnd()).toBe(thinkBlockLines(row, () => 0, 1, now)[0])
	})

	test("scene A: think → tool → todo brief are pinned ABOVE the subagent list", () => {
		const row = think()
		const lines = mergedDockLines(
			{
				think: [row],
				tools: [tool("bash")],
				todos: [todo("active", "in_progress")],
				agents: [agent("a")],
			},
			{ innerWidth: 60, now },
		)
		expect(lines.slice(0, 3).map((line) => line.kind)).toEqual(["think", "tool", "todo"])
		expect(lines[3]!.kind).toBe("agent")
		// Scene A pins think to ONE line regardless of the gear.
		expect(textOf(lines[0]!).trimEnd()).toBe(thinkBlockLines(row, () => 0, 1, now)[0])
	})

	test("scene B honors the think gear (≤ 10 lines)", () => {
		const row = think({ text: "a\nb\nc\nd\ne" })
		const lines = mergedDockLines(
			{ think: [row], tools: [], todos: [], agents: [] },
			{ innerWidth: 60, now, thinkLines: 3 },
		)
		expect(lines).toHaveLength(3)
		expect(lines.every((line) => line.kind === "think")).toBe(true)
	})

	test("think alone: only the think line is produced", () => {
		const lines = mergedDockLines(
			{ think: [think()], tools: [], todos: [], agents: [] },
			{ innerWidth: 40, now },
		)
		expect(lines).toHaveLength(1)
		expect(lines[0]!.kind).toBe("think")
		expect(textOf(lines[0]!).trimEnd()).toBe(thinkBlockLines(think(), () => 0, 1, now)[0])
	})

	test("a replay think row (no panel state) paints no think line", () => {
		const lines = mergedDockLines(
			{
				think: [{ key: "reasoning:stored", kind: "reasoning", text: "stored draft", final: true }],
				tools: [tool("bash")],
				todos: [],
				agents: [],
			},
			{ innerWidth: 40, now },
		)
		expect(lines.every((line) => line.kind !== "think")).toBe(true)
	})
})

describe("mergedDockLines — right-boundary alignment (D13, mandatory)", () => {
	const INNER = 40
	test("every line renders to exactly the inner width with CJK/emoji/VS16/ZWJ/English", () => {
		const cjkEmoji = "修复问题 🛠️👨‍👩‍👧‍👦 ABCDEFGHIJKLMNOPQRSTUVWXYZ"
		const lines = mergedDockLines(
			{
				tools: [tool("bash", { args: `{"command":"${cjkEmoji}"}` })],
				todos: [todo(cjkEmoji, "in_progress")],
				agents: [agent("a", { label: cjkEmoji, lastLine: cjkEmoji })],
			},
			{ innerWidth: INNER, now: 4_000 },
		)
		expect(lines.length).toBeGreaterThan(0)
		for (const line of lines) {
			expect(lineWidth(line)).toBe(INNER)
			expect(stringWidth(textOf(line))).toBe(INNER)
		}
	})

	test("tool-only long English line is also cropped to inner width", () => {
		const lines = mergedDockLines(
			{ tools: [tool("bash", { args: '{"command":"' + "x".repeat(200) + '"}' })], todos: [], agents: [] },
			{ innerWidth: INNER, now: 4_000 },
		)
		expect(lines).toHaveLength(1)
		expect(lineWidth(lines[0]!)).toBe(INNER)
	})
})

describe("mergedDockLines — line-level skin metadata (D3/D5/D13/D14)", () => {
	const now = 4_000

	test("think line: accent think on every text segment, italic, stable id, fadeOutAt by streaming", () => {
		const streaming = think({ streaming: true, startedAt: 1_000, elapsedSec: undefined })
		const opts = { innerWidth: 60, now }
		const a = mergedDockLines({ think: [streaming], tools: [], todos: [], agents: [] }, opts)
		const line = a[0]!
		expect(line.kind).toBe("think")
		for (const segment of line.segments) {
			if (segment.text.length > 0) expect(segment.accent).toBe("think")
		}
		expect(line.italic).toBe(true)
		expect(line.id).toBe(`dock:think:${streaming.key}`)
		expect(line.fadeOutAt).toBeUndefined()

		// Stable across two calls (id is derived from the row key, not the text).
		const b = mergedDockLines({ think: [streaming], tools: [], todos: [], agents: [] }, opts)
		expect(b[0]!.id).toBe(line.id)

		// A stopped row anchors its exit fade at startedAt + elapsedSec*1000.
		const stopped = think({ streaming: false, startedAt: 1_000, elapsedSec: 2.5 })
		const c = mergedDockLines({ think: [stopped], tools: [], todos: [], agents: [] }, opts)
		expect(typeof c[0]!.fadeOutAt).toBe("number")
		expect(c[0]!.fadeOutAt).toBe(3_500)
	})

	test("tool coexistence: body accent tool, marker + markerAt, stable id, fadeOutAt by status", () => {
		const running = tool("bash", { startedAt: 1_000 })
		const opts = { innerWidth: 60, now }
		const a = mergedDockLines({ tools: [running], todos: [todo("active", "in_progress")], agents: [] }, opts)
		const line = a.find((l) => l.kind === "tool")!
		expect(line.segments.some((s) => s.accent === "tool")).toBe(true)
		expect(line.marker).toBe(toolMarker("running")) // ⚙
		expect(line.markerAt).toBe(0)
		expect(line.id).toBe(`dock:tool:${running.key}`)
		expect(line.fadeOutAt).toBeUndefined()

		const b = mergedDockLines({ tools: [running], todos: [todo("active", "in_progress")], agents: [] }, opts)
		expect(b.find((l) => l.kind === "tool")!.id).toBe(line.id)

		const done = tool("bash", { status: "done", startedAt: 1_000, elapsedSec: 2.5 })
		const c = mergedDockLines({ tools: [done], todos: [todo("active", "in_progress")], agents: [] }, opts)
		const doneLine = c.find((l) => l.kind === "tool")!
		expect(doneLine.marker).toBe(toolMarker("done")) // ✔
		expect(typeof doneLine.fadeOutAt).toBe("number")
		expect(doneLine.fadeOutAt).toBe(3_500)
	})

	test("tool-only: body accent tool, marker glyph at offset 0, id, fadeOutAt", () => {
		const running = tool("bash", { startedAt: 1_000 })
		const lines = mergedDockLines({ tools: [running], todos: [], agents: [] }, { innerWidth: 80, now })
		expect(lines).toHaveLength(1)
		const line = lines[0]!
		expect(line.segments.some((s) => s.accent === "tool")).toBe(true)
		expect(line.marker).toBe(toolMarker("running"))
		expect(line.markerAt).toBe(0)
		// toolLineText starts with the glyph, so markerAt 0 is correct.
		expect(textOf(line).startsWith(line.marker!)).toBe(true)
		expect(line.id).toBe(`dock:tool:${running.key}`)
		expect(line.fadeOutAt).toBeUndefined()

		const done = tool("bash", { status: "done", startedAt: 1_000, elapsedSec: 2.5 })
		const doneLine = mergedDockLines({ tools: [done], todos: [], agents: [] }, { innerWidth: 80, now })[0]!
		expect(doneLine.marker).toBe(toolMarker("done"))
		expect(doneLine.markerAt).toBe(0)
		expect(doneLine.fadeOutAt).toBe(3_500)
	})

	test("scene A: subagent rows carry the agent accent, the todo brief stays neutral; no id/fade/marker", () => {
		const todos = Array.from({ length: 12 }, (_, i) => todo(`t${i + 1}`, "in_progress"))
		const lines = mergedDockLines({ tools: [], todos, agents: [agent("a")] }, { innerWidth: 60, now })
		const lower = lines.filter(
			(l) => l.kind === "todo" || l.kind === "agent" || l.kind === "more-top" || l.kind === "more-bottom",
		)
		expect(lower.length).toBeGreaterThan(0)
		for (const line of lower) {
			expect(line.id).toBeUndefined()
			expect(line.fadeOutAt).toBeUndefined()
			expect(line.marker).toBeUndefined()
		}
		// Batch decision: the scene-A todo brief (upper zone) stays neutral — no
		// accent — so it never reads as a colored tree row (avoids mixed-signal).
		const briefs = lower.filter((l) => l.kind === "todo")
		expect(briefs.length).toBeGreaterThan(0)
		for (const line of briefs) for (const segment of line.segments) expect(segment.accent).toBeUndefined()
		// Subagent content is agent-accented; the branch/indent glyph stays muted.
		const agents = lower.filter((l) => l.kind === "agent")
		expect(agents.length).toBeGreaterThan(0)
		for (const line of agents) {
			expect(line.segments.some((s) => s.accent === "agent")).toBe(true)
			expect(line.segments[0]!.accent).toBeUndefined()
		}
		// Scroll indicators carry no accent.
		for (const line of lower.filter((l) => l.kind.startsWith("more-"))) {
			for (const segment of line.segments) expect(segment.accent).toBeUndefined()
		}
	})

	test("todo tree rows and subagent rows resolve to DIFFERENT accents", () => {
		const opts = { innerWidth: 80, now }
		// Scene C: no running subagent / think → the compact todo tree. Every
		// todo row (header + items) carries the green "todo" accent.
		const todoLines = mergedDockLines(
			{ tools: [], todos: [todo("alpha", "in_progress"), todo("beta", "pending")], agents: [] },
			opts,
		).filter((l) => l.kind === "todo")
		expect(todoLines.length).toBeGreaterThan(0)
		for (const line of todoLines) for (const segment of line.segments) expect(segment.accent).toBe("todo")

		// Scene A: a running subagent renders an "agent"-accented content segment.
		const agentLine = mergedDockLines({ tools: [], todos: [], agents: [agent("a")] }, opts).find((l) => l.kind === "agent")!
		const agentAccent = agentLine.segments.find((s) => s.accent !== undefined)!.accent
		expect(agentAccent).toBe("agent")

		// The two row kinds must not share an accent token — that is the whole
		// point of F4 (both used to be tone:"running" amber).
		expect(todoLines[0]!.segments[0]!.accent).not.toBe(agentAccent)
	})

	test("width law holds with emoji/CJK/VS16/ZWJ after adding skin fields", () => {
		const mixed = "修复 🛠️👨‍👩‍👧‍👦 ABCDEFGHIJKLMNOPQRSTUVWXYZ"
		const lines = mergedDockLines(
			{
				think: [think({ text: mixed, startedAt: 1_000 })],
				tools: [tool("bash", { args: `{"command":"${mixed}"}` })],
				todos: [todo(mixed, "in_progress")],
				agents: [agent("a", { label: mixed, lastLine: mixed })],
			},
			{ innerWidth: 40, now },
		)
		expect(lines.length).toBeGreaterThan(0)
		for (const line of lines) {
			expect(lineWidth(line)).toBe(40)
			expect(stringWidth(textOf(line))).toBe(40)
		}
	})

	test("degenerate narrow crop clears a stale marker and keeps the width law", () => {
		const lines = mergedDockLines(
			{
				tools: [tool("bash", { status: "done", startedAt: 1_000, elapsedSec: 2.5 })],
				todos: [todo("active", "in_progress")],
				agents: [],
			},
			{ innerWidth: 0, now },
		)
		expect(lines.length).toBeGreaterThan(0)
		for (const line of lines) {
			expect(lineWidth(line)).toBe(0)
			if (line.marker !== undefined) expect(textOf(line).startsWith(line.marker)).toBe(true)
		}
	})
})

describe("mergedDockLines — configurable total cap & small-cap edge (D12)", () => {
	const now = 4_000
	const base = { tools: [tool("bash")], todos: [], agents: manyAgents(12) }

	test("totalLines threads the cap: exactly N lines for a tool + overflow agents", () => {
		for (const totalLines of [1, 2, 3, 5, 7]) {
			const lines = mergedDockLines(base, { innerWidth: 60, now, totalLines })
			expect(lines).toHaveLength(totalLines)
			expect(lines[0]!.kind).toBe("tool")
			for (const line of lines) expect(lineWidth(line)).toBe(60)
		}
	})

	test("no lower slot (cap < upper lines): upper is trimmed, lower renders nothing", () => {
		// think + tool = 2 upper lines (scene A); cap 1 → newest upper line (tool) only.
		const lines = mergedDockLines(
			{ think: [think()], tools: [tool("bash")], todos: [], agents: manyAgents(12) },
			{ innerWidth: 60, now, totalLines: 1 },
		)
		expect(lines).toHaveLength(1)
		expect(lines[0]!.kind).toBe("tool")
		expect(lines.some((line) => line.kind === "think" || line.kind === "todo" || line.kind.startsWith("more-"))).toBe(false)
	})

	test("one lower slot with overflow: one content line at cursor, no indicator", () => {
		// tool upper + cap 2 → lowerBudget 1 → one content line, NO ▲/▼.
		const top = mergedDockLines(base, { innerWidth: 60, now, totalLines: 2, cursor: 0 })
		expect(top).toHaveLength(2)
		expect(top[1]!.kind).toBe("agent")
		expect(textOf(top[1]!)).toContain("task 1")
		expect(top.some((line) => line.kind === "more-top" || line.kind === "more-bottom")).toBe(false)

		// Clamped to the last item; still exactly one content line, no indicator.
		const bottom = mergedDockLines(base, { innerWidth: 60, now, totalLines: 2, cursor: 11 })
		expect(bottom).toHaveLength(2)
		expect(bottom[1]!.kind).toBe("agent")
		expect(textOf(bottom[1]!)).toContain("task 12")
		expect(bottom.some((line) => line.kind === "more-top" || line.kind === "more-bottom")).toBe(false)
	})

	test("tiny caps never produce a negative window across all cursors", () => {
		for (const totalLines of [0, 1, 2, 3]) {
			for (const cursor of [0, 1, 5, 11, 99, -3]) {
				const lines = mergedDockLines(base, { innerWidth: 60, now, totalLines, cursor })
				expect(lines).toHaveLength(totalLines)
				for (const line of lines) expect(lineWidth(line)).toBe(60)
			}
		}
	})
})

describe("mergedWindowInfo + mergedPositionSuffix — title N/M from the shared window (D8, 2026-11-17)", () => {
	// 14 lower (subagent) items, no upper lines, cap 8 → one indicator + a
	// 7-line window. Since 2026-11-19 the scrollable lower zone is the scene-A
	// subagent list; todos are a pinned one-line brief above it.
	const many = { tools: [], think: [], todos: [], agents: manyAgents(14) }
	const opts = (cursor: number) => ({ innerWidth: 60, now: 4_000, totalLines: 8, cursor })

	test("14 items / 7-line window at cursor 0 → 1/14; cursor 7 → 8/14", () => {
		const top = mergedWindowInfo(many, opts(0))
		expect(top.total).toBe(14)
		expect(top.position).toBe(1)
		expect(top.start).toBe(0)
		expect(top.size).toBe(7)
		expect(top.overflow).toBe(true)
		expect(mergedPositionSuffix(top)).toBe("1/14")

		const mid = mergedWindowInfo(many, opts(7))
		expect(mid.position).toBe(8)
		expect(mid.start).toBe(7)
		expect(mergedPositionSuffix(mid)).toBe("8/14")

		// N/M and the rendered window come from the SAME data: the first visible
		// agent at cursor 7 is "task 8" (position 8).
		const lines = mergedDockLines(many, opts(7))
		const firstAgent = lines.find((line) => line.kind === "agent")!
		expect(textOf(firstAgent)).toContain("task 8")
	})

	test("no overflow → no suffix (everything fits)", () => {
		const few = { tools: [], think: [], todos: [], agents: manyAgents(3) }
		const info = mergedWindowInfo(few, opts(0))
		expect(info.overflow).toBe(false)
		expect(info.total).toBe(3)
		expect(mergedPositionSuffix(info)).toBeNull()
	})

	test("out-of-range cursor is clamped on every build; window never blanks", () => {
		for (const cursor of [999, -5, 13]) {
			const lines = mergedDockLines(many, opts(cursor))
			const content = lines.filter((line) => line.kind === "todo" || line.kind === "agent")
			expect(content.length).toBeGreaterThan(0)
			const info = mergedWindowInfo(many, opts(cursor))
			expect(info.start).toBeGreaterThanOrEqual(0)
			expect(info.start).toBeLessThanOrEqual(info.maxCursor)
			expect(info.position).toBe(info.start + 1)
		}
	})
})

describe("mergedWindowInfo.maxCursor — no dead zone at the visual bottom (P1)", () => {
	const lastContent = (lines: ReturnType<typeof mergedDockLines>) => {
		const content = lines.filter((line) => line.kind === "todo" || line.kind === "agent")
		return textOf(content[content.length - 1]!)
	}

	const cases: Array<{ label: string; n: number; totalLines: number; tools: MergedToolRow[]; expected: number }> = [
		{ label: "n=12, size 8 (the reported bug)", n: 12, totalLines: 9, tools: [], expected: 4 },
		{ label: "n=12, size 8 + coexistence tool", n: 12, totalLines: 10, tools: [tool("bash")], expected: 4 },
		{ label: "n=14, size 7", n: 14, totalLines: 8, tools: [], expected: 7 },
		{ label: "n=20, size 4", n: 20, totalLines: 5, tools: [], expected: 16 },
		{ label: "n=8, size 3", n: 8, totalLines: 4, tools: [], expected: 5 },
	]
	for (const c of cases) {
		test(`${c.label}: maxCursor=${c.expected}, last item is the last content row, +step clamps back`, () => {
			const data = { tools: c.tools, think: [], todos: [], agents: manyAgents(c.n) }
			const opts = (cursor: number) => ({ innerWidth: 60, now: 4_000, totalLines: c.totalLines, cursor })
			const info = mergedWindowInfo(data, opts(0))
			expect(info.overflow).toBe(true)
			// The old code reported n-1; that left a dead zone of (n-1-maxCursor) notches.
			expect(info.maxCursor).toBe(c.expected)
			expect(info.maxCursor).not.toBe(c.n - 1)

			const atMax = mergedDockLines(data, opts(info.maxCursor))
			expect(lastContent(atMax)).toContain(`task ${c.n}`)
			const past = mergedDockLines(data, opts(info.maxCursor + 3))
			const pastInfo = mergedWindowInfo(data, opts(info.maxCursor + 3))
			expect(pastInfo.start).toBe(info.maxCursor)
			expect(past.map(textOf)).toEqual(atMax.map(textOf))
		})
	}

	test("maxCursor is branch-stable: both-indicator cursors report the same cap as the bottom cursor", () => {
		const data = { tools: [tool("bash")], think: [], todos: [], agents: manyAgents(12) }
		const opts = (cursor: number) => ({ innerWidth: 60, now: 4_000, totalLines: 11, cursor })
		const midLines = mergedDockLines(data, opts(2))
		expect(midLines.some((line) => line.kind === "more-top")).toBe(true)
		expect(midLines.some((line) => line.kind === "more-bottom")).toBe(true)
		const mid = mergedWindowInfo(data, opts(2))
		const bottom = mergedWindowInfo(data, opts(mid.maxCursor))
		expect(mid.maxCursor).toBe(3) // n - (lowerBudget - 2) - 1 = 12 - 8 - 1
		expect(bottom.maxCursor).toBe(mid.maxCursor)
		expect(lastContent(mergedDockLines(data, opts(mid.maxCursor)))).toContain("task 12")
	})

	test("tiny budgets use their own clamp bound: lowerBudget 1 → n-1, budget-2 both → n-2", () => {
		const data = { tools: [tool("bash")], think: [], todos: [], agents: manyAgents(12) }
		// cap 2 → lowerBudget 1: one content line, maxCursor = n - 1 = 11.
		const one = mergedWindowInfo(data, { innerWidth: 60, now: 4_000, totalLines: 2, cursor: 0 })
		expect(one.maxCursor).toBe(11)
		expect(lastContent(mergedDockLines(data, { innerWidth: 60, now: 4_000, totalLines: 2, cursor: one.maxCursor }))).toContain("task 12")
		// cap 3 → lowerBudget 2: a middle cursor takes the no-indicator "both" branch,
		// whose clamp bound is n - lowerBudget = 10.
		const twoOpts = (cursor: number) => ({ innerWidth: 60, now: 4_000, totalLines: 3, cursor })
		const twoLines = mergedDockLines(data, twoOpts(5))
		expect(twoLines.some((line) => line.kind.startsWith("more-"))).toBe(false)
		const two = mergedWindowInfo(data, twoOpts(5))
		expect(two.maxCursor).toBe(10)
		expect(lastContent(mergedDockLines(data, twoOpts(two.maxCursor)))).toContain("task 12")
	})
})

describe("mergedWindowInfo no-window semantics — n>0 but no lower slot (P3)", () => {
	const data = {
		tools: [tool("bash")],
		think: [think()],
		todos: [],
		agents: manyAgents(12),
	}
	const opts = (totalLines: number) => ({ innerWidth: 60, now: 4_000, totalLines })

	test("no lower slot: size 0 / overflow false / maxCursor 0 and NO N/M (documented, bound)", () => {
		// think + tool = 2 upper lines, cap 1 → lowerBudget < 1 → noWindow().
		const info = mergedWindowInfo(data, opts(1))
		expect(info.total).toBe(12)
		expect(info.position).toBe(1)
		expect(info.start).toBe(0)
		expect(info.size).toBe(0)
		expect(info.overflow).toBe(false)
		expect(info.maxCursor).toBe(0)
		expect(mergedPositionSuffix(info)).toBeNull()
		const lines = mergedDockLines(data, opts(1))
		expect(lines).toHaveLength(1)
		expect(lines[0]!.kind).toBe("tool")
		expect(lines.some((line) => line.kind.startsWith("more-"))).toBe(false)
	})

	test("cap ≤ 0: same no-window report, no lines at all", () => {
		const info = mergedWindowInfo(data, opts(0))
		expect(info.size).toBe(0)
		expect(info.overflow).toBe(false)
		expect(info.maxCursor).toBe(0)
		expect(mergedPositionSuffix(info)).toBeNull()
		expect(mergedDockLines(data, opts(0))).toEqual([])
	})
})
