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
  "shell.input.steer": { "zh-CN": "运行中：输入可追加指令，回车注入当前轮 ⚡", en: "turn running: type to steer · enter injects ⚡" },
  "shell.transcript.empty": { "zh-CN": "（输入消息开始对话）", en: "(type a message to start)" },
  "agent.thinking": { "zh-CN": "思考", en: "thinking" },
  "agent.tool.ok": { "zh-CN": "完成", en: "ok" },
  "agent.tool.fail": { "zh-CN": "失败", en: "failed" },
  "agent.approve.title": { "zh-CN": "工具调用审批", en: "tool call approval" },
  "agent.approve.hint": { "zh-CN": "y 允许 · n 拒绝", en: "y approve · n decline" },
  "agent.error": { "zh-CN": "出错", en: "error" },
  "cmd.help.lines": {
    "zh-CN": "/help 命令列表 · /model 切换模型 · /login /logout 凭据 · /usage 用量 · /clear 清空 · /quit 退出",
    en: "/help · /model [provider/id] · /login · /logout · /usage · /clear · /quit",
  },
  "cmd.model.current": { "zh-CN": "当前模型", en: "current model" },
  "cmd.model.available": { "zh-CN": "可用模型", en: "available" },
  "cmd.model.set": { "zh-CN": "已切换", en: "switched to" },
  "cmd.model.next": { "zh-CN": "（下一条消息生效）", en: "(next message)" },
  "picker.sessions.title": { "zh-CN": "会话（回车恢复 · esc 取消）", en: "sessions (enter resume · esc cancel)" },
  "picker.effort.title": { "zh-CN": "{model} 思考档位", en: "{model} reasoning effort" },
  "picker.effort.keep.desc": { "zh-CN": "沿用默认档位", en: "keep the default effort" },
  "picker.effort.low.desc": { "zh-CN": "轻量思考，最快响应", en: "light reasoning, fastest" },
  "picker.effort.medium.desc": { "zh-CN": "中等思考", en: "moderate reasoning" },
  "picker.effort.high.desc": { "zh-CN": "深度思考", en: "deep reasoning" },
  "picker.effort.xhigh.desc": { "zh-CN": "更深度思考，更慢", en: "deeper reasoning, slower" },
  "picker.effort.max.desc": { "zh-CN": "全力思考，最慢", en: "maximum reasoning, slowest" },
  "cmd.new.done": { "zh-CN": "已开新会话", en: "new session started" },
  "cmd.sessions.empty": { "zh-CN": "没有可恢复的会话", en: "no stored sessions" },
  "cmd.sessions.resumed": { "zh-CN": "已挂载会话（下条消息生效）", en: "session attached (applies to next message)" },
  "ask.title": { "zh-CN": "模型提问", en: "model asks" },
  "cmd.usage.summary": { "zh-CN": "累计", en: "total" },
  "cmd.cleared": { "zh-CN": "会话已清空", en: "session cleared" },
  "cmd.login.saved": { "zh-CN": "凭据 {ref} 已保存", en: "credential {ref} saved" },
  "cmd.login.usage": {
    "zh-CN": "用法：/login REF KEY（裸 /login 查看凭据状态）",
    en: "usage: /login REF KEY (bare /login shows credential status)",
  },
  "cmd.logout.done": { "zh-CN": "凭据 {ref} 已移除", en: "credential {ref} removed" },
  "cmd.logout.usage": {
    "zh-CN": "用法：/logout REF（裸 /logout 查看凭据状态）",
    en: "usage: /logout REF (bare /logout shows credential status)",
  },
  "cmd.cred.status": { "zh-CN": "{ref}：{status}", en: "{ref}: {status}" },
  "cmd.cred.configured": { "zh-CN": "已配置", en: "configured" },
  "cmd.cred.missing": { "zh-CN": "未配置", en: "missing" },
  "picker.model.title": { "zh-CN": "选择模型", en: "select model" },
  "picker.theme.title": { "zh-CN": "选择主题", en: "select theme" },
  "picker.preset.title": { "zh-CN": "选择预设", en: "select preset" },
  "picker.history.title": { "zh-CN": "选择分叉点（回车 fork · esc 取消）", en: "pick a fork point (enter forks · esc cancels)" },
  "panel.tools.title": { "zh-CN": "工具", en: "tools" },
  "panel.think.title": { "zh-CN": "思考", en: "thinking" },
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
