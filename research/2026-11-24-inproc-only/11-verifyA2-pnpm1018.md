# 11 — 真机实测 A2：pnpm 10.18.3（CI 钉版）下的 P0-3 复测

日期：2026-11-24
仓库：`/Users/qingguee/repo/dsh-opentui-wt-inproc-only`
边界：只在 `/private/tmp/verifyA2.xK3JPv` scratch 目录操作；所有 `DSH_HOME` 均指向该 scratch 下子目录，未读写 `~/.dsh`；未改仓库源码/commit（仅新增本文件）。

---

## 0. 结论先行

| 项 | 结论 |
| --- | --- |
| **pinned pnpm 是否取得** | 是。`npx -y pnpm@10.18.3 --version` → `10.18.3`；并把该版本装到 scratch prefix，实测 `pnpm --version` = `10.18.3`，provision 日志行 `Done in 721ms using pnpm v10.18.3` 证明 companion 安装确实跑在钉版上。**没有用 10.33 冒充。** |
| **P0-3 是否复现（10.18.3）** | **未复现。** 全新 HOME、缺 `pnpm-workspace.yaml`、真 dsh rc.5 下，companion 的 16 个 `@deepseek-ai/*` optional peers 一个都没被物化进 `profiles/opentui-inproc/node_modules`；`find -path '*@deepseek-ai*'` 空，`node_modules` 顶层只有 `@aiwayds`，step 5 通过，退出码 **0**、`PASS`。 |
| **与 09（pnpm 10.33）对比** | 结论一致：版本差异（10.18.3 ↔ 10.33.0）**不改变**结果。两个版本下 P0-3 都不成立。 |
| **`hoisted` 到底影响什么** | 只改变 companion 在 `node_modules` 里的**物化方式**：无契约 → `nodeLinker: isolated`，`@aiwayds/dsh-subagent-registry` 是 `.pnpm/...` 的 symlink；有契约 → `nodeLinker: hoisted`，是真实目录。两者都没有 `@deepseek-ai` 拷贝。`autoInstallPeers` 由 `true` 变 `false`，但不改变是否安装 optional peer。 |
| **D7 建议** | **从 P0 降级为「一致性/防御性」工作**，不再是开工阻塞项，也不该占用门禁优先级。理由见 §6。 |

---

## 1. 环境、制品与隔离证据

### 1.1 取得 pinned pnpm（步骤 1）

`corepack` 在本机不可用（`command -v corepack` 为空），走 npx 路径：

```
/opt/homebrew/bin/npx -y pnpm@10.18.3 --version      # -> 10.18.3
npm i -g --prefix "$W/pnpm-prefix" pnpm@10.18.3      # added 1 package in 471ms
ls -la "$W/pnpm-prefix/bin/pnpm"
  -> .../pnpm-prefix/bin/pnpm -> ../lib/node_modules/pnpm/bin/pnpm.cjs
"$W/pnpm-prefix/bin/pnpm" --version                  # -> 10.18.3
```

实际版本字符串：**`10.18.3`**（不是 10.33）。

### 1.2 scratch 与 PATH shadow（步骤 2–3）

```
W=$(mktemp -d /private/tmp/verifyA2.XXXXXX)     # -> /private/tmp/verifyA2.xK3JPv
export DSH_HOME="$W/home"; mkdir -p "$DSH_HOME"
export PATH="$W/pnpm-prefix/bin:/opt/homebrew/bin:/usr/bin:/bin"
```

断言输出（原文）：

```
pnpm resolved: /private/tmp/verifyA2.xK3JPv/pnpm-prefix/bin/pnpm
pnpm --version: 10.18.3
dsh resolved: /opt/homebrew/bin/dsh
dsh --version: 0.2.2-rc.5
node: v26.8.1
npm: 11.19.0
ASSERTIONS_OK
```

