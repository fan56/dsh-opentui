/**
 * tui-base's i18n surface (design c5-i18n §3/§4 T2): the language starts at
 * boot (`applyI18nConfig` in examples/v2-entry.tsx) and can be switched LIVE
 * through `setLanguage(id)` (the /language command + /hints lang persist
 * through the config seam, then flip the signal).
 *
 * RED LINE (design §6 solid-props getter law): the active language now rides
 * a solid signal, so a translated value feeding a solid component prop still
 * goes through a getter/computed — never bake the translated string into a
 * module-level constant or a plain (non-getter) prop. `t()` call sites inside
 * a tracking scope re-run automatically on a language switch.
 */
export { t, activeLanguage, installedLanguages, LANGUAGE_CHOICES, setLanguage } from "@dsh-opentui/i18n"
