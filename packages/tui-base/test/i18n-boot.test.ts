/**
 * i18n boot chain (design c5-i18n §3/§4 T2): the language is resolved from
 * the persisted config at boot — `applyI18nConfig(seam.configLoad?.())` in
 * v2-entry, `applyHintsConfig` boot-replay parity (examples/v2-entry.tsx:1319
 * shape). Live-switch amendment: the boot seeds the language SIGNAL;
 * `setLanguage(id)` flips it afterwards without a restart.
 *
 * The boot chain replays BOTH systems from the same config keys:
 * - the hints-bar persistence signal (`hintsLocale`, /hints lang — since the
 *   T8 fold it is the stored-language mirror only; the labels ride the
 *   registry below);
 * - the unified i18n registry (`t()`, zh-CN alias folding, ja/ko → en
 *   degradation — ja/ko have no bundled locale file by contract §1).
 */
import { describe, expect, test } from "bun:test"
import { activeLanguage, applyI18nConfig, t } from "@dsh-opentui/i18n"
import { t as tReexported } from "../src/i18n"
import { applyHintsConfig, hintsLocale, setHintsLocale } from "../src/routes/session/hints-line"

describe("i18n boot chain (v2-entry applyI18nConfig, applyHintsConfig parity)", () => {
	test("boot replay fixes the language from the persisted hintsLocale; t() and the hints signal both see it", () => {
		// boot: v2-entry replays the hints selection, then the i18n registry
		applyHintsConfig({ hintsLocale: "zh-CN" })
		applyI18nConfig({ hintsLocale: "zh-CN" })

		expect(activeLanguage()).toBe("zh-CN")
		expect(hintsLocale()).toBe("zh-CN")
		// t() resolves the boot-fixed language (fail-open table round-trips)
		expect(t("common.confirm")).toBe("确认")
		expect(t("panel.sessionsCount", { count: 3 })).toBe("会话数: 3")
		// the exposed tui-base surface re-exports the same t() (live key)
		expect(tReexported("command.language.set", { lang: "zh-CN" })).toBe("语言已切换：zh-CN")
	})

	test("zh-CN alias folding and ja/ko → en degradation happen in the boot chain; the unified lang key wins over legacy hintsLocale", () => {
		// alias folding: every zh spelling collapses onto the bundled zh-CN
		applyI18nConfig({ hintsLocale: "zh" })
		expect(activeLanguage()).toBe("zh-CN")

		// degradation: ja is a legal /hints lang spelling (the command surface
		// is kept) but has no bundled locale file — the registry degrades to
		// en, never throws, and t() falls open to the en strings
		applyHintsConfig({ hintsLocale: "ja" })
		applyI18nConfig({ hintsLocale: "ja" })
		expect(activeLanguage()).toBe("en")
		// the signal mirrors the stored key (a legacy "ja" value replays as-is);
		// the degradation itself lives in the registry chain
		expect(hintsLocale()).toBe("ja")
		expect(t("common.confirm")).toBe("Confirm")

		// unified `lang` beats the legacy hintsLocale when both are present
		applyI18nConfig({ lang: "en", hintsLocale: "zh-CN" })
		expect(activeLanguage()).toBe("en")

		// missing/corrupt config → en default, still no throw
		applyI18nConfig(undefined)
		expect(activeLanguage()).toBe("en")
		expect(t("common.noItems")).toBe("No items")
	})

	test("T14 storage-key unification: the hints mirror folds the SAME precedence — unified lang first, legacy hintsLocale read-only fallback", () => {
		// the unified key wins on the signal mirror too
		applyHintsConfig({ lang: "zh-CN", hintsLocale: "en" })
		expect(hintsLocale()).toBe("zh-CN")

		// no unified value → the legacy key still folds in (read-only compat)
		applyHintsConfig({ hintsLocale: "zh-CN" })
		expect(hintsLocale()).toBe("zh-CN")

		// neither → the signal is left untouched (replay never resets)
		setHintsLocale("en")
		applyHintsConfig({})
		expect(hintsLocale()).toBe("en")
	})
})
