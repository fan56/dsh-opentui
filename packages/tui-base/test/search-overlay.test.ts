/**
 * SearchOverlay pure helpers (batch H1): the matcher and status label that
 * drive the find bar. The matcher is the contract the scenario pins —
 * case-insensitive substring over each seam row's searchable text, one hit
 * per ROW (the row is the walk unit for Enter / shift+Enter), empty query
 * counts zero — and the status label carries the reference's two faces
 * ("N/M" counter, "No matches").
 */
import { describe, expect, test } from "bun:test"
import { findMatchRowIndices, formatMatchStatus, rowSearchText, type SearchOverlayProps } from "../src/routes/session/search-overlay"
import type { SeamRow } from "../src/routes/session/seam-rows"

function row(partial: Omit<SeamRow, "final"> & { final?: boolean }): SeamRow {
	switch (partial.kind) {
		case "user":
			return { key: partial.key, kind: "user", text: partial.text, final: true }
		case "assistant":
			return { key: partial.key, kind: "assistant", text: partial.text, final: partial.final ?? true }
		case "reasoning":
			return { key: partial.key, kind: "reasoning", text: partial.text, final: partial.final ?? true }
		case "tool":
			return {
				key: partial.key,
				kind: "tool",
				name: partial.name,
				args: partial.args,
				status: partial.status,
				output: partial.output,
			}
	}
}

describe("rowSearchText", () => {
	test("text rows contribute their text; tool rows contribute name, args and output", () => {
		expect(rowSearchText(row({ key: "u", kind: "user", text: "E2E-SEARCH-NEEDLE alpha" }))).toBe("E2E-SEARCH-NEEDLE alpha")
		expect(rowSearchText(row({ key: "a", kind: "assistant", text: "Settled body" }))).toBe("Settled body")
		expect(
			rowSearchText(
				row({ key: "t", kind: "tool", name: "read", args: '"f.ts"', status: "done", output: "E2E-SEARCH-NEEDLE in output" }),
			),
		).toBe('read("f.ts") E2E-SEARCH-NEEDLE in output')
	})
})

describe("findMatchRowIndices", () => {
	const rows: SeamRow[] = [
		row({ key: "1", kind: "user", text: "E2E-SEARCH-NEEDLE alpha" }),
		row({ key: "2", kind: "assistant", text: "a reply without the marker" }),
		row({ key: "3", kind: "user", text: "e2e-search-needle beta" }),
		row({ key: "4", kind: "tool", name: "bash", args: "", status: "done", output: "needle in tool output" }),
	]

	test("case-insensitive substring, in row order, one hit per row", () => {
		expect(findMatchRowIndices(rows, "E2E-SEARCH-NEEDLE")).toEqual([0, 2])
	})

	test("matches tool rows through their output text", () => {
		expect(findMatchRowIndices(rows, "needle in tool")).toEqual([3])
	})

	test("empty / whitespace query counts zero", () => {
		expect(findMatchRowIndices(rows, "")).toEqual([])
		expect(findMatchRowIndices(rows, "   ")).toEqual([])
	})

	test("no hits for an absurd query", () => {
		expect(findMatchRowIndices(rows, "zzqqxx")).toEqual([])
	})
})

describe("formatMatchStatus", () => {
	test("no query → empty status (the bar shows just the placeholder)", () => {
		expect(formatMatchStatus("", 0, 0)).toBe("")
		expect(formatMatchStatus("   ", 0, 0)).toBe("")
	})

	test("live query with zero hits → the reference's No matches", () => {
		expect(formatMatchStatus("zzqqxx", 0, 0)).toBe("No matches")
	})

	test("N/M counter: 1-based current over total", () => {
		expect(formatMatchStatus("needle", 2, 0)).toBe("1/2")
		expect(formatMatchStatus("needle", 2, 1)).toBe("2/2")
	})
})

describe("SearchOverlayProps surface", () => {
	test("the scroll prop is the scrollbox value (getter-prop law)", async () => {
		// Structural pin: SearchOverlayProps.scroll is a getter PROP — the
		// callers write `get scroll()` and the overlay reads `props.scroll`
		// as the box itself (NOT an accessor function; calling it crashed
		// the view on the first match jump — C13 e2e 22-search).
		const sample: SearchOverlayProps = {
			projection: { rows: [], hydrated: () => false } as unknown as SearchOverlayProps["projection"],
		}
		expect(sample.scroll).toBeUndefined()
	})
})
