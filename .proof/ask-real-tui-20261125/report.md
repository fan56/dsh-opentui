# Proof Report: ask-real-tui-20261125 / 证明报告：ask 真机

> **终判状态**：本文件为 7 组真机证据执行后的汇总判定。证据目录已有 R1–R7 全部原始产物；**未改源码/测试/prereg、未 commit**。判定为 `BLOCKED`：R3 / R5 / R6 含未覆盖子项，按 skill §6「缺一项即不可称 done」与 §7「BLOCKED 不得记 PASS」，Gate 与 Result 均为 `BLOCKED`。下方「machine part」仅列已取得机器证据的断言，**不代表整体 PASS**。

- Gate / 门禁: BLOCKED
- Profile(s) / 证明类型: FEATURE（主）+ DATAFLOW（`journal → replay → transcript` 三跳）
- Result: BLOCKED（与 Gate 相同；无 NOT RUN、无 FAIL，三个 BLOCKED 行见「UNAVAILABLE / BLOCKED declarations」）
- machine part（仅机器证据子集，非 gate 结论）: R1 PASS | R2 PASS（本仓侧；T1–T8 跨仓不判） | R4 PASS | R7 PASS。R3 / R5 / R6 BLOCKED。
- Expected registered (UTC) / 预期登记时间: 2026-11-25T06:29:18Z（本组 R1–R7 真机骨架；既有 45 条预期登记于 2026-11-25T03:16Z，见引用文件）
- Change ref: `15233ef5edadff871ae8281cccbc1af845688977`（HEAD `docs(changelog): prepare 0.28.2`；实现落在祖先提交 `d781cfc` / `9291d2f`；改动前基线 `4d6e2a0`）
- Working tree: tracked clean；untracked: `research/*.md`、`.proof/ask-outcome-transcript/`、`.proof/ask-real-tui-20261125/`（`git status --short` 于汇总时复核；`git rev-parse HEAD` = `15233ef…`）
- Task: 真机验收 ask 类行为（权限 ask / 问题 ask）无论用户是否回答，结局都写入 transcript，避免超时或拒绝后 AI 自行停止而用户不知原因
- Acceptance target (user verbatim) / 验收目标（用户原话）:「权限 ask，问题 ask 等 ask 类的行为，不管用户是否回答。都要把结果写在 transcript 上，避免 ask 超时，拒绝后，LLM/AI 自己停止，用户不知道为什么。」
- Changed behaviors / 改动行为:
  - `packages/bridge/src/ask-registry.ts` `#settle` / `answer` / `clearTurn` / `clearSession` / `failClosed` / `create` 显式产出 `settleReason` 与 frame `reason` → R1, R2, R3, R5
  - `packages/bridge/src/index.ts` gate signal abort 与 `disposeBinding` / teardown 结算优先级 → R3, R5
  - `packages/bridge/src/ask-journal.ts` / `ask-frames.ts` 终态字段、`childSessionId` + `redactIdentifier`、`AskSettledPayload` 无 `code?` → R1, R3, R5
  - `packages/shell/src/client/bridge-session-seam.ts` live / replay / hydrate 固定 id upsert、seq 去重、旧 journal 回退表 → R1, R4, R6
  - `packages/shell/src/client/ask-outcome.ts` 单一文案函数 → R1, R4, R6
  - `packages/tui-base/src/seams/session.ts`、`seam-rows.ts (toStoredRow)`、`seam-types.ts`、`btw-overlay.tsx` 载体与子日志过滤 → R4, R6
  - baseline method: pre-change commit worktree / checkout `4d6e2a0` + 发布 tarball `@aiwayds/dsh-opentui@0.28.1`（R7 采用后者，isolated install 后真机跑同夹具）
- Touched paths / 本次改动（`git diff --stat 4d6e2a0..15233ef`，仅列生产文件）:
  - `packages/bridge/src/ask-frames.ts`, `packages/bridge/src/ask-journal.ts`, `packages/bridge/src/ask-registry.ts`, `packages/bridge/src/index.ts`
  - `packages/shell/src/client/ask-outcome.ts`, `packages/shell/src/client/bridge-session-seam.ts`, `packages/shell/src/client/seam-types.ts`
  - `packages/tui-base/src/routes/session/btw-overlay.tsx`, `packages/tui-base/src/routes/session/seam-rows.ts`, `packages/tui-base/src/seams/session.ts`
- Evidence directory / 证据目录: `.proof/ask-real-tui-20261125/`（296 个证据/索引/清单文件逐文件 sha256；另 4 份分组 manifest 与本报告）
- Assertion total / 断言总数 N: 7（R1–R7；引用既有 45 条预期不重复计数）

## Acceptance assertions / 验收断言

> `expected` 与 `pass criterion` 两列逐字保留 `00-preregistered-expected.md` 的注册原文，**未改写为 observed**。下表 `evidence file` 列填写实际采集文件名（真机采集统一采用 `r<组>-*` 前缀；预注册表中的 `02-*.ans` 等命名与之的对应关系见本文件 Evidence index）。状态只由 `pass criterion` 对 observed 判定。

