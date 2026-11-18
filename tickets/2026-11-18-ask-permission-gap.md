# ask / permission 双向通道缺口调研（2026-11-18）

性质：**只读调研**。未改源码、未 commit。工作区 `feat/inproc-bridge-20261118`，HEAD `c8f891b`。
时间盒 30 分钟；关键结论均带代码位置，未核实的标 UNKNOWN。本文不含任何凭据值。

## 0. 结论先行（一句话）

**当前默认配置下（`defaultPreset: danger-full-access` / `approval: never`），审批通道缺口是"休眠"的——工具全放行、用户永远看不到审批卡，因为宿主侧 approval 策略被配置成 `never`，根本不会发起 ask；一旦把预设切成 `read-only`/`workspace-write`（`approval: ask`），宿主发起的审批在 bridge 内无人应答，走 `unavailable` 失败关闭，需要审批的工具全被拒，且客户端仍无任何提示（用户按下确认的动作不存在，因为审批卡从不弹出）。**

关键词：**不是"用户按确认无反应"，而是"根本没有审批帧下推，卡片不出现"**。
安全性判断：缺口本身是 **fail-closed（拒）**，不是 fail-open（放行）；真正让工具"全放行"的是 profile 的 `danger-full-access` 预设，那是独立配置事实，不是审批通道在工作。

---

## 1. 宿主侧契约（真实机制 + 数据结构原文）

宿主是 cordis 应用，审批与提问都走 **scoped waterfall 事件**，不是 RPC、不是回调注入。

### 1.1 审批：`approval/request` waterfall

- 服务：`@deepseek-ai/dsh-user-approval` 的 `ApprovalService`（`node_modules/.pnpm/@deepseek-ai+dsh-user-approval@0.2.2-rc.3_106cb524db0a6912bf21e510c0c35f62/node_modules/@deepseek-ai/dsh-user-approval/src/index.ts`）
- 事件声明（`src/types.ts:87-91`）：
  ```ts
  'approval/request'(
    this: Scoped<Agent>,
    req: ApprovalRequestEvent,
    next: () => Promise<ApprovalOutcome>,
  ): Promise<ApprovalOutcome>
  ```
- 请求结构 `ApprovalRequestEvent`（`src/types.ts:63-76`）：
  ```ts
  export interface ApprovalRequestEvent {
    readonly agent: Agent                 // 路由身份
    readonly toolName: string
    readonly callId?: ToolCallId
    readonly reason?: string
    readonly displayReason?: { readonly en: string; readonly [locale: string]: string }
    readonly signal?: AbortSignal          // 取消 lifetimes
  }
  ```
- 应答词汇 `ApprovalOutcome`（`src/types.ts:32`）：`'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`；**只有 `allowed-once` 是放行**（`src/index.ts:238`、`dsh-tools/lib/pipeline.js:636-653`）。
- 审计事件：`approval/asked` / `approval/decided`（`src/types.ts:34-59`）。
- 策略（`src/index.ts:68`、`170-172`）：`ApprovalPolicy = 'ask' | 'never'`，默认 `'ask'`；`'never'` 在确定性地 `rejected`（`src/index.ts:301`）。
- **无人应答时**（waterfall 全部 `next()`）：fallback `() => Promise.resolve('unavailable')`（`src/index.ts:306-310`）；抛错的 answerer / 非词汇返回值也被归一成 `'unavailable'`（`src/index.ts:311-318`）。
- 工具侧消费（`dsh-tools/lib/pipeline.js:618-655`）：`allowed-once → allow`；其余分别映射 `APPROVAL_REJECTED` / `APPROVAL_CANCELLED` / `APPROVAL_UNAVAILABLE` 的 deny（`:641-651`）；**`ctx.get('approval')` 取不到服务时也直接 deny**（`:619-623`）。

### 1.2 提问：`user-questions/request` waterfall

- 服务：`@deepseek-ai/dsh-user-questions`（`lib/index.js`）
- 事件声明（`lib/types/types.d.ts:174`）：
  ```ts
  'user-questions/request'(this: Scoped<Agent>, request: AskUserQuestionRequestEvent,
                           next: () => Promise<AskUserQuestionAnswer>): Promise<AskUserQuestionAnswer>
  ```
