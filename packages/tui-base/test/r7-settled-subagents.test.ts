/**
 * R7 — a settled subagent leaves every dock face immediately.
 * Preregistration: .proof/r7-r8-subagent-brief/00-preregistered-expected.md §一
 *
 * User 2026-11-23: 「子 agent 执行完毕，就消失，不要占位置」. The four dock
 * faces were ALREADY running-only before this slice (framed scene-A list,
 * compact lower, lastrequest children, D10 latch); these tests LOCK that
 * invariant so a future change cannot reintroduce a completed-agent row.
 * Tool rows (✔use_agent / ✔wait_agent) and the /subagents viewer are out of
 * scope by user decision.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { bundledLocalesDir, loadLocales, setLanguages } from "@dsh-opentui/i18n"
import type { SeamRow } from "../src/routes/session/seam-rows"
import { mergedDockLines, type MergedAgent } from "../src/routes/session/merged-dock"
import { mergedLowerHasContent, mergedRunningAgents } from "../src/routes/session/widgets-dock"

beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages)
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

const textOf = (line: ReturnType<typeof mergedDockLines>[number]) => line.segments.map((s) => s.text).join("")

describe("R7 — settled subagents leave every dock face immediately", () => {
	test("mergedRunningAgents drops settled children (running-only invariant)", () => {
		const rows = [subagentRow([
			{ id: "a", status: "running" },
			{ id: "b", status: "completed" },
			{ id: "c", status: "failed" },
		])]
		expect(mergedRunningAgents(rows).map((a) => a.id)).toEqual(["a"])
	})

	test("scene A agent list drops a settled agent on the next build", () => {
		const data = {
			tools: [],
			todos: [],
			agents: [runningAgent("a"), runningAgent("b", { status: "completed" })],
		}
		const withSettled = mergedDockLines(data, { innerWidth: 76, now: 2_000 })
		expect(withSettled.filter((l) => l.kind === "agent")).toHaveLength(1)
		expect(textOf(withSettled.find((l) => l.kind === "agent")!)).toContain("agent-a")

		const allSettled = mergedDockLines({ ...data, agents: [runningAgent("a", { status: "completed" })] }, { innerWidth: 76, now: 2_000 })
		expect(allSettled.filter((l) => l.kind === "agent")).toHaveLength(0)
	})

	test("a settled-only roster does NOT keep the D10 lower zone alive", () => {
		expect(mergedLowerHasContent([subagentRow([{ id: "a", status: "completed" }, { id: "b", status: "failed" }])])).toBe(false)
		expect(mergedLowerHasContent([subagentRow([{ id: "a", status: "running" }])])).toBe(true)
	})
})
