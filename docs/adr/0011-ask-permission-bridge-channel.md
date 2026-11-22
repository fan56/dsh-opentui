# ADR-0011: Ask / permission bridge channel

Date: 2026-11-18
Status: Proposed（随 ADR-0010 在 0.22.0 落地前定稿）

> 本文以源码为准核对了 blocky 草案的未验证内容（草案作者无文件工具，所有行号与字段名未核对）。凡草案与源码不符之处均按源码改写，改动逐条列在文末「草案偏差记录」。已拍板决策（方案 C + 默认预设改需审批）原样保留；四个未拍板项中 **Q1/Q2/Q3 已于 2026-11-18 按推荐值确认并随 T2 实现（见 §8）；Q4 已于 2026-11-19 按推荐值确认并随 T8 实现（本提交，基于 `1b103dc`，见 §8）**。

## 1. 背景（Context）

ADR-0010 把 bridge 定义为 TUI 的默认会话通道，事件面**当前仅** `turn.*` 五种（`turn.start` / `turn.token` / `turn.tool` / `turn.end` / `turn.error`，见 `docs/adr/0010-session-seam-lifecycle-contract.md:69-77`、`packages/bridge/src/index.ts:621-623,629,635,640,699,708,770,785`）。bridge 的 `BridgeContext` 无 `approval` / `userQuestions`，`inject` 仅为 `['agents']`（`packages/bridge/src/index.ts:77-101,240`），订阅只有 `session/event` 与 `agent/assistant-stream`（`packages/bridge/src/index.ts:833-834`），从无 `approval/request` 或 `user-questions/request` 的 answerer。因此宿主发起的审批 / 提问在 bridge 内**无人应答**。

调研（`tickets/2026-11-18-ask-permission-gap.md:6-11,154-185`）已确认该缺口的真实语义：

- 宿主 waterfall 无 answerer → approval 回退 `'unavailable'`（`dsh-user-approval/src/index.ts:306-310`）、questions 报错 `NO_PROVIDER`（`dsh-user-questions/lib/index.js:706`）；工具侧只有 `allowed-once` 放行，其余（含 `unavailable`）全部 deny（`dsh-tools/lib/pipeline.js:618-655`）。缺口是 **fail-closed**，不是 fail-open。
- 当前 profile 默认 `danger-full-access` / `approval: never`（`packages/shell/scripts/provision-inproc-profile.mjs:490-493`），宿主确定性地不发起 ask，所以缺口"休眠"；一旦切到 `read-only`/`workspace-write`（均 `approval:'ask'`，同文件 `:484-489`），需审批工具会被**静默全拒**，且由于 bridge seam 从不调用 `onApprove`（`packages/shell/src/client/bridge-session-seam.ts:488-492`）、`registerAskProvider` 为空注册（同文件 `:593-595`），审批卡与提问面板**从不出现**——用户看到的是"工具突然失败"，而不是"点了没反应"。

HEAD `46ed988` 已把 bridge seam 设为 inproc 默认并 deprecate `--remote`（`feat(seam): default to bridge seam in inproc mode...`），因此该缺口从"潜在"变为"默认路径上的真实缺口"。本文定义一条完整的 ask/permission 双向帧通道，把宿主 waterfall 的审批 / 提问接到 TUI 的审批卡与提问面板。

## 2. 决策（Decision）

以下几项**已由用户拍板**，不在本文讨论范围：

