# `/agents` 命令现状与 panel-kit 适配方案

- 调查对象：`dsh-opentui` worktree（HEAD `148654a`，`packages/panel-kit` 为未跟踪新包）
- 方法：只读代码走查 + 现有测试/验证脚本清单；未运行任何构建、安装、客户端
- 结论口径：每条断言带 `file:line`；查不到的直接写「未找到」，不做推断

---

## 0. 结论速览

1. `/agents` **存在且是完整功能**：命令注册在 `coreCommands()`（`packages/tui-base/src/routes/session/commands.ts:379,754-767`），面板 `AgentsPanel` 1229 行，含 table / fields / limits / limitEdit / picker / effort / deep / viewer 八层（`packages/tui-base/src/routes/session/agents-panel.tsx:103-111`）。
2. 渲染层是 **ad-hoc 自绘面板**，不是 panel-kit，也不是直接复用 tui-pi 组件：所有内容先被拍平成 `PanelLine[]` 字符串数组，再由一个 `border={["left"]}` 的内联 dock box 逐行画（`agents-panel.tsx:1085-1144`、`1162-1227`）。语义照 tui-pi，代码是 opentui 自写。
3. 数据面是 **client-local 文件系统**，不是 host registry RPC：读 `<$DSH_HOME>/agents/*.md`，写 frontmatter 或 workspace pin 的 profile 覆盖（`packages/shell/src/client/remote-host-session.ts:1498-1531`、`packages/shell/src/client/remote-local-fs.ts:162-190,277-320`、`packages/shell/src/client/remote-agent-profiles.ts:322-342`）。审计文档明确记录 host 侧无 agents CRUD（`docs/client-mode-protocol-audit.md:87,106-109`）。
4. 与 `/settings` 是**同一套手写骨架的疑似复制**：模块级 open signal + `Keymap` priority 2 + `lines()` 字符串渲染 + focus-catcher input + close summary（settings 侧 `packages/tui-base/src/routes/session/settings-panel.tsx:877-900,1276-1315,1320,1369-1395`）。两者适合共用一个 PanelStack/导航骨架。
5. panel-kit 能覆盖面板壳、栈、确认框、数字/文本输入、下拉；**硬缺口有 5 个**：多列行（`cells/columns` 只在契约里、实现里没有）、列表窗口/分页、字母热键路由（只认 7 个保留键）、tui-base 主题到 `PanelTheme` 的投影、`PanelBody/PanelTitle/PanelActions` 三个壳组件只有类型没有实现（`packages/panel-kit/src/contracts.ts:186-192,371-404,426-447`，`packages/panel-kit/src/controls/list.tsx:358-503`，`packages/panel-kit/src/panel.tsx:52`，`packages/panel-kit/src/kit.tsx:37-45`，`packages/panel-kit/src/index.ts:13-117`）。
6. 另一个必须先拍板的点：panel-kit 的 `Panel` 是**全屏模态**（absolute + scrim + zIndex 3000，`packages/panel-kit/src/panel.tsx:241-256`），而 `/agents` 今天是**内联 dock 行**（`flexShrink={0} width="100%"`，`agents-panel.tsx:1163-1174`）。迁移等于改变交互形态，不是纯重构。

---

## §1 是否存在 + 现状

### 1.1 注册链（命令 → host → 入口 → 挂载）

| 环节 | 证据 |
| --- | --- |
| 命令表 | `coreCommands()` 返回数组，`/agents` 是其中一项：`packages/tui-base/src/routes/session/commands.ts:379`、`754-767` |
| 降级语义 | `!ctx.seam.agents` → `"/agents unavailable in this session"`；`!ctx.openAgents` → `"/agents: the manager panel is not mounted in this entry"`（`commands.ts:757-767`） |
| ctx 钩子声明 | `openAgents?(name?: string): void`（`commands.ts:198`） |
| slash host 默认命令源 | `createSlashHost()` 的 `fallbackCommands = coreCommands()`（`packages/tui-base/src/routes/session/slash-palette.tsx:406-409`） |
| deps 透传类型 | `SlashHostDeps.openAgents`（`slash-palette.tsx:392`） |
| 入口必须提供的钩子清单 | `ENTRY_SLASH_HOOKS` 含 `"openAgents"`（`packages/tui-base/src/routes/session/slash-deps.ts:40-51`），`buildSlashDeps` 强制装配（同文件 `92-110`），`carrySlashHooks` 防「声明了但没进 ctx」的历史事故（`112-122`） |
| 真实入口装配 | `openAgents: (name?: string) => openAgentsPanel(name)`（`packages/tui-base/examples/v2-entry.tsx:649`） |
| 组件挂载 | `createComponent(AgentsPanel, { get seam() {...}, onClosed })`（`v2-entry.tsx:764-773`） |
| 客户端进入该入口 | `client-entry.tsx` 运行时 import `tui-base/examples/v2-entry.tsx`（`packages/shell/src/client-entry.tsx:335-336`） |
| 面板独占屏幕的旁路信号 | `agentsPanelOpen` 被会话 sidebar 的 priority-10 Esc 层读取以让位（`packages/tui-base/src/routes/session/index.tsx:75,277-284`） |

