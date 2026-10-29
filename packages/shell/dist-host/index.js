// src/host-entry.tsx
import { createComponent as _$createComponent3 } from "@opentui/solid";
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
    en: "/help · /model [provider/id] · /usage · /clear · /quit"
  },
  "cmd.model.current": { "zh-CN": "当前模型", en: "current model" },
  "cmd.model.available": { "zh-CN": "可用模型", en: "available" },
  "cmd.model.set": { "zh-CN": "已切换", en: "switched to" },
  "cmd.usage.summary": { "zh-CN": "累计", en: "total" },
  "cmd.cleared": { "zh-CN": "会话已清空", en: "session cleared" }
};
function createI18n(locale = "zh-CN") {
  const fmt = (s, vars) => vars ? s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)) : s;
  return {
    locale,
    t: (key, vars) => {
      const entry = dict[key];
      return entry ? fmt(entry[locale], vars) : key;
    }
  };
}

// src/ShellHost.tsx
import { memo as _$memo } from "@opentui/solid";
import { createComponent as _$createComponent2 } from "@opentui/solid";
import { setProp as _$setProp2 } from "@opentui/solid";
import { effect as _$effect2 } from "@opentui/solid";
import { insert as _$insert2 } from "@opentui/solid";
import { createTextNode as _$createTextNode2 } from "@opentui/solid";
import { insertNode as _$insertNode2 } from "@opentui/solid";
import { createElement as _$createElement2 } from "@opentui/solid";
import { For as For2, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { createTextAttributes, SyntaxStyle } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/solid";
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
var catppuccinMocha = {
  name: "catppuccin-mocha",
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
    approvalBorder: "#f9e2af"
  }
};
var themes = {
  default: defaultTheme,
  "catppuccin-mocha": catppuccinMocha
};
function getTheme(name) {
  if (name && themes[name])
    return themes[name];
  return defaultTheme;
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
function renderParts(parts) {
  return _$createComponent(For, {
    each: parts,
    children: (p) => (() => {
      var _el$ = _$createElement("span");
      _$insert(_el$, () => p.text);
      _$effect((_$p) => _$setProp(_el$, "style", {
        fg: p.dim ? defaultTheme.tokens.dim : p.color
      }, _$p));
      return _el$;
    })()
  });
}
function StatusBar(props) {
  return (() => {
    var _el$3 = _$createElement("box"), _el$4 = _$createElement("text");
    _$insertNode(_el$3, _el$4);
    _$insertNode(_el$4, _$createTextNode(`dsh`));
    _$insert(_el$3, _$createComponent(For, {
      get each() {
        return props.widgets.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      },
      children: (w) => (() => {
        var _el$6 = _$createElement("text");
        _$insert(_el$6, () => renderParts(w.parts));
        return _el$6;
      })()
    }), null);
    _$effect((_p$) => {
      var _v$ = {
        border: true,
        borderColor: defaultTheme.tokens.border,
        flexDirection: "row",
        gap: 2
      }, _v$2 = {
        fg: defaultTheme.tokens.accent
      };
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$3, "style", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$4, "style", _v$2, _p$.t));
      return _p$;
    }, {
      e: undefined,
      t: undefined
    });
    return _el$3;
  })();
}
// src/ShellHost.tsx
var MAX_VISIBLE_ITEMS = 120;
var THEME_ORDER = ["catppuccin-mocha", "default"];
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
  name: "/theme",
  desc: "cycle theme"
}, {
  name: "/model",
  desc: "show or switch model (/model provider/id)"
}, {
  name: "/quit",
  desc: "exit the shell"
}];
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
function ShellHost(props) {
  const t = props.deps.t;
  const store = props.deps.store;
  const [input, setInput] = createSignal("");
  const [cursor, setCursor] = createSignal(0);
  const [history, setHistory] = createSignal([]);
  const [historyIdx, setHistoryIdx] = createSignal(0);
  const [items, setItems] = createSignal([]);
  const [busy, setBusy] = createSignal(false);
  const [spin, setSpin] = createSignal(0);
  const [approval, setApproval] = createSignal(null);
  const [usage, setUsage] = createSignal({
    prompt: 0,
    completion: 0,
    turns: 0
  });
  const [label, setLabel] = createSignal(props.deps.session.label);
  const [snapshot, setSnapshot] = createSignal(store.snapshot);
  const initialTheme = process.env.DSH_OPENTUI_THEME ?? props.deps.themeName ?? "catppuccin-mocha";
  const [themeName, setThemeName] = createSignal(themes[initialTheme] ? initialTheme : "catppuccin-mocha");
  const theme = () => getTheme(themeName());
  const [menuOpen, setMenuOpen] = createSignal(true);
  const [menuSel, setMenuSel] = createSignal(0);
  let approveResolve = null;
  onMount(() => {
    onCleanup(store.subscribe(() => setSnapshot(store.snapshot)));
    const t2 = setInterval(() => setSpin((s) => (s + 1) % 4), 150);
    onCleanup(() => clearInterval(t2));
  });
  const spinner = () => ["⠋", "⠙", "⠹", "⠸"][spin()];
  const filteredCommands = createMemo(() => {
    const m = /^\/(\S*)/.exec(input());
    if (!m)
      return [];
    return COMMANDS.filter((c) => c.name.slice(1).startsWith(m[1]));
  });
  const clampedSel = createMemo(() => {
    const n = filteredCommands().length;
    return n === 0 ? 0 : Math.min(menuSel(), n - 1);
  });
  const menuVisible = createMemo(() => !busy() && menuOpen() && filteredCommands().length > 0);
  const rendererCtx = useRenderer();
  let mdStyle;
  try {
    mdStyle = SyntaxStyle.create(rendererCtx);
  } catch {
    mdStyle = undefined;
  }
  const visibleItems = createMemo(() => items().slice(-MAX_VISIBLE_ITEMS));
  const itemNode = (it) => {
    const th = theme();
    if (it.kind === "user") {
      return (() => {
        var _el$ = _$createElement2("text"), _el$2 = _$createTextNode2(`❯ `);
        _$insertNode2(_el$, _el$2);
        _$insert2(_el$, () => it.text, null);
        _$effect2((_$p) => _$setProp2(_el$, "style", {
          fg: th.tokens.userMark ?? th.tokens.accent
        }, _$p));
        return _el$;
      })();
    }
    if (it.kind === "assistant") {
      if (it.final) {
        return (() => {
          var _el$3 = _$createElement2("box"), _el$4 = _$createElement2("markdown"), _el$5 = _$createElement2("text");
          _$insertNode2(_el$3, _el$4);
          _$insertNode2(_el$3, _el$5);
          _$setProp2(_el$3, "style", {
            flexDirection: "column"
          });
          _$setProp2(_el$4, "streaming", false);
          _$setProp2(_el$4, "syntaxStyle", mdStyle);
          _$insertNode2(_el$5, _$createTextNode2(` `));
          _$effect2((_$p) => _$setProp2(_el$4, "content", it.text, _$p));
          return _el$3;
        })();
      }
      return (() => {
        var _el$7 = _$createElement2("box");
        _$setProp2(_el$7, "style", {
          flexDirection: "column"
        });
        _$insert2(_el$7, _$createComponent2(For2, {
          get each() {
            return renderAssistant(it.text, th);
          },
          children: (l) => (() => {
            var _el$8 = _$createElement2("text");
            _$insert2(_el$8, () => l.text || " ");
            _$effect2((_$p) => _$setProp2(_el$8, "style", l.fg ? {
              fg: l.fg
            } : {}, _$p));
            return _el$8;
          })()
        }));
        return _el$7;
      })();
    }
    if (it.kind === "thinking") {
      return (() => {
        var _el$9 = _$createElement2("text");
        _$insert2(_el$9, () => `${spinner()} ${t("agent.thinking")} (${it.chars}) ${it.tail.slice(-120)}`);
        _$effect2((_$p) => _$setProp2(_el$9, "style", {
          fg: th.tokens.dim
        }, _$p));
        return _el$9;
      })();
    }
    if (it.kind === "tool") {
      return (() => {
        var _el$0 = _$createElement2("box"), _el$1 = _$createElement2("text"), _el$10 = _$createElement2("text");
        _$insertNode2(_el$0, _el$1);
        _$insertNode2(_el$0, _el$10);
        _$setProp2(_el$0, "style", {
          flexDirection: "column"
        });
        _$insert2(_el$1, () => ` ⚒ ${it.name} ${it.args.slice(0, 90)}`);
        _$insert2(_el$10, () => ` ⎿ ${it.ok ? t("agent.tool.ok") : t("agent.tool.fail")}: ${it.brief.slice(0, 110)}`);
        _$effect2((_p$) => {
          var _v$ = {
            fg: th.tokens.toolOk ?? th.tokens.warn
          }, _v$2 = {
            fg: it.ok ? th.tokens.dim : th.tokens.toolFail ?? th.tokens.danger
          };
          _v$ !== _p$.e && (_p$.e = _$setProp2(_el$1, "style", _v$, _p$.e));
          _v$2 !== _p$.t && (_p$.t = _$setProp2(_el$10, "style", _v$2, _p$.t));
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        return _el$0;
      })();
    }
    if (it.kind === "error") {
      return (() => {
        var _el$11 = _$createElement2("text"), _el$12 = _$createTextNode2(`✗ `), _el$13 = _$createTextNode2(`: `);
        _$insertNode2(_el$11, _el$12);
        _$insertNode2(_el$11, _el$13);
        _$insert2(_el$11, () => t("agent.error"), _el$13);
        _$insert2(_el$11, () => it.text, null);
        _$effect2((_$p) => _$setProp2(_el$11, "style", {
          fg: th.tokens.danger
        }, _$p));
        return _el$11;
      })();
    }
    return (() => {
      var _el$14 = _$createElement2("text"), _el$15 = _$createTextNode2(`· `);
      _$insertNode2(_el$14, _el$15);
      _$insert2(_el$14, () => it.text, null);
      _$effect2((_$p) => _$setProp2(_el$14, "style", {
        fg: th.tokens.dim
      }, _$p));
      return _el$14;
    })();
  };
  let lastBump = 0;
  let streaming = {};
  const bumpSoon = () => {
    const now = Date.now();
    if (now - lastBump > 60) {
      lastBump = now;
      setItems((arr) => arr.map((x) => x === streaming.thinking || x === streaming.reply ? {
        ...x
      } : x));
    }
  };
  const push = (it) => setItems((arr) => [...arr, it]);
  const wordStart = (s, pos) => {
    const cut = s.slice(0, pos).replace(/\s+$/, "").replace(/\S+$/, "").length;
    return Math.min(cut, pos);
  };
  const resetHistoryNav = () => setHistoryIdx(history().length);
  const insertChar = (ch) => {
    const s = input();
    const c = Math.min(cursor(), s.length);
    setInput(s.slice(0, c) + ch + s.slice(c));
    setCursor(c + ch.length);
    resetHistoryNav();
  };
  const commitHistory = (text) => {
    if (!text)
      return;
    const h = history();
    const next = h[h.length - 1] === text ? h : [...h, text];
    setHistory(next);
    setHistoryIdx(next.length);
  };
  const historyNav = (dir) => {
    const h = history();
    if (h.length === 0)
      return;
    let idx = Math.min(historyIdx(), h.length);
    if (dir === -1 && idx > 0)
      idx -= 1;
    else if (dir === 1 && idx < h.length)
      idx += 1;
    else
      return;
    setHistoryIdx(idx);
    const text = idx === h.length ? "" : h[idx];
    setInput(text);
    setCursor(text.length);
  };
  const inputChunks = () => {
    const s = input();
    const c = Math.min(cursor(), s.length);
    return {
      before: s.slice(0, c),
      at: c < s.length ? s.charAt(c) : " ",
      after: c < s.length ? s.slice(c + 1) : ""
    };
  };
  function runCommand(text) {
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
    } else if (cmd === "clear") {
      setItems([]);
      push({
        kind: "system",
        text: t("cmd.cleared")
      });
    } else if (cmd === "usage") {
      const u = usage();
      push({
        kind: "system",
        text: `${t("cmd.usage.summary")}: ${u.turns} turns · prompt ${u.prompt} · completion ${u.completion} tokens`
      });
    } else if (cmd === "theme") {
      const i = THEME_ORDER.indexOf(themeName());
      const next = THEME_ORDER[(i + 1) % THEME_ORDER.length];
      setThemeName(next);
      push({
        kind: "system",
        text: `theme → ${next}`
      });
    } else if (cmd === "model") {
      if (!arg) {
        push({
          kind: "system",
          text: `model: ${props.deps.session.label}`
        });
        const catalog = props.deps.session.listProviders();
        for (const p of catalog) {
          push({
            kind: "system",
            text: `  ${p.provider}: ${p.models.slice(0, 8).join(", ")}${p.models.length > 8 ? ` …(+${p.models.length - 8})` : ""}`
          });
        }
        push({
          kind: "system",
          text: "switch: /model provider/model-id (applies to the next message)"
        });
      } else {
        const [provider, model] = arg.split("/");
        if (!provider || !model) {
          push({
            kind: "error",
            text: "usage: /model provider/model-id"
          });
        } else {
          props.deps.session.switchModel(provider, model);
          setLabel(props.deps.session.label);
          push({
            kind: "system",
            text: `model → ${provider}/${model} (next message)`
          });
        }
      }
    } else {
      push({
        kind: "system",
        text: `unknown command: /${cmd} (try /help)`
      });
    }
  }
  async function send(text) {
    if (busy())
      return;
    push({
      kind: "user",
      text
    });
    setBusy(true);
    let thinkingItem = null;
    let replyItem = null;
    streaming = {};
    try {
      await props.deps.session.turn(text, {
        onThinkingDelta: (s) => {
          if (!thinkingItem) {
            thinkingItem = {
              kind: "thinking",
              tail: "",
              chars: 0
            };
            streaming.thinking = thinkingItem;
            push(thinkingItem);
          }
          thinkingItem.tail = (thinkingItem.tail + s).split(`
`).slice(-2).join(" ");
          thinkingItem.chars += s.length;
          bumpSoon();
        },
        onContentDelta: (s) => {
          if (thinkingItem) {
            thinkingItem.tail = `…${thinkingItem.chars}`;
            thinkingItem = null;
          }
          if (!replyItem) {
            replyItem = {
              kind: "assistant",
              text: ""
            };
            streaming.reply = replyItem;
            push(replyItem);
          }
          replyItem.text += s;
          bumpSoon();
        },
        onTurnEnd: (u) => {
          if (replyItem) {
            const final = {
              ...replyItem,
              final: true
            };
            setItems((arr) => arr.map((x) => x === replyItem ? final : x));
          }
          setLabel(props.deps.session.label);
          setUsage((v) => ({
            prompt: v.prompt + u.prompt,
            completion: v.completion + u.completion,
            turns: v.turns + 1
          }));
        },
        onApprove: (name, args) => {
          setApproval({
            name,
            args: JSON.stringify(args)
          });
          return new Promise((resolve) => {
            approveResolve = resolve;
          });
        },
        onToolRun: (run) => {
          const brief = run.output.split(`
`).slice(-3).join(" ⏎ ").slice(0, 200);
          push({
            kind: "tool",
            name: run.name,
            args: run.argsPretty,
            ok: run.ok,
            brief
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
        text: String(e instanceof Error ? e.message : e).slice(0, 300)
      });
    } finally {
      setApproval(null);
      approveResolve = null;
      setBusy(false);
    }
  }
  useKeyboard((key) => {
    if (process.env.DSH_OPENTUI_DEBUG) {
      import("node:fs").then((fs) => fs.appendFileSync("/tmp/host-keys.log", JSON.stringify({
        name: key.name,
        seq: key.sequence
      }) + `
`)).catch(() => {});
    }
    if (key.sequence === "\x03" || (key.name === "c" || key.name === "C") && key.ctrl)
      process.exit(0);
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
    if (busy())
      return;
    if (menuVisible() && (key.name === "up" || key.name === "down")) {
      const n = filteredCommands().length;
      setMenuSel((s) => key.name === "up" ? (s - 1 + n) % n : (s + 1) % n);
      return;
    }
    if (key.name === "up" || key.name === "down") {
      if (input().startsWith("/"))
        return;
      return historyNav(key.name === "up" ? -1 : 1);
    }
    if (key.name === "left")
      return setCursor((c) => Math.max(0, c - 1));
    if (key.name === "right")
      return setCursor((c) => Math.min(input().length, c + 1));
    if (key.name === "home" || key.ctrl && key.name === "a")
      return setCursor(0);
    if (key.name === "end" || key.ctrl && key.name === "e")
      return setCursor(input().length);
    if (key.name === "tab") {
      const cmd = menuVisible() ? filteredCommands()[clampedSel()] : undefined;
      if (cmd) {
        setInput(cmd.name + " ");
        setCursor(cmd.name.length + 1);
        resetHistoryNav();
        setMenuSel(0);
      }
      return;
    }
    if (key.name === "return") {
      const text = input().trim();
      const cmd = menuVisible() ? filteredCommands()[clampedSel()] : undefined;
      setInput("");
      setCursor(0);
      setMenuOpen(true);
      setMenuSel(0);
      if (cmd) {
        commitHistory(cmd.name);
        runCommand(cmd.name);
        return;
      }
      if (!text)
        return;
      commitHistory(text);
      if (text.startsWith("/")) {
        runCommand(text);
        return;
      }
      send(text);
      return;
    }
    if (key.name === "backspace") {
      const c = cursor();
      if (c > 0) {
        const s = input();
        setInput(s.slice(0, c - 1) + s.slice(c));
        setCursor(c - 1);
        resetHistoryNav();
        setMenuOpen(true);
        setMenuSel(0);
      }
      return;
    }
    if (key.name === "delete" || key.ctrl && key.name === "d") {
      const c = cursor();
      const s = input();
      if (c < s.length) {
        setInput(s.slice(0, c) + s.slice(c + 1));
        resetHistoryNav();
        setMenuOpen(true);
        setMenuSel(0);
      }
      return;
    }
    if (key.ctrl && key.name === "u") {
      setInput("");
      setCursor(0);
      resetHistoryNav();
      setMenuOpen(true);
      setMenuSel(0);
      return;
    }
    if (key.ctrl && key.name === "w") {
      const c = cursor();
      const cut = wordStart(input(), c);
      if (cut < c) {
        const s = input();
        setInput(s.slice(0, cut) + s.slice(c));
        setCursor(cut);
        resetHistoryNav();
        setMenuOpen(true);
        setMenuSel(0);
      }
      return;
    }
    if (key.name === "escape") {
      if (menuVisible())
        return setMenuOpen(false);
      setInput("");
      setCursor(0);
      return;
    }
    const ch = key.sequence;
    if (ch && ch.length === 1 && !key.ctrl && !key.meta && !/[\x00-\x1f]/.test(ch)) {
      insertChar(ch);
      setMenuOpen(true);
      setMenuSel(0);
    }
  });
  const widgets = () => snapshot().filter((d) => d.kind === "widget");
  const th = () => theme();
  return (() => {
    var _el$16 = _$createElement2("box"), _el$17 = _$createElement2("box"), _el$18 = _$createElement2("box"), _el$19 = _$createElement2("text"), _el$20 = _$createElement2("box");
    _$insertNode2(_el$16, _el$17);
    _$insertNode2(_el$16, _el$18);
    _$insertNode2(_el$16, _el$20);
    _$setProp2(_el$16, "style", {
      flexDirection: "column",
      flexGrow: 1
    });
    _$setProp2(_el$17, "style", {
      flexDirection: "column",
      flexGrow: 1,
      padding: 1
    });
    _$insert2(_el$17, _$createComponent2(For2, {
      get each() {
        return visibleItems();
      },
      get fallback() {
        return (() => {
          var _el$21 = _$createElement2("text");
          _$insert2(_el$21, () => t("shell.transcript.empty"));
          _$effect2((_$p) => _$setProp2(_el$21, "style", {
            fg: th().tokens.dim
          }, _$p));
          return _el$21;
        })();
      },
      children: (it) => itemNode(it)
    }));
    _$insert2(_el$16, _$createComponent2(For2, {
      get each() {
        return _$memo(() => !!approval())() ? [approval()] : [];
      },
      children: (ap) => (() => {
        var _el$22 = _$createElement2("box"), _el$23 = _$createElement2("text"), _el$24 = _$createTextNode2(`⚠ `), _el$25 = _$createTextNode2(`: `), _el$26 = _$createElement2("text"), _el$27 = _$createElement2("text");
        _$insertNode2(_el$22, _el$23);
        _$insertNode2(_el$22, _el$26);
        _$insertNode2(_el$22, _el$27);
        _$insertNode2(_el$23, _el$24);
        _$insertNode2(_el$23, _el$25);
        _$insert2(_el$23, () => t("agent.approve.title"), _el$25);
        _$insert2(_el$23, () => ap.name, null);
        _$insert2(_el$26, () => ap.args.slice(0, 200));
        _$insert2(_el$27, () => t("agent.approve.hint"));
        _$effect2((_p$) => {
          var _v$5 = {
            border: true,
            borderColor: th().tokens.approvalBorder ?? th().tokens.warn,
            flexDirection: "column",
            padding: 1
          }, _v$6 = {
            fg: th().tokens.warn
          }, _v$7 = {
            fg: th().tokens.dim
          };
          _v$5 !== _p$.e && (_p$.e = _$setProp2(_el$22, "style", _v$5, _p$.e));
          _v$6 !== _p$.t && (_p$.t = _$setProp2(_el$23, "style", _v$6, _p$.t));
          _v$7 !== _p$.a && (_p$.a = _$setProp2(_el$27, "style", _v$7, _p$.a));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined
        });
        return _el$22;
      })()
    }), _el$18);
    _$insert2(_el$16, _$createComponent2(For2, {
      get each() {
        return menuVisible() ? [0] : [];
      },
      children: () => (() => {
        var _el$28 = _$createElement2("box");
        _$insert2(_el$28, _$createComponent2(For2, {
          get each() {
            return filteredCommands();
          },
          children: (c, i) => (() => {
            var _el$29 = _$createElement2("text"), _el$30 = _$createTextNode2(` `);
            _$insertNode2(_el$29, _el$30);
            _$insert2(_el$29, () => i() === clampedSel() ? "› " : "  ", _el$30);
            _$insert2(_el$29, () => c.name, _el$30);
            _$insert2(_el$29, () => c.desc, null);
            _$effect2((_$p) => _$setProp2(_el$29, "style", {
              fg: i() === clampedSel() ? th().tokens.accent : undefined
            }, _$p));
            return _el$29;
          })()
        }));
        _$effect2((_$p) => _$setProp2(_el$28, "style", {
          border: true,
          borderColor: th().tokens.border,
          flexDirection: "column",
          padding: 0
        }, _$p));
        return _el$28;
      })()
    }), _el$18);
    _$insertNode2(_el$18, _el$19);
    _$insert2(_el$19, (() => {
      var _c$ = _$memo(() => !!busy());
      return () => _c$() ? `${spinner()} ` : "❯ ";
    })());
    _$insert2(_el$18, (() => {
      var _c$2 = _$memo(() => !!busy());
      return () => _c$2() ? (() => {
        var _el$31 = _$createElement2("text");
        _$insert2(_el$31, () => t("shell.input.busy"));
        _$effect2((_$p) => _$setProp2(_el$31, "style", {
          fg: th().tokens.dim
        }, _$p));
        return _el$31;
      })() : _$memo(() => input() === "")() ? [(() => {
        var _el$32 = _$createElement2("text");
        _$insertNode2(_el$32, _$createTextNode2(` `));
        _$effect2((_$p) => _$setProp2(_el$32, "style", {
          fg: th().tokens.accent,
          attributes: createTextAttributes({
            inverse: true
          })
        }, _$p));
        return _el$32;
      })(), (() => {
        var _el$34 = _$createElement2("text");
        _$insert2(_el$34, () => t("shell.input.placeholder"));
        _$effect2((_$p) => _$setProp2(_el$34, "style", {
          fg: th().tokens.dim
        }, _$p));
        return _el$34;
      })()] : [(() => {
        var _el$35 = _$createElement2("text");
        _$insert2(_el$35, () => inputChunks().before);
        _$effect2((_$p) => _$setProp2(_el$35, "style", {
          fg: th().tokens.text
        }, _$p));
        return _el$35;
      })(), (() => {
        var _el$36 = _$createElement2("text");
        _$insert2(_el$36, () => inputChunks().at);
        _$effect2((_$p) => _$setProp2(_el$36, "style", {
          fg: th().tokens.text,
          attributes: createTextAttributes({
            inverse: true
          })
        }, _$p));
        return _el$36;
      })(), (() => {
        var _el$37 = _$createElement2("text");
        _$insert2(_el$37, () => inputChunks().after);
        _$effect2((_$p) => _$setProp2(_el$37, "style", {
          fg: th().tokens.text
        }, _$p));
        return _el$37;
      })()];
    })(), null);
    _$setProp2(_el$20, "style", {
      flexDirection: "row",
      paddingLeft: 2,
      paddingRight: 2
    });
    _$insert2(_el$20, _$createComponent2(For2, {
      each: footerHints,
      children: (h, i) => (() => {
        var _el$38 = _$createElement2("text"), _el$39 = _$createTextNode2(` `);
        _$insertNode2(_el$38, _el$39);
        _$insert2(_el$38, () => i() > 0 ? " · " : "", _el$39);
        _$insert2(_el$38, () => h.key, _el$39);
        _$insert2(_el$38, () => h.label, null);
        _$effect2((_$p) => _$setProp2(_el$38, "style", {
          fg: th().tokens.dim
        }, _$p));
        return _el$38;
      })()
    }));
    _$insert2(_el$16, _$createComponent2(StatusBar, {
      get widgets() {
        return [{
          kind: "widget",
          slot: "status",
          id: "model",
          order: 10,
          parts: [{
            text: label(),
            color: th().tokens.accent
          }]
        }, {
          kind: "widget",
          slot: "status",
          id: "usage",
          order: 20,
          parts: [{
            text: `p${usage().prompt}/c${usage().completion}`,
            dim: true
          }]
        }, ...widgets()];
      }
    }), null);
    _$effect2((_p$) => {
      var _v$3 = {
        border: true,
        borderColor: th().tokens.border,
        flexDirection: "row"
      }, _v$4 = {
        fg: th().tokens.accent
      };
      _v$3 !== _p$.e && (_p$.e = _$setProp2(_el$18, "style", _v$3, _p$.e));
      _v$4 !== _p$.t && (_p$.t = _$setProp2(_el$19, "style", _v$4, _p$.t));
      return _p$;
    }, {
      e: undefined,
      t: undefined
    });
    return _el$16;
  })();
}

// src/host-session.ts
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { randomUUID } from "node:crypto";

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
  usage = { prompt: 0, completion: 0 };
  constructor(ctx) {
    this.#ctx = ctx;
    this.#wire();
  }
  listProviders() {
    try {
      const llm = this.#ctx.get?.("llm");
      const providers = llm?.listConfigurableProviders?.() ?? [];
      return providers.map((p) => ({
        provider: String(p?.provider ?? p?.id ?? p ?? ""),
        models: (p?.models ?? []).map((m) => String(m?.id ?? m?.model ?? m ?? "")).filter(Boolean)
      })).filter((p) => p.provider);
    } catch {
      return [];
    }
  }
  switchModel(provider, model) {
    this.#override = { provider, model };
    try {
      this.#handle?.dispose?.();
    } catch {}
    this.#handle = undefined;
    this.#sessionId = undefined;
    this.#agentId = undefined;
    this.label = `${provider}/${model}`;
  }
  async turn(userText, cb, _signal) {
    this.#cb = cb;
    if (!this.#handle) {
      this.#sessionId = randomUUID();
      const sel = this.#override ?? this.#ctx.get?.("agentDefaultModel")?.currentSelection?.();
      const agentOptions = sel ? { provider: sel.provider, model: sel.model, ...sel.reasoningEffort ? { reasoningEffort: sel.reasoningEffort } : {} } : {};
      if (sel)
        this.label = `${sel.provider}/${sel.model}`;
      this.#handle = await this.#ctx.agents.create({
        sessionId: this.#sessionId,
        meta: { cwd: process.cwd() },
        agentOptions
      });
      this.#agentId = this.#handle.agent.id;
    }
    const message = createUserMessage({
      content: [{ type: "text", text: userText }],
      source: { kind: "user" }
    });
    this.#handle.agent.followup(message);
    await new Promise((resolve) => {
      this.#resolveTurn = resolve;
    });
  }
  #finishTurn() {
    const r = this.#resolveTurn;
    this.#resolveTurn = undefined;
    this.#cb?.onTurnEnd({ prompt: this.usage.prompt, completion: this.usage.completion });
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
      try {
        if (c.type === "reasoning-delta" && c.text)
          cb.onThinkingDelta(c.text);
        else if (c.type === "text-delta" && c.text)
          cb.onContentDelta(c.text);
        else if (c.type === "tool-call-delta" && c.name) {}
      } catch {}
    });
    ctx.on("agent/status", ({ agent, status }) => {
      if (this.#agentId === undefined || agent.id !== this.#agentId)
        return;
      const wasRunning = this.#running;
      this.#running = status === "running";
      if (wasRunning && !this.#running && this.#resolveTurn)
        this.#finishTurn();
    });
    ctx.on("session/event", (session, event) => {
      if (this.#sessionId === undefined || String(session.id) !== this.#sessionId)
        return;
      const cb = this.#cb;
      if (!cb)
        return;
      try {
        if (event.type === "tool/call" && event.data) {
          this.#toolCalls.set(String(event.data.callId ?? ""), {
            name: String(event.data.name ?? "tool"),
            args: String(event.data.arguments ?? "")
          });
        } else if (event.type === "tool/result" && event.data) {
          const callId = String(event.data.callId ?? "");
          const known = this.#toolCalls.get(callId);
          const brief = JSON.stringify(event.data.output ?? event.data).slice(0, 300);
          cb.onToolRun({
            name: known?.name ?? "tool",
            argsPretty: known?.args ?? "",
            output: brief,
            ok: event.data.isError !== true
          });
        } else if (event.type === "turn/end") {
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
function apply(ctx, config) {
  const i18n = createI18n("zh-CN");
  const store = new SurfaceStore;
  const session = new HostSession(ctx);
  mountEngine({}).then(({
    renderer
  }) => {
    render(() => _$createComponent3(ShellHost, {
      get deps() {
        return {
          store,
          t: i18n.t,
          session,
          themeName: config?.theme
        };
      }
    }), renderer);
  }).catch((e) => {
    process.stderr.write("dsh-opentui boot failed: " + String(e) + `
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
