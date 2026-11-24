# 09 — 真机实测 A：全新 DSH_HOME 的 inproc provision（P0-3 验证）

日期：2026-11-24
仓库：`/Users/qingguee/repo/dsh-opentui-wt-inproc-only`，HEAD `153c8cedfa25be5242fc9cd9f04a275ec5dbc7d5`
边界：只在 `/private/tmp` 的 scratch 目录操作；未读写 `~/.dsh`；未改仓库源码/commit；A1–A3 全部用独立打包制品 + 独立 prefix 的 dsh，见 §1。

---

## 0. 结论先行

| 项 | 结论 |
| --- | --- |
| **P0-3 是否复现** | **未复现。** A1 全新 scratch home 上 `pnpm-workspace.yaml` 确实缺失（根因前半段成立），lockfile 也确实记录 `autoInstallPeers: true`；但 companion 的 16 个 `@deepseek-ai/*` optional peers 一个都没被装进 profile，`node_modules` 只有 `@aiwayds`，step 5 guard 通过，A1 退出码 **0**、输出 `PASS`。 |
| **A3 修复是否有效** | A3（手写契约 + 删 `node_modules`/`pnpm-lock.yaml` 重装）退出码 **0**、step 5 通过、lockfile 变为 `autoInstallPeers: false`、`find @deepseek-ai` 为空；契约被 pnpm 正确采纳。但由于 A1 本就没有失败，**A3 只能证明修复流程本身可跑通，不能证明它修复了 P0-3 的失败**。 |
| **因果链断点** | P0-3 的因果链是「无契约 → `autoInstallPeers: true` → optional peers 被装进 profile → step 5 硬 guard 失败」。本机实测断在第三环：pnpm 10.33 的 `autoInstallPeers` 对 `peerDependenciesMeta.optional: true` 的缺失 peer **不安装**（见 §6）。这与设计 07 §1.1 行 58 的前提相反。 |

---

## 1. 环境、制品与隔离证据

### 1.1 scratch 与 home

```
W=$(mktemp -d /private/tmp/verifyA.XXXXXX)     # -> /private/tmp/verifyA.TP5R50
export DSH_HOME="$W/home"; mkdir -p "$DSH_HOME"
W2=$(mktemp -d /private/tmp/verifyA2.XXXXXX)   # -> /private/tmp/verifyA2.0Ht0Lg
```

全程未设置任何指向 `~/.dsh` 的 `DSH_HOME`；未读取 `~/.dsh` 下任何文件。

### 1.2 打包（制品来源）

按 CI `.github/workflows/ci.yml:211-220` 的做法，从 `packages/shell` 打包（根包是 private monorepo，无 bin）：

```
cd /Users/qingguee/repo/dsh-opentui-wt-inproc-only
pnpm install --frozen-lockfile          # 仅安装 gitignored 的 node_modules，供 prepack 使用；RC=0
cd packages/shell
npm pack --pack-destination "$W"        # prepack 真实执行；RC=0
```

证据：
- tarball 文件名：`aiwayds-dsh-opentui-0.18.3.tgz`（2,828,071 bytes）
- npm 报告：`name: @aiwayds/dsh-opentui`、`version: 0.18.3`、`shasum: 352c6debe2094416b08dbcc691fd1ca9884e9e1d`、`total files: 37`
- 含 `package/dist/bridge/index.js`、`package.json`、`cordis.patch.yml`、`bundle-fingerprint.json`
- 未发现 tarball 内含 `node_modules/@deepseek-ai/`

### 1.3 独立 prefix 安装

```
npm i -g --prefix "$W/prefix" "$W"/*.tgz      # RC=0，"added 105 packages in 2s"
```

未需要 `--legacy-peer-deps`（首次安装即成功；未回退源码目录）。

- bin 实际路径：`/private/tmp/verifyA.TP5R50/prefix/bin/dsh-opentui`
  → symlink `../lib/node_modules/@aiwayds/dsh-opentui/bin/dsh-opentui.mjs`
- `"$W/prefix/bin/dsh-opentui" --version` → `dsh-opentui 0.18.3`
- 安装日志版本：`added 105 packages in 2s`；`npm ls -g --prefix` → `@aiwayds/dsh-opentui@0.18.3`
- 制品内 provisioner：`$W/prefix/lib/node_modules/@aiwayds/dsh-opentui/scripts/provision-inproc-profile.mjs`
  sha256 `45afc0d1b03a01a0f7aa8d1edab2779c56dbe3005bfa8840b460154aa03daa26`，与仓库 `packages/shell/scripts/provision-inproc-profile.mjs` **完全一致**（因此源码脚本直跑是等价对照，未额外跑，避免混淆制品口径）。

