# `dsh-opentui upgrade` 实现方案

- 编写日期：2026-11-16
- 基线：`main` = worktree `/Users/qingguee/repo/dsh-opentui-wt-release`，HEAD `ff31d6f chore(release): 0.17.3`，`packages/shell/package.json:3` = `0.17.3`
- 实现落点：新 worktree `dsh-opentui-wt-upgrade`，分支 `feat/upgrade-command`，从 `main`(0.17.3) 拉出
- 事实来源：`research/upgrade-command-20261116/cli-and-profile-facts.md`、`research/upgrade-command-20261116/prior-art-and-pitfalls.md`，以及本文中逐条核实过的源码行号（均在 0.17.3 基线上重新读过）
- 本文只含方案；不含实现代码（仅 ≤10 行伪代码/签名说明接入点）

已定前提（不重复论证，方案在此之上落地）：

1. 范围 = profile 内全部 registry 插件 + `dsh-opentui` 自身（npm 全局）；宿主 `dsh` **不自动升**，只检测并提示落后。
2. 版本策略 = 一律升到 dist-tag `latest`，不拦 major。
3. 反降级 = profile 内写 override 清单，provisioning 尊重它（不放宽校验、不接受降级）。
4. 交互 = 默认打印计划表 + 确认；`--dry-run` 只看；`--yes` 跳过；执行前备份，失败回滚并说明卡点。

---

## 1. 命令面定义

### 1.1 命令名：`upgrade`

结论：用 `upgrade` 作为**位置子命令**（`dsh-opentui upgrade`），不用 `update`。

理由（按权重）：

1. **语义必须与 pnpm 的 `update` 区分**。pnpm `update` 在 package.json 的 range 内升级，只有 `update -L/--latest` 才跨 range（`prior-art-and-pitfalls.md` §4 实测）。本命令的行为是"跨 range 到 dist-tag"，叫 `update` 会让用户按 pnpm 语义预期它不跨 major。
2. **避免与宿主命令同名异义**。`dsh plugin --profile opentui update` 是另一条已存在的通路（转发给 pnpm），两者行为不同（后者不带 `-L` 时对本 profile 的精确 pin 完全无效）。同栈两个 `update` 是文档负担。
3. **同生态先例**：opencode 用 `upgrade`（`opencode upgrade [target]`，见 prior-art §2.2），本仓用户群与该生态重叠。
4. **当前 CLI 无位置子命令占用**：client 只消费 `--new/--resume-last/--session`（`packages/tui-base/src/routes/session/auto-resume.ts:64-93`），裸位置参数 `upgrade` 今天是被静默忽略的，新增语义不冲突。

已知代价（写进 README）：在**尚未发布本命令的旧版本**上执行 `dsh-opentui upgrade`，会被当成无意义位置参数并直接启动 TUI。缓解：`--version` 输出新版本号；README 的 Upgrade 段写明最低版本。

不做的事：不新增顶层 `--help`（现有启动链没有 usage，加顶层 help 会扩大回归面）。只有 `dsh-opentui upgrade --help`。

### 1.2 flag 全表

| flag | 语义 | 备注 |
|---|---|---|
| （无） | 解析清单 → 打印计划表 → 交互确认 → 执行 | 计划为空时直接打印"已最新"并退出 0，不询问 |
| `--dry-run` | 打印计划表 + 即将执行的完整命令，**不写任何文件** | 与现有 `--dry-run`（`provision-plan.mjs:129-131`）同名同义 |
| `-y`, `--yes` | 跳过确认 | 与 `--dry-run` 同用时无意义，取 `--dry-run` |
| `--tag <name>` / `--tag=<name>` | 解析用的 dist-tag，默认 `latest` | 校验 `^[A-Za-z0-9][A-Za-z0-9._-]*$`；无该 tag 的包记 `skipped (no <tag>)`，不算失败 |
| `--no-self` | 跳过 `dsh-opentui` 自身升级 | 显式选择"不升 launcher"；插件升级完成后结尾**必须**打印降级风险警告（§6.3）——旧 launcher 不读 override，下次启动会按 pin 收敛 |
| `--no-plugins` | 跳过 profile 插件升级 | 用于只升自身 |
| `--reset-overrides` | 删除 override 清单并打印清掉哪些条目 | **terminal action**：清完即退出 0，不继续升级（§5.5）。只能与 `--dry-run` 组合（只预览）；与任何 scope/执行 flag（`--no-self`/`--no-plugins`/`--tag`/`--yes`/`--force`）组合 → usage error |
| `-h`, `--help` | 打印用法，退出 0 | 唯一新增的 help 面 |

互斥/校验规则：

- `--no-self` + `--no-plugins` 同用 → usage error（exit 2）。
- `--tag` 缺值或值非法 → usage error。
- 未知 flag → 收集后一次性报错（`unknown flag(s): --x, --y`），exit 2，不执行任何动作。
- 非 TTY stdin 且没有 `--yes`/`--dry-run` → 打印计划表后报 `refusing to prompt on a non-interactive stdin; re-run with --yes`，exit 2（不静默 assume yes）。

`--tag` 只是 dist-tag 的名字；**查询源**（registry URL）与它无关，按 §4.2 的 seam 解析：`DSH_UPGRADE_REGISTRY` > profile 生效的 `.npmrc` > `~/.npmrc` > `https://registry.npmjs.org`。解析出的源既非官方源、又不是 `DSH_UPGRADE_REGISTRY` 显式指定时，输出会多一行镜像滞后提示（见 §1.4(a)、§4.2）。

### 1.3 退出码约定

| 码 | 含义 | 谁产生 |
|---|---|---|
| 0 | 全部已最新；或计划内所有目标都验证落地；`--dry-run` 打印完；`--help`；**profile 不存在（无可升级对象）**；**自身被 skip（`foreign-pm`/`other-copy`/`unknown`）且插件全部 landed** | 正常终态 |
| 1 | 硬失败：前置缺失（`npm`/`dsh` 不在 PATH）、**`npm i -g <own>@<target>` 非零退出**、自身 `npm` exit 0 但磁盘版本没落地、写盘失败、批量安装失败且回滚已执行 | 终态 |
| 2 | 用法错误：未知 flag、`--tag` 非法/缺值、互斥组合、非 TTY 且未 `--yes`、`--force` 与 `upgrade` 同用 | 终态，零副作用 |
| 3 | 非致命部分成功：批量安装 exit 0 但**逐包版本校验**发现 ≥1 个包未到目标版本（`mismatch`/`missing`） | 终态，磁盘一致，可重跑 |

自身升级的三种结果分别落到哪个码（**不存在第四种**）：

- **landed** → 继续，结果码由插件阶段决定；
- **硬失败**（npm 非零 / 校验未落地 / EACCES / 写盘失败）→ **立即 exit 1，完全不碰 profile**（见 §6.3）；
- **skip**（`foreign-pm`/`other-copy`/`unknown`，按 §3.1 判定）→ **不算失败**：插件全部 landed 时仍是 exit 0，插件有 mismatch 时是 exit 3（skip 本身不升码）。

注意退出码 3 的定义边界：**"批量 `dsh plugin add` 非零退出"不是部分成功**——单批 = 单个 pnpm 进程，失败即回滚，走 exit 1（见 §6）。exit 3 只由"pnpm 成功但落盘版本 ≠ 计划目标"（`minimumReleaseAge`、镜像滞后、包内 `files` 缺失等）产生。

关于 exit 0 的字面例外：上表第 0 行写"计划内所有目标都验证落地"，而**自身 skip 的目标从未进入计划**（计划表里它就是 `skipped (…)`，与 `link:`/`excluded` 同类），所以 skip + 插件全 landed 仍属 exit 0，不与字面冲突。

### 1.4 输出样例（真实文本）

宽度在实现里按内容计算（`padEnd`），下面是排版基准。约定：进度/结果走 stdout（沿用 `provision-opentui-profile.mjs:134` 的 `say` 风格，前缀 `provision-opentui-profile: ` 换成 `dsh-opentui upgrade: `），WARN 走 stderr。

**(a) 计划表（`--dry-run` 与交互确认前共用）**

```
dsh-opentui upgrade: dsh home /Users/qingguee/.dsh · profile opentui · tag latest
dsh-opentui upgrade: registry https://registry.npmmirror.com (source: npm config; profile has no .npmrc)
dsh-opentui upgrade: note: querying through a mirror — `latest` may lag the official registry;
                     set DSH_UPGRADE_REGISTRY=https://registry.npmjs.org to pin the query source

  #    package                               current    target     action
  ──   ───────────────────────────────────   ────────   ────────   ──────────────────────────────
  self @aiwayds/dsh-opentui                 0.17.3     0.17.4     upgrade (npm global: /opt/homebrew/lib/node_modules)
  host @deepseek-ai/dsh                     0.2.2-rc.3 0.2.2-rc.4 behind — NOT upgraded (run: npm i -g @deepseek-ai/dsh)

  1    @aiwayds/dsh-approval-policy          0.3.0      0.4.0      upgrade
  2    @aiwayds/dsh-ask-router               0.7.0      0.7.2      upgrade
  3    @aiwayds/dsh-cron                     0.7.0      0.7.0      up to date
  ...
  19   @aiwayds/dsh-vault                    0.8.2      0.8.2      up to date (pin 0.8.0 · override 0.8.2)
  -    @aiwayds/dsh-workflow                 link:…     —          skipped (local spec — never replaced)
  -    @deepseek-ai/* (2 in dsh.profile.bundles)  —      —          excluded (host closure — never upgraded)

  11 upgrade · 8 up to date · 1 skipped · 0 unknown

  writes: 1 × dsh plugin --profile opentui add --save-exact <11 specs>
          1 × npm i -g @aiwayds/dsh-opentui@0.17.4
          1 × upgrade-overrides.json (11 entries, atomic)

Proceed? [y/N]
```

