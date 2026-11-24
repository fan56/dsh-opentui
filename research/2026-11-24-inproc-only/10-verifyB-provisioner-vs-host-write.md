# Verify B — provisioner 字节比较 vs 宿主 `/settings` 写（真机实测）

- 日期：2026-11-24
- 仓库：`/Users/qingguee/repo/dsh-opentui-wt-inproc-only`，HEAD `153c8cedfa25be5242fc9cd9f04a275ec5dbc7d5`
- 隔离：scratch `W=/private/tmp/verifyB.tQ4u5Q`，`DSH_HOME=$W/home`；**未读写 `~/.dsh`，未改仓库源码，未 commit**
- 宿主 yaml：`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/yaml` = **2.9.1**；`node` = `/opt/homebrew/bin/node` v26.8.1；宿主 dsh = 0.2.2-rc.5

## 0. 结论先行

| 断言 | 结论 | 证据一句话 |
|---|---|---|
| **1（oldfox P0-1）** 宿主 `/settings` 写走 `parseDocument → String(document)` 整份重写（长行折行）→ provisioner 字节比较失效 → `modified outside provisioning` WARN + `.bak-<ts>` + 覆盖 | **成立（因果核心）** | 仅一次宿主式重写就使 patch 从 15442 B / 456 行 / md5 `80a6560d…` 变为 15448 B / 457 行 / md5 `c2105aa…`（唯一差异是 `defaultPreset` 折行）；下一轮 provision 立即产生 1 个 `.bak` 与两条 WARN，并覆盖回模板字节。 |
| **2（carry 缺口）** 不在现有 3 字段 carry 列表的宿主写入值（`windowSeconds: 300`）在下一轮 provision 丢失 | **成立** | 注入后第 464 行 `windowSeconds: 300`；第 2 轮后 `grep windowSeconds` = ABSENT，该值只存在于 `.bak` 中（备份第 464 行）。 |

断言 1 的**措辞修正**：实测并非「无条件每次启动」——第 3/4 轮没有宿主写时是 `already current, skipping`，没有 `.bak`。准确表述是：**每一次宿主改写之后的下一轮 provision 都必然误判**。这与设计 06 的 R1/R8 完全一致（判据不能是字节）。

额外发现（第三条）：宿主折行后的 `!!js` 行因不再匹配 `patch-runtime-merge.mjs` 的整行正则，还会多出一条 `permission.defaultPreset: runtime value failed the scalar allow-list; template !!js line kept` WARN——折行不仅破坏字节比较，也破坏当前的行级 carry 合并本身。

## 1. 方法与必要的执行细节

### 1.1 命令约束
严格使用用户指定的 `PATH=/usr/bin:/bin` + `/opt/homebrew/bin/node`，使 step [4/8] 的 `dshOnPath()` 找不到 `dsh` 而 WARN 跳过，避免联网装 companion。已验证：`/usr/bin/dsh`、`/bin/dsh` 均不存在，`dsh` 只在 `/opt/homebrew/bin`。

### 1.2 一个必要补充（已记录，非偏离隔离约束）
脚本 step [1/8] 的 `detectHostVersion()`（`host-compat.mjs:119-147`）同样依赖 `dsh --version`；在 stripped PATH 下会在 step 1 直接 fail-fast，永远走不到 step 4。因此每轮命令额外加**只读、无副作用的文档化覆盖** `DSH_OPENTUI_HOST_VERSION=0.2.2-rc.5`（本机真实宿主版本，落在支持窗口 `>=0.2.2-rc.3 <0.3.0`，触发 `granted exact-version exemption`）。该变量的用途在 `host-compat.mjs:42` 明确写为「test/know-exact-runtime override」；不联网、不写 `~/.dsh`。

### 1.3 宿主写模拟的 customTags 对齐
任务给出的 `customTags: ['js']` 与宿主实际写法不一致。按任务备注先读了 `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-config-editor/src/index.ts:105-141`：真实调用是

```ts
const document = parseDocument(before, {
  customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }],
})
```

故 `$W/sim.mjs`（**放在 scratch，不在仓库**）采用宿主这一写法，再 `writeFileSync(p, String(doc))`。`parseDocument` 无 error（`SIM_PARSE_ERRORS` 未出现）。未复刻宿主随后的 config 变更、`document.contents.flow = false`、`visit(__jsExpr)` 与 `writeFileAtomic`；见 §6 未知项。

## 2. 四轮原始证据

### 第 1 轮 — 初始 provision（基线）

