/**
 * V4 markdown audit: the seam transcript's assistant rows must render
 * markdown TABLES with grid borders.
 *
 * Gap found on the real client (scratch DSH_HOME + mock-llm markdown phase,
 * 2026-11-08): transcript.tsx `assistantRow` rendered `<markdown>` without
 * `tableOptions`, and under `internalBlockMode="top-level"` @opentui 0.8.1
 * resolves an unstyled table to borderless "columns" (resolveTableStyle:
 * `this._internalBlockMode === "top-level" ? "columns" : "grid"`). The
 * vendored TextPart (message-parts.tsx) passes
 * `{ style: "grid", cellPaddingX: 1 }` — the transcript must match.
 *
 * Two layers, mirroring transcript-layout.test.ts:
 *  - behavior (pinned 0.8.1 test renderer): a top-level markdown with the
 *    TextPart tableOptions paints box-drawing borders; the red control
 *    (same table, no tableOptions) paints none — the assertion has teeth;
 *  - source shape: transcript.tsx assistantRow carries the grid tableOptions.
 */
import { describe, expect, test } from "bun:test"
import { MarkdownRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const src = (file: string) => readFileSync(join(import.meta.dir, "..", file), "utf8")

const WIDTH = 60
const HEIGHT = 20

const TABLE = ["| A | B |", "| - | - |", "| a1 | b1 |", "| a2 | b2 |", ""].join("\n")

/** Paint a top-level markdown block with optional tableOptions; return frame. */
async function paintTable(tableOptions: Record<string, unknown> | undefined) {
	await using setup = await createTestRenderer({ width: WIDTH, height: HEIGHT, useMouse: false })
	const { renderer, flush } = setup
	const md = new MarkdownRenderable(renderer, {
		width: WIDTH,
		content: TABLE,
		internalBlockMode: "top-level",
		...(tableOptions ? { tableOptions } : {}),
	})
	renderer.root.add(md)
	await flush()
	return setup.captureCharFrame()
}

describe("transcript markdown tables (@opentui 0.8.1, top-level blocks)", () => {
	test("grid tableOptions paint box-drawing borders", async () => {
		const frame = await paintTable({ style: "grid", cellPaddingX: 1 })
		expect(frame).toContain("│")
		expect(frame).toContain("┌")
		expect(frame).toMatch(/A/)
	})

	test("red control — no tableOptions: borderless columns, no box glyphs", async () => {
		const frame = await paintTable(undefined)
		expect(frame).not.toContain("│")
		expect(frame).not.toContain("┌")
	})
})

describe("transcript markdown source shape (transcript.tsx carries the fix)", () => {
	test("assistantRow markdown passes the TextPart grid tableOptions", () => {
		const source = src("src/routes/session/transcript.tsx")
		// the assistantRow markdown element itself (between its tag open and close)
		const start = source.indexOf("<markdown", source.indexOf("const assistantRow"))
		expect(start).toBeGreaterThan(0)
		const element = source.slice(start, source.indexOf("/>", start))
		expect(element).toMatch(/tableOptions=\{\{ style: "grid", cellPaddingX: 1 \}\}/)
	})
})
