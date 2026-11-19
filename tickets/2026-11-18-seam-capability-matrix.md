# SessionSeam 十九个必需成员 × 桥能力对照表

日期：2026-11-18
分支：`feat/inproc-bridge-20261118`，HEAD `f05b28c`（本次对齐基准；前版为 `e3bf194`）
性质：调研文档，**不含实现**；不修改任何源码、不做 git add/commit。本文已按截至 `f05b28c` 的实现回写结论，历史快照中"bridge 无 ask 帧/listSessions 未实现/currentModelSelection 无帧"等表述已按实现订正。

## 0. 版本与口径（表头依据）

| 项 | 值 | 出处 |
|---|---|---|
| 宿主版本（package.json version） | **`@deepseek-ai/dsh` 0.2.2-rc.4** | `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/package.json`；兼容窗 `>=0.2.2-rc.3 <0.3.0` 由 `packages/shell/scripts/lib/host-compat.mjs:26-32,102-113` 钉死，rc.4 的接纳由 `265c11c` 落地 |
| 接口宿主包 | `@dsh-opentui/tui-base` **2.2.5-893e8dc** | `packages/tui-base/package.json` |
| bridge 包 | `@aiwayds/dsh-opentui-bridge` **0.1.0** | `packages/bridge/package.json:2-3` |
| 协议版本 | `protocolVersion = 1` | `packages/bridge/src/index.ts:317` |
| 默认 seam | inproc 模式（`DSH_OPENTUI_INPROC=1`）默认 `BridgeSessionSeam`，`--remote` 为 deprecated 逃生门 | `46ed988`，`packages/shell/src/client/seam-bootstrap.ts:65-72,204-236` |

**接口口径不变**：在仓库 `node_modules/.pnpm`、`~/.dsh/profiles/node_modules/@deepseek-ai`、`~/.tmp/dsh-type-closure-rc2/node_modules/@deepseek-ai`、`~/.bun/install/cache/@deepseek-ai` 中不存在名为 `SessionSeam` 的宿主类型；本表采用本仓 vendored view 的权威接口 `packages/tui-base/src/seams/session.ts:484-816` 的 `export interface SessionSeam`。十九个必需成员 = 该接口中**非 optional** 的 19 个顶层成员；其余 optional 面不在本表范围。

判据定义：
- **COVERED**：bridge IPC 帧或 bridge 已读取的宿主能力可提供该成员行为，且接线已完成。
- **PARTIAL**：部分行为已有，但缺字段/签名不对等/仍需客户端投影或状态机；现有实现不足以完全满足该成员语义。
- **UNSUPPORTED**：bridge 无对应帧，宿主能力切片中也未暴露；异步成员显式返回 `UNSUPPORTED`，同步签名成员按 §6 D3 降级值 + 日志，不抛错。

## 1. 成员表（一行一成员）

签名要点列抄自 `packages/tui-base/src/seams/session.ts` 原文行号；证据列 `bridge:` 指 `packages/bridge/src/index.ts`，`seam:` 指 `packages/shell/src/client/bridge-session-seam.ts`。结论列反映**截至 HEAD `f05b28c` 的实现**，非最初调研快照。

