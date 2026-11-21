# 03 握手与生命周期（能力握手三态 + 会话状态机）

> 出处约定见 [README.md](README.md)。握手是**生命周期观察者**，不是 wire 方法（`024-base-task4-handshake.md:19`）。接线步骤见 `docs/workflows/w1-capability-slice.md`。

## 3.1 能力握手三态（PENDING / READY / DEGRADED）

引擎在 `packages/bridge/src/handshake.ts`。三态定义：`PENDING`（注册面尚未观测）/ `READY`（稳定面读数、比对通过）/ `DEGRADED`（比对发现缺失）（`handshake.ts:5-7,59`）。

**硬不变量 — 禁 apply 当刻读数**：`apply()` 当刻 `typert.local.list()` 恒返回 `[]`；模块从不在 apply 时读它，首次读数延迟到异步轮询循环（`handshake.ts:7-8`，`024-base-task4-handshake.md:23`）。I 类探针同样在稳定窗后采样，apply 时值被证明是注册期噪声（sessionController present=false@apply → true@1500ms；`handshake.ts:19-20,223-227`）。

| 机制 | 值 / 口径 | 出处 |
|---|---|---|
| 默认超时 | 10000 ms；`options.timeoutMs` 或 `DSH_OPENTUI_HANDSHAKE_TIMEOUT_MS` 覆盖 | `handshake.ts:103-104,117,217-218` |
| 轮询间隔 / 稳定窗 | 100 ms；连续 2 次（最小 2）非空集合签名一致 | `handshake.ts:118-119,220,327-333` |
| 稳定判定 | `ids.length>0 && streak>=stabilitySamples`；达成或超时即调用 `compare()` 结算 | `handshake.ts:332-346` |
| 超时推导 | 超时且空 → DEGRADED + `subclass:"registration-timeout"`；超时非空且缺 → 常规 DEGRADED；超时非空且齐 → READY（reason 标注 deadline） | `handshake.ts:171-206`，`024-base-task4-handshake.md:40` |
| 取消 | teardown/EOF 调 `cancel()` 清 timer，避免迟到日志 | `handshake.ts:356-363`，`024-base-task4-handshake.md:28` |

接线只在 `bridge/index.ts:1763` 启动握手、teardown 取消，**零 `req.method ===` 新增分支**（`024-base-task4-handshake.md:16,19`）；handle 通过 `attachHandshake` 挂 ctx 供取证（`handshake.ts:50-57`）。

## 3.2 比对基线：期望面 75 与「能力面 257」的关系

**基线是 ledger 期望面 75 条，不是 CapIR 257 全集**（`handshake.ts:10-13,215`）。数据集直接 `import ledger/ledger.json`，构建期内联进 bundle，ledger 仍是真源（`024-base-task4-handshake.md:34`）。257 全集只经 `CAP_DISPATCH_TABLE` 计出 `fullOnlyIgnored = 182`（257−75），从不作基线、不作 diff（`handshake.ts:168-169`；真机日志 `024-base-task4-handshake.md:83` 记 observed=75/expected=75/fullOnlyIgnored=182）。

比对键是 CapIR method id ↔ typert `descriptor.id` 的**恒等映射** `toTypertDescriptorId`（`capcontract/dispatch.ts:14-16`；`handshake.ts:164-165`）；两侧同为 `<pkg>#<ns>/<method>`，id 不手抄不重算（`024-base-task4-handshake.md:35`）。

**期望面 75 的推导法**（bundle 声明闭包，禁安装面解析）：

- 按目标 profile 的宿主源码 bundle 声明闭包（`@deepseek-ai/dsh-base` 的 `dependencies` + `optionalDependencies` BFS），**禁安装面 node_modules 解析**（`024-base-task3-ledger.md:26`，`024-day1-review-oldfox.md:33,39`）。
- dsh-base 声明闭包 138 包 ∩ CapIR = 12 贡献包 → 49 方法；profile patch 显式 insert 的 session-controller +27；方法级排除 `permissionPresets/set` −1；合计 **75**（`024-base-task3-ledger.md:34-40`，`ledger/ledger.md:34-52`）。
- 推导只是「推导 + 实测校准闭环」，不假设一次即准；实测 3s/9s 稳态 75 条（`024-base-task3-ledger.md:52-55`；`024-day1-review-oldfox.md:34`）。

