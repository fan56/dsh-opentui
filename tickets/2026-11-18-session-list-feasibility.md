# 宿主持久层「会话枚举」能力可行性调研（listSessions / `session.list`）

日期：2026-11-18
工作区：`/Users/qingguee/repo/dsh-opentui-wt-inproc`（worktree，HEAD `863f80b`）
性质：只读调研，**不含实现**，不改源码、不 git add / commit；只新增本文档。
口径：宿主 `@deepseek-ai/dsh` **0.2.2-rc.3**（`/opt/homebrew/.../dsh/package.json`），profile `node_modules/@deepseek-ai/*` 软链至此。

> **已落地（commit `7e66b3f` + `2b5e2f1`，2026-11-18）**：本文是当时的只读调研，结论中「桥侧缺口 / U1 阻塞」均已消解——`7e66b3f` 已在 bridge `handleLine` 加 `session.list` 帧（`ctx.get('sessionController').list`，`{items: SessionSummary[]}` 原样透传，含单测）；`2b5e2f1` 为 inproc profile 生成 standalone `sessionController` shim，默认 profile 下 `ctx.get('sessionController')` 可用，真机实测 `session.list` 返回真实会话行（见 `docs/adr/0010-session-seam-lifecycle-contract.md` 的 session.list 契约段）。下方 §0 与 §4 U1 的过期表述逐条标注「已解决」，原文保留供追溯。

## 0. 结论先行

**FEASIBLE-WITH-ADAPTER**。

一句话理由：宿主 `ctx.sessionPersistence` **本身就有 `list()` / `stat()`**（`dsh-session-persistence/lib/types/index.d.ts:160,166`），且宿主 `sessionController.list()` 正是 thin client `/resume` 走的 `session/list` RPC 的服务端（`dsh-api-session-controller/lib/typert.host.js:2168`），能力在 0.2.2-rc.3 已存在；缺口只在桥侧——`PersistenceLike` 仅声明 `open`（本仓 `packages/bridge/src/index.ts:157`）、dispatch 无 `session.list`（落到 UNSUPPORTED，`:1235`），所以需**加帧 + 扩结构切片 + 照抄 remote 投影**，无需宿主新增能力。**（已解决：`7e66b3f` 已按该路径加帧 + 扩 `SessionControllerLike` 切片 + 照抄远端投影；本句描述的是调研时状态。）**

因此 `tickets/2026-11-18-seam-capability-matrix.md:30,64,98` 中 #2 `listSessions` 的 **UNSUPPORTED / C 级 / UNKNOWN** 应下调为 **PARTIAL / B 级 / 宿主能力已确认存在**；唯一的运行时未知是「桥能否通过 `ctx.get('sessionController')` 拿到该服务」（见 §4 未知项 U1）。**（已解决：矩阵 #2 已随 `7e66b3f` + `2b5e2f1` 升为可用；唯一的 U1 已由 standalone shim 消解，见顶部注记与 U1 行。）**

## 1. 证据表（事实 / 结论 / 文件:行）

宿主文件缩写：`persist/index.d.ts` = `$HOST/dsh-session-persistence/lib/types/index.d.ts`；`ctrl/types.d.ts` = `$HOST/dsh-api-session-controller/lib/types/types.d.ts`；`$HOST` = `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`。