| id | assertion | expected | pass criterion (checkable) | changed path (file:function/route) | level required | evidence file | depends on |
|----|-----------|----------|---------------------------|------------------------------------|----------------|---------------|------------|
| R1 | live answer / reject：权限 ask 用户回答后立即出结局 | `ask.settled` reason=answered/rejected；journal 终态 settleReason 同值；notice 固定 id `ask-outcome:<E>`、`role='notice'`、text 非空、sessionID=父会话、同 id 行数==1；原 outcome/verdict 不覆盖 | TUI `.ans`/`.log` 与 bridge journal 原始输出中 approved 同一 eventId 含 `"reason":"answered"` + `"settleReason":"answered"`，reject 含 `"reason":"rejected"` + `"settleReason":"rejected"` 且原 `outcome`/`verdict` 逐字保留；seam 输出中 `id == details.id == ask-outcome:<E>` 的 `message.updated` 行数==1、`role='notice'`、text 非空、sessionID 等于 `session.open` 应答的父 id | `packages/bridge/src/ask-registry.ts (#settle, answer)`；`packages/shell/src/client/bridge-session-seam.ts (:5007-5011)`；`packages/shell/src/client/ask-outcome.ts` | Artifact + reverse | r1-approved-after.ans, r1-approved-after.log, r1-rejected-after.ans, r1-rejected-after.log, r1-approved-journal-scan.log, r1-rejected-journal-scan.log, r1r2-frame-assert.log, 00-pre-change.log | R7 |
| R2 | policy timeout：approval-policy 窗口到期僵尸卡撤销 | gate signal 到期走 `#settle`，终态 journal 恰 1 行 `settleReason='timeout'`，无 `aborted`；notice text 为 timeout 语义且非空；宿主 signal 未合成；`defaultOutcome` 胜出。T1–T8 跨仓只登记、本仓不判 PASS | gate 夹具原始输出该 eventId 终态行数==1 且 `settleReason='timeout'`、`aborted` 出现数==0、text 非空且 id 规则同 R1；僵尸卡计数归零；迟到 answer 不改变终态；T1–T8 在本仓记 `UNAVAILABLE`/`BLOCKED` 附四行声明 | `packages/bridge/src/ask-registry.ts (#settle)`；跨仓证据归 `/Users/qingguee/repo/dsh-approval-policy` | Artifact + reverse | r2-policy-timeout-after.ans, r2-policy-timeout-after.log, r2-policy-timeout-journal-scan.log, r1r2-frame-assert.log, r1r2-driver-console.log | R7 |
| R3 | bridge timeout + abort：deadline / hard cap 与宿主 signal 分离 | deadline / hard-cap 各自同 id `settleReason='timeout'`、frame `reason='timeout'`、journal kind `cancelled`；宿主 signal abort 落 `settleReason='aborted'`、timeout 行数==0；双信号两顺序不改写首终态；迟到 `ask.response` 不新增行；缺 reason 帧不拒收不丢帧 | deadline / hard-cap 原始输出同 eventId 含 `"reason":"timeout"` + `"settleReason":"timeout"` 且 kind=cancelled（场景标签区分）；宿主 abort 含 `"settleReason":"aborted"` 且 timeout 行数==0；双信号两顺序首终态逐字相同、终态行数==1；迟到 answer 返回 ASK_ALREADY_ANSWERED / ASK_TURN_ENDED 之一；缺 reason 帧后无 `BAD_PARAMS`、无丢帧 | `packages/bridge/src/ask-registry.ts (:304-311, :315-322, ask.abort, #settle)`；`packages/bridge/src/index.ts (:2771,2774)`；`packages/bridge/src/ask-frames.ts (AskSettledPayload)` | Artifact + reverse | r3-deadline-after.ans, r3-deadline-journal-decoded.log, r3-deadline-assert.log, r3-abort-assert.log, r3-abort-journal-decoded.log, r3-abort2-journal-decoded.raw, r3-abort2-driver-console.log | R7 |
| R4 | resume：`/resume` 后 ask-outcome notice 可见 | view key 字面 `notice:ask-outcome:<E>`（`kind:'assistant'`，无 `stored:` 前缀），text 与 live 逐字一致；stored 行 `kind='notice'`；同 id 行数==1；`sessionInfo()` 计数不变；子日志 / `/btw` 零行；`/history` 零可见（K3 缺口，不算 FAIL） | `/resume` hydrate 原始输出含 key `notice:ask-outcome:<E>` 的 view 行且 text 与 R1 逐字相等，stored 行 `kind='notice'`；hydrate + DEAD 同轮同 id 行数==1；`sessionInfo()` 各计数与 `00-pre-change.log` 逐字相同且无 `notice:ask-outcome:` 行；子日志与 `/btw` 原始输出 `ask-outcome:` 行数==0；`/history` 该 key 行数==0 并登记缺口 | `packages/shell/src/client/bridge-session-seam.ts (:4165-4182, :773-793, :820, :3276-3279, :1272-1280)`；`packages/shell/src/client/seam-types.ts`；`packages/tui-base/src/seams/session.ts`；`packages/tui-base/src/routes/session/seam-rows.ts (toStoredRow)` | Artifact + reverse | r4-live-after.ans, r4-resume-after.ans, r4-projection-assert.log, r4-journal.jsonl, r4-journal-resumed.jsonl, 00-pre-change.log | R1 |
| R5 | normal teardown：正常退出 connection-closed 落盘 | `/quit` 正常退出后 `ask.pendingIds()` 每 id 一条 `settleReason='connection-closed'` 终态 journal，行数==pending 数；无该批 id 的 `ask.settled` 帧投递成功行；restart replay 可读；`disposeBinding`：activeTurn→turn-ended，非 activeTurn→session-closed | teardown 原始输出每个 pending id 含 `"settleReason":"connection-closed"` 且行数==pending 数，无该批 id `ask.settled` 投递成功行；replay 回读含 `connection-closed`；`disposeBinding` 夹具 activeTurn id reason=turn-ended、非 activeTurn id reason=session-closed 且顺序未变；`reapHost()` 后 lock 清除 | `packages/bridge/src/index.ts (disposeBinding :3774-3828, teardown :4939)`；`packages/bridge/src/ask-registry.ts (#settle, clearTurn, clearSession)` | Artifact + reverse | r5-quit-stuck.log, r5-projection-assert.log, r5b-projection-assert.log, r5c-projection-assert.log, r5c-journal-replay.jsonl, r5c-journal-scan.log | R7 |
| R6 | questions parent / child：approved 不重复 + 子会话可见 | 父级 questions-approved（无 childSessionId）：`journalToTranscriptRows` 恰好 1 条 ask 行、0 条 notice；带 childSessionId 的 approved：1 条 notice、sessionID=父 id、父 transcript ask 行 0 条；重复帧/seq 只 1 行取最大 seq；两条不同 settleReason 终态不静默合并 | replay 原始输出父级 `kind:'ask'` 行数==1、`ask-outcome:<E>` notice 数==0；子级 notice 数==1 且 `childSessionId` 字段存在、`sessionID` 等于父 id、ask 行数==0；重复同 id/seq 后行数==1 且内容取最大 seq；两条不同 settleReason 保留可分辨记录或显式冲突标记；`sessionInfo()` 零新增、`/btw` 零行 | `packages/shell/src/client/bridge-session-seam.ts (:5007-5011, :820, bridgeReplayRowsToChildLog :1272-1280)`；`packages/tui-base/src/routes/session/btw-overlay.tsx (:288-290)` | Artifact + reverse | r6b-questions-after.ans, r6b-questions-after.log, r6b-journal.jsonl, r6b-projection-assert.log, r6-attempt1-projection-assert.log | R1 |
| R7 | 反向基线 0.28.1：同夹具改动前后差分（K4） | 改动前树 / 0.28.1 上同夹具**不产生**终态 journal / notice，改动后按 R1–R6 expected 产生；A14 三返回值/outcome 字符串逐字一致；「改动前后都失败」不算覆盖 | `00-pre-change.log`（最终 prereg 写定后重采）中 `ask-outcome:` / `settleReason` 终态行命中数==0，改动后对应夹具按各行 criterion 产生；跨 run 产品代码一致（仅 harness 改动可用 diff / bundle fingerprint 证明）；基线来源、HEAD、status 与采集命令 + UTC 留档；旧基线（03:36Z，A1–A15）不作 A16–A29 / T1–T12 反向证据 | 改动前版本：`packages/bridge/src/ask-registry.ts`, `packages/bridge/src/index.ts`, `packages/shell/src/client/bridge-session-seam.ts`（仅用于基线运行，不改本仓源码） | Artifact + reverse | 00-pre-change.log, r7-approve-journal-scan.log, r7-rejected-journal-scan.log, 09-secrets-self-test.log, 09-secrets-scan.log | — （根节点） |

