# 01 系统拓扑（stdio bridge 单宿主）

> 出处约定见 [README.md](README.md)。本文讲结构；启动/发版步骤见 `docs/workflows/w6-release.md`。

## 1.1 进程模型：三段启动链，一个会话宿主

当前生产链有三个 OS 进程角色，但**只有一个会话宿主**：

1. **node launcher** — `packages/shell/bin/dsh-opentui.mjs`
   - 解析 launcher 参数，检查 `bun` 与 `dsh`，运行 profile provisioning。
   - inproc profile provisioning 是启动硬前置；失败即退出，不带病启动 TUI。
   - launcher 不预启 HTTP host，也不持有 host registry。
2. **bun TUI** — `packages/shell/src/client-entry.tsx`
   - `main()` 构造 `StdioBridgeTransport` 并无条件注入 `bootClientV2()`。
   - 渲染栈保持 bun + `@opentui/solid`；客户端不持有 transcript 真源。
3. **node bridge 宿主** — `dsh --profile opentui-monday`
   - 由 bun TUI 侧的 `StdioBridgeTransport` spawn，设置 `DSH_HOME` 与 `DSH_OPENTUI_BRIDGE_STDIO=1`，三路 stdio 全部走 pipe。
   - 宿主加载 `@aiwayds/dsh-opentui-bridge` cordis bundle；bridge 的 `inject` 为 `['agents', 'typert']`。
   - 这是唯一会话宿主。每客户端一个 child，不共享 server，不启动常驻 HTTP host，也不监听会话端口。

当前 profile 名为 **`opentui-monday`**，唯一事实源是 `packages/shell/scripts/lib/profile-name.mjs` 的 `DEFAULT_PROFILE`；旧的 `opentui` / `opentui-inproc` 目录只作为迁移源与回退材料保留。

启动链：

```text
dsh-opentui (node launcher)
  └─ profile provisioning
      └─ bun client bundle
          └─ client-entry.main()
              └─ StdioBridgeTransport
                  └─ spawn dsh --profile <DEFAULT_PROFILE>
                      └─ dsh-opentui-bridge (cordis bundle)
                          └─ bridge.hello / 指纹校验
                              └─ BridgeSessionSeam
                                  └─ V2 视图
```

launcher 以前台进程组方式 spawn bun，不设 `detached`；它转发 SIGINT/SIGTERM/SIGHUP，等待 bun 退出后把信号死亡映射为 `128 + signum`，否则透传客户端退出码。bridge child 的生命周期由 transport 持有，不再由独立 watchdog 或 idle-reaper 管理。

## 1.2 两根硬桩（不可消解的约束）

- **宿主不能跑 bun**：宿主依赖 Node 私有 ESM loader 等内部模块，bun 不提供；硬桩的历史实测与推理保留在 [ADR-0009](../adr/0009-inprocess-session-bridge.md) Context。
- **node 后端 OpenTUI 0.8.x 不 flush 帧**：同树 bun 与 node 输出量差异已有历史实测；0.7.0 正常。该约束同样记录在 ADR-0009，不作为本文重复展开的现状手册。

结论：真单进程 + 现有渲染栈在 0.8.x 是坏的。当前方案保留 node 宿主与 bun TUI 两个运行时，只把会话通道收敛为 stdio bridge。opencode 的单 OS 进程、双 bun 线程形态没有消除 Node↔Bun 约束。

分发护栏仍是 `packages/shell/scripts/lib/host-compat.mjs` 的 `HOST_PEER_RANGE`。provisioner 在启动前校验宿主版本，窗口内写 profile 级 `compatibility.json` 精确豁免；越窗显式失败，不静默跳过 bridge。

## 1.3 生产 boot 合成根

合成根是 `packages/tui-base/examples/v2-entry.tsx` 的 `bootClientV2()`。`client-entry.tsx` 用计算式动态 import 引入它，使 vendored view 不进入 shell 的 tsc program；根目录 `scripts/build-client.mjs` 在构建期把计算说明符重写为字面量，并扫描 bundle，发现泄漏的计算式动态 import 就失败。

boot 结构不变量：

```text
StdioBridgeTransport
  → bridge.hello + fingerprint verification
  → BridgeSessionSeam
  → V2SessionPage
```

`packages/shell/src/client/seam-bootstrap.ts` 的 `createBridgeSessionSeam()` 先发 `bridge.hello`，校验 protocolVersion / bridgeVersion / hostVersion 与指纹，再构造 seam。失败抛 `BridgeBootstrapError`；没有 remote seam fallback，也没有 env escape hatch。生产入口若未注入 transport，同样直接失败。

Provider 嵌套由外到内保持：

```text
ClipboardHost
  → FocusRouterProvider（内部嵌 InputOwnershipProvider）
    → DialogProvider
      → ErrorBoundaryDiagnostics
        → PanelKitHost
          → V2SessionPage
```

结构依据在 `packages/tui-base/examples/v2-entry.tsx` 与 `packages/tui-base/src/context/focus-router.tsx`；键盘所有权契约见 [ADR-0008](../adr/0008-input-ownership-for-keyboard-routing.md)。

## 1.4 HTTP host 客户端层已退役

以下内容不再参与 boot、会话或退出链路：