### 1.4 独立 host dsh（A1 用）

```
npm i -g --prefix "$W/host-prefix" @deepseek-ai/dsh@0.2.2-rc.5   # RC=0，added 674 packages
"$W/host-prefix/bin/dsh" --version                             # 0.2.2-rc.5
```

选 rc.5 是为了与本机全局 dsh 的版本一致，但**装在 scratch 的独立 prefix**，未使用 `/opt/homebrew/bin/dsh`，也未使用任何全局安装的 dsh-opentui。`PATH` 里 `/opt/homebrew/bin` 仅用于提供 `node`/`npm`/`pnpm`/`which`，`dsh` 由 `$W/host-prefix/bin` 优先解析。

注释：安装日志给出 npm 11 的 `install-scripts` 警告（5 个包未允许运行安装脚本）；这些包不参与 `dsh plugin add` 路径，实测 companion 安装成功。

---

## 2. A1 — dsh 在 PATH，全新 home

### 2.1 命令与退出码

```
PATH="$W/host-prefix/bin:/opt/homebrew/bin:/usr/bin:/bin" \
DSH_HOME="$W/home" \
"$W/prefix/bin/dsh-opentui" --repair-bridge > "$W/A1.log" 2>&1
```

- `command -v dsh` → `/private/tmp/verifyA.TP5R50/host-prefix/bin/dsh`（真实路径，非 stub）
- 运行前 profile 目录不存在：`(no profile dir yet)`
- **A1_EXIT = 0**

### 2.2 关键日志行（原文）

```
dsh-opentui(inproc): repair mode accepted (no-op — bridge copy converges every provision)
dsh-opentui(inproc): [1/8] host — granted exact-version exemption @aiwayds/dsh-opentui-bridge@0.1.0 for dsh 0.2.2-rc.5
dsh-opentui(inproc): [2/8] manifest — wrote bundles [@deepseek-ai/dsh-base, @aiwayds/dsh-opentui-bridge]
dsh-opentui(inproc): companion @aiwayds/dsh-subagent-registry: absent -> @aiwayds/dsh-subagent-registry@0.21.0 (latest)
Progress: resolved 2, reused 2, downloaded 0, added 2, done
dependencies:
+ @aiwayds/dsh-subagent-registry 0.21.0
Done in 318ms using pnpm v10.33.0
dsh-opentui(inproc): [4/8] companions — installed 1 of 1
dsh-opentui(inproc): [5/8] verify — bridge resolves to …/dist/bridge; no @deepseek-ai copy in profile; 1 companion(s) consistent
dsh-opentui(inproc): PASS
```

`A1.log` 中 `grep -nE 'workspace|step 5|guard|WARN|@deepseek-ai|companion|pnpm'` 只命中：step 2 的 bundle 行、companion 解析行、pnpm 进度/依赖行、step 5 与 companion 汇总行。**没有 WARN，没有 guard 失败，没有 workspace 相关行。**

### 2.3 证据清单

1. `ls -la "$W/home/profiles/opentui-inproc/"`

```
.plugin-manager/  compatibility.json  cordis.patch.yml  node_modules/
package.json  pnpm-lock.yaml
```

2. `pnpm-workspace.yaml`：**ABSENT**（契约缺失，与 P0-3 前半段一致）

3. `find "$P" -maxdepth 4 -path '*@deepseek-ai*'`：**空**

4. manifest（`node -e`，只打印键，不含任何密钥值）

```
dsh.profile.bundles = ["@deepseek-ai/dsh-base","@aiwayds/dsh-opentui-bridge","@aiwayds/dsh-subagent-registry"]
dependencies keys   = ["@aiwayds/dsh-subagent-registry"]
```

5. `ls "$P/node_modules" | head -20` → 仅 `@aiwayds`

6. `pnpm-lock.yaml` 头部：

```
settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false
```

**A1 判定**：根因前半段（无契约）成立，但 guard 未失败；P0-3 未复现。

---

## 3. A2 — dsh 不在 PATH

### 3.1 前置确认

```
PATH="/usr/bin:/bin" sh -c 'command -v dsh'   # -> (no dsh)
/opt/homebrew/bin/node --version              # v26.8.1（bin 用绝对路径 node 启动）
```

（bin 的 shebang 是 `#!/usr/bin/env node`，PATH 里没有 node，因此用 node 绝对路径启动；provisioner 由 `process.execPath` 派生，仍为该绝对路径。）

### 3.2 A2 首次运行（未设 host 版本覆盖）

```
PATH="/usr/bin:/bin" DSH_HOME="$W2/home" /opt/homebrew/bin/node "$BIN" --repair-bridge
```

