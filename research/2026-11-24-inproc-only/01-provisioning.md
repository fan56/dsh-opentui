# 01 — dsh-opentui 供给/分发面调研（opentui vs opentui-inproc）

- 日期：2026-11-24
- 仓库：`/Users/qingguee/repo/dsh-opentui-wt-inproc-only`（worktree，HEAD `153c8ce`）
- 范围：只读调研。未修改任何源码/profile，未运行写 profile 的命令，未读取/打印任何凭据值。
- 证据格式：`文件:行`（仓库相对路径）。

---

## 一、结论先行（10 条）

1. **老 `opentui` profile 的"创建"由 dsh-opentui 脚本驱动 dsh CLI 完成，不是 dsh 默认自动 provision。** 目录不存在时，脚本显式调用 `dsh opentui --from-default-profile web --dump-config`，让 dsh 从 `web` 模板建目录（`--dump-config` 使 dsh compose-and-exit，不启动 profile）。模板选择、创建时机、后续所有写入都在 dsh-opentui 侧。（`packages/shell/scripts/provision-opentui-profile.mjs:8-12,173-200`；模板常量 `TEMPLATE='web'` 同文件 `:111`）

2. **老 profile 的文件写入分工明确**：`package.json`（deps + `dsh.profile.bundles`，`writeManifest` 先做 `.bak-<ts>` 备份）、`cordis.patch.yml`（provider 路由 + `tool-web` 重开 + `web.searchProvider=anysearch` + `mcp-context7`）、`pnpm-workspace.yaml`（清 orphan patch / 写 allowBuilds）、`.provision-state.json`（失败记忆，脚本自写自读）；`upgrade-overrides.json` 与 `config.json` 由**别处**写（upgrade / launcher 迁移）。（`provision-opentui-profile.mjs:304-315,322,369-423,430-450,691-779`；`:158-160,267-294`；`packages/shell/scripts/upgrade.mjs:84,972`；`packages/shell/bin/dsh-opentui.mjs:344-401`）

3. **`opentui-inproc` 完全独立**：`provision-inproc-profile.mjs` 8 步收敛自己的目录，`PROFILE='opentui-inproc'`，hard guard 只碰这一个 profile，不读写 `opentui` 目录。（`packages/shell/scripts/provision-inproc-profile.mjs:2-11,92-95,147`）

4. **启动脚本目前同时供给两个 profile**：bin step 3 对 `opentui` 做 best-effort provision（退出非 0 只打 WARN、继续启动）；step 3b 对 `opentui-inproc` 做 fatal provision（失败即退出）；step 6a 还用 `profile:'opentui'` 预启 HTTP host。（`packages/shell/bin/dsh-opentui.mjs:267-302,304-321,499-528`）`--repair-bridge` 只走 inproc provisioner，不碰老 profile。（同文件 `:202-231`）

5. **`upgrade` 子命令只作用于老 profile**：`upgrade.mjs` 从 `provision-plan.mjs` 导入 `PROFILE`（= `'opentui'`），在 `~/.dsh/profiles/opentui` 下备份/改 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`upgrade-overrides.json`，写 `.upgrade-backup/`，完全不涉及 inproc。（`packages/shell/scripts/upgrade.mjs:55-61,84,102,972,1133`；`packages/shell/scripts/lib/provision-plan.mjs:15`）

6. **`DSH_OPENTUI_INPROC` 已从源码删除**（0.24.0 移除 legacy remote seam 的逃生门；仓库中唯一残留是测试断言"usage 不应再出现它"，其余仅文档/历史）。当前 provision 相关开关是 `DSH_OPENTUI_COMPANION_LATEST`、`DSH_OPENTUI_COMPANIONS`（inproc companions）、`DSH_OPENTUI_PLUGINS`（老 tier）、`DSH_PROVISION_DRY_RUN`、`DSH_OPENTUI_APPROVAL_GATE`、`DSH_OPENTUI_HOST_VERSION`、`DSH_HOME`。**不存在"按 env 决定是否 provision opentui"的开关——step 3 每次启动都跑**。（`packages/shell/test/bin-launcher.test.ts:463`；`CONTEXT.md:96`；`README.md:12,118`；`packages/shell/scripts/lib/inproc-companions.mjs:23-25`；`provision-opentui-profile.mjs:138-139`；`provision-plan.mjs:135-137`；`provision-inproc-profile.mjs:161,164`）

