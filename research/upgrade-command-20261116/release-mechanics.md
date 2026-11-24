# dsh-opentui 发版机制调研（只读，2026-11-16）

调研对象：`/Users/qingguee/repo/dsh-opentui`（HEAD `feat/ask-user-redesign` @ b25460f）、
`/Users/qingguee/repo/dsh-opentui-wt-release`（`main` @ ff31d6f）、
`/Users/qingguee/repo/dsh-opentui-wt-upgrade`（`feat/upgrade-command` @ ff31d6f）。

本次调研未做任何写操作：无 merge/commit/push/tag/pack/publish/install。

> 2026-11-24 批次 2：本文所述 upgrade 命令及相关工作树文件已退役；正文保留为历史发版调研记录。

---

## 1. 包与版本

| 事实 | 证据 |
|---|---|
| 发布包名 | `packages/shell/package.json:2` → `"name": "@aiwayds/dsh-opentui"` |
| 当前版本 | `packages/shell/package.json:3` → `"version": "0.17.3"` |
| 根 package.json 无 version 字段 | `grep -c '"version"' package.json` → `0`（根只有 `"name": "dsh-opentui-monorepo"`、`"private": true`） |
| 是 workspace，不是单包 | 根 `package.json:3` `"private": true`；`pnpm-workspace.yaml:1-3` → `packages/*` + `starter` |
| packageManager | 根 `package.json:5` → `"packageManager": "pnpm@10.18.3"` |
| 只有 shell 是发布包 | 其余 5 个包 `private=true`：`@dsh-opentui/i18n` / `panel-kit` / `runtime` / `tui-base`（`2.2.5-893e8dc`） |

结论：**版本号只需改 `packages/shell/package.json:3` 一处**，根 package.json 不需要同步。
`packages/shell/package.json:38` 有 `"@dsh-opentui/runtime": "workspace:*"`，位于 `devDependencies`（消费端不安装）。

## 2. CI 发版

- 工作流只有 1 个文件：`.github/workflows/ci.yml`（`ls .github/workflows | wc -l` → `1`）。
- 触发条件：`ci.yml:2-6`
  ```yaml
  on:
    push:
      branches: [main]
    pull_request:
    workflow_dispatch:
  ```
  没有 `push: tags:`，没有 `release:` 事件。
- 两个 job：`test`（`ci.yml:9`，macOS+Ubuntu 矩阵，跑 `bun test` / `test:ft` / `typecheck:entry` / `verify:` 过滤）与 `real-client`（`ci.yml:88`，opt-in 自托管 runner）。
- **没有任何 publish 步骤**：`grep -n -i "publish|registry|NPM_TOKEN|secrets\." .github/workflows/ci.yml` 只命中 3 处注释（第 26、68、71 行），无 `npm publish`、无 `NPM_TOKEN`、无 `setup-node` registry 配置。

结论：**本仓是"纯手动 `npm publish`"。推 main 只会跑测试，打 tag 不会触发任何东西，也没有 OIDC/trusted publishing。** 依据：`ci.yml:2-6` 的 `on:` 与全文无 publish step。

## 3. 历史发版轨迹

- 版本号由**独立的 release 提交**推进，且只动两个文件：
  ```
  git show --stat ff31d6f  →  CHANGELOG.md | 11 +, packages/shell/package.json | 2 +-
  ```
  抽查 0.16.0 / 0.16.1 / 0.17.0 / 0.17.1 / 0.17.2 / 0.17.3 六个提交，`--stat` 全部是 `CHANGELOG.md + packages/shell/package.json` 两文件。
- 提交信息规范：`chore(release): x.y.z`（`git log --grep="chore(release)" main` → 20 条）；0.9.x 及更早是 `release 0.9.x` 形式。
- 顺序：功能提交先落在 main，最后追加一条 release 提交（`git log --oneline -40 main`：`ff31d6f chore(release): 0.17.3` 紧跟 `3ca7177 fix(ui): ...`）。
- **tag 已废弃**：`git tag --sort=-v:refname | head` 只有 `v0.4.1 v0.4.2 v0.4.3`（共 3 个），全部指向 2026-11-01 的 0.4.x 提交；`git ls-remote --tags origin` 也只有这 3 个。npm 版本已经到 0.17.3，**tag 与 npm 版本严重不对应，发版不打 tag**。
- CHANGELOG 分段格式（`CHANGELOG.md:5-12`）：
  ```
  ## [0.17.3] - 2026-11-16

  ### Added

  - **Splash lists installed plugins.** ...
  ```
  小节标题用 `### Added` / `### Fixed` / `### Internal`；无 `## [Unreleased]`（`grep -n Unreleased` 无命中）。