全程 `DSH_HOME` 只指向 `$W/home` / `$W/home2`；未设置任何指向 `~/.dsh` 的值，未读取 `~/.dsh` 下任何文件。dsh 用 `/opt/homebrew/bin/dsh`（真 dsh，非 stub），版本 rc.5（与 09 一致）。

### 1.3 打包与独立 prefix 安装（步骤 4）

任务字面写 `cd <repo> && npm pack`，但仓库根 `package.json` 是 `private: true` 且**无 `bin`**（实测 `name=dsh-opentui-monorepo`，`bin=undefined`），不可安装成 CLI。按 CI `.github/workflows/ci.yml` 与 09 报告的做法，从 `packages/shell` 打包（其 `bin.dsh-opentui = bin/dsh-opentui.mjs`）：

```
cd /Users/qingguee/repo/dsh-opentui-wt-inproc-only/packages/shell
npm pack --pack-destination "$W"                        # RC=0
npm i -g --prefix "$W/prefix" "$W"/*.tgz                # added 105 packages in 2s
```

- tarball：`aiwayds-dsh-opentui-0.18.3.tgz`，2,828,071 bytes，37 files，**shasum `352c6debe2094416b08dbcc691fd1ca9884e9e1d`** —— 与 09 报告的制品字节完全一致。
- bin：`$W/prefix/bin/dsh-opentui -> ../lib/node_modules/@aiwayds/dsh-opentui/bin/dsh-opentui.mjs`，`--version` → `dsh-opentui 0.18.3`。
- provisioner 校验：制品内 `scripts/provision-inproc-profile.mjs` sha256 `45afc0d1b03a01a0f7aa8d1edab2779c56dbe3005bfa8840b460154aa03daa26`，与仓库 `packages/shell/scripts/provision-inproc-profile.mjs` **逐字一致**。
- 打包前后 `git status --short` 过滤 `research/`、`tickets/` 后为空：无源码/commit 变更。

---

## 2. A1 — 全新 HOME + 缺契约（步骤 5）

### 2.1 命令与退出码

```
PATH="$W/pnpm-prefix/bin:/opt/homebrew/bin:/usr/bin:/bin" \
DSH_HOME="$W/home" \
"$W/prefix/bin/dsh-opentui" --repair-bridge > "$W/A1.log" 2>&1
```

- 运行前 profile 目录不存在（`(no profile dir yet)`）。
- **A1_EXIT = 0**，耗时 1s。

### 2.2 关键日志行（原文）

```
dsh-opentui(inproc): repair mode accepted (no-op — bridge copy converges every provision)
dsh-opentui(inproc): [1/8] host — granted exact-version exemption @aiwayds/dsh-opentui-bridge@0.1.0 for dsh 0.2.2-rc.5
dsh-opentui(inproc): [2/8] manifest — wrote bundles [@deepseek-ai/dsh-base, @aiwayds/dsh-opentui-bridge]
dsh-opentui(inproc): companion @aiwayds/dsh-subagent-registry: absent -> @aiwayds/dsh-subagent-registry@0.21.0 (latest)
Done in 721ms using pnpm v10.18.3
dsh-opentui(inproc): [4/8] companions — installed 1 of 1
dsh-opentui(inproc): [5/8] verify — bridge resolves to …/dist/bridge; no @deepseek-ai copy in profile; 1 companion(s) consistent
dsh-opentui(inproc): PASS
```

`grep -nE 'workspace|guard|WARN|FAIL'` 对 A1.log **零命中**：没有 WARN、没有 guard 失败、没有 workspace 相关行。

### 2.3 断言清单（原始结果）