历史事故背景（说明这条链为何被强类型化）：`examples/v2-entry.tsx` 曾有 `@ts-nocheck`，`openAgents` 在 deps→ctx 手工展开时丢失，`/agents` 在真机上报 "manager panel is not mounted"（`slash-deps.ts:1-26`、`docs/verification-gates.md:68-73`）。

### 1.2 渲染层：ad-hoc 面板，八个层级

- 层级枚举：`PanelLevel = "table" | "fields" | "limits" | "limitEdit" | "picker" | "effort" | "deep" | "viewer"`（`agents-panel.tsx:103-111`）。
- 空语料落地层：`initialAgentLevel()` 在 0 行时直接进 `limits`（`agents-panel.tsx:113-120`）。
- 每层都是纯函数产 `PanelLine[]`：
  - table：`agentTableLines` + `agentTableWidths`（`agents-panel.tsx:145-206`）
  - fields：`agentFieldLines`（`240-275`）
  - limits：`agentLimitsRows` / `agentLimitsLines`（`299-320,350-388`）
  - viewer：`agentViewerLines`（`391-406`）
  - model picker 两段式：`agentPickerLines` / `agentEffortLines`（`414-432,438-463`）
- 渲染：`<Show when={open()}>` → 一个 `border={["left"]}`、`backgroundColor={theme?.background.raised.base}` 的**内联盒子**，`<For each={lines()}>` 逐行 `<text>`；`totalLines()+1` 定高（`agents-panel.tsx:1160-1187`）。
- 焦点兜底层：非编辑层挂一个 `width={1}` 的 `input` 当 catcher，防止可打印键漏进 composer；deep/limitEdit 层换成真输入框（`agents-panel.tsx:1188-1225`）。
- 光标窗口固定 12 行（`MAX_VISIBLE = 12`，`agents-panel.tsx:54,179-180`）。

### 1.3 打开 / 关闭 / 刷新

- 打开桥：模块级 `bridgeOpen`，`openAgentsPanel(name?)` 只写桥；组件内 `createEffect` 消费桥 → `reloadRows()` → 定层 → 预选 → `setOpen(true)`（`agents-panel.tsx:73-84,617-634`）。
- 预选只匹配精确 `name`，不匹配 displayName（`preselectAgentIndex`，`agents-panel.tsx:491-494`）。
- 每次成功写后重读语料（无 render 期 I/O）：`reloadRows()` 在 `586-601`，调用点 `722,748,815,863,905`。
- 关闭：`Esc`（table 层）→ `close()` 计算 `agentsSummary(changed)` → 复位 state → `setTimeout(...,3)` 调 `onClosed`（`agents-panel.tsx:607-615`）。
- 从 limits 的官方 cap 跳 `/settings`：`close()` 后 `openSettingsPanel("subagent.<key>")`（`agents-panel.tsx:324-326,693-696`）。
- 卸载复位 open 信号，防止 sidebar Esc 永久失效（`agents-panel.tsx:86-94`）。

### 1.4 键位（全局 priority 2，dialog 栈非空时关闭）

`Keymap.createLayer` 定义在 `agents-panel.tsx:932-1061`：

| 键 | 层级 | 行为 | 证据 |
| --- | --- | --- | --- |
| `esc` | 全部 | 逐层回退；table 关闭；空语料 limits 直接关闭 | `937-957` |
| `up` / `down` | 光标层 | 移动光标 | `959-970` |
| `pageup` / `pagedown` | table/picker/effort/limits | 移动 `MAX_VISIBLE` | `971-982`、`1063-1083` |
| `return` | 全部 | table→fields；fields→按字段进 model/think/deep；picker/effort/limits/deep/limitEdit 提交 | `983-1016` |
| `m` | fields | 模型两段式选择 | `1017-1024` |
| `t` | fields | think 档位 | `1025-1032` |
| `d` | fields / limits | deep 编辑器 / background 切换 | `1033-1042` |
| `v` | fields | 查看 system prompt body | `1043-1050` |
| `l` | table | 进入 limits | `1051-1059` |

### 1.5 opentui 命令面里的等价能力（子代理列表 / 切换）

`/agents` **不是**「子代理列表 / 切换器」，它是**agent 定义（markdown 语料）管理器**。真正的 live 子代理列表是另一条独立路径：

