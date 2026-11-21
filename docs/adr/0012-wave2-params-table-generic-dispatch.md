# ADR-0012: CapIR v3 参数表与表驱动通用调用（Wave 2 底座）

Date: 2026-11-21
Status: Draft（草案；W2-0 底座已落地，逐 id 放行随 W2-1 起各批推进）

> 本 ADR 是方案 `025-wave2-plan.md` v1.1 的架构决策记录，落地事实以仓内代码与 `.proof/025-w2-0*` 证据为准。方案本身经 oldfox 评审（`025-wave2-plan-review-oldfox.md`），AMEND-1..4 与 C1–C4、S1–S3 已并入。

## 1. 背景（Context）

0.24 底座自 `feat/024-capir@b37b78a` 冻结。CapIR v2（`dsh-opentui.capir/2`）每个 method 只有 `{id, namespace, name, kind, class}` 五键，**无参数信息**；capcontract 三件套的 `TODO(CapIR)` 显式预留 params/result/sessionId。宿主生成工件中已有这套数据的静态真源：`.d.ts` 的 `TYPERT_REMOTE` 字面量给出字段名/顺序/可选性，`typert.host.js` 的 `createTypertRemoteInfo` manifest 给出 service key、implementation 别名、每参 JSON Schema、stream/cancellation/scope。

波1 收掉 4 条缺口后，实际待收割 gap 为 52（expected 75 − exp∩wired 23）。按波1 范式逐条手写 per-id arm（每条 = 结构切片 + 逐字段校验 + 投影 + 测试），52 条不可持续，且手写 host 调用无统一校验语义。宿主运行时 registry 无泛型 invoke（`ctx.typert` 只有 register/get/resolve/list/toJSONSchema），调用仍须「service key + 参数序 + 位置调用」，所以参数表必须是静态提取而非运行时猜测。

改 CapIR 真源 = 底座解冻，须按 W8 流程五步执行（确认必须解冻 → 显式决策 → 正门变更 → 受影响 proof 全部重跑 → 重新冻结）。用户三波拍板即显式解冻决策。

## 2. 决策（Decision）

- **D1 — CapIR v3，additive-only**：schema `dsh-opentui.capir/2` → `/3`；每 method 追加 `service` / `implementation?` / `params[]` / `result` / `stream?` / `cancel?` / `scope?`，既有五键与既有值字节不变；`totals.methods_with_params = 257`。生成链唯一：extractor 双源交叉（fail-loud）→ `gen-capir.mjs` 整文件重写。
- **D2 — 静态参数表 + bridge 内部表驱动 generic arm**：生成 `CAP_SERVICE_TABLE` / `CAP_PARAMS_TABLE` / `CAP_GENERIC_WIRE_METHODS`；`createCapHostInvoke` 在既有 28 条 per-id arm 之前加一段通用 arm，按 `CAP_GENERIC_ADAPTERS` 白名单**逐 id 显式放行**。只做 unary；stream id 入 unary → `BAD_KIND`；服务/方法缺 → `NOT_WIRED`；表校验失败 → `BAD_PARAMS`（含完整 CapIR id）。第一道闸升级为「手写集 ∪ 通用放行集」并集判定，文案计数 28+N，旧计数断言逐字留注释。
- **D3 — seam face 不生成、不透传**：每个新 face 手写「face 方法 → `#transport.request(wireName, 白名单构造 params)` → 返回值二次逐字段投影」，参数表只作实现底稿。安全纪律不退化：`ctx.get` 包裹式解析（不进 cordis `inject`）、敌意帧白名单投影、authorize URL 值不跨 seam。
- **D4 — 两道结构闸**：deny-list 对 namespace ∈ {`account`, `credentials`, `settings`} 三族拒绝生成 adapter/wire 行（这三族有专属投影纪律）；result jsonSchema 递归键名命中 `/token|apikey|api_key|secret|password|credential|authorize|bearer/i` 的 id 强制进入 `PROJECTED_BY_HAND` 手写投影例外清单。二者均由 check-capcontract 断言。
- **D5 — seeded dormancy（W2-0 落地态）**：`CAP_GENERIC_ADAPTERS` 为空集，wired 计数保持 28，bridge 可观测行为零变化；生成表与门禁先落，放行随 W2-1 起逐批推进。
- **D6 — ledger additive-only 标注**：方案 §4.4 的 19 条不做项以 `deferred_reason` 新键经 `gen-ledger.mjs` 正门落到 gap 行；`dsh-opentui.ledger/1` **不升版**、既有键值零改；reason ∈ `{no-tui-consumer, stream-no-relay, dual-source-risk}`。
- **D7 — 冻结面纪律不放松**：capir/capcontract/ledger 三处只走各自 gen 正门；`build-bridge.mjs` 转义段（N1 C1）只读；既有测试断言零删除；`@manual = 0`；生成物零 `@deepseek-ai` import、声明行全覆盖。

## 3. 契约要点（Contract）