- 分发（`lib/index.js:708-711`）：`ctx.waterfall(scopeTarget(agent, agent), 'user-questions/request', {...request, agent}, noAnswerer)`。
- **无人应答时**：`noAnswerer = () => Promise.reject(new UserQuestionError("no user-questions answerer accepted the request", "NO_PROVIDER"))`（`lib/index.js:706`）→ `ask_user_question` 工具报错，等价于拒绝。
- 还有一条带超时的 RPC 路 `askTimed` / `userQuestions/attachWait`（`lib/index.js:621-626`）；waterfall 路无超时状态机（`remote-waterfall.ts:25-35` 解释了为何客户端选 waterfall 而非 RPC）。

### 1.3 谁注册 answerer

- 远端拓扑：`dsh-api-gateway` 把 waterfall 转成 `$events` 帧推给客户端，客户端用 `$events/result` 应答（见 §2）。
- in-process TUI 拓扑：宿主 UI 应用自己注册 answerer（本仓不含该宿主应用）。
- **inproc bridge 拓扑**：bridge 只订阅 `session/event` 与 `agent/assistant-stream`（`packages/bridge/src/index.ts:833-834`），**没有注册任何 `approval/request` 或 `user-questions/request` answerer**；全依赖树 grep 只命中 `ApprovalService` 自身的 waterfall 调用点，无任何 `.on('approval/request')` 注册（见 §5 证据）。

---

## 2. 现有 remote 路径怎么做（逐项 RPC/事件名与字段）

| 位置 | 机制 / 名称 | 字段原文 |
|---|---|---|
| `packages/shell/src/client/mux-frame.ts:50-57` | Host→client 帧 `EventsWaterfall` | `{type:"waterfall", event, eventId, agentId, request:{[k]:RemoteJson}}` |
| 同文件 `:59-66` | Host→client `EventsCancel` | `{type:"cancel", eventId}`（取消已下发的 waterfall） |
| `remote-host-session.ts:2652-2677` | 路由：`event === "approval/request"` → `#onApprovalRequest`；`event === "user-questions/request"` → `#onQuestionsRequest`；其余 `delegate`（`next`） | `claims()` 用 `frame.agentId === sessionId` |
| `remote-host-session.ts:2682-2714` | 审批应答 | `cb.onApprove(toolName, args)` → `"allowed-once"`/`"rejected"`，异常或 `cb===undefined` → `"unavailable"`（fail closed，`:2685-2687, :2706-2708`） |
| `remote-host-session.ts:771-773` | 提问注册 | `registerAskProvider(onAsk)` 仅存 `#askProvider` |
| `remote-host-session.ts:2716-2734` | 提问应答 | `questionsView` → `#askProvider(picks)` → `answersValue` / 异常时 `declinedValue` |
| `remote-waterfall.ts:11-16, 123-125` | client→Host 应答 RPC | `rpc("$events/result", {clientId, eventId, outcome})`；`outcome = {kind:"next"} \| {kind:"result", value} \| {kind:"rejected", error}` |
| `remote-waterfall.ts:42` | verdict | `RemoteApprovalVerdict = "allowed-once" \| "rejected" \| "unavailable"` |
| `remote-waterfall.ts:47-71, 96-101` | 问题/回答结构 | `RemoteQuestion{id,prompt,header?,description?,detail?,options[{label,description?}],multiSelect?}`；`RemoteQuestionAnswer{questionId,selected,selections?,custom?}` |
| `remote-waterfall.ts:158-163, 174-192, 206-230` | 投影 | `approvalView→{toolName,callId?,reason?}`；`questionsView`；`answersValue`（`{answers:[{id,selected[],custom?}]}`）/ `declinedValue`（`custom:"declined"`） |
| `session-seam-adapter.ts:340-357, 367-371` | seam↔facade 适配 | `onApprove: verdict === "allowed-once"`（其余布尔 false，fail closed）；`registerAskProvider` 结构透传 |
| `remote-session-ops.ts:81-129` | **仅**journal 回放投影 | 把 `ask_user_question` 的 `tool/call`+`tool/result` 合并成 `SeamTranscriptRow{kind:"ask"}`；无活跃审批/提问通路 |

