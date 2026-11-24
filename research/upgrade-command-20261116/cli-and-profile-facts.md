# dsh-opentui CLI 命令面 / profile 与插件安装机制 — 事实文档

- 调研日期：2026-11-16
- 方法：只读（ls / cat / grep / rg / git log / 读本机已安装产物），未联网、未执行安装、未跑测试、未改任何业务代码。
- 仓库绝对路径：`/Users/qingguee/repo/dsh-opentui`
- 调研时 checkout：分支 `feat/ask-user-redesign`，HEAD `37e7cfe`（2026-11-15），`packages/shell/package.json` version `0.16.0`。

## 0. 仓库定位与排除项

结论：主开发仓是 `/Users/qingguee/repo/dsh-opentui`（含 `.git` 目录的独立 clone；`git worktree list` 把它列为所有 `-wt-*` 目录的宿主）。

- `git rev-parse --show-toplevel` → `/Users/qingguee/repo/dsh-opentui`；`git worktree list` 输出把 `/private/tmp/dsh-baseline`、`/private/tmp/relgate-9427cdc` 和 9 个 `dsh-opentui-wt-*` 都登记为它的 worktree（`/Users/qingguee/repo/dsh-opentui/.git`）。
- 排除 1：`/Users/qingguee/repo/dsh-opentui-spike` — `git rev-parse --show-toplevel` 报 `fatal: not a git repository`，内容是 bun 试验目录（`build.ts`/`src`/`bun.lock`），无 `packages/shell`。
- 排除 2：`/Users/qingguee/repo/dsh-opentui-wt-{1954,dpack-c7,dpack-i18n,fixbase,gap-analysis,gate,release,stopconfirm,test-arch,u4fix}` — 全是上面主仓的 linked worktree（各自 `.git` 是文件，例：`/Users/qingguee/repo/dsh-opentui-wt-release/.git` 79 字节），非独立开发仓。
- 需要知道的工作区分歧：`main` 分支被 checkout 在 worktree `dsh-opentui-wt-release`（HEAD `ff31d6f chore(release): 0.17.3`，`packages/shell/package.json` version **0.17.3**）。主仓当前在 `feat/ask-user-redesign`（0.16.0）。两者 CLI/profile 关键文件**逐字节相同**：`bin/dsh-opentui.mjs`、`bin/lib/launcher.mjs`、`scripts/provision-opentui-profile.mjs`、`scripts/lib/provision-plan.mjs`、`scripts/install-profile.mjs` 用 `diff -q` 对比全部 "same"，`package.json` 仅 version 行不同（0.16.0 vs 0.17.3）。
- 附：本机全局安装的 `@aiwayds/dsh-opentui` 是 0.17.3（`/opt/homebrew/lib/node_modules/@aiwayds/dsh-opentui/package.json`），不是从本仓源码运行的。

---

## 1. CLI 入口与命令注册

### 1.1 bin 指向

结论：发布包的 bin 是 `packages/shell/bin/dsh-opentui.mjs`；包名 `@aiwayds/dsh-opentui`，version 0.16.0。

```json
// packages/shell/package.json:1-8
{
  "name": "@aiwayds/dsh-opentui",
  "version": "0.16.0",
  "license": "Apache-2.0",
  "type": "module",
  "bin": {
    "dsh-opentui": "bin/dsh-opentui.mjs"
  },
```

证据：`packages/shell/package.json:2-8`。根仓 `package.json` 没有 `bin`（`package.json:1-25`，`name: dsh-opentui-monorepo`, `private: true`）。

另有一个**源码树开发用** launcher（不是 bin，不进 npm 包）：`/Users/qingguee/repo/dsh-opentui/dsh-opentui`（bash，20-21 行 `exec bun --preload .../preload.js .../client-entry.tsx "$@"`）。

### 1.2 命令分发方式

结论：**没有子命令分发，也没有任何框架**（无 commander/yargs/cac）。只有两个 bin 级 flag `--version` / `--force` 在 bin 内部被吃掉，其余 argv 原样转发给 client 进程。

```js
// packages/shell/bin/lib/launcher.mjs:51-68
export function parseLauncherArgs(argv) {
	const args = Array.isArray(argv) ? argv : []
	let version = false
	let force = false
	const rest = []
	for (const arg of args) {
		if (arg === '--version') { version = true; continue }
		if (arg === '--force') { force = true; continue }
		rest.push(arg)
	}
	return { version, force, rest }
}
```

证据：`packages/shell/bin/lib/launcher.mjs:51-68`（纯函数，只识别两个 token）；调用点 `packages/shell/bin/dsh-opentui.mjs:73`。

### 1.3 现有"命令/flag"全表及处理位置

