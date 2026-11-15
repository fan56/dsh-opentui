/**
 * Reverse canary for the text-leak audit (verify/text-leak-audit.mjs): the
 * 0.16.0 incident shape reproduced at unit scale. A REAL component is
 * mounted through @opentui/solid testRender with an EMPTY locale registry —
 * t()'s fail-open chain (active → en → THE KEY ITSELF) paints the raw key
 * name — and the audit's OWN scan core (verify/text-leak-core.mjs, imported
 * directly, not a copy) must hit it against the real dictionaries.
 *
 * Two-sided guard:
 *  - if the registry boots when it should be empty, the key never paints and
 *    the first assertion fails (the leak scenario stopped being reproducible);
 *  - if the scan logic regresses (shape regex, dictionary load, membership
 *    gate), the second assertion fails (the audit went blind).
 *
 * Note: testRender markers classify this file into the ft tier (real
 * renderer), per docs/testing.md — it is a unit-scale canary in placement
 * only.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { createComponent, testRender } from "@opentui/solid"
import type { CapturedFrame, CapturedSpan } from "@opentui/core"
import { setLanguages } from "@dsh-opentui/i18n"
import { resolve } from "node:path"
import { findKeyLeaks, loadDictionary } from "../../../verify/text-leak-core.mjs"
import { WidgetsDock } from "../src/routes/session/widgets-dock"
import type { SeamRow } from "../src/routes/session/seam-rows"

// The incident key SHAPE: dotted fail-open paint (`overlay.widgets.frameTitle`
// was the 0.16.0 installed-package incident; which exact key paints depends on
// the dock state — the canary pins the shape + membership, not one string).
// Deliberately a local, simple regex: leg 1 must not depend on the scan core
// it is about to test.
const KEYISH = /[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_-]+)+/g

// The gate dictionary loads straight from the locale sources (audit parity:
// NOT through the app's registry — that is exactly the fail-open chain under
// test). Repo-root relative: packages/tui-base/test → <repo>/packages/i18n.
const LOCALES_DIR = resolve(import.meta.dir, "../../i18n/locales")
const { keySet } = loadDictionary(LOCALES_DIR)

// Empty registry: the fail-open chain must resolve t() to the key itself.
beforeAll(() => setLanguages(new Map()))
afterAll(() => setLanguages(new Map()))

function frameText(frame: CapturedFrame): string {
	return frame.lines.flatMap((line: { spans: CapturedSpan[] }) => line.spans.map((span: CapturedSpan) => span.text)).join("\n")
}

describe("text-leak canary (audit logic must stay able to catch the leak shape)", () => {
	test("empty registry + real WidgetsDock paints the raw key and the audit scan hits it", async () => {
		const rows: SeamRow[] = [
			{
				key: "reasoning:canary-1",
				kind: "reasoning",
				text: "alpha\nbeta",
				final: true,
				startedAt: Date.now() - 1500,
				elapsedSec: 1.5,
			},
		]
		const setup = await testRender(() => createComponent(WidgetsDock, { rows }), {
			width: 72,
			height: 60,
			useMouse: false,
		})
		let painted: string
		try {
			await setup.renderOnce()
			painted = frameText(setup.captureSpans())
		} finally {
			await setup.dispose()
		}

		// Leg 1 — the leak is real: the fail-open chain painted raw key names
		// (dotted tokens that ARE dictionary keys — the audit's leak shape).
		const paintedKeys = [...new Set([...painted.matchAll(KEYISH)].map((m) => m[0]).filter((k) => keySet.has(k)))]
		expect(paintedKeys.length).toBeGreaterThan(0)

		// Leg 2 — the audit is not blind: the SAME scan the audit gates with
		// flags the painted frame against the real dictionaries, and finds at
		// least everything leg 1 found.
		const leaks = findKeyLeaks(painted, keySet)
		expect(leaks.length).toBeGreaterThan(0)
		for (const key of paintedKeys) expect(leaks).toContain(key)
	})
})
