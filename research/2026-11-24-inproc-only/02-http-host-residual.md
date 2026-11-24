# HTTP 宿主运行时残责面（只读调研，2026-11-24）

范围：worktree `/Users/qingguee/repo/dsh-opentui-wt-inproc-only`，HEAD `153c8ce`。此处说的「HTTP 宿主」= boot 期 `lifecycle.ensureV2Host` 拉起的第二个 node 宿主 `dsh --profile opentui --no-open --port N`（`packages/shell/src/client/host-launch.ts:549`）；「inproc 宿主」= `StdioBridgeTransport` 用 stdio 拉起的 `dsh --profile opentui-inproc` 宿主（`packages/shell/src/client/bridge-transport.ts:176-192`）。本文只讨论**删除前者**、保留后者。

一句话总览：当前生产 boot（`client-entry.tsx:main` → `v2-entry.tsx:bootClientV2`）仍然在合成根上 **硬启动 HTTP 宿主并构造 `HTTP client carrier`/`HTTP session facade`**，但真正的会话/命令面已经全部走 `BridgeSessionSeam`。`HTTP session facade` 在 v2 里只剩 4 件事：冷启动 label 等待、skin migration 的一次写、theme/mode/motion 的启动读取、退出 dispose。其中 config 读写本身是**纯本地文件 I/O**（不是 RPC），所以「功能断掉」的范围比表面看到的窄；真正挡路的是 boot 链本身、配置白名单/overlay 解析器不全，以及一整套围绕 HTTP 宿主的进程治理代码。

---

## 结论先行

### P0 — 删除 HTTP 宿主前必须先补/改