（`@aiwayds/dsh-workflow` 在当前 manifest 里是唯一的 `link:` 依赖，所以它只能出现在 `skipped (local spec)` 那一行；`pin · override` 的示例用另一个包 `@aiwayds/dsh-vault`。镜像提示行只在解析出的查询源不是 `registry.npmjs.org` 时打印。）

**(b) 成功终态**

```
dsh-opentui upgrade: [1/4] self      npm i -g @aiwayds/dsh-opentui@0.17.4 … done (12.4s)
dsh-opentui upgrade: [2/4] plugins   dsh plugin --profile opentui add --save-exact 11 specs … exit 0 (38.1s)
dsh-opentui upgrade: [3/4] verify    11/11 landed at the planned version
dsh-opentui upgrade: [4/4] overrides wrote 11 entries to ~/.dsh/profiles/opentui/upgrade-overrides.json

✔ upgraded 11 plugin(s) and dsh-opentui:
  @aiwayds/dsh-ask-router        0.7.0 → 0.7.2
  ...
  @aiwayds/dsh-opentui           0.17.3 → 0.17.4

next: this process still runs the OLD code. Quit and re-run `dsh-opentui` to start on 0.17.4.
      Plugin versions are on disk; the resident dsh host picks them up on its next start —
      quit the TUI fully and re-run (`/reload` alone only restarts the host on the same port).
backup: ~/.dsh/profiles/opentui/.dsh-opentui-upgrade-backup/20261116T142530Z
```

**(c) 失败终态（批量安装失败 → 已回滚）**

```
dsh-opentui upgrade: [1/4] self      already at 0.17.4 — up to date, no install (12s saved)
dsh-opentui upgrade: [2/4] plugins   dsh plugin --profile opentui add --save-exact 11 specs … FAILED (exit 1, 41.2s)

✖ upgrade failed at step 2/4 (install plugins)
  command : dsh plugin --profile opentui add --save-exact @aiwayds/dsh-ask-router@0.7.2 …
  exit    : 1
  stderr  : ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION — 0.7.2 was published 3h ago (minimumReleaseAge=24h)

rollback: restored package.json, pnpm-lock.yaml, pnpm-workspace.yaml from
          ~/.dsh/profiles/opentui/.dsh-opentui-upgrade-backup/20261116T142530Z-failed
          node_modules: `dsh plugin --profile opentui install --frozen-lockfile` exit 0 — back on the pre-upgrade versions
          upgrade-overrides.json: not written (only written after a verified install)

profile is unchanged. Re-run `dsh-opentui upgrade --dry-run` to inspect, or retry later.
```

**(d) 已是最新终态**

```
dsh-opentui upgrade: dsh home /Users/qingguee/.dsh · profile opentui · tag latest
dsh-opentui upgrade: registry https://registry.npmjs.org (source: DSH_UPGRADE_REGISTRY)

  self @aiwayds/dsh-opentui   0.17.4   0.17.4   up to date
  host @deepseek-ai/dsh       0.2.2-rc.3 0.2.2-rc.3 up to date

  19 plugin(s) up to date · 1 skipped (local spec) · 0 unknown

everything is already at `latest` — nothing to do.
```

**(e) profile 不存在终态（打包门禁要用，也必须定义）**

```
dsh-opentui upgrade: no profile at /tmp/upg-home/profiles/opentui — nothing to upgrade.
dsh-opentui upgrade: (the launcher creates it on the next start: run `dsh-opentui`, then `dsh-opentui upgrade`)
```

exit 0。`--reset-overrides` 在 profile 缺失时同样 exit 0（override 文件必然不存在，打印 `no override file at <path>` 并说明，见 §5.5）。

**(f) 部分成功终态（exit 3）**

```
⚠ upgrade partially applied — 9 landed, 2 not at the planned version
  landed : @aiwayds/dsh-ask-router 0.7.0 → 0.7.2, @aiwayds/dsh-cron 0.7.0 → 0.7.1, …
  not    : @aiwayds/dsh-vault    planned 0.8.2, installed 0.8.1 (registry lag / minimumReleaseAge)
           @aiwayds/dsh-llm-stats planned 0.9.3, installed 0.9.0 (registry lag / minimumReleaseAge)

the manifest and lock are consistent (pnpm exited 0); these two are NOT in upgrade-overrides.json,
so the next start will not pin a version that is not on disk.

⚠ downgrade risk for the ones NOT written: provisioning compares the installed version to the
  shipped PLUGIN_SET pin with equality, so on the NEXT START each of these packages is reinstalled
  AT THE SHIPPED PIN (a visible downgrade). Either re-run `dsh-opentui upgrade` before starting the
  TUI (retry the two), or accept the shipped pins for them.
```

---

## 2. 接线点清单（逐处：文件:行号 → 改什么）

基线行号全部在 `dsh-opentui-wt-release`（0.17.3）上重新核对。

| # | 位置 | 改动 |
|---|---|---|
| 1 | `packages/shell/bin/lib/launcher.mjs:51-68` | **`parseLauncherArgs` 一字不改**（47-68 的返回结构 `{version, force, rest}` 是 `bin-launcher.test.ts:28-46` 的契约）。在文件末尾（当前 `:284` 之后）**追加**两个纯函数并导出：`splitLauncherSubcommand(rest)`、`parseUpgradeArgs(args)`。 |
| 2 | `packages/shell/bin/dsh-opentui.mjs:73` | 这里是 argv 的唯一消费点。第 73 行 destructuring 之后加一行 `const sub = splitLauncherSubcommand(userArgs)`；分支体放在 **`:83`（`--version` 块结束）之后、`:86`（bun 检查）之前**（新注释段 `--- 0.5 upgrade subcommand ---`）。理由见下。 |
| 3 | `packages/shell/bin/dsh-opentui.mjs:116-141` | **不改**。provision 透传循环只按名字挑 `--provider/--model/--reasoning-effort/--plugins/--dry-run`（`:118-130`），`upgrade` 及其参数不可能被它捡到；且分支在 `:84` 附近就 `process.exit`，到不了这里。 |
| 4 | `packages/shell/bin/dsh-opentui.mjs:303-316`（兜底 spawn 在 `:309`） | **不改**。同理被 early exit 挡住。回归断言要求"升级分支绝不 spawn bun"。 |
| 5 | `packages/shell/package.json:9-19` `files` | **不改**。`files` 里的 `"scripts"` 递归整目录发布，新增的 `scripts/upgrade.mjs` 与 `scripts/lib/upgrade-plan.mjs` 自动随包。验收动作：`npm pack --dry-run --json` 必须列出这两个路径（见 §7.3）。 |
| 6 | `packages/shell/package.json:20-24` `scripts.prepack` | **不改**。`upgrade.mjs` 是纯源码、无构建产物；`prepack` 仍只跑 `build-client.mjs` + `verify-pack-locales.mjs` + `pack-meta.mjs`。若将来改成 bundling 才需要在这里串接。 |
| 7 | `packages/shell/test/bin-launcher.test.ts:27-47` | 现有两个 `test` **不改**。在文件里追加 `describe('splitLauncherSubcommand')`、`describe('parseUpgradeArgs')`（用例见 §7.1）。 |
| 8 | `README.md:42-58` 与 `packages/shell/README.md:42-58` | 两份文件 `diff -q` 无差异（当前 0.17.3 实测 SAME）。插入点在 **`README.md:59`（空行）之后、`:60`（`Architecture: one resident host …`）之前**（`:58` 是最后一条 bullet，`:59` 是空行）。插入 `## Upgrade` 段（约 20 行：一条命令、flag 表、重启语义、override 文件与 `--reset-overrides`、宿主不自动升、**查询源跟随安装源 + 非官方源时的镜像滞后提示 + `DSH_UPGRADE_REGISTRY`**）。**必须同时改两份并保持字节相同**。 |
| 9 | `e2e/scenarios/run-all.sh:21` | `E2E_SCENARIOS` 里 `10-install` 之后插入 `11-upgrade`。新增 `e2e/scenarios/11-upgrade.sh`（结构照 `10-install.sh:27-49`：`set -u` / source `common.sh` / `scenario '…'` / 非容器 `warn + summary + exit 0`）。 |

新增文件（均需在 T2/T3/T5 创建）：

- `packages/shell/scripts/upgrade.mjs` —— 命令体（自身升级、计划、确认、安装、备份、回滚）。只 import node 内建 + `./lib/upgrade-plan.mjs` + `./lib/provision-plan.mjs`（后者已在 `packages/shell/package.json:11` 的 `scripts` 里随包发布，复用 `parseVersion`/`compareVersions`/`isLocalSpec` 避免重复实现）。
- `packages/shell/scripts/lib/upgrade-plan.mjs` —— 纯逻辑（argv、清单筛选、计划行、override 读写、格式化），无 fs/spawn，供单测直接 import（沿用 `provision-plan.mjs:1-7` 的"纯逻辑分离"约定）。
- `packages/shell/test/upgrade-plan.test.ts`
- `e2e/scenarios/11-upgrade.sh`、`e2e/fixtures/mini-registry.mjs`

**为什么分支放在 `:83` 之后、`:86` 之前**：`upgrade` 只需要 `npm`（自身）和 `dsh`（插件），不需要 `bun`（`:86-88`），也不需要 `@deepseek-ai/dsh-client-connection` 软链（`:236-266`）。放在 bun 检查之前，用户可以在没装 bun 的环境里升级；放在 `--version` 之后，保持 `--version` 的绝对短路语义（`:75-83` 的整段回归断言依赖这一点）。

### 2.1 三条回归断言（必须逐条证明不变）

**A. `--version` 不变**
```
node packages/shell/bin/dsh-opentui.mjs --version
```
- stdout 精确等于 `dsh-opentui <packages/shell/package.json .version>\n`（`:81`），exit 0。
- `DSH_HOME=$(mktemp -d)` 下执行，该目录**仍为空**（证明没走 provision `:131`、没走 TUI `:309`）。
- 单测：`parseLauncherArgs(['--version'])` 仍 deep-equal `{version:true,force:false,rest:[]}`；`readLauncherVersion(pkgRoot) === pkgVersion`（`bin-launcher.test.ts:49-57` 原样通过）。

