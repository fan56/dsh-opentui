# 02 能力层（CapIR 真源 → capcontract → bridge hostInvoke）

> 出处约定见 [README.md](README.md)。分层结构在此；新增能力域的**步骤**见 `docs/workflows/w1-capability-slice.md`。

## 2.1 CapIR：静态接口形状的唯一真源

`capir/capir.json` 是本仓能力接口形状的**唯一真源**：43 个宿主生成工件、257 个 wire→client 可调用方法（全 W），保留 `unary`/`stream` 标注（`capir/README.md:5-6`；`ledger/ledger.md:13` 实读 257 methods/43 artifacts、unary 226/stream 31）。

三条口径不可混：

- **43 工件 / 257 方法**：extractor 对 rc.5 源码的静态全集，双源计数零差异（`024-day1-extractor-first-run.md:95`）。
- **27 端点**：仅 session-controller 单包口径（源码 `@Remote` 27 处双证），**不是全局端点总数**；全局 map 键和为 257，agent-scope 变体（全局 34）不计入（`capir/README.md:36-41`）。
- **75 期望面 / 24 已接线 / 10 协议面**：分别是环境状态与桥面，不属 CapIR 静态全集（见 [03](03-handshake-lifecycle.md)、[04](04-ledger-provenance.md)）。

不变量：CapIR **只存静态全集，不携带「已注册 / 已接线」标记**；运行时注册面（profile × 宿主二进制 × 安装面）归 ledger（`capir/README.md:8-10`，`024-day1-review-oldfox.md:31`）。它只描述接口形状（工件/方法 id/端点口径），不含宿主实现代码（同 README `:11`）。

id 体系 `<package>#<namespace>/<method>`，与运行时 `typert.local.list()` 的 `descriptor.id` 同形（`capir/README.md:27-34`）。`attribution` 是顶层第一个键并保持在第 1 物理行，CI 按字段与按行双重断言（`capir/README.md:16-17`；`check-capcontract.mjs:33-34` 的 `ATTRIBUTION` 常量）。

**禁手改 / 换代纪律**：声明由 `scripts/gen-capir.mjs` 自动加盖，禁止手工粘贴（`capir/README.md:12`）；`node scripts/gen-capir.mjs --check` 内存重生成并与仓内文件字节级比对，漂移即非零退出（同 README `:61-67`）。宿主 rc 升级时重跑 extractor + 改 provenance 输入 → `capir.json` 由生成器整文件重写，provenance 不静默撒谎（`capir/README.md:43-49`）；换代流程见 `w7-host-upgrade.md`。

## 2.2 capcontract：生成三件套（去调用面设计）

`capcontract/` 是 `capir/` 的根级兄弟目录，生成物独立成目录以免被误认为 IR 数据（`capcontract/README.md:9-12`）。由 `scripts/gen-capcontract.mjs` 从 `capir.json` 生成，`check-capcontract.mjs` 字节级比对、漂移即红（`capcontract/README.md:5-7`）。

| 文件 | 内容 | 出处 |
|---|---|---|
| `types.ts` | CapIR id 联合类型、每方法 shape 行、totals | `capcontract/README.md:16`；生成器 `gen-capcontract.mjs:85-98` |
| `dispatch.ts` | `CAP_DISPATCH_TABLE`（257 行 id→kind）、`toTypertDescriptorId` 恒等映射、`createCapDispatcher(hostInvoke)` | `capcontract/dispatch.ts:14-16,18-19,284-307` |
| `binder.ts` | `CapWireFrame` → dispatcher 投影、`createProjectionBinder(hostInvoke)` 成员检查 | `capcontract/binder.ts:11-18,28-36` |

**去调用面设计**（oldfox R1/R2/R3/R5）：生成层只拥有 id/kind 数据 + 成员检查，**声明零 inject、触碰零 ctx 服务**（`handshake.ts:15-18`，`gen-capcontract.mjs:10-11`）；`CapHostInvoke` 由 bridge 注入（`dispatch.ts:290-307`），生成层不对任何宿主 API 形态做假设（无 `typert.local.invoke/stream`、无 `descriptor.invoke`，R5 TODO 见 `:290-293`）。`binder.ts:25` 明确「No cordis inject / ctx access here — the bridge assembles hostInvoke」。完整调用链：

```
wire frame → createProjectionBinder → createCapDispatcher → lookupCapKind → 注入的 hostInvoke
出处：capcontract/binder.ts:28-35, dispatch.ts:284-307, bridge/index.ts:1181-1185
```

`inject: ['typert']` 由 bridge 单独拥有（`bridge/index.ts:568`，`handshake.ts:30-33`）——注意 `capcontract/README.md:27-28` 仍表述为「生成层声明 inject」，与当前源不一致；**以源码为准**。TODO(CapIR) 缺口（params/result schema、codec、事件帧 sessionId）显式标注、不伪造（`capcontract/README.md:30-34`，`binder.ts:15-17`）。

## 2.3 hostInvoke 注册表模式