- **D1 — 方案 C：完整对齐 remote。** 审批 + 提问双向帧齐备，含取消、超时、并发、fail-closed 显式化、审计/持久对齐（`tickets/2026-11-18-ask-permission-gap.md:188-194` 候选 C）。
- **D2 — 默认预设改为需审批。** 把 `provision-inproc-profile.mjs:490-493` 的 `defaultPreset: danger-full-access` 改成需审批预设。原前提「等 T1–T8 全部落地后再改」已按落地现实调整：**T9 已先落地**（改为 `workspace-write` + `approval: ask`，见 §6 / §10），**T8（显式 fail-closed + UI 明示）仍开放**；提前落地的风险由 pre-execute gate 默认开启承担（gate `enabled: true`，写类工具 `ask`，见 §6）——缺审批通道时工具按 fail-closed 拒绝而非放行，`DSH_OPENTUI_APPROVAL_GATE=off` 为逃生门。
- **D3 — 5 帧命名空间**：`ask.request` / `ask.cancel` / `ask.pending` / `ask.settled` / `ask.response`。帧名沿用 bridge 的 `turn.<verb>` 点分小写风格（`packages/bridge/src/index.ts:629,635,699,708,770`），不沿用宿主 `$events` 的斜杠风格（`approval/request`，`packages/shell/src/client/remote-waterfall.ts:1-35`）。
- **D4 — first-wins 结算**：同一 ask 恰好结算一次，第二次应答一律拒绝，不改状态。
- **D5 — turn 结束强制清场**：turn abort / 终态 / 会话 close / replace 时把所有 pending ask 一次性 cancel，迟到应答不得改写已终态 ask。
- **D6 — 显式 fail-closed**：无 provider / 无服务 / 应答异常 / 超时一律落 `unavailable`（与宿主契约一致，`packages/shell/src/client/remote-waterfall.ts:42`、`packages/shell/src/client/remote-host-session.ts:2702-2708`），不在 UI 静默吞掉。
- **D7 — 决策进 journal + 'always' 走会话级摘要**：每次结算写 journal；`behavior:'always'` 的效果以会话级权限摘要承载，compaction 清事件但不清效果。

## 3. 契约（Contract）

### 3.1 帧形态（对齐 ADR-0010 §IPC 契约）

沿用三种帧（`docs/adr/0010-session-seam-lifecycle-contract.md:50-55`）：

- `event{type, payload}`：下推帧，`type` 为 5 个 `ask.*` 名之一；`emitEvent` 已按此形状写帧（`packages/bridge/src/index.ts:621-623`）。
- `request{id, method, params}` / `response{id, ok, result | error{code, message, detail}}`：回传帧走现有 dispatch（`packages/bridge/src/index.ts:508,608-616,1335-1389`）。

**关联键统一为 `eventId`**，取值 `${turnId}:ask-${seq}`（turn 作用域内单调）。理由：bridge 请求帧的关联键是 `id`（`string | number`，`packages/bridge/src/index.ts:508,528-529`），宿主 waterfall 的关联键是 `eventId`（`packages/shell/src/client/mux-frame.ts:51-57`）——草案里的 `requestId` 字段在两者中都不存在，故按源码改写为 `eventId`（见偏差记录 ②）。`id` 仍用于 bridge 请求/应答配对，`eventId` 用于 ask 生命周期关联，二者职责不同。

### 3.2 五帧逐项定义

| 帧 | 方向 | 字段 | 源码依据 |
| --- | --- | --- | --- |
| `ask.request` | host→client (event) | `eventId, sessionId, kind:'approval'\|'questions', toolName?, callId?, reason?, questions?[{id,prompt,header?,description?,detail?,options:[{label,description?}],multiSelect?}], deadlineAt?, detachGraceMs?, escalation?` | 字段取自 `approvalView`/`questionsView`（`packages/shell/src/client/remote-waterfall.ts:158-163,174-192`）与宿主 `ApprovalRequestEvent`（`tickets/2026-11-18-ask-permission-gap.md:30-40`） |
| `ask.cancel` | host→client (event) | `eventId, reason:'host-abort'\|'superseded'\|'deadline'\|'no-provider'` | 对应宿主 `signal` abort / turn 终态 / cancel 帧（`packages/shell/src/client/mux-frame.ts:59-63`；`tickets/2026-11-18-ask-permission-gap.md:132`） |
| `ask.pending` | host→client (event, 重连快照) | `sessionId, asks:[ask.request 的快照]` | 重连后 client 重建 pending 卡片 |
| `ask.settled` | host→client (event, 结算广播) | `eventId, outcome:'approved'\|'denied'\|'cancelled'\|'unavailable'` | first-wins 后广播，供其它 surface 收敛 |
| `ask.response` | client→host (request) | `params:{eventId, kind, verdict?:\|'allowed-once'\|'rejected'\|'unavailable', answers?:[{id,selected[],custom?}], behavior?:'once'\|'always'\|'session', escalation?:boolean}` | 应答词汇对齐 `RemoteApprovalVerdict`（`packages/shell/src/client/remote-waterfall.ts:42`）与 `answersValue`（同文件 `:206-223`） |

