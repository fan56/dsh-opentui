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
	test("HUD merge: no StatusBar mount; HintsLine busy is a stable getter function", () => {
		// The busy comet moved into the last hints row. v2-entry must not mount
		// StatusBar in the transcript status slot, and it must pass busy() as a
		// STABLE FUNCTION value — a `get busy()` accessor is recast to a mount-time
		// snapshot before the component body runs (the WidgetsDock turnActive trap).
		expect(source).not.toMatch(/createComponent\(StatusBar,/)
		expect(source).not.toMatch(/<StatusBar\b/)
		expect(source).toMatch(/createComponent\(HintsLine,\s*\{/)
		expect(source).toMatch(/busy:\s*\(\)\s*=>\s*busy\(\)/)
		expect(source).not.toMatch(/get busy\(\)\s*\{\s*return busy\(\)/)
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

describe("v2-entry pickOne focus-current wiring (live-language picker regression, 2026-11-15)", () => {
	test("pickOne forwards the extras focus-current arm to DialogSelect", () => {
		// The hardcoded `focusCurrent: false` kept the picker SELECTION on row 0
		// while the current row only carried the `●` marker — ↑ from the marked
		// row wrapped away and Enter resolved the wrong language. The arm is
		// opt-in per call (the /theme bare-Enter row-0 contract stays put).
		expect(source).toMatch(/focusCurrent:\s*extras\?\.focusCurrent === true/)
		expect(source).not.toMatch(/focusCurrent:\s*false,/)
	})
})

describe("v2-entry reconnect layer (RM-2b V3: dead-state R must reach recovery)", () => {
	test("reconnect layer is global-mode + canRecover-gated, not pageOwns-only", () => {
		// A terminal "已失效" card stays on the modal dialog stack after bridge
		// death. A base-mode `pageOwns()` layer is gated out by that modal; the
		// reconnect layer must dispatch in modal mode and open on canRecover().
		expect(source).toMatch(/mode:\s*"global",\s*\n\s*enabled:\s*\(\)\s*=>\s*pageOwns\(\)\s*\|\|\s*recovery\.canRecover\(\)/)
		expect(source).not.toMatch(/enabled:\s*\(\)\s*=>\s*pageOwns\(\),\s*\n\s*commands:\s*\[recovery\.reconnectCommand\(\)\]/)
		expect(source).toMatch(/commands:\s*\[recovery\.reconnectCommand\(\)\]/)
	})

	test("registerTurnOverlays gets a localized deadReason for bridge.dead", () => {
		expect(source).toMatch(/registerTurnOverlays\(seam,\s*overlays,\s*\{/)
		expect(source).toMatch(/deadReason:/)
		expect(source).toMatch(/overlay\.ask\.invalidated\.disconnected/)
	})
})