**B. `--force` 不变**
- 单测：`parseLauncherArgs(['--force','--model','x'])` 仍 deep-equal `{version:false,force:true,rest:['--model','x']}`（`bin-launcher.test.ts:32-36` 原样通过）。
- 进程级：`node ... --force` 仍先打印 `--force: killed N stale instance(s)`（`:109`），再走 provision、再启动 client；`selectStaleProcesses`/`classifyProcess`/`killStaleProcesses` 的 20 个既有用例零改动通过。
- 组合：`--force` 与 `upgrade` 同用 → exit 2（`--force is not supported with upgrade`），不执行任何动作。检查点是 **bin 分支的 `forceFlag && sub.command`**——`--force` 已被 `parseLauncherArgs`（`launcher.mjs:61-64`）消费，永远到不了 `parseUpgradeArgs`（见 §7.1 用例 8）。这条是新定义，不是回归，因为该组合今天无意义。

**C. 无参启动不变**
- 单测：`parseLauncherArgs([])` → `{version:false,force:false,rest:[]}`；`splitLauncherSubcommand([])` → `{command:null,args:[]}`。
- 进程级：无参启动仍按 `:86 → :91 → :116 → :144 → :236 → :309` 顺序走完；`e2e/scenarios/20-start.sh` 不改一行且必须继续通过（这是"无参启动没被新分支污染"的最强证据）。
- 位置参数边界：只有 `rest[0] === 'upgrade'`（大小写敏感）才进子命令；`['--model','upgrade']`、`['Upgrade']`、`['upgrade-lookalike']` 全部走原路径。单测覆盖。

---

## 3. 自升级子流程

### 3.1 判定"我这个 dsh-opentui 是什么安装形态"

复用 bin 里已有的两段现成实现，不新造轮子：

- 包根：`pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)))`（`bin/dsh-opentui.mjs:57`）。
- `npm root -g` 探测：`bin/dsh-opentui.mjs:272` 已有同样调用。
- 从 bin 路径 realpath 向上走 8 层找 `package.json.name` 的写法：`bin/dsh-opentui.mjs:280-298` 已有同样模式（那段是找宿主 `@deepseek-ai/dsh`，这里找自己）。

判定顺序（第一个命中的生效）：

1. `which dsh-opentui` → `realpathSync` → 向上找 `name === <own name>` 的包根。取不到 → `unknown`。
2. `realpath(包根) !== realpath(pkgRoot)` → `other-copy`（源码树、bun 直接跑、另一份拷贝）。**跳过自身升级**，打印：`self: running from <path>, not the installation that \`which\` resolves — skipping self-upgrade`。
3. `realpath(join(npmRoot, ...ownName.split('/'))) === realpath(pkgRoot)` → `npm-global`（`ownName` 从运行中 `pkgRoot/package.json` 读，见 §3.2；本机就是 `/opt/homebrew/lib/node_modules/@aiwayds/dsh-opentui`）。
4. 包根路径里含 `/pnpm/global/`（pnpm 全局）或 `/.bun/install/global/`（bun 全局）→ `foreign-pm`。**不执行 `npm i -g`**（会在另一个 prefix 造影子副本，`which` 仍解析老的 → 假成功），改为打印手工命令：`<detected pm> add -g <own name>@<target>`，该行计为 `skipped (managed by pnpm|bun)`，**不**计入失败。
5. 其余 → `unknown`（含 `--prefix` 装到自定义 prefix 的情形）：不做任何安装，表里 action 打 `skipped (unrecognized install: <pkgRoot>)`，并给出 `<own name>@<target>` 的手工命令。分支 1 取不到包根时打同一条。

### 3.2 用哪条命令升、包名从哪读

- 目标包名：`JSON.parse(readFileSync(join(pkgRoot,'package.json'))).name`（真源是 `packages/shell/package.json:2` = `@aiwayds/dsh-opentui`）。**不硬编码**——`bin/lib/launcher.mjs` 里没有包名常量，硬编码会在改名时静默失效。
- 命令：`npm i -g <own name>@<target>`，附加 `--no-fund --no-audit`。
  - **不加** `--ignore-scripts`：`packages/shell/package.json:20-24` 只有 `prepack`，没有 `postinstall`/`install`，加了只会掩盖将来误加钩子的错误（`prior-art` §3.8 的 `--ignore-scripts` 是给退役路径用的）。
  - **不加** `--force`；**不先卸载**再装（opencode 的经验：先卸载会在运行中把 bin 摘掉）。
  - **不**传自定义 `--registry`：写路径沿用用户现有的 registry 配置（与 `provision-opentui-profile.mjs:362-373` 的写路径一致）；只有 §4 的**查询**会显式传 `--registry`，其值按 §4.2 的 seam 解析（默认与安装源一致）。

### 3.3 升后校验

三层，任一失败即 exit 1：

1. `npm` 的 exit code 必须为 0；非 0 → 附 stderr 尾部 2KB（照 `provision-opentui-profile.mjs:455-462` 的 tail 截断习惯）。
2. 重新执行 §3.1 的第 1-3 步（**重新 realpath，不缓存**），读该包根的 `package.json.version`，必须 `=== target`。不等 → `npm exited 0 but the copy at <path> is still <v>` + 重试命令。
3. `which dsh-opentui` 仍能解析，且其包根版本 == target（防"装到别的 prefix"）。

### 3.4 运行中进程的语义（必须显式说明）

`npm i -g` 替换的是磁盘上的包目录；**当前进程仍在跑旧代码**（Node 已装载的 ESM 模块不会热替换）。因此：

- `upgrade` 是**终端命令，不进入 TUI**：分支执行完 `process.exit(status)`，绝不落到 `:303` 的 client spawn。
- 成功文案固定包含：`this process still runs the OLD code. Quit and re-run \`dsh-opentui\` to start on <target>.`
- 不自动 re-exec（会让退出码语义变复杂，且在 npm 替换自身包目录后再 exec 有窗口期风险）。
- 读当前版本只在**执行前读一次**并留在内存里（`currentVersion`），升完不再读运行中的 `pkgRoot`（它可能已被替换），只读重新解析出的安装根（见 §3.3 第 2 步）——这条也写进 R9。

---

## 4. 插件升级子流程

### 4.1 "已安装插件清单"从哪读

**真源：`$DSH_HOME/profiles/opentui/package.json` 的 `.dependencies`**（`provision-opentui-profile.mjs:201-202` 的 `manifestDependencies` 同一语义）。

不选其它来源的理由：

- `node_modules/`：装失败的包没有目录 → 会漏掉"声明了但没装上"的项；且 hoisted 布局下目录存在不代表 manifest 认账。
- `dsh.profile.bundles`（`~/.dsh/profiles/opentui/package.json:6-27`，20 项）：是**加载清单**，包含 `@deepseek-ai/dsh-base`/`dsh-web-app` 这类宿主闭包，且不含只在 deps 里的 `dsh-jev-core`/`dsh-self-improve`。用它会把宿主包拖进来。
- `PLUGIN_SET`（`provision-plan.mjs:23-96`，12 项）：是**产品 pin 表**，不是"已装清单"；用户 profile 里有 20 个 dep（19 pin + 1 link，含 8 个 `EXCLUDED_PLUGINS`），升它等于无视用户已装的东西。

排除规则（按顺序，先命中先生效）：

1. `isLocalSpec(spec)`（`provision-plan.mjs:342-344`，`link|file|workspace|portal:`）→ `skipped (local spec — never replaced)`。本机命中 `@aiwayds/dsh-workflow: link:/Users/qingguee/repo/dsh-workflow`（`~/.dsh/profiles/opentui/package.json:50`）。
2. name 以 `@deepseek-ai/` 开头 → `excluded (host closure)`。理由：这些包由 `$DSH_HOME/profiles/node_modules` 软链农场解析到全局 dsh 闭包（facts §3、§4.4），升单个会与在跑的宿主版本分裂；升全部等于变相升宿主，与已定前提 #1 冲突。
   说明：本机 opentui profile 的 `dependencies` 里其实**没有** `@deepseek-ai/*`（它们只出现在 `dsh.profile.bundles:6-27` 的前两项），所以这条过滤在 deps 上通常命中 0 项；`dsh.profile.bundles` 里的宿主包另作一行汇总展示（`excluded (host closure — never upgraded)`），让"我们没动宿主闭包"在输出里可见。别的 profile（如 tui）确实会在 deps 里直接依赖宿主包，那时由这条规则跳过。
3. `parseVersion(spec) === null`（`git+…`、`https:…`、`*`、`workspace:*` 等非纯版本）→ `skipped (unsupported spec)`。
4. **`EXCLUDED_PLUGINS`（`provision-plan.mjs:100-109`）不参与过滤**。它是 provisioning 档位的排除表，不是安装禁令；profile 里实际装着 `dsh-dcp`/`dsh-feishu`/`dsh-llm-proxy`/`dsh-web-search-tavily`/`dsh-agent-dispatch`/`dsh-self-improve`/`dsh-profile-switch`（`~/.dsh/profiles/opentui/package.json:31-49`），用户已装的东西必须一起升。单测专门断言这条（§7.1 用例 3 最后一条）。

### 4.2 版本查询（查询源 = 安装生效源，可被环境变量覆盖）

查询源是一个**可注入的 seam**，按顺序解析（第一命中生效）：

1. `DSH_UPGRADE_REGISTRY` 环境变量（显式覆盖；e2e/CI 用它指向 `127.0.0.1` fixture，见 §7.2）；
2. profile 生效的 registry：`$DSH_HOME/profiles/opentui/.npmrc` 的 `registry=` > `~/.npmrc`（即 pnpm 在 profile 目录里的解析结果）；
3. 兜底 `https://registry.npmjs.org`。

