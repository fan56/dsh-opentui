# 07 — inproc-only workspace 契约设计（P0-3）

## 修订记录（2026-11-24，依 oldfox 二轮）

本轮只改设计，不改源码。下表逐条列出二轮意见的处理位置；`prov` = `packages/shell/scripts/provision-inproc-profile.mjs`。

| 评审项 | 处理位置 | 修订要点 |
|---|---|---|
| **P0-9** | §0.3、§0.4、§1.3、§2（状态机 + 补充约束）、§5、§6 | 冲突/不可解析从「WARN 放行」改为 **companion 安装前 fail-fast**；失败文案点名 workspace 冲突并给两条可执行指引（手改文件 / `--repair-bridge` 备份后整体重写）。证据 `tickets/2026-11-24-inproc-only-review-oldfox-2.md:19`。 |
| **P0-10** | §0.5、§3.1–3.3、§5、§6、§7 | 修复判据与 guard 判据统一为「**删 `node_modules` + `pnpm-lock.yaml`，按契约重装**」；取消 quarantine 与 symlink 豁免。解释为何消除三个失败面（symlink 仍触发 `existsSync` guard、quarantine 命中 CI `find`、旧 lock 重新物化）。证据 `tickets/2026-11-24-inproc-only-review-oldfox-2.md:20`。 |
| **P0-11** | §0.8、§1.3 步骤 2、§5、§6 | 显式声明本设计依赖 06 的 yaml 决议；修正「仓库已有 yaml」错误事实（仓库现无依赖）。证据 `tickets/2026-11-24-inproc-only-review-oldfox-2.md:18,21`；`research/2026-11-24-inproc-only/06-patch-ownership-design.md:27,48,107`。 |
| **P0-12** | §0.3、§1.3、§2、§4.1、§4.2、§6 | 整体去掉语义合并：缺失即写模板、存在且三键相等即通过、其余 fail-fast；PATH 前置按**命令作用域**只给第二个 pass，第一个 pass 加 `! command -v dsh` 前置断言冻结唯一覆盖。证据 `tickets/2026-11-24-inproc-only-review-oldfox-2.md:22`。 |
| **P1：companion 漂移** | §4.2「CI 钉版」、§6、§7 | 给出具体做法：checked-in `companion-pins.json` + opt-in env 把 `latest` 换成精确 pin；新增接口部分标「推测」。证据 `tickets/2026-11-24-inproc-only-review-oldfox-2.md:34`；`packages/shell/scripts/lib/inproc-companions.mjs:31-33,199-213`。 |
| **P1：mode 引用** | §1.3 步骤 1 | 把 `build-approval.ts:69` 的「mode 0o600 与 dsh 对齐」引用改为 dsh 首次写 `profile.ts:216` 的默认 mode；`build-approval.ts:69` 仅为后续整份重写路径。证据 `tickets/2026-11-24-inproc-only-review-oldfox-2.md:34`。 |
| **附带：D5 fixture** | §0.7、§4.3、§6 | 保留与 D5 共用 scratch-HOME helper 的结论，并写明 D5 票面 `:36` 的「静态 fixture」已被 `:41` 评审修正推翻，实施必须「跑真 provisioner 到 scratch HOME」。证据 `tickets/2026-11-24-inproc-D5-gates-and-legacy-dir.md:36,41,44`。 |
| **附带：profile 名** | §0.9、§4.3、§6 | 门禁命令中的 profile 名一律从常量/参数取，不硬编码；改名 `opentui-monday` 在最后一个提交落地。证据 `tickets/2026-11-24-inproc-only-review-oldfox.md:15`；`tickets/2026-11-24-inproc-only-map.md:53`；`tickets/2026-11-24-inproc-only-review-oldfox-2.md:19`。 |

调研日期 2026-11-24；仓库 `/Users/qingguee/repo/dsh-opentui-wt-inproc-only` HEAD `153c8ce`。
全程只读 + 只写本报告；未改源码、未写真 profile、未跑 provisioner 或任何安装命令。
证据记号：仓库内 `path:line`；宿主安装为 `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`，下文缩写为 `<dsh>/`，例如 `<dsh>/dsh-app-boot/src/profile.ts:184-189`；本机 profile 快照写作 `~/.dsh/profiles/...`。推断一律标「推测」。

---

## 0. 结论先行