| 名字 | 归属 | 处理位置 | 行为 |
|---|---|---|---|
| `--version` | bin | `packages/shell/bin/dsh-opentui.mjs:75-83` | 读自身 package.json version，打印 `dsh-opentui <version>`，exit 0，**先于** bun/dsh 检查、provision、TUI |
| `--force` | bin | `packages/shell/bin/dsh-opentui.mjs:100-110` | 用 `ps -A -o pid=,ppid=,command=` + `ps eww -A -o pid=,args=` 选同 (DSH_HOME, profile) 的陈旧 host/client，TERM→KILL（`bin/lib/launcher.mjs:90-171,195-...`） |
| `--provider` / `--model` / `--reasoning-effort` | bin→provision | 透传组装 `packages/shell/bin/dsh-opentui.mjs:118-122`；消费 `packages/shell/scripts/provision-opentui-profile.mjs:126-128` | 写 profile 的模型路由 |
| `--plugins=core\|recommended\|none`（也接受 `--plugins <v>`） | bin→provision | 透传 `packages/shell/bin/dsh-opentui.mjs:123-129`；消费 `provision-opentui-profile.mjs:130`、`provision-plan.mjs:119-139` | 选插件档位；环境变量 `DSH_OPENTUI_PLUGINS` 等价 |
| `--dry-run`（或 `DSH_PROVISION_DRY_RUN=1`） | bin→provision | 透传 `packages/shell/bin/dsh-opentui.mjs:130`；`provision-plan.mjs:129-131` | 只打印将执行的命令 |
| `--new` / `--resume-last` / `--session <id>` / `--session=<id>` | client（tui-base） | 解析 `packages/tui-base/src/routes/session/auto-resume.ts:64-93`；消费者 `packages/tui-base/examples/v2-entry.tsx:1319` | 启动时的会话恢复选择；其它 argv 一律忽略 |
| `--client` / `--v2` / `--plugin` | 已退役别名 | 仅文档性提及 `packages/shell/src/client-entry.tsx:4-9,336` | 没有解析代码；因为 client 只挑 `--new/--resume-last/--session`，它们实际是被忽略的无效参数 |

结论：**不存在 `onboard`、`install`、`upgrade`、`login` 之类的 CLI 子命令**。全仓 `rg -i onboard` 只命中 e2e 场景 `e2e/scenarios/80-onboard.sh`、`e2e/scenarios/run-all.sh:21` 和 UI 里的 onboarding 侧栏（`packages/tui-base/src/feature-plugins/sidebar/footer.tsx:9-51`）；`rg "process\.argv"` 在源码里只有 `packages/shell/bin/dsh-opentui.mjs:73`、两个 scripts、`packages/tui-base/examples/v2-entry.tsx:1286`。

### 1.4 bin 的固定启动链（顺序即语义）

```js
// packages/shell/bin/dsh-opentui.mjs:85-93
if (!spawnSync('which', ['bun'], { encoding: 'utf8' }).stdout.trim()) {
  exitWithGuidance('bun', 'npm i -g bun')
}
if (!spawnSync('which', ['dsh'], { encoding: 'utf8' }).stdout.trim()) {
  exitWithGuidance('the dsh CLI', 'npm i -g @deepseek-ai/dsh')
}
```

完整链路：0 `--version` 短路（75-83）→ 1 bun 检查（86-88）→ 2 dsh 检查（91-93）→ 2.5 `--force` 清场（100-110）→ 3 profile 自举，spawnSync `node scripts/provision-opentui-profile.mjs`（116-141，非零只 WARN 139-140）→ 4 一次性 legacy 迁移（144-159）→ 5 `@deepseek-ai/dsh-client-connection` 软链保证（236-266）→ 6 `spawnSync('bun', [dist/client/index.js, ...userArgs], {stdio:'inherit'})`（303-316）。
证据：`packages/shell/bin/dsh-opentui.mjs:1-49`（顶部链路注释）+ 上述行号。

---

## 2. argv 解析与帮助文案

结论：**没有统一 usage/help 文本，也没有 `--help` 分支**。全仓 `rg -n "argv|--help|usage|Usage:"` 在 `packages/shell/{src,bin,scripts}` 的命中只有 `bin/dsh-opentui.mjs:73`、`bin/lib/launcher.mjs:45-68`、`scripts/*.mjs` 的 flags 解析和 `launcher.mjs` 注释，不含 usage 字符串。唯一的"用法文档"是 README 与 bin 顶部注释。

- `packages/shell/bin/dsh-opentui.mjs:1-49` — 启动链注释（无 flag 表）。
- `README.md:23-34` / `packages/shell/README.md:23-34`（两文件 `diff -q` 完全相同）— 只有 `npm i -g @aiwayds/dsh-opentui` + `dsh-opentui`。
- `README.md:42-53` — 只描述 `--provider/--model/--reasoning-effort`、`--plugins`、`--dry-run`、`--resume-last/--new/--session`。

加一个新子命令（例如 `upgrade`）在当前结构下要动的地方（逐处，均为"因为代码在这里处理 argv 或发布清单在这里"）：

1. `packages/shell/bin/lib/launcher.mjs:51-68` `parseLauncherArgs` —— 目前只返回 `{version, force, rest}`；要么在这里加第三个 token，要么新增独立解析函数（该文件是唯一被单测直接 import 的纯逻辑层，见 `packages/shell/test/bin-launcher.test.ts:11-21`）。
2. `packages/shell/bin/dsh-opentui.mjs:73` —— 消费解析结果的唯一位置；新分支必须放在 `--version` 短路之后、bun/dsh 检查之前或之后需自行决定（现无此先例）。
3. `packages/shell/bin/dsh-opentui.mjs:116-130` —— 现有"从 userArgs 里挑 flag 转发"的循环；若不希望新子命令的参数被透传给 provision/client，必须在此排除。
4. `packages/shell/bin/dsh-opentui.mjs:309` —— 兜底 `spawnSync('bun', [clientEntry, ...userArgs])`，未消费的 token 会被当作 client argv 传下去（client 只认 `--new/--resume-last/--session`，其余静默忽略，`auto-resume.ts:64-93`）。
5. `packages/shell/package.json:9-19` `files` 白名单 —— 只发 `bin`、`scripts`、`dist/client`、`dist/scripts`、`dist/locales`、README/LICENSE/NOTICE/CHANGELOG。新命令若放在 `bin/` 或 `scripts/` 之下自动随包；放到别处不会发布。
6. `packages/shell/package.json:20-24` `scripts.prepack` —— 打包前会跑 `build-client.mjs` + `verify-pack-locales.mjs` + `pack-meta.mjs`，新脚本若依赖构建产物需在此串接。
7. `packages/shell/test/bin-launcher.test.ts:27-47` —— `parseLauncherArgs` 的行为契约（含"不吞掉 lookalike 参数"），改解析必改此测试。
8. `README.md:42-58` / `packages/shell/README.md` 同段 —— 用户可见的启动行为说明（两处是同一份内容的两份拷贝，`diff -q` 无差异）。
9. `e2e/scenarios/10-install.sh:29` 起的安装场景与 `e2e/scenarios/run-all.sh:21` 的 `E2E_SCENARIOS` 清单 —— 若新命令需要端到端覆盖，入口在这两处。

