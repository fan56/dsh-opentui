# ADR-0010: Session seam lifecycle contract

Date: 2026-11-18
Status: Proposed（随 ADR-0009 在 0.22.0 落地前定稿）

## Context

ADR-0009 选定宿主内 bridge（方案 D）作为 TUI 的默认会话通道。bridge 与 bun TUI 之间以 stdio JSON-lines 通信，会话身份、turn 生命周期、writer lock、append section 的语义必须在两侧严格一致，否则会重现"两个数据源分裂"的事故。本文定义 `BridgeSessionSeam` 的生命周期契约：**这是实现与握手测试的验收依据，不是设计说明**。

> 本契约同时是"上游将来若加 resume RPC"时该 RPC 的验收规格书 —— 任何上游 resume/select/open/attach RPC 必须逐条满足本文的不变量、状态机、IPC 形态与四门禁。

## 不变量 I1–I6

- **I1 — sessionId 只因用户动作变化**：仅 `/new`、`/resume` 的用户选择、启动 flag（`--session` / `--resume-last`）可以改变当前 sessionId。协议层不得存在第二个能改 id 的操作（禁止隐式 re-mint、禁止 fallback create）。
- **I2 — resume 必须 eager 真恢复**：resume 必须真实调用 `ctx.agents.resume`，恢复目标会话的历史；禁止以"创建新会话并静默采纳新 id"作为 fallback。
- **I3 — abort 只取消当前 turn**：`turn.abort` 只终止在途 turn，会话身份（sessionId）不变，历史不回滚。
- **I4 — 单 writer lock**：每个打开会话恰由一个持有者持 writer lock，close 时释放；后开者必须显式收到协议错误码 `SESSION_LOCKED`（UI 层展示为文案 `writer-held`），不得静默接管。
- **I5 — sessionId 常显（2026-11-19 用户裁决移除 footer 常显，见文末修订记录）**：原条款要求状态栏常显 sessionId 作为 I1/I2 的可观测性前提。用户裁决该 🆔 段无用，已从 footer 段、接线与测试中整体移除；session 身份仍可由 `/session info` 面板的 `session` 行等既有面查询，I1/I2 的语义与四门禁不变。本条保留编号仅为契约历史连续，不再作为 footer 渲染依据。
- **I6 — 客户端不得持有 transcript 真源**：UI 只持 sessionId 与只读投影；journal 真源留在宿主持久化层（`sessionPersistence`）。

## 状态机

**桥态**：

```
BOOTING → READY ⇄ DEAD（可恢复停泊态）
BOOTING / READY / DEAD ─close()→ CLOSED（唯一终态）

DEAD ─recover()→ RECOVERING → 重握手 → READY（三校验全过）
                              └→ DEAD（respawn 失败或任一校验不过）
```

`DEAD` 不是终态，而是**可恢复的停泊态**：连接断开后会话身份与 `onEvent` 订阅存活，经用户显式恢复回到 `READY`。**唯一终态是 `CLOSED`**（`close()` 后 `recover()` 被 `BRIDGE_CLOSED` 拒绝，`packages/shell/src/client/bridge-transport.ts:353-355,417-434`）。传输层是单一状态机（同文件 `:12-18,58-64`），`RECOVERING` 是其瞬时值而非第二台机器。

**0.22.0 阶段一：恢复仅由用户显式触发**。不做自动 respawn、不做自动退避重连（受限自动退避属阶段二）。触发入口是 R 键（`RECOVERY_RECONNECT_BIND = "r"` 与 `recover()`，recovery-ui.ts），仅在 `dead`/`failed`/`locked` 三态有效（`canRecover()`，recovery-ui.ts）；DEAD 起算 5s 冷却窗口内 `recover()` 被拒并回 `BRIDGE_RECOVERY_COOLDOWN`（`bridge-transport.ts:79,363-372`）。`RECOVERING` 期间：普通 `request()` 被拒并回 `BRIDGE_RECOVERING`（同文件 `:307-310,383`），UI composer 禁用（`composerDisabled` 仅在 `recovering` 为真，recovery-ui.ts），已输入草稿不清空（`packages/tui-base/src/routes/session/session-composer.tsx:146-148`）。理由：重连是意图明确的动作，自动重连会在三校验失败（如 fingerprint / host-compat 变更）时反复重启；composer 禁用 + 草稿保留避免用户在 in-flight 窗口重复提交又丢失输入。

**恢复序列（顺序强约束）**，传输层先于会话层：