| # | 必补能力 | 证据 | 不补的后果 | 仓库里现成实现可否直接接线 |
|---|---|---|---|---|
| P0-1 | 从合成根删除 `ensureV2Host` → `HTTP client carrier` → `HTTP session facade` → `session.start()` 整条 boot 链；给 `host.dshHome` 找一个不依赖 HTTP handle 的替代源 | `v2-entry.tsx:1616,1624-1659,1660`；`host.dshHome` 仍用于 `:1624,1636,1656,1779,1789,1880,1889`；`ensureV2Host` 实现 `retired HTTP lifecycle module:1377-1395`，默认 launcher 在 `host-launch.ts:549` spawn `dsh --profile <p> --no-open --port N` | HTTP 宿主不存在时 `ensureV2Host` 无法启动/采纳进程，`bootClientV2` 在首个 `await` 就抛错，TUI 根本不渲染 | 部分可用：dshHome 可用 `resolveDshHome()`（`remote-local-fs.ts`，`bridge-session-seam.ts:2272` 已在用）或 `seam.settings.identity()`（`bridge-session-seam.ts:1477`）；profile 常量可直接从 `retired HTTP lifecycle module:69` 搬走（`bridge-session-seam.ts:89` 现在还从 lifecycle 引 `DEFAULT_PROFILE`，删除 lifecycle 前必须换源） |
| P0-2 | 把 skin migration 的写从 `session.configSave` 迁到 `seam.configSave`，并补齐 `LocalConfigStore` 的键白名单 + **workspace overlay 写回** | 写点 `v2-entry.tsx:1817`（patch 在 `:1813-1816`）；seam 已有 `configSave`（`bridge-session-seam.ts:3812-3814`）；但 `LocalConfigStore.configSave` 只接受 `CONFIG_KEYS`（`local-config-faces.ts:69-85,367-376`），其中**没有** `skinMigration`、`workspaceTheme`、`workspaceThemeMode`；对比 `HTTP session facade.configSave` 对这三个键有显式路由（`retired HTTP session facade module:1480-1493`） | profile 层：marker 写不进去（迁移仍会因 `theme=dsh-blue` 自然停下，但 one-shot 标记契约被破坏）。workspace 层：整个 patch 被丢弃，legacy `theme` 仍在，`skinMigrationPlan`（`boot-shared.ts:259-283`）每次 boot 都命中，一次性通知反复出现 | 有现成骨架但**不能直接接线**：`LocalConfigStore` 需扩键；workspace 写回应复用 `saveWorkspaceConfig`（`workspace-config.ts:254`，已支持 `theme`/`themeMode`，且 `retired HTTP session facade module:1495-1502` 有读写缓存的写法可参考） |
| P0-3 | theme / themeMode / motion 的 boot 读取改走 seam，并补齐 seam 本地 overlay 解析 | 读取点 `v2-entry.tsx:1826-1827,1834`（helper 定义 `boot-shared.ts:175-211`）；seam 的对应面在 `bridge-session-seam.ts:3800-3813`；`LocalConfigStore.configLoad` 只回传白名单键（`local-config-faces.ts:346-361`），其同步 overlay 读取 `loadWorkspaceConfigState`（`local-config-faces.ts:380-395`）的 YAML fallback **只解析 `theme`**；真正的解析器还读 `themeMode` 和 `model`（`workspace-config.ts:593-606`） | 若直接把 `session` 换成 `seam` 而不补解析器：workspace 层 `themeMode` pin 和 workspace `model` 覆盖在启动读取中丢失（`/theme`、`/model` 的既有 seam 路径仍在，但 boot 首帧主题错）。`motion` 键本身在白名单内，可平滑迁移 | 骨架已有（`seam.configLoad`），解析器需换成 `loadWorkspaceConfig`（`workspace-config.ts:169`）或在 `loadWorkspaceConfigState` 补 `themeMode`/`model` 两行 |
| P0-4 | 退出路径去 HTTP 化：`session.dispose()` → 只留 `seam.dispose()` + `bridgeTransport.close()`；同时去掉 `clientHeartbeat` / `spawnWatchdog` / `lastOneGracefulShutdown` / `host.release()` / `spawnIdleReaper` 对 HTTP 宿主的操作 | `v2-entry.tsx:1860-1892`（`session.dispose` 在 `:1861`，seam/transport 关闭在 `:1865-1869`，heartbeat/watchdog 在 `:1620-1637`，last-one 在 `:1880`，release/reaper 在 `:1889-1890`）；`lastOneGracefulShutdown` 读的是 v2 registry（`client-lifecycle.ts:389-440`），reaper 锁路径 `boot-shared.ts:46,147-165` | 保留这些调用会：注册无人消费的 heartbeat 文件、spawn 一个盯空 registry 的 detached watchdog、给一个不存在的 registry 发 SIGTERM；`lastOneGracefulShutdown` 在 registry 缺失时走 `no-host` 早返回（`client-lifecycle.ts:396-398`），所以不会误杀，但整机机制空转 | 已有 `seam.dispose()`（`bridge-session-seam.ts:4130`）和 `bridgeTransport.close()`（`bridge-transport.ts:419-427`）可直接接线；如要保留「最后一个客户端退出时关 inproc 宿主」，需**重新设计**（见 P1-3） |

### P1 — 功能降级 / 启动体验回退

