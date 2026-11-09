/**
 * /agents panel layer (tui-pi agents manager parity, phase 1): the table
 * rendering (row count, cells, `▸ ` marker, overflow counter), the field
 * rows/defaults, the `v` viewer cap, and the pure two-stage picker flow
 * (Esc at either stage cancels the whole change).
 */
import { describe, expect, test } from "bun:test"
import {
	agentEffortLines,
	agentFieldLines,
	agentTableLines,
	agentViewerLines,
	agentsSummary,
	beginPickerFlow,
	effortCursorFor,
	parseDeepInput,
	pickerCancel,
	pickerSelectEffort,
	pickerSelectModel,
	preselectAgentIndex,
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
