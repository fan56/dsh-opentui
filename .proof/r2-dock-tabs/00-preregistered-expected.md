# R2 activity 面板 tab 化 — 预注册 expected（write-once，capture 后正文未改）

- 切片：UI batch 2026-11-23 / R2（定案 `research/2026-11-23-ui-batch/00-decisions.md:8-11`；事实 `research/2026-11-23-ui-batch/02-dock-tabs-mouse-border-facts.md`）。
- 工作树：`/Users/qingguee/repo/dsh-opentui-wt-uibatch-1123`，分支 `feat/ui-batch-1123`（HEAD 捕获前 `c79071a`）。
- 证据目录：`.proof/r2-dock-tabs/`（本文件唯一入库断言文件；`.log` 为 gitignored 采集物）。
- 成文方式：本节一次性成文（非逐节顺写），时间戳记整体成文时刻；不冒充逐节顺写。
- 成文时刻：2026-11-23T01:40:46Z。
- CapIR 方法集/wired 面/宿主版本：本切片为纯展示层改造，无 CapIR 方法增删、无宿主版本依赖；不引入 present=true 类运行时状态断言（W5 §四.2 翻车条款）。

## expected 表（E1–E5，FROZEN）

| id | assertion | expected (FROZEN) | pass criterion（机器可判、环境无关） | changed path | level | evidence file | depends on |
|---|---|---|---|---|---|---|---|
| E1 | 默认 tab 状态 | 模块级信号 `activityDockTab()` 默认 `"main"` | 新测试直接断言 `activityDockTab() === "main"`（首次 import 后、任何切换前）；`resetActivityDockTab()` 把它复位到 `"main"` | `packages/tui-base/src/routes/session/widgets-dock.tsx` | unit | `05-r2-dock-tabs.test.log` | — |
| E2 | main tab 渲染原样 | main tab 的渲染入口与现有合并显示同一函数 `mergedFrame()`/`frameLines()` | 新测试断言：信号=`"main"` 时活动面板内容行由 `mergedDockLines` 产出；`merged-dock.ts` 的 `mergedDockLines`/`fitAll`/`fitLine` 源码文本未被本切片改动（以 diff 范围为准） | `widgets-dock.tsx`；`merged-dock.ts` 不改 | unit + diff | `05-r2-dock-tabs.test.log`、`01-diff-scope.log` | E1 |
| E3 | 切到 todo tab（鼠标 + Alt+2） | 鼠标 onMouseUp 点 todo tab 文本、键盘命令 `session.dock.tab.todo`（绑定 `alt+2`）都调用 `setActivityDockTab("todo")`；todo tab 行来自 `todoTreeLines`/`latestTodos(props.rows)` 且经 `fitLine`/`takeWidth` 定宽 | 新测试断言：`selectActivityDockTab("todo")` 后信号=`"todo"`；`todoTabLines(rows, W)` 返回的每行 `lineWidth === W`（grapheme-safe），且包含 todo 内容文本；`onDockTabMouseUp("todo", 左键事件)` 切换成功；`keybind.ts` 中 `session.dock.tab.todo` 绑定 `alt+2` | `widgets-dock.tsx`、`config/keybind.ts` | unit | `05-r2-dock-tabs.test.log` | E1 |
| E4 | 切回 main（Alt+1） | 键盘命令 `session.dock.tab.main`（绑定 `alt+1`）调用 `setActivityDockTab("main")`；切回后内容恢复 `mergedFrame()` 行 | 新测试断言：`selectActivityDockTab("main")` 后信号=`"main"`；`session.dock.tab.main` 绑定 `alt+1`；切回后 `mainTabLines` 与 E2 同行 | `widgets-dock.tsx`、`config/keybind.ts` | unit | `05-r2-dock-tabs.test.log` | E3 |
| E5 | todo 为空时 tab2 表现 | `latestTodos(rows)` 为空或全 completed → `todoTabLines` 返回 `[]`（tab2 为空白内容区，不报错、不产生裁剪行） | 新测试断言：空 rows 与全 completed rows 两种输入下 `todoTabLines(rows, W).length === 0`；不抛异常 | `widgets-dock.tsx` | unit | `05-r2-dock-tabs.test.log` | E3 |

## 门禁预期

- `bun test packages/tui-base/test/<new-r2-file>.test.ts` 全绿（E1–E5）。
- `bun test packages/tui-base/test/widgets-dock.test.ts packages/tui-base/test/merged-dock.test.ts` 全绿（回归）。
- `bun run typecheck:entry`（tui-base）无错误。
- git diff 范围仅含：`widgets-dock.tsx`、`config/keybind.ts`、`packages/i18n/locales/{en,zh-CN}.json`（仅 tab 标签键插入）、新测试文件、`.proof/r2-dock-tabs/`；不含 `dock-visibility.ts`、R3/R4 拥有的文件。

## USER-JUDGMENT 预案（≤5 项，记录 + 推荐默认，不进技术门禁）

1. tab 条样式（active 强调色/字形 vs 纯文本）：真机看；默认沿用 merged title 的语义色，active tab 用 accent，非 active 用 muted。
2. tab 命中手感（命中区宽度/高度）：真机看；默认每个 tab 命中区 ≥ 8 列宽、整行高，左键点击切换。
3. tab 标签中英文案（`1 main`/`2 todo` vs `1 主面板`/`2 待办`）：真机看；默认按 locale 键走既有 `t()`。

## NOT RUN 声明

- 真机 tmux 抓帧（`.ans`）由主 agent 做；本切片不采集视觉帧，JUDGMENT 项留待真机裁决。
- Alt+1/Alt+2 的真实终端 passthrough 由真机验；单测只覆盖绑定 id→run 的纯映射。

## 措辞与强度

- 措辞强度：单测断言"每个 tab 行 lineWidth===W"只证明定宽，不声称视觉对齐；"default==main"只证明信号初值。
- criterion 全部机器可判、无环境依赖子句（无 present=true、无宿主版本/配置文件存在性断言）。