| 能力 | 现状 | 证据 |
| --- | --- | --- |
| 运行中子代理 roster / 选中 / steer | 单行 picker：`Subagents ▸ <label> · Running · i/n · ↑↓ select · enter steer · ctrl+a show inactive · esc`；`↓` 仅在存在 running child 时打开；running 清空后自动关闭 | `packages/tui-base/src/routes/session/subagents-picker.tsx:41-56,136-152,173-191,225-234` |
| 数据来源 | `seam.subagentViews()` / `onSubagentViews()`（`packages/tui-base/src/seams/session.ts:616-619`；adapter `packages/shell/src/client/session-seam-adapter.ts:593-601`）；远端聚合自 `session/list` 的 `parentSessionId` + `origin:'subagent'` 与 `api-session/added|removed`，steer 走 `subagents/prompt` | `packages/shell/src/client/remote-subagents.ts:1-32` |
| agent preset 切换（"换一个 agent 组合"） | `/preset`（bare 打开 picker，`next` 轮转）；`currentId` 来自 `session/projections` 的 `agentPreset` | `commands.ts:999-1058`、`session.ts:553-565`、`session-seam-adapter.ts:458-470` |
| agent 定义管理 | `/agents`（本文主体） | 见 §1.1 |

结论：命令面**不缺**「看子代理 / steer / 切 preset」，缺的是把 `/agents` 从「文件编辑器」升级为「带状态、可分组的 agent 总览」——这属于产品增强，不是补缺失能力。

### 1.6 未找到（明确记录）

- **未找到** `/agents` 的 host RPC（如 `agents/list|read|write`）。审计文档把该能力标为 `MISSING (write); PARTIAL read`，唯一远端读是 `GET /api/file?path=` 单文件（`docs/client-mode-protocol-audit.md:87`），并列入「需要 host 侧改动」（同文件 `210-212`）。
- **未找到** web profile 内的 `/agents` 界面实现。`~/.dsh/profiles/web/package.json` 的 bundles 为 `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`（本机 profile 文件，只读核对），仓库内审计同样只列 host 读能力，没有 web 端 agent 管理页；`~/.dsh/profiles/web/node_modules` 未落 `@deepseek-ai/*`（由全局 `dsh` 安装解析），本轮未越界读取全局安装目录，故「web 前端是否有隐藏入口」保持未验证。
- **未找到** "current agent"（当前正在使用的 agent 定义）概念。见 §2.5。

---

## §2 数据面与写通道

### 2.1 读路径（agent 定义语料）

```
AgentsPanel props.seam.agents
  → SessionSeamAdapter.agents.list()            session-seam-adapter.ts:479-481
  → RemoteHostSession.listAgents()              remote-host-session.ts:1498-1501
  → listComposedAgents(dshHome, workspaceDir)   remote-agent-profiles.ts:226-247
  → listAgentFiles(home)                        remote-local-fs.ts:162-190
  → <$DSH_HOME>/agents/*.md（顶层，仅 .md）
```

- seam 契约：`agents?: { list, dir?, set, body, modelEfforts, officialCaps? }`（`packages/tui-base/src/seams/session.ts:567-586`）；行结构 `SeamAgentRow`（`291-312`）。
- 解析规则：frontmatter + body；`name` 必须等于文件名 stem，否则标 broken；broken 行**返回但不抛**，由面板单独计数（`remote-local-fs.ts:162-190`、`agents-panel.tsx:586-601`）。
- 排序：valid 按 `localeCompare`，broken 追加在后（`remote-local-fs.ts:193-195`）。
- 组合值：`effective = frontmatter 基线 (+) pin 到的 profile.agents[name]`；pin 是工作区向上最近的 `.dsh-profile`（`remote-agent-profiles.ts:1-19,29,210-224`）。
- 注意：`model-profiles.json` 的 `current` **不参与**该路径，它只驱动 opentui agent loop 的默认 route（`remote-agent-profiles.ts:13-15` 注释）。

### 2.2 写通道（唯一写点）

```
AgentsPanel seam.set(name, field, value)
  → SessionSeamAdapter.agents.set()             session-seam-adapter.ts:479-494
  → RemoteHostSession.agentSet()                remote-host-session.ts:1514-1526
      ├─ deep | maxRounds | background → setAgentField()      remote-local-fs.ts:277-320
      │      → updateAgentFrontmatter()                       remote-local-fs.ts:200-270
      └─ model | thinking → commitAgentModelEdit()            remote-agent-profiles.ts:322-342
             ├─ pin 解析成功 → saveProfileAgentOverrides()     remote-agent-profiles.ts:250-318
             └─ 否则        → updateAgentFrontmatter()
```

