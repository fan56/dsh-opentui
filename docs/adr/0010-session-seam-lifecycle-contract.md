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
- **I5 — sessionId 常显**：状态栏常显 sessionId，这是可观测性前提 —— 没有它，I1/I2 的违规无法被用户发现。
- **I6 — 客户端不得持有 transcript 真源**：UI 只持 sessionId 与只读投影；journal 真源留在宿主持久化层（`sessionPersistence`）。

## 状态机

**桥态**：

```
BOOTING → READY → DEAD（可恢复）
```

`DEAD` 可恢复：连接断开后重新握手回到 `READY`，不销毁会话身份。

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
- ask 通道（ADR-0011）：`ask.request`、`ask.cancel`、`ask.pending`、`ask.settled`（`packages/bridge/src/ask-frames.ts:24-27`；经 `packages/bridge/src/index.ts:750-830` 的 registry sink 转发）

bridge 自身生命周期（连接断开、插件卸载等）**仍不通过事件面暴露**：seam 侧不消费此类事件，新增 emitter 只会产生无消费者的死代码。桥态 `DEAD` 的可恢复性由重新握手体现，而非某个 bridge 生命周期事件。`ask.pending` 虽已定义帧类型且 seam 侧已消费（`bridge-session-seam.ts:973-983`），但 bridge 生产路径尚未下发重连快照（`AskRegistry.pendingSnapshot` 无生产调用点），见 ADR-0011 §8 与矩阵 §8。

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

ask 通道另有 7 个专用错误码（`ASK_UNKNOWN_REQUEST` / `ASK_NOT_ADDRESSEE` / `ASK_ALREADY_ANSWERED` / `ASK_TURN_ENDED` / `ASK_INVALID_RESPONSE` / `ASK_DEADLINE_EXCEEDED` / `ASK_CHANNEL_UNAVAILABLE`），定义于 `packages/bridge/src/ask-frames.ts`（`ASK_ERROR_CODES` 为全集常量），语义由 ADR-0011 §5 管辖，不在此表重复。seam 侧 `turn()` 的 `TURN_REENTRANT` 是客户端本地错误（`packages/shell/src/client/bridge-session-seam.ts:699-705`），不是 bridge 协议帧 `code`。

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