---

## 3. bridge 现状缺口

### 3.1 `packages/bridge/src/index.ts` 无任何 ask hook

- 结构宿主面 `BridgeContext`（`:78-101`）只有 `logger/effect/on/get/appExit/agents/agentDefaultModel/sessionPersistence/sessionController`；**无 `approval`、无 `userQuestions`**。
- `inject` 仅 `['agents']`（`:240`）。
- `emitEvent`（`:621-623`）的全部调用点只发 5 种帧：`turn.start`（`:629`）、`turn.token`（`:635,640`）、`turn.tool`（`:770,785`）、`turn.end`（`:699`）、`turn.error`（`:708`）；`onSessionEvent`（`:739-796`）只识别 `turn/start`、`assistant/message`、`tool/call`、`tool/result`、`turn/end`。
- 分发表（`:1350-1389`）无 ask 相关 method。
- ADR-0010 只声明了这 5 种事件（`docs/adr/0010-session-seam-lifecycle-contract.md:69-77`）。

### 3.2 `packages/shell/src/client/bridge-session-seam.ts` 降级点

| 成员 | 位置 | 降级行为 |
|---|---|---|
| `registerAskProvider` | `:593-596` | 空注册（不保存 provider）+ `logger.warn`："no ask/permission frames; provider registration is empty (ask/approve unavailable)" |
| `turn(...).onApprove` | `:488-492` | `turn()` 开头 warn "bridge has no ask/permission frame; onApprove will not fire"；**回调永远不被调用** |
| `onSessionEvent` | `:443-453` | warn "permission.asked / bridge.shutdown absent"，但仍登记 listener（只收 5 种 turn.* 投影，`:206-227`） |
| `projectBridgeEvent` | `:206-227` | 不投影 `permission.asked`（wire 上不存在） |
| `bridgeReplayRowsToSeamTranscript` | `:174-194` | ask 行只做 transcript 投影（与 remote 共用的 `journalToTranscriptRows`），非活跃通道 |

降级机制：`#degrade` / `#degradeOnce`（`:614-623`）——只 warn，不抛错。

### 3.3 降级后 UI 会发生什么（关键）

- 审批卡由 `TurnOverlayController.requestApproval()` 创建（`packages/tui-base/src/routes/session/turn-overlay-controller.ts:145-151`），而它正是 `SeamTurnCallbacks.onApprove` 的 view 侧入口（同文件 `:145` 注释；`seam-rows.ts:675` 把 `onApprove` 接到该入口）。
- bridge seam 从不调用 `cb.onApprove`（§3.2），**审批卡从不出现**，所以不是"用户按确认无反应"，而是**没有可按的确认**。ask panel 同理：provider 未保存，提问帧不会下推。
- 当前仓库中 `BridgeSessionSeam` 只在自身文件与测试里出现（grep 无生产装配点），**尚未切成默认 seam**——这是潜在缺口，不影响已发布默认路径。能力矩阵也把它列为阶段一"可按 D3 降级撑过"（`tickets/2026-11-18-seam-capability-matrix.md:88`），但同时要求"必须在 UI 明示不可用，不能静默吞掉"。

---

## 4. 最小实现面与工作量（若阶段一必须支持审批）

需要**双向新帧**，这是 19 个成员里唯一需要新协议语义而非单纯补帧的缺口（矩阵 `:69` 标 D 级）。

新增帧（建议统一一对，用 `kind` 区分审批/提问）：

| 方向 | 帧 | 字段 |
|---|---|---|
| host→client（event） | `ask/request`（或沿用 `permission.asked` 语义） | `{eventId, sessionId, agentId, kind:'approval'\|'questions', toolName?, callId?, reason?, questions?[{id,prompt,header?,description?,detail?,options[{label,description?}],multiSelect?}]}` |
| client→host（request） | `ask/answer` | `{eventId, verdict:'allowed-once'\|'rejected'\|'unavailable'}`，提问时 `{eventId, answers:[{id,selected[],custom?}]}` |

bridge 需 inject / 接线：