- 写目标语义：`model/thinking` 落在 pinned profile 的 `agents[name]`；`deep/maxRounds/background` **永远**落 frontmatter（`remote-host-session.ts:1507-1513` 注释、`1519-1525`）。
- `null` = 删 key（inherit）；`maxRounds` 正整数字面校验，0 会让消费侧判 broken（`remote-local-fs.ts:277-318`、`agents-panel.tsx:479-487`）。
- 原子性：profile 覆盖写走 tmp+rename（`remote-agent-profiles.ts:296-317`）；frontmatter 原地改写，保留注释/未知字段/CRLF，无变更不写（`remote-local-fs.ts:200-270`）。
- 面板侧不乐观更新：每次写后重读（`agents-panel.tsx:722,748,815,863,905`）。

### 2.3 辅助读

| 数据 | 来源 | 证据 |
| --- | --- | --- |
| system prompt body | `agentBody(name)` → 再读同一语料 | `remote-host-session.ts:1555-1559` |
| 官方 subagent caps | `settingsDescribe()` 的 `subagent` namespace：`maxActiveSubagents` / `maxDepth`；读不到就 `n/a`，不猜默认 | `remote-host-session.ts:1533-1553`、`agents-panel.tsx:299-320` |
| think 档位阶梯 | `modelCatalog()` 的 `reasoning.efforts` | `remote-host-session.ts:1561-1566` |
| 语料目录 | `joinPath($DSH_HOME, "agents")` | `remote-host-session.ts:1503-1505` |

### 2.4 host / web 侧

- 语料的真正消费者是 host 侧插件 `@aiwayds/dsh-subagent-registry`（e2e 里通过 profile bundles 注入，`e2e/lib/bake-subagent-registry.mjs:1-14`）。opentui 与 host 共用同一个 `$DSH_HOME`（`packages/shell/src/client/remote-local-fs.ts:1-20` 的 ADR-0005 说明），所以 `/agents` 直接改文件即可影响下一次 spawn。
- opentui host profile 是从 web 模板克隆的：`research/tui-pi-model-switch-parity.md:35`（`provision-opentui-profile.mjs` 的 `TEMPLATE = 'web'`）。因此「web profile 怎么取数」在 current 架构里**没有独立实现**：web 不提供 agent 定义管理，host 也不暴露 CRUD RPC（`docs/client-mode-protocol-audit.md:87,210-212`）。

### 2.5 有没有「当前 agent」

- `/agents` 面板**没有** selection/current 概念：它只编辑定义，不发 dispatch（`agents-panel.tsx:552-1229` 全文无 current/selected agent 持久化，仅 `selectedName` 做面板内定位）。
- 最接近的两个概念：
  1. **agent preset**（会话级组合）：`preset.currentId()` + `select()`（`session.ts:553-565`、`session-seam-adapter.ts:458-470`），UI 在 `/preset`（`commands.ts:999-1058`）。
  2. **model-profiles 的 `current`**：驱动 agent loop 默认 route，与 pin/composition 无关（`remote-agent-profiles.ts:13-15`）。
- 旧 `mini/footer.ts` 里有 `selectedAgentID` / `currentAgent`（`packages/tui-base/src/mini/footer.ts:185-186,272-276`），但 mini 树**不在** client 入口的 import 图里（`v2-entry.tsx` 无 mini import；入口只加载 v2-entry，`packages/shell/src/client-entry.tsx:335-336`），属于 vendored demo，不可作为现状能力。

---

## §3 panel-kit 覆盖度与缺口

### 3.1 已有能力（`packages/panel-kit/src`）

| 能力 | 实现 | 证据 |
| --- | --- | --- |
| 面板壳：标题/副标题/scrim/边框/尺寸/对齐/淡入淡出/beforeClose | `Panel` | `panel.tsx:77-290`、`contracts.ts:248-291` |
| 栈：open/close/closeAll/confirm/maxDepth、逐层 scrim、只顶层收 Esc、焦点保存恢复 | `PanelStack` / `usePanels` | `stack.tsx:64-245`、`contracts.ts:334-357` |
| List：single/multi、分组行、模糊过滤、badge、description、宽度截断、空态、footer | `List` / `listReduce` / `buildListRows` | `controls/list.tsx:170-202,276-335,358-503` |
| 数字步进 / 文本输入 / 只读行 / 校验错误 | `InputRow` | `controls/input-row.tsx:1-120`、`contracts.ts:571-599` |
| 下拉（弹层，8 行窗口） | `Dropdown` | `controls/dropdown.tsx:1-60`、`tests/controls-b.test.tsx:315` |
| 确认框（destructive/tone/防双提交） | `ConfirmDialog` | `controls/confirm.tsx`、`test/controls-b.test.tsx:143-201` |
| Button / Check（含 indeterminate） | | `controls/button.tsx`、`controls/check.tsx`、`contracts.ts:473-508` |
| 列/行文本工具 | `fitColumns` / `fitRow` / `truncate` / `align` | `text.ts:67-100` |
| 宿主桥：Keymap modal 层 + focus takeover | `createHostKeyAdapter` | `kit.tsx:37-95` |
| 主题投影函数（tone→border、scrim alpha、fade） | | `theme.ts:1-60`+ |