| 断言 | 结果 |
| --- | --- |
| `pnpm-workspace.yaml` | **ABSENT**（契约缺失，P0-3 前半段成立） |
| `find "$P" -maxdepth 4 -path '*@deepseek-ai*'` | **空** |
| `node_modules` 顶层 | `.modules.yaml`、`.pnpm`、`.pnpm-workspace-state-v1.json`、`@aiwayds`（无 `@deepseek-ai`） |
| `node_modules/@aiwayds/` | `dsh-opentui-bridge`、`dsh-opentui-session-shim`、`dsh-subagent-registry` |
| `[ -e "$P/node_modules/@deepseek-ai" ]` | **NO**（与 step 5 的 `existsSync` guard 同一判据） |
| `pnpm-lock.yaml` settings | `autoInstallPeers: true`；`excludeLinksFromLockfile: false` |
| manifest | `dsh.profile.bundles = ["@deepseek-ai/dsh-base","@aiwayds/dsh-opentui-bridge","@aiwayds/dsh-subagent-registry"]`；`dependencies = ["@aiwayds/dsh-subagent-registry"]` |
| `node_modules/.modules.yaml` | `nodeLinker: isolated`；`packageManager: pnpm@10.18.3` |

### 2.4 为什么 optional peers 没被装（断点证据）

companion `@aiwayds/dsh-subagent-registry@0.21.0` 的 lockfile 段与 `package.json` 均确认：

- `peerDependencies` 共 **16** 个，全部以 `@deepseek-ai/` 开头；
- `peerDependenciesMeta` 对这 16 个**全部**标 `optional: true`；
- 但 `snapshots` 段只有 `@aiwayds/dsh-jev-core`，没有任何 `@deepseek-ai` 包被解析/物化。

即 P0-3 因果链「无契约 → `autoInstallPeers: true` → optional peers 被装进 profile → step 5 guard 失败」断在第三环：**pnpm 10.18.3 与 10.33.0 一样，不安装 `optional: true` 的缺失 peer**。

**A1 判定**：根因前半段（无契约 + 默认 `autoInstallPeers: true`）成立，但 guard 未失败；**P0-3 在 10.18.3 下未复现**。

---

## 3. A3 — 手写契约对照（步骤 6）

为回答「hoisted 到底影响了什么」，用**全新 HOME**（`$W/home2`）先手写 dsh 模板契约，再跑同样的 provision。这比 09 的 A3（复用 A1 的 HOME、删 `node_modules`/lock 重装）更干净：从第一步起契约就在场，排除历史残留。

### 3.1 命令与退出码

```
P2="$W/home2/profiles/opentui-inproc"
mkdir -p "$P2"
printf 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n' > "$P2/pnpm-workspace.yaml"
PATH="$W/pnpm-prefix/bin:/opt/homebrew/bin:/usr/bin:/bin" \
DSH_HOME="$W/home2" \
"$W/prefix/bin/dsh-opentui" --repair-bridge > "$W/A3.log" 2>&1
```

- **A3_EXIT = 0**，耗时 1s。关键行走 `[4/8] installed 1 of 1`、`[5/8] ... no @deepseek-ai copy in profile ...`、`PASS`；日志同样记 `Done in 293ms using pnpm v10.18.3`。

### 3.2 断言清单（原始结果）

| 断言 | 结果 |
| --- | --- |
| 契约是否原样保留 | **IDENTICAL**（三行模板字节未被改写） |
| `find "$P2" -maxdepth 4 -path '*@deepseek-ai*'` | **空** |
| `node_modules` 顶层 | 与 A1 完全相同：`.modules.yaml`、`.pnpm`、`.pnpm-workspace-state-v1.json`、`@aiwayds` |
| `pnpm-lock.yaml` settings | `autoInstallPeers: false`（契约被采纳）；无 `nodeLinker` 键 |
| `node_modules/.modules.yaml` | `nodeLinker: hoisted`；`packageManager: pnpm@10.18.3` |

**A3 判定**：契约被正确采纳，但结果与 A1 在「是否装 @deepseek-ai」「step 5 是否通过」上完全一致。

---

## 4. hoisted 到底改变了什么（A1 ↔ A3 逐项对照）

