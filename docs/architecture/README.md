# dsh-opentui 0.24 架构文档集（as-built）

本目录编纂 **0.24 落地后的软件架构**：结构与不变量。素材仅为仓内源码、`docs/adr/`、0.24 报告（`research/`），每条关键断言带出处；不记载流程步骤（那是 `docs/workflows/` 的职责），不凭空发挥。

## 出处约定

- `报告名.md:行号` — 位于 wayfinder-web-profile 仓 `research/` 目录（0.24 执行/评审/裁决全文），**不在本产品仓**。
- `路径/file:行号` — 位于本产品仓（基线 `feat/024-capir @ bea33c3`，0.24.0 发布树）。
- `docs/adr/NNNN-*.md` — 本产品仓架构决策记录（本文直接引用其条款）。

## 与 workflows/ 的分工（严格）

| | 架构（本目录） | 流程（`docs/workflows/`） |
|---|---|---|
| 回答 | **是什么 / 为什么这样、什么不能动** | **怎么做 / 按什么步骤、怎么判绿** |
| 内容 | 拓扑、分层、状态机、不变量、数据结构、冻结面、扩展点 | 切片七步、门禁命令、证据包规范、评审协议、发版与解冻步骤 |
| 变化触发 | 结构变更 / 不变量新增或移除 | 流程或门禁口径变更 |
| 越界示例 | 不写「先落预注册再实现」这类步骤 | 不写「FocusRouter 是 modal>overlay>main>global」这类结构 |

交叉引用一律**只给链接与一句定位**，不复制对方内容。本目录引用 workflows 的地方：

- [04-ledger-provenance.md](04-ledger-provenance.md) → `w7-host-upgrade.md`（rc 升级换代流程）、`w8-base-unfreeze.md`（解冻流程）。
- [07-testing-architecture.md](07-testing-architecture.md) → `docs/workflows/README.md` 的「测试架构总表」与各 wN 的门禁阶梯，本文只讲门禁的**分层职责与判据来源**，不重列命令表。
- [08-frozen-surfaces.md](08-frozen-surfaces.md) → `w8-base-unfreeze.md`（解冻步骤）。
- [09-extension-points.md](09-extension-points.md) → `w1-capability-slice.md` / `w2-command-face.md`（切片步骤）。

## 系统拓扑总图（与源码一致）

```
                       ┌──────────────────────────────────────────────┐
  用户命令 dsh-opentui  │ 段 1  node launcher                         │
                       │   packages/shell/bin/dsh-opentui.mjs         │
                       │   · spawn bun + 转发 SIGINT/SIGTERM/SIGHUP   │
                       │     (bin:534,550-552)                        │
                       │   · 信号退出码 128+N；正常透传 client rc      │
                       │     (bin:557-560)                            │
                       └───────────────────┬──────────────────────────┘
                                           │ spawn (bin:534)
                       ┌───────────────────▼──────────────────────────┐
                       │ 段 2  bun TUI 进程                           │
                       │   client-entry.tsx:440-459                   │
                       │     → v2-entry.tsx 生产 boot 合成根           │
                       │   · ClientConnection / RemoteHostSession      │
                       │     (HTTP 宿主：config/label/lifecycle 保留面)│
                       │     (v2-entry.tsx:1587-1605)                  │
                       │   · StdioBridgeTransport → BridgeSessionSeam  │
                       │     (唯一 session seam, v2-entry.tsx:1625)    │
                       │   · FocusRouter / 27 命令 / panel-kit         │
                       └────────┬──────────────────────┬───────────────┘
                                │ stdio JSON-lines     │ HTTP (cookie / authority)
                                │ DSH_OPENTUI_         │ ADR-0009 0.22.0 已知过渡债
                                │ BRIDGE_STDIO=1       │ (非从属 TUI 的 config 宿主)
                                │ (bridge-transport.ts │
                                │  :183-190)           │
                ┌───────────────▼──────────────────┐  ┌─▼──────────────────────┐
                │ 段 3  宿主 node 进程              │  │ detached HTTP 宿主      │
                │   dsh --profile opentui-inproc    │  │  lifecycle.ensureV2Host │
                │   硬桩①：宿主不能跑 bun            │  │  (v2-entry.tsx:1561)   │
                │   (ADR-0009:27)                   │  │  仅 config 面           │
                │ ┌───────────────────────────────┐ │  └────────────────────────┘
                │ │ bridge = cordis bundle        │ │
                │ │  packages/bridge (宿主进程内)  │ │
                │ │  inject: ['agents','typert']   │ │
                │ │  (index.ts:568)               │ │
                │ └───────────────┬───────────────┘ │
                │                 │ ctx 直调宿主服务 │
                │                 ▼                 │
                │  agents / sessionPersistence /     │
                │  sessionController / agentDefault  │
                │  Model / deepseekAccount / ...     │
                └────────────────────────────────────┘
```

硬桩（两进程方案的不可消解约束）：宿主不能跑 bun（N-API addon 调 Node 私有模块，`docs/adr/0009-inprocess-session-bridge.md:27`）；node 后端 OpenTUI 0.8.x 不 flush 帧（同 ADR `:28`；本仓 `CHANGELOG.md:968` 现文，ADR 原引 `:564` 已随 CHANGELOG 演进空白）。因此「单进程 + 现有渲染栈」不可行，取方案 D：bridge 作为宿主进程内 bundle，TUI 仍是独立 bun 进程（`ADR-0009:44`）。

## 阅读顺序

| 序 | 文档 | 主题 |
|---|---|---|
| 1 | [01-system-topology.md](01-system-topology.md) | 两进程三段拓扑、硬桩、生产 boot 合成根、host 客户端层、exit code 契约 |
| 2 | [02-capability-layer.md](02-capability-layer.md) | CapIR 真源、capcontract 生成三件套、hostInvoke 注册表、@manual 口径、NOT_WIRED |
| 3 | [03-handshake-lifecycle.md](03-handshake-lifecycle.md) | 三态握手、期望面 75 推导、缺失分档、I 类 6 服务探针、会话生命周期 |
| 4 | [04-ledger-provenance.md](04-ledger-provenance.md) | 六维台账、gen-ledger 正门纪律、对账闭环、rc 升级换代 |
| 5 | [05-tui-layer.md](05-tui-layer.md) | FocusRouter 四层捕获栈、panel-kit、seam face 供给/降级、27 命令 |
| 6 | [06-security-privacy.md](06-security-privacy.md) | 脱敏三处白名单、中央剥离、逐字段投影、凭据纪律、auth URL 四层禁入、N1 转义段 |
| 7 | [07-testing-architecture.md](07-testing-architecture.md) | 门禁阶梯各层职责（命令表见 workflows） |
| 8 | [08-frozen-surfaces.md](08-frozen-surfaces.md) | 冻结面清单与解冻边界（步骤见 w8） |
| 9 | [09-extension-points.md](09-extension-points.md) | 加能力域/命令/面板各动哪几层（三层速查表） |

## 维护责任

任何进程拓扑、boot 入口、模块归属或跨层不变量的改动（含 ADR 新增/修订、v2-entry 合成根改线、bridge inject 面变化）必须更新本文档与相应分文档。