README 已把 `/settings`、`/agents`、`/model` 写成目标消费方（`packages/panel-kit/README.md:3-4`），但**当前仓库内零处 import panel-kit**（`grep -r "panel-kit" packages/tui-base packages/shell` 无命中；tui-base `package.json` 依赖里也没有它）。

### 3.2 缺口（按对 `/agents` 的阻塞程度排序）

| # | 缺口 | 证据 | 对 `/agents` 的影响 |
| --- | --- | --- | --- |
| G1 | **多列行未实现**：`ListItem.cells` / `ListProps.columns` 只有契约，`list.tsx` 全文不读这两个字段 | `contracts.ts:426-427,446-447`（注释自认 v1.1「needed by /agents」）；`controls/list.tsx:358-503` 只有 label+badge+description | 阻塞 table 层的 `NAME │ MODEL │ DEEP │ DESCRIPTION`（`agents-panel.tsx:145-206`）。可先用 `fitColumns`（`text.ts:84-95`）+ 自定义行渲染绕过，但等于不用 List 的行渲染 |
| G2 | **列表无窗口/无分页**：List 全量渲染，只处理 up/down；`PanelBody.scroll` 只有类型声明，无实现，`panel.tsx` 无滚动容器 | `controls/list.tsx:388-418`；`contracts.ts:381-387`；`panel.tsx:268-283` | 今天靠 `MAX_VISIBLE=12` 切片（`agents-panel.tsx:54,179-180`）。agent 语料 >12 行时 panel-kit 会溢出，且没有 `pageup/pagedown` |
| G3 | **字母热键不可路由**：kit 只映射 7 个保留 id | `contracts.ts:186-192`、`panel.tsx:52`、`kit.tsx:37-45`（`PANEL_KEY_IDS`） | `m/t/d/v/l` 与 `pageup/pagedown`（`agents-panel.tsx:959-1059`）必须由消费方自建 Keymap 层，或扩 kit 契约（属于 API 变更） |
| G4 | **主题投影缺失**：`PanelTheme` 要求 RGBA 令牌树；tui-base 侧是可选、字符串色 | `contracts.ts:102-158`；`agents-panel.tsx:1146-1157`（`theme?.text.muted ?? "#565f89"`） | 迁移前必须写一个 `tui-base theme → PanelTheme` 的适配器；仓库内不存在（grep `PanelTheme|PanelKitProvider` 在 tui-base/shell 零命中） |
| G5 | **壳插槽只有类型**：`PanelTitleProps` / `PanelBodyProps` / `PanelActionsProps` 无组件实现，`index.ts` 不导出 | `contracts.ts:371-404`；`index.ts:13-117` | footer hint（`↑↓ navigate · Enter open · Esc back · l limits`，`agents-panel.tsx:200-205`）与动作行要自己用 `<text>` 拼 |
| G6 | **导航语义不同**：List 首尾循环；`/agents` 是 clamp | `controls/list.tsx:218-229` vs `agents-panel.tsx:1063-1083` | 迁移后键位手感变化，属于行为回归风险 |
| G7 | **状态/错误行无控件**：只有 `text`；tone 体系是消费方自造 | `agents-panel.tsx:96-101,1146-1158` | `✘ error` / `saved ...` / broken 提示要逐面板重写；panel-kit 无 banner/statusLine 抽象 |
| G8 | **分组无折叠**：`ListGroup` 只有表头 | `contracts.ts:417-420`、`list.tsx:194-200` | `/agents` 当前也无分组/折叠，暂不阻塞 |
| G9 | **多选无使用场景** | `list.tsx:322-335` | `/agents` 是单选游标，不算缺口 |

### 3.3 结论：迁移所需的控件映射

| `/agents` 现状 | panel-kit 对应 | 结论 |
| --- | --- | --- |
| table 层（4 列 + 游标 + 12 行窗口） | `List` + `columns/cells`（缺）或 `fitColumns` 自定义行 | **需要补 G1/G2**，或接受自定义 table 行 |
| fields 层（Field/Value 行 + `✎`） | `List` + `badge`/`description` | 可覆盖（单列表单） |
| limits 层（可编辑/只读混排 + 跳 /settings） | `List`（`disabled` + `onSelect`）+ `PanelStack.open` 或回调 | 可覆盖 |
| model picker 两段式（provider/model → effort） | `Dropdown`（单段）或 `List` + 栈内二次 open | 用 `PanelStack` 压两层更贴合现状；`Dropdown` 只有 8 行且无 provider/model 双列 |
| deep / maxRounds 编辑器 | `InputRow kind="number"` + `validate` | 可覆盖（注意 maxRounds 要求 ≥1，`agents-panel.tsx:479-487`；InputRow 的 `min`/`step` 可表达） |
| viewer（40 行 + `… N more`） | 无只读长文本控件；用 `PanelBody scroll`（缺）或 `text` 行 | **需要补滚动或保留手写行** |
| footer hint / 动作行 | `PanelActions`（缺实现） | 需补 G5 或自绘 |

