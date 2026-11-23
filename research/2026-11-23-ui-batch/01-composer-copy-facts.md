# Composer 复制/粘贴快捷键：只读调查事实

调查日期：2026-11-23
范围：`/Users/qingguee/repo/dsh-opentui`（只读），OpenTUI 宿主包 `/Users/qingguee/p2-verify-home-ODgLDy/profiles/opentui/node_modules/@opentui/core`（版本 0.8.1）。
说明：以下按 1-5 编号，每条为「结论 + 证据 file:line」。终端是否实际透传 cmd+c/v 属于终端配置问题，代码内无法证实，未作肯定结论。

---

## 1. 输入框组件与按键清单

**结论：存在两套输入框。当前 vendored 应用挂载 `component/prompt/index.tsx` 的 `<Prompt>`；v2 入口用 `routes/session/session-composer.tsx` 的 `SessionComposer`。按键由「配置文件 → keymap 层 → OpenTUI textarea 默认绑定」三层组成。**

- 挂载点：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/index.tsx:1678` 渲染 `<Prompt>`；`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/component/prompt/index.tsx` 是其实现。v2：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/examples/v2-entry.tsx:1360`、`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/session-composer.tsx:195`。
- 配置键位默认表（全清单）：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/config/keybind.ts:224-264`：
  - 移动 `input.move.left/right/up/down` = `left,ctrl+b` / `right,ctrl+f` / `up` / `down`（229-232）
  - 选区 `input.select.left/right/up/down` = `shift+方向键`（233-236）；`input.select.line.home/end` = `ctrl+shift+a/e`（238-239）；`input.select.visual.line.*` = `alt+shift+a/e`（243-244）；`input.select.buffer.home/end` = `shift+home/end`（246-247）；`input.select.word.*` = `alt+shift+f/b`（258-259）
  - Home/End `input.line.home/end` = `ctrl+a`/`ctrl+e`（237）；`input.visual.line.home/end` = `alt+a`/`alt+e`（241-242）；`input.buffer.home/end` = `none`（245）
  - 删除 `ctrl+shift+d`(删行)、`ctrl+k`(删到行尾)、`ctrl+u`(删到行首)、`ctrl+d`/`delete`/`shift+delete`(删字符)（250-253）；`ctrl+w`/`ctrl+backspace`/`alt+backspace` 与 `alt+d`/`alt+delete`/`ctrl+delete` 删词（260-261）
  - 撤销重做 `ctrl+-,super+z` / `ctrl+.,super+shift+z`（254-255）
  - 提交换行 `input.submit=return`、`input.newline=shift+return,ctrl+return,alt+return,ctrl+j`（227-228）
  - 全选 `input.select.all = super+a`（262）；历史 `prompt.history.previous/next = up/down`（263-264）
  - 无 `ctrl+y`（yank）绑定。
- 分发位置：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/context/keymap.tsx:95-137` 的 `registerManagedTextareaLayer` 把上述 `input.*` 全量绑定到聚焦的 textarea；OpenTUI 侧映射见 `/Users/qingguee/p2-verify-home-ODgLDy/profiles/opentui/node_modules/@opentui/keymap/src/addons/opentui/index.js:138,407`。
- OpenTUI textarea 内建绑定（与上面基本一致，含 `super+a` 全选、`super+z` 撤销）：`/Users/qingguee/p2-verify-home-ODgLDy/profiles/opentui/node_modules/@opentui/core/index.node.js:8542-8607`。
- 其他：v2 的 `↑↓` 历史 / `Tab` 补全在 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/session-composer.tsx:449-484`，fallback `onKeyDown` 在 `:500-525`；palette 的 `pageup/pagedown/home/end` 拦截在 `:112,492-497`；提交/换行绑定在 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/composer-keybinds.ts:86-99`（**只有 submit/newline**）。底部 Composer 面板的 `esc`/`ctrl+c` 关闭在 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/composer/index.tsx:72-82`。

## 2. 粘贴进入路径

**结论：主路径是终端 bracketed paste 由 OpenTUI 解析成 `PasteEvent` 注入；v1 另有 `ctrl+v` → clipboard.read() 的显式通道。**

- v1：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/component/prompt/index.tsx:1798-1823` 的 `onPaste(PasteEvent)`：`decodePasteBytes` + CRLF 规范化 → `preventDefault()` → `enqueuePaste(pasteInputText)`（插入实现 `:1447`）。空 paste 时 dispatch `prompt.paste`（`:1812`）。
- `prompt.paste` 命令：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/component/prompt/index.tsx:472-493`，`clipboard.read()` 在 `:479`，文本插入到 `:489`，图片变附件 `:483-487`。绑定层在 `:948-954`。默认值 `ctrl+v` 且 `preventDefault:false`：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/config/keybind.ts:226`。
- v2：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/session-composer.tsx:59` 注释明确 "Paste: native (TextareaRenderable.handlePaste, bracketed). No custom code."；API 在 `/Users/qingguee/p2-verify-home-ODgLDy/profiles/opentui/node_modules/@opentui/core/renderables/Textarea.d.ts:44`。
- bracketed paste 协议实现：`\x1B[200~`/`\x1B[201~` 常量与解析在 `/Users/qingguee/p2-verify-home-ODgLDy/profiles/opentui/node_modules/@opentui/core/chunk-node-s9be55eh.js:4773-4774,5587,6178`；终端能力位 `bracketed_paste` 在 `/Users/qingguee/p2-verify-home-ODgLDy/profiles/opentui/node_modules/@opentui/core/types.d.ts:71`。

## 3. cmd/meta 修饰键与 kitty keyboard protocol

**结论：OpenTUI 的 KeyEvent 能携带 `super`（mac cmd），kitty protocol 默认/显式启用；但代码里无任何 `super+c/super+v/super+x` 绑定，cmd+c/v 是否到达应用完全取决于终端模拟器是否把它们作为按键上报（通常被终端截走）。**

- KeyEvent 字段：`/Users/qingguee/p2-verify-home-ODgLDy/profiles/opentui/node_modules/@opentui/core/lib/KeyHandler.d.ts:4-17`（`ctrl:6`、`meta:7`、`super?:16`、`hyper?:17`）。`meta` 在本项目代表 alt/option：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/config/keybind.ts:34` 注释 `alt: "meta"`；cmd 对应 `super`（`input.select.all=super+a`，`:262`）。
- kitty 启用：v1 显式 `useKittyKeyboard: {}`：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/app.tsx:257`；v2 未显式传，但 core 默认 `config.useKittyKeyboard ?? {}`：`/Users/qingguee/p2-verify-home-ODgLDy/profiles/opentui/node_modules/@opentui/core/chunk-node-s9be55eh.js:21868`。flags 默认 `disambiguate + alternateKeys`（`:21410-21428`），解析时启用 kitty：`:3931`。
- 已有 super 先例：`super+a` 全选、`super+z` 撤销、`super+shift+z` 重做：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/config/keybind.ts:254-255,262`；OpenTUI 默认绑定同样有 `super+a/z`：`/Users/qingguee/p2-verify-home-ODgLDy/profiles/opentui/node_modules/@opentui/core/index.node.js:8603-8607`。
- **没找到** `super+c` / `super+v` / `super+x` 的任何注册（全仓 grep 只命中注释：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/examples/v2-entry.tsx:1907-1910`）。
- 终端侧限制证据：`/Users/qingguee/repo/dsh-opentui/docs/activity-merged-widget.md:228` 说明终端原生拖选/Cmd+C 需要 Shift+drag 才让给终端；`/Users/qingguee/repo/dsh-opentui/packages/tui-base/examples/v2-entry.tsx:1907-1910` 同样说明 Shift+drag 绕开应用选择交给终端 Cmd+C。即 Cmd+C/V 在 Ghostty/iTerm2 通常被终端/OS 处理，不是应用按键。

## 4. 选区与剪贴板写入通道

**结论：composer 编辑器本身有完整选区 API，但没有 "copy/cut" action；系统剪贴板写入走 OpenTUI `createClipboard`（宿主原生后端 + OSC52），仓库有多处 `clipboard.write` 先例，未见 pbcopy/xclip 之类的 shell 命令。**

- 编辑区选区：`/Users/qingguee/p2-verify-home-ODgLDy/profiles/opentui/node_modules/@opentui/core/renderables/EditBufferRenderable.d.ts:141-150`（`getSelectedText`/`hasSelection`/`getSelection`/`setSelection`/`clearSelection`）与 `:194`（`selectAll()`）；键盘选区绑定见 Q1。`TextareaAction` 联合类型无 `copy`/`cut`：`/Users/qingguee/p2-verify-home-ODgLDy/profiles/opentui/node_modules/@opentui/core/renderables/Textarea.d.ts:7`。
- 终端级选区另有体系：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/util/selection.ts:40-66`（`copy`/`copyOnSelectRelease`）、`:67-105`（`handleSelectionKey`，`ctrl+c` 复制，`baseCode 99/67` 兼容 kitty）；应用层拦截优先级 101 在 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/app.tsx:589-598`；console 复制 `ctrl+shift+c` 在 `:262`，回调 `:602-610`。
- 剪贴板封装：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/clipboard.ts:13-20` 创建 `createClipboard({ host: createHostClipboard(), terminal: createRendererClipboardAdapter(renderer) })`；写入 `:54-63` 调 `writeText(..., { destination:"all-available", selection:"clipboard" })`；读取 `:24-53`。Context 在 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/context/clipboard.tsx:3-19`，Provider 挂载在 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/app.tsx:293-295,339`。
- OSC52 通道：`/Users/qingguee/p2-verify-home-ODgLDy/profiles/opentui/node_modules/@opentui/core/lib/clipboard.d.ts:75-95`（`copyToClipboardOSC52`）；实现 `/Users/qingguee/p2-verify-home-ODgLDy/profiles/opentui/node_modules/@opentui/core/chunk-node-s9be55eh.js:24174-24178` → `nativeSession.writeClipboard`；宿主后端是原生 ABI：`/Users/qingguee/p2-verify-home-ODgLDy/profiles/opentui/node_modules/@opentui/core/native-abi.generated.d.ts:966-1034`。**没找到** JS 层的 `pbcopy`/`xclip`/`wl-copy` 调用。
- 复制先例：`messages.copy=<leader>y`（`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/config/keybind.ts:211`），实际 `clipboard.write` 在 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/index.tsx:1369,1403`；消息弹窗复制 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/dialog-message.tsx:70`；工作目录复制 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/ui/working-directory-actions.tsx:30`。`/export` 命令定义在 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/commands.ts:1407`，其纯逻辑 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/export.ts`；**没找到** `/export` 里写剪贴板的代码。

## 5. 底部 status bar / footer 现状

**结论：v2 的提示行是一行 `⌨ ...` 快捷键提示；busy 状态行已删除，只剩一个 comet 动画；v1 的 PromptFooter 显示 subagent/shell/goal/上下文用量/费用等。**

- v2 composer 底边固定行：`"enter send · while streaming enter steers · alt+enter newline · ↑↓ history"`：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/session-composer.tsx:119,619-622`。
- v2 页面最后一行 hints：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/hints-line.tsx:8-9`（idle `⌨ enter send · alt+enter newline · ↑↓ history · ctrl+shift+f search · pgup/pgdn scroll · ctrl+c quit`；busy `⌨ enter steer · esc stop · …`），分段定义 `:139-149`，渲染 `:276`，可 `/hints` 开关。
- status-bar 已退役为 comet（busy 才显示）：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/status-bar.tsx:1-13,31-57`。
- v1 footer：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/feature-plugins/prompt/footer.tsx:11-120`（subagents/shells 数量、goal、token 用量/费用、`Ctrl+P commands`、`Tab agents`）。

---

## 对用户需求的含义

**已具备的能力**：`全选` 在代码层已存在——`super+a`（mac cmd+a / linux super+a）既在 OpenTUI textarea 默认绑定里，也在项目 `input.select.all` 配置里（`keybind.ts:262`）；选区 API（`getSelectedText`/`selectAll`）也齐全。**缺的是把选区文字写入剪贴板的 "copy" action**（textarea 没有 `copy`/`cut` action，需新增：取 `getSelectedText()` → `clipboard.write()`），以及 Linux 习惯的 `ctrl+c` 复制——但 `ctrl+c` 当前已被 `prompt.clear`（清空输入，`keybind.ts:224`）和 app 退出占用，不能直接用。

**可行键位方案与限制**：

- **mac（Ghostty/iTerm2）**：`cmd+a` 全选——应用侧已支持，前提是终端把 cmd+a 作为 kitty `super` 修饰键上报；`cmd+c`/`cmd+v`——应用侧无绑定，且**通常被终端/OS 截走用于系统剪贴板**（`docs/activity-merged-widget.md:228`、`v2-entry.tsx:1907-1910` 的证据）。若要应用内响应，必须让终端把 cmd+c/v 作为按键透传（改终端键位映射到 kitty 序列）；否则只能依赖终端原生复制/粘贴，但当前应用接管了普通拖拽选择，终端原生复制需要 **Shift+拖拽**。`alt/option`（OpenTUI `meta`）系的 `alt+shift+方向键`、`alt+a/e`、`alt+f/b` 等能稳定到达应用，可作为自定义 copy 前缀（例如 `alt+w` 复制）的候选；`ctrl+v` 粘贴已存在（`keybind.ts:226`），但 `preventDefault:false` 意味着它和终端 bracketed paste 可能同时触发，需注意双插风险。

- **Linux（kitty/foot/WezTerm 等支持 kitty protocol 的终端）**：`super+a` 全选同样可用；`ctrl+shift+c`/`ctrl+shift+v` 是终端级复制粘贴惯例（应用内 console 已用 `ctrl+shift+c` 复制终端选区，`app.tsx:262`），若要做输入框复制可复用这一习惯，但需处理与终端截获的冲突；`ctrl+c`/`ctrl+v` 在应用内已被占用（清空 / 粘贴）；`ctrl+k/u/w/d/a/e/b/f` 这套 bash/readline 键位已完整实现（`keybind.ts:229-261` + OpenTUI 默认绑定），无需新增。粘贴无论平台都已有 bracketed paste 主路径，新增工作主要集中在「选区 → 剪贴板写入」这一环，通道现成（`clipboard.write` → 宿主原生后端 + OSC52）。

- **超时说明**：本次调查在 30 分钟时间盒内完成，所有结论均为静态代码证据；终端是否实际透传 cmd+c/v 属于终端配置问题，代码内无法证实，故未作肯定结论。
