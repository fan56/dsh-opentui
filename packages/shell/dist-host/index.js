// src/host-entry.tsx
import { createComponent as _$createComponent10 } from "@opentui/solid";
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
    en: "/help · /model [provider/id] · /login · /logout · /usage · /clear · /quit"
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
    en: "usage: /login REF KEY (bare /login shows credential status)"
  },
  "cmd.logout.done": { "zh-CN": "凭据 {ref} 已移除", en: "credential {ref} removed" },
  "cmd.logout.usage": {
    "zh-CN": "用法：/logout REF（裸 /logout 查看凭据状态）",
    en: "usage: /logout REF (bare /logout shows credential status)"
  },
  "cmd.cred.status": { "zh-CN": "{ref}：{status}", en: "{ref}: {status}" },
  "cmd.cred.configured": { "zh-CN": "已配置", en: "configured" },
  "cmd.cred.missing": { "zh-CN": "未配置", en: "missing" },
  "picker.model.title": { "zh-CN": "选择模型", en: "select model" },
  "panel.tools.title": { "zh-CN": "工具", en: "tools" },
  "panel.think.title": { "zh-CN": "思考", en: "thinking" }
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
import { createTextNode as _$createTextNode9 } from "@opentui/solid";
import { insertNode as _$insertNode10 } from "@opentui/solid";
import { effect as _$effect11 } from "@opentui/solid";
import { insert as _$insert11 } from "@opentui/solid";
import { createComponent as _$createComponent9 } from "@opentui/solid";
import { memo as _$memo5 } from "@opentui/solid";
import { setProp as _$setProp11 } from "@opentui/solid";
import { createElement as _$createElement11 } from "@opentui/solid";
import { For as For8, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { SyntaxStyle } from "@opentui/core";
import { useKeyboard as useKeyboard2, useRenderer } from "@opentui/solid";
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
// ../kit/src/shell-parts.tsx
import { memo as _$memo } from "@opentui/solid";
import { createComponent as _$createComponent2 } from "@opentui/solid";
import { setProp as _$setProp2 } from "@opentui/solid";
import { effect as _$effect2 } from "@opentui/solid";
import { insert as _$insert2 } from "@opentui/solid";
import { createTextNode as _$createTextNode2 } from "@opentui/solid";
import { insertNode as _$insertNode2 } from "@opentui/solid";
import { createElement as _$createElement2 } from "@opentui/solid";
import { For as For2, Show } from "solid-js";
import { createTextAttributes } from "@opentui/core";
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
function Transcript(props) {
  const visibleItems = () => props.items.slice(-(props.maxItems ?? MAX_VISIBLE_ITEMS));
  const itemNode = (it) => {
    const th = props.theme;
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
          _$insertNode2(_el$5, _$createTextNode2(` `));
          _$effect2((_p$) => {
            var _v$ = it.text, _v$2 = props.mdStyle;
            _v$ !== _p$.e && (_p$.e = _$setProp2(_el$4, "content", _v$, _p$.e));
            _v$2 !== _p$.t && (_p$.t = _$setProp2(_el$4, "syntaxStyle", _v$2, _p$.t));
            return _p$;
          }, {
            e: undefined,
            t: undefined
          });
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
            _$insert2(_el$8, () => `┃ ${l.text || " "}`);
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
        _$insert2(_el$9, () => `${props.spinnerFrame} ${props.t("agent.thinking")} (${it.chars}) ${it.tail.slice(-120)}`);
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
        _$insert2(_el$10, () => ` ⎿ ${it.ok ? props.t("agent.tool.ok") : props.t("agent.tool.fail")}: ${it.brief.slice(0, 110)}`);
        _$effect2((_p$) => {
          var _v$3 = {
            fg: th.tokens.toolOk ?? th.tokens.warn
          }, _v$4 = {
            fg: it.ok ? th.tokens.dim : th.tokens.toolFail ?? th.tokens.danger
          };
          _v$3 !== _p$.e && (_p$.e = _$setProp2(_el$1, "style", _v$3, _p$.e));
          _v$4 !== _p$.t && (_p$.t = _$setProp2(_el$10, "style", _v$4, _p$.t));
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
        _$insert2(_el$11, () => props.t("agent.error"), _el$13);
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
  return (() => {
    var _el$16 = _$createElement2("box");
    _$setProp2(_el$16, "style", {
      flexDirection: "column",
      flexGrow: 1,
      padding: 1
    });
    _$insert2(_el$16, _$createComponent2(For2, {
      get each() {
        return visibleItems();
      },
      get fallback() {
        return (() => {
          var _el$17 = _$createElement2("text");
          _$insert2(_el$17, () => props.t("shell.transcript.empty"));
          _$effect2((_$p) => _$setProp2(_el$17, "style", {
            fg: props.theme.tokens.dim
          }, _$p));
          return _el$17;
        })();
      },
      children: (it) => itemNode(it)
    }));
    return _el$16;
  })();
}
function InputLine(props) {
  const inputChunks = () => {
    const s = props.value;
    const c = Math.min(props.cursor, s.length);
    return {
      before: s.slice(0, c),
      at: c < s.length ? s.charAt(c) : " ",
      after: c < s.length ? s.slice(c + 1) : ""
    };
  };
  return (() => {
    var _el$21 = _$createElement2("box"), _el$22 = _$createElement2("text");
    _$insertNode2(_el$21, _el$22);
    _$insert2(_el$22, (() => {
      var _c$ = _$memo(() => !!props.busy);
      return () => _c$() ? `${props.spinnerFrame} ` : "❯ ";
    })());
    _$insert2(_el$21, (() => {
      var _c$2 = _$memo(() => !!props.busy);
      return () => _c$2() ? (() => {
        var _el$23 = _$createElement2("text");
        _$insert2(_el$23, () => props.busyLabel);
        _$effect2((_$p) => _$setProp2(_el$23, "style", {
          fg: props.theme.tokens.dim
        }, _$p));
        return _el$23;
      })() : _$memo(() => props.value === "")() ? [(() => {
        var _el$24 = _$createElement2("text");
        _$insertNode2(_el$24, _$createTextNode2(` `));
        _$effect2((_$p) => _$setProp2(_el$24, "style", {
          fg: props.theme.tokens.accent,
          attributes: createTextAttributes({
            inverse: true
          })
        }, _$p));
        return _el$24;
      })(), (() => {
        var _el$26 = _$createElement2("text");
        _$insert2(_el$26, () => props.placeholder);
        _$effect2((_$p) => _$setProp2(_el$26, "style", {
          fg: props.theme.tokens.dim
        }, _$p));
        return _el$26;
      })()] : [(() => {
        var _el$27 = _$createElement2("text");
        _$insert2(_el$27, () => inputChunks().before);
        _$effect2((_$p) => _$setProp2(_el$27, "style", {
          fg: props.theme.tokens.text
        }, _$p));
        return _el$27;
      })(), (() => {
        var _el$28 = _$createElement2("text");
        _$insert2(_el$28, () => inputChunks().at);
        _$effect2((_$p) => _$setProp2(_el$28, "style", {
          fg: props.theme.tokens.text,
          attributes: createTextAttributes({
            inverse: true
          })
        }, _$p));
        return _el$28;
      })(), (() => {
        var _el$29 = _$createElement2("text");
        _$insert2(_el$29, () => inputChunks().after);
        _$effect2((_$p) => _$setProp2(_el$29, "style", {
          fg: props.theme.tokens.text
        }, _$p));
        return _el$29;
      })()];
    })(), null);
    _$effect2((_p$) => {
      var _v$5 = {
        border: true,
        borderStyle: "rounded",
        borderColor: props.theme.tokens.border,
        flexDirection: "row"
      }, _v$6 = {
        fg: props.theme.tokens.accent
      };
      _v$5 !== _p$.e && (_p$.e = _$setProp2(_el$21, "style", _v$5, _p$.e));
      _v$6 !== _p$.t && (_p$.t = _$setProp2(_el$22, "style", _v$6, _p$.t));
      return _p$;
    }, {
      e: undefined,
      t: undefined
    });
    return _el$21;
  })();
}
function FooterHints(props) {
  return (() => {
    var _el$30 = _$createElement2("box");
    _$setProp2(_el$30, "style", {
      flexDirection: "row",
      paddingLeft: 2,
      paddingRight: 2
    });
    _$insert2(_el$30, _$createComponent2(For2, {
      each: footerHints,
      children: (h, i) => (() => {
        var _el$31 = _$createElement2("text"), _el$32 = _$createTextNode2(` `);
        _$insertNode2(_el$31, _el$32);
        _$insert2(_el$31, () => i() > 0 ? " · " : "", _el$32);
        _$insert2(_el$31, () => h.key, _el$32);
        _$insert2(_el$31, () => h.label, null);
        _$effect2((_$p) => _$setProp2(_el$31, "style", {
          fg: props.theme.tokens.dim
        }, _$p));
        return _el$31;
      })()
    }));
    return _el$30;
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
  tools: "#E65100"
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
// ../kit/src/welcome.tsx
import { effect as _$effect7 } from "@opentui/solid";
import { insert as _$insert7 } from "@opentui/solid";
import { createTextNode as _$createTextNode6 } from "@opentui/solid";
import { insertNode as _$insertNode7 } from "@opentui/solid";
import { setProp as _$setProp7 } from "@opentui/solid";
import { createElement as _$createElement7 } from "@opentui/solid";

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
var CWD_MAX_COLUMNS = 40;
function shortenCwd(cwd) {
  if (cwd.length <= CWD_MAX_COLUMNS)
    return cwd;
  return `…${cwd.slice(-(CWD_MAX_COLUMNS - 1))}`;
}
function WelcomeBanner(props) {
  const quote = pickDailyQuote();
  return (() => {
    var _el$ = _$createElement7("box"), _el$2 = _$createElement7("ascii_font"), _el$3 = _$createElement7("text"), _el$5 = _$createElement7("text"), _el$6 = _$createElement7("text"), _el$8 = _$createElement7("text");
    _$insertNode7(_el$, _el$2);
    _$insertNode7(_el$, _el$3);
    _$insertNode7(_el$, _el$5);
    _$insertNode7(_el$, _el$6);
    _$insertNode7(_el$, _el$8);
    _$setProp7(_el$, "style", {
      flexDirection: "column",
      flexGrow: 1,
      justifyContent: "center",
      padding: 1
    });
    _$setProp7(_el$2, "text", "DSH");
    _$setProp7(_el$2, "font", "block");
    _$insertNode7(_el$3, _$createTextNode6(` `));
    _$insert7(_el$5, () => `${props.model} · ${shortenCwd(props.cwd)}`);
    _$insertNode7(_el$6, _$createTextNode6(` `));
    _$insert7(_el$8, `\uD83D\uDC33 「${quote}」`);
    _$effect7((_p$) => {
      var _v$ = POWERLINE_COLORS.brand, _v$2 = {
        fg: props.theme.tokens.dim
      }, _v$3 = {
        fg: props.theme.tokens.dim
      };
      _v$ !== _p$.e && (_p$.e = _$setProp7(_el$2, "color", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp7(_el$5, "style", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp7(_el$8, "style", _v$3, _p$.a));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined
    });
    return _el$;
  })();
}
// ../kit/src/dock-widgets.tsx
import { memo as _$memo4 } from "@opentui/solid";
import { createTextNode as _$createTextNode7 } from "@opentui/solid";
import { setProp as _$setProp8 } from "@opentui/solid";
import { effect as _$effect8 } from "@opentui/solid";
import { insertNode as _$insertNode8 } from "@opentui/solid";
import { createComponent as _$createComponent7 } from "@opentui/solid";
import { insert as _$insert8 } from "@opentui/solid";
import { createElement as _$createElement8 } from "@opentui/solid";
import { For as For7, Show as Show4 } from "solid-js";
var THINK_TAIL = 3;
var THINK_SUMMARY_HEAD = 60;
function ThinkWidget(props) {
  const th = () => props.theme;
  const summary = () => {
    const head = props.state.text.slice(0, THINK_SUMMARY_HEAD).replace(/\s+/g, " ").trim();
    return `\uD83D\uDCAD thought · ${props.state.elapsed}s · ${head}...`;
  };
  return _$createComponent7(Show4, {
    get when() {
      return props.state.active;
    },
    get fallback() {
      return _$createComponent7(Show4, {
        get when() {
          return props.state.text.length > 0;
        },
        get children() {
          var _el$3 = _$createElement8("text");
          _$insert8(_el$3, summary);
          _$effect8((_$p) => _$setProp8(_el$3, "style", {
            fg: th().tokens.dim
          }, _$p));
          return _el$3;
        }
      });
    },
    get children() {
      var _el$ = _$createElement8("box"), _el$2 = _$createElement8("text");
      _$insertNode8(_el$, _el$2);
      _$insert8(_el$2, () => `${BUBBLE_FRAMES[props.state.elapsed % BUBBLE_FRAMES.length]} thinking · ${props.state.elapsed}s`);
      _$insert8(_el$, _$createComponent7(For7, {
        get each() {
          return props.state.text.split(`
`).slice(-THINK_TAIL);
        },
        children: (line) => (() => {
          var _el$4 = _$createElement8("text");
          _$insert8(_el$4, line || " ");
          _$effect8((_$p) => _$setProp8(_el$4, "style", {
            fg: th().tokens.dim
          }, _$p));
          return _el$4;
        })()
      }), null);
      _$effect8((_p$) => {
        var _v$ = {
          border: true,
          borderColor: th().tokens.accent,
          flexDirection: "column",
          padding: 1
        }, _v$2 = {
          fg: th().tokens.accent
        };
        _v$ !== _p$.e && (_p$.e = _$setProp8(_el$, "style", _v$, _p$.e));
        _v$2 !== _p$.t && (_p$.t = _$setProp8(_el$2, "style", _v$2, _p$.t));
        return _p$;
      }, {
        e: undefined,
        t: undefined
      });
      return _el$;
    }
  });
}
var TOOL_ARGS_WIDTH = 80;
var TOOL_OUTPUT_TAIL = 2;
var SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
var SPINNER_FPS = 8;
var BUBBLE_FRAMES = ["╹", "╹▀", "╹▀▄", " ▀▄"];
function runningColor(theme) {
  return theme.tokens.userMark ?? "#61afef";
}
function spinnerFrame(elapsed) {
  const t = elapsed ?? 0;
  return SPINNER_FRAMES[Math.floor(t * SPINNER_FPS) % SPINNER_FRAMES.length];
}
function ToolWidget(props) {
  const th = () => props.theme;
  const okCount = () => props.entries.filter((e) => e.status === "ok").length;
  const failCount = () => props.entries.filter((e) => e.status === "fail").length;
  const runningCount = () => props.entries.filter((e) => e.status === "running").length;
  const lastRunningIndex = () => {
    let idx = -1;
    for (let i = 0;i < props.entries.length; i++) {
      if (props.entries[i]?.status === "running")
        idx = i;
    }
    return idx;
  };
  const headerElapsed = () => {
    let max = 0;
    for (const e of props.entries)
      if (e.status === "running" && (e.elapsed ?? 0) > max)
        max = e.elapsed ?? 0;
    return max;
  };
  const rowFg = (e) => {
    if (e.status === "ok")
      return th().tokens.ok;
    if (e.status === "fail")
      return th().tokens.toolFail ?? th().tokens.danger;
    return runningColor(th());
  };
  const rowText = (e) => {
    if (e.status === "ok")
      return `✔ ${e.name}`;
    if (e.status === "fail")
      return `✘ ${e.name}`;
    const args = e.args.slice(0, TOOL_ARGS_WIDTH).replace(/\s+/g, " ").trim();
    return args ? `⚙ ${e.name} ${args}` : `⚙ ${e.name}`;
  };
  const outputTail = (e) => (e.output ?? "").split(`
`).slice(-TOOL_OUTPUT_TAIL).filter((l) => l.trim().length > 0);
  return _$createComponent7(Show4, {
    get when() {
      return props.entries.length > 0;
    },
    get children() {
      return _$createComponent7(Show4, {
        get when() {
          return props.active;
        },
        get fallback() {
          return (() => {
            var _el$0 = _$createElement8("text");
            _$insert8(_el$0, () => `⚒ ${props.entries.length} tools · ${okCount()}✔ ${failCount()}✘`);
            _$effect8((_$p) => _$setProp8(_el$0, "style", {
              fg: th().tokens.dim
            }, _$p));
            return _el$0;
          })();
        },
        get children() {
          var _el$5 = _$createElement8("box"), _el$6 = _$createElement8("box"), _el$8 = _$createElement8("box"), _el$9 = _$createElement8("text");
          _$insertNode8(_el$5, _el$6);
          _$insertNode8(_el$6, _el$8);
          _$insertNode8(_el$6, _el$9);
          _$setProp8(_el$6, "style", {
            flexDirection: "row"
          });
          _$insert8(_el$6, _$createComponent7(Show4, {
            get when() {
              return runningCount() > 0;
            },
            get fallback() {
              return (() => {
                var _el$1 = _$createElement8("text");
                _$insertNode8(_el$1, _$createTextNode7(`⚒ tools`));
                _$effect8((_$p) => _$setProp8(_el$1, "style", {
                  fg: th().tokens.accent
                }, _$p));
                return _el$1;
              })();
            },
            get children() {
              var _el$7 = _$createElement8("text");
              _$insert8(_el$7, () => `${spinnerFrame(headerElapsed())} ⚒ tools · ${runningCount()} running`);
              _$effect8((_$p) => _$setProp8(_el$7, "style", {
                fg: runningColor(th())
              }, _$p));
              return _el$7;
            }
          }), _el$8);
          _$setProp8(_el$8, "style", {
            flexGrow: 1
          });
          _$insert8(_el$9, () => `${okCount()}✔ ${failCount()}✘`);
          _$insert8(_el$5, _$createComponent7(For7, {
            get each() {
              return props.entries;
            },
            children: (e, i) => [(() => {
              var _el$11 = _$createElement8("text");
              _$insert8(_el$11, () => rowText(e));
              _$effect8((_$p) => _$setProp8(_el$11, "style", {
                fg: rowFg(e)
              }, _$p));
              return _el$11;
            })(), _$createComponent7(Show4, {
              get when() {
                return _$memo4(() => i() === lastRunningIndex())() && e.output;
              },
              get children() {
                return _$createComponent7(For7, {
                  get each() {
                    return outputTail(e);
                  },
                  children: (line) => (() => {
                    var _el$12 = _$createElement8("text");
                    _$insert8(_el$12, `  ⎿ ${line}`);
                    _$effect8((_$p) => _$setProp8(_el$12, "style", {
                      fg: th().tokens.dim
                    }, _$p));
                    return _el$12;
                  })()
                });
              }
            })]
          }), null);
          _$effect8((_p$) => {
            var _v$3 = {
              border: true,
              borderColor: th().tokens.border,
              flexDirection: "column",
              padding: 1
            }, _v$4 = {
              fg: th().tokens.dim
            };
            _v$3 !== _p$.e && (_p$.e = _$setProp8(_el$5, "style", _v$3, _p$.e));
            _v$4 !== _p$.t && (_p$.t = _$setProp8(_el$9, "style", _v$4, _p$.t));
            return _p$;
          }, {
            e: undefined,
            t: undefined
          });
          return _el$5;
        }
      });
    }
  });
}
// ../kit/src/scroll.tsx
import { effect as _$effect9 } from "@opentui/solid";
import { insert as _$insert9 } from "@opentui/solid";
import { setProp as _$setProp9 } from "@opentui/solid";
import { createElement as _$createElement9 } from "@opentui/solid";
function AutoScroll(props) {
  return (() => {
    var _el$ = _$createElement9("scrollbox");
    _$setProp9(_el$, "stickyScroll", true);
    _$setProp9(_el$, "scrollY", true);
    _$insert9(_el$, () => props.children);
    _$effect9((_$p) => _$setProp9(_el$, "style", {
      flexGrow: 1,
      maxHeight: props.maxHeight
    }, _$p));
    return _el$;
  })();
}
// ../kit/src/select.tsx
import { createComponent as _$createComponent8 } from "@opentui/solid";
import { effect as _$effect10 } from "@opentui/solid";
import { createTextNode as _$createTextNode8 } from "@opentui/solid";
import { insertNode as _$insertNode9 } from "@opentui/solid";
import { insert as _$insert10 } from "@opentui/solid";
import { setProp as _$setProp10 } from "@opentui/solid";
import { createElement as _$createElement10 } from "@opentui/solid";
import { Show as Show5 } from "solid-js";
import { useKeyboard } from "@opentui/solid";
var MAX_VISIBLE_ITEMS2 = 12;
var FALLBACK_SELECTION_BG = "#313244";
function Select(props) {
  useKeyboard((key) => {
    if (key.name === "escape")
      props.onCancel();
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
  return _$createComponent8(Show5, {
    get when() {
      return props.items.length > 0;
    },
    get children() {
      var _el$ = _$createElement10("box"), _el$2 = _$createElement10("box"), _el$3 = _$createElement10("text"), _el$4 = _$createElement10("box"), _el$5 = _$createElement10("text"), _el$7 = _$createElement10("select");
      _$insertNode9(_el$, _el$2);
      _$insertNode9(_el$, _el$7);
      _$insertNode9(_el$2, _el$3);
      _$insertNode9(_el$2, _el$4);
      _$insertNode9(_el$2, _el$5);
      _$setProp10(_el$2, "style", {
        flexDirection: "row"
      });
      _$insert10(_el$3, () => props.title);
      _$setProp10(_el$4, "style", {
        flexGrow: 1
      });
      _$insertNode9(_el$5, _$createTextNode8(`↑↓ move · enter select · esc cancel`));
      _$setProp10(_el$7, "selectedIndex", 0);
      _$setProp10(_el$7, "focused", true);
      _$setProp10(_el$7, "width", "100%");
      _$setProp10(_el$7, "onSelect", (_index, option) => {
        if (option)
          props.onSelect(String(option.value));
      });
      _$effect10((_p$) => {
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
        }, _v$4 = options(), _v$5 = visibleItems() * linesPerItem(), _v$6 = th().tokens.text, _v$7 = th().tokens.dim, _v$8 = th().tokens.selection ?? FALLBACK_SELECTION_BG, _v$9 = th().tokens.text, _v$0 = th().tokens.selection ?? FALLBACK_SELECTION_BG, _v$1 = th().tokens.text, _v$10 = hasDescriptions(), _v$11 = props.items.length > visibleItems();
        _v$ !== _p$.e && (_p$.e = _$setProp10(_el$, "style", _v$, _p$.e));
        _v$2 !== _p$.t && (_p$.t = _$setProp10(_el$3, "style", _v$2, _p$.t));
        _v$3 !== _p$.a && (_p$.a = _$setProp10(_el$5, "style", _v$3, _p$.a));
        _v$4 !== _p$.o && (_p$.o = _$setProp10(_el$7, "options", _v$4, _p$.o));
        _v$5 !== _p$.i && (_p$.i = _$setProp10(_el$7, "height", _v$5, _p$.i));
        _v$6 !== _p$.n && (_p$.n = _$setProp10(_el$7, "textColor", _v$6, _p$.n));
        _v$7 !== _p$.s && (_p$.s = _$setProp10(_el$7, "descriptionColor", _v$7, _p$.s));
        _v$8 !== _p$.h && (_p$.h = _$setProp10(_el$7, "focusedBackgroundColor", _v$8, _p$.h));
        _v$9 !== _p$.r && (_p$.r = _$setProp10(_el$7, "focusedTextColor", _v$9, _p$.r));
        _v$0 !== _p$.d && (_p$.d = _$setProp10(_el$7, "selectedBackgroundColor", _v$0, _p$.d));
        _v$1 !== _p$.l && (_p$.l = _$setProp10(_el$7, "selectedTextColor", _v$1, _p$.l));
        _v$10 !== _p$.u && (_p$.u = _$setProp10(_el$7, "showDescription", _v$10, _p$.u));
        _v$11 !== _p$.c && (_p$.c = _$setProp10(_el$7, "showScrollIndicator", _v$11, _p$.c));
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
        c: undefined
      });
      return _el$;
    }
  });
}
// src/ShellHost.tsx
var THEME_ORDER = ["catppuccin-mocha", "default"];
var CRED_REFS = ["ZAI_CODING_CN_API_KEY", "DEEPSEEK_API_KEY", "MINIMAX_CN_API_KEY"];
var EFFORTS = ["keep", "low", "medium", "high", "xhigh", "max"];
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
  name: "/theme",
  desc: "cycle theme"
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
  const [input, setInput] = createSignal("");
  const [cursor, setCursor] = createSignal(0);
  const [history, setHistory] = createSignal([]);
  const [historyIdx, setHistoryIdx] = createSignal(0);
  const [items, setItems] = createSignal([]);
  const [busy, setBusy] = createSignal(false);
  const [approval, setApproval] = createSignal(null);
  const [usage, setUsage] = createSignal({
    prompt: 0,
    completion: 0,
    turns: 0
  });
  const [label, setLabel] = createSignal(props.deps.session.label);
  const [showWelcome, setShowWelcome] = createSignal(true);
  const [thinkState, setThinkState] = createSignal({
    active: false,
    text: "",
    elapsed: 0
  });
  const [toolEntries, setToolEntries] = createSignal([]);
  const [overlay, setOverlay] = createSignal(null);
  const [modelItems, setModelItems] = createSignal([]);
  const initialTheme = process.env.DSH_OPENTUI_THEME ?? props.deps.themeName ?? "catppuccin-mocha";
  const [themeName, setThemeName] = createSignal(themes[initialTheme] ? initialTheme : "catppuccin-mocha");
  const theme = () => getTheme(themeName());
  const [menuOpen, setMenuOpen] = createSignal(true);
  const [menuSel, setMenuSel] = createSignal(0);
  const [clock, setClock] = createSignal(fmtClock());
  let approveResolve = null;
  onMount(() => {
    const tick = setInterval(() => {
      setClock(fmtClock());
      setThinkState((s) => s.active ? {
        ...s,
        elapsed: s.elapsed + 1
      } : s);
      setToolEntries((arr) => arr.some((e) => e.status === "running") ? arr.map((e) => e.status === "running" ? {
        ...e,
        elapsed: (e.elapsed ?? 0) + 1
      } : e) : arr);
    }, 1000);
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
          setOverlay({
            kind: "ask",
            title: `${t("ask.title")}: ${q0.prompt}`.slice(0, 70),
            questionId: q0.id,
            items: options.map((o) => ({
              label: o,
              value: o
            })),
            resolve
          });
        });
        if (answer === "declined")
          throw new Error("declined");
        return answer;
      });
  });
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
  const menuVisible = createMemo(() => menuOpen() && filteredCommands().length > 0);
  const refreshModelItems = () => {
    props.deps.session.listProviders().then((catalog) => {
      const out = [];
      for (const p of catalog) {
        for (const m of p.models) {
          const id = `${p.provider}/${m}`;
          out.push({
            label: m,
            group: p.provider,
            value: id,
            ...label() === id ? {
              description: t("cmd.model.current")
            } : {}
          });
        }
      }
      setModelItems(out);
    });
  };
  onMount(refreshModelItems);
  const effortItems = () => EFFORTS.map((e) => ({
    label: e,
    value: e,
    description: t(`picker.effort.${e}.desc`)
  }));
  const overlayItems = createMemo(() => {
    const ov = overlay();
    if (!ov)
      return [];
    if (ov.kind === "model")
      return modelItems();
    if (ov.kind === "effort")
      return effortItems();
    return ov.items;
  });
  const overlayTitle = () => {
    const ov = overlay();
    if (!ov)
      return "";
    if (ov.kind === "model")
      return t("picker.model.title");
    if (ov.kind === "sessions")
      return t("picker.sessions.title");
    if (ov.kind === "effort")
      return t("picker.effort.title", {
        model: ov.model
      });
    return ov.title;
  };
  const onOverlaySelect = (value) => {
    const ov = overlay();
    setOverlay(null);
    if (!ov)
      return;
    if (ov.kind === "model") {
      const [provider, model] = value.split("/");
      if (provider && model)
        setOverlay({
          kind: "effort",
          provider,
          model
        });
      return;
    }
    if (ov.kind === "effort") {
      const effort = value === "keep" ? undefined : value;
      props.deps.session.switchModel(ov.provider, ov.model, effort);
      setLabel(props.deps.session.label);
      push({
        kind: "system",
        text: `${t("cmd.model.set")} ${ov.provider}/${ov.model}${effort ? ` (${effort})` : ""} ${t("cmd.model.next")}`
      });
      return;
    }
    if (ov.kind === "sessions") {
      const item = ov.items.find((s) => s.value === value);
      props.deps.session.resumeSession(value);
      push({
        kind: "system",
        text: `${t("cmd.sessions.resumed")}: ${item?.label ?? value.slice(0, 8)}`
      });
      return;
    }
    ov.resolve([{
      questionId: ov.questionId,
      selected: value
    }]);
  };
  const onOverlayCancel = () => {
    const ov = overlay();
    setOverlay(null);
    if (ov?.kind === "ask")
      ov.resolve("declined");
  };
  const rendererCtx = useRenderer();
  let mdStyle;
  try {
    mdStyle = SyntaxStyle.create(rendererCtx);
  } catch {
    mdStyle = undefined;
  }
  let thinkBuf = "";
  let streamingReply = null;
  let lastBump = 0;
  const bumpSoon = () => {
    const now = Date.now();
    if (now - lastBump < 60)
      return;
    lastBump = now;
    if (thinkBuf !== thinkState().text)
      setThinkState((prev) => ({
        ...prev,
        text: thinkBuf
      }));
    if (streamingReply)
      setItems((arr) => arr.map((x) => x === streamingReply ? {
        ...x
      } : x));
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
      push({
        kind: "system",
        text: `model: ${label()}`
      });
    } else if (cmd === "new") {
      props.deps.session.newSession();
      setItems([]);
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
        setOverlay({
          kind: "sessions",
          items: list.map((x) => ({
            label: x.title || x.id.slice(0, 8),
            value: x.id,
            ...x.updatedAt ? {
              description: String(x.updatedAt).slice(0, 19)
            } : {}
          }))
        });
      }
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
        refreshModelItems();
        setOverlay({
          kind: "model"
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
            text: `${t("cmd.model.set")} ${provider}/${model} ${t("cmd.model.next")}`
          });
        }
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
      } else if (parts.length === 1) {
        await pushCredStatus();
      } else {
        push({
          kind: "error",
          text: t("cmd.login.usage")
        });
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
      } else if (parts.length === 1) {
        await pushCredStatus();
      } else {
        push({
          kind: "error",
          text: t("cmd.logout.usage")
        });
      }
    } else {
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
    thinkBuf = "";
    setThinkState({
      active: true,
      text: "",
      elapsed: 0
    });
    let replyItem = null;
    streamingReply = null;
    try {
      await props.deps.session.turn(text, {
        onThinkingDelta: (s) => {
          thinkBuf += s;
          bumpSoon();
        },
        onContentDelta: (s) => {
          if (!replyItem) {
            replyItem = {
              kind: "assistant",
              text: ""
            };
            streamingReply = replyItem;
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
        onToolStart: (start) => {
          setToolEntries((arr) => [...arr, {
            name: start.name,
            args: start.args,
            status: "running",
            elapsed: 0,
            ...start.callId ? {
              callId: start.callId
            } : {}
          }]);
        },
        onToolRun: (run) => {
          const brief = run.output.split(`
`).slice(-2).join(" ⏎ ").slice(0, 200);
          setToolEntries((arr) => {
            const idx = run.callId ? arr.findIndex((e) => e.callId === run.callId) : arr.findIndex((e) => e.status === "running" && e.name === run.name);
            const settled = {
              ...run.callId ? {
                callId: run.callId
              } : {},
              name: run.name,
              args: run.argsPretty,
              status: run.ok ? "ok" : "fail",
              output: brief
            };
            return idx === -1 ? [...arr, settled] : arr.map((e, i) => i === idx ? {
              ...e,
              ...settled
            } : e);
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
      setThinkState((prev) => ({
        ...prev,
        active: false,
        text: thinkBuf
      }));
      setToolEntries((arr) => arr.map((e) => e.status === "running" ? {
        ...e,
        status: "fail"
      } : e));
      setApproval(null);
      approveResolve = null;
      setBusy(false);
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
        const full = text === cmd.name || !text.startsWith("/") ? cmd.name : text;
        commitHistory(full);
        runCommand(full);
        return;
      }
      if (!text)
        return;
      commitHistory(text);
      if (text.startsWith("/")) {
        runCommand(text);
        return;
      }
      if (busy())
        return steerText(text);
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
  const toolCount = createMemo(() => toolEntries().length);
  const toolActive = createMemo(() => toolEntries().some((e) => e.status === "running"));
  const powerlineSegments = () => {
    const r = route();
    const pct = contextPct();
    const segs = [{
      text: "dsh",
      bg: POWERLINE_COLORS.brand
    }, {
      text: r.provider,
      bg: POWERLINE_COLORS.provider
    }, {
      text: `${r.model || "·"}${r.effort ? ` ◕${r.effort}` : ""}`,
      bg: POWERLINE_COLORS.thinking[r.effort ?? "high"] ?? POWERLINE_COLORS.thinking.high
    }, {
      text: `\uD83E\uDDE0 ${pct}%`,
      bg: pct > 80 ? POWERLINE_COLORS.contextDanger : pct > 60 ? POWERLINE_COLORS.contextOrange : pct > 40 ? POWERLINE_COLORS.contextWarn : POWERLINE_COLORS.contextOk
    }];
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
    return segs;
  };
  const th = () => theme();
  return (() => {
    var _el$ = _$createElement11("box");
    _$setProp11(_el$, "style", {
      flexDirection: "column",
      flexGrow: 1
    });
    _$insert11(_el$, (() => {
      var _c$ = _$memo5(() => !!showWelcome());
      return () => _c$() ? _$createComponent9(WelcomeBanner, {
        get theme() {
          return th();
        },
        get model() {
          return label();
        },
        get cwd() {
          return process.cwd();
        }
      }) : _$createComponent9(AutoScroll, {
        get children() {
          return _$createComponent9(Transcript, {
            get items() {
              return items();
            },
            get theme() {
              return th();
            },
            t,
            spinnerFrame: "",
            mdStyle
          });
        }
      });
    })(), null);
    _$insert11(_el$, _$createComponent9(ThinkWidget, {
      get state() {
        return thinkState();
      },
      get theme() {
        return th();
      }
    }), null);
    _$insert11(_el$, _$createComponent9(ToolWidget, {
      get entries() {
        return toolEntries();
      },
      get active() {
        return toolActive();
      },
      get theme() {
        return th();
      }
    }), null);
    _$insert11(_el$, (() => {
      var _c$2 = _$memo5(() => !!approval());
      return () => _c$2() ? _$createComponent9(ApprovalCard, {
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
    _$insert11(_el$, (() => {
      var _c$3 = _$memo5(() => !!overlay());
      return () => _c$3() ? _$createComponent9(Select, {
        get title() {
          return overlayTitle();
        },
        get items() {
          return overlayItems();
        },
        get theme() {
          return th();
        },
        onSelect: onOverlaySelect,
        onCancel: onOverlayCancel
      }) : null;
    })(), null);
    _$insert11(_el$, (() => {
      var _c$4 = _$memo5(() => !!menuVisible());
      return () => _c$4() ? (() => {
        var _el$2 = _$createElement11("box");
        _$insert11(_el$2, _$createComponent9(For8, {
          get each() {
            return filteredCommands();
          },
          children: (c, i) => (() => {
            var _el$3 = _$createElement11("text"), _el$4 = _$createTextNode9(` `);
            _$insertNode10(_el$3, _el$4);
            _$insert11(_el$3, () => i() === clampedSel() ? "› " : "  ", _el$4);
            _$insert11(_el$3, () => c.name, _el$4);
            _$insert11(_el$3, () => c.desc, null);
            _$effect11((_$p) => _$setProp11(_el$3, "style", {
              fg: i() === clampedSel() ? th().tokens.accent : undefined
            }, _$p));
            return _el$3;
          })()
        }));
        _$effect11((_$p) => _$setProp11(_el$2, "style", {
          border: true,
          borderColor: th().tokens.border,
          flexDirection: "column",
          padding: 0
        }, _$p));
        return _el$2;
      })() : null;
    })(), null);
    _$insert11(_el$, _$createComponent9(InputLine, {
      get value() {
        return input();
      },
      get cursor() {
        return cursor();
      },
      busy: false,
      spinnerFrame: "",
      get placeholder() {
        return _$memo5(() => !!busy())() ? t("shell.input.steer") : t("shell.input.placeholder");
      },
      get busyLabel() {
        return t("shell.input.busy");
      },
      get theme() {
        return th();
      }
    }), null);
    _$insert11(_el$, _$createComponent9(FooterHints, {
      get theme() {
        return th();
      }
    }), null);
    _$insert11(_el$, _$createComponent9(PowerlineFooter, {
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
var DBG = (_m) => {};

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
  usage = { prompt: 0, completion: 0 };
  constructor(ctx) {
    this.#ctx = ctx;
    this.#wire();
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
    this.label = `${provider}/${model}${reasoningEffort ? ` (${reasoningEffort})` : ""}`;
  }
  newSession() {
    try {
      this.#handle?.dispose?.();
    } catch {}
    this.#handle = undefined;
    this.#sessionId = undefined;
    this.#agentId = undefined;
  }
  resumeSession(id) {
    this.newSession();
    this.#resumeId = id;
  }
  async listSessions(limit = 12) {
    const persistence = this.#ctx.get?.("sessionPersistence");
    if (!persistence?.list)
      return [];
    try {
      const headers = await persistence.list();
      return headers.map((h) => ({
        id: String(h?.id ?? ""),
        title: String(h?.title ?? h?.firstPrompt ?? h?.name ?? "").slice(0, 40),
        updatedAt: h?.updatedAt ?? h?.lastEventAt ?? h?.mtime
      })).filter((s) => s.id).sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""))).slice(0, limit);
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
  async turn(userText, cb, _signal) {
    this.#cb = cb;
    if (!this.#handle) {
      this.#sessionId = this.#resumeId ?? randomUUID();
      this.#resumeId = undefined;
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
      DBG(`session created ${this.#sessionId} agent=${this.#agentId}`);
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
      if (this.#sessionId === undefined || String(session.id) !== this.#sessionId)
        return;
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
function apply(ctx, config) {
  const i18n = createI18n("zh-CN");
  const store = new SurfaceStore;
  const session = new HostSession(ctx);
  mountEngine({}).then(({
    renderer
  }) => {
    render(() => _$createComponent10(ShellHost, {
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
