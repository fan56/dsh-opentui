/**
 * Batch 10d regression guard: the v2 entry's root `get children()` getter
 * must not read signals eagerly in sibling props. An eager `busy()` /
 * `segments()` / `now()` read there is tracked by the getter, so every 1s
 * clock tick remounted the whole subtree (live: ~70 SessionComposer mounts
 * per turn) and the composer owning the in-flight turn was disposed before
 * its busy=false — "Writing…" froze after a settled turn. The entry file is
 * ts-nocheck and boots a real renderer, so this guards the source shape.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(import.meta.dir, "..", "examples", "v2-entry.tsx"), "utf8")
const sessionSource = readFileSync(join(import.meta.dir, "..", "examples", "session.tsx"), "utf8")
const helloSource = readFileSync(join(import.meta.dir, "..", "examples", "hello.tsx"), "utf8")

describe("v2-entry reactive-prop law", () => {
	test("StatusBar phase rides a getter, not an eager busy() read", () => {
		expect(source).not.toMatch(/createComponent\(StatusBar,\s*\{\s*phase:\s*busy\(\)/)
		expect(source).toMatch(/createComponent\(StatusBar,\s*\{\s*get phase\(\)/)
	})

		test("PowerlineFooter left/right ride getters, not eager segments()/now() reads", () => {
			expect(source).not.toMatch(/left:\s*segments\(\)/)
			expect(source).not.toMatch(/right:\s*clock\(now\(\)\)/)
			expect(source).toMatch(/get left\(\)\s*\{\s*return segments\(\)/)
			expect(source).toMatch(/get right\(\)\s*\{\s*return clock\(now\(\)\)/)
		})
})

describe("examples reactive-prop law (batch 10e, the same family)", () => {
	test("session.tsx StatusBar phase rides a getter, not an eager busy() read", () => {
		expect(sessionSource).not.toMatch(/<StatusBar\s+phase=\{busy\(\)/)
		expect(sessionSource).toMatch(/createComponent\(StatusBar,\s*\{\s*get phase\(\)/)
	})

	test("session.tsx PowerlineFooter left/right ride getters, not eager segments()/now() reads", () => {
		expect(sessionSource).not.toMatch(/<PowerlineFooter\s/)
		expect(sessionSource).not.toMatch(/left=\{segments\(\)\}/)
		expect(sessionSource).not.toMatch(/right=\{clock\(now\(\)\)\}/)
		expect(sessionSource).toMatch(/createComponent\(PowerlineFooter,\s*\{\s*get left\(\)/)
		expect(sessionSource).toMatch(/get right\(\)\s*\{\s*return clock\(now\(\)\)/)
	})

	test("hello.tsx For each rides a getter, not an eager rows() read", () => {
		expect(helloSource).not.toMatch(/<For\s+each=\{rows\(\)\}/)
		expect(helloSource).toMatch(/createComponent\(For,\s*\{\s*get each\(\)/)
	})
})