| # | 结论 | 证据 |
|---|---|---|
| 0.1 | **根因确认（比票面更精确）**：不是「没人建目录」，而是 **`dsh plugin add` 只在 `package.json` 不存在时才调用 `initProfile()`**；inproc provisioner 在 step 2 先写了 `package.json`，所以 step 4 装 companion 时 dsh 的建 profile 分支被整体跳过，`pnpm-workspace.yaml` 永远不会被写。 | `<dsh>/dsh-plugin-manager/src/operations.ts:597-608`（`:603` 判 `package.json` 不存在 → `:605 initProfile`）；`prov:1404-1428`（step 2 写 manifest）→ `:1462`（step 4 才 `dsh plugin add`）；宿主启动路径同样只在 `package.json` 缺失时 `initProfile`（`<dsh>/dsh-app-boot/src/profile.ts:204-216`） |
| 0.2 | **契约由 provisioner 自己写，不能委托 dsh**：新增一个纯本地 FS 步骤，在 step 4 之前写 `packages: [.]` + `nodeLinker: hoisted` + `autoInstallPeers: false`，字节内容与 dsh 的 `PROFILE_PNPM_WORKSPACE` 模板一致。 | `<dsh>/dsh-app-boot/src/profile.ts:180-189`（模板原文）、`:198-217`（`initProfile` 三件套 + 只写缺失文件）；`prov:960-976` 起 step 4、`scripts/build-bridge.mjs:19-25`（optional peer 被 pnpm 折叠的成因） |
| 0.3 | **三键语义相等即通过，其余 fail-fast（P0-12 去掉语义合并）**：`allowBuilds` 会被 dsh 用 `parseDocument → setIn → String(document)` 整份重写，字节不稳定，判等必须按 YAML 三键取值而非字节（`<dsh>/dsh-plugin-manager/src/build-approval.ts:28-50,69,95`）；但改名后 profile 目录全新、dsh 的两个写手只产出完整模板或 round-trip，不存在「部分」态（`tickets/2026-11-24-inproc-only-review-oldfox-2.md:22`），所以不做补缺/合并：**缺失即写模板；存在且三键相等即通过；其余一律在 companion 安装前 fail-fast**（`tickets/2026-11-24-inproc-only-review-oldfox-2.md:19,22`）。 | `<dsh>/dsh-plugin-manager/src/build-approval.ts:28-50,69,95`；`tickets/2026-11-24-inproc-only-review-oldfox-2.md:19,22`；本机 `~/.dsh/profiles/opentui/pnpm-workspace.yaml` 有 11 项 `true` + 1 项 `false` 的 `allowBuilds`，`~/.dsh/profiles/opentui-inproc/pnpm-workspace.yaml` 只有三字段 |
| 0.4 | **顺序**：DSH_HOME 必须预存（provisioner 不创建，`:1507-1512`）→ 建 profileDir（`:1518`）→ step 2 写 manifest（`:1404-1428`）→ **新增 step `[3/9] workspace`：fail-fast 或写模板** → 复制 bridge（原 step 3，`:1430-1458`）→ step 4 `dsh plugin add`（`:1460-1462`）→ step 5 硬 guard（`:1464-1488`）。契约步骤对 dsh 不在 PATH 的路径无依赖（`:950-957`），离线也能完成；fail-fast 保证坏契约不进入分钟级安装。 | `prov:1507-1512,1518,1404-1428,1430-1458,1460-1462,1464-1488,950-957`；`tickets/2026-11-24-inproc-only-review-oldfox-2.md:19` |
| 0.5 | **修复 = 删 `node_modules` + `pnpm-lock.yaml`，按契约重装（P0-10）**：guard 判据是 `existsSync(<profile>/node_modules/@deepseek-ai)`（`prov:1479-1480`），对 symlink 也为真；旧方案 symlink 豁免 + profile 内 quarantine 既留 symlink 触发 guard，又命中 CI `find -path '*@deepseek-ai*'`（`.github/workflows/ci.yml:315-317`）。整目录删 + 删 lock 后 `existsSync` 必然 false、不留 `@deepseek-ai` 路径；重装由现有 step 4 承担（`:1034-1039`），复用 `--repair-bridge` opt-in 入口（`:87-90`；`.github/workflows/ci.yml:294`）。 | `prov:1479-1480,1034-1039,87-90`；`.github/workflows/ci.yml:315-317,294`；`tickets/2026-11-24-inproc-only-review-oldfox-2.md:20` |
| 0.6 | **门禁可进默认 CI，但分两个 pass**：现有冷启动 pass 不前置 PATH，加 `! command -v dsh` 前置断言冻结「dsh 不在 PATH」这条唯一覆盖；新增 `fresh-home-provision` pass 只在**该 pass 的命令**前置 `$HOST_PREFIX/bin`（不写 step 级 env），跑真 provisioner 再做契约/无拷贝/companion 三视图 + 二次幂等断言。runner 前置：npm registry 可达、pnpm≥10 在 PATH、node 26、约 300s companion 查询预算。 | `.github/workflows/ci.yml:225-229,162-169,286-317`；`tickets/2026-11-24-inproc-D5-gates-and-legacy-dir.md:41`、`tickets/2026-11-24-inproc-D7-workspace-contract.md:21-23`；`tickets/2026-11-24-inproc-only-review-oldfox-2.md:22` |
| 0.7 | **与 D5 统一为同一个 scratch-HOME helper**：D5 票面 `:36` 的「脚本自带静态 fixture」已被 `:41` 的评审修正推翻；`fresh-home-provision` 与 D5 的真机脚本必须共用「空 DSH_HOME + 跑真 provisioner」的 fixture 构造函数，禁止从 `~/.dsh` 拷贝。 | `tickets/2026-11-24-inproc-D5-gates-and-legacy-dir.md:36,41,44`；`tickets/2026-11-24-inproc-D7-workspace-contract.md:23`；`research/2026-11-24-inproc-only/03-references-and-gates.md:144-159` |
| 0.8 | **显式依赖 06 的 yaml 决议（P0-11）**：三键相等判定需要 YAML AST；`yaml` 是 06 的 R12/Q3 新增依赖（`06:27,48,107`），本设计与之共用同一份，**仓库当前没有该依赖**（`packages/shell/package.json`、`pnpm-lock.yaml` 均无命中），原 07「仓库已有 yaml」不成立。版本按二轮 P0-8 精确钉 `2.9.1`，lockfile 同提交，否则 `ci.yml:169-170` 红。 | `tickets/2026-11-24-inproc-only-review-oldfox-2.md:18,21`；`research/2026-11-24-inproc-only/06-patch-ownership-design.md:27,48,107`；`.github/workflows/ci.yml:169-170` |
| 0.9 | **门禁命令中的 profile 名从常量/参数取**：唯一来源是 `prov:147` 的 `PROFILE` 常量；改名 `opentui-monday` 在最后一个提交落地，门禁里不得出现裸 `opentui-inproc` 字面量（`ci.yml:237`、`scripts/verify-bridge-handshake.mjs:31` 是待清扫点）。 | `prov:147`；`tickets/2026-11-24-inproc-only-review-oldfox.md:15`；`tickets/2026-11-24-inproc-only-map.md:53`；`tickets/2026-11-24-inproc-only-review-oldfox-2.md:19` |