---

## §4 实现步骤拆解（每步 ≤30 分钟）

> 前置约束：本轮**不改源码、不 install、不 commit**。步骤 1 之后的执行需要新授权。所有命令都在 `$HOME` 内、只读/测试性质。

| # | 步骤 | 改动文件（计划） | 验证命令 | 预估 |
| --- | --- | --- | --- | --- |
| 0 | 基线确认（本轮已完成）：记录现有测试与真机门禁 | 无 | `cd packages/tui-base && bun test test/agents-panel.test.ts test/agents-mount-entry.test.ts`；`cd packages/panel-kit && bun test && bun run typecheck` | 10m |
| 1 | 建立 panel-kit 依赖与主题桥（不接 UI）：workspace 依赖 + `PanelTheme` 投影 + `PanelKitProvider` 挂到 v2-entry 根 | `packages/tui-base/package.json`（新增 `@dsh-opentui/panel-kit`）、`packages/tui-base/src/routes/session/panel-theme.ts`（新）、`packages/tui-base/examples/v2-entry.tsx`（Provider 包裹） | `cd packages/tui-base && bun run typecheck`；`cd packages/panel-kit && bun test` | 30m |
| 2 | 抽语料控制器：把 `reloadRows/loadOfficialCaps/models/efforts` 从组件里抽成 `createAgentsModel(seam)`（纯逻辑，不改渲染） | `packages/tui-base/src/routes/session/agents-model.ts`（新）、`agents-panel.tsx`（仅改为调用） | `cd packages/tui-base && bun test test/agents-panel.test.ts` | 30m |
| 3 | 补 panel-kit 多列行（G1）：实现 `ListItem.cells` + `ListProps.columns`（fixed width/align），或新增 `Table` 控件；补最小单测 | `packages/panel-kit/src/controls/list.tsx`（或新 `table.tsx`）、`packages/panel-kit/src/index.ts`、`packages/panel-kit/test/controls-a.test.tsx` | `cd packages/panel-kit && bun test && bun run typecheck` | 30m |
| 4 | 补列表窗口/分页（G2）：`pageSize` + `pageup/pagedown` 语义（可选 `clamp` 模式），保游标可见 | `packages/panel-kit/src/controls/list.tsx`、`contracts.ts`（`ListProps.pageSize`、`wrap?: boolean`）、`packages/panel-kit/test/stack.test.tsx` 或新测试 | `cd packages/panel-kit && bun test` | 30m |
| 5 | 迁移 table 层到 panel-kit：`Panel` + 多列 List + 空态文案 + broken 提示；保留 `openAgentsPanel(name)` 预选语义 | `packages/tui-base/src/routes/session/agents-panel.tsx`（新增 panel 版实现，旧 pure 函数保留供测试） | `cd packages/tui-base && bun test test/agents-panel.test.ts test/agents-mount-entry.test.ts` | 30m |
| 6 | 迁移 fields / limits / viewer 到 `PanelStack` 子层：Enter 进、Esc 回退、`l` 进 limits、官方 cap 跳 `/settings` | 同上（`agents-panel.tsx`） | `cd packages/tui-base && bun test test/agents-panel.test.ts`；`node verify/agents-mount-repro.mjs`（需 tmux/真机前置） | 30m |
| 7 | 迁移 picker/effort/deep：`InputRow(number)` + 二层 picker；字母热键保持消费方 Keymap 层（G3 暂不扩契约） | `agents-panel.tsx`、必要的话 `panel-kit/src/kit.tsx` 文档注释 | 同步骤 6 + 手工核对 `m/t/d` | 30m |
| 8 | `/settings` 共用骨架抽取：`usePanelListNav`（cursor/filter/page/clamp）+ 统一 `openXPanel` 模块信号模式，两个面板同时接入 | `packages/tui-base/src/routes/session/settings-panel.tsx`、`agents-panel.tsx`、新 `panel-nav.ts` | `cd packages/tui-base && bun test test/agents-panel.test.ts`；settings 相关测试（`bun test -t settings`） | 30m |
| 9 | 真机门禁与几何矩阵：`/agents` 打开、空语料、写入回读、Esc 全链路 | 无源码改动（仅验证） | `node verify/agents-mount-repro.mjs`；`bash e2e/scenarios/72-agents.sh`（容器） | 30m |