**字段取舍说明**：草案的 `outcome/behavior/optionId/feedback` 不是任何真实签名（见 §3.4 与偏差记录 ④）。本文把它拆成两层：wire 层用源码里真实存在的 `verdict`（二/三值）与 `answers`（`{id,selected[],custom?}`）；`behavior`（once/always/session）保留在 `ask.response` 供 bridge 消费——bridge 把 `always` 折算成 D7 的会话级权限摘要，再以 `allowed-once` 应答宿主 waterfall（宿主 `ApprovalOutcome` 只有 `allowed-once` 是放行，`tickets/2026-11-18-ask-permission-gap.md:41`）。`optionId` 折进 `answers[].selected`，`feedback` 折进 `answers[].custom`（`packages/shell/src/client/remote-waterfall.ts:206-223`）。

### 3.3 状态机（first-wins + turn 清场）

```
                 ask.request
   (none)  ───────────────────▶  pending(eventId)
                                    │
              ask.response / cancel / timeout
                                    ▼
                               settled(once)
                                    │
                            ask.settled 广播
```

- pending → settled **恰好一次**（D4）；结算后从 registry 移除并广播 `ask.settled`。
- turn abort / 终态 / 会话 close / replace：对该 turn 全部 pending 发 `ask.cancel` 并结算为 `cancelled`（D5）。这与 bridge 既有的 turn 终态收口同构：`finalizeTurn` / `disposeBinding` 已负责给在途 turn 补发唯一终态帧（`packages/bridge/src/index.ts:689-733,849-886`）。
- 迟到 `ask.response`（eventId 已结算或所属 turn 已结束）→ 回 `ASK_TURN_ENDED` 或 `ASK_ALREADY_ANSWERED`，**不改状态**。
- 无 provider / 无 `approval` 服务：不下推 `ask.request`，直接以 `unavailable` 结算并回 `ASK_CHANNEL_UNAVAILABLE`（D6）；不静默。
- 关联表 `eventId → {resolve, turnId, sessionId, deliveredTo}` 用 Map（并发多请求不复用单槽，`tickets/2026-11-18-ask-permission-gap.md:132`）；access 校验 `deliveredTo === sessionId`，对应宿主 waterfall 的 `claims()`（`frame.agentId === sessionId`，`packages/shell/src/client/remote-waterfall.ts:128-131`）。

### 3.4 seam 适配边界（onApprove / registerAskProvider 的真实签名）

这是草案偏差最大的一处，按源码钉死：

- `SeamTurnCallbacks.onApprove` 真实签名是 `(name: string, args: Record<string, unknown>) => Promise<SeamApprovalVerdict>`，其中 `SeamApprovalVerdict = "allowed-once" | "rejected"`（`packages/tui-base/src/seams/session.ts:212-218,293-309`）。**没有** `outcome/behavior/optionId/feedback` 这些字段。
- `turn()` 入口为 `turn(userText: string, cb: SeamTurnCallbacks): Promise<void>`（同文件 `:600`）。
- `registerAskProvider` 真实签名是 `(onAsk: (questions: SeamAskQuestion[]) => Promise<SeamAskPick[]>) => void`（同文件 `:604-609,850-857`）；`SeamAskQuestion = {id,prompt,options:[{label,description?}],header?,description?,detail?,multiSelect?}`（同文件 `:220-241`），`SeamAskPick = {questionId,selected,selections?,custom?}`（同文件 `:243-255`）。
- 真实适配器的映射：`onApprove: async (name,args) => (await cb.onApprove(name,args)) === "allowed-once"`（`packages/shell/src/client/session-seam-adapter.ts:340-357`），`registerAskProvider` 为结构透传（同文件 `:367-371`）。因此 bridge seam 的实现目标是让 `cb.onApprove` 真正被调用、provider 真正被保存——当前二者都是 degrade 桩（`packages/shell/src/client/bridge-session-seam.ts:488-492,593-595`）。
- **不存在 `capabilities` 表面**（全仓 `seams/`、`client/` grep 无定义）；草案 T4 的 `capabilities.ask` 无源码对应，改为可选 `permissionCatalog()`（`packages/tui-base/src/seams/session.ts:452-457`）探测能力，并保留 UI 明示义务。

## 4. 不变量（Invariants）

文档既有不变量是 **I1–I6**（`docs/adr/0010-session-seam-lifecycle-contract.md:12-19`）：I1 sessionId 只因用户动作变化、I2 resume eager、I3 abort 只取消当前 turn、I4 单 writer lock、I5 sessionId 常显（2026-11-19 用户裁决已移除 footer 常显面，见 ADR-0010 修订记录）、I6 客户端不持 transcript 真源。草案把这些重排为 A1–A5 并替换语义，属编号冲突；本文按源码保留 I1–I6 原义，ask 通道新增 **A1–A5** 作为附加不变量（不改号、不重定义 I1–I6，见偏差记录 ⑤）：