---

## 1. 契约文件精确内容

### 1.1 权威字节

直接复用 dsh 的模板（`<dsh>/dsh-app-boot/src/profile.ts:184-189`），写到 `<profileDir>/pnpm-workspace.yaml`：

```yaml
packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
```

逐字段理由：

- `packages: [.]`：把 profile 目录声明为单包 workspace，使 pnpm 把该文件当作配置源；dsh 模板自带此项（`<dsh>/dsh-app-boot/src/profile.ts:184-186`）。
- `nodeLinker: hoisted`：扁平 `node_modules`，缺失 peer 走宿主运行时解析，所有插件共享安装层唯一 cordis 实例，而不是各自一份（`<dsh>/dsh-app-boot/src/profile.ts:180-183`；票面 `tickets/2026-11-24-inproc-D7-workspace-contract.md:13`）。
- `autoInstallPeers: false`：阻止 pnpm 把 optional peer 自动装进 profile；pnpm 的 `autoInstallPeers` 会忽略 `peerDependenciesMeta.optional`，把宿主依赖树整体折进图（`<dsh>/dsh-app-boot/src/profile.ts:188`；`scripts/build-bridge.mjs:19-25`；`prov:967-969,1478-1486`）。
- pnpm ≥10 从 `pnpm-workspace.yaml` 而非 `.npmrc` 读这两个设置（`<dsh>/dsh-app-boot/src/profile.ts:180-183`），所以写在 `.npmrc` 无效。
- 权威副本是「新写文件」的字节；**已有文件不整体覆盖**，只做 1.3 的三键相等判定。`allowBuilds`（11 true + 1 false，本机 `~/.dsh/profiles/opentui/pnpm-workspace.yaml`）与 dsh 的审批状态是用户/宿主的数据；唯一的整体覆盖路径是 §3.3 的 repair「备份后重写」（P0-9 指引二），用户键留在 `.bak-<ts>` 中可找回。

### 1.2 不接管的键（must preserve）

- `allowBuilds`：dsh 插件管理器独占写入；pnpm 11 阻止依赖脚本时它记录 pending 键并可批准，`writeFileAtomic(..., { mode: 0o600 })`（`<dsh>/dsh-plugin-manager/src/build-approval.ts:63-70,90-96`；`<dsh>/dsh-plugin-manager/README.md:72`）。
- `strictDepBuilds`：**dsh 全仓库无写入**（`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/**` 全量 grep 0 命中），属于用户/pnpm 侧设置；不得新增或翻转。
- 其他未知键（用户自定义 glob、patchedDependencies 等）一律保留；本设计只拥有三个托管字段。
- 三键相等通过时这些键原样留在文件里（本步骤不重写整份文件）；唯一会覆盖它们的路径是 §3.3 repair 的备份后整体重写，属显式 opt-in、可从 `.bak` 恢复的 reset。

### 1.3 写入 / 判定算法（纯 FS，无 spawn）

1. `existsSync(workspacePath) === false` → 原子写 1.1 的模板（复用 manifest 的 tmp+rename 范式，`prov:1421-1425`）。
   - **mode 引用修正（P1）**：文件 mode 沿用 dsh **首次写**的默认行为——`writeFileSync(workspacePath, PROFILE_PNPM_WORKSPACE)` 不带 `mode`（`<dsh>/dsh-app-boot/src/profile.ts:216`；oldfox 二轮记作 `:217`，rc.3 pin 可能行号偏移），不是 0o600。原 07 引 `<dsh>/dsh-plugin-manager/src/build-approval.ts:69` 说「0o600 与 dsh 对齐」不成立：那是 build-approval 后续整份重写路径（`:69,95`），不是首次写。本步骤不额外声明 mode。
2. 存在 → **只做三键相等判定，不补缺、不合并**（P0-12）：
   - 解析需要 YAML AST：本设计**依赖 06 的 yaml 决议**（`research/2026-11-24-inproc-only/06-patch-ownership-design.md:27,48,107` 的 R12/Q3；oldfox P0-8 要求精确钉 `2.9.1` 且 lockfile 同提交，`tickets/2026-11-24-inproc-only-review-oldfox-2.md:18`）。仓库当前**没有** `yaml` 依赖（`packages/shell/package.json`、`pnpm-lock.yaml` 无命中），原 07「仓库已有 yaml」不成立。本步骤复用 06 新增的同一份依赖，不另起版本；06 未落地前 07 不能开工。
   - 相等条件：`packages` 是字符串数组且含 `.`；`nodeLinker === 'hoisted'`；`autoInstallPeers === false`。三者全真 → 通过、不写。
   - 其余（非 mapping / 解析报错 / 托管键类型错 / `packages` 不含 `.` / 值不同）→ **fail-fast**（见 §2），不写、不 WARN 放行。