依赖顺序：1 → 2 →（3、4 可并行）→ 5 → 6 → 7 → 8 → 9。

---

## §5 风险与需拍板项

### 5.1 必须由人拍板

| ID | 事项 | 选项 | 建议 |
| --- | --- | --- | --- |
| D1 | **panel-kit 依赖未连通**：`packages/panel-kit` 在 workspace（`pnpm-workspace.yaml:1-3`）且 lock 有 importer（`pnpm-lock.yaml:11`），但 `packages/tui-base/node_modules` 下**没有** `@dsh-opentui/panel-kit` 链接，tui-base `package.json` 也没声明 | (a) 加 workspace 依赖 + 允许执行 `pnpm install`；(b) 相对路径 `../../panel-kit/src` 导入（绕过包管理，不建议） | (a)；但本轮禁止 install，需单独授权 |
| D2 | **交互形态：内联 dock 还是全屏模态** | (a) 接受 panel-kit `Panel` 的全屏 scrim/zIndex 3000 模态；(b) 只复用 controls，保留现有内联 dock 壳 | 需要产品判断。若选 (b)，panel-kit 的 `Panel/PanelStack` 大部分价值用不上，收益下降 |
| D3 | **多列实现位置** | (a) 补 panel-kit `columns`（契约已预留，注释写明「needed by /agents」）；(b) 只在 `/agents` 内用 `fitColumns` 自绘行 | (a)，否则每个表格面板都要重复造轮子 |
| D4 | **字母热键路由** | (a) 扩 `PANEL_KEY_IDS`（契约变更，影响所有消费方）；(b) 保留消费方自建 Keymap 层（现状） | (b) 先做，(a) 留到第二个消费方出现 |
| D5 | **空语料落地层语义**：现在直接进 limits（`agents-panel.tsx:113-120`），迁移后是否保持 | 保持 / 改成 table 空态 | 保持，有真机门禁断言 |
| D6 | **是否补滚动**：viewer 40 行 + 长语料 | (a) 实现 `PanelBody scroll`；(b) 保持固定窗口 + 截断提示 | (a) 与 G2 一起做最省事 |

### 5.2 技术风险

1. **入口未被 tsc 覆盖**：`v2-entry.tsx` 是 `@ts-nocheck`（`slash-deps.ts:1-26`），挂载/依赖错误只能靠源码契约测试 `packages/tui-base/test/agents-mount-entry.test.ts:26-33` 抓。迁移必须同步更新该正则，否则回归无人拦。
2. **焦点/键位冲突**：现有 catcher input 机制（`agents-panel.tsx:1188-1225`）与 panel-kit 的 modal key 表（`panel.tsx:190-198`）是两套。迁移期必须确保同一时刻只有一套收键，否则可打印键会漏进 composer。
3. **写后重读的时序**：面板无乐观更新，全依赖 `reloadRows`（`agents-panel.tsx:595-605`）。panel-kit 下若把 rows 放进 List 的受控 state，要保证重读后游标不丢（`preselectAgentIndex` 语义，`491-494`）。
4. **主题降级**：tui-base 主题上下文是 optional（`useThemeOptional`），panel-kit 无 provider 时落到 `FALLBACK_THEME`（`packages/panel-kit/src/fallback.ts`）。迁移后如果投影失败，颜色会整体跳变，需在 80×24 与 120×34 两个几何都验。
5. **并行修改冲突**：当前 worktree 已有未提交改动（`packages/shell/src/client/remote-btw.ts`、`packages/tui-base/src/routes/session/btw-overlay.tsx`、`pnpm-lock.yaml`）且 `packages/panel-kit/` 本身未跟踪。动 `pnpm-lock.yaml` 前需确认这些改动的归属。

---

## §6 测试策略

### 6.1 分层矩阵（现有资产）

