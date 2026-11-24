# 03 — 删除 `opentui` profile：全仓引用面与门禁影响

- 日期：2026-11-24
- 仓库：`/Users/qingguee/repo/dsh-opentui-wt-inproc-only`（独立 worktree，HEAD `153c8ce`，与 main 同内容）
- 性质：**只读调研**。未修改源码、未写 `~/.dsh`、未 git commit、未打印任何凭据值。
- 证据格式：`文件:行`（仓库相对路径）。grep 均排除 `node_modules` / `.git` / `.proof` / `pnpm-lock.yaml`。
- 配套报告：`research/2026-11-24-inproc-only/01-provisioning.md`（供给面）；本报告聚焦引用面与门禁。

> 2026-11-24 批次 2 更新：upgrade 子命令及其实现/专属测试已退役；相关条目已标记，旧行号仅作历史快照。

---

## 一、结论先行

1. **`opentui` 不是"只留字符串即可删"的死 profile**。在 `153c8ce` 上它仍承担四个活角色：① HTTP 宿主启动/registry/三证据 stale-kill；② bridge seam 下客户端本地配置面（settings/config/presets/login）的**文件归属目录**；③ 启动器的 provision/upgrade/legacy 迁移；④ 真机 verify / e2e 的 seed profile 与 preflight。直接删目录会让客户端继续写一个不存在的目录，并让多个真机门禁 preflight 直接 red。

2. **历史记录的三个"硬引用点"核对结果**：
   - `v2-entry` 约 `:1617`/`:1660` 在 0.22–0.24 与 HEAD 上都是 **seam bootstrap（legacy seam 删除/BridgeBootstrapError）**，不是 profile 名（`packages/tui-base/examples/v2-entry.tsx:1674-1682`；`docs/architecture/01-system-topology.md:38`）。该处**无需因删 profile 而改**。
   - 真正的 v2-entry 硬点在 `:1609`（`lifecycle.DEFAULT_PROFILE`，旧版本约 `:1554-1555`）及其下游 `:1616`、`:1636`、`:1651`、`:1940`；**仍存在，必须改**（或随 HTTP host 一起退役）。
   - `lifecycle` 约 `:1079` 在 0.22–0.24 与 HEAD 都是**参数化**的 `profileDir = join(o.dshHome, 'profiles', o.profile)` + `ProfileMissingError`（`retired HTTP lifecycle module:1078-1079`）。**仍存在**，但它本身不是字面量；硬依赖来自 `:91`（`DEFAULT_PROFILE='opentui'`）→ `:1009`（`opts.profile ?? DEFAULT_PROFILE`）→ `:1113`（spawn `--profile <o.profile>`）。

3. **默认 CI 不会被删 profile 直接打断**：`.github/workflows/ci.yml` 的 `test` 与 `pack-cold-start` job 都不需要 `~/.dsh/profiles/opentui`（pack 只用 `opentui-inproc`，`ci.yml:237,294`）。**会失效的是 opt-in 的 `real-client` job**（`ci.yml:129-140`），它 preflight 检查老 profile 并跑 `agents-mount-client.test.ts`。

4. **发布门禁与 e2e 家族会失效**：`scripts/real-client-gate.sh:224,231`、`e2e/families/lib/family-lib.sh:39`、`legacy command-surface sweep (retired):49,74,94-95`、`legacy client-topology gate (retired):96,114,166-172`、`verify/*` 全家（8 个脚本）都以老 profile 为 seed/preflight。CI pack gate 与 `e2e/families/00-pack-gate.sh` 不受影响。

5. **bridge 与老 profile 刻意分离**：`packages/shell/src/client/local-config-faces.ts:7-17` 明确说明 inproc provisioner 会整体重写自己的 `cordis.patch.yml`，所以客户端读老 profile 是"诚实实现"而非遗留 bug。删老 profile 前必须先决定**用户配置（主题/语言/快捷键/预设/provider 路由）迁到哪里**，否则改常量会与 inproc provisioner 写同一文件冲突。这是本次改动的最大设计约束。

6. **本机快照**：`~/.dsh/profiles/opentui` = 52M / 20 bundles（含 `dsh-web-app`）/ 完整 pnpm 锁与 5 份 patch 备份；`opentui-inproc` = 2.3M / 3 bundles / bridge 为实目录副本。`~/.dsh` 顶层**没有** host lockfile / registry 记录含 `profile=opentui`（仅有 2 个 client heartbeat 文件，无 profile 字段）。

7. **假阳性不得误改**：`settings-modal.tsx:99,370`（settings section id）、`entry-slash-deps.test.ts:30-31`（theme name）、`@opentui/*` 库名、`dsh-opentui` 包名均不是 profile 名。

---

## 二、引用分类表

### 2.1 生产代码 — 活代码（删 profile 后行为改变）

