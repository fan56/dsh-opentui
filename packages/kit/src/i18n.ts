/**
 * The i18n seam: every user-visible string in Kit and Shell goes through t().
 * v0 ships zh-CN and en dictionaries; adding a language means adding a file,
 * zero code changes (same posture as dsh-tui-pi's locales/).
 */
export type Locale = "zh-CN" | "en"

type Dict = Record<string, { "zh-CN": string; en: string }>

const dict: Dict = {
  "shell.title": { "zh-CN": "dsh-opentui", en: "dsh-opentui" },
  "shell.input.placeholder": { "zh-CN": "提问，回车发送 · /help 命令 · Ctrl+C 退出", en: "Ask anything, Enter to send · /help · Ctrl+C to quit" },
  "shell.input.busy": { "zh-CN": "思考/执行中… esc 中止", en: "working… esc to abort" },
  "shell.transcript.empty": { "zh-CN": "（输入消息开始对话）", en: "(type a message to start)" },
  "agent.thinking": { "zh-CN": "思考", en: "thinking" },
  "agent.tool.ok": { "zh-CN": "完成", en: "ok" },
  "agent.tool.fail": { "zh-CN": "失败", en: "failed" },
  "agent.approve.title": { "zh-CN": "工具调用审批", en: "tool call approval" },
  "agent.approve.hint": { "zh-CN": "y 允许 · n 拒绝", en: "y approve · n decline" },
  "agent.error": { "zh-CN": "出错", en: "error" },
  "cmd.help.lines": {
    "zh-CN": "/help 命令列表 · /model 切换模型 · /usage 用量 · /clear 清空 · /quit 退出",
    en: "/help · /model [provider/id] · /usage · /clear · /quit",
  },
  "cmd.model.current": { "zh-CN": "当前模型", en: "current model" },
  "cmd.model.available": { "zh-CN": "可用模型", en: "available" },
  "cmd.model.set": { "zh-CN": "已切换", en: "switched to" },
  "cmd.usage.summary": { "zh-CN": "累计", en: "total" },
  "cmd.cleared": { "zh-CN": "会话已清空", en: "session cleared" },
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
