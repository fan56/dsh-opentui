/**
 * /agents pure models after the panel-kit migration.
 *
 * The ad-hoc line builders (agentTableLines/…, MAX_VISIBLE slicing) were
 * replaced by panel-kit List items + paging; the assertions that pinned their
 * exact strings moved to test/agents-panel-panelkit.test.tsx, which drives the
 * real modal stack and asserts the painted frames. What stays here is the
 * data layer: row models, limits/copy ordering, parse rules, preselect and the
 * two-stage picker flow, plus the open-state lifetime.
 */
import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import {
	agentFieldContent,
	agentFieldItems,
	agentLimitsCell,
	agentLimitsItem,
	agentLimitsRows,
	agentName,
	agentPickerItems,
	agentEffortItems,
	agentTableItem,
	agentTableItems,
	agentsPanelOpen,
	agentsSummary,
	beginPickerFlow,
	effortCursorFor,
	initialAgentLevel,
	officialCapSettingsRow,
	parseDeepInput,
	parseMaxRoundsInput,
	pickerSelectEffort,
	pickerSelectModel,
	preselectAgentIndex,
	useAgentsPanelOpenState,
	viewerWindow,
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

describe("agents table model", () => {
	test("one item per row; NAME rides the label (List's first-column fallback)", () => {
		const items = agentTableItems(rows)
		expect(items).toHaveLength(2)
		expect(items[0]!.id).toBe("workhorse")
		expect(items[0]!.label).toBe("Workhorse")
		// The cells block deliberately omits `name`: panel-kit List paints the
		// label in the first column when cells[id] is missing.
		expect(items[0]!.cells?.name).toBeUndefined()
		expect(items[0]!.cells).toMatchObject({
			model: "bigmodel/glm-5.3",
			thinking: "high",
			deep: "2",
			limits: "—",
		})
	})

	test("inherit fallbacks and the per-agent limits summary", () => {
		const item = agentTableItem({ name: "bare", deep: 0, file: "/tmp/bare.md" })
		expect(item.label).toBe("bare")
		expect(item.cells).toMatchObject({ model: "(inherit)", thinking: "—", deep: "0" })
		expect(agentLimitsCell({ name: "a", deep: 1, maxRounds: 12, background: true, file: "/a.md" })).toBe(
			"rounds 12 · background",
		)
		expect(agentLimitsCell({ name: "a", deep: 1, file: "/a.md" })).toBe("")
		expect(agentName({ name: "x", displayName: "X", deep: 0, file: "/x.md" })).toBe("X")
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

describe("agents field model", () => {
	test("model/thinking/deep rows in fixed order with the inherit defaults", () => {
		const items = agentFieldItems(rows[1]!)
		expect(items.map((item) => item.id)).toEqual(["model", "thinking", "deep"])
		expect(items.every((item) => item.badge === "✎")).toBe(true)
		expect(items[0]!.cells?.value).toBe("(inherit — default model)")
		expect(items[1]!.cells?.value).toBe("(inherit)")
		expect(items[2]!.cells?.value).toBe("0")
	})

	test("the description + scope hint (workspace pin vs global frontmatter)", () => {
		const pinned = agentFieldContent({ ...rows[0]!, pin: "work" })
		expect(pinned[0]).toBe("does the work")
		expect(pinned.at(-1)).toContain('apply to profile "work"')
		const unpinned = agentFieldContent(rows[1]!)
		expect(unpinned[0]).toBe("")
		expect(unpinned.at(-1)).toContain("no workspace profile pin")
	})
})

describe("viewer window", () => {
	test("caps at maxRows and reports the overflow", () => {
		const body = Array.from({ length: 43 }, (_, i) => `line ${i + 1}`).join("\n")
		const window = viewerWindow(body, 40)
		expect(window.lines).toHaveLength(40)
		expect(window.lines.at(-1)).toBe("line 40")
		expect(window.hidden).toBe(3)
		expect(viewerWindow("a\nb", 40)).toEqual({ lines: ["a", "b"], hidden: 0 })
	})
})

describe("deep / maxRounds parse", () => {
	test("deep parse: empty keeps, non-digit errors, digits commit", () => {
		expect(parseDeepInput("  ")).toEqual({ kind: "keep" })
		expect(parseDeepInput("-1")).toMatchObject({ kind: "error" })
		expect(parseDeepInput("abc")).toEqual({ kind: "error", error: 'expected a non-negative integer, got "abc"' })
		expect(parseDeepInput(" 3 ")).toEqual({ kind: "value", value: 3 })
		expect(parseDeepInput("0")).toEqual({ kind: "value", value: 0 })
	})

	test("maxRounds parse: keep on empty, positive integer only (0 breaks the registry)", () => {
		expect(parseMaxRoundsInput("  ")).toEqual({ kind: "keep" })
		expect(parseMaxRoundsInput(" 12 ")).toEqual({ kind: "value", value: 12 })
		expect(parseMaxRoundsInput("0")).toEqual({ kind: "error", error: 'expected a positive integer, got "0"' })
		expect(parseMaxRoundsInput("-1")).toMatchObject({ kind: "error" })
		expect(parseMaxRoundsInput("abc")).toMatchObject({ kind: "error" })
	})
})

describe("limits layer model", () => {
	const agent: SeamAgentRow = {
		name: "workhorse",
		displayName: "Workhorse",
		maxRounds: 12,
		background: true,
		deep: 1,
		file: "/tmp/workhorse.md",
	}

	test("four rows in fixed order: per-agent caps then official caps", () => {
		const limits = agentLimitsRows(agent, { maxActiveSubagents: 8, maxDepth: 1 })
		expect(limits.map((row) => row.key)).toEqual(["maxRounds", "background", "maxActiveSubagents", "maxDepth"])
		expect(limits.map((row) => row.editable)).toEqual([true, true, false, false])
		expect(limits.map((row) => row.value)).toEqual(["12", "on", "8", "1"])
	})

	test("missing per-agent values show (inherit)/off; unreadable official caps show n/a", () => {
		const bare: SeamAgentRow = { name: "bare", deep: 1, file: "/tmp/bare.md" }
		const limits = agentLimitsRows(bare, undefined)
		expect(limits[0]!.value).toBe("(inherit)")
		expect(limits[1]!.value).toBe("off")
		expect(limits[2]!.value).toBe("n/a")
		expect(limits[3]!.value).toBe("n/a")
	})

	test("editable rows carry the ✎ badge; read-only official caps do not", () => {
		const items = agentLimitsRows(agent, { maxActiveSubagents: 8, maxDepth: 1 }).map(agentLimitsItem)
		expect(items.find((item) => item.id === "maxRounds")!.badge).toBe("✎")
		expect(items.find((item) => item.id === "background")!.badge).toBe("✎")
		expect(items.find((item) => item.id === "maxActiveSubagents")!.badge).toBeUndefined()
		expect(items.find((item) => item.id === "maxDepth")!.badge).toBeUndefined()
		expect(items[0]!.cells?.value).toBe("12 · assistant messages before wrap-up")
		expect(items[2]!.cells?.value).toBe("8 · official concurrent-children cap (subagent plugin)")
	})

	test("zero agents: only the two official rows remain", () => {
		const limits = agentLimitsRows(undefined, { maxActiveSubagents: 8, maxDepth: 1 })
		expect(limits.map((row) => row.key)).toEqual(["maxActiveSubagents", "maxDepth"])
		expect(limits.every((row) => !row.editable)).toBe(true)
	})

	test("the official-cap Enter jumps to the real /settings whitelist row", () => {
		// The old copy said "edit them in /settings" with no way to get there;
		// the id must match settings-panel's whitelist exactly.
		expect(officialCapSettingsRow("maxActiveSubagents")).toBe("subagent.maxActiveSubagents")
		expect(officialCapSettingsRow("maxDepth")).toBe("subagent.maxDepth")
	})
})

describe("model picker model", () => {
	const ladder: SeamEffortOption[] = [
		{ id: "low", name: "Low" },
		{ id: "high", name: "High" },
	]

	test("picker items key the route and expose MODEL/PROVIDER cells", () => {
		const items = agentPickerItems([{ providerID: "p", modelID: "m" }])
		expect(items[0]!.id).toBe("p/m")
		expect(items[0]!.label).toBe("m")
		expect(items[0]!.cells).toEqual({ provider: "p" })
	})

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

	test("effort items put (provider default) first and map row 0 to null", () => {
		const items = agentEffortItems(ladder)
		expect(items.map((item) => item.id)).toEqual(["default", "low", "high"])
		expect(items[0]!.label).toBe("(provider default)")
		expect(items[0]!.value).toBeNull()
		expect(items[2]!.value).toBe("high")
	})
})

describe("open landing (empty corpus)", () => {
	test("an empty corpus opens on the limits layer, a non-empty one on the table", () => {
		expect(initialAgentLevel([])).toBe("limits")
		expect(initialAgentLevel(rows)).toBe("table")
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
