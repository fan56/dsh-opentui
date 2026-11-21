# 08 冻结面（不可擅动的结构边界）

> 出处约定见 [README.md](README.md)。本文列**哪些面冻结、为何冻结、解冻的结构后果**；解冻的**步骤与决策协议**见 `docs/workflows/w8-base-unfreeze.md`，那里已完整定义的流程此处只给交叉引用，不复制。

## 8.1 冻结宣告

0.24 底座自 `feat/024-capir@b37b78a` 起冻结（主体验证于 `89b1f36`，N1 收口补丁并入；`024-base-frozen.md:3`）。冻结依据 V1–V4 全绿（装配实测、底座 proof 证据包、真机冒烟、CI run 44762359675 三 job 绿、门禁 PASS=13、红档留档；同报告 `:5-14`）。冻结后变更须走显式解冻（解冻决策 + 受影响 proof 重跑；`:3`）。

## 8.2 冻结面清单

| 冻结面 | 边界内容 | 为何是结构边界 | 出处 |
|---|---|---|---|
| CapIR 真源（`capir/capir.json`） | 43 工件/257 方法计数、`attribution` 首行、id 体系、`--check` 字节级自洽；**禁手改**，换代只能由 extractor 重跑 + 生成器整文件重写 | 版本锚定的静态契约；塞入「已注册」会污染环境快照 | `capir/README.md:5-17,61-68`；`024-day1-review-oldfox.md:31`；`024-base-frozen.md:3` |
| build-bridge 转义段 | `emittedBundle.replaceAll("@deepseek-ai/dsh-llm", "@deepseek-ai\\u002fdsh-llm")` 一段；**只读，禁扩 needle / 禁放宽**，改动须显式评审票 | N1 路线 B 的产物侧守卫，guard 零改动前提 | `scripts/build-bridge.mjs:110-123`；`024-base-frozen.md:18,29` |
| 既有断言（测试层） | 既有断言零删除；计数/降级断言「更新非删除」；冻结底座断言（shell seam）一字未改 | 门禁是回归网，删除断言等于静默降覆盖 | `024-s2-credentials-slice.md:8,109-115`；`024-base-frozen.md` 冻结依据 |
| @manual 口径 | `wired_manual` 为 @manual 计数源，tag 前提必须为 0；`wired_protocol`（ADR-0010 10 帧）不计入；CI 检查 8 拆 8a/8b，名集对账保留 | 旧口径「全部 wire 行清零」会误废 ADR-0010 帧协议本身 | `024-tag-premise-adjudication-oldfox.md:10-40`；`check-capcontract.mjs:15-18,250-304` |
| 生成物声明行 | 4/4 生成物（capcontract .ts ×3 + ledger.md）首行带 provenance 声明；CI #6 断言 | provenance 法务口径的机器化 | `024-base-task4-handshake.md:49-50`；`check-capcontract.mjs:12-13` |
| peer 版本窗 | `HOST_PEER_RANGE = >=0.2.2-rc.3 <0.3.0`（单一事实源 `host-compat.mjs:32`），与 CapIR 钉点同 PR 同步 | 越窗变 provisioning 显式失败；单独更新任一成半开状态 | `docs/adr/0009-inprocess-session-bridge.md:62`；v3 `:96` |

## 8.3 解冻的结构后果（步骤见 w8）

解冻不是单纯「改一行」，以下结构连锁必须一并核算（`docs/workflows/w8-base-unfreeze.md` 定义步骤）：

- **动 CapIR** → 换代（extractor 重跑 + provenance 改）→ ledger 对账（expected/wired/fullOnlyIgnored 重算）→ capcontract 生成物重生成 → `check-capcontract` 全绿 → 受影响 proof 重跑（`024-base-frozen.md:3`；`024-tag-premise-adjudication-oldfox.md:60-65`）。
- **动 build-bridge 转义段** → N1 守卫语义与 ci.yml inline-guard 需同步复核，一级负例自测（C3）与 CI 双 OS + pack 全绿复验（`024-base-frozen.md:18`）。
- **动 @manual 口径** → ledger 维度定义、gen-ledger、check-capcontract 检查 8 与 tag 前提文本同步（`024-tag-premise-adjudication-oldfox.md:30-40`）。
- **动 peer 窗/CapIR 钉点** → 两者同 PR 更新，否则「连得上但听不懂」（v3 `:96`）。

## 8.4 已知残留（不阻塞冻结，随切片/末期处置）

路线 b（全集 257 通用调用）待 CapIR params schema 的残留已关闭：CapIR v3（schema `dsh-opentui.capir/3`，43 工件/257 方法全带 params）已解冻再冻结 @ `bd37e9e`（025 波2 W2-0e，additive-only params/service/result + 休眠 generic arm + ledger deferred_reason；证据链 `docs/025-wave2-w8-unfreeze-refreeze.md`，决策 ADR-0012 仍标 Draft 但 W2-0 底座已落地、逐 id 放行随批推进）。**冻结后 generic arm 的逐 id 放行属 W1/W2 切片流程、不再重复解冻**（再冻结声明 `:62-67`）：手写集 28 + 通用放行 `CAP_GENERIC_ADAPTERS=30` = 并集 wired 58 终态；`ledger.dimensions.wired_capir_generated.count` 仍 28（通用放行只在 capcontract 代码侧、不动 capir.json / ledger）。波3 全程 `git diff c563323..HEAD -- capir capcontract ledger scripts/build-bridge.mjs` 为空，冻结面零触碰。本刀 `check-capcontract` PASS=22、`gen-capir --check`/`gen-capcontract --check` byte-identical。
#9 deny-list 换名臆造盲区（N3.1）、#10 静态半边依赖 smoke 时点（N3.2）、UJ1 stdio 尾随文案、NOT RUN 清单均原样登记（同冻结报告 `:22-28`）。AMEND-2 盲区家族（`result.jsonSchema` 为 null / `additionalProperties:true` 的已放行 id 不进 `CAP_PROJECTED_BY_HAND`）逐 id 登记与 seam 手写二次白名单为 load-bearing 防线，详见 [02](02-capability-layer.md) §2.3、`docs/workflows/w2-command-face.md` 判定表补充。

## 维护责任

冻结宣告的基点、冻结面范围或解冻结构连锁发生变化时必须更新本文档；具体解冻操作步骤调整只更新 `w8-base-unfreeze.md`。