## Per-assertion verdict / 逐条判定

| id | 判定 | observed（真实 journal / 帧 / 投影） | 限制（不升格结论） |
|----|------|--------------------------------------|--------------------|
| R1 | **PASS** | approved eventId `8c1df096-…:ask-1`：`ask/responded` `settleReason=answered` / `verdict=allowed-once` / `outcome=approved` / `source=answer`，`tool/result` 无 error（`E2E-TOOL-RESULT-OK`）；rejected eventId `d4e10dd1-…:ask-1`：`settleReason=rejected` / `verdict=rejected` / `outcome=denied`，`tool/result` 为 `ApprovalError / APPROVAL_REJECTED`；两夹具 notice 文案 `已收到该请求的回答` / `该请求已被拒绝`，终态行各 1 条；`r1r2-frame-assert.log` `TOTAL 18/18 PASS` | **固定 id 未取得真机 raw seam 字面行**：TUI 面板只渲染 notice 文本，不渲染 `message.updated` 的 `id`/`details.id`/`role`/`sessionID`。`ask-outcome:<E>` 与 `role='notice'` 由源码契约 + eventId 推得（R4 投影 `r4-projection-assert.log` 在 real journal 上直接产出该 id，见下），R1 本行只到推导级，未声称 TUI 观测到 raw seam id。`E2E-TOOL-DONE` 是 fake model 罐头文本，工具执行以 journal `tool/result` 为准。 |
| R2 | **PASS（本仓侧）** | scratch `dsh-approval-policy@0.3.1`，`windowSeconds:5` / `defaultOutcome:rejected`；eventId `c052b076-…:ask-1`：`settleReason=timeout` / `outcome=denied` / `code=ASK_DEADLINE_EXCEEDED` / `source=timeout`，`approval/decided outcome=rejected`（defaultOutcome 胜出），`aborted` 命中 0，终态行 1 条；after 帧 `等待该请求的回答超时` 且审批卡已撤销（`r1r2-frame-assert.log` `after card withdrawn` PASS） | **T1–T8 / X1 跨仓不判**：gate 内顺序、异步 resolve、差分证据归 `/Users/qingguee/repo/dsh-approval-policy`，本仓未采、不记 PASS（见 Excluded scope）。本行只覆盖「policy 超时 → bridge `#settle` → journal timeout、非 aborted、defaultOutcome 胜出、notice 为 timeout 语义」的本仓侧。 |
| R3 | **BLOCKED** | deadline 子项 **PASS**：eventId `df9e4a49-…:ask-1`，`settleReason=timeout` / `reason=deadline` / `outcome=denied` / `code=ASK_DEADLINE_EXCEEDED` / `kind=ask.cancelled`，终态行 1、无 aborted、notice `等待该请求的回答超时`（`r3-deadline-assert.log` 全项 PASS）。abort 子项：Escape 实测 `settleReason=rejected`（`permission.tsx:241,493` 把 Escape 绑为 Reject）；`/stop` 实测被审批卡当作 Allow 答复落 `answered`（`r3-abort2-journal-decoded.raw`） | hard-cap（默认 `maxAskWaitMs=3_600_000` = 1h，无 env/config 缩时入口）与 pending-card abort 真机入口均未覆盖，记 BLOCKED；不伪造 turn-ended。迟到 `ask.response` / 双信号两顺序 / 缺 reason 帧本轮未逐项真机触发，不声称 PASS。四行声明见下。 |
| R4 | **PASS** | live 与 `--resume-last` 面板 notice `已收到该请求的回答` 各 1 行；`r4-projection-assert.log` 在 real journal（eventId `ddff658e-…:ask-1`，`settleReason=answered`）投影出 `STORED id=ask-outcome:<E> kind=notice`、VIEW key `notice:ask-outcome:<E>` `kind=assistant` text 逐字一致、replay EVENT 1 条、`child-log-ask-outcome-lines=0`，`RESULT: PASS` | `/history` 该 key 零可见为 K3 分期缺口，登记不算 FAIL（见 Excluded scope）。首轮 fake model 拒 `reasoningEffort: high` 的失败帧保留为 `r4-attempt1-*`，非产品 FAIL。 |
| R5 | **BLOCKED** | 三路径 journal 终态：`/quit` → `answered`（卡吞键，`r5-quit-stuck.log`）；关窗 SIGHUP → `turn-ended`（reason=host-abort，`r5b-journal-scan.log`）；客户端 SIGTERM → `aborted`（`r5c-journal-scan.log`）。三条 replay 投影 `connection-closed` 行数均为 0，三份 `*-projection-assert.log` 均因「view notice text differs from live: expected 连接关闭时该请求已取消」而 `RESULT: FAIL`（即未产出目标终态） | 三种真机关闭路径都先结算为其他终态，无法产生 `connection-closed` 落盘证据；`disposeBinding` 夹具 activeTurn/non-activeTurn 优先级未在真机复现。记 BLOCKED，不伪造 connection-closed，也不冒充 PASS。四行声明见下。 |
| R6 | **PASS（父）/ BLOCKED（子）** → 整行 **BLOCKED** | 父级：real journal eventId `ca149775-…:ask-1`，`askKind=questions` / `settleReason=answered` / `outcome=approved` / `answers.count=3`，`childSessionId` 出现数 0；`r6b-projection-assert.log`：`transcript-ask-rows=1`、`stored-notice-rows=0`、`replay-notice-events=0`、`child-log-ask-outcome-lines=0`、重复/高 seq 注入后 notice 仍 0，`RESULT: PASS` | 子级 `childSessionId` 真机路由未覆盖：本轮没有真实 `use_agent`/`ask_agent` 子会话产生带 `childSessionId` 的 approved，未用合成行冒充真机。**父级 PASS 不等于整行 PASS**；按 skill §6 缺子项即 BLOCKED。四行声明见下。 |
| R7 | **PASS** | 0.28.1 tarball isolated install（`@aiwayds/dsh-opentui@0.28.1`，`--version` 实测）；approved 夹具真机审批卡出现、bash 工具执行（`E2E-TOOL-DONE`/`E2E-TOOL-RESULT-OK`）；`r7-approve-journal-scan.log` 与 `r7-rejected-journal-scan.log` 运行时 `settleReason` / `ask-outcome:` / `role notice` 命中均 0；0.28.1 静态 bundle `settleReason` x0，修复树 `packages/shell/dist/bridge/index.js` x21；`00-pre-change.log` 留档来源/命令/UTC | 首轮 rejected 变体未达成（动作未注册、工具仍执行），保留为 approve 重复；0.28.1 rejected-case 反向证据 UNVERIFIED（不作 R1-reject / R2 反向证据）。静态 absence 不替代 forward「改动后」证明，forward 由 R1–R6 承担。 |

