# 02 能力层（CapIR 真源 → capcontract → bridge hostInvoke）

> 出处约定见 [README.md](README.md)。分层结构在此；新增能力域的**步骤**见 `docs/workflows/w1-capability-slice.md`。

## 2.1 CapIR：静态接口形状的唯一真源

`capir/capir.json` 是本仓能力接口形状的**唯一真源**：43 个宿主生成工件、257 个 wire→client 可调用方法（全 W），保留 `unary`/`stream` 标注（`capir/README.md:5-6`；`ledger/ledger.md:13` 实读 257 methods/43 artifacts、unary 226/stream 31）。

三条口径不可混：

- **43 工件 / 257 方法**：extractor 对 rc.5 源码的静态全集，双源计数零差异（`024-day1-extractor-first-run.md:95`）。
- **27 端点**：仅 session-controller 单包口径（源码 `@Remote` 27 处双证），**不是全局端点总数**；全局 map 键和为 257，agent-scope 变体（全局 34）不计入（`capir/README.md:36-41`）。
- **75 期望面 / 28 已接线 / 10 协议面**：分别是环境状态与桥面，不属 CapIR 静态全集（见 [03](03-handshake-lifecycle.md)、[04](04-ledger-provenance.md)）。
  - round log（已接线口径，终态并集 **58**）：0.24 final knife 24 → 025 波1（session/search、session/fork、subagents/prompt、subagents/interruptByUser + account/settings 补齐）28。W2-0 底座不含 id 放行，仍 28；W2-1 放行 3 个通用 id 后，**手写集 28 不变**，并集口径 28+3=31；W2-2 再放行 7 个 pluginManager 读 id（listBundles/listPlugins/listVersionExemptions/registries/inspect/listVersions/readBundleDetail），并集口径 28+10=38；W2-3 再放行 8 个 pluginManager 写 id（installBundle/updateBundle/removeBundle/setBundleEnabled/setPluginEnabled/setVersionExemption/cancelInstall/waitForInstall），并集口径 28+18=46；W2-4 再放行 5 个只读目录 id（llm x3 / web / permissionPresets）28+23=51；W2-5 再放行 7 个 goals id 达 **28+30=58（终态；`ledger.dimensions.wired_capir_generated.count=28` 为手写集口径，通用放行集 `CAP_GENERIC_ADAPTERS.size=30`，二者并集 58）**（旧 28+3=31 / 28+10=38 / 28+18=46 / 28+23=51 criterion 逐字留注释于源码与单测，见 §2.3/§2.5）。

不变量：CapIR **只存静态全集，不携带「已注册 / 已接线」标记**；运行时注册面（profile × 宿主二进制 × 安装面）归 ledger（`capir/README.md:8-10`，`024-day1-review-oldfox.md:31`）。它只描述接口形状（工件/方法 id/端点口径），不含宿主实现代码（同 README `:11`）。

id 体系 `<package>#<namespace>/<method>`，与运行时 `typert.local.list()` 的 `descriptor.id` 同形（`capir/README.md:27-34`）。`attribution` 是顶层第一个键并保持在第 1 物理行，CI 按字段与按行双重断言（`capir/README.md:16-17`；`check-capcontract.mjs:33-34` 的 `ATTRIBUTION` 常量）。

**CapIR v3（025 W2-0 起，schema `dsh-opentui.capir/3`）**：method 条目在原有五键 `id/namespace/name/kind/class` 上**追加** `service`、`params[]`、`result`、`implementation?`、`stream?`、`cancel?`、`scope?`（既有键值逐字节不变，additive-only）。参数签名双源交叉：`.d.ts` `TYPERT_REMOTE` 字面量（字段名/顺序/可选性权威）× `typert.host.js` manifest `parameters[]`（jsonSchema）。`params[]` 归一档 `{name,required,type,enum?}`；完整 jsonSchema 留 capir 数据层。换代经 W8 解冻-再冻结五步（`docs/025-wave2-w8-unfreeze-refreeze.md`）。