7. **内容差异**：老 profile = `web` 模板 bundles + 12 个受管插件（7 core + 5 recommended，pin 写在 `provision-plan.mjs`），无 companion 概念；inproc profile = `dsh-base` + `dsh-opentui-bridge` 两个 bundle，默认唯一 companion `@aiwayds/dsh-subagent-registry`，其余 8 个候选全部 opt-in（`defaultOn:false`），且禁止把任何 `@deepseek-ai` 依赖写进 manifest。（`provision-plan.mjs:19,29-102`；`provision-inproc-profile.mjs:147-149,885-901,1478-1485`；`inproc-companions.mjs:35-99,116-124`）

8. **`HOST_PEER_RANGE='>=0.2.2-rc.3 <0.3.0'` 只服务 inproc**：注入 bridge 的 peerDependencies、provision 启动前 fail-fast gate、握手期 host 校验，并写 profile 内 `compatibility.json` 精确版本豁免。老 `opentui` profile 不走此窗口校验，也没有该文件。（`packages/shell/scripts/lib/host-compat.mjs:23,32,35,42,103-114,203-224`；`scripts/build-bridge.mjs:38,103`；`provision-inproc-profile.mjs:129-135,1215-1261`；`packages/shell/src/client/seam-bootstrap.ts:35-37,176-179`）

9. **只停 provision、不删目录时，`~/.dsh/profiles/opentui` 仍被大量读写**：客户端本地配置面（settings/config/presets/login）读写其 `cordis.patch.yml`/`config.json`/`provider-keys.json`；HTTP host 预启与 stale-kill 仍按 `--profile opentui` 匹配；launcher 的一次性迁移仍写其 `config.json`；e2e/verify 脚本仍以它为 seeded profile。（`packages/shell/src/client/bridge-session-seam.ts:2271-2290,3794-3805`；`local-config-faces.ts:235,333,498-499,608-609`；`bin/dsh-opentui.mjs:272,324-401`；`bin/lib/launcher.mjs:42,433-466`；`scripts/e2e-sweep.mjs:49,74,94-95`）

10. **`install-profile.mjs` 是退役的 plugin-mode 死代码**：它建的是第三个 profile `dsh-opentui`（不是 `opentui`/`opentui-inproc`），且 import 的 `./solid-js-pin.mjs` 在仓库中已不存在，无任何调用方。（`packages/shell/scripts/install-profile.mjs:3-5,25,34`；全仓仅 `provision-plan.mjs:607` 注释提及被退役的 solid-js-pin）

---

## 二、证据表

### 2.1 谁创建 / 谁写文件 / 谁钉版本