| # | 项 | 证据 | 降级表现 |
|---|---|---|---|
| P1-1 | 冷启动 label 等待会空转 4s | `v2-entry.tsx:1661-1668` 轮询 `session.label === "dsh-host"`，`BOOT_LABEL_BUDGET_MS = 4000`（`boot-shared.ts:15`）；label 由 HTTP `session/modelCatalog.default` 填充（`retired HTTP session facade module:2361-2370`，RPC 在 `remote-model.ts:172-173`） | 删掉 session 后若保留循环，每次启动白等 4s；正确做法是直接删循环，powerline 的路由本来就从 seam 取（`v2-entry.tsx:461,939`；`bridge-session-seam.ts:3946-3963`） |
| P1-2 | HTTP 宿主专属的进程治理整套失去对象 | v2 registry `host-registry.ts:131`（`opentui-host.<profile>.json`）；heartbeat `client-lifecycle.ts:70-86,216-277`；last-one `client-lifecycle.ts:389-440`；watchdog `client-lifecycle.ts:556-680`；launcher 预启动 `packages/shell/bin/dsh-opentui.mjs:483-535`；legacy idle reaper `boot-shared.ts:105-165` | 删 HTTP 宿主后这些机制要么空转要么需整体删除；inproc 宿主由 `StdioBridgeTransport` 自己管生死（`bridge-transport.ts:176-192,352-405,419-427`），没有跨客户端共享 heartbeat 概念 |
| P1-3 | inproc 宿主没有「最后一个客户端退出即关闭」的对应机制 | inproc 子进程状态机 `bridge-transport.ts:55-64,419-427`；HTTP 侧的等价机制 `client-lifecycle.ts:389-440` 只认 v2 registry 的 pid（`:396-398`） | 单客户端场景无所谓（transport.close 关自己的子进程）；多客户端/崩溃残留场景，谁负责回收 inproc 宿主尚无现成实现。**推测**：把 `lastOneGracefulShutdown` 改成按 bridge child pid 治理是可行的，但需新增「inproc registry」或复用现有 heartbeat 文件，成本不小（依据是 `client-lifecycle.ts` 全文都以 `readRegistry(home, profile)` 为锚点） |
| P1-4 | `/reload` 的同端口 HTTP 宿主重启彻底失效 | `remote-restart.ts:1-44` 明确读 `<dshHome>/opentui-host.<profile>.json` 并重启 `dsh --profile <p> --no-open --port <same>`；`HTTP session facade` 的 `restartHost` 注入点 `retired HTTP session facade module:262-267,1700-1710` | 当前 v2 命令表里**没有** `/reload` 命令（`commands.ts` 的 `coreCommands()` 从 `:683` 起，未列 `/reload`），所以实际用户面影响为零；bridge 侧的恢复入口已存在 `seam-bootstrap.ts:270-294`（`recoverBridgeSession`，`v2-entry.tsx:1690-1695` 接线） |
| P1-5 | 已存在的 bridge 能力缺口不会因删除 HTTP 宿主而新出现，但也不会被补上 | `renameSession` / `steer` / `listProviders` 在 bridge seam 里是显式降级：`bridge-session-seam.ts:4242-4246,4247-4249,4271-4273`；记录于 `tickets/2026-11-18-seam-capability-matrix.md:37,39,42` | 这些面在**当前**生产路径里已经是 UNSUPPORTED/no-op，不是 HTTP 宿主删除造成的回归；如果后续误以为「删 HTTP 宿主会顺带丢这些」属于误判 |

### P2 — 可延后 / 顺带收益 / 文档债

- **双宿主失步风险消失**：ADR 明确两 profile 共享 `~/.dsh/sessions`，后开者须显式 `writer-held`（`docs/adr/0009-inprocess-session-bridge.md:63`）。HTTP 宿主删除后只剩一个宿主，这个共享写风险自然消解；但 bridge 的 `resumeSession` 是同步 staging，不能返回 `"owned"`（`bridge-session-seam.ts:2357-2364`，注释明确「`SESSION_LOCKED` 异步浮现」）。若将来 web/phone writer 仍可能同时在线，需要补异步锁检测（P2）。
- **ADR/CHANGELOG 已过期**：`docs/adr/0009-inprocess-session-bridge.md:70,75` 仍写「`BridgeSessionSeam.configLoad` 降级 `{}`、config 面归 HTTP 宿主」；当前代码已是本地真实读写（`bridge-session-seam.ts:3795-3813`、`local-config-faces.ts:1-24`）。`CHANGELOG.md:492-497` 的 0.22.0 Known debt 也停在旧状态。删完一并更新即可。
- **死代码清理面**（按 import 关系，不碰测试）：`retired HTTP lifecycle module`、`host-launch.ts`、`host-registry.ts`、`host-health.ts`、`host-probe.ts`、`host-port.ts`、`cookie-mint.ts`、`client-lifecycle.ts`、`retired HTTP transport module`、`retired HTTP session facade module`、`remote-restart.ts`、`remote-subagents.ts`、`remote-waterfall.ts`、`shell-session.ts`、`watchdog-cli.ts`、`client-entry.tsx` 的 `bootClient` 分支（`client-entry.tsx:1-80,240-408`）。注意 `bridge-session-seam.ts:74-75,88-89` 仍从 `remote-session-ops.ts`/`remote-local-fs.ts`/`retired HTTP lifecycle module` 取类型和常量，清理时要保留或搬迁这几个具体符号。