1. **respawn**：同一 transport 实例上 best-effort kill 旧 child 并以原 path/argv/env 重新 spawn；会话身份与 `onEvent` 订阅存活，generation++ 使旧连接迟到帧无法结算新请求（`bridge-transport.ts:374-395`）。
2. **重握手三校验**：发 `bridge.hello{protocolVersion}`，三项全过才继续——`protocolVersion` 相等、fingerprint 字段齐备（`bridgeVersion` / `hostVersion`）、host-compat 版本窗（`isHostVersionSupported`）。任一不过 → 回 DEAD，`deadCause` 置 `recoverability:"permanent"` 并在 `mismatches` 报具体不匹配项（`VERSION_INCOMPATIBLE` / `FINGERPRINT_MISSING` / `HOST_INCOMPATIBLE`；`packages/shell/src/client/seam-bootstrap.ts:160-219`、`packages/shell/test/bridge-recover.test.ts:150-190`）。理由：三项决定「新 child 是否还是原来那个宿主」，任一不符则 resume 会挂到不兼容宿主，必须停在 DEAD 而非降级。
3. **`session.open{mode:"resume", id:lastSessionId}`**：eager 恢复原会话，不 replace（`recoverSession()`，bridge-session-seam.ts，从属 I2）。
4. **`journal.replay{from:lastAppliedSeq+1}` drain 完成**：`from` 为 inclusive seq 下界，无 lastSeq 时为 1；分页 drain、按 seq 去重升序后经既有 transcript 管线 apply（`recoverSession()` 的 `#drainJournal()` + `bridgeReplayRowsToSeamTranscript()` / `bridgeReplayRowsToSeamEvents()` 走 `onSessionEvent`，bridge-session-seam.ts；10e750a 落地，见下方 step 5 与修订记录）；客户端 seq 领先 journal 时 clamp 并告警、不抛错。
5. **pendingSnapshot 重建**：仅当 replay drain 完成后，才用缓冲的 `ask.pending` 快照重建卡片，`eventId` 逐字保留走既有 `ask.response` 路径；失败 / locked 分支清缓冲、不重建（`recoverSession()` 的 `#applyPendingSnapshot()`，bridge-session-seam.ts；commit `4323a82`）。理由：drain 未完成就重建会与新 replay 的 `turn.*` 竞态，产生重复或错位卡片。**适用边界（2026-11-19 修正）**：快照重建只适用于「bridge 进程仍存活、仅客户端连接断开后重连」的场景——此时上游 `AskRegistry` 仍在内存里，`ask.pending` 能给出可重建的 ask。**bridge 进程死亡（SIGKILL / 退出 / 握手失败后 respawn）时 `AskRegistry` 随进程清空，新进程发空快照，结构上不存在可重建的 pending ask**；这不是缺陷。该场景下所有 turn/ask 随进程终止，pending 卡在 `bridge.dead` 到达的瞬间即转为**「已失效」终态**并附原因（连接断开），不重建、不保留可作答假象；终态卡只可确认、不可作答，且让恢复键 R 在 dead 态立即可达（`packages/tui-base/src/routes/session/turn-overlay-controller.ts` 的 `invalidateAll` / `invalidateAsk`，`registerTurnOverlays` 的 `bridge.dead` 分支，`examples/v2-entry.tsx` 的 global 恢复层；`packages/shell/src/client/bridge-session-seam.ts` 的 `#isDeadResponseError` 纳入 `BRIDGE_DEAD`）。

**SESSION_LOCKED**：`session.open` 返回 `SESSION_LOCKED` 时 transport 保持 READY，仅会话层降为「已连接未挂载」（`recoveryState()==="locked"`、`#sessionAttached=false`），发 `bridge.recovery.locked` 事件，UI 给「重试 / 新会话」两条动作，**不提供 steal**（`recoverSession()` 的 SESSION_LOCKED 分支，bridge-session-seam.ts；`recoveryBannerLines()` / `recover()`，recovery-ui.ts；`897585d` 映射为文案 `writer-held`）。理由：写锁归属是宿主事实，客户端强抢会造成双 writer，违反 I4。

**断线期间 in-flight turn（journal 终态为准）**：turn 在 DEAD 时若在途，以 journal 的 `turn/end` / `turn/error` 终态行判定——replay 中出现宿主终态则不另画；journal 沉默（无终态行）时客户端呈现本地 `INTERRUPTED` 标记：`bridge.turn.interrupted` 事件，`code:"INTERRUPTED"`、`seq:null`、`source:"local"`，**仅客户端推断、禁止写 journal**，已 stream 的部分输出保留（`recoverSession()` 的 `bridge.turn.interrupted` 分支，bridge-session-seam.ts；`packages/tui-base/src/routes/session/seam-rows.ts:595-609`；`packages/bridge/src/index.ts:686`）。理由：journal 是 transcript 真源（I6），本地推断不得冒充宿主终态；`seq:null` 是「非 journal 事件」的溯源标签。

**DEAD 即时上屏**：DEAD 由事件驱动即时上屏——空闲期崩溃（无在途 turn）也同步回调一次 `onDead` 并转成瞬时通知（`onDead` 选项与 `bridge.dead` 帧处理，bridge-session-seam.ts；`packages/shell/src/client/seam-bootstrap.ts`）；transport 发布 `bridge.dead` 帧（`bridge-transport.ts:271,294`）。`deadCause` 带 `stage`（`spawn` / `handshake` / `runtime` / `closed`）+ `code` / `signal`，握手失败类另带 `recoverability:"permanent"` 与 `mismatches`（`bridge-transport.ts:98-122`；`BridgeDeadCause` 定义与 `asDeadCause()`，bridge-session-seam.ts）。理由：空闲期崩溃没有 `turn.error` 可承载，若不在 DEAD 时立即上屏，用户会误以为会话仍在。

**阶段二（0.22.0 不做）**：受限自动退避（≤3 次，1s/5s/15s，仅瞬态 / 未知类）、fingerprint 变化确认流、断线期间完成标记、心跳。当前实现为纯手动恢复、无 retry loop（`recoverSession()` 的「无 retry loop」注释，bridge-session-seam.ts）。

**会话态**：

```
EMPTY → OPENING(id) → OPEN(id) ⇄ STREAMING(turn)
ABORTING → OPEN(id)
OPEN → CLOSING → OPENING(newId)        （/new）
```