| 面 | 行为 | 证据 |
|---|---|---|
| 创建老 profile | 目录不存在 → `dsh opentui --from-default-profile web --dump-config`；dsh CLI 执行实际建目录，脚本决定模板与时机 | `provision-opentui-profile.mjs:8-12,111,173-200` |
| 老 profile 写 package.json | `writeManifest()` 备份 `.bak-<ts>` 后写；step 4 改 `dependencies` 与 `dsh.profile.bundles` | `provision-opentui-profile.mjs:304-315,691-757` |
| 老 profile 写 cordis.patch.yml | provider/model route（`llm-pi-ai` + `agent-default-model`）、`TOOL_WEB_PATCH`、`WEB_SEARCH_PATCH`、`MCP_CONTEXT7_PATCH`，逐条 idempotent append | `provision-opentui-profile.mjs:322,369-423`；`provision-plan.mjs:739-749,855-862,817-829,877-885` |
| 老 profile 装插件 | 一次批量 `dsh plugin --profile opentui add <specs>`，失败逐个重试 + WARN；有效 pin 可被 override 抬高 | `provision-opentui-profile.mjs:452-463,536-681`；`provision-plan.mjs:153-159,392-403,432-449` |
| 老 profile 清 patch/写 workspace | `planOrphanPatchCleanup` 删 `pnpm-workspace.yaml` 中 orphan `patchedDependencies`；`approvePrintedBuilds` 写 allowBuilds | `provision-opentui-profile.mjs:430-450,710-722,759-778`；`provision-plan.mjs:624-718` |
| 老 profile verify | `dsh opentui --dump-config`；`skipping profile bundle` 行转 WARN，不作为失败 | `provision-opentui-profile.mjs:781-803`；`provision-plan.mjs:890-899` |
| 老 profile 失败记忆 | `.provision-state.json` 写在 profile 内，只减少重试；读坏静默降级 | `provision-opentui-profile.mjs:161-163,262-294`；`provision-state.mjs:17-25` |
| upgrade 写 override | `upgrade-overrides.json`（packages map）由 `dsh-opentui upgrade` 写，provision 只读；`.upgrade-backup/` 在老 profile 内 | `provision-plan.mjs:352-371`；`upgrade.mjs:84,102,972,1133`；`provision-opentui-profile.mjs:158-160,229-260` |
| launcher 迁移写 config.json | 老 `dsh-opentui` 偏好合并进 `opentui/config.json`，写 marker，旧 profile 不动 | `bin/dsh-opentui.mjs:28-33,323-402` |
| inproc  manifest | 只写 `dsh.profile.bundles`（`dsh-base` + bridge + 已声明 catalog companions），不写 `@deepseek-ai` 依赖 | `provision-inproc-profile.mjs:143-149,879-901,1404-1428` |
| inproc  bridge copy | `cpSync(dist/bridge → profile/node_modules/@aiwayds/dsh-opentui-bridge)`，实目录非 symlink | `provision-inproc-profile.mjs:30-36,1430-1458` |
| inproc  companions | `dsh plugin --profile opentui-inproc add ...`，失败/无 dsh 均 WARN；写 manifest deps+bundles+node_modules | `provision-inproc-profile.mjs:959-1067,1034-1039` |
| inproc  patch/shim | 生成 `cordis.patch.yml`（`profileRevision` 标记，web/opentui 旧模板 MD5 `54b66bf…` 静默替换，手写备份+WARN）与本地 shim 包 | `provision-inproc-profile.mjs:59-73,648-654,1269-1322,1494-1497` |
| inproc  host gate/豁免 | `dsh --version` → 窗口外 fail-fast，窗口内写 `compatibility.json` 精确豁免 | `provision-inproc-profile.mjs:1399-1402,1215-1261`；`host-compat.mjs:118-147,203-224` |
| inproc 锁 | `.provision.lock`（O_EXCL，30s stale，~1s 等待后 SKIP） | `provision-inproc-profile.mjs:75-81,151-155,1517-1532` |

### 2.2 逐脚本对 `opentui` profile 的作用（packages/shell/scripts/ 与 lib/）

