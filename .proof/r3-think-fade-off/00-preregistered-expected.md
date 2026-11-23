# PREREGISTRATION — R3 关闭 think 渐隐（write-once，捕获前落盘，never edited after capture）

本文件在任何实现改动与证据捕获之前写入磁盘。它是 R3 的冻结 `expected` 预测值。
正文 capture 后未改；observed 与判定写入后续报告，禁止回改本文件 `expected`。

- Preregistered at (UTC): 2026-11-23T01:27Z
- Worktree / branch: `/Users/qingguee/repo/dsh-opentui-wt-uibatch-1123` @ `feat/ui-batch-1123`
- Pre-change HEAD: `fff0a3b5d10844669406669419f7cd8b64888d18`（clean）
- 授权来源: `research/2026-11-23-ui-batch/00-decisions.md` §R3（用户已拍板「2 秒停留后直接消失」，禁止动 `void dockSpin()`）
- 适用流程: W5 预注册 + W3 缺陷修复（用户已拍板，本刀为授权后修复刀）
- Evidence directory: `.proof/r3-think-fade-off/`
- 证据约定: `*.log` 为 gitignored 采集日志；唯一入库断言文件为本文件

## 变更面与不变量

- 变更: `packages/tui-base/src/routes/session/dock-visibility.ts` 的 `DOCK_FADE_OUT_MS` 由 300 改 0，常量旁加注释。
- 派生量: `DOCK_LINE_RETENTION_MS = DOCK_LINGER_MS + DOCK_FADE_OUT_MS` → 2000（无需单独改动常量定义，目标「2 秒后直接消失、无渐隐中间态」由派生自动达成）。
- 不动: `widgets-dock.tsx:950-952` 的 `void dockSpin()`（M1 响应式重绘点，事故修复）；`SKIN_FADE_IN_MS`（=400，独立常量）入场渐隐链路。
- 测试面: 断言渐隐中间帧的用例同步改；新增「`DOCK_FADE_OUT_MS=0` 时 `dockLineVisibility` 不含 fading」断言。

## 预注册 expected（E1–E5，机器可判、环境无关）

| id | assertion | expected（FROZEN，捕获前填） | pass criterion（checkable，禁环境依赖子句） | changed path | level | evidence file | depends on |
|----|-----------|------------------------------|--------------------------------------------|--------------|-------|---------------|------------|
| E1 | 渐隐关闭：可见性状态机不再进入 fading | `DOCK_FADE_OUT_MS === 0`；对 `stopAt` 固定、`elapsed ∈ [0, 3000]` 步进扫描、`decorated ∈ {true,false}`，`dockLineVisibility(...).phase` 取值集合 ⊆ `{live, lingering, hidden}` | 单测断言 `DOCK_FADE_OUT_MS === 0`，且扫描结果不含 `"fading"` | `packages/tui-base/src/routes/session/dock-visibility.ts:28` | Unit | `04-bun-test.log` | — |
| E2 | think 行时序：live→lingering→2000ms hidden | `stopAt === undefined` → `{phase:"live",progress:0}`；`elapsed=1999` → `{phase:"lingering",progress:0}`；`elapsed=2000` → `{phase:"hidden",progress:1}` | 单测对上述三元组 exact equality，并对 decorated 两档成立 | `dock-visibility.ts:70-80` | Unit | `04-bun-test.log` | E1 |
| E3 | 入场渐隐不受影响 | `SKIN_FADE_IN_MS === 400` 且不由 `DOCK_FADE_OUT_MS` 派生；`skinFadeInColor(target,bg,SKIN_FADE_IN_MS/2)` 为 target 与 faint 起点的中间色 | 单测断言常量值 400 与中点混色非端点色；源码中 `SKIN_FADE_IN_MS` 定义为字面量 400 | `packages/tui-base/src/routes/session/widgets-dock.tsx:123` | Unit | `04-bun-test.log` | — |
| E4 | retention 语义：行 2 秒后直接消失、无渐隐中间态 | `DOCK_LINE_RETENTION_MS === 2000`；`dockRemovalMs(true) === 2000` 且 `dockRemovalMs(false) === 2000`；`elapsed=2000` 时 `dockLineVisible` 为 false | 单测对常量与两档 removal 延迟 exact equality，并断言 2000ms 时不可见 | `dock-visibility.ts:32,38-40` | Unit | `04-bun-test.log` | E1, E2 |
| E5 | 受影响包单测与类型检查全绿；事故重绘点未被改动 | `packages/tui-base`、`packages/shell` 的 `bun test` exit 0；两包 `bun run typecheck` exit 0；`git diff` 中 `widgets-dock.tsx:950-952` 的 `void dockSpin()` 逐字保留 | 命令 exit code 均为 0；diff 含 `void dockSpin()` 上下文行且无删除 | 上述测试文件 + `widgets-dock.tsx:950-952`（只读核对） | Gate | `04-bun-test.log`, `05-typecheck.log`, `06-diff.log` | E1–E4 |

## 门禁预期（技术门禁全绿即 PASS）

- `bun test`（tui-base / shell）：exit 0，无失败用例；渐隐中间帧用例已同步改或跳过，不得靠删除断言换绿。
- `bun run typecheck`（tui-base / shell）：exit 0。
- `git status`：仅含本刀授权文件；剔除无关文件；单 commit，禁止 push。
- commit message: `fix(dock): disable think fade per user request (DOCK_FADE_OUT_MS 300->0)`。

## USER-JUDGMENT 预案（≤5 项；记录 + 默认，不进技术门禁）

- U1（交互手感／真机项）：think 行在 2 秒停留后直接消失、无 300ms 渐隐，观感是否生硬。**用户已拍板接受**（`research/2026-11-23-ui-batch/00-decisions.md` §R3）；推荐默认：按拍板保持关闭，不恢复渐隐。本项只记录，不拦技术门禁，不自行翻案。

## NOT RUN 声明

- 真机 tmux `capture-pane -e` 抓帧与本刀无关（由主 agent 在真机配方阶段做）；本刀只落机器可判的单元与类型检查证据，不伪造真机帧。
- 本刀不跑 `check-capcontract` / `real-client-gate` / pack 阶梯：改动限于 dock 可见性纯函数与测试，未触碰 CapIR / wire / 分发面。

## PASS 判定式

E1–E5 全达成 ∧ 技术门禁（bun test / typecheck）全绿 ∧ JUDGMENT（U1）有裁决记录 ∧ NOT RUN 已如实声明 → PASS。
USER-JUDGMENT 只记录不拦；红就红着报，不放水。
