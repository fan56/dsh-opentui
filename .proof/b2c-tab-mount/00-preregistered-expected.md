# B2c — tabbed activity frame on the shipped route — preregistered expected

Worktree / branch: `/Users/qingguee/repo/dsh-opentui-wt-uibatch-1123` @ `feat/ui-batch-1123`.
HEAD at write: `84b2ce72a28b681860bb95f880d531195183652c`.
Written (UTC): 2026-11-23T05:09:25Z. Write-once; `.log` / `.ans` are gitignored capture artifacts.

> **Timing note (honest)**: root cause, fix design and the unit-level expectations below were established from source analysis + the R2 render tests BEFORE the final tmux capture; this file is written after that final capture. The `expected` values are therefore frozen against the pre-capture analysis, not reverse-engineered from the capture output.

## Root cause (pre-change, from source + installed bundle)

- The shipped client boots `packages/tui-base/examples/v2-entry.tsx` (client-entry.tsx computes `../../tui-base/examples/v2-entry.tsx`; the published `dist/client/index.js` bundle contains `v2-entry.tsx` + `widgets-dock.tsx` sources). WidgetsDock IS mounted there with `turnActive: () => busy()` — no v1/v2 dual-route gap.
- `activityFrameLatch` was latching correctly on the live turn (`turnActive() || lower content || think/tool rows`). The dock WAS in its shown state.
- The real gap is the **compact terminal branch**: `activityFrameMode(terminalRows)` (`widgets-dock.tsx:1216`) returns `"rule"` at `<= COMPOSER_COMPACT_TERMINAL_ROWS` (30, `skin/semantic.ts:174`). The rule branch (`widgets-dock.tsx` around `:1984` pre-change) rendered `activityRuleLines` + `compactLower()` and had NO tab bar and NO read of `activityDockTab`. R2 had wired the tab bar only into the framed box `title` (`mergedTitleText`), which never renders on the shipped 24-row pane. Hence `┃ 活动` + `┃⚙bash sleep...` with no tabs, exactly as captured.
- Reproduced on the shipped bundle at 120x24 in tmux; at 120x36 the framed tab bar (`1 主面板  2 待办`) appears — confirming the row-count gate.

## Fix

- `widgets-dock.tsx` compact branch: add a first-row tab bar via `dockTabBarLayout` + `mergedLineView` (CJK-safe path), a `compactTabAtPosition` mouse hit test, and route the content through `activityDockTab()` (`main` = rule lines + lower zone; `todo` = `todoTabLines`; empty todo => bar-only empty state). `compactHeight()` updated to account for the tab row.
- No route change, no frame-threshold change, no i18n key change, no bridge/seam/provisioner/dist diff.

## Preregistered expected (E1–E4, machine-checkable)

| id | assertion | expected (FROZEN) | pass criterion | changed path | evidence |
|----|-----------|-------------------|----------------|--------------|----------|
| E1 | compact terminal mounts tab bar | a real-render WidgetsDock at height 24 paints a leading row `1 main  2 todo` (en test locale) | render test asserts `occupied[0].trimEnd() === "   1 main  2 todo"` at 24 rows | `widgets-dock.tsx`, `widgets-dock-render.test.ts` | test run log |
| E2 | main tab unchanged | `activityDockTab()==="main"` still paints the rule form (`bash` tool line present) | render test asserts `bash` present in main, bar row still leading | same | test run log |
| E3 | alt+2 / alt+1 switch | `setActivityDockTab("todo")` writes the signal the global keymap `session.dock.tab.*` commands use; todo paints the tree and drops the rule lines; `setActivityDockTab("main")` restores | render test drives the module signal and asserts todo tree `romeo` present + `bash` absent, then main restores `bash` | same | test run log |
| E4 | shipped-route real frame | on the rebuilt installed bundle at 120x24, during a live turn the dock top shows `1 主面板  2 待办`; after `M-2` the tab row persists | `capture-pane` `.ans`/`.txt` contains the literal `1 主面板  2 待办` on the dock top row | n/a (evidence only) | `/private/tmp/b2c-final-main.ans`, `/private/tmp/b2c-final-todo.txt` |

## Gate expectations

- `bun test packages/tui-base/test/widgets-dock-render.test.ts` + R2/dock unit files: all green.
- `bun run typecheck:entry` (tui-base): exit 0.
- Single commit `fix(dock): mount tabbed activity frame on the shipped route (R2 followup)`; no push; no `packages/shell/dist` source diff committed (build output is gitignored).

## NOT RUN

- Mouse SGR click injection (`ESC[<0;x;yM`) not exercised on the real pane; the hit-test is pure-function covered by the R2 tab-bar test.
- v1/v2 dual-route hypothesis: disproved (single v2-entry boot); no route migration performed.

## Observation (not a gate, reported to coordinator)

- While a permission dialog is open on a 24-row pane, the compact dock's CJK glyphs were observed blanked in the rebuilt bundle; after the dialog is dismissed the tab bar renders `1 主面板  2 待办` correctly. This reproduces with clean pre-fix source too, so it is pre-existing and out of this slice's scope; recorded, not silently passed.

---

# 附则 (appendix) — 2026-11-23T05:47:17Z — 正文 E1–E4 FROZEN，以下为追加，不回改正文

追加 HEAD：`df699fe420ac443b01f9d0d7acad0df77ac9035f`。三项跟进：鼠标点击诊断、激活 tab 标记、dock 隐藏焦点回落。正文 E1–E4 的 expected 一字不改；本附则自带 FROZEN 预测值。

## A1 — 鼠标点击 tab 无效：根因定位（预注册）

