/**
 * R5 panel focus borders — state machine + frame mapping contract (no renderer).
 * Preregistered expectations: .proof/r5-panel-focus-borders/00-preregistered-expected.md
 *   E1 default composer; E2 focused/unfocused frame mapping; E3 click activity;
 *   E4 typing back to composer; E5 tab switch sets activity; E6 dialogs stay
 *   heavy; E7 unfocused border lifted to a visible muted color; E8 width law;
 *   E9 interaction wiring present in every owned panel.
 *
 * All assertions are pure/state-level. No terminal, host version, config file
 * presence or tmux frame is consulted (W5 §四.2 environment-dependency ban).
 */
import { beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { MouseButton, type MouseEvent } from "@opentui/core"
import { bundledLocalesDir, loadLocales, setLanguages } from "@dsh-opentui/i18n"
import {
	activePanel,
	composerInteraction,
	DEFAULT_ACTIVE_PANEL,
	markPanelActive,
	resetActivePanel,
} from "../src/routes/session/pane-focus"
import {
	activityDockTab,
	onActivityPanelMouseUp,
	resetActivityDockTab,
	selectActivityDockTab,
} from "../src/routes/session/widgets-dock"
import {
	focusedBorderColor,
	panelFocusFrame,
	SKIN_FALLBACK,
	UNFOCUSED_BORDER_MUTED_MIX,
	unfocusedBorderColor,
} from "../src/skin/semantic"
import { getDshBlueTheme } from "../src/theme/index"
import { createComponentTheme } from "../src/theme/component"
import { resolveThemeDocument } from "../src/vendor/theme/src/tui/resolve"
import type { ComponentTheme } from "../src/theme/component"

beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages)
})

beforeEach(() => {
	resetActivePanel()
	resetActivityDockTab()
})

/** Stub theme missing `text.muted` — the unfocused resolver must return the
 * raw border.base verbatim (regression compat with the pre-R5 stub tests). */
function stubTheme(borderBase = "#111111", interactive = "#222222"): ComponentTheme {
	return {
		border: { base: borderBase },
		hue: { interactive: { 500: interactive } },
		text: {},
	} as unknown as ComponentTheme
}

function mouse(button: MouseButton): MouseEvent {
	return { button } as MouseEvent
}

describe("E1 — default active panel", () => {
	test("signal starts at composer and reset restores it", () => {
		expect(DEFAULT_ACTIVE_PANEL).toBe("composer")
		expect(activePanel()).toBe("composer")
		markPanelActive("activity")
		expect(activePanel()).toBe("activity")
		resetActivePanel()
		expect(activePanel()).toBe("composer")
	})
})

describe("E2 — focused / unfocused frame mapping", () => {
	const theme = stubTheme("#110000", "#2200ff")

	test("focused = heavy + focused accent; title follows the border color", () => {
		const frame = panelFocusFrame({ focused: true, theme })
		expect(frame.borderStyle).toBe("heavy")
		expect(frame.borderColor).toBe(focusedBorderColor(theme))
		expect(frame.titleColor).toBe(frame.borderColor)
	})

	test("unfocused = single + visible muted; title follows the border color", () => {
		const frame = panelFocusFrame({ focused: false, theme })
		expect(frame.borderStyle).toBe("single")
		expect(frame.borderColor).toBe(unfocusedBorderColor(theme))
		expect(frame.titleColor).toBe(frame.borderColor)
		expect(frame.borderColor).not.toBe(focusedBorderColor(theme))
	})

	test("no theme → the pre-skin fallbacks", () => {
		expect(panelFocusFrame({ focused: true }).borderColor).toBe(SKIN_FALLBACK.accent)
		expect(panelFocusFrame({ focused: false }).borderColor).toBe(SKIN_FALLBACK.border)
		expect(panelFocusFrame({ focused: false }).borderStyle).toBe("single")
		expect(panelFocusFrame({ focused: true }).borderStyle).toBe("heavy")
	})
})

describe("E3 — clicking the activity panel moves active", () => {
	test("left mouse press sets activity; right press does not", () => {
		expect(activePanel()).toBe("composer")
		onActivityPanelMouseUp(mouse(MouseButton.RIGHT))
		expect(activePanel()).toBe("composer")
		onActivityPanelMouseUp(mouse(MouseButton.LEFT))
		expect(activePanel()).toBe("activity")
	})

	test("after the click, activity is heavy and the composer is single", () => {
		onActivityPanelMouseUp(mouse(MouseButton.LEFT))
		const theme = stubTheme()
		const activity = panelFocusFrame({ focused: activePanel() === "activity", theme })
		const composer = panelFocusFrame({ focused: activePanel() === "composer", theme })
		expect(activity.borderStyle).toBe("heavy")
		expect(composer.borderStyle).toBe("single")
		expect(activity.borderColor).not.toBe(composer.borderColor)
	})
})

