/**
 * panel-kit-wiring.test.tsx — proves the @dsh-opentui/panel-kit resolution
 * chain from tui-base (bare specifier → tsconfig paths → workspace source)
 * AND that a minimal Panel renders through PanelKitProvider.
 *
 * Deliberately renderer-only and theme-agnostic: no tui-base provider tree,
 * no keymap. The entry-level wiring (PanelKitHost) is exercised by the real
 * boot, not here.
 */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import {
	FALLBACK_THEME,
	Panel,
	PanelKitProvider,
	STATIC_MOTION,
	fadeTheme,
} from "@dsh-opentui/panel-kit"

describe("panel-kit wiring", () => {
	test("the bare specifier resolves to the workspace source", () => {
		// The module exports exist only if the specifier resolved at all; a
		// broken link fails at import time, before this assertion.
		expect(typeof Panel).toBe("function")
		expect(typeof PanelKitProvider).toBe("function")
		expect(typeof fadeTheme).toBe("function")
		expect(fadeTheme(FALLBACK_THEME, 1)).toBe(FALLBACK_THEME)
	})

	test("a minimal Panel renders its content through the provider", async () => {
		const renderer = await testRender(
			() => (
				<PanelKitProvider theme={FALLBACK_THEME} motion={STATIC_MOTION}>
					<Panel title="Smoke Panel" height={7} fadeIn={false}>
						<text>panel-kit wiring ok</text>
					</Panel>
				</PanelKitProvider>
			),
			{ width: 80, height: 24 },
		)
		try {
			await renderer.renderOnce()
			const frame = renderer.captureCharFrame()
			expect(frame).toContain("Smoke Panel")
			expect(frame).toContain("panel-kit wiring ok")
		} finally {
			await renderer.dispose()
		}
	})
})
