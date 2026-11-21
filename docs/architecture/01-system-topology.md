# 01 系统拓扑（两进程三段 + 硬桩 + boot 合成根）

> 出处约定见 [README.md](README.md)。本文讲结构；启动/发版步骤见 `docs/workflows/w6-release.md`。

## 1.1 进程模型：两进程、三段、一债

0.24 的**会话主链**是 bun TUI 进程 + node 宿主进程两进程，中间以 stdio JSON-lines 连接；宿主内跑我方 bridge cordis bundle，`ctx` 直调宿主服务（`docs/adr/0009-inprocess-session-bridge.md:44`，`dsh-opentui-redesign-proposal.md:7,93`）。从用户命令到宿主共三段：

1. **段 1 — node launcher**：`packages/shell/bin/dsh-opentui.mjs`（npm `bin` 入口，`packages/shell/package.json:11-12`）。spawn bun 客户端并把 SIGINT/SIGTERM/SIGHUP 转发给子进程（`bin:534,550-552`）；子进程退出后若带信号，以 `128 + signum` 派生退出码，否则透传 client rc（`bin:557-560`）。128+N 的权威单测断言在 `packages/shell/test/bin-launcher.test.ts:808`（`e2e/families/40-exit-code.sh:4-11`）。
2. **段 2 — bun TUI 进程**：`packages/shell/src/client-entry.tsx:440-459` 计算 v2-entry 说明符并注入 `new StdioBridgeTransport()`，进入生产 boot 合成根 `packages/tui-base/examples/v2-entry.tsx`。渲染栈 `@opentui/solid` + bun（硬桩②所保）。
3. **段 3 — 宿主 node 进程**：`dsh --profile opentui-inproc`，由 bun TUI 侧的 `bridge-transport.ts:183-190` 以 `DSH_OPENTUI_BRIDGE_STDIO=1` spawn；宿主加载我方 bridge（作为 cordis 插件），bridge 的 `inject: ['agents', ...HANDSHAKE_INJECT]` 即 `['agents','typert']`（`packages/bridge/src/index.ts:568`，`handshake.ts:33`）。

**一债 — detached HTTP config 宿主**：0.22.0 起生产启动路径同时拉起第二个 node 宿主（HTTP 宿主），由 `lifecycle.ensureV2Host`（`v2-entry.tsx:1561`）承担 config 面（`configSave`、主题/skin 持久化、profile/workspace overlay 读取）；bridge 侧无 config frame，其 `configLoad`/`configRaw`/`workspaceConfig` 只能降级（ADR-0009 `:68-75`）。这是**已知过渡债务，非方案 D 的设计目标**：常驻内存/冷启约两倍，配置双视图存在失步风险；退出计划是把 config 面迁入 bridge 或下沉本地文件后删除该通路（ADR-0009 `:75`）。该债使 `removal` 之后的终态才是「stdio 无端口治理」（v3 `:94`）。

## 1.2 两根硬桩（不可消解的约束）

- **宿主不能跑 bun**：`@deepseek-ai/dsh-app-boot/lib/index.js:2571-2576` 经 N-API addon `node-addon-require-builtin` 调 `requireBuiltin("internal/modules/esm/loader")` 等 Node 私有模块；bun 不提供，宿主栈在 bun 下无法启动（`docs/adr/0009-inprocess-session-bridge.md:27`）。
- **node 后端 OpenTUI 0.8.x 不 flush 帧**：本仓 `CHANGELOG.md:968` 记载（「0.8.1/0.8.2 never do — discriminator: same tree bun 148KB vs node 5KB」；ADR-0009 `:28` 原引 `:564`，该行随 CHANGELOG 演进已空白，故按现文定位）。0.7.0 正常，插件模式曾为此把依赖冻结在 0.4.3。

结论：真单进程 + 现有渲染栈在 0.8.x 是坏的；要么冻结渲染栈要么换栈，代价远超补一条 resume 通道（ADR-0009 `:30`）。opencode 常被当作反例，但它是单 OS 进程双 bun 线程、server 侧非 node，从未解决 Node↔Bun 同进程问题（ADR-0009 `:84-92`）。

分发护栏：`dsh-base` 钉 `>=0.2.2-rc.3 <0.3.0`（单一事实源 `packages/shell/scripts/lib/host-compat.mjs:32` 的 `HOST_PEER_RANGE`），窗口内 provisioning 写精确版本豁免，越窗显式失败而非静默跳过（ADR-0009 `:62`）。

## 1.3 生产 boot 合成根（v2-entry，构建期重写）

