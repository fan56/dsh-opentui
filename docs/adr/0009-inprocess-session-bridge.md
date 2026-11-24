# ADR-0009: Session bridge — negotiate the missing resume capability in-host, keep the bun TUI

Date: 2026-11-18
Status: Accepted（方案 D 已落地；2026-11-24 inproc-only 终态见 Update）

## Update — 2026-11-24：inproc-only 终态

- **唯一会话宿主是 stdio bridge 子进程**：bun TUI 通过 `StdioBridgeTransport` spawn `dsh --profile opentui-inproc`，宿主内加载 bridge cordis bundle；`bootClientV2()` 经 `createBridgeSessionSeam()` 完成握手/指纹校验后只创建 `BridgeSessionSeam`。bridge 与 TUI 仍是两个 OS 进程，不是单进程方案。
- **HTTP 宿主链已退役**：`ensureV2Host`、`RemoteHostSession`、HTTP carrier/session facade、registry/heartbeat、watchdog 与 idle-reaper 均不再参与 boot 或退出链路。`--remote` 与 remote seam 逃生门也已删除；握手失败抛 `BridgeBootstrapError`，绝不静默降级。
- **配置面不再依赖 HTTP 宿主**：`configLoad` / `configRaw` / `workspaceConfig` / `configSave` 由 seam 的本地配置面提供；preset/login 等同 profile 目录职责见 [01 系统拓扑](../architecture/01-system-topology.md)。
- **bridge 产物使用 profile 内实目录副本**：provisioner 每次把 `dist/bridge` 收敛到 `node_modules/@aiwayds/dsh-opentui-bridge`，不再用绝对路径 symlink；`bundle-fingerprint.json` 校验身份。Decision 第 2 条的 symlink 安排仅作 0.22.0 历史记录。
- **双 profile 过渡已收敛为单 profile 决策**：活动 profile 与客户端配置目录共用同一个 `DEFAULT_PROFILE`。当前代码名称仍为 `opentui-inproc`；最终改名 `opentui-monday` 由 T11 单独提交，不在本 ADR 提前完成。迁移语义见 [ADR-0014：单 profile 收敛](0014-single-profile-convergence.md)。
- 以下 Context / Decision / Consequences 保留 0.22.0 决策时的历史记录；标注为过渡期的段落不再描述当前拓扑。本文历史引用的 `ADR-0010` 均指 [Session seam lifecycle contract](0010-session-seam-lifecycle-contract.md)，与新单 profile ADR 按文件名区分。

## Context

### 事故根因链

`/resume` 流程在当前 thin-client 架构下静默丢失上下文，根因链已逐环定位：

1. `/resume` 只在客户端 stage 一个 id，不建立任何会话（历史 HTTP session facade；该 facade 已退役）。
2. 首条消息触发 `#ensureSession()`，调用 `session/create`（`:2361-2384`），把 staged id 作为 resume 意图传给宿主。
3. 宿主 `claim()` 判定 `reusable = request.reusable(id) && !events.some(e => e.type === 'turn/start')`。一旦目标会话有过任何 user turn，`events` 里必然存在 `turn/start`，该式为 false，reuse 路径不成立。
4. 宿主走 `createMinted()` 新建会话（`@deepseek-ai/dsh-api-session-controller/src/agent.ts:352-371`），返回一个全新 sessionId。
5. 客户端静默采纳新 id（`:2391-2393`），不报错、不告警。
6. 结果：模型上下文只剩 system + 当前这一条，而屏幕仍渲染旧 journal —— 模型所见与 UI 所见来自两个数据源，发生分裂。用户看到历史还在，模型却"忘了"。

### 协议面事实

宿主的 `session` 命名空间共 25 个 `@Remote`，没有任何 resume / select / open / attach。唯一能带回历史的 `session/fork` 也只返回一个新 id（复制前缀，不是恢复身份）。`docs/client-mode-protocol-audit.md:72` 把 "resume via `session/create` on stored id" 标为 FULL，与上述实现不符；本次顺带修正该行（改为 MISSING，并指向本 ADR）。

### 为什么不能沿用 ADR-0005 的两条支柱

ADR-0005 的产品路径建立在两条断言上：宿主跑在 node、TUI 跑在 bun，二者靠 Remote 协议跨进程。resume 缺口不能用"把 TUI 搬回宿主进程"或"让宿主跑 bun"来补：

- **宿主不能跑 bun**：`@deepseek-ai/dsh-app-boot/lib/index.js:2571-2576` 经 N-API addon `node-addon-require-builtin` 调 `requireBuiltin("internal/modules/esm/loader")` 等 Node 私有模块。bun 不提供这些内部模块，宿主栈在 bun 下无法启动。
- **node 后端的 OpenTUI 不 flush 帧**：`@opentui/core` 0.8.x 的 node 后端不 flush 帧（本仓 `CHANGELOG.md:564`；同树实测 bun 148KB vs node 5KB 的输出）。0.7.0 正常。插件模式当年因此把依赖冻结在 0.4.3，后被 B4 删除。