---

## 逐项证据

### 1. boot 合成根与 `ensureV2Host` 各步

入口：`packages/shell/bin/dsh-opentui.mjs:483-535` 在 launcher 里先 `legacy host bootstrap({profile:'opentui'})` 预启动 HTTP 宿主（best-effort，`--force` 时致命），随后 spawn bun 客户端；源码 launcher `dsh-opentui:1-22` 直接跑 `client-entry.tsx`。`client-entry.tsx:412-460` 的 `main()` 构造 `StdioBridgeTransport` 注入 `bootClientV2`，**这才是生产路径**；`bootClient()`（`client-entry.tsx:250-408`）是测试 seam，生产不调用。

`bootClientV2` 的时序（`v2-entry.tsx:1596-1668`）：

1. `lifecycle.ensureV2Host({profile, idleExitSec})`（`:1616`）→ `retired HTTP lifecycle module:1377-1395`：进程内 registry 命中则 attach，否则 `bootV2Host`（`retired HTTP lifecycle module:1330-1375`）调默认 launcher `host-launch.ts legacy host bootstrap`。
2. launcher 读/claim v2 registry（`host-launch.ts:436-511`；路径 `<home>/opentui-host.<profile>.json`，`host-registry.ts:131`），`findFreePort`（`:535`）后 spawn `dsh --profile <profile> --no-open --port <port>`（`:549`），等 TCP + 带 owner cookie 的 `GET /` 健康（`:559-575`；`host-health.ts:5-7,86-119`；`host-probe.ts:72-73`），写 `ready` registry（`:579`）。`mintOwnerCookie` 在 `cookie-mint.ts:142`，cookie 同时是 HTTP 与 mux（`host-probe.ts:109`）的凭证。
3. 写回 `host handle`：`v2Managed:true`、`lockOwned:false`、无 idle timer（`retired HTTP lifecycle module:1348-1366`）；cookie 经 `mintCookieWithRetry`（`:1371`）。
4. 客户端注册自己的 heartbeat + detached watchdog（`v2-entry.tsx:1620-1637`），这是 ADR-0009 decision 6 的「引用计数=新鲜 heartbeat 数」模型（`client-lifecycle.ts:8-24,70-86`）。
5. `new HTTP client carrier({authority, cookieHeader, diagnostics})`（`v2-entry.tsx:1642-1648`；类在 `retired HTTP transport module:158-190`）—— 唯一作用是 HTTP authority + cookie 的 unary RPC / mux / `$events` 载体，无本地替代需求，删除即可。
6. `new HTTP session facade({connection, cookieHeader, cwd, workspaceDir, dshHome, profile})`（`v2-entry.tsx:1651-1657`），`session.start()`（`:1660`）→ `retired HTTP session facade module:570-592`：`connection.connect()`、订阅事件/状态、`#applyColdBootLabel()`（`:2361-2370`，走 `remote-model.ts:172-173` 的 `session/modelCatalog`）、`#refreshWorkspaceOverlay()`（`:1545-1558`，**本地文件读**）、`#probeExecutionMode()`、`refreshPlugins()`。
7. 冷启动 label 轮询（`:1661-1668`，4s 上限）。
8. 之后才 `createBridgeSessionSeam`（`:1680-1710`）；`seam-bootstrap.ts:233-255` 做 `bridge.hello` + 指纹校验，失败 fail-fast，无 fallback。

**结论**：HTTP 宿主在 boot 中的职责 = 进程/注册/端口/cookie/heartbeat 生命周期 + 一个 `$events`/RPC 载体 + 冷启动 label；会话面从 step 8 起完全属于 bridge。删除时 step 1-7 整段可以砍掉（P0-1/P0-4、P1-1）。

### 2. HTTP 宿主仍承担的功能点逐项判断