（以上是"代码位置事实"，不含实现建议。）

---

## 3. profile 的物理结构

结论：产品 profile 固定名 `opentui`，目录 `$DSH_HOME/profiles/opentui`（`DSH_HOME` 缺省 `~/.dsh`）。

- profile 名常量：`packages/shell/scripts/lib/provision-plan.mjs:9`（`export const PROFILE = 'opentui'`）、`packages/shell/bin/lib/launcher.mjs:37`。
- 路径推导：`packages/shell/scripts/provision-opentui-profile.mjs:146-148`；bin 侧 `packages/shell/bin/dsh-opentui.mjs:58,116`。
- "只碰 opentui 一个 profile"的硬约束：`provision-opentui-profile.mjs:66`。

本机实际内容（`~/.dsh/profiles/opentui`，只读列举）：

```
config.json                  # 27 行：retentionDays/theme/skinMigration/slashUsage/footerHints/lang
cordis.yml                   # 3 行注释 + "[]"（空根，组合全靠 patch）
cordis.patch.yml             # 11539 字节，模型路由/tool-web/web/mcp 等 entry
cordis.patch.yml.bak-*       # 5 份历史备份
node_modules/                # 51 项，hoisted 实目录
package.json                 # 1716 字节
package.json.bak-*           # 3 份备份
patches/solid-js@1.9.17.patch
pnpm-lock.yaml               # 32281 字节（存在）
pnpm-workspace.yaml          # 498 字节
pnpm-workspace.yaml.bak-1794450175
.plugin-manager/logs/operation-*/pnpm.log   # 宿主插件管理器操作日志（抽样文件为 0 字节）
```

同样存在兄弟 profile：`~/.dsh/profiles/{tui,web}`，以及**父级共享 `node_modules` 农场** `~/.dsh/profiles/node_modules`（219 个顶层条目，`@deepseek-ai/` 下 234 项，全部是指向全局 dsh 闭包的软链，例：`@deepseek-ai/dsh -> /opt/homebrew/lib/node_modules/@deepseek-ai/dsh`）——注意 `opentui/node_modules` 里**没有** `@deepseek-ai/` 目录，解析靠 Node 向父目录查找命中该农场。

### 3.1 profile 的 package.json（依赖声明形态）

结论：依赖写**精确版本号**（不带 `^`/`~`，不是 `latest`），唯一例外是一个本地 `link:` 规格；bundle 清单自维护在 `dsh.profile.bundles`（当前 20 项），无 `version`、`private: true`。

```json
// ~/.dsh/profiles/opentui/package.json:1-6,30-33,50
{
  "name": "dsh-profile-opentui",
  "private": true,
  "dsh": {
    "profile": {
      "bundles": [ ... 20 项 ... ]
  "dependencies": {
    "@aiwayds/dsh-agent-dispatch": "0.3.1",
    "@aiwayds/dsh-approval-policy": "0.3.0",
    "@aiwayds/dsh-ask-router": "0.7.0",
    ...
    "@aiwayds/dsh-workflow": "link:/Users/qingguee/repo/dsh-workflow"
```