**禁手改 / 换代纪律**：声明由 `scripts/gen-capir.mjs` 自动加盖，禁止手工粘贴（`capir/README.md:12`）；`node scripts/gen-capir.mjs --check` 内存重生成并与仓内文件字节级比对，漂移即非零退出（同 README `:61-67`）。宿主 rc 升级时重跑 extractor + 改 provenance 输入 → `capir.json` 由生成器整文件重写，provenance 不静默撒谎（`capir/README.md:43-49`）；换代流程见 `w7-host-upgrade.md`。

## 2.2 capcontract：生成三件套（去调用面设计）

`capcontract/` 是 `capir/` 的根级兄弟目录，生成物独立成目录以免被误认为 IR 数据（`capcontract/README.md:9-12`）。由 `scripts/gen-capcontract.mjs` 从 `capir.json` 生成，`check-capcontract.mjs` 字节级比对、漂移即红（`capcontract/README.md:5-7`）。

| 文件 | 内容 | 出处 |
|---|---|---|
| `types.ts` | CapIR id 联合类型、每方法 shape 行、totals；**CapIR v3 新表**：`CAP_SERVICE_TABLE`（257 行 id→{service,implementation,cancel?}）、`CAP_PARAMS_TABLE`（257 行有序参数归一档）、`CAP_GENERIC_WIRE_METHODS`/`CAP_GENERIC_WIRE_BY_ID`（237 行双向通用 wire 名）、`CAP_GENERIC_ADAPTERS`（显式放行集）、`CAP_WRITE_CONFIRM_IDS`（W2-3 写 id confirm 闸集）、`CAP_PROJECTED_BY_HAND`（敏感键手写投影例外集） | `capcontract/README.md:16`；生成器 `gen-capcontract.mjs` |
| `dispatch.ts` | `CAP_DISPATCH_TABLE`（257 行 id→kind）、`toTypertDescriptorId` 恒等映射、`createCapDispatcher(hostInvoke)` | `capcontract/dispatch.ts:14-16,18-19,284-307` |
| `binder.ts` | `CapWireFrame` → dispatcher 投影、`createProjectionBinder(hostInvoke)` 成员检查 | `capcontract/binder.ts:11-18,28-36` |

deny-list（AMEND-1）：`account`/`credentials`/`settings` 三族从通用 adapter/wire 表排除，只走手写 arm + 专属投影。AMEND-2：`result.jsonSchema` 递归键名命中敏感模式的 id 强制入 `CAP_PROJECTED_BY_HAND`，禁走通用默认投影（运行时报 `HAND_PROJECTION_REQUIRED` → UNSUPPORTED）。

**去调用面设计**（oldfox R1/R2/R3/R5）：生成层只拥有 id/kind 数据 + 成员检查，**声明零 inject、触碰零 ctx 服务**（`handshake.ts:15-18`，`gen-capcontract.mjs:10-11`）；`CapHostInvoke` 由 bridge 注入（`dispatch.ts:290-307`），生成层不对任何宿主 API 形态做假设（无 `typert.local.invoke/stream`、无 `descriptor.invoke`，R5 TODO 见 `:290-293`）。`binder.ts:25` 明确「No cordis inject / ctx access here — the bridge assembles hostInvoke」。完整调用链：

```
wire frame → createProjectionBinder → createCapDispatcher → lookupCapKind → 注入的 hostInvoke
出处：capcontract/binder.ts:28-35, dispatch.ts:284-307, bridge/index.ts:1181-1185
```

`inject` 由 bridge 单独拥有（现为 `['agents','typert']`，见 `bridge/index.ts` 的 `inject` 常量与 R5 红线单测）——注意 `capcontract/README.md:27-28` 仍表述为「生成层声明 inject」，与当前源不一致；**以源码为准**。**R5 红线**：新服务键一律走包裹式 `ctx.get`（含 try/catch），禁止加入 cordis `inject` 数组（declared-but-absent required inject 会停用整个插件）。TODO(CapIR) 残留缺口（codec、事件帧 sessionId）显式标注、不伪造；params/result schema 已由 CapIR v3 补齐（`binder.ts:15-17`）。

## 2.3 hostInvoke 注册表模式（手写 arm ∪ 通用 arm）

bridge 侧 `createCapHostInvoke(ctx)`（`packages/bridge/src/index.ts:980`）是生成 dispatcher 的宿主适配器。第一道闸现为**并集判定**：登记在手写集 `CAP_HOST_WIRED_IDS`（28 条）**或**通用放行集 `CAP_GENERIC_ADAPTERS` 的 id 才进真宿主服务；其余显式失败：