| 功能点 | 当前通路 | 证据 | 本地/bridge 替代 | 迁移难度 |
|---|---|---|---|---|
| boot skin migration 写 | **名义上走 `HTTP session facade`，实际是本地文件写**；patch 在 `v2-entry.tsx:1813-1816`，调用 `:1817` | `retired HTTP session facade module:1478-1520`：按 `workspaceTheme`/`workspaceThemeMode`/`model` 分流 overlay 与 profile，profile 用 `writeFileSync(tmp)+renameSync` 原子写；`configPath()` 在 `:1420-1423`。没有任何 `this.#rpc` | `seam.configSave` → `LocalConfigStore`（`bridge-session-seam.ts:3812-3814`；`local-config-faces.ts:327-377`） | **中**（P0-2）：白名单缺 3 个键、无 overlay 写回 |
| theme / themeMode 读取 | `shared.themeNameFromConfig(session)` / `themeModeFromConfig(session)`（`v2-entry.tsx:1826-1827`）→ `session.configLoad()` | `boot-shared.ts:175-192`；`retired HTTP session facade module:1433-1447`（本地 profile JSON + overlay cache + env 合并） | `seam.configLoad`/`configRaw`/`workspaceConfig`（`bridge-session-seam.ts:3800-3810`） | **低-中**（P0-3）：`LocalConfigStore.configLoad` 已有 merge，但 overlay 同步解析只认 `theme`（`local-config-faces.ts:380-395`）|
| motion 读取 | `shared.motionFromConfig(session)`（`v2-entry.tsx:1834`） | `boot-shared.ts:203-211`（读 `configLoad().motion`） | 同上；`motion` 在 `CONFIG_KEYS` 内（`local-config-faces.ts:69-85`），可直接切 | **低** |
| label / authority / cookie | 全部仅 HTTP 载体：`host.authority`/`host.cookieHeader` 给 `HTTP client carrier`（`v2-entry.tsx:1643-1644,1653`）；`session.label` 只用于启动轮询（`:1665`）；UI 的模型标签不读它，读 `seam.currentModelSelection()`（`:461,939`） | `retired HTTP session facade module:2361-2370`；`bridge-session-seam.ts:3946-3963` | label 无需迁移（删轮询）；authority/cookie 无用途，随之删除 | **低**（P1-1）|
| workspace 切换 | 无 `/workspace` 命令；workspace = `process.cwd()`（`v2-entry.tsx:1608`）并作为 `cwd`/`workspaceDir` 注入；seam 侧只读 `cwd()` | `commands.ts` 中 `workspace` 仅出现在 `/resume` 的 DIR 列和显示文案（`:1087,1979`）；`bridge-session-seam.ts:3860-3884`（`cwd()` 复用 `session.list` 帧） | 已下沉本地/bridge | **无** |
| session list | `/resume`、`runAutoResume` 走 `seam.listSessions()` | `commands.ts:1101-1104`；`v2-entry.tsx:1743-1750`（`{ config, launch, workspace }` + `listSessions`/`resumeSession` 注入）；`bridge-session-seam.ts:3860-3877` 走 bridge `session.list` | 已走 bridge；inproc profile 有 standalone sessionController shim（`provision-inproc-profile.mjs:60-64,656-720`） | **无** |
| model catalog | `/model`、`currentModelSelection` 走 bridge `modelCatalog`/`model.currentSelection`/`selectModel` | `bridge-session-seam.ts:4281-4320`；`commands.ts:713-...`；v2 的 UI 标签 `:461,939` | 已走 bridge（HTTP 侧只有冷启动 label 用 `session/modelCatalog`） | **无**（除 P1-1 的 label 轮询） |
| credentials / login | `/login`、`/logout` 走 `seam.login` = `LocalLoginFace`（patch 路由 + 本地 key store） | `commands.ts:958-...`（`ctx.seam.login`）；`bridge-session-seam.ts:1580-1595`；`local-config-faces.ts:603` 起（`LocalLoginFace`） | 已下沉本地 | **无**。`account.*` 另走 bridge 帧（`bridge-session-seam.ts:1597-1610`），也不走 HTTP |
| permission | `/permission` 走 `seam.permission`（`permissionPresets.catalog` + `commands.execute` 经 bridge 泛化臂） | `commands.ts:1876-...`；`bridge-session-seam.ts:1493-1495,1680-1713`；顶层 `permissionCatalog()` 是本地探针（`:3838-3856`，注释 `:3822-3830` 说明 bridge 无 catalog 路由） | 已走 bridge/本地 | **无**（已有 honest degrade） |
| subagent 视图 | `subagentViews` / `onSubagentViews` / `steerChild` / `interruptChild` / `stopChildren` 全在 bridge seam，数据来自 `journal.replay` + 子 agent 帧 | `bridge-session-seam.ts:3112-3130,3169-3223,3630`；子 agent 目录/字段本地化见 `local-config-faces.ts:402,479-505` | 已走 bridge/本地 | **无** |
| settings / agents / preset / plugins / skills / goals / btw / search / history fork | 全部 `BridgeSessionSeam` 面 | settings `:1437-1492`（face 在 `:1461`）；agents `:1551-1566`；preset `:1567-1579`；plugins `:1624-...`；goals `:1528-1550`；btw `:4184-4215`；search `:4230-4240`；fork `:3934-3944`；skills 面板由 boot 本地扫描 `discoverSkills`（`v2-entry.tsx:1770-1790`） | 已走 bridge/本地 | **无** |