## Evidence index / 证据清单

> 全部文件位于 `/Users/qingguee/repo/dsh-opentui-wt-ask-transcript/.proof/ask-real-tui-20261125/`。sha256 为 `shasum -a 256` 实测值。4 份分组 manifest（`r7-` / `r1r2-` / `r3-` / `r456-evidence-sha256.txt`）保存完整逐文件哈希；下表为关键判定文件 + manifest 自哈希。与 manifest 复核：除 manifest 自哈希（写入后内容变化）与 `00-pre-change.log`（§8 追加后哈希 `d29fd17…` 已在 R7 manifest 记录）外无漂移。

| file | level | what it captures | captured at (exact command/action + time) | redaction | sha256 |
|------|-------|------------------|-------------------------------------------|-----------|--------|
| 00-preregistered-expected.md | Artifact（预注册） | R1–R7 expected + criterion（未改写） | 骨架写入 2026-11-25T06:29Z | n/a | `4dfe69bafa5b7e698ee6170bf923d89b2a6be988fb0f4fc4bfda0a8c6c469dd8` |
| 00-pre-change.log | Artifact + reverse | R7 反向基线（0.28.1，§8 追加后） | R7 driver，2026-11-25T06:54Z | n/a | `d29fd17bf5cca616a8074910be1e706b39c598f79ee1ff233051b50def7bcd37` |
| r7-approve-journal-scan.log | Artifact | 0.28.1 approved 运行时 settleReason/notice=0 | r7-driver，2026-11-25T06:44Z | n/a（断言字段禁脱敏） | `20b637ed8a53699d9aafc6233c0b2b9ee2afeeabc007c504549057ab17e43a2c` |
| r7-rejected-journal-scan.log | Artifact | 0.28.1 genuine rejected 运行时 settleReason/notice=0 | r7-rejected driver，2026-11-25T06:54Z | n/a | `f8e33a7ae24b4d8b444e8bb4f72fb82e6efbab5b14dc434a06983532c9a9ea0b` |
| r1-approved-journal-scan.log | Artifact | R1 approved 终态 journal（answered） | r1r2-driver，2026-11-25T07:04Z | n/a | `c439a0127e5c00dc50f2d27b927a85a650c1ca487d8a8bb6197dabb1e50b2273` |
| r1-rejected-journal-scan.log | Artifact | R1 rejected 终态 journal（rejected） | r1r2-driver，2026-11-25T07:04Z | n/a | `390aae558f7a42a9fb36dfc9c1055ed14f0d0f829e39d1173378403046b78515` |
| r1r2-frame-assert.log | Artifact | R1/R2 数值 `.ans` 18/18 断言 | `python3 /private/tmp/dsh-r1r2-frame-assert.py …`，2026-11-25T07:05:43Z | n/a | `65e056794a2a285ca11d4681c5d5a62babff36949d7bcabadc2b7761ace93d5e` |
| r2-policy-timeout-journal-scan.log | Artifact | R2 policy 超时终态（timeout，非 aborted） | r1r2-driver，2026-11-25T07:04Z | n/a | `6ac501a1ba9f94d04290f610bc1df946b613030199c4ff77e46742c5767e5d64` |
| r3-deadline-journal-decoded.log | Artifact | R3 deadline 解码 journal（timeout/deadline） | r3-driver，2026-11-25T07:05Z | n/a | `4a0e3cd511d76913cb8e064b3c54b6ef0fd6105d8330a8b67c1651a81d8d8f1d` |
| r3-deadline-assert.log | Artifact | R3 deadline 机器断言全 PASS | r3-driver，2026-11-25T07:05:02Z | n/a | `ccfb125ab9a76cf5f0e9a3662d38a55734d973dc4cde15b53b87760ddf4164f9` |
| r3-abort-assert.log | Artifact | R3 Escape=reject 原始断言（turn-ended 期望未达） | r3-driver，2026-11-25T07:05:02Z | n/a | `b725dbadfad4e4089964bfe1ebefefbb758d2f7460ff96dc35991f00494994ee` |
| r3-abort2-journal-decoded.raw | Artifact | R3 `/stop` 被卡消费为 answered 的解码 journal | r3-abort2 driver，2026-11-25T07:09Z | n/a | `648c6eab1b3ba74c9d91cd13ef8e17f088d66b6bc1cbcc7461e1b9bf4b403901` |
| r4-projection-assert.log | Artifact | R4 real journal 投影 PASS（固定 id/kind/text） | r456-projection.mjs，2026-11-25T07:05Z | n/a | `c19febf341dd1e29d29de5f098862e452a2a9b4ed5516be1c16360711f403602` |
| r5-quit-stuck.log | Artifact | R5 `/quit` 被卡吞键→answered 原始帧 | r5-driver，2026-11-25T07:07Z | n/a | `1d4b68253651a3ca3a13cff3b0f887fc91805e7278c79f1720f50d591aa6e3b4` |
| r5-projection-assert.log | Artifact | R5 `/quit` replay 投影 FAIL（无 connection-closed） | r456-projection.mjs，2026-11-25T07:08Z | n/a | `2684159c2603098d3560d6b165a4c1d44502843bc3cc9f2da73a425328e81e90` |
| r5b-projection-assert.log | Artifact | R5 SIGHUP→turn-ended 投影 FAIL | r5b-driver，2026-11-25T07:11Z | n/a | `41cac08f89bd06ba7d1865c514c786f961fd19ef40fdb68852f199f892239945` |
| r5c-projection-assert.log | Artifact | R5 SIGTERM→aborted 投影 FAIL | r5c-driver，2026-11-25T07:13Z | n/a | `ee68be99b4005232c46f60c51304cab67df5097c12a3185d126ed0b4f9ea871e` |
| r6b-journal.jsonl | Artifact | R6 父级 questions real journal（childSessionId=0） | r6b-driver，2026-11-25T07:16Z | n/a | `13868d527ef8f07356f572eeed7d901f57fd62da77c5a82b32dc14a62b04cd18` |
| r6b-projection-assert.log | Artifact | R6 父级投影 PASS（ask=1/notice=0） | r6-projection.mjs，2026-11-25T07:17Z | n/a | `94c05cb945b182434894069d1c53561f770fab7fbd1df802b919e610ac9a82dc` |
| 09-secrets-self-test.log | Artifact | scanner negative control 10/10 | `node scripts/scan-stdio-secrets.mjs --self-test`，2026-11-25T06:45Z | n/a | `2aeae4d512abedcb1ea4d7920018cee6df8546cb7a537c1a1caad32bd48519fb` |
| 09-secrets-scan.log | Artifact | 证据目录扫描 31 文件 hits=0 | `node scripts/scan-stdio-secrets.mjs …`，2026-11-25T06:45Z | n/a | `bcbb4858ce499b8ba88db0f6bea588e2bcb6d4eb76094cf7e5b522140ecad719` |
| r1r2-evidence-sha256.txt | Artifact | R1/R2 逐文件 sha256 manifest（自哈希） | 2026-11-25T07:06:12Z | n/a | `a5525bf4cb7776c7421ddd7efd44229a4d0c6dfbb337e61f95bcd042734a5e96` |
| r3-evidence-sha256.txt | Artifact | R3 逐文件 sha256 manifest（自哈希） | 2026-11-25T07:09Z | n/a | `e1fdb10345c00cf35145558fc89251b4d10a1d47aa7ebd947ed0ccab5c807a38` |
| r456-evidence-sha256.txt | Artifact | R4/R5/R6 逐文件 sha256 manifest（自哈希） | 2026-11-25T07:17:38Z | n/a | `2c80344247d0a8f91679b48865a4bf12c4d94b6d6833d39377431478de5f294f` |
| r7-evidence-sha256.txt | Artifact | R7 逐文件 sha256 manifest（自哈希） | 2026-11-25T06:54Z | n/a | `b4014f12083effadec5beb3eeb8bc995d8855e78c001b32b2feee3ec9bc75fc8` |