| 文件:行 | 上下文 | 该处假设 |
|---|---|---|
| `retired HTTP lifecycle module:91` | `export const DEFAULT_PROFILE = 'opentui'` | 所有未显式传 profile 的 host 生命周期调用都指老 profile |
| `retired HTTP lifecycle module:1009` | `const profile = opts.profile ?? DEFAULT_PROFILE` | `legacy host bootstrap`/`ensureV2Host` 默认 profile 可解析到老 profile |
| `retired HTTP lifecycle module:1078-1079` | `join(o.dshHome, 'profiles', o.profile)` + `ProfileMissingError` | profile 目录必须存在，否则冷启动抛错 |
| `retired HTTP lifecycle module:1095` | `const profileDir = join(o.dshHome, 'profiles', o.profile)` | append-system 写老 profile 的 `cordis.patch.yml` |
| `retired HTTP lifecycle module:1113` | `spawnDsh(['--profile', o.profile, '--no-open', '--port', ...])` | 实际拉起 `dsh --profile opentui` HTTP 宿主 |
| `packages/shell/src/client/client-entry.tsx:258` | `const profile = options.profile ?? DEFAULT_PROFILE` | boot 默认 profile |
| `packages/shell/src/client-entry.tsx:266-268` | `ensureV2Host({ profile, ... })` | 客户端采纳/拉起老 profile 的 HTTP host |
| `packages/shell/src/client-entry.tsx:298` | `spawnLifecycleWatchdog(host.dshHome, { scriptPath, profile })` | watchdog 按老 profile 标识进程 |
| `packages/shell/src/client-entry.tsx:323` | `createSession({ ..., profile })` | `HTTP session facade` 配置路径按老 profile 解析 |
| `packages/shell/src/client-entry.tsx:376` | `lastOneGracefulShutdown(host.dshHome, { profile, hooks })` | 退出时的宿主回收按老 profile registry |
| `packages/tui-base/examples/v2-entry.tsx:1609` | `const profile = lifecycle.DEFAULT_PROFILE` | 合成根的 profile 直接来自老常量（历史约 `:1554-1555`） |
| `packages/tui-base/examples/v2-entry.tsx:1616` | `ensureV2Host({ profile, idleExitSec })` | 同上：拉起 HTTP host |
| `packages/tui-base/examples/v2-entry.tsx:1636` | `spawnWatchdog(host.dshHome, { scriptPath, profile })` | watchdog argv 带老 profile |
| `packages/tui-base/examples/v2-entry.tsx:1651-1657` | `new rhs.HTTP session facade({ ..., profile })` | 本地 config/keybindings 路径按老 profile |
| `packages/tui-base/examples/v2-entry.tsx:1940` | `profileName: profile` 传给 welcome hero | 启动页插件树根标签显示老 profile 名 |
| `packages/shell/src/client/bridge-session-seam.ts:89,2273` | `import DEFAULT_PROFILE` → `options.profile ?? DEFAULT_PROFILE` | **bridge seam** 的本地配置面仍以老 profile 为目录 |
| `packages/shell/src/client/bridge-session-seam.ts:2278-2280` | `new LocalSettingsStore(dshHome, profile)` / `new LocalConfigStore(...)` | patch/config 文件读写指向 `profiles/opentui/*` |
| `packages/shell/src/client/bridge-session-seam.ts:3795-3805` | 注释 + `configLoad()/configSave()/...` | 明确断言"客户端拥有 `opentui` profile 文件，inproc host 写另一个 profile" |
| `packages/shell/src/client/local-config-faces.ts:231-232` | `LocalSettingsStore` 构造 → `join(home,'profiles',profile,'cordis.patch.yml')` | settings 读写老 profile patch |
| `packages/shell/src/client/local-config-faces.ts:333,498-499,608-609` | `LocalConfigStore`/`LocalPresetFace`/`LocalLoginFace` 的路径 | config.json / provider-keys.json / presets 都在老 profile |
| `packages/shell/src/client/client-lifecycle.ts:393,557,657` | `options.profile ?? 'opentui'` | 三处生命周期帮助函数默认老 profile |
| `packages/shell/src/client/client-lifecycle.ts:661-671` | `spawnWatchdog(..., ['--profile', profile])` | watchdog cmdline 带老 profile（三证据之一） |
| `packages/shell/src/client/safe-kill.ts:31` | `export const HOST_PROFILE = 'opentui'` | 允许被 signal 的唯一 profile |
| `packages/shell/src/client/safe-kill.ts:151,227` | `expectedProfile: string = HOST_PROFILE` / `profile = HOST_PROFILE` | 三证据匹配的默认值 |
| `packages/shell/src/client/host-launch.ts:69` | `export const DEFAULT_LAUNCH_PROFILE = 'opentui'` | 预启 host 的默认 profile |
| `packages/shell/src/client/host-launch.ts:268` | `const profile = d.profile ?? DEFAULT_LAUNCH_PROFILE` | launcher deps 默认值 |
| `packages/shell/src/client/host-launch.ts:549` | `spawnHost(['--profile', o.profile, '--no-open', ...])` | 真正拉起 HTTP host |
| `packages/shell/src/client/remote-restart.ts:165` | `options.profile ?? "opentui"`（`/reload` 同端口重启） | 重启的 lockfile 与 spawn 都按老 profile |
| `packages/shell/src/client/remote-restart.ts:258` | `spawnDsh(["--profile", profile, "--no-open", ...])` | 同上 |
| `retired HTTP session facade module:547` | `this.#profile = options.profile ?? "opentui"` | 未注入 profile 的 session 默认老 profile |
| `packages/shell/src/client/watchdog-cli.ts:25` | `process.env[ENV_WATCHDOG_PROFILE] || 'opentui'` | detached watchdog 的兜底 profile |
| `packages/shell/src/client/append-system.ts:33,37` | `APPEND_SYSTEM_PRESET_ID='opentui-append-system'`、marker | 合成 preset id 与老 profile patch 行绑定（历史元数据） |
| `packages/shell/src/client/append-system.ts:312-313,349,382-388` | `profilePatchPath(home, profile)` 等 | 按传入 profile 写 patch；调用方（lifecycle/legacy）传老 profile |
| `packages/shell/bin/dsh-opentui.mjs:272` | `const opentuiProfileDir = join(dshHome,'profiles','opentui')` | 迁移/ manifest 目标目录 |
| `packages/shell/bin/dsh-opentui.mjs:292` | spawn `provision-opentui-profile.mjs`（每次启动，best-effort） | 每次启动都收敛老 profile |
| `packages/shell/bin/dsh-opentui.mjs:346,393` | `targetConfigPath` / `mkdirSync(opentuiProfileDir)` | legacy `dsh-opentui` 偏好迁移写老 profile config.json |
| `packages/shell/bin/dsh-opentui.mjs:505` | `ensureLaunchHost({ profile: 'opentui', ... })`（step 6a） | **启动器直接预启老 profile 的 HTTP host** |
| `packages/shell/bin/lib/launcher.mjs:42` | `export const PROFILE = 'opentui'` | stale 进程判定与 `--force` 依据 |
| `packages/shell/bin/lib/launcher.mjs:452-455,482` | `classifyProcess()` 匹配 `--profile <PROFILE>` | 只把老 profile 的 dsh 识别为 host |
| `packages/shell/scripts/lib/provision-plan.mjs:15` | `export const PROFILE = 'opentui'` | provision/upgrade 的 profile 名真源 |
| `packages/shell/scripts/lib/provision-plan.mjs:147-159` | `['plugin','--profile','opentui','add',...]` | 装插件走老 profile（`upgrade 子命令（已退役）` 复用） |
| `upgrade 子命令（批次 2 已退役）` | 退役前导入 `PROFILE`，写老 profile 的 override/backup | 批次 2 已删除 |
| `packages/shell/scripts/provision-opentui-profile.mjs:8,87,111,137,173-200` | 建/收敛老 profile（从 `web` 模板） | 整个脚本只服务老 profile |
| `packages/shell/scripts/provision-inproc-profile.mjs:8,92-95,651-653,1313` | 注释/"known web/opentui template" MD5/WARN 文案 | **硬 guard 只碰 inproc**；老 profile 名仅出现在文案/历史模板检测，逻辑不依赖 |