bridge 侧 `createCapHostInvoke(ctx)`（`packages/bridge/src/index.ts:907`）是生成 dispatcher 的宿主适配器，只有登记在 `CAP_HOST_WIRED_IDS`（`:581-612`，实读 24 条）的 id 才走到真宿主服务；其余一律显式失败：

```
NOT_WIRED: <id> has no inproc host adapter (ledger in_wired=24/257)
出处：bridge/index.ts:907-913（错误文案由 :911 给出，计数由 :911 内 CAP_HOST_WIRED_IDS.length 得出）
```

**四张 `CAP_*_WIRE_METHODS` 表**（wire 名 → CapIR id 的表查找，**不是**手抄 `req.method ===` 分支）：

| 表 | 行 | 覆盖 |
|---|---|---|
| `CAP_MODEL_WIRE_METHODS` | `index.ts:1201-1206` | model.currentSelection / modelCatalog / selectModel / initializeDefaultModel |
| `CAP_SESSION_WIRE_METHODS` | `:1220-1222` | session.list（0.24 final knife 迁生成链，wire 名不变、client/seam 零改） |
| `CAP_SETTINGS_WIRE_METHODS` | `:1230-1233` | settings.describe / settings.mutate |
| `CAP_ACCOUNT_WIRE_METHODS` | `:1248-1259` | 10 个 unary account 方法；2 个 stream 方法不在此表 |

表的作用是让客户端 wire 名保持稳定的同时，1:1 宿主调用走生成链（`:1187-1193`、`:1212-1218`、`:1224-1229`、`:1235-1247`）。`model.currentSelection` 的回复形状投影（`CAP_SELECTION_READ_METHOD`，`:1210`）是生成 dispatch 内的 reply-shape 投影，不进 @manual 布线清单。

**stream relay**：`account/watch`、`account/watchExpiry` 不能经 stdio unary 回复承载 AsyncIterable，由 `createAccountWatchRelay`（`:773-811`，生产接线 `:2313-2324`）以「signal 释放 / BAD_KIND / cap.end / 复合键」四件套管理，只 emit 白名单 `cap.event` 帧（`methodId/sessionId/seq/eventType`，`:834-835`）。`session/observeEvent/observeState/observeProjections` 三组 push 流由 `createPushRelay`（`:696-...`，生产接线 `:2302-2311`）承载。`streamSignalFrom`（`:887-895`）把非 `AbortSignal` 的 signal 判为 `BAD_PARAMS`，绝不放行到宿主流。

## 2.4 接线口径：@manual=0 与协议面 10 条

0.24 tag 前提裁决把原「wired=11/12」拆成两维（`024-tag-premise-adjudication-oldfox.md:10-40`）：

- **`wired_protocol` = 10 条**：ADR-0010 桥协议帧（多步/有状态/依赖 I 类服务、CapIR 无同名 id），不是双轨的任何一轨，**不计入 @manual**。10 条为 `bridge.ping`/`bridge.hello`/`session.open`/`session.send`/`session.close`/`turn.abort`/`ask.response`/`journal.replay`/`subagents.interrupt`/`subagents.stopChildren`（`ledger/ledger.md:54-67`；逐条定性见裁决 `:18-28`）。
- **`wired_manual` = 0**：有 CapIR 对应的 1:1 宿主手抄调用。S1 先删 `model.currentSelection`（`024-tag-premise-adjudication-oldfox.md:17`），0.24 final knife 再删最后一条 `session.list`（`gen-ledger.mjs:64-65`；`CAP_SESSION_WIRE_METHODS` 注释 `index.ts:1212-1218`）。CI 断言 `wired_manual == 0`（`check-capcontract.mjs:17-18,268-275`）。
- **`wired_capir_generated` = 24**（`ledger/ledger.md:17-18`）；`in_wired_total=24/257`。

「工件在≠服务在」是另一约束：W 类同样需要启动在场探针，握手缺失项显式降级而非崩溃（v3 `:56`，`024-day1-review-oldfox.md:33-34`）。

## 2.5 NOT_WIRED 是显式降级，不是静默成功

除 24 条外，其余 233 个 W id 经 hostInvoke 一律显式 `NOT_WIRED`（`index.ts:907-913`；冻结风险 2 见 `024-base-frozen.md:25`）。设计动机：缺宿主服务/未接线必须与「空结果」可区分——`session.list` 服务缺失时返回 `UNSUPPORTED` 而非 `{items:[]}`（`ADR-0010:112`）；stream 无宿主返回 `NOT_WIRED` 而非空流（`index.ts:1014,1100`）。全集通用调用（路线 b）待 CapIR params schema，是 0.24 后事项且须解冻（`024-tag-premise-adjudication-oldfox.md:60-65`）。

## 维护责任

CapIR 计数/口径、生成物结构、`CAP_HOST_WIRED_IDS` 或 `CAP_*_WIRE_METHODS` 增删、@manual/协议面维度定义、NOT_WIRED 语义变化时必须更新本文档；新增流式中继需同步 2.3 节。
