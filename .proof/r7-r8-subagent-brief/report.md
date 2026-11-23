# R7 + R8 证据报告（2026-11-23）

## 环境与被测物

- 分支 `feat/ui-batch-1123`，捕获前 HEAD `0690166`（任务票基线 `36dc77a` 之后并行 agent 又落了 3 刀）。
- 新构建：`bun scripts/build-client.mjs` → `packages/shell/dist/client/index.js`（2,419,984 bytes）；产物含 `overlay.widgets.subagentBrief` ×1、`subagentBatchAnchor|subagentBriefLine` ×5。
- `npm pack`（packages/shell，prepack 重编 bridge/client/locales）→ `npm install -g --prefix /private/tmp/r7r8brief-prefix`，从安装版 bin 启动。
- 自有 tmux server `r7r8brief`（session `r7r8:0`，120x40 ≥31 行 → 带框模式），自有 scratch home `/private/tmp/r7r8brief-home`（从 `/private/tmp/uibatch-frame-home` 复制）。未碰 `uibatchframe*`、用户 `~/.dsh` 或用户进程。
- 帧：`tmux capture-pane -e -p` 数值 `.ans`，本目录 `verify-*`/`steer-*`/`final-*`/`reset-*` 等；禁 PNG/视觉模型。
- 区域语言 zh-CN（scratch home 原设置）；subagent 简报 en/zh 同值纯 ASCII，帧中字面 `subagent *N Ns` 可直接 grep。

## 门禁

| 项 | 结果 | 证据 |
|---|---|---|
| scoped（6 个 dock 测试文件） | 209 pass / 1 skip（M1 既有 skip）/ 0 fail | `04-r7-r8-scoped.log` |
| tui-base 全量（114 文件） | 1639 pass / 1 skip / 0 fail | `05-full-tui-base.log` |
| typecheck:entry | PASS | 命令输出（本轮 tail 为空、退出码 0） |

注：全量首跑 1 fail = 静态源测试 grep `clipToWidth` 命中我新增注释里的字面 token；改注释措辞后复跑全绿，断言强度未降。D11 真渲染测试从 4 行改为 5 行并新增 `subagent *12` 行内容断言（R8 新增行，非放宽）。

## expected → observed

| id | expected | observed | 判定 |
|---|---|---|---|
| E-R7 | 四 dock 面 running-only，settle 后行立即消失 | 改动前一手审计见预注册 §一：(a) scene A 只 `mergedRunningAgents`；(b) 紧凑下半区只 todo 树；(c) lastrequest view 只画 👤 echo；(d) D10 latch/turn/clock 均 running-only。本刀补回归测试锁定，不改行为 | PASS（行为已在基线满足） |
| E-R8-1 | `subagent *N Ns`，running=0 空，en/zh 同 ASCII | 单测 exact；真机帧 `verify-007-142613.ans` 含 `subagent *3 0s` | PASS |
| E-R8-2 | 两简报合并/独占 | 单测 exact；真机此轮无 todo 工具调用 → 只见 subagent 独占行（合并路径由单测覆盖） | PASS（单测） |
| E-R8-3 | 批锚 0→N / N→M / →0 / 再 0→N | 单测序列全绿；真机 N→M 见 `verify-030-142637.ans`：`*6 24s`，3 个原 agent 均 24.3s、3 个新 agent 0.0s，计数变 6 而计时仍 24s（未重置） | PASS |
| E-R8-4 | 两模式真帧 + 帧高预算 | 带框真帧见下；紧凑 24 行真渲染测试通过（单帧断言 `subagent *3`）；80x24 预算单测 `24 - dock - chrome >= 6` | PASS |
| E-R8-5 | 数据层纯函数 + 宽度律 | `combineBriefText`/`fittedBriefLine` 纯函数；静态测试确认 merged-dock.ts 无 `clipToWidth`；`lineWidth` exact | PASS |
| E-GATE | 门禁 | 见上 | PASS |
| E-REAL | 真机 a–d | 见下 | PARTIAL（d 未取得；详见下） |

## 真机 a–d（≥31 行带框模式，逐秒帧）

- **a. 简报出现且计时递增 — PASS。** `verify-007-142613.ans` `subagent *3 0s` → `verify-014-142621.ans` `*3 7s` → `verify-028-142635.ans` `*3 22s` → `verify-038-142645.ans` `*6 32s`（后段新代理并入使计数变 6，计时连续）。计时随墙钟递增（scratch home 原配置 `motion:"off"`，与所有既有 elapsed 列同机制： seam 行变更时重算；逐秒帧可见递增）。
- **b. settle 后行消失、计数变、计时不重置 — PARTIAL。**
  - 行立即消失：`steer-012-143045.ans` 含 `subagent *1 12s` + 1 条 agent 行；下一秒 `steer-013-143046.ans` 简报与 agent 行同时消失。
  - 计数变化且计时不重置：`verify-029-142636.ans` `*3 22s` → `verify-030-142637.ans` `*6 24s`（3 个新 agent 并入同一批，计时连续）。
  - 未取得「某个 agent settle 使 3→2」的干净帧：本机模型把多个 `use_agent` 并发启动、收尾几乎同时发生，3 次尝试均未出现单个 agent 错峰 settle 的帧。按 W5 不拼接、不虚构。
- **c. 全部完成后简报与代理区一起收起 — PASS。** `verify-031-142638.ans` 仍有 `*6 24s` + 6 行；`verify-043-142650.ans` 简报与全部 agent 行同时消失，标题退回 `💭 think`。`final-*/reset-*` 亦有多处同样收起帧。
- **d. 全部跑完后同 turn 再开新批 → 从 0 起算 — NOT RUN（真机）。** 3 次尝试（两批提示词、steer 注入、显式 use_agent  wording）中，模型要么把第二批与第一批并发启动（即上面 b 的 `*3→*6`），要么把「第二批」降级为直接 bash 工具调用，没有产生「running 归 0 后同 turn 再次 0→N」的真机序列。锚点语义（→0 清锚、再 0→N 从 0）由 E-R8-3 单测逐条锁定，真机对应帧不存在，如实声明，不冒充 PASS。

## 一手事实 / 与规格偏差

1. **R7 无需行为改动**：改动前四个 dock 面已全部 running-only（预注册 §一逐 file:line）。本刀 R7 commit 内容是注释固化口径 + 回归测试；若评审期待 behavioral diff，以本报告为准。
2. **motion off 的 elapsed 机制**：scratch home 原配置 `motion:"off"`，`onAnimationTick` 不订阅，`dockSpin` 不逐帧 bump；所有 elapsed 列（含既有 think/tool 与 todo 简报）只在 seam 行变更时重算。实测逐秒帧仍可见简报秒数递增。尝试把 scratch home 改成 `motion:"full"` 后出现**既有**的高度 tween 掉行现象（dock 只画 1 行内容，标题仍显示子代理存在），与本刀改动无关；已恢复原设置并以原设置取证。
3. **并发上限**：任务票写「本机并发上限 3」，实测模型可同时开 6 个子代理（帧 `verify-030`）。不影响本刀逻辑，如实登记。
4. **合并行真机未覆盖**：本轮模型未调用 todo 工具，`todo 简报 · subagent 简报` 的合并帧未取得；合并文本由 E-R8-2 单测 exact 覆盖。
