/**
 * /agents panel layer (tui-pi agents manager parity, phase 1): the table
 * rendering (row count, cells, `▸ ` marker, overflow counter), the field
 * rows/defaults, the `v` viewer cap, and the pure two-stage picker flow
 * (Esc at either stage cancels the whole change).
 */
import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import {
	agentEffortLines,
	agentEmptyLines,
	agentFieldLines,
	agentLimitsLines,
	agentLimitsRows,
	agentTableLines,
	agentViewerLines,
	agentsPanelOpen,
	agentsSummary,
	beginPickerFlow,
	effortCursorFor,
	initialAgentLevel,
	limitsEscapeTarget,
	parseDeepInput,
	parseMaxRoundsInput,
	pickerCancel,
	pickerSelectEffort,
	pickerSelectModel,
	preselectAgentIndex,
	useAgentsPanelOpenState,
} from "../src/routes/session/agents-panel"
import type { SeamAgentRow, SeamEffortOption } from "../src/seams/session"

const rows: SeamAgentRow[] = [
	{
		name: "workhorse",
		displayName: "Workhorse",
		model: "bigmodel/glm-5.3",
		thinking: "high",
		deep: 2,
		description: "does the work",
		file: "/tmp/workhorse.md",
	},
	{ name: "reviewer", model: undefined, deep: 0, description: "", file: "/tmp/reviewer.md" },
]

describe("agents table layer", () => {
	test("header carries NAME | MODEL | DEEP | DESCRIPTION", () => {
		const lines = agentTableLines(rows, 0, 120)
		const header = lines.find((line) => line.text.includes("NAME"))!.text
		expect(header).toContain("NAME")
		expect(header).toContain("MODEL")
		expect(header).toContain("DEEP")
		expect(header).toContain("DESCRIPTION")
	})

	test("one line per row; the cursor row carries ▸ and the composed values", () => {
		const lines = agentTableLines(rows, 0, 120)
		const selected = lines.find((line) => line.text.startsWith("▸ "))!
		expect(selected.text).toContain("Workhorse")
		expect(selected.text).toContain("bigmodel/glm-5.3")
		expect(selected.text).toContain("does the work")
		expect(selected.tone).toBe("selected")
		// the second row: no marker, inherit fallback, display name falls back
		const second = lines.find((line) => line.text.includes("reviewer") && !line.text.includes("Workhorse"))!
		expect(second.text.startsWith("  ")).toBe(true)
		expect(second.text).toContain("(inherit)")
	})

	test("overflow caps at 12 rows and the footer reports (cursor/total)", () => {
		const many = Array.from({ length: 14 }, (_, i) => ({
			name: `agent${String(i).padStart(2, "0")}`,
			deep: 1,
			file: `/tmp/a${i}.md`,
		}))
		const lines = agentTableLines(many, 13, 120)
		const body = lines.filter((line) => line.text.includes("agent"))
		expect(body).toHaveLength(12)
		expect(lines.at(-1)!.text).toContain("(14/14)")
		expect(lines.at(-1)!.text).toContain("l limits")
	})

	test("/agents <name> preselects the exact name row only", () => {
		expect(preselectAgentIndex(rows, "workhorse")).toBe(0)
		expect(preselectAgentIndex(rows, "Workhorse")).toBe(-1)
		expect(preselectAgentIndex(rows, "nope")).toBe(-1)
		expect(preselectAgentIndex(rows, undefined)).toBe(-1)
	})
})

describe("empty corpus state", () => {
	test("names the real agents directory and keeps the l hint visible", () => {
		const lines = agentEmptyLines("/home/u/.dsh/agents", 120)
		const copy = lines.find((line) => line.text.includes("no agents in"))!
		expect(copy.text).toBe("no agents in /home/u/.dsh/agents yet — drop a markdown file to define one")
		expect(lines.some((line) => line.text.includes("l limits"))).toBe(true)
	})

	test("renders the status line (the l notice is visible with zero agents)", () => {
		const lines = agentEmptyLines("/home/u/.dsh/agents", 120, "limits panel — next phase")
		expect(lines.some((line) => line.text === "limits panel — next phase" && line.tone === "attention")).toBe(true)
	})

	test("the old $DSH_HOME copy is gone", () => {
		const lines = agentEmptyLines("/x/agents", 120)
		expect(lines.some((line) => line.text.includes("$DSH_HOME"))).toBe(false)
	})
})

describe("exit summary", () => {
	test("no changes and the changed-name list (seed branch is phase 2)", () => {
		expect(agentsSummary([])).toBe("Agents unchanged.")
		expect(agentsSummary(["workhorse"])).toBe("Agents updated: workhorse")
		expect(agentsSummary(["workhorse", "reviewer"])).toBe("Agents updated: workhorse, reviewer")
	})
})

