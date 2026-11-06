/**
 * Batch V5 regression guard — the plugin entry's reactive-prop law.
 *
 * host-entry-v2.tsx builds the page root with spread(root, { get children() }).
 * Any signal read EAGERLY in a sibling's props object (busy(), segments(),
 * now()) is tracked by that children getter, so every 1s clock tick re-ran it
 * and remounted the whole subtree. The client entry was fixed in batch 10d
 * (tui-base/test/v2-entry-reactive-props.test.ts); the plugin entry kept the
 * eager reads, and in the e2e container (plugin mode) it surfaced as the
 * slash-palette anomaly: SessionComposer remounted ~2x/s (probed: 10 mounts
 * per 5s idle), each mount a fresh empty textarea, so "/" then "h" left the
 * buffer "h" — the palette closed, Enter submitted "", and only text arriving
 * in ONE write (one tick) survived.
 *
 * The entry boots a real renderer inside the dsh host, so this guards the
 * source shape (the same technique as the 10d guard).
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(import.meta.dir, "..", "src", "host-entry-v2.tsx"), "utf8")

describe("host-entry-v2 reactive-prop law (plugin entry)", () => {
	test("StatusBar phase rides a getter, not an eager busy() read", () => {
		expect(source).not.toMatch(/createComponent\(StatusBar,\s*\{\s*phase:\s*busy\(\)/)
		expect(source).toMatch(/createComponent\(StatusBar,\s*\{\s*get phase\(\)\s*\{\s*return busy\(\)/)
	})

	test("PowerlineFooter left/right ride getters, not eager segments()/now() reads", () => {
		expect(source).not.toMatch(/left:\s*segments\(\)/)
		expect(source).not.toMatch(/right:\s*clock\(now\(\)\)/)
		expect(source).toMatch(/get left\(\)\s*\{\s*return segments\(\)/)
		expect(source).toMatch(/get right\(\)\s*\{\s*return clock\(now\(\)\)/)
	})

	test("the dist-host bundle carries the getter shape too (no stale eager build)", () => {
		const bundle = readFileSync(join(import.meta.dir, "..", "dist-host", "index.js"), "utf8")
		expect(bundle).not.toMatch(/left:\s*segments\(\)/)
		expect(bundle).not.toMatch(/right:\s*clock\(now\(\)\)/)
		expect(bundle).toMatch(/get right\(\)\s*\{\s*return clock\(now\(\)\)/)
	})
})
