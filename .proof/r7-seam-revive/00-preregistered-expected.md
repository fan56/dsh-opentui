# R7 seam 即时 settle 被 journal 重折叠复活缺陷修复 — 预注册（W5，write-once）

- 日期：2026-11-23。
- 分支 `fix/alt-dock-tabs-1123`，起始 HEAD `309c439`（基于 main `442b387` = v0.27.0）。
- 宿主：darwin arm64。证据目录：`.proof/r7-seam-revive/`。
- 时间盒：约 40 分钟；不收敛即停车，交回已确认机制/证据。
- 本文件正文在实现与取证之前一次性冻结；捕获后不改。
- 不 commit、不 push；冻结面（`capir/`、`capcontract/`、`ledger/`）零改动。

## 一、改动前一手事实（引用，非本刀重新审计）

- 已复现缺陷（仓外物 `/private/tmp/oldfox-review-1123/r7-replay-revive.repro.test.ts`，oldfox P1-1）：
  - `[A] afterLive=completed | afterTurnEndReFold=running   emits=["c1:completed","c1:running","c1:running"]`
  - `[E] afterSessionInfoDrain=running`
- 根因：`agent.settle` 即时终态走 `packages/shell/src/client/bridge-session-seam.ts` 的 `#foldAgentFrame` 直接折叠，**不登记** `#sweepSettledRuns`（只有 `#settleChildFromHost`，即 sweep 与 C3，会登记，见 3438-3457）。之后任何不含 settle 通知的 catalog-only 重折叠（回合末 `storedTranscript`、`/session` 增量 `sessionInfo`、`session.list` 失败兜底）都会走 catalog 复活分支（`bridgeFoldAgentRecord`，`subagent/catalog` 分支 849-867）把该行复活成 running；`#syncSubagentMeta` 的 sticky 复断言（3529-3557）因无登记而不触发。
- 修复约束：优先复用既有 `#sweepSettledRuns` / sticky 机制，不新造第二套状态；`#subagentJournalLoaded` 守卫与 journal 终态权威语义不动；不改 settle 的 outcome 映射（oldfox P2-4 单独记录）。

## 二、expected 表（FROZEN，机器可判；criterion 无环境依赖子句）

作用域：只改 `packages/shell` seam 源码 + seam 层用例 + 三处文档措辞；既有测试断言只加不删改。

| id | assertion | expected (FROZEN) | pass criterion（机器可判，无环境依赖子句） | level | evidence |
|---|---|---|---|---|---|
| E-RV-1 | 复现物红→绿 | 同一份 seam 代码上，catalog-only 重折叠不再复活即时 settle 的 run | 仓内临时跑复现物：`[A]` 的 `afterTurnEndReFold` 为终态（非 running），emits 不含 `c1:running`；`[E]` 的 `afterSessionInfoDrain` 为终态 | unit | 复现物 stdout |
| E-RV-2 | 回合末重折叠不复活（入库用例） | live `agent.settle` 后仅含 catalog 行的 `storedTranscript` 重折叠不发出 running，行保持终态 | seam 用例：`subagentViews()` 该 id 状态为终态；`onSubagentViews` 收集序列中无 running 项 | unit | `packages/shell/test/bridge-session-seam.test.ts` |
| E-RV-3 | `/session` 增量路径不复活（入库用例） | live `agent.settle` 后 `sessionInfo()` 的 catalog-only drain 不复活该行 | seam 用例：drain 后该 id 状态为终态 | unit | 同上 |
| E-RV-4 | 正向配对不受影响 | catalog-keyed spawn + settle 正常配对；重复 settle 与迟到冲突 settle 为 no-op | 复现物 `[P]`：spawn 后 running、settle 后终态、重复/冲突后状态不变 | unit | 复现物 stdout |
| E-RV-5 | seal 范围门禁 | seam 与 bridge 两包相关测试全绿；生成物零改动 | `bun test packages/shell/test/bridge-session-seam.test.ts` 0 fail；`bun test packages/bridge/test/agent-lifecycle.test.ts` 0 fail；`git status --short capir capcontract ledger` 为空 | gate | 命令退出码 + git status |
| E-RV-6 | 文档订正落地 | CHANGELOG R7 错句、E-SET-5 用例名/注释、两处桥注释、seam 注释均订正为事实 | 逐处 `grep` 命中新措辞且旧错句消失 | gate | 文件 diff |

## 三、JUDGMENT 预案（只记录，不拦门禁）

1. 修复口径 = 在 live `agent.settle` 折叠前，把该 child 的 pre-settle run key 登记进 `#sweepSettledRuns`，使后续 `#syncSubagentMeta` 复用 sticky 复断言；不改 outcome 映射、不改 journal 终态权威语义、不动 `#subagentJournalLoaded`。
2. 若 childId 缺失（防御分支），退化为经 `#subagentRunSeq` 无法解析则不登记；真实桥帧（childId 必带）走登记路径。
3. catalog 家族「新一轮 catalog = 新 run 可复活」语义保留；sticky 仅在 run key 与登记时一致时断言，避免跨 run 误杀。
4. 不扩大面到 `bridgeSettledStatus` / outcome 映射（P2-4 单独记账）。
5. 真机 10Hz 抓帧若拿不到或不可判定，标 `NOT RUN`，以 seam 用例覆盖，不拼接、不虚构帧。

## 四、脱敏纪律（W5 §4）

- 证据只含 UI 状态文本（running/completed 等）、run key、帧计数；不落任何 token/key/凭据/cookie。
- 不把 suspect 字符串或会话正文写入证据；报告只报键名与有无。
- 不触碰用户 `~/.dsh`、主仓与其它 worktree、用户 tmux（`default`/`cmdz`）。

## 五、NOT RUN / 作用域外声明

- 不跑全量测试，只跑 seam 与 bridge 两包相关范围。
- 不 commit、不 push；提交由协调者统一做。
- 生成物（`capir/`、`capcontract/`、`ledger/`）禁止任何变化。
