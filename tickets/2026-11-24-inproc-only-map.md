# 地图：去掉 HTTP 宿主，只留一个桥 profile（`opentui-monday`）

- 日期：2026-11-24
- 工作区：`/Users/qingguee/repo/dsh-opentui-wt-inproc-only`（分支 `research/inproc-only-1124`，基线 `153c8ce`）
- 性质：决策地图（wayfinder）。本文件是索引；每条决策的细节在子票与其引用的调研报告里。
- **评审**：[oldfox 一轮](2026-11-24-inproc-only-review-oldfox.md)（GO-WITH-CONDITIONS，P0-1…5）、[oldfox 二轮](2026-11-24-inproc-only-review-oldfox-2.md)（06/07 均 GO-WITH-CONDITIONS，P0-1…12）。**二轮 P0 未解前不开工**；其中两项需用户拍板：`/login` 自定义 provider 路由去留、inproc 源（`opentui-inproc`）的 `permission.defaultPreset`/`maxDepth` 是否迁。

## Destination

一份可以照做开工的迁移方案：**删掉 `opentui`（HTTP 宿主）profile 与整条 HTTP boot 通路，桥宿主 profile 收敛为唯一的一个（名 `opentui-monday`）**；用户配置、遗留插件、真机门禁都有明确归处，可作为一个 minor 版本发布。

## Notes

- 仓库约定：调研落 `research/`，决策落 `tickets/`。
- 事实源（2026-11-24，全部带 `文件:行`）：
  - [01 供给/分发面](../research/2026-11-24-inproc-only/01-provisioning.md)
  - [02 HTTP 宿主残责](../research/2026-11-24-inproc-only/02-http-host-residual.md)
  - [03 引用与门禁影响](../research/2026-11-24-inproc-only/03-references-and-gates.md)
  - [04 dsh 上游 app/web profile 设计](../research/2026-11-24-inproc-only/04-dsh-app-web-profiles.md)
  - [05 遗留插件功能对等](../research/2026-11-24-inproc-only/05-companion-parity.md)
- 四条硬约束（先记住，几乎所有决策都受它约束）：
  1. inproc provisioner **每轮整体重写**自己的 `cordis.patch.yml`（`packages/shell/scripts/provision-inproc-profile.mjs:1275-1322`）——用户配置不能直接写进该文件。
  2. 客户端本地配置面（settings/config/presets/login）**当前以 `DEFAULT_PROFILE='opentui'` 为目录**（`packages/shell/src/client/bridge-session-seam.ts:2273`、`local-config-faces.ts:231-232,333,498-499,608-609`）。
  3. `dsh` **不会**自动重建非模板 profile 目录（`dsh-app-boot/src/profile.ts:733-741`）；但本仓代码会（`remote-host-session.ts` 的 `mkdirSync`、bin step 6a 预启）。
  4. 上游没有「app profile」，只有 5 个模板 `acp/web/headless/sdk/sdk-minimal`；controller 是普通插件行，in-process carrier 是官方替代 HTTP 的形态（`dsh-sdk-app/cordis.patch.yml:56-60`、`dsh-client-connection/README.md:34,49`）。

## 结论摘要（调研已确认的事实，不是待决项）

- 会话/命令面已全部走 `BridgeSessionSeam`，**没有任何 `/` 命令因删 HTTP 宿主而直接缺**（02 §3）。
- HTTP 宿主残留职责只剩四件：boot 链本身、skin migration 的一次写、theme/themeMode/motion 的启动读、退出处置——且后两者实际是**本地文件 I/O**，不是 HTTP RPC（02 §2）。
- 默认 CI 与 pack-cold-start 门禁只用 `opentui-inproc`，**在「只删不改名」的前提下**不会红；一旦改名，`ci.yml:237,317-320` 与 `scripts/verify-bridge-handshake.mjs:31` 立刻失效（oldfox P0-5）。
- 老 profile 在本机是 52M / 20 bundles（含 `dsh-web-app` + 18 个 `@aiwayds/*`）；inproc 是 2.3M / 3 bundles + 1 companion（03 §5）。
- **写面是最大未知**：`/settings` 写走宿主 config-editor 对整份 patch `parseDocument → String` 重写，且编辑的是托管行，不是用户段（oldfox P0-1/P0-2；`dsh-config-editor/src/index.ts:110-141,124-130`）。

## Decisions so far