| 维度 | A1（无契约） | A3（手写契约） | 差异来源 |
| --- | --- | --- | --- |
| 退出码 / step 5 | 0 / PASS | 0 / PASS | 无差异 |
| `find @deepseek-ai` | 空 | 空 | 无差异 |
| `node_modules` 顶层条目数 | 3 dir + 2 file（含 `@aiwayds`） | 同左 | 无差异 |
| `pnpm-lock.yaml` | `autoInstallPeers: true` | `autoInstallPeers: false` | 唯一一行差异：`4c4` |
| lockfile 是否含 `nodeLinker` | **否** | **否** | pnpm 9 lockfile 不记录 linker |
| `.modules.yaml` `nodeLinker` | `isolated` | `hoisted` | 契约的 `nodeLinker` 键落在这里 |
| `@aiwayds/dsh-subagent-registry` 形态 | `lrwxr-xr-x` symlink → `.pnpm/@aiwayds+dsh-subagent-registry@0.21.0/...` | `drwxr-xr-x` 真实目录（hoistedLocations 记录） | `nodeLinker` 的实质作用 |
| `.modules.yaml` 其他键 | `hoistedDependencies`（jev-core 标 private） | `hoistedLocations`（jev-core + subagent-registry 列真实路径） | 同上 |

**口径修正（供 07/11 后续引用）**：任务描述「lockfile 里 `autoInstallPeers` 与 `nodeLinker` 的取值」中，`nodeLinker` **不在 `pnpm-lock.yaml`**——实测 lockfile 只有 `autoInstallPeers` / `excludeLinksFromLockfile` 两个 settings 键；`nodeLinker` 记录在 `node_modules/.modules.yaml`。以后断言 linker 必须读 `.modules.yaml`，不能读 lockfile。

**结论**：`hoisted` 的实质效果是把 companion 从「virtual store 的 symlink」变成「真实 hoisted 目录」，这正是 dsh `initProfile` 想要的「插件共享安装层唯一 cordis 实例」布局。它**不**控制 optional peers 是否被安装；控制后者的是 `autoInstallPeers`，而在本机两个 pnpm 版本下该开关对 `optional: true` 的缺失 peer 都不生效。

---

## 5. 与 09 报告、设计 07 的差异

### 5.1 与 09（pnpm 10.33.0）

- 结论、退出码、日志模式、文件布局全部一致；唯一可观察差异是日志里的 pnpm 版本字符串（10.33.0 ↔ 10.18.3）与 companion 安装耗时（318ms ↔ 721ms）。
- 09 的 A3 在 A1 的 HOME 上删 `node_modules`/lock 重装；本报告 A3 用独立全新 HOME 预写契约。两者都 PASS，本报告额外排除了「残留状态导致不复现」的可能。
- 09 §7.3 列的「pnpm 版本差异未实测」未知项，本次已关闭：**10.18.3 与 10.33.0 都不复现**。

### 5.2 与设计 07

| 设计 07 条目 | 本次实测 | 判定 |
| --- | --- | --- |
| §1.1 行 58「`autoInstallPeers` 会忽略 `peerDependenciesMeta.optional`，把宿主依赖树整体折进图」 | 10.18.3 与 10.33 都不安装 optional peers；`build-bridge.mjs:19-25` 的 239→957 膨胀是 workspace 包自身声明 peer 的场景 | **前提在两个版本上都错误**，不能作为 P0 依据 |
| §1.1「pnpm≥10 只从 `pnpm-workspace.yaml` 读这两个设置」 | A3 写入后 `autoInstallPeers: false` 被采纳、`.modules.yaml` `nodeLinker: hoisted` 被采纳 | **确认** |
| §0.1 根因：provisioner 先写 manifest → workspace 契约永不生成 | A1 契约 ABSENT | **确认**前半段 |
| §0.4/§0.5 顺序与修复流程 | A1/A3 日志都是 8 步、无 `[3/9] workspace`；契约写入后幂等 | 设计未落地；修复流程本身可跑通 |
| §0.3/§0.6 三键判定与门禁 | HEAD 无此实现，本次未测 | 未测（设计未落地） |
| §1.1 `nodeLinker` 落点 | 实测在 `.modules.yaml`，不在 lockfile | **需修正引用**（见 §4） |