### Raw output / 原始输出（关键判定文件，verbatim）

`r1r2-frame-assert.log`（sha256 `65e05679…`；`redacted: none` — 断言依赖字段未脱敏）:
```
$ python3 /private/tmp/dsh-r1r2-frame-assert.py .proof/ask-real-tui-20261125
PASS  r1-approved  boot .ans non-empty
PASS  r1-approved  card .ans non-empty
PASS  r1-approved  after .ans non-empty
PASS  r1-approved  card shows approval card
PASS  r1-approved  after shows notice text
PASS  r1-approved  after notice present
PASS  r1-rejected  boot .ans non-empty
PASS  r1-rejected  card .ans non-empty
PASS  r1-rejected  after .ans non-empty
PASS  r1-rejected  card shows approval card
PASS  r1-rejected  after shows notice text
PASS  r1-rejected  after notice present
PASS  r2-policy-timeout  boot .ans non-empty
PASS  r2-policy-timeout  card .ans non-empty
PASS  r2-policy-timeout  after .ans non-empty
PASS  r2-policy-timeout  card shows approval card
PASS  r2-policy-timeout  after shows notice text
PASS  r2-policy-timeout  after card withdrawn
TOTAL 18/18 PASS
rc=0
```

`r3-deadline-assert.log`（sha256 `ccfb125a…`；`redacted: none`）:
```
eventId requested rows=1 terminal rows=1 turn/end rows=1
PASS  terminal journal row for same eventId count==1  count=1
PASS  settleReason=timeout  observed=timeout
PASS  reason=deadline  observed=deadline
PASS  journal kind=ask.cancelled  observed=ask.cancelled
PASS  code=ASK_DEADLINE_EXCEEDED  observed=ASK_DEADLINE_EXCEEDED
PASS  notice text timeout semantics non-empty  text=等待该请求的回答超时 (ask-outcome.ts:66)
PASS  no aborted in terminal journal
```