- **A1 — turn 有界**：每个 ask 必须绑定到打开会话的在途 turnId，turn 终态即该 ask 的结算上界（从属 I3）。
- **A2 — 一次结算**：first-wins，pending → settled 恰好一次；迟到应答不改状态（D4）。
- **A3 — 显式 fail-closed**：无 provider / 无服务 / 异常 / 超时一律 `unavailable` + 协议错误码，UI 明示，不静默吞掉（D6；对照现状 `packages/shell/src/client/bridge-session-seam.ts:593-595` 的静默降级）。
- **A4 — 决策持久**：每次结算进 journal；`always` 的效果进会话级权限摘要，compaction 清事件不清效果（D7；journal 真源留在宿主，从属 I6）。
- **A5 — 重放安全**：`eventId` 为 turn 作用域单调值 + `deliveredTo` 校验，重复/迟到/跨会话应答不产生第二次结算（从属 I1）。

## 5. 错误码全集（Error codes）

沿用协议 `error{code, message, detail}` 的平铺 `SCREAMING_SNAKE_CASE` 风格，**无模块前缀**（既有码如 `SESSION_NOT_FOUND`/`TURN_BUSY`/`BAD_PARAMS` 见 `docs/adr/0010-session-seam-lifecycle-contract.md:97-125`；草案的 `ASK_` 前缀与源码"首词表语义"惯例相容——`SESSION_`/`TURN_`/`JOURNAL_`/`VERSION_`——故保留，见偏差记录 ③）。`ask.response` 的 `error.code` 新增 7 个：

| code | 触发 | 行为 |
| --- | --- | --- |
| `ASK_UNKNOWN_REQUEST` | `eventId` 不在 registry（从未下发或已淘汰） | `ok:false`，不结算任何 ask |
| `ASK_ALREADY_ANSWERED` | 对已结算 `eventId` 二次应答 | first-wins，返回 `ok:false`，不改状态 |
| `ASK_NOT_ADDRESSEE` | `deliveredTo !== sessionId`（跨会话串帧） | 拒绝，不结算（对应 waterfall `delegate/next`，`packages/shell/src/client/remote-waterfall.ts:133-136`） |
| `ASK_TURN_ENDED` | 所属 turn 已终态 / 会话已 close-replace 的迟到应答 | 拒绝，不改状态（D5） |
| `ASK_DEADLINE_EXCEEDED` | 超过 `deadlineAt` / `askDeadlineMs` 墙钟仍未应答；或触发 `maxAskWaitMs` 绝对硬帽 | 墙钟超时按 kind 结算：permission → `denied`、question → `cancelled`（Q1，已确认）；**`maxAskWaitMs` 硬帽一律结算 `unavailable`**（D6 fail-closed）。两者都随结算记入 `code:ASK_DEADLINE_EXCEEDED`，并发 `ask.cancel{reason:'deadline'}` + `ask.settled` |
| `ASK_CHANNEL_UNAVAILABLE` | 无 `approval`/`userQuestions` 服务或无 provider | 直接 `unavailable` 结算，不下推 `ask.request` |
| `ASK_INVALID_RESPONSE` | 应答字段非法（如未授予 escalation 却带 `behavior:'always'`） | 拒绝，不改状态 |

宿主侧 `APPROVAL_REJECTED`/`APPROVAL_CANCELLED`/`APPROVAL_UNAVAILABLE`（`dsh-tools/lib/pipeline.js:641-651`）是工具层错误，**不是**本协议 code；两者不得混用。

**超时参数**（草案数值标为未验证假设，见 §8）：`askDeadlineMs` 默认 `null`（在场不设墙钟）、`detachGraceMs` 30000、`maxAskWaitMs` 3600000 绝对硬帽；permission 墙钟超时 → `denied`、question 墙钟超时 → `cancelled`（Q1 已确认，按 T2 实现），`maxAskWaitMs` 硬帽 → `unavailable`（D6 fail-closed）。宿主 waterfall **无超时状态机**（`packages/shell/src/client/remote-waterfall.ts:25-35`、`tickets/2026-11-18-ask-permission-gap.md:57`），故所有墙钟由 bridge 侧设定；数值仍须真机验证（§8 Q1 已确认语义与默认值）。

## 6. 与当前 profile 默认的关系（Relationship to profile default）

