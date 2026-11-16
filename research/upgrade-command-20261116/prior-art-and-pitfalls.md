# 自升级 + 升级本 profile 插件：本机参考实现与已知坑

- 调研日期：2026-11-16
- 方式：只读（ls/cat/rg/git log/`--help`/`npm view --offline`/`strings`）；未安装、未改任何源码、未联网查询 registry。
- 目标仓：`/Users/qingguee/repo/dsh-opentui`（实际仓名与任务一致，版本 `packages/shell@0.17.3`，见 `/Users/qingguee/repo/dsh-opentui/packages/shell/package.json:3`）。
- 本机 CLI 形态：`dsh-opentui` 是 client-mode 启动器（`docs/adr/0005-client-mode.md:42-56`），插件装在固定 profile `~/.dsh/profiles/opentui`；仓内**目前没有任何 upgrade/self-update 命令**（`rg 'self.?update|升级命令|自升级' research docs tickets CHANGELOG.md` 零命中；启动器自己只消费 `--version`/`--force` 两个 bin 级 flag，`packages/shell/bin/dsh-opentui.mjs:72-110`）。
- 相关本机事实：`dsh -V` = `0.2.2-rc.3`；`npm -v` = 11.19.0；`pnpm -v` = 10.33.0；`node -v` = v26.8.1；全局 `npm/pnpm registry` 均为 `https://registry.npmmirror.com`（`npm config get registry`、`pnpm config list`）。

---

## 1. 参考仓 A：dsh-tui-pi 的 onboard 与版本跟随

仓路径：`/Users/qingguee/repo/dsh-tui-pi`（`@aiwayds/dsh-tui-pi`，仓内 manifest 2.37.1；本机 `~/.dsh/profiles/tui` 实装 2.38.1）。

### 1.1 触发点：每次启动都做版本跟随，而不是安装期钩子

`bin/boot.mjs` 是唯一入口。快路径要求“宿主在 + profile 已挂载 + profile 不比全局包旧”，否则先跑 onboarding 再 boot：

```js
// bin/boot.mjs:42-54
if (dsh && profileMounted() && !profileBehind()) {
  const guard = checkHostPackages({ ... })
  if (!guard.ok) process.exit(1)
  boot(dsh)
}
console.log('dsh-tui-pi setup (first run / upgrade only):')
const setup = runOnboard({ log: (line) => console.log(line) })
```

`profileBehind()` 的判据是“profile 内已装副本版本 < 本包版本”，profile 更新（开发机提前升过）时不动它：

```js
// bin/onboard-core.mjs:199-205
export function profileBehind() {
  const mounted = profileVersion()
  const self = selfVersion()
  if (!mounted || !self) return false
  if (mounted === self) return false
  return compareVersions(mounted, self) < 0
}
```

### 1.2 升级/安装流程 = 3 步（1 步是“重装 profile”）

`runOnboard()` 固定三步，每步先检查再动作（幂等）：

1. `[1/3] dsh host`：`dsh` 不在 PATH，或 `dsh -V` 低于 floor，就 `npm install -g @deepseek-ai/dsh@<wanted>`；npm 本身不存在则打印安装 Node 的提示并退出（`bin/onboard-core.mjs:273-302`）。
2. `[2/3] pnpm`：缺失时 `npm install -g pnpm`（`:304-314`）。
3. `[3/3] tui profile`：`profileMounted() && !profileBehind()` 时只打印 `already set up`；否则执行 `dsh plugin --profile tui add @aiwayds/dsh-tui-pi`；非零退出时写 `allowBuilds` 再原样重试一次（`:316-343`）。

关键实现摘录：

```js
// bin/onboard-core.mjs:323-340
const result = spawnSync(dsh, ['plugin', '--profile', PROFILE, 'add', PKG], {
  stdio: 'inherit',
  timeout: INSTALL_TIMEOUT_MS,
})
if (result.status !== 0) {
  if (!approvePrintedBuilds()) {
    return { ok: false, step: 'tui profile setup', hint: `run it manually with: dsh plugin --profile ${PROFILE} add ${PKG} — then re-run dsh-tui-pi` }
  }
  log('  [3/3] tui profile           approved the printed build scripts (our closure-linker no-ops) — retrying…')
  const retry = spawnSync(dsh, ['plugin', '--profile', PROFILE, 'add', PKG], { ... })
}
```

### 1.3 宿主版本解析：latest/next 取新、floor 校验

```js
// bin/onboard-core.mjs:161-176
export function resolveHostVersion() {
  try {
    const out = execFileSync('npm', ['view', HOST, 'dist-tags', '--json'], { ... })
    const tags = JSON.parse(out)
    const stable = tags?.latest
    const rc = tags?.next
    if (stable && rc) return compareVersions(rc, stable) > 0 ? rc : stable
    return stable ?? rc ?? null
  } catch { return null }
}
```