3. 判等仍用语义相等而不用字节比较——dsh 的 `String(document)` 重写会让字节永不相等（`<dsh>/dsh-plugin-manager/src/build-approval.ts:69,95`）；但相等判据只覆盖三托管键，不再推导任何补缺动作。

---

## 2. 状态机（缺失 / 一致 / 其余 fail-fast）

（P0-12 删除了原「部分」补缺分支：改名后 profile 目录全新，dsh 两个写手只产出完整模板或 round-trip，`tickets/2026-11-24-inproc-only-review-oldfox-2.md:22`。）

| 状态 | 判定（解析后的 YAML） | 动作 | 输出 |
|---|---|---|---|
| **缺失** | 文件不存在 | 原子写完整模板 | `workspace: wrote contract`；继续后续步骤 |
| **一致** | `nodeLinker === 'hoisted'` && `autoInstallPeers === false` && `packages` 含 `.` | 不写 | `workspace: contract OK` |
| **冲突 / 部分 / 不可解析** | 托管键存在但值不同；或三键任一缺失（`packages` 非空但不含 `.` 亦属此类）；或 YAML 语法错误 / 根非 mapping / 托管键类型错误 | **fail-fast，文件不动**；位置在 companion 安装之前 | `FAIL workspace contract <状态>: <file> <key> expected <...> got <...>` + 两条指引（见下） |

补充约束：

- **fail-fast 的触发点**：新增 step `[3/9] workspace`，在 manifest 之后、bridge copy 之前；必须在 `provisionCompanions()`（`prov:1462`）之前完成。原 step 3–8 顺延为 4–9，`TOTAL_STEPS` 8→9，步号注释与 `say()` 标签同步（`prov:174,735`）。原因：坏契约下继续 step 4 会真装分钟级并把 `@deepseek-ai` 写进 profile 的 `node_modules`，到 step 5 才 fail，安装成本白付且失败文案不提 workspace 冲突（P0-9，`tickets/2026-11-24-inproc-only-review-oldfox-2.md:19`）。
- **失败文案三要素**：必须点名 `workspace` 与「冲突/不可解析/部分」字样、文件路径、具体键与期望值/实际值，再给两条可执行指引。`fail(message, detail)` 的两参形态（`prov:754-759`）正好承载「诊断 + 两条指引」：
  1. **手改文件**：`<profileDir>/pnpm-workspace.yaml` 里设 `nodeLinker: hoisted`、`autoInstallPeers: false`、`packages` 含 `.`，保留 `allowBuilds` 等用户键，再重跑。
  2. **重跑 `dsh-opentui --repair-bridge`**：先把现有文件备份为 `<file>.bak-<ts>`，再按 §1.1 模板整体重写；用户键在备份中可找回（§3.3）。
- 不再存在「只 WARN 继续」的契约状态（P0-9）；WARN 仍用于 companion 可选项（`prov:1021-1032`），与契约无关。
- **已知边界（推测，由源码推断）**：若 `pnpm-workspace.yaml` 缺失时 build-approval 先写出仅含 `allowBuilds` 的文件（`<dsh>/dsh-plugin-manager/src/build-approval.ts:28-35,63-70`），本步骤按「部分」fail-fast；走指引二备份后重写即可恢复三键。
- 幂等：重复运行走「一致」分支，不产生 `.bak`、不重写文件；与 manifest 的收敛范式一致（`prov:1412-1427`）。

---

## 3. 修复策略（既有坏 profile）

### 3.1 检测（三重，缺一不可）

1. **目录副本**：`existsSync(join(profileDir, 'node_modules', '@deepseek-ai'))` —— 与 step 5 现成硬 guard 完全同一判据（`prov:1479-1485`）。注意 `existsSync` 对 symlink 也为真（oldfox P0-10，`tickets/2026-11-24-inproc-only-review-oldfox-2.md:20`），所以判据不能带「symlink 豁免」。
2. **清单残留**：`dependencies` 中任何 `@deepseek-ai/*` 键；`dsh.profile.bundles` 中除白名单 `@deepseek-ai/dsh-base`（`prov:149 BUNDLES`）之外的 `@deepseek-ai/*` 行。因为 `desiredManifest` 是 `...existing` 展开（`prov:892-901`），这类键不会被自动清掉，是复发的根源。
3. **契约状态**：按第 2 节判定；「缺失 / 冲突 / 部分 / 不可解析」均为待修复态。

### 3.2 清理原则（修复判据 == guard 判据，P0-10）

