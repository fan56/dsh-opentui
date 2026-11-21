# 09 扩展点（三类变更各动哪几层）

> 出处约定见 [README.md](README.md)。本文只回答**结构影响面**（哪些层必须改、哪些不变量随之校验）；切片/落地**步骤**见 `docs/workflows/w1-capability-slice.md` 与 `w2-command-face.md`，那里已有的门禁阶梯与预注册流程不在此重复。

## 9.1 三层速查表

记号：`●` 必须改；`○` 条件改（看是否触冻结面）；`—` 不动。层序对应 [README](README.md) 的拓扑分层。

| 变更 | 能力源层（CapIR/ledger/capcontract） | 桥接线层（bridge hostInvoke/协议面） | seam face 层 | TUI 层（命令/面板/焦点） |
|---|---|---|---|---|
| **加新能力域**（CapIR 无现成 id） | ● extractor 重跑 + 换代；provenance 贡献包映射；ledger 对账；capcontract 重生成（[02](02-capability-layer.md) §2.1-2.2、[04](04-ledger-provenance.md)） | ● **优先通用 arm 放行集**：在 gen-capcontract 的 `adapterBlock` 加 id（非 deny 族）；deny 族（account/credentials/settings）走手写 arm + 专属投影；stream 走 relay（[02](02-capability-layer.md) §2.3） | ● 若 TUI 要消费，新增 `SessionSeam` face 并接 `BridgeSessionSeam`（手写 face + 二次白名单投影，不生成透传面） | ● 新命令注册进 `coreCommands()` / 新面板挂 panel-kit（[05](05-tui-layer.md)） |
| **加新命令**（已有域扩展） | —（不扩能力面） | —（宿主面已 wired） | ● 若缺 face：补 seam face；有 face 则只改命令体 | ● `commands.ts:597` 增条目 + unavailable 分支；skill 命令由 `withSkillCommands` 追加（[05](05-tui-layer.md) §5.3-5.4） |
| **加新面板/overlay** | — | — | ○ 仅当面板读新 face | ● panel-kit 栈 + push/pop 所有权帧；in-flow 面 admission 守 page ownership；FocusRouter tier 声明（[05](05-tui-layer.md) §5.1-5.2） |

## 9.2 各类型的结构约束（不是步骤）

- **新能力域**：若 CapIR 无对应 id 或需走生成链，动 CapIR = 底座解冻（[08](08-frozen-surfaces.md)）；握手期望面由 bundle 声明闭包推导，新增贡献包须进 provenance 并重跑对账（[03](03-handshake-lifecycle.md) §3.2、[04](04-ledger-provenance.md) §4.4）；hostInvoke 只认登记 id，未登记即 `NOT_WIRED`（[02](02-capability-layer.md) §2.5）。接线地图与七步流程见 `w1-capability-slice.md`。
- **新命令**：瓶颈常不在宿主能力而在 seam face——0.24 审计中 5 条降级命令是 seam 未接 face 而非 host 缺口（`025-command-surface-audit.md:143`）。补命令不改 CapIR/ledger（除非同时扩能力面）；保留 unavailable 契约（[05](05-tui-layer.md) §5.4）。判定口径与范例见 `w2-command-face.md`。
- **新面板**：panel-kit 以结构桥接 push/pop token，**零 tui-base 依赖**（[05](05-tui-layer.md) §5.2）；in-flow 面不得把帧推到绝对定位 overlay 之上（`ADR-0008:183-199`）；keymap 迁移为独立项、必须带真机门禁（v3 `:108`，见 [07](07-testing-architecture.md)）。

### 9.2a 通用 arm 放行机制（W2 后新增的主扩展点）

CapIR v3 参数表 + 表驱动 generic arm（ADR-0012）落地后，**扩能力的默认路径是往通用放行集加 id，而不是复制手写 arm**：`CAP_GENERIC_ADAPTERS`（生成于 `gen-capcontract.mjs` 的 `adapterBlock`）逐 id 显式白名单，桥侧 `invokeGenericCap` 走查表 → deny-list（先于白名单）→ BAD_KIND → confirm 闸（写 id，`CAP_WRITE_CONFIRM_IDS`）→ 包裹式 `ctx.get` → `CAP_PARAMS_TABLE` 粗校验 → 表序位置调用 → owned signal（[02](02-capability-layer.md) §2.3）。放行四处同步：生成器 `adapterBlock` / check #16 放行断言 / NOT_WIRED 文案并集计数 / 架构 02 round log；旧 criterion 逐字留注释、exact equality 不降（`docs/workflows/w5-proof-evidence.md` round log 实例）。

扩展边界与例外：

- deny-list 三族（`account`/`credentials`/`settings`）与 `CAP_PROJECTED_BY_HAND`（敏感键命中）**禁走通用投影**，必须手写 arm + 逐字段白名单投影 + wire SENTINEL 负例（AMEND-1/2；[06](06-security-privacy.md)）。
- AMEND-2 盲区家族（`result.jsonSchema` 为 null / `additionalProperties:true`）静态扫描失明，已放行 id 须逐 id 声明默认投影假设，load-bearing 防线为 seam 手写二次白名单（[02](02-capability-layer.md) §2.3）。
- scope 家族 id 首参是 lookup 语义（wire 收字符串、宿主收活体对象），须依赖 data-driven resolver（AMEND-5 §11.1）；服务键 `ctx.get` 成功只证注册在档、不证语义可达（I-1 教训，[07](07-testing-architecture.md) §7.3）。
- 放行集不写死 expected-75 全集：逐批显式加入 + ledger provenance 走 gen-ledger 正门；终态并集 wired 58（手写 28 + 通用 30），冻结面零触碰（[08](08-frozen-surfaces.md) §8.4）。

## 9.3 安全与门禁横切（任一类型都要核对）

任何跨层扩展都要复核：新增出帧字段是否落入 [06](06-security-privacy.md) 的三处白名单/投影字段集；新增/改动的断言是否触发 [08](08-frozen-surfaces.md) 的冻结面；门禁职责分层见 [07](07-testing-architecture.md)，命令表见 `docs/workflows/README.md:58-68`。

## 维护责任

分层归属或三类扩展的影响面（尤其 seam face 与命令/panel 的耦合边界）发生变化时更新本文档；具体切片步骤调整只更新 w1/w2。