- 通道：只比较 `latest` 与 `next`，`alpha` 已退役（`bin/onboard-core.mjs:155-160` 注释；同规则见 `e2e/run-e2e.sh:15-42`、`.github/workflows/ci.yml:52-64`）。
- 兼容窗口：**不是 `[rc.2, rc.4]` 这类闭区间**。本机代码里只有下界（floor），没有上界：
  - `minHostVersion()` 从自身 `peerDependencies` 的 `>=x` 提取，取不到则固定 `0.2.2-rc.1`（`bin/onboard-core.mjs:185-194`）。
  - 运行时守卫 `HOST_FLOOR = '0.2.2-rc.1'`，读 profile 实际解析到的 `@deepseek-ai/dsh-user-questions/package.json` 版本，低于 floor 打印升级提示并退出；版本不可读时 **fail-open**（`src/host-version.ts:18`、`:94-113`）。
  - 也就是说：宿主 `>= floor` 一律保留，低于 floor 自动升级；没有区间上限或“rc.2 到 rc.4 之外拒绝”的逻辑。
- 版本比较：自写 `compareVersions`，数字段逐段比；预发布按点分段、数字段数值比较（`rc.10 > rc.4`），无预发布 > 有预发布（`bin/onboard-core.mjs:207-231`）；运行时守卫是同一规则的 TS 版（`src/host-version.ts:38-73`）。

### 1.4 安装位置与包管理器

- 宿主与 pnpm：全局 npm prefix（`npm install -g`），不跟随调用方的包管理器（`bin/onboard-core.mjs:130-153` 注释与实现）。
- profile 本体：`~/.dsh/profiles/tui/node_modules/@aiwayds/dsh-tui-pi`（`bin/onboard-core.mjs:52-55`）。
- profile 的插件安装：委托宿主 `dsh plugin --profile tui add`，宿主把它转发给 profile 目录里的 pnpm（`dsh plugin --help`：“forwarding the remaining arguments to pnpm in the profile directory”）。
- 无 `--version` / `--channel` / `--dry-run` 参数；`boot.mjs` 只把参数原样传给 `dsh`（`bin/boot.mjs:33-37`）。

### 1.5 失败契约（可借鉴的错误结构）

失败返回 `{ ok:false, step, hint, detail }`，`detail` 明确记录子进程死法；注释给出真实事故：npm 在 2 GiB podman VM 上被 OOM SIGKILL（exit 137），若只返回布尔会只剩“setup stopped”（`bin/onboard-core.mjs:17-20`、`:134-153`）。

### 1.6 同仓的“单包升级”实现：`scripts/dev-upgrade.mjs`（最接近参考）

它只升级一个包（`@aiwayds/dsh-tui-pi`），流程 4 步，是仓内唯一带 dry-run 的升级路径：

1. `npm view <pkg>@latest|@<ver> version` 先确认目标版本存在（否则不写任何文件），`:132-143`。
2. 只改 profile `package.json` 里该包那一行，保留原格式；要求当前值是纯精确版本，拒绝 `file:/link:/range/tag`；改完做“只变了一个字段”的断言，`:74-110`、`:210-219`。
3. `pnpm install`（cwd=profile）；失败则把 pin 原子恢复为原值，并提示下一次 `pnpm install` 会收敛半更新的 lock（`:222-239`）。
4. 读 `node_modules/<pkg>/package.json` 校验版本等于目标；最后打印 “restart dsh (or /reload inside the TUI) to load the new copy”（`:241-250`）。

`--dry-run` 打印完整 plan（文件、old → new、命令）后退出，不写不装（`:191-200`）。

---

## 2. 参考仓 B：opencode

### 2.1 源码与二进制现状（先澄清）

- 本机**有源码**：`/Users/qingguee/Downloads/opencode-survey`（`package.json` version `2.3.0`，无 `.git`，无法给出 commit）。该目录同时带一份 `v1.0.0/` 历史快照。
- 本机**已装**的是 Homebrew 二进制：`/opt/homebrew/bin/opencode -> ../Cellar/opencode/1.4.3/bin/opencode`（Mach-O arm64），`opencode --version` = `1.4.3`。
- 因此：1.4.3 的精确实现无源码；对 1.4.3 只做 `--help` 与二进制字符串观察，2.3.0 以源码为准。两者方法集合不同（见下）。

`opencode upgrade --help` 实测：

```
opencode upgrade [target]
Positionals: target  version to upgrade to, for ex '0.1.48' or 'v0.1.48'
Options:
  -m, --method  installation method to use
      [choices: "curl", "npm", "pnpm", "bun", "brew", "choco", "scoop"]
```

2.3.0 源码里 `methods` 变成 `["curl","npm","pnpm","bun","yarn","vp","brew","winget"]`（`packages/cli/src/services/updater.ts:14`），即 1.4.3 之后 choco/scoop 被 winget 取代并新增 yarn/vp。

### 2.2 1.4.3（已装二进制）可观察到的行为

`strings -a` 提取到的关键片段（原文）：