## 3.3 缺失分档（compare 是唯一入口）

`compare()` 的三档（`handshake.ts:155-207`）：

| 情况 | 结果 | 出处 |
|---|---|---|
| 期望面内缺失（expected − observed 非空） | DEGRADED，`missingExpected` 记缺（**唯一降级 diff**） | `handshake.ts:183-195` |
| 期望面外多出（observed − expected） | 记 `extraOutsideExpected`（ledger 新增候选），**不降级** | `handshake.ts:167`，`024-base-task4-handshake.md:38` |
| 全集 − 期望面 182 | 只计 `fullOnlyIgnored`，正常不报告 | `handshake.ts:168-169` |
| observed 空 | DEGRADED（超时则 subclass=`registration-timeout`） | `handshake.ts:171-182` |

PENDING 期无任何降级判定（`024-base-task4-handshake.md:26`，L41 负例纪律）；DEGRADED 仅在稳定后或超时后产生（`handshake.ts:334-345`）。

## 3.4 I 类 6 服务探针（观测，不参与判定）

清单取 `ledger.dimensions.i_class.services[].key`（`handshake.ts:48,216`），F3 后为 6 个：agents / sessionPersistence / agentDefaultModel / appExit / sessionController / systemPrompt（`024-base-task4-handshake.md:41`；`ledger/ledger.md:19`）。探针在稳定窗后经 `ctx.get` 逐个采样（`handshake.ts:228-237,343`），结果记入快照与日志，**缺任一 I 服务不降级**（I 类均为可选降级包装；`024-base-task4-handshake.md:41`）。真机样本中 `sessionController` present=false 但 W 面 75 条比对通过，如实记录不改判定（`024-base-task4-handshake.md:88,94`）。

S2 另加两个 observation-only 键 `deepseekAccount`/`credentialsController`：只在稳定窗后观察在场，不加进 cordis `inject`（声明但缺的服务会让 cordis 4.1 整个插件 pending），仍走 `ctx.get`（`handshake.ts:35-43`）。

## 3.5 会话生命周期（ADR-0010，与能力握手正交）

能力握手决定「W 面是否齐」，会话状态机决定「session/turn 怎么活」。两者不共享状态。

**桥态**：`BOOTING → READY ⇄ DEAD`（可恢复停泊态），`close()` 到唯一终态 `CLOSED`；传输层是单一状态机，`RECOVERING` 是瞬时值（`ADR-0010:23-35`）。阶段一恢复仅用户显式触发（R 键 + 5s 冷却），无自动 respawn（`:35`）。恢复序列顺序强约束：

```
respawn → 三校验重握手(protocolVersion / fingerprint 字段 / host-compat) → session.open{mode:"resume"} → journal.replay drain → pendingSnapshot 重建
出处：ADR-0010:37-45
```

`SESSION_LOCKED` 时 transport 保持 READY、只会话层降「已连接未挂载」，给「重试/新会话」两条动作、**不提供 steal**（`:45`）。DEAD 事件驱动即时上屏，带 `deadCause`（stage/code/signal）（`:49`）。

**会话态**：`EMPTY → OPENING(id) → OPEN(id) ⇄ STREAMING(turn)`；`ABORTING → OPEN(id)`；`/new` 走 `OPEN → CLOSING → OPENING(newId)`；失败终态 `OPEN_FAILED{SESSION_NOT_FOUND|JOURNAL_CORRUPT|SESSION_LOCKED|VERSION_INCOMPATIBLE}`（`ADR-0010:53-67`）。不变量 I1–I6（sessionId 只因用户动作变、resume 必须 eager 真恢复、abort 只取消当前 turn、单 writer lock、客户端不得持 transcript 真源）见 `ADR-0010:12-19`。

## 维护责任

三态判定/超时推导、比对基线口径（75/257）、缺失分档、I 类服务清单或会话状态机/恢复序列变化时更新本文档；握手参数默认值改动须同步 3.1 表。