describe("agents field layer", () => {
	test("model/thinking/deep rows with the inherit defaults and ✎ affordance", () => {
		const lines = agentFieldLines(rows[1]!, 0, 120)
		expect(lines[0]!.text).toBe("● reviewer")
		const values = lines.filter((line) => line.text.includes("✎")).map((l) => l.text)
		expect(values[0]).toContain("model")
		expect(values[0]).toContain("✎ (inherit — default model)")
		expect(values[1]).toContain("thinking")
		expect(values[1]).toContain("✎ (inherit)")
		expect(values[2]).toContain("deep")
		expect(values[2]).toContain("✎ 0")
		expect(lines.some((line) => line.text.includes("no workspace profile pin"))).toBe(true)
		expect(lines.at(-1)!.text).toContain("v full prompt")
	})

	test("a pinned agent carries the profile scope hint", () => {
		const lines = agentFieldLines({ ...rows[0]!, pin: "work" }, 0, 140)
		expect(lines.some((line) => line.text.includes('apply to profile "work"'))).toBe(true)
	})
})

describe("agents viewer + deep editor", () => {
	test("viewer caps at 40 lines and reports the overflow", () => {
		const body = Array.from({ length: 43 }, (_, i) => `line ${i + 1}`).join("\n")
		const lines = agentViewerLines("workhorse", body, 120)
		expect(lines.some((line) => line.text.includes("line 40"))).toBe(true)
		expect(lines.some((line) => line.text.includes("line 41"))).toBe(false)
		expect(lines.some((line) => line.text === "… 3 more line(s)")).toBe(true)
		expect(lines.at(-1)!.text).toBe("  Esc to close")
	})

	test("deep parse: empty keeps, non-digit errors, digits commit", () => {
		expect(parseDeepInput("  ")).toEqual({ kind: "keep" })
		expect(parseDeepInput("-1")).toMatchObject({ kind: "error" })
		expect(parseDeepInput("abc")).toEqual({ kind: "error", error: 'expected a non-negative integer, got "abc"' })
		expect(parseDeepInput(" 3 ")).toEqual({ kind: "value", value: 3 })
		expect(parseDeepInput("0")).toEqual({ kind: "value", value: 0 })
	})
})

describe("limits layer (phase 2)", () => {
	const agent: SeamAgentRow = {
		name: "workhorse",
		displayName: "Workhorse",
		maxRounds: 12,
		background: true,
		deep: 1,
		file: "/tmp/workhorse.md",
	}

	test("four rows in fixed order: per-agent caps then official caps", () => {
		const rows = agentLimitsRows(agent, { maxActiveSubagents: 8, maxDepth: 1 })
		expect(rows.map((row) => row.key)).toEqual(["maxRounds", "background", "maxActiveSubagents", "maxDepth"])
		expect(rows.map((row) => row.editable)).toEqual([true, true, false, false])
		expect(rows.map((row) => row.value)).toEqual(["12", "on", "8", "1"])
	})

	test("missing per-agent values show (inherit)/off; unreadable official caps show n/a", () => {
		const bare: SeamAgentRow = { name: "bare", deep: 1, file: "/tmp/bare.md" }
		const rows = agentLimitsRows(bare, undefined)
		expect(rows[0]!.value).toBe("(inherit)")
		expect(rows[1]!.value).toBe("off")
		expect(rows[2]!.value).toBe("n/a")
		expect(rows[3]!.value).toBe("n/a")
	})

	test("rendered lines carry the spec copy, the target agent and ✎ only on editable rows", () => {
		const lines = agentLimitsLines({
			agent,
			caps: { maxActiveSubagents: 8, maxDepth: 1 },
			cursor: 0,
			width: 140,
		})
		expect(lines[0]!.text).toBe("⚙ Limits")
		expect(lines[1]!.text).toBe("target: Workhorse")
		const body = lines.filter((line) => line.text.startsWith("▸ ") || (line.text.startsWith("  ") && line.text.includes("·")))
		const byKey = (key: string) => body.find((line) => line.text.includes(key))!.text
		expect(byKey("maxRounds")).toContain("12 · assistant messages before wrap-up")
		expect(byKey("maxRounds")).toContain("✎")
		expect(byKey("background")).toContain("on · run this agent in background sessions")
		expect(byKey("background")).toContain("✎")
		expect(byKey("maxActiveSubagents")).toContain("8 · official concurrent-children cap (subagent plugin)")
		expect(byKey("maxActiveSubagents")).not.toContain("✎")
		expect(byKey("maxDepth")).toContain("1 · official delegation depth (subagent plugin)")
		expect(byKey("maxDepth")).not.toContain("✎")
		expect(lines.at(-1)!.text).toContain("d toggle background")
	})

	test("zero agents: only the two official rows plus the empty-corpus hint; Esc closes", () => {
		const lines = agentLimitsLines({ caps: { maxActiveSubagents: 8, maxDepth: 1 }, cursor: 0, width: 140, dir: "/h/agents" })
		const rows = agentLimitsRows(undefined, { maxActiveSubagents: 8, maxDepth: 1 })
		expect(rows.map((row) => row.key)).toEqual(["maxActiveSubagents", "maxDepth"])
		expect(rows.every((row) => !row.editable)).toBe(true)
		expect(lines.some((line) => line.text.includes("no agents in /h/agents yet"))).toBe(true)
		expect(lines.some((line) => line.text.includes("maxRounds"))).toBe(false)
		expect(limitsEscapeTarget(0)).toBe("close")
		expect(limitsEscapeTarget(2)).toBe("table")
	})

	test("broken files are reported in both layers", () => {
		expect(agentTableLines(rows, 0, 140, undefined, 2).some((line) => line.text === "2 broken file(s) ignored")).toBe(true)
		expect(agentEmptyLines("/h/agents", 140, undefined, 1).some((line) => line.text === "1 broken file(s) ignored")).toBe(true)
		expect(
			agentLimitsLines({ agent, cursor: 0, width: 140, broken: 3 }).some((line) => line.text === "3 broken file(s) ignored"),
		).toBe(true)
	})

	test("maxRounds parse: keep on empty, positive integer only (0 breaks the registry)", () => {
		expect(parseMaxRoundsInput("  ")).toEqual({ kind: "keep" })
		expect(parseMaxRoundsInput(" 12 ")).toEqual({ kind: "value", value: 12 })
		expect(parseMaxRoundsInput("0")).toEqual({ kind: "error", error: 'expected a positive integer, got "0"' })
		expect(parseMaxRoundsInput("-1")).toMatchObject({ kind: "error" })
		expect(parseMaxRoundsInput("abc")).toMatchObject({ kind: "error" })
	})
})