失败终态：

```
OPEN_FAILED{SESSION_NOT_FOUND | JOURNAL_CORRUPT | SESSION_LOCKED{holder} | VERSION_INCOMPATIBLE}
```

- `SESSION_LOCKED{holder}` 携带宿主 `SessionAlreadyOwnedError.sessionId`（被占用写锁的会话 id；错误不带该值时为 `"unknown"`），供 UI 生成 `writer-held` 诊断。该值标识**被锁会话**，不标识持有者进程身份。
- `VERSION_INCOMPATIBLE` 由握手的 `protocolVersion` + 宿主版本比对得出。

## IPC 契约

**传输**：stdio JSON-lines。三种帧：

- `request{id, method, params}`
- `response{id, ok, result | error{code, message, detail}}`
- `event{type, payload}`

**握手**：`bridge.hello` / `bridge.ping` 的响应携带 `protocolVersion`（当前 `1`）、`bridgeVersion` 与 `hostVersion`；`bridge.hello` 请求带 `params.protocolVersion` 时由 bridge 做版本比对，不一致返回 `VERSION_INCOMPATIBLE`（`detail` 含 `clientProtocolVersion` / `bridgeProtocolVersion` / `hostVersion`），对应 `OPEN_FAILED{VERSION_INCOMPATIBLE}`。

**方法面**（以 `packages/bridge/src/index.ts:1777-1842` 的分发表为准，共 10 个）：

- `bridge.ping`
- `bridge.hello`（握手版本比对：入参 `params.protocolVersion`；响应 `protocolVersion` / `bridgeVersion` / `hostVersion`，不匹配返回 `VERSION_INCOMPATIBLE`）
- `model.currentSelection`（只读；转写 `ctx.agentDefaultModel.currentSelection()`，供 seam 的 `currentModelSelection` 在首个 `session.open` 前读当前选择；由 `19c2ab2` 加入，协议版本不变）
- `session.list`
- `session.open({mode:"new"} | {mode:"resume", id})`
- `session.close`
- `session.send`
- `turn.abort`
- `ask.response`（ADR-0011 T3/T4：`{eventId, kind, verdict|answers, behavior?, escalation?}`；迟到/已结算的请求回 `ASK_TURN_ENDED` / `ASK_ALREADY_ANSWERED`）
- `journal.replay`

**事件**（两种类别，均由 `emitEvent` 走同一 `event{type,payload}` 写通道）：

- 会话/turn 生命周期：`turn.start`、`turn.token`、`turn.tool`、`turn.end`、`turn.error`（`packages/bridge/src/index.ts:847,853,858,917,926,993,1008`）
- 子代理生命周期（2026-11-19 加入，**协议版本仍为 1** —— 见下方兼容性说明）：`agent.spawn`、`agent.settle`（`packages/bridge/src/index.ts` 的 `onSessionEvent` 把宿主 `tool-workflow/agent-start|agent-end` 持久记录转发为这两个 additive 事件帧；旧客户端忽略未知事件类型，故无需 bump）。**durable agent 记录不受 turn 门控，后台 run 实时可见**：`onSessionEvent` 对这两类记录只按绑定 sessionId 过滤，不检查 activeTurn / ended —— 它们是父 journal 的持久行而非 turn 流事件，abort 后或父 turn 结束后到达的 `agent-end` 仍须结算，idle 期的后台 workflow run 也须可见（remote firehose 无此门）；turn/abort 语义不因这些帧改变。
- ask 通道（ADR-0011）：`ask.request`、`ask.cancel`、`ask.pending`、`ask.settled`（`packages/bridge/src/ask-frames.ts:24-27`；经 `packages/bridge/src/index.ts:750-830` 的 registry sink 转发）

**已知债务（P3-3，字段集一致、值近似）**：inproc `subagentViews` 的字段集与 remote 一致，但值是近似的 —— 桥只见父 journal，故 `rounds` 恒为 0、`lastLine` / `model` 缺失、settled 行的 `elapsedSec` 冻结在观测时刻；不做整体 parity 断言，也不为此伪造数据。

bridge 自身生命周期（连接断开、插件卸载等）**仍不通过 bridge 的 `emitEvent` 帧暴露**：bridge 子进程不产生生命周期 emitter；桥态 `DEAD` 的可恢复性由上文的恢复序列体现，而非某个 bridge 生命周期帧。阶段一落地后（`c9d3fae..a1341ea`），transport / seam 在 `onEvent` 管线下发并消费一组**客户端合成事件**——`bridge.dead` / `bridge.recovered` / `bridge.recovery.locked` / `bridge.recovery.failed` / `bridge.turn.interrupted`（`bridge-transport.ts:271,294`；`recoverSession()` / `bridge.dead` 帧处理，bridge-session-seam.ts）——它们不是 bridge 生产的帧，仅供本地 UI 上屏。`ask.pending` 除帧类型与 seam 消费（`onEvent` 的 `ask.pending` 分支，bridge-session-seam.ts）外，bridge 生产路径现已在 resume 时下发重连快照（`AskRegistry.pendingSnapshot` 的生产调用点见 `packages/bridge/src/index.ts:1374-1384`，commit `4323a82`），供上文恢复序列第 5 步重建卡片，见 ADR-0011 §8 与矩阵 §8。