**T9 已落地（commit `feat(profile): default to workspace-write + approval: ask with the pre-execute gate`）。** `packages/shell/scripts/provision-inproc-profile.mjs` 的 patch 模板现在写 `defaultPreset: workspace-write`（`presets.workspace-write = {sandbox:'workspace-write', approval:'ask'}`），并把 `dsh-opentui-approval-gate` 默认 armed：`enabled: true` + `tools: {bash: ask, write: ask, edit: ask, apply_patch: ask}`。工具名按宿主注册表面核对——`dsh-tool-bash/src/index.ts:393` 注册 `bash`，`dsh-tool-fs/src/{write,edit,apply-patch}.ts` 分别注册 `write` / `edit` / `apply_patch`，即 `tools/pre-execute` 收到的 `exec.name`。写类工具因此真正返回 `{kind:'ask'}`，走 `serviceAsk` → `approval.request` → bridge answerer → `ask.request` → TUI 审批卡；只读工具仍由 `next()` 直接放行。越界写仍由 `workspace-write` 文件沙箱硬拒绝并提示升级（收益来自 sandbox，不来自 approval）。

**逃生门**：`DSH_OPENTUI_APPROVAL_GATE=off dsh-opentui`。patch 的 `defaultPreset` 与 gate 的 `enabled` 都由 `!!js process.env.DSH_OPENTUI_APPROVAL_GATE` 推导；置 `off` 时恢复 `danger-full-access` + gate 关闭（即 T9 前的行为）。默认不设置，即 ON；不要默认关闭。

历史依据（改默认曾必须排在 T9 之后，现已满足）：旧模板 `defaultPreset: danger-full-access` + `approval: never`；若提前切到 `approval:'ask'` 而 ask 通道未上线，bridge 无 answerer（`packages/bridge/src/index.ts:77-101,240,833-834`）→ 宿主 `unavailable`（`tickets/2026-11-18-ask-permission-gap.md:158-162`）→ 工具侧 deny（`dsh-tools/lib/pipeline.js:641-651`）；且 seam 不接 `onApprove` / provider 空注册（`packages/shell/src/client/bridge-session-seam.ts:488-492,593-595`），净结果是"所有需审批工具被静默全拒"（ticket `:172-175`）。T1–T5（帧/registry/dispatch/answerer/两张卡）与 pre-execute gate（commit `19c2ab2`）已落地；T7 journal 由并行分支推进。D2 的落地点即本 T9。

## 7. 被否备选（Alternatives considered）

- **A — 保持降级 + ADR 写清后果**：0 代码改动。否决：HEAD 已把 bridge seam 设为默认；矩阵要求"必须在 UI 明示不可用，不能静默吞掉"（`tickets/2026-11-18-ask-permission-gap.md:112,192`），与静默降级冲突，且挡住 D2。
- **B — 最小 allow/deny（只做审批，不做提问/超时/取消）**：否决：用户已拍板 C；且无取消/超时则客户端掉线会挂住 turn（ticket `:193`）。
- **D — 透传宿主 waterfall 帧（直接把 `approval/request` 原帧推给 TUI）**：否决：TUI 的事件面只消费 5 种投影后的事件（`docs/adr/0010-session-seam-lifecycle-contract.md:69-77`），透传会把宿主结构细节和跨会话串帧风险泄漏进视图层；本项目既有策略是 bridge 侧投影 + 强校验（`packages/bridge/src/index.ts:739-824`）。

> **对称性交叉引用**：备选 B 所述「客户端掉线挂住 turn」是 ask 通道侧的否决理由；**宿主侧掉线语义由 ADR-0010 的 DEAD 恢复条款兑现**——bridge 连接断开进 DEAD 后，仅用户显式 R 键重连恢复，恢复序列的 replay drain 完成后用 `ask.pending` 快照重建未答卡片（见 `docs/adr/0010-session-seam-lifecycle-contract.md` 的「DEAD 恢复阶段一」与「桥态」条款，commit `4323a82`）。两侧对称：ask 侧掉线结算为 `cancelled`（§8 Q2），宿主侧连接中断期间的 in-flight turn 在 journal 沉默时由客户端呈现本地 INTERRUPTED（不写 journal）。

## 8. 假设与确认状态（Q1–Q4 已确认）