| # | 成员 / 出处行 | 签名要点（原文） | 当前实现状态 | 仍存缺口 | 结论 | 证据 |
|---|---|---|---|---|---|---|
| 1 | `status` :486 | `status(): SeamStatus` — `{connection, turn, sessionAttached}`（:134-138） | 无专用 status 帧；`connect()` 用 `bridge.ping` 填 connection，turn.* 事件驱动 turn，open/close 驱动 sessionAttached；P2-9 对重复降级只 warn 一次 | `turn:"reconnecting"` 与 `"starting"` 无法精确区分，歧义时落 `idle/connected` | **PARTIAL**（同步降级值+日志） | `seam:465-485,1010-1020`；无 status 帧（`bridge:1777-1842` 分发表） |
| 2 | `listSessions` :489 | `listSessions(limit?: number): Promise<SeamSessionSummary[]>`（异步） | **已真实现**：bridge `session.list` 帧调用宿主 `sessionController.list()`，wire 行原样透传；seam 侧 `projectBridgeSessionList` 照抄 remote 过滤/排序/截断规则。宿主服务由 `dsh-api-session-controller` 插件 + provision 生成的本地 shim（`fileUploads`/`workspaceRegistry`）提供，无需 web-app | 若 profile 未经 `DSH_OPENTUI_INPROC=1` provision 生成 patch/shim，`session.list` 仍返回 `UNSUPPORTED`（服务缺失属配置前提，非代码缺失） | **COVERED** | `7e66b3f`（帧+测试）；`c8f891b`（provision 接管 patch）；`2b5e2f1`（shim）；`bridge:1814`；`seam:657-665,276-298`；`provision:569-574` |
| 3 | `searchSessions` :490 | `searchSessions(query: string): Promise<{id, snippet}[]>` | seam 显式 `unsupported("searchSessions")`，无 bridge 帧 | 全量缺失；无实现计划（fault-tolerant stub） | **UNSUPPORTED** | `seam:787-789`；`bridge:1777-1842`（无该帧） |
| 4 | `storedTranscript` :491 | `storedTranscript(id: string, skip?: number): Promise<SeamTranscriptRow[]>` | **已实现**：`journal.replay` 对任意 id 只读取 `{seq,type,payload}`，`bridgeReplayRowsToSeamTranscript` 复用 remote 的 `journalToTranscriptRows` 做 call→result 配对、ask/tool 行投影；`skip` 按行数本地切片，不发 `from` | 无（投影语义已在注释中钉死：`skip` 是行数、`from` 是 seq 下界，二者不等价） | **COVERED** | `045ab0d`；`bridge:1686-1760,1838`；`seam:667-673,300-347` |
| 5 | `currentSessionId` :492 | `currentSessionId(): string \| undefined` | 客户端投影 `session.open` 响应的 sessionId，`newSession/dispose` 清空；I1 保证仅 open 改 id | 无 | **COVERED** | `seam:487-490,514,722-724,782`；ADR-0010:14（I1） |
| 6 | `resumeSession` :559 | `resumeSession(id: string): "ok" \| "owned"`（同步） | stage id，下一 turn 走 `session.open{mode:"resume",replace?}` 做 eager `agents.resume`；writer-held 异步报 `SESSION_LOCKED` | `"owned"` 无法同步判定（remote 亦恒 `"ok"`），占用延迟到 turn 暴露 | **COVERED** | `seam:492-499,713-729`；ADR-0010:15-17（I2/I3/I4） |
| 7 | `newSession` :596 | `newSession(): void`（同步） | 清空本地 id，stage `session.open{mode:"new"}` 到下一 turn | staged 窗口内 bridge 仍持旧会话（P1-8 有意保留 `replace` 能力），`sessionAttached` 不立即清 | **COVERED** | `seam:501-516`（P1-8 注释）；`remote-host-session.ts:746-751` |
| 8 | `renameSession` :597 | `renameSession(title: string): Promise<{title, seq}\|undefined>` | seam 显式 `unsupported("renameSession")`；bridge 无 rename 帧 | 全量缺失；无实现计划。宿主有 `dsh-session-title` 但 bridge 未引用，能否直调 UNKNOWN | **UNSUPPORTED** | `seam:791-793`；`bridge:1777-1842` |
| 9 | `turn` :600 | `turn(userText, cb: SeamTurnCallbacks): Promise<void>` | `session.send` + turn 事件流；`cb.onApprove` **已接通**：ask.request 下推 → turn-scoped `onApprove` → `ask.response`；reentrant 请求拒绝而非排队；终止帧释放 waiter | `turn.tool` 无 `callId`，`onToolStart/onToolRun` 的 callId 字段无法喂；`onToolRun.ok` 恒 true | **PARTIAL** | `5429cfb`；`4770ae1`、`7d54190`；`seam:688-761,882-930,1036-1062` |
| 10 | `steer` :601 | `steer(text: string): void` | 同步降级：`#degrade("steer", "no session.steer frame; steer is a no-op")` | 无 bridge 帧；无实现计划。同步签名按 D3 不抛错 | **UNSUPPORTED**（同步降级 no-op+日志） | `seam:795-797`；`bridge:1777-1842` |
| 11 | `interrupt` :602 | `interrupt(): void`（同步） | `turn.abort` 真实：非空 turnId 校验、`TURN_NOT_FOUND`、64 项终态 FIFO；P1-5 失败经 `onError` + `session.error` 事件上屏并释放 waiter | 同步 void 取不到在途 turnId 时降级 no-op + 日志 | **PARTIAL**（同步降级值+日志） | `b8877c9`、`e3bf194`、`98957f1`、`44f339f`；`seam:527-595`；`bridge:1045-1102` |
| 12 | `registerAskProvider` :609 | `registerAskProvider(onAsk): void` | **已接通**：真存 provider；`ask.request{kind:"questions"}` → provider → `ask.response`；approval 无 turn-scoped `onApprove` 时回落到 provider；无 provider/异常一律 `unavailable`（fail-closed） | 重连细节未闭环（见 §9：`ask.pending` 帧定义但 bridge 未发）；T8 UI 显式"通道不可用"未落地 | **COVERED**（成员契约层面；跨切面缺口列 §9） | `5429cfb`（T4-client）、`7d54190`（T4-host）、`4770ae1`（T3）；`seam:799-804,882-930,954-987`；`bridge:750-830,1795-1834` |
| 13 | `listProviders` :612 | `listProviders(): Promise<{provider, models[]}[]>` | seam 显式 `unsupported("listProviders")`；bridge 只读 `agentDefaultModel.currentSelection()`，不读 provider 目录 | 全量缺失；无实现计划 | **UNSUPPORTED** | `seam:812-814`；`bridge:1795-1813` |
| 14 | `modelCatalog` :613 | `modelCatalog(force?: boolean): Promise<SeamProviderModel[]>` | seam 显式 `unsupported("modelCatalog")` | 全量缺失；无实现计划 | **UNSUPPORTED** | `seam:816-818`；`bridge:1777-1842` |
| 15 | `currentModelSelection` :614 | `currentModelSelection(): Promise<{providerID, modelID}\|undefined>` | **已实现**：bridge 新增只读帧 `model.currentSelection`（`ctx.agentDefaultModel.currentSelection()`），seam 把 `provider/model` 投影为 `providerID/modelID` | 无帧缺失；服务不可用时回 `UNSUPPORTED`（合理降级） | **COVERED** | `19c2ab2`；`bridge:1795-1813`；`seam:675-686` |
| 16 | `selectModel` :627 | `selectModel(providerID, modelID): Promise<void>`（拒绝须 reject） | seam 显式 `Promise.reject(UNSUPPORTED)`；bridge 的 `agentOptions` 是只读 getter，不能写回宿主 | 全量缺失；无实现计划 | **UNSUPPORTED** | `seam:820-822`；`bridge:479-495` |
| 17 | `usageSummary` :656 | `usageSummary(): string[]`（同步） | 缓存每个 `turn.end` 的 usage（含其他 seam 驱动的 turn），聚合为 `turns/prompt/completion` 三行 | 无专用 usage 帧；格式与远端不保证逐字一致；无数据时返回 `[]` + 一次 warn | **PARTIAL**（同步降级值+日志） | `seam:597-610,1022-1033` |
| 18 | `onSessionEvent` :812 | `onSessionEvent(listener): () => void` | `projectBridgeEvent` 把 `turn.start/end/error` 投影成 `session.updated`/`session.error`；ask 帧由 `#onAskEvent` 独立队列消费，不进该投影 | 缺 `permission.asked`（ask 帧不投影到该面）、宿主 `session.updated`、`bridge.shutdown`；这些在 wire 上不存在 | **PARTIAL** | `seam:612-622,359-375,953-987,1004-1075`；ADR-0010:69-77 |
| 19 | `dispose` :815 | `dispose(): Promise<void>` | 退订事件、清 ask 队列与回调，best-effort `session.close`，EOF/fiber dispose 走完整 teardown | 无（`bridge.shutdown` 事件缺失不影响 dispose 行为） | **COVERED** | `seam:763-783`；`bridge:1238-1253` |

