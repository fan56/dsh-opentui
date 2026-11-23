/**
 * R6: slash-command output (SeamRow kind "system") renders as info-colored
 * PLAIN TEXT, not markdown. Two layers:
 *  - source shape: transcript.tsx's color table + rowView dispatch (the
 *    system case uses `<text fg={color.system()}>` and never `<markdown>`),
 *    and the exhaustive rowSearchText switch handles the new kind;
 *  - behavior: pinned @opentui 0.8.1 test renderer proves a `<text>` with
 *    the info fg paints `#` / `*` literally and carries the color — the
 *    red control would be a markdown renderable (which interprets them).
 */
import { describe, expect, test } from "bun:test"
import { RGBA, TextRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const src = (file: string) => readFileSync(join(import.meta.dir, "..", file), "utf8")

describe("R6 system rows — source shape", () => {
	test("transcript color table reads text.feedback.info.base for system", () => {
		const source = src("src/routes/session/transcript.tsx")
		expect(source).toContain('system: () => theme?.text.feedback.info.base ?? "#565f89"')
	})

	test("rowView dispatches system through <text> with the system fg, never <markdown>", () => {
		const source = src("src/routes/session/transcript.tsx")
		const start = source.indexOf('case "system":', source.indexOf("const rowView"))
		expect(start).toBeGreaterThan(0)
		const block = source.slice(start, source.indexOf('case "ask":', start))
		expect(block).toContain("<text fg={color.system()}>{row.text}</text>")
		expect(block).not.toContain("<markdown")
	})

	test("visibleRows blacklist still excludes only tool/reasoning/subagents (system passes)", () => {
		const source = src("src/routes/session/transcript.tsx")
		const start = source.indexOf("const visibleRows")
		const end = source.indexOf("const rowView", start)
		const filter = source.slice(start, end)
		for (const kind of ["tool", "reasoning", "subagents"]) {
			expect(filter).toContain(`row.kind !== "${kind}"`)
		}
		expect(filter).not.toContain('row.kind !== "system"')
	})

	test("search-overlay's exhaustive rowSearchText switch handles system", () => {
		const source = src("src/routes/session/search-overlay.tsx")
		const start = source.indexOf("export function rowSearchText")
		const block = source.slice(start, source.indexOf("export function findMatchRowIndices", start))
		expect(block).toMatch(/case "system":\s*\n\s*return row\.text/)
	})
})

describe("R6 system rows — plain-text behavior (@opentui 0.8.1)", () => {
	test("a text renderable paints # and * literally and carries the info fg", async () => {
		const info = "#7aa2f7"
		await using setup = await createTestRenderer({ width: 40, height: 6, useMouse: false })
		const { renderer, flush } = setup
		const text = new TextRenderable(renderer, {
			content: "# header\n* bullet",
			fg: RGBA.fromHex(info),
			width: "auto",
		})
		renderer.root.add(text)
		await flush()
		const frame = setup.captureSpans()
		const painted = frame.lines.map((line) => line.spans.map((span) => span.text).join("")).join("\n")
		expect(painted).toContain("# header")
		expect(painted).toContain("* bullet")
		const span = frame.lines.flatMap((line) => line.spans).find((s) => s.text.includes("header"))
		expect(span).toBeDefined()
		expect(span!.fg.toInts().slice(0, 3)).toEqual(RGBA.fromHex(info).toInts().slice(0, 3))
	})
})
