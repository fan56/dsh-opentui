import { describe, expect, test } from "bun:test"
import {
	foldSubagentMarkerViews,
	subagentHardStopGlyph,
	subagentMarkerSuffix,
	subagentMarkersFor,
} from "../src/routes/session/subagent-markers"

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