### 2.2 生产代码 — 注释/文档性引用（删代码时顺手同步，不影响行为）

| 文件:行 | 说明 |
|---|---|
| `retired HTTP lifecycle module:5` | 用法示例 `legacy host bootstrap({profile:'opentui', ...})` |
| `packages/shell/src/client-entry.tsx:20,148` | 头部示例 + `profile` 选项注释 |
| `packages/shell/src/client/host-launch.ts:17` | 三证据注释含 `--profile opentui` |
| `packages/shell/src/client/watchdog-cli.ts:6` | watchdog 三证据注释 |
| `packages/shell/src/client/client-lifecycle.ts:652` | spawnWatchdog 注释 |
| `packages/shell/src/client/local-config-faces.ts:13-14` | "client profile is `opentui`" 设计说明 |
| `packages/shell/src/client/bridge-session-seam.ts:268,2271,3795` | 默认 profile 说明 |
| `packages/shell/src/client/append-system.ts:5,8,53` | "opentui profile 的 patch / opentui host"说明 |
| `packages/shell/src/client/remote-agent-profiles.ts:13` | `current` key 驱动 opentui profile 的说明 |
| `packages/shell/src/client/remote-restart.ts:66` | "default `opentui`"注释 |
| `retired HTTP session facade module:259` | "default `opentui`"注释 |
| `packages/shell/bin/lib/launcher.mjs:23-29,427,441-455,691` | host 识别规则与 help 文案 |
| `packages/shell/bin/dsh-opentui.mjs:20-33,205,261-265,341` | step 3/迁移/`--force` 说明 |
| `legacy client-topology gate (retired):4,166` / `legacy command-surface sweep (retired).mjs:32,37` | 脚本头部拓扑说明 |
| `packages/shell/scripts/lib/provision-plan.mjs:107,724,888` / `upgrade 子命令（已退役）` / `inproc-companions.mjs:18` | 文案 |
| `dsh-opentui:3` | 顶层 wrapper 注释："resident `dsh --profile opentui` host" |
| `packages/tui-base/src/routes/welcome-hero.tsx:80` | tree-root 标签注释（描述 profile 名） |

### 2.3 测试（单元 / 集成，`packages/shell/test/`）

下表逐条给出 `文件:行`；"假设"列概括该处对 HTTP 宿主/老 profile 的依赖。