- 依赖块：`~/.dsh/profiles/opentui/package.json:30-51`（20 个 dep；19 个精确版本 + 1 个 `link:`）。
- bundles：`~/.dsh/profiles/opentui/package.json:6-27`（20 项，前两项是宿主 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`，其余 18 是 `@aiwayds/*`）。
- `pnpm-lock.yaml` 存在（`~/.dsh/profiles/opentui/pnpm-lock.yaml`，32281 字节，mtime 2026-11-15 17:18），由 profile 内的 pnpm 安装写出。
- 工作区配置：`~/.dsh/profiles/opentui/pnpm-workspace.yaml:1-18` —— `packages: [.]`、`nodeLinker: hoisted`、`autoInstallPeers: false`、`allowBuilds:` 逐包白名单（`dsh-vault: false`）。

### 3.2 本仓自维护的插件清单（产品侧真源）

结论：产品侧插件清单在 `packages/shell/scripts/lib/provision-plan.mjs`，不是 profile 里的 bundles。当前 12 个包（7 core + 5 recommended），全部**精确版本字符串**；另有 8 条显式排除清单和 1 条退役清单。

```js
// packages/shell/scripts/lib/provision-plan.mjs:23-28, 96, 115
export const PLUGIN_SET = [
  {
    name: '@aiwayds/dsh-ask-router',
    version: '0.7.0',
    tier: 'core',
    reason: 'owns the ask surface; must load before any other UI/ask bundle',
  },
  ...  // 共 12 项
]
export const EXCLUDED_PLUGINS = [ ... 8 项 ... ]   // 100-109
export const RETIRED_PROFILE_ENTRIES = ['@aiwayds/dsh-opentui']  // 115
```

- 12 项全表：`provision-plan.mjs:23-96`（`ask-router 0.7.0`、`subagent-registry 0.20.0`、`llm-net-retry 0.8.0`、`web-search-anysearch 0.9.0`、`mcp-adapter 0.8.0`、`approval-policy 0.3.0`、`model-sync 0.9.0` / `llm-stats 0.9.0`、`topics-memory 0.26.0`、`cron 0.7.0`、`workflow 0.2.1`、`vault 0.8.0`）。
- 排序契约（ask-router 必须第一）：`provision-plan.mjs:19-22`。
- 档位：`provision-plan.mjs:12-13`（`DEFAULT_TIER='recommended'`，`TIERS=['core','recommended','none']`）、`135-139`。
- README 里同一张表（文档副本）：`README.md:65-88`。

**未能确认项**：任务提到的"21 bundles 那个配置"在本仓未找到。全仓 `rg "21 bundles|21 个 bundle"` 无命中；profile 当前 bundles 是 20 项；产品清单是 12 项。若"21"指某个历史版本或另一台机器，本仓 git 历史/文档中没有对应数字的证据。

---

## 4. 插件/包的实际安装方式

### 4.1 产品路径：不直接调 pnpm/npm，而是 `dsh plugin --profile opentui add`

结论：本仓代码把安装**委托给宿主 dsh CLI**，只用 spawnSync 拼一条 `dsh plugin --profile opentui add <spec...>`。

```js
// packages/shell/scripts/provision-opentui-profile.mjs:362-373
function runPluginAdd(specs, { captureStderr = false } = {}) {
  return spawnSync('dsh', pluginAddArgs(PROFILE, specs), {
    stdio: captureStderr ? ['inherit', 'inherit', 'pipe'] : 'inherit',
    env: { ...process.env, DSH_HOME: dshHome },
    timeout: INSTALL_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  })
}
```

```js
// packages/shell/scripts/lib/provision-plan.mjs:147-149
export function pluginAddArgs(profile, specs) {
  return ['plugin', '--profile', profile, 'add', ...specs]
}
```

- argv 形态：`['plugin', '--profile', 'opentui', 'add', '@aiwayds/x@1.2.3', ...]`（`provision-plan.mjs:147-149`）；spec 由 `installSpecs` 拼成 `name@exactVersion`（`provision-plan.mjs:142-144`，被用于 `install` 计划的 `spec` 字段 `381`）。
- **没有 workdir 参数**（`provision-opentui-profile.mjs:362-373` 只有 `stdio/env/timeout/maxBuffer`）——子进程继承调用者的 cwd（即用户当前工作区），不是 profile 目录。
- **没有 `--frozen-lockfile` / `--ignore-scripts` / `--registry` 等 pnpm flag**：这些 flag 不在本仓代码里；仓库只传 `dsh plugin` 的四个 token。
- 调用点：批次安装 `provision-opentui-profile.mjs:412`；失败后逐包重试 `429-451`（3 次、间隔 5s：`114-115`），重试前会写/修 `pnpm-workspace.yaml` 的 `allowBuilds`（`345-360`）。
- 超时 10 分钟：`provision-opentui-profile.mjs:103`。
- 结果全部记 WARN，不阻塞启动：`455-462`，以及 bin 侧 `138-140`。

宿主侧（**非本仓代码**，本机全局 dsh 0.2.2-rc.3，仅作机制佐证）：
- `dsh plugin` 把参数原样交给 pnpm，profile 目录作为工作目录：`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/src/plugin.ts:17,67-71,93-99`（`exitCode===127` 时提示 "pnpm was not found"）。
- 版本/兼容检查用 `pnpm view`：`.../node_modules/@deepseek-ai/dsh-plugin-manager/src/operations.ts:173,193`（`view <spec> name version engines peerDependencies --json`）。
- 宿主把 pnpm 日志写到 profile 的 `.plugin-manager/logs/operation-*/pnpm.log`（本机存在 18+ 个 operation 目录，抽样 `pnpm.log` 为 0 字节，**具体 pnpm argv 不可见** → 标为未确认）。

### 4.2 遗留路径：`scripts/install-profile.mjs`（已不可运行）

结论：仓里仅存的"直接跑 pnpm"的产品脚本是 `packages/shell/scripts/install-profile.mjs`，它 `import './solid-js-pin.mjs'`，而该文件**不存在**，所以当前状态是死脚本。

```js
// packages/shell/scripts/install-profile.mjs:122-131
const pnpm = (() => {
  try {
    execFileSync('pnpm', ['--version'], { stdio: 'pipe' })
    return ['pnpm']
  } catch {
    return ['npx', '-y', 'pnpm@10.18.3']
  }
})()
run(pnpm[0], [...pnpm.slice(1), 'install'])
run(pnpm[0], [...pnpm.slice(1), 'install'])
```

- 实际 argv：`pnpm install`（连跑两次）或 `npx -y pnpm@10.18.3 install`；无任何额外 flag（无 `--frozen-lockfile`、无 `--ignore-scripts`、无 `--registry`）。
- workdir：`packages/shell/scripts/install-profile.mjs:117`（`cwd: profileDir`）。
- 目标目录是**退役的** `profiles/dsh-opentui`：`install-profile.mjs:34`。
- 缺失依赖：`install-profile.mjs:25` `import { ensureSolidPatch, pinSolidJsDependency, pinSolidJsExports } from './solid-js-pin.mjs'`；`ls packages/shell/scripts/solid-js-pin.mjs` → `No such file or directory`。
- 仍被文档/注释引用：`e2e/lib/common.sh:77`、`e2e/scenarios/80-onboard.sh:8,16`、`e2e/Containerfile:5`。

### 4.3 测试/验证路径里的 pnpm

- e2e 容器内直接 pnpm（在 profile 目录装 bake 出来的依赖）：`e2e/lib/common.sh:224-226`

```bash
  if (( baked )); then
    pnpm --dir "$FACE_HOME/profiles/$FACE_PROFILE" install \
      --registry="${E2E_NPM_REGISTRY:-https://registry.npmjs.org}" || return 1
  fi