合成根 = `packages/tui-base/examples/v2-entry.tsx` 的 `bootClientV2()`（`v2-entry.tsx:1541-1649`）。源码中 v2-entry 由 client-entry 的**计算式动态 import** 引入（对 tsc 不透明，`client-entry.tsx:440-441`）；`scripts/build-client.mjs:18-22,60-61,100-107` 在构建期用 `onLoad` rewrite 把计算说明符钉成字面量 `"../../tui-base/examples/v2-entry.tsx"`，并同样重写 v2-entry `loadShell()` 的 5 个 shell computed import（`build-client.mjs:62-63,110-120`）、lifecycle 的 cookie-mint import（`:64-67,133-141`）与 spin-attention 的 jev-core import（`:68-73,155-163`）。源文件保持 tsc 不透明形态，直跑路径不变。

boot 顺序（结构不变量）：

```
ensureV2Host → ClientConnection → RemoteHostSession → BridgeSessionSeam → 视图
```

出处：`v2-entry.tsx:1536-1540`（注释即顺序）、`:1552-1605`（实现）、`:1625`（seam 创建）。

Provider 嵌套（由外到内，结构固定）：`... → ClipboardHost → FocusRouterProvider → DialogProvider → ErrorBoundaryDiagnostics → PanelKitHost → V2SessionPage`（`v2-entry.tsx:1863-1879`）。`FocusRouterProvider` 内部再嵌 `InputOwnershipProvider`（`packages/tui-base/src/context/focus-router.tsx:158-164`）；panel-kit 以结构桥接方式接入保持零 tui-base 依赖（`ADR-0008:172-178`）。

**S6 不变量**：`BridgeSessionSeam` 是唯一 session seam；legacy seam 与 env escape hatch 已删除（`v2-entry.tsx:1616-1624`，`packages/shell/src/client/seam-bootstrap.ts:4-6`）。bridge 握手/指纹失败抛 `BridgeBootstrapError`（三要素），**绝不静默降级到 remote seam**（`seam-bootstrap.ts:72-76,123-125`，`v2-entry.tsx:1617-1623`）。

## 1.4 host 客户端层与 seam 选择正交（保留面定性）

`ClientConnection`（`packages/shell/src/client/transport.ts`）与 `RemoteHostSession`（`packages/shell/src/client/remote-host-session.ts`）构成 **host 客户端层**：负责 label/config/lifecycle（`v2-entry.tsx:1536-1538`）。它与「session seam 选谁」正交——seam 是 `BridgeSessionSeam`（会话面），客户端层是 HTTP 宿主的连接/生命周期面，二者在 boot 中各占一条线（`v2-entry.tsx:1587-1625`）。定性：

- **会话面**归 bridge：`session.open`/`send`/`close`/`list`、`turn.abort`、ask 应答、`journal.replay` 与 append section（ADR-0009 `:71`）。
- **config 面**暂归 HTTP 宿主：`configLoad`/`configRaw`/`workspaceConfig`/`configSave`（ADR-0009 `:70`、`:75`）。
- 保留 `RemoteHostSession` 不是设计目标而是债；0.23.0 计划删除该通路（ADR-0009 `:75`），0.24 仍在役。

## 1.5 exit code 契约

| 退出码 | 语义 | 出处 |
|---|---|---|
| 0 | 干净退出：`/quit` 或 idle Ctrl+C 打开 quit-confirm 对话框，Enter 确认 → exit 0，无残留 client 进程 | `e2e/families/40-exit-code.sh:34-72`；renderer `exitOnCtrlC:false` 由 `TurnCancelKeys` 接管（`v2-entry.tsx:1924-1928`） |
| 128+N | launcher 把被信号杀掉的子进程透传为 `128 + signum`（SIGINT→130、SIGTERM→143） | `packages/shell/bin/dsh-opentui.mjs:557-560`；`40-exit-code.sh:4-11,23-32` |
| 1 | boot / render 失败（断言异常、main catch） | `v2-entry.tsx:1931-1934,1972-1977`；`client-entry.tsx:465` |
| 2 | 视图崩溃（ErrorBoundary fallback）；另 dsh 0.18.4+ 对未知 flag 退出 2 | `v2-entry.tsx:1957-1964`；`docs/adr/0009-server-lifecycle-singleton.md:26-28` |

单 writer lock（`SESSION_LOCKED` → UI `writer-held`）与 DEAD 恢复态属 bridge 会话态，见 [03-handshake-lifecycle.md](03-handshake-lifecycle.md) 与 `ADR-0010`。

## 维护责任

进程数、启动顺序、provider 嵌套、合成根重写或退出码映射发生任何变化时必须更新本文档；host 客户端层/bridge 归属重新划分时同步更新 README 拓扑图。
