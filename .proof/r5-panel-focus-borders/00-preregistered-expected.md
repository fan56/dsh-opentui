# R5 面板边框粗/细 + 焦点 — 预注册 expected（write-once，capture 后正文未改）

- 切片：UI batch 2026-11-23 / R5（定案 `research/2026-11-23-ui-batch/00-decisions.md:24-28`；执行任务书；事实 `research/2026-11-23-ui-batch/02-dock-tabs-mouse-border-facts.md:30-48`）。
- 工作树：`/Users/qingguee/repo/dsh-opentui-wt-uibatch-1123`，分支 `feat/ui-batch-1123`（HEAD 捕获前 `19cfc12`）。
- 证据目录：`.proof/r5-panel-focus-borders/`（本文件唯一入库断言文件；`.log` 为 gitignored 采集物）。
- 成文方式：本节一次性成文（非逐节顺写），时间戳记整体成文时刻；不冒充逐节顺写。
- 成文时刻：2026-11-23T02:00:00Z。
- CapIR 方法集/wired 面/宿主版本：本切片为纯展示层 + 模块级信号改造，无 CapIR 方法增删、无宿主版本依赖；不引入 `present=true` 类运行时状态断言（W5 §四.2 翻车条款）。
- 环境依赖子句禁令：下列 criterion 全部机器可判、环境无关——不依赖宿主版本、配置文件存在性、真机帧、tmux、终端尺寸实测，也不以「整体曾绿」替代逐项断言。

## 常驻框枚举（实现时枚举的实际结果，FROZEN）

| 面板 | 源码位置 | 当前是否常驻带框 | R5 处理 |
|---|---|---|---|
| activity（含 R2 tab 条） | `routes/session/widgets-dock.tsx` framed box | 是（`borderStyle="heavy"` 常量，turn 期间恒亮） | 改为 active-panel 信号驱动 |
| composer | `routes/session/session-composer.tsx` root box | 是（`surfaceBorder` 已按 pane focus 驱动） | 叠加 active-panel 门控 + 点击/打字回迁 |
| transcript | `routes/session/transcript.tsx` frame box | 是（`transcriptFrame` 已按 pane focus 驱动） | 不动（已聚焦驱动；不在 R5 定案枚举内） |
| lastrequest dock | `routes/session/lastrequest-dock.tsx` slot | **否**（只有 `paddingLeft=1` 的无框 slot，无 `border`/`borderStyle`） | 无框可驱动，不新增框（宽度/高度律不动）；接线点击设 active |
| notices dock | `routes/session/notices-dock.tsx` slot | **否**（同上） | 同上 |
| 弹窗（dialog） | `ui/dialog.tsx` | 是，但瞬态 | 永远激活态，恒 heavy，不参与信号（保持原样） |
| transcript 内用户消息框 | `transcript.tsx` `userBorder` | 是，但属滚动内容 | 无焦点语义，不参与（保持原样） |

## expected 表（E1–E9，FROZEN）

