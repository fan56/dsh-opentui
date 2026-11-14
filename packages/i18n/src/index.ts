export {
	DEFAULT_LANGUAGE,
	bundledLocalesDir,
	extractParams,
	installedLanguagesFrom,
	loadLocales,
	mergeTables,
	parseLocaleFile,
	userLocalesDir,
	validateLocaleFile,
} from "./registry"
export type { LocaleFileError, LocaleTable, LoadLocalesResult, ValidateResult } from "./registry"
export { activeLanguage, applyI18nConfig, installedLanguages, localeFromConfig, setLanguages, t } from "./t"
export type { I18nConfigLike } from "./t"
