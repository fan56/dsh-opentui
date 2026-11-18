# `opentui-inproc` 只挂 sessionController 服务可行性（只读查证）

日期：2026-11-18
工作区：`/Users/qingguee/repo/dsh-opentui-wt-inproc`（HEAD `8e6f267`）
性质：只读查证。未改源码 / profile，未 commit。scratch home 凭据零打印。
口径：宿主 `@deepseek-ai/dsh` 0.2.2-rc.3。下文 `$HOST` = `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`。

## 0. 结论先行

**STANDALONE-FEASIBLE（需 2 个薄 shim）**。

一句话理由：`sessionController` 是一个独立 cordis 插件（web-app 里仅一行 `id/name`，无 config），13 个 inject 中 **11 个已在 `dsh-base`/inproc profile 里**，只有 `fileUploads` 与 `workspaceRegistry` 缺失且来自 web-app；两者在 session-controller 源码里都是 `import type`，可被本地 ~40–60 行 shim 顶替，因此**无需拉入 dsh-web-app bundle**。

预估实现代价：**2–4 小时**（shim 40–60 行 + patch 加 1 行 ~0.5h；运行时探针验证 13 inject 全满足 ~1h；`session.list` 帧回归 + remote 行数对拍 ~1–2h）。若选择「挂载真实 `dsh-workspace` 只 stub `fileUploads`」的中间路线，代价相近但少一个 shim。

> 边界：本结论只保证 `list()`（`/resume` 所需）可用。stub 会让 `create/prompt/fork` 等 RPC 变 no-op；inproc bridge 当前只暴露 `session.list`（`packages/bridge/src/index.ts:1181-1200`），可接受，但需在报告中明列为风险。

---

## 1. 证据表（事实 / 文件:行）