**并发**：单会话单在途 turn；并发 `session.send` 返回 `TURN_BUSY`（`detail.turnId` 为当前在途 turn id）。

**`journal.replay` 游标语义（以实现为准）**：响应字段名是 `cursor`，不是 `journalCursor`；语义为全量日志的 exclusive 上界 `maxSeq + 1`（`maxSeq` 为本次读到的最大 `seq`，空日志为 `0`），与请求参数 `from`（inclusive seq 下界）无关 —— 响应只回 `seq >= from` 的 `rows`，但 `cursor` 始终覆盖全量日志。`session.open` 响应中另有 `journalCursor` 字段，取自 `agent.session.seq`（会话当前 seq，缺失时为 `0`），是另一个字段、另一条路径。把 replay 的 `cursor` 等同于 `session.seq` **依赖 seq 稠密**（从 0 连续分配、无压缩丢段），属**未验证假设**：宿主存储 seq 可能稀疏（turn/start、tool/call、compaction 标记占位，压缩可整段丢弃），因此「存储 seq 稀疏」与「`cursor = maxSeq + 1` 的计算」是两件事，不可混用。客户端不得用 `cursor` 反推行偏移：`skip` 是行数、`from` 是 seq 下界（见 seam 的投影注释）。

**`turnId` 归属**：由 bridge 生成（独立 UUID，不是消息 id）；后续所有 `turn.*` 事件（`turn.start` / `turn.token` / `turn.tool` / `turn.end` / `turn.error`）必须携带该字段，供客户端把事件关联到同一 turn。

**`session.list`（只读会话枚举）** —— 与实现逐字段一致：

- **请求**：`{id, method:"session.list", params?:{cursor?:string}}`。`cursor` 沿用宿主 `SessionListRequest`（预留字段，thin client 通常不传）；若出现且非字符串返回 `BAD_PARAMS`。空或缺省 `params` 合法。
- **服务解析**：`ctx.get('sessionController')`（cordis `sessionController`，与 thin client `session/list` RPC 同一服务，带 `ctx.sessionController` 直连兜底）。服务缺失（无该服务或无 `.list()`，或 cordis 抛 `cannot get property ... without inject`）返回 `UNSUPPORTED`，`detail={capability:"session.list",service:"sessionController"}`；**不得**回 `{items:[]}` 冒充成功 —— 空列表与「能力不可用」必须可区分。
- **宿主部署前提（2026-11-18 更新）**：`sessionController` 由真实的 `@deepseek-ai/dsh-api-session-controller` 插件提供。`opentui-inproc` profile 由 provision 生成本地 shim（`@aiwayds/dsh-opentui-session-shim`，提供 `fileUploads` / `workspaceRegistry` 两个 no-op 服务）满足其 13 个 inject 中 web-only 的 2 个，其余 11 个由 `dsh-base` 提供 —— **无需挂载 `dsh-web-app` bundle**。直接挂 `dsh-client-file-upload`（`fileUploads` 的真实提供方）会经 `connection → webStartup` 强制拉入 web-app，故用 no-op shim 顶替；两个依赖在 session-controller 源码里仅为 `import type`，无运行时代码依赖。桥的 `inject` 仍保持 `['agents']` 不变 —— 若把 `sessionController` 加进必填 inject，未启用 shim 的 profile 会让桥插件整体 pending、连 `bridge.ping` 都不可用。真机实测（全新 prefix + 新 DSH_HOME + 安装版 tarball）：`opentui-inproc` 启动日志无 pending / `entry not found`，`bridge.ping` 正常，`session.list` 回真实会话行（`updatedAt` 降序、字段与远端 wire 逐字段一致）；停掉 shim 注册后 `session.list` 正确回 `UNSUPPORTED`。`connection` 刻意不做 shim：若提供一个仅 no-op 的 `connection`，`dsh-api-gateway` 的可选 `ctx.inject(['connection'])` 回调会调用 `connection.rpc.intercept(...)` 而拿到不完整对象并报错；保持 connection 缺席只令 `SessionMediaReferences` 子插件 pending，不阻塞控制器激活与 `list()`。stub 会让 `create/prompt/fork` 等非 list RPC 降级为 no-op（inproc bridge 当前只暴露 `session.list`）。
- **响应**：`{id, ok:true, result:{items: SessionSummary[]}}`；`items` 为宿主 wire 行**原样透传**，不改名、不造字段、不在桥侧过滤/排序（宿主已按 `updatedAt` 降序）。`SessionSummary` 形状：
  `{sessionId:string, updatedAt:number, agentAvailable:boolean, formatStatus?:"current"|"migration-required", running:boolean, blank:boolean, parentSessionId?:string, origin?:"subagent", cwd?:string, projections?:{kind:"cached"|"sequenced", asOfSeq:number, values:object}}`；标题位于 `projections.values.title`，无顶层 `title`/`sizeBytes` 字段（远端防御性读取，缺失即缺省）。
- **只读性**：不 `agents.create/resume`、不 `open`、不取 writer lock、不改绑定（I1/I6）；无会话打开也可调用。
- **错误码**：`BAD_PARAMS`（非法 cursor）、`UNSUPPORTED`（服务缺失）、宿主异常经 `mapHostError` 映射（默认 `INTERNAL`）；无 `SESSION_NOT_OPEN`。`protocolVersion` 不变（仍为 1）。

