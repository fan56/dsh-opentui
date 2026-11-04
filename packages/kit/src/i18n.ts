/**
 * The i18n seam: every user-visible string in Kit and Shell goes through t().
 * v0 ships zh-CN and en dictionaries; adding a language means adding a file,
 * zero code changes (same posture as dsh-tui-pi's locales/).
 */
export type Locale = "zh-CN" | "en" | "ja" | "ko"

type Dict = Record<string, { "zh-CN": string; en: string; ja?: string; ko?: string }>

const dict: Dict = {
  "shell.title": { "zh-CN": "dsh-opentui", en: "dsh-opentui" , ja: "dsh-opentui ターミナルシェル", ko: "dsh-opentui 터미널 셸" },
  "shell.input.placeholder": { "zh-CN": "提问，回车发送 · /help 命令 · Ctrl+C 退出", en: "Ask anything, Enter to send · /help · Ctrl+C to quit" , ja: "質問を入力して Enter で送信 · /help コマンド · Ctrl+C 終了", ko: "질문 입력 후 Enter 전송 · /help 명령 · Ctrl+C 종료" },
  "shell.input.busy": { "zh-CN": "思考/执行中… esc 中止", en: "working… esc to abort" , ja: "実行中：入力で追記指示、Enter で現在のターンに注入 ⚡", ko: "실행 중: 입력으로 지시 추가, Enter로 현재 턴 주입 ⚡" },
  "shell.input.steer": { "zh-CN": "运行中：输入可追加指令，回车注入当前轮 ⚡", en: "turn running: type to steer · enter injects ⚡" , ja: "実行中：入力で追記指示、回车注入当前轮 ⚡", ko: "실행 중: 입력 추가 지시, Enter 현재 턴 주입 ⚡" },
  "shell.transcript.empty": { "zh-CN": "（输入消息开始对话）", en: "(type a message to start)" , ja: "まだ会話がありません。入力して開始します", ko: "아직 대화가 없습니다. 입력해서 시작하세요" },
  "agent.thinking": { "zh-CN": "思考", en: "thinking" , ja: "思考中", ko: "생각 중" },
  "agent.tool.ok": { "zh-CN": "完成", en: "ok" , ja: "完了", ko: "완료" },
  "agent.tool.fail": { "zh-CN": "失败", en: "failed" , ja: "失敗", ko: "실패" },
  "agent.approve.title": { "zh-CN": "工具调用审批", en: "tool call approval" , ja: "ツール実行の承認", ko: "도구 실행 승인" },
  "agent.approve.hint": { "zh-CN": "y 允许 · n 拒绝", en: "y approve · n decline" , ja: "y 実行 · n 却下 · esc 中止", ko: "y 실행 · n 거부 · esc 중단" },
  "agent.error": { "zh-CN": "出错", en: "error" , ja: "エラー", ko: "오류" },
  "cmd.help.lines": {
    "zh-CN": "/help 命令列表 · /model 切换模型 · /login /logout 凭据 · /usage 用量 · /clear 清空 · /quit 退出",
    en: "/help · /model [provider/id] · /login · /logout · /usage · /clear · /quit",
  },
  "cmd.model.current": { "zh-CN": "当前模型", en: "current model" , ja: "現在のモデル", ko: "현재 모델" },
  "cmd.model.available": { "zh-CN": "可用模型", en: "available" , ja: "利用可能", ko: "사용 가능" },
  "cmd.model.set": { "zh-CN": "已切换", en: "switched to" , ja: "切替済み", ko: "전환됨" },
  "cmd.model.next": { "zh-CN": "（下一条消息生效）", en: "(next message)" , ja: "（次のメッセージから有効）", ko: "(다음 메시지부터 적용)" },
  "picker.sessions.title": { "zh-CN": "会话（回车恢复 · esc 取消）", en: "sessions (enter resume · esc cancel)" , ja: "セッション（Enter で復元 · esc キャンセル）", ko: "세션 (Enter 복원 · esc 취소)" },
  "picker.effort.title": { "zh-CN": "{model} 思考档位", en: "{model} reasoning effort" , ja: "{model} 思考レベル", ko: "{model} 추론 수준" },
  "picker.effort.keep.desc": { "zh-CN": "沿用默认档位", en: "keep the default effort" , ja: "デフォルトレベルを維持", ko: "기본 수준 유지" },
  "picker.effort.low.desc": { "zh-CN": "轻量思考，最快响应", en: "light reasoning, fastest" , ja: "軽い思考、最速", ko: "가벼운 추론, 최속" },
  "picker.effort.medium.desc": { "zh-CN": "中等思考", en: "moderate reasoning" , ja: "中程度の思考", ko: "중간 추론" },
  "picker.effort.high.desc": { "zh-CN": "深度思考", en: "deep reasoning" , ja: "深い思考", ko: "깊은 추론" },
  "picker.effort.xhigh.desc": { "zh-CN": "更深度思考，更慢", en: "deeper reasoning, slower" , ja: "より深く、より遅い", ko: "더 깊고 느림" },
  "picker.effort.max.desc": { "zh-CN": "全力思考，最慢", en: "maximum reasoning, slowest" , ja: "最大思考、最遅", ko: "최대 추론, 최저속" },
  "cmd.new.done": { "zh-CN": "已开新会话", en: "new session started" , ja: "新しいセッションを開始しました", ko: "새 세션 시작" },
  "cmd.sessions.empty": { "zh-CN": "没有可恢复的会话", en: "no stored sessions" , ja: "復元可能なセッションがありません", ko: "복원 가능한 세션이 없습니다" },
  "cmd.sessions.resumed": { "zh-CN": "已挂载会话（下条消息生效）", en: "session attached (applies to next message)" , ja: "復元しました", ko: "복원됨" },
  "ask.title": { "zh-CN": "模型提问", en: "model asks" , ja: "確認", ko: "확인" },
  "ask.declined": { "zh-CN": "已拒绝", en: "declined" , ja: "辞退", ko: "거절" },
  "cmd.usage.summary": { "zh-CN": "累计", en: "total" , ja: "使用量", ko: "사용량" },
  "cmd.cleared": { "zh-CN": "会话已清空", en: "session cleared" , ja: "クリアしました", ko: "지웠습니다" },
  "cmd.login.saved": { "zh-CN": "凭据 {ref} 已保存", en: "credential {ref} saved" , ja: "資格情報を保存: {ref}", ko: "자격증명 저장됨: {ref}" },
  "cmd.login.usage": {
    "zh-CN": "用法：/login REF KEY（裸 /login 查看凭据状态）",
    en: "usage: /login REF KEY (bare /login shows credential status)",
  },
  "cmd.logout.done": { "zh-CN": "凭据 {ref} 已移除", en: "credential {ref} removed" , ja: "資格情報を削除: {ref}", ko: "자격증명 제거됨: {ref}" },
  "cmd.logout.usage": {
    "zh-CN": "用法：/logout REF（裸 /logout 查看凭据状态）",
    en: "usage: /logout REF (bare /logout shows credential status)",
  },
  "cmd.cred.status": { "zh-CN": "{ref}：{status}", en: "{ref}: {status}" , ja: "資格情報の状態", ko: "자격증명 상태" },
  "cmd.cred.configured": { "zh-CN": "已配置", en: "configured" , ja: "設定済み", ko: "구성됨" },
  "cmd.cred.missing": { "zh-CN": "未配置", en: "missing" , ja: "未設定", ko: "미설정" },
  "picker.model.title": { "zh-CN": "选择模型", en: "select model" , ja: "モデルを選択", ko: "모델 선택" },
  "picker.theme.title": { "zh-CN": "选择主题", en: "select theme" , ja: "テーマを選択", ko: "테마 선택" },
  "picker.preset.title": { "zh-CN": "选择预设", en: "select preset" , ja: "プリセットを選択", ko: "프리셋 선택" },
  "picker.history.title": { "zh-CN": "选择分叉点（回车 fork · esc 取消）", en: "pick a fork point (enter forks · esc cancels)" , ja: "分岐点を選択（Enter で fork · esc キャンセル）", ko: "분기점 선택 (Enter fork · esc 취소)" },
  "panel.tools.title": { "zh-CN": "工具", en: "tools" , ja: "ツール", ko: "도구" },
  "panel.think.title": { "zh-CN": "思考", en: "thinking" , ja: "思考", ko: "생각" },
}

export interface I18n {
  t(key: string, vars?: Record<string, string | number>): string
  locale: Locale
  /** Live locale switch — t() reads the current locale on every call. */
  setLocale(l: Locale): void
}

export function createI18n(locale: Locale = "zh-CN"): I18n {
  let current: Locale = locale
  const fmt = (s: string, vars?: Record<string, string | number>) =>
    vars ? s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)) : s
  return {
    get locale() {
      return current
    },
    setLocale(l: Locale) {
      current = l
    },
    // reads the CURRENT locale dynamically with a graceful chain:
    // requested → en → zh-CN → the key itself (ja/ko are seeded locales —
    // untranslated keys fall through instead of breaking)
    t: (key, vars) => {
      const entry = dict[key]
      if (!entry) return key
      const v = (entry as Record<string, string>)[current] ?? entry.en ?? entry["zh-CN"]
      return fmt(v, vars)
    },
  }
}