| # | 事实 | 含义 | 文件:行 |
|---|---|---|---|
| F1 | `dsh-api-session-controller` 入口 `main: lib/index.js`、`exports.{".","./types","./typert",...}`；`dependencies` 仅 6 个（brand/deque/timeout/schemastery/mime-types/zod），`peerDependencies` 31 个（多为宿主已有服务包） | 包本身是**服务实现**，非 web UI/HTTP 路由包；依赖可挂在既有宿主 closure 上 | `$HOST/dsh-api-session-controller/package.json`（`main`/`exports`/`dependencies`/`peerDependencies` 段） |
| F2 | `class SessionController extends TypertRemoteService`，`static inject = [agentDefaultModel, agents, attachments, fileUploads, fs, llm, remoteAccess, sessions, sessionProjections, sessionQuery, typert, typertGateway, workspaceRegistry]`（13 项） | 挂载前提是 13 个 inject 服务全部注册；缺一个即 cordis pending | `$HOST/dsh-api-session-controller/src/index.ts:135-150` |
| F3 | 构造函数 `super(ctx, 'sessionController', { namespace: 'session' })`；`[Service.init]` 构造 `ApiSessionAgentController`/`SessionCommandController`/`SessionControlController`/`HistoryController`/`StateController`/`WebController`/`ApiSessionList` 七个控制器，并 `ctx.plugin` 四个子插件（FileReferences/MediaReferences/SkillCatalog/ArchivedSessionGate） | **不是薄 list 服务**，是重编排器；但 `list()` 只用到其中 `ApiSessionList` 一路 | `$HOST/dsh-api-session-controller/src/index.ts:178-187,189-247` |
| F4 | web-app 注册仅两行：`- id: session-controller` / `name: '@deepseek-ai/dsh-api-session-controller'`，**无 config、无额外 inject 覆盖** | 最小复刻只需在 inproc 的 `cordis.patch.yml` 加同款两行 + 本地 shim 插件；无需 bundle | `$HOST/dsh-web-app/cordis.patch.yml:116-118` |
| F5 | `dsh-base/cordis.patch.yml` 无 `session-controller` 行；inproc `--dump-config` 中无该包 | 现状确认缺失；与盘点报告一致 | `$HOST/dsh-base/cordis.patch.yml`；`/private/tmp/inproc-inventory-probe/dump-opentui-inproc.txt`；本仓 `tickets/2026-11-18-inproc-profile-inventory.md:153-164` |
| F6 | 13 inject 中 11 个对应服务在 inproc base 已注册：`agents`(dsh-agent)、`sessions`(dsh-session)、`sessionProjections`(dsh-session-projection)、`sessionQuery`(dsh-session-query-sqlite)、`typert`(dsh-typert-registry)、`typertGateway`(dsh-api-gateway)、`remoteAccess`(dsh-api-remote-access)、`llm`(dsh-llm)、`agentDefaultModel`(dsh-agent-default-model)、`attachments`（`dsh-attachment-local` 的 `LocalAttachmentStore extends AttachmentStore`，后者 `super(ctx,'attachments')`）、`fs`（`fs-sandbox` 的 `SandboxedFileSystem extends LocalFileSystem extends FileSystem`，后者 `super(ctx,'fs')`） | 只有 2 个 inject 需要额外处理 | `$HOST/dsh-attachment/src/index.ts:77-79`；`$HOST/dsh-attachment-local/src/index.ts:151,178`；`$HOST/dsh-fs/src/index.ts:104-106`；`$HOST/dsh-fs-local/src/index.ts:74,113`；`$HOST/dsh-fs-sandbox/src/index.ts:55-62`；`$HOST/dsh-base/cordis.patch.yml:146-147,539-540`；inproc dump-config |
| F7 | 缺失的 2 个 inject：`fileUploads` 由 `dsh-client-file-upload` 提供（`super(ctx,'fileUploads')`）；`workspaceRegistry` 由 `dsh-workspace` 提供（`super(ctx,'workspaceRegistry')`）。二者在 web dump 中存在、inproc dump 中不存在 | 这是全部「web 闭包」入口 | `$HOST/dsh-client-file-upload/src/index.ts`（service reg）；`$HOST/dsh-workspace/src/index.ts:187`（`super(ctx,'workspaceRegistry')`）；`/private/tmp/inproc-inventory-probe/dump-web.txt:453,527`；inproc dump 无 |
| F8 | `dsh-client-file-upload` 自身 `static inject = ['agents','attachments','commands','connection']`；web patch 中 `connection` 条目为 `id: connection` / `name: '@deepseek-ai/dsh-client-connection'` / `inject: [webStartup]` / `config.trustedHosts: ctx.webStartup.trustedHosts`；`webStartup` 注册方是 `dsh-web-app/src/startup.ts` 与 `dsh-cmdline` | **直接挂载真实 fileUploads 会强制拉入 web-app bundle**（`connection → webStartup`）。因此必须 stub 或另辟 shim——这是本调研的决定性约束 | `$HOST/dsh-client-file-upload/src/index.ts:59`；`$HOST/dsh-web-app/cordis.patch.yml:238-250`；`$HOST/dsh-web-app/src/startup.ts`；`$HOST/dsh-cmdline/src/index.ts` |
| F9 | session-controller 源码对这 2 个服务全是 `import type`：index.ts:10 `import type {} from '.../dsh-client-file-upload'`；commands.ts:15-16 `import type {...}`；archived-session-gate.ts:15 `import type {} from '.../dsh-workspace'`；types.ts:15 仅类型 | **无运行时代码依赖**，shim 只需实现被调方法，不需要真实包 | F2 同文件：`$HOST/dsh-api-session-controller/src/index.ts:10`；`.../src/commands.ts:15-16`；`.../src/archived-session-gate.ts:15`；`.../src/types.ts:15` |
| F10 | 被调方法面很窄：`fileUploads.registerAgentResolver`（初始化一次，`index.ts:195`）、`resolve/bindPrompt/retirePrompt`（commands，仅 prompt 流程）；`workspaceRegistry.archivedSessionIds`（`archived-session-gate.ts:47`，初始化即读）、`get/list`（commands 的 create 流程） | 只服务 `list()` 时，`fileUploads` shim 只需 `registerAgentResolver: ()=>()=>{}`（返回 dispose），`workspaceRegistry` shim 只需 `archivedSessionIds: []`；`get/list` 可给空实现 | `$HOST/dsh-api-session-controller/src/index.ts:195`；`.../src/commands.ts:342,372,506,126,140,570`；`.../src/archived-session-gate.ts:25-34,46-58` |
| F11 | `list()` 正文：`const items = await this.listState.list(signal)` → `items.filter(item => this.ctx.remoteAccess.allows({kind:'session',id:item.sessionId}))`；`ApiSessionList.initialize()` 用 `ctx.sessionProjections.register` 与 `ctx.attachments.imageLimits`；`list()` 再读 `ctx.sessionQuery.listSessions`、`ctx.sessions`、`ctx.agents` | list 路径的硬依赖全在 base（F6），无 HTTP/路由/token | `$HOST/dsh-api-session-controller/src/index.ts:282-285`；`.../src/list.ts:91-112,125-133,147,154` |
| F12 | 桥以**直接方法调用** `controller.list({_request:{...}})`，不经 Typert RPC gateway | 决定 U4 的调用形态 | `/Users/qingguee/repo/dsh-opentui-wt-inproc/packages/bridge/src/index.ts:1198`；`resolveSessionController` 见 `:329-348` |
| F13 | 依赖闭包：controller 直接依赖 6 / peer 31 / dev 46；web-app 直接依赖 **145** / peer 3 / dev 21。盘点报告实测 web profile 205 条目 / 42M node_modules，inproc 103 条目 / 0B | 挂 controller 的闭包远小于 web-app（即使含 2–3 个 shim） | `$HOST/dsh-api-session-controller/package.json`、`$HOST/dsh-web-app/package.json`（`dependencies` 计数）；本仓 `tickets/2026-11-18-inproc-profile-inventory.md:89-98,214-217` |
| F14 | `SessionController.init()` 挂载的子插件 `SessionMediaReferences` 自身 `inject: ['connection', 'fs', 'attachments']`，且 `ctx.connection.fetch.register(...)`（`media-references.ts:70-77,74`） | 这是包内**唯一的 web-context 耦合**，但属于 `ctx.plugin` 子插件：缺 `connection` 时该子插件 pending，**不阻塞父 `SessionController` 激活与 `list()`**；file-display 能力降级。要消除 pending warning 可加第 3 个 `connection` shim（no-op `fetch.register`） | `$HOST/dsh-api-session-controller/src/media-references.ts:70-77`；`.../src/index.ts:217` |

