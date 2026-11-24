# ADR-0014: Single-profile convergence（单 profile 收敛）

Date: 2026-11-24
Status: Accepted（收敛完成；当前活动 profile 名为 `opentui-monday`）

> 编号说明：本文编号为 ADR-0014；[Session seam lifecycle contract](0010-session-seam-lifecycle-contract.md) 保持 ADR-0010。引用时以编号并配合文件名消歧。

## Context

0.22.0 为了同时保留 HTTP 宿主与 stdio bridge，形成了两个产品 profile：

- `opentui`：承接 HTTP boot、客户端设置、preset/login 与旧插件供给；
- `opentui-inproc`：承接 stdio bridge 宿主、会话与 inproc bundle。

T12 删除 HTTP lifecycle/carrier/session 链后，`opentui` 作为第二个宿主的技术前提已经消失。继续维护双 profile 会带来四个问题：

1. **配置与宿主分叉**：客户端读写一个目录，实际宿主加载另一个目录；同名设置、preset、provider 路由和 patch 可能不同步。
2. **供给与版本分叉**：两套 bundle、companion、patch 模板和 provisioning 路径需要分别演进。
3. **迁移与回滚复杂**：同一份 `~/.dsh/sessions` 被两个 profile 共享，writer lock 能防止双写，却不能消除目录与配置漂移。
4. **唯一事实源缺失**：profile 名、目录与宿主 argv 容易在多处硬编码，改名和门禁清扫因此变成高风险改动。

因此需要把运行时宿主与客户端配置收敛到同一个 profile，同时保留旧目录作为迁移源与回退材料。

## Decision

### 1. 一个活动 profile，一个宿主

- 产品运行时只保留一个活动 profile；stdio bridge 宿主与该 profile 的客户端配置面必须指向同一目录。
- profile 名只有一处事实源：`packages/shell/scripts/lib/profile-name.mjs` 的 `DEFAULT_PROFILE`。TypeScript 侧由 `packages/shell/src/client/profile-constants.ts` 重导出；provisioner、transport 与本地配置面都消费该常量。
- `StdioBridgeTransport` spawn 的 `--profile` 与 seam 本地写入的 profile 必须一致；不一致时本地写入拒绝并给出两个目录路径，不能猜测或静默切换。
- 旧目录不自动删除、不改名。`opentui` 与 `opentui-inproc` 都只作为迁移源与回退材料保留，均为只读；生产目标是 `opentui-monday`。

### 2. 唯一活动 profile 名

活动 profile 名是 **`opentui-monday`**，唯一事实源为 `packages/shell/scripts/lib/profile-name.mjs` 的 `DEFAULT_PROFILE`。改名与收敛、写手退役、门禁清扫在同一提交完成，避免不可验证的中间状态；桥握手/指纹不绑定 profile 名。

### 3. 一次性迁移走 `converge + externalCarry`

迁移不整段复制旧 `cordis.patch.yml`，也不新增第二条 patch 写路径：

1. `planMigration()` 同时读取 `opentui` 与 `opentui-inproc` 的旧 patch，以及 `opentui` 的 `config.json` / `keybindings.json` / `provider-keys.json`。
2. patch 用户意图按**叶路径白名单**抽取，生成 `externalCarry = { source, values, dropped }`。
3. `provisionProfileFiles()` 在同一次 `package.json.lock` 临界区内，把 `externalCarry` 交给 `converge()`；manifest、patch 与 `.patch-ownership.json` 一次收敛。
4. `externalCarry` 只改变本次生效值；sidecar 的 ancestor 仍是**未加 ext 的模板投影**。后续模板升级不会被迁移值永久冻结。
5. marker 不存在时才计算 carry；marker 存在时连旧文件都不读，`externalCarry` 为 `undefined`，不重放迁移 notice。

干净 home 没有旧 patch 时不伪造 `externalCarry`，也不写迁移 marker。

### 4. 迁移载荷与冲突规则

| 载荷 | 规则 |
|---|---|
| `subagent.maxActiveSubagents` | `opentui-inproc` 优先；该源没有此叶时才回退 `opentui` |
| `subagent.maxDepth` | 只从 `opentui-inproc` 抽取 |
| `session-log-deepseek.enabled` | `opentui-inproc` 优先；缺失时回退 `opentui` |
| `agent-default-model.{provider,model,reasoningEffort}` | 逐叶选源，整组原子校验；任一叶无效则整组丢弃 |
| `dsh-approval-policy.config.windowSeconds` | `opentui-inproc` 优先；缺失时回退 `opentui`；只接受 `[0, 86400]` 的有限数值 |
| `config.json` / `keybindings.json` | 从 `opentui` 整份带回；非法 JSON 不激活 |
| `provider-keys.json` | 只备份，不作为活凭据迁移；宿主凭据仍在 home 级，需重新 `/login` |
| `~/.dsh/sessions` / home 级凭据 | 不迁移、不复制，继续共享 |

源优先级按**叶是否存在**判断，不按值是否等于模板默认值判断。`opentui-inproc` 中一个等于默认但仍显式存在的值，不得回退到 `opentui` 的旧值。

禁止迁移 `permission` 整族、`llm-pi-ai.providers`、append preset insert、重复 insert、已无 bundle 的旧行与未知叶。它们进入 `dropped` 并给出 reason；迁移不得静默放宽沙箱、替换模型表或制造不可寻址的重复 id。`agent-default-model` 三叶作为一组校验，避免只迁半个模型选择。

### 5. 备份与 marker 顺序

生产目标是 `opentui-monday`，源 B (`opentui-inproc`) 是独立的只读旧目录。**converge 前先写备份仍是硬前置条件**：备份写入目标 profile 的 `.migrated-from/`，且必须是迁移前原文。