- **修复 = 删 `<profileDir>/node_modules` 与 `<profileDir>/pnpm-lock.yaml`，按契约重装**。取消原方案的 `renameSync` 隔离、`.provision-quarantine/<ts>` 与 `lstatSync` symlink 豁免（`tickets/2026-11-24-inproc-only-review-oldfox-2.md:20`）。
- **为什么收敛（逐条对应 P0-10 的三个失败面）**：
  1. guard 用 `existsSync(<profile>/node_modules/@deepseek-ai)`（`prov:1479-1480`），symlink 也为真；旧方案「symlink 不删」会留下 symlink 使 guard 继续红。整目录 `rmSync(recursive)` 同时清除真实目录副本与 symlink，删除后 `existsSync` 必然为 false，修复判据与 guard 判据完全一致。
  2. 旧 quarantine 目录 `<profile>/.provision-quarantine/<ts>/@deepseek-ai` 虽脱离 `node_modules/@deepseek-ai`，但仍匹配 CI 的 `find "$PROFILE_DIR" -path '*@deepseek-ai*'`（`.github/workflows/ci.yml:315-317`），会把修复流程本身变成门禁红。新方案不在 profile 内留任何 `@deepseek-ai` 路径。
  3. `pnpm-lock.yaml` 记录旧解析结果（`autoInstallPeers: true` 时代的 hoisted 树）；只删目录不删 lock，下一次 pnpm 可能按旧 lock 重新物化 `@deepseek-ai`。删 lock 强制在纠正后的契约（`hoisted` + `autoInstallPeers: false`）下重新解析。
- **重装与顺序**：重装由现有 step 4（`provisionCompanions()` → `dsh plugin add`，`prov:1034-1039`）承担；bridge copy（step 3）与 shim（原 step 8）在各自步骤重建。顺序：契约 fail-fast / repair 重写 → 从 manifest 清 `@deepseek-ai/*` 依赖（tmp+rename 原子写，`prov:937-939`）→ 删 `node_modules` + `pnpm-lock.yaml` → 后续步骤重建 → step 5 guard 闭环。删除发生在 bridge copy 之前，避免刚复制的 bridge 被随后删掉。
- **边界**：只删这一个 profile 的两个路径；`profiles/node_modules` 共享安装层（本机 `~/.dsh/profiles/node_modules` 221 项）与其他 profile 不动（`prov:92-95,147`）。
- **dsh 不在 PATH 时的重装**：`provisionCompanions()` 会 WARN + `dropUnmountedCompanions()`（`prov:1021-1032,920-942`），删完 `node_modules` 后 companion 不重装，但 manifest 残留声明同时被清，step 5 三视图仍自洽（`prov:1077-1100`）。这是「更小失败面」的代价，PATH 在场的路径由第二个门禁 pass 覆盖（§4.1）。

### 3.3 `--repair` 扩展

- `--repair` / `--repair-bridge` 当前被接受但是 no-op（`prov:87-90,1376-1379`）；CI 冷启动每次传 `--repair-bridge`（`.github/workflows/ci.yml:294`）。扩展为 opt-in 修复位：契约冲突时备份后整体重写（P0-9 指引二）→ 清 manifest `@deepseek-ai/*` → 删 `node_modules` + `pnpm-lock.yaml` → 后续步骤重装。
- **普通启动（无 flag）严格保持现状**：契约状态非「缺失/一致」即 fail-fast（§2）；若为「一致」但 step 5 发现 `@deepseek-ai` 副本 → fail（`prov:1481-1484`），提示重跑 `--repair-bridge`。不静默删用户目录内容。
- 修复是幂等的：第二次 `--repair-bridge` 走「一致」+ 无副本 → 不删不写，guard 通过。
- 文案：`repair mode: workspace contract rewritten from backup; @deepseek-ai manifest rows removed; node_modules + pnpm-lock.yaml cleared for reinstall`。
- 与 `--repair-bridge` 原语义（bridge copy 无条件收敛 + T5 指纹 guard，`prov:1430-1457,1490-1492`）不冲突，但扩展后它不再「不碰 pnpm-workspace.yaml / dependencies」（§7 未知项 5 更新）。

---

## 4. 门禁设计：`fresh-home-provision`

### 4.1 执行路径（必须是真 provisioner）

1. 复用 pack 门禁的前半段：`pnpm install --frozen-lockfile` → `bun scripts/build-bridge.mjs` → `npm pack` → `npm i -g --prefix $PREFIX $TARBALL` → `npm i -g --prefix $HOST_PREFIX @deepseek-ai/dsh@0.2.2-rc.3`（`.github/workflows/ci.yml:171-175,211-220,286-290`）。
2. **两个 pass，PATH 按命令作用域区分（P0-12）**：
   - **第一个 pass（现有冷启动，`.github/workflows/ci.yml:292-300`）**：**不**前置 `$HOST_PREFIX/bin`；在跑 provisioner 前加前置断言 `! command -v dsh || fail "..."`（`command -v` 优于 `which`，更可移植），冻结「dsh 不在 PATH」这条唯一覆盖（当前 CI 明确把宿主装在私有 prefix 且不在 PATH，`:225-229`）。该 pass 下 companion 被跳过是预期结果，断言输出含 skipped。
   - **第二个 pass（新增 `fresh-home-provision`）**：只在**该 pass 的那条命令**前置 PATH，写成 `PATH="$HOST_PREFIX/bin:$PATH" DSH_HOME="$DSH_HOME" ... "$PREFIX/bin/dsh-opentui" --repair-bridge`；**不要**写进 job/step 级 `env:`，否则两个 pass 都被污染、唯一覆盖消失。`pnpm` 也要在 PATH，因为 dsh 内部默认以 `pnpm` 命令安装（`<dsh>/dsh-plugin-manager/src/index.ts:326,1215-1223`）。
