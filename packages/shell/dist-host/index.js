// src/host-entry.tsx
import { createComponent as _$createComponent7 } from "@opentui/solid";
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
    "zh-CN": "/help 命令列表 · /model 切换模型 · /login /logout 凭据 · /usage 用量 · /clear 清空 · /quit 退出",
    en: "/help · /model [provider/id] · /login · /logout · /usage · /clear · /quit"
  },
  "cmd.model.current": { "zh-CN": "当前模型", en: "current model" },
  "cmd.model.available": { "zh-CN": "可用模型", en: "available" },
  "cmd.model.set": { "zh-CN": "已切换", en: "switched to" },
  "cmd.model.next": { "zh-CN": "（下一条消息生效）", en: "(next message)" },
  "picker.sessions.title": { "zh-CN": "会话（回车恢复 · esc 取消）", en: "sessions (enter resume · esc cancel)" },
  "picker.effort.title": { "zh-CN": "{model} 思考档位", en: "{model} reasoning effort" },
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
import { createTextNode as _$createTextNode5 } from "@opentui/solid";
import { effect as _$effect6 } from "@opentui/solid";
import { insertNode as _$insertNode6 } from "@opentui/solid";
import { memo as _$memo4 } from "@opentui/solid";
import { insert as _$insert6 } from "@opentui/solid";
import { createComponent as _$createComponent6 } from "@opentui/solid";
import { setProp as _$setProp6 } from "@opentui/solid";
import { createElement as _$createElement6 } from "@opentui/solid";
import { For as For6, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { SyntaxStyle } from "@opentui/core";
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
function TranscriptWindow(props) {
  const offset = () => props.offset ?? 0;
  const bottomView = () => _$createComponent2(Transcript, {
    get items() {
      return props.items;
    },
    get theme() {
      return props.theme;
    },
    get t() {
      return props.t;
    },
    get spinnerFrame() {
      return props.spinnerFrame;
    },
    get maxItems() {
      return props.maxItems;
    },
    get mdStyle() {
      return props.mdStyle;
    }
  });
  const windowLines = () => {
    const visible = props.items.slice(-(props.maxItems ?? MAX_VISIBLE_ITEMS));
    const all = itemsToLines(visible, props.theme, props.t, props.spinnerFrame, props.mdStyle);
    const rows = props.viewportRows ?? 30;
    const start = Math.max(0, all.length - rows - offset());
    const end = Math.max(1, all.length - offset());
    return all.slice(start, end);
  };
  const scrolledView = () => (() => {
    var _el$18 = _$createElement2("box"), _el$19 = _$createElement2("text");
    _$insertNode2(_el$18, _el$19);
    _$setProp2(_el$18, "style", {
      flexDirection: "column",
      flexGrow: 1,
      padding: 1
    });
    _$insert2(_el$18, _$createComponent2(For2, {
      get each() {
        return windowLines();
      },
      children: (l) => (() => {
        var _el$20 = _$createElement2("text");
        _$insert2(_el$20, () => l.text || " ");
        _$effect2((_$p) => _$setProp2(_el$20, "style", l.fg ? {
          fg: l.fg
        } : {}, _$p));
        return _el$20;
      })()
    }), _el$19);
    _$insert2(_el$19, () => `↑ scrolled ${offset()} rows (PgDn = bottom)`);
    _$effect2((_$p) => _$setProp2(_el$19, "style", {
      fg: props.theme.tokens.dim
    }, _$p));
    return _el$18;
  })();
  return _$createComponent2(Show, {
    get when() {
      return offset() === 0;
    },
    get fallback() {
      return scrolledView();
    },
    get children() {
      return bottomView();
    }
  });
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
function Picker(props) {
  const maxRows = () => props.maxRows ?? 12;
  const visible = () => props.items.slice(0, maxRows());
  const hiddenCount = () => props.items.length - visible().length;
  const rowStyle = (sel) => {
    if (!sel)
      return {
        fg: props.theme.tokens.dim
      };
    return {
      fg: props.theme.tokens.text,
      ...props.theme.tokens.selection ? {
        bg: props.theme.tokens.selection
      } : {}
    };
  };
  const needsHeader = (idx) => {
    const it = visible()[idx];
    if (!it || it.group === undefined)
      return false;
    const prev = idx > 0 ? visible()[idx - 1] : undefined;
    return prev?.group !== it.group;
  };
  return (() => {
    var _el$ = _$createElement3("box"), _el$2 = _$createElement3("text");
    _$insertNode3(_el$, _el$2);
    _$insert3(_el$2, () => props.title);
    _$insert3(_el$, _$createComponent3(For3, {
      get each() {
        return visible();
      },
      children: (it, i) => [_$memo2(() => _$memo2(() => !!needsHeader(i()))() ? (() => {
        var _el$4 = _$createElement3("text");
        _$insert3(_el$4, () => it.group);
        _$effect3((_$p) => _$setProp3(_el$4, "style", {
          fg: props.theme.tokens.dim
        }, _$p));
        return _el$4;
      })() : null), (() => {
        var _el$3 = _$createElement3("text");
        _$insert3(_el$3, () => i() === props.selected ? "› " : "  ", null);
        _$insert3(_el$3, () => it.label, null);
        _$insert3(_el$3, (() => {
          var _c$2 = _$memo2(() => !!it.detail);
          return () => _c$2() ? (() => {
            var _el$5 = _$createElement3("span");
            _$insert3(_el$5, () => `  ${it.detail}`);
            _$effect3((_$p) => _$setProp3(_el$5, "style", {
              fg: props.theme.tokens.dim
            }, _$p));
            return _el$5;
          })() : null;
        })(), null);
        _$effect3((_$p) => _$setProp3(_el$3, "style", rowStyle(i() === props.selected), _$p));
        return _el$3;
      })()]
    }), null);
    _$insert3(_el$, (() => {
      var _c$ = _$memo2(() => hiddenCount() > 0);
      return () => _c$() ? (() => {
        var _el$6 = _$createElement3("text");
        _$insert3(_el$6, () => `… ${hiddenCount()} more`);
        _$effect3((_$p) => _$setProp3(_el$6, "style", {
          fg: props.theme.tokens.dim
        }, _$p));
        return _el$6;
      })() : null;
    })(), null);
    _$effect3((_p$) => {
      var _v$ = {
        border: true,
        borderColor: props.theme.tokens.border,
        flexDirection: "column",
        padding: 1
      }, _v$2 = {
        fg: props.theme.tokens.accent
      };
      _v$ !== _p$.e && (_p$.e = _$setProp3(_el$, "style", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp3(_el$2, "style", _v$2, _p$.t));
      return _p$;
    }, {
      e: undefined,
      t: undefined
    });
    return _el$;
  })();
}
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
import { For as For4 } from "solid-js";
var TOOL_MAX_ROWS = 14;
var TOOL_OUTPUT_TAIL = 6;
var THINK_TAIL = 10;
function dockHeader(theme, title, closeHint) {
  return (() => {
    var _el$ = _$createElement4("box"), _el$2 = _$createElement4("text"), _el$3 = _$createElement4("box"), _el$4 = _$createElement4("text");
    _$insertNode4(_el$, _el$2);
    _$insertNode4(_el$, _el$3);
    _$insertNode4(_el$, _el$4);
    _$setProp4(_el$, "style", {
      flexDirection: "row"
    });
    _$insert4(_el$2, title);
    _$setProp4(_el$3, "style", {
      flexGrow: 1
    });
    _$insert4(_el$4, closeHint);
    _$effect4((_p$) => {
      var _v$ = {
        fg: theme.tokens.accent
      }, _v$2 = {
        fg: theme.tokens.dim
      };
      _v$ !== _p$.e && (_p$.e = _$setProp4(_el$2, "style", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp4(_el$4, "style", _v$2, _p$.t));
      return _p$;
    }, {
      e: undefined,
      t: undefined
    });
    return _el$;
  })();
}
function ToolPanel(props) {
  const rows = () => {
    const th = props.theme;
    const out = [];
    for (let i = 0;i < props.entries.length && out.length < TOOL_MAX_ROWS; i++) {
      const e = props.entries[i];
      if (!e)
        continue;
      const fg = e.ok ? th.tokens.toolOk ?? th.tokens.ok : th.tokens.toolFail ?? th.tokens.danger;
      out.push({
        text: `⚒ ${e.name} ${e.ok ? "ok" : "fail"}`,
        fg
      });
      if (i === props.expandedIndex) {
        for (const line of e.output.split(`
`).slice(-TOOL_OUTPUT_TAIL)) {
          if (out.length >= TOOL_MAX_ROWS)
            break;
          out.push({
            text: `  ${line}`,
            fg: th.tokens.dim
          });
        }
      }
    }
    return out;
  };
  return (() => {
    var _el$5 = _$createElement4("box");
    _$insert4(_el$5, () => dockHeader(props.theme, ` Tools (${props.entries.length})`, "ctrl+o close"), null);
    _$insert4(_el$5, _$createComponent4(For4, {
      get each() {
        return rows();
      },
      children: (r) => (() => {
        var _el$6 = _$createElement4("text");
        _$insert4(_el$6, () => r.text);
        _$effect4((_$p) => _$setProp4(_el$6, "style", {
          fg: r.fg
        }, _$p));
        return _el$6;
      })()
    }), null);
    _$effect4((_$p) => _$setProp4(_el$5, "style", {
      border: true,
      borderColor: props.theme.tokens.border,
      flexDirection: "column",
      padding: 1
    }, _$p));
    return _el$5;
  })();
}
function ThinkPanel(props) {
  const lines = () => props.text.split(`
`);
  const tail = () => lines().slice(-THINK_TAIL);
  const truncated = () => lines().length > tail().length;
  return (() => {
    var _el$7 = _$createElement4("box");
    _$insert4(_el$7, () => dockHeader(props.theme, " Thinking ", "ctrl+t close"), null);
    _$insert4(_el$7, (() => {
      var _c$ = _$memo3(() => !!truncated());
      return () => _c$() ? (() => {
        var _el$8 = _$createElement4("text");
        _$insertNode4(_el$8, _$createTextNode4(`…`));
        _$effect4((_$p) => _$setProp4(_el$8, "style", {
          fg: props.theme.tokens.dim
        }, _$p));
        return _el$8;
      })() : null;
    })(), null);
    _$insert4(_el$7, _$createComponent4(For4, {
      get each() {
        return tail();
      },
      children: (l) => (() => {
        var _el$0 = _$createElement4("text");
        _$insert4(_el$0, l);
        _$effect4((_$p) => _$setProp4(_el$0, "style", {
          fg: props.theme.tokens.dim
        }, _$p));
        return _el$0;
      })()
    }), null);
    _$effect4((_$p) => _$setProp4(_el$7, "style", {
      border: true,
      borderColor: props.theme.tokens.border,
      flexDirection: "column",
      padding: 1
    }, _$p));
    return _el$7;
  })();
}
// ../kit/src/table.tsx
import { effect as _$effect5 } from "@opentui/solid";
import { insertNode as _$insertNode5 } from "@opentui/solid";
import { createComponent as _$createComponent5 } from "@opentui/solid";
import { insert as _$insert5 } from "@opentui/solid";
import { setProp as _$setProp5 } from "@opentui/solid";
import { createElement as _$createElement5 } from "@opentui/solid";
import { For as For5 } from "solid-js";
// src/ShellHost.tsx
var MAX_VISIBLE_ITEMS2 = 120;
var THEME_ORDER = ["catppuccin-mocha", "default"];
var CRED_REFS = ["ZAI_CODING_CN_API_KEY", "DEEPSEEK_API_KEY", "MINIMAX_CN_API_KEY"];
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
  const [showThink, setShowThink] = createSignal(false);
  const [showTool, setShowTool] = createSignal(false);
  const [toolExpanded, setToolExpanded] = createSignal(-1);
  const [picker, setPicker] = createSignal(null);
  const [pickerSel, setPickerSel] = createSignal(0);
  const [sessionItems, setSessionItems] = createSignal([]);
  const [scrollOffset, setScrollOffset] = createSignal(0);
  const [ask, setAsk] = createSignal(null);
  let reasoningBuf = "";
  const [lastReasoning, setLastReasoning] = createSignal("");
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
    if (!process.env.DSH_OPENTUI_NO_ASK)
      props.deps.session.registerAskProvider(async (questions) => {
        const answer = await new Promise((resolve) => {
          setAsk({
            questions,
            resolve
          });
        });
        if (answer === "declined")
          throw new Error("declined");
        return answer;
      });
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
  const [modelItems, setModelItems] = createSignal([]);
  const refreshModelItems = () => {
    props.deps.session.listProviders().then((catalog) => {
      const out = [];
      for (const p of catalog) {
        for (const m of p.models) {
          const id = `${p.provider}/${m}`;
          out.push({
            id,
            group: p.provider,
            label: m,
            detail: label() === id ? "current" : undefined
          });
        }
      }
      setModelItems(out);
    });
  };
  onMount(refreshModelItems);
  const EFFORTS = ["keep", "low", "medium", "high", "xhigh", "max"];
  const pickerData = createMemo(() => {
    const p = picker();
    if (!p)
      return {
        title: "",
        items: []
      };
    if (p.kind === "model")
      return {
        title: t("picker.model.title"),
        items: modelItems()
      };
    if (p.kind === "sessions")
      return {
        title: t("picker.sessions.title"),
        items: sessionItems()
      };
    return {
      title: t("picker.effort.title", {
        model: p.model
      }),
      items: EFFORTS.map((e) => ({
        id: e,
        label: e
      }))
    };
  });
  const toolEntries = createMemo(() => items().filter((it) => it.kind === "tool").map((it) => ({
    name: it.name,
    args: it.args,
    ok: it.ok,
    output: it.brief
  })));
  const rendererCtx = useRenderer();
  let mdStyle;
  try {
    mdStyle = SyntaxStyle.create(rendererCtx);
  } catch {
    mdStyle = undefined;
  }
  const visibleItems = createMemo(() => items().slice(-MAX_VISIBLE_ITEMS2));
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
    } else if (cmd === "new") {
      props.deps.session.newSession();
      setItems([]);
      setScrollOffset(0);
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
        setSessionItems(list.map((x) => ({
          id: x.id,
          label: x.title || x.id.slice(0, 8),
          detail: x.updatedAt ? String(x.updatedAt).slice(0, 19) : undefined
        })));
        setPickerSel(0);
        setPicker({
          kind: "sessions"
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
        setPickerSel(0);
        setPicker({
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
  async function send(text) {
    if (busy())
      return;
    setScrollOffset(0);
    push({
      kind: "user",
      text
    });
    setBusy(true);
    let thinkingItem = null;
    let replyItem = null;
    streaming = {};
    reasoningBuf = "";
    setLastReasoning("");
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
          reasoningBuf += s;
          setLastReasoning(reasoningBuf);
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
        text: errText(e)
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
    const pendingAsk = ask();
    if (pendingAsk) {
      const q0 = pendingAsk.questions[0];
      const opts = q0?.options ?? [];
      if (key.name === "up" || key.name === "down") {
        if (opts.length > 0)
          setPickerSel((v) => key.name === "up" ? (v - 1 + opts.length) % opts.length : (v + 1) % opts.length);
      } else if (key.name === "return") {
        const sel = opts[Math.min(pickerSel(), Math.max(0, opts.length - 1))];
        setAsk(null);
        pendingAsk.resolve(sel ? [{
          questionId: q0.id,
          selected: sel
        }] : "declined");
      } else if (key.name === "escape") {
        setAsk(null);
        pendingAsk.resolve("declined");
      }
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
    const pk = picker();
    if (pk) {
      const n = pickerData().items.length;
      if (key.name === "up" || key.name === "down") {
        if (n > 0)
          setPickerSel((s) => key.name === "up" ? (s - 1 + n) % n : (s + 1) % n);
      } else if (key.name === "return") {
        const item = n > 0 ? pickerData().items[Math.min(pickerSel(), n - 1)] : undefined;
        setPicker(null);
        setPickerSel(0);
        if (item && pk.kind === "model") {
          const [provider, model] = item.id.split("/");
          if (provider && model)
            setPicker({
              kind: "effort",
              provider,
              model
            });
        } else if (item && pk.kind === "effort") {
          const effort = item.id === "keep" ? undefined : item.id;
          props.deps.session.switchModel(pk.provider, pk.model, effort);
          setLabel(props.deps.session.label);
          push({
            kind: "system",
            text: `${t("cmd.model.set")} ${pk.provider}/${pk.model}${effort ? ` (${effort})` : ""} ${t("cmd.model.next")}`
          });
        } else if (item && pk.kind === "sessions") {
          props.deps.session.resumeSession(item.id);
          push({
            kind: "system",
            text: `${t("cmd.sessions.resumed")}: ${item.label}`
          });
        }
      } else if (key.name === "escape") {
        setPicker(null);
        setPickerSel(0);
      }
      return;
    }
    if (key.ctrl && key.name === "t") {
      setShowThink((v) => !v);
      return;
    }
    if (key.ctrl && key.name === "o") {
      setShowTool((v) => !v);
      return;
    }
    if (key.ctrl && key.name === "p") {
      const n = toolEntries().length;
      if (n > 0)
        setToolExpanded((v) => v + 1 >= n ? -1 : v + 1);
      return;
    }
    if (key.name === "pageup") {
      setScrollOffset((o) => o + 10);
      if (process.env.DSH_OPENTUI_DEBUG) {
        import("node:fs").then((fs) => fs.appendFileSync("/tmp/host-keys.log", `pageup handled offset=${scrollOffset()}
`)).catch(() => {});
      }
      return;
    }
    if (key.name === "pagedown") {
      setScrollOffset((o) => Math.max(0, o - 10));
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
    var _el$ = _$createElement6("box"), _el$2 = _$createElement6("box");
    _$insertNode6(_el$, _el$2);
    _$setProp6(_el$, "style", {
      flexDirection: "column",
      flexGrow: 1
    });
    _$setProp6(_el$2, "style", {
      flexDirection: "column",
      flexGrow: 1,
      padding: 1
    });
    _$insert6(_el$2, _$createComponent6(TranscriptWindow, {
      get items() {
        return visibleItems();
      },
      get theme() {
        return theme();
      },
      t,
      get spinnerFrame() {
        return spinner();
      },
      mdStyle,
      get offset() {
        return scrollOffset();
      },
      viewportRows: 24
    }));
    _$insert6(_el$, (() => {
      var _c$ = _$memo4(() => !!showTool());
      return () => _c$() ? _$createComponent6(ToolPanel, {
        get entries() {
          return toolEntries();
        },
        get theme() {
          return th();
        },
        get expandedIndex() {
          return toolExpanded();
        }
      }) : null;
    })(), null);
    _$insert6(_el$, (() => {
      var _c$2 = _$memo4(() => !!showThink());
      return () => _c$2() ? _$createComponent6(ThinkPanel, {
        get text() {
          return lastReasoning();
        },
        get theme() {
          return th();
        }
      }) : null;
    })(), null);
    _$insert6(_el$, _$createComponent6(For6, {
      get each() {
        return _$memo4(() => !!approval())() ? [approval()] : [];
      },
      children: (ap) => _$createComponent6(ApprovalCard, {
        get toolName() {
          return ap.name;
        },
        get args() {
          return ap.args;
        },
        get hint() {
          return t("agent.approve.hint");
        },
        get theme() {
          return th();
        }
      })
    }), null);
    _$insert6(_el$, (() => {
      var _c$3 = _$memo4(() => !!ask());
      return () => _c$3() ? _$createComponent6(Picker, {
        get title() {
          return `${t("ask.title")}: ${ask().questions[0]?.prompt ?? ""}`.slice(0, 70);
        },
        get items() {
          return (ask().questions[0]?.options ?? []).map((o) => ({
            id: o,
            label: o
          }));
        },
        get selected() {
          return pickerSel();
        },
        get theme() {
          return th();
        },
        maxRows: 8
      }) : null;
    })(), null);
    _$insert6(_el$, (() => {
      var _c$4 = _$memo4(() => !!picker());
      return () => _c$4() ? _$createComponent6(Picker, {
        get title() {
          return pickerData().title;
        },
        get items() {
          return pickerData().items;
        },
        get selected() {
          return pickerSel();
        },
        get theme() {
          return th();
        },
        maxRows: 8
      }) : null;
    })(), null);
    _$insert6(_el$, _$createComponent6(For6, {
      get each() {
        return menuVisible() ? [0] : [];
      },
      children: () => (() => {
        var _el$3 = _$createElement6("box");
        _$insert6(_el$3, _$createComponent6(For6, {
          get each() {
            return filteredCommands();
          },
          children: (c, i) => (() => {
            var _el$4 = _$createElement6("text"), _el$5 = _$createTextNode5(` `);
            _$insertNode6(_el$4, _el$5);
            _$insert6(_el$4, () => i() === clampedSel() ? "› " : "  ", _el$5);
            _$insert6(_el$4, () => c.name, _el$5);
            _$insert6(_el$4, () => c.desc, null);
            _$effect6((_$p) => _$setProp6(_el$4, "style", {
              fg: i() === clampedSel() ? th().tokens.accent : undefined
            }, _$p));
            return _el$4;
          })()
        }));
        _$effect6((_$p) => _$setProp6(_el$3, "style", {
          border: true,
          borderColor: th().tokens.border,
          flexDirection: "column",
          padding: 0
        }, _$p));
        return _el$3;
      })()
    }), null);
    _$insert6(_el$, _$createComponent6(InputLine, {
      get value() {
        return input();
      },
      get cursor() {
        return cursor();
      },
      get busy() {
        return busy();
      },
      get spinnerFrame() {
        return spinner();
      },
      get placeholder() {
        return t("shell.input.placeholder");
      },
      get busyLabel() {
        return t("shell.input.busy");
      },
      get theme() {
        return th();
      }
    }), null);
    _$insert6(_el$, _$createComponent6(FooterHints, {
      get theme() {
        return th();
      }
    }), null);
    _$insert6(_el$, _$createComponent6(StatusBar, {
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
    render(() => _$createComponent7(ShellHost, {
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