- **A2_EXIT = 1**
- 失败在 step [1/8] 之前，未到达 companion 分支：

```
dsh-opentui(inproc): FAIL — cannot verify the dsh host version before loading the bridge
could not determine the running dsh host version via `dsh --version` (or DSH_OPENTUI_HOST_VERSION); refusing to provision because a version mismatch would skip the bridge without a usable error
```

这与 CI `.github/workflows/ci.yml:224-229` 的注释一致：dsh 不在 PATH 时必须用 `DSH_OPENTUI_HOST_VERSION` 钉版本，否则 provisioner 在 host 门禁就退出。

### 3.3 A2b（钉版本后重跑，到达 companion 分支）

```
PATH="/usr/bin:/bin" DSH_HOME="$W2/home" DSH_OPENTUI_HOST_VERSION=0.2.2-rc.5 \
  /opt/homebrew/bin/node "$BIN" --repair-bridge > "$W2/A2b.log" 2>&1
```

- **A2b_EXIT = 0**
- 关键行：

```
dsh-opentui(inproc): [1/8] host — granted exact-version exemption … for dsh 0.2.2-rc.5
dsh-opentui(inproc): companion @aiwayds/dsh-subagent-registry: absent -> @aiwayds/dsh-subagent-registry@latest (unresolved)
dsh-opentui(inproc): WARN no global `dsh` on PATH; skipping optional companions. Install dsh and re-run provisioning to auto-install them, or set DSH_OPENTUI_COMPANION_LATEST=off to skip them permanently.
dsh-opentui(inproc): [4/8] companions — skipped (no global `dsh` on PATH; companions are optional)
dsh-opentui(inproc): [5/8] verify — …; no @deepseek-ai copy in profile; 0 companion(s) consistent
dsh-opentui(inproc): PASS
```

**A2 判定**：无 dsh 时 companion 确实被跳过（WARN 文案如上），进程退出 0、profile 仍 bootable；与设计 07 §3.2「dsh 不在 PATH 时重装 companion 不生效」一致。A2 前提（PATH 无 dsh）成立。

---

## 4. A3 — 复现修复路径（在 A1 的 scratch home）

### 4.1 命令与退出码

```
P="$W/home/profiles/opentui-inproc"
printf 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n' > "$P/pnpm-workspace.yaml"
rm -rf "$P/node_modules" "$P/pnpm-lock.yaml"       # 仅 scratch 目录
PATH="$W/host-prefix/bin:/opt/homebrew/bin:/usr/bin:/bin" \
DSH_HOME="$W/home" "$W/prefix/bin/dsh-opentui" --repair-bridge > "$W/A3.log" 2>&1
```

写入的契约与独立安装 dsh 的模板逐字一致（`dsh-app-boot/src/profile.ts:184-189` / `lib/index.js:1378-1383`）：

```
packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
```

- **A3_EXIT = 0**
- 关键行：

```
[2/8] manifest — already correct, skipping
[3/8] bridge-copy — copied … -> …/node_modules/@aiwayds/dsh-opentui-bridge
companion @aiwayds/dsh-subagent-registry: absent -> @aiwayds/dsh-subagent-registry@0.21.0 (latest)
[4/8] companions — installed 1 of 1
[5/8] verify — …; no @deepseek-ai copy in profile; 1 companion(s) consistent
PASS
```

### 4.2 证据

- 重跑后 `pnpm-workspace.yaml` 未被改写（三行契约原样保留）。
- 重跑后 `pnpm-lock.yaml` 头部：`settings: autoInstallPeers: false`（契约被 pnpm 采纳）。
- `find "$P" -maxdepth 4 -path '*@deepseek-ai*'`：空。
- `ls "$P/node_modules"`：仅 `@aiwayds`。

**A3 判定**：修复流程（写契约 + 删 `node_modules`/`pnpm-lock.yaml` + 重装）本身可跑通、幂等、guard 通过。但 A1 没有先失败，所以**不能据此声称 A3 修复了一个真实现象**。

---

## 5. 与设计 07 的对应关系