3. 空 DSH_HOME：`WORK=$(mktemp -d); DSH_HOME="$WORK/dsh-home"; mkdir -p "$DSH_HOME"` —— 必须预建，provisioner 在 DSH_HOME 不存在时直接 fail（`prov:1507-1512`）。**不要从 `~/.dsh` 拷任何东西**（D5 决议修正，`tickets/2026-11-24-inproc-D5-gates-and-legacy-dir.md:41,44`）。
4. 跑真 provisioner（命令作用域 PATH）：`PATH="$HOST_PREFIX/bin:$PATH" DSH_HOME="$DSH_HOME" DSH_OPENTUI_HOST_VERSION=0.2.2-rc.3 "$PREFIX/bin/dsh-opentui" --repair-bridge`（对照现有冷启动 `:292-300`，env pin 见 `:229`；不设 `DSH_OPENTUI_COMPANION_LATEST=off`，否则 companion 路径又被跳过；钉版按 §4.2）。
5. 断言（全部 hard fail + 诊断 dump，沿用 `:242-258` 的 `dump_diagnostics` 范式）：
   - **契约**：`node -e` 用 yaml 解析 `$PROFILE_DIR/pnpm-workspace.yaml`，断言 `packages` 含 `.`、`nodeLinker === 'hoisted'`、`autoInstallPeers === false`；文件缺失或任一不符即 fail。
   - **无拷贝**：`find "$PROFILE_DIR" -path '*@deepseek-ai*' -print` 为空（复用 `:314-317`）。此断言同时守住 §3.2 不再把 quarantine 留在 profile 内。
   - **companion 三视图**：对每个 catalog 条目，断言 `package.json` 的 `dependencies[name]`、`dsh.profile.bundles` 含 `name`、`node_modules/@aiwayds/<name>/package.json` 存在——与 provisioner 自身的 `verifyCompanionState` 完全同一判据（`prov:1077-1100`）。期望集合从 `inproc-companions.mjs` 的 `COMPANIONS`（`:35-99`）动态导出，不写死数字；版本按 §4.2 的 pins 断言。D2 决议是 10 个保留项 + 本来就默认装的 `subagent-registry`（`tickets/2026-11-24-inproc-D2-companion-parity.md:37-40`），而 D7 票面写「10 个 companion bundle」（`tickets/2026-11-24-inproc-D7-workspace-contract.md:22`）；实现时以 D2 决议的实际 catalog 为准（见 §7 未知项）。
   - **幂等**：用同一环境再跑一遍 `--repair-bridge`，断言第二次输出 `manifest already correct, skipping` / `workspace: contract OK`，且契约文件哈希不变、没有新的 `.bak-*`（manifest 备份范式见 `:1416-1420`）。
   - 可选复用：握手 `node scripts/verify-bridge-handshake.mjs "$HOST_PREFIX/bin/dsh" "$DSH_HOME" 25000`（`:302-312`），把 bridge 握手串成一条链。
6. 建议做成独立脚本 `scripts/verify-fresh-home-provision.mjs`（解析 YAML + 三视图断言），由 CI 调用；本地开发者用真 dsh 也能跑同一个脚本，不需要 CI 专用分支。
7. **profile 名从常量/参数取（P0-5 覆盖矩阵末行）**：上述命令里的 `$PROFILE_DIR` 不得以裸 `opentui-inproc` 拼出，应由 provisioner 的 `PROFILE` 常量（`prov:147`）导出或由 CI 参数传入，例如 `PROFILE_NAME="${PROFILE_NAME:?}"` / `PROFILE_NAME="$(node -p '...PROFILE...')"`，再 `PROFILE_DIR="$DSH_HOME/profiles/$PROFILE_NAME"`；`scripts/verify-bridge-handshake.mjs:31` 硬编码的 `--profile opentui-inproc` 同样改为参数/读同一常量。改名 `opentui-monday` 在最后一个提交落地，届时只改常量一处（`tickets/2026-11-24-inproc-only-review-oldfox.md:15`；`tickets/2026-11-24-inproc-only-map.md:53`；`tickets/2026-11-24-inproc-only-review-oldfox-2.md:19`）。

### 4.2 能否进默认 CI / runner 前置

