# 0.23.1 立项：bridge 内子代理停止能力（session→sub-agents 映射索引）

日期：2026-11-20。分支 `feat/0231-subagent-stop`，基线 `ae24a81`（v0.23.0）。
设计全文：`/private/tmp/0231-subagent-stop-design.md`；事实底稿：`/private/tmp/023-subagent-stop-facts.md`；真机证据：`/private/tmp/023-sweep-debug-accepted.jsonl`。

## 问题（0.23.0 真机主诉）

"Stop everything" / `/stop` / ctrl+g 的 shift+k 在 inproc 默认模式下停不掉子代理：
1. `BridgeSessionSeam.interruptChild` 是 D3 存根（`packages/shell/src/client/bridge-session-seam.ts:9-13`）；
2. `packages/tui-base/src/routes/session/stop-all.ts:37-46` 遇 `!seam.interruptChild` 直接 continue；
3. 确认 Stop 瞬间客户端 roster 为空（插桩 `sweep.enter roster=[]`）——即使实现也遍历不到。

结果：子代理继续跑完，只在下一 turn 边界由 registry sweep 收敛（等，不即时）。

## 已查证事实（宿主 0.2.2-rc.4）

- 宿主**无** `subagents/interruptByParent`；只有 `subagents/interruptByUser(childSessionId)`（裸串、恒 `{accepted:true}`、无终态语义）与 `session/cancel({sessionId})`（web `Session.cancel` 二选一，`dsh-api-session-controller/lib/client.js:4`）。
- bridge 是宿主内 bundle（`inject:['agents']`，`packages/bridge/src/index.ts:344`）：可 `ctx.sessionController.list` 枚举 + `ctx.agents.get(id).cancel({kind:'user'},{keepInbox:true})` 逐停；dispatcher 是 if 链（`index.ts:2081-2146`）；已订阅 `ctx.on('session/event')`（`index.ts:1409`）。
- `session.list` 行有 `sessionId/origin/parentSessionId/running/updatedAt`，**没有** stopReason/kind（真机 411 行）。
- 终态真相在子 journal：`subagent-settled` notice 的 `source.stopReason` 或子 `turn/end` 的 `reason.kind`（completed/aborted/error/max-tokens/refusal）。
- 对话框"否"= 子代理继续（`dialog-confirm.tsx:47-51`）。
- settle 现状：重复 no-op（`bridge-session-seam.ts:618,707`）；catalog 族允许迟到 catalog 复活（`:635-639`），仅 sweep settle 有 sticky（`:1170,2223-2253`）；`bridgeSettledStatus` 把非 failed/cancelled 映射 completed（`:543-545`）。

## 设计（方案 C + 用户补充的映射索引）

### 1) bridge 内 session→sub-agents 索引（用户 2026-11-20 指令）

- `Map<childId, { parentSessionId, startedAt, status, lastSeq? }>`，宿主内单例（一宿主一 bridge 一表，多 client 共享）。
- 建表：首次使用/重置时 `ctx.sessionController.list` 全量过滤 `origin==="subagent"`。
- 增量：复用 `ctx.on('session/event')`（catalog 行插入、settle/turn end 更新状态）。
- 对账：每次停止动作前与 `session.list` 快照对账（索引是缓存，宿主 list 是真源；parentSessionId 不可变，TOCTOU 无实害）。
- 不持久化，宿主重启重建。
- 收益：不依赖客户端 roster（消灭 Stop 空窗）、可观测（索引即调试面）、不杀错。

### 2) 帧契约

- `subagents.interrupt` `{parentSessionId, childId}` → `{childId, disposition: 'cancel-issued'|'already-settled'|'failed', detail?}`
- `subagents.stopChildren` `{parentSessionId}` → `{children: [{childId, disposition, detail?}]}`
- 结果字段用 `disposition`（`agent.settle` 帧已有 `outcome` 语义，不复用）。
- live settle 帧不复用 journal 行 kind 名。

### 3) 双闸权属

- 连接/会话绑定校验：`parentSessionId` 必须是请求方 bridge 会话上下文所属；不符回 ownership error，零枚举零取消（落地时按 bridge 现有 binding 模型实现，报告实际形状）。
- 行级复核：cancel 前再验 child 行 `parentSessionId===P`。
- **禁止任何全局停语义**。

### 4) settle 投影（confirm-then-emit，oldfox P0 修正后）

- `running===false` 后用 `journal.replay(childId)` 读真实 reason；读不到降级 `aborted`。
- 确认后发 settle 投影 + 置 sticky；抽 `#settleChildFromHost(childId, stopReason)` 公共函数（sweep/C3/恢复共用，sticky 三拍：fold 前记 run key → `#foldWithFrozenSettle` → `#syncSubagentMeta(false)` 单次 emit）。
- 超时降频续轮询（250ms→1s，上限 30-60s），不静默放弃。
- sweep 硬编码 completed 的路径改为走同一取因函数（C2/C3 登记 in-flight interrupt 集合或统一取因）。

### 5) 显示映射

- `bridgeSettledStatus`：aborted → 「已中止」（不可折成 completed）；T7 圈定所有 aborted 来源 + 类型/快照同步。
- seam 补 `interruptChild` + 新增 `stopChildren`；`stop-all.ts` 能力分支，无能力走旧遍历降级。

### 6) 能力协商

- handshake（hello/ping）加 additive `capabilities` 数组；老 bridge 无字段=无能力，避免逐 child 试错。

## oldfox 评审要点（有条件 GO）

P0-1 观测源不存在（list 无 reason）→ journal 取因；P0-2 5s 超时兜底断裂 → 续轮询；P1-1 sweep 硬编码 completed 吃结果 → 统一取因/跳过 in-flight；P1-2 sticky 抽公共函数；P1-3 aborted→completed 映射吞显示 → 改映射；P1-4 换绑代际 guard；P1-5 capabilities 协商；P1-6 基线必须 ae24a81。

## 任务拆分

- **L1（bridge 包）**：索引 + `subagents.interrupt`/`subagents.stopChildren` + capabilities + 单测。
- **L2（shell seam）**：interruptChild/stopChildren 实现、`#settleChildFromHost` 抽取、C3 confirm-then-emit（journal 取因 + 代际 guard）、显示映射、单测。
- **L3（tui-base）**：stop-all.ts 能力分支 + 测试。

## 验收门禁

1. 单测全绿（bridge/shell/tui-base）+ typecheck。
2. oldfox 终审。
3. 真机：Stop→即时 settle；对话框否→无帧；shift+k 单停；自然结束竞态；**S6 多会话隔离**（A/B 各带子代理互不干扰）；S7 越权帧零取消。
4. 发版：tag 驱动 CI，发布须用户当次确认。

## 未决

- 上游 issue 外发（`/private/tmp/023-upstream-issue-draft.md`）待用户确认目标仓/措辞。
- abort 自动级联（B2）等上游表态。