- `ctx.get('approval')` + `ctx.on('approval/request', ...)` 注册 scoped answerer：emit 下推帧 → 等待 `ask/answer` → 返回 verdict；按 `scopeTarget`/session id 过滤，防止跨会话串帧（照 `onSessionEvent` 的 gate 模式，`index.ts:739-743`）。
- `ctx.on('user-questions/request', ...)` 同理（若支持提问）。
- `BridgeContext` 增加 `approval`/`userQuestions` 结构切片；`inject` 视 cordis 解析需要决定是否加入。
- 关联表 `eventId → {resolve, signal}`；**取消**：`req.signal` abort 时 settle `cancelled` 并丢弃迟到答案（宿主已有此语义，`dsh-user-approval/src/index.ts:319-332`）；**超时**：宿主 waterfall 无超时，需决定是否由 bridge 设上限（否则客户端掉线会挂住 turn）；**并发多请求**：用 Map by eventId，不复用单槽；**callId/args**：`turn.tool` 帧当前无 callId（矩阵 `:37`），审批要显示 args 需在 ask 帧里补带或从 journal 取。

seam 需改：

- `registerAskProvider`：真正保存 provider；收到 `ask/request(kind=questions)` → provider → `ask/answer`。
- `turn()`：收到 `ask/request(kind=approval)` → 调用 `cb.onApprove(name, args)` → `ask/answer`；删除/改写 `:492` 的降级 warn。
- `projectBridgeEvent`/`onSessionEvent`：新增 `permission.asked` 投影与取消帧处理。

工作量粗估（每项 ≤30m）：

1. 帧契约 + ADR-0010 增补（版本/事件面）— 0.5 项
2. bridge：`approval/request` answerer + `ask/request` 下推 — 1 项
3. bridge：`ask/answer` 分发表 + eventId 关联/取消/超时/并发 — 1 项
4. bridge：`user-questions/request` answerer（若含提问）— 1 项
5. seam：`registerAskProvider` + 提问帧→provider→answer — 1 项
6. seam：`turn().onApprove` 接审批帧 + args/callId — 1 项
7. 测试（bridge 帧 + seam 映射 + 取消/并发/超时）+ UI "unavailable" 明示 — 1~2 项

合计 **约 7~9 个任务**（含提问约 9，只做审批约 7）。UNKNOWN：`ctx.get('approval')` 在 bridge bundle 内是否可直接取到、cordis scoped waterfall 订阅是否需要对 `this` 做额外 gate——需一次真机触发验证（矩阵 `:100` 同样标 UNKNOWN）。

---

## 5. 风险：保持降级的实际后果（代码依据，最关键）

### 5.1 通道本身的语义 = fail-closed（拒绝）

- 宿主 waterfall 无 answerer → fallback `'unavailable'`（`dsh-user-approval/src/index.ts:306-310`）；`'never'` 策略直接 `'rejected'`（`:301`）。
- 工具侧 `unavailable/rejected/cancelled` 全部映射为 deny，只有 `allowed-once` 放行（`dsh-tools/lib/pipeline.js:636-653`）；无 `approval` 服务也 deny（`:619-623`）。
- 提问路无 answerer → `NO_PROVIDER` 错误（`dsh-user-questions/lib/index.js:706`）。
- bridge 无 answerer 注册（§3.1；全依赖树仅命中 `ApprovalService` 自身 waterfall 调用，无 `.on('approval/request')`）。
- ⇒ **只要宿主真的发起 ask，结果一定是拒绝/报错，绝不会放行。**

### 5.2 但当前默认配置让 ask 不发（所以"工具全放行"）

- `packages/shell/scripts/provision-inproc-profile.mjs:462-475`：`presets.danger-full-access = {sandbox:'danger-full-access', approval:'never'}`，`defaultPreset: danger-full-access`。
- `dsh-permission-presets` 在 `agent/created` 时用 `setApprovalPolicy(session, spec.approval)` 给会话播种策略（`lib/index.js:193-195, 383-394`）；默认即 `never`。
- `never` 下 `ApprovalService.decide` 在 dispatch 前直接返回 `'rejected'`（`dsh-user-approval/src/index.ts:301`）。
- profile 盘点复核：`tickets/2026-11-18-inproc-profile-inventory.md:56, :200-201` 确认 patch 覆盖为 `danger-full-access`；其 U4（`:242`）明确"未验证实际审批行为"。
- ⇒ **默认 inproc bridge：工具不受审批门禁约束（full access），审批卡不出现，缺口休眠。**

