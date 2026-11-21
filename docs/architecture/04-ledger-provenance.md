# 04 台账与溯源（capability ledger）

> 出处约定见 [README.md](README.md)。维度与不变量在此；rc 升级的**执行步骤**见 `docs/workflows/w7-host-upgrade.md`，解冻步骤见 `w8-base-unfreeze.md`。

## 4.1 ledger 是「环境状态」唯一归属

CapIR 只存静态全集；**已注册/已接线面是环境状态**（profile × 宿主二进制 × 安装面），归 ledger（`capir/README.md:8-10`，`024-day1-review-oldfox.md:31`）。ledger 由 `scripts/gen-ledger.mjs` 从 `capir/capir.json` + `ledger/provenance.json` 全量生成，**永不手改**（`gen-ledger.mjs:9-16`，`ledger/ledger.md:5`）。

## 4.2 六维（口径与现值）

`ledger/ledger.json` 的 `dimensions`（生成器 `gen-ledger.mjs:100-142`；现值以 `ledger/ledger.md:11-19` 为实读口径）：

| 维度 | 含义 | 现值 | 出处 |
|---|---|---|---|
| `full` | CapIR 静态全集 | 257 methods / 43 artifacts（unary 226 / stream 31，class W 257；端点 sc 27、global map sum 257） | `ledger/ledger.md:13`；`gen-ledger.mjs:101-108` |
| `expected` | profile 期望面（bundle 声明闭包推导 + 实测对账） | 75（13 贡献包、1 排除，profile `opentui-inproc`） | `ledger/ledger.md:14,34-52`；`gen-ledger.mjs:109-115` |
| `wired_protocol` | ADR-0010 桥协议帧（不计 @manual） | 10（`mark: bridge-protocol (ADR-0010)`） | `ledger/ledger.md:15,54-67`；`gen-ledger.mjs:116-120` |
| `wired_manual` | 有 CapIR 对应的 1:1 宿主手抄（@manual 计数源，**必须为 0**） | 0（`mark: derived-from-manual host-copy`） | `ledger/ledger.md:16,69-72`；`gen-ledger.mjs:121-125` |
| `wired_capir_generated` | 经生成链接线的 CapIR id（非手抄 wire 行） | 24；`in_wired_total=24/257` | `ledger/ledger.md:17-18,74-...`；`gen-ledger.mjs:126-131` |
| `i_class` | 手登记的服务面（服务对象面，无 W 对应） | 6 services | `ledger/ledger.md:19`；`gen-ledger.mjs:132-136` |

另有 `provenance` 维（profile/推导链/对账记录/dsh-base 依赖验证，`gen-ledger.mjs:137-141`）与每条 `methods[]` 行上的 `in_full/in_expected/in_wired/provenance` 标记（`:78-94`）。「wired」并非独立第三维：它是 `wired_protocol` + `wired_manual` + `wired_capir_generated` 的 capir_id 并集（`gen-ledger.mjs:68-76,88`）。

## 4.3 gen-ledger 正门纪律

- **输入不可变**：`capir/capir.json`（真源）+ `ledger/provenance.json`（手工维护映射与证据数据：bundle→贡献包映射、方法级排除、75 条实测 id、手抄面/I 类登记）。对账修正只进 provenance，**永不改 CapIR**（`gen-ledger.mjs:4-16,53`，`024-base-task3-ledger.md:97-104`）。
- **对账是硬门禁**：推导 expected 与实测稳态集合若不等（双向 diff 任一非空），脚本非零退出且不写任何输出（`gen-ledger.mjs:45-55`，`024-base-task3-ledger.md:117`）。
- **幂等**：复跑字节级一致（双跑 sha256 恒等，`024-base-task4-handshake.md:61`）。
- **声明行**：`ledger.json` / `ledger.md` 首行带 provenance 声明（F4 扩到 4/4 生成物，`024-base-task4-handshake.md:49-50`；`gen-ledger.mjs:163-165`）。
- **门禁联动**：`check-capcontract.mjs` 字节比对生成物并校验维度（#6 声明行、#8a 协议面名集、#8b `wired_manual==0`；`check-capcontract.mjs:6-21,250-304`）。

## 4.4 对账闭环（首跑 diff → 修映射 → final diff 空）

这是**结构闭环**，不是操作步骤；执行顺序见 w7。

1. naive 首跑（仅声明闭包）推导 49，实测 75 → diff：extra 1（`permissionPresets/set`）、missing 27（session-controller）（`ledger/ledger.md:29-32`，`024-base-task3-ledger.md:57-93`）。
2. 修映射数据（均在 provenance）：补 session-controller 为 profile-patch 贡献包（+27，证据 `provision-inproc-profile.mjs:566-578`、`cordis.patch.yml` insert）；排除 `permissionPresets/set`（rc.4 实测无该 @Remote，rc.5 源码有；记方法级环境修正，不判宿主漂移）（`024-base-task3-ledger.md:95-104`）。
3. 重推导 diff 空 → 对账闭环成立；负例（移除一个实测 id）exit 1 且零输出（`024-base-task3-ledger.md:106-117`）。

「工件在 ≠ 服务在」的实证即上述 rc.4/rc.5 偏差：status 静态包解析面 vs 运行时贡献面不一致，按实测优先登记（`024-day1-review-oldfox.md:72-82`）。

## 4.5 rc 升级换代（交叉引用，不重述流程）

宿主 rc 升级时：extractor 重跑 → CapIR 换代 → ledger diff → proof 重跑。**执行步骤、preflight/后验与断链 symlink 陷阱见 `docs/workflows/w7-host-upgrade.md`**。结构要点：

- `HOST_PEER_RANGE`（peer 版本钉点）与 CapIR 版本钉点必须**同 PR 同步更新**，单独更新任一即「连得上但听不懂」的半开状态（v3 `:96`）。
- rc.4→rc.5 时 `permissionPresets/set` 会从排除项变为注册项，须从 provenance 移除该排除并重跑对账，否则 expected 少 1（`024-base-task3-ledger.md:191`）。
- `fullOnlyIgnored=182` 依赖 `CAP_DISPATCH_TABLE`（257），随 rc 换代自动更新（`024-base-task4-handshake.md:96`）。

## 维护责任

ledger 维度定义/计数、`provenance.json` 映射数据、对账硬门禁语义或 rc 换代口径变化时更新本文档；仅改流程步骤不改结构时不更新。