- 检测：brew / scoop / choco 的本地列表命令（scoop、choco 的命令数组直接可见；brew 分支只可见其参与检测与包名选择），以及 npm/pnpm/bun 的全局列表；包名按方法区分：`brew|choco|scoop -> "opencode"`，其余 `"opencode-ai"`。v1.0.0 源码里的检测/命令表可作结构参照（`opencode-survey/v1.0.0/packages/opencode/src/installation/index.ts:52-96`）。
- 升级命令：`npm install -g opencode-ai@${target}`、`pnpm install -g opencode-ai@${target}`、`bun install -g opencode-ai@${target}`、`brew ...`、`choco upgrade opencode --version=${target} -y`、`scoop install opencode@${target}`。
- curl 方法：请求 `https://opencode.ai/install`（同时存在 GitHub `releases/latest` 的字符串，无法仅凭静态字符串判定走哪条）。
- 输出：`opencode upgrade skipped: ${target} is already installed`、`Upgrade failed` / `Upgrade complete`、`From ... → ...`。
- 结论：1.4.3 的自升级是**交给原安装器**（全局包管理器/安装脚本），不是下载二进制后原地替换。

### 2.3 2.3.0 源码的升级流程（5 步）

`packages/cli/src/commands/handlers/upgrade.ts:10-49` + `packages/cli/src/services/updater.ts`：

1. **定方法**：`--method` 优先；否则 `updater.method()` 按可执行文件路径与包管理器全局列表探测（curl 安装目录、brew Cellar、winget 目录、npm/pnpm/bun/yarn/vp 的 `list -g`），Volta/mise 托管的副本返回专门错误（`updater.ts:254-285`、`:418-424`）。
2. **定目标**：显式 `target` 去掉前导 `v`；否则 `latest(method)`——默认问 `https://opencode.ai/update/api/<channel>/<artifact>/<distribution>?current=<version>`，brew core 问 `formulae.brew.sh`，winget 问 `winget search`（`:315-406`）。
3. **同版本跳过**：`version === OPENCODE_VERSION` 打印 skipped 并退出 0（`handlers/upgrade.ts:26-30`）。
4. **加锁 + 执行**：`flock.acquire("cli-upgrade", timeout 15min)`，然后按方法跑子进程，超时 5 分钟；npm 特意不先卸载旧包（“uninstalling it can unlink the replacement command”），并带 `--allow-scripts=<pkg>`；pnpm 用 `--allow-build`；bun 用临时 cache 目录；curl 先下载 installer 再 `bash installer --version <v> --no-modify-path`（`updater.ts:496-574`）。
5. **结果校验与错误输出**：npm/bun/yarn 成功后重新读安装目录 `package.json`，版本不等于目标就报 “did not update this copy” 并给 retry 命令（`:590-604`）；失败统一为 `UpgradeError { title, detail, command, retry }`，CLI 格式化成人类可读块（`handlers/upgrade.ts:52-82`）。
6. **旁路：自动更新策略**：`inspect()/run()` 读 `update: disable|notify|auto`（兼容旧 `autoupdate`），`OPENCODE_DISABLE_AUTOUPDATE` 可禁用；`notify` 只报告，`auto` 直接安装（`updater.ts:127-142`、`:607-635`、`:695-705`）。

无 dry-run；无回滚（失败由包管理器自己负责）；无 Node 版本检查；重启不是命令的一部分（替换的是磁盘上的可执行文件/包目录，运行中的进程继续用旧映像）。

---

## 3. 已知坑清单（逐条出处）

### 3.1 pnpm `strictDepBuilds` / `ERR_PNPM_IGNORED_BUILDS`

- 本机生态的权威记录：pnpm 11 默认 `strictDepBuilds=true`，依赖带未放行的 `preinstall`/`install`/`postinstall` 时 `pnpm add` 非零退出，**dsh 宿主的插件管理器把非零退出当安装失败并回滚**，用户看到“更新失败”但包其实可用（`/Users/qingguee/repo/dsh-tui-pi/docs/adr/0004-onboarding-first-launch-not-postinstall.md:8-14`，指向 `dsh-subagent-registry#10`）。
  - 本机版本注记：`pnpm -v` = 10.33.0，`pnpm config get strict-dep-builds` 返回 `undefined`。上述“pnpm 11 默认开启”是仓内记录的行为，本次没有在 pnpm 10 上复测该默认值。
- 事故形态：tui-pi 0.7.1 的 no-op `postinstall` 触发该门，导致 dsh 未把插件写进 `dsh.profile.bundles`，TUI 只剩 `dsh-base` 空树（黑屏、无 banner）（`/Users/qingguee/repo/dsh-tui-pi/CHANGELOG.md:2243-2253`）。
- 批量回归测试已成为生态惯例：baseline 安装 → `npm pack` → 覆盖安装 → 断言 exit 0 且输出无 `ERR_PNPM_IGNORED_BUILDS`（`/Users/qingguee/repo/dsh-tui-pi/test/packaged-upgrade.test.mjs:1-14`、`:96-102`；同型测试见 `dsh-ask-router`、`dsh-approval-policy`、`dsh-llm-net-retry`、`dsh-agent-dispatch`、`dsh-mcp-adapter`、`dsh-profile-switch` 的 `test/packaged-upgrade.test.mjs`）。

### 3.2 `postinstall` vs `prepare`

