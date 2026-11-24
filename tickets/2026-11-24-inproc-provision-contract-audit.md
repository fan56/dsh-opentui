# 2026-11-24 inproc provision 三契约只读审计

范围：工作树 `feat/inproc-only-1124`；未运行真安装、未改代码。证据均来自当前工作树与纯函数调用。

## 结论

| 契约 | 判定 | 事实 |
|---|---|---|
| 默认 companion 清单 | **不符** | 默认纯函数只选中 `@aiwayds/dsh-subagent-registry`；D2 保留的 10 项全部未默认安装，其中 `topics-memory`、`cron` 连 catalog 都没有。 |
| patch sidecar 字段 | **符合**（就 `templateRevision`/N1 契约） | `templateRevision` 由 provisioner 传入、projection 生成、writer 落盘；缺失/过期 sidecar 在 no-write 轮次会补写。另有 06 JSON 样例与实现的 authority 字段位置差异，见下。 |
| `--repair-bridge` | **不符**（相对 D5/D7） | launcher 会杀 stale 进程并调用 provisioner；provisioner 的 `repair` 参数本身只打日志，bridge copy 无 flag 也无条件收敛。D7 的 workspace 修复链完全未实现。 |

## D2 10 项 vs 当前默认清单

D2 决议：`tickets/2026-11-24-inproc-D2-companion-parity.md:37-44`。选择逻辑：`packages/shell/scripts/lib/inproc-companions.mjs:35-99,116-124`；fresh manifest：`packages/shell/scripts/provision-inproc-profile.mjs:800-816,903-905`。

| D2 项 / 包 ID | 当前 catalog | `defaultOn` | 默认选中 |
|---|---:|---:|---:|
| `ask-router` / `@aiwayds/dsh-ask-router` | 有 | false | 否 |
| `approval-policy` / `@aiwayds/dsh-approval-policy` | 有 | false | 否 |
| `llm-net-retry` / `@aiwayds/dsh-llm-net-retry` | 有 | false | 否 |
| `model-sync` / `@aiwayds/dsh-model-sync` | 有 | false | 否 |
| `llm-stats` / `@aiwayds/dsh-llm-stats` | 有 | false | 否 |
| `mcp-adapter` / `@aiwayds/dsh-mcp-adapter` | 有 | false | 否 |
| `vault` / `@aiwayds/dsh-vault` | 有 | false | 否 |
| `web-search` / `@aiwayds/dsh-web-search-anysearch` | 有 | false | 否 |
| `topics-memory` / `@aiwayds/dsh-topics-memory` | **无** | — | 否 |
| `cron` / `@aiwayds/dsh-cron` | **无** | — | 否 |
| 既有默认 `subagent-registry` / `@aiwayds/dsh-subagent-registry` | 有 | true | **是** |

纯函数验证：`selectCompanions({})` 返回上述唯一 registry ID。默认选择数 **1**；D2 十项减当前集合 = **10**；当前集合减 D2 十项 = **registry**。若按 D2“10 + 本来默认的 registry”合并目标，应为 **11**，当前缺 **10**。实际落盘还受 `dsh` PATH、registry/version guard 与安装结果影响；未跑安装，真实安装成功数**未证实**。

## sidecar 实际字段

Writer：`packages/shell/scripts/lib/patch-ownership-state.mjs:32-38`；projection：`packages/shell/scripts/lib/patch-ownership.mjs:350-381`；provisioner 接线：`packages/shell/scripts/provision-inproc-profile.mjs:659,1236-1241,1262-1265,1292`。

| 层级 | 实际字段 | 含义 |
|---|---|---|
| top-level | `version` | 固定 `1` |
| top-level | `templateRevision` | 16 位模板 SHA-256；**存在** |
| top-level | `rows` | managed row 投影 |
| top-level | `writtenAt` | writer 追加的 ISO 时间 |
| 每 row | `role`、`disabled`、`ancestor` | 角色、独立 carry 开关、基线 |
| `ancestor` | carry: `config`；providers: `providers`/`restSha256`；authority: `ancestorSha256` | 按角色不同 |

缺失字段：**无 `templateRevision` 缺失**。N1 已在 `patch-ownership.mjs:967-973,1327-1333` 实现：patch 不需写但 sidecar 缺失/损坏/过期时，`writeSidecarOnly=true` 并重写 projection；纯函数调用已验证。T11 改名只改 `profile-name.mjs`，不改变模板哈希；新 profile 路径无 patch 时走 absent 全量重建（`:895-924`）。旧目录/sidecar 的迁移不在当前 provisioner，**未证实**。06 样例把 authority 的 `ancestorSha256` 画在 row 顶层（设计稿 `:437`），实现在 `row.ancestor` 内；这是文档样例差异。

## repair flag 代码路径

- **不带 flag**：launcher 每次启动调用 provisioner（`packages/shell/bin/dsh-opentui.mjs:315-332`）→ `repair=false` → `runProvision()`（`provision-inproc-profile.mjs:1376`）→ bridge copy 在 `:1420-1435` 无条件检查/替换 → identity guard `:1470`。
- **带 flag**：launcher 先杀 stale 实例，再以 `--repair` 调 provisioner 并退出（`bin/dsh-opentui.mjs:222-243`）→ `repair=true` → `:1379` 仅打印 no-op 提示 → 后续 bridge copy/identity 路径与无 flag 相同。
- 因此目标 bridge 缺失、stale、symlink、hash 不符时，两者都会重建；但**源制品**缺失/损坏会在 `:1381-1393` 两者都失败。profile 有 `@deepseek-ai` 拷贝时，两者都在 `:1457-1462` 失败，flag 不会清理。
- D7 要求（`research/2026-11-24-inproc-only/07-workspace-contract-design.md:103-128`）：普通启动对坏 workspace fail-fast；repair 备份重写契约、清 manifest `@deepseek-ai/*`、删 `node_modules` + `pnpm-lock.yaml`、重装。当前 provisioner **没有 workspace 步骤，也没有上述任何 repair 动作**；缺的是整条 opt-in 恢复链。D5 的 fresh-home/负向门禁仅有未跟踪脚本，CI/package 脚本无引用。

## 最小修法建议（不实施）

1. 按 D2 补 `topics-memory`/`cron` catalog，将既有 8 项设 `defaultOn:true`（或默认选 D2 11 项），同步 reason/注释与测试。
2. `templateRevision` 无需补字段；补 T11 改名/旧 sidecar 迁移测试，并统一 06 authority 字段样例。
3. 在 companion 前实现 workspace 三态检查；无 flag 坏契约 fail-fast，repair 才备份重写、清残留、删安装树/lock 并重装；保留现有 bridge 无条件收敛。
4. 将 D5/D7 scratch-HOME 真 provisioner 门禁接入 CI，覆盖无 flag 负向路径与 repair 正向路径。

## 未覆盖

- 未运行真安装，registry 可用性、版本漂移及最终 companion 落盘数未证实。
- 未执行会写临时目录的集成测试；未跟踪 fresh-home verifier 不作为已集成门禁证据。
- T11 物理改名后的旧目录迁移、Windows 行为未验证。