| 文件:行 | 假设 |
|---|---|
| `client-entry.test.ts:33,146,156,338,363` | `ensureHostOptions.profile === 'opentui'`；boot 默认走老 profile |
| `client-entry.test.ts:704,706` | `adapted.configPath()` 返回 `profiles/opentui/config.json` / `keybindings.json` |
| `client-lifecycle.test.ts:113,135,145,444,465-466,683` | `cmdline --profile opentui` 的三证据判定；watchdog argv 带老 profile；registry 写入老 profile |
| `host-launch.test.ts:5,55,106,129,133,146,175,238,326,334` | `DEFAULT_LAUNCH_PROFILE`；spawn argv `['--profile','opentui','--no-open','--port',...]`；无/多 profile 时不 kill |
| `host-registry.test.ts:26,36,104,111,115-116,128,130,297,325,328,340` | registry 文件名 `opentui-host.<PROFILE>.json`；legacy 记录按老 profile 清理 |
| `v2-registry-adopt.test.ts:30,57,64,85,120,124,131,144,148,176` | v2 registry adopt 的 key 是老 profile；v1→v2 委托与 watchdog 也按它 |
| `boot-timeouts.test.ts:15,154` | 创建 `profiles/<DEFAULT_PROFILE>` 目录以满足启动前检查 |
| `lifecycle.test.ts:14,118,131,135,212,217,239,287,476,501,527,577,608,677,700,726,763,867,885,897` | `DEFAULT_PROFILE` 全程贯穿：建目录、lockPath/registryKey、spawn cwd、ProfileMissingError、append 路径 |
| `idle-reaper.test.ts:44,142` | lockfile 的 `profile:'opentui'` 字段；reaper 读取该字段 |
| `host-port.test.ts:16,51` | `PROFILE='opentui'`，端口探测循环含 `'opentui'` |
| `bin-launcher.test.ts:118,121,138,148,155-156,158,162,166,169-170,181,184` | `classifyProcess`/`parseProcessHomes` 用 `--profile opentui` 文本串做正反例 |
| `remote-btw-restart.test.ts:346,358,363,401,408,416,427,436,463,506,511,547` | `/reload` 同端口重启：老 profile 目录、`opentui-host.opentui.json` lock、spawn argv、重写后 `profile==='opentui'`，随后 `legacy host bootstrap` 采纳（真实 killable child + HTTP server） |
| `remote-wave3-local.test.ts:351-352,380,417,431-432,435` | `configLoad`/`configSave`/`keybindingsLoad` 从 `profiles/opentui/*.json` 读写 |
| `bridge-session-seam.test.ts:519,602,3355,3435` | seam 的 `profile='opentui'`；`profiles/opentui/node_modules` 存在性分支 |
| `b1-s4-seam-route.test.ts:35-38,46` | scratch `profiles/opentui/cordis.patch.yml` 为 seam 本地配置源；断言 patch 字节不变 |
| `s5-local-faces.test.ts:17-20,43,59,70,98,138,152,168,176,207,219,231,246,259,278-298,316,336,349` | `LocalSettingsStore`/`LocalConfigStore`/`LocalPresetFace`/`LocalLoginFace` 全部以 `profile='opentui'` 构造，patch/config/provider-keys 落在 `profiles/opentui/` |
| `agents-mount-client.test.ts:35-36` | 真机门禁前置：`~/.dsh/profiles/opentui` 必须存在，否则 skipped/FAIL；随后跑 `verify/agents-mount-repro.mjs` |
| `append-system.test.ts:44-45,109,111,116,127,129,136,140,148,157,164-165,171,176,184,189,194,198,204,206,209,215,223,230,232-233` | 大量调用 `syncAppendSystemPreset(home,'opentui')` / `profilePatchPath(home,'opentui')`，假设老 profile patch 的 managed span 语义 |
| `upgrade apply 专属测试（批次 2 已删除）` | `PROFILE_DIR=${DSH_HOME}/profiles/opentui`；`plugin --profile opentui add` argv |
| `upgrade run 专属测试（批次 2 已删除）` | 同上：`profiles/opentui` 作为 upgrade 目标 |
| `provision-plan.test.ts:179-180,675-676` | `pluginAddArgs/Command('opentui',...)` 与 `[1/5] profile reusing /dsh/profiles/opentui` 文案 |
| `provision-script.test.ts:20,33,79,86-98,124,137,159` | 真 wiring：stub `plugin --profile opentui add`；fixture 建 `profiles/opentui/package.json` |
| `provision-state.test.ts:1` | 纯重试状态逻辑，无 profile 字面量 → 本身无需改，但调用方若退役需评估是否连带删除 |
| `provision-inproc-companions.test.ts:34,38,129,247` | **只用 `opentui-inproc`**；删老 profile 不受影响 |
| `patch-runtime-merge.test.ts:18-28,161-171` | 只读 inproc provisioner 模板；不受影响 |
| `shell-render-fixture.tsx:316` / `key-routing-ft.test.tsx:97` / `zombie-pid-alive-local.test.ts:213` / `remote-subagents.test.ts:559` | fixture 里 `profile:'opentui'` 或 `profiles/opentui` 目录假设 |
| `remote-live-smoke.test.ts:5,39-40` | 默认 `DSH_SMOKE_PROFILE` 是 `"web"`；示例文案提到 `opentui`（改文档即可） |

### 2.4 脚本 / e2e / verify（`scripts/`、`packages/shell/scripts/`、`verify/`、`e2e/`）