`r4-projection-assert.log`（sha256 `c19febf3…`；`redacted: none`）:
```
TERMINAL seq=20 type=plugin:opentui/ask/responded payload={"eventId":"ddff658e-c579-418d-b18d-abcaa5575148:ask-1","kind":"ask.responded","settleReason":"answered","verdict":"allowed-once","outcome":"approved","source":"answer"}
STORED id=ask-outcome:ddff658e-c579-418d-b18d-abcaa5575148:ask-1 text="已收到该请求的回答" kind=notice
VIEW key=notice:ask-outcome:ddff658e-c579-418d-b18d-abcaa5575148:ask-1 kind=assistant text="已收到该请求的回答"
EVENT id=ask-outcome:ddff658e-c579-418d-b18d-abcaa5575148:ask-1 text="已收到该请求的回答" sessionID=8555b56c-55d9-45e0-8e4f-8da5096933b1 childSessionId=(none)
child-log-ask-outcome-lines=0
RESULT: PASS
```

`r5c-projection-assert.log`（sha256 `ee68be99…`；`redacted: none`）— BLOCKED 证据，无 connection-closed:
```
TERMINAL seq=20 type=plugin:opentui/ask/cancelled payload={"eventId":"c61f93a4-c989-4a91-97b9-1a271915d120:ask-1","kind":"ask.cancelled","settleReason":"aborted","outcome":"cancelled","source":"teardown"}
VIEW key=notice:ask-outcome:c61f93a4-c989-4a91-97b9-1a271915d120:ask-1 kind=assistant text="该请求被中止"
RESULT: FAIL: view notice text differs from live: expected "连接关闭时该请求已取消", got ["该请求被中止"]
```

`r6b-projection-assert.log`（sha256 `94c05cb9…`；`redacted: none`）:
```
sessionId=24dafec6-2e5b-4c6f-b666-764f3b6127e3 rows=28 askRows=2
TERMINAL ... askKind="questions" settleReason="answered" outcome="approved" answers.count=3
transcript-ask-rows=1
stored-notice-rows=0
replay-notice-events=0
child-log-ask-outcome-lines=0
RESULT: PASS
```

### Final secrets self-test + full-directory scan（汇总时执行）

```
$ node scripts/scan-stdio-secrets.mjs --self-test        # 2026-11-25，rc=0
self-test: PASS (every pattern caught a planted negative; scanner is not a no-op)   # 10/10 detected=true
$ node scripts/scan-stdio-secrets.mjs .proof/ask-real-tui-20261125   # 2026-11-25，rc=0
scanned files: 297
patterns: credential-sentinel, secret-value-field, secret-assignment, sk-key, ghp-token, bearer-token, auth-url-challenge, auth-url-state, auth-url-field, config-value-secret
hits=0
scan: PASS (no credential/auth URL value reached any evidence sink)
```
输出留档：`/private/tmp/dsh-final-secrets-self-test.log`（sha256 `2aeae4d512abedcb1ea4d7920018cee6df8546cb7a537c1a1caad32bd48519fb`，与目录内各 self-test 日志同内容）、`/private/tmp/dsh-final-secrets-scan.log`（sha256 `f77f76ef2f8f5184af903c2ab8f7acc57f1cc721f78b603b68213cc19eaba2de`）。`redacted: none` — scanner 只输出 pattern + 文件 + offset，从不回显命中值；**本轮无任何命中**，无需区分测试夹具与真实凭据。历史说明：R1/R2 曾观察到宽扫描 12 条 `secret-value-field` 命中（来自 R3 `r3-*-journal-scan.log` 请求头工具描述中的配置样例，非真实凭据），R3 已将该两份日志改为只含解码后 runtime 行并保留原始宽扫描于 `/private/tmp`；R3/R456/本轮复扫均 hits=0。断言依赖字段（eventId、settleReason、outcome、verdict、code、kind、seq、行数、id）全程未脱敏。

## Excluded scope / 已排除范围

| 条目 | 处理 |
|------|------|
| `/history` | K3 分期决定：本阶段零可见，另开任务；不得声称可见，也不算 FAIL（见 A12） |
| 真实强杀无 `turn/end` | 契约不保证可见 → `UNCOVERED` / `NOT RUN`，附「缺 turn/end」原始输出证据，绝不计 PASS（§2.8） |
| 增量恢复窗口缺 `ask.requested` | 契约不保证可见 → `UNCOVERED` / `NOT RUN`，附「缺 requested」原始输出证据，绝不计 PASS（§2.8） |
| X2 / 宿主 `approval/*`（`windowSeconds:0` / 策略 `never`） | 不经 bridge，本契约不覆盖，不记 PASS；宿主已写 audit，投影修复另开任务 |
| 远端 SDK / ACP | 不透传 `approvalGateExpiry`，范围外；cordis 非 4.1.0 未核、`approval/*` 是否经 `journal.replay` 下发未核，不记 PASS |
| 跨仓 X1 / T1–T8 | 证据在 `/Users/qingguee/repo/dsh-approval-policy`；本仓无证据即 `UNAVAILABLE`/`BLOCKED` 附四行声明，不记 PASS（R2 本行只判本仓侧） |
| 无绑定时 fail-closed 不写 journal（`index.ts:2790-2791`） | 既有边界，不判为新失败 |
| R3 hard-cap / pending-card abort；R5 connection-closed；R6 childSessionId 真机路由 | 本轮真机未覆盖（非 Excluded 的契约缺口，而是 BLOCKED 未覆盖项），逐条四行声明见下；不得记 PASS |

## Profile-specific section / 分项证明