```
NOT_WIRED: <id> has no inproc host adapter (ledger in_wired=58/257)
出处：bridge/index.ts createCapHostInvoke 第一道闸；计数 = CAP_HOST_WIRED_IDS.length + generic.adapters.size
```

round log（NOT_WIRED 计数文案）：025 波1（28/28，手写集口径）→ W2-0 底座（28+0，通用集空）→ W2-1（28+3=31，放行 session/create|prompt|wait）→ W2-2（28+10=38，再放行 7 个 pluginManager 读 id）→ W2-3（28+18=46，再放行 8 个 pluginManager 写 id）→ W2-4（28+23=51，再放行 5 个目录 id：llm x3 / web / permissionPresets）→ W2-5（28+30=58，再放行 7 个 goals id：create/get/edit/complete/pause/resume/clear）。旧 `in_wired=28/257`、`in_wired=31/257`、`in_wired=38/257`、`in_wired=46/257` 与 `in_wired=51/257` criterion 逐字留注释于源码与单测（round log 纪律）。

**通用 arm（W2-0 底座建、W2-1 首个真实消费者）**：`packages/bridge/src/cap-generic.ts` 的 `invokeGenericCap` 表驱动分发——查 `CAP_GENERIC_ADAPTERS` 白名单 → deny-list（先于白名单）→ BAD_KIND 闸（stream 禁入 unary）→（W2-3 起）confirm 闸（`CAP_WRITE_CONFIRM_IDS` 写 id 须 `__confirm===true`，R6 桥侧第一道闸）→ 包裹式 `ctx.get(service)` → 按 `CAP_PARAMS_TABLE` 粗校验（BAD_PARAMS）→ 依表序位置调用（R3 保槽不左移）→ `cancel:'signal'` 追加 owned AbortSignal。零手抄 `methodId ===`（C5）。放行是逐 id 显式白名单制（非 expected-75 全放），每批切片把自己收割的 id 加入放行集 + ledger provenance 走 gen-ledger 正门。W2-1 放行 session/create|prompt|wait 三 id 兑现 `/btw`，seam 侧封装 create→prompt→wait side-session 生命周期（域分离于绑定主会话）。W2-2 放行 7 个 pluginManager 读 id 兑现 `/plugins` 真数据面（listBundles/listPlugins 填 state 列、readBundleDetail 供 detail 视图、registries/listVersions/listVersionExemptions/inspect 供安装前置信息）；seam 侧手写 `pluginsManager` face + 二次白名单投影。W2-3 放行 8 个 pluginManager 写 id（install/update/remove/setEnabled×2/setVersionExemption/cancelInstall/waitForInstall）；全部过 confirm 闸 + TUI 确认模态（seam 侧第二道闸），进度走 waitForInstall 轮询（不扩 ADR-0010 帧面）。W2-4 放行 5 个只读目录 id（llm/listProviders、llm/listConfigurableProviders、llm/discoverModels、web/listProviders、permissionPresets/catalog）；消费点（/login provider picker、/settings permission 行）从静态/空壳转真数据，seam 手写白名单投影。llm/discoverModels 在 `CAP_PROJECTED_BY_HAND`（result.jsonSchema 命中 `maxTokens`→`/token/`），其 wire 默认投影被禁（`HAND_PROJECTION_REQUIRED`，AMEND-2 终稿条款）——首次真正触发 wire 层 SENTINEL 负例义务。评审移交把 PROJECTED id 误记为 llm/listProviders / web/listProviders，系一手扫描勘误（见 `.proof/025-w2-4/00-preregistered-expected.md §1 E5`）。W2-5 放行 7 个 goals id（create/get/edit/complete/pause/resume/clear，全 unary/service=goals，scope `{context:agent,wire:agentId}`：wire 侧收 agentId 字符串，arm 在 host 调用边界按 `CAP_SCOPE_TABLE` 原位解析为活体对象——data-driven scope 代入已实现（d94161a），表驱动，非「通用 arm 不做 scope 代入」；AMEND-5 勘误）；消费点新建 `/goals` 命令 + 手写 `goals` face（GoalView/GoalRef 逐字段二次白名单投影）。7 id 无一在 `CAP_PROJECTED_BY_HAND`，但 result schema 为 null（get）或 `additionalProperties:true`（其余 6）使 AMEND-2 静态扫描对未声明键失明——盲区家族逐 id 默认投影假设登记于 `.proof/025-w2-5/00-preregistered-expected.md §1 E5.b`，load-bearing 防线为 seam 手写二次白名单投影（封闭枚举 + 自由文本封顶 + 敌意键零过）。
- **波3 收尾终态（54836a4）**：discoverModels 的手写 face 已接 `/model discover` 入口，其 wire 方法名由生成表 `CAP_GENERIC_WIRE_METHODS` + `CAP_PROJECTED_BY_HAND` 解析（不手抄字符串）——否则 check #8a 会把手抄名判为 ledger `wired_protocol` 之外的 extra 而红；w3-2 修复后 PASS（`.proof/025-w3-2/05-closure/summary.md` 逐项结果 4b）。`CAP_PROJECTED_BY_HAND.size=10`、`CAP_WRITE_CONFIRM_IDS.size=8`、`CAP_GENERIC_ADAPTERS.size=30`（本刀 `bun` 一手读生成表）。