| 文件:行 | 假设 / 门禁后果 |
|---|---|
| `legacy client-topology gate (retired):96,99-103,114,166-172` | preflight 要求 `profiles/opentui` 存在；`LOCK_PATH=opentui-host.opentui.json`；用 `pgrep -f 'dsh --profile opentui --no-open'` 找宿主 pid。删 profile 后脚本永远 skip 或误判 |
| `legacy command-surface sweep (retired):32,49,74,94-98,122,365` | 从真 home 拷 `profiles/opentui` 到 scratch（不写真 profile），真实目录缺失则 skip；生成的 host 调用 `legacy host bootstrap({profile:'opentui'})` |
| `scripts/real-client-gate.sh:24,125-126,156,224,231` | 环境自检查 `dsh --profile opentui --no-open` 孤儿；**preflight 要求真 `profiles/opentui` 存在**；拷入 scratch 作配置 seed |
| `scripts/real-client-gate.sh:30,236-243,263` | 握手与 provision 阶段实际只用 `opentui-inproc`（`:263` spawn `dsh --profile opentui-inproc`）；老 profile 仅作为 fixture |
| `scripts/test-tier.mjs:22,139-140,191` | `PROFILE=DSH_UI_PROFILE||'opentui'`；ui 档 preflight 要求老 profile；`DSH_SMOKE_PROFILE` 默认传它 |
| `scripts/verify-s1-model-ans.mjs:19-20,33,42,54,61,70` | 真 home 老 profile 必须存在 → 拷到 scratch → 在 scratch 跑 provisioner → 读 `profiles/opentui/config.json` |
| `scripts/verify-sk-keymap-ans.mjs:30-31,45,58,73,84,88` | 同上（keymap 档） |
| `scripts/verify-s1-model-ans.mjs:70` / `verify-sk-keymap-ans.mjs:88` | 还复制 `~/.dsh/profiles/node_modules`（共享依赖树） |
| `verify/ui-matrix.mjs:53-54,103-104,272,276,296-297,359` | seed 老 profile、写 scratch `config.json`/patch、读 `opentui-host.opentui.json` lock |
| `verify/agents-mount-repro.mjs:48-49,191-192,206,210,218,246,334,685,823` | 同上；`:700-705` 另有 `HOST_PROFILE='opentui-inproc'` 分支读 inproc patch（已区分两者） |
| `verify/w1a-six-commands.mjs:23-24,37,44-45,57` | 缺老 profile 直接 `process.exit(2)`；seed config/patch |
| `verify/queue-flush-repro.mjs:30-31,58-59,73,79` | 同上 + lockfile |
| `verify/steer-queue-repro.mjs:41-42,75-76,90,99,113,132` | 同上 + patch/config |
| `verify/text-leak-audit.mjs:66-67,134-135,193,208,244,252` | 同上 + patch/config/lock |
| `verify/e2e-flows/setup-home.mjs:8,37-38,41-47,52-61,73,114,135` | 以真 `profiles/opentui` 为模板，写 scratch 的 manifest/patch/config 并 symlink node_modules |
| `verify/e2e-flows/run-flows.mjs:10,20,31,70,201,389,410` | 模板老 profile 缺失即 missing；用 `opentui-host.<PROFILE>.json` 判活、写 config.json |
| `e2e/families/lib/family-lib.sh:18-19,38-46` | 每个 family 的 scratch home 都拷真 `profiles/opentui` + 共享 `profiles/node_modules`，再 provision inproc |
| `e2e/families/run-all.sh:63-70` | `verify-gate` family 直接复用 `scripts/real-client-gate.sh` → 间接受老 profile 约束 |
| `e2e/README.md:15-16,53` | 文档说明 verify70（实际 64/64）gate 与真机脚本的耦合 |
| `.github/workflows/ci.yml:88,94,129-140` | `real-client` job preflight 与 job 描述明确要求老 profile |
| `.github/workflows/ci.yml:237,294` | `pack-cold-start` 仅 `profiles/opentui-inproc` → 不受删老 profile 影响 |

### 2.5 文档 / 历史记录（建议同步，不阻塞构建）

| 文件:行 | 内容 |
|---|---|
| `README.md`（批次 2 已更新） | upgrade 段已改为退役提示；其余双 profile、legacy 迁移与插件说明仍属后续批次 |
| `CONTEXT.md:52-54,65,74` | 术语表：产品 profile 固定 `opentui`；host 定义为 profile `opentui` 的常驻进程；lockfile 命名 |
| `docs/verification-gates.md:39,120` | 真机 gate 前置条件含 `~/.dsh/profiles/opentui` |
| `docs/testing.md:17` | ui tier 前置条件含老 profile |
| `docs/adr/0005-client-mode.md:43` | ADR 原文：插件装到 `~/.dsh/profiles/opentui` |
| `docs/adr/0009-server-lifecycle-singleton.md:71` | singleton 判据：`ps` cmdline 含 `--profile opentui` |
| `docs/adr/0009-inprocess-session-bridge.md` / `docs/adr/0010-session-seam-lifecycle-contract.md:178` / `docs/architecture/README.md:58` / `docs/architecture/01-system-topology.md:11,38` | 描述两 profile 分工；`:178` 提到 legacy opentui profile 中的历史 preset id |
| `packages/shell/src/client/README.md:38,239,255` | boot 示例与 `DSH_SMOKE_PROFILE=opentui` 示例 |
| `CHANGELOG.md:748,775,1185,1194,1244` | 历史发布记录（**建议保留原文，不重写历史**） |
| `tickets/2026-11-18-inproc-profile-inventory.md:86,230` / `tickets/2026-11-18-m3-append-inventory.md:21-22,43,51,68,86,111` / `tickets/2026-11-19-023-flip-and-sweep-plan.md:32` | 历史决策记录（同上，保留） |
| `research/upgrade-command-20261116/*`、`research/tui-pi-model-switch-parity.md:35,93,106,108`、`research/025-w3-ci-gate-decision.md:29`、`research/2026-11-23-ui-batch/05-settings-runtime-channel-design.md:27-28` | 历史调研事实（保留；若引用旧行号需加注） |

### 2.6 假阳性 — 名字相同但不是 profile 名（**无需改**）

