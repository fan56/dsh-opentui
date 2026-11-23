# Proof Report: dock-frame-regression / dock 活动帧用例红盘的二分与裁决

- Gate / 门禁: PASS（最终 HEAD `13411a7` 上该用例 9 pass / 0 fail；改判前在 `733e859` 为 1 fail）
- Result / 结论: PASS（红盘经二分定位为过时测试前提，13411a7 测试侧修复，非产品缺陷）
- 预注册：`00-preregistered-expected.md`（本目录，write-once，含二分表与根因 file:line）
- 权威证据：`.proof/final-gate/final-2/04-pert-shell-render-regression-ft.out`（13411a7 逐条明细）、`.proof/final-gate/final-2/03-full-shell.out`（三包全量）、`.proof/frame-pass-1123/report.md`（主 agent 最终包真机帧）

## 1. 范围与红盘

失败用例：`packages/shell/test/shell-render-regression-ft.test.tsx` 中
`dock activity frame appears during a turn and hides after end + linger`。

- 在 `733e859`（R8）为唯一 red：`.proof/final-gate/00-summary.md:21-24,27-36`、`.proof/final-gate/full-shell.out`（1355 pass / 5 skip / **1 fail**）、`pertests/shell-shell-render-regression-ft.out`（733e859 轮 8 pass / 1 fail）。
- 在 `8127420`（基线）为 PASS；引入区间 `8127420..HEAD`。

## 2. 二分表（evidence，隔离 worktree `/private/tmp/bisect-dock`，真实 `pnpm install --frozen-lockfile`）

逐 commit 执行 `bun test ... -t "dock activity frame appears during a turn"`，时序如下（抄自 `00-preregistered-expected.md`）：

| commit | subject | result |
|---|---|---|
| 8127420 | docs(batch) baseline (control) | PASS |
| 7f89410 | mount tabbed activity frame on shipped route | PASS |
| 187a653 | mark the active tab + mouse click path | PASS |
| **36dc77a** | **return focus to composer when the activity dock hides** | **FAIL（首个红）** |
| 1e4a237 | settled subagents leave the dock immediately (R7) | FAIL |
| 733e859 | subagent brief with per-batch timer (R8) | FAIL（当时的 HEAD） |
| **13411a7** | **test(shell): re-pin activity focus after dock shows for heavy-frame premise** | **PASS（修复，最终 HEAD）** |

首个红 commit：`36dc77a`。修复 commit：`13411a7`（仅测试侧重钉焦点前提，strength 未降，expect 10→11）。

二分 setup 注意：软链 `node_modules` 的检出不是合法二分 setup（`@dsh-opentui/i18n` 会解析到主工作树模块，产生第二个 module 实例、`t()` fail-open 到 raw key）；上表每一格都用隔离检出内真实 frozen-lockfile install。

## 3. 根因（file:line，抄自预注册）

`packages/tui-base/src/routes/session/widgets-dock.tsx:1822-1824`（36dc77a 引入）：
```
createEffect(() => {
  if (!activityFrameLatch.shown() && untrack(activePanel) === "activity") resetActivePanel()
})
```
turn 起点 push effect（`:1804-1811`）以 `shown:false, pending:"show"` 武装 60ms defer，通知 reset effect 时 `shown()` 仍为 false，于是调用 `resetActivePanel()`；而帧重 `panelFocusFrame({ focused: activePanel() === "activity" })`（`:2098`）因此保持单框 `┌`，`expect(survived).toContain("┏")` 失败。

定性：**STALE TEST PREMISE（过时测试前提），非产品缺陷**。36dc77a 的焦点回收是有意行为，产品只在 dock 带框可见时经 `selectActivityDockTab`/`onActivityPanelMouseUp`（`:517-545`）标记 activity active；旧用例在 turn 前 dock 隐藏时钉了 activity 焦点，属产品现已刻意清除的状态。最小正确修法是重钉该前提（after the framed board is up），13411a7 照此实现，未弱化任何生命周期断言。

## 4. 最终 HEAD 9 pass 的原始依据

`.proof/final-gate/final-2/04-pert-shell-render-regression-ft.out`（13411a7 单文件逐条明细）9 条 `(pass)` 一一对上：

| 行 | `(pass)` 用例 |
|---|---|
| `:4` | width 50: wrapped prose keeps every token inside columns |
| `:5` | width 80: wrapped prose keeps every token inside columns |
| `:6` | width 160: wrapped prose keeps every token inside columns |
| `:7` | resize narrow→wide→narrow reflows the transcript without losing content |
| `:8` | empty session renders a stable first frame with no placeholder debris |
| **`:9`** | **dock activity frame appears during a turn and hides after end + linger（原失败用例，现 `(pass)` [2974.45ms]）** |
| `:10` | turn/end error row is visible and the stored transcript survives it |
| `:11` | a live-turn onError lands as an error row next to the user line |
| `:12` | replayed journal records survive the 50-column wrap |

汇总：`:14` **9 pass** / `:15` **0 fail** / `:16` 51 expect() calls（对比 733e859 轮 `pertests/shell-shell-render-regression-ft.out` 的 8 pass / 1 fail、45 expect——断言更强且全绿）。

三包全量交叉印证：`.proof/final-gate/final-2/03-full-shell.out` = **1356 pass / 5 skip / 0 fail**（由 733e859 的 1 fail 归零），exit 0（`final-2/03-full-shell.exit`）。

## 5. 主 agent 真机复验

`.proof/frame-pass-1123/report.md` §2 第 10 项「面板消失后焦点自动回输入框（不击键）PASS」（帧 `12-focus-returned-after-hide.ans`）证明 36dc77a 的焦点回收在最终包上确有预期行为；§3 D10 记录该用例红盘的修复 commit `13411a7`。二分裁决（测试前提过时、产品行为正确）与真机复验一致。

## 6. 结论

dock 活动帧用例在最终 HEAD `13411a7` 上 9 pass / 0 fail，红盘为 733e859 期的过时测试前提，已由 13411a7 测试侧修复。本切片不构成产品回归，不阻塞发版。证据不覆盖的项（如 `36dc77a` 之前各中间 commit 的真机帧）不在判定域，未声称。