因此"单进程 + 现有渲染栈"这条路在 0.8.x 上是坏的；要么冻结渲染栈，要么换栈，代价都远超补一个 resume 通道。

### 方案对比

| 方案 | 内容 | 工作量 | 结论 |
|---|---|---|---|
| A — 只把 id 漂移显式化 | 检测 `createMinted()` 的新 id，向用户提示"已新建会话，历史未恢复" | 2–4 人日 | 治标，上下文仍然丢失，不采纳 |
| E — 1:1 + 宿主新增 resume RPC | 沿用 thin client，等上游在 `session` 命名空间加 resume/select/open | 我方 5–8 + 上游 5–15 人日 + 排期 | 周期外置，不可控，不采纳 |
| D — 自持会话桥 | 宿主进程内 cordis bundle 直连持久化层，对外 stdio JSON-lines，TUI 仍是 bun | 15–21.5 人日 | **本次采纳** |
| B — 真单进程 + 降 opentui 0.7.0 | TUI 搬进宿主，渲染栈冻结在 0.7.0 | 15–25 人日 | 渲染栈冻结，长期债务，不采纳 |
| C — 换渲染栈 | 替换为与 node 兼容的渲染栈，UI 重写 | 20–40+ 人日 | 成本最高，不采纳 |

## Decision

1. **采用方案 D**：一个独立 bridge（cordis bundle）跑在**宿主进程内**，直调 `ctx.agents.resume` / `sessionPersistence`，对外暴露 stdio JSON-lines。TUI 仍是独立的 bun 进程，用户命令仍是 `dsh-opentui`；默认 seam 从 `RemoteSessionSeam` 换成 `BridgeSessionSeam`。**注意：这是两进程方案，不是单进程** —— bridge 只是宿主内的一个 bundle，TUI 与宿主仍是两个 OS 进程。
2. **0.22.0 分发形态**：bridge 构建产物内嵌 dsh-opentui tarball（`packages/shell/package.json` 的 `files` 加 `dist/bridge`）；bin 运行时向 profile 落**绝对路径 symlink**。不使用 `link:` / `file:` 协议语义 —— pnpm 的 `file:` 是拷贝，等于制造野包副本。0.23.0 再拆成独立 npm 包。
3. **新 profile `opentui-inproc`，共享同一个 `~/.dsh`**：不得给它独立 `DSH_HOME`，否则看不到存量 sessions。bin 首启做幂等 provisioning，带跨实例互斥。护栏校验 name@version（或 integrity），不用 realpath 前缀硬绑 —— 否则 0.23.0 拆包时全员拒启。
4. **append-system 改为 bridge 内的 `systemPrompt.section`**：从"合成 agentPreset"改为 bridge 内按 scope 注册的 section（禁 global），`order: 200`。存量 `opentui-append-system` 会话在 resume 前映射为 `standard` + 一次 warning（走日志，不混入消息流），不写任何用户持久化数据。**（已过期 / superseded：该映射语义由 `a45a052` 撤销——旧 id 在 inproc 为惰性元数据、不传 `preset`，append 由 bridge section 无条件注入；防重见 [Session seam lifecycle contract](0010-session-seam-lifecycle-contract.md) 条款 A/B。原句仅作历史决策记录保留。）**
5. **发布门不可跳过**：CI 必须有 `npm pack → 全新 scratch prefix 安装 → 冷启动 → 四门禁冒烟`，required，不可 skip。

## Consequences

Positive:

- resume 变成宿主进程内的真恢复（直调 `ctx.agents.resume`），模型上下文与屏幕 journal 重新指向同一数据源，消除分裂。
- 渲染栈保持 bun + `@opentui/solid` 官方支持路径，不冻结、不重写。
- 上游排期不再是关键路径；将来上游若加 resume RPC，本方案的 IPC 契约可直接充当该 RPC 的验收规格书（见 [Session seam lifecycle contract](0010-session-seam-lifecycle-contract.md)）。

Negative / cost:

- **0.22.0 单 tarball 使 bridge 没有独立回滚单元**：bridge 与 TUI 同包发布，回滚必须整体回滚，不能单独回退 bridge。
- **`--remote` 保留为已弃用（deprecated）但可见的 flag**，0.23.0 再删除；过渡期内两套 seam 并存。**（0.22.0 历史过渡约束，现已退役；当前 `--remote` 为未知参数，remote seam 已删除，见 Update。）**
- **`dsh-base` 钉 `>=0.2.2-rc.3 <0.3.0` 兼容窗口**（单一事实来源 `packages/shell/scripts/lib/host-compat.mjs:32` 的 `HOST_PEER_RANGE`）：rc.3 是构建基线、rc.4 消费面字节一致，`<0.3.0` 上限把未来大版本撞车变成 provisioning 显式失败而非静默跳过；窗口内 provisioning 自动写入精确版本豁免（`compatibility.json`），因此无需手工改钉点，越窗才需显式 PR + 四门禁回归。
- **两个 profile 共享 `~/.dsh/sessions`**：后开者必须显式收到 `writer-held`，不能静默接管。**（0.22.0 历史状态；现已收敛为单 profile，writer lock 语义不变，见 [ADR-0014：单 profile 收敛](0014-single-profile-convergence.md)。）**
- 新增一个 profile 与一套 provisioning / 互斥逻辑，首启路径复杂度上升。