| 文件:行 | 实际含义 |
|---|---|
| `packages/tui-base/src/routes/session/settings-modal.tsx:99,370` | `SETTINGS_SECTIONS` 的 section id `"opentui"` |
| `packages/tui-base/test/settings-panel-panelkit.test.tsx:479,1075` | 断言上述 section id / 测试标题 |
| `packages/tui-base/test/entry-slash-deps.test.ts:30-31` | theme name `"opentui"` |
| `packages/tui-base/src/routes/welcome-hero.tsx:80` | 注释中举例的 profile 名（描述性文字） |
| 全仓 `@opentui/core` / `@opentui/solid` 导入、`dsh-opentui` 包/命令名、`DSH_OPENTUI_*` 环境变量 | 库名/包名/环境前缀，与 profile 名无关；改名会破坏完全不相关的面 |

---

## 三、硬依赖点（0.22–0.24 记录 → 153c8ce 核对）

| 记录点 | 旧版本内容（tag 核对） | HEAD `153c8ce` 实况 | 删 profile 是否必须改 |
|---|---|---|---|
| `v2-entry ≈ :1617` | v0.22–v0.24 该区间是 seam 选择 / `createBridgeSessionSeam` / `BridgeBootstrapError`，**无 profile 字面量**（`v0.24.0:packages/tui-base/examples/v2-entry.tsx:1616-1626`） | `packages/tui-base/examples/v2-entry.tsx:1674-1682` 仍是 seam bootstrap fail-fast；`docs/architecture/01-system-topology.md:38` 引用的就是这里 | **否**（不是 profile 引用） |
| `v2-entry ≈ :1660` | recoverBridge / seam 相关（同上区间），非 profile | `packages/tui-base/examples/v2-entry.tsx:1706-1712` recoverBridge | **否** |
| `v2-entry 真正硬点` | v0.22 `:1555`、v0.23 `:1555`、v0.24 `:1554` 为 `const profile = lifecycle.DEFAULT_PROFILE` | `packages/tui-base/examples/v2-entry.tsx:1609`（同句）；下游 `:1616` ensureV2Host、`:1636` spawnWatchdog、`:1651-1657` HTTP session facade、`:1940` profileName | **是**（改常量或整体退役 HTTP host 路径） |
| `lifecycle ≈ :1079` | v0.22–v0.24 与 HEAD 完全一致：`join(o.dshHome,'profiles',o.profile)` + `ProfileMissingError`，**参数化** | `retired HTTP lifecycle module:1078-1079`；相邻 `:1095` 写 patch | **间接是**：它本身随参数变化；字面量源头在 `:91` / `:1009` 与 spawn `:1113` |
| 其他字面量源头（补充） | 0.22–0.24 已存在且 HEAD 未变 | `client-lifecycle.ts:393,557,657`；`safe-kill.ts:31,151,227`；`host-launch.ts:69,268,549`；`remote-restart.ts:165`；`retired HTTP session facade module:547`；`watchdog-cli.ts:25`；`bin/launcher.mjs:42`；`bin/dsh-opentui.mjs:272,505` | **是**（全部把 `'opentui'` 当默认值或唯一可信号 profile） |

**删 profile 时不可绕过的最小闭环**：`DEFAULT_PROFILE`/`HOST_PROFILE`/`DEFAULT_LAUNCH_PROFILE` 与 6 处 `?? 'opentui'` 必须统一决策；同时 `bridge-session-seam.ts:2273` 与 `local-config-faces.ts` 的文件归属必须重新指定，否则"删除目录"只是让代码继续找（或重建）一个用户不可见的空 profile。

---

## 四、门禁影响

| 门禁 | 是否实际拉起/校验 `opentui` profile | 删 profile 后 |
|---|---|---|
| `.github/workflows/ci.yml` `test` job（`:11-81`） | 否。无全局 dsh，SDK 打 stub，测试全 fake；`host-compat.test.ts` 只调用 inproc provisioner（`:40-46`） | **不失效** |
| `.github/workflows/ci.yml` `test:ft` / `typecheck:entry` / `^verify:`（`:63-81`） | 否 | **不失效**（但若改常量导致类型/断言漂移，需同步测试） |
| `.github/workflows/ci.yml` `real-client` job（`:84-140`） | **是**：job 条件与注释要求自托管 runner 已 provision `~/.dsh/profiles/opentui`（`:88,94,129-134`），preflight `test -d`（`:134`），跑 `agents-mount-client.test.ts`（`:138`） | **失效**：preflight 直接 error；须改 job 前置与测试，或接受该 gate 退役 |
| `.github/workflows/ci.yml` `pack-cold-start` job（`:143-319`） | 否，且明确只用 `PROFILE_DIR=$FRESH_DSH_HOME/profiles/opentui-inproc`（`:237`），`--repair-bridge`（`:294`）在老 profile provision 之前退出 | **不失效**（最关键的发布门禁仍覆盖 inproc 冷启动 + 握手） |
| `.github/workflows/release.yml` | 未发现 profile 相关步骤；只有 pack/registry/verify 类 gate | **不失效** |
| `scripts/real-client-gate.sh` | **是**：preflight `:224`、seed copy `:231`、孤儿检测 `:125-126,156`；握手用 inproc（`:263`） | **失效**：preflight exit 2；可改为拷贝 inproc + 新的用户配置 seed |
| `e2e/families/lib/family-lib.sh:38-46` + `run-all.sh:63-70` | **是**（间接）：每个 family 拷老 profile 到 scratch，verify-gate family 复用 real-client-gate | **失效** |
| `e2e/families/00-pack-gate.sh` | 否（只跑 capcontract 完整性） | **不失效** |
| `legacy client-topology gate (retired)` | **是**：preflight 存在性 + `opentui-host.opentui.json` lock + `pgrep --profile opentui`（`:96,114,166-172`） | **失效**（永远 skip 或误判宿主） |
| `legacy command-surface sweep (retired)` | **是**：seed 老 profile；缺则 skip（`:74`） | **失效/静默 skip** |
| `scripts/test-tier.mjs` 的 `ui`/`e2e` 档 | **是**：老 profile preflight（`:139-140`） | **失效**（exit 2 = 环境缺失，不是测试通过） |
| `verify/*`（8 个脚本） | **是**：全部以老 profile 为模板/lock/config 源（详见 2.4） | **失效**：preflight 退出或 scratch 配置缺失 |
| `packages/shell/test/agents-mount-client.test.ts` | **是**（真机路径） | **失效**（在 CI `real-client` job 中变为 FAIL） |
| 单元测试全量（`for p in packages/*/; do bun test` 等） | 否（都注入 fake fs / scratch home，不碰真 `~/.dsh`） | **不失效**，但断言里的大量 `'opentui'` 字面量需随常量改动同步 |