DATAFLOW expected transformation（采证前写定，每跳引用）：`ask.requested journal → ask.settled/replay rows → stored notice → view notice:<id>`。
- entry：`ask.requested` journal 行（R1 `r1-approved-journal-scan.log`、R4 `r4-journal.jsonl`、R6 `r6b-journal.jsonl`，含同一 eventId 作 correlation id）。
- intermediate：终态 `ask/responded` / `ask/cancelled` journal 行（`settleReason` / `outcome` / `kind`，R1/R2/R3/R4/R5/R6 各 `*-journal-scan.log` / `*-journal*.jsonl`）。
- persistence：`STORED id=ask-outcome:<E> kind=notice`（`r4-projection-assert.log`、`r5*-projection-assert.log` 用 `bun` 直接 import 当前源码 `bridge-session-seam.ts` / `seam-rows.ts`，输入是真实 TUI 产生的 `session.v4.jsonl.zstd` 解压行，非回写值重打印）。
- exit：`VIEW key=notice:ask-outcome:<E> kind=assistant` + replay EVENT（同上投影日志）；固定 id 在 real journal 投影层直接观测到（R4），TUI 面板层只渲染 notice 文本、不暴露 raw seam id（R1 限制）。

FEATURE：正向真实命令（fake-model `--port 0` → `setup-home.mjs --home <scratch> --workspace <ws> --port <port>` in-process provisioner `--repair` → 私有 tmux socket `dsh-opentui --client` → `tmux send-keys` 触发 → `capture-pane -e -p` 存 `.ans`）见各 `*-driver-console.log`；反向基线 `00-pre-change.log`（0.28.1 同夹具不产生终态 journal / notice）。scratch-only harness 补丁仅两处（删 `reasoningEffort: high`；R3 注入 `config.askDeadlineMs: 4000`），均只改隔离 home，不改产品源码/测试。无 mock/stub 替代真实链路：`fake-model` / `mock-llm` 是真实本地 HTTP 服务，`.ans` 为 tmux 真机 ANSI 帧，journal 为 zstd 真机解压行。change ref `15233ef5edadff871ae8281cccbc1af845688977`。

U1（引用既有 45 条中的 USER-JUDGMENT 叶子）：文案是否让用户明白「AI 自己停下」、强杀孤行是否表达「未收到结果」，由用户判断；机器只判字段 / 计数 / 闭集词出现数；不进 `depends on`，不阻塞机器行。本组不新增 USER-JUDGMENT 行。

## Gate judgment / 门禁判定

- [x] Completeness：N=7，7 条逐条状态已列（R1 PASS / R2 PASS / R3 BLOCKED / R4 PASS / R5 BLOCKED / R6 BLOCKED / R7 PASS），均在合法枚举内、无空值、count=N
- [x] Binding：acceptance target 逐字引用；touched paths 声明；≥1 证据落在本 diff（R1/R3/R4/R5/R6 均执行改动代码路径并点名文件/函数）
- [x] Change ref 指向含改动的提交（非 report 提交）；Working tree 为自由文本；FEATURE/DATAFLOW 的 `changed path` 已填
- [x] 每条断言有可判定 criterion、`changed path`、evidence file；≥1 条执行改动代码路径并点名文件/函数/route
- [x] ≥1 条 change ref 上的真实驱动 I/O transcript（`r1r2-driver-console.log`、`r3-driver-console.log`、`r4-driver-console.log`、`r5*-driver-console.log`、`r6b-driver-console.log`）
- [ ] **每个改动行为一条反向用例**：hard-cap、pending-card abort、connection-closed、childSessionId 真机路由未覆盖 → R3/R5/R6 BLOCKED，gate 项不满足
- [x] 未触发 anti-cheat red line（skill §8）：无空/占位证据、无改写 expected、无 mock 替代真实链路、无旧提交截图
- [x] 无 `Claim` 级项作为 PASS 唯一依据：PASS 行均有 Artifact（+reverse）级 raw 文件
- [x] `expected` 已预注册、绝不改写为 observed；冲突采前修正；NOT RUN 不改记 UNAVAILABLE；按 `depends on` 拓扑顺序采集
- [x] `depends on` 为 DAG（R7 根 → R1/R2/R3/R5 → R4/R6），无环；无 NOT RUN、无 FAIL
- [x] 最终 secrets self-test 10/10 + 全目录 297 文件 hits=0（均 rc=0）

**PASS 条件不成立**（R3/R5/R6 含 BLOCKED），故 Gate = Result = `BLOCKED`。

Assertion status / 断言状态:
R1: PASS | R2: PASS（本仓侧；T1–T8 跨仓不判） | R3: BLOCKED | R4: PASS | R5: BLOCKED | R6: BLOCKED（父级 PASS、子级未覆盖） | R7: PASS

Status summary / 状态汇总（sum = 7）:
| status | count |
|--------|-------|
| PASS | 4 |
| FAIL | 0 |
| NOT RUN | 0 |
| UNAVAILABLE | 0 |
| BLOCKED | 3 |
| USER-JUDGMENT | 0 |
| PASS-BY-USER | 0 |

Result: BLOCKED（与 Gate 相同；无 NOT RUN、无 FAIL；BLOCKED 行 R3/R5/R6 附四行声明于下）

## Re-run evidence / 回修证据

| round | what changed | new evidence file | old criterion (verbatim) | re-gate result |
|-------|--------------|-------------------|--------------------------|----------------|
| R1/R2 首轮 | scratch patch 去掉 fake 路由不支持的 `reasoningEffort: high`，整轮重跑（首轮产物被同名覆盖） | r1-*/r2-* 全套（重跑后） | n/a | R1 PASS / R2 PASS（本仓侧） |
| R3 abort 复查 | Escape 实测=reject 后改试 `/stop`，定位卡吞键 | r3-abort2-*.ans/.log、r3-abort2-journal-decoded.raw、r3-abort2-driver-console.log | n/a | R3 abort 仍 BLOCKED |
| R4 首轮 | fake model 拒 `reasoningEffort: high`（90s 无卡），仅 scratch 补丁后重跑 | r4-live-* / r4-resume-*（保留 r4-attempt1-*） | n/a | R4 PASS |
| R5 三路径 | `/quit`→卡吞键；改试关窗 SIGHUP；改试 SIGTERM | r5-* / r5b-* / r5c-*（保留 r5-attempt1-*、r5b-attempt1-*） | n/a | R5 仍 BLOCKED（无 connection-closed） |
| R6 首轮 | 固定 Down+Enter 序列在第 3 题多按一次 Down 卡住，改为按光标逐帧驱动 | r6b-*（保留 r6-attempt1-*） | n/a | R6 父 PASS，子仍 BLOCKED |
| R7 rejected 复采 | 首轮 reject 动作无效，另起 genuine rejected 夹具 | r7-rejected-* + `00-pre-change.log` §8 追加 | n/a | R7 PASS（rejected 变体 UNVERIFIED，不作反向证据） |