### 0.22.0 过渡期双宿主（历史记录，已退役）

> 以下保留 0.22.0 的已知债务与退出计划，不代表当前拓扑。T12 已删除 HTTP 宿主及其客户端链；当前唯一宿主与 config 面归属见本文 Update。

0.22.0 的默认 inproc 启动路径实际上同时拉起**两个 node 宿主进程**（`packages/tui-base/examples/v2-entry.tsx:1439-1494`），与上文"bridge 跑在宿主进程内"的单宿主叙事并不完全一致——后者描述的是会话桥的归属，不代表全链路只有一个 node 宿主：

- **HTTP 宿主**（`lifecycle.legacy host bootstrap` + `legacy HTTP facade`）承担 **config 面**：`configSave`、主题 / skin 迁移持久化（`v2-entry.tsx:1589`）、profile 与 workspace overlay 读取。`BridgeSessionSeam` 没有 config frame，其 `configLoad` / `configRaw` / `workspaceConfig` 只能降级返回 `{}`（`packages/shell/src/client/bridge-session-seam.ts:627-656`），所以 config 面仍由 HTTP 宿主负责。
- **bridge 宿主**（`createBridgeSessionSeam` 的 stdio transport）承担 **会话面**：`session.open` / `send` / `close` / `list`、`turn.abort`、ask 应答、`journal.replay` 与 append section。

代价：两份 node 宿主并存，常驻内存与冷启动时间约为单宿主时的两倍；profile 配置 / overlay 在两侧各有一份视图，存在失步风险。此前没有任何 ADR 或 ticket 记录这一现状，此处补记为 0.22.0 的**已知过渡债务，不是方案 D 的设计目标**。

移除计划：0.23.0 把 config 面（`configLoad` / `configRaw` / `workspaceConfig` / `configSave`）迁入 bridge 或下沉到本地文件后，删除 `legacy host bootstrap` / `legacy HTTP facade` 这条 config 通路，只保留 bridge 一个 node 宿主。本条只记录现状与退出计划，不据此改动 0.22.0 代码。**Update：该退出计划已由 T12 完成；当前状态见本文 Update。**

不可逆点 / 发布后约束：

- 一旦 0.22.0 发布，`opentui-inproc` profile 名与 `dist/bridge` 内嵌布局成为分发契约；0.23.0 拆包必须保持 name@version 护栏兼容，否则存量 profile 全部拒启。
- `systemPrompt.section` 的 scope 注册与 `order: 200` 一旦落地，成为与 tui-pi 共装时的 tie-break 前提，需由握手测试永久钉死（见 [Session seam lifecycle contract](0010-session-seam-lifecycle-contract.md)）。

## opencode 反例（单列）

opencode 常被当作"单进程解决 Node↔Bun"的例证，实际不是。它是**单 OS 进程、双线程**：TUI 主线程 + Bun Worker 内的 server，走一个假 baseUrl `http://opencode.internal` + 自定义 fetch 直调 `app.fetch`，默认不监听任何端口。它的 TUI 同样是 `@opentui/solid` + bun，Worker 与主线程同为 bun —— **它从未解决 Node↔Bun 同进程问题，只是绕开了它**（server 侧根本不是 node）。

可借鉴的是它的**边界设计**，不是它的形态：

- API 面与传输解耦（假 baseUrl + 自定义 fetch，调用方不关心真实传输）；
- 会话归服务端持久化层持有，UI 只持 sessionId 与只读投影；
- 单 session 单 runner（与 [Session seam lifecycle contract](0010-session-seam-lifecycle-contract.md) 的不变量一致）。

本方案不追求 opencode 的单进程形态（宿主是 node、TUI 是 bun 这一约束无法消除），只复用上述边界原则。

## Supersedes

ADR-0005（thin client 作为唯一产品路径）。本 ADR 不否定 Remote 协议与 web/phone 客户端的价值，只取消"TUI 必须走 thin client"的唯一性：TUI 改为默认走宿主内 bridge（方案 D），`--remote` 作为已弃用路径保留到 0.23.0。**（末句为 0.22.0 历史过渡安排；`--remote` 与 remote seam 现已删除，见 Update。）**

## Open questions

> 以下为 0.22.0 定稿前的历史问题；preset 迁移语义已由 [Session seam lifecycle contract](0010-session-seam-lifecycle-contract.md) 的「preset 迁移语义」落地，不再作为当前阻塞项。

- T/W 分支实测待定：宿主 `session/open` 遇未知 preset id 是容忍还是抛错，决定"合成 preset 声明清理"在 0.22.0 还是推迟到 0.23.0（见 tickets/2026-11-18-inproc-bridge-plan.md 前置实测项）。该结论在 0.22.0 落地前定稿。