**四张手写 `CAP_*_WIRE_METHODS` 表 + 一张生成通用表**（wire 名 → CapIR id 的表查找，**不是**手抄 `req.method ===` 分支）：

| 表 | 行 | 覆盖 |
|---|---|---|
| `CAP_MODEL_WIRE_METHODS` | `index.ts:1201-1206` | model.currentSelection / modelCatalog / selectModel / initializeDefaultModel |
| `CAP_SESSION_WIRE_METHODS` | `:1220-1222` | session.list（0.24 final knife 迁生成链，wire 名不变、client/seam 零改） |
| `CAP_SETTINGS_WIRE_METHODS` | `:1230-1233` | settings.describe / settings.mutate |
| `CAP_ACCOUNT_WIRE_METHODS` | `index.ts` | 10 个 unary account 方法；2 个 stream 方法不在此表 |
| `CAP_GENERIC_WIRE_METHODS`（生成） | `capcontract/types.ts` | 237 行非 deny 族通用 wire 名（`<ns>.<name>`），双向表；W2-1 经此把 `session.create/prompt/wait` 路由到通用 arm |

表的作用是让客户端 wire 名保持稳定的同时，1:1 宿主调用走生成链。手写 wire 名一律不迁（client/seam 兼容），通用表分支位于 6 张手写表之后（LAST on purpose，零遮蔽）。`model.currentSelection` 的回复形状投影（`CAP_SELECTION_READ_METHOD`）是生成 dispatch 内的 reply-shape 投影，不进 @manual 布线清单。通用分支回复默认 `sanitizeFrameForWire` + record 包装，`CAP_PROJECTED_BY_HAND` id 拒绝通用投影（无值帧）。

**stream relay**：`account/watch`、`account/watchExpiry` 不能经 stdio unary 回复承载 AsyncIterable，由 `createAccountWatchRelay`（`:773-811`，生产接线 `:2313-2324`）以「signal 释放 / BAD_KIND / cap.end / 复合键」四件套管理，只 emit 白名单 `cap.event` 帧（`methodId/sessionId/seq/eventType`，`:834-835`）。`session/observeEvent/observeState/observeProjections` 三组 push 流由 `createPushRelay`（`:696-...`，生产接线 `:2302-2311`）承载。`streamSignalFrom`（`:887-895`）把非 `AbortSignal` 的 signal 判为 `BAD_PARAMS`，绝不放行到宿主流。

## 2.4 接线口径：@manual=0 与协议面 10 条

0.24 tag 前提裁决把原「wired=11/12」拆成两维（`024-tag-premise-adjudication-oldfox.md:10-40`）：