| id | assertion | expected (FROZEN) | pass criterion（机器可判、环境无关） | changed path | level | evidence file | depends on |
|---|---|---|---|---|---|---|---|
| E1 | 默认 active panel | 模块级信号 `activePanel()` 默认 `"composer"` | 新测试首次 import 后断言 `activePanel() === "composer"`；`resetActivePanel()` 复位到 `"composer"` | `routes/session/pane-focus.tsx` | unit | `05-r5-panel-focus-borders.test.log` | — |
| E2 | 聚焦/非聚焦边框映射 | 聚焦=`borderStyle:"heavy"` + `focusedBorderColor`；非聚焦=`"single"` + `unfocusedBorderColor`；标题色跟随边框色 | 纯函数断言：`panelFocusFrame({focused:true})` 得 heavy + 主题 interactive 色；`{focused:false}` 得 single + 主题 border 色；`titleColor` 等于各自 borderColor；无主题时等于 `SKIN_FALLBACK` 对应值 | `skin/semantic.ts` | unit | `05-r5-panel-focus-borders.test.log` | E1 |
| E3 | 点击 activity 迁移 active | activity 框左键 `onMouseUp` 把 active 设为 `"activity"`；其后 activity 边框 heavy、composer 边框 single | 新测试断言：`activityPanelClick()` 后 `activePanel() === "activity"`；非左键不改；断言两张框各自 `panelFocusFrame({focused: activePanel()==="activity"})` / `==="composer"` 的样式 | `widgets-dock.tsx`、`pane-focus.tsx` | unit | 同上 | E1,E2 |
| E4 | 打字回迁 composer | composer 的 `onKeyDown` 与 `onContentChange` 都把 active 设回 `"composer"` | 新测试断言：`composerKeyActivity()` / `composerTextActivity()` 调用后 `activePanel() === "composer"`；调用后再断言 composer 框 heavy | `session-composer.tsx`、`pane-focus.tsx` | unit | 同上 | E3 |
| E5 | tab 键盘切换设 activity 为 active | `selectActivityDockTab("main"|"todo")`（alt+1/2 与鼠标共用的 selectors）把 active 设为 `"activity"` | 新测试断言：两个入参各调用一次后 `activePanel() === "activity"` 且 `activityDockTab()` 同步为目标值；`resetActivityDockTab()` 不改 active | `widgets-dock.tsx` | unit | 同上 | E3 |
| E6 | 弹窗恒 heavy 不受信号影响 | dialog 的 `borderStyle="heavy"` 常量与 `focusedBorderColor` 用法不被本切片改动 | diff 断言：`ui/dialog.tsx` 不在改动文件清单；新测试断言 active 信号从 composer→activity 再→composer 的每次迁移都不写 dialog 模块状态（以 `panelFocusFrame` 对 dialog 不产生调用为准） | `ui/dialog.tsx` 不改 | unit + diff | 同上、diff 日志 | E1 |
| E7 | 非聚焦可见（提亮一档） | 有主题时 `unfocusedBorderColor` 在 `border.base` 太暗时向 `text.muted` 提亮，仍为可辨识色；无主题时保持 `SKIN_FALLBACK.border` | 新测试断言：真实 dsh-blue dark 主题下返回值与裸 `border.base` 不同、且亮度分量提高；stub 主题缺 `text.muted` 时原样返回（回归兼容）；`SKIN_FALLBACK.border` 不变 | `skin/semantic.ts` | unit | 同上 | E2 |
| E8 | 宽度律不动 | `fitLine`/`takeWidth` 逻辑与每行宽度不因本切片改变 | diff 断言：`merged-dock.ts` 不改；本切片不引入 `clipToWidth` 新调用；既有 R2 定宽测试全绿 | `merged-dock.ts` 不改 | diff + unit | diff 日志、R2 测试日志 | — |
| E9 | 验证闭环 | 新测试全绿 + 受影响包测试无新增失败 + `typecheck:entry` 无错误 | 命令输出逐项记录；若他方拥有的测试因 focus 改 heavy→single 出现断言失败，逐条列出失败名与所属文件，作为跨 owner 协调项，不静默跳过 | 多文件 | unit + typecheck | `05-r5-panel-focus-borders.test.log`、`06-typecheck.log` | E1–E8 |

## 门禁预期

- `bun test packages/tui-base/test/r5-panel-focus-borders.test.ts` 全绿（E1–E7）。
- `bun test packages/tui-base/test/pane-focus.test.ts packages/tui-base/test/skin-semantic.test.ts packages/tui-base/test/widgets-dock-tabs-r2.test.ts` 全绿（回归）。
- `bun test packages/tui-base/test/widgets-dock-render.test.ts packages/tui-base/test/widgets-dock.test.ts` 结果如实记录（这两文件由 R2 owner 拥有；本切片不改，若因 heavy→single 失败则登记为跨 owner 协调项）。
- `bun run typecheck:entry`（tui-base）无错误。
- git diff 范围仅含：`pane-focus.tsx`、`skin/semantic.ts`、`widgets-dock.tsx`、`session-composer.tsx`、`lastrequest-dock.tsx`、`notices-dock.tsx`、新测试文件、`.proof/r5-panel-focus-borders/`；不含 `ui/dialog.tsx`、`merged-dock.ts`、B4/R1 拥有文件。

## USER-JUDGMENT 预案（≤5 项，记录 + 推荐默认，不进技术门禁）

1. 聚焦观感：heavy + 亮色 vs 非聚焦 single + muted 的对比强度——真机看；推荐默认=`surfaceBorder` 单一来源（聚焦 interactive 500，非聚焦提亮后的 border.base）。
2. 非聚焦亮度：dsh-blue dark `border.base` 原值 `rgba(0.23,0.25,0.36)` 太暗，提亮一档向 `text.muted` 混合（系数 0.5，量测后回填实际值）——记录，不阻塞。
3. 标题只换色不做粗体（用户拍板方案 3，Box 无 `titleAttributes`）——沿用；tab 条随整条 title 换色。
4. activity 聚焦色沿用通用 `focusedBorderColor`（interactive 500）而非旧的「恒亮蓝」专用色——记录视觉差异；旧纯函数保留供既有测试 pin。
5. lastrequest/notices 实际无边框（见枚举表），本切片不新增框，只接点击设 active——真机若确认需要框，下一刀单独评估布局预算。

## NOT RUN 声明

- 真机 tmux 抓帧（`.ans`）由主 agent 做；本切片不采集视觉帧，JUDGMENT 项留待真机裁决。
- 真实终端的鼠标点击 / alt+1/2 passthrough 由真机验；单测覆盖信号的纯迁移与 selectors 调用路径。

## 措辞与强度

- 单测断言「样式映射正确」只证明纯函数输出，不声称视觉对齐/观感合格。
- 「点击设 active」只证明处理器调用信号，不声称终端鼠标事件已真机验证。
- 跨 owner 测试失败按实际失败名登记，不以「整体曾绿」概括。