**结论**：删 profile 不会让默认 CI / 发布门禁变红，但会让**所有真机 gate 与 verify 脚本失去前置条件**；如果不同步修改，会出现"CI 全绿但真机 gate 全红且没有覆盖"的门禁空洞。

---

## 五、本机现状（只读快照，2026-11-24）

| 项 | `~/.dsh/profiles/opentui` | `~/.dsh/profiles/opentui-inproc` |
|---|---|---|
| 目录大小 | 52M | 2.3M |
| `package.json` name | `dsh-profile-opentui` | `dsh-profile-opentui-inproc` |
| `dsh.profile.bundles` | 20 项：`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`，其后 18 项 `@aiwayds/*`（ask-router、dcp、subagent-registry、llm-net-retry、feishu、web-search-anysearch、mcp-adapter、approval-policy、web-search-tavily、llm-proxy、model-sync、llm-stats、topics-memory、cron、workflow、profile-switch、agent-dispatch、vault） | 3 项：`@deepseek-ai/dsh-base`、`@aiwayds/dsh-opentui-bridge`、`@aiwayds/dsh-subagent-registry` |
| `dependencies` | 20 项；19 个精确版本 + 1 个 `link:/Users/qingguee/repo/dsh-workflow` | 仅 `@aiwayds/dsh-subagent-registry: 0.21.0` |
| `cordis.patch.yml` | 存在，19916 B，mtime 11-23 23:33；另有 5 份 `.bak-*` | 存在，15442 B，mtime 11-23 12:56；另有 3 份 `.bak-*` |
| `pnpm-lock.yaml` | 存在，32409 B | 存在，2879 B |
| `node_modules` | 存在（57 项），有 `.modules.yaml`；无 `@deepseek-ai/` 拷贝；`@aiwayds/dsh-workflow` 为 symlink | 存在（6 项），有 `.modules.yaml`；无 `@deepseek-ai/` 拷贝；`@aiwayds/dsh-opentui-bridge` 为**实目录**（v0.1.0，mtime 11-23 23:32） |
| 其他 | `config.json`（525 B）、`upgrade-overrides.json`（509 B）、多份 manifest/patch 备份 | `compatibility.json`（84 B） |

`~/.dsh` 顶层/子目录记录：

- 未发现 `opentui-host*.json` 或任何 registry/lockfile 中含 `"profile":"opentui"` 的记录（递归扫描 JSON/YAML，排除 node_modules 等大目录后仅 6 个文件含 `opentui` 字样，均为上述两个 profile 的 manifest/patch 及 `profiles/web/cordis.patch.yml`、inproc `compatibility.json`）。
- `~/.dsh/opentui-clients/` 有 2 个 heartbeat JSON（pid 80221 / 93878），白名单字段中无 profile 字段；未读取其他字段值。
- `~/.dsh/opentui-host.idle.log` 存在（6207 B，mtime 11-19 10:49）；未读内容。
- **全程只读**：没有写、删、改任何 `~/.dsh` 文件；没有打印凭据或 token。

---

## 六、删 `opentui` profile 的改动面矩阵