**`session.open` 的 replace 语义（M2-1b 实现中，先按契约写）**：`session.open` 支持 `{replace:true}`——显式点名目标 id 时允许关旧开新，响应携带 `previousSessionId`（被关闭的旧会话 id）；不带 `replace` 且当前已有不同会话时返回 `ALREADY_OPEN`（`detail.openSessionId` 为当前打开的会话 id）。该操作不违反 I1：sessionId 仍只由 `open` 改变，且必须显式点名目标 id，不存在隐式 re-mint 或 fallback create。

## 子代理生命周期行派生（inproc subagent lifecycle rows）

bridge 无 subagent RPC，其 `subagentViews` 名册从父 journal 的持久行投影（`bridge-session-seam.ts` 的 `bridgeFoldAgentRecord`）。名册里有**两个行族**，配对方式与 revive 语义不同，不可混用：

- **tool-workflow 族**：`tool-workflow/agent-start`（spawn）→ `tool-workflow/agent-end`（terminal），按 `runId:seq` 配对（remote `remote-subagents.ts:152/235-249` 同款）。**不 revive**：settle 之后的 agent-start 不得复活已结算行，也不得覆盖其冻结时钟（no-revive 守卫）。
- **catalog 族**：普通 `subagent` 委托只在父 journal 落 `subagent/catalog`（childId + label/name + childCreatedAt），不发 agent-start/agent-end。**配对按 childId，不用 runId:seq**。

**settle 派生规则（catalog 族）**：宿主把异步子代理的终态写成一条 `user/message` 行，`data.source = {kind:"subagent-settled", stopReason, senderSessionId, …}`；以 `senderSessionId` 直接查 children map 结算，无需 runSeq 配对（真机证据 `ad45fecb` seq21 catalog childId 与 seq37 settle 行 `senderSessionId` 逐字相等）。`stopReason` 映射：`failed`→`failed`、`cancelled`→`cancelled`、其余（含 `completed`、未知/缺失）→`completed` 保守取值，绝不因未知原因误 paint 失败。结算行 drop `startedAt`、冻结 `elapsedSec` + `endedAt`（与 remote `SeamSubagentView` 投影同形），故已结算行不再走秒。

**aborted 残留边界（已知残留，不做兜底）**：父 turn 被 aborted 时宿主**不写**这条 subagent-settled 行（真机样本 `2d692fc9`：catalog seq24、`turn/end` aborted seq32，无 settle 行），因此该 catalog child 无终态可派生，会一直停在 `running` —— 这是 (a) 方案治不了的幽灵行。契约明确**不加 wall-clock 兜底**：客户端不得凭墙上时钟推断一个仍在运行的宿主的子代理终态，那是客户端捏造的宿主事实。aborted 父 turn 的后台幽灵作为已知残留记录在案。

**catalog 族 revive 语义**：settle 之后再次出现**同 childId 的 catalog 行**，视为该 child 的一次新 run，行回到 `running`（journal 有序无歧义：catalog 是 spawn，晚于 settle 的 spawn 必是新一次）。这是与 tool-workflow 族 no-revive 守卫相反的**分族行为**——revive 许可按**行族**判定，不做全局一刀切。revive 行用新 catalog 的 `childCreatedAt` 作 startedAt。

**catalog replay 时钟（P3-2）**：`subagent/catalog` 行携带宿主真实 `childCreatedAt`（epoch ms），replay 投影以它为 running 行的 startedAt，而非发现时刻 `now`；因此恢复（recovery）后该 child 的时长是真实值。其余不带时钟的 replay 行仍用 `now` 作发现锚点（首见起算的诚实近似）。bridge 亦在 catalog 转发的 `agent.spawn` 帧里携带 childCreatedAt（live 路径同样锚定真实时钟）。

**turn 外收敛点（P2-1）**：`sessionInfo` 的增量 journal drain 也把新行喂给同一个 `bridgeFoldAgentRecord`，使错过 live `agent.settle` 帧（catalog 族本就没有该帧）的异步 child 在 turn 之外也能收敛到 settled，无需等待下一次 turn 或 recovery 全量重放。

**callId / isError（P1-1）**：`turn.tool` 的 call 与 result 帧都带 `callId`，seam 的 `#onFrame` 把它透传给 `SeamTurnCallbacks.onToolStart/onToolRun`；`seam-rows` 据此以 `tool:live:${callId}` 为键，保证同名工具交错不撞键、args 各归各行。result 帧带宿主 `isError` 镜像，seam 映射到 `ok = !isError`（不再硬编码 `true`），失败工具不再被画成成功。

## 错误码全集

协议帧 `error{code, message, detail}` 的 `code` 取值分两类。

**宿主错误映射**（bridge 不在运行时 import 宿主包，按错误类的稳定 `this.name` 判断，避免野包副本混入）：

| 宿主错误类（`this.name`） | 协议 `code` | `detail` |
| --- | --- | --- |
| `SessionPersistenceNotFoundError` | `SESSION_NOT_FOUND` | — |
| `SessionAlreadyOwnedError` | `SESSION_LOCKED` | `holder`：取自宿主错误的 `sessionId`（被占用写锁的会话 id），缺失时为 `"unknown"`；标识被锁会话，不标识持有者进程 |
| `SessionPersistenceCorruptionError` | `JOURNAL_CORRUPT` | — |
| `SessionFormatUnsupportedError` | `VERSION_INCOMPATIBLE` | — |
| 其它 | `INTERNAL` | — |