- 姊妹仓的统一修法：`postinstall` → `prepare`。理由：**npm 和 pnpm 对 registry 依赖从不执行 `prepare`**，而 pnpm 的门只盯 `preinstall/install/postinstall` 三个键（`/Users/qingguee/repo/dsh-profile-switch/CHANGELOG.md:18`）。
- 同一文档还记录了“修法本身的边界”：`prepare` 在 npm 安装 git 依赖时会在临时 clone 里执行，所以 linker 用 `INIT_CWD` + `tsconfig.json`/`.git` 双守卫，避免在消费者目录里删 `@deepseek-ai` 包（`/Users/qingguee/repo/dsh-profile-switch/scripts/link-dsh-closure.mjs:20-46`）。
- tui-pi 不能走该范式：它的 postinstall 承载真实装机，挪进 `prepare` 只是把同一个门撞到 dev 安装上，最终选择“删钩子 + 首启 onboarding”（`docs/adr/0004-onboarding-first-launch-not-postinstall.md:16-20`、`:56-58`）。
- 结论性事实：只要消费方 pnpm 开着 `strictDepBuilds`（仓内记录为 pnpm 11 默认）且未在 `allowBuilds` 放行，发布包里的 install 类钩子就会让 `pnpm add` 非零退出；`prepare` 只在发布包自己的 dev/git 安装路径执行，registry 依赖不会跑。

### 3.3 `allowBuilds` 的写法与“谁有权放行”

- tui-pi 首启的做法：读 profile 的 `pnpm-workspace.yaml`；若有 pnpm 留下的 `set this to true or false` 占位符就全部替换为 `true`；若已有 `allowBuilds:` 则不动；否则自己追加一段精确包名的 block（`bin/onboard-core.mjs:233-261`）。
- dsh-opentui provisioning 复制了同一逻辑（`packages/shell/scripts/provision-opentui-profile.mjs:340-360`）。
- 本机 opentui profile 的真实文件（`cat -n /Users/qingguee/.dsh/profiles/opentui/pnpm-workspace.yaml`）：`nodeLinker: hoisted`、`autoInstallPeers: false`、`allowBuilds` 11 个 `true` + `'@aiwayds/dsh-vault': false`（第 4-18 行）。**显式 `false` 是用户决定，工具不应覆盖**（两个实现都只补 `set this to true or false` 或整块缺失的情况）。
- 宿主侧语义：失败安装把待批准项放在 `pendingBuilds`；**失败的 run 恢复 `package.json` 与 `pnpm-lock.yaml`，但故意不恢复 `pnpm-workspace.yaml`**；“版本豁免不授权依赖脚本”（`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-plugin-manager/README.md:72`、`:77`）。

### 3.4 宿主回滚的真实边界（不是事务）

`runProfilePnpm()` 在 pnpm 之前保存 `package.json`、`pnpm-lock.yaml`，事后拒绝（引擎/peer 不兼容、`expected` 不匹配、bundle 加载失败等）时：

```ts
// dsh-plugin-manager/src/operations.ts:97-98
const RESTORED_FILES = ['package.json', 'pnpm-lock.yaml'] as const

// :549-561（拒绝后的恢复）
await restore()
const hadLockfile = savedFiles.some(file => file.path.endsWith('pnpm-lock.yaml') && file.text !== undefined)
const repair = ['install', hadLockfile ? '--frozen-lockfile' : '--config.lockfile=false']
const repairing = execa(options.command ?? 'pnpm', [...options.args ?? [], ...repair], { ... })
// 成功 → "restored package.json, pnpm-lock.yaml, and node_modules"
// 失败 → "restored package.json and pnpm-lock.yaml, but node_modules could not be reinstalled"
```

- 恢复靠“重装旧 lock”实现，**不是快照回滚**；已下载内容留在 pnpm store，`node_modules` 能否回到旧状态取决于这次重装（`:289-302`）。
- 并发保护：`runPluginCommand` 对 `<profile>/package.json` 加文件锁，`lockWaitMs` 默认 120s（`operations.ts:591-610`；`dsh` CLI 传 `12e4`，见 `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/lib/plugin-DC80YBt4.js:85`、`:94`）。另有 `.plugin-manager/run.json` 记录上一次启动的 pnpm 进程树，防止进程先死而 pnpm 树仍在写 profile（`operations.ts:213-255`）。
- 安装成功后的兼容性检查同样会触发回滚：pnpm 退出 0 后，逐个检查**本次 spec 或已装 `package.json` 发生变化**的直接依赖；任一 bundle 的 `engines.dsh`/peer 不满足就 `restore()` 并重装旧 lock，退出码改 1；未发生变化的依赖只警告并留待 startup 拒绝（`operations.ts:496-565`）。这意味着走 `dsh plugin` 通道的批量升级有“manifest+lock 级别的整体回滚”，但**预检只覆盖 `add/install/i`**（`INSTALL_COMMANDS`，`:158`），`update` 只有事后检查。

### 3.5 `minimumReleaseAge` 与镜像滞后：`npm view latest` ≠ 实际会装到的版本

