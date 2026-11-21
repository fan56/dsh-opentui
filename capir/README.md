<!-- Derived from deepseek-ai/deepseek-harness (MIT, Copyright (c) 2026 DeepSeek) -->

# CapIR (0.24 底座第一刀)

`capir.json` 是本仓能力接口形状（Capability IR）的**唯一真源**：43 个宿主生成工件、
257 个 wire→client 可调用方法（全 W），保留 `unary` / `stream` 标注。

纪律：
- 只存静态全集（随宿主 rc 锚定），**不携带任何「已注册 / 已接线」标记**。运行时注册面
  （profile × 宿主二进制 × 安装面）归 capability ledger，不进本文件。
- 只描述接口形状（工件 / 方法 id / 端点口径），**不含宿主实现代码**。
- 本目录所有文件头部带来源声明行；声明由 `scripts/gen-capir.mjs` 自动加盖，禁止手工粘贴。

## 文件格式

严格 JSON（2 空格缩进、稳定排序、文件尾换行）。`attribution` 为第一个键并保持在第 1 物理行，
便于 CI 同时按字段与按行断言。JSON 无注释语法，故声明落为字段而非 `//` 注释。

schema = `dsh-opentui.capir/3`（CapIR v3，025 W2-0 起）。相对 `/2` 的变化：method 条目在原有五键上追加 `service` / `params[]` / `result` 及可选 `implementation` / `stream` / `cancel` / `scope`（additive-only，既有键值逐字节不变）；相对 `/1` 的历史变化：`endpoints_map` → `endpoints_count`（每工件方法数计数，非映射）。
参数签名双源交叉：`.d.ts` `TYPERT_REMOTE` 字面量（字段名/顺序/可选性权威）× `typert.host.js` manifest `parameters[]`（jsonSchema）；`params[]` 归一档 `{name,required,type,enum?}`，完整 jsonSchema 留 capir 数据层。

顶层字段：`attribution` / `schema` / `provenance` / `counting_rules` / `totals` / `artifacts`。
每个 method：`id` / `namespace` / `name` / `kind` / `class` + `service` / `params[]` / `result`（可选 `implementation` / `stream` / `cancel` / `scope`）；257 方法全带 service/params/result，`totals.methods_with_params = 257`。

## id 体系

```
<package>#<namespace>/<method>
```

样例：`@deepseek-ai/dsh-deepseek-account#account/cancelSignIn`。
`<package>` 取宿主包名（含 scope），`namespace/method` 取生成 `.d.ts` 的 key。
该 id 与运行时 `typert.local.list()` 的 `descriptor.id` **同形**（实测样例
`@deepseek-ai/dsh-llm#llm/discoverModels`），后续握手比对与批 1 用例重索引复用同一 id。

## 端点口径

`totals.endpoints_session_controller = 27` 是 **session-controller 单包**口径（源码
`@Remote` 27 处双证）；`totals.endpoints_global_map_sum = 257` 是各工件
`endpoints_count` 之和（每方法一键）。agent-scope 变体（`TypertRemoteScopeMap`，全局 34）
不计入端点。勿把 27 当全局端点总数。

## 生成器输入（可复现）

- `extractor-input.json`：开发者机器上 extractor 输出的可复现副本。已剥除含本机绝对路径的
  `source_root`；生成链路消费的 `counting_rules` / `totals` / `artifacts` 原样保留。
- `provenance-input.json`：**独立 provenance 输入**。`source_branch` / `source_version`
  在此钉定，不再硬编码进 `scripts/gen-capir.mjs`。宿主 rc 升级重跑时只改此文件与外部
  extractor 输出，`capir.json` 由生成器整文件重写，provenance 不会静默撒谎。

extractor 是开发者机器上的本地只读工具（不在本仓），产出原始 JSON；formatter 在本仓，
负责校验、加声明行、稳定序列化。复跑命令（把占位符替换为开发者机器上的实际路径）：

```
# 本地（开发者机器，宿主源码 checkout 旁）：
python3 -I <extractor-script> <host-source-root> <extractor-output.json> <artifact-method-list.md>

# 本仓（把 <extractor-output.json> 的机器相关字段剥除后提交为 capir/extractor-input.json）：
node scripts/gen-capir.mjs <extractor-input.json> capir/capir.json <provenance-input.json>

# CI / 本地反漂洗校验（只比对不覆写，漂移即非零退出）：
node scripts/gen-capir.mjs --check
```

`--check` 不带参数时使用仓内三份提交输入（`capir/extractor-input.json`、
`capir/capir.json`、`capir/provenance-input.json`），内存重生成后与仓内文件字节级比对。
formatter 拒绝内部不一致（计数不符、id 重复、非 W 方法、非法 kind），不硬凑数字。
宿主 rc 升级时重跑并做 ledger diff。
