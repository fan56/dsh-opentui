// src/host-entry.tsx
import { createComponent as _$createComponent16 } from "@opentui/solid";
import { spawn } from "node:child_process";
import { render } from "@opentui/solid";

// ../runtime/src/engine.ts
import { createCliRenderer } from "@opentui/core";
async function mountEngine(options = {}) {
  const renderer = await createCliRenderer({
    externalOutputMode: "passthrough",
    exitOnCtrlC: false,
    autoFocus: false
  });
  const capture = captureConsoleWhileMounted(options.captureStdout !== false);
  renderer.on("exit", (reason) => {
    capture.restore();
    options.onExit?.(String(reason ?? "exit"));
  });
  options.onReady?.(renderer);
  return { renderer, capture };
}
function captureConsoleWhileMounted(enabled) {
  const captured = [];
  if (!enabled)
    return { restore() {}, lines: () => captured };
  const origConsoleLog = console.log;
  const origConsoleError = console.error;
  const origConsoleWarn = console.warn;
  const origConsoleInfo = console.info;
  const sink = (prefix) => (...args) => {
    captured.push(prefix + args.map(String).join(" "));
  };
  console.log = sink("[log]");
  return {
    restore() {
      console.log = origConsoleLog;
      console.error = origConsoleError;
      console.warn = origConsoleWarn;
      console.info = origConsoleInfo;
    },
    lines: () => [...captured]
  };
}

// ../runtime/src/surface-service.ts
class SurfaceStore {
  #decls = new Map;
  #version = 0;
  #listeners = new Set;
  get snapshot() {
    return [...this.#decls.values()];
  }
  get version() {
    return this.#version;
  }
  upsert(decl) {
    this.#decls.set(decl.id, decl);
    this.#bump();
  }
  remove(id) {
    if (this.#decls.delete(id))
      this.#bump();
  }
  subscribe(cb) {
    this.#listeners.add(cb);
    return () => this.#listeners.delete(cb);
  }
  #bump() {
    this.#version++;
    for (const l of this.#listeners)
      l();
  }
}

// ../kit/src/i18n.ts
var dict = {
  "shell.title": { "zh-CN": "dsh-opentui", en: "dsh-opentui", ja: "dsh-opentui ターミナルシェル", ko: "dsh-opentui 터미널 셸" },
  "shell.input.placeholder": { "zh-CN": "提问，回车发送 · /help 命令 · Ctrl+C 退出", en: "Ask anything, Enter to send · /help · Ctrl+C to quit", ja: "質問を入力して Enter で送信 · /help コマンド · Ctrl+C 終了", ko: "질문 입력 후 Enter 전송 · /help 명령 · Ctrl+C 종료" },
  "shell.input.busy": { "zh-CN": "思考/执行中… esc 中止", en: "working… esc to abort", ja: "実行中：入力で追記指示、Enter で現在のターンに注入 ⚡", ko: "실행 중: 입력으로 지시 추가, Enter로 현재 턴 주입 ⚡" },
  "shell.input.steer": { "zh-CN": "运行中：输入可追加指令，回车注入当前轮 ⚡", en: "turn running: type to steer · enter injects ⚡", ja: "実行中：入力で追記指示、回车注入当前轮 ⚡", ko: "실행 중: 입력 추가 지시, Enter 현재 턴 주입 ⚡" },
  "shell.transcript.empty": { "zh-CN": "（输入消息开始对话）", en: "(type a message to start)", ja: "まだ会話がありません。入力して開始します", ko: "아직 대화가 없습니다. 입력해서 시작하세요" },
  "agent.thinking": { "zh-CN": "思考", en: "thinking", ja: "思考中", ko: "생각 중" },
  "agent.tool.ok": { "zh-CN": "完成", en: "ok", ja: "完了", ko: "완료" },
  "agent.tool.fail": { "zh-CN": "失败", en: "failed", ja: "失敗", ko: "실패" },
  "agent.approve.title": { "zh-CN": "工具调用审批", en: "tool call approval", ja: "ツール実行の承認", ko: "도구 실행 승인" },
  "agent.approve.hint": { "zh-CN": "y 允许 · n 拒绝", en: "y approve · n decline", ja: "y 実行 · n 却下 · esc 中止", ko: "y 실행 · n 거부 · esc 중단" },
  "agent.error": { "zh-CN": "出错", en: "error", ja: "エラー", ko: "오류" },
  "cmd.help.lines": {
    "zh-CN": "/help 命令列表 · /model 切换模型 · /login /logout 凭据 · /usage 用量 · /clear 清空 · /quit 退出",
    en: "/help · /model [provider/id] · /login · /logout · /usage · /clear · /quit"
  },
  "cmd.model.current": { "zh-CN": "当前模型", en: "current model", ja: "現在のモデル", ko: "현재 모델" },
  "cmd.model.available": { "zh-CN": "可用模型", en: "available", ja: "利用可能", ko: "사용 가능" },
  "cmd.model.set": { "zh-CN": "已切换", en: "switched to", ja: "切替済み", ko: "전환됨" },
  "cmd.model.next": { "zh-CN": "（下一条消息生效）", en: "(next message)", ja: "（次のメッセージから有効）", ko: "(다음 메시지부터 적용)" },
  "picker.sessions.title": { "zh-CN": "会话（回车恢复 · esc 取消）", en: "sessions (enter resume · esc cancel)", ja: "セッション（Enter で復元 · esc キャンセル）", ko: "세션 (Enter 복원 · esc 취소)" },
  "picker.effort.title": { "zh-CN": "{model} 思考档位", en: "{model} reasoning effort", ja: "{model} 思考レベル", ko: "{model} 추론 수준" },
  "picker.effort.keep.desc": { "zh-CN": "沿用默认档位", en: "keep the default effort", ja: "デフォルトレベルを維持", ko: "기본 수준 유지" },
  "picker.effort.low.desc": { "zh-CN": "轻量思考，最快响应", en: "light reasoning, fastest", ja: "軽い思考、最速", ko: "가벼운 추론, 최속" },
  "picker.effort.medium.desc": { "zh-CN": "中等思考", en: "moderate reasoning", ja: "中程度の思考", ko: "중간 추론" },
  "picker.effort.high.desc": { "zh-CN": "深度思考", en: "deep reasoning", ja: "深い思考", ko: "깊은 추론" },
  "picker.effort.xhigh.desc": { "zh-CN": "更深度思考，更慢", en: "deeper reasoning, slower", ja: "より深く、より遅い", ko: "더 깊고 느림" },
  "picker.effort.max.desc": { "zh-CN": "全力思考，最慢", en: "maximum reasoning, slowest", ja: "最大思考、最遅", ko: "최대 추론, 최저속" },
  "cmd.new.done": { "zh-CN": "已开新会话", en: "new session started", ja: "新しいセッションを開始しました", ko: "새 세션 시작" },
  "cmd.sessions.empty": { "zh-CN": "没有可恢复的会话", en: "no stored sessions", ja: "復元可能なセッションがありません", ko: "복원 가능한 세션이 없습니다" },
  "cmd.sessions.resumed": { "zh-CN": "已挂载会话（下条消息生效）", en: "session attached (applies to next message)", ja: "復元しました", ko: "복원됨" },
  "ask.title": { "zh-CN": "模型提问", en: "model asks", ja: "確認", ko: "확인" },
  "cmd.usage.summary": { "zh-CN": "累计", en: "total", ja: "使用量", ko: "사용량" },
  "cmd.cleared": { "zh-CN": "会话已清空", en: "session cleared", ja: "クリアしました", ko: "지웠습니다" },
  "cmd.login.saved": { "zh-CN": "凭据 {ref} 已保存", en: "credential {ref} saved", ja: "資格情報を保存: {ref}", ko: "자격증명 저장됨: {ref}" },
  "cmd.login.usage": {
    "zh-CN": "用法：/login REF KEY（裸 /login 查看凭据状态）",
    en: "usage: /login REF KEY (bare /login shows credential status)"
  },
  "cmd.logout.done": { "zh-CN": "凭据 {ref} 已移除", en: "credential {ref} removed", ja: "資格情報を削除: {ref}", ko: "자격증명 제거됨: {ref}" },
  "cmd.logout.usage": {
    "zh-CN": "用法：/logout REF（裸 /logout 查看凭据状态）",
    en: "usage: /logout REF (bare /logout shows credential status)"
  },
  "cmd.cred.status": { "zh-CN": "{ref}：{status}", en: "{ref}: {status}", ja: "資格情報の状態", ko: "자격증명 상태" },
  "cmd.cred.configured": { "zh-CN": "已配置", en: "configured", ja: "設定済み", ko: "구성됨" },
  "cmd.cred.missing": { "zh-CN": "未配置", en: "missing", ja: "未設定", ko: "미설정" },
  "picker.model.title": { "zh-CN": "选择模型", en: "select model", ja: "モデルを選択", ko: "모델 선택" },
  "picker.theme.title": { "zh-CN": "选择主题", en: "select theme", ja: "テーマを選択", ko: "테마 선택" },
  "picker.preset.title": { "zh-CN": "选择预设", en: "select preset", ja: "プリセットを選択", ko: "프리셋 선택" },
  "picker.history.title": { "zh-CN": "选择分叉点（回车 fork · esc 取消）", en: "pick a fork point (enter forks · esc cancels)", ja: "分岐点を選択（Enter で fork · esc キャンセル）", ko: "분기점 선택 (Enter fork · esc 취소)" },
  "panel.tools.title": { "zh-CN": "工具", en: "tools", ja: "ツール", ko: "도구" },
  "panel.think.title": { "zh-CN": "思考", en: "thinking", ja: "思考", ko: "생각" }
};
function createI18n(locale = "zh-CN") {
  let current = locale;
  const fmt = (s, vars) => vars ? s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)) : s;
  return {
    get locale() {
      return current;
    },
    setLocale(l) {
      current = l;
    },
    t: (key, vars) => {
      const entry = dict[key];
      if (!entry)
        return key;
      const v = entry[current] ?? entry.en ?? entry["zh-CN"];
      return fmt(v, vars);
    }
  };
}

// src/ShellHost.tsx
import { effect as _$effect16 } from "@opentui/solid";
import { createTextNode as _$createTextNode11 } from "@opentui/solid";
import { insertNode as _$insertNode13 } from "@opentui/solid";
import { mergeProps as _$mergeProps } from "@opentui/solid";
import { insert as _$insert16 } from "@opentui/solid";
import { createComponent as _$createComponent15 } from "@opentui/solid";
import { memo as _$memo9 } from "@opentui/solid";
import { setProp as _$setProp16 } from "@opentui/solid";
import { createElement as _$createElement16 } from "@opentui/solid";
import { For as For12, createMemo, createSignal as createSignal4, onCleanup, onMount } from "solid-js";
import { SyntaxStyle } from "@opentui/core";
import { useKeyboard as useKeyboard2, useRenderer } from "@opentui/solid";
// ../kit/src/themes-data.ts
var ayuLight = {
  name: "ayu-light",
  dark: false,
  tokens: {
    accent: "#ff9940",
    dim: "#9099a2",
    danger: "#cf3e4f",
    ok: "#6b9900",
    warn: "#b57d2e",
    text: "#5c6773",
    border: "#d8d7d4",
    selection: "#f2f1f0",
    userMark: "#ff9940",
    toolOk: "#b57d2e",
    toolFail: "#cf3e4f",
    approvalBorder: "#b57d2e",
    thinking: "#a37acc"
  }
};
var catppuccinLatte = {
  name: "catppuccin-latte",
  dark: false,
  tokens: {
    accent: "#1e66f5",
    dim: "#8c8fa1",
    danger: "#d20f39",
    ok: "#3b9433",
    warn: "#b06f00",
    text: "#4c4f69",
    border: "#ccd0da",
    selection: "#e6e9ef",
    userMark: "#1e66f5",
    toolOk: "#b06f00",
    toolFail: "#d20f39",
    approvalBorder: "#b06f00",
    thinking: "#8839ef"
  }
};
var catppuccinMocha = {
  name: "catppuccin-mocha",
  dark: true,
  tokens: {
    accent: "#89b4fa",
    dim: "#6c708f",
    danger: "#f38ba8",
    ok: "#a6e3a1",
    warn: "#f9e2af",
    text: "#cdd6f4",
    border: "#45475a",
    selection: "#313244",
    userMark: "#89b4fa",
    toolOk: "#f9e2af",
    toolFail: "#f38ba8",
    approvalBorder: "#f9e2af",
    thinking: "#cba6f7"
  }
};
var draculaLight = {
  name: "dracula-light",
  dark: false,
  tokens: {
    accent: "#6272a4",
    dim: "#7a7d92",
    danger: "#c23b4c",
    ok: "#178b48",
    warn: "#9a7e0d",
    text: "#282a36",
    border: "#d0d0d8",
    selection: "#ececf0",
    userMark: "#6272a4",
    toolOk: "#9a7e0d",
    toolFail: "#c23b4c",
    approvalBorder: "#9a7e0d",
    thinking: "#7c52c0"
  }
};
var dracula = {
  name: "dracula",
  dark: true,
  tokens: {
    accent: "#bd93f9",
    dim: "#6272a4",
    danger: "#ff5555",
    ok: "#50fa7b",
    warn: "#f1fa8c",
    text: "#f8f8f2",
    border: "#3a3d4d",
    selection: "#2f313e",
    userMark: "#bd93f9",
    toolOk: "#f1fa8c",
    toolFail: "#ff5555",
    approvalBorder: "#f1fa8c",
    thinking: "#ff79c6"
  }
};
var githubDark = {
  name: "github-dark",
  dark: true,
  tokens: {
    accent: "#79c0ff",
    dim: "#6e7681",
    danger: "#ffa198",
    ok: "#56d364",
    warn: "#e3b341",
    text: "#e6edf3",
    border: "#3d444d",
    selection: "#161b22",
    userMark: "#79c0ff",
    toolOk: "#e3b341",
    toolFail: "#ffa198",
    approvalBorder: "#e3b341",
    thinking: "#d2a8ff"
  }
};
var githubLight = {
  name: "github-light",
  dark: false,
  tokens: {
    accent: "#0a60b5",
    dim: "#829087",
    danger: "#b64550",
    ok: "#1e843b",
    warn: "#9a6700",
    text: "#1f2a24",
    border: "#b8c1b9",
    selection: "#eef3ee",
    userMark: "#0a60b5",
    toolOk: "#9a6700",
    toolFail: "#b64550",
    approvalBorder: "#9a6700",
    thinking: "#7b4fae"
  }
};
var gruvboxDark = {
  name: "gruvbox-dark",
  dark: true,
  tokens: {
    accent: "#83a598",
    dim: "#7c6f64",
    danger: "#fb4934",
    ok: "#b8bb26",
    warn: "#fabd2f",
    text: "#ebdbb2",
    border: "#504945",
    selection: "#3c3836",
    userMark: "#83a598",
    toolOk: "#fabd2f",
    toolFail: "#fb4934",
    approvalBorder: "#fabd2f",
    thinking: "#d3869b"
  }
};
var gruvboxLight = {
  name: "gruvbox-light",
  dark: false,
  tokens: {
    accent: "#458588",
    dim: "#928374",
    danger: "#cc241d",
    ok: "#79740e",
    warn: "#b57614",
    text: "#3c3836",
    border: "#d5c4a1",
    selection: "#ebdbb2",
    userMark: "#458588",
    toolOk: "#b57614",
    toolFail: "#cc241d",
    approvalBorder: "#b57614",
    thinking: "#8f3f71"
  }
};
var materialLight = {
  name: "material-light",
  dark: false,
  tokens: {
    accent: "#009688",
    dim: "#78909c",
    danger: "#c62828",
    ok: "#2e7d32",
    warn: "#b26a00",
    text: "#37474f",
    border: "#cfd8dc",
    selection: "#eceff1",
    userMark: "#009688",
    toolOk: "#b26a00",
    toolFail: "#c62828",
    approvalBorder: "#b26a00",
    thinking: "#6a1b9a"
  }
};
var monokai = {
  name: "monokai",
  dark: true,
  tokens: {
    accent: "#66d9ef",
    dim: "#75715e",
    danger: "#f92672",
    ok: "#a6e22e",
    warn: "#e6db74",
    text: "#f8f8f2",
    border: "#3e3d32",
    selection: "#33332c",
    userMark: "#66d9ef",
    toolOk: "#e6db74",
    toolFail: "#f92672",
    approvalBorder: "#e6db74",
    thinking: "#ae81ff"
  }
};
var nordDark = {
  name: "nord-dark",
  dark: true,
  tokens: {
    accent: "#88c0d0",
    dim: "#667289",
    danger: "#bf616a",
    ok: "#a3be8c",
    warn: "#ebcb8b",
    text: "#eceff4",
    border: "#434c5e",
    selection: "#3b4252",
    userMark: "#88c0d0",
    toolOk: "#ebcb8b",
    toolFail: "#bf616a",
    approvalBorder: "#ebcb8b",
    thinking: "#b48ead"
  }
};
var nordLight = {
  name: "nord-light",
  dark: false,
  tokens: {
    accent: "#5e81ac",
    dim: "#6c7994",
    danger: "#a9444f",
    ok: "#4e7a34",
    warn: "#a0700a",
    text: "#2e3440",
    border: "#c3cad6",
    selection: "#d8dee9",
    userMark: "#5e81ac",
    toolOk: "#a0700a",
    toolFail: "#a9444f",
    approvalBorder: "#a0700a",
    thinking: "#8453a8"
  }
};
var oneDark = {
  name: "one-dark",
  dark: true,
  tokens: {
    accent: "#61afef",
    dim: "#616a7b",
    danger: "#e06c75",
    ok: "#98c379",
    warn: "#e5c07b",
    text: "#b6bdc9",
    border: "#363c46",
    selection: "#2f343d",
    userMark: "#61afef",
    toolOk: "#e5c07b",
    toolFail: "#e06c75",
    approvalBorder: "#e5c07b",
    thinking: "#c678dd"
  }
};
var oneLight = {
  name: "one-light",
  dark: false,
  tokens: {
    accent: "#4078f2",
    dim: "#9a9ea8",
    danger: "#e45649",
    ok: "#50a14f",
    warn: "#b18401",
    text: "#383a42",
    border: "#d4d4da",
    selection: "#f0f0f0",
    userMark: "#4078f2",
    toolOk: "#b18401",
    toolFail: "#e45649",
    approvalBorder: "#b18401",
    thinking: "#a626a4"
  }
};
var solarizedDark = {
  name: "solarized-dark",
  dark: true,
  tokens: {
    accent: "#268bd2",
    dim: "#586e75",
    danger: "#dc322f",
    ok: "#859900",
    warn: "#b58900",
    text: "#b0bcbc",
    border: "#0a3a47",
    selection: "#073642",
    userMark: "#268bd2",
    toolOk: "#b58900",
    toolFail: "#dc322f",
    approvalBorder: "#b58900",
    thinking: "#6c71c4"
  }
};
var solarizedLight = {
  name: "solarized-light",
  dark: false,
  tokens: {
    accent: "#268bd2",
    dim: "#839496",
    danger: "#dc322f",
    ok: "#667400",
    warn: "#9a7500",
    text: "#586e75",
    border: "#d3ccb4",
    selection: "#eee8d5",
    userMark: "#268bd2",
    toolOk: "#9a7500",
    toolFail: "#dc322f",
    approvalBorder: "#9a7500",
    thinking: "#6c71c4"
  }
};
var synthwave = {
  name: "synthwave",
  dark: true,
  tokens: {
    accent: "#36f9f6",
    dim: "#6d6288",
    danger: "#fe4450",
    ok: "#72f1b8",
    warn: "#ff8b39",
    text: "#f8f8f2",
    border: "#3a3350",
    selection: "#302a3d",
    userMark: "#36f9f6",
    toolOk: "#ff8b39",
    toolFail: "#fe4450",
    approvalBorder: "#ff8b39",
    thinking: "#ff7edb"
  }
};
var tokyoNightLight = {
  name: "tokyo-night-light",
  dark: false,
  tokens: {
    accent: "#2e7de9",
    dim: "#7c8291",
    danger: "#c32d5c",
    ok: "#587539",
    warn: "#8c6c3e",
    text: "#3760bf",
    border: "#b7bac3",
    selection: "#d5d6db",
    userMark: "#2e7de9",
    toolOk: "#8c6c3e",
    toolFail: "#c32d5c",
    approvalBorder: "#8c6c3e",
    thinking: "#7847bd"
  }
};
var tokyoNight = {
  name: "tokyo-night",
  dark: true,
  tokens: {
    accent: "#7aa2f7",
    dim: "#565f89",
    danger: "#f7768e",
    ok: "#9ece6a",
    warn: "#e0af68",
    text: "#c0caf5",
    border: "#3b4261",
    selection: "#292e42",
    userMark: "#7aa2f7",
    toolOk: "#e0af68",
    toolFail: "#f7768e",
    approvalBorder: "#e0af68",
    thinking: "#bb9af7"
  }
};
var generatedThemes = {
  "ayu-light": ayuLight,
  "catppuccin-latte": catppuccinLatte,
  "catppuccin-mocha": catppuccinMocha,
  "dracula-light": draculaLight,
  dracula,
  "github-dark": githubDark,
  "github-light": githubLight,
  "gruvbox-dark": gruvboxDark,
  "gruvbox-light": gruvboxLight,
  "material-light": materialLight,
  monokai,
  "nord-dark": nordDark,
  "nord-light": nordLight,
  "one-dark": oneDark,
  "one-light": oneLight,
  "solarized-dark": solarizedDark,
  "solarized-light": solarizedLight,
  synthwave,
  "tokyo-night-light": tokyoNightLight,
  "tokyo-night": tokyoNight
};

