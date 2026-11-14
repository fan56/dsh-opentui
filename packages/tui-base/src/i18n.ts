/**
 * tui-base's i18n surface (design c5-i18n §3/§4 T2): the language is fixed at
 * boot (`applyI18nConfig` in examples/v2-entry.tsx, applyHintsConfig parity)
 * and this module only re-exports `t()` for the per-facet copy migrations.
 *
 * RED LINE (design §6 solid-props getter law): `t()` reads the boot-fixed
 * language, so calling it inside a component render body is safe ONLY where
 * it is allowed to re-run on every render. When a translated value feeds a
 * solid component prop, keep the `t(...)` call inside a getter/computed —
 * never bake the translated string into a module-level constant or a plain
 * (non-getter) prop. No reactive language switching is planned (startup
 * fixed), so no signal wiring belongs here.
 */
export { t } from "@dsh-opentui/i18n"