**为什么跟随安装源而不是硬编码官方源**：查询源必须与安装生效源一致，否则镜像用户会常态性拿到"镜像还没同步、装不上"的版本 —— 每次升级都以 exit 3 收场，这是常态而非边角。`--prefer-online` 仍然一律给（绕本地缓存/负缓存，prior-art §3.6 有本机事故记录）。

```
npm view <name> dist-tags --json --registry=<resolved> --prefer-online
```

- 解析出的源固定打印在表头（`registry <url> (source: DSH_UPGRADE_REGISTRY | profile .npmrc | npm config)`）。**镜像提示行的规则**：解析出的源既不是 `registry.npmjs.org`、`source` 又不是 `DSH_UPGRADE_REGISTRY` 时，额外打印 `note: querying through a mirror — latest may lag`（用户显式设了 env 就是显式选择，不唠叨）；见 §1.4(a)。
- 若 `DSH_UPGRADE_REGISTRY` 被显式设置且**不等于**安装生效源：额外 WARN `query source <q> differs from install source <i> — a planned version may not be served by <i> yet`。这是唯一会分裂的场景，且是用户自己选的。
- 写路径一律**不**传 `--registry`（沿用 profile/用户现有配置，见 §4.4），所以默认情形下查询源 == 安装源。
- 解析 `JSON.parse(stdout)[tag]`；解析失败 / 无该 key / 非 0 exit → 该包 `unknown`（**绝不**当成可降级的证据）。
- 顺序执行，打印进度 `resolving 7/19 <name> …`；单次 `timeout: 60_000`。19 次调用最坏 ~30s，可接受；未来优化（一次 HTTP GET abbreviated packument）只写注释，不进本期需求。

### 4.3 计划行生成

逐包判定（`compareVersions` 复用 `provision-plan.mjs:291-312`）：

| 条件 | action |
|---|---|
| 查询失败/无 tag | `unknown` / `skipped (no <tag>)` |
| `compareVersions(target, current) > 0` | `upgrade` |
| `=== 0` | `up to date` |
| `< 0`（本地版本比 latest 新，如预发布或本地构建） | `up to date` + `ahead` 标记，**永不降级** |

只有 `upgrade` 行进批次 specs，顺序 = manifest 的 key 插入序（确定性，便于测试断言）。specs 形如 `<name>@<target>`。

### 4.4 写盘方式结论：用 `dsh plugin add`，不用直接 pnpm

**结论：** 一批 `dsh plugin --profile opentui add --save-exact <specs...>`。

依据（按重要性）：

1. **错误可见性**：`spawnSync('dsh', […], { stdio: 'inherit' })`（照 `provision-opentui-profile.mjs:362-373`），pnpm 的 `ERR_PNPM_*` 原样进终端，`classifyPluginAddFailure`（`provision-plan.mjs:226-244`）可直接复用做提示。直接跑 `pnpm add` 只是换了父子进程，没有可见性收益。
2. **有宿主保护**：`dsh plugin` → `runPluginCommand` 会拿 profile `package.json` 文件锁（120s）、在 pnpm 前后备份并恢复 `package.json` + `pnpm-lock.yaml`、对 `add/install/i`（`INSTALL_COMMANDS`，`operations.ts:158-172`）做安装前 registry 预检、安装后对变化过的依赖做 `engines.dsh`/peer 兼容检查（`operations.ts:496-565`）。直接 pnpm 全部绕过。
3. **不破坏精确 pin**：`--save-exact` 会被 `dsh plugin` 原样转发给 pnpm（`dsh/src/plugin.ts:17` 的契约原话："all other arguments remain pnpm's responsibility"），于是 `add` 写 `"0.7.2"` 而不是 `"^0.7.2"`，与现有 profile 的 19 个精确 pin（`~/.dsh/profiles/opentui/package.json:30-51`）和 `pnpm-lock.yaml` 的 `specifier`（`~/.dsh/profiles/opentui/pnpm-lock.yaml:10-40` 全为精确值）一致。宿主的 `updateBundle` 走 registry 版本时同样用 `saveExact: true` + `--save-exact`（`dsh-plugin-manager/src/index.ts:866,1039`），是生态既有意图。
4. **不需要宿主在线**：`dsh plugin` 是 CLI，直接在 profile 目录跑 pnpm；不要求有常驻 host 进程。
5. **反例**：直接 pnpm 需要自己找 pnpm（`packages/shell/scripts/install-profile.mjs:122-131` 的 `npx -y pnpm@10.18.3` 兜底，而该脚本因缺 `solid-js-pin.mjs` 已是死脚本）、自己 `cwd: profileDir`、自己处理 lock/rollback —— 等于把宿主的 3 个保护重写一遍。

**已知不确定项（必须由 T4 验收消解）**：`--save-exact` 是否被 `dsh` 顶层 argv 解析器接受。契约说其余参数归 pnpm（`plugin.ts:17`），但未实测。T4 的验收命令里包含一次 `dsh plugin --profile opentui add --help`（本地、无网络）确认 flag 穿透；若被拒，退路 F1：去掉 `--save-exact`，只靠 override 清单锁定版本（provisioning 判定用 override，不看 manifest 的 range），并在结果里 WARN 一句 `profile pins are now ranges (^x.y.z); the override file keeps provisioning from downgrading`。**不要**在 pnpm 跑完后手工改写 package.json（会让 lock 的 `specifier` 与 manifest 不一致，下次 install 被判 stale）。

### 4.5 落盘后逐包校验

读 `$DSH_HOME/profiles/opentui/node_modules/<name>/package.json` 的 `version`（访问器形状照 `provision-opentui-profile.mjs:206-212`）：

- `=== target` → `landed`
- 其它版本 → `mismatch`（记录实际值；典型原因 `minimumReleaseAge`、镜像滞后）→ exit 3，**不写入 override**
- 目录不存在 → `missing` → exit 3，不写入 override

不做逐包重试（与 provisioning 的 `PLUGIN_ADD_ATTEMPTS` 策略相反）。理由：升级要"尽量原子"，逐包重试正是制造"3 成 1 败"的原因；单批失败就整体回滚（§6）。

---

## 5. override 清单设计

### 5.1 文件路径与格式

路径：`$DSH_HOME/profiles/opentui/upgrade-overrides.json`

选这里的理由：与 `package.json` / `compatibility.json` 同目录（宿主已习惯该目录下的旁挂文件，且不读未知文件）；`npm i -g dsh-opentui` 只替换全局包，不会清掉 profile；可手改、可审计；不在发布物里。

```json
{
  "schema": 1,
  "writtenBy": "@aiwayds/dsh-opentui 0.17.4 upgrade",
  "updatedAt": "2026-11-16T14:25:31.204Z",
  "pins": {
    "@aiwayds/dsh-ask-router": "0.7.2",
    "@aiwayds/dsh-cron": "0.7.1",
    "@aiwayds/dsh-dcp": "0.14.0"
  }
}
```

- 只有 `pins` 有语义；`schema`/`writtenBy`/`updatedAt` 是审计字段，读侧忽略。
- `schema !== 1` 或 JSON 解析失败 → **整文件忽略** + WARN `upgrade-overrides.json ignored (<reason>) — provisioning behaves as shipped`，**绝不抛错、绝不半解析**（fail-safe：没有该文件时的行为必须与现状逐字节一致）。
- 空对象 / 空 `pins` 等价于"无 override"。

### 5.2 何时写、写入粒度

- **只在两个条件都成立后写**：(a) 批量 `dsh plugin add` exit 0；(b) 逐包校验（§4.5）至少 1 个 `landed`。
- **粒度：一次整表原子写**（`writeFileSync(tmp)` + `renameSync`），不是逐包。理由：逐包写会在中途失败时留下"一半 override + 一半 downgrade 风险"的文件，比不写更糟。
- 合并规则（read-modify-write）：保留本次未升级的名字的既有 entry；用本次 `landed` 覆盖；**删掉 `target <= shipped pin` 的 entry**（见 5.4 过期规则）——但只对 `PLUGIN_SET` 里的名字做"<= pin"剪枝，非 `PLUGIN_SET` 名字没有 pin 可比，只保留。
- 记录范围：**所有 `landed` 的包**（不只 `PLUGIN_SET` 成员）。虽然只有 `PLUGIN_SET` 成员会被读侧消费，但记录全部让文件成为"升级审计日志"，并且未来某包被加进 `PLUGIN_SET` 时不会立刻被旧 pin 降级。

### 5.3 provisioning 的具体接入点（真实行号）

判定点唯一：`packages/shell/scripts/lib/provision-plan.mjs:379`

```js
// 现状（0.17.3）
const depOk = depSpec !== undefined && (isLocalSpec(depSpec) || satisfiesVersion(installed, plugin.version))
```

改为（≤6 行伪代码，签名级）：

```js
const wanted = effectivePin(plugin.version, overrides[plugin.name])   // 默认就是 shipped pin
const depOk = depSpec !== undefined && (isLocalSpec(depSpec) || satisfiesVersion(installed, wanted))
...
install.push({ name: plugin.name, spec: `${plugin.name}@${wanted}`, reason: plugin.reason })  // :381
```

签名变化（加法，不破坏现有调用）：`provision-plan.mjs:370`

```js
export function planPluginInstall({ tier, dependencies = {}, bundles = [], installedVersions = {}, overrides = {} })
```

`effectivePin` 放在 `upgrade-plan.mjs`（纯函数，单测直接覆盖）：

```js
// override 只在"严格新于 shipped pin"时生效；pin 抬上来后自动失效
export function effectivePin(pin, override) {
  if (parseVersion(override) === null) return pin
  return compareVersions(override, pin) > 0 ? override : pin
}
```

provision 脚本读侧：在 `provision-opentui-profile.mjs:394-400` 之间（`const manifest = readManifest() ?? {}` … `const plan = planPluginInstall(...)` 之前）插入一次读取：