| # | 事实（原文签名/行为） | 结论 | 文件:行 |
|---|---|---|---|
| F1 | `abstract open(id, access, options?): Promise<SessionHandle>`、`abstract stat(id, options?): Promise<SessionPersistenceSnapshot\|undefined>`、`abstract list(options?): Promise<readonly SessionPersistenceSnapshot[]>` —— `ctx.sessionPersistence` 是含枚举的服务 | 宿主持久层**具备会话枚举**，且就在桥已解析的同一服务上 | `persist/index.d.ts:133,160,166` |
| F2 | `SessionPersistenceSnapshot` 带 `header: SessionHeader`、`eventCount?`、`sizeBytes?`、`revision`、`location?`；`list()` JSDoc「List every stored session visible to this process, in no promised order」，明确「without reading the full event log」 | 枚举读的是**头部/轻量快照**，不读全量 journal；排序不承诺，需客户端排 | `persist/index.d.ts:19-40,161-166` |
| F3 | `SessionHeader` 含 `id`、`createdAt: number`、`cwd?`、`origin?: 'subagent'`、`parentSession?`、`delegationDepth?`；**无 title、无 updatedAt** | 标题/活跃时间不在持久层头部，来自投影层（F5/F8）；直接 `persistence.list()` 拿不到 title | `$HOST/dsh-session/lib/types/types.d.ts:59-100` |
| F4 | `ctx.sessionController: SessionController` 由 cordis 提供；服务注册为 `super(ctx, "sessionController", { namespace: "session" })` | 桥可用 `ctx.get('sessionController')` 取到服务（与现有 `ctx.get('sessionPersistence')` 同模式） | `dsh-api-session-controller/lib/types/index.d.ts:16`；`dsh-api-session-controller/lib/index.js:3885` |
| F5 | `@Remote('list') async list(_request: SessionListRequest, signal): Promise<SessionListValue>`，「Read all visible Session rows without resuming an Agent」「ordered by activity」；handler：`session/list` → `service: 'sessionController'` | thin client 的 `session/list` RPC 服务端就是它 | `dsh-api-session-controller/lib/typert.host.js:2168,2740`；`dsh-api-session-controller/lib/index.js:3988-3990` |
| F6 | `SessionController.list()` → `listState.list(signal)` → `ctx.sessionQuery.listSessions(signal)`，对 cold 记录 `summarizeCold()`，最后 `items.sort((l,r)=>r.updatedAt-l.updatedAt)`；按 `workSliceMs` `scheduler.yield()` 分片 | 枚举为 O(N) 轻量记录 + 缓存投影，宿主内已按 updatedAt 降序；不阻塞事件循环；再按 `remoteAccess.allows` 过滤 | `dsh-api-session-controller/lib/index.js:2843-2873,3988-3990` |
| F7 | `SessionListValue { items: readonly SessionSummary[] }`；`SessionListRequest { cursor?: string }`（**有游标字段，但 thin client 不传**） | 单次调用返回全量可见行（有序），无强制分页；游标为预留 | `ctrl/types.d.ts:249-255`；`dsh-api-session-controller/lib/typert.host.js:2178-2195` |
| F8 | `SessionSummary { sessionId, updatedAt:number, running, blank, parentSessionId?, origin?, cwd?, projections? }`；`projections.values` 含 `title` | 覆盖 `/resume` 所需 id/title/updatedAt/cwd/blank/origin；`sizeBytes` 不在该类型（远端是防御性读取，可缺省） | `ctrl/types.d.ts:41-59,138-151,294` |
| F9 | `ApiSessionList.search()` → `ctx.get("sessionQuery")`，`searchSessions/searchEvents` 带 FTS5、filter、limit、cursor；`dsh-session-query-sqlite` 用 SQLite FTS5（`SESSION_QUERY_SQLITE_SCHEMA_VERSION=8`） | 搜索/索引能力也存在（阶段一可继续 `UNSUPPORTED`，但非「宿主无能力」） | `dsh-api-session-controller/lib/index.js:2894-2897`；`$HOST/dsh-session-query/lib/types/index.d.ts:63,70,90`；`$HOST/dsh-session-query-sqlite/lib/types/schema.d.ts:1-15` |
| F10 | 远端链路：`RemoteHostSession.listSessions` → `RemoteSessionOps.listSessions` → `rpc("session/list",{_request:{}})` → 过滤 `origin==='subagent'`、retentionDays cutoff、`sort` desc、`slice(0,limit)`，title 取 `row.projections.values.title` | **最可能直接复用的路径**：协议方法、宿主 handler、行形状、投影规则全部已存在且有实现 | 本仓 `packages/shell/src/client/remote-host-session.ts:1079-1086`；`packages/shell/src/client/remote-session-ops.ts:234-305`；`packages/shell/src/client/session-seam-adapter.ts:174-184` |
| F11 | 桥侧：`interface PersistenceLike { open(...) }`（仅 open）；dispatch 的 method 集合为 ping/hello/open/send/close/abort/replay，无 `session.list`，否则 `replyError(..., 'UNSUPPORTED', ...)` | 桥缺口明确，且 `session.list` 早已在 ADR 声明 | 本仓 `packages/bridge/src/index.ts:156-158,1187-1235`；`docs/adr/0010-session-seam-lifecycle-contract.md:61` |
| F12 | 桥用 `ctx.get(name)` 解析宿主服务（`sessionPersistence` 即如此）；`inject = ['agents']`，`get?` 为可选字段 | 复用宿主 list 服务无需新协议语义；是否要加 `inject` 注入取决于运行时探测（U1） | 本仓 `packages/bridge/src/index.ts:84-85,200,276-285` |
| F13 | `SeamSessionSummary { id, title, updatedAt?, cwd?, sizeBytes?, blank?, parentID? }` | F8 的 `SessionSummary` 与该形状逐字段可投影（id←sessionId，title←projections.values.title，其余同名） | 本仓 `packages/tui-base/src/seams/session.ts:71-83` |

## 2. 推荐实现路径（照抄现有 remote 方案，不自研）