describe("model picker (two stages)", () => {
	const ladder: SeamEffortOption[] = [
		{ id: "low", name: "Low" },
		{ id: "high", name: "High" },
	]

	test("a model without a ladder commits {model, thinking:null}", () => {
		const next = pickerSelectModel(beginPickerFlow(), { providerID: "p", modelID: "m" }, [], "high")
		expect(next).toEqual({ stage: "done", model: "p/m", thinking: null })
	})

	test("a model with a ladder advances to stage 2 with the current effort preselected", () => {
		const next = pickerSelectModel(beginPickerFlow(), { providerID: "p", modelID: "m" }, ladder, "high")
		expect(next).toMatchObject({ stage: "effort", model: "p/m", cursor: 2 })
		expect(effortCursorFor(ladder, undefined)).toBe(0)
		expect(effortCursorFor(ladder, "missing")).toBe(0)
	})

	test("stage 2 row 0 clears; another row picks the effort", () => {
		const flow = pickerSelectModel(beginPickerFlow(), { providerID: "p", modelID: "m" }, ladder, "high")
		expect(pickerSelectEffort(flow, 0)).toEqual({ stage: "done", model: "p/m", thinking: null })
		expect(pickerSelectEffort(flow, 2)).toEqual({ stage: "done", model: "p/m", thinking: "high" })
	})

	test("Esc at either stage cancels the whole change (nothing committed)", () => {
		expect(pickerCancel(beginPickerFlow())).toEqual({ stage: "cancelled" })
		const stage2 = pickerSelectModel(beginPickerFlow(), { providerID: "p", modelID: "m" }, ladder, undefined)
		expect(pickerCancel(stage2)).toEqual({ stage: "cancelled" })
	})

	test("effort lines put (provider default) first", () => {
		const lines = agentEffortLines(ladder, 0, 120)
		expect(lines[0]!.text).toBe("● Reasoning effort")
		const body = lines.filter(
			(line) =>
				(line.text.startsWith("▸ ") || line.text.startsWith("  ")) &&
				!line.text.includes("EFFORT") &&
				!line.text.includes("─"),
		)
		expect(body[0]!.text).toContain("(provider default)")
		expect(body[1]!.text).toContain("Low")
		expect(body[2]!.text).toContain("High")
	})
})

describe("open landing (empty corpus)", () => {
	test("an empty corpus opens on the limits layer, a non-empty one on the table", () => {
		expect(initialAgentLevel([])).toBe("limits")
		expect(initialAgentLevel(rows)).toBe("table")
	})

	test("the limits layer title is the limits heading", () => {
		const lines = agentLimitsLines({ cursor: 0, width: 120 })
		expect(lines[0]!.text).toBe("⚙ Limits")
	})
})

describe("open-state lifetime", () => {
	test("unmount resets the /agents open signal so the sidebar Esc layer recovers", () => {
		const dispose = createRoot((dispose) => {
			const [open, setOpen] = useAgentsPanelOpenState()
			setOpen(true)
			expect(open()).toBe(true)
			return dispose
		})
		dispose()
		expect(agentsPanelOpen()).toBe(false)
	})
})