严格顺序如下：

1. 获取整轮 `.provision.lock`，读取迁移输入并生成 plan。
2. **先写 pre-backup** 到目标 profile 的 `.migrated-from/`；只备份，不写 config/keybindings/marker。备份失败即 fail-fast，converge 不得执行。
3. 执行 `converge + externalCarry`，同一轮完成 manifest、patch 与 sidecar。
4. 应用有效 `config.json`、`keybindings.json`；pre-backup 已写过的备份不重复覆盖。
5. **最后写 `.migration.json`**。任一前置写失败都不写 marker，下次启动重试。

备份文件名固定为 `<source>-cordis.patch.yml` 与 `opentui-provider-keys.json`。patch 备份为 0644，provider key 备份为 0600；active config/keybindings 与 marker 使用 0600，写入均为同目录 tmp+rename。

marker 记录 `from` / `at` / `version` / `digest` / `migrated` / `dropped`。`version` 取自 shell package，`digest` 覆盖 marker 内容与备份文本，不包含 `at` / `version`。marker 内容损坏也按“已迁移”安全阻断，不重新读取旧文件。

崩溃重入分两种：

- converge 前崩溃：尚无 marker，重跑 plan；已存在的备份按内容相等跳过。
- converge 后、marker 前崩溃：保留原 pre-backup，不把已收敛文本重新当成旧值覆盖备份；ext 重算后结果幂等，成功后才写 marker。

### 6. Companion 默认名单

单 profile 的默认 companion 名单固定为以下 **11 项**；顺序与 `DEFAULT_COMPANION_IDS` 一致：

| # | Catalog id | Package |
|---|---|---|
| 1 | `registry` | `@aiwayds/dsh-subagent-registry` |
| 2 | `ask-router` | `@aiwayds/dsh-ask-router` |
| 3 | `approval-policy` | `@aiwayds/dsh-approval-policy` |
| 4 | `llm-net-retry` | `@aiwayds/dsh-llm-net-retry` |
| 5 | `model-sync` | `@aiwayds/dsh-model-sync` |
| 6 | `llm-stats` | `@aiwayds/dsh-llm-stats` |
| 7 | `mcp-adapter` | `@aiwayds/dsh-mcp-adapter` |
| 8 | `vault` | `@aiwayds/dsh-vault` |
| 9 | `web-search` | `@aiwayds/dsh-web-search-anysearch` |
| 10 | `topics-memory` | `@aiwayds/dsh-topics-memory` |
| 11 | `cron` | `@aiwayds/dsh-cron` |

`workflow` 明确不在默认名单。`DSH_OPENTUI_COMPANIONS` 显式设置时替换默认集合，`none` 表示空集，`all` 表示整个 catalog；`DSH_OPENTUI_COMPANION_LATEST` 是总开关。companion 解析 `latest` 后按 catalog 的兼容范围校验，装精确版本，不降级已安装版本。

## Consequences

Positive:

- 宿主、设置、preset/login 与插件目录只有一个归属，消除双 profile 配置漂移。
- provisioning、companion 与 patch 收敛共用一把锁和一条写路径，首启迁移可重入且可审计。
- 旧 patch 只抽取明确安全的叶，权限与模型表不会被旧配置静默覆盖。
- 旧目录保留，回退旧版不需要反向迁移。

Negative / cost:

- 迁移会丢弃 permission、provider 表、append preset 与未知字段；必须通过 notice / marker 明确呈现，不能伪装成无损复制。
- 旧 `provider-keys.json` 不再是活凭据来源，用户可能需要重新 `/login`。
- marker 一旦存在，之后对旧目录的修改不会再被自动吸收。
- 11 项默认 companion 增加首次安装与启动时 registry 查询成本。
- 活动 profile 名为 `opentui-monday`；`opentui` 与 `opentui-inproc` 只作为迁移源与回退材料保留，文档与命令均不得把它们写成当前目录名。

## Implementation anchors

- Profile 名单一事实源：`packages/shell/scripts/lib/profile-name.mjs`、`packages/shell/src/client/profile-constants.ts`。
- Patch 收敛与 ext 白名单：`packages/shell/scripts/lib/patch-ownership.mjs`。
- 迁移规划与文件系统提交：`packages/shell/scripts/lib/migration.mjs`、`packages/shell/scripts/lib/migration-io.mjs`。
- 调用顺序与锁：`packages/shell/scripts/provision-inproc-profile.mjs` 的 `runProvision()` / `provisionProfileFiles()`。
- Companion 名单与 catalog：`packages/shell/scripts/lib/companion-policy.mjs`、`packages/shell/scripts/lib/inproc-companions.mjs`。
- 宿主/客户端 profile 一致性：`packages/shell/src/client/bridge-transport.ts`、`packages/shell/src/client/bridge-session-seam.ts`、`packages/shell/src/client/local-config-faces.ts`。
- 行为证据：`packages/shell/test/migration.test.ts`、`packages/shell/test/migration-io.test.ts`、`packages/shell/test/provision-inproc-migration.test.ts`、`packages/shell/test/patch-ownership.test.ts`、`packages/shell/test/profile-consistency.test.ts`、`packages/shell/test/inproc-companions.test.ts`。

## Related decisions

- [ADR-0009：Session bridge](0009-inprocess-session-bridge.md) 决定唯一会话通道为宿主内 stdio bridge；本文决定该通道使用的 profile 如何从两个收敛为一个。
- [Session seam lifecycle contract](0010-session-seam-lifecycle-contract.md) 继续管辖 session identity、writer lock、恢复与 IPC 生命周期；本文不改变这些不变量。