```

- e2e bake 脚本只改 manifest，不装包：`e2e/lib/bake-subagent-registry.mjs:37-42`（`pkg.dependencies[REGISTRY]=VERSION` + bundles push），注释明确"Deliberately NOT `dsh plugin add`"：`bake-subagent-registry.mjs:10-16`。
- e2e 安装腿用 npm 装 tarball：`e2e/scenarios/10-install.sh:53`（`npm pack`）、`74` 与 `171`（`npm install -g --ignore-scripts --no-fund --no-audit --registry "$NPM_REG" "$TARBALL"`）。

### 4.4 node_modules 软链 / hoist 处理

- profile 用 pnpm **hoisted** 布局：`~/.dsh/profiles/opentui/pnpm-workspace.yaml:4`（`nodeLinker: hoisted`）、`5`（`autoInstallPeers: false`）；`opentui/node_modules/.modules.yaml` 首行即 `"hoistPattern": ["*"]`。
- `@aiwayds/*` 是**实目录**（非软链），唯一软链依赖是 `link:` 规格：`opentui/node_modules/@aiwayds/dsh-workflow -> ../../../../../repo/dsh-workflow`。
- 父级"软链农场"：`~/.dsh/profiles/node_modules`（219 项；`@deepseek-ai/*` 234 项全部 symlink 到 `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/...`）。`opentui/node_modules` 无 `@deepseek-ai/`，靠 Node 父目录查找命中该农场。**谁创建该农场本仓未找到证据**（本仓无相关代码；全仓 `rg "profiles', 'node_modules|profiles/node_modules"` 仅命中 `verify/e2e-flows/setup-home.mjs:135` 的测试用软链）→ 标为未确认；宿主源码里把它称作 "shared profiles tree"（`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-app-boot/src/profile.ts:135-148,257-270`）。
- 本仓自己创建的软链只有一处：bin 把 `@deepseek-ai/dsh-client-connection` 从全局 dsh 闭包链进**包根** `node_modules/@deepseek-ai/`（`packages/shell/bin/dsh-opentui.mjs:224-266`，候选路径解析 `269-300`，幂等检查 `241`）。

---

## 5. 版本解析现状

结论：仓里只有"读本地已装版本"的两个函数；**没有任何"查询 npm registry 最新版"的产品代码**。

有的（本地版本读取）：
- 读 launcher 自身版本：`packages/shell/bin/lib/launcher.mjs:76-83`（`readLauncherVersion(pkgRoot)` → `package.json.version`），唯一消费点 `bin/dsh-opentui.mjs:76-82`。
- 读 profile 内某包已装版本：`packages/shell/scripts/provision-opentui-profile.mjs:206-212`

```js
function installedVersion(name) {
  try {
    return JSON.parse(readFileSync(join(profileDir, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')).version
  } catch {
    return undefined
  }
}
```

- 版本比较工具（自写 semver 子集：exact/`^`/`~`/`>=`）：`packages/shell/scripts/lib/provision-plan.mjs:278-336`（`parseVersion`/`compareVersions`/`satisfiesVersion`）。
- 依赖当前值的来源是 profile `package.json` 的 `dependencies` 字段：`provision-opentui-profile.mjs:201-204,395`。

没有的（明确"无"）：
- 无 `npm view` / `pnpm view` / registry HTTP 查询（全仓 `rg "npm view|dist-tags|registry.npmjs"` 的产品代码零命中；命中的只有 e2e：`e2e/run-e2e.sh:24-30` 用 `npm view @deepseek-ai/dsh@latest|@next version` 只为构建测试镜像，`e2e/scenarios/*.sh` 里的 `npm pack` 是 fixture）。
- 无"最新版"概念：`satisfiesVersion` 对字符串 `'latest'` 直接返回 true（`provision-plan.mjs:320`），仅此一处提到 latest。

关键行为：PLUGIN_SET 用的是精确版本，而 `satisfiesVersion(installed, exact)` 是 `cmp === 0`，所以**已装版本比 pin 新也算不满足**，会被重新安装回 pin。

```js
// packages/shell/scripts/lib/provision-plan.mjs:316-335（节选）
export function satisfiesVersion(installed, wanted) {
  const got = parseVersion(installed)
  if (!got) return false
  const wantedText = String(wanted ?? '').trim()
  if (wantedText === '' || wantedText === '*' || wantedText === 'latest') return true
  ...
  return cmp === 0
}
```

证据：`provision-plan.mjs:316-336`；行为契约单测 `packages/shell/test/provision-plan.test.ts:97-107`（`expect(satisfiesVersion('0.7.1','0.7.0')).toBe(false)`）；计划函数 `provision-plan.mjs:370-395`（不满足就进 `install`）。

---

## 6. 兼容窗口 / 版本约束

### 6.1 本仓声明了什么

结论：本仓**没有**声明任何宿主版本兼容区间——没有 `peerDependencies`，没有自定义 compat range，`engines` 只约束 Node/Bun。

```json
// packages/shell/package.json:25-43（节选）
  "dependencies": {
    "@opentui/core": "0.8.1", "@opentui/solid": "0.8.1", "@opentui/keymap": "0.8.1",
    "solid-js": "1.9.17", "ws": "^8.22.1"
  },
  "devDependencies": {
    "typescript": "^5.7.0", "@types/bun": "latest", "@deepseek-ai/cordis": "4.1.0",
    "@deepseek-ai/dsh-llm": "0.2.2-rc.1", "@deepseek-ai/schemastery": "~3.19.0",
    "@dsh-opentui/runtime": "workspace:*"
  },
  "engines": { "node": ">=26.4.0", "bun": ">=1.3.14" }
```

- `packages/shell/package.json:25-43`；本仓所有 `package.json` 无 `peerDependencies` 字段（全仓 `rg "peerDependencies"` 的命中只有 `CHANGELOG.md:402` 的一句历史说明）。
- 历史明文：`CHANGELOG.md:402` — "no peerDependencies are declared in this workspace, so no floors involved"。
- 运行时也不校验宿主版本，只校验存在性：`packages/shell/bin/dsh-opentui.mjs:91-93`（`which dsh`）。
- 设计上"宿主升级与 TUI 发布解耦"：`docs/adr/0005-client-mode.md:68`。
- 唯一的版本耦合来自**运行时 import 宿主的私有 SDK**：client bundle 在运行时 import `@deepseek-ai/dsh-client-connection/client`，bin 把它软链到"当前全局 dsh 闭包里那个版本"（`packages/shell/bin/dsh-opentui.mjs:224-266`；bundle 侧 `scripts/build-client.mjs:28-36`）。
- 已知风险记录（非门禁）：`docs/client-mode-protocol-audit.md:183-185` — "Version skew — strict Typert descriptor validation fails hard on TUI/host mismatch; needs a startup compatibility check and a documented pin."（当前**没有**这个 startup check）。

### 6.2 宿主侧的兼容门（外部事实，本机全局 dsh 0.2.2-rc.3）

结论：宿主会检查**插件**声明的 `engines.dsh`（优先）或 `peerDependencies` 里 `@deepseek-ai/dsh`/`@deepseek-ai/dsh-*` 的区间，semver 判定、含 prerelease；不满足则拒绝安装/加载，除非有 exact 版本豁免。

```ts
// /opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-app-boot/src/plugin-compatibility.ts:51-53,55-74（节选）
function satisfies(runtimeVersion: string, range: string): boolean {
  return range.trim() !== '' && semver.satisfies(runtimeVersion, range, { includePrerelease: true })
}
function unmetRequirements(fields: Record<string, unknown>, runtimeVersion: string): Record<string, string> {
  const engines = ... 
  if (Object.hasOwn(engines, 'dsh')) { ... return satisfies(runtimeVersion, range) ? {} : { 'engines.dsh': range } }
  ...
  if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) continue
  ... if (!satisfies(runtimeVersion, requirement)) unmet[name] = range
```

- 定义与判定：`.../dsh-app-boot/src/plugin-compatibility.ts:51-74`、`87-102`；"own `engines.dsh` 决定一切并忽略 peers"：同文件 `76-82` 注释。
- 豁免机制：`dsh plugin --profile <p> allow-version <pkg>@<ver> --dsh-version <v> --accept-risk`（`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/src/plugin.ts:17-55,100-102`），豁免落在 profile 的 `compatibility.json`（`.../dsh-app-boot/src/profile-compatibility.ts:10`）。本机 `~/.dsh/profiles/opentui/compatibility.json` **不存在**（`ls -a` 无 compat 文件）→ 当前无任何豁免。

### 6.3 本机插件实际声明的区间（升到 npm 最新版会不会越界）

结论（事实）：`~/.dsh/profiles/opentui/node_modules/@aiwayds/*` 的 20 个插件**全部没有 `engines.dsh`**，peer 区间全是**只有下界、没有上界**的 `>=`：

| 包 | 版本 | peer 区间（节选） |
|---|---|---|
| dsh-ask-router | 0.7.0 | `@deepseek-ai/dsh: >=0.2.0-rc.2` |
| dsh-approval-policy | 0.3.0 | `>=0.2.0-rc.2` |
| dsh-subagent-registry | 0.20.0 | 15 个 peer，均为 `>=0.2.0-rc.2 \|\| >=0.2.1-rc.1` |
| dsh-cron / dsh-llm-* / dsh-mcp-adapter / dsh-model-sync / dsh-topics-memory / dsh-vault / dsh-web-search-* / dsh-workflow / dsh-feishu / dsh-jev-core | 见下 | 同类 `>=` 下界（feishu: `>=0.2.2-rc.1`；jev-core: 无 peer） |

证据：逐包 `package.json` 读取（`~/.dsh/profiles/opentui/node_modules/@aiwayds/<pkg>/package.json` 的 `engines`/`peerDependencies` 字段；本机实测汇总）。宿主当前是 `0.2.2-rc.3`，`semver.satisfies('0.2.2-rc.3', '>=0.2.0-rc.2', {includePrerelease:true})` 为真。

判断（依据上述事实）：
1. **plugin 侧不设上界**，所以"插件升到 npm 最新版"不会越过任何*已声明*的兼容区间；宿主门只会因为**下界**（例如未来插件要求 `>=0.3.0`）而拒装。
2. **launcher 自身（`@aiwayds/dsh-opentui`）没有任何声明式区间**，宿主对它的兼容检查也无从触发（它不是 bundle：无 `dsh.bundle`，`packages/shell/package.json:1-43` 无 `dsh` 字段）。它与宿主真正的耦合是运行时的 `dsh-client-connection` 私有 SDK（`bin/dsh-opentui.mjs:224-266`），以及 `docs/client-mode-protocol-audit.md:183-185` 记录的"strict Typert descriptor 校验会对 TUI/host 版本不匹配硬失败，且尚无 startup 检查"。
3. 因此"升到 npm 最新版是否会越过兼容区间"的答案是：**不会触发本仓/插件清单里的任何区间（因为不存在上界）**；但它会**改变一个未声明的隐式契约**——client bundle 引用的 `dsh-client-connection` 版本随全局 dsh 变化（bin 是"链当前全局 dsh 闭包"），而仓内没有针对该契约的版本校验或门禁（`bin/dsh-opentui.mjs:91-93` 只查存在性）。是否接受这个未约束面，需要用户拍板。
4. 另一个方向的事实（与"升级"语义直接冲突）：provisioner 会把 profile 里**比 pin 新**的插件重新装回 pin（`provision-plan.mjs:316-336,370-395`；单测 `provision-plan.test.ts:98`）。所以"升级插件"在当前设计下不是改 profile，而是改 `PLUGIN_SET` 的精确版本（`provision-plan.mjs:23-96`）。

---

## 7. 测试与门禁基础设施

### 7.1 单测框架与目录

结论：`bun test`（`bun:test`），测试文件与源码同包存放（`packages/*/test` 或 `packages/*/src/**`），根 `package.json` 用 `scripts/test-tier.mjs` 做四层分层。

- 框架引用：`packages/shell/test/bin-launcher.test.ts:6`（`import { describe, expect, test } from 'bun:test'`）。
- 根脚本：`package.json:14-24`（`build`/`test`/`test:unit`/`test:ft`/`test:ui`/`test:e2e`/`test:all`/`test:list`/`typecheck`/`typecheck:entry`/`verify:assembly`）。
- 分层器：`scripts/test-tier.mjs:1-12`（层定义与 `unit|ft|ui|e2e|all|list`）；归类规则 `41-72`；unit/ft 逐包 `bun test`（`114-119`）；环境缺失 exit 2（`153-160`）。
- 与 CLI/profile 直接相关的测试：`packages/shell/test/bin-launcher.test.ts`（20 个 `test(`）、`packages/shell/test/provision-plan.test.ts`（46 个 `test(`）、`packages/shell/test/provision-plan.test.ts:253,278`（`nodeLinker: hoisted` 断言）。
- shell 包内测试目录：`packages/shell/test/`（40 个文件，含 `client-entry.test.ts`、`lifecycle.test.ts`、`remote-*.test.ts`）。

### 7.2 e2e 场景开关

- 场景清单与 `E2E_SCENARIOS` 覆盖：`e2e/scenarios/run-all.sh:21`（默认 20 个场景：`10-install 20-start 22-search 30-commands 40-mock-llm 50-resize-exit 60-ask-user 61-btw 62-hard-stop 63-cache-hit 64-session-stats 65-jev-attention 66-preset 67-theme 68-resume 69-login 70-steer 71-search 72-agents 80-onboard`）。
- 宿主侧容器驱动：`e2e/run-e2e.sh:24-45`（解析 dsh 版本）、`62-76`（`E2E_FACE=client` 校验、`E2E_SCENARIOS` 透传、`podman run ... bash /e2e/scenarios/run-all.sh`）。
- 轻量客户端驱动：`e2e/run-client-e2e.sh:17-23`（`-v $REPO_ROOT:/repo:ro`、`E2E_SCENARIOS` 默认 `20-start`）。
- 层入口：`scripts/test-tier.mjs:175-214`（e2e = 本地 flows `verify/e2e-flows/run-flows.mjs` + 可选 live `DSH_E2E_LIVE=1` + 容器套件 `bash e2e/run-e2e.sh`；`DSH_E2E_PODMAN=0` 则 exit 2 并声明"不是通过"）。
- 其他开关：`E2E_FACE`（`e2e/lib/common.sh:119-121`，plugin 被拒）、`E2E_NPM_REGISTRY`（`10-install.sh:38`、`common.sh:226`）、`DSH_PROVISION_DRY_RUN`（`provision-plan.mjs:130`）、`DSH_OPENTUI_PLUGINS`（`provision-opentui-profile.mjs:130`）。

### 7.3 打包后安装验证脚本（npm pack → 装到临时 prefix → 跑起来）

结论：**有**，就是 e2e 场景 `10-install`（容器内跑；宿主机会自我 skip）。

- 场景声明：`e2e/scenarios/10-install.sh:29` — `scenario 'install (npm pack -> global install -> client bin -> idempotent reinstall)'`。
- 腿 1 打包：`10-install.sh:52-60`（`cd $PKG_DIR && npm pack --pack-destination /tmp/install-pkg`，走 `prepack`）。
- 腿 2 全局安装：`10-install.sh:74`（`npm install -g --ignore-scripts --no-fund --no-audit --registry "$NPM_REG" "$TARBALL"`），然后 `82-88` 断言 bin 可解析。
- 腿 3 真启动：`10-install.sh:96-165`（若 `dist/client/index.js` 存在，在 `DSH_HOME=/tmp/install-boot-home` 下 tmux 启动 bin，600s 超时 `125`，断言 composer/provider 标记 `127-130`，并校验 `PLUGIN_SET` 全部 pin 且 node_modules 可解析 `139-161`）。
- 腿 4 幂等重装：`10-install.sh:167-176`。
- 打包契约：`packages/shell/package.json:23`（`prepack` = build-client + verify-pack-locales + pack-meta）、`scripts/verify-pack-locales.mjs:1-13`、`packages/shell/scripts/pack-meta.mjs:1-17`。
- 注意：`10-install.sh:40-44` 在非容器报 `warn 'host environment detected — skipping'` 并 `summary; exit 0`。

### 7.4 其他常驻门禁

- Legacy command-surface sweep and client-topology gates: retired in T12 Batch 1; no longer runnable.
- ui 层三条脚本：`scripts/test-tier.mjs:162-173`（`verify/ui-matrix.mjs`、`verify/agents-mount-repro.mjs`、`verify/text-leak-audit.mjs`）。
- 打包产物语言审计：`verify/text-leak-pack-audit.mjs`（存在；`CHANGELOG.md:17` 提到 prepack 校验打包产物）。

---

## 8. 文档面与版本号

### 8.1 安装 / 升级的既有描述

结论：文档只描述"安装 + 每次启动自举修复"，**没有升级流程描述**（没有 `upgrade`/`self-update` 字样；`rg -i "upgrade|self-update"` 在产品文档里只命中"升级 @opentui 依赖"和"dsh 升级风险"语境）。

- 安装：`README.md:23-34`（= `packages/shell/README.md:23-34`）

```
## Install
Prerequisites:
- [Bun](https://bun.sh) >= 1.3.14 (`npm i -g bun`) — the client bundle's runtime
- The dsh CLI (`npm i -g @deepseek-ai/dsh`) — the session carrier (profile storage, config, model access)
- Node >= 26.4 — runs the `dsh-opentui` launcher itself

npm i -g @aiwayds/dsh-opentui
dsh-opentui
```

- 每次启动做的事（自举/插件/迁移/SDK 链接）：`README.md:42-58`。
- 插件收敛规则（"三处一致才算装好"，含 `dsh plugin --profile opentui add`）：`README.md:110-116`
- 跳过插件：`README.md:118-134`（`--plugins=none` / `DSH_OPENTUI_PLUGINS=none` / 之后可自行 `dsh plugin --profile opentui add <pkg>`）。
- 开发流程：`README.md:164-171`（`npx pnpm@10.18.3 install`、`cd packages/shell && bun src/client-entry.tsx`、逐包 `bun test`、`npx pnpm@10.18.3 -r typecheck`）。

### 8.2 版本号

- 本仓当前（工作区 checkout）`packages/shell/package.json:3` → **0.16.0**。
- CHANGELOG 最新条目：`CHANGELOG.md:8` → `## [0.16.0] - 2026-11-15`（下一条 0.15.0 在 `:21`，0.14.0 在 `:34`）。
- `main` 分支（worktree `dsh-opentui-wt-release`）最新：`ff31d6f 2026-11-16 chore(release): 0.17.3`，其 `packages/shell/package.json:3` = **0.17.3**。
- git tag 很旧：`git tag --sort=-v:refname | head` → `v0.4.3 / v0.4.2 / v0.4.1`（0.16.0/0.17.3 无 tag）。
- 本机全局安装版本：**0.17.3**（`/opt/homebrew/lib/node_modules/@aiwayds/dsh-opentui/package.json`）；全局 dsh 宿主：**0.2.2-rc.3**（`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/package.json`）。

---

## 9. 事实存疑 / 未能确认清单

1. **"21 bundles"**：本仓无任何 21 项 bundles 的配置或文档；profile 当前 20 项（`~/.dsh/profiles/opentui/package.json:6-27`），产品插件清单 12 项（`provision-plan.mjs:23-96`）。无法定位任务所指的"21"。
2. **`dsh plugin add` 内部真实 pnpm argv 与 flag**（是否 `--ignore-scripts`/`--frozen-lockfile`/`--registry`）：本仓代码不传这些；宿主的 `.plugin-manager/logs/*/pnpm.log` 抽样为空文件；宿主源码只显示"把参数交给 pnpm"（`dsh/src/plugin.ts:67-71,93-99`）。**未能确认具体 flag**。
3. **`~/.dsh/profiles/node_modules` 软链农场由谁写入**：本仓无相关代码；宿主源码把它称为 "shared profiles tree"（`dsh-app-boot/src/profile.ts:135-148,257-270`）但本机未 grep 到创建点。**创建者未确认**。
4. **0.17.3 已发布但本仓 tag 只到 v0.4.3**：git tag 与 package.json/CHANGELOG 不一致，原因未查（不联网，未查 npm dist-tags）。
5. **`--client` / `--v2` / `--plugin` 的"无操作别名"**：只在注释里声明（`client-entry.tsx:4-9,336`），代码中无解析分支；实际效果是"被忽略"。若它们依赖别处（打包产物/宿主）处理，本仓内无证据。
6. **`packages/shell/scripts/install-profile.mjs` 是否仍在任何发布/CI 路径上**：文件存在但 import 的 `solid-js-pin.mjs` 缺失；仅被 e2e 注释与 Containerfile 注释提及（`e2e/lib/common.sh:77`、`e2e/scenarios/80-onboard.sh:8,16`、`e2e/Containerfile:5`），未见执行入口。
