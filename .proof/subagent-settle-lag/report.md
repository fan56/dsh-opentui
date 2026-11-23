# R7 子代理结束后面板滞留 12–21 秒 — 修复报告

切片：`.proof/subagent-settle-lag/`。分支 `feat/ui-batch-1123`，起点 HEAD `80b7e40`。
预注册（FROZEN）：本目录 `00-preregistered-expected.md`。
执行：workhorse subagent 完成诊断、实现与单测；模型通道中断后由协调者接手补报告与真机取证。

## 1. 结论

**机制已坐实、已修复、`packages/bridge` 单测 389 pass / 0 fail。逐秒真机证据（E-REAL-1/2/3）随最终安装包验收一并采集（见 §5），本报告不预判。**

## 2. 根因（推翻了什么、证实了什么）

**证实**：`agent.settle` 此前只在父侧到达时才发，子会话自己的 `turn/end` 只更新内部索引。
**精确化**：对 catalog 家族子代理（`subagent` / `use_agent`，即常用委派路径）来说，父侧 settle 的实际触发点是**父 journal 里 `user/message subagent-settled` 通知被 drain 的时刻**，不是单纯的 `tool-workflow agent-end`。这就是 12–21 秒的来源：子会话早已 `turn/end completed`，桥在等父侧那条通知。

渲染层无问题：四个 dock 面本来就只画 `status === "running"`（r7-r8 已逐 file:line 审计）。并发上限 3 也一直是生效的（`ActivationPool.reserve`），此前「6 个同时跑」是状态滞后造成的显示错误。

## 3. 修复

`packages/bridge/src/index.ts`：

- 新增 `childSettleOutcome(reason)`：把宿主 reason（字符串或 `{kind}`）映射到 seam 既有口径 —— `error`/`blocked` → `failed`，`aborted`/`interrupted`/`forked` → `aborted`，其余 → `completed`；未知 reason 不臆造失败。
- 子会话 `turn/end` 处理路径内，满足 `row.status === 'running' && row.parentSessionId === boundId` 时**即时** `emitEvent('agent.settle', { runId: 'catalog:<childId>', seq: 0, outcome, ... })` —— 复用既有帧类型与 spawn 时的配对键，seam 侧同一个纯投影器折叠，不新增协议。
- `running` 守卫使重复 `turn/end` 与父侧晚到的 `agent-end` 成为 no-op：**不重复 settle，不复活已消失的行**。
- 子会话 `turn/start` 且该 child 已在索引中 → `index.noteRunning(sessionId)`：宿主重新接管说明是新一轮运行，恢复 running，让下一次 `turn/end` 恰好再发一次 settle（被再次唤起的子代理能重新出现）。
- `#subagentJournalLoaded` 守卫未动：settle 后 journal 重读仍是终态权威。
- `flushProgressNow` / `noteSettled` / `clearChildProgress` 的既有顺序保持不变（B3 的实时进度与残留清理不受影响）。

`packages/bridge/src/subagent-index.ts`：新增 `noteRunning(childId)`（仅对已知行置回 running）。

生成物 `capir/`、`capcontract/`、`ledger/` 零改动。

## 4. 单测证据

`packages/bridge/test/agent-lifecycle.test.ts` 新增 `describe("R7 child turn/end settle lag")`，8 条用例映射预注册断言：

| 断言 | 用例 |
|---|---|
| E-SET-1 即时 settle（catalog 配对键） | `E-SET-1: child turn/end emits one agent.settle with the catalog pairing key` |
| E-SET-1 终态映射 | `E-SET-1: failed and aborted terminals map to the seam's settled outcomes` |
| E-SET-2 不重复 settle | `E-SET-2: a repeated child turn/end is a no-op (no double settle)` |
| E-SET-2 父侧晚到 agent-end | `E-SET-2: a late parent tool-workflow agent-end never re-settles or revives the child` |
| E-SET-3 后台子代理 | `E-SET-3: a background child finishing while the parent turn is idle still settles` |
| E-SET-4 再唤起重现 | `E-SET-4: a re-awakened child reappears and settles again on its next turn/end` |
| E-SET-5 journal 重读仍终态 | `E-SET-5: journal/host-list re-read keeps the settled terminal authoritative` |
| 作用域加固：非本父的子会话 | `E-SET-2: a foreign child's turn/end cannot settle the bound child` |

原始输出：`10-bridge-settle.out`（协调者与收尾 agent 各跑一次，均 **389 pass / 0 fail / 2044 expect**，33 files）。

## 5. 真机证据（0.27.0 安装包，HEAD `2555fe3`）

已在 `npm pack` 安装包（`a3619290…`）+ 全新 scratch home + `/motion full` 上完成，详见 `20-journal.md` 与 `20-frames/`：

- **E-REAL-1 PASS**：三个子会话 `turn/end` 后，面板行消失延迟 **765 ms / 375 ms / 768 ms**（均 ≤2s）。
- **E-REAL-2 PASS**：`subagent *3 → *1 → 0`，严格不增；旧的 `*3 → *6` 显示错误未复现。
- **E-REAL-3 PASS**：`0s→1s→2s→3s→4s` 计时非递减，单个 settle 不重置锚点。

未做：人为错峰（三个子代理在同一秒起跑、先后结束）；预注册 JUDGMENT-5 已允许。
`20-frames/` 内为本轮逐秒 `.ans` 帧与采样 CSV。

## 6. 脱敏

本目录只含测试输出、断言名与计数；不含令牌、凭据、会话正文或 host 值正文。