- 发布与 release 提交解耦的证据：`CHANGELOG.md:34` 写明 "0.17.0 was never published to npm — `latest` skips it and points at 0.17.1"，即 release 提交存在 ≠ 已发布。

## 4. 发布前检查项

- 仓里**没有** RELEASE.md / 发版脚本 / 发版 checklist：`docs/` 只有 adr、testing.md、verification-gates.md 等；`grep -rn "npm publish" scripts/ docs/` 无命中；`scripts/` 只有 `build-client.mjs`、`test-tier.mjs`、`verify-pack-locales.mjs`。
- `prepack` 定义（`packages/shell/package.json:23`）：
  ```
  bun ../../scripts/build-client.mjs && bun ../../scripts/verify-pack-locales.mjs && node scripts/pack-meta.mjs
  ```
  1. `scripts/build-client.mjs` —— 打包客户端 bundle 到 `packages/shell/dist/client`（并复制 locales 到 `dist/locales`）。
  2. `scripts/verify-pack-locales.mjs:22-46` —— 校验 `dist/locales` 与 `packages/i18n/locales` 逐字节一致，必须含 `en.json`、`zh-CN.json`，不一致即 `exit 1`。
  3. `packages/shell/scripts/pack-meta.mjs:14-16` —— 从仓库根复制 `LICENSE NOTICE README.md CHANGELOG.md` 到包目录（这 4 个文件被 `.gitignore:8-11` 忽略，永不提交）。
- 没有 `prepublishOnly`、没有 `publishConfig`（`grep -n "publishConfig|prepublishOnly|prepack" packages/*/package.json package.json` 只命中 prepack 那一行）。
- `files` 白名单（`packages/shell/package.json:9-19`）：`bin`、`scripts`、`dist/client`、`dist/scripts`、`dist/locales`、`README.md`、`LICENSE`、`NOTICE`、`CHANGELOG.md`。
- 本机工具链满足要求：node `v26.8.1`、npm `11.19.0`、bun `1.4.4`、pnpm `10.33.0`（`engines` 要 node>=26.4.0 / bun>=1.3.14）。
- 注意点：`pack-meta.mjs:5` 的注释说 "prepublishOnly copies" 与实际挂在 `prepack` 不符，实际生效的是 `prepack`。

## 5. registry 与鉴权

- 仓库 `.npmrc:1`：`registry=https://registry.npmjs.org/`（只有这一个键，无 scope registry、无 auth token）。
- 用户级 `~/.npmrc` 键名（值已脱敏）：`registry=...`、`//registry.npmjs.org/:_authToken=...` —— 发布凭据来自用户级 home，不在仓库里。
- `npm whoami --registry=https://registry.npmjs.org` → **`aiwayds`**（已登录，具备该 scope 的发布身份）。

## 6. research 目录

- **`research/` 被 git 跟踪，未被忽略**：
  - `git check-ignore -v research/` → 无输出，`exit=1`（不忽略）；
  - `git ls-files research | wc -l` → `13`（`research/README.md` 等 13 个已跟踪文件）。
- 主 clone 当前未跟踪状态（`git status --porcelain`，顶层 8 项；`-uall` 展开为 **90 个文件**，任务里说的"10 个"与此不符）：
  ```
  ?? .v2c/plugin_root
  ?? .video_agent/plugin_root
  ?? research/e2e-inventory.md
  ?? research/gap-analysis-20261113/          (9 个文件)
  ?? research/splash-plugin-list.md
  ?? research/upgrade-command-20261116/       (3 个文件，本文件为第 4 个)
  ?? verify/text-leak-out/                    (28 个文件)
  ?? verify/text-leak-pack-out/               (47 个文件，含 aiwayds-dsh-opentui-0.16.0.tgz)
  ```
  这些都不影响发版（npm 只看 `files` 白名单），但会出现在 `git status` 里。

## 7. 分支现状（关键异常）

