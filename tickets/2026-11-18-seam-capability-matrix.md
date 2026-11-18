# SessionSeam 十九个必需成员 × 桥能力对照表

日期：2026-11-18
分支：`feat/inproc-bridge-20261118`，HEAD `23cbfb5`
性质：调研文档，**不含实现**；不修改任何源码、不做 git add/commit。

## 0. 版本与口径（表头依据）

| 项 | 值 | 出处 |
|---|---|---|
| 宿主版本（package.json version） | **`@deepseek-ai/dsh` 0.2.2-rc.3** | `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/package.json`（profile `node_modules/@deepseek-ai/dsh` 软链到此） |
| 接口宿主包 | `@dsh-opentui/tui-base` **2.2.5-893e8dc** | `packages/tui-base/package.json` |
| bridge 包 | `@aiwayds/dsh-opentui-bridge` **0.1.0** | `packages/bridge/package.json:2-3` |
| 协议版本 | `protocolVersion = 1` | `packages/bridge/src/index.ts:202` |

**重要事实更正（影响本表口径）**：在仓库 `node_modules/.pnpm`、`~/.dsh/profiles/node_modules/@deepseek-ai`（软链到 `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`）、`~/.tmp/dsh-type-closure-rc2/node_modules/@deepseek-ai`、`~/.bun/install/cache/@deepseek-ai` 中**不存在名为 `SessionSeam` 的宿主类型**（`grep -Rln 'SessionSeam'` 只命中本仓 `@dsh-opentui/tui-base` 与 `@aiwayds/dsh-opentui` 的源文件/测试）。因此本表的"宿主侧 SessionSeam 真实定义"采用本仓 vendored view 的权威接口：`packages/tui-base/src/seams/session.ts:484-816` 的 `export interface SessionSeam`。十九个必需成员 = 该接口中**非 optional** 的 19 个顶层成员；其余 34 个 optional 面不在本表范围（它们天然可缺省，不阻塞默认路径切换）。若任务预期的是另一份宿主 authored 接口，本表口径需用户拍板重做（见 §4）。

判据定义：
- **COVERED**：现有 bridge IPC 帧或 bridge 已读取的宿主能力即可提供行为，只需客户端接线（staging / 本地投影），无需新 IPC 帧、无需新宿主能力。
- **PARTIAL**：部分行为已有（数据可取或事件已发），但缺客户端投影、缺字段、签名不同，或需要一个新的只读小帧。
- **UNSUPPORTED**：bridge 无对应帧，且其宿主能力切片中不存在该能力；需要新 IPC 帧 + 宿主侧能力确认（或宿主能力本身缺失）。所有 UNSUPPORTED 必须在 `BridgeSessionSeam` 中显式返回 `UNSUPPORTED`，不得伪装实现。

## 1. 成员表（一行一成员）

签名要点列抄自 `packages/tui-base/src/seams/session.ts` 原文行号；证据列 `bridge:` 指 `packages/bridge/src/index.ts`。