- `ensureV2Host` 与 HTTP host bootstrap；
- `RemoteHostSession`、HTTP carrier / session facade；
- registry / heartbeat / watchdog / idle-reaper；
- `RemoteSessionSeam` 与 `DSH_OPENTUI_INPROC` 逃生门；
- `--remote` flag（现在按未知参数处理）。

当前职责划分：

- **会话面**归 bridge：`session.open` / `send` / `close` / `list`、`turn.abort`、ask 应答、`journal.replay` 与 append section。
- **config 面**归 seam 本地配置面：`configLoad` / `configRaw` / `workspaceConfig` / `configSave` 由 `LocalConfigStore` 提供；settings 优先走宿主官方 settings 通路，本地文件模式只作为可观测降级，不伪造宿主写入成功。
- **preset / login 面**使用与宿主相同的 profile 目录；transport 暴露实际 `--profile`，seam 在写入前比对目录，不一致即拒绝。
- **退出面**只关闭 seam 与 transport；transport 负责结束自己的 bridge child。

## 1.5 Profile 目录职责

活动目录是 `$DSH_HOME/profiles/opentui-monday`。host 与 client 必须共用它；旧 `opentui` 目录不是第二宿主，可以作为迁移源或回退材料存在，但不会自动被删除或改名。

| 路径 / 文件 | 职责 | 主要消费者 / 写者 |
|---|---|---|
| `package.json` | bundle manifest；基础项为 `@deepseek-ai/dsh-base` 与 `@aiwayds/dsh-opentui-bridge`，加已声明 companion | provisioner；宿主启动时读取 |
| `cordis.patch.yml` | inproc 组合模板、用户设置与 provider 路由 | 启动期 `converge()` 写托管段并保留用户区；运行期宿主 settings 写用户值 |
| `.patch-ownership.json` | 上一轮采用的模板投影，用于三方 carry / drift 判定 | provisioner，与 manifest/patch 同锁写入 |
| `config.json` | profile 级客户端偏好、workspace overlay 的落点 | `LocalConfigStore`；skin migration 也写这里 |
| `keybindings.json` | profile 级快捷键覆盖文件；旧版文件在迁移时保留 | 客户端配置层；TUI hotkeys 面板声明该覆盖位置 |
| `provider-keys.json` | owner-only 本地 key store；旧文件迁移时只备份，不直接激活 | `LocalLoginFace`；迁移备份在 `.migrated-from/` |
| `presets` | preset 声明在 patch 的 insert 块，暂存 id 在 `config.json` | `LocalPresetFace` 与宿主组合 |
| `node_modules/@aiwayds/dsh-opentui-bridge/` | 当前安装的 bridge 实目录副本，避免 symlink 绑定某个 worktree | provisioner 每次收敛；`bundle-fingerprint.json` 校验身份 |
| `compatibility.json` | 宿主精确版本豁免 | provisioner 与握手校验 |
| `.migration.json` | 一次性迁移完成标记 | provisioner 最后写入；存在即不读旧 profile |
| `.migrated-from/` | converge 前的旧 patch / provider-key 快照 | provisioner pre-backup |
| `.provision.lock` | 整轮 provisioning 互斥 | provisioner |
| `package.json.lock` | 与宿主 plugin manager 互斥的 profile 写锁 | provisioner 与宿主 |

home 级 sessions 与凭据不属于某个 profile，不随 profile 复制；单 profile 收敛不改变 `/resume` 历史与 writer lock 语义。迁移的详细顺序和白名单见 [ADR-0014：单 profile 收敛](../adr/0014-single-profile-convergence.md)。

## 1.6 Exit code 契约

| 退出码 | 语义 | 出处 |
|---|---|---|
| 0 | 干净退出：`/quit` 或 idle Ctrl+C 打开 quit-confirm，确认后退出 | `e2e/families/40-exit-code.sh`；`packages/tui-base/examples/v2-entry.tsx` |
| 128+N | launcher 把被信号杀掉的 bun 子进程透传为 `128 + signum`（SIGINT→130、SIGTERM→143） | `packages/shell/bin/dsh-opentui.mjs`；`e2e/families/40-exit-code.sh` |
| 1 | launcher 前置检查 / provisioning 失败，或 client boot / render 失败 | `packages/shell/bin/dsh-opentui.mjs`；`packages/shell/src/client-entry.tsx`；`packages/tui-base/examples/v2-entry.tsx` |
| 2 | 参数错误，或视图 ErrorBoundary 崩溃 | `packages/shell/bin/dsh-opentui.mjs`；`packages/tui-base/examples/v2-entry.tsx` |

renderer 使用 `exitOnCtrlC:false`，Ctrl+C 由 `TurnCancelKeys` 与 quit-confirm 接管。单 writer lock（`SESSION_LOCKED` → UI `writer-held`）与 DEAD 恢复态仍属 bridge 会话态，见 [03 handshake / lifecycle](03-handshake-lifecycle.md) 与 [Session seam lifecycle contract](../adr/0010-session-seam-lifecycle-contract.md)。

## 维护责任

进程角色、启动顺序、唯一宿主、profile 目录职责、provider 嵌套、合成根重写或退出码映射发生变化时，必须更新本文档。引用优先使用文件路径与符号名，不绑定会随编辑漂移的行号。
