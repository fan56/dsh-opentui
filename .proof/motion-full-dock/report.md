# motion full 下活动面板内容区不出 — 修复报告

切片：`.proof/motion-full-dock/`。分支 `feat/ui-batch-1123`，起点 HEAD `80b7e40`。
预注册：本目录 `00-preregistered-expected.md`（动手前落盘）。
执行：workhorse subagent 完成诊断与实现，模型通道中断后由协调者接手补报告；红→绿原始输出为该 agent 落盘，未被改写。

## 1. 结论

**已定位、已修复、单测层红→绿已证。真机矩阵（motion full/reduced/off × 带框/紧凑）未在本切片执行，随最终安装包验收一并取证（见 §5）。**

## 2. 根因

`packages/tui-base/src/routes/session/widgets-dock.tsx`。

高度 tween 的**喂料效应器**读的是 `tabContentLines().length`：

- 主 tab 下 `tabContentLines()` 返回 `frameLines()`；
- `frameLines()` 已经按 tween 当前 painted 行数裁过（`dockHeightContentLines(target, dockFrameNow)`）；
- 而 `frameLines()` 内部读 `dockSpin`，动画钟每 tick 同时 `setDockSpin(...)` + `tickDockHeight(...)`，于是这个 effect 被 `dockSpin` 反复重跑；
- 每次重跑都把**tween 自己的滞后 painted 值**写回 `setDockHeightTarget(...)` → tween 被重定向到自身当前值 → 永远长不到真实 target。

从 0/1 行开始的增长（本批 R2 的 `tabContentLines()` 引入该读法）表现为：第一 tick 就把目标钉死为 1（或 0），面板只剩边框，直到 latch 过期才跳到真实行数 —— 真机上就是「第 1–7 秒只有标题行，第 8 秒才出 1 行」。motion off 走 `dockHeightContentLines` 的 `!motionAnimationRunning()` 早退，直接回 target，所以不触发；这解释了为什么本批此前全部验收（都在 motion off 下做）漏检。

## 3. 修复

`packages/tui-base/src/routes/session/widgets-dock.tsx`：

- 新增 `tabTargetLineCount()`：主 tab 取未被 tween 裁剪的原始构建结果 `mergedFrame().lines.length`；todo tab 取 `todoTabLines(...).length`。
- 喂料 effect 改为 `setDockHeightTarget(tabTargetLineCount())`。
- 不加新机制、不改 tween 参数、不关 tween。与既有 `FlatDock`（本来就喂 `allLines()` 原始值）一致。

改动量：1 个源文件 +1 helper / 1 行调用；1 个测试文件 +53 行回归用例。

## 4. 回归测试

`packages/tui-base/test/widgets-dock-render.test.ts` 新增
`REG motion full: framed content grows to the raw target under the animation clock`：

- 真实渲染器 + **动画钟启用**（`setMotionTier("full")`），不手工 `setDockHeightTarget`；
- 先 1 行场景，再涨到 6 行（think 1 + tool 1 + todo 简报 1 + 3 个 running 子代理行）；
- 断言：末帧内容行数 `== 6`，且中间帧单调不减。

红→绿原始输出（agent 落盘，未改写）：

| 状态 | 证据 | 结果 |
|---|---|---|
| 修复前（effect 内为 `setDockHeightTarget(tabContentLines().length)`） | `01-red-before-fix.txt` | FAIL：`Expected: 6 / Received: 1` — 正是反馈锁把 painted 值钉在 1 |
| 修复后 | `02-green-after-fix.txt` | PASS：`1 pass / 0 fail`，22 expect |

补充：`bun test packages/tui-base/test/widgets-dock-render.test.ts packages/tui-base/test/widgets-dock-tabs-r2.test.ts` = **33 pass / 1 skip / 0 fail**。唯一 skip 是 R3 关渐隐后已失效的 `M1 ... fade frame` 用例，`HEAD` 上即已是 `test.skip`（非本次引入）。

## 5. 未在本切片完成（如实）

- **真机矩阵 NOT RUN here**：motion full / reduced / off × 带框(120×40) / 紧凑(80×24) × 场景（bash sleep、并行 3 子代理）由协调者在最终 `npm pack` 安装包上执行（铁律：UI 验收由主 agent 亲自抓帧），证据追加进 `.proof/frame-pass-1123/`。本报告不预判其结果。
- E1/E3/E4（纯函数层 tween 单调性、首帧 snap、motion off 恒等 target）由既有测试与本次真渲染用例覆盖，未单独立新用例。

## 6. 脱敏

本目录只含测试输出与行数计数，无凭据、无会话正文、无 host 值。