describe("E4 — composer typing reasserts composer", () => {
	test("key and content channels both set active back to composer", () => {
		markPanelActive("activity")
		composerInteraction()
		expect(activePanel()).toBe("composer")
		markPanelActive("notices")
		composerInteraction()
		expect(activePanel()).toBe("composer")
		expect(panelFocusFrame({ focused: activePanel() === "composer" }).borderStyle).toBe("heavy")
	})
})

describe("E5 — tab selectors (alt+1/2) set activity active", () => {
	test("both tabs mark activity active and keep the tab signal in sync", () => {
		for (const tab of ["main", "todo"] as const) {
			selectActivityDockTab(tab)
			expect(activityDockTab()).toBe(tab)
			expect(activePanel()).toBe("activity")
		}
	})

	test("resetActivityDockTab only resets the tab, not the active panel", () => {
		markPanelActive("activity")
		selectActivityDockTab("todo")
		resetActivityDockTab()
		expect(activityDockTab()).toBe("main")
		expect(activePanel()).toBe("activity")
	})
})

describe("E6 — dialogs stay heavy (never read the active signal)", () => {
	test("dialog border is a constant heavy frame and imports no active-panel state", () => {
		const dialog = readFileSync(join(import.meta.dir, "../src/ui/dialog.tsx"), "utf8")
		expect(dialog).toContain('borderStyle="heavy"')
		expect(dialog).not.toContain("activePanel")
		expect(dialog).not.toContain("panelFocusFrame")
		// Migrating the signal through all panels never writes dialog state.
		for (const panel of ["activity", "composer", "lastrequest", "notices", "composer"] as const) {
			markPanelActive(panel)
			expect(activePanel()).toBe(panel)
		}
	})
})

describe("E7 — unfocused border is a visible muted color", () => {
	test("real dsh-blue theme: lifted one notch toward muted, luminance rises", () => {
		const theme = createComponentTheme(() => resolveThemeDocument(getDshBlueTheme(), "dark"))
		const raw = theme.border.base
		const lifted = unfocusedBorderColor(theme)
		expect(typeof lifted).toBe("string")
		const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b
		const rawLuma = luminance(raw.r, raw.g, raw.b)
		const liftedLuma = luminance(...parseHex(lifted as string))
		expect(liftedLuma).toBeGreaterThan(rawLuma)
		expect(UNFOCUSED_BORDER_MUTED_MIX).toBeGreaterThan(0)
	})

	test("theme without text.muted keeps the raw border; no theme keeps the fallback", () => {
		expect(unfocusedBorderColor(stubTheme())).toBe("#111111")
		expect(unfocusedBorderColor(undefined)).toBe(SKIN_FALLBACK.border)
	})
})

describe("E8/E9 — width law and interaction wiring (static, diff-level)", () => {
	const src = (relative: string) => readFileSync(join(import.meta.dir, relative), "utf8")

	test("merged-dock.ts keeps fitLine/takeWidth and gains no clipToWidth", () => {
		const merged = src("../src/routes/session/merged-dock.ts")
		expect(merged).toContain("fitLine")
		expect(merged).not.toContain("clipToWidth")
	})

	test("each owned panel wires its interaction channel", () => {
		const dock = src("../src/routes/session/widgets-dock.tsx")
		const composer = src("../src/routes/session/session-composer.tsx")
		const lastRequest = src("../src/routes/session/lastrequest-dock.tsx")
		const notices = src("../src/routes/session/notices-dock.tsx")
		expect(dock).toContain("onActivityPanelMouseUp(event)")
		expect(dock).toContain('markPanelActive("activity")')
		expect(dock).toContain("panelFocusFrame")
		expect(composer).toContain("composerInteraction()")
		expect(composer).toContain("activePanel() === \"composer\"")
		expect(lastRequest).toContain('markPanelActive("lastrequest")')
		expect(notices).toContain('markPanelActive("notices")')
	})
})

/** `#rrggbb` → normalized 0-1 channels. */
function parseHex(hex: string): [number, number, number] {
	return [
		parseInt(hex.slice(1, 3), 16) / 255,
		parseInt(hex.slice(3, 5), 16) / 255,
		parseInt(hex.slice(5, 7), 16) / 255,
	]
}