| 脚本 | 对老 `opentui` 做什么 | 对 `opentui-inproc` 做什么 | 证据 |
|---|---|---|---|
| `provision-opentui-profile.mjs` | 创建/收敛：写 package.json、patch、装插件、清 bundles/ orphan patch、verify、WARN | 无 | `:1-75,126-806` |
| `provision-inproc-profile.mjs` | 无（开头注释明确 "The `opentui` profile path is otherwise untouched"） | 全部 8 步 | `:6-11,92-95,147,1399-1499` |
| `upgrade.mjs` | 升级受管插件 pin、写 override、备份/回滚、WARN；`PROFILE` 取自 provision-plan | 无 | `:55-61,84-102,732-870,972,1133` |
| `install-profile.mjs` | 无（建第三个 profile `dsh-opentui`，死代码） | 无 | `:3-5,25,34` |
| `e2e-client.mjs` | 只读预检存在性 + 按 `dsh --profile opentui --no-open` 找 host pid | 无 | `:96,114,166-172` |
| `e2e-sweep.mjs` | 从真实 home 拷贝 `profiles/opentui` 到 scratch（不写真实 profile）；真实目录不存在则 skip | 在 scratch 中链接 bridge | `:32,49,74,94-95` |
| `idle-reaper.mjs` | 只写 `<dshHome>/opentui-host.idle.log`，不写 profile 目录 | 无 | `:27,113` |
| `pack-meta.mjs` | 无（仅拷贝 LICENSE/NOTICE/README/CHANGELOG） | 无 | 文件全文 |
| `lib/provision-plan.mjs` | 纯逻辑：`PROFILE='opentui'`、12 插件+pin、tier、patch 行定义、override 规则、WARN 文案 | 无 | `:15-19,29-121,352-403,720-885` |
| `lib/provision-state.mjs` | 纯逻辑：失败记忆策略（文件由调用方写在老 profile 内） | 无 | `:1-25` |
| `lib/upgrade-plan.mjs` | 纯逻辑：registry/NPMRC 解析（`<profile>/.npmrc` 占位）、override 序列化 | 无 | `:25,75-76,190-192` |
| `lib/host-compat.mjs` | 无 | 窗口、检测、豁免读写 | `:1-16,23-42,103-114,203-224` |
| `lib/inproc-companions.mjs` | 无 | companion 目录/选择/版本决策 | `:1-25,35-124,163-213` |
| `lib/patch-runtime-merge.mjs` | 无 | patch 运行时字段（maxActiveSubagents/defaultPreset 等）合并 | `:1-19` |
| `lib/bridge-failfast-text.mjs` | 无 | 仅供 bridge provision/handshake 的 fail-fast 文案 | `provision-inproc-profile.mjs:119-125` |

### 2.3 内容差异（bundles / companions / tiers / patch）

| 维度 | `opentui`（HTTP 宿主） | `opentui-inproc`（stdio bridge 宿主） |
|---|---|---|
| bundle 来源 | 从 dsh `web` 默认模板复制，再由 step 4 追加受管 bundles | 脚本写死 `BUNDLES=['@deepseek-ai/dsh-base','@aiwayds/dsh-opentui-bridge']` |
| bundle 具体项 | 初始模板项在 dsh CLI 内（本仓库不可见）；受管 12 项见下 | `provision-inproc-profile.mjs:147-149,885-890` |
| 必需插件/tier | core 7：`dsh-ask-router@0.7.0`、`dsh-subagent-registry@0.20.1`、`dsh-llm-net-retry@0.8.0`、`dsh-web-search-anysearch@0.9.0`、`dsh-mcp-adapter@0.8.0`、`dsh-approval-policy@0.3.0`、`dsh-model-sync@0.9.0`；recommended 再加 5：`dsh-llm-stats@0.9.0`、`dsh-topics-memory@0.26.0`、`dsh-cron@0.7.0`、`dsh-workflow@0.2.1`、`dsh-vault@0.8.2`（默认 `recommended`） | 无 tier 表；默认唯一 companion `dsh-subagent-registry`（catalog 声明 `^0.21.0`，实际装 `latest` 并做 major/0.x-minor 防破坏、不降级） |
| 显式排除/可选 | `EXCLUDED_PLUGINS` 8 项；`RETIRED_PROFILE_ENTRIES=['@aiwayds/dsh-opentui']` | 其余 8 个 `@aiwayds/*` 候选全部 `defaultOn:false`，靠 `DSH_OPENTUI_COMPANIONS` opt-in：`ask-router`、`approval-policy`、`llm-net-retry`、`model-sync`、`llm-stats`、`mcp-adapter`、`web-search`、`vault` |
| patch 内容 | provider 路由 + tool-web/anysearch（服务 HTTP 宿主上的 web 工具）+ mcp-context7 client row | inproc-only 模板：移除 web-app 补偿行；含 subagent `maxActiveSubagents:3/maxDepth:1`；注册 `dsh-opentui-session-shim` + `@deepseek-ai/dsh-api-session-controller`；`session-log-deepseek.enabled`；`DSH_OPENTUI_APPROVAL_GATE` 逃生门 |
| 关键证据 | `provision-plan.mjs:18-19,29-115`；`provision-opentui-profile.mjs:135-139,369-423`；`provision-plan.mjs:723-749` | `inproc-companions.mjs:35-99,116-124,163-192`；`provision-inproc-profile.mjs:598-646,623-634,559-574,606-621` |
| manifest 禁止项 | 无 `@deepseek-ai` 禁止规则 | 明确禁止 `@deepseek-ai/*` 出现在 profile（由宿主 closure 提供），step 5 fail-fast |

