# W8 — 底座解冻流程

适用：必须改动已冻结底座面的场景（CapIR 真源、capcontract 生成层、ledger 生成物、build-bridge 转义段、握手/完整性门禁语义）。前置：底座已冻结（`024-base-frozen.md:3`）。解冻须**显式决策**，且受影响 proof 全部重跑。出处：`024-base-frozen.md:3,22-29`、`dsh-opentui-024-delivery-plan.md:50,88,95`、`024-tag-premise-adjudication-oldfox.md:60-65`。

## 一、冻结面清单（默认禁动）

来源：`024-base-frozen.md:3`（冻结主体 `feat/024-capir@b37b78a`，CapIR 真源 `fab915a4` / ledger 真源 `e9826514`）、`:29`（N1 C1 只读段）。

| 冻结面 | 内容 | 默认纪律 |
|---|---|---|
| `capir/capir.json` | 能力真源（43 工件/257 方法，随宿主 rc 锚定） | 禁手改；变更走 extractor 重跑（[W7](w7-host-upgrade.md)）+ 显式解冻 |
| `capcontract/{types,dispatch,binder}.ts` | 生成物（零 @deepseek-ai import、inject 声明式） | 禁手改；`gen-capcontract.mjs` 重生成 |
| `ledger/ledger.{json,md}` + `provenance.json` | 台账与映射数据 | 禁手改；`gen-ledger.mjs` 正门重生成 |
| `packages/bridge/src/index.ts` 握手/完整性相关 | 三态握手、75/75 面、wired 表查找 | 变更须过门禁 #7/#8a/#8b/#9/#10 与握手复跑 |
| `scripts/build-bridge.mjs` 转义段（`:110-123`） | N1 路线 B 的 `\u002f` 转义（`@deepseek-ai/dsh-llm` → `\u002f`） | **N1 C1 冻结只读**：禁扩 needle、禁放宽 replaceAll、禁任何「让 CI 转绿」取向的改动，改动须显式评审票（`024-base-task6-review-oldfox.md:34-39`） |
| 完整性门禁 #1–#10（现拆 #8a/#8b，共 14 项） | CapIR/capcontract 可复现、自洽、扫描零、声明行覆盖、provenance、dispatch 可执行 | 语义变更须评审；撒谎注释必改（ci.yml 文案票，`024-base-core-review-oldfox.md:60-62`） |

冻结声明：底座自 `b37b78a` 起冻结；后续变更须走显式解冻流程（解冻决策 + 受影响 proof 重跑，`024-base-frozen.md:3`）。各切片反复核对「冻结面 git diff 空」为硬红线（S1–S6 各片报告红线段）。

## 二、解冻流程

1. **确认必须解冻**：先判定变更是否真的落在冻结面。多数「补能力」需求可在冻结面外解决（[W1](w1-capability-slice.md) 表查找接线、[W2](w2-command-face.md) 补 seam face），不必解冻。路线 b（CapIR params schema → 全集 257 通用调用）需新增 CapIR 维度 = 真源变更 = 底座解冻，属 0.24 后事项（`024-tag-premise-adjudication-oldfox.md:60-65`）。
2. **显式决策**：解冻须由协调者/oldfox 出显式评审票，写明解冻面、理由、影响范围、保留条件（如 N1 C1 的三条正当性事实：17 处均为 CapIR/ledger 派生数据字面量、运行时逐字节等价、注释已明示意图与边界，`024-base-task6-review-oldfox.md:36`）。无决策不动冻结面。
3. **执行变更**：按 [W7](w7-host-upgrade.md) 重跑 extractor / gen 正门生成；转义段变更须评审票（N1 C1）。保留条件须持续满足，缺一即回退走替代路线（`024-base-task6-review-oldfox.md:27-39`）。
4. **受影响 proof 全部重跑**：底座 V1–V4（装配实测 / 底座 proof / 真机冒烟 / CI 完整性）、所有切片 proof、握手 75/75、verify70 全量、E2E —— 凡依赖被解冻面的证据均重跑（`024-base-frozen.md:50`、`dsh-opentui-024-delivery-plan.md:95`）。解冻爆炸半径对冲即此（风险 3）。
5. **重新冻结或宣告新基线**：变更后经评审 GREEN + 真 CI 双 OS+pack 全绿，宣告新冻结点（沿 `024-base-frozen.md:9-15` V1–V4 判据格式）。

## 三、预防条款（0.24 真实陷阱，就地归属）

1. **转义段只读被破（N1 C1）**：路线 B（产物侧 `\u002f` 转义）成立的前提是 C1「转义段冻结只读」+ C2「ci.yml 注释对齐」+ C3「一级负例自测」（`024-base-task6-review-oldfox.md:34-39`）；S6 收尾仍核 `build-bridge.mjs:117-122` needle 在位、未触碰（`024-s6-legacy-slice.md:8`）。预防：任何对转义段的改动走显式评审票；CI 第一级三标记（`function createUserMessage`/`deepFreeze(`/`node_modules/.pnpm/@deepseek-ai`）零命中 + 第二级 guard 验证产物不含宿主实现字面量（`024-base-task6-review-oldfox.md:47,58`）。
2. **冻结面 git diff 不空即停**：每片报告的硬红线；解冻票之外若发现冻结面被改，视为越界即停（[W4](w4-review-gate.md) RED 停车）。
3. **底座漂移危害**：首日 E 条历史注记——本项目已两次因本地视角/基线过时产生错误（0.23.4 的 inproc opt-in 口径、本地 main v0.22.0 滞留）；任何证据采集/构建/对账先核 HEAD 与 origin/main 关系并记入证据文件头（`dsh-opentui-024-delivery-plan.md:26`、`024-day1-review-oldfox.md:84-94`）。解冻时尤其要钉死分支基点，禁在本地滞留树上操作。