1. **桥侧加帧**：在 `handleLine` dispatch 新增 `session.list`（ADR-0010:61 已声明，无协议版本变更，`PROTOCOL_VERSION` 仍为 1）。调用宿主解析 `ctx.get('sessionController')`，执行 `controller.list({ _request: {} })`，回 `{ items: SessionSummary[] }`——**直接复用远端 `session/list` 的 wire 形状**（F5/F7），使客户端投影逻辑可照抄。
   - 备选更低风险路径：若 U1 证明 `sessionController` 取不到，则扩 `PersistenceLike` 增加 `list()`，调 `ctx.sessionPersistence.list()`（F1，桥已能解析该服务）。代价：头部无 title/updatedAt（F3），需另经 `sessionQuery.readTitle*`（F9）补标题，投影更重——**不推荐作首选**。
2. **seam 适配器照抄投影**：`BridgeSessionSeam.listSessions(limit?)` 按 `session-seam-adapter.ts:174-184` 逐字段映射；并照抄 `remote-session-ops.ts:271-305` 的客户端规则：过滤 `origin==='subagent'`、retentionDays cutoff、按 `updatedAt` 降序、`slice(0, limit)`、`btw:` 前缀行过滤（`remote-host-session.ts:1082-1085`）。宿主已排序（F6），客户端排序为双保险。
3. **宿主暴露 / 版本约束**：宿主无需新增能力（0.2.2-rc.3 已具备 F1/F4/F5/F9）。若 `ctx.get('sessionController')` 在桥 ctx 不可用，唯一「宿主暴露」动作是把 `'sessionController'` 加入桥的 `inject`（当前仅 `['agents']`，F12）。协议版本不变；旧宿主兼容策略见 U3。

## 3. 规模与性能

- 枚举 N 个会话的代价为 **O(N) 轻量头部 + 缓存投影**，不是读全量 journal：`ApiSessionList.list()` 从 `sessionQuery.listSessions(signal)` 取记录，live 会话走内存投影 `summaryFor`，cold 会话走 `summarizeCold`（头部 + 投影缓存），并按 `workSliceMs` yield（F6）；持久层 `list()` 明确「without reading the full event log」（F2）。
- 宿主侧已按 `updatedAt` 降序（F6）；`limit` 截断在客户端完成（F10），因此 N 大时 RPC 仍返回全量——若后续会话量很大，可用 `SessionListRequest.cursor`（F7）或 `sessionQuery.filterSessions`（F9）在桥侧提前收窄，但阶段一 `/resume` 规模无需。

## 4. 未知项（无法从静态声明确认；留白优于猜测）

| 编号 | 未知项 | 是否阻塞 | 需要什么才能确认 |
|---|---|---|---|
| U1 | 桥运行时能否 `ctx.get('sessionController')` 取到服务（`get?` 为可选；`inject` 仅 `agents`） | **已解决（原为阻塞前提；`7e66b3f` + `2b5e2f1`）** | 由 `2b5e2f1` 的 inproc standalone `sessionController` shim 消解：默认 profile 下 `ctx.get('sessionController')` 可用，真机实测 `session.list` 返回真实会话行（ADR-0010 session.list 契约段）。无需把 `sessionController` 加入必填 `inject`，也无需退到 `PersistenceLike.list()` 备选路径 |
| U2 | `sizeBytes` 是否真出现在 `session/list` wire（`SessionSummary` 未声明，远端仅防御性读取） | 不阻塞（seam 字段可选） | 取一条真实会话行样本核对；缺省即可，view 已 fail-open |
| U3 | 宿主最低版本/是否所有部署都挂载 `sessionController` + `sessionQuery`；旧宿主缺 `session/list` route 时的兼容策略 | 部分阻塞（版本门） | 查宿主 changelog / 对旧版宿主做一次 `session/list` 探测；桥 handshake 已有 `bridge.hello` 版本比对，可在此加能力探测并降级 UNSUPPORTED |
| U4 | 在进程内（非 remote）场景 `remoteAccess.allows({kind:'session',id})` 是否放行全部本地会话 | 不阻塞但影响正确性 | 真机起桥后对比 `session/list` 返回行数与 `sessionPersistence.list()` 行数；若被过滤，需走不过滤的底层 `ApiSessionList.list()` |
| U5 | `updatedAt`（来自 `sessionListMetadata.lastPromptAt`/header）语义是否满足 auto-resume 对 blank 会话的跳过逻辑 | 不阻塞 | 用一个 blank 会话 + 一个已提示会话的真实行样本跑投影对比 |

## 5. 一句话结论

宿主能力存在且已有可照抄的完整实现（remote `session/list` → `sessionController.list` → `ApiSessionList.list` → `sessionQuery.listSessions`）；`listSessions` 从 UNSUPPORTED 变为 **桥侧加帧 + 投影的 B 级工作**，唯一前置未知是 U1（桥能否取到 `sessionController` 服务）。
