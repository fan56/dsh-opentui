/**
 * The i18n seam: every user-visible string in Kit and Shell goes through t().
 * v0 ships zh-CN and en dictionaries; adding a language means adding a file,
 * zero code changes (same posture as dsh-tui-pi's locales/).
 */
export type Locale = "zh-CN" | "en"

type Dict = Record<string, { "zh-CN": string; en: string }>

const dict: Dict = {
  "shell.title": { "zh-CN": "dsh-opentui", en: "dsh-opentui" },
  "shell.input.placeholder": { "zh-CN": "输入消息，Ctrl+C 退出", en: "Type a message, Ctrl+C to quit" },
  "shell.transcript.empty": { "zh-CN": "（暂无消息）", en: "(no messages yet)" },
  "kit.status.default": { "zh-CN": "就绪", en: "ready" },
}

export interface I18n {
  t(key: string, vars?: Record<string, string | number>): string
  locale: Locale
}

export function createI18n(locale: Locale = "zh-CN"): I18n {
  const fmt = (s: string, vars?: Record<string, string | number>) =>
    vars ? s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)) : s
  return {
    locale,
    t: (key, vars) => {
      const entry = dict[key]
      return entry ? fmt(entry[locale], vars) : key
    },
  }
}