映射依据：宿主错误类带稳定 `this.name`；bridge 不在运行时 import 宿主包（避免野包副本同型），故以 `name` 判定；宿主版本在 peer 钉死精确版本，并由 `packages/bridge/test/host-error-map.test.ts` 覆盖上述四个 `name`（含 `SESSION_LOCKED` 的 `holder` detail）及未知 name 的 `INTERNAL` 兜底。

**协议层自生 `code`**：

- `SESSION_NOT_OPEN`
- `ALREADY_OPEN`（`detail.openSessionId`）
- `TURN_BUSY`（`detail.turnId`）
- `TURN_NOT_FOUND`（`turn.abort` 请求的 turnId 不是在途 turn、也非最近已终态 turn 时返回；`detail` 为 `{requestedTurnId, activeTurnId}`，其中 `activeTurnId` 为当前在途 turn id，无在途 turn 时为 `null`）
- `SESSION_CLOSED`（`turn.error` 的 `code`：会话被 `session.open{replace:true}` 替换或被 `session.close` 关闭时，为仍在途的 turn 补发唯一的终态帧；该 turn 因所属会话结束而终止，既非模型失败，也非 `turn.abort` 的 `ABORTED`）
- `ABORTED`（`turn.error` 的 `code`：`turn.abort` 成功取消时宿主 aborted 结果未带 code 的兜底；`packages/bridge/src/index.ts:598-601`）
- `BLOCKED`（`turn.error` 的 `code`：turn 在进入模型步之前被阻断；`packages/bridge/src/index.ts:602`）
- `INTERRUPTED`（`turn.error` 的 `code`：turn 被中断；`packages/bridge/src/index.ts:603`）
- `FORKED`（`turn.error` 的 `code`：turn 因 fork 被关闭；`packages/bridge/src/index.ts:604`）
- `BAD_PARAMS`
- `BAD_FRAME`
- `UNSUPPORTED`（未知方法；亦用于 `session.list` 服务缺失，`detail={capability,service}`）
- `VERSION_INCOMPATIBLE`（亦可由握手版本比对与宿主映射得出）

ask 通道另有 7 个专用错误码（`ASK_UNKNOWN_REQUEST` / `ASK_NOT_ADDRESSEE` / `ASK_ALREADY_ANSWERED` / `ASK_TURN_ENDED` / `ASK_INVALID_RESPONSE` / `ASK_DEADLINE_EXCEEDED` / `ASK_CHANNEL_UNAVAILABLE`），定义于 `packages/bridge/src/ask-frames.ts`（`ASK_ERROR_CODES` 为全集常量），语义由 ADR-0011 §5 管辖，不在此表重复。seam 侧 `turn()` 的 `TURN_REENTRANT` 是客户端本地错误（`turn()` 的 reentrancy 门，bridge-session-seam.ts），不是 bridge 协议帧 `code`。同理，恢复通道的 `BRIDGE_RECOVERING` / `BRIDGE_RECOVERY_COOLDOWN` / `BRIDGE_CLOSED` / `BRIDGE_NOT_DEAD` 是 transport 的本地 `BridgeProtocolError` code（拒绝调用、非协议帧；`packages/shell/src/client/bridge-transport.ts:307-310,353-372`），不进入上表；`INTERRUPTED` 在恢复语义中作为本地推断标记的事件 `code`（`seq:null`、`source:"local"`）出现，与宿主 `turn.error` 的同名 code 共用词汇但来源不同。

**终态 turnId 记忆与 close/replace**：bridge 用一个有界 FIFO（上限 64、oldest-first 淘汰）记住最近终态 turnId，使重复 `turn.abort` 在 id 仍在 FIFO 时返回 `{noop:true}`。`session.close` 与 `session.open{replace:true}` 的 `disposeBinding` 会 `terminalTurnIds.clear()` 清空该 FIFO；因此 close/replace 之前刚终态的 turn，其 id 在 close/replace 后不再被记忆，重试 `turn.abort` 返回 `TURN_NOT_FOUND`（而非 `{noop:true}`）。FIFO 自然淘汰旧 id 也有同样效果。

## preset 迁移语义

- **旧 id resume 语义（条款 A）**：若会话 header 携带旧合成 preset id（如 `opentui-append-system`）：不清洗、不覆盖、不向 `agents.resume` 传递任何 `preset` 字段；append 内容由 bridge section 注入，行为与新建会话一致。理由：宿主 `AgentOptions`/`ResumeAgentOptions` 无 `preset` 字段，`dsh-agent-loop` 仅消费 `maxTokens`，多余字段被静默忽略；且 inproc 无 `agentPresets` 服务，preset 组装不发生。该 id 在 inproc 为惰性历史元数据，在 legacy opentui profile 仍为活数据（见「交替恢复」条款）。
- **观测条款（追加）**：检测到旧 id 时记一条 debug 日志，说明「id 在本 profile 不生效，append 由 bridge section 接管」；不使用 warn——该状态为预期行为。每次 resume 触发一次，不做按会话去重。

## append section 契约