---

## 6. 降级建议：D7 是否还值得做

**明确结论：P0-3 在当前两个 pnpm 版本（10.18.3 CI 钉版、10.33.0 本机）上都不成立。**

因果链三环里，第一环（无契约）与第二环（默认 `autoInstallPeers: true`）都成立，但第三环（optional peers 被物化进 profile）在两个版本上都被 pnpm 自己挡住了。因此「缺契约 → step 5 硬 fail」这条现实现象不存在，D7 作为**开工阻塞的 P0 修复**失去事实基础。

**我认可的降级理由（D7 从 P0 → 一致性/防御性，值得做但不阻塞）：**

1. **与 dsh 自身 `initProfile` 对齐**：dsh 给普通 profile 写的模板就是三键契约；inproc profile 缺它是事实上的不一致。补上后布局从 `isolated` symlink 变成 `hoisted` 真实目录（§4），符合「所有插件共享安装层唯一 cordis 实例」的设计意图——这是**独立于 P0-3 的、仍成立的正确性理由**。
2. **消除对 pnpm 默认值的依赖**：09 §6 已指出该默认值语义可能被版本改变。当前两个版本碰巧正确处理 optional peers，但 companion 升级后若新增**非 optional** 的 `@deepseek-ai` peer，或 pnpm 11 改变行为，第三环可能被接上。写死契约把行为从「依赖默认值」变成「显式确定」。
3. **门禁确定性**：契约在场时 `autoInstallPeers` 固定为 `false`，step 5 guard 与 CI `find` 门禁获得可复现输入，不再随 pnpm 版本漂移。

**降级后的取舍**：不再占用门禁优先级、不再作为其他票的前置依赖；可在 06 的 `yaml` 依赖落地后，按 07 终稿实现，作为一致性收尾。原票面 §要求 2 的 `fresh-home-provision` 门禁若只为堵 P0-3，可降为「契约/无拷贝/companion 三视图」的常规覆盖，不必设为阻塞 gate。

**什么情况下应重新升级为 P0**（触发条件，非本次实测）：
- companion catalog 中出现**非 optional** 的 `@deepseek-ai` peer（本次 16 个全是 optional）；
- pnpm 11 手工复测出现 optional peers 被物化（设计 07 §5 仍列此待办，本次未覆盖）；
- `DSH_OPENTUI_COMPANIONS=all` 下其他 companion 带非 optional peer（09 §7.4 未测，本次同样未测）。

---

## 7. 未知项（本次未覆盖）

1. **pnpm 11**：按 07 §5 仍需手工跑一次；本次只覆盖 10.18.3 与 10.33.0。
2. **dsh 版本**：用 rc.5（本机全局），CI 设计稿写 rc.3；未测 rc.3 是否改变 companion 解析。
3. **非默认 companion**：只跑默认 `defaultOn` 的 `@aiwayds/dsh-subagent-registry`，未跑 `DSH_OPENTUI_COMPANIONS=all`。
4. **全局 dsh 配置/缓存**：按任务要求用 `/opt/homebrew/bin/dsh`（09 用 scratch 独立 prefix）；profile 写入只受 `DSH_HOME` 影响，但本次未做「独立 prefix dsh」的交叉对照。

---

## 8. 清理（步骤 7）

scratch 无用户数据，删除 `W`（含 `home`、`home2`、`pnpm-prefix`、`prefix`、tarball、A1/A3 日志与全部 profile）及状态指针：

```
rm -rf "$W" /private/tmp/verifyA2.current.W
```

仓库只新增本文件；`npm pack` 的 `dist/` 等产物均为 gitignored 构建产物，未改源码、未 commit。未触碰 `~/.dsh`。
