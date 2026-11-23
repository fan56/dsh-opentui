# activity 面板 tab 化 / 鼠标 / 边框聚焦 — 只读调查事实

> 调查仓库：`/Users/qingguee/repo/dsh-opentui`（UI 主体在 `packages/tui-base/src`，宿主包 `@opentui/core@0.8.1` 在 `node_modules/.pnpm/...`）
> 方法：只读调查（read/grep），未修改任何文件。时间盒 30 分钟内完成。
> 用途：为「1) activity 面板重构为 tab 切换（tab1=主面板现状，tab2=todo 详细内容，鼠标点击切换）；2) 所有面板边框/线条与标题聚焦时粗体、非聚焦时浅色细线」提供事实依据。

---

## 1. activity 面板代码与内部结构

**结论**：合并面板的代码分两层：渲染组件 `WidgetsDock`，纯数据/行构建在 `merged-dock.ts`。todo 与 subagent 被合并为一个「上区（think/tool）+ 下区（todo/subagent）」的单一边框盒，按 scene A/B/C 切换布局，全部行由 `mergedDockLines` 构建并裁到统一内宽。

- 渲染入口组件 `WidgetsDock`：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/widgets-dock.tsx:1538`
- 数据装配 `mergedSource`（每次渲染从 `props.rows` 重建，无组件级 memo）：`widgets-dock.tsx:1616-1622`
- todo 来源 `latestTodos(rows)` → `parseTodos`（从 tool call 行解析）：`widgets-dock.tsx:582`；subagent 来源 `mergedRunningAgents(rows)`：`widgets-dock.tsx:1480`
- 纯数据层 `merged-dock.ts`：`MergedDockData` 定义 `:66`，`buildMergedDock` `:439`，三场景 `:459-490`（A=有运行中 subagent → think/tool/todo brief 各 1 行钉在上方 + 可滚动 agent 列表；B=仅 think；C=tool 最多 3 行 + todo 树）
- 标题由 `mergedTitle()` 生成，刻意不含 "todo" 字样：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/merged-dock.ts:203`
- 实际挂载：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/examples/v2-entry.tsx:1319`（`widgets: createComponent(WidgetsDock, ...)`）；经 `transcript.tsx:517-527` 的 widgets slot 落在编辑器上方

## 2. 鼠标支持

**结论**：opentui 上报鼠标事件，本应用已有大量点击/滚轮处理先例；终端鼠标上报由 `renderer.useMouse = config.mouse`（默认 true）开启。但 app 显式设了 `autoFocus: false`，所以「点击自动转移焦点」这条路径与 pane-focus 注释里描述的默认行为不一致，新增 tab 应靠显式 `onMouseUp` 处理器。

- activity 面板自身已吃滚轮：`onMouseScroll={onMergedWheel}`（`widgets-dock.tsx:1844`），处理器 `:1699`（读 `event.scroll.direction/delta` 改 `mergedDockCursor` 信号）
- 点击先例（onMouseUp/onMouseDown）：`ui/link.tsx:27`、`ui/dialog.tsx:73,95,152`、`ui/toast.tsx:67`、`routes/session/pane-resize.ts:49`、`feature-plugins/sidebar/todo.tsx:25`、`feature-plugins/home/footer.tsx:24`
- 鼠标类型来自 `@opentui/core`：`MouseEvent`/`MouseButton` 见 `ui/link.tsx:2`、`ui/pane-resize.ts:1`
- 终端侧开启：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/app.tsx:260`（`useMouse: config.mouse`）、`app.tsx:633`（`renderer.useMouse = config.data.mouse`）；默认 true 在 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/config/index.tsx:328`
- 注意：`app.tsx:258` 设 `autoFocus: false`，而 `pane-focus.tsx` 文件头声称 "renderer's autoFocus (default true) focuses the nearest focusable ancestor on a left-button press" —— 该默认在本应用被关闭，不能依赖点击自动聚焦

## 3. 边框与标题现状

**结论**：已有完整的聚焦/非聚焦边框语义（`surfaceBorder`：聚焦=heavy 粗线+interactive 色，非聚焦=single 细线+border.base）；但 activity 面板边框是「turn 期间恒亮蓝 heavy」，与聚焦无关；box 的标题由 opentui 原生渲染，box 属性里没有 bold/titleAttributes，只有颜色与 `focusedBorderColor`。

- 边框语义单一来源：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/skin/semantic.ts:46`（`unfocusedBorderColor`）、`:55`（`focusedBorderColor`）、`:69-88`（`surfaceBorder`）
- activity 边框现状：`borderStyle="heavy"` + `borderColor={activityFrameBorderColor(theme)}`（亮蓝，仅 turn 期间显示）：`widgets-dock.tsx:1839-1842`；颜色函数 `:1230`，fallback `#7aa2f7` 在 `:1109`
- 标题渲染：`title={mergedTitleText()}` `titleAlignment="left"` 在 `widgets-dock.tsx:1842-1843`；box 原生 title 属性定义在 `/Users/qingguee/repo/dsh-opentui/node_modules/.pnpm/@opentui+core@0.8.1_typescript@5.9.3_web-tree-sitter@0.25.10/node_modules/@opentui/core/renderables/Box.d.ts:14-19`（`title`, `titleColor`, `titleAlignment`, `focusedBorderColor`），**没有** `titleAttributes`/`borderAttributes`；标题实际绘制在 `chunk-node-tpjmjvn7.js:10096-10109`
- 弹窗边框/标题：`ui/dialog.tsx:107` `borderStyle="heavy"`、`:66` 用 `focusedBorderColor`、`:144` 标题文字用 `TextAttributes.BOLD`（仅 non-newDesigns 分支）
- ANSI bold 已有先例：全项目大量 `TextAttributes.BOLD`（如 `ui/dialog-confirm.tsx:133`、`context/panel-kit-host.tsx:107-111`），但都是 `<text>`/`<span>` 的文字属性，不是 box 边框属性
- 渲染限制：`clipToWidth` 的历史 bug 是「已定宽内容被再次裁剪 + 空格正则缺 g 标志，右边框短 2 列」，现改用 `takeWidth`，见 `/Users/qingguee/repo/dsh-opentui/CHANGELOG.md:524-527`；当前 `dockLineNode` 仍用 `clipToWidth` 裁每行（`widgets-dock.tsx:1908-1927`），但 merged 行走 `fitLine`/`takeWidth`（`merged-dock.ts:255`），改边框时必须保住「每行恰好 innerWidth」的宽度律