> **状态说明（M3 已落地，截至 9c1dd90）**：M3-04（`bd4828b`）已在 bridge `session.open` 的 `setup` 回调中把 append section 注册到 agent scope，**无条件注入** APPEND_SYSTEM.md 派生文本；旧合成 preset id 在 inproc 为惰性历史元数据、不向 `agents.resume` 传 `preset`（条款 A），防重由挂载面结构性保证、不以 preset id 作抑制条件（条款 B，修正落地于 `a45a052`）。当前启动失败文本为 `BRIDGE_APPEND_PRESET_NOTICE = 'inproc bridge mode injects append-system via the bridge section; presets are standard only.'`（`packages/shell/scripts/lib/bridge-failfast-text.mjs`），不再声称该模式无 append 支持。以下各条是已实现的约束，按验收规格逐条核对。

- **scope 注册，禁 global**：section 必须以 scope 注册，不得注册为 global。
- **`order: 200`**：与 tui-pi 共装时会并列；tie-break 语义须由握手测试钉死（不能靠注册顺序的偶然行为）。
- **优先用 `agentCtx` 按 agent 作用域注册**：参照 tui-pi `src/session.ts:40-60` 先例。
- **字段兜底写成运行时 OR**：`subagentDepth > 0 || delegationDepthOf(agent) > 0`，不能用单一字段近似。
- **惰性读取 + mtime 缓存**：文件内容惰性读取，按 mtime 缓存，避免每次 turn 都读盘。
- **64KiB 截断落在 UTF-8 字符边界**：不得在多字节字符中间切断；截断告警仅入日志。
- **文件缺失/为空返回空串**：不影响会话打开。
- **append 注入防重（条款 B）**：不以会话记录中的 preset id 作为 section 文本的抑制条件。防重由挂载面结构性保证——不变量：同一 profile 禁止同时挂载 bridge section 与会注入 append persona 的 `agentPresets` preset；当前 inproc（只挂 bridge）与 legacy opentui（只挂 preset）满足该不变量，交替恢复各自注入一次。若未来 inproc 挂载 `agentPresets` 服务，必须在同一变更中重新引入防重，且判据必须为「服务存在 ∧ header.agentPreset 可解析为激活 preset」；仅判服务存在，会在旧 id 场景复现 M3-05 的内容丢失（commit 8e0e847）。

## 构建与打包约束（Consequences）

- `@deepseek-ai/*` 一律在 bundle 构建时标为 external；产物中只允许出现 import 语句。
- 禁止把宿主实现内联进 `dist/bridge/index.js`：野包副本与宿主实现同型，且宿主可能做结构校验，内联会引入不一致副本。
- CI 有对应断言校验上述 external 约束（确认产物中 `@deepseek-ai/*` 仅为 import、无实现内联）。

## 验收门（四项，原文照抄）

① 三条 resume 入口（`/resume`、`--session`、`--resume-last`）均能恢复历史；
② abort 后下一条消息仍在同一会话；
③ 模型能答出原会话首条消息；
④ 连续 20 轮上下文正确（含 compaction/截断交互）。

## 修订记录