```bash
W=$(mktemp -d /private/tmp/verifyB.XXXXXX); export DSH_HOME="$W/home"
mkdir -p "$DSH_HOME/profiles/opentui-inproc"
cd /Users/qingguee/repo/dsh-opentui-wt-inproc-only
PATH=/usr/bin:/bin DSH_OPENTUI_HOST_VERSION=0.2.2-rc.5 DSH_HOME="$DSH_HOME" \
  /opt/homebrew/bin/node packages/shell/scripts/provision-inproc-profile.mjs > "$W/r1.log" 2>&1
```

- 退出码 `0`，`PASS`
- `cordis.patch.yml` **已生成**：md5 `80a6560d52edafeb6f14ff0f058d1b68`，15442 B，456 行，`# profileRevision: 3e0cafa23235d81c`（第 2 行）
- `pnpm-workspace.yaml`：**缺失**（`ls` → No such file or directory，事实记录）
- `.bak` 数量：`0`
- 关键日志行：
  - `[1/8] host — granted exact-version exemption @aiwayds/dsh-opentui-bridge@0.1.0 for dsh 0.2.2-rc.5`
  - `[4/8] WARN no global \`dsh\` on PATH; skipping optional companions. ...`（预期）
  - `[7/8] patch — wrote .../cordis.patch.yml (profileRevision 3e0cafa23235d81c)`
  - `[8/8] shim — wrote ... (shimRevision bed281c535303a14)`
- patch 中两行原文：
  - 第 370 行 `    defaultPreset: !!js process.env.DSH_OPENTUI_APPROVAL_GATE === 'off' && 'danger-full-access' || 'workspace-write'`
  - `windowSeconds`：不存在（模板无 `dsh-approval-policy` 行，确认于 `provision-inproc-profile.mjs:193-647`）

### 插入步骤 A — 宿主 `/settings` 写模拟（`parseDocument → String`）

```bash
/opt/homebrew/bin/node "$W/sim.mjs" "$DSH_HOME/profiles/opentui-inproc/cordis.patch.yml"
```

| 项 | 重写前 | 重写后 |
|---|---|---|
| 字节 | 15442 | 15448 |
| md5 | `80a6560d52edafeb6f14ff0f058d1b68` | `c2105aaabb82ebf571b269d419707938` |
| 行数 | 456 | 457 |
| `!!js` 行数 | 3（304 / 370 / 384） | 3（304 / **370+371 折行** / 385） |

唯一 diff（`$W/fold.diff`，pristine 模板 vs 重写后）：

```diff
@@ -367,7 +367,8 @@
     # DSH_OPENTUI_APPROVAL_GATE=off to restore the pre-T9 permissive default.
-    defaultPreset: !!js process.env.DSH_OPENTUI_APPROVAL_GATE === 'off' && 'danger-full-access' || 'workspace-write'
+    defaultPreset: !!js process.env.DSH_OPENTUI_APPROVAL_GATE === 'off' &&
+      'danger-full-access' || 'workspace-write'
```

- 被折行的行号：**370**（第 370 行被拆成 370–371；其余两处 `!!js` 未折行）
- `# profileRevision` 仍在，**仍为 `3e0cafa23235d81c`**（宿主重写不删 marker）
- 结论：值语义未变（折行只发生在空格处，设计 06 附录 B.4），但**字节已不等** → 断言 1 的前提成立。

### 插入步骤 B — 注入 carry 列表外的宿主写入值

模板里没有 `- insert: dsh-approval-policy` 条目，按任务指示在文件末尾按 patch 语法追加（包名取设计 06 §5.2 的 `@aiwayds/dsh-approval-policy`）：

```yaml
# Host-written value under a row outside the 3-field carry list (verification B step 4)
- insert:
    - id: dsh-approval-policy
      name: '@aiwayds/dsh-approval-policy'
      config:
        windowSeconds: 300
```

- 注入后：md5 `55552bff84bae0e6e3dbe3f82cbc0c7c`，15661 B，464 行
- 行号：461 `- id: dsh-approval-policy`，462 `name:`，**464 `        windowSeconds: 300`**
- `.bak` 数量仍为 0

### 第 2 轮 — 对「宿主写过 + 注入过」的 patch 再 provision

```bash
PATH=/usr/bin:/bin DSH_OPENTUI_HOST_VERSION=0.2.2-rc.5 DSH_HOME="$DSH_HOME" \
  /opt/homebrew/bin/node packages/shell/scripts/provision-inproc-profile.mjs > "$W/r2.log" 2>&1
```