统计：**COVERED 8**（#2 #4 #5 #6 #7 #12 #15 #19）；**PARTIAL 5**（#1 #9 #11 #17 #18）；**UNSUPPORTED 6**（#3 #8 #10 #13 #14 #16）。合计 19。
对照旧快照（COVERED 4 / PARTIAL 8 / UNSUPPORTED 7）：#2/#4/#15 从 PARTIAL 升 COVERED，#12 从 UNSUPPORTED 升 COVERED。

## 2. 缺口清单（按当前状态）

代价口径：A = 只改客户端接线/只读投影；B = 加一个 bridge IPC 帧，宿主能力已存在；C = 加 IPC 帧且需先确认/新增宿主侧能力；D = 需宿主侧新能力或双向协议。

### 2.1 已闭环（截至 f05b28c）

| 缺口（旧序） | 结论 | 关闭它的 commit / 代码 |
|---|---|---|
| `currentModelSelection` (#15) | 已加只读帧并投影 | `19c2ab2`；`bridge:1795-1813`、`seam:675-686` |
| `listSessions` (#2) | 已加 `session.list` 帧 + shim 提供宿主服务 + 投影 | `7e66b3f`、`c8f891b`、`2b5e2f1`；`seam:276-298,657-665` |
| `storedTranscript` (#4) | 已加 `journal.replay` + 投影，skip 语义已钉死 | `045ab0d`；`seam:300-347` |
| `configLoad` / `configRaw` / `workspaceConfig`（optional，v2-entry 启动 UNGUARDED 调用） | 同步降级为 `{}` + 一次 warn，修复默认 inproc 启动崩溃 | `1eaf995`；`seam:624-653` |
| `registerAskProvider` / `turn().onApprove` (#12 + #9 的审批半边) | 双向 ask 帧 + 队列 + fail-closed 已接通 | `4770ae1`（T3）、`7d54190`（T4-host）、`5429cfb`（T4-client）、`2168604`（T5a 审批卡）、`08e17d8`（T5b 提问面板） |
| `TURN_NOT_FOUND` / turn 终态帧 / abort 失败上屏 (#11) | 非空校验 + 终态 FIFO + 失败双通道上屏 | `b8877c9`、`e3bf194`、`98957f1`、`44f339f` |
| 默认 seam / fail-fast 三要素 | inproc 默认 bridge，握手与 provision 共用三元素文本 | `46ed988`、`1eaf995`；`seam-bootstrap.ts:65-72,87-133`；`scripts/lib/bridge-failfast-text.mjs` |

### 2.2 仍未实现（当前行为与计划）

| 成员 | 代价 | 当前行为 | 计划 |
|---|---|---|---|
| `searchSessions` (#3) | C | 异步 `UNSUPPORTED` 错误 | 无排期 |
| `renameSession` (#8) | C | 异步 `UNSUPPORTED` 错误 | 无排期 |
| `listProviders` (#13) / `modelCatalog` (#14) | C | 异步 `UNSUPPORTED` 错误 | 无排期 |
| `selectModel` (#16) | C | rejected promise（`UNSUPPORTED`） | 无排期 |
| `steer` (#10) | B | 同步 no-op + 日志 | 无排期 |
| `status` (#1) 的 `reconnecting` 精度 | B | 歧义时落 idle/connected | 无排期 |
| `turn` 的 `onToolStart/onToolRun.callId` (#9) | B | `turn.tool` 无 callId，字段缺失 | 无排期 |
| `onSessionEvent` 的 `permission.asked` / `bridge.shutdown` (#18) | A/B | 不上屏该事件面；ask 走独立队列 | `bridge.shutdown` 是否补发未拍板 |

## 3. 默认路径切换（M2 / T9）需要的最小集——当前接线状态

门禁依据：M2 放行门 = 门禁①（`/resume`、`--session`、`--resume-last` 三入口恢复历史）+ 门禁②（abort 后同会话）+ 双向崩溃用例（`tickets/2026-11-18-inproc-bridge-plan.md:27-32`）。

**已真实现（原"阶段一必须真实现"清单）**：
- `resumeSession` (#6) + `newSession` (#7)：id staging → `session.open{mode:"resume"|"new"}`（`seam:492-516,713-729`）。
- `turn` (#9)：`session.send` + turn 事件流，`onContentDelta/onThinkingDelta/onError` 与 `onApprove` 均真通（`seam:688-761,882-930`）。
- `storedTranscript` (#4)：`journal.replay` + 投影（`seam:667-673,300-347`）。
- `currentSessionId` (#5)：I1/I5 前提（`seam:487-490`）。
- `status` (#1)：footer 与 idle 判定，最小可用（`seam:465-485`）。
- `onSessionEvent` (#18)：journal feed 入口，只投影已有 turn.*（`seam:359-375`）。
- `interrupt` (#11)：`turn.abort` 真实现，失败双通道上屏（`seam:527-595`）。
- `dispose` (#19)：`session.close` + teardown（`seam:763-783`）。
- `listSessions` (#2)：`session.list` 帧 + shim + 投影，接入 `/resume` 选择器（`7e66b3f`、`c8f891b`、`2b5e2f1`）。

**仍显式降级/UNSUPPORTED（不进门禁①，且均未排期实现）**：
- 异步 UNSUPPORTED：`searchSessions` (#3)、`renameSession` (#8)、`listProviders` (#13)、`modelCatalog` (#14)、`selectModel` (#16)。
- 同步降级：`steer` (#10) no-op + 日志。
- 同步降级：`status` 的 `reconnecting` 精度、`usageSummary` (#17) 空数组、`configLoad/configRaw/workspaceConfig` 返回 `{}`。
- 注意：`registerAskProvider` (#12) 不再是"空注册 + UI 明示不可用"——通道已接通（§2.1）；剩余是跨切面的 T6/T8/摘要持久化（§9）。

**同步签名风险（已拍板，见 §6 D3）**：同步成员一律"降级值 + 日志"，不抛错；异步成员返回 `UNSUPPORTED` 错误。已按此口径实现（`seam:475-653,787-822`）。

## 4. 风险与未知（历史项已按实现结案）

| 项 | 当前状态 | 依据 / 仍需什么 |
|---|---|---|
| 任务所述"宿主包中的 SessionSeam 接口" | 事实不符 / UNKNOWN（口径维持 §0） | 已 grep 全部宿主包位置，无 `SessionSeam` 符号；仍需用户确认是否以 vendored 19 成员为准 |
| 宿主会话枚举服务 | **已闭环**：`sessionController` 由真实插件 + 本地 shim 提供 | `c8f891b`、`2b5e2f1`；`provision:562-574`；ADR-0010:89 |
| `journal.replay` → `SeamTranscriptRow` 投影 | **已实现**（复用 remote 投影规则），但 seq 稠密性仍是未验证假设 | `seam:300-347`；ADR-0010:81 |
| `onApprove`/ask 审批在 bridge 下的语义 | **主通道已实现**（双向帧 + 队列 + fail-closed），但"真机触发一次带审批的 turn"仍未做 | `4770ae1`、`7d54190`、`5429cfb`；§9 U1 |
| 宿主改名/标题能力 (#8) | UNKNOWN，未实现 | bridge 未引用 `dsh-session-title` |
| 宿主 provider/model catalog 与 selectModel (#13/#14/#16) | UNKNOWN，未实现 | bridge 只用 `currentSelection()`（`bridge:1795-1813`） |
| `resumeSession` 返回 `"owned"` 时机 | UNKNOWN，沿用 remote 恒 `"ok"` 语义 | `seam:492-499` |
| 宿主错误类 `this.name` 映射（ADR-0010:101-111） | 实现有测试覆盖，真机 writer-held 复现仍未做 | `bridge:306-342`；`packages/bridge/test/host-error-map.test.ts` |
| `bridge.shutdown` 事件（ADR-0010:77） | 确认缺失，是否补发未拍板 | `emitEvent` 现有 turn.* 五种 + ask.* 四种（§9） |

## 5. 结论摘要

- 十九成员中：**COVERED 8 / PARTIAL 5 / UNSUPPORTED 6**（截至 HEAD `f05b28c`）。
- 默认路径切换的核心（staging + open/send/close/abort/replay + list）已被 bridge 真实现；ask/审批双向通道已接通（T3/T4/T5/T7/T9 + gate）。
- 仍未闭环的不是 19 成员本身，而是三个跨切面项：重连快照未发（T6 细节）、UI 显式"通道不可用"未落地（T8）、会话级权限摘要仅进程内 Map 不跨进程持久化（见 §9）。
- 未支持的 5 个异步成员（search/rename/listProviders/modelCatalog/selectModel）与 1 个同步成员（steer）均显式 UNSUPPORTED/降级，无实现排期。

## 6. 已拍板（2026-11-18 用户决定）

以下六条为用户/ADR 已拍板结论；已回写本表相关定级与口径。

| # | 用户决定 | 对本表结论的影响 |
|---|---|---|
| D1 | `/resume` 交互选择器纳入阶段一（门禁①） | `listSessions` (#2) 必须真实现；已由 `7e66b3f`+`c8f891b`+`2b5e2f1` 落地，定级 COVERED（§1 #2） |
| D2 | `TURN_NOT_FOUND` 补进 ADR-0010 错误码全集，保留语义、代码不改码 | 已由 `b8877c9` 落为 `docs/adr/0010-session-seam-lifecycle-contract.md:118`；`detail:{requestedTurnId,activeTurnId}`；幂等基于 64 项终态 FIFO |
| D3 | 同步签名的 seam 成员缺能力时返回降级值 + 日志；异步成员返回 `UNSUPPORTED` 错误 | 成员表同步成员按此实现（`seam:475-653,787-822`）；异步成员保持显式 `UNSUPPORTED` |
| D4 | **方案 C：完整对齐 remote**（审批 + 提问双向帧，含取消/超时/并发/fail-closed） | 关掉 §0 旧快照中"ask 路径静默失效"类表述；#12 由 UNSUPPORTED 升 COVERED，#9 的 `onApprove` 半边接通（§2.1）。来源：ADR-0011:23（D1）、`4770ae1`/`7d54190`/`5429cfb`/`2168604`/`08e17d8` |
| D5 | **默认预设改需审批**：`defaultPreset` 由 `danger-full-access` 改为 `workspace-write`（`approval: ask`） | 来源：ADR-0011:24（D2）、`c7acf1e`；`provision:505-520`；逃生门 `DSH_OPENTUI_APPROVAL_GATE=off`（ADR-0011:115）。消除"默认 full-access、缺口休眠"的旧结论 |
| D6 | **gate 插件**：预执行 gate 默认 armed，写类工具返回 `{kind:'ask'}` 触发审批 | 来源：`19c2ab2`（`packages/bridge/src/approval-gate.ts`）、`c7acf1e`；`provision:522-540`；细节见 `tickets/2026-11-18-approval-trigger-mechanism.md:8` |

## 7. 实现顺序（已执行）与后续

已执行（与 commit 顺序一致）：
1. `session.list` 帧 + `sessionController` shim + 投影（`7e66b3f` → `c8f891b` → `2b5e2f1`）。
2. 默认 seam 切换 + configLoad 补洞 + fail-fast 三要素（`46ed988` → `1eaf995`），rc.4 兼容（`265c11c`）。
3. ask 通道 T3→T4-host→T4-client→T5a/T5b（`4770ae1`→`7d54190`→`5429cfb`→`2168604`→`08e17d8`）。
4. 预执行 gate（`19c2ab2`）+ 默认 preset 改需审批（`c7acf1e`）。
5. T7 决策 journal + 会话级权限摘要（`f05b28c`）。

后续（无排期，见 §9）：重连快照实际下发（T6 细节）、UI 显式通道状态（T8 / ADR-0011 Q4）、权限摘要跨进程持久化。

## 8. 仍未闭环项（不美化清单）

1. **重连快照（T6 细节）**：`ask.pending` 帧类型与 seam 消费均已定义（`seam:973-983`），`AskRegistry.pendingSnapshot(sessionId, emit)` 亦存在（`packages/bridge/src/ask-registry.ts:545-552`），但 bridge 生产路径无任何调用点（全仓仅测试引用），重连后卡片不会重建。
2. **UI 显式提示（T8 / ADR-0011 Q4）**：ADR-0011:133 标"待确认"；seam 对无 provider 仅 `logger.warn`（`seam:895,902,908`），无常驻/一次性"审批通道不可用"状态位；`permissionCatalog()` 为 optional 面、BridgeSessionSeam 未实现。
3. **跨进程摘要持久化**：`SessionPermissionSummary` 是进程内 plain Map（`packages/bridge/src/ask-journal.ts:127-138`），`dispose()` 清空（`ask-registry.ts:565`）；journal 有审计事件但摘要不从事件重建。ADR-0011:139 已记"journal 写与摘要更新非原子，crash 间隙可能丢 always 效果"。
4. **真机验证缺口**：带审批 turn、writer-held 错误类映射、rc.4 实机行为、20 轮门禁④均未在本轮文档对齐中执行（无新验证）。
5. **未排期成员**：§2.2 的 8 项（5 个异步 UNSUPPORTED + steer + status.reconnecting + onToolRun.callId）与 `bridge.shutdown` 是否补发未拍板。