### 2.4 profile 名常量 / pin / 窗口校验

| 类型 | 位置（文件:行） |
|---|---|
| 老 profile 名常量 | `provision-plan.mjs:15`、`bin/lib/launcher.mjs:42`、`bin/dsh-opentui.mjs:272,505`、`scripts/e2e-client.mjs:96`、`scripts/e2e-sweep.mjs:49`、`src/client/lifecycle.ts:91`（`DEFAULT_PROFILE`）、`src/client/host-launch.ts:69`（`DEFAULT_LAUNCH_PROFILE`）、`src/client/safe-kill.ts:31`（`HOST_PROFILE`）、`src/client/client-lifecycle.ts:393,557,657`、`src/client/remote-restart.ts:165`、`src/client/watchdog-cli.ts:25`、`src/client/remote-host-session.ts:547`、`scripts/verify-sk-keymap-ans.mjs:31`、`scripts/verify-s1-model-ans.mjs:20`、`scripts/test-tier.mjs:22` |
| 新 profile 名常量 | `provision-inproc-profile.mjs:147`、`src/client/bridge-transport.ts:71,188`（默认 spawn `dsh --profile opentui-inproc`） |
| 版本 pin | 老 profile 全部插件 pin 在 `provision-plan.mjs:29-102`（`PLUGIN_SET[].version`）；override 抬升 `provision-plan.mjs:392-403`；inproc 不 pin 插件版本（companion 走 `npm view dist-tags latest`：`inproc-companions.mjs:199-213`），bridge 自身身份/版本由 `bundle-fingerprint.json` 守护（`provision-inproc-profile.mjs:55-58,1490-1492`） |
| 升级/降级 | 老 profile：`upgrade.mjs` 批量 `dsh plugin add` + override（只升不降：`provision-plan.mjs:368-371,392-403`）；inproc：`decideCompanionInstall` 明确 `downgrade → skip`（`inproc-companions.mjs:185-191`） |
| 窗口校验 | 仅 inproc：`host-compat.mjs:32,103-114,203-224`，被 `build-bridge.mjs:38,103`、`provision-inproc-profile.mjs:129-135,1231-1254`、`seam-bootstrap.ts:35-37,176-179` 复用；老 profile 无对应校验 |
| UI 中的 "opentui" | `packages/tui-base/src/routes/session/settings-modal.tsx:99,370`（settings section id）、`welcome-hero.tsx:80`（tree-root 注释）——是 UI id/文案，不是 profile 名，删除 profile 时不必改 |

---

## 三、删除 `opentui` profile 的供给面改动点清单

### A. 必改（供给/启动链，直接产出或消费 profile）