```js
const overrides = readUpgradeOverrides(join(profileDir, 'upgrade-overrides.json'))  // 缺失/损坏 → {}
const plan = planPluginInstall({ tier, dependencies, bundles, installedVersions, overrides })
```

**没有该文件时的行为必须与现状逐字节一致**，靠三条保证：

1. `readUpgradeOverrides` 返回 `{}`，`effectivePin(pin, undefined) === pin`；
2. 单测断言 `planPluginInstall(x)` deep-equal `planPluginInstall({...x, overrides: {}})`，且 `provision-plan.test.ts:117-179` 的**既有断言一行不改**照旧通过；
3. `[3/5] plugins` 的进度文案（`:404-408`、`:411`、`:462`）不改，避免 e2e 文本断言漂移。

### 5.4 与 `PLUGIN_SET` 精确 pin 的关系（过期规则）

- 病根：`satisfiesVersion` 对纯精确版本走 `cmp === 0`（`provision-plan.mjs:316-336`），而 `PLUGIN_SET` 全精确（`:23-96`）。所以"装得比 pin 新"被判为不满足 → `:381` 拼出 `name@<pin>` → **降级**。
- 有 override 时：wanted = override（例如 `0.7.2`），已装 `0.7.2` 满足 → `install` 为空 → 不降级。
- **下次包版本升级把 pin 抬高时，override 自动失效**：`compareVersions('0.7.2','0.8.0') <= 0` → `effectivePin` 返回 pin `0.8.0` → 已装 `0.7.2` 不满足 → 正常升到 `0.8.0`。这是刻意设计：pin 代表产品承诺，产品追上/超过用户的 override 时应由产品说了算，用户不需要手工清文件。
- 反向保护：override 比 pin **旧**（手改错、或 pin 已经跳到 0.8.0 而 override 还是 0.7.2）→ pin 胜出，绝不因 override 降级。
- 升级命令自己也会在写文件时按同一规则剪掉过期 entry，所以文件不会无限积累。

### 5.5 清理方式

`--reset-overrides` 是 **terminal action**（语义定死，不留歧义）：**清完即退出 0，不继续执行任何升级**。

选这个语义的理由：

- 与升级组合会让退出码语义混叠（"清成功 + 升级部分成功"该报 0 还是 3？）；
- 用户需要先看到"清掉了什么 + 下次启动会降到哪些 pin"，再决定是否重跑 `upgrade`；
- 避免"清完立刻被同一命令写回新 override"的悖论。

行为与组合规则：

- `dsh-opentui upgrade --reset-overrides`：删除文件（不存在则打印 `no override file at <path>`，exit 0），逐条打印被清掉的名字，退出 0。**同一屏必须**提示后果：`the next start converges back to the shipped pins (this may downgrade: ask-router 0.7.2 → 0.7.0); re-run \`dsh-opentui upgrade\` to re-pin`。
- `--reset-overrides --dry-run`：只打印"会清掉哪些 entry"，**不动文件**，exit 0。
- `--reset-overrides` 与 `--no-self` / `--no-plugins` / `--tag` / `--yes` / `--force` 任一组合 → **usage error，exit 2**（这些 flag 对 terminal action 无意义）。这条同时落实 §1.2 的"不能与 `--no-self --no-plugins` 同用"：不只是那两个，而是所有 scope/执行类 flag。
- profile 不存在时：文件必然不存在 → 打印 `no override file at <path>`，exit 0（与 §1.4(e) 一致）。
- 文档同时写明手删即可（`rm $DSH_HOME/profiles/opentui/upgrade-overrides.json`），因为它是纯文本旁挂文件。

---

## 6. 回滚与备份

### 6.1 备份什么、放哪

目录：`$DSH_HOME/profiles/opentui/.dsh-opentui-upgrade-backup/<UTC ts>-<pid>/`

| 文件 | 必需性 | 说明 |
|---|---|---|
| `package.json` | 必需 | 依赖 pin 的唯一真源 |
| `pnpm-lock.yaml` | 存在则备 | 回滚后的 `install --frozen-lockfile` 依赖它 |
| `pnpm-workspace.yaml` | 存在则备 | **宿主明确不回滚它**（`dsh-plugin-manager/README.md:72`），本机还有用户手写的 `'@aiwayds/dsh-vault': false`（`~/.dsh/profiles/opentui/pnpm-workspace.yaml:18`），必须自己保 |
| `upgrade-overrides.json` | 存在则备，否则记 marker `overrides.absent` | 回滚时要能把它恢复成"本来没有" |

**不备**：`node_modules/`（体积大，由恢复后的 lock 重装重建）、`cordis.patch.yml`（升级路径不碰它，`.bak-*` 已有一堆）。

**用 copy 不用 rename**：rename 会让 pnpm 在跑到一半时看不到 live 文件。

### 6.2 生命周期

1. 自身升级（§3）—— 不进备份（profile 无关）。**硬失败在这里就 exit 1 并中止，§6.3 的 step 3（备份）起全部不执行**；skip 则继续。自身升级成功后不因后续插件失败而回退自身。
2. 备份写入（copy）。
3. 批量 `dsh plugin add`。
4. 逐包校验。
5. 写 override（仅当 ≥1 landed）。
6. **成功**：保留本次目录；同一父目录下只留最近 2 个 ts 目录，更老的删除（`fs.rmSync` 递归删自己的目录，不用 shell）。成功文案打印路径。
7. **失败**（第 3 或第 4 步）：
   a. 从备份 copy 回 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`；
   b. override：备份里有就 restore，备份里有 `overrides.absent` 就删掉磁盘上可能被写出的文件；
   c. `dsh plugin --profile opentui install --frozen-lockfile` 重建 `node_modules`（宿主自己的回滚也是这条：`operations.ts:549-561` 的 `restore()` + `['install','--frozen-lockfile']`）；
   d. 目录重命名成 `<ts>-failed` 并打印；
   e. exit 1，文案见 §1.4(c)：**卡在哪一步、命令是什么、exit code、stderr 尾部**。
   
   幂等性说明：宿主此时很可能**已经**恢复了 `package.json`+`lock`（它的 `RESTORED_FILES`，prior-art §3.4）。我们再 copy 一次相同字节是无害的；我们补上它不恢复的 `pnpm-workspace.yaml`。
   
   若 (c) 的重装也失败：文案降级为 `restored package.json and pnpm-lock.yaml, but node_modules could not be reinstalled (exit N) — run \`dsh plugin --profile opentui install\` manually`，仍然 exit 1（与宿主的措辞对齐，避免用户以为已完全恢复）。

### 6.3 控制流、部分成功与退出码

执行顺序与短路规则（这是全文唯一的控制流定义）：

1. **解析 + 计划**（只读：读 manifest、查 registry、算表；不写任何文件）。
2. **自身升级**（§3），三种结果：
   - **landed** → 继续 step 3；
   - **硬失败**（`npm i -g` 非零 / `npm` exit 0 但磁盘版本未落地 / EACCES / 写盘失败）→ **立即 exit 1，step 3 起（备份/安装/校验/override）全部不执行，profile 一个字节都不碰**。文案：`failed at step 1/4 (self)` + 命令 + exit code + stderr 尾部 + `profile untouched`。**不**建议用 `--no-self` 继续（那正是"旧 launcher + 新插件"的终态，见本节末）；用户坚持的话命令仍执行，但结尾必须打印 skip 情形的那条警告。
   - **skip**（`foreign-pm` / `other-copy` / `unknown`，§3.1）→ **不算失败**，继续 step 3；最终结果码由插件阶段决定（全 landed → 0，有 mismatch → 3）。
3. **备份**（§6.1）→ 4. **批量 `dsh plugin add`** → 5. **逐包校验**（§4.5）→ 6. **写 override**（§5.2）。

编号对照（避免和 UI 进度行混淆）：UI 只打印 4 步 —— `[1/4] self` / `[2/4] plugins`（= 这里的 step 3+4）/ `[3/4] verify` / `[4/4] overrides`；上面 1-6 是内部序号，不打印。`failed at step 1/4 (self)` 用的是 UI 编号。

部分成功的定义（只此一种，与 §1.3 的 exit 3 一一对应）：

- 单批 `dsh plugin add` **非 0** → 全量回滚（§6.2 第 7 条）→ **exit 1**，不是部分成功。
- 单批 **exit 0**，但 §4.5 校验出现 `mismatch`/`missing` → **不回滚**（manifest/lock/node_modules 三者一致，只是"没到目标版本"）→ 记录 `landed` 集合、只对 landed 写 override、**exit 3**，文案见 §1.4(f)。

skip 且本次**实际升级了 ≥1 个插件**（全部 landed，exit 0）时，结尾**必须**追加：

```
⚠ the launcher was NOT upgraded (skipped: <reason>).
  Before the next start, upgrade it by hand: <detected pm> add -g @aiwayds/dsh-opentui@<target>
  otherwise the older launcher you will run does not read upgrade-overrides.json and
  provisioning will converge these plugins back to the shipped PLUGIN_SET pins.
```

为什么自身升级必须放在插件之前（顺序不可换）：override 清单只有**带本功能的 launcher** 会读。若先升插件、后升自身，而自身升级**硬失败**，磁盘上就会是"新插件 + 不读 override 的旧 launcher"，下一次启动把刚升的全按 pin 降回去（R1 复发）。把自身放在最前，并用"硬失败立即 abort、不碰 profile"保证：**自身阶段只要失败，profile 就没被动过**。唯一会留下"新插件 + 旧 launcher"的是 **skip**（非 npm 全局安装，我们无权改那个副本）——那条路径用 §6.3 的强制警告把风险显式交给用户，绝不让它静默发生。

### 6.4 并发

两个 `upgrade` 同时跑：宿主对 profile `package.json` 加文件锁，`lockWaitMs` 默认 120s（`operations.ts:591-610`），后到的会等或超时失败；我们的备份目录名含 `<pid>` 避免互相覆盖；批量安装（§6.3 的 step 4）拿到 `dsh: plugin command failed` 时统一按失败处理（exit 1），不重试。

