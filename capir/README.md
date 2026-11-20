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

顶层字段：`attribution` / `schema` / `provenance` / `counting_rules` / `totals` / `artifacts`。
每个 method：`id` / `namespace` / `name` / `kind` / `class`。

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
`TypertRemoteMap` 键之和（每方法一键）。agent-scope 变体（`TypertRemoteScopeMap`，全局 34）
不计入端点。勿把 27 当全局端点总数。

## 复跑

extractor 是开发者机器上的本地只读工具（不在本仓），产出原始 JSON；formatter 在本仓，
负责校验、加声明行、稳定序列化：

```
python3 -I /Users/qingguee/repo/wayfinder-web-profile/scripts/extract_capir_artifacts.py \
  /Users/qingguee/repo/deepseek-harness-pr \
  /Users/qingguee/repo/wayfinder-web-profile/research/024-day1-extractor-artifacts.json \
  /Users/qingguee/repo/wayfinder-web-profile/research/024-day1-artifact-method-list.md

node scripts/gen-capir.mjs \
  /Users/qingguee/repo/wayfinder-web-profile/research/024-day1-extractor-artifacts.json \
  capir/capir.json
```

formatter 拒绝内部不一致（计数不符、id 重复、非 W 方法、非法 kind），不硬凑数字。
宿主 rc 升级时重跑并做 ledger diff。