- `git log --oneline main..feat/upgrade-command` → **空**
- `git diff --stat main...feat/upgrade-command` → **空**
- `git merge-base --is-ancestor main feat/upgrade-command; echo $?` → **`0`**（main 是它的祖先）
- 两者指向同一提交：`main` = `feat/upgrade-command` = `ff31d6f chore(release): 0.17.3`；`git rev-list --left-right --count origin/main...HEAD`（wt-upgrade）→ `0 0`。
- **`feat/upgrade-command` 上没有任何提交**：upgrade 的全部改动都在 `/Users/qingguee/repo/dsh-opentui-wt-upgrade` 的 **working tree** 里：
  - 已修改 9 个：`CHANGELOG.md`、`README.md`、`e2e/README.md`、`e2e/scenarios/run-all.sh`、`packages/shell/bin/dsh-opentui.mjs`、`packages/shell/bin/lib/launcher.mjs`、`packages/shell/scripts/lib/provision-plan.mjs`、`packages/shell/scripts/provision-opentui-profile.mjs`、`packages/shell/test/provision-plan.test.ts`（`git diff --stat` = 9 files, +439/−11）
  - 未跟踪新增 11 个：退役的 upgrade 实现、planner 与 4 个专属测试、`e2e/fixtures/upgrade-registry/*`(3)、`e2e/scenarios/11-upgrade.sh`
  - 未改 `pnpm-lock.yaml`、未改任何 `package.json`。
- `git ls-remote --heads origin feat/upgrade-command` → **无输出**（分支未 push）。

结论：**"待合并分支"目前等于 main，不能直接 merge——必须先提交 working tree；且分支未推到 origin。**

## 8. 发版从哪做

- `main` 被 `/Users/qingguee/repo/dsh-opentui-wt-release` 占用（`git worktree list` 显示 `ff31d6f [main]`），主 clone 在 `feat/ask-user-redesign`。git 不允许同一分支在两个 worktree 同时 checkout，所以 **merge 到 main 必须在 `dsh-opentui-wt-release` 里做**。
- publish 也必须在 `dsh-opentui-wt-release/packages/shell` 做：`prepack` 里的相对路径 `../../scripts/*.mjs` 与 `./scripts/pack-meta.mjs` 以包目录为 cwd 才成立；根目录 `private: true` 不能发布。
- 用 **npm** 打 tarball / 发布，不用 pnpm：
  - 仓内既有的打包契约与校验全部按 npm 生命周期写（`packages/shell/package.json:23` 的 `prepack`、`e2e/scenarios/10-install.sh:53` 的 `npm pack --pack-destination`）；
  - `pnpm publish` 默认做 git 状态/远端同步检查，本 worktree 有 90 个未跟踪文件，容易被 `ERR_PNPM_GIT_UNCLEAN` 之类拦下；npm publish 无此检查。
  - `workspace:*` 只出现在 devDependencies，npm 不重写也不影响消费者安装。

---

# 按本仓惯例，发 0.18.0 的步骤清单

> 依据：release 提交只改 `CHANGELOG.md` + `packages/shell/package.json`（§3）、不打 tag（§3）、CI 不发布（§2）、手动 npm publish（§2/§4）。
> 标注：**[无副作用]** 本地只读/本地提交；**[远程]** 推到 origin；**[对外]** 发布到 npm，不可撤销。

### 阶段 A：让 feat/upgrade-command 真正有东西可合（当前 0 提交）

```bash
cd /Users/qingguee/repo/dsh-opentui-wt-upgrade
git status --porcelain -uall          # 确认 9 改 + 11 新增，且无 package.json / lockfile 变更
git add -A && git commit -m "feat(upgrade): add dsh-opentui upgrade command"
```
**[本地提交]** —— 这一步不做，后面 merge 是空的。

### 阶段 B：分支推送与合并（合并只能在 wt-release 做）

```bash
cd /Users/qingguee/repo/dsh-opentui-wt-upgrade
git push -u origin feat/upgrade-command          # [远程]

cd /Users/qingguee/repo/dsh-opentui-wt-release
git fetch origin && git status -sb                # 期望 main...origin/main 同步
git merge --ff-only feat/upgrade-command          # 提交后仍可 ff（线性历史，本仓惯例）
```

### 阶段 C：合并后本地验证（CI 会跑同样的门；先在本地过一遍）

```bash
cd /Users/qingguee/repo/dsh-opentui-wt-release
pnpm install --frozen-lockfile       # [本地，会写 node_modules；若无 lockfile 变更应成功]
for p in packages/*/; do (cd "$p" && bun test); done
bun run test:ft
cd packages/tui-base && bun run typecheck:entry && bun test -t '^verify:'
```

### 阶段 D：版本提交（只动两个文件，沿用惯例）