| # | 成员 / 出处行 | 签名要点（原文） | 桥现有能力能否满足 | 缺口描述 | 结论 | 证据 |
|---|---|---|---|---|---|---|
| 1 | `status` :486 | `status(): SeamStatus` — `{connection: connecting\|connected\|disconnected, turn: idle\|starting\|running\|reconnecting, sessionAttached: boolean}`（:134-138） | 部分。`bridge.ping/hello` 回版本（可判连通），`turn.start/end/error` 可判 turn，`session.open/close` 可判 attached | 无专用 status 帧；`turn: "reconnecting"` 与 `"starting"` 无法从现有帧精确区分；需要一个客户端状态机约定或新只读帧 | **PARTIAL** | `bridge:1178-1194`、`bridge:557-632`、`bridge:888-892`、`bridge:1012` |
| 2 | `listSessions` :489 | `listSessions(limit?: number): Promise<SeamSessionSummary[]>` | 否。ADR-0010:61 列了 `session.list` 方法面，但 bridge dispatch 无该 method | 需新增 `session.list` IPC 帧；且 bridge 的 `PersistenceLike` 只有 `open(id,access)`（`bridge:155-158`），枚举会话的宿主能力在本桥中**不存在**，须确认宿主提供 list 服务 | **UNSUPPORTED** | ADR-0010:61；`bridge:1168-1217`（无 `session.list`）；`bridge:1216`（落到 UNSUPPORTED）；`bridge:155-158` |
| 3 | `searchSessions` :490 | `searchSessions(query: string): Promise<{id, snippet}[]>` | 否。无任何搜索帧或宿主搜索能力切片 | 新 IPC 帧 + 宿主搜索能力确认；若宿主无搜索服务，只能先返回 `UNSUPPORTED` 或客户端全量扫描（需 list 先落地） | **UNSUPPORTED** | `bridge:1168-1217`；`bridge:105-158`（结构宿主类型无搜索） |
| 4 | `storedTranscript` :491 | `storedTranscript(id: string, skip?: number): Promise<SeamTranscriptRow[]>` | 部分。`journal.replay` 可对**任意 id**、以只读方式取持久行 `{seq,type,payload}` | 原始行有了，但缺 `{seq,type,payload}` → `SeamTranscriptRow{kind,text,final,args,output,ok,entries}` 的投影；`skip`（行数）与 `from`（seq 下界）语义不等价，需明确映射 | **PARTIAL** | `bridge:1100-1165`（尤其 :1120 只读 open、:1143-1147 行形状）；`session.ts:106-118`（目标形状）；`session-seam-adapter.ts:208-230`（remote 侧投影，仅作形状参考） |
| 5 | `currentSessionId` :492 | `currentSessionId(): string \| undefined` | 是。bridge 在 `session.open` 响应回 `sessionId`，close 亦回 id；客户端缓存即可 | 无（I1 保证仅 `open` 改 id，客户端投影稳定） | **COVERED** | `bridge:888-892`、`bridge:823`、`bridge:1012`；ADR-0010:14（I1） |
| 6 | `resumeSession` :559 | `resumeSession(id: string): "ok" \| "owned"`（同步） | 是（按 staging 语义）。remote 实现本就是同步 stage id、下一 turn 才建会话（`remote-host-session.ts:760-764`）；bridge 的 `session.open{mode:"resume"}` 做 eager `agents.resume`，writer-held 映射 `SESSION_LOCKED` | 返回值的 `"owned"` 无法同步判定（remote 也恒返回 `"ok"`）；占用错误只能在下一 turn 以 `SESSION_LOCKED` 异步暴露，需客户端约定 | **COVERED** | `bridge:858-877`、`bridge:323-342`；`remote-host-session.ts:746-764`；ADR-0010:17（I4） |
| 7 | `newSession` :596 | `newSession(): void`（同步） | 是（按 staging 语义）。remote 实现为清空本地 id（`remote-host-session.ts:746-751`）；bridge `session.open{mode:"new"}` 在下一 turn 铸新 id | 同上：同步 void 只 stage，真正 open 在 `turn()` 内 await；需约定失败如何回到调用方 | **COVERED** | `bridge:850-857`、`bridge:1196-1199`；`remote-host-session.ts:746-751` |
| 8 | `renameSession` :597 | `renameSession(title: string): Promise<{title, seq}\|undefined>` | 否。无 rename 帧；bridge 的 `PersistenceHandleLike` 只有 `read/close`（`:150-153`），无任何写/改名能力 | 新 IPC 帧 + 宿主改名/标题服务确认（宿主存在 `dsh-session-title` 包，但 bridge 未引用，能力是否可直调为 UNKNOWN） | **UNSUPPORTED** | `bridge:1168-1217`；`bridge:150-158`；`session-seam-adapter.ts:336-338`（remote 走 `session/rename`） |
| 9 | `turn` :600 | `turn(userText, cb: SeamTurnCallbacks): Promise<void>`；cb 需 `onThinkingDelta/onContentDelta/onApprove/onToolStart?/onToolRun?/onError`（`session.ts:294-312`） | 部分。`session.send` 发文本并返回 turnId；`turn.token` / `turn.error` 可喂 delta 与 error | **`onApprove` 无帧**：bridge 不转发 ask/permission 事件，也没有回答帧；`turn.tool` 只带 `name/input/output`，无 `callId`，无法喂 `onToolStart/onToolRun` 的 callId 字段 | **PARTIAL** | `bridge:902-1001`、`bridge:557-716`（:690-710 tool 帧）；`session.ts:294-312` |
| 10 | `steer` :601 | `steer(text: string): void` | 否。无 `session.steer` 帧。宿主 `agent.steer` 存在但只在 `handleSend` 内部使用（`status === 'running'` 时） | 新增只读/写入帧 `session.steer` → `agent.steer(message)`；小改动，但需定义无在途 turn 时的降级（排队 followup） | **UNSUPPORTED** | `bridge:948-956`（内部 steer）；`bridge:1168-1217`（无该帧） |
| 11 | `interrupt` :602 | `interrupt(): void` | 部分。`turn.abort` 实现 I3（只取消在途 turn、不改 id）；但签名异步且需 `turnId`，seam 是同步 void | 客户端需以当前在途 turnId 做 fire-and-forget 调用；无 turnId 时 bridge 返回 `{noop:true}`（`bridge:1038-1043`），语义可接受 | **PARTIAL** | `bridge:1027-1085`（:1078 cancel）；ADR-0010:16（I3） |
| 12 | `registerAskProvider` :609 | `registerAskProvider(onAsk: (questions: SeamAskQuestion[]) => Promise<SeamAskPick[]>): void` | 否。客户端注册本身可做，但 bridge 不发 ask/permission 帧，回调永远不会被触发，`onApprove` 一并失效 | 需要**双向帧**：宿主 ask 事件下推 + 客户端回答回传（新 event + 新 request）；宿主 user-questions 能力存在但未在 bridge 暴露 | **UNSUPPORTED** | `bridge:552-716`（emitEvent 仅 5 种 turn.*）；`bridge:1168-1217`；`session.ts:609`（签名） |
| 13 | `listProviders` :612 | `listProviders(): Promise<{provider, models: string[]}[]>` | 否。无该帧；bridge 只读 `agentDefaultModel.currentSelection()`（`bridge:132-134,290-304`），不读 provider 目录 | 新 IPC 只读帧 + 宿主 provider 目录服务确认（bridge 无此能力切片） | **UNSUPPORTED** | `bridge:1168-1217`；`bridge:131-134` |
| 14 | `modelCatalog` :613 | `modelCatalog(force?: boolean): Promise<SeamProviderModel[]>` | 否。同 #13，无 catalog 帧 | 新 IPC 只读帧 + 宿主 model catalog 服务确认（`force` 是否需要刷新语义亦待确认） | **UNSUPPORTED** | `bridge:1168-1217`；`bridge:131-134` |
| 15 | `currentModelSelection` :614 | `currentModelSelection(): Promise<{providerID, modelID}\|undefined>` | 部分。宿主能力已在 bridge 内被使用（`currentSelection()` 供 `agentOptions` getter 惰性读取），但未通过任何帧暴露 | 新增一个只读帧 `model.currentSelection` 并做 `provider→providerID`、`model→modelID` 改名投影；代价小 | **PARTIAL** | `bridge:132-134`、`bridge:290-304`；`bridge:1168-1217` |
| 16 | `selectModel` :627 | `selectModel(providerID: string, modelID: string): Promise<void>`（拒绝须 reject） | 否。无该帧；bridge 的 `agentOptions` 是**只读 getter**，不能写回宿主选择 | 新 IPC 写入帧 + 宿主选择/设置服务确认（remote 走 `session/select-model`，bridge 无对应） | **UNSUPPORTED** | `bridge:290-304`（getter 只读）；`bridge:1168-1217`；`session-seam-adapter.ts:399-406` |
| 17 | `usageSummary` :656 | `usageSummary(): string[]`（同步） | 部分。宿主 `assistant/message` 的 usage 被捕获（`bridge:680`）并随 `turn.end` 下发（`bridge:625`） | 无专用 usage 帧；需客户端缓存并按 `string[]` 聚合（同步签名要求本地缓存），格式需与现状对齐 | **PARTIAL** | `bridge:430-431`、`bridge:680`、`bridge:625`；`remote-host-session.ts:952` |
| 18 | `onSessionEvent` :812 | `onSessionEvent(listener: (event: SeamSessionEvent) => void): () => void`；事件 `type` 期望 `session.updated` / `permission.asked` 等（`session.ts:122-132`） | 部分。bridge 发 `turn.start/token/tool/end/error` 五种事件，可投影一部分 | 事件面不对等：缺 `session.updated`、`permission.asked` 等；ADR-0010:75 声明的 `bridge.shutdown` 事件**未实现**（`emitEvent` 调用点只有上述五种）；需要投影层 + 决定哪些事件显式不发 | **PARTIAL** | `bridge:552-716`（全部 emitEvent 调用点）；ADR-0010:68-76；`session.ts:122-132` |
| 19 | `dispose` :815 | `dispose(): Promise<void>` | 是。客户端退订 + `session.close`；bridge EOF/fiber dispose 都做完整 teardown 并走宿主 appExit 优雅退出 | 无（`bridge.shutdown` 事件缺失不影响 dispose 行为） | **COVERED** | `bridge:1004-1013`、`bridge:1238-1253`、`bridge:1260-1297` |