| 层 | 文件 | 覆盖内容 | 命令 |
| --- | --- | --- | --- |
| 纯函数单测 | `packages/tui-base/test/agents-panel.test.ts`（309 行） | table/fields/limits/viewer/picker 的行内容、窗口、空语料、broken、md 解析、deep/maxRounds 解析、打开态寿命 | `cd packages/tui-base && bun test test/agents-panel.test.ts` |
| 源码契约 | `packages/tui-base/test/agents-mount-entry.test.ts:26-33` | v2-entry 导入 `AgentsPanel`、`openAgentsPanel`、`openAgents` 透传 | 同上 |
| 依赖装配 | `packages/tui-base/src/routes/session/slash-deps.ts:40-51,92-122`（类型级） | 漏声明/漏传 hook 编译期失败 | `cd packages/tui-base && bun run typecheck` |
| shell 数据面 | `packages/shell/test/remote-agent-parity.test.ts` | frontmatter 宽松解析、组合行、pin 写入、单写点 | `cd packages/shell && bun test test/remote-agent-parity.test.ts` |
| shell 本地 FS | `packages/shell/test/remote-wave3-local.test.ts:38-105` | `listAgentFiles` / `agentSet` / broken / 缺失目录 | `cd packages/shell && bun test test/remote-wave3-local.test.ts` |
| shell 客户端入口 | `packages/shell/test/client-entry.test.ts:654-672` | wave-3 row 30：list + set 真文件写入 | `cd packages/shell && bun test test/client-entry.test.ts` |
| 真机（tmux） | `verify/agents-mount-repro.mjs` | 120×34 与 80×24 的面板打开、键位、行数、slash palette | `node verify/agents-mount-repro.mjs`（需 tmux/bun/全局 dsh/profile） |
| 真机包装 | `packages/shell/test/agents-mount-client.test.ts:43-58` | `DSH_AGENTS_E2E=1` 时转调上者 | `cd packages/shell && DSH_AGENTS_E2E=1 bun test test/agents-mount-client.test.ts` |
| 容器 e2e | `e2e/scenarios/72-agents.sh` | 空语料、table/fields/limits、写入回读 | `bash e2e/scenarios/72-agents.sh` |
| panel-kit 自身 | `packages/panel-kit/test/*.test.tsx` | List reduce/分组/过滤、Confirm、Dropdown 窗口、InputRow 数字校验、栈 Esc/焦点、集成 | `cd packages/panel-kit && bun test && bun run typecheck` |
| 几何/视觉 | `verify/ui-matrix.mjs`（`docs/testing.md:17,37`） | 5 个几何的数值断言 | `bun run test:ui`（需 tmux/env） |

### 6.2 迁移后必须新增的断言

1. **多列渲染**：`NAME/MODEL/DEEP/DESCRIPTION` 列宽与右侧对齐、宽字符截断（CJK 2 格），对应 G1。
2. **窗口/分页**：>12 行时游标可见、`pageup/pagedown` 步长与首尾 clamp（对照 `agents-panel.tsx:1063-1083`）。
3. **键位隔离**：面板打开时 `m/t/d/v/l` 不出现在 composer；dialog 打开时面板层让位（对照 `agents-panel.tsx:932-936` 的 gate）。
4. **写后重读**：`set` 成功后 rows 刷新、游标保持在原 agent、broken 计数更新。
5. **主题投影**：至少断言 `focused/selected` 与 `muted` 使用注入令牌，而非硬编码 fallback（消除 `agents-panel.tsx:1146-1157` 的 `?? "#..."`）。
6. **双几何**：80×24（compact，`Panel` 的 inset 从 3 降到 1，`panel.tsx:92`）与 120×34 都要能打开并完整显示 footer hint。

### 6.3 回归门禁建议

- 必跑（本地，无环境依赖）：步骤 0 的 4 条命令。
- 合入前必跑（有环境）：`node verify/agents-mount-repro.mjs` + `bash e2e/scenarios/72-agents.sh`。
- 禁止用 `bun test` 全量替代真机门禁：源码契约测试抓不到「入口没挂」这类事故（`docs/verification-gates.md:132` 明确记录该教训）。

---

## 附录：本轮复核命令（可直接重放）

```bash
cd ~/repo/dsh-opentui

# 1) 命令注册与入口挂载
grep -n 'name: "/agents"' -A 14 packages/tui-base/src/routes/session/commands.ts
grep -n 'openAgents' packages/tui-base/src/routes/session/slash-palette.tsx \
  packages/tui-base/src/routes/session/slash-deps.ts packages/tui-base/examples/v2-entry.tsx

# 2) 面板层级与键位
grep -n 'PanelLevel\|Keymap.createLayer\|MAX_VISIBLE\|PanelLine' \
  packages/tui-base/src/routes/session/agents-panel.tsx | head -30

# 3) 数据面
grep -n 'listAgents\|agentSet\|agentBody\|agentOfficialCaps\|modelEfforts' \
  packages/shell/src/client/remote-host-session.ts
sed -n '226,247p;322,342p' packages/shell/src/client/remote-agent-profiles.ts

# 4) panel-kit 缺口
grep -n 'cells\|columns' packages/panel-kit/src/contracts.ts
grep -n 'PANEL_KEY_IDS' packages/panel-kit/src/kit.tsx
grep -rn 'PanelBody\|PanelActions' packages/panel-kit/src

# 5) 是否已接入
grep -rn 'panel-kit' packages/tui-base/src packages/shell/src
```