---

## 7. 测试方案

### 7.1 单测：`packages/shell/test/upgrade-plan.test.ts`（新文件，`bun test`）

沿用仓内风格（`bun:test`，`describe`/`test`，纯函数直测：`bin-launcher.test.ts:6`、`provision-plan.test.ts:1-50`）。

**`describe('splitLauncherSubcommand')`**

1. `test('no subcommand: empty and non-upgrade argv pass through untouched')`
   - `[]` → `{command:null,args:[]}`
   - `['--model','upgrade']` → `{command:null,args:['--model','upgrade']}`
   - `['Upgrade']` / `['upgrade-lookalike']` → `command:null`
2. `test('upgrade at position 0 becomes a subcommand and keeps its own args')`
   - `['upgrade','--dry-run','--tag','next']` → `{command:'upgrade',args:['--dry-run','--tag','next']}`

**`describe('parseUpgradeArgs')`**

3. `test('defaults: tag latest, both scopes on, nothing dry-run')` → `{dryRun:false,yes:false,tag:'latest',self:true,plugins:true,resetOverrides:false,help:false,errors:[]}`
4. `test('flags parse in both --k v and --k=v forms')` → `['--tag=next']` 与 `['--tag','next']` 得同一结果
5. `test('--no-self + --no-plugins is a usage error')` → `errors` 含一条，实现层 exit 2
6. `test('--tag without a value or with an invalid name is a usage error')` → `['--tag']`、`['--tag','bad tag!']`
7. `test('unknown flags are collected, not ignored')` → `['--bogus','-z']` → `errors` 两条且包含原文
8. `test('--force never reaches parseUpgradeArgs (parseLauncherArgs eats it first)')`
   - `parseLauncherArgs(['--force','upgrade'])` → `{version:false, force:true, rest:['upgrade']}`（`launcher.mjs:61-64` 已把它消费掉），所以 `parseUpgradeArgs(['upgrade'])` 的参数里根本不存在 `--force`。
   - 因此"`--force` + `upgrade` 拒绝"的真实检查点是 **bin 分支** 的 `forceFlag && sub.command`（不是 `parseUpgradeArgs`）。单测放 `bin-launcher.test.ts`：断言上面那条 `parseLauncherArgs` 返回值不变；进程级断言放进 T3 验收（`node bin/dsh-opentui.mjs --force upgrade` → exit 2）。`upgrade-plan.test.ts` 里**不**再设 `--force` 用例。

**`describe('selectUpgradeTargets')`**（纯函数：`(dependencies, latestByTag, tag) → rows`）

9. `test('newer registry version plans an upgrade with current and target')`
10. `test('equal version is up to date')`
11. `test('an installed version ahead of latest is never downgraded')`（`current 0.8.0`, latest `0.8.0-rc.2` → `up to date` + `ahead:true`）
12. `test('local specs, host-closure packages, and non-version specs are skipped with distinct reasons')`
    - `link:…` → `skipped-localSpec`；`@deepseek-ai/dsh-base` → `excluded-host`；`git+https://…` → `skipped-unsupported`
13. `test('EXCLUDED_PLUGINS does not filter the upgrade set')`
    - deps 里放 `@aiwayds/dsh-tui-pi`（在 `provision-plan.mjs:101` 的排除表里）→ 仍然 `upgrade`

**`describe('planUpgrade')`**

14. `test('counts and spec list: upgrade/unparsable/upToDate/skipped/unknown')`
15. `test('specs keep manifest order and use name@target exactly')`

**`describe('upgrade overrides')`**

16. `test('effectivePin honours an override only when it is newer than the pin')`
    - `('0.7.0','0.7.2') → '0.7.2'`；`('0.8.0','0.7.2') → '0.8.0'`；`('0.7.0',undefined) → '0.7.0'`；`('0.7.0','garbage') → '0.7.0'`
17. `test('a missing, empty, or wrong-schema file degrades to no overrides without throwing')`
    - `''` / `'{}'` / `'{"schema":2,…}'` / `'not json'` → `{}` + 一条 warning
18. `test('mergeOverrides keeps untouched names, replaces landed ones, prunes entries at or below the pin')`
19. `test('serialize→parse round-trips byte-stable (2-space JSON + trailing newline)')`

**`describe('planPluginInstall with overrides')`**

20. `test('no overrides key produces the exact pre-change plan object')` —— deep-equal 与既有 fixture 相同（并把 `planPluginInstall(x)` 与 `planPluginInstall({...x, overrides:{}})` 对比）
21. `test('an override satisfied by the installed version plans no install')`
22. `test('installed at the shipped pin but override newer installs the override spec')`
23. `test('a stale override (pin raised past it) still installs at the pin')`

**`describe('formatting')`**

24. `test('plan table header and one row match the documented text')`（锁定 §1.4(a) 的列宽/表头；并断言示例里每个依赖名只出现一次——`link:` 的包不会同时出现在 pin 行；镜像提示行只在解析出的源不是 `registry.npmjs.org` 时输出）
25. `test('each terminal state prints its documented first line')`（成功/失败/已最新/无 profile/部分/skip-警告）

既有测试的存量回归（不改一行）：`bin-launcher.test.ts`（20 个）、`provision-plan.test.ts`（46 个）。

### 7.2 e2e 场景

新增 `e2e/scenarios/11-upgrade.sh`，在 `e2e/scenarios/run-all.sh:21` 里排在 `10-install` 之后。

**前置：自己保证 bin 存在**（单独跑 `E2E_SCENARIOS=11-upgrade` 时不能假设容器已全局装过包）：

1. 优先复用 `10-install` 产出的 tarball `/tmp/install-pkg/aiwayds-dsh-opentui-*.tgz`；
2. 没有就自己打：`(cd /src/packages/shell && npm pack --pack-destination /tmp/upgrade-e2e-pkg)`；
3. 装到**独立 prefix**：`npm i -g --prefix /tmp/upgrade-e2e-prefix --ignore-scripts --no-fund --no-audit --registry "$NPM_REG" <tarball>`，然后用 `/tmp/upgrade-e2e-prefix/bin/dsh-opentui` 作为被测 bin（**不再依赖容器全局前缀**，也不会污染它）。

**怎么避免真联网 / 真升级**：

- 起本地静态 registry：`e2e/fixtures/mini-registry.mjs`，`node` 内建 `http`，只对手写的 packument 路径返回 JSON，其余 404。监听 `127.0.0.1:0`，把端口回传给 shell。需覆盖：`@aiwayds/dsh-fake-a`、`@aiwayds/dsh-fake-b`、`@aiwayds/dsh-fake-new`，以及 `@deepseek-ai/dsh`（host 行也会查询，不提供会得到 `unknown`，输出不确定）。
- **查询源只用** `DSH_UPGRADE_REGISTRY=http://127.0.0.1:<port>`（§4.2 的 seam 第 1 优先级，压过 profile `.npmrc` 与 `~/.npmrc`）。这是 e2e 与 §4.2 的唯一衔接点：**不**改任何 flag、**不**写 `.npmrc`。
- 用**独立的 scratch profile**：`CLIENT_DSH_HOME=/tmp/upgrade-e2e-home`，手写最小 `profiles/opentui/package.json`（`deps` 为 `@aiwayds/dsh-fake-a: 1.0.0`、`@aiwayds/dsh-fake-b: 1.1.0`、`@aiwayds/dsh-fake-new: 0.1.0`、`@aiwayds/dsh-fake-up: link:…`、`@deepseek-ai/dsh-base: 0.2.2-rc.3`）。`--dry-run` 不需要 `node_modules`、不需要 lock。
- 调**安装后的 bin**，不是 `./dsh-opentui` 那个 bash launcher（`dsh-opentui:20-21` 直接 `exec bun …client-entry.tsx`，绕过 bin，测不到子命令）。
- 断言（leg 1，`--dry-run --no-self`，env 带 `DSH_UPGRADE_REGISTRY`）：
  - exit 0；表格（按 §1.4(a) 的列格式，不是箭头）里 `dsh-fake-a` 那行的 current/target 为 `1.0.0` / `1.1.0` 且 action 为 `upgrade`、`dsh-fake-b` 那行 action 为 `up to date`、`link:` 那行含 `skipped (local spec`、`@deepseek-ai/dsh-base` 那行含 `excluded (host closure`；
  - 表头打印的 `registry` 等于 `http://127.0.0.1:<port>` 且 `source: DSH_UPGRADE_REGISTRY`；**不**出现 `note: querying through a mirror`（因为这条提示只针对"解析出的源是镜像"，env 显式指定视为用户选择）；
  - `sha256sum` 前后一致：`package.json`、`pnpm-lock.yaml`（若存在）、`pnpm-workspace.yaml`（若存在）不变（dry-run 零写入）；
  - 无公网访问：脚本把 `HTTP_PROXY/HTTPS_PROXY` 指向一个不存在的地址，并断言查询源只有一个 `127.0.0.1:<port>`（fixture registry 命不中就是 404，不会 fallback 到公网）。
- leg 2（`--reset-overrides --dry-run`）：往 scratch profile 里放一份手写 `upgrade-overrides.json`，断言输出列出将清掉的 entry、文件仍在、exit 0。
- leg 3（`--no-self --no-plugins --dry-run`）：断言 `nothing to do` + exit 0（两个开关都不越界）。
- 不做的腿：真实安装。理由：需要 fixture 包的 tarball 与本地 tarball registry，收益低于成本；写盘路径已由 §7.3 真机门禁 + T4 的人工验收覆盖。e2e 的职责是 argv/计划/查询源/零写入契约。

场景文件统一用 `e2e/lib/common.sh` 的 `ok`/`bad`/`warn`/`summary`，非容器环境照 `10-install.sh:40-44` 直接 `warn` + `summary` + `exit 0`。

### 7.3 pack tarball 真机门禁（人工，一次性）