1. **`packages/shell/bin/dsh-opentui.mjs`**
   - 删除 step 3 整段（`:267-302`）：`provision-opentui-profile.mjs` 调用 + `--provider/--model/--reasoning-effort/--plugins/--dry-run` 转发 + WARN 逻辑。
   - 删除 step 4 一次性迁移（`:28-33,323-402`，含 `opentuiProfileDir`、`migrateLegacyPreferences()`）；若保留对 `dsh-opentui` 旧 profile 的迁移，目标需改为 inproc 或取消。
   - 删除 step 6a 以 `profile:'opentui'` 预启 HTTP host（`:499-528`，尤其 `:505`），或改为 inproc/取消；同时清理 `--force` 说明中残留的 `--profile opentui` 措辞（`:261-265`）。
   - 头部注释 `:20-27`（step 3 描述）同步更新；`repairBridge` 分支注释 `:205-206` 提到的 "default `opentui` profile bootstrap" 同步。
   - `upgrade` 子命令 branch（`:102-146`）：如 upgrade 只服务老 profile，需决定一同退役还是改造成 incompanion 升级（见 B）。

2. **`packages/shell/scripts/provision-opentui-profile.mjs`** — 整个文件退役（它唯一作用就是老 profile）。其 import 的 `provision-plan.mjs` 逻辑随之处理（见 4）。

3. **`packages/shell/scripts/upgrade.mjs`** — 其 `PROFILE` 来自 `provision-plan.mjs`（= `opentui`），全部逻辑针对老 profile（`:972` 等）。删除或重写为 inproc companion 升级；否则会继续在已删除的目录里写 `upgrade-overrides.json`/`.upgrade-backup/`。

4. **`packages/shell/scripts/lib/provision-plan.mjs`** — `PROFILE='opentui'`（`:15`）、`PLUGIN_SET` 12 项与 pin（`:29-102`）、`EXCLUDED_PLUGINS`（`:106-115`）、`RETIRED_PROFILE_ENTRIES`（`:121`）、tier 与 patch 行定义（`:18-19,125-145,720-885`）、override 抬升（`:352-403`）都只服务老 profile。但 `upgrade.mjs` 当前复用其 `PROFILE/PLUGIN_SET/compareVersions/parseVersion/resolveEffectivePin`（`upgrade.mjs:55-61`），删除前需先处理 upgrade。纯函数 `classifyPluginAddFailure` 等若是老 profile 专用，也一并退役。

5. **`packages/shell/bin/lib/launcher.mjs`** — `PROFILE='opentui'`（`:42`）与 `classifyProcess()` 的 host 判定（`:433-466`，匹配 `--profile opentui`）为老 profile 的 stale-process/`--force` 服务；若 HTTP host 预启被删，此面需改判定或退役。

### B. 关联必改（不删目录也会被读写，属"只停 provision"的遗漏面）

6. **`packages/shell/src/client/lifecycle.ts:91,1078,1095`**（`DEFAULT_PROFILE='opentui'` + profileDir 校验/append-system patch 路径）、**`client-entry.tsx:258,266-267`**（`ensureV2Host({profile})` 仍用 DEFAULT_PROFILE 启动 HTTP host）、**`host-launch.ts:69,549`**（`--profile <profile> --no-open --port N`）、**`safe-kill.ts:31`**（`HOST_PROFILE='opentui'`）、**`client-lifecycle.ts:393,557,657`、`remote-restart.ts:165`、`watchdog-cli.ts:25`、`remote-host-session.ts:547`** 的默认 profile 值：若只删供给、不改这些，客户端会继续找一个不存在的 profile 目录并在很多情况下自动重建它（如 `remote-host-session.ts:1502` 的 `mkdirSync`）。