补充：`HTTP session facade` 的 `configLoad/configRaw/configSave/refreshWorkspaceConfig` 都是本地 I/O（`retired HTTP session facade module:1433-1536`），所以「HTTP 宿主承担 config 面」在**当前代码**已经不成立；只有 `start()`、`label`、`dispose()`、`turn()` 等真正需要 HTTP 载体。ADR-0009 的旧描述（`docs/adr/0009-inprocess-session-bridge.md:70`）是 0.22.0 的历史快照。

### 3. `/` 命令与 UI 面依赖判定

命令表集中在 `packages/tui-base/src/routes/session/commands.ts:683` 起的 `coreCommands()`。抽查结果：

- `/new` → `ctx.seam.newSession()`（`commands.ts:694-706`）→ bridge seam `newSession()`（`bridge-session-seam.ts:2366`）：**已有 bridge 路径**，不依赖 HTTP。
- `/model`（含 `discover`）→ `ctx.seam.modelCatalog` / `providerDirectory.discover` / `selectModel`（`commands.ts:713-...`）：**已有 bridge 路径**。
- `/login`、`/logout` → `ctx.seam.login`（`commands.ts:958-...`）：**已下沉本地**（`LocalLoginFace`）。
- `/permission` → `ctx.seam.permission`（`commands.ts:1876-...`）：**已有 bridge 路径**（catalog 缺失时 degrade 提示，非 HTTP 回归）。
- `/resume` → `ctx.seam.listSessions` + `resumeSession`（`commands.ts:1092-1140`）：**已有 bridge 路径**。
- `/workspace`：**不存在该命令**；workspace 来自 cwd（`v2-entry.tsx:1608`）和 `/resume` 的 DIR 列（`commands.ts:1087`）。**无 HTTP 依赖**。
- `/agents`、`/skills`、`/settings`、`/plugins`、`/preset`、`/theme`、`/btw`、`/search`、`/history` → 全部 `ctx.seam.*` 或本地面板（对应证据见 §2 表）。
- **直接依赖 `HTTP session facade`/`HTTP client carrier` 的只有 boot 代码**：生产侧 `v2-entry.tsx:1642-1668,1817,1826-1834,1861`，以及测试 seam `client-entry.tsx:240-408`。UI 层没有任何文件 import 这两个类（`grep` 结果：仅 `packages/shell/src/client-entry.tsx`、`retired HTTP session facade module`、`shell-session.ts`、`retired HTTP transport module` 等 shell 内部互引）。

结论：删除 HTTP 宿主不会让任何 slash 命令「直接缺」；风险集中在 boot（P0-1~4）和已存在的 bridge 能力降级（P1-5）。

### 4. 退出 / 生命周期

