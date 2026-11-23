# 预注册预期 — motion full 下活动面板内容区不出（回归修复）

切片：`.proof/motion-full-dock/`。分支 `feat/ui-batch-1123`，起点 HEAD `80b7e40`。
流程纪律：W5（预注册证据）+ W3（缺陷修复）。动手实现前先落本文件。

## 一、要修的回归（一手事实，来自主 agent 真机）

- 最终包（13411a7）+ scratch home + tmux 120×40，`/motion full`：
  - bash `sleep` turn：第 1–7 秒带框活动面板只有标题行，内容区 0 行，第 8 秒才出 1 行。
  - 并行 3 子代理：面板先空、随后整体消失，34 秒内无 `subagent *N` 简报、无代理行。
- 基线 v0.26.4 同 `/motion full`：第 4 秒起 `┏━ tool━━┓` + `⚙ bash sleep …`，正常。
- 同包 `/motion off` 一切正常；此前全部真机验收都在 motion off 下做，故漏检。
- 用户本机直连终端默认 auto→full，即用户平时就是全开模式。影响面：默认用户。

## 二、根因假设（待真渲染/单测证实，不先入为主）

motion full 才走高度 tween（`/motion off` 由 `dockHeightContentLines` 的 `!motionAnimationRunning()` 早退直接回 target，故不触发）。
重点怀疑：给 tween 喂 target 的 effect 读的是 `tabContentLines().length`，而后者经 `frameLines()` 返回的是**已被 tween 裁过的 painted 行数**，不是原始 `mergedFrame().lines.length`。动画钟每 tick 同时 `setDockSpin` + `tickDockHeight`，effect 被 dockSpin 重新触发，把部分增长的分数值当成新目标写回 `setDockHeightTarget`，形成反馈环：tween 被不断重定向到当前 painted 值，永远长不到真实 target（在 0 内容起步时表现为长期 0 行）。候选提交：`4562774`(R2 tabContentLines) 前后。

## 三、expected 机器断言（无环境依赖子句）

E1（纯函数层）：`motionAnimationRunning()` 为真、`setDockHeightTarget(from)` 建好 tween 后，`dockHeightContentLines(target, t)` 随 `t` 单调递增，且在 `t >= startedAt + DOCK_HEIGHT_ANIM_MS` 精确等于 target。
E2（真渲染层，核心回归）：动画钟启用（motion full）下挂载 WidgetsDock + 固定 rows（含 running tool / 3 running 子代理），内容行数从起始值随 tween 长到 `mergedFrame` 的原始目标值；断言：(a) 首帧 painted 内容行数 == 起始值（非 target）；(b) 中间帧存在且单调不减；(c) 终帧 painted 内容行数 == 原始 target（不是被反馈环锁住的部分值）。
E3（反回归）：teardown/重挂载后第一次出现（start 无历史高度）snap 到 target，不留 border-only 空框等待 tick。
E4（档位覆盖）：同一断言在 motion off 下恒等 target（早退路径不受影响）。

**criterion 措辞纪律**：E2 的断言只描述「动画钟启用下内容行数随 tween 长到目标」，不写任何环境依赖子句（不写 tmux/present/truecolor/profile 是否存在等条件）。

## 四、JUDGMENT 预案（不可机器判定项）

- J1（视觉手感）：tween 增长是否"肉眼连续"。预案：整数行 + 200ms smoothstep 已定案，真机抓帧确认无 border-only 空窗即可；不做主观色值判断。
- J2（真机自验矩阵）：motion full/reduced/off × 带框(≥31 行)/紧凑(≤30 行) × 场景 bash sleep / 并行 3 子代理。预案：以 `.ans` 帧内文本为准（内容行、tab 条、`subagent *N`、代理行出现）逐格记 PASS/FAIL；这是自验不是最终验收，最终由主 agent 亲自抓帧。
- J3：若根因假设被真渲染测试证伪，停车并交回一手证据，不强行套用。

## 五、脱敏纪律

- 所有 `.proof/motion-full-dock/` 产物只含渲染 ANSI 文本、行数计数、帧序号；不写入任何 token/key/密码/会话凭据。
- scratch home 只用 `/private/tmp/mfix-a-home`（拷贝），不碰用户 `~/.dsh`；不碰用户 tmux server（`default`/`cmdz`），只用 `tmux -L mfix-a`。
- 若真机帧意外含敏感串，落档前用帧号引用替代原文，禁止原文入库。

## 六、交付对照

1. 本文件（预注册，动手前）。
2. 修复代码 + 一条真渲染回归测试（当前 HEAD 红、修复后绿，自验红→绿）。
3. `.proof/motion-full-dock/report.md`：根因（file:line + 机制）/ 改动文件 / 红转绿证据 / 残余风险。
4. 真机自验帧与结果落 `.proof/motion-full-dock/`。