```bash
cd /Users/qingguee/repo/dsh-opentui-wt-upgrade/packages/shell
npm pack --pack-destination /tmp/upg
npm i -g --prefix /tmp/upg-prefix --ignore-scripts --no-fund --no-audit /tmp/upg/aiwayds-dsh-opentui-*.tgz
PATH=/tmp/upg-prefix/bin:$PATH DSH_HOME=/tmp/upg-home dsh-opentui --version
PATH=/tmp/upg-prefix/bin:$PATH DSH_HOME=/tmp/upg-home dsh-opentui upgrade --dry-run
npm pack --dry-run --json | grep -E '"path": "scripts/(upgrade|lib/upgrade-plan)\.mjs"'
```

断言：

1. `--version` 打印打包进去的版本（证明 `bin` 与 `scripts` 都在 tarball 里、`files` 白名单没漏）；
2. `upgrade --dry-run`（**不带** `--no-self`；带了这个 flag 自身判定分支根本不会执行，等于没验）打印 §1.4(e) 的"no profile at /tmp/upg-home/profiles/opentui"，exit 0；同时 `self` 行的 action 必须是 `skipped (unrecognized install: /tmp/upg-prefix/lib/node_modules/@aiwayds/dsh-opentui)`（§3.1 分支 5：`--prefix` 装的位置不等于 `npm root -g`），**不得**是 `upgrade (npm global…)`；且输出里没有任何 `npm i -g … done` 行（dry-run 连自身安装都不执行）。若本机 `npm root -g` 恰好被改成 `/tmp/upg-prefix/lib/node_modules`，则该断言退化为"self 行不是 `upgrade`"，仍然成立；
3. `npm pack --dry-run --json` 里出现 `scripts/upgrade.mjs` 与 `scripts/lib/upgrade-plan.mjs`。

**为什么不真升级**：

- `--prefix` 装出来的副本不在 `npm root -g` 下，真跑自身升级会（正确地）走 §3.1 分支 5 判为 `unknown` 并跳过 —— 升它证明不了用户机器上的行为；
- 插件真升级要连公网 registry 并写一个真实 profile，不适合当门禁；
- 门禁要证明的是"发布出去的 tarball 真的带上了新命令并且能跑起来"，`--dry-run` 已经覆盖。

---

## 8. 风险清单

致命度按"用户会得出错误结论"或"数据/环境被改坏"排序。

| # | 风险 | 后果 | 缓解 / 检测 |
|---|---|---|---|
| R1 | **升完没重启，用户以为没生效** | 用户重复执行 `upgrade`，或认为升级坏了；更糟的是以为改的是运行中的会话 | 成功文案固定包含"本进程仍跑旧代码 + 重跑 `dsh-opentui`"；并明确 `/reload` 只重启 host 同端口（`packages/shell/src/client/remote-restart.ts:1-40`），client 仍要重跑；plan 表里同时打印"运行中版本"与"磁盘版本" |
| R2 | **`@deepseek-ai/*` 被误纳入批量升级** | 与全局 dsh 闭包版本分裂（`$DSH_HOME/profiles/node_modules` 是软链农场），且会连带影响 tui/web 等所有 profile；还可能被宿主 `engines.dsh`/peer 门拒装 | 排除规则 2 + 单测用例 12；plan 表固定打印 `excluded (host closure: N package(s))` 让数字可见；宿主版本只打印"落后"提示，永不自动升 |
| R3 | **`link:` 依赖被改写** | 本地开发中的 `@aiwayds/dsh-workflow`（`~/.dsh/profiles/opentui/package.json:50`）被换成 registry 版本，开发工作流静默断掉 | 排除规则 1（复用 `provision-plan.mjs:342-344` 的 `isLocalSpec`）+ 单测用例 12 + plan 表逐行显示 `skipped (local spec)`；任何 `link:`/`file:` 都不进 specs 数组（单测断言 `specs` 不含它） |
| R4 | **override 让用户永久偏离 pin** | profile 长期停在旧版本，用户忘了为什么；或与 README 的 pin 表不符 | 过期规则（`effectivePin` 只在 override > pin 时生效，pin 追上即作废）；升级时自动剪枝过期 entry；plan 表打印 `pin x · override y`；`--reset-overrides` 且附带"会降级到 pin"的明示 |
| R5 | **批量升级中途失败，没有事务** | package.json/lock 与 node_modules 三者不一致；用户看到"部分能用部分不能" | 单批（一个 pnpm 进程）+ 自有备份 + 恢复后 `install --frozen-lockfile`；宿主自身的 manifest/lock 回滚作为第二层；失败文案逐项列出"恢复成功/恢复失败"；不做逐包重试以避免制造部分态 |
| R6 | **查询源与安装源分裂 / 查询结果滞后**（`minimumReleaseAge=24h`、镜像未同步、负缓存） | plan 表承诺 0.8.2，镜像上装不到 → 每次升级都以 exit 3 收场（**镜像用户的常态**，不是偶发）；如果按 target 写 override，provisioning 会认为装到的版本"不满足"而反复重装 | 查询源跟随安装生效源（`DSH_UPGRADE_REGISTRY` > profile `.npmrc` > `~/.npmrc` > 官方源，§4.2），并一律 `--prefer-online`；解析出的源固定打印，非官方源时打印"经镜像查询，latest 可能滞后"一行；`DSH_UPGRADE_REGISTRY` 与安装源不一致时额外 WARN；装后逐包校验 `node_modules/<pkg>/package.json`，不一致 → exit 3 且**不写 override**（避免 pin 一个不存在的版本）；README 段落同步说明该提示 |
| R7 | **旧 lock 与新包版本冲突** | pnpm 重解析整棵依赖树；`ERR_PNPM_OUTDATED_LOCKFILE`（若有人加了 frozen）；或 lock 的 `resolved` URL 被写成 npmmirror（`dsh-jev-core/CHANGELOG.md:11-12` 的真实事故） | 不用 frozen 跑正向升级（让 pnpm 正常更新 lock，由宿主接管）；回滚时才用 `--frozen-lockfile`；升级后可选检查 lock 里 `resolved:` 是否出现 `npmmirror`，出现则 WARN + 给重指命令（不进本期强需求） |
| R8 | **`--save-exact` 被 dsh 的参数解析吞掉/报错** | pin 变成 `^x.y.z`，profile 从"精确 pin"漂移；`pnpm update` 语义随之改变；后续 `dev-upgrade` 类工具会拒改 | T4 验收项（`dsh plugin --profile opentui add --help`）；装后断言每条升级过的 dep 是 `parseVersion(spec) !== null`，否则 WARN 并走退路 F1（只靠 override 锁版本）；绝不事后手改 manifest |
| R9 | **自升级把运行中命令自己的包目录换掉** | 运行中进程后续读 `pkgRoot/package.json` 可能读到**新**版本，导致成功文案或退出判定说谎 | 执行前只读一次版本并留在内存；升后只读**重新解析出的安装根**的 package.json；不 re-exec 自身 |
| R10 | **非 npm 全局安装（pnpm/bun 全局、源码树跑）** | `npm i -g` 在另一个 prefix 造影子副本，`which` 仍指向老副本 → 用户看到"成功"但没变化 | §3.1 五种形态判定；`foreign-pm`/`other-copy`/`unknown` 一律跳过并给对应包管理器的命令；只有重新 realpath 后版本 == target 才宣称成功 |
| R11 | **宿主落后 + 新版本插件抬高 `engines.dsh`/peer 下界** | 宿主拒装（`incompatible-version`），整批失败回滚；用户以为命令坏了 | plan 表在**执行前**就打印 host 落后行与建议命令；我们不自动升宿主（既定前提）；失败文案把宿主的 `incompatible-version` 原文带出来（宿主自己会打 `allow-version` 提示） |
| R12 | **override 读不出来 → 静默降级** | 文件损坏/手改错 schema 时 provisioning 退回现状行为，下次启动把刚升的版本降回去 | 读侧 fail-safe 但**必打 WARN**（stderr 进 `[3/5] plugins` 输出）；升级命令自己在写完 override 后回读一次并断言内容可解析；失败文案醒目 |
| R13 | **`ERR_PNPM_IGNORED_BUILDS` / `allowBuilds` 门** | 新版本插件带 `postinstall` 时整批失败；若自动放行会覆盖用户手写的 `'@aiwayds/dsh-vault': false`（`pnpm-workspace.yaml:18`） | **不自动**改 `allowBuilds`（与 provisioning 的 `approvePrintedBuilds` 刻意不同：升级不做猜测性放行）；失败文案给"把 pnpm 打印的 key 手加到 pnpm-workspace.yaml 后重跑" |
| R14 | **两个 upgrade 并发** | profile 被两个 pnpm 写；备份目录互相覆盖 | 宿主 profile 文件锁（120s）兜底；备份目录名含 `<pid>`；拿不到锁按失败处理，不重试 |

---

## 9. 落地任务拆分建议

每个任务单一动作、可独立验收、前置明确。分支 `feat/upgrade-command`（worktree `dsh-opentui-wt-upgrade`，从 `main` 0.17.3 拉出）。

### T1 纯逻辑与单测（无接线、无网络）
- 改：新增 `packages/shell/scripts/lib/upgrade-plan.mjs`（`splitLauncherSubcommand`、`parseUpgradeArgs`、`selectUpgradeTargets`、`planUpgrade`、`effectivePin`、`readUpgradeOverrides`/`mergeOverrides`/`serializeOverrides`、`formatPlan`/`formatResult`、退出码常量）；新增 `packages/shell/test/upgrade-plan.test.ts`（§7.1 的 24 个用例；用例 8 的 `--force` 断言按 §7.1 归 `bin-launcher.test.ts`，不落在这个文件；override 相关的 20-23 可留到 T2）。
- 验收：`cd /Users/qingguee/repo/dsh-opentui-wt-upgrade/packages/shell && bun test test/upgrade-plan.test.ts`
- 前置：无。