以下四项来自草案 §5 末尾的未拍板项。**Q1/Q2/Q3 已于 2026-11-18 按推荐值确认，并已由 T2 `AskRegistry` 实现；Q4 已于 2026-11-19 按推荐值确认（用户授权直接用推荐），由 T8 落地（本提交，基于 `1b103dc`）。**

- **Q1 — 超时墙钟**（已确认 2026-11-18，按推荐值）：采纳默认值 `askDeadlineMs=null` / `detachGraceMs=30000` / `maxAskWaitMs=3600000`；permission 墙钟超时落 `denied`、question 墙钟超时落 `cancelled`，`deadlineAt` 只作硬帽不主动轮询；`maxAskWaitMs` 绝对硬帽落 `unavailable`（D6 fail-closed）。数值仍待真机验证后定最终值。
- **Q2 — 掉线/turn 中断时未答请求的语义**（已确认 2026-11-18，按推荐值）：统一 `cancelled`（宿主 `ApprovalOutcome` 含 `cancelled`，`tickets/2026-11-18-ask-permission-gap.md:41`），并把 `signal` abort 视为 cancel（`ticket:132`）；迟到应答按 `ASK_TURN_ENDED` 丢弃。
- **Q3 — 'always'/escalation 的作用域与授权边界**（已确认 2026-11-18，按推荐值）：当前会话级摘要（compaction 不清），未授予 escalation 时收到 `behavior:'always'` 回 `ASK_INVALID_RESPONSE`（D7 + §5）。
- **Q4 — UI 明示义务的范围**（已确认 2026-11-19，按推荐值，用户授权直接用推荐）：是否除审批卡/提问面板外，还要常驻显示"审批通道不可用"状态位？**结论**：不常驻；在 `permissionCatalog()` 探测到无 provider 时显示一次性提示（矩阵 `:88,100`、`packages/shell/src/client/bridge-session-seam.ts` 的 `onSessionEvent` / `ask.no-provider` degrade）。**落地（本提交，基于 `1b103dc`）**：`BridgeSessionSeam.permissionCatalog()` 以「ask 帧可用性 + 本地 answerer + `ask.no-provider` degrade + bridge 连接态」为探测依据——bridge 无能力声明（`bridge.hello`/`ping` 仅回版本三元组）、无 `permissionPresets/catalog` RPC，故返回与 `SeamPermissionCatalog` 同形的**空目录**（不臆造 preset 值），无法确认 provider 时返回 `undefined`；经 `BridgeSessionSeamOptions.onPermissionUnavailable` 由 v2-entry 用 `showNotice` 显示一次性 fail-closed 提示，进程内 once 标志为 seam 私有字段 `#permissionNoticeShown`，触发点为真实 fail-closed ask（非 boot，避免误报）。i18n 键 `notice.permission.unavailable` / `notice.permission.reason.*`（en + zh-CN）。单测 `packages/shell/test/bridge-permission-catalog.test.ts`。

### F1-A2 拍板（2026-11-22）：per-ask deadline 超时 outcome

- **超时 outcome = `denied`**（host 收到 `rejected`），沿用 `ask-registry.ts:337-342` 既有语义，不新造 `unavailable` 分支；`maxAskWaitMs` 1h 硬帽仍落 `unavailable`（D6），两者不混。
- 理由：挂死根因（子会话无卡片）已在 F1-A1 路由层修掉；`askDeadlineMs` 只兜「卡片已弹但无人应答」，按用户拒绝处理，与 Q1 推荐值一致。
- 默认 `askDeadlineMs=null`（不装墙钟）：默认行为不变，1h 硬上限仍是唯一兜底；启用须 profile patch config 显式配置，改默认值超出本刀授权。

### F1-A1/C2 拍板（2026-11-22）：父会话管到底（always grant 覆盖子代理）

- **语义（用户拍板）**：子会话 ask 经父通道路由（`askTarget` 落点恒为父 `sessionId`），故 `behavior:'always'` grant 的作用域 = 本会话 + 该父会话下全部注册子代理的同名工具：父已 grant 的工具，其注册子会话的 ask 不弹卡直接放行；子卡上按 always 写入父 grant 键，父与兄弟子会话随后均命中。逻辑不变，仅钉测试并文档化。
- **一致性**：与业界 subagent 继承会话授权的惯例一致（授权挂在父会话，子代理复用同一授权域），不改 Q3 的会话级摘要实现。
- **边界不变**：grant 只影响已通过 fail-closed 路由门的注册子会话；foreign-parent / 未注册子会话仍 `unavailable`，授权面不因 grant 放宽。
- **风险提示**：给子代理长期放行等同于授权其同类写操作（含其后续同类工具调用）；用户按 always 时应知悉该授权覆盖当前及未来全部子代理，范围大于单会话。