- pnpm 11 的 `minimumReleaseAge=24h` 让 24 小时内新发的版本在 fresh install 里仍解析到旧版本（`dsh-tui-pi/docs/adr/0004-onboarding-first-launch-not-postinstall.md:29-31`）。
- 宿主 UI 文档明确：安装完成时“pnpm 装到的版本可能不同于 inspect 读到的版本，例如 `minimumReleaseAge` 拦下刚发布的版本”，并给出实际版本（`.../dsh-client-ui-plugin-manager/README.md:65`）。
- 本机默认 registry 是 `registry.npmmirror.com`（`npm config get registry`），而多份代码显式切官方源以避开镜像滞后/未同步：
  - 安装探针/回归用 `--registry=https://registry.npmjs.org`（`dsh-tui-pi/test/packaged-upgrade.test.mjs:29`、`:62-66`；`dsh-mini-subagent/scripts/install-profile.mjs:44`、`:153`、`:194`）。
  - e2e 镜像的默认源单独可配，并注明 npmmirror 可能滞后于刚发布的版本（`dsh-opentui-wt-fixbase/e2e/Containerfile:37-39`、`dsh-tui-pi/e2e/Containerfile.latest:6-7`）。
  - 宿主插件管理器把 npmmirror 作为 `fallbackRegistries` 默认值，并且**只在“不可达 / 超时 / not-found / no-matching-version”时换下一个源**，即镜像未同步也会触发降级询问（`.../dsh-plugin-manager/README.md` Configuration 表；`src/registry.ts:78-98`）。

### 3.6 `npm view --prefer-online` 的必要性（本机证据）

- 发布后验证需绕过本地缓存/负缓存：本机长期记忆明确写“首发后验证包存在性用 `npm view <pkg> --prefer-online`”（`/Users/qingguee/.dsh/topics/topics/dsh-plugin-bundled-skill-pattern.md:38`；同见 `dsh-install-all-registry-no-link.md:40`）。
- 一次真实事故记录：`npm publish` 返回成功，但 `npm view` 持续 404 超过 160s，直连 registry 的 packument 已是 200 且 `dist-tags.latest` 正确，判定为客户端负缓存，用 `--prefer-online` 才通过（`/Users/qingguee/.dsh/topics/meta/observations.jsonl:113` 的对话摘录）。
- 时新性检查的标准写法是 `--registry=https://registry.npmjs.org --prefer-online` 同时给（`/Users/qingguee/repo/wayfinder/dsh-021-migration/assets-dsh-0.2.2-rc.3/recheck-20261116.md:64`）。
- 反例（现状缺口）：tui-pi 的 `resolveHostVersion()` 只跑 `npm view @deepseek-ai/dsh dist-tags --json`，既没 `--registry` 也没 `--prefer-online`（`bin/onboard-core.mjs:163`），而 tui-pi 仓根没有 `.npmrc`，所以在本机会走 npmmirror 的缓存元数据。

### 3.7 npm 在 profile 目录的 arborist 说法

- 本机唯一出处是注释性断言：profile 是 pnpm 管理的，`npm crashes on the arborist layout`，缺失 pnpm 时直接失败并给出这句话（`/Users/qingguee/repo/dsh-mini-subagent/scripts/install-profile.mjs:24-25`、`:86`）；同一脚本所有安装都用 `pnpm install --registry https://registry.npmjs.org`（`:153`、`:194`）。
- 除此之外，`/Users/qingguee/repo` 全仓 `rg arborist` 只有这一处；本次只读调研未复现该崩溃，宿主侧也没有 npm 路径（`dsh plugin` 硬编码 pnpm，`README.md:77`）。因此应表述为“生态内的既有经验/注释断言”，不是本次实测结论。

### 3.8 `npm pack --ignore-scripts` 的差异

- 用途一：`npm pack` 默认会跑根 `prepare`/`prepack`，钩子的 stdout 会污染“用 stdout 最后一行当 tarball 文件名”的解析；因此打包取文件名时加 `--ignore-scripts`，而 build 产物已由前置 gate 生成（`/Users/qingguee/repo/dsh-mcp-adapter/scripts/smoke-boot.mjs:49-53`；同一修法记在该仓 `CHANGELOG.md:28`）。
- 用途二：e2e 里 `npm i -g --ignore-scripts <tarball>` 用来跳过“已退役的全局 postinstall profile bootstrap”，只测 bin 注册与包内容（`/Users/qingguee/repo/dsh-opentui-wt-fixbase/e2e/scenarios/10-install.sh:11-17`、`:71-74`、`:167-175`）。
- 反面事实：`dsh-tui-pi/test/packaged-upgrade.test.mjs:62-66` 故意**不加** `--ignore-scripts` 来 pack，并改用“扫描目录里的唯一 `.tgz`”而不是解析 stdout，注释写明原因就是钩子日志会破坏输出解析。

### 3.9 hoist / 软链农场：一次安装影响的到底是哪些 profile