- 退出码 `0`，`PASS`
- **出现 1 个 `.bak`**：`cordis.patch.yml.bak-1795501273588`
- **出现 `modified outside provisioning` WARN**（原文）：
  > `WARN cordis.patch.yml was modified outside provisioning (local revision 3e0cafa23235d81c, md5 55552bff84bae0e6e3dbe3f82cbc0c7c matches neither a known web/opentui template nor the current generated profileRevision 3e0cafa23235d81c); backed up to .../cordis.patch.yml.bak-1795501273588`
- **额外 WARN**（折行破坏行级 merge）：
  > `WARN cordis.patch.yml: permission.defaultPreset: runtime value failed the scalar allow-list; template !!js line kept`
- `windowSeconds`：**主文件 ABSENT**；`.bak` 第 464 行仍为 `windowSeconds: 300`
- `# profileRevision`：**仍是本轮值 `3e0cafa23235d81c`**（第 2 行；与第 1 轮相同，因为模板未变）
- 主文件被覆盖回基线：md5 `80a6560d52edafeb6f14ff0f058d1b68`，15442 B，456 行
- `defaultPreset` 恢复为第 370 行单行原文
- 值得注意的措辞缺陷：WARN 说 `local revision … matches neither … nor the current generated profileRevision 3e0cafa23235d81c`，但 `local revision` 与 `current profileRevision` **相等**；真正不等的是字节。这是日志表述不准，不是行为错误（行为根因见 `provisionPatch()` 的 `current === nextContent` 字节比较，脚本 `:1299`、`:1313`）。

### 第 3 轮 — 不模拟宿主写（稳定性）

- 退出码 `0`，`PASS`
- `[7/8] patch — already current, skipping`
- WARN：仅 step 4 的 `no global dsh`（**没有** `modified outside provisioning`、没有 defaultPreset WARN）
- md5 `80a6560d52edafeb6f14ff0f058d1b68`，456 行；`.bak` 数量 `1`（未新增）

### 第 4 轮 — 再来一次（额外稳定性复核）

- 退出码 `0`，`PASS`；`[7/8] patch — already current, skipping`
- md5 与行数不变；`.bak` 数量仍为 `1`

### 汇总表

| 阶段 | 动作 | 退出码 | patch md5 | 字节/行 | `.bak` 数 | `windowSeconds` | profileRevision |
|---|---|---|---|---|---|---|---|
| 1 | 初始 provision | 0 | `80a6560d…` | 15442 / 456 | 0 | 不存在 | `3e0cafa23235d81c` |
| A | 宿主式 `parseDocument→String` | 0（sim） | `c2105aa…` | 15448 / 457 | 0 | 不存在 | `3e0cafa23235d81c`（保留） |
| B | 注入 `windowSeconds: 300` | — | `55552bff…` | 15661 / 464 | 0 | 第 464 行 | 同上 |
| 2 | provision | 0 | `80a6560d…` | 15442 / 456 | **1** | **ABSENT** | `3e0cafa23235d81c`（本轮值） |
| 3 | provision（无写） | 0 | `80a6560d…` | 15442 / 456 | 1（未增） | ABSENT | 同上 |
| 4 | provision（无写） | 0 | `80a6560d…` | 15442 / 456 | 1（未增） | ABSENT | 同上 |

## 3. 与设计 06 的对应关系