统计：**COVERED 4**（#5 #6 #7 #19）；**PARTIAL 7**（#1 #4 #9 #11 #15 #17 #18）；**UNSUPPORTED 8**（#2 #3 #8 #10 #12 #13 #14 #16）。合计 19。

## 2. 缺口清单（按实现代价从低到高排序）

代价口径：A = 只改客户端接线/只读投影；B = 加一个 bridge IPC 帧，宿主能力已存在；C = 加 IPC 帧且需先确认/新增宿主侧能力；D = 需宿主侧新能力或双向协议，本仓无法单独完成。

| 序 | 成员 | 代价 | 要补什么 |
|---|---|---|---|
| 1 | `currentModelSelection` (#15) | A/B | 宿主能力已在 bridge 内（`agentDefaultModel.currentSelection()`，`bridge:290-304`）。加一个只读帧并把 `provider/model` 改名为 `providerID/modelID` 即可 |
| 2 | `status` (#1) | A | 客户端状态机：ping 成功→connected，`turn.start`→starting/running，`turn.end/error`→idle，`session.open/close`→sessionAttached；`reconnecting` 需要握手重试语义（新帧或约定）。无新宿主能力 |
| 3 | `usageSummary` (#17) | A | 客户端缓存 `turn.end.usage` 并聚合成 `string[]`；无新帧 |
| 4 | `onSessionEvent` (#18) | A/B | 客户端把 5 种 turn.* 事件投影成 `SeamSessionEvent`；需决定 `session.updated`/`permission.asked` 等是显式不发还是新增帧；`bridge.shutdown`（ADR-0010:75）若要发，加一个 emit 点 |
| 5 | `storedTranscript` (#4) | A/B | 把 `journal.replay` 的 `{seq,type,payload}` 投影为 `SeamTranscriptRow`；明确 `skip`（行数）→ `from`（seq）的映射。原始读取已具备（`bridge:1120`） |
| 6 | `interrupt` (#11) | A | 客户端以当前 turnId 调 `turn.abort` 并吞掉 promise；bridge 侧无需改（`bridge:1027-1085`） |
| 7 | `steer` (#10) | B | 新帧 `session.steer`，桥内转 `agent.steer(message)`（`bridge:948-956` 已有同型调用）；定义无在途 turn 时降级为 followup |
| 8 | `listSessions` (#2) | C | 新帧 `session.list`（ADR-0010:61 已声明但未实现）；先确认宿主是否有会话枚举服务——bridge 的 `PersistenceLike` 只有 `open`（`bridge:155-158`），**宿主侧能力本身是否存在未确认** |
| 9 | `searchSessions` (#3) | C | 新帧 + 宿主搜索能力确认；若宿主无搜索服务，阶段一只能 `UNSUPPORTED` 或基于 #8 的客户端扫描 |
| 10 | `renameSession` (#8) | C | 新帧 + 宿主改名/标题能力确认（宿主装有 `dsh-session-title`，但 bridge 未引用，能否直调 UNKNOWN） |
| 11 | `listProviders` (#13) / `modelCatalog` (#14) | C | 新只读帧 + 宿主 provider/model catalog 服务确认；`force` 刷新语义待确认 |
| 12 | `selectModel` (#16) | C | 新写入帧 + 宿主设置/选择服务确认；bridge 现有 `agentOptions` 是只读 getter（`bridge:290-304`），不能写回 |
| 13 | `registerAskProvider` / `onApprove` (#12 + #9 的 onApprove) | **D** | **双向协议**：宿主 ask/permission 事件下推（新 event）+ 客户端回答回传（新 request），且要与 `turn()` 的 `cb.onApprove` 对齐。宿主 user-questions 能力存在但在 bridge 中完全未暴露。这是唯一需要新协议语义而非单纯补帧的缺口 |

## 3. 默认路径切换（M2 / T9）需要的最小集

依据：M2 放行门 = 门禁①（`/resume`、`--session`、`--resume-last` 三入口恢复历史）+ 门禁②（abort 后同会话）+ 双向崩溃用例（`tickets/2026-11-18-inproc-bridge-plan.md:27-32`）。

**阶段一必须真实现（否则门禁①②过不了）**：
- `resumeSession` (#6) + `newSession` (#7)：三入口的 id staging（同步面），落到 bridge `session.open{mode:"resume"|"new"}`。
- `turn` (#9)：`session.send` + turn 事件流；至少 `onContentDelta/onThinkingDelta/onError` 要真通；`onApprove` 若宿主不发 ask 帧，本阶段需按 §4 拍板降级。
- `storedTranscript` (#4)：journal.replay + 投影，历史渲染与门禁③的前置。
- `currentSessionId` (#5)：I5 状态栏常显与 I1 可观测性前提（ADR-0010:18）。
- `status` (#1)：footer 与 idle 判定，最小可用即可（不需要精确 `reconnecting`）。
- `onSessionEvent` (#18)：journal feed 入口；最小只投影已有 turn.*。
- `interrupt` (#11)：门禁②依赖 `turn.abort`。
- `dispose` (#19)：`session.close` + EOF teardown，双向崩溃用例的一部分。
- `listSessions` (#2)：**取决于 `/resume` 选择器是否在门禁①内**。若 `/resume` 必须列出可选会话，则它是启动必需且属于 UNSUPPORTED 硬缺口（见 §4 待拍板）；若阶段一只接受显式 id（`--session` / `--resume-last`），可先返回 `UNSUPPORTED`。

**阶段一可用 `UNSUPPORTED` / 降级值撑过（不进门禁①）**：
- `searchSessions` (#3)、`renameSession` (#8)、`steer` (#10)、`listProviders` (#13)、`modelCatalog` (#14)、`selectModel` (#16)：显式 `UNSUPPORTED` 错误。
- `registerAskProvider` (#12)：注册空实现，但**必须在文档/UI 明确 ask/approve 不可用**，不能静默吞掉审批请求。
- `usageSummary` (#17)：返回空数组或缓存值，不阻塞渲染。

**同步签名风险**：`status` / `currentSessionId` / `usageSummary` / `steer` / `interrupt` / `newSession` / `resumeSession` / `registerAskProvider` 都是同步成员。若用"抛错"表达 UNSUPPORTED，可能直接打断 render 路径。阶段一对同步成员建议"降级值 + 日志"，对异步成员用 rejected promise / `UNSUPPORTED` 帧错误；该策略需用户拍板（§4）。

## 4. 风险与未知（不含猜测；每项写清需要什么才能确认）

| 项 | 状态 | 需要什么才能确认 |
|---|---|---|
| 任务所述"宿主包 `@deepseek-ai/*` 中的 SessionSeam 接口" | **事实不符 / UNKNOWN** | 已 grep 全部宿主包位置，无 `SessionSeam` 符号（见 §0）。需用户确认：是否就以 `packages/tui-base/src/seams/session.ts:484` 的 19 个非 optional 成员为准；若另有宿主接口，请给出准确包名:行号，本表需重做 |
| 宿主是否有会话枚举服务（决定 #2 `listSessions` 能否 B 级补） | UNKNOWN | bridge 只声明 `PersistenceLike.open`（`bridge:155-158`）。需检查宿主 `dsh-session-persistence` / `dsh-api-session-controller` 的 `lib/types/*.d.ts`，或真机起 host 后探测 `ctx` 上是否有 list 服务 |
| `journal.replay` 行 → `SeamTranscriptRow` 投影是否正确（门禁③前置） | UNKNOWN | 仓库中无该投影的现成实现（`session-seam-adapter.ts:208-230` 是 remote facade 投影，输入不同）。需一个真实会话的 journal 行样本 + 跑一次投影对比 |
| `onApprove` / ask 审批在 bridge 路径下的语义 | UNKNOWN | bridge 不发 ask 帧（`bridge:552-716`）。需确认宿主 user-questions / permission 服务能否在 bundle 内订阅，以及 tui-pi 的审批桥接方式；需真机触发一次带审批的 turn |
| 宿主改名/标题能力（#8） | UNKNOWN | 宿主装有 `dsh-session-title`，但 bridge 未引用。需查其 d.ts 与 `session/rename` Remote 的宿主实现 |
| 宿主 provider/model catalog 与 selectModel 能力（#13/#14/#16） | UNKNOWN | bridge 只用 `currentSelection()`（`bridge:290-304`）。需查 `dsh-client-ui-model-selection` / `dsh-api-settings-controller` 的宿主实现 |
| `resumeSession` 返回 `"owned"` 的时机 | UNKNOWN | remote 恒返回 `"ok"`（`remote-host-session.ts:760-764`），真实占用在下一 turn 报 `SESSION_LOCKED`。需用户/实现方确认阶段一是否接受"延迟到 turn 报错" |
| 宿主错误类 `this.name` 映射（ADR-0010:91-99）在 0.2.2-rc.3 是否仍成立 | UNKNOWN | `bridge:306-342` 按稳定 name 映射，但仓库内无对应单测。需查宿主 `dsh-session-persistence` 的 `lib/types/errors.d.ts` 并跑一次真机 writer-held 复现 |
| `bridge.shutdown` 事件（ADR-0010:75） | 确认缺失 | `emitEvent` 调用点只有 5 种 turn.*（`bridge:552-716`）；需决定是否本阶段补发 |

## 5. 结论摘要

- 十九成员中：COVERED 4 / PARTIAL 7 / UNSUPPORTED 8。
- 默认路径切换本身（staging + open/send/close/abort/replay）已被 bridge 覆盖；** blocking 缺口集中在"非会话核心"的 8 个 UNSUPPORTED 与 1 个双向审批协议**。
- 最大未知不是代码量，而是"宿主侧是否提供 list/search/catalog/rename/select 能力"——这些无法从 bridge 代码确认；在确认前，相关成员必须显式 UNSUPPORTED。