| 文件 / 面 | 改动性质 | 说明（关键行） |
|---|---|---|
| `packages/shell/bin/dsh-opentui.mjs` | **删代码** | step 3 老 profile provision `:267-302`；legacy 迁移 `:323-402`；step 6a 预启 HTTP host `:499-528`（尤其 `:505`）；头部/注释 `:20-33,205,261-265,341` |
| `packages/shell/scripts/provision-opentui-profile.mjs` | **删代码** | 整文件退役（`:8-12,111,173-200`） |
| upgrade 子命令 | **批次 2 已退役** | 实现、planner、bin/launcher 分支与专属测试已删除；不改变 inproc companion |
| `packages/shell/scripts/lib/provision-plan.mjs` | **删代码 / 改常量** | `PROFILE='opentui'` `:15`；插件 pin/tier/patch 行 `:29-115,125-159,720-885`；upgrade 消费方已于批次 2 删除 |
| `packages/shell/bin/lib/launcher.mjs` | **改常量 / 删代码** | `PROFILE` `:42`；`classifyProcess` host 判定 `:452-455,482`；help 文案 `:691`。若去掉 HTTP 预启，此面整体退役 |
| `retired HTTP lifecycle module` | **改常量 / 删代码** | `DEFAULT_PROFILE` `:91`；`:1009,1078-1079,1095,1113`。若 HTTP host 整个退役，v1+v2 boot 路径一起删 |
| `packages/shell/src/client-entry.tsx`、`packages/tui-base/examples/v2-entry.tsx` | **改常量 / 删代码** | `client-entry.tsx:258,266-268,298,323,376`；`v2-entry.tsx:1609,1616,1636,1651-1657,1940`。决定 ensureV2Host 是否保留 |
| `packages/shell/src/client/host-launch.ts`、`safe-kill.ts`、`client-lifecycle.ts`、`remote-restart.ts`、`retired HTTP session facade module`、`watchdog-cli.ts` | **改常量** | `:69/268/549`、`:31/151/227`、`:393/557/657`、`:165/258`、`:547`、`:25`；全部把老 profile 当默认值 |
| `packages/shell/src/client/bridge-session-seam.ts`、`local-config-faces.ts` | **改常量 + 设计决策** | `:89/2273/2278-2280/3795-3805`、`:231-232/333/498-499/608-609`。**必须**先定用户配置归属（迁到 inproc 或独立 user profile），否则会与 inproc provisioner 的 patch 收敛冲突 |
| `packages/shell/src/client/append-system.ts` | **改常量 / 保留历史标记** | preset id `:33`、marker `:37` 可保留为惰性元数据；路径函数 `:312-313,349,382-388` 随调用方 profile 变化 |
| `packages/shell/scripts/provision-inproc-profile.mjs` | **无需改（仅注释建议）** | 有硬 guard 只碰 inproc（`:92-95,147`）；老名只在注释/legacy 模板 MD5/文案 `:8,651-653,1313` |
| `packages/shell/src/client/bridge-transport.ts` | **无需改** | 已默认 spawn `--profile opentui-inproc`（`:71,188`） |
| `packages/tui-base/src/routes/session/settings-modal.tsx`、`entry-slash-deps.test.ts` 等 | **无需改** | section id / theme name，假阳性（2.6） |
| `packages/shell/test/*.test.ts`（约 14 个文件，见 2.3） | **改测试** | 字面量与常量断言需同步；`agents-mount-client.test.ts:35-36` 需改前置；`append-system.test.ts` 约 27 处；`lifecycle.test.ts` 约 20 处 |
| `packages/shell/test/provision-inproc-companions.test.ts`、`patch-runtime-merge.test.ts`、`provision-state.test.ts` | **无需改 / 视调用方** | 前两者只涉及 inproc；后者为纯逻辑 |
| `scripts/real-client-gate.sh`、`e2e/families/lib/family-lib.sh` | **改脚本** | `:224,231`（+ `:125-126,156` 孤儿检测）、`:39`。seed 源改为 inproc + 用户配置 |
| `legacy client-topology gate (retired)`、`legacy command-surface sweep (retired).mjs` | **改脚本 / 删代码** | `:96,114,166-172`、`:49,74,94-98,122,365`。若 HTTP host 退役，legacy client-topology gate (retired) 的 host 拓扑断言需重写或删除 |
| `scripts/test-tier.mjs`、`verify/*`（8 个）、`verify/e2e-flows/*` | **改脚本** | 常量、preflight、seed 源、lock 名（见 2.4） |
| `.github/workflows/ci.yml` | **改文档/门禁** | `real-client` job 注释与 preflight `:88,94,129-134`；`test` 与 `pack-cold-start` 无需改 |
| `README.md`、`CONTEXT.md`、`docs/verification-gates.md:39,120`、`docs/testing.md:17`、`docs/adr/0005-client-mode.md:43`、`docs/adr/0009-server-lifecycle-singleton.md:71`、`packages/shell/src/client/README.md` | **改文档** | 产品语义与 gate 前置；`CHANGELOG.md` / `tickets/*` 保留原文；`research/*` 保留历史内容并加退役注记 |
| 本机 `~/.dsh/profiles/opentui` | **不在本次改动范围** | 本任务只读；删除动作须在单独变更中执行，并先完成配置迁移 |

---

## 七、未知项

1. **HTTP host 是否仍承担功能**：`docs/architecture/01-system-topology.md:42` 把 `HTTP client carrier`/`HTTP session facade` 称为独立于 session seam 的"host 客户端层"，`v2-entry.tsx:1616` 仍 `ensureV2Host`；但 bridge 是唯一 session seam（`v2-entry.tsx:1674-1682`）。HTTP host 除 registry/health 外是否仍被实际消费，需运行时/odot 侧确认；本只读调研不启动任何 dsh 进程。
2. **用户配置归属的产品决策**：inproc provisioner 每轮整体收敛 `cordis.patch.yml`（`provision-inproc-profile.mjs:1275-1322`），把本地配置面直接改指向 inproc 会冲突。是迁到 inproc、新增第三个 user profile、还是改为 workspace/config 文件，仓库内没有既定结论。
3. **`dsh` CLI 自身行为**：`dsh --profile <missing>` 是否自动 provision、`dsh opentui --from-default-profile web --dump-config` 生成哪些文件，源码不在本仓（`01-provisioning.md:143`）。删目录后 dsh 是否立即重建，无法从仓库判断。
4. **`upgrade` 子命令去向已决**：批次 2 已退役；不改造为 inproc companion 升级。
5. **历史行号漂移**：`v2-entry ≈ :1617/:1660` 与 `lifecycle ≈ :1079` 的旧记录可能来自 0.22 之前的行号体系或另一文件；本报告按 tag v0.22.0/v0.23.0/v0.23.3/v0.24.0 与 HEAD 逐行核对，结论以本文第三节为准。
6. **未运行的验证**：本任务禁止源码改动与门禁执行，报告中的"失效/不失效"为静态依赖推导，未实跑 CI 或真机 gate。