| 设计项 | 现有实现（HEAD 153c8ce） | 实测映射 | R1/R8/R10 是否需要再调 |
|---|---|---|---|
| **R1** 不用字节比较判「没被改过」；`ancestor/current/next` 三方 + 侧车 `.patch-ownership.json`；`ancestor` 存模板投影 | `provisionPatch()` 只比 `current === nextContent && localRevision === PATCH_REVISION`（`:1299`）；marker 相等也不足以通过 | 宿主重写后 marker **仍相等**却仍备份 → 直接证明「marker 存在不是所有权证明」；且折行后的 `!!js` 行被行级正则误判，说明行级方案连语义合并都不可靠 | **不需要改 R1**。实测只是把 R1 的前提从推断升级为证据。建议把本文作为 R1 的回归用例（fold 后 `!!js` 行必须被 parser 还原，而非正则匹配）。 |
| **R8** 语义无变化就不写 | 任何字节变化都写（且备份） | 折行是纯字节变化、值不变，却触发写 + `.bak` + 两条 WARN | **不需要改 R8**。R8 的触发条件列表已覆盖。补一条验收：宿主折行后 `converge` 必须零写入、零 WARN。 |
| **R10** 备份只在五类事件；每轮最多一个 `.bak` + 逐 path WARN；根因是字节比较 | 当前根因确为字节比较；本轮只产生 1 个 patch `.bak`，但 WARN 是文件级、无 `paths[]`，且多出一条由折行引发的 merge WARN | 设计已把「字节比较」列为每轮 `.bak` 的根因；本次实测确认为唯一触发源（无其它 drift） | **不需要改 R10**。R10 的事件枚举与「每轮最多一个 `.bak`」均成立。注意实现时 `paths[]` 要包含被折行的 `permission.defaultPreset` 这类**语义未变但字节变了**的行应被排除，否则会误报 path WARN。 |
| **carry 缺口** vs 设计 06 §5.2 / L1 / L19（`dsh-approval-policy` 顶层行，`windowSeconds` 等 4 字段全 volatile，整块 config carry） | 当前 `patch-runtime-merge.mjs` 只 carry 3 个叶：`subagent.maxActiveSubagents`、`permission.defaultPreset`、`session-log-deepseek.enabled`（`:19-21,75-169`） | 第 464 行 `windowSeconds: 300` 在注入后的下一轮被整份覆盖、彻底丢失 | **设计不需要改**（已把 `dsh-approval-policy` 列入 carry 表并指定新增模板行）；缺口只在当前实现。结论支持设计 06 的「退役行级 3 字段 merge → 阶段 1b 整块 config 三方合并」判断，无需新增 R 编号。 |

补充：`R2`（只替换托管行节点字节区间、不做整文件 round-trip）在本次证据里得到间接支持——宿主的整文件 round-trip 恰好只改了 1 个节点的一个折行，却足以让整份文件被替换；采用 node range 写回即可把这一处字节变化局限在托管 span 内。

## 4. 实测产生文件（scratch，未在仓库）

- `$W/sim.mjs`、`$W/sim.log`、`$W/fold.diff`、`$W/after-sim.yml`、`$W/before-inject.yml`
- `$W/r1.log`、`$W/r2.log`、`$W/r3.log`、`$W/r4.log`
- `$W/home/profiles/opentui-inproc/cordis.patch.yml.bak-1795501273588`（保留注入值 464 行）
- 独立基线 scratch `/private/tmp/verifyBbaseline.NfhVzw`（只用于生成 diff）
- 报告写完后按步骤 8 执行 `rm -rf "$W"`（基线目录一并清理）；全程未碰 `~/.dsh`

## 5. 清理

按任务步骤 8 执行 `rm -rf "$W"`，并删除独立基线 scratch `/private/tmp/verifyBbaseline.NfhVzw` 与路径记录 `/private/tmp/verifyB.path`。`~/.dsh` 全程未读写。本文件是本次唯一的仓库内新增文件。

## 6. 未知项

1. **未跑真实 `/settings` API**：模拟只用同一 yaml 2.9.1 + 宿主同款 `customTags` 做 `parseDocument → String`，没有在 scratch DSH_HOME 上启动宿主并调用 settings.mutate。宿主真实写还会改 config 值、设 `document.contents.flow = false`、跑 `visit(__jsExpr)`、用 `writeFileAtomic` 写；这些未复刻。但本实验已证明**仅折行一项**就足以触发两个断言，结论方向不受影响。
2. **宿主其它规范化未触发**：设计 06 §164 列的 CRLF→LF、连续空行压缩、BOM 丢弃、行尾注释空格规范化在本模板上无从观察（模板已是 LF、无 BOM、无连续空行）。这些场景下是否引入更多 drift 未验证。
3. **`dsh-approval-policy` 未真正挂载**：scratch 里没装该包（stripped PATH + 无网络），注入的 insert 行只用于验证 carry/覆盖行为，未验证宿主是否会应用该行、以及 `name` 是否与宿主实际一致（`@aiwayds/dsh-approval-policy` 取自设计 06 的旧 opentui profile 路径）。
4. **「每次启动」的严格性**：如 §0 所述，无宿主写时第 3/4 轮不备份。若某启动路径在每次启动时都改写 patch，则每轮都会 `.bak`；本次未测该路径。
5. **sim 的 `customTags` 采用宿主对象写法**而非任务初稿的 `['js']`；两种写法在 `!!js` 标量上的等价性未单独对比（宿主写法已足以复现折行）。
6. **信号强度**：第 1 轮的 `DSH_OPENTUI_HOST_VERSION` 覆盖只影响 step [1/8] 的版本判定；已核对日志确认 step 4 仍按预期 WARN 跳过、没有联网请求。