- `$DSH_HOME/profiles/node_modules` 是宿主的运行时解析表：`@deepseek-ai/*` 以软链指向全局 dsh 安装的闭包，所有 profile 把它当祖先目录；profile 内 pnpm 装的包不被改写（`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-app-boot/README.md:142-144`）。
- 本机实测：`/Users/qingguee/.dsh/profiles/node_modules` 有 190 个符号链接，例如 `@deepseek-ai/dsh-settings -> /opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-settings`；而 `profiles/{tui,opentui}/node_modules/@aiwayds/*` 是**物理目录**，不是链接。
- 推论（事实层）：升级全局 dsh → 所有 profile 同时换宿主闭包；升级某个插件 → 只影响该 profile 的物理副本。`npm i -g @aiwayds/dsh-tui-pi` 也只改全局副本，profile 副本由首启 onboarding 再同步一次（`bin/boot.mjs:14-17`）。
- 风险的历史实证：同一版本号的 hoisted 目录会“保留旧内容”，只有换一个版本号才强制落盘——e2e 曾因此把 vendored 包 patch 版本号加一（`dsh-tui-pi/CHANGELOG.md:38`、`:46`；`e2e/scenarios/75-hard-stop.sh:60`）。
- 另一类硬失败：`patchedDependencies` 指向已不在依赖图里的包会让**每次** pnpm install 以 `ERR_PNPM_UNUSED_PATCH` 失败；dsh-opentui provisioning 专门清理孤儿 patch（`provision-opentui-profile.mjs:31-39`、`:491-500`；分类规则见 `packages/shell/scripts/lib/provision-plan.mjs:181-230`）。

### 3.10 registry 相关：本机能证到什么、不能证到什么

- 能证：
  - 默认读源是 npmmirror（`npm config get registry`、`pnpm config list`）。
  - 发布鉴权只配置了官方源：`~/.npmrc` 里只有 `//registry.npmjs.org/:_authToken=...`（值不转写），`dsh-opentui/.npmrc` 明确 `registry=https://registry.npmjs.org/`，发布 workflow 用 `registry-url: https://registry.npmjs.org`（`/Users/qingguee/repo/dsh-jev-core/.github/workflows/release.yml:40-42`）。
  - 镜像泄漏是现实问题：一次“按官方源重装”实际把 lock 的 3 个 resolved URL 写成了 `registry.npmmirror.com`，靠事后重指 + `npm ci --registry=...` 修正（`dsh-jev-core/CHANGELOG.md:11-12`）。
- 不能证：仓内 **没有任何文字**说“npmmirror 只读”。本次未做任何写 registry 的操作，无法验证该说法；只能确认发布/鉴权路径配置的是 `registry.npmjs.org`。

---

## 4. 升级命令的常见设计点：逐条对照

图例：有 / 无 / 部分。

| 设计点 | dsh-tui-pi onboard | dsh-tui-pi `dev-upgrade.mjs` | opencode 2.3.0 | opencode 1.4.3（可观察） | dsh 宿主 plugin-manager | dsh-opentui provisioning |
|---|---|---|---|---|---|---|
| dry-run | 无（`boot.mjs` 无该参数） | 有（`:191-200`） | 无 | 无（`--help` 无） | 无批量；单 bundle 有 `listVersions` 预读 | 有（`--dry-run`，`:406-408`；bin 转发 `:130`） |
| 指定版本 | 无 | 有（`latest` 或显式版本） | 有（`target`） | 有（`target`） | 有（`updateBundle(name, version)`，必须 `semver.gt`，`index.ts:752-754`） | 无（版本来自硬编码 `PLUGIN_SET`） |
| 通道选择 | 隐式 newest(latest,next) | 无（只 `latest`） | 方法 + 服务端 channel/artifact | 方法 | 无（按已装 spec 判断 registry/git） | 无 |
| 失败回滚 | 无（只 allowBuilds 重试一次）；底层宿主恢复 package.json+lock | 仅恢复 pin（不恢复 node_modules） | 无（包管理器负责）；仅校验“没升到目标”后报错 | 无 | 单 bundle：remove→install→失败再装回旧版（HMR），`:783-799` | 无；失败是 WARN，继续启动（`:453-463`） |
| 需要重启/重载 | 装完立刻 boot；已在运行的实例需重启 | 打印 “restart dsh (or /reload inside the TUI)” | 否（替换磁盘副本） | 否（下次启动生效） | HMR 下热应用；无 HMR 报 `restart-required` | 下次启动生效；`/reload` = 同端口重启宿主（`remote-restart.ts:1-40`） |
| Node 版本校验 | 无（只检查 npm 是否存在） | 无 | 无 | 无 | 无（检查的是 `engines.dsh`/dsh peer） | 无 |
| 并发锁 | 无自己的锁；`dsh plugin add` 内部拿 profile 文件锁 120s | 无 | `flock("cli-upgrade")`，15min（`updater.ts:521`） | 未知 | profile 文件锁 120s + `run.json` 进程树记录 | 安装步骤经 `dsh plugin` 有锁；step 4 直接读写 manifest 在锁外 |
| 升级范围 | 本包 + 其 `dependencies` 声明的 companions（`onboard-core.mjs:70-79`） | 单包 | 单包（自身） | 单包（自身） | 单 bundle（官方目录条目有 Update；第三方无批量） | tier 内的缺失/不满足项，逐项补齐 |