| 设计 07 条目 | 本次实测对应 | 结果 |
| --- | --- | --- |
| §0.1 根因：`dsh plugin add` 只在 `package.json` 不存在时 `initProfile` | 独立 dsh rc.5 的 `lib/plugin-DC80YBt4.js:42` 确为 `else if (!existsSync(join(dir, "package.json"))) initProfile(...)`；A1 日志 step 2 先写 manifest，最终 `pnpm-workspace.yaml` ABSENT | **确认**前半段 |
| §0.2 契约字节 = dsh 模板 | A3 用逐字模板写入，pnpm 读成 `autoInstallPeers: false` | **确认**模板可用 |
| §0.3 三键判定 / fail-fast | HEAD 153c8ce 的 provisioner 仍是 8 步、无 workspace 步骤；本次未实现对三键判定做验证 | 未测（设计未落地） |
| §0.4 顺序：manifest → bridge → companion → guard | A1/A3 日志顺序完全符合；新增 step `[3/9] workspace` 在 HEAD 中不存在 | 现有顺序确认 |
| §0.5 修复 = 删 `node_modules` + `pnpm-lock.yaml` 重装 | A3 按此执行并 PASS，`existsSync` guard 与 `find` 均干净 | 流程可跑通；**修复有效性未被失败案例证明** |
| §4.1 门禁「无拷贝」`find ... -path '*@deepseek-ai*'` | A1、A3 均空 | 满足 |
| §4.3 必须跑真 provisioner 到 scratch HOME，禁止从 `~/.dsh` 拷贝 | A1–A3 全用打包制品 + 独立 prefix + scratch `DSH_HOME` | 满足 |

---

## 6. 为什么 P0-3 未复现（诊断，含源码依据）

1. companion `@aiwayds/dsh-subagent-registry@0.21.0` 确实声明 16 个 `@deepseek-ai/*` peerDependencies，且**全部**在 `peerDependenciesMeta` 中标 `optional: true`（证据：profile 内该包的 `package.json` 与 `pnpm-lock.yaml` 的 `peerDependenciesMeta` 段）。
2. A1 的 `pnpm-lock.yaml` `settings.autoInstallPeers: true`，确认「无契约 → 默认 true」成立。
3. 本机 pnpm **10.33.0** 默认 `auto-install-peers: true`（`/opt/homebrew/lib/node_modules/pnpm/dist/pnpm.cjs:18666`）。
4. 但同文件 `:156266-156274` 把缺失 peer 分成 `missingOptionalPeers` 与 `missingRequiredPeers`；`:157216` 依据 `peerDependenciesMeta[peer].optional === true` 打 optional 标记；optional 分支不进入安装队列。因此这 16 个 peer 只出现在 lockfile 的 peer 元数据里，没有物化到 profile `node_modules`。
5. 结论：设计 07 §1.1 行 58 的「pnpm 的 `autoInstallPeers` 会忽略 `peerDependenciesMeta.optional`，把宿主依赖树整体折进图」对**已安装 registry 依赖的 optional peers** 在本机 pnpm 10.33 上不成立。`build-bridge.mjs:19-25` 记录的 239→957 膨胀发生在 workspace 包自身声明 peer 的场景，两者不可直接外推。

---

## 7. 未知项

1. **未覆盖全局 dsh 环境**：按追加要求，A1 用 scratch 独立 prefix 的 dsh@0.2.2-rc.5，未用 `/opt/homebrew/bin/dsh`，未读写 `~/.dsh`。无法排除全局 dsh 的宿主配置/缓存带来不同结果（本报告的 dsh 版本与全局一致，且 `dsh plugin add` 的 profile 写入只受 `DSH_HOME` 影响，此为推测）。
2. **dsh 版本**：CI 钉 `0.2.2-rc.3`，本机全局为 `0.2.2-rc.5`，本次用 rc.5。未验证 rc.3 是否改变 companion 解析结果。
3. **pnpm 版本**：本机 10.33.0；CI 钉 10.18.3，设计 07 §5 提到还要在 pnpm 11 手工验证。不同 pnpm 小版本对 optional peer 的处理未实测。
4. **非默认 companion**：只跑了 `defaultOn` 的 `@aiwayds/dsh-subagent-registry`；`DSH_OPENTUI_COMPANIONS=all` 下其他 companion 是否带非 optional 的 `@deepseek-ai` peer 未测。
5. **修复仍值得做**：即便 P0-3 未复现，「契约缺失」在 A1 已确认，补写 `pnpm-workspace.yaml` 能消除对 pnpm 默认值的依赖（§6 显示该默认值语义可能被版本改变），并让 guard 与 CI 门禁获得确定性；这是防御性理由，不是本次实测到的失败修复证据。

---

## 8. 清理

scratch 未含用户数据，最后按追加要求删除 `W` 与 `W2`（含各自 `prefix`、`host-prefix`、tarball、日志与 profile）：

```
rm -rf "$W" "$W2"
```

仓库只新增本文件；`pnpm install` 与 `npm pack` 的 `node_modules/`、`dist/`、`pack-meta` 复制的 `LICENSE`/`NOTICE`/`README.md`/`CHANGELOG.md` 均为 gitignored 构建产物，不构成源码/commit 变更。未触碰 `~/.dsh`。