7. **`packages/shell/src/client/bridge-session-seam.ts:2271-2290,3794-3805` + `local-config-faces.ts:235,333,498-499,608-609`**：bridge seam 下客户端仍以 `DEFAULT_PROFILE='opentui'` 读写 `cordis.patch.yml`/`config.json`/`provider-keys.json`。这是"删掉老 profile 目录后谁还写它"的核心答案，必须改成 inproc profile（或改到本地配置路径）才能真正不再触碰。注意 inproc provisioner 每轮都会整体重写 `cordis.patch.yml`（`provision-inproc-profile.mjs:1283-1322`），两边若指向同一文件会冲突——这正是当前刻意分离两个 profile 的原因（见 `local-config-faces.ts:7-17`）。

8. **测试/e2e 与验证脚本**：`scripts/e2e-client.mjs:96,114`、`scripts/e2e-sweep.mjs:49,74,94-95`、`scripts/verify-sk-keymap-ans.mjs:31,45,57-64`、`scripts/verify-s1-model-ans.mjs:20,33`、`scripts/test-tier.mjs:22`、`scripts/real-client-gate.sh:125-126,181,224,231`（读/拷真实 `profiles/opentui`），需改用 inproc 或移除相关 preflight。

### C. 仅文档/不阻塞但建议同步

9. `README.md`、`CONTEXT.md`、`CHANGELOG.md` 中关于默认 seam 与两 profile 的描述（如 `README.md:118`、`CONTEXT.md:90-96`）；`packages/shell/package.json` 的 `files` 含 `bin`、`scripts`（`:14-16`），删除脚本时它们不再随包分发，无需改 files 字段本身。

### D. 只停 provision 不删目录的后果（直接回答）

- `~/.dsh/profiles/opentui` 不会被自动删除（所有 provisioner 都是"复用已存在"策略：`provision-opentui-profile.mjs:173-175`；inproc 从不删它）。
- 仍写入者：`upgrade.mjs`（override/backup）、客户端本地配置面（patch/config/provider-keys）、launcher 迁移（config.json，仅 marker 未写时）、HTTP host 启动（registry/lock 在 `<dshHome>` 根，profile 目录本身被 dsh 读取）。
- 仍读取者：`dsh --profile opentui --no-open --port N` 宿主启动（bin step 6a + client-entry ensureV2Host）、launcher stale-kill 判定、e2e/verify preflight。
- 换言之，"停 provision"只能阻止 dsh-opentui 对该目录做 pin/patch/install 收敛，不能阻止运行时读写。

---

## 四、未知项（无法从本仓库确认）

1. **dsh CLI 内部行为**：`dsh opentui --from-default-profile web --dump-config` 实际创建哪些文件、`web` 默认模板的初始 bundle/依赖清单、`dsh --profile opentui` 在 profile 缺失时是否会自动 provision——这些都在 `@deepseek-ai/dsh` 包内，本仓库无源码，无法给出 `文件:行` 证据。本报告只确认"dsh-opentui 的脚本发起该命令并决定模板"（`provision-opentui-profile.mjs:173-200`）。
2. **本机实际状态**：未检查本机 `~/.dsh/profiles/opentui` / `opentui-inproc` 是否存在及其内容（只读任务且避免触碰凭据），"只停 provision 后目录会怎样"的结论基于代码行为而非本机快照。
3. **HTTP host 当前是否仍承担功能**：文档称 0.24.0 起 bridge 是唯一 seam（`CONTEXT.md:90-96`），但 bin 与 client-entry 仍启动 `opentui` HTTP host（`bin/dsh-opentui.mjs:499-528`、`client-entry.tsx:266`）。该 HTTP host 除 registry/health 外是否还被客户端实际使用，属运行时面，超出本次供给面调研，需另案确认。
4. **`install-profile.mjs` 的历史分发状态**：仓库中无调用方且 import 缺失模块（`install-profile.mjs:25`），是否曾被发布版本调用、外部脚本是否依赖它，无法从仓库判定。
5. **`upgrade` 对 inproc 的适用意图**：当前 upgrade 完全不覆盖 inproc companion 升级（`upgrade.mjs:55-61` 仅老 profile）；"删除 opentui 后 upgrade 该何去何从"是需要产品/技术决策的问题，本报告不代替决策。