补充事实：宿主 UI 文档明确“官方按需条目有显式 Update，其他插件通过卸载再安装来升级”（`.../dsh-client-ui-plugin-manager/README.md:65`），并且 agent 工具的动作枚举里**没有 update**（只有 `list_plugins / list_bundles / set_plugin / set_bundle / install_bundle / remove_bundle / list_version_exemptions / set_version_exemption`，`.../dsh-plugin-manager/src/tools.ts:91`）。也就是说“升级所有已装插件”在宿主侧目前没有现成的一等操作。

与批量升级直接相关的两条命令语义（本机 `--help` 实测）：

- `pnpm update` 是“按 package.json 里的 range 升”，只有 `-L/--latest` 才 “Ignore version ranges in package.json”（`pnpm update --help`）。本机 opentui profile 的依赖全是精确 pin（`~/.dsh/profiles/opentui/package.json:30-50`），所以裸 `pnpm update` 不会产生任何升级；能批量跨 pin 的只有 `update --latest`。
- `dsh plugin --profile <p> <args...>` 把 `args` 原样转给 profile 里的 pnpm（`dsh plugin --help`），因此 `dsh plugin --profile opentui update --latest` 在机制上可用；它会经过宿主的 profile 文件锁、事后兼容性检查与 manifest/lock 回滚（见 3.4），但**不经过** `add/install` 的安装前预检（`INSTALL_COMMANDS` 不含 `update`，`operations.ts:158`）。若升级命令自己改 pin 后直接跑 `pnpm install`，上述宿主保护全部不生效。

---

## 5. 对“自升级 + 升级本 profile 所有插件”的关键风险（只列事实与后果）

### R1. 现有 provisioning 会把“升到 latest 的插件”在下次启动时按硬编码 pin 装回去

- `PLUGIN_SET` 里每个插件是精确版本（如 `@aiwayds/dsh-subagent-registry: '0.20.0'`，`packages/shell/scripts/lib/provision-plan.mjs:20-88`）。
- 幂等判定要求“已装版本 **等于** pin”才算满足；`satisfiesVersion` 对纯精确版本走 `cmp === 0`（`provision-plan.mjs:316-336`、`:354-385`）。
- 现有 profile 的依赖也全是精确 pin（`~/.dsh/profiles/opentui/package.json:30-50`；lock 的 `specifier` 同样精确，`pnpm-lock.yaml:10-40`）。
- 后果：若新命令把插件升到比 `PLUGIN_SET` 新的版本，下一次 `dsh-opentui` 启动的 `[3/5] plugins` 会认为 `0.20.1 != 0.20.0`，执行 `dsh plugin add @aiwayds/dsh-subagent-registry@0.20.0`，即**降级**。升级命令必须同时处理 pin 源（PLUGIN_SET 与 profile manifest）或改动满足规则，否则升级结果不持久。

### R2. 批量升级没有事务，部分失败是常态

- 一次 batched `dsh plugin add <specs...>` 是单个 pnpm 进程；失败后 provisioning 退化为逐包重试，最多 3 次、间隔 5s；确定性失败不重试；最终失败只 WARN，客户端照常启动（`provision-opentui-profile.mjs:104-115`、`:412-463`；分类见 `provision-plan.mjs:180-230`）。
- 宿主侧拒绝安装时只恢复 `package.json` + `pnpm-lock.yaml` 并重装旧 lock；重装失败时 `node_modules` 处于“文件已回、模块未回”的中间态（`operations.ts:293-294`、`:549-561`）。
- `allowBuilds` 的失败路径**不回滚** `pnpm-workspace.yaml`（`plugin-manager/README.md:72`），而本机 opentui profile 已有一条用户写的 `false`（`pnpm-workspace.yaml:18`），批量放行逻辑若粗放会覆盖用户决定。
- 后果：一次升级可能得到“部分包新、部分包旧、lock 与 node_modules 需要再收敛”的状态，且没有单点回滚。

### R3. “所有插件”与宿主闭包/运行中宿主混在同一张依赖图里

- profile manifest 里同时有第三方插件和宿主闭包包（本机 tui profile 直接依赖 `@deepseek-ai/dsh-cordis-host-runner`，`~/.dsh/profiles/tui/package.json:26`），而 `@deepseek-ai/*` 的解析实际由 `$DSH_HOME/profiles/node_modules` 软链农场提供（`dsh-app-boot/README.md:142`）。把 `@deepseek-ai/*` 当普通插件升到 npm latest，会与运行中的全局 dsh 闭包（本机 0.2.2-rc.3）产生版本分裂。
- 宿主是单实例、长驻的（`docs/adr/0005-client-mode.md:50-56`）；插件升级后，运行中的 host 仍加载旧模块，必须重启才生效（宿主 HMR 之外的操作报 `restart-required`；dsh-opentui 的 `/reload` 就是同端口重启 host，`remote-restart.ts:1-40`）。
- 宿主对插件版本有独立准入：`engines.dsh` 或 `@deepseek-ai/dsh*` peer 不满足会在 pnpm 之前拒绝（`operations.ts:361-380`；`dsh-app-boot/README.md:54-56`），而“版本豁免不授权依赖脚本”（`plugin-manager/README.md:77`）。
- 后果：把“所有已装依赖”一律升 latest，最坏情况同时改变宿主闭包、触发 peer 拒绝、并使运行中的 host 与磁盘状态不一致；而别的 profile 因为共享闭包农场会被一起影响。