- **`wired_protocol` = 10 条**：ADR-0010 桥协议帧（多步/有状态/依赖 I 类服务、CapIR 无同名 id），不是双轨的任何一轨，**不计入 @manual**。10 条为 `bridge.ping`/`bridge.hello`/`session.open`/`session.send`/`session.close`/`turn.abort`/`ask.response`/`journal.replay`/`subagents.interrupt`/`subagents.stopChildren`（`ledger/ledger.md:54-67`；逐条定性见裁决 `:18-28`）。
- **`wired_manual` = 0**：有 CapIR 对应的 1:1 宿主手抄调用。S1 先删 `model.currentSelection`（`024-tag-premise-adjudication-oldfox.md:17`），0.24 final knife 再删最后一条 `session.list`（`gen-ledger.mjs:64-65`；`CAP_SESSION_WIRE_METHODS` 注释 `index.ts:1212-1218`）。CI 断言 `wired_manual == 0`（`check-capcontract.mjs:17-18,268-275`）。
- **`wired_capir_generated` = 28**（`ledger.dimensions.wired_capir_generated.count=28`，手写 arm 口径；通用放行集 `CAP_GENERIC_ADAPTERS.size=30` 不改 capir.json / ledger，故 ledger 维度仍 28）；并集口径 `in_wired_total=58/257`（28 手写 + 30 通用）。W2-1 通用放行 3 id（并集 31），W2-2 再放行 7 个 pluginManager 读 id（38），W2-3 再放行 8 个写 id（46），W2-4 再放行 5 个目录 id（51），W2-5 再放行 7 个 goals id（**58，终态**），但手写集与 ledger `in_wired` 仍 28。round log：24 → 28（波1）→ 28（W2-0/底座）→ 31（W2-1）→ 38（W2-2）→ 46（W2-3）→ 51（W2-4）→ **58（W2-5，终态）**。

「工件在≠服务在」是另一约束：W 类同样需要启动在场探针，握手缺失项显式降级而非崩溃（v3 `:56`，`024-day1-review-oldfox.md:33-34`）。

## 2.5 NOT_WIRED 是显式降级，不是静默成功

除 28 条手写 arm（+ W2-1 起 3 条通用放行 + W2-2 起 7 个 pluginManager 读放行 + W2-3 起 8 个 pluginManager 写放行 + W2-4 起 5 个目录 id + W2-5 起 7 个 goals id，并集终态 58）外，其余 W id 经 hostInvoke 一律显式 `NOT_WIRED`（`index.ts` 第一道闸；冻结风险 2 见 `024-base-frozen.md:25`）。设计动机：缺宿主服务/未接线必须与「空结果」可区分——`session.list` 服务缺失时返回 `UNSUPPORTED` 而非 `{items:[]}`（`ADR-0010:112`）；stream 无宿主返回 `NOT_WIRED` 而非空流。通用 arm 的 NOT_WIRED 语义：id 不在放行集 / deny 族 / 服务缺 / 方法缺 / stream 入 unary（BAD_KIND）均显式失败，绝不静默成功或假空。`/btw` 服务的 `/btw` 在通用放行前走精确降级文案（`SIDE_SESSION_NOT_WIRED` → 现 W2-1 真化后为 `UNSUPPORTED`/`SIDE_SESSION_NO_ANSWER`），从无 mock LLM 假答案。

`NOT_WIRED` 白名单制（第一道闸 = 手写集 ∪ 通用放行集）：通用放行集逐 id 显式（非 expected-75 全放），这是「显式降级不是静默成功」的既有语义在通用 arm 上的延续。deny-list 三族（account/credentials/settings）先于白名单判定，敌意/stale 生成器把 deny id 写进放行集也被拒。round log：0.24 时代「全集通用调用待 CapIR params schema」已由 W2-0 CapIR v3 参数表 + W2-1 首批放行兑现（路线 b 落地）。

## 维护责任

CapIR 计数/口径、生成物结构（CapIR v3 字段/生成表）、`CAP_HOST_WIRED_IDS` / `CAP_GENERIC_ADAPTERS` / `CAP_WRITE_CONFIRM_IDS` / `CAP_*_WIRE_METHODS` 增删、@manual/协议面维度定义、NOT_WIRED 语义变化时必须更新本文档；新增流式中继需同步 2.3 节。放行新 id 时四处同步：生成器 `adapterBlock`、`check-capcontract #16` 放行断言、NOT_WIRED 文案计数（并集 28+N）、本文档 round log；写 id 另需同步 `CAP_WRITE_CONFIRM_IDS` + `check-capcontract #17`。
