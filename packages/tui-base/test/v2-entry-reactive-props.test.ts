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