### U4 结论（feasibility 报告 U4：inproc 下 `remoteAccess.allows` 是否放行全部本地会话）

**答案：放行全部（无过滤）**。证据链：

1. `allows(resource)`：`const invocation = this.ctx.invocation; const principal = principalOf(invocation); if (invocation === undefined || principal === undefined) return true`（`$HOST/dsh-api-remote-access/src/index.ts:235-244`）。
2. `principalOf(invocation)`：`invocation?.peer.principal`，`principal?.kind === 'owner' ? undefined : principal`——即「不在 Remote 调用中」或「owner」都返回 `undefined`（`$HOST/dsh-typert-protocol/src/principal.ts:14-17`）。
3. 桥是**直接方法调用**（F12），`ctx.invocation === undefined` → `allows()` 第一步即 `return true`。

因此纯 inproc 挂载后 `sessionController.list()` 返回**全部本地会话**，不会因 remoteAccess 策略少列。若未来改走 gateway 但仍是 owner 身份，`principalOf` 同样返回 `undefined` → 仍全放行。仅当以非 owner peer 经 RPC 调用时才按 policy 过滤——与当前 inproc 场景无关。风险等级：低。

---

## 2. 最小注册骨架要点（不写完整代码）

本地 cordis 插件（可放在 `packages/bridge` 或新增独立小包）需做三件事：