```bash
cd /Users/qingguee/repo/dsh-opentui-wt-release
# 1) packages/shell/package.json:3  "version": "0.17.3" -> "0.18.0"
# 2) CHANGELOG.md:8 之前插入：
#    ## [0.18.0] - 2026-11-16
#    （下面按 ### Added / ### Fixed / ### Internal 分段）
git add CHANGELOG.md packages/shell/package.json
git commit -m "chore(release): 0.18.0"
git show --stat HEAD                  # 必须只有这 2 个文件
```
**[本地提交]** —— 根 package.json 不有 version，不要改。

### 阶段 E：推 main（会触发 CI，但不会发布）

```bash
cd /Users/qingguee/repo/dsh-opentui-wt-release
git push origin main                 # [远程] 触发 .github/workflows/ci.yml（on: push main）
# 等 CI green（macOS/Ubuntu 矩阵：per-package bun test + test:ft + typecheck:entry + verify:）
```

### 阶段 F：发布（强对外副作用）

```bash
cd /Users/qingguee/repo/dsh-opentui-wt-release/packages/shell
npm pack --dry-run                   # [无副作用] 先看 files 白名单内容（会跑 prepack）
npm publish                          # [对外，不可撤销] prepack 自动 build + 校验 locales + 复制 root 元数据
```
- `prepack` 会自动跑 `build-client.mjs` + `verify-pack-locales.mjs` + `pack-meta.mjs`，任一失败 publish 中止（失败则无对外影响）。
- 不需要 `--access public`（该 scope/包已发布过）；不需要 `--tag`，默认落 `latest`（0.17.x 惯例就是 latest 顺延）。

### 阶段 G：发布后核对

```bash
npm view @aiwayds/dsh-opentui version --registry=https://registry.npmjs.org   # [只读网络]
npm view @aiwayds/dsh-opentui dist-tags.latest --registry=https://registry.npmjs.org
```

### 不做的事
- **不打 tag**（仓里 tag 停在 v0.4.3，已是废弃习惯）。
- **不需要改根 package.json**（无 version）。
- **不要用 `pnpm publish`**（git 状态检查 + 本 worktree 未跟踪文件会挡）。

---

# 风险点（必须知道）

1. **`feat/upgrade-command` 现在等于 main，0 提交**——upgrade 的全部工作都在 `wt-upgrade` 的 working tree（含 11 个 untracked 文件）。不先 commit，merge 是空操作；这也是最容易"以为合了其实没合"的地方。
2. **分支未 push**（`git ls-remote --heads origin feat/upgrade-command` 空），需要先 push，否则 wt-release 合不到（除非本地直接 `git merge feat/upgrade-command`，同一 clone 的本地分支可见）。
3. **`main` 被 wt-release 独占 checkout**，在主 clone 执行 `git checkout main` 会失败；所有 main 操作必须进 `wt-release`。
4. **推 main 会触发 CI 但不发布**：CI 只有测试门（`ci.yml:2-6`、全文无 `npm publish`/`NPM_TOKEN`）。真正的对外动作只有 `npm publish` 一条命令，其余步骤都不会污染 registry。
5. **publish 用 npm 且 cwd 必须是 `packages/shell`**：根目录 `private: true` 会拒发；`prepack` 的相对路径也只在该 cwd 成立。本机 bun 1.4.4 已满足要求。
6. **prepack 会重写 `packages/shell/{LICENSE,NOTICE,README.md,CHANGELOG.md}`**（gitignored，`.gitignore:8-11`）。当前这些本地副本是 11-15 的旧版（`packages/shell/CHANGELOG.md` mtime 11-15 11:44，不含 0.17.3），pack 时会从根覆盖，属正常；但**不要 `git add -A` 时误把它们当新文件**（已被 ignore，不会）。
7. **版本号只在 `packages/shell/package.json:3`**；改了根 package.json 或别的包版本都是错的（其余 5 包 private）。
8. **CI 的 `pnpm install --frozen-lockfile`**（`ci.yml:22`）：任何依赖/锁文件漂移都会让 main 上的 CI 红。upgrade 工作目前未改 lockfile，别在合并时顺手改依赖。
9. **发布不可撤销**（npm 24h 内可 unpublish，之后不行）；先 `npm pack --dry-run` 看清单，尤其 `files` 里 `scripts` 整个目录（含 52KB `legacy client-topology gate (retired).mjs`）会进 tarball。
10. **worktree 里的 90 个未跟踪文件**（`.v2c/`、`.video_agent/`、`verify/*` 产物）不会被 npm 或 git 提交带上（`files` 白名单 + 未 add），但会让 `git status` 很脏；不要用 `git add -A` 在 release 提交里误收。