---

## 6. 引用索引（按节）

| 主题 | 文件:行 |
|---|---|
| 首启/升级触发与版本跟随 | `dsh-tui-pi/bin/boot.mjs:14-17`、`:42-62`；`bin/onboard-core.mjs:199-205` |
| 三步 onboarding | `dsh-tui-pi/bin/onboard-core.mjs:263-346` |
| host 版本解析（latest/next） | `dsh-tui-pi/bin/onboard-core.mjs:155-176`；`e2e/run-e2e.sh:15-42`；`.github/workflows/ci.yml:52-64` |
| 兼容 floor（非区间） | `dsh-tui-pi/bin/onboard-core.mjs:178-194`；`src/host-version.ts:18`、`:75-102` |
| 版本比较 | `dsh-tui-pi/bin/onboard-core.mjs:207-231`；`src/host-version.ts:38-73` |
| 安装目录/包管理器 | `dsh-tui-pi/bin/onboard-core.mjs:52-55`、`:130-153`、`:316-343` |
| 单包升级（dry-run/回滚 pin） | `dsh-tui-pi/scripts/dev-upgrade.mjs:29-31`、`:74-110`、`:166-250` |
| pnpm 11 门与宿主回滚 | `dsh-tui-pi/docs/adr/0004-onboarding-first-launch-not-postinstall.md:8-14`、`:26-31`；`CHANGELOG.md:14`、`:2243-2253` |
| postinstall → prepare | `dsh-profile-switch/CHANGELOG.md:18`；`dsh-profile-switch/scripts/link-dsh-closure.mjs:20-46` |
| allowBuilds 写法 | `dsh-tui-pi/bin/onboard-core.mjs:233-261`；`dsh-opentui/packages/shell/scripts/provision-opentui-profile.mjs:340-360`；`~/.dsh/profiles/opentui/pnpm-workspace.yaml:4-18` |
| 宿主恢复边界与锁 | `dsh-plugin-manager/src/operations.ts:97-98`、`:213-255`、`:289-342`、`:549-561`、`:591-610`；`dsh/lib/plugin-DC80YBt4.js:85,94` |
| 插件更新语义（remove+install+restore） | `dsh-plugin-manager/src/index.ts:738-800`、`:1039`；`README.md:72,77` |
| 官方 Update / 第三方卸载重装 | `dsh-client-ui-plugin-manager/README.md:65`；`dsh-plugin-manager/src/tools.ts:91` |
| registry 计划与 npmmirror 回退 | `dsh-plugin-manager/src/registry.ts:14-17`、`:54-98`；`README.md` Configuration 表 |
| profiles 闭包软链农场 | `dsh-app-boot/README.md:142-144`；本机 `find ~/.dsh/profiles/node_modules -maxdepth 1 -type l | wc -l` = 190 |
| npm view --prefer-online / 负缓存 | `~/.dsh/topics/topics/dsh-plugin-bundled-skill-pattern.md:38`；`.dsh/topics/meta/observations.jsonl:113`；`wayfinder/dsh-021-migration/assets-dsh-0.2.2-rc.3/recheck-20261116.md:64` |
| 镜像滞后与官方源 | `dsh-jev-core/CHANGELOG.md:11-12`；`dsh-jev-core/.github/workflows/release.yml:40-42`；`dsh-tui-pi/test/packaged-upgrade.test.mjs:29,62-66`；`dsh-mini-subagent/scripts/install-profile.mjs:44,153,194` |
| npm/arborist 断言 | `dsh-mini-subagent/scripts/install-profile.mjs:24-25`、`:86` |
| npm pack --ignore-scripts | `dsh-mcp-adapter/scripts/smoke-boot.mjs:49-53`；`dsh-opentui-wt-fixbase/e2e/scenarios/10-install.sh:11-17`、`:71-74`；`dsh-tui-pi/test/packaged-upgrade.test.mjs:62-70` |
| opentui provisioning / 幂等规则 | `packages/shell/scripts/provision-opentui-profile.mjs:27-59`、`:400-463`；`packages/shell/scripts/lib/provision-plan.mjs:20-88`、`:316-385` |
| dsh-opentui 重启语义 | `docs/adr/0005-client-mode.md:42-56`、`:88`；`packages/shell/src/client/remote-restart.ts:1-40` |
| opencode 2.3.0 升级 | `opencode-survey/packages/cli/src/commands/handlers/upgrade.ts:10-82`；`packages/cli/src/services/updater.ts:14`、`:254-285`、`:315-406`、`:483-574`、`:590-604`、`:607-635` |
| opencode 1.4.3 观察 | `opencode --version` / `opencode upgrade --help` 实测；`strings -a /opt/homebrew/Cellar/opencode/1.4.3/bin/opencode` |
| opencode v1.0.0 旧实现 | `opencode-survey/v1.0.0/packages/opencode/src/cli/cmd/upgrade.ts:28-50`；`.../installation/index.ts:52-153` |