- **可以**，runner 用 `ubuntu-latest` 即可（pack 门禁已是默认 CI job，`.github/workflows/ci.yml:153-156`）。前置：node 26（shell engines，`ci.yml:168`）、pnpm 10.18.3（`:162-164`）、bun 1.4.4（`:159-161`）、npm registry 可达（`queryDistTagLatest` 对 10+ companion 串行 `npm view`，各 30s 超时，`packages/shell/scripts/lib/inproc-companions.mjs:199-213`；D2 估算黑洞网络最坏约 300s + 每次 `dsh plugin add` 最长 10 分钟，`tickets/2026-11-24-inproc-D2-companion-parity.md:49`）、第二个 pass 的命令作用域 PATH。
- 推荐把第二个 pass 做成 pack-cold-start job 内的第二个 scratch HOME pass（复用 tarball 与宿主安装，不重复下载；总 timeout 从 25 分钟上调到 35–40 分钟，`.github/workflows/ci.yml:153-156`），同时保留独立脚本入口便于本地复现；不要新增一个重复 npm install 的 job，除非需要并行缩短墙钟时间。
- **CI 钉版（P1，`tickets/2026-11-24-inproc-only-review-oldfox-2.md:34`）**：现况是 `queryDistTagLatest` 读 npm `dist-tags.latest`（`inproc-companions.mjs:199-213`），而 `declaredRange` 明确「只做 major/downgrade guard，`never installed`」（`:31-33`），所以门禁的 companion 版本随时间漂移。具体做法：
  1. 在 `packages/shell` 新增 checked-in `companion-pins.json`，格式为 `{"<包名>":"<精确版本>", ...}`（此格式为示例，不预设具体版本号）；值由一次性 `npm view <name> dist-tags.latest` 生成，随 D2 catalog 落地提交，CI **只读不现算**。
  2. provisioner 增加 opt-in env `DSH_OPENTUI_COMPANION_PINS`（指向 pins 文件或 `name@version,...`），在 `selectCompanions()` 之后、`decideCompanionInstall()` 之前把每个条目的安装 spec 从 `latest` 替换为精确 pin（**推测**：当前无此 env/接口，需新增实现；挂点见 `inproc-companions.mjs:116-124` 与 `prov:1000-1011`）。
  3. 第二个 pass 设该 env 并断言实际安装版本等于 pins；第一个 pass 不需设（companion 被跳过）。
  4. pins 更新走独立 PR（人工或定时 job），与门禁本体解耦；不更新时门禁稳定复现同一组版本，不再漂移。
- CI 内 companion 数量较大时，可用 `DSH_OPENTUI_COMPANIONS` 指定确定性子集跑快速路径（`inproc-companions.mjs:25,116-124`），但**全量 catalog 的断言至少保留一条上下文**——否则又回到「默认路径零覆盖」（D5:41 的核心批评）。

### 4.3 与 D5 的统一

- 抽出一个共享 fixture 构造函数（例如 `scripts/lib/fresh-home-provision.sh` 或等价 node helper）：输入 tarball 路径 + dsh bin 路径 + 空目录，输出「已跑过真 provisioner 的 scratch DSH_HOME」。`fresh-home-provision` 门禁和 D5 所有需要 profile seed 的脚本（`scripts/real-client-gate.sh`、`verify/*`、`e2e/families/lib/family-lib.sh`，见 `research/2026-11-24-inproc-only/03-references-and-gates.md:144-159`）统一调用它。
- **实施时必须「跑真 provisioner 到 scratch HOME」**：D5 票面 `:36` 的「脚本自带固定假数据 / 静态 fixture」决议已被 `:41` 的评审修正明确推翻——pack 冷启动门禁里 dsh 不在 PATH、step 4 直接 WARN 跳过（`.github/workflows/ci.yml:225-229,1021-1033`），静态 fixture 会掩盖 P0-3 那类问题。禁止从 `~/.dsh` 拷贝。
- D5 票面需补一条决议修正记录，否则实施者会照旧文本做（`tickets/2026-11-24-inproc-D5-gates-and-legacy-dir.md:36,41`）。
- D5 的「老目录保留原样、不删不改名」（`tickets/2026-11-24-inproc-D5-gates-and-legacy-dir.md:44`）与本门禁无冲突：门禁只碰 scratch HOME，永不读 `~/.dsh`。

---

## 5. 风险与处理原则

| 风险 | 处理原则（一句） |
|---|---|
| **pnpm 版本差异（10 / 11）** | 三字段契约在 10/11 都从 `pnpm-workspace.yaml` 读取（`<dsh>/dsh-app-boot/src/profile.ts:180-183`），照同一模板写即可；CI 固定 pnpm 10.18.3 保证确定性，另在 pnpm 11 环境手工跑一次门禁确认接受度（`<dsh>/dsh-plugin-manager/README.md:72` 记的是 pnpm 11 的脚本阻止行为）。 |
| **`allowBuilds` 与 `strictDepBuilds`** | 两者全部视为 dsh/用户数据，本设计不接管、不判定；三托管键冲突即 fail-fast（§2），唯一覆盖它们的路径是 repair 的备份后整体重写（§3.3，`<dsh>/dsh-plugin-manager/src/build-approval.ts:38-50,68-69,94-95`）。 |
| **坏契约继续安装（P0-9）** | 契约步骤在 companion 安装前 fail-fast，文案含 workspace 冲突 + 两条指引（`tickets/2026-11-24-inproc-only-review-oldfox-2.md:19`；§2）。 |
| **修复留残留触发 CI（P0-10）** | 删整个 `node_modules` + `pnpm-lock.yaml`、不建 quarantine、不豁免 symlink；修复后 `existsSync` guard 与 CI `find` 同时干净（`.github/workflows/ci.yml:315-317`；§3.2）。 |
| **yaml 依赖与 06 的耦合（P0-11）** | 复用 06 决议的同一份 `yaml`，精确 `2.9.1`、lockfile 同提交；06 若改版本须同步，否则 `ci.yml:169-170` 红（`tickets/2026-11-24-inproc-only-review-oldfox-2.md:18,21`）。 |
| **profile 改名打断门禁** | 门禁命令中 profile 名从 `PROFILE` 常量 / 参数取（§4.1 第 7 条），改名 `opentui-monday` 在最后提交落地（`tickets/2026-11-24-inproc-only-review-oldfox.md:15`；`tickets/2026-11-24-inproc-only-map.md:53`）。 |
| **companion 版本漂移（P1）** | CI 用 checked-in pins + opt-in env 把 `latest` 换成精确 pin（§4.2；新增接口标「推测」）。 |
| **Windows** | 契约写入本身是跨平台 `node:fs` 操作且可用 LF + 原子 rename，但 `which dsh` 探测（`prov:950-957`）、bash 门禁脚本与 lock 的 POSIX 语义不跨平台——本轮门禁限定 ubuntu/macos，若需 Windows 支持先把 `dshOnPath` 改为 PATH 扫描并单独设计 lock/门禁（`prov:75-81`）。 |
| （附带）**companion 启动成本** | 门禁用 `DSH_OPENTUI_COMPANIONS` 控制全量/子集两档，并保留 `npm view` 30s 超时与 `dsh plugin add` 10 分钟超时的既有上界（`inproc-companions.mjs:199-213`；`prov:175,1034-1039`；`tickets/2026-11-24-inproc-D2-companion-parity.md:49`）。 |