- **profile 名定为 `opentui-monday`**（用户改定，取代先前「保留 `opentui`」）：`opentui` 与 `opentui-inproc` 两个旧名退役；配置从 `profiles/opentui` 迁入；回退旧版安全（互不覆写）（[D1](2026-11-24-inproc-D1-config-home.md)）。
- **配置落 patch 用户段**（tui-pi 同形态）：provisioner 改为托管段/用户段；顺手修「只保留 3 个字段」缺陷（[D1](2026-11-24-inproc-D1-config-home.md)）。
- **一个版本内按序做完**，不留半态（[D3](2026-11-24-inproc-D3-teardown.md)）。
- **真机门禁改用仓库内固定 fixture**，不读用户 `~/.dsh`（[D5](2026-11-24-inproc-D5-gates-and-legacy-dir.md)）。
- **插件保留 10、放弃 1**：8 个 opt-in 全部升为默认装 + 新增 `topics-memory`/`cron`；放弃 `workflow`（[D2](2026-11-24-inproc-D2-companion-parity.md)）。由此引出两个必做项：ask 槽仲裁、审批双层确认。
- **模型表 4 项漂移不补**，以 inproc 模板现状为准（发布说明需提示选择器少 4 项）（[D2](2026-11-24-inproc-D2-companion-parity.md)）。
- **`upgrade` 子命令退役**：插件升级改为启动时按 provision 自动跟随、不降级（[D4](2026-11-24-inproc-D4-upgrade-command.md)）。
- **架构取向：每客户端一个宿主，没有共享 server**；不新建 registry/heartbeat/reap；同会话并发写由内核 flock 仲裁（[D3](2026-11-24-inproc-D3-teardown.md)）。
- **`--force` = 杀本机所有 dsh-opentui 进程（任意 cwd/HOME），绝不碰 `tui`/`web`/`headless` 等其他 profile**；按 argv 精确 token + argv[0] 校验，SIGTERM→SIGKILL（[D3](2026-11-24-inproc-D3-teardown.md)）。
- **`approval-policy` 保留 60s 自动拒绝行为，窗口改 300s**；`windowSeconds` 进用户段保留清单（[D2](2026-11-24-inproc-D2-companion-parity.md)）。
- **`opentui-monday` 定稿为长期名**（[D1](2026-11-24-inproc-D1-config-home.md)）。

## 前沿状态

决策层已收口，但 **oldfox 评审判 GO-WITH-CONDITIONS**：P0-1…P0-5 必须先补设计（见评审记录），其中两条改动实施顺序：

- **改名必须是最后一个提交**（否则中途门禁全红），且与 kill 路径退役原子提交（否则 `--profile opentui` 的 bridge 子进程会被当成可杀宿主）。
- **门禁（原 D5）要提到「删 boot 链」之前**。

## Open tickets（前沿）

| 票 | 问题 | 状态 |
|---|---|---|
| [D1 用户配置放哪](2026-11-24-inproc-D1-config-home.md) | 落点已定；**分段协议按票面实现无效**，需按 P0-1/P0-2 重写设计 | 退回设计 |
| [D2 遗留插件怎么办](2026-11-24-inproc-D2-companion-parity.md) | 已定保留 10；需补 approval-policy 60s 自动 reject 的处理与 catalog `reason` 改写 | 有条件 |
| [D3 HTTP 通路拆除](2026-11-24-inproc-D3-teardown.md) | 已定单版本；顺序需按评审调整，`--force`/多客户端仍未决议 | 有条件 |
| [D4 `upgrade` 子命令](2026-11-24-inproc-D4-upgrade-command.md) | 已定退役 | 已决 |
| [D5 门禁与老目录](2026-11-24-inproc-D5-gates-and-legacy-dir.md) | fixture 方案需改为「跑真 provisioner 到 scratch HOME」；改名清扫面补全 | 退回设计 |
| [D6 迁移设计](2026-11-24-inproc-D6-migration.md) | 不能整段搬老 patch（P0-4），需显式转换白名单 + 依赖剪枝 | 退回设计 |
| [D7 pnpm workspace 契约](2026-11-24-inproc-D7-workspace-contract.md) | 全新机器缺 `initProfile` 的 workspace 契约，装 companion 会撞 step 5 硬 guard（P0-3） | 设计已完成，待按二轮 P0-9…12 修订 |
| [D8 `/login` 三入口](2026-11-24-inproc-D8-login-modes.md) | account / 第三方 provider / 自定义 provider 三种登录入口与各自面板、凭据落点（用户新增需求） | 调研中（08-login-modes） |

## 未定（fog）

- `--force` 语义与 inproc 跨客户端写锁归属（SIGKILL 后谁清锁）；oldfox 要求先有一页 ADR，哪怕结论是「只支持单客户端」。
- `approval-policy` 默认装的 60s 自动 reject（`origins: ['subagent','scheduled']`）要不要保留默认。
- 是否要在 inproc 挂 `settings-controller`（04 推荐路径）——与 P0-2 的写权方案绑定。
- bridge 已有降级面（`renameSession` / `steer` / `listProviders` / `permission` catalog）要不要顺手补——**不是本次负债**。

## Out of scope

- 改成单进程（Node↔Bun 硬桩：宿主不能跑 bun、OpenTUI 0.8.x node 端不 flush）。
- `tui` profile / dsh-tui-pi 那一栈。
- 历史记录改写（`CHANGELOG.md`、旧 `tickets/*`、`research/*` 保留原文）。