## 9. 风险（Risks）

- **跨会话串帧**：多会话共用一条 bridge 连接，`approval/request` 按 `agentId` claim（`remote-waterfall.ts:128-131`）；bridge 必须按 `deliveredTo === sessionId` gate，否则 A 的审批会落到 B 的 turn。缓解：`onSessionEvent` 的 sessionId gate 模式（`packages/bridge/src/index.ts:739-743`）。
- **`approval` 服务获取方式（已按实现定稿，原风险 retired）**：ticket `:150,205` 的 UNKNOWN 前提是「用 `ctx.get('approval')` 取服务可能因未 inject 而抛错、令桥插件整体 pending」。实现未走该路径：`armAskAnswerers()`（`packages/bridge/src/index.ts:1193-1210`）改用 `ctx.on('approval/request', ...)` / `ctx.on('user-questions/request', ...)` 注册 answerer，并把注册整段包在 containment 内（缺 `ctx.on` 或注册抛错只记 warn，`bridge.ping` 及其余方法照常可用）。`ctx.get` 只在 `resolveSessionController` 等解析 helper 里做 `typeof ctx.get === 'function'` 守卫的 loose 探测，从不作为必填 inject（桥 `inject` 仍为 `['agents']`）。
- **turn 清场竞态**：turn 终态与 ask 结算并发时可能重复广播或漏清。缓解：复用 `finalizeTurn` 的单终态帧语义（`packages/bridge/src/index.ts:689-733`）。
- **审计/持久一致性**：journal 写与会话级权限摘要更新非原子，crash 间隙可能丢 `always` 效果。需在 T7 明确写入顺序（先摘要后 journal 或反之）并由验收固定。

## 10. 实现拆分（Implementation breakdown）

每项 ≤30 分钟，标依赖。**当前分支有一个 P0 在修**（turn 终态帧 / dispose 竞态，`packages/bridge/src/index.ts:849-886` 标注 P0 于 `:853`）。**ask 通道任务一律排在 P0 落地并验证之后**：T1 为推荐先做的第一个任务，起手前先确认 P0 已合入。

| 任务 | 内容（≤30m） | 依赖 |
| --- | --- | --- |
| T1 | 帧类型 + 7 错误码常量（bridge 与 seam 共享的形状定义） | P0 已落地 |
| T2 | `AskRegistry`（Map by eventId、first-wins、turn 作用域、deliveredTo gate）+ 单测 | T1 |
| T3 | dispatch 接线：`ask.response` 方法 + ask.cancel + turn 终态/close/replace 清场 + 迟到应答错误 | T1, T2 |
| T4 | bridge 侧 `approval/request` + `user-questions/request` answerer 注册与 `ask.request` 下推（含 `ctx.get` containment） | T1, T3 |
| T5 | seam 适配：`registerAskProvider` 真存 provider、`turn().onApprove` 接审批帧、删除 degrade 桩 | T1, T4 |
| T6 | TUI 卡片：审批卡 / 提问面板接 `onApprove` / provider（复用 `turn-overlay-controller.ts:145-151`） | T5 |
| T7 | journal 决策落盘 + 会话级权限摘要（compaction 清事件不清效果，D7） | T2, T3, T5 |
| T8 | 显式 fail-closed + UI 明示（unavailable 上屏，替换静默 warn） | T5, T7 |
| T9 | 去 `danger-full-access` 硬编码，默认预设改需审批（`provision-inproc-profile.mjs:490-493`） | **已落地，commit `feat(profile): default to workspace-write + approval: ask with the pre-execute gate`（见 §6）** |
| T10 | 真机验收（审批卡可放行、提问可答、掉线/取消/并发/重连/compaction） | T9 |

T9 是 D2 的落地点，已按 §6 的前提落地（commit `feat(profile): default to workspace-write + approval: ask with the pre-execute gate`）。

> **编号对照（落地编号与本文表格不完全一致，不重排编号）**：§10 表格里的 T6「TUI 卡片」实际以 commit `2168604`（审批卡，标注 T5a）与 `08e17d8`（提问面板，标注 T5b）落地，未使用 T6 号；T4 拆为 T4-host（`7d54190`）/ T4-client（`5429cfb`）。表格保留原始 T1–T10 编号；**T8（显式 fail-closed + UI 明示）仍开放**，T7 已由 `f05b28c` 落地，T9 已由 `c7acf1e` 落地。