- wire 名规约：新 id 一律生成 `<namespace>.<name>` 双向表，既有 wire 名零迁移。
- 调用参数按 `.d.ts` 顺序权威做位置重建；可选参缺省留 `undefined` 空位，后续索引不左移（防静默错型，R3）。
- 错误面：hostInvoke 新文案 `NOT_WIRED: <id> <reason>` / `BAD_PARAMS: <id> <param> <reason>` / `BAD_KIND: <id> <reason>`；handleLine/seam 映射不变。
- 可观测性：通用 arm 与 per-id arm 不相交；`check-capcontract` gate #10 对账手写集 ∪ 通用集与 ledger `in_wired`。
- 影响面裁剪（AMEND-4 终稿）：W2-0 落地时 `CAP_GENERIC_ADAPTERS` 为空、wired 计数不变（28）、bridge 可观测行为零变化，故 verify70/E2E 判定域不受本刀影响；generic arm 入 bundle 后 fingerprint 变更，0.24 时代真机证据对新 fingerprint 失效，波2 真机证据自 W2-1 起按新 bundle 重取，W2-6 收尾做一次新 bundle 上的 verify70 收口（或显式 NOT RUN + 理由）。

## 4. 后果（Consequences）

正面：

- 52 缺口从「逐条手写」变为「生成表 + 逐 id 放行」，新增 id 的边际成本大幅下降；参数顺序/可选性由双源交叉 fail-loud 保证。
- 安全纪律从口头约定升级为结构闸（deny-list + 静态敏感键扫描 + seam 手写投影 + 中心清洗），通用调用无法把投影退化为动态透传。
- 19 条不做项从「未解释 gap」变为「已裁决留置」，ledger 可审计、可随宿主 rc 复评。

负面与对冲（方案 §7 R1–R9）：

- **R1 CapIR v2→v3 不可逆点**：schema 字符串被 provenance/CI 断言钉死，回滚需旧 extractor 全链重跑；对冲 = additive-only 双跑字节一致 + 双源交叉 + 宿主钉点不动保留回滚树。
- **R2 通用调用弱化安全纪律**：对冲 = 四层防线 + 例外清单 SENTINEL wire 层负例。
- **R3 位置参数序错位（静默错数据）**：对冲 = mock 实参逐 id 全覆盖 + `.d.ts` 顺序权威。
- **R4/R5 新服务键不可解析 / 误入 inject 致插件停活**：对冲 = 逐批 E1 在场探针（禁写 present=true）+ `inject` 仍仅 `['agents','typert']` 单测。
- **R6 write 面 FS 变更**：确认模态 + scratch home 真机证据 + 前置 dry-run 信息。
- **R7 宿主 rc 漂移**：钉点 rc.5，漂移即 W7 整链重跑。
- **R8/R9 不做项误读 / wired 凑数**：ledger deferred_reason 落档 + 白名单逐批放行 + 验收看用户可见变化。
- **单点故障**：generic arm 与 extractor 各为共同故障点；对冲 = 每批 id 数受控（≤8）+ BAD_KIND/NOT_WIRED 闸先行 + 双跑一致/fail-loud。
- **fingerprint 连带失效**：新 bundle 使 0.24 真机证据失效（AMEND-4），波2 各批须按新 bundle 重取证，W2-6 收口。

## 5. 回滚（Rollback）

宿主钉点不动使回滚树存在。回滚顺序（逆变更链，逐门复核）：

1. ledger 正门回退 `deferred_reasons` 数据并重生成（schema 仍 /1）；
2. 移除 bridge generic arm（保留既有 28 条 per-id arm 不动）；
3. `gen-capcontract.mjs` 回退生成表与 gate #11–#16，重生成三件套；
4. `capir/capir.json` 由旧版 extractor + `gen-capir.mjs` 全链重写回 `/2`；
5. 移除仓内 extractor v2。

每步回滚后须重跑 `bun test packages/*`、`gen-*-check`、`node scripts/check-capcontract.mjs` 与受影响 proof；CI schema 断言钉 `/3`，回滚必须整链一致，禁止只改单点造成半开状态。回滚是显式决策，须走 W8 反向流程并记录。

## 6. 出处与落地证据

- 方案：`/Users/qingguee/repo/wayfinder-web-profile/research/025-wave2-plan.md` v1.1（§2/§3/§4.4/§6.3/§8/附录 A.5）。
- W2-0 五片 commit：`7f249bf`（a extractor）、`b0a68ac`（b CapIR v3）、`de0d6b1`（c capcontract）、`eb86405`（d generic arm）、`bd37e9e`（e ledger 正门）。
- 证据包：`.proof/025-w2-0/`（a–d）、`.proof/025-w2-0e/`（e：预注册、diff 审计、机器检查、真机 smoke、fingerprint、脱敏扫描）。
- 解冻-再冻结链：`docs/025-wave2-w8-unfreeze-refreeze.md` + `docs/architecture/08-frozen-surfaces.md` §8.4。