---

## 6. 实施影响面（供拆分任务）

| 文件 | 改动 |
|---|---|
| `packages/shell/scripts/provision-inproc-profile.mjs` | 新增 step `[3/9] workspace`（在 `:1462` 之前）：缺失写模板 / 三键相等通过 / 其余 fail-fast（文案含两条指引）；`TOTAL_STEPS` 8→9（`:174`）；更新步骤注释与 `say()` 标签（`:9-11,22-29,735`）；扩展 `--repair-bridge` 为「契约备份重写 + manifest 清 `@deepseek-ai/*` + 删 `node_modules`/`pnpm-lock.yaml` 重装」（`:87-90,1376-1379`）；不引入 quarantine / symlink 豁免。 |
| `packages/shell/package.json` + `pnpm-lock.yaml` | 复用 06 决议的 `yaml` 依赖，精确 `2.9.1`、lockfile 同提交（P0-11/P0-8，`tickets/2026-11-24-inproc-only-review-oldfox-2.md:18,21`；本设计不独立新增第二份）。 |
| `packages/shell/companion-pins.json`（新） | CI 钉版用的 checked-in pins 文件；配套 opt-in env 解析（接口标「推测」，§4.2）。 |
| `scripts/verify-fresh-home-provision.mjs`（新） | YAML 契约断言 + 无拷贝断言 + 三视图断言（版本按 pins）+ 幂等二次运行；profile 名从参数/常量取，不硬编码。 |
| `.github/workflows/ci.yml` | pack-cold-start 内加第二个 scratch HOME pass：第一个 pass 加 `! command -v dsh` 断言；第二个 pass 命令作用域 PATH + pins env；timeout 上调（`:153-156,225-229,292-317`）；profile 名从常量/参数取（`:237`）。 |
| `scripts/verify-bridge-handshake.mjs` | `:31` 硬编码 `--profile opentui-inproc` 改为参数/读同一常量。 |
| `tickets/2026-11-24-inproc-D5-gates-and-legacy-dir.md` | 修正 `:36` 静态 fixture 决议，登记 D5 与 D7 共用「跑真 provisioner 到 scratch HOME」fixture helper。 |
| `tickets/2026-11-24-inproc-D7-workspace-contract.md` | 决议栏 `:25-27` 回填本设计链接；更新 `:31-33` 中「语义合并 / quarantine 隔离」的旧表述。 |

---

## 7. 未知项

1. **companion 数字不一致**：D2 决议「保留 10 + 本来就默认装的 subagent-registry」=`11`，D7 票面写「10 个 companion bundle」（`tickets/2026-11-24-inproc-D2-companion-parity.md:37-40` vs `tickets/2026-11-24-inproc-D7-workspace-contract.md:22`）；HEAD 的 catalog 仍是 9 项且只有 registry 默认装（`inproc-companions.mjs:35-99`）。门禁实现前须按 D2 落地后的 catalog 重新数，并写成动态导出，不硬编码。
2. **pnpm 11 实机验证未做**：本机 pnpm 10.33.0、CI pin 10.18.3（`.github/workflows/ci.yml:164`）；pnpm 11 对三字段契约的接受度只有文档级证据（`<dsh>/dsh-plugin-manager/README.md:72`），需本地/门禁补一次真实安装。
3. **pins 文件的维护归属未拍板**：谁生成 / 多久更新 `companion-pins.json` 尚无结论（§4.2）；本设计只要求 CI 只读 pins、门禁不随 `latest` 漂移。
4. **dsh 版本跨度**：本机 `0.2.2-rc.5`、CI pin `0.2.2-rc.3`；两者 `profile.ts` 模板一致（本机副本 `:184-189`），但 `operations.ts:603-605` 的 initProfile 跳过条件是否在 rc.3 完全相同，需按 CI 实际安装版本复核一次。
5. **`--repair-bridge` 扩展的兼容性**：门禁、launcher 与文档都把它当 no-op 对外解释（`prov:87-90`；`.github/workflows/ci.yml:294`）；扩展后它会删 `node_modules`/`pnpm-lock.yaml` 并可能重写契约，需确认没有调用方依赖「repair 不碰 pnpm-workspace.yaml / dependencies」这一隐含性质。