## 4. focus 模型

**结论**：焦点不止 composer 一个——已有 composer/transcript 双 pane 焦点（`PaneFocus`，F6 切换）和四层 FocusRouter 捕获栈；但 activity 面板/widget 没有"当前激活"状态，tab 化可复用现成的 `createSignal` 模块级信号模式。

- 双 pane 焦点：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/pane-focus.tsx:48-62`（`createPaneFocus`，`Pane = "composer" | "transcript"`），真值来自 renderer 的 `FOCUSED_RENDERABLE` 事件 `:125-136`；F6 切换层 `:151-181`
- 四层捕获栈：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/context/focus-router.tsx:37-48`（modal>overlay>main>global）、`:135`（`useIsPageOwner`）
- 现有激活态信号先例：`activityPanelGear`（`widgets-dock.tsx:211`）、`mergedDockCursor`（`:484`）、`dockSpin`（`:475`）——都用模块级 `createSignal` + 配套 reset
- 建议落点：在 `widgets-dock.tsx` 增一个模块级 `createSignal<"main"|"todo">` 作为 tab 状态，与现有 `mergedDockCursor` 同级；不需要新建 store

## 5. keymap 注册机制

**结论**：用 `Keymap.createLayer` 注册；`mode: "global"` 的层不受 modal 拦截（所有 mode 都生效），默认 `mode: "base"` 的层在 dialog 推入 modal 后自动失效；`capture` 层再做 FocusRouter 结构门控；`priority` 决定同层优先级。

- 注册实现：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/context/keymap.tsx:209`（`createLayer`）、`:243`（`mode === "global" ? {} : { mode: mode ?? MODE.base }`）、`:223-242`（capture 与 enabled 门控）
- mode 栈：`keymap.tsx:497-522`，`current = stack().findLast(enabled)?.mode ?? base`
- modal 推入点：`ui/dialog.tsx:363`（`keymap.mode.push("modal")`），对话框层 `mode: "modal"` + `capture:"modal"` 见 `ui/dialog.tsx:387-391`
- 与 activity 面板最贴近的注册例子：`widgets-dock.tsx:1711-1737` 的 `Keymap.createLayer(() => ({ mode:"global", enabled: overflow && pageOwns(), bindings:["session.dock.scroll.up","session.dock.scroll.down"] }))`；键位 id 定义在 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/config/keybind.ts:200-201`
- 另一个 global+capture:"main"+priority:1 的例子：`pane-focus.tsx:151-181`

---

## 对用户需求的含义

**tab 化最小改法**：在 `WidgetsDock` 内新增一个模块级信号（仿 `mergedDockCursor`）表示 `main`/`todo`；`mergedTitleText()` 附近拼出两个可点击的 tab 文本节点，各挂 `onMouseUp` 切换信号；现有整块 box 内容改为条件渲染——tab1 保持 `mergedLineView(frameLines())` 原样，tab2 渲染 todo 详细内容（复用 `todoTreeLines`/`latestTodos(props.rows)`，纯函数已存在，见 `widgets-dock.tsx:620`、`merged-dock.ts:620`）。data 层完全不用动，zone 宽度律仍由 `fitLine` 保证。

**鼠标点击可行性**：高。滚轮已在同一个 box 上跑通，全项目有几十处 `onMouseUp` 先例，终端鼠标由 config.mouse 开启。唯一注意点：app 设了 `autoFocus:false`，不要指望 renderer 自动把焦点转给被点组件，要用显式 `onMouseUp` 处理器；tab 文本节点需保证可命中的宽度/高度。

**粗体/浅色切换实现**：现有机制已覆盖 90%——复用 `surfaceBorder({focused})`（`skin/semantic.ts:69`）：聚焦 `borderStyle="heavy"` + `focusedBorderColor`，非聚焦 `single` + `unfocusedBorderColor`，把 activity 的常量 `borderStyle="heavy"`/`activityFrameBorderColor` 换成该函数的输出即可。标题文字的粗体不能通过 box 属性设置（opentui Box 无 `titleAttributes`），需要两条路之一：(a) 保留 box `title` 但只切 `titleColor`（聚焦 accent、非聚焦 `text.faint`，照抄 `transcriptFrame` 在 `skin/semantic.ts:180-186` 的做法）；(b) 若必须粗体，把标题改为 box 内的 `<text attributes={TextAttributes.BOLD|undefined}>` 自定义渲染——但这会破坏现有精确定宽的 title slot（标题槽宽 = 终端宽-4，见 `widgets-dock.tsx:1654-1667`），改动面更大。改动时避免重新引入 `clipToWidth` 二次裁剪右边框的问题。

**时间盒**：调查在 30 分钟内完成，未修改任何源文件。