### 5.3 切到 `ask` 预设后 = 工具全被拒

- `/permission read-only` 或 `workspace-write`（两者 `approval:'ask'`，provision 脚本 `:466-471`）会把策略置 `ask`；此后需要审批的操作发起 `approval/request`，bridge 无人应答 → `unavailable` → deny（`APPROVAL_UNAVAILABLE`，`dsh-tools/lib/pipeline.js:649-651`）。
- 用户侧：审批卡从不出现（§3.3），用户无法放行任何需要审批的操作；表现为"某工具突然失败，报错 no approval channel available"，而非"点了没反应"。

### 5.4 结论对照表

| 场景 | 实际行为 | 依据 |
|---|---|---|
| 默认 profile（danger-full-access / never） | 工具全放行；审批卡不出现；缺口休眠 | provision `:462-475`；inventory `:200-201`；approval `src/index.ts:301` |
| 切到 ask 预设（read-only/workspace-write） | 需审批工具全被拒（fail-closed），提问工具报 NO_PROVIDER；无 UI 提示 | approval `src/index.ts:306-318`；tools `pipeline.js:641-651`；questions `lib/index.js:706` |
| 是否"用户按确认无反应" | 否——卡片从不弹出 | `turn-overlay-controller.ts:145-151` + seam 从不调用 onApprove |
| 是否 fail-open / 全放行（因通道缺陷） | 否——通道缺陷只会拒；放行来自独立配置 | §5.1 全部 |

---

## 6. 三个候选（供拍板）

| 候选 | 一句话 | 代价 | 风险 |
|---|---|---|---|
| **A 保持降级 + ADR 写清后果** | 不改码；在 ADR/文档写明"bridge 默认 full-access、无审批 UI；ask 预设下需审批工具会被拒"，并把矩阵 `:100` 的 UNKNOWN 结案 | 0 码改动；一份 ADR 更新 + UI/文档警示位 | 阶段一若有人切 `ask` 预设，审批工具静默失败且无提示；安全姿态依赖用户不误切预设；与矩阵 `:88`"不能静默吞掉"的要求冲突，需补 UI 明示 |
| **B 最小 ask 通道（只 allow/deny）** | 只做 `approval/request` 一对帧（下推 + 回传 verdict），不做 user-questions、不做超时/取消精细化 | 约 5~7 任务；bridge inject approval + 新帧 + seam onApprove 接线 | 提问（ask_user_question）仍失效；无取消/超时则客户端掉线时 turn 挂住；多并发请求需最小 eventId 关联；需先验证 `ctx.get('approval')` 可用 |
| **C 完整对齐 remote** | 审批 + 提问双向帧齐备，含取消、超时、并发、failed/declined 信封、审计对齐 | 约 8~10 任务 + 真机验证；协议版本/ADR 变更 | 范围最大、周期最长；宿主 scoped waterfall 订阅与跨会话隔离需真机调；与阶段一其它门禁争抢时间 |

---

## 7. 需用户拍板的点

1. **默认安全姿态**：保持 `danger-full-access`（工具全放行、无审批）是否符合预期？inventory U4 已标"是否用户有意未验证"。
2. **阶段一是否必须审批**：若非门禁项，选 A（写清后果）即可；若必须，选 B 还是 C。
3. **若选 B/C**：是否同时覆盖 `user-questions`（ask_user_question），还是只做工具审批。
4. **取消/超时策略**：客户端掉线或 turn 中断时，未答审批是拒绝、取消还是挂起？bridge 是否设超时上限。
5. **UI 明示义务**：即便选 A，是否在 UI 显示"审批不可用（inproc bridge）"——矩阵 `:88` 要求，当前实现只有 `logger.warn`。
6. **UNKNOWN 需真机确认**：`ctx.get('approval')`/`ctx.on('approval/request')` 在 bridge bundle 内可用性与 scoped gate（矩阵 `:100`）。
