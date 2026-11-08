/**
 * Skin code-block forms on the REAL render path (@opentui 0.8.1 test
 * renderer + the module's own skin logic — no pure-function mocks).
 *
 * Root cause this pins (skin-codeblock fix): markdown's
 * `context.defaultRender()` for a `code` token returns a CodeRenderable
 * (extends TextBufferRenderable — no border support), so the original
 * in-place border flip bailed on its "only bordered boxes" guard and every
 * real code block stayed bare. The skin now rides a wrapper box:
 *   - streaming: heavy left rule `┃` on the code's own rows (NO extra rows);
 *   - final: single frame with the language in the top border.
 *
 * Layers, mirroring transcript-markdown-table.test.ts:
 *  - behavior: MarkdownRenderable + the module's applyCodeBlockSkinForTest
 *    with a live renderer paints both forms; a bare control (no skin) paints
 *    neither — the assertions have teeth;
 *  - streaming updates: content increments refresh the wrapped code rows in
 *    place (no lost rows between increments);
 *  - source shape: transcript.tsx assistantRow wires the wrapper into the
 *    markdown renderNode with the live renderer ctx.
 */
import { describe, expect, test } from "bun:test"
import { MarkdownRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { applyCodeBlockSkinForTest } from "../src/routes/session/transcript"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const src = (file: string) => readFileSync(join(import.meta.dir, "..", file), "utf8")

const WIDTH = 60
const HEIGHT = 12
const OPEN_CODE = "```ts\nconst a = 1\nconst b = 2" // streaming: unclosed fence
const CLOSED_CODE = "```ts\nconst a = 1\n```" // final: closed fence

/** Paint markdown with the module's skin applied to code tokens. */
async function paint(content: string, isFinal: boolean) {
	await using setup = await createTestRenderer({ width: WIDTH, height: HEIGHT, useMouse: false })
	const { renderer, flush } = setup
	const md = new MarkdownRenderable(renderer, {
		width: WIDTH,
		content,
		internalBlockMode: "top-level",
		renderNode: (token: any, context: any) => {
			if (token?.type !== "code") return undefined
			const defaulted = context.defaultRender()
			return applyCodeBlockSkinForTest(
				defaulted,
				isFinal,
				typeof token.lang === "string" ? token.lang : undefined,
				renderer,
			)
		},
	})
	renderer.root.add(md)
	await flush()
	return setup.captureCharFrame()
}

describe("skin code-block forms (real render path, @opentui 0.8.1)", () => {
	test("streaming: heavy left rule ┃ on the code rows, no frame glyphs", async () => {
		const frame = await paint(OPEN_CODE, false)
		expect(frame).toContain("┃")
		expect(frame).toContain("const a = 1")
		expect(frame).toContain("const b = 2")
		expect(frame).not.toContain("┌")
		expect(frame).not.toContain("└")
	})

	test("final: single frame with the language in the top border", async () => {
		const frame = await paint(CLOSED_CODE, true)
		expect(frame).toMatch(/┌─ ts ─/)
		expect(frame).toContain("│")
		expect(frame).toContain("└")
		expect(frame).toContain("const a = 1")
		expect(frame).not.toContain("┃")
	})

	test("bare control — no skin: no rule, no frame (assertions have teeth)", async () => {
		await using setup = await createTestRenderer({ width: WIDTH, height: HEIGHT, useMouse: false })
		const { renderer, flush } = setup
		const md = new MarkdownRenderable(renderer, {
			width: WIDTH,
			content: CLOSED_CODE,
			internalBlockMode: "top-level",
		})
		renderer.root.add(md)
		await flush()
		const frame = setup.captureCharFrame()
		expect(frame).not.toContain("┃")
		expect(frame).not.toContain("┌")
	})

	test("streaming increments keep the wrapper stable (no renderNode churn)", async () => {
		await using setup = await createTestRenderer({ width: WIDTH, height: HEIGHT, useMouse: false })
		const { renderer, flush } = setup
		let codeCalls = 0
		const md = new MarkdownRenderable(renderer, {
			width: WIDTH,
			content: OPEN_CODE,
			internalBlockMode: "top-level",
			renderNode: (token: any, context: any) => {
				if (token?.type !== "code") return undefined
				codeCalls++
				const defaulted = context.defaultRender()
				return applyCodeBlockSkinForTest(defaulted, false, typeof token.lang === "string" ? token.lang : undefined, renderer)
			},
		})
		renderer.root.add(md)
		await flush()
		expect(setup.captureCharFrame()).toContain("┃")
		// Core shields a stable block via token identity: content growth that
		// keeps the block intact does not re-enter renderNode — the wrapper box
		// is NOT rebuilt per increment (contract §2.6, harness cadence).
		const before = codeCalls
		md.content = `${OPEN_CODE}\nconst c = 3`
		await flush()
		expect(codeCalls).toBe(before)
		expect(setup.captureCharFrame()).toContain("┃")
	})
})

describe("skin code-block source shape (transcript.tsx wires the live path)", () => {
	test("assistantRow passes the renderer ctx into the skin wrapper", () => {
		const source = src("src/routes/session/transcript.tsx")
		const start = source.indexOf("renderNode={skinRenderNode(", source.indexOf("const assistantRow"))
		expect(start).toBeGreaterThan(0)
		const wiring = source.slice(start, source.indexOf("}", start))
		expect(wiring).toContain("renderer")
		expect(wiring).toContain("row.final")
	})
})