## Failure rounds / 回修轮次

上述各轮均为**夹具/触发修正**（非产品实现回修），未改动任何 pass criterion（故 `old criterion (verbatim)` 全为 n/a），未新增/删除断言行（N 恒为 7）。没有以 relabel 旧文件或改写 prose 充当新轮次；每个新轮次均新增 raw 文件并给出新断言结果。

## UNAVAILABLE / BLOCKED declarations / 无法验证声明

**R3（整行 BLOCKED；deadline 子项 PASS）**
- **Reason**：hard cap 默认 `maxAskWaitMs=3_600_000`（1h，`ask-registry.ts:165,212,357-381`），构造点 `index.ts:2856` 无覆盖值、profile-patch 只暴露 `askDeadlineMs`，预算内无法真机触发；pending 审批卡时 Escape 被绑为 Reject（`permission.tsx:241,493`）、`/stop` 被卡当作 Allow 答复，无可靠 TUI abort 入口。
- **Tried**：只读核对 `ask-registry.ts` / `index.ts` 与全仓 `maxAskWaitMs` grep；真机按 Escape（`r3-abort-assert.log`：observed `rejected`、`turn-ended`=0）与 `/stop`（`r3-abort2-journal-decoded.raw`：observed `answered`）两次尝试；未启动 1h 等待，未用单测 PASS 冒充真机。
- **Excluded scope**：hard-cap 独立夹具、宿主 signal abort 真机、双信号两顺序、迟到 `ask.response`、缺 reason 帧本轮未真机覆盖；deadline 夹具与 hard-cap 共用 `settleReason=timeout` 代码路径但**不是** hard-cap 独立证据。
- **Remaining risk**：hard-cap 定时器真机是否按 1h 触发、与短 deadline 并发的首终态竞态、宿主 abort 的 `settleReason=aborted` 落盘、迟到响应不改写终态，均未验证。

**R5（BLOCKED）**
- **Reason**：ask pending 时审批卡是 dialog 模态层，`/quit` 被吞键等价于 Allow once；关窗 SIGHUP 先中止回合落 `turn-ended`，客户端 SIGTERM 落 `aborted`；三种真实关闭路径均未产生 `connection-closed`，且无可用输入在 pending 时投递正常退出。
- **Tried**：真机三路径（`/quit` → `r5-quit-stuck.log` `answered`；关窗 → `r5b-journal-scan.log` `turn-ended`；SIGTERM → `r5c-journal-scan.log` `aborted`），三份 `*-projection-assert.log` 的 `connection-closed` 行数均 0、均 `RESULT: FAIL`；未用合成 journal 行冒充真机关闭。
- **Excluded scope**：正常退出 `connection-closed` 终态落盘、restart replay 回读 `connection-closed`、`disposeBinding` 的 activeTurn→turn-ended / 非 activeTurn→session-closed 真机优先级、`reapHost()` lock 清除，均未覆盖。
- **Remaining risk**：真实用户以受支持方式正常退出时 pending ask 是否按契约落 `connection-closed`，以及 `ask.settled` 帧写路径在 `closing` 置位后是否确实短路，均未验证。

**R6（整行 BLOCKED；父级 PASS）**
- **Reason**：父级 questions 真机已完成（`r6b-projection-assert.log` PASS），但本轮未通过真实 `use_agent` / `ask_agent` 子会话路由产生带 `childSessionId` 的 approved ask（real journal `childSessionId` 出现数 0）。
- **Tried**：真机 `Ask me three questions. E2E_ASK_TRIGGER` 三题流程（`r6b-questions-after.ans/.log`、`r6b-journal.jsonl`），并注入重复/高 seq 帧验证去重；子会话路由未在夹具中可达，未用合成 childSessionId 行冒充真机证据。
- **Excluded scope**：子级 approved 的 notice 落盘、`sessionID`=父 id 语义、`childSessionId` 保留与 `redactIdentifier`、父 transcript ask 行 0 条、两条不同 settleReason 的冲突标记，均未在真机子会话中验证。
- **Remaining risk**：真实子会话里 questions/permission ask 的跨会话 notice 路由是否正确（父 id 归属、去重、冲突）未验证；父级 PASS 不能外推到子级。

**跨仓 T1–T8 / X1（R2 引用；本仓无证据，非本组 R 行）**
- **Reason**：gate 内顺序、异步 resolve、差分等断言的证据在 `/Users/qingguee/repo/dsh-approval-policy`，本仓 `.proof/ask-real-tui-20261125/` 无对应 raw 文件。
- **Tried**：本仓侧只跑 policy 超时夹具（`r2-policy-timeout-*`），确认 timeout→`#settle`→journal timeout、非 aborted、defaultOutcome 胜出；未跨仓采集 T1–T8 证据。
- **Excluded scope**：T1–T8、X1 全部跨仓断言，本仓不判 PASS、不并入本组 gate。
- **Remaining risk**：宿主 approval-policy 自身的信号顺序/并发正确性未在本仓证明，需到源仓独立验收。

## Gitignore notice / 忽略提示

`*.log` 可按仓库既有规则忽略并逐文件 sha256 登记；`00-preregistered-expected.md` 与 `report.md` 应入库以便复核。不代用户修改 `.gitignore`。本汇总任务未改源码/测试/prereg、未 commit；`report.md` 与 `research/proof-final-summary.md` 为本任务仅有的两处写入。