| id | assertion | expected (FROZEN) | pass criterion | evidence |
|----|-----------|-------------------|----------------|----------|
| A1 | 注入 vs 处理链 | 根因是**注入方式**：`tmux send-keys -H '<hex>'` 把字节当作字面字符吞掉，SGR 字节到不了 renderer.stdin；处理链（SGR parse → hitTest → processMouseEvent → onCompactTitleMouseUp → dockTabAtPosition → onDockTabMouseUp）本身正确 | 对照实验：向进程 stdin 挂 listener，注入 `-H '1b 5b ...'` 后 log 无 `\x1b[<` 字节；改用 `send-keys $'\e[<...'`（literal ESC）后 log 出现 `\x1b[<0;16;18M` 且 debug hook 记到 `COMPACT up x=15 y=17 btn=0` + `TAB SELECT todo btn=0` | stdin debug log + mouse debug log（capture 期临时插桩，捕获后还原） |
| A2 | 真机可靠注入方法 | `tmux send-keys -t <pane> $'\e[<0;<col>;<row>M'`（bash ANSI-C quoting 产出真实 ESC 字节）+ 对应 `m` 释放；列/行 1-based；须先清掉权限弹窗（弹窗捕获鼠标） | 24 行紧凑模式点击 tab 触发 `TAB SELECT`；≥31 行带框模式同法点击生效 | `.ans` 帧 + debug hook |
| A3 | 双模式点击证据 | 紧凑 + 带框两种模式各留一列「点击前/点击后」帧 | 帧文件存在且 tab 行激活标记迁移（见 A4） | `.proof/b2c-tab-mount/*.ans` |

## A4 — 激活 tab ASCII 方括号标记（预注册）

| id | assertion | expected (FROZEN) | pass criterion | changed path |
|----|-----------|-------------------|----------------|--------------|
| A4 | 激活标记统一来源 | 带框（title）与紧凑（rule 首行）两个模式共用同一标签生成；`main` 激活→`[1 main]  2 todo`，`todo` 激活→`1 main  [2 todo]`（en）；zh 对应 `[1 主面板]  2 待办` / `1 主面板  [2 待办]` | 单测断言两种 tab 状态下标签串精确值；真机帧含对应字面串；i18n 键值不变；命中测试用 layout 宽度自动跟随标记宽度 | `widgets-dock.tsx`（标签生成 helper）+ 渲染测试 |
| A5 | 标记随切换迁移 | alt+2 / 点击后标记从 main 标签迁到 todo 标签，切回相反 | 渲染测试断言切换前后 tab 行文本变化；保留既有切换/内容断言强度不降 | 同上 |
| A6 | 命中区随标记 | `dockTabBarLayout` 输入带标记的标签，命中测试按 layout 宽度走，`[1 main]` / `[2 todo]` 各自区间仍命中正确 tab | R2 hit-zone 单测以带标记标签复测通过 | `widgets-dock-tabs-r2.test.ts` |

## A7 — dock 隐藏焦点回落 composer（预注册）

| id | assertion | expected (FROZEN) | pass criterion | changed path |
|----|-----------|-------------------|----------------|--------------|
| A7 | 焦点孤儿修复 | `activityFrameLatch.shown()` 从 true→false（turn 结束 dock 消失）时，若 `activePanel()==="activity"` 则回落 `"composer"`；turn 进行中点面板/切 tab 仍置 activity 不受影响；R5-2 onCleanup 复位不重复触发 | 真渲染测试：turnActive true + markPanelActive(activity) → 置 false 等 latch hide → `activePanel()==="composer"`；turn 中切 tab 断言 activity 保持；R5-2 dispose 测试仍绿 | `widgets-dock.tsx` + `widgets-dock-render.test.ts` |

## 流程

- 三个独立 commit：鼠标诊断（证据+插桩还原，仅附则文件入库）、激活标记、焦点回落。禁止 push。
- 门禁：widgets-dock 相关单测 + tui-base 全量 + `typecheck:entry` 全绿。
- 不动主 agent 的 `uibatchframe` tmux server；用我自己的 `uibatchframe3`。

## NOT RUN（附则）

- 真实物理鼠标硬件事件：仅验证 tmux 注入的 SGR 字节路径，不接物理鼠标。

## 附则 observed（capture 后追加，expected 未回改）

- A1 PASS — `-H` hex 注入的字节到不了 stdin（stdin listener 无 log）；literal `$'\e[<...'` 注入的字节到达（log 出现 `\x1b[<0;16;18M`，mouse hook 记到 `COMPACT up x=15 y=17 btn=0` + `TAB SELECT todo btn=0`）。
- A2 PASS — 真机可靠注入法 = `tmux send-keys -t <pane> $'\e[<button;<col>;<row>M'`（+ `m` 释放）；须先清权限弹窗。
- A3 PASS — 紧凑 + 带框双模式各有点击前/后帧：`10/11/12-compact-*`、`20/21/22-framed-*`。
- A4 PASS — 两模式同标签源，激活 tab 带 ASCII []；帧 `10`/`11`/`20`/`21` 分别含 `[1 主面板]  2 待办` / `1 主面板  [2 待办]`。
- A5 PASS — 点击 alt+2/alt+1 标记迁移，渲染测试断言切换前后文本变化。
- A6 PASS — R2 hit-zone 单测以带标记标签复测通过（新增 B2c-2 单测）。
- A7 PASS — 真机帧 `30-focus-after-hide.ans` 显示 dock 消失后 composer 重框 `┏━` 无需击键；真渲染测试 B2c-3 绿。