// ../kit/src/theme.ts
var defaultTheme = {
  name: "default",
  tokens: {
    accent: "#00ff88",
    dim: "#666666",
    danger: "#ff5555",
    ok: "#50fa7b",
    warn: "#ffb86c",
    text: "#eeeeee",
    border: "#444444"
  }
};
var catppuccinMocha2 = {
  name: "catppuccin-mocha",
  dark: true,
  tokens: {
    accent: "#a6e3a1",
    dim: "#6c7086",
    danger: "#f38ba8",
    ok: "#a6e3a1",
    warn: "#f9e2af",
    text: "#cdd6f4",
    border: "#45475a",
    selection: "#313244",
    userMark: "#89b4fa",
    toolOk: "#f9e2af",
    toolFail: "#f38ba8",
    approvalBorder: "#f9e2af",
    thinking: "#cba6f7"
  }
};
var themes = {
  default: defaultTheme,
  ...generatedThemes,
  "catppuccin-mocha": catppuccinMocha2
};
function getTheme(name) {
  if (name && themes[name])
    return themes[name];
  return defaultTheme;
}
function themeNames() {
  return Object.values(themes).map((theme) => ({ name: theme.name, dark: theme.dark ?? true }));
}
// ../kit/src/components.tsx
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { For } from "solid-js";
// ../kit/src/shell-parts.tsx
import { use as _$use } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { createComponent as _$createComponent2 } from "@opentui/solid";
import { setProp as _$setProp2 } from "@opentui/solid";
import { effect as _$effect2 } from "@opentui/solid";
import { insert as _$insert2 } from "@opentui/solid";
import { createTextNode as _$createTextNode2 } from "@opentui/solid";
import { insertNode as _$insertNode2 } from "@opentui/solid";
import { createElement as _$createElement2 } from "@opentui/solid";
import { createEffect, For as For2, on, Show } from "solid-js";
import { defaultTextareaKeyBindings } from "@opentui/core";
var MAX_VISIBLE_ITEMS = 120;
var footerHints = [{
  key: "enter",
  label: "send"
}, {
  key: "y/n",
  label: "approve"
}, {
  key: "esc",
  label: "abort"
}, {
  key: "/help",
  label: "commands"
}, {
  key: "ctrl+c",
  label: "quit"
}];
function renderAssistant(text, theme) {
  const out = [];
  let inFence = false;
  for (const raw of text.split(`
`)) {
    const line = raw.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
    if (/^```/.test(line)) {
      inFence = !inFence;
      out.push({
        text: inFence ? "┌─" : "└─",
        fg: theme.tokens.dim
      });
      continue;
    }
    if (inFence) {
      out.push({
        text: `│ ${line}`,
        fg: theme.tokens.dim
      });
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)/.exec(line);
    if (heading)
      out.push({
        text: heading[2],
        fg: theme.tokens.accent
      });
    else
      out.push({
        text: line
      });
  }
  return out;
}
function itemsToLines(items, theme, t, spinnerFrame, _mdStyle) {
  const out = [];
  for (const it of items) {
    if (it.kind === "user") {
      out.push({
        text: `❯ ${it.text}`,
        fg: theme.tokens.userMark ?? theme.tokens.accent
      });
    } else if (it.kind === "assistant") {
      out.push(...renderAssistant(it.text, theme));
      if (it.final)
        out.push({
          text: ""
        });
    } else if (it.kind === "thinking") {
      out.push({
        text: `${spinnerFrame} ${t("agent.thinking")} (${it.chars}) ${it.tail.slice(-120)}`,
        fg: theme.tokens.dim
      });
    } else if (it.kind === "tool") {
      out.push({
        text: ` ⚒ ${it.name} ${it.args.slice(0, 90)}`,
        fg: theme.tokens.toolOk ?? theme.tokens.warn
      });
      out.push({
        text: ` ⎿ ${it.ok ? t("agent.tool.ok") : t("agent.tool.fail")}: ${it.brief.slice(0, 110)}`,
        fg: it.ok ? theme.tokens.dim : theme.tokens.toolFail ?? theme.tokens.danger
      });
    } else if (it.kind === "error") {
      out.push({
        text: `✗ ${t("agent.error")}: ${it.text}`,
        fg: theme.tokens.danger
      });
    } else {
      out.push({
        text: `· ${it.text}`,
        fg: theme.tokens.dim
      });
    }
  }
  return out;
}
function TranscriptWindow(props) {
  const offset = () => props.offset ?? 0;
  const windowLines = () => {
    const visible = props.items.slice(-(props.maxItems ?? MAX_VISIBLE_ITEMS));
    const all = itemsToLines(visible, props.theme, props.t, props.spinnerFrame, props.mdStyle);
    const vrows = props.viewportRows ?? 30;
    props.onLayout?.(all.length, vrows);
    if (props.startIndex !== undefined) {
      const start = Math.max(0, Math.min(props.startIndex, Math.max(0, all.length - vrows)));
      return all.slice(start, start + vrows);
    }
    const start = Math.max(0, all.length - vrows - offset());
    const end = Math.max(1, all.length - offset());
    return all.slice(start, end);
  };
  return (() => {
    var _el$18 = _$createElement2("box");
    _$setProp2(_el$18, "style", {
      flexDirection: "column",
      flexGrow: 1,
      justifyContent: "flex-end",
      padding: 1
    });
    _$insert2(_el$18, _$createComponent2(For2, {
      get each() {
        return windowLines();
      },
      children: (l) => (() => {
        var _el$21 = _$createElement2("text");
        _$insert2(_el$21, () => l.text || " ");
        _$effect2((_$p) => _$setProp2(_el$21, "style", l.fg ? {
          fg: l.fg
        } : {}, _$p));
        return _el$21;
      })()
    }), null);
    _$insert2(_el$18, _$createComponent2(Show, {
      get when() {
        return (props.offset ?? 0) > 0 || props.startIndex !== undefined;
      },
      get children() {
        var _el$19 = _$createElement2("text");
        _$insertNode2(_el$19, _$createTextNode2(`↑ scrolled (PgDn = follow latest)`));
        _$effect2((_$p) => _$setProp2(_el$19, "style", {
          fg: props.theme.tokens.dim
        }, _$p));
        return _el$19;
      }
    }), null);
    return _el$18;
  })();
}
var INPUT_KEY_BINDINGS = [...defaultTextareaKeyBindings, {
  name: "return",
  action: "submit"
}, {
  name: "kpenter",
  action: "submit"
}, {
  name: "return",
  shift: true,
  action: "newline"
}, {
  name: "kpenter",
  shift: true,
  action: "newline"
}, {
  name: "return",
  meta: true,
  action: "newline"
}, {
  name: "kpenter",
  meta: true,
  action: "newline"
}];
function InputLine(props) {
  let ta;
  createEffect(on(() => props.resetKey, () => {
    ta?.setText("");
  }, {
    defer: true
  }));
  createEffect(on(() => props.setKey, () => {
    if (!ta)
      return;
    ta.replaceText(props.setValue ?? "");
    ta.gotoBufferEnd();
  }, {
    defer: true
  }));
  createEffect(on(() => props.focusKey, () => {
    if (!props.busy)
      ta?.focus();
  }, {
    defer: true
  }));
  const onKeyDown = (key) => {
    if (props.onKeyFilter?.(key)) {
      key.preventDefault();
      return;
    }
    if (!ta || key.shift || key.ctrl || key.meta)
      return;
    const row = ta.visualCursor.visualRow;
    if (key.name === "up" && row === 0) {
      if (props.onHistoryNav?.("up"))
        key.preventDefault();
    } else if (key.name === "down" && row >= Math.max(0, ta.virtualLineCount - 1)) {
      if (props.onHistoryNav?.("down"))
        key.preventDefault();
    }
  };
  return (() => {
    var _el$22 = _$createElement2("box"), _el$23 = _$createElement2("box"), _el$24 = _$createElement2("text"), _el$26 = _$createElement2("textarea");
    _$insertNode2(_el$22, _el$23);
    _$insertNode2(_el$23, _el$24);
    _$insertNode2(_el$23, _el$26);
    _$setProp2(_el$23, "style", {
      flexDirection: "row"
    });
    _$insertNode2(_el$24, _$createTextNode2(`❯ `));
    _$use((el) => ta = el, _el$26);
    _$setProp2(_el$26, "keyBindings", INPUT_KEY_BINDINGS);
    _$setProp2(_el$26, "onContentChange", () => props.onContentChange?.(ta?.plainText ?? ""));
    _$setProp2(_el$26, "onSubmit", () => props.onSubmit?.());
    _$setProp2(_el$26, "onKeyDown", onKeyDown);
    _$insert2(_el$22, _$createComponent2(Show, {
      get when() {
        return props.busy;
      },
      get children() {
        var _el$27 = _$createElement2("text");
        _$insert2(_el$27, () => `${props.spinnerFrame ? `${props.spinnerFrame} ` : ""}${props.busyLabel}`);
        _$effect2((_$p) => _$setProp2(_el$27, "style", {
          fg: props.theme.tokens.dim
        }, _$p));
        return _el$27;
      }
    }), null);
    _$effect2((_p$) => {
      var _v$5 = {
        border: true,
        borderStyle: "rounded",
        borderColor: props.theme.tokens.border,
        flexDirection: "column"
      }, _v$6 = {
        fg: props.theme.tokens.accent
      }, _v$7 = !props.busy && (props.focused ?? true), _v$8 = props.placeholder, _v$9 = props.theme.tokens.text, _v$0 = props.theme.tokens.text, _v$1 = props.theme.tokens.dim, _v$10 = {
        flexGrow: 1,
        height: props.height ?? 1,
        wrapMode: "char"
      };
      _v$5 !== _p$.e && (_p$.e = _$setProp2(_el$22, "style", _v$5, _p$.e));
      _v$6 !== _p$.t && (_p$.t = _$setProp2(_el$24, "style", _v$6, _p$.t));
      _v$7 !== _p$.a && (_p$.a = _$setProp2(_el$26, "focused", _v$7, _p$.a));
      _v$8 !== _p$.o && (_p$.o = _$setProp2(_el$26, "placeholder", _v$8, _p$.o));
      _v$9 !== _p$.i && (_p$.i = _$setProp2(_el$26, "textColor", _v$9, _p$.i));
      _v$0 !== _p$.n && (_p$.n = _$setProp2(_el$26, "focusedTextColor", _v$0, _p$.n));
      _v$1 !== _p$.s && (_p$.s = _$setProp2(_el$26, "placeholderColor", _v$1, _p$.s));
      _v$10 !== _p$.h && (_p$.h = _$setProp2(_el$26, "style", _v$10, _p$.h));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined,
      s: undefined,
      h: undefined
    });
    return _el$22;
  })();
}
function FooterHints(props) {
  return (() => {
    var _el$28 = _$createElement2("box");
    _$setProp2(_el$28, "style", {
      flexDirection: "row",
      paddingLeft: 2,
      paddingRight: 2
    });
    _$insert2(_el$28, _$createComponent2(For2, {
      each: footerHints,
      children: (h, i) => (() => {
        var _el$29 = _$createElement2("text"), _el$30 = _$createTextNode2(` `);
        _$insertNode2(_el$29, _el$30);
        _$insert2(_el$29, () => i() > 0 ? " · " : "", _el$30);
        _$insert2(_el$29, () => h.key, _el$30);
        _$insert2(_el$29, () => h.label, null);
        _$effect2((_$p) => _$setProp2(_el$29, "style", {
          fg: props.theme.tokens.dim
        }, _$p));
        return _el$29;
      })()
    }));
    return _el$28;
  })();
}
// ../kit/src/overlays.tsx
import { createTextNode as _$createTextNode3 } from "@opentui/solid";
import { setProp as _$setProp3 } from "@opentui/solid";
import { effect as _$effect3 } from "@opentui/solid";
import { insertNode as _$insertNode3 } from "@opentui/solid";
import { memo as _$memo2 } from "@opentui/solid";
import { createComponent as _$createComponent3 } from "@opentui/solid";
import { insert as _$insert3 } from "@opentui/solid";
import { createElement as _$createElement3 } from "@opentui/solid";
import { For as For3 } from "solid-js";
function ApprovalCard(props) {
  const th = () => props.theme;
  return (() => {
    var _el$0 = _$createElement3("box"), _el$1 = _$createElement3("text"), _el$10 = _$createTextNode3(`⚠ `), _el$11 = _$createElement3("text"), _el$12 = _$createElement3("text");
    _$insertNode3(_el$0, _el$1);
    _$insertNode3(_el$0, _el$11);
    _$insertNode3(_el$0, _el$12);
    _$insertNode3(_el$1, _el$10);
    _$insert3(_el$1, () => props.toolName, null);
    _$insert3(_el$11, () => props.args.slice(0, 200));
    _$insert3(_el$12, () => props.hint);
    _$effect3((_p$) => {
      var _v$5 = {
        border: true,
        borderStyle: "rounded",
        borderColor: th().tokens.approvalBorder ?? th().tokens.warn,
        flexDirection: "column",
        padding: 1
      }, _v$6 = {
        fg: th().tokens.warn
      }, _v$7 = {
        fg: th().tokens.dim
      };
      _v$5 !== _p$.e && (_p$.e = _$setProp3(_el$0, "style", _v$5, _p$.e));
      _v$6 !== _p$.t && (_p$.t = _$setProp3(_el$1, "style", _v$6, _p$.t));
      _v$7 !== _p$.a && (_p$.a = _$setProp3(_el$12, "style", _v$7, _p$.a));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined
    });
    return _el$0;
  })();
}
// ../kit/src/panels.tsx
import { createTextNode as _$createTextNode4 } from "@opentui/solid";
import { memo as _$memo3 } from "@opentui/solid";
import { createComponent as _$createComponent4 } from "@opentui/solid";
import { effect as _$effect4 } from "@opentui/solid";
import { insertNode as _$insertNode4 } from "@opentui/solid";
import { insert as _$insert4 } from "@opentui/solid";
import { setProp as _$setProp4 } from "@opentui/solid";
import { createElement as _$createElement4 } from "@opentui/solid";
import { For as For4, Show as Show2 } from "solid-js";
// ../kit/src/table.tsx
import { effect as _$effect5 } from "@opentui/solid";
import { insertNode as _$insertNode5 } from "@opentui/solid";
import { createComponent as _$createComponent5 } from "@opentui/solid";
import { insert as _$insert5 } from "@opentui/solid";
import { setProp as _$setProp5 } from "@opentui/solid";
import { createElement as _$createElement5 } from "@opentui/solid";
import { For as For5 } from "solid-js";
// ../kit/src/powerline.tsx
import { createTextNode as _$createTextNode5 } from "@opentui/solid";
import { insertNode as _$insertNode6 } from "@opentui/solid";
import { effect as _$effect6 } from "@opentui/solid";
import { insert as _$insert6 } from "@opentui/solid";
import { createComponent as _$createComponent6 } from "@opentui/solid";
import { setProp as _$setProp6 } from "@opentui/solid";
import { createElement as _$createElement6 } from "@opentui/solid";
import { For as For6, Show as Show3 } from "solid-js";
var POWERLINE_COLORS = {
  brand: "#4D6BFE",
  provider: "#6A1B9A",
  thinking: {
    off: "#616161",
    minimal: "#78909C",
    low: "#5C6BC0",
    medium: "#42A5F5",
    high: "#26A69A",
    xhigh: "#FFA726",
    max: "#EF5350"
  },
  contextOk: "#4CAF50",
  contextWarn: "#FFC107",
  contextOrange: "#FF9800",
  contextDanger: "#F44336",
  messages: "#1565C0",
  tools: "#E65100",
  speed: "#00897B"
};
var AUTO_FG_DARK = "#1a1a2e";
var AUTO_FG_LIGHT = "#ffffff";
function hexToRgb(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m)
    return [0, 0, 0];
  const n = m[1];
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}
function brightness(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
function autoContrast(bg) {
  return brightness(bg) > 0.6 ? AUTO_FG_DARK : AUTO_FG_LIGHT;
}
function PowerlineFooter(props) {
  return (() => {
    var _el$ = _$createElement6("box");
    _$setProp6(_el$, "style", {
      flexDirection: "row"
    });
    _$insert6(_el$, _$createComponent6(For6, {
      get each() {
        return props.left;
      },
      children: (seg, i) => {
        const next = () => props.left[i() + 1];
        return [(() => {
          var _el$4 = _$createElement6("text");
          _$insert6(_el$4, () => ` ${seg.text} `);
          _$effect6((_$p) => _$setProp6(_el$4, "style", {
            bg: seg.bg,
            fg: seg.fg ?? autoContrast(seg.bg)
          }, _$p));
          return _el$4;
        })(), _$createComponent6(Show3, {
          get when() {
            return next();
          },
          get fallback() {
            return (() => {
              var _el$5 = _$createElement6("text");
              _$insertNode6(_el$5, _$createTextNode5(``));
              _$effect6((_$p) => _$setProp6(_el$5, "style", {
                fg: seg.bg
              }, _$p));
              return _el$5;
            })();
          },
          children: (n) => (() => {
            var _el$7 = _$createElement6("text");
            _$insertNode6(_el$7, _$createTextNode5(``));
            _$effect6((_$p) => _$setProp6(_el$7, "style", {
              fg: seg.bg,
              bg: n().bg
            }, _$p));
            return _el$7;
          })()
        })];
      }
    }), null);
    _$insert6(_el$, _$createComponent6(Show3, {
      get when() {
        return props.right;
      },
      get children() {
        return [(() => {
          var _el$2 = _$createElement6("box");
          _$setProp6(_el$2, "style", {
            flexGrow: 1
          });
          return _el$2;
        })(), (() => {
          var _el$3 = _$createElement6("text");
          _$insert6(_el$3, () => props.right);
          _$effect6((_$p) => _$setProp6(_el$3, "style", {
            fg: props.theme.tokens.text
          }, _$p));
          return _el$3;
        })()];
      }
    }), null);
    return _el$;
  })();
}
function speedSegment(tps, theme) {
  if (tps === null || !Number.isFinite(tps) || tps < 0)
    return null;
  return {
    text: `⚡ ${Math.round(tps)} tok/s`,
    bg: POWERLINE_COLORS.speed
  };
}
// ../kit/src/welcome.tsx
import { effect as _$effect7 } from "@opentui/solid";
import { insert as _$insert7 } from "@opentui/solid";
import { createComponent as _$createComponent7 } from "@opentui/solid";
import { memo as _$memo4 } from "@opentui/solid";
import { createTextNode as _$createTextNode6 } from "@opentui/solid";
import { insertNode as _$insertNode7 } from "@opentui/solid";
import { setProp as _$setProp7 } from "@opentui/solid";
import { createElement as _$createElement7 } from "@opentui/solid";
import { For as For7 } from "solid-js";

// ../kit/src/quotes.ts
var DAILY_QUOTES = [
  "今天也要开开心心呀",
  "好事正在路上,慢慢来",
  "你比昨天又厉害了一点点",
  "元气满满,出发!",
  "微笑是今天最好的开场白",
  "深呼吸,一切都会好的",
  "今天的风也站在你这边",
  "今天的任务是:开心",
  "简单点,开心点",
  "把今天过成喜欢的样子",
  "摸鱼也是生产力的一部分",
  "代码能跑,就先别动它",
  "bug 是明天的,开心是今天的",
  "心情好,代码都少几个 bug",
  "万事开头难,然后就很爽",
  "先完成,再完美",
  "高手的秘诀:多练,多睡,多笑",
  "把烦恼丢进回收站,记得清空",
  "打不倒你的,都在给你攒经验值",
  "偶尔宕机,是为了更好地重启",
  "喝口热水,烦恼减半",
  "好好吃饭,是最朴素的浪漫",
  "一杯茶,一段好时光",
  "今天的你,值得一块小蛋糕",
  "难过的话,就先吃点甜的",
  "无论如何,先吃顿好的",
  "早餐吃好,一天都好",
  "泡面的三分钟,也值得期待",
  "微波炉叮的一声,是世界在说你好",
  "冬天的被窝,夏天的西瓜,都值得",
  "你已经在变好的路上了",
  "小小进度也是进度",
  "一步一步来,比较快",
  "别慌,月亮也在海上漂着呢",
  "会好的,而且会很好",
  "累了就休息,不是放弃",
  "你比你想象的更能扛",
  "别怕,大不了重新开始",
  "你努力的样子真的很酷",
  "今天的烦恼,明天看都是小事",
  "出太阳了,晒晒心情",
  "云是天空的小绵羊",
  "落日是白天的温柔谢幕",
  "面朝大海,春暖花开",
  "星星不会因为天黑就不亮",
  "春天在口袋里偷偷发芽",
  "晚风会把白天的疲惫吹走",
  "今天的花,今天开",
  "眼里有光,哪里都是舞台",
  "阳光免费,心情也免费",
  "允许自己摆烂五分钟",
  "偶尔发呆,是大脑在充电",
  "睡个好觉,明早又是新的",
  "别和自己较劲,和自己击个掌",
  "乖,摸摸头,没事的",
  "冷水洗脸,清醒又快乐",
  "遇到困难先睡一觉,明天再战",
  "唱歌跑调也要大声唱",
  "笑一笑,十年少,先笑为敬",
  "今天也记得夸夸自己",
  "你很重要,真的",
  "你的存在就是一件好事",
  "世界因你多了一点可爱",
  "你是自己的锦鲤",
  "你是限量版,全球仅此一件",
  "今天的你也很棒,辛苦啦",
  "你被这个世界温柔以待着",
  "世界很大,你的开心更大",
  "今天也是被宇宙爱着的一天",
  "好运正在派件,请保持好心情",
  "周五的下午,空气都是甜的",
  "咸鱼翻身,还是咸鱼,但很快乐",
  "猫一天要睡十六个小时,学着点",
  "今天适合听一首喜欢的歌",
  "今天适合提前十分钟下班",
  "计划表上写:今天要快乐",
  "心中有海,哪里都是马尔代夫",
  "偶尔迷路,才能遇到新风景",
  "跑起来,风就来了",
  "好天气是自己给的",
  "鲸鱼都要浮上来换气,你也歇会儿",
  "鲸鱼今天也在海里开心地游",
  "大海不急,鲸鱼也不急",
  "浪花拍岸,是海在鼓掌",
  "潜得深,是为了跳得高",
  "鲸鱼唱歌的频率,刚好治愈人心",
  "海的那边,还是海,还是很好玩",
  "潮水退了还会再来,好运也是",
  "风浪越大,鱼越贵,你越强",
  "今天的海是蓝色的,心情是彩色的",
  "保持热爱,奔赴山海",
  "生活明朗,万物可爱",
  "明天的你,会感谢今天没放弃的自己",
  "你种下的努力,正在发芽",
  "今天的运气藏在微笑里",
  "今日宜:喝茶,吹风,想点好事",
  "世界很大,幸福很小,但刚刚好",
  "快乐是可以自己生产的",
  "会有人因为遇见你而开心",
  "今天,也要记得喜欢自己呀"
];
function pickDailyQuote() {
  return DAILY_QUOTES[Math.floor(Math.random() * DAILY_QUOTES.length)];
}

// ../kit/src/welcome.tsx
var home = typeof process !== "undefined" && process.env.HOME || "";
function shortenCwd(cwd) {
  const short = home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
  if (short.length <= 60)
    return short;
  return `…${short.slice(-59)}`;
}
function WelcomeBanner(props) {
  const quote = pickDailyQuote();
  return (() => {
    var _el$ = _$createElement7("box"), _el$2 = _$createElement7("ascii_font"), _el$3 = _$createElement7("text"), _el$5 = _$createElement7("text"), _el$7 = _$createElement7("text"), _el$8 = _$createElement7("text"), _el$9 = _$createElement7("text");
    _$insertNode7(_el$, _el$2);
    _$insertNode7(_el$, _el$3);
    _$insertNode7(_el$, _el$5);
    _$insertNode7(_el$, _el$7);
    _$insertNode7(_el$, _el$8);
    _$insertNode7(_el$, _el$9);
    _$setProp7(_el$, "style", {
      flexDirection: "column",
      flexGrow: 1,
      justifyContent: "flex-start",
      alignItems: "flex-start",
      padding: 1
    });
    _$setProp7(_el$2, "text", "DSH OPENTUI");
    _$setProp7(_el$2, "font", "block");
    _$insertNode7(_el$3, _$createTextNode6(`plugins:`));
    _$insert7(_el$, _$createComponent7(For7, {
      get each() {
        return props.plugins ?? [];
      },
      children: (p) => (() => {
        var _el$1 = _$createElement7("text");
        _$insert7(_el$1, () => `  ● ${p.name}@${p.version}`);
        _$effect7((_$p) => _$setProp7(_el$1, "style", {
          fg: props.theme.tokens.dim
        }, _$p));
        return _el$1;
      })()
    }), _el$5);
    _$insertNode7(_el$5, _$createTextNode6(` `));
    _$insert7(_el$7, () => `${props.model} · ${shortenCwd(props.cwd)}`);
    _$insert7(_el$8, `\uD83D\uDC33 「${quote}」`);
    _$insertNode7(_el$9, _$createTextNode6(` `));
    _$effect7((_p$) => {
      var _v$ = POWERLINE_COLORS.brand, _v$2 = {
        fg: props.theme.tokens.dim
      }, _v$3 = {
        fg: props.theme.tokens.dim
      }, _v$4 = {
        fg: props.theme.tokens.dim
      };
      _v$ !== _p$.e && (_p$.e = _$setProp7(_el$2, "color", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp7(_el$3, "style", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp7(_el$7, "style", _v$3, _p$.a));
      _v$4 !== _p$.o && (_p$.o = _$setProp7(_el$8, "style", _v$4, _p$.o));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined
    });
    return _el$;
  })();
}
// ../kit/src/dock-widgets.tsx
import { createTextNode as _$createTextNode7 } from "@opentui/solid";
import { memo as _$memo5 } from "@opentui/solid";
import { setProp as _$setProp8 } from "@opentui/solid";
import { effect as _$effect8 } from "@opentui/solid";
import { insertNode as _$insertNode8 } from "@opentui/solid";
import { createComponent as _$createComponent8 } from "@opentui/solid";
import { insert as _$insert8 } from "@opentui/solid";
import { createElement as _$createElement8 } from "@opentui/solid";
import { For as For8, Show as Show4 } from "solid-js";
// ../kit/src/subagent-widget.tsx
import { setProp as _$setProp9 } from "@opentui/solid";
import { effect as _$effect9 } from "@opentui/solid";
import { insert as _$insert9 } from "@opentui/solid";
import { createElement as _$createElement9 } from "@opentui/solid";
import { createComponent as _$createComponent9 } from "@opentui/solid";
import { For as For9, Show as Show5 } from "solid-js";
var SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
var SPINNER_FPS = 8;
var ID_TAIL = 8;
var LAST_LINE_WIDTH = 80;
function spinnerFrame(elapsed) {
  return SPINNER_FRAMES[Math.floor(elapsed * SPINNER_FPS) % SPINNER_FRAMES.length];
}
function displayName(e) {
  if (e.label)
    return e.label;
  return e.id.length > ID_TAIL ? e.id.slice(-ID_TAIL) : e.id;
}
function metaSuffix(e) {
  const parts = [];
  if (e.model)
    parts.push(e.model);
  parts.push(`↻${e.rounds}`);
  parts.push(`${e.elapsed}s`);
  if (e.tokens !== undefined)
    parts.push(`${e.tokens} tok`);
  return parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
}
function tailLine(e) {
  return (e.lastLine ?? "").replace(/\s+/g, " ").trim().slice(0, LAST_LINE_WIDTH);
}
function SubagentWidget(props) {
  const th = () => props.theme;
  return _$createComponent9(Show5, {
    get when() {
      return props.entries.length > 0;
    },
    get children() {
      return _$createComponent9(For9, {
        get each() {
          return props.entries;
        },
        children: (e, i) => {
          const branch = () => i() === props.entries.length - 1 ? "└─" : "├─";
          const name = () => displayName(e);
          const meta = () => metaSuffix(e);
          const glyph = () => e.status === "completed" ? "✔" : e.status === "failed" ? "✘" : "⊘";
          return _$createComponent9(Show5, {
            get when() {
              return e.status === "running";
            },
            get fallback() {
              return (() => {
                var _el$3 = _$createElement9("text");
                _$insert9(_el$3, () => `${branch()} ${glyph()} ${name()}${meta()}`);
                _$effect9((_$p) => _$setProp9(_el$3, "style", {
                  fg: th().tokens.dim
                }, _$p));
                return _el$3;
              })();
            },
            get children() {
              return [(() => {
                var _el$ = _$createElement9("text");
                _$insert9(_el$, () => `${branch()} ${spinnerFrame(e.elapsed)} ${name()}${meta()}`);
                _$effect9((_$p) => _$setProp9(_el$, "style", {
                  fg: th().tokens.accent
                }, _$p));
                return _el$;
              })(), _$createComponent9(Show5, {
                get when() {
                  return tailLine(e).length > 0;
                },
                get children() {
                  var _el$2 = _$createElement9("text");
                  _$insert9(_el$2, () => `│   ${tailLine(e)}`);
                  _$effect9((_$p) => _$setProp9(_el$2, "style", {
                    fg: th().tokens.dim
                  }, _$p));
                  return _el$2;
                }
              })];
            }
          });
        }
      });
    }
  });
}
// ../kit/src/scroll.tsx
import { effect as _$effect10 } from "@opentui/solid";
import { insert as _$insert10 } from "@opentui/solid";
import { use as _$use2 } from "@opentui/solid";
import { setProp as _$setProp10 } from "@opentui/solid";
import { createElement as _$createElement10 } from "@opentui/solid";
// ../kit/src/select.tsx
import { createComponent as _$createComponent10 } from "@opentui/solid";
import { effect as _$effect11 } from "@opentui/solid";
import { createTextNode as _$createTextNode8 } from "@opentui/solid";
import { insertNode as _$insertNode9 } from "@opentui/solid";
import { insert as _$insert11 } from "@opentui/solid";
import { setProp as _$setProp11 } from "@opentui/solid";
import { createElement as _$createElement11 } from "@opentui/solid";
import { Show as Show6, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
var MAX_VISIBLE_ITEMS2 = 12;
var FALLBACK_SELECTION_BG = "#313244";
var clamp = (v, n) => n === 0 ? 0 : Math.max(0, Math.min(n - 1, v));
function Select(props) {
  const [index, setIndex] = createSignal(0);
  let lastFire = 0;
  const fire = (i) => {
    const opt = options()[i];
    if (!opt)
      return;
    const now = Date.now();
    if (now - lastFire < 250)
      return;
    lastFire = now;
    props.onSelect(String(opt.value));
  };
  useKeyboard((key) => {
    const n = props.items.length;
    if (key.name === "escape") {
      key.preventDefault?.();
      return props.onCancel();
    }
    if (n === 0)
      return;
    if (key.name === "up") {
      key.preventDefault?.();
      const v = (index() - 1 + n) % n;
      setIndex(v);
      props.onPreview?.(props.items[v]?.value ?? "");
      return;
    }
    if (key.name === "down") {
      key.preventDefault?.();
      const v = (index() + 1) % n;
      setIndex(v);
      props.onPreview?.(props.items[v]?.value ?? "");
      return;
    }
    if (key.name === "return" || key.name === "enter") {
      key.preventDefault?.();
      fire(clamp(index(), n));
    }
  });
  const th = () => props.theme;
  const options = () => props.items.map((it) => ({
    name: it.label,
    description: [it.group, it.description].filter(Boolean).join(" · "),
    value: it.value
  }));
  const hasDescriptions = () => props.items.some((it) => Boolean(it.description || it.group));
  const linesPerItem = () => hasDescriptions() ? 2 : 1;
  const visibleItems = () => Math.min(props.items.length, MAX_VISIBLE_ITEMS2);
  return _$createComponent10(Show6, {
    get when() {
      return props.items.length > 0;
    },
    get children() {
      var _el$ = _$createElement11("box"), _el$2 = _$createElement11("box"), _el$3 = _$createElement11("text"), _el$4 = _$createElement11("box"), _el$5 = _$createElement11("text"), _el$7 = _$createElement11("select");
      _$insertNode9(_el$, _el$2);
      _$insertNode9(_el$, _el$7);
      _$insertNode9(_el$2, _el$3);
      _$insertNode9(_el$2, _el$4);
      _$insertNode9(_el$2, _el$5);
      _$setProp11(_el$2, "style", {
        flexDirection: "row"
      });
      _$insert11(_el$3, () => props.title);
      _$setProp11(_el$4, "style", {
        flexGrow: 1
      });
      _$insertNode9(_el$5, _$createTextNode8(`↑↓ move · enter select · esc cancel`));
      _$setProp11(_el$7, "focused", true);
      _$setProp11(_el$7, "width", "100%");
      _$setProp11(_el$7, "onSelect", (i, option) => {
        if (option)
          fire(i ?? clamp(index(), props.items.length));
      });
      _$effect11((_p$) => {
        var _v$ = {
          border: true,
          borderStyle: "rounded",
          borderColor: th().tokens.border,
          flexDirection: "column",
          padding: 1
        }, _v$2 = {
          fg: th().tokens.accent
        }, _v$3 = {
          fg: th().tokens.dim
        }, _v$4 = options(), _v$5 = clamp(index(), props.items.length), _v$6 = visibleItems() * linesPerItem(), _v$7 = th().tokens.text, _v$8 = th().tokens.dim, _v$9 = th().tokens.selection ?? FALLBACK_SELECTION_BG, _v$0 = th().tokens.text, _v$1 = th().tokens.selection ?? FALLBACK_SELECTION_BG, _v$10 = th().tokens.text, _v$11 = hasDescriptions(), _v$12 = props.items.length > visibleItems();
        _v$ !== _p$.e && (_p$.e = _$setProp11(_el$, "style", _v$, _p$.e));
        _v$2 !== _p$.t && (_p$.t = _$setProp11(_el$3, "style", _v$2, _p$.t));
        _v$3 !== _p$.a && (_p$.a = _$setProp11(_el$5, "style", _v$3, _p$.a));
        _v$4 !== _p$.o && (_p$.o = _$setProp11(_el$7, "options", _v$4, _p$.o));
        _v$5 !== _p$.i && (_p$.i = _$setProp11(_el$7, "selectedIndex", _v$5, _p$.i));
        _v$6 !== _p$.n && (_p$.n = _$setProp11(_el$7, "height", _v$6, _p$.n));
        _v$7 !== _p$.s && (_p$.s = _$setProp11(_el$7, "textColor", _v$7, _p$.s));
        _v$8 !== _p$.h && (_p$.h = _$setProp11(_el$7, "descriptionColor", _v$8, _p$.h));
        _v$9 !== _p$.r && (_p$.r = _$setProp11(_el$7, "focusedBackgroundColor", _v$9, _p$.r));
        _v$0 !== _p$.d && (_p$.d = _$setProp11(_el$7, "focusedTextColor", _v$0, _p$.d));
        _v$1 !== _p$.l && (_p$.l = _$setProp11(_el$7, "selectedBackgroundColor", _v$1, _p$.l));
        _v$10 !== _p$.u && (_p$.u = _$setProp11(_el$7, "selectedTextColor", _v$10, _p$.u));
        _v$11 !== _p$.c && (_p$.c = _$setProp11(_el$7, "showDescription", _v$11, _p$.c));
        _v$12 !== _p$.w && (_p$.w = _$setProp11(_el$7, "showScrollIndicator", _v$12, _p$.w));
        return _p$;
      }, {
        e: undefined,
        t: undefined,
        a: undefined,
        o: undefined,
        i: undefined,
        n: undefined,
        s: undefined,
        h: undefined,
        r: undefined,
        d: undefined,
        l: undefined,
        u: undefined,
        c: undefined,
        w: undefined
      });
      return _el$;
    }
  });
}
// ../kit/src/todos.tsx
import { setProp as _$setProp12 } from "@opentui/solid";
import { effect as _$effect12 } from "@opentui/solid";
import { insert as _$insert12 } from "@opentui/solid";
import { createElement as _$createElement12 } from "@opentui/solid";
import { createComponent as _$createComponent11 } from "@opentui/solid";
import { For as For10 } from "solid-js";
var MAX_ROWS = 5;
var STATUS_GLYPH = {
  pending: "☐",
  in_progress: "▶",
  completed: "☑"
};
function sortTodos(todos) {
  const rank = (t) => t.status === "in_progress" ? 0 : t.status === "pending" ? 1 : 2;
  const completed = todos.filter((t) => t.status === "completed");
  return [...todos].sort((a, b) => rank(a) - rank(b) || completed.indexOf(b) - completed.indexOf(a));
}
function TodosWidget(props) {
  const th = () => props.theme;
  const visible = () => sortTodos(props.todos).slice(0, MAX_ROWS);
  const remaining = () => Math.max(0, props.todos.length - visible().length);
  const active = () => props.todos.some((t) => t.status === "in_progress" || t.status === "pending");
  return _$createComponent11(For10, {
    get each() {
      return visible();
    },
    children: (t, i) => (() => {
      var _el$ = _$createElement12("text");
      _$insert12(_el$, () => `${i() === 0 && active() ? "\uD83D\uDCCB " : "   "}${STATUS_GLYPH[t.status]} ${t.content}${i() === visible().length - 1 && remaining() > 0 ? ` (+${remaining()})` : ""}`);
      _$effect12((_$p) => _$setProp12(_el$, "style", {
        fg: t.status === "completed" ? th().tokens.dim : t.status === "in_progress" ? th().tokens.accent : th().tokens.text
      }, _$p));
      return _el$;
    })()
  });
}
// ../kit/src/widget-frame.tsx
import { insertNode as _$insertNode10 } from "@opentui/solid";
import { createComponent as _$createComponent12 } from "@opentui/solid";
import { setProp as _$setProp13 } from "@opentui/solid";
import { effect as _$effect13 } from "@opentui/solid";
import { insert as _$insert13 } from "@opentui/solid";
import { memo as _$memo6 } from "@opentui/solid";
import { createElement as _$createElement13 } from "@opentui/solid";
import { Show as Show7 } from "solid-js";
function dimColor(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.round(v * (1 - k)).toString(16).padStart(2, "0");
  return `#${f(n >> 16 & 255)}${f(n >> 8 & 255)}${f(n & 255)}`;
}
function widgetRows(size) {
  return size === "full" ? 14 : size;
}
function WidgetFrame(props) {
  const fade = () => Math.min(1, Math.max(0, props.fade ?? 0));
  const accent = () => dimColor(props.accent, fade());
  const rows = () => Math.max(fade() >= 1 ? 0 : 1, Math.round(widgetRows(props.size) * (1 - fade())));
  const bordered = () => widgetRows(props.size) > 1 && rows() > 1;
  return _$createComponent12(Show7, {
    get when() {
      return rows() > 0;
    },
    get children() {
      var _el$ = _$createElement13("box");
      _$insert13(_el$, (() => {
        var _c$ = _$memo6(() => rows() === 1);
        return () => _c$() ? (() => {
          var _el$2 = _$createElement13("box"), _el$3 = _$createElement13("box"), _el$4 = _$createElement13("text");
          _$insertNode10(_el$2, _el$3);
          _$insertNode10(_el$2, _el$4);
          _$setProp13(_el$2, "style", {
            flexDirection: "row"
          });
          _$setProp13(_el$3, "style", {
            flexDirection: "row",
            flexGrow: 1
          });
          _$insert13(_el$3, () => props.children);
          _$insert13(_el$4, () => props.hint ?? "");
          _$effect13((_$p) => _$setProp13(_el$4, "style", {
            fg: dimColor(accent(), 0.25)
          }, _$p));
          return _el$2;
        })() : [_$memo6(() => _$memo6(() => !!(props.title || props.hint))() ? (() => {
          var _el$5 = _$createElement13("box"), _el$6 = _$createElement13("text"), _el$7 = _$createElement13("box"), _el$8 = _$createElement13("text");
          _$insertNode10(_el$5, _el$6);
          _$insertNode10(_el$5, _el$7);
          _$insertNode10(_el$5, _el$8);
          _$setProp13(_el$5, "style", {
            flexDirection: "row"
          });
          _$insert13(_el$6, () => props.title);
          _$setProp13(_el$7, "style", {
            flexGrow: 1
          });
          _$insert13(_el$8, () => props.hint);
          _$effect13((_p$) => {
            var _v$ = {
              fg: accent(),
              wrapMode: "none",
              truncate: true
            }, _v$2 = {
              fg: dimColor(accent(), 0.25)
            };
            _v$ !== _p$.e && (_p$.e = _$setProp13(_el$6, "style", _v$, _p$.e));
            _v$2 !== _p$.t && (_p$.t = _$setProp13(_el$8, "style", _v$2, _p$.t));
            return _p$;
          }, {
            e: undefined,
            t: undefined
          });
          return _el$5;
        })() : null), _$memo6(() => props.children)];
      })());
      _$effect13((_$p) => _$setProp13(_el$, "style", {
        flexDirection: "column",
        flexGrow: 0,
        height: rows(),
        ...props.bg ? {
          backgroundColor: props.bg
        } : {},
        ...bordered() ? {
          border: true,
          borderStyle: "rounded",
          borderColor: accent()
        } : {},
        padding: 0
      }, _$p));
      return _el$;
    }
  });
}
// src/features/model-select.tsx
function createModelSelectFeature(deps) {
  let catalog = [];
  const refresh = async () => {
    try {
      catalog = await deps.session.listProviders();
    } catch {
      catalog = [];
    }
  };
  return {
    async open(openOverlay) {
      await refresh();
      const current = deps.label();
      const fav = deps.config()?.favoriteModels ?? [];
      const hidden = deps.config()?.hiddenModels ?? [];
      openOverlay({
        title: deps.t("picker.model.title"),
        items: catalog.flatMap((p) => p.models.filter((m) => !hidden.includes(`${p.provider}/${m}`)).map((m) => {
          const id = `${p.provider}/${m}`;
          const isFav = fav.includes(id);
          return {
            label: isFav ? `★ ${m}` : m,
            group: p.provider,
            value: id,
            ...id === current ? {
              description: deps.t("cmd.model.current")
            } : {}
          };
        })).sort((a, b) => Number(fav.includes(`${b.group}/${b.value}`)) - Number(fav.includes(`${a.group}/${a.value}`))),
        onSelect: (value) => {
          const [provider, model] = value.split("/");
          if (!provider || !model)
            return;
          openOverlay({
            title: deps.t("picker.effort.title", {
              model
            }),
            items: EFFORTS.map((e) => ({
              label: e,
              value: e,
              description: deps.t(`picker.effort.${e}.desc`)
            })),
            onSelect: (effortValue) => {
              const effort = effortValue === "keep" ? undefined : effortValue;
              deps.session.switchModel(provider, model, effort);
              deps.setLabel(deps.session.label);
              deps.push({
                kind: "system",
                text: `${deps.t("cmd.model.set")} ${provider}/${model}${effort ? ` (${effort})` : ""} ${deps.t("cmd.model.next")}`
              });
            }
          });
        }
      });
    },
    direct(provider, model) {
      if (!provider || !model) {
        deps.push({
          kind: "error",
          text: "usage: /model provider/model-id"
        });
        return;
      }
      deps.session.switchModel(provider, model);
      deps.setLabel(deps.session.label);
      deps.push({
        kind: "system",
        text: `${deps.t("cmd.model.set")} ${provider}/${model} ${deps.t("cmd.model.next")}`
      });
    }
  };
}
var EFFORTS = ["keep", "low", "medium", "high", "xhigh", "max"];

// src/features/theme-select.tsx
function createThemeSelectFeature(deps) {
  return {
    open(openOverlay) {
      const previous = deps.themeName();
      openOverlay({
        title: deps.t("picker.theme.title"),
        items: themeNames().map((x) => ({
          label: x.name,
          group: x.dark ? "dark" : "light",
          value: x.name,
          ...x.name === deps.themeName() ? {
            description: deps.t("cmd.model.current")
          } : {}
        })),
        onPreview: (value) => deps.setThemeName(value),
        onSelect: (value) => deps.setThemeName(value),
        onCancel: () => deps.setThemeName(previous)
      });
    }
  };
}

// src/features/history-fork.tsx
function createHistoryForkFeature(deps) {
  return {
    open(openOverlay) {
      const turns = deps.session.historyTurns();
      if (turns.length === 0) {
        deps.push({
          kind: "system",
          text: "no completed turns yet"
        });
        return;
      }
      openOverlay({
        title: deps.t("picker.history.title"),
        items: [...turns].reverse().map((tn) => ({
          label: `#${tn.turn} ${tn.preview.slice(0, 46) || "(no text)"}`,
          value: String(tn.seqEnd),
          description: "fork before this turn"
        })),
        onSelect: async (value) => {
          try {
            const forked = await deps.session.forkAtTurn(Number(value));
            deps.setItems(forked.items.map((it) => it.kind === "assistant" ? {
              kind: "assistant",
              text: it.text,
              final: true
            } : {
              kind: "user",
              text: it.text
            }));
            deps.resetDock();
            deps.onForked();
            deps.push({
              kind: "system",
              text: `⑂ forked at turn boundary — reply continues from here`
            });
          } catch (e) {
            deps.push({
              kind: "error",
              text: String(e instanceof Error ? e.message : e).slice(0, 300)
            });
          }
        }
      });
    }
  };
}

// src/features/login.tsx
import { setProp as _$setProp14 } from "@opentui/solid";
import { effect as _$effect14 } from "@opentui/solid";
import { createTextNode as _$createTextNode9 } from "@opentui/solid";
import { insertNode as _$insertNode11 } from "@opentui/solid";
import { memo as _$memo7 } from "@opentui/solid";
import { insert as _$insert14 } from "@opentui/solid";
import { createElement as _$createElement14 } from "@opentui/solid";
import { createComponent as _$createComponent13 } from "@opentui/solid";
import { createSignal as createSignal2 } from "solid-js";
var PROVIDER_CATALOG = [{
  id: "amazon-bedrock",
  name: "Amazon Bedrock",
  hint: "aws route",
  catalogRoute: true
}, {
  id: "ant-ling",
  name: "Ant Ling",
  hint: "api key",
  catalogRoute: true
}, {
  id: "anthropic",
  name: "Anthropic",
  hint: "api key",
  catalogRoute: true
}, {
  id: "azure-openai-responses",
  name: "Azure OpenAI",
  hint: "api key",
  catalogRoute: true
}, {
  id: "cerebras",
  name: "Cerebras",
  hint: "api key",
  catalogRoute: true
}, {
  id: "cloudflare-ai-gateway",
  name: "Cloudflare AI Gateway",
  hint: "api key",
  catalogRoute: true
}, {
  id: "cloudflare-workers-ai",
  name: "Cloudflare Workers AI",
  hint: "api key",
  catalogRoute: true
}, {
  id: "deepseek",
  name: "DeepSeek",
  hint: "api key",
  catalogRoute: true
}, {
  id: "fireworks",
  name: "Fireworks",
  hint: "api key",
  catalogRoute: true
}, {
  id: "github-copilot",
  name: "GitHub Copilot",
  hint: "provcatalog.hint.copilot",
  catalogRoute: true
}, {
  id: "google",
  name: "Google Gemini",
  hint: "api key",
  catalogRoute: true
}, {
  id: "google-vertex",
  name: "Google Vertex AI",
  hint: "provcatalog.hint.googleCloud",
  catalogRoute: true
}, {
  id: "groq",
  name: "Groq",
  hint: "api key",
  catalogRoute: true
}, {
  id: "huggingface",
  name: "Hugging Face",
  hint: "provcatalog.hint.huggingface",
  catalogRoute: true
}, {
  id: "kimi-coding",
  name: "Kimi For Coding",
  hint: "api key",
  catalogRoute: true
}, {
  id: "minimax",
  name: "MiniMax",
  hint: "api key",
  catalogRoute: true
}, {
  id: "minimax-cn",
  name: "MiniMax CN",
  hint: "api key",
  catalogRoute: true
}, {
  id: "mistral",
  name: "Mistral",
  hint: "api key",
  catalogRoute: true
}, {
  id: "moonshotai",
  name: "Moonshot AI",
  hint: "api key",
  catalogRoute: true
}, {
  id: "moonshotai-cn",
  name: "Moonshot AI CN",
  hint: "api key",
  catalogRoute: true
}, {
  id: "nvidia",
  name: "NVIDIA",
  hint: "api key",
  catalogRoute: true
}, {
  id: "openai",
  name: "OpenAI",
  hint: "api key",
  catalogRoute: true
}, {
  id: "opencode-go",
  name: "OpenCode Go",
  hint: "api key.gateway",
  catalogRoute: true
}, {
  id: "opencode",
  name: "OpenCode Zen",
  hint: "api key",
  catalogRoute: true
}, {
  id: "openrouter",
  name: "OpenRouter",
  hint: "api key",
  catalogRoute: true
}, {
  id: "qwen-token-plan",
  name: "Qwen Token Plan",
  hint: "api key",
  catalogRoute: true
}, {
  id: "qwen-token-plan-cn",
  name: "Qwen Token Plan CN",
  hint: "api key",
  catalogRoute: true
}, {
  id: "together",
  name: "Together AI",
  hint: "api key",
  catalogRoute: true
}, {
  id: "vercel-ai-gateway",
  name: "Vercel AI Gateway",
  hint: "api key",
  catalogRoute: true
}, {
  id: "xiaomi",
  name: "Xiaomi",
  hint: "api key",
  catalogRoute: true
}, {
  id: "xiaomi-token-plan-ams",
  name: "Xiaomi Token Plan AMS",
  hint: "api key",
  catalogRoute: true
}, {
  id: "xiaomi-token-plan-cn",
  name: "Xiaomi Token Plan CN",
  hint: "api key",
  catalogRoute: true
}, {
  id: "xiaomi-token-plan-sgp",
  name: "Xiaomi Token Plan SGP",
  hint: "api key",
  catalogRoute: true
}, {
  id: "zai",
  name: "Z.AI",
  hint: "api key",
  catalogRoute: true
}, {
  id: "zai-coding-cn",
  name: "Z.AI Coding CN",
  hint: "api key",
  catalogRoute: true
}, {
  id: "xai",
  name: "xAI",
  hint: "api key",
  catalogRoute: true
}];
var CUSTOM = {
  id: "custom",
  name: "Custom provider",
  hint: "baseUrl + model + key",
  catalogRoute: false
};
function deriveKeyRef(provider) {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
}
function providerProfileFor(entry) {
  const profile = {
    apiKeyEnv: deriveKeyRef(entry.id)
  };
  if (!entry.catalogRoute) {
    if (entry.api)
      profile.api = entry.api;
    if (entry.baseURL)
      profile.baseURL = entry.baseURL;
    if (entry.models)
      profile.models = entry.models;
    if (entry.displayName)
      profile.displayName = entry.displayName;
  }
  return profile;
}
function createLoginFeature(deps) {
  const [stage, setStage] = createSignal2({
    kind: "closed"
  });
  const settings = () => deps.session.settingsSeam;
  const writeRoute = async (op, entry) => {
    const st = settings();
    if (!st)
      return;
    try {
      const entries = await st.describe();
      const desc = Array.isArray(entries) ? entries.find((e) => e?.ns === "llm-pi-ai") : undefined;
      const ops = op === "set" ? [{
        op: "set",
        path: ["providers", entry.id],
        value: providerProfileFor(entry)
      }] : [{
        op: "unset",
        path: ["providers", entry.id]
      }];
      await st.mutate("llm-pi-ai", ops, desc?.revision);
      return;
    } catch (e) {
      return String(e instanceof Error ? e.message : e).slice(0, 200);
    }
  };
  const commitLogin = async (entry, key) => {
    setStage({
      kind: "closed"
    });
    const routeError = await writeRoute("set", entry);
    if (routeError) {
      deps.push({
        kind: "error",
        text: `${entry.id}: ${routeError}`
      });
      return;
    }
    try {
      await deps.session.login(deriveKeyRef(entry.id), key);
      deps.push({
        kind: "system",
        text: `${entry.name} subscribed — key stored, route registered (in /model next session)`
      });
    } catch (e) {
      deps.push({
        kind: "error",
        text: String(e instanceof Error ? e.message : e).slice(0, 200)
      });
    }
  };
  const commitLogout = async (id) => {
    setStage({
      kind: "closed"
    });
    const routeError = await writeRoute("unset", {
      id,
      name: id,
      hint: "",
      catalogRoute: true
    });
    try {
      await deps.session.logout(deriveKeyRef(id));
    } catch (e) {
      deps.push({
        kind: "error",
        text: `key removal failed: ${String(e instanceof Error ? e.message : e).slice(0, 150)}`
      });
    }
    if (routeError)
      deps.push({
        kind: "error",
        text: `${id}: ${routeError}`
      });
    else
      deps.push({
        kind: "system",
        text: `${id} unsubscribed — route and key removed`
      });
  };
  const openMenu = async (mode) => {
    const st = settings();
    let configuredRoutes = [];
    try {
      const entries = await st?.describe();
      const desc = Array.isArray(entries) ? entries.find((e) => e?.ns === "llm-pi-ai") : undefined;
      configuredRoutes = Object.keys(desc?.value?.providers ?? {});
    } catch {}
    if (mode === "logout") {
      if (configuredRoutes.length === 0) {
        setStage({
          kind: "notice",
          text: "no subscribed providers to log out"
        });
        return;
      }
      setStage({
        kind: "menu",
        title: "log out — pick a provider (removes route + key)",
        items: configuredRoutes.map((id) => ({
          label: id,
          value: id
        })),
        onPick: (id) => setStage({
          kind: "confirm",
          text: `unsubscribe ${id}? (route + key removed)`,
          onYes: () => void commitLogout(id)
        })
      });
      return;
    }
    setStage({
      kind: "menu",
      title: "log in — pick a provider",
      items: [...PROVIDER_CATALOG, CUSTOM].map((e) => ({
        label: e.name,
        group: e.catalogRoute ? "api key" : "hand-declared",
        value: e.id,
        description: e.hint
      })),
      onPick: (id) => {
        if (id === CUSTOM.id) {
          setStage({
            kind: "entry",
            title: "custom provider baseUrl",
            mask: false,
            buffer: "",
            onCommit: (base) => {
              setStage({
                kind: "entry",
                title: "model ids (comma-separated)",
                mask: false,
                buffer: "",
                onCommit: (models) => {
                  setStage({
                    kind: "entry",
                    title: "custom provider id (route key)",
                    mask: false,
                    buffer: "",
                    onCommit: (pid) => {
                      const entry = {
                        id: pid.trim() || "custom",
                        name: pid.trim() || "custom",
                        hint: "custom",
                        catalogRoute: false,
                        api: "openai-completions",
                        baseURL: base.trim(),
                        models: models.split(",").map((m) => ({
                          id: m.trim()
                        })).filter((m) => m.id),
                        displayName: pid.trim()
                      };
                      setStage({
                        kind: "entry",
                        title: `API key for ${entry.id}`,
                        mask: true,
                        buffer: "",
                        onCommit: (key) => void commitLogin(entry, key)
                      });
                    }
                  });
                }
              });
            }
          });
          return;
        }
        const entry = PROVIDER_CATALOG.find((e) => e.id === id);
        setStage({
          kind: "entry",
          title: `API key for ${entry.name} (${deriveKeyRef(entry.id)})`,
          mask: true,
          buffer: "",
          onCommit: (key) => void commitLogin(entry, key)
        });
      }
    });
  };
  const view = () => {
    const st = stage();
    const th = deps.theme();
    if (st.kind === "menu") {
      return _$createComponent13(Select, {
        get title() {
          return st.title;
        },
        get items() {
          return st.items;
        },
        theme: th,
        onSelect: (v) => {
          setStage({
            kind: "closed"
          });
          st.onPick(v);
        },
        onCancel: () => setStage({
          kind: "closed"
        })
      });
    }
    if (st.kind === "entry") {
      return (() => {
        var _el$ = _$createElement14("box"), _el$2 = _$createElement14("text"), _el$3 = _$createElement14("text"), _el$4 = _$createElement14("text");
        _$insertNode11(_el$, _el$2);
        _$insertNode11(_el$, _el$3);
        _$insertNode11(_el$, _el$4);
        _$insert14(_el$2, () => st.title);
        _$insert14(_el$3, (() => {
          var _c$ = _$memo7(() => !!st.mask);
          return () => _c$() ? st.buffer.replace(/./g, "*") || " " : st.buffer || " ";
        })());
        _$insertNode11(_el$4, _$createTextNode9(`type · enter saves · esc cancels`));
        _$effect14((_p$) => {
          var _v$ = {
            border: true,
            borderStyle: "rounded",
            borderColor: th.tokens.border,
            flexDirection: "column",
            padding: 1
          }, _v$2 = {
            fg: th.tokens.accent
          }, _v$3 = {
            fg: th.tokens.text
          }, _v$4 = {
            fg: th.tokens.dim
          };
          _v$ !== _p$.e && (_p$.e = _$setProp14(_el$, "style", _v$, _p$.e));
          _v$2 !== _p$.t && (_p$.t = _$setProp14(_el$2, "style", _v$2, _p$.t));
          _v$3 !== _p$.a && (_p$.a = _$setProp14(_el$3, "style", _v$3, _p$.a));
          _v$4 !== _p$.o && (_p$.o = _$setProp14(_el$4, "style", _v$4, _p$.o));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined,
          o: undefined
        });
        return _el$;
      })();
    }
    if (st.kind === "confirm") {
      return (() => {
        var _el$6 = _$createElement14("box"), _el$7 = _$createElement14("text"), _el$8 = _$createElement14("text");
        _$insertNode11(_el$6, _el$7);
        _$insertNode11(_el$6, _el$8);
        _$insert14(_el$7, () => st.text);
        _$insertNode11(_el$8, _$createTextNode9(`y confirm · n/esc cancels`));
        _$effect14((_p$) => {
          var _v$5 = {
            border: true,
            borderStyle: "rounded",
            borderColor: th.tokens.warn,
            flexDirection: "column",
            padding: 1
          }, _v$6 = {
            fg: th.tokens.warn
          }, _v$7 = {
            fg: th.tokens.dim
          };
          _v$5 !== _p$.e && (_p$.e = _$setProp14(_el$6, "style", _v$5, _p$.e));
          _v$6 !== _p$.t && (_p$.t = _$setProp14(_el$7, "style", _v$6, _p$.t));
          _v$7 !== _p$.a && (_p$.a = _$setProp14(_el$8, "style", _v$7, _p$.a));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined
        });
        return _el$6;
      })();
    }
    if (st.kind === "notice") {
      return (() => {
        var _el$0 = _$createElement14("box"), _el$1 = _$createElement14("text");
        _$insertNode11(_el$0, _el$1);
        _$insert14(_el$1, () => st.text);
        _$effect14((_p$) => {
          var _v$8 = {
            border: true,
            borderStyle: "rounded",
            borderColor: th.tokens.border,
            flexDirection: "column",
            padding: 1
          }, _v$9 = {
            fg: th.tokens.dim
          };
          _v$8 !== _p$.e && (_p$.e = _$setProp14(_el$0, "style", _v$8, _p$.e));
          _v$9 !== _p$.t && (_p$.t = _$setProp14(_el$1, "style", _v$9, _p$.t));
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        return _el$0;
      })();
    }
    return null;
  };
  const handleKey = (key) => {
    const st = stage();
    if (st.kind === "closed")
      return false;
    if (st.kind === "entry") {
      if (key.name === "escape") {
        setStage({
          kind: "closed"
        });
        return true;
      }
      if (key.name === "return") {
        const v = st.buffer;
        st.onCommit(v);
        return true;
      }
      if (key.name === "backspace") {
        setStage({
          ...st,
          buffer: st.buffer.slice(0, -1)
        });
        return true;
      }
      const ch = key.sequence ?? "";
      if (ch.length === 1 && /[\x20-\x7e]/.test(ch)) {
        setStage({
          ...st,
          buffer: st.buffer + ch
        });
        return true;
      }
      return true;
    }
    if (st.kind === "confirm") {
      if (key.sequence === "y") {
        st.onYes();
        return true;
      }
      if (key.sequence === "n" || key.name === "escape") {
        setStage({
          kind: "closed"
        });
        return true;
      }
      return true;
    }
    if (st.kind === "notice") {
      setStage({
        kind: "closed"
      });
      return true;
    }
    return false;
  };
  return {
    view,
    open: openMenu,
    handleKey,
    active: () => stage().kind !== "closed" && stage().kind !== "menu",
    panelOpen: () => stage().kind !== "closed"
  };
}

// src/features/dock.tsx
import { setProp as _$setProp15 } from "@opentui/solid";
import { effect as _$effect15 } from "@opentui/solid";
import { insert as _$insert15 } from "@opentui/solid";
import { createTextNode as _$createTextNode10 } from "@opentui/solid";
import { insertNode as _$insertNode12 } from "@opentui/solid";
import { createElement as _$createElement15 } from "@opentui/solid";
import { createComponent as _$createComponent14 } from "@opentui/solid";
import { memo as _$memo8 } from "@opentui/solid";
import { createSignal as createSignal3, For as For11, Show as Show8 } from "solid-js";
var FLUSH_MS = 60;
var FADE_STEP_MS = 130;
var FADE_STEPS = 5;
var SPINNER_FRAMES2 = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
function createDockFeature(deps) {
  const th = () => deps.theme();
  const thinkFg = () => th().tokens.thinking ?? th().tokens.accent;
  const toolFg = () => th().tokens.toolOk ?? th().tokens.ok;
  const dim = (fg) => dimColor(fg, 0.45);
  const [think, setThink] = createSignal3({
    visible: false,
    expanded: false,
    fading: false,
    fade: 0,
    text: "",
    lastAt: 0,
    startedAt: 0
  });
  let thinkBuf = "";
  let lastFlush = 0;
  let thinkOpen = false;
  const [tools, setTools] = createSignal3([]);
  const [toolVisible, setToolVisible] = createSignal3(false);
  const [toolFading, setToolFading] = createSignal3(false);
  const [toolFade, setToolFade] = createSignal3(0);
  const [toolExpanded, setToolExpanded] = createSignal3(false);
  let lastToolAt = 0;
  let thinkHideTimer;
  const cancelThinkHide = () => {
    if (thinkHideTimer !== undefined) {
      clearTimeout(thinkHideTimer);
      thinkHideTimer = undefined;
    }
  };
  const scheduleThinkHide = (delayMs = 1800) => {
    cancelThinkHide();
    thinkHideTimer = setTimeout(() => {
      thinkHideTimer = undefined;
      startThinkFade();
    }, delayMs);
  };
  const flush = (force = false) => {
    const now = Date.now();
    if (!force && now - lastFlush < FLUSH_MS)
      return;
    lastFlush = now;
    setThink((s) => s.visible ? {
      ...s,
      text: thinkBuf
    } : s);
  };
  const fadeTimer = setInterval(() => {
    setThink((s) => {
      if (!s.fading)
        return s;
      const f = Math.min(1, s.fade + 1 / FADE_STEPS);
      return f >= 1 ? {
        visible: false,
        expanded: false,
        fading: false,
        fade: 0,
        text: "",
        lastAt: 0,
        startedAt: 0
      } : {
        ...s,
        fade: f
      };
    });
    if (toolFading()) {
      const f = Math.min(1, toolFade() + 1 / FADE_STEPS);
      if (f >= 1) {
        setToolFading(false);
        setToolFade(0);
        setToolVisible(false);
        setTools([]);
      } else
        setToolFade(f);
    }
  }, FADE_STEP_MS);
  const startThinkFade = () => setThink((s) => ({
    ...s,
    visible: true,
    fading: true,
    fade: 0,
    expanded: false
  }));
  const dockView = () => {
    const t = think();
    const list = tools();
    const rowsT = deps.sizes?.().think ?? 7;
    const rowsTool = deps.sizes?.().tool ?? 7;
    const hints = deps.hints?.() ?? {};
    const elapsed = t.startedAt ? Math.floor((Date.now() - t.startedAt) / 1000) : 0;
    const running = list.filter((e) => e.status === "running");
    const frame = SPINNER_FRAMES2[Math.floor(Date.now() / 125 % SPINNER_FRAMES2.length)];
    const bgTint = () => {
      const st = deps.style?.() ?? {};
      const override = t.visible ? st.thinkBg : st.toolBg;
      if (override && override !== "auto")
        return override;
      const border = t.visible ? thinkFg() : toolFg();
      return dimColor(border, 0.82);
    };
    return [_$createComponent14(Show8, {
      get when() {
        return t.visible;
      },
      get children() {
        return _$createComponent14(WidgetFrame, {
          get bg() {
            return bgTint();
          },
          get size() {
            return t.expanded ? rowsT : 1;
          },
          get accent() {
            return thinkFg();
          },
          get fade() {
            return _$memo8(() => !!t.fading)() ? t.fade : 0;
          },
          title: `\uD83D\uDCAD thinking · ${elapsed}s`,
          get hint() {
            return hints.think;
          },
          get children() {
            return [_$createComponent14(Show8, {
              get when() {
                return t.expanded;
              },
              get children() {
                return _$createComponent14(For11, {
                  get each() {
                    return t.text.split(`
`).slice(-Math.max(1, (typeof rowsT === "number" ? rowsT : 7) - 2));
                  },
                  children: (line) => (() => {
                    var _el$6 = _$createElement15("text");
                    _$insert15(_el$6, line || " ");
                    _$effect15((_$p) => _$setProp15(_el$6, "style", {
                      fg: dimColor(thinkFg(), 0.2),
                      wrapMode: "none",
                      truncate: true
                    }, _$p));
                    return _el$6;
                  })()
                });
              }
            }), _$createComponent14(Show8, {
              get when() {
                return !t.expanded;
              },
              get children() {
                var _el$ = _$createElement15("text"), _el$2 = _$createTextNode10(`\uD83D\uDCAD `), _el$3 = _$createTextNode10(`s `);
                _$insertNode12(_el$, _el$2);
                _$insertNode12(_el$, _el$3);
                _$insert15(_el$, elapsed, _el$3);
                _$insert15(_el$, () => thinkBuf.split(`
`).pop() || " ", null);
                _$effect15((_$p) => _$setProp15(_el$, "style", {
                  fg: dimColor(thinkFg(), 0.2),
                  wrapMode: "none",
                  truncate: true
                }, _$p));
                return _el$;
              }
            })];
          }
        });
      }
    }), _$createComponent14(Show8, {
      get when() {
        return toolVisible() || list.length > 0;
      },
      get children() {
        return _$createComponent14(WidgetFrame, {
          get bg() {
            return bgTint();
          },
          get size() {
            return toolExpanded() ? rowsTool : 1;
          },
          get accent() {
            return toolFg();
          },
          get fade() {
            return _$memo8(() => !!toolFading())() ? toolFade() : 0;
          },
          get title() {
            return `\uD83D\uDD27 ${running.length > 0 ? `${SPINNER_FRAMES2[Math.floor(Date.now() / 125 % SPINNER_FRAMES2.length)]} ${running.length} running` : `${list.length} tools`} · ${list.filter((e) => e.status === "ok").length}✔ ${list.filter((e) => e.status === "fail").length}✘`;
          },
          get hint() {
            return hints.tool;
          },
          get children() {
            return [_$createComponent14(Show8, {
              get when() {
                return toolExpanded();
              },
              get children() {
                return _$createComponent14(For11, {
                  get each() {
                    return list.slice(-Math.max(1, (typeof rowsTool === "number" ? rowsTool : 7) - 2));
                  },
                  children: (e) => (() => {
                    var _el$7 = _$createElement15("text");
                    _$insert15(_el$7, (() => {
                      var _c$2 = _$memo8(() => e.status === "running");
                      return () => _c$2() ? `⚙ ${e.name} ${e.args}` : `${e.status === "ok" ? "✔" : "✘"} ${e.name} ${e.args}`;
                    })());
                    _$effect15((_$p) => _$setProp15(_el$7, "style", {
                      fg: e.status === "running" ? toolFg() : e.status === "fail" ? th().tokens.toolFail ?? th().tokens.danger : th().tokens.toolOk ?? th().tokens.ok,
                      wrapMode: "none",
                      truncate: true
                    }, _$p));
                    return _el$7;
                  })()
                });
              }
            }), _$createComponent14(Show8, {
              get when() {
                return !toolExpanded();
              },
              get children() {
                var _el$4 = _$createElement15("text"), _el$5 = _$createTextNode10(`\uD83D\uDD27 `);
                _$insertNode12(_el$4, _el$5);
                _$insert15(_el$4, (() => {
                  var _c$ = _$memo8(() => running.length > 0);
                  return () => _c$() ? `⚙ ${running[0].name} ${running[0].args}` : `${list[0]?.name ?? ""} ${list[0]?.args ?? ""}`;
                })(), null);
                _$effect15((_$p) => _$setProp15(_el$4, "style", {
                  fg: dimColor(toolFg(), 0.2),
                  wrapMode: "none",
                  truncate: true
                }, _$p));
                return _el$4;
              }
            })];
          }
        });
      }
    })];
  };
  return {
    dockView,
    onThinkingDelta(text) {
      if (text === "")
        return;
      const now = Date.now();
      cancelThinkHide();
      const fresh = !think().visible || think().fading || !thinkOpen;
      thinkBuf = fresh ? text : thinkBuf + text;
      thinkOpen = true;
      if (fresh) {
        setThink({
          visible: true,
          expanded: false,
          fading: false,
          fade: 0,
          text: thinkBuf,
          lastAt: now,
          startedAt: now
        });
        lastFlush = 0;
        flush(true);
        return;
      }
      setThink((s) => ({
        ...s,
        text: thinkBuf,
        lastAt: now,
        expanded: false
      }));
      flush();
    },
    onContentDelta() {
      if (think().visible)
        setThink((s) => ({
          ...s,
          expanded: false,
          lastAt: Date.now()
        }));
      scheduleThinkHide();
      thinkOpen = false;
    },
    onToolStart(start) {
      lastToolAt = Date.now();
      setToolVisible(true);
      setToolFading(false);
      setToolFade(0);
      setTools((arr) => [...arr, {
        name: start.name,
        args: start.args,
        status: "running",
        elapsed: 0,
        ...start.callId ? {
          callId: start.callId
        } : {}
      }]);
    },
    onToolRun(run) {
      const brief = (run.output ?? "").split(`
`).slice(-2).join(" ⏎ ").slice(0, 160);
      setTools((arr) => {
        const idx = run.callId ? arr.findIndex((e) => e.callId === run.callId) : arr.findIndex((e) => e.status === "running" && e.name === run.name);
        const settled = {
          ...run.callId ? {
            callId: run.callId
          } : {},
          name: run.name,
          args: run.argsPretty ?? "",
          status: run.ok ? "ok" : "fail",
          output: brief
        };
        return idx === -1 ? [...arr, settled] : arr.map((e, i) => i === idx ? {
          ...e,
          ...settled
        } : e);
      });
      lastToolAt = Date.now();
    },
    onTurnStart() {
      cancelThinkHide();
      if (think().visible)
        scheduleThinkHide(600);
      if (tools().length > 0 && toolVisible()) {
        setToolFading(true);
        setToolFade(0);
      }
      thinkBuf = "";
      thinkOpen = false;
    },
    onTurnEnd() {
      thinkBuf = "";
      if (think().visible)
        scheduleThinkHide();
      if (tools().length > 0 && toolVisible()) {
        setToolFading(true);
        setToolFade(0);
      }
      thinkOpen = false;
    },
    tick() {},
    reset() {
      hideAll();
    },
    toggleExpand(which) {
      if (which === "think")
        setThink((s) => s.visible ? {
          ...s,
          expanded: !s.expanded,
          lastAt: Date.now()
        } : s);
      else
        setToolExpanded((v) => !v);
    },
    toolCount: () => tools().length,
    toolActive: () => tools().some((e) => e.status === "running")
  };
  function hideAll() {
    setThink({
      visible: false,
      expanded: false,
      fading: false,
      fade: 0,
      text: "",
      lastAt: 0,
      startedAt: 0
    });
    cancelThinkHide();
    thinkBuf = "";
    setTools([]);
    setToolVisible(false);
    setToolFading(false);
    setToolFade(0);
    setToolExpanded(false);
  }
}

// src/ShellHost.tsx
var SPAWN_TOOLS = ["subagent", "subagent_fork", "workflow", "ralph", "use_agent"];
var CRED_REFS = ["ZAI_CODING_CN_API_KEY", "DEEPSEEK_API_KEY", "MINIMAX_CN_API_KEY"];
var CONTEXT_WINDOW_TOKENS = 128000;
var COMMANDS = [{
  name: "/help",
  desc: "show available commands"
}, {
  name: "/clear",
  desc: "clear the transcript"
}, {
  name: "/usage",
  desc: "show token usage summary"
}, {
  name: "/new",
  desc: "start a fresh session"
}, {
  name: "/sessions",
  desc: "list and resume stored sessions"
}, {
  name: "/history",
  desc: "fork the session at an earlier turn"
}, {
  name: "/preset",
  desc: "switch agent preset"
}, {
  name: "/search",
  desc: "full-text search sessions (/search text)"
}, {
  name: "/btw",
  desc: "side question overlay (/btw question, bare toggles)"
}, {
  name: "/language",
  desc: "switch interface language (zh-CN/en)"
}, {
  name: "/hints",
  desc: "toggle the key-hint strip"
}, {
  name: "/config",
  desc: "plugin settings (/config or /config key value)"
}, {
  name: "/queue",
  desc: "queue a message (/queue msg, bare toggles panel)"
}, {
  name: "/repair",
  desc: "scan session logs for broken files"
}, {
  name: "/theme",
  desc: "pick theme"
}, {
  name: "/model",
  desc: "pick or switch model (/model provider/id)"
}, {
  name: "/login",
  desc: "set an api key (/login REF KEY)"
}, {
  name: "/logout",
  desc: "remove an api key (/logout REF)"
}, {
  name: "/attach",
  desc: "attach an image to the next message (/attach path)"
}, {
  name: "/quit",
  desc: "exit the shell"
}];
var errText = (e) => String(e instanceof Error ? e.message : e).slice(0, 300);
var fmtClock = () => {
  const d = new Date;
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
};
function ShellHost(props) {
  const t = props.deps.t;
  const [input, setInput] = createSignal4("");
  const [history, setHistory] = createSignal4([]);
  const [historyIdx, setHistoryIdx] = createSignal4(0);
  const [resetKey, setResetKey] = createSignal4(0);
  const [setKey, setSetKey] = createSignal4(0);
  const [setValueText, setSetValueText] = createSignal4("");
  const [items, setItems] = createSignal4([]);
  const [busy, setBusy] = createSignal4(false);
  const [approval, setApproval] = createSignal4(null);
  const [usage, setUsage] = createSignal4({
    prompt: 0,
    completion: 0,
    turns: 0
  });
  const [label, setLabel] = createSignal4(props.deps.session.label);
  const [showWelcome, setShowWelcome] = createSignal4(true);
  const [todos, setTodos] = createSignal4([]);
  const [subagents, setSubagents] = createSignal4([]);
  const [viewerId, setViewerId] = createSignal4(null);
  const [viewerLines, setViewerLines] = createSignal4([]);
  const [steerFor, setSteerFor] = createSignal4(null);
  const [steerBuffer, setSteerBuffer] = createSignal4("");
  const [hintsVisible, setHintsVisible] = createSignal4(true);
  const [gitBranch, setGitBranch] = createSignal4("");
  const [queueMsgs, setQueueMsgs] = createSignal4([]);
  const [queueOpen, setQueueOpen] = createSignal4(false);
  const [btwPairs, setBtwPairs] = createSignal4([]);
  const [btwLive, setBtwLive] = createSignal4(null);
  const [btwOpen, setBtwOpen] = createSignal4(false);
  const [kb] = createSignal4(props.deps.session.keybindingsLoad?.() ?? {});
  const hot = (action, fallback) => kb()[action] ?? fallback;
  const [pluginConfig, setPluginConfig] = createSignal4(props.deps.session.configLoad());
  const openViewer = (id) => {
    setViewerId(id);
    setViewerLines(props.deps.session.childTranscript(id));
  };
  const [overlay, setOverlay] = createSignal4(null);
  const initialTheme = process.env.DSH_OPENTUI_THEME ?? props.deps.themeName ?? "catppuccin-mocha";
  const [themeName, setThemeName] = createSignal4(themes[initialTheme] ? initialTheme : "catppuccin-mocha");
  const theme = () => getTheme(themeName());
  const [menuOpen, setMenuOpen] = createSignal4(true);
  const [menuSel, setMenuSel] = createSignal4(0);
  const [clock, setClock] = createSignal4(fmtClock());
  const [liveTps, setLiveTps] = createSignal4(null);
  let turnStartAt = 0;
  let approveResolve = null;
  const [scrollTopLine, setScrollTopLine] = createSignal4(null);
  let totalLines = 0;
  const VIEWPORT_ROWS = 18;
  const scrollUp = () => {
    const cur = scrollTopLine() ?? Math.max(0, totalLines - VIEWPORT_ROWS);
    setScrollTopLine(Math.max(0, cur - 12));
  };
  const scrollDown = () => {
    const cur = scrollTopLine();
    if (cur === null)
      return;
    const next = cur + 12;
    if (next + VIEWPORT_ROWS >= totalLines)
      setScrollTopLine(null);
    else
      setScrollTopLine(next);
  };
  const pinIfFollowing = () => {};
  let replayGen = 0;
  const [stopConfirm, setStopConfirm] = createSignal4(false);
  const [plugins] = createSignal4(props.deps.session.listPlugins());
  const execMode = props.deps.session.executionMode();
  const [hostCommands, setHostCommands] = createSignal4([]);
  onMount(async () => {
    try {
      setHostCommands(await props.deps.session.listHostCommands());
    } catch {}
  });
  const [focusKey, setFocusKey] = createSignal4(0);
  onMount(() => {
    const tick = setInterval(() => {
      setClock(fmtClock());
      dock.tick();
      setSubagents((arr) => arr.some((r) => r.status === "running") ? arr.map((r) => r.status === "running" ? {
        ...r,
        elapsed: r.elapsed + 1
      } : r) : arr);
      if (viewerId())
        setViewerLines(props.deps.session.childTranscript(viewerId()));
    }, 1000);
    const gitTick = setInterval(() => {
      import("node:child_process").then(({
        execFile
      }) => {
        execFile("git", ["branch", "--show-current"], {
          cwd: process.cwd(),
          timeout: 3000
        }, (err, stdout) => {
          if (!err)
            setGitBranch(String(stdout).trim());
          else
            setGitBranch("");
        });
      });
    }, 30000);
    const gitOnce = setTimeout(() => {
      import("node:child_process").then(({
        execFile
      }) => {
        execFile("git", ["branch", "--show-current"], {
          cwd: process.cwd(),
          timeout: 3000
        }, (err, stdout) => {
          if (!err)
            setGitBranch(String(stdout).trim());
        });
      });
    }, 1200);
    onCleanup(() => {
      clearInterval(gitTick);
      clearTimeout(gitOnce);
    });
    onCleanup(() => clearInterval(tick));
    if (!process.env.DSH_OPENTUI_NO_ASK)
      props.deps.session.registerAskProvider(async (questions) => {
        const answer = await new Promise((resolve) => {
          const q0 = questions[0];
          const options = q0?.options ?? [];
          if (!q0 || options.length === 0) {
            resolve("declined");
            return;
          }
          let settled = false;
          const settle = (v) => {
            if (settled)
              return;
            settled = true;
            setOverlay(null);
            setFocusKey((k) => k + 1);
            resolve(v);
          };
          const timeoutSec = Number(pluginConfig().askUserTimeoutSec ?? 0);
          if (timeoutSec > 0)
            setTimeout(() => settle("declined"), timeoutSec * 1000);
          openOverlay({
            title: `${t("ask.title")}: ${q0.prompt}`.slice(0, 70),
            items: options.map((o) => ({
              label: o,
              value: o
            })),
            ask: {
              questionId: q0.id,
              resolve: settle
            },
            onSelect: (value) => settle([{
              questionId: q0.id,
              selected: value
            }])
          });
        });
        if (answer === "declined")
          throw new Error("declined");
        return answer;
      });
  });
  const allCommands = createMemo(() => {
    const tuiNames = new Set(COMMANDS.map((c) => c.name));
    return [...COMMANDS, ...hostCommands().filter((c) => !tuiNames.has(`/${c.name}`)).map((c) => ({
      name: `/${c.name}`,
      desc: c.description,
      host: true
    }))];
  });
  const filteredCommands = createMemo(() => {
    const m = /^\/(\S*)/.exec(input());
    if (!m)
      return [];
    return allCommands().filter((c) => c.name.slice(1).startsWith(m[1]));
  });
  const clampedSel = createMemo(() => {
    const n = filteredCommands().length;
    return n === 0 ? 0 : Math.min(menuSel(), n - 1);
  });
  const menuVisible = createMemo(() => menuOpen() && filteredCommands().length > 0);
  const openOverlay = (req) => setOverlay(req);
  const dock = createDockFeature({
    theme,
    sizes: () => {
      const c = pluginConfig();
      const pick = (v, d) => typeof v === "number" || v === "full" ? v : d;
      return {
        think: pick(c.dockRows?.think, 7),
        tool: pick(c.dockRows?.tool, 7)
      };
    },
    hints: () => ({
      think: hot("think", "ctrl+t"),
      tool: hot("tools", "ctrl+o")
    }),
    style: () => {
      const c = pluginConfig();
      return {
        thinkBg: typeof c.thinkBg === "string" ? c.thinkBg : undefined,
        toolBg: typeof c.toolBg === "string" ? c.toolBg : undefined
      };
    }
  });
  const modelSelect = createModelSelectFeature({
    session: props.deps.session,
    t,
    label,
    setLabel,
    push: (it) => push(it),
    config: pluginConfig
  });
  const themeSelect = createThemeSelectFeature({
    t,
    themeName,
    setThemeName,
    revertTheme: () => setThemeName(initialTheme)
  });
  const historyFork = createHistoryForkFeature({
    session: props.deps.session,
    t,
    push: (it) => push(it),
    setItems: (rows) => setItems(rows),
    resetDock: () => {
      dock.reset();
      setTodos([]);
      setSubagents([]);
    },
    onForked: () => {
      setShowWelcome(false);
      setBusy(false);
    }
  });
  const loginFeature = createLoginFeature({
    session: props.deps.session,
    theme,
    push: (it) => push(it)
  });
  const onOverlaySelect = (value) => {
    const ov = overlay();
    setOverlay(null);
    setFocusKey((k) => k + 1);
    ov?.onSelect(value);
  };
  const onOverlayCancel = () => {
    const ov = overlay();
    setOverlay(null);
    setFocusKey((k) => k + 1);
    ov?.onHoverCancel?.();
    ov?.ask?.resolve("declined");
  };
  const rendererCtx = useRenderer();
  let mdStyle;
  try {
    mdStyle = SyntaxStyle.create(rendererCtx);
  } catch {
    mdStyle = undefined;
  }
  let streamingReply = null;
  let lastBump = 0;
  const bumpSoon = () => {
    const now = Date.now();
    if (now - lastBump < 60)
      return;
    lastBump = now;
    pinIfFollowing();
    if (streamingReply) {
      const prev = streamingReply;
      const next = {
        ...prev
      };
      streamingReply = next;
      setItems((arr) => arr.map((x) => x === prev ? next : x));
    }
  };
  const push = (it) => {
    setItems((arr) => [...arr, it]);
    pinIfFollowing();
  };
  const commitHistory = (text) => {
    if (!text)
      return;
    const h = history();
    const next = h[h.length - 1] === text ? h : [...h, text];
    setHistory(next);
    setHistoryIdx(next.length);
  };
  const setBuffer = (text) => {
    setSetValueText(text);
    setSetKey((k) => k + 1);
    setInput(text);
  };
  const historyNav = (dir) => {
    const h = history();
    if (h.length === 0)
      return false;
    let idx = Math.min(historyIdx(), h.length);
    if (dir === "up" && idx > 0)
      idx -= 1;
    else if (dir === "down" && idx < h.length)
      idx += 1;
    else
      return false;
    setHistoryIdx(idx);
    setBuffer(idx === h.length ? "" : h[idx]);
    return true;
  };
  const clearBuffer = () => setBuffer("");
  const submitLine = () => {
    const text = input().trim();
    const cmd = menuVisible() ? filteredCommands()[clampedSel()] : undefined;
    setMenuOpen(true);
    setMenuSel(0);
    if (cmd) {
      const full = text === cmd.name || !text.startsWith("/") ? cmd.name : text;
      commitHistory(full);
      clearBuffer();
      if (cmd.host) {
        props.deps.session.executeHostCommand(full).then((r) => {
          if (r?.text)
            push({
              kind: "system",
              text: r.text
            });
        });
        return;
      }
      runCommand(full);
      return;
    }
    if (!text)
      return;
    commitHistory(text);
    clearBuffer();
    if (text.startsWith("/")) {
      runCommand(text);
      return;
    }
    if (busy())
      return steerText(text);
    send(text);
  };
  const paletteKeyFilter = (key) => {
    if (!menuVisible())
      return false;
    if (key.name === "up" || key.name === "down") {
      const n = filteredCommands().length;
      setMenuSel((s) => key.name === "up" ? (s - 1 + n) % n : (s + 1) % n);
      return true;
    }
    if (key.name === "tab") {
      const cmd = filteredCommands()[clampedSel()];
      if (cmd) {
        setBuffer(`${cmd.name} `);
        setMenuSel(0);
      }
      return true;
    }
    if (key.name === "return") {
      submitLine();
      return true;
    }
    return false;
  };
  const pushCredStatus = async () => {
    for (const ref of CRED_REFS) {
      try {
        const st = await props.deps.session.credentialStatus(ref);
        push({
          kind: "system",
          text: t("cmd.cred.status", {
            ref,
            status: st.configured ? t("cmd.cred.configured") : t("cmd.cred.missing")
          })
        });
      } catch (e) {
        push({
          kind: "error",
          text: `${ref}: ${errText(e)}`
        });
      }
    }
  };
  async function runCommand(text) {
    setShowWelcome(false);
    const parts = text.slice(1).trim().split(/\s+/);
    const cmd = parts[0];
    const arg = parts.slice(1).join(" ");
    if (cmd === "quit" || cmd === "exit")
      process.exit(0);
    if (cmd === "help" || cmd === "?") {
      push({
        kind: "system",
        text: t("cmd.help.lines")
      });
      push({
        kind: "system",
        text: "keys: PgUp/PgDn or ctrl+b/f scroll · ctrl+t think detail · ctrl+o tool ledger · esc stop-confirm while busy · alt+enter newline · / palette"
      });
      const hc = hostCommands();
      if (hc.length > 0)
        push({
          kind: "system",
          text: `host commands: ${hc.map((c) => `/${c.name}`).join(" ")}`
        });
    } else if (cmd === "clear") {
      setItems([]);
      setResetKey((k) => k + 1);
      push({
        kind: "system",
        text: t("cmd.cleared")
      });
    } else if (cmd === "usage") {
      for (const line of props.deps.session.usageSummary())
        push({
          kind: "system",
          text: line
        });
      push({
        kind: "system",
        text: `model: ${label()}`
      });
    } else if (cmd === "search") {
      if (!arg) {
        push({
          kind: "error",
          text: "usage: /search <text>"
        });
      } else {
        const hits = await props.deps.session.searchSessions(arg);
        if (hits.length === 0) {
          push({
            kind: "system",
            text: `no sessions matching "${arg}"`
          });
        } else {
          openOverlay({
            title: `search: ${arg}`,
            items: hits.map((hit) => ({
              label: hit.snippet || hit.id.slice(0, 8),
              value: hit.id,
              description: hit.id.slice(0, 8)
            })),
            onSelect: async (value) => {
              props.deps.session.resumeSession(value);
              setBusy(false);
              setShowWelcome(false);
              const gen = ++replayGen;
              try {
                const rows = await props.deps.session.storedTranscript(value);
                if (gen !== replayGen)
                  return;
                await new Promise((r2) => setTimeout(r2, 50));
                if (gen !== replayGen)
                  return;
                setItems(rows.map((it) => it.kind === "assistant" ? {
                  kind: "assistant",
                  text: it.text,
                  final: true
                } : {
                  kind: "user",
                  text: it.text
                }));
                setScrollTopLine(null);
              } catch {}
              push({
                kind: "system",
                text: `${t("cmd.sessions.resumed")}: ${value.slice(0, 8)}`
              });
            }
          });
        }
      }
    } else if (cmd === "preset") {
      const presets = await props.deps.session.listPresets();
      if (presets.length === 0) {
        push({
          kind: "system",
          text: "no presets in the agentPresets registry"
        });
      } else {
        const cur = props.deps.session.currentPresetId();
        openOverlay({
          title: t("picker.preset.title"),
          items: presets.map((p) => ({
            label: p.name,
            value: p.id,
            ...p.id === cur ? {
              description: t("cmd.model.current")
            } : {}
          })),
          onSelect: (value) => {
            const picked = presets.find((p) => p.id === value);
            props.deps.session.switchPreset(value);
            push({
              kind: "system",
              text: `preset → ${picked?.name ?? value} (fresh session on next message)`
            });
          }
        });
      }
    } else if (cmd === "history") {
      historyFork.open(openOverlay);
    } else if (cmd === "new") {
      replayGen++;
      props.deps.session.newSession();
      setItems([]);
      setBtwPairs([]);
      setBtwLive(null);
      setBtwOpen(false);
      push({
        kind: "system",
        text: t("cmd.new.done")
      });
    } else if (cmd === "sessions") {
      const list = await props.deps.session.listSessions();
      if (!list.length) {
        push({
          kind: "system",
          text: t("cmd.sessions.empty")
        });
      } else {
        openOverlay({
          title: t("picker.sessions.title"),
          items: list.map((x) => ({
            label: x.title || x.id.slice(0, 8),
            value: x.id,
            ...x.updatedAt ? {
              description: String(x.updatedAt).slice(0, 19)
            } : {}
          })),
          onSelect: async (value) => {
            props.deps.session.resumeSession(value);
            setBusy(false);
            setShowWelcome(false);
            const gen = ++replayGen;
            try {
              const rows = await props.deps.session.storedTranscript(value);
              if (gen !== replayGen)
                return;
              await new Promise((r2) => setTimeout(r2, 50));
              if (gen !== replayGen)
                return;
              setItems(rows.map((it) => it.kind === "assistant" ? {
                kind: "assistant",
                text: it.text,
                final: true
              } : {
                kind: "user",
                text: it.text
              }));
              setScrollTopLine(null);
            } catch {}
            push({
              kind: "system",
              text: `${t("cmd.sessions.resumed")}: ${value.slice(0, 8)}`
            });
          }
        });
      }
    } else if (cmd === "theme") {
      themeSelect.open(openOverlay);
    } else if (cmd === "model") {
      if (!arg) {
        await modelSelect.open(openOverlay);
      } else {
        const [provider, model] = arg.split("/");
        modelSelect.direct(provider, model);
      }
    } else if (cmd === "login") {
      if (parts.length === 3) {
        try {
          await props.deps.session.login(parts[1], parts[2]);
          push({
            kind: "system",
            text: t("cmd.login.saved", {
              ref: parts[1]
            })
          });
        } catch (e) {
          push({
            kind: "error",
            text: errText(e)
          });
        }
      } else {
        await loginFeature.open("login");
      }
    } else if (cmd === "logout") {
      if (parts.length === 2) {
        try {
          await props.deps.session.logout(parts[1]);
          push({
            kind: "system",
            text: t("cmd.logout.done", {
              ref: parts[1]
            })
          });
        } catch (e) {
          push({
            kind: "error",
            text: errText(e)
          });
        }
      } else {
        await loginFeature.open("logout");
      }
    } else if (cmd === "attach") {
      if (!arg) {
        push({
          kind: "error",
          text: "usage: /attach /path/to/image.png"
        });
      } else {
        try {
          const desc = await props.deps.session.attachImage(arg);
          push({
            kind: "system",
            text: `\uD83D\uDCCE attached ${desc} — sends with your next message`
          });
        } catch (e) {
          push({
            kind: "error",
            text: errText(e)
          });
        }
      }
    } else if (cmd === "language") {
      const i18n = props.deps.i18n;
      if (i18n) {
        const cycle = ["zh-CN", "en", "ja", "ko"];
        const to = cycle[(cycle.indexOf(i18n.locale) + 1) % cycle.length];
        i18n.setLocale(to);
        push({
          kind: "system",
          text: `language → ${to}`
        });
      } else {
        push({
          kind: "error",
          text: "language switching unavailable"
        });
      }
    } else if (cmd === "repair") {
      for (const line of props.deps.session.repairScan())
        push({
          kind: "system",
          text: line
        });
    } else if (cmd === "queue") {
      setShowWelcome(false);
      if (!arg) {
        setQueueOpen((v) => !v);
        return;
      }
      setQueueMsgs((arr) => [...arr, arg]);
      push({
        kind: "system",
        text: `queued (${queueMsgs().length} waiting) — sends after the current turn`
      });
    } else if (cmd === "config") {
      const KEYS = [{
        key: "retentionDays",
        desc: "/sessions retention days (0 = unlimited)",
        parse: (v) => Number(v)
      }, {
        key: "askUserTimeoutSec",
        desc: "ask overlay timeout seconds (0 = none)",
        parse: (v) => Number(v)
      }, {
        key: "favoriteModels",
        desc: "favorite models (comma-separated provider/model)",
        parse: (v) => v.split(",").map((x) => x.trim()).filter(Boolean)
      }, {
        key: "hiddenModels",
        desc: "hidden models (comma-separated provider/model)",
        parse: (v) => v.split(",").map((x) => x.trim()).filter(Boolean)
      }, {
        key: "maxAgents",
        desc: "max concurrently running subagents (0 = unlimited)",
        parse: (v) => Number(v)
      }, {
        key: "maxRounds",
        desc: "max rounds per subagent (0 = unlimited, enforced at the approval layer)",
        parse: (v) => Number(v)
      }, {
        key: "iconSet",
        desc: "dock icon style: default | minimal",
        parse: (v) => ["default", "minimal"].includes(v) ? v : "default"
      }];
      if (parts.length >= 3) {
        const spec = KEYS.find((k) => k.key === parts[1]);
        if (!spec) {
          push({
            kind: "error",
            text: `unknown config key: ${parts[1]}`
          });
        } else {
          const merged = props.deps.session.configSave({
            [spec.key]: spec.parse(parts.slice(2).join(" "))
          });
          setPluginConfig(merged);
          push({
            kind: "system",
            text: `${spec.key} = ${JSON.stringify(merged[spec.key])} — ${spec.desc}`
          });
        }
      } else {
        push({
          kind: "system",
          text: "config keys:"
        });
        for (const k of KEYS) {
          push({
            kind: "system",
            text: `  ${k.key} = ${JSON.stringify(pluginConfig()[k.key] ?? "(unset)")} — ${k.desc}`
          });
        }
        push({
          kind: "system",
          text: "set: /config <key> <value>"
        });
      }
    } else if (cmd === "btw") {
      if (!arg) {
        setBtwOpen((v) => !v);
        if (!btwOpen())
          setShowWelcome(false);
        return;
      }
      if (btwLive()) {
        push({
          kind: "system",
          text: "a btw side call is already running — it will finish first"
        });
        return;
      }
      const snapshot = items().filter((it) => it.kind === "user" || it.kind === "assistant").slice(-8).map((it) => `${it.kind === "user" ? "Q" : "A"}: ${it.text.slice(0, 150)}`);
      const q = arg;
      setBtwLive({
        q,
        a: ""
      });
      setShowWelcome(false);
      props.deps.session.btwAsk(q, snapshot, (full) => setBtwLive({
        q,
        a: full.slice(-400)
      })).then((a) => {
        setBtwLive(null);
        if (a)
          setBtwPairs((arr) => [...arr.slice(-4), {
            q,
            a
          }]);
      });
      return;
    } else if (cmd === "hints") {
      setHintsVisible((v) => !v);
      push({
        kind: "system",
        text: `key hints ${hintsVisible() ? "hidden" : "shown"}`
      });
    } else {
      const known = hostCommands().some((c) => c.name === cmd);
      if (known) {
        const r = await props.deps.session.executeHostCommand(text);
        if (r?.text)
          push({
            kind: "system",
            text: r.text
          });
        return;
      }
      push({
        kind: "system",
        text: `unknown command: /${cmd} (try /help)`
      });
    }
  }
  const steerText = (text) => {
    push({
      kind: "user",
      text: `⚡ ${text}`
    });
    props.deps.session.steer(text);
  };
  async function send(text) {
    setShowWelcome(false);
    push({
      kind: "user",
      text
    });
    setBusy(true);
    dock.onTurnStart();
    setLiveTps(null);
    turnStartAt = Date.now();
    streamingReply = null;
    try {
      await props.deps.session.turn(text, {
        onThinkingDelta: (s) => {
          dock.onThinkingDelta(s);
          bumpSoon();
        },
        onContentDelta: (s) => {
          dock.onContentDelta(s);
          if (!streamingReply) {
            streamingReply = {
              kind: "assistant",
              text: ""
            };
            push(streamingReply);
          }
          streamingReply.text += s;
          bumpSoon();
        },
        onTurnEnd: (u) => {
          const cur = streamingReply;
          if (cur) {
            const final = {
              ...cur,
              final: true
            };
            setItems((arr) => arr.map((x) => x === cur ? final : x));
          }
          setLabel(props.deps.session.label);
          setUsage((v) => ({
            prompt: v.prompt + u.prompt,
            completion: v.completion + u.completion,
            turns: v.turns + 1
          }));
        },
        onStreamTick: ({
          chars,
          at
        }) => {
          const sec = (at - turnStartAt) / 1000;
          if (sec > 0.3 && chars > 0)
            setLiveTps(Math.round(chars / 4 / sec));
        },
        onTodos: (list) => setTodos(list),
        onSubagentUpdate: (entries) => setSubagents(entries),
        onApprove: (name, args) => {
          if (SPAWN_TOOLS.includes(name)) {
            const cap = Number(pluginConfig().maxAgents ?? 0);
            const running = subagents().filter((e) => e.status === "running").length;
            if (cap > 0 && running >= cap) {
              push({
                kind: "error",
                text: `spawn rejected: maxAgents=${cap} reached (${running} running)`
              });
              return Promise.resolve(false);
            }
          }
          setApproval({
            name,
            args: JSON.stringify(args)
          });
          return new Promise((resolve) => {
            approveResolve = resolve;
          });
        },
        onToolStart: (start) => {
          dock.onToolStart(start);
        },
        onToolRun: (run) => {
          dock.onToolRun(run);
        },
        onReattachedMissed: (rows) => {
          if (rows.length === 0)
            return;
          setItems((arr) => {
            const painted = rows.map((it) => it.kind === "assistant" ? {
              kind: "assistant",
              text: it.text,
              final: true
            } : {
              kind: "user",
              text: it.text
            });
            if (arr.length === 0)
              return painted;
            return [...arr.slice(0, -1), ...painted, arr[arr.length - 1]];
          });
        },
        onError: (msg) => push({
          kind: "error",
          text: msg
        })
      });
    } catch (e) {
      push({
        kind: "error",
        text: errText(e)
      });
    } finally {
      dock.onTurnEnd();
      setApproval(null);
      approveResolve = null;
      setBusy(false);
      setLiveTps(null);
      const nextQueued = queueMsgs()[0];
      if (nextQueued !== undefined) {
        setQueueMsgs((arr) => arr.slice(1));
        setTimeout(() => void send(nextQueued), 400);
      }
    }
  }
  useKeyboard2((key) => {
    if (process.env.DSH_OPENTUI_DEBUG) {
      import("node:fs").then((fs) => fs.appendFileSync("/tmp/host-keys.log", JSON.stringify({
        name: key.name,
        seq: key.sequence
      }) + `
`)).catch(() => {});
    }
    if (key.sequence === "\x03" || (key.name === "c" || key.name === "C") && key.ctrl)
      process.exit(0);
    if (stopConfirm()) {
      if (key.sequence === "y") {
        setStopConfirm(false);
        props.deps.session.abort?.();
        push({
          kind: "system",
          text: "turn aborted"
        });
      } else if (key.sequence === "n" || key.name === "escape") {
        setStopConfirm(false);
      }
      return;
    }
    if (key.name === "escape" && busy() && !stopConfirm()) {
      setStopConfirm(true);
      return;
    }
    const ap = approval();
    if (ap) {
      if (key.sequence === "y" || key.name === "return") {
        setApproval(null);
        approveResolve?.(true);
        approveResolve = null;
      } else if (key.sequence === "n" || key.name === "escape") {
        setApproval(null);
        approveResolve?.(false);
        approveResolve = null;
      }
      return;
    }
    if (overlay()) {
      if (key.name === "escape")
        onOverlayCancel();
      return;
    }
    if (viewerId()) {
      if (key.name === "escape") {
        if (steerFor()) {
          setSteerFor(null);
          setSteerBuffer("");
        } else {
          setViewerId(null);
        }
        setFocusKey((k) => k + 1);
        return;
      }
      if (steerFor()) {
        if (key.name === "return") {
          const text = steerBuffer().trim();
          setSteerFor(null);
          setSteerBuffer("");
          if (text) {
            const ok = props.deps.session.steerChild(viewerId(), text);
            push({
              kind: ok ? "system" : "error",
              text: ok ? `⚡ steered child ${viewerId().slice(0, 8)}` : "child is not steerable (settled or not in this process)"
            });
          }
        } else if (key.name === "backspace") {
          setSteerBuffer((b) => b.slice(0, -1));
        } else {
          const ch = key.sequence ?? "";
          if (ch.length === 1 && /[\x20-\x7e]/.test(ch))
            setSteerBuffer((b) => b + ch);
        }
        return;
      }
      if (key.sequence === "s") {
        const entry = subagents().find((e) => e.id === viewerId());
        if (entry?.status === "running") {
          setSteerFor(viewerId());
          setSteerBuffer("");
        } else {
          push({
            kind: "system",
            text: "child is settled — only running children can be steered"
          });
        }
        return;
      }
      return;
    }
    const viewerKey = hot("viewer", "ctrl+g");
    const vkCtrl = viewerKey.startsWith("ctrl+");
    const vkName = vkCtrl ? viewerKey.slice(5) : viewerKey;
    if (key.ctrl === vkCtrl && key.name === vkName) {
      const list = subagents();
      if (list.length === 0) {
        push({
          kind: "system",
          text: "no subagents yet"
        });
        return;
      }
      openOverlay({
        title: "subagents — pick to view transcript",
        items: list.map((e) => ({
          label: `${e.label}${e.model ? ` · ${e.model}` : ""}`,
          value: e.id,
          description: `${e.status} · ↻${e.rounds}`
        })),
        onSelect: (value) => openViewer(value)
      });
      return;
    }
    if (loginFeature.active() && loginFeature.handleKey(key))
      return;
    const thinkKey = hot("think", "ctrl+t");
    const tkCtrl = thinkKey.startsWith("ctrl+");
    if (key.ctrl === tkCtrl && key.name === (tkCtrl ? thinkKey.slice(5) : thinkKey)) {
      dock.toggleExpand("think");
      return;
    }
    const toolsKey = hot("tools", "ctrl+o");
    const toCtrl = toolsKey.startsWith("ctrl+");
    if (key.ctrl === toCtrl && key.name === (toCtrl ? toolsKey.slice(5) : toolsKey)) {
      dock.toggleExpand("tool");
      return;
    }
    const upKey = hot("scrollUp", "pageup");
    const dnKey = hot("scrollDown", "pagedown");
    if (key.name === upKey || upKey.startsWith("ctrl+") && key.ctrl && key.name === upKey.slice(5)) {
      scrollUp();
      return;
    }
    if (key.name === dnKey || dnKey.startsWith("ctrl+") && key.ctrl && key.name === dnKey.slice(5)) {
      scrollDown();
      return;
    }
    if (key.name === "escape" && menuVisible())
      setMenuOpen(false);
  });
  const route = createMemo(() => {
    const m = /^([^/]+)\/(\S+?)(?:\s*\(([\w-]+)\))?$/.exec(label());
    if (!m)
      return {
        provider: label(),
        model: "",
        effort: undefined
      };
    return {
      provider: m[1],
      model: m[2],
      effort: m[3]
    };
  });
  const contextPct = createMemo(() => Math.min(99, Math.round(usage().prompt / CONTEXT_WINDOW_TOKENS * 100)));
  const msgCount = createMemo(() => items().filter((it) => it.kind === "user" || it.kind === "assistant").length);
  const toolCount = createMemo(() => dock.toolCount());
  const powerlineSegments = () => {
    const r = route();
    const pct = contextPct();
    const segs = [{
      text: `dsh(${execMode})`,
      bg: POWERLINE_COLORS.brand
    }, {
      text: r.provider,
      bg: POWERLINE_COLORS.provider
    }, {
      text: `\uD83E\uDD16 ${r.model || "·"} ◕${r.effort ?? "off"}`,
      bg: POWERLINE_COLORS.thinking[r.effort ?? "high"] ?? POWERLINE_COLORS.thinking.high
    }, {
      text: `\uD83E\uDDE0 ${usage().prompt >= 1000 ? `${(usage().prompt / 1000).toFixed(1)}k` : usage().prompt}(${pct}%)`,
      bg: pct > 80 ? POWERLINE_COLORS.contextDanger : pct > 60 ? POWERLINE_COLORS.contextOrange : pct > 40 ? POWERLINE_COLORS.contextWarn : POWERLINE_COLORS.contextOk
    }];
    if (gitBranch())
      segs.push({
        text: `⎇ ${gitBranch()}`,
        bg: POWERLINE_COLORS.provider
      });
    if (msgCount() > 0)
      segs.push({
        text: `\uD83D\uDCAC ${msgCount()}`,
        bg: POWERLINE_COLORS.messages
      });
    if (toolCount() > 0)
      segs.push({
        text: `⚒ ${toolCount()}`,
        bg: POWERLINE_COLORS.tools
      });
    const ch = props.deps.session.cacheHitRate();
    if (ch !== null)
      segs.push({
        text: `⚡ CH${ch.toFixed(1)}%`,
        bg: POWERLINE_COLORS.speed
      });
    const speed = speedSegment(busy() ? liveTps() : null, th());
    if (speed)
      segs.push(speed);
    return segs;
  };
  const th = () => theme();
  return (() => {
    var _el$ = _$createElement16("box");
    _$setProp16(_el$, "style", {
      flexDirection: "column",
      flexGrow: 1
    });
    _$insert16(_el$, (() => {
      var _c$ = _$memo9(() => !!showWelcome());
      return () => _c$() ? _$createComponent15(WelcomeBanner, {
        get theme() {
          return th();
        },
        get model() {
          return label();
        },
        get cwd() {
          return process.cwd();
        },
        get plugins() {
          return plugins();
        }
      }) : _$createComponent15(TranscriptWindow, _$mergeProps({
        get items() {
          return items();
        },
        get theme() {
          return th();
        },
        t,
        spinnerFrame: "",
        mdStyle,
        viewportRows: VIEWPORT_ROWS
      }, () => scrollTopLine() !== null ? {
        startIndex: scrollTopLine()
      } : {
        offset: 0
      }, {
        onLayout: (total, rows) => totalLines = total
      }));
    })(), null);
    _$insert16(_el$, _$createComponent15(TodosWidget, {
      get todos() {
        return todos();
      },
      get theme() {
        return th();
      }
    }), null);
    _$insert16(_el$, _$createComponent15(SubagentWidget, {
      get entries() {
        return subagents();
      },
      get theme() {
        return th();
      }
    }), null);
    _$insert16(_el$, () => dock.dockView(), null);
    _$insert16(_el$, (() => {
      var _c$2 = _$memo9(() => !!approval());
      return () => _c$2() ? _$createComponent15(ApprovalCard, {
        get toolName() {
          return approval().name;
        },
        get args() {
          return approval().args;
        },
        get hint() {
          return t("agent.approve.hint");
        },
        get theme() {
          return th();
        }
      }) : null;
    })(), null);
    _$insert16(_el$, (() => {
      var _c$3 = _$memo9(() => !!stopConfirm());
      return () => _c$3() ? (() => {
        var _el$2 = _$createElement16("box"), _el$3 = _$createElement16("text"), _el$5 = _$createElement16("text");
        _$insertNode13(_el$2, _el$3);
        _$insertNode13(_el$2, _el$5);
        _$insertNode13(_el$3, _$createTextNode11(`abort this turn?`));
        _$insertNode13(_el$5, _$createTextNode11(`y aborts · n/esc resumes`));
        _$effect16((_p$) => {
          var _v$ = {
            border: true,
            borderStyle: "rounded",
            borderColor: th().tokens.warn,
            flexDirection: "column",
            padding: 1
          }, _v$2 = {
            fg: th().tokens.warn
          }, _v$3 = {
            fg: th().tokens.dim
          };
          _v$ !== _p$.e && (_p$.e = _$setProp16(_el$2, "style", _v$, _p$.e));
          _v$2 !== _p$.t && (_p$.t = _$setProp16(_el$3, "style", _v$2, _p$.t));
          _v$3 !== _p$.a && (_p$.a = _$setProp16(_el$5, "style", _v$3, _p$.a));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined
        });
        return _el$2;
      })() : null;
    })(), null);
    _$insert16(_el$, (() => {
      var _c$4 = _$memo9(() => !!viewerId());
      return () => _c$4() ? (() => {
        var _el$7 = _$createElement16("box"), _el$8 = _$createElement16("text");
        _$insertNode13(_el$7, _el$8);
        _$insert16(_el$8, () => `child ${viewerId().slice(0, 8)} · s steer · esc back`);
        _$insert16(_el$7, _$createComponent15(For12, {
          get each() {
            return viewerLines().slice(-7);
          },
          children: (l) => (() => {
            var _el$9 = _$createElement16("text");
            _$insert16(_el$9, l);
            _$effect16((_$p) => _$setProp16(_el$9, "style", {
              fg: th().tokens.dim
            }, _$p));
            return _el$9;
          })()
        }), null);
        _$effect16((_p$) => {
          var _v$4 = {
            border: true,
            borderStyle: "rounded",
            borderColor: th().tokens.border,
            flexDirection: "column",
            padding: 1,
            height: 10
          }, _v$5 = {
            fg: th().tokens.accent
          };
          _v$4 !== _p$.e && (_p$.e = _$setProp16(_el$7, "style", _v$4, _p$.e));
          _v$5 !== _p$.t && (_p$.t = _$setProp16(_el$8, "style", _v$5, _p$.t));
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        return _el$7;
      })() : null;
    })(), null);
    _$insert16(_el$, (() => {
      var _c$5 = _$memo9(() => !!steerFor());
      return () => _c$5() ? (() => {
        var _el$0 = _$createElement16("box"), _el$1 = _$createElement16("text"), _el$11 = _$createElement16("text");
        _$insertNode13(_el$0, _el$1);
        _$insertNode13(_el$0, _el$11);
        _$insertNode13(_el$1, _$createTextNode11(`⚡ steer: `));
        _$insert16(_el$11, () => steerBuffer() || " ");
        _$effect16((_p$) => {
          var _v$6 = {
            border: true,
            borderStyle: "rounded",
            borderColor: th().tokens.accent,
            flexDirection: "row",
            padding: 1
          }, _v$7 = {
            fg: th().tokens.accent
          }, _v$8 = {
            fg: th().tokens.text
          };
          _v$6 !== _p$.e && (_p$.e = _$setProp16(_el$0, "style", _v$6, _p$.e));
          _v$7 !== _p$.t && (_p$.t = _$setProp16(_el$1, "style", _v$7, _p$.t));
          _v$8 !== _p$.a && (_p$.a = _$setProp16(_el$11, "style", _v$8, _p$.a));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined
        });
        return _el$0;
      })() : null;
    })(), null);
    _$insert16(_el$, (() => {
      var _c$6 = _$memo9(() => !!(btwOpen() || btwLive()));
      return () => _c$6() ? (() => {
        var _el$12 = _$createElement16("box"), _el$13 = _$createElement16("box"), _el$14 = _$createElement16("text"), _el$16 = _$createElement16("box"), _el$17 = _$createElement16("text");
        _$insertNode13(_el$12, _el$13);
        _$insertNode13(_el$13, _el$14);
        _$insertNode13(_el$13, _el$16);
        _$insertNode13(_el$13, _el$17);
        _$setProp16(_el$13, "style", {
          flexDirection: "row"
        });
        _$insertNode13(_el$14, _$createTextNode11(`btw`));
        _$setProp16(_el$16, "style", {
          flexGrow: 1
        });
        _$insertNode13(_el$17, _$createTextNode11(`/btw close`));
        _$insert16(_el$12, _$createComponent15(For12, {
          get each() {
            return _$memo9(() => !!btwLive())() ? [btwLive()] : btwPairs().slice(-2);
          },
          children: (pair) => (() => {
            var _el$19 = _$createElement16("box"), _el$20 = _$createElement16("text");
            _$insertNode13(_el$19, _el$20);
            _$setProp16(_el$19, "style", {
              flexDirection: "column"
            });
            _$insert16(_el$20, () => `Q: ${pair.q.slice(0, 90)}`);
            _$insert16(_el$19, _$createComponent15(For12, {
              get each() {
                return pair.a.split(`
`).slice(0, 4);
              },
              children: (l) => (() => {
                var _el$21 = _$createElement16("text");
                _$insert16(_el$21, () => `A: ${l.slice(0, 100)}`);
                _$effect16((_$p) => _$setProp16(_el$21, "style", {
                  fg: th().tokens.text
                }, _$p));
                return _el$21;
              })()
            }), null);
            _$effect16((_$p) => _$setProp16(_el$20, "style", {
              fg: th().tokens.dim
            }, _$p));
            return _el$19;
          })()
        }), null);
        _$effect16((_p$) => {
          var _v$9 = {
            border: true,
            borderStyle: "rounded",
            borderColor: th().tokens.accent,
            flexDirection: "column",
            padding: 1,
            maxHeight: 10
          }, _v$0 = {
            fg: th().tokens.accent
          }, _v$1 = {
            fg: th().tokens.dim
          };
          _v$9 !== _p$.e && (_p$.e = _$setProp16(_el$12, "style", _v$9, _p$.e));
          _v$0 !== _p$.t && (_p$.t = _$setProp16(_el$14, "style", _v$0, _p$.t));
          _v$1 !== _p$.a && (_p$.a = _$setProp16(_el$17, "style", _v$1, _p$.a));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined
        });
        return _el$12;
      })() : null;
    })(), null);
    _$insert16(_el$, (() => {
      var _c$7 = _$memo9(() => !!(queueOpen() || queueMsgs().length > 0));
      return () => _c$7() ? (() => {
        var _el$22 = _$createElement16("box"), _el$23 = _$createElement16("box"), _el$24 = _$createElement16("text"), _el$26 = _$createElement16("box"), _el$27 = _$createElement16("text");
        _$insertNode13(_el$22, _el$23);
        _$insertNode13(_el$23, _el$24);
        _$insertNode13(_el$23, _el$26);
        _$insertNode13(_el$23, _el$27);
        _$setProp16(_el$23, "style", {
          flexDirection: "row"
        });
        _$insertNode13(_el$24, _$createTextNode11(`queue`));
        _$setProp16(_el$26, "style", {
          flexGrow: 1
        });
        _$insertNode13(_el$27, _$createTextNode11(`/queue &lt;msg&gt; enqueue · bare toggle`));
        _$insert16(_el$22, _$createComponent15(For12, {
          get each() {
            return queueMsgs();
          },
          children: (m, i) => (() => {
            var _el$29 = _$createElement16("text");
            _$insert16(_el$29, () => `${i() + 1}. ${m.slice(0, 80)}`);
            _$effect16((_$p) => _$setProp16(_el$29, "style", {
              fg: th().tokens.text
            }, _$p));
            return _el$29;
          })()
        }), null);
        _$effect16((_p$) => {
          var _v$10 = {
            border: true,
            borderStyle: "rounded",
            borderColor: th().tokens.border,
            flexDirection: "column",
            padding: 1,
            maxHeight: 8
          }, _v$11 = {
            fg: th().tokens.accent
          }, _v$12 = {
            fg: th().tokens.dim
          };
          _v$10 !== _p$.e && (_p$.e = _$setProp16(_el$22, "style", _v$10, _p$.e));
          _v$11 !== _p$.t && (_p$.t = _$setProp16(_el$24, "style", _v$11, _p$.t));
          _v$12 !== _p$.a && (_p$.a = _$setProp16(_el$27, "style", _v$12, _p$.a));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined
        });
        return _el$22;
      })() : null;
    })(), null);
    _$insert16(_el$, () => loginFeature.view(), null);
    _$insert16(_el$, (() => {
      var _c$8 = _$memo9(() => !!overlay());
      return () => _c$8() ? _$createComponent15(Select, {
        get title() {
          return overlay()?.title ?? "";
        },
        get items() {
          return overlay()?.items ?? [];
        },
        get theme() {
          return th();
        },
        onSelect: onOverlaySelect,
        get onPreview() {
          return overlay()?.onPreview;
        },
        onCancel: onOverlayCancel
      }) : null;
    })(), null);
    _$insert16(_el$, (() => {
      var _c$9 = _$memo9(() => !!menuVisible());
      return () => _c$9() ? (() => {
        var _el$30 = _$createElement16("box");
        _$insert16(_el$30, _$createComponent15(For12, {
          get each() {
            return filteredCommands();
          },
          children: (c, i) => (() => {
            var _el$31 = _$createElement16("text"), _el$32 = _$createTextNode11(` `);
            _$insertNode13(_el$31, _el$32);
            _$insert16(_el$31, () => i() === clampedSel() ? "› " : "  ", _el$32);
            _$insert16(_el$31, () => c.name, _el$32);
            _$insert16(_el$31, () => c.desc, null);
            _$effect16((_$p) => _$setProp16(_el$31, "style", {
              fg: i() === clampedSel() ? th().tokens.accent : undefined
            }, _$p));
            return _el$31;
          })()
        }));
        _$effect16((_$p) => _$setProp16(_el$30, "style", {
          border: true,
          borderColor: th().tokens.border,
          flexDirection: "column",
          padding: 0
        }, _$p));
        return _el$30;
      })() : null;
    })(), null);
    _$insert16(_el$, _$createComponent15(InputLine, {
      get focused() {
        return !(approval() || overlay() || loginFeature.panelOpen() || viewerId() !== null);
      },
      get height() {
        return Math.max(1, Math.min(5, input() ? input().split(`
`).length : 1));
      },
      busy: false,
      get placeholder() {
        return _$memo9(() => !!busy())() ? t("shell.input.steer") : t("shell.input.placeholder");
      },
      get busyLabel() {
        return t("shell.input.busy");
      },
      get theme() {
        return th();
      },
      onSubmit: submitLine,
      onContentChange: (v) => {
        setInput(v);
        setMenuOpen(true);
        setMenuSel(0);
      },
      onHistoryNav: historyNav,
      onKeyFilter: paletteKeyFilter,
      get focusKey() {
        return focusKey();
      },
      get resetKey() {
        return resetKey();
      },
      get setKey() {
        return setKey();
      },
      get setValue() {
        return setValueText();
      }
    }), null);
    _$insert16(_el$, (() => {
      var _c$0 = _$memo9(() => !!hintsVisible());
      return () => _c$0() ? _$createComponent15(FooterHints, {
        get theme() {
          return th();
        }
      }) : null;
    })(), null);
    _$insert16(_el$, _$createComponent15(PowerlineFooter, {
      get left() {
        return powerlineSegments();
      },
      get right() {
        return clock();
      },
      get theme() {
        return th();
      }
    }), null);
    return _el$;
  })();
}

// src/host-session.ts
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";

// src/agent/loop.ts
var STREAM_TICK_MS = 250;
var CHARS_PER_TOKEN = 4;
function estimateTokens(chars) {
  return Math.max(0, Math.round(chars / CHARS_PER_TOKEN));
}
function tokensPerSecond(tokens, ms) {
  if (ms <= 0 || tokens <= 0)
    return null;
  return tokens * 1000 / ms;
}
function emptyTurnStats() {
  return { startedAt: 0, endedAt: 0, ms: 0, chars: 0, tokens: 0, tps: null, estimated: true };
}
function createStreamTicker(onTick, intervalMs = STREAM_TICK_MS) {
  let chars = 0;
  let lastTickAt = 0;
  return {
    reset() {
      chars = 0;
      lastTickAt = 0;
    },
    add(delta) {
      if (delta <= 0)
        return;
      chars += delta;
      const now = Date.now();
      if (now - lastTickAt >= intervalMs) {
        lastTickAt = now;
        onTick({ chars, at: now });
      }
    },
    finish() {
      if (chars <= 0)
        return;
      const now = Date.now();
      lastTickAt = now;
      onTick({ chars, at: now });
    },
    chars: () => chars
  };
}

// src/host-session.ts
var DBG = (_m) => {};
function blocksText(content) {
  if (!Array.isArray(content))
    return "";
  let text = "";
  for (const block of content) {
    const typed = block;
    if (typed?.type === "text" && typeof typed.text === "string") {
      text += (text === "" ? "" : `
`) + typed.text;
    }
  }
  return text.trim();
}

class HostSession {
  label = "dsh-host";
  #ctx;
  #handle;
  #sessionId;
  #agentId;
  #cb;
  #resolveTurn;
  #running = false;
  #toolCalls = new Map;
  #override;
  #resumeId;
  #idleTimer;
  #releasedSeq = 0;
  usage = { prompt: 0, completion: 0, cacheRead: 0, cacheWrite: 0 };
  cacheHitRate() {
    const total = this.usage.cacheRead + this.usage.cacheWrite;
    if (total <= 0)
      return null;
    return this.usage.cacheRead / total * 100;
  }
  lastTurnStats = emptyTurnStats();
  #turns = 0;
  #ticker = createStreamTicker((t) => this.#cb?.onStreamTick?.(t));
  #turnStartedAt = 0;
  #turnUsageStart = { prompt: 0, completion: 0 };
  constructor(ctx) {
    this.#ctx = ctx;
    this.#wire();
    try {
      const sel = ctx.get?.("agentDefaultModel")?.currentSelection?.();
      if (sel?.provider && sel?.model)
        this.label = `${sel.provider}/${sel.model}${sel.reasoningEffort ? ` (${sel.reasoningEffort})` : ""}`;
    } catch {}
  }
  #providerCache = null;
  async listProviders() {
    if (this.#providerCache)
      return this.#providerCache;
    try {
      const llm = this.#ctx.get?.("llm");
      if (!llm?.listConfigurableProviders)
        return this.#providerCache = [];
      const configurable = await llm.listConfigurableProviders();
      const out = [];
      for (const p of configurable) {
        const provider = String(p?.provider ?? "");
        if (!provider)
          continue;
        let models = [];
        try {
          const list = await llm.listModels(provider);
          models = list.map((m) => String(m?.id ?? m?.model ?? m ?? "")).filter(Boolean);
        } catch {}
        out.push({ provider, models });
      }
      return this.#providerCache = out;
    } catch {
      return this.#providerCache = [];
    }
  }
  switchModel(provider, model, reasoningEffort) {
    this.#override = { provider, model, ...reasoningEffort ? { reasoningEffort } : {} };
    try {
      this.#handle?.dispose?.();
    } catch {}
    this.#handle = undefined;
    this.#sessionId = undefined;
    this.#agentId = undefined;
    this.#disarmIdleRelease();
    this.label = `${provider}/${model}${reasoningEffort ? ` (${reasoningEffort})` : ""}`;
  }
  newSession() {
    try {
      this.#handle?.dispose?.();
    } catch {}
    this.#handle = undefined;
    this.#sessionId = undefined;
    this.#agentId = undefined;
    this.#disarmIdleRelease();
    this.#resumeId = undefined;
  }
  resumeSession(id) {
    this.newSession();
    this.#resumeId = id;
  }
  async storedTranscript(id, skip = 0) {
    const persistence = this.#ctx.get?.("sessionPersistence");
    if (!persistence?.open)
      return [];
    const handle = await persistence.open(id, "read");
    try {
      const events = [];
      let offset = 0;
      for (;; ) {
        const batch = await handle.read(offset);
        if (!batch?.events?.length)
          break;
        events.push(...batch.events);
        offset += batch.events.length;
      }
      const items = [];
      for (const event of skip > 0 ? events.slice(skip) : events) {
        if (event.type === "user/message") {
          const kind = event.data?.source?.kind;
          if (kind !== undefined && kind !== "user")
            continue;
          const text = blocksText(event.data?.content);
          if (text)
            items.push({ kind: "user", text });
        } else if (event.type === "assistant/message") {
          const text = blocksText(event.data?.message?.content);
          if (text)
            items.push({ kind: "assistant", text });
        }
      }
      return items;
    } finally {
      await handle.close?.();
    }
  }
  async listSessions(limit = 12) {
    const persistence = this.#ctx.get?.("sessionPersistence");
    if (!persistence?.list)
      return [];
    try {
      const headers = await persistence.list();
      const cfg = this.configLoad();
      const retentionDays = Number(cfg.retentionDays ?? 0);
      const cutoff = retentionDays > 0 ? Date.now() - retentionDays * 86400000 : 0;
      const out = [];
      for (const entry of headers) {
        const h = entry?.header ?? entry;
        if (h?.origin === "subagent" || (h?.delegationDepth ?? 0) > 0)
          continue;
        const id = String(h?.id ?? "");
        if (!id)
          continue;
        const updatedAt = String(h?.updatedAt ?? h?.lastEventAt ?? h?.mtime ?? "");
        if (cutoff > 0 && updatedAt && new Date(updatedAt).getTime() < cutoff)
          continue;
        out.push({
          id,
          title: String(h?.title ?? h?.firstPrompt ?? h?.name ?? "").slice(0, 40),
          updatedAt
        });
      }
      return out.filter((s) => s.id).sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""))).slice(0, limit);
    } catch {
      return [];
    }
  }
  registerAskProvider(onAsk) {
    this.#ctx.on("user-questions/request", async (request, next) => {
      const asking = request?.agent?.session?.id;
      if (this.#sessionId !== undefined && asking !== undefined && String(asking) !== this.#sessionId)
        return next();
      const questions = request?.questions ?? [];
      if (!questions.length)
        return next();
      const simplified = questions.map((q) => ({
        id: String(q?.id ?? ""),
        prompt: String(q?.prompt ?? q?.question ?? q?.header ?? ""),
        options: (q?.options ?? []).map((o) => String(o?.label ?? o?.value ?? o))
      }));
      let picks;
      try {
        picks = await onAsk(simplified);
      } catch {
        return { answers: simplified.map((q) => ({ id: q.id, selected: [], custom: "declined" })) };
      }
      return {
        answers: simplified.map((q) => {
          const pick = picks.find((p) => p.questionId === q.id);
          return pick ? { id: q.id, selected: [pick.selected] } : { id: q.id, selected: [], custom: "declined" };
        })
      };
    });
  }
  #credentials() {
    try {
      return this.#ctx.get?.("credentials");
    } catch {
      return;
    }
  }
  async credentialStatus(ref) {
    const c = this.#credentials();
    if (c?.describe)
      return c.describe(ref);
    return { configured: false };
  }
  async login(ref, apiKey) {
    const c = this.#credentials();
    if (!c?.set)
      throw new Error("credentials service unavailable in this host");
    await c.set(ref, apiKey);
  }
  async logout(ref) {
    const c = this.#credentials();
    if (!c?.unset)
      throw new Error("credentials service unavailable in this host");
    await c.unset(ref);
  }
  async listHostCommands() {
    try {
      const cmds = this.#ctx.get?.("commands");
      if (!cmds?.list)
        return [];
      const list = this.#handle?.agent ? await cmds.list(this.#handle.agent) : await cmds.list?.();
      return (Array.isArray(list) ? list : []).map((c) => ({ name: String(c?.name ?? ""), description: String(c?.description ?? "") })).filter((c) => c.name);
    } catch {
      return [];
    }
  }
  async executeHostCommand(line) {
    try {
      const cmds = this.#ctx.get?.("commands");
      const agent = this.#handle?.agent;
      if (!cmds?.execute || !agent)
        return { text: "host command service unavailable" };
      const result = await cmds.execute(agent, line, new AbortController().signal);
      const text = result?.message ?? result?.text ?? result?.output;
      return text ? { text: String(text).slice(0, 300) } : {};
    } catch (e) {
      return { text: String(e instanceof Error ? e.message : e).slice(0, 300) };
    }
  }
  #presetId;
  async listPresets() {
    try {
      const registry = this.#ctx.get?.("agentPresets");
      if (!registry?.remoteExportList)
        return [];
      const roster = await registry.remoteExportList();
      const list = Array.isArray(roster) ? roster : roster?.entries ?? roster?.presets ?? [];
      return (Array.isArray(list) ? list : []).map((e) => ({ id: String(e?.id ?? ""), name: String(e?.name ?? e?.id ?? "") })).filter((e) => e.id);
    } catch {
      return [];
    }
  }
  switchPreset(presetId) {
    this.#presetId = presetId;
    this.newSession();
  }
  currentPresetId() {
    return this.#presetId;
  }
  keybindingsLoad() {
    try {
      return JSON.parse(readFileSync(this.configPath("keybindings.json"), "utf8"));
    } catch {
      return {};
    }
  }
  async btwAsk(question, snapshot, onDelta) {
    const sessionId = randomUUID();
    const handle = await this.#ctx.agents.create({
      sessionId,
      meta: { cwd: process.cwd() },
      agentOptions: this.#modelSelection() ?? undefined
    });
    const agentId = handle.agent.id;
    let out = "";
    const ctxAny = this.#ctx;
    return new Promise((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled)
          return;
        settled = true;
        offStream();
        offStatus();
        offTurn();
        try {
          handle.dispose();
        } catch {}
        resolve(out.trim());
      };
      const dbg = (m) => {
        if (process.env.DSH_OPENTUI_DEBUG) {
          try {
            appendFileSync("/tmp/otui-btw.log", `${Date.now()} ${m}
`);
          } catch {}
        }
      };
      dbg(`side agent ${agentId} created`);
      const offStream = ctxAny.on("agent/assistant-stream", ({ agent, frame }) => {
        if (agent.id !== agentId)
          return;
        dbg(`frame ${frame.type} ${frame.chunk?.type ?? ""} ${(frame.chunk?.text ?? "").length}ch`);
        if (frame.type !== "chunk" || !frame.chunk)
          return;
        if (frame.chunk.type === "text-delta" && frame.chunk.text) {
          out += frame.chunk.text;
          onDelta?.(out);
        }
      });
      const offTurn = ctxAny.on("session/event", (session, event) => {
        if (String(session?.id) === sessionId && event.type === "turn/end") {
          dbg(`turn/end reason=${JSON.stringify(event.data?.reason).slice(0, 200)}`);
          if (event.data?.reason?.kind === "error") {
            out = `error: ${String(event.data.reason.error?.message ?? "unknown").slice(0, 200)}`;
          }
          settle();
        }
      });
      const offStatus = ctxAny.on("agent/status", ({ agent, status }) => {
        if (agent.id === agentId)
          dbg(`status ${status}`);
      });
      const snap = snapshot.length > 0 ? `Recent conversation context (for reference only):
${snapshot.join(`
`).slice(-1500)}

` : "";
      const message = createUserMessage({
        content: [{ type: "text", text: `${snap}Side question (answer in one or two sentences, do not use tools): ${question}` }],
        source: { kind: "user" }
      });
      handle.agent.followup(message);
      setTimeout(settle, 120000);
    });
  }
  get settingsSeam() {
    const st = this.#ctx.get?.("settings");
    return st ? { describe: () => st.describe(), mutate: (ns, ops, rev) => st.mutate(ns, ops, rev) } : undefined;
  }
  async searchSessions(query) {
    try {
      const q = this.#ctx.get?.("sessionQuery");
      if (!q?.searchSessions)
        return [];
      const res = await q.searchSessions({ query, limit: 10 });
      return (res?.items ?? []).map((it) => ({
        id: String(it?.header?.id ?? ""),
        snippet: String(it?.bestMatch?.snippet ?? "").replace(/\s+/g, " ").slice(0, 80)
      })).filter((it) => it.id);
    } catch {
      return [];
    }
  }
  configPath(name = "config.json") {
    let dir = new URL(".", import.meta.url).pathname;
    for (let i = 0;i < 8; i++) {
      if (existsSync(join(dir, "cordis.patch.yml")))
        return join(dir, name);
      const parent = join(dir, "..");
      if (parent === dir)
        break;
      dir = parent;
    }
    const home = process.env.DSH_HOME || join(process.env.HOME || "", ".dsh");
    return join(home, "profiles", "dsh-opentui", name);
  }
  configLoad() {
    try {
      return JSON.parse(readFileSync(this.configPath(), "utf8"));
    } catch {
      return {};
    }
  }
  configSave(patch) {
    const merged = { ...this.configLoad(), ...patch };
    writeFileSync(this.configPath(), JSON.stringify(merged, null, 2) + `
`);
    return merged;
  }
  repairScan() {
    const out = [];
    try {
      const home = process.env.DSH_HOME || join(process.env.HOME || "", ".dsh");
      const root = join(home, "sessions");
      if (!existsSync(root))
        return ["no sessions directory"];
      let total = 0;
      let ok = 0;
      const broken = [];
      const visit = (dir, depth) => {
        if (depth > 4)
          return;
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) {
            visit(full, depth + 1);
            continue;
          }
          if (!(name.startsWith("session.") && (name.endsWith(".zstd") || name.endsWith(".jsonl"))))
            continue;
          total += 1;
          const size = statSync(full).size;
          if (size === 0) {
            broken.push(`${name} (0 bytes)`);
            continue;
          }
          if (name.endsWith(".zstd")) {
            const buf = readFileSync(full);
            const magicOk = buf[0] === 40 && buf[1] === 181 && buf[2] === 47 && buf[3] === 253;
            if (!magicOk) {
              broken.push(`${name} (not a zstd frame)`);
              continue;
            }
            ok += 1;
            continue;
          }
          try {
            const text = readFileSync(full, "utf8").trim();
            const last = text.split(`
`).filter((l) => l.trim()).pop() ?? "{}";
            JSON.parse(last);
            ok += 1;
          } catch {
            broken.push(`${name} (invalid jsonl tail)`);
          }
        }
      };
      visit(root, 0);
      out.push(`sessions: ${total} logs scanned, ${ok} healthy`);
      if (broken.length === 0)
        out.push("no broken logs found");
      else {
        out.push(`broken: ${broken.length}`);
        for (const b of broken.slice(0, 8))
          out.push(`  ✗ ${b}`);
        if (broken.length > 8)
          out.push(`  … +${broken.length - 8} more`);
      }
    } catch (e) {
      out.push(`scan failed: ${String(e instanceof Error ? e.message : e).slice(0, 150)}`);
    }
    return out;
  }
  listPlugins() {
    try {
      const root = new URL("../../../../package.json", import.meta.url).pathname;
      const pkg = JSON.parse(readFileSync(root, "utf8"));
      const out = [];
      for (const [name, range] of Object.entries(pkg.dependencies ?? {})) {
        if (name.startsWith("@deepseek-ai/"))
          continue;
        let version = range;
        try {
          version = JSON.parse(readFileSync(new URL(`../../../../node_modules/${name}/package.json`, import.meta.url).pathname, "utf8")).version;
        } catch {}
        out.push({ name, version });
      }
      return out;
    } catch {
      return [];
    }
  }
  executionMode() {
    return this.listPlugins().some((p) => /ptc|codemode/i.test(p.name)) ? "ptc" : "native";
  }
  usageSummary() {
    const fmt = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
    const lines = [
      `turns ${this.#turns}`,
      `prompt ${fmt(this.usage.prompt)} tok`,
      `completion ${fmt(this.usage.completion)} tok`
    ];
    const s = this.lastTurnStats;
    if (s.ms > 0) {
      const rate = s.tps === null ? "" : ` · ${Math.round(s.tps)} tok/s${s.estimated ? " (estimated)" : ""}`;
      lines.push(`last turn ${(s.ms / 1000).toFixed(1)}s${rate}`);
    }
    return lines;
  }
  async turn(userText, cb, _signal) {
    this.#cb = cb;
    this.#disarmIdleRelease();
    this.#turns++;
    this.#ticker.reset();
    this.#turnStartedAt = Date.now();
    this.#turnUsageStart = { prompt: this.usage.prompt, completion: this.usage.completion };
    if (!this.#handle) {
      const reattach = this.#isReleasedForReattach();
      this.#sessionId = this.#resumeId ?? this.#sessionId ?? randomUUID();
      this.#resumeId = undefined;
      if (reattach)
        this.#presetId = undefined;
      const agentOptions = this.#modelSelection() ?? {};
      try {
        this.#handle = await this.#ctx.agents.create({
          sessionId: this.#sessionId,
          meta: { cwd: process.cwd(), ...this.#presetId ? { agentPreset: this.#presetId } : {} },
          agentOptions
        });
      } catch (error) {
        if (reattach && error?.name === "SessionAlreadyOwnedError") {
          throw new Error("session is being driven by another process (phone/web) — send again later to re-take it, or /new for a fresh session");
        }
        throw error;
      }
      this.#agentId = this.#handle.agent.id;
      DBG(`session created ${this.#sessionId} agent=${this.#agentId}`);
      if (reattach) {
        const missed = await this.storedTranscript(this.#sessionId, this.#releasedSeq);
        this.#releasedSeq = 0;
        if (missed.length > 0)
          cb.onReattachedMissed?.(missed);
      }
    }
    const message = createUserMessage({
      content: [
        { type: "text", text: userText },
        ...this.#pendingImages.map((ref) => ({ type: "image", attachment: ref }))
      ],
      source: { kind: "user" }
    });
    this.#pendingImages = [];
    this.#handle.agent.followup(message);
    await new Promise((resolve) => {
      this.#resolveTurn = resolve;
    });
  }
  #pendingImages = [];
  #idleReleaseMs() {
    const cfg = this.configLoad();
    const sec = Number(cfg.idleReleaseSec ?? 600);
    if (!Number.isFinite(sec) || sec <= 0)
      return 0;
    return sec * 1000;
  }
  #armIdleRelease() {
    this.#disarmIdleRelease();
    const ms = this.#idleReleaseMs();
    if (ms <= 0 || this.#sessionId === undefined)
      return;
    const timer = setTimeout(() => this.#releaseIdle(), ms);
    timer.unref?.();
    this.#idleTimer = timer;
  }
  #disarmIdleRelease() {
    if (this.#idleTimer === undefined)
      return;
    clearTimeout(this.#idleTimer);
    this.#idleTimer = undefined;
  }
  #releaseIdle() {
    this.#idleTimer = undefined;
    if (this.#handle === undefined || this.#running)
      return;
    this.#releasedSeq = this.#snapshot().length;
    this.#toolCalls.clear();
    try {
      this.#handle?.dispose?.();
    } catch {}
    this.#handle = undefined;
    this.#agentId = undefined;
  }
  #isReleasedForReattach() {
    return this.#handle === undefined && this.#sessionId !== undefined && this.#resumeId === undefined;
  }
  #children = new Map;
  #runSeqToChild = new Map;
  #childLogs = new Map;
  #childAgents = new Map;
  childTranscript(id) {
    return [...this.#childLogs.get(id) ?? []];
  }
  steerChild(id, text) {
    const agent = this.#childAgents.get(id);
    if (!agent?.steer)
      return false;
    try {
      agent.steer(createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } }));
      return true;
    } catch {
      return false;
    }
  }
  #adoptChild(session, sessionKey) {
    if (this.#children.has(sessionKey))
      return false;
    const header = session?.header;
    if (!header || String(header.parentSession) !== this.#sessionId)
      return false;
    if (header.origin !== "subagent" && (header.delegationDepth ?? 0) <= 0)
      return false;
    this.#children.set(sessionKey, {
      label: `subagent ${sessionKey.slice(0, 8)}`,
      status: "running",
      rounds: 0,
      startedAt: Date.now()
    });
    const agent = session?.agent;
    if (agent)
      this.#childAgents.set(sessionKey, agent);
    return true;
  }
  #registerChild(childId, label) {
    if (!childId)
      return;
    const existing = this.#children.get(childId);
    if (existing) {
      if (label && label !== existing.label)
        this.#children.set(childId, { ...existing, label });
    } else {
      this.#children.set(childId, { label: label || `subagent ${childId.slice(0, 8)}`, status: "running", rounds: 0, startedAt: Date.now() });
    }
    this.#emitChildren();
  }
  #settleChild(childId, outcome) {
    const existing = this.#children.get(childId);
    if (existing && existing.status === "running") {
      this.#children.set(childId, { ...existing, status: outcome });
      this.#emitChildren();
    }
  }
  #foldChildEvent(session, sessionKey, event) {
    let changed = this.#adoptChild(session, sessionKey);
    const view = this.#children.get(sessionKey);
    if (!view)
      return;
    const d = event.data ?? {};
    if (event.type === "subagent/descriptor") {
      const label = typeof d.label === "string" && d.label ? d.label : undefined;
      const model = [d.agentProvider, d.agentModel].filter(Boolean).join("/") || (typeof d.provider === "string" ? String(d.provider) : undefined);
      const next = { ...view, ...label ? { label } : {}, ...model ? { model } : {} };
      this.#children.set(sessionKey, next);
      changed = true;
    } else if (event.type === "request/header") {
      const cfg = d.header?.config ?? d.config;
      const model = cfg && (cfg.provider || cfg.model) ? `${cfg.provider ?? ""}/${cfg.model ?? ""}`.replace(/^\//, "") : undefined;
      if (model) {
        this.#children.set(sessionKey, { ...view, model });
        changed = true;
      }
    } else if (event.type === "assistant/message") {
      const text = blocksText(d.message?.content ?? d.content);
      const usage = d.usage?.totalTokens ?? d.message?.usage?.totalTokens ?? d.message?.usage?.total_tokens;
      this.#children.set(sessionKey, {
        ...view,
        rounds: view.rounds + 1,
        ...usage ? { tokens: (view.tokens ?? 0) + Number(usage) } : {},
        ...text ? { lastLine: text.split(`
`).pop()?.slice(0, 80) } : {}
      });
      changed = true;
    }
    const log = this.#childLogs.get(sessionKey) ?? [];
    if (event.type === "assistant/message") {
      const text = blocksText(d.message?.content ?? d.content);
      for (const line of text.split(`
`))
        if (line.trim())
          log.push(line.slice(0, 110));
    } else if (event.type === "tool/call") {
      log.push(`▶ ${d.name ?? "tool"} ${String(d.arguments ?? "").slice(0, 90)}`);
    } else if (event.type === "tool/result") {
      log.push("  ⎿ done");
    }
    while (log.length > 200)
      log.shift();
    if (log.length > 0)
      this.#childLogs.set(sessionKey, log);
    if (changed)
      this.#emitChildren();
  }
  #emitChildren() {
    const cb = this.#cb;
    if (!cb?.onSubagentUpdate)
      return;
    cb.onSubagentUpdate([...this.#children.entries()].map(([id, v]) => ({
      id,
      label: v.label,
      ...v.model ? { model: v.model } : {},
      status: v.status,
      rounds: v.rounds,
      ...v.tokens !== undefined ? { tokens: v.tokens } : {},
      elapsed: Math.max(0, Math.floor((Date.now() - v.startedAt) / 1000)),
      ...v.lastLine ? { lastLine: v.lastLine } : {}
    })));
  }
  historyTurns() {
    const events = this.#snapshot();
    const turns = [];
    let open;
    for (const event of events) {
      if (event.type === "turn/start") {
        open = { turn: Number(event.data?.turn ?? turns.length), seqEnd: Number(event.seq ?? 0), preview: "" };
        continue;
      }
      if (!open)
        continue;
      if (event.type === "user/message") {
        const kind = event.data?.source?.kind;
        if (kind === undefined || kind === "user") {
          const text = blocksText(event.data?.content);
          if (text && !open.preview)
            open.preview = text;
        }
      } else if (event.type === "turn/end") {
        open.seqEnd = Number(event.seq ?? open.seqEnd);
        turns.push(open);
        open = undefined;
      }
    }
    return turns;
  }
  #snapshot() {
    const session = this.#handle?.agent?.session;
    const snap = session?.snapshotEvents?.();
    return Array.isArray(snap) ? snap : [];
  }
  async forkAtTurn(seqEnd) {
    const events = this.#snapshot();
    if (events.length === 0)
      throw new Error("no live session to fork");
    const seed = events.slice(0, seqEnd + 1);
    if (seed.length === 0)
      throw new Error("fork point before the first event");
    const parentSession = this.#sessionId;
    const sel = this.#modelSelection();
    this.#disarmIdleRelease();
    this.#releasedSeq = 0;
    try {
      this.#handle?.dispose?.();
    } catch {}
    this.#handle = undefined;
    this.#agentId = undefined;
    this.#sessionId = randomUUID();
    this.#children.clear();
    this.#runSeqToChild.clear();
    this.#toolCalls.clear();
    this.#handle = await this.#ctx.agents.create({
      sessionId: this.#sessionId,
      meta: { cwd: process.cwd(), ...parentSession ? { parentSession, isSeeded: true } : {} },
      ...seed ? { seed, inheritedEventCount: seed.length } : {},
      ...sel ? { agentOptions: sel } : {}
    });
    this.#agentId = this.#handle.agent.id;
    const items = [];
    for (const event of seed) {
      if (event.type === "user/message") {
        const kind = event.data?.source?.kind;
        if (kind !== undefined && kind !== "user")
          continue;
        const text = blocksText(event.data?.content);
        if (text)
          items.push({ kind: "user", text });
      } else if (event.type === "assistant/message") {
        const text = blocksText(event.data?.message?.content);
        if (text)
          items.push({ kind: "assistant", text });
      }
    }
    return { items, turn: seed.length };
  }
  #modelSelection() {
    const sel = this.#override ?? this.#ctx.get?.("agentDefaultModel")?.currentSelection?.();
    if (!sel)
      return;
    if (this.#handle === undefined)
      this.label = `${sel.provider}/${sel.model}${sel.reasoningEffort ? ` (${sel.reasoningEffort})` : ""}`;
    return { provider: sel.provider, model: sel.model, ...sel.reasoningEffort ? { reasoningEffort: sel.reasoningEffort } : {} };
  }
  async attachImage(path) {
    const store = this.#ctx.get?.("attachments");
    if (!store?.saveImages)
      throw new Error("attachment service unavailable in this host");
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    const mediaType = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
    if (!mediaType[ext])
      throw new Error(`unsupported image type .${ext} (png/jpg/webp/gif)`);
    const data = await (await import("node:fs/promises")).readFile(path);
    const [ref] = await store.saveImages([{ data: new Uint8Array(data), mediaType: mediaType[ext], name: path.split("/").pop() }]);
    this.#pendingImages.push(ref);
    return `${ref.name ?? path} (${(ref.bytes / 1024).toFixed(0)} KB)`;
  }
  abort() {
    this.#disarmIdleRelease();
    try {
      this.#handle?.dispose?.();
    } catch {}
    this.#handle = undefined;
    this.#agentId = undefined;
    this.#sessionId = undefined;
    this.#releasedSeq = 0;
    this.#resolveTurn?.();
    this.#resolveTurn = undefined;
  }
  steer(userText) {
    if (!this.#handle)
      return;
    const message = createUserMessage({
      content: [{ type: "text", text: userText }],
      source: { kind: "user" }
    });
    this.#handle.agent.steer?.(message);
  }
  #finishTurn() {
    DBG("finishTurn");
    const endedAt = Date.now();
    this.#ticker.finish();
    const chars = this.#ticker.chars();
    const ms = Math.max(0, endedAt - this.#turnStartedAt);
    const completion = this.usage.completion - this.#turnUsageStart.completion;
    const real = completion > 0;
    const tokens = real ? completion : estimateTokens(chars);
    this.lastTurnStats = {
      startedAt: this.#turnStartedAt,
      endedAt,
      ms,
      chars,
      tokens,
      tps: tokensPerSecond(tokens, ms),
      estimated: !real
    };
    const r = this.#resolveTurn;
    this.#resolveTurn = undefined;
    this.#cb?.onTurnEnd({ prompt: this.usage.prompt, completion: this.usage.completion });
    this.#armIdleRelease();
    r?.();
  }
  #wire() {
    const ctx = this.#ctx;
    ctx.on("agent/assistant-stream", ({ agent, frame }) => {
      if (this.#agentId === undefined || agent.id !== this.#agentId)
        return;
      const cb = this.#cb;
      if (!cb || frame.type !== "chunk" || !frame.chunk)
        return;
      const c = frame.chunk;
      if (process.env.DSH_OPENTUI_DEBUG) {
        try {
          appendFileSync("/tmp/otui-stream.log", `${Date.now()} ${c.type} ${(c.text ?? "").length}ch
`);
        } catch {}
      }
      try {
        if (c.type === "reasoning-delta" && c.text) {
          cb.onThinkingDelta(c.text);
          this.#ticker.add(c.text.length);
        } else if (c.type === "text-delta" && c.text) {
          cb.onContentDelta(c.text);
          this.#ticker.add(c.text.length);
        } else if (c.type === "usage") {
          if (process.env.DSH_OPENTUI_DEBUG) {
            try {
              appendFileSync("/tmp/otui-usage.log", JSON.stringify(c) + `
`);
            } catch {}
          }
          const u = c.usage ?? {};
          const num = (v) => typeof v === "number" ? v : 0;
          let p = Math.max(num(u.promptTokens), num(u.inputTokens), num(u.prompt_tokens));
          let comp = Math.max(num(u.completionTokens), num(u.outputTokens), num(u.completion_tokens));
          const cRead = Math.max(num(u.cacheReadTokens), num(u.cache_read_tokens), num(u.cacheRead));
          const cWrite = Math.max(num(u.cacheWriteTokens), num(u.cache_write_tokens), num(u.cacheWrite));
          if (p > 0)
            this.usage.prompt = p;
          if (comp > 0)
            this.usage.completion += comp;
          if (cRead > 0)
            this.usage.cacheRead = cRead;
          if (cWrite > 0)
            this.usage.cacheWrite = cWrite;
        } else if (c.type === "tool-call-delta" && c.name) {}
      } catch {}
    });
    ctx.on("agent/status", ({ agent, status }) => {
      if (this.#agentId === undefined || agent.id !== this.#agentId)
        return;
      const wasRunning = this.#running;
      this.#running = status === "running";
      DBG(`agent/status ${status} wasRunning=${wasRunning} resolve=${!!this.#resolveTurn}`);
      if (wasRunning && !this.#running && this.#resolveTurn)
        this.#finishTurn();
    });
    ctx.on("session/event", (session, event) => {
      if (process.env.DSH_OPENTUI_DEBUG && (event.type === "turn/end" || event.type === "turn/start")) {
        try {
          process.stderr.write(`[hs] session/event ${event.type} sessionMatch=${String(session.id) === this.#sessionId} my=${this.#sessionId}
`);
        } catch {}
      }
      const sessionKey = String(session.id);
      if (this.#sessionId === undefined)
        return;
      if (sessionKey !== this.#sessionId) {
        this.#foldChildEvent(session, sessionKey, event);
        return;
      }
      const cb = this.#cb;
      if (!cb)
        return;
      try {
        if (event.type === "tool/call" && event.data) {
          const callId = String(event.data.callId ?? "");
          const name = String(event.data.name ?? "tool");
          const args = String(event.data.arguments ?? "");
          this.#toolCalls.set(callId, { name, args });
          cb.onToolStart?.({ callId, name, args });
        } else if (event.type === "todo/write") {
          cb.onTodos?.(event.data?.todos ?? []);
        } else if (event.type === "tool-workflow/agent-start" && event.data) {
          this.#registerChild(String(event.data.childId ?? ""), String(event.data.label ?? "subagent"));
          this.#runSeqToChild.set(`${event.data.runId}:${event.data.seq}`, String(event.data.childId ?? ""));
        } else if (event.type === "tool-workflow/agent-end" && event.data) {
          const childId = this.#runSeqToChild.get(`${event.data.runId}:${event.data.seq}`);
          const outcome = event.data.outcome === "failed" || event.data.outcome === "cancelled" ? event.data.outcome : "completed";
          if (childId)
            this.#settleChild(childId, outcome);
        } else if (event.type === "tool/result" && event.data) {
          const callId = String(event.data.callId ?? event.data.message?.toolCallId ?? "");
          const known = this.#toolCalls.get(callId);
          const brief = JSON.stringify(event.data.output ?? event.data).slice(0, 300);
          const content = event.data.message?.content ?? event.data.content ?? [];
          const imageBlock = content.find?.((c) => c?.type === "image");
          const pathMatch = /<path>([^<]+)<\/path>/.exec(content.find?.((c) => c?.type === "text")?.text ?? "");
          const imagePath = (typeof imageBlock?.source === "string" ? imageBlock.source : undefined) ?? imageBlock?.path ?? imageBlock?.file_path ?? imageBlock?.url ?? (imageBlock ? pathMatch?.[1] : undefined);
          cb.onToolRun({
            name: known?.name ?? "tool",
            argsPretty: known?.args ?? "",
            output: brief,
            ok: event.data.isError !== true,
            ...callId ? { callId } : {},
            ...typeof imagePath === "string" ? { imagePath } : {}
          });
        } else if (event.type === "turn/end") {
          DBG(`turn/end seen resolve=${!!this.#resolveTurn}`);
          const reason = event.data?.reason;
          if (reason?.kind === "error") {
            cb.onError(String(reason.error?.message ?? reason.error ?? "turn error").slice(0, 300));
          }
          if (this.#resolveTurn)
            this.#finishTurn();
        }
      } catch {}
    });
    ctx.on("approval/request", async (request, next) => {
      if (this.#sessionId === undefined || String(request?.agent?.session?.id) !== this.#sessionId)
        return next();
      const cb = this.#cb;
      if (!cb)
        return "unavailable";
      let args = {};
      try {
        const raw = this.#lookupCallArgs(request) ?? "";
        if (raw)
          args = JSON.parse(raw);
      } catch {}
      const ok = await cb.onApprove(String(request.toolName ?? "tool"), args);
      return ok ? "allowed-once" : "rejected";
    });
  }
  #lookupCallArgs(request) {
    if (!request?.callId)
      return;
    const session = request.agent?.session;
    if (typeof session?.eventAt !== "function")
      return;
    for (let seq = (session.seq ?? 0) - 1;seq >= 0; seq--) {
      const event = session.eventAt(seq);
      if (event?.type === "tool/call" && String(event.data?.callId ?? "") === String(request.callId)) {
        return event.data?.arguments;
      }
    }
    return;
  }
}

// src/host-entry.tsx
var inject = ["agents"];
function hasFfiFlag() {
  return (process.env.NODE_OPTIONS ?? "").includes("--experimental-ffi");
}
function reExecWithFfi() {
  if (hasFfiFlag())
    return false;
  const env = {
    ...process.env,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --experimental-ffi`.trim()
  };
  const child = spawn(process.argv[1], process.argv.slice(2), {
    env,
    stdio: "inherit",
    cwd: process.cwd()
  });
  child.on("exit", (code) => process.exit(code ?? 0));
  return true;
}
function apply(ctx, config) {
  const i18n = createI18n("zh-CN");
  const store = new SurfaceStore;
  const session = new HostSession(ctx);
  mountEngine({}).then(({
    renderer
  }) => {
    render(() => _$createComponent16(ShellHost, {
      get deps() {
        return {
          store,
          t: i18n.t,
          session,
          themeName: config?.theme,
          i18n
        };
      }
    }), renderer);
  }).catch((e) => {
    const msg = String(e);
    if (/native FFI is not available/.test(msg) && reExecWithFfi())
      return;
    process.stderr.write("dsh-opentui boot failed: " + msg + `
`);
  });
}
var plugin = {
  name: "dsh-opentui",
  inject,
  apply
};
var host_entry_default = plugin;
export {
  apply,
  host_entry_default as default,
  plugin
};