- 2026-11-18 — M3-05 事后修订：撤销 `8e0e847` 的错误映射语义（`preset='standard'` 死数据 + 基于 header preset id 抑制 section，曾导致内容丢失），修正落地于 `a45a052`。按架构裁决改为条款 A（旧 id 为 inproc 惰性历史元数据，不传 `preset`）、条款 B（防重由挂载面结构性保证）与观测条款（每次 resume 一条 debug 日志，不用 warn）；append section 无条件注入 APPEND_SYSTEM.md 派生内容。
- 2026-11-19 — DEAD 条款 0.22.0 阶段一落地（commits `c9d3fae..a1341ea`，阶段二未做）：DEAD 改为可恢复停泊态、唯一终态 CLOSED；恢复仅用户显式触发（R 键 + 5s 冷却）+ 顺序强约束（respawn → 三校验重握手 → resume → replay drain → pendingSnapshot）、SESSION_LOCKED 不 steal、journal 沉默时本地 INTERRUPTED、DEAD 事件驱动即时上屏（deadCause 带 stage/code/signal）。同步更新事件面段（客户端合成生命周期事件）与错误码段（transport 本地 `BRIDGE_*`）以保持一致。
- 2026-11-19 — RM-2b 真机 V3 修正：限定 pendingSnapshot 重建仅适用于「bridge 进程存活的客户端重连」；进程死亡时 AskRegistry 随进程清空、新进程发空快照为常态非缺陷。明确进程死场景的语义：`bridge.dead` 到达即把该 bridge 内全部 pending 卡转「已失效」终态（原因：连接断开），不重建、不可作答，且 dead 态下恢复键 R 立即可达（modal 不再 gate R）。错误映射 `#isDeadResponseError` 纳入 `BRIDGE_DEAD`/`BRIDGE_CLOSED`，避免 DEAD 期作答静默消失。
- 2026-11-19 — oldfox review P1-1/P2-1/P2-2/P2-3 修正（commit `14ecb15`）：`#settleSuspendedTurn()` 结算 DEAD 遗留的在途 turn（silent-INTERRUPTED / failed / locked 退出及 newSession）并按 generation 清 busy，使下一条 turn 不再被 `TURN_REENTRANT` 拒绝；`lastJournalTurnTerminal` 增 `startOutsideWindow` 模式修终态归属（后续 writer 的 turn/start 不抢占本 turn 终态）；冷却 `BRIDGE_RECOVERY_COOLDOWN`（`detail.remainingMs`）改为短暂通知、保留 dead 态而非持久 failed banner（新 i18n key）；修正失效卡的生命周期注释（DEAD 期保留、恢复后随会话重建清除）。
- 2026-11-19 — oldfox review P1-2/P2-4 修正（commit `10e750a`）：replay drain 的行经既有 transcript 管线 apply（`projectJournalRecord` + tool 配对 projector 走 `onSessionEvent`，stable key upsert、seq/keys 双重去重），使死亡窗口内落 journal 的尾部内容上屏，并在 suspend turn 结算后 apply 以令 SETTLE SUPERSEDE 就地替换而非追加重复正文；补 dead 态 R 逃逸口的 FT（focused composer 下 r 触发恢复并被吞、ready 态 r 正常输入），记录全局优先级（终态 ask 卡保持 modal 所有权、R 为唯一恢复入口）。同步把本文 step 4/5 及 in-flight 段的过时行号改为指向符号名。
- 2026-11-19 — 用户裁决（merge 后真机 footer 复核，勿再议）：① 删除 I5 的 🆔 session-id footer 常显段，连同 v2-entry 的 sessionId 接线、recovery-ui 的 onSessionId 回调与对应测试整体移除；身份仍由 `/session info` 的 `session` 行查询，I1/I2/I3 语义不变。② `bridgeStatus` 三态只隐藏常态 `✓ ready`——`⚠ dead` / `⟳ recovering` 在异常/恢复期间照常显示，恢复完成（状态回 `ready`）自动消失；RecoveryUiController/driving 逻辑不动，仅改 powerline 段渲染条件。③ 80 列裁剪优先级表复核：`bridgeStatus` 保持最低优先级 -2，ready 常态不再占位。复核发现：🧠/⚡ 段恢复后满载条带宽于 80 列，异常段（priority -2）在裁剪时最先让位；裁决限定只改渲染条件，故不动优先级，80 列窄屏的异常信号由瞬时故障 notice / 恢复 banner 兜底。
- 2026-11-19 — oldfox 复审 P2-1(a)/P2-3/P3 小修：`onSessionEvent` 放开 durable `tool-workflow/agent-*` 的 turn 门控（只按绑定 sessionId 过滤），late `agent-end` 与 idle 期后台 run 实时可见；seam 侧 live spawn 升级加 `running` 守卫、会话切换无条件 emit 空快照、fold 采纳新 label；单测覆盖 turn 外 fold、settle-before-spawn、幂等、spawn-after-settle 不复活、切会话清名册、recoverSession 路径。同步声明 P3-3 债务：subagentViews 字段集与 remote 一致、值近似（rounds/lastLine/model 降级）。
- 2026-11-19 — oldfox 复审 P2-2 口径写实：明确 inproc bridge 无 `session` / `projections` RPC（仅 `session.list`），footer 三段由 journal 行派生而非 live projection，口径分层、不做整体 parity 断言。⚡/CH 与 remote 同公式（`lastMessage` / `session`）；🧠 为降级口径——numerator 取 journal 最新 billed `assistant/message.data.usage.totalTokens`（≈ remote `ContextTokenMeter` billed base `input + cacheRead + cacheWrite + output`），无 pending 项、无下一请求投影，turn 进行中不随 pending 上涨；分母取 journal `request/context.contextWindow` 并按 live `currentModelSelection()` 路由 guard。更正此前「formulas match remote exactly」「same journal data the remote seam uses」的笼统表述：remote 读 live usage chunk 而非 journal，桥接侧读承载同一宿主 usage 数据的 journal 行。P2-1 同步：locked banner 经 `bridge.recovery.locked` 的 `details.message` / `details.holder`（源自 bridge `error.detail.holder`）显示持有会话 id；`recovery.locked{.reason,.holder}` 模板按 message 是否已含 holder 选择，渲染超长 id 截断前 8 位。
- 2026-11-19 — oldfox 复审 9190946 修正（P1×2+P2×3+P3×3）：新增「子代理生命周期行派生」节，定稿 catalog 族 settle 派生（user/message source.kind=subagent-settled 按 senderSessionId 结算，stopReason→status 保守映射，无 runId 配对）、aborted 父 turn 无 settle 行的已知残留（不做 wall-clock 兜底）、catalog 族允许 revive 而 tool-workflow 族 no-revive 的分族语义；catalog replay 锚定 childCreatedAt 真实时钟；sessionInfo 增量 drain 接 fold 提供 turn 外收敛点。P1-1 接通 callId 透传与 result 帧 isError→ok 映射（更正 9190946 commit/bridge 注释中「callId 保住 todos」的失实表述——实际靠 seam-rows 空 argsPretty 兜底）。
- 2026-11-19 — 0.23.0 规划（用户拍板：0.22.0 先发、两项残留连同方案排 0.23；均做在 bridge 内、不拆新插件）：① aborted 幽灵 running 的正解=宿主侧 registry 对账——bridge 在 turn 末/recover 时 sweep 宿主会话注册表（`ctx.sessions` / `session.list` 的 running 标志，照抄 remote `remote-subagents.ts:277-304` 的 sweep 语义），catalog childId 已不 running 即发 settle，不做 wall-clock 兜底的前提保持；② rounds/lastLine/model 降级的正解=桥读子会话 journal（`ctx.sessionPersistence` 只读；rounds=子 journal assistant/message 行数对齐 remote 口径、lastLine=末条尾部、model=request/context 行，惰性+缓存）。拆独立插件的方案被否：唯一传输通道仍是 bridge stdio、agent 名册状态已在桥内，拆分=两份状态+重复造协议/指纹/provisioning。
