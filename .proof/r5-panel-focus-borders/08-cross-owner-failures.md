# R5 跨 owner 测试失败补录（E9 条款）

- 切片：UI batch 2026-11-23 / R5（`.proof/r5-panel-focus-borders/00-preregistered-expected.md` E9）。
- 工作树：`/Users/qingguee/repo/dsh-opentui-wt-uibatch-1123`，分支 `feat/ui-batch-1123`。
- 核对提交：`485f0e0`（`feat(skin): focus-driven panel borders with active-panel signal`，R5 引入提交）；修复提交 `5c7de0e`（`test(dock): pin active panel in border-glyph cases (R5 followup)`，R2 侧完成）。
- 成文时刻：2026-11-23。
- 性质：E9 预注册条款要求「若他方拥有的测试因 focus 改 heavy→single 出现断言失败，逐条列出失败名与所属文件……不静默跳过」。当时只报了 D10 一例（见 `07-isolated-render.log`，单测隔离运行只跑了 D10 一条），本文件为逐条补录，**不是新增失败**。

## 失败清单（7 条，全部位于同一文件）

所属文件：`packages/tui-base/test/widgets-dock-render.test.ts`（R2 owner，R5 切片不改此文件）。
运行方式：在该提交点以 `bun test test/widgets-dock-render.test.ts` 复现，结果 `9 pass, 7 fail, 1 skip (M1)`。下列名称与 bun test 输出的 `(fail)` 行逐字一致。

| # | 失败用例名（逐字） | 源文件位置 |
|---|---|---|
| 1 | `P2-4: captured growth frames start at \`from\`, never exceed target (real renderer)` | `packages/tui-base/test/widgets-dock-render.test.ts` |
| 2 | `P2-4: interrupted shrink retarget paints continuously (real renderer)` | `packages/tui-base/test/widgets-dock-render.test.ts` |
| 3 | `scene A: the 10-line frame is gear-inert; scene B: the gear drives think lines` | `packages/tui-base/test/widgets-dock-render.test.ts` |
| 4 | `scene A: \`all\` is a legacy 10-line spelling, never a growth rule` | `packages/tui-base/test/widgets-dock-render.test.ts` |
| 5 | `title shows N/M only on lower-zone overflow, right-aligned (D8/D13)` | `packages/tui-base/test/widgets-dock-render.test.ts` |
| 6 | `D10: lower zone survives turn end (turnActive false, no FlatDock fallback)` | `packages/tui-base/test/widgets-dock-render.test.ts` |
| 7 | `latch: think linger holds the frame after turn end; store drop withdraws it` | `packages/tui-base/test/widgets-dock-render.test.ts` |

## 归因

- 根因单一：R5 把 activity 面板边框从常量 `borderStyle="heavy"` 改为模块级 `activePanel()` 信号驱动，默认 active panel 为 `composer`（E1）。这些用例用 `dockContentLines()` 数 heavy `┃` 行、或直接断言 heavy `┏━┓` 标题字形；未显式把 activity 设为 active 时，activity 边框渲染为 single，断言收到单线字形而失败。
- 与 R2 自身标题回归的区别：`.proof/r2-dock-tabs/07-render-regression.log` 中 D8/D13、D10 的失败是 tab 条前缀 `1 main  2 todo ` 进入标题导致，已由 `9e3bab7`（`test(dock): title expectations include tab bar`）修复；本次 7 条是在标题期望已含 tab 条的前提下复现，纯由边框粗细驱动引入，两者不混。
- `07-isolated-render.log` 只隔离跑了 D10 一条，故当时 E9 只报一例；本补录以提交点全量实跑为准。

## 修复与验证

- `5c7de0e`（R2 侧）对上述 7 个用例逐一加 `markPanelActive("activity")`，并在 `afterEach` 加 `resetActivePanel()` 防止信号跨用例泄漏；修复仅改测试文件，不改 R5 实现。
- 修复后端点全量测试恢复绿；该提交为跨 owner 协调项（R5 引入、R2 侧固化），登记于此以满足 E9「逐条列出、不静默跳过」。