## 11. 验收标准（Acceptance）

对齐 ADR-0010 的四门禁（`docs/adr/0010-session-seam-lifecycle-contract.md:150-155`），新增 ask 专项门：

① 切到 `approval:'ask'` 预设后，审批卡与提问面板能弹出并分别经 `onApprove` / provider 回传，`allowed-once` 放行、其余 deny；
② 同一 `eventId` 二次应答返回 `ASK_ALREADY_ANSWERED` 且状态不变（A2）；
③ turn abort / close / replace 后，该 turn 全部 pending 收到 `ask.cancel`，迟到应答回 `ASK_TURN_ENDED`，不污染下一 turn（A1/A5）；
④ 无 provider / 无服务 / 超时三种路径均显式 `unavailable` + 错误码 + UI 提示，不静默（A3）；
⑤ 决策进 journal，`always` 在 compaction 后仍生效（A4）；
⑥ 两个会话并发审批不串帧（A5）；
⑦ T9 改默认后，20 轮内上下文正确且不出现"全拒"回归（复用 0010 验收门 ④）。

## 草案偏差记录（Draft deviations）

核对 5 个维度，共 **7 处**改动（② ④ 为最关键两处）：

1. **turn.* 事件真实名**：草案作者无文件工具，未列实名。本文按源码钉死 5 种为 `turn.start`/`turn.token`/`turn.tool`/`turn.end`/`turn.error`（`packages/bridge/src/index.ts:629,635,640,699,708,770,785`；`docs/adr/0010-session-seam-lifecycle-contract.md:69-77`），并让 `ask.*` 沿用同一点分小写风格。
2. **帧字段命名风格（最关键之一）**：草案用 `requestId=${turnId}:ask-${seq}` 作关联键；源码中 bridge 请求帧关联键是 `id`、宿主 waterfall 是 `eventId`（`packages/shell/src/client/mux-frame.ts:51-57`），无 `requestId`。已改为统一 `eventId`（值仍为 `${turnId}:ask-${seq}`），`id` 专用于请求/应答配对。草案 `outcome/behavior/optionId/feedback` 已拆成源码真实字段 `verdict` + `answers` + `behavior`（§3.2）。
3. **错误码前缀**：草案 7 个 `ASK_*` 与源码平铺命名空间无冲突；既有码以语义首词分族（`SESSION_`/`TURN_`/`JOURNAL_`/`VERSION_`，`docs/adr/0010-session-seam-lifecycle-contract.md:97-125`），`ASK_` 同型，予以保留；同时明确宿主 `APPROVAL_*` 是工具层错误、非本协议码（§5）。
4. **onApprove 真实签名（最关键之一）**：草案把审批应答建模为 `outcome:'approved'|'denied'|'cancelled'`、`behavior:'once'|'always'|'session'`、`optionId`、`feedback` 的富响应；源码真实签名是 `onApprove:(name,args)=>Promise<"allowed-once"|"rejected">`（`packages/tui-base/src/seams/session.ts:212-218,307`），`registerAskProvider:(questions)=>Promise<SeamAskPick[]>`（同文件 `:609`），无 `capabilities` 表面。已按源码改写 §3.4：wire 层用 `verdict`/`answers`，`always` 折进会话级摘要，`optionId/feedback` 折进 `answers[]`，`capabilities.ask` 改为 `permissionCatalog()` 探测。
5. **I1–I6 编号与语义**：草案把既有不变量重排成 A1–A5 并替换语义；源码 I1–I6 含义固定（`docs/adr/0010-session-seam-lifecycle-contract.md:12-19`）。已恢复 I1–I6 原文语义，ask 通道不变量另编为 A1–A5，并逐条标注对 I3/I6/I1 的从属关系（§4）。
6. **profile 默认行号**：草案/工单引用 `provision-inproc-profile.mjs:462-475`，当前 HEAD 实际为 `:480-493`（`defaultPreset` 在 `:493`，`danger-full-access` 在 `:490-492`）。本文全部引用按当前 HEAD 改写（§1、§6）。
7. **seam degrade 行号**：工单引用 `bridge-session-seam.ts:488-492/593-596`，当前 HEAD 核对为 `:488-492` 与 `:593-595`（`registerAskProvider` 方法体到 `:596`），本文按实际行号引用（§1、§6、§8）。