### T2 provisioning 尊重 override
- 改：`packages/shell/scripts/lib/provision-plan.mjs:370`（加 `overrides = {}`）与 `:379`/`:381`（改用 `effectivePin`）；`packages/shell/scripts/provision-opentui-profile.mjs:394-400`（读文件并传参）；`packages/shell/test/provision-plan.test.ts` 追加 §7.1 的 20-23 四个用例。
- 验收：
  ```
  cd /Users/qingguee/repo/dsh-opentui-wt-upgrade/packages/shell
  bun test test/provision-plan.test.ts && bun test test/upgrade-plan.test.ts

  # fixture 必须连 node_modules 一起拷：provision-plan.mjs:379 的三个条件里有 installedVersions
  rm -rf /tmp/t2-home && mkdir -p /tmp/t2-home/profiles
  cp -R ~/.dsh/profiles/opentui /tmp/t2-home/profiles/opentui

  # 复现病灶：把副本里 ask-router 的已装版本抬到 0.7.2（高于 pin 0.7.0）
  node -e 'const fs=require("fs"),f="/tmp/t2-home/profiles/opentui/node_modules/@aiwayds/dsh-ask-router/package.json";
           const p=JSON.parse(fs.readFileSync(f,"utf8")); p.version="0.7.2";
           fs.writeFileSync(f,JSON.stringify(p,null,2)+"\n")'

  DSH_HOME=/tmp/t2-home node scripts/provision-opentui-profile.mjs --dry-run --plugins=core | grep '\[3/5\]'
  #   期望：installing 1（ask-router@0.7.0）—— 降级病灶复现

  echo '{"schema":1,"pins":{"@aiwayds/dsh-ask-router":"0.7.2"}}' \
    > /tmp/t2-home/profiles/opentui/upgrade-overrides.json
  DSH_HOME=/tmp/t2-home node scripts/provision-opentui-profile.mjs --dry-run --plugins=core | grep '\[3/5\]'
  #   期望：already satisfied (7/7) —— override 被尊重，不降级
  ```
  第二条命令的 `already satisfied` 与第一条的 `installing 1` 是本任务的核心证据；两条都必须是 dry-run（零写入）。
- 前置：T1。

### T3 bin 接线 + 命令体（只到 `--dry-run`）
- 改：`packages/shell/bin/lib/launcher.mjs`（在 `:284` 之后追加两个导出，`parseLauncherArgs` 不动）；`packages/shell/bin/dsh-opentui.mjs`（`:73` 后取子命令，`:83` 后 `:86` 前加分支，`spawnSync(process.execPath, [scripts/upgrade.mjs, ...args], {stdio:'inherit'})` 后 `process.exit(status)`；`forceFlag && sub.command` 的 exit 2 守卫也在这里）；新增 `packages/shell/scripts/upgrade.mjs`（自身形态判定 + 计划表 + 打印，写盘路径留 TODO）；`packages/shell/test/bin-launcher.test.ts` 追加两个 `describe`（`splitLauncherSubcommand`，以及 §7.1 用例 8 的 `parseLauncherArgs(['--force','upgrade'])` 断言）。
- 验收：
  `cd packages/shell && bun test test/bin-launcher.test.ts && DSH_HOME=$(mktemp -d) node bin/dsh-opentui.mjs upgrade --dry-run --no-self; echo "exit=$?"`（期望 §1.4(e) 文本 + exit 0）
  `node bin/dsh-opentui.mjs --version`（输出与 `package.json` 版本一致，exit 0）
  `node bin/dsh-opentui.mjs upgrade --bogus; echo "exit=$?"`（exit 2）
  `node bin/dsh-opentui.mjs --force upgrade; echo "exit=$?"`（exit 2，且无 `--force: killed` 行 —— 守卫在 kill 之前）
- 前置：T1。

### T4 执行路径（确认、自身升级、批量安装、备份、校验、override 写、回滚）
- 改：`packages/shell/scripts/upgrade.mjs` 的 step 1-4（§3、§4.4、§4.5、§6）。
- 验收（需网络，人工）：
  1. `dsh plugin --profile opentui add --help` —— 确认 `--save-exact` 能穿透（R8）；
  2. 把 `~/.dsh/profiles/opentui` **连 `node_modules` 一起**复制到 `/tmp/upg-scratch/profiles/opentui`，然后 `node bin/dsh-opentui.mjs upgrade --yes`（**不带** `--no-self`：从源码树跑时 `which dsh-opentui` 指向全局 0.17.3、与 `pkgRoot` 不同 → 自身判定为 `other-copy` 并 skip，不碰全局安装，正好验证 §6.3 的 skip 路径）：期望 exit 0 或 3；输出**必须**带 §6.3 的 skip 警告（本次 ≥1 插件会升）；`/tmp/upg-scratch/profiles/opentui/upgrade-overrides.json` 存在且 `pins` 只含校验通过的包；`.dsh-opentui-upgrade-backup/<ts>/` 的 `package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml` 三件套齐全；
  3. 回滚演练：把 `--tag` 指向一个不存在的 tag（如 `--tag=no-such-tag-xyz`）重跑 → 每行 `skipped (no no-such-tag-xyz)`，exit 0 且零写入；再人为把某项 target 改成不存在版本（临时改 fixture，不入库）验证 exit 1 + 备份恢复 + `node_modules` 重装日志。
  4. 自身升级的**真路径不进自动验收**（会改用户全局安装）：执行者先跑 `node bin/dsh-opentui.mjs upgrade --dry-run`，确认 self 行 action 是 `upgrade (npm global: …)`；要真验证就在确认过 dry-run 之后单独执行命令并重跑 `--version` 比对。
- 前置：T2、T3。

### T5 e2e 场景与 fixture
- 改：新增 `e2e/fixtures/mini-registry.mjs`、`e2e/scenarios/11-upgrade.sh`；`e2e/scenarios/run-all.sh:21` 插入 `11-upgrade`。
- 验收：`E2E_SCENARIOS=11-upgrade bash e2e/scenarios/run-all.sh`（容器内；宿主机会自我 skip），期望该场景 `0 fail`。
- 前置：T2、T3。

### T6 文档与打包门禁
- 改：`README.md` 与 `packages/shell/README.md` 同步插入 `## Upgrade` 段（两份字节相同）；`CHANGELOG.md` 顶部加一条 unreleased 条目；跑 §7.3 门禁。
- 验收：
  `diff -q README.md packages/shell/README.md`（无输出）
  `cd packages/shell && npm pack --dry-run --json | grep -c 'scripts/upgrade.mjs'`（=1）
  然后执行 §7.3 的命令块，断言 §7.3 的 3 条结果。
- 前置：T4、T5。

依赖图：`T1 → {T2, T3}`；`{T2,T3} → {T4,T5}`；`{T4,T5} → T6`。

---

## 附：本方案引用的关键行号索引（0.17.3 基线）

| 主题 | 位置 |
|---|---|
| bin 包根 / DSH_HOME | `packages/shell/bin/dsh-opentui.mjs:57-58` |
| argv 消费点 | `packages/shell/bin/dsh-opentui.mjs:73` |
| `--version` 短路 | `packages/shell/bin/dsh-opentui.mjs:75-83` |
| bun / dsh 检查 | `packages/shell/bin/dsh-opentui.mjs:86-93` |
| provision 透传与 spawn | `packages/shell/bin/dsh-opentui.mjs:116-141` |
| client spawn（兜底） | `packages/shell/bin/dsh-opentui.mjs:303-316` |
| `parseLauncherArgs` | `packages/shell/bin/lib/launcher.mjs:51-68` |
| `npm root -g` / 向上找包根 | `packages/shell/bin/dsh-opentui.mjs:272`、`:280-298` |
| PLUGIN_SET / EXCLUDED / RETIRED | `packages/shell/scripts/lib/provision-plan.mjs:23-96`、`:100-109`、`:115` |
| `isLocalSpec` | `packages/shell/scripts/lib/provision-plan.mjs:342-344` |
| `parseVersion`/`compareVersions`/`satisfiesVersion` | `packages/shell/scripts/lib/provision-plan.mjs:278-336` |
| **override 接入点（`depOk`）** | `packages/shell/scripts/lib/provision-plan.mjs:379`（spec 在 `:381`，签名在 `:370`） |
| 失败分类 / 重试决策 | `packages/shell/scripts/lib/provision-plan.mjs:226-258` |
| profile 路径 / 读 manifest | `packages/shell/scripts/provision-opentui-profile.mjs:146-148`、`:192-212` |
| 写 manifest（含 `.bak-<ts>`） | `packages/shell/scripts/provision-opentui-profile.mjs:216-225` |
| 批量 `dsh plugin add` | `packages/shell/scripts/provision-opentui-profile.mjs:362-373`、`:412` |
| 读侧插入点 | `packages/shell/scripts/provision-opentui-profile.mjs:394-400` |
| `files` / `prepack` / 包名 | `packages/shell/package.json:9-19`、`:20-24`、`:2` |
| bin 单测契约 | `packages/shell/test/bin-launcher.test.ts:27-57` |
| plan 单测 | `packages/shell/test/provision-plan.test.ts:96-179` |
| README 双份 | `README.md:42-58`、`:65-88`、`:110-116`（`packages/shell/README.md` 同内容） |
| e2e 场景表 | `e2e/scenarios/run-all.sh:21` |
| 安装场景写法 | `e2e/scenarios/10-install.sh:27-49`、`:53`、`:74`、`:82-88` |
| 源码树 launcher（绕过 bin） | `dsh-opentui:20-21` |
| 宿主参数穿透契约 | `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/src/plugin.ts:17`（"all other arguments remain pnpm's responsibility"） |
| 宿主 INSTALL_COMMANDS 预检 | `…/dsh-plugin-manager/src/operations.ts:158-172` |
| 宿主备份/恢复边界 | `…/dsh-plugin-manager/src/operations.ts:97-98`、`:549-561`、`:591-610` |
| 宿主精确 pin 意图 | `…/dsh-plugin-manager/src/index.ts:866`、`:1039` |