- `shutdown`（`v2-entry.tsx:1858-1893`）：`session.dispose()`（`:1861`）→ `seam.dispose()`（`:1865`）→ `bridgeTransport.close()`（`:1869`）→ heartbeat stop/remove + `lastOneGracefulShutdown`（`:1871-1882`）→ `host.release()`（`:1889`）→ 条件性 `spawnIdleReaper`（`:1890`）。`installExitPaths(shutdown)`（`:1895`）把 quit/Ctrl+C/信号都导到这里；grace 2.5s（`boot-shared.ts:13`）。
- `HTTP session facade.dispose()` 停 stream/follow、解绑监听器并 `connection.close()`（`retired HTTP session facade module:608-630`）—— 全是 HTTP 载体资源，删除后无需替代。
- `host handle.release()` 对 v2Managed 宿主**只减 refCount、不设 kill timer**（`retired HTTP lifecycle module:1215-1237` 的 `releaseHost` 早返回）；真正的关闭靠 heartbeat + last-one grace（`client-lifecycle.ts:8-24,389-440`）与 detached watchdog（`:556-680`）。`host.dispose()` 则 SIGTERM/SIGKILL 并清 registry（`retired HTTP lifecycle module:1270-...`）。
- legacy idle reaper（`boot-shared.ts:105-165`，脚本 `scripts/idle-reaper.mjs`）只在 `host.v2Managed !== true` 时 arm（`v2-entry.tsx:1890`），生产路径上本来就不会触发；HTTP 宿主删除后这套机制整体无对象。
- launcher 的 `--force` 预启动/清理（`dsh-opentui.mjs:483-535`）依赖 v2 registry + heartbeat（`client-lifecycle.ts:492-508` 的 `assertForceAllowed`），HTTP 宿主删除后 `-force` 语义需要重新定义（**推测**：改成清理 inproc profile 的锁/provision 状态；依据是 `dsh-opentui.mjs:223,310` 另有 provisioning 侧的 `--repair`，但那是 profile 修复，不是宿主回收）。

---

## 未知项 / 需实测或拍板

1. **inproc 宿主的跨客户端生命周期**：`StdioBridgeTransport` 只管自己 spawn 的子进程（`bridge-transport.ts:176-192,419-427`），没有 heartbeat/registry/「最后一个客户端退出」模型。两个 dsh-opentui 同时启动是否会各起一个 inproc 宿主、是否共享 session writer lock，本仓库源码无法证明（**推测**：会各起一个，因为 transport 无共享锁；依据是其构造参数只有 dshHome/profile/env，无锁文件读写）。需实机双开验证。
2. **`LocalConfigStore` overlay 同步解析的实际影响面**：`loadWorkspaceConfigState`（`local-config-faces.ts:380-395`）的 JSON 分支能读全字段，YAML fallback 只读 `theme`。用户实际写出的 `.dsh/config.yml` 是 YAML（`workspace-config.ts:671` 的 writer），所以走 fallback 是常态；但注册表里 workspace `themeMode` 的真实使用量未知，需在真实 profile 上确认后再定 P0-3 的优先级。
3. **bridge 是否真的提供 `permissionPresets.catalog` / `commands.execute` / `modelCatalog` / `llm.*` 等泛化臂**：seam 侧有映射（`bridge-session-seam.ts:1680-1713,1500-1515,4281-4320`），但 `permissionCatalog()` 的注释（`:3822-3830`）明确说 bridge dispatch **没有** `permissionPresets/catalog` 路由；两处是否指向不同能力 id 需对照 `packages/bridge/src/index.ts` 的 dispatch 表实机确认。若 `permission` 面实际不可用，那是 bridge 缺口，不是 HTTP 宿主删除造成的。
4. **删除 `retired HTTP lifecycle module` 的涟漪**：`bridge-session-seam.ts:89` 从它引 `DEFAULT_PROFILE`，`boot-shared.ts` 引 `hostLockPath`，`host-*/remote-*` 多处引工具函数；本调研只做静态 import 扫描，未做编译级依赖闭包确认。
5. **launcher 的 `--remote` / `DSH_OPENTUI_INPROC=0` 遗留**：CHANGELOG 称 0.23.0 删除，但 `bin/dsh-opentui.mjs` 的参数解析仍可能有分支；本报告未穷举，删除 HTTP 宿主时需一并 grep。