1. **提供 2 个 shim 服务**（用 cordis `Service` 子类，`super(ctx, 'fileUploads')` / `super(ctx, 'workspaceRegistry')`，并在 `[Service.init]` 里挂到 ctx），只实现 F10 列出的方法面：
   - `fileUploads`：`registerAgentResolver(fn)` 返回 dispose（no-op 即可）；`resolve/bindPrompt/retirePrompt` 给空实现，保证 prompt 流程不崩（虽 inproc 不暴露）。
   - `workspaceRegistry`：`archivedSessionIds = []`（getter）；`get/list` 返回空集合。
   - **可选第 3 个** `connection`：no-op `fetch.register(...)`，仅为消除 `SessionMediaReferences` 子插件的 pending warning（F14）；不影响 `list()` 正确性。
2. **挂载真实服务**：插件 `inject` 声明 F2 的 13 项（shim 服务 + base 11 项），在 `apply(ctx)` 里 `ctx.plugin(SessionController)`（从 `@deepseek-ai/dsh-api-session-controller` 导入类）。cordis 会在 13 项齐备后激活；config 传 `{}`（`listWorkSliceMs` 默认 16，F4 证实 web 无 config）。
3. **profile 接线**：在 inproc 的 `cordis.patch.yml` 追加该本地插件条目（仿 `id: session-controller` / `name: <本地包>`），**不改 bundle 列表**（不引入 `dsh-web-app`）。bridge 侧 `resolveSessionController`（`packages/bridge/src/index.ts:332-348`）已用 `ctx.get('sessionController')`，服务激活后即可取到；`inject` 当前仅 `['agents']`，按 U1 讨论可加 `sessionController` 到 bridge inject 以消除取服务竞态（可选，非必须——服务已挂载时 `ctx.get` 可用）。

关键：shim 与真实包全为 `import type`（F9），无 runtime 依赖，因此 `node_modules` 不需要 `dsh-client-file-upload`/`dsh-workspace` 副本；满足 provision 脚本「profile 内禁止 `@deepseek-ai/*` 副本」的约束（本仓 `tickets/2026-11-18-inproc-profile-inventory.md:28-33`）。

---

## 3. 未知项清单（留白优于猜测）

| 编号 | 未知项 | 是否阻塞 | 确认方法 |
|---|---|---|---|
| N1 | shim 服务是否需在 `inject` 之外还满足 cordis 的「服务名唯一/命名空间」约束（如与 base 某服务重名） | 不阻塞（实现时即可发现） | 起宿主后看 `session-controller` 是否从 pending 转为 active |
| N2 | `ApiSessionList.initialize()` 里 `ctx.attachments.imageLimits` 是否真由 `dsh-attachment-local` 提供具体值（F6 仅证实服务注册，未证实 `imageLimits` 字段非空） | 不阻塞（wire view 缺省可 fail-open） | 跑一次 `session.list` 看是否抛 `imageLimits` 相关错 |
| ~~N3~~ | ~~`WebController` 是否触碰 HTTP/webStartup~~ | **已查证：否** | `web/controller.ts:1-24` 仅 import cordis/typert/session-query/history；无 HTTP/fetch/webStartup。真正的 web 耦合是 F14 的 `SessionMediaReferences`（`connection`），属子插件 pending，不阻塞 list |
| N4 | shim 下 `create/prompt/fork` 等 RPC 变 no-op 是否会被 TUI 客户端误触发（inproc bridge 未暴露，但客户端其他路径可能间接调用） | 不阻塞（当前范围只 `/resume`） | 起桥后跑一轮 `/resume` + 普通会话流程，确认无异常调用 |
| N5 | 宿主升级（>0.2.2-rc.3）后 13 inject 列表或 wire 形状变化导致 shim 失效 | 不阻塞（版本门） | 升级前对 inject 列表与 `SessionSummary` wire 做 diff；handshake 已有版本比对可扩展 |

---

## 4. 一句话总结

可只挂 `sessionController` 而不引入 web-app bundle：真实插件 + 2 个薄 shim（`fileUploads`/`workspaceRegistry`，可选第 3 个 `connection`）即可满足 13 inject，`list()` 全部依赖在 base；U4 已证实在进程内 direct call 下 `remoteAccess.allows` 全放行；`WebController` 已查证无 HTTP 依赖（N3 已消解）。代价 2–4 小时，主要风险是 stub 对非 list RPC 的语义裁剪（N4）与子插件 pending 的运行时表现（N1/F14）。
