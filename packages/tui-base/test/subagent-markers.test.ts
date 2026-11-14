import { beforeEach, describe, expect, test } from "bun:test"
import {
	foldSubagentMarkerViews,
	subagentHardStopGlyph,
	subagentMarkerSuffix,
	subagentMarkersFor,
	printSteerFeedback,
	registerSubagentSteer,
	registerSubagentSteerFeedback,
	resetSubagentSlotsForTests,
	steerSubagent,
	subagentSteerWired,
} from "../src/routes/session/subagent-markers"

// bun test runs the whole monorepo in one process: shell specs that build a
// RemoteSessionSeam leave the module steer slot registered (the adapter
// wires it in its constructor). Reset both slots so the "unwired" specs
// below see the fresh-process contract they assert.
beforeEach(() => {
	resetSubagentSlotsForTests()
})

describe("subagentMarkerSuffix", () => {
	test("empty when neither policy stage fired", () => {
		expect(subagentMarkerSuffix({})).toBe("")
		expect(subagentMarkerSuffix({ injectedRound: undefined, hardStopRound: undefined })).toBe("")
	})

	test("⚡ injected when the wrap-up landed", () => {
		expect(subagentMarkerSuffix({ injectedRound: 8 })).toBe(" ⚡ injected")
	})

	test("⏻ hard-stopped @N carries the stop round", () => {
		expect(subagentMarkerSuffix({ hardStopRound: 12 })).toBe(" ⏻ hard-stopped @12")
	})

	test("both markers compose, stop first (tui-pi viewer order)", () => {
		expect(subagentMarkerSuffix({ injectedRound: 8, hardStopRound: 10 })).toBe(" ⏻ hard-stopped @10 ⚡ injected")
	})
})

describe("subagentHardStopGlyph", () => {
	test("⏻ only when hard-stopped", () => {
		expect(subagentHardStopGlyph({ hardStopRound: 3 })).toBe("⏻")
		expect(subagentHardStopGlyph({})).toBe("")
	})
})

describe("marker store", () => {
	test("foldSubagentMarkerViews feeds lookups by session id", () => {
		foldSubagentMarkerViews([
			{ id: "child-a", label: "Explore", status: "running", rounds: 4, injectedRound: 4 },
			{ id: "child-b", label: "Plan", status: "cancelled", rounds: 6, hardStopRound: 6 },
		])
		expect(subagentMarkersFor("child-a")?.injectedRound).toBe(4)
		expect(subagentMarkersFor("child-b")?.hardStopRound).toBe(6)
		expect(subagentMarkersFor("child-c")).toBeUndefined()
	})
})

describe("steer slot (batch G2)", () => {
	test("unwired slot: steerSubagent returns undefined, wired() is false", () => {
		expect(subagentSteerWired()).toBe(false)
		expect(steerSubagent("child-a", "wrap up")).toBeUndefined()
	})

	test("registered face: steerSubagent delegates 1:1, wired() flips true", () => {
		const calls: [string, string][] = []
		registerSubagentSteer((id, text) => {
			calls.push([id, text])
			return id === "child-a"
		})
		expect(subagentSteerWired()).toBe(true)
		expect(steerSubagent("child-a", "go left")).toBe(true)
		expect(steerSubagent("child-b", "go left")).toBe(false)
		expect(calls).toEqual([
			["child-a", "go left"],
			["child-b", "go left"],
		])
	})
})

describe("steer feedback slot (batch D9)", () => {
	test("unregistered printer: printSteerFeedback is a silent no-op", () => {
		expect(() => printSteerFeedback("steered explore")).not.toThrow()
	})

	test("registered printer: lines ride to the page's say path 1:1", () => {
		const lines: string[] = []
		registerSubagentSteerFeedback((line) => lines.push(line))
		printSteerFeedback("steered explore")
		printSteerFeedback("steer rejected — Plan is not running")
		expect(lines).toEqual(["steered explore", "steer rejected — Plan is not running"])
	})
})
