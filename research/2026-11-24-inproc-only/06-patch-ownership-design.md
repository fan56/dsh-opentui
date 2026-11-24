# 06 — `cordis.patch.yml` 归属、收敛与迁移设计

- 日期：2026-11-24（修订 2，依 oldfox 二轮复审）
- 工作区：`/Users/qingguee/repo/dsh-opentui-wt-inproc-only`（分支 `research/inproc-only-1124`，HEAD `153c8ce`）
- 性质：设计稿（不实现、不改源码）。实施依据：D1 分段协议、D6 迁移、D8 `/login` 三入口、oldfox 二轮 P0-1…P0-8 与 06 相关 P1。
- 结论先行；规则按 **R0–R29** 编号，可直接照做写代码。引用一律 `文件:行`。
- 实测环境：`node v26.8.1`，宿主 `yaml 2.9.1`（`<dsh>/node_modules/yaml`，`<dsh>` = `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh`）。第 2 章与附录 B 的 yaml 行为全部是本机实测，不是推断；本次修订在 2026-11-24 复测了 R13 与 `- # 注释` 两处。

---

## 修订记录（2026-11-24，依 oldfox 二轮）

| 条目 | 处理方式 | 落地位置 |
|---|---|---|
| P0-1 `.provision.lock` 无整轮互斥 | 重写锁语义：活持有者永不按时间判 stale；等不到即非零退出（不再 SKIP）；补 claim 接管、corrupt 宽限、心跳仅诊断、pid 复用恢复路径；给出分钟级窗口的安全论证 | §0 R14、§6.3.1、§6.4 #1/#7/#8/#10、§6.5、§8.1-37/38、§8.2-11/12 |
| P0-2 与 `dsh plugin add` 抢 `package.json.lock` | 步骤重排（manifest + patch + 侧车合并为一次早期临界区，早于 step 4）+ 等待上限 `PROFILE_LOCK_WAIT_MS`；补「另一个客户端正在装 companion」时的本端行为；锁内容改为宿主可接管的 `${pid}\n` | §0 R7/R15/R16、§6.2、§6.3.2、§6.4 #3/#4、§8.2-13/14 |
| P0-3 R3 值取最后一次与宿主不符 | 重写「有效行值」：逐键 last-wins 折叠，只折叠 name 匹配（或省略 name）的行；name 不匹配的行整行跳过并按外来行处理 | §0 R3/R17、§3.4.1、§4.2、§8.1-19/31 |
| P0-4 R5 与 §3.2 相反 | 保留用户新增：托管 insert 块的模板 entry 权威、用户新增 entry 保留、且用户新增不触发整块重写；同步伪码、写回表、测试 #12 | §0 R5/R18、§3.2、§3.4.2、§3.5、§8.1-12 |
| P0-5 `llm-pi-ai.providers` 归属 | `providers` 子键三方合并（模板 id 权威、用户新增保留、模板 provider 字段级 merge3 + 结构校验回退、用户删模板 provider 恢复）；其余 config 键模板权威；D8-Q1/Q2 写成参数化前置 | §0 R19、§2.4、§5.3.1、§7.2、§7.3、§12（1d 验收口径） |
| P0-6 三客户端写手退役顺序 | 写手盘点补「写入目标是 `DEFAULT_PROFILE`、改名后会切到 provisioner 的 patch」；门禁与退役必须先于改名提交；D1/D3/D6 回写建议 | §1.1、§6.1、§7.6、§12 |
| P0-7 迁移源缺 `opentui-inproc` | 新增第二迁移源与叶级抽取清单：`subagent.maxActiveSubagents`、`subagent.maxDepth`、`session-log-deepseek.enabled` 必迁；`permission.defaultPreset` 按模板权威、不迁 | §1.6、§7.2、§7.3、§7.4、§7.6、§8.2-8 |
| P0-8 converge 两处未定义路径 + yaml 钉版 | 补三种 absent 分支（文件、行、config）；`externalCarry` 与 ancestor 语义；`yaml` 精确钉 `2.9.1` + lockfile 同提交 | §0 R12/R21/R23/R25、§4.3.1、§4.5、§4.6、§8.1-27/28/29、§8.2-16 |
| P1 merge3 无「双方都改」 | 明确冲突分支：current 胜 + path 级 WARN（安全边界由模板权威行承担，不靠 carry 冲突裁决） | §4.4.2、§8.1-30 |
| P1 侧车丢失无 path 级 WARN | R10 与 §4.3 一致化：base 未知 → 整文件一次备份 + 逐 path WARN；权威行同样列 path | §4.3.3、§4.6.3、§0 R10/R29 |
| P1 R13 无效 | 空行必须加在**模板自带首注释之后**（注释块与首行之间）；实测复现并给出正确形态；补 `preamble` 修复规则；锚测试必须同提交更新 | §0 R13、§2.2、§3.4.3、附录 B.7、§8.1-35、§12 |
| P1 `- # 注释` 与 `id:` 异行 | 加 R9 结构断言：dash 与首个节点必须同一逻辑行，否则 fatal，不写 | §0 R28、§3.3、§8.1-36、附录 B.8 |
| P1 §8.2-6 判据不准 | CI 判据改为「宿主全部写手并集」（settings、`/plugin` 开关、`/model` 保存、sanitize），并补写手盘点 | §0 R26、§6.1、§8.2-6、§8.2-15 |
| P1 写手并集（衍生） | `/plugin` 的 `disabled` 写手必须被 carry，否则每轮被模板覆盖 → 新增 R20 与算法 | §0 R20、§5.3.2、§8.1-34 |
| P1 pid 复用 | 明说不可接管、不自动删锁、失败文案与人工恢复步骤；修正原文「不永久卡死」的错误表述 | §6.3.1、§6.4 #8、§6.5、§10.1 |
| P1 锁复刻缺 claim | `profile-lock.mjs` 必须复刻 claim 文件、`${pid}\n` 记录与 ESRCH 接管 | §0 R15、§6.3.2、附录 A |
| P1 语义相等行不移动 | 明确不移动及其后果（insert 挂载顺序、同一 id 只保留一个适用行、reset 后行移到 EOF） | §0 R27、§3.4.4、§10.1 |
| P1 `agent-default-model` 整行 all-or-nothing | 引入 carry 组原子性：provider/model/reasoningEffort 要么整组 carry，要么整组回模板 + WARN | §0 R22、§5.4、§8.1-25 |
| P1 carry 行 name 写法 | 渲染行始终写模板 `name`（含引号风格）；缺 name 补上；不采用不匹配的 name；并加「模板 name 与组合树 entry name 一致」的集成断言 | §0 R24、§3.4.5、§8.2-15 |
| P1 `permission.presets` 非 volatile | 事实修正：只有 `defaultPreset` 是 volatile；`presets` 只能手改 patch，整块 carry 覆盖、无害 | §1.4、§5.2 |
| **自审发现的语义错误** | 原 §4.3 把 `base` 定义为「上一轮写出的投影」：用户设 `maxDepth=2` 被写出后，下一轮 `current==base` 会判「未改」并回模板 1，**用户值每轮被重置**。修正为 `ancestor = 上一轮采用的模板投影`（oldfox P1「双方都改」的措辞也隐含此语义） | §0 R1、§4.3.1、§4.4、§8.1-7/21 |

规则变更汇总：**重写** R3、R5、R7、R11、R13；**新增** R14–R29；**未删除编号**，但备份枚举里的 `first-convergence` 并入 `base-unknown`（§4.6.3）。

---

## 0. 结论先行（规则表）

| # | 规则 | 一句话理由 |
|---|---|---|
| R0 | **归属按「身份」判定，范围按「字节位置」落地**：托管 = 模板顶层 row-id 集合 ∪ 模板 `- insert:` 的嵌套 id 集合；其余全部（注释/空行/外来行）是用户区。 | 只按位置会被宿主重排/折行破坏；只按 id 无法保留原字节。 |
| R1 | **不用字节比较判「没被改过」**。判据是三方：`ancestor`（上一轮 provisioner **采用的模板投影**，落在侧车 `.patch-ownership.json`）、`current`（文件里的有效值）、`next`（新模板投影）。 | P0-1：宿主 `parseDocument → String` 必然改变字节。`ancestor` 必须是模板投影而不是写出的结果，否则用户值会被下一轮重置（见修订记录「自审发现的语义错误」）。 |
| R2 | **写回只替换托管行的节点字节区间**（yaml node `range`），用户区逐字节原样拼接；不做整文件 YAML round-trip。**唯一例外**是 R13 的 preamble 空行修复（只插入换行，不改写既有字节）。 | config-editor 的 reset 会删掉行并带走 `commentBefore`（`dsh-config-editor/src/index.ts:119-126`），我们没有第二次机会保留用户字节。 |
| R3 | **有效行值 = 逐键 last-wins 折叠**：按文件顺序，只折叠 `name` 匹配（或省略 `name`）的行，行内每个顶层键覆盖前值；`config` 是一个键，整块替换。写回时**位置保留第一个适用行**，其余适用行删除并备份 + WARN。 | 宿主是逐键 `target[key]=value`（`cordis-plugin-include/src/patch.ts:102-105`）；后行没有该键时前行仍生效；`name` 不匹配的行运行时整行跳过（`patch.ts:97-100`）。 |
| R4 | **托管行缺 `config` 时不允许被静默吞掉**：`/settings` 的写面是「整份 config」（`dsh-settings/src/index.ts:411-421`），carry 必须按「整块 config 三方合并」，不是叶白名单。 | P0-2：只补 3 个字段必然继续丢值。 |
| R5 | **carry 只对 carry-enabled 行（§5.2 的 `ROLE`）开放**；模板权威行的差异一律 drift → `.bak` + path 级 WARN + 覆盖；**托管 insert 块不适用「权威行覆盖」**，按 R18 的 entry 级规则处理。 | 保住 `maxDepth:1`、模型表、`tool-*` 开关的模板权威，同时不吞用户值、不删用户新增 entry（P0-4）。 |
| R6 | **写权收敛为两类**：启动期 provisioner（托管段）+ 运行期宿主（托管行内的用户值与 `disabled`）。客户端 3 个 patch 写手必须退役，且**先于 profile 改名提交**。 | 今天实际有 6 个写手（§1.1）；改名后客户端写手会从旧 profile 切到 provisioner 的 patch。 |
| R7 | provisioner 必须拿**宿主同一把锁** `profiles/<p>/package.json.lock`；`manifest + patch + 侧车` 在**同一次**锁获取内、且**早于 step 4（companion 安装）**；等待有上限，超时非零退出。 | P0-2：宿主整段 pnpm 期间持锁（`dsh-plugin-manager/src/operations.ts:602-608`），「毫秒级临界区」只对 provisioner 成立。 |
| R8 | **语义无变化就不写**；写只在以下之一成立时发生：托管行/块语义变化、缺行、重复 id、retired id、preamble 缺失/过期/未分离（R13）。 | 宿主重写后字节永不等于模板（P0-1），字节比较会每次备份+覆盖。 |
| R9 | 解析失败/结构异常 ⇒ **不写 + 失败退出**（不是覆盖），并给出 `line:col`。结构异常包含 R28 的三条断言。 | 覆盖会毁掉用户区唯一副本；宿主自己也会 sanitize（`dsh-app-boot/src/profile-sanitize.ts:15-40`）。 |
| R10 | 备份只在五类事件发生：`duplicates`、`foreign-comments`、`drift`、`new-managed-row`、`base-unknown`。每轮最多一个 `.bak`，并附**逐 path** 的 WARN。 | D1：不做「每次 WARN 覆盖」；当前每轮 `.bak` 的根因是字节比较。 |
| R11 | **迁移按叶路径白名单抽取，禁止整行搬运**；对两个迁移源（`opentui`、`opentui-inproc`）统一禁止 `permission` 整族、`llm-pi-ai`（含 `providers`）、append preset。 | P0-4/P0-7：patch 合并是 `target[key]=value` 整块替换（`patch.ts:102-104`）。 |
| R12 | 新增 `yaml` 作为 shell 包**运行时依赖**，版本见 R25（精确 `2.9.1`）。 | 需要 `range`/comment/折行语义；不能用正则近似 YAML。 |
| R13 | **preamble 修复**：模板自带首注释（`# model route …`）之前是两行 header；**空行必须插在「整个首注释块」与首个 `- ` 之间**，不是插在 header 与模板注释之间。 | 实测：注释块与首行之间没有空行时，整块是 `commentBefore`，`document.delete(0)` 后 `# profileRevision` 与模板注释一起消失（附录 B.7）。 |
| R14 | **`.provision.lock` = 整轮互斥**：活持有者**永不**按时间判 stale；等不到就非零退出（不 SKIP、不启动宿主）；接管必须走 claim；pid 复用不接管。 | P0-1：首启迁移 + 10 companion 是分钟级窗口，第二个窗口不能带半成品启动。 |
| R15 | **`package.json.lock` 复刻宿主协议**：内容是 `${pid}\n`（不是 JSON）、`wx` 创建、`ESRCH` 才接管、接管走 `<lock>.takeover-<sha256(record)[0:16]>` claim 文件。 | 宿主的 `holderExited` 只认 `/^\d+\n$/`（`dsh-atomic-write/src/index.ts:112-127`）；claim 防止两个 contender 同时判死锁而双持（`index.ts:150-178`）。 |
| R16 | **写序与等待上限**：profile 文件临界区早于 step 4；`PROFILE_LOCK_WAIT_MS` 默认 120s；写后用 re-read 校验，被无锁写手覆盖 → WARN、跳过侧车、exit 0，下轮收敛。 | P0-2 + 宿主 `/plugin` 开关写手不持锁（`dsh-plugin-manager/src/patch.ts:25-78`），只能靠「写后校验」暴露。 |
| R17 | **有效值算法**（R3 的可执行形式）与 **name 不匹配行的处置**：整行跳过、按外来行保留、不删、不参与重复计数、WARN 一次。 | P0-3。 |
| R18 | **托管 insert 块**：模板声明的 entry id 权威（逐 entry 判等，差异 → 模板值 + WARN）；用户新增 entry **保留**；用户新增**不触发**整块重写；块需要重写时才重建（模板 entry + 用户 entry 追加在后）。 | P0-4：§3.2 的「保留用户新增」与 R5 的「权威行覆盖」必须二选一，本文选保留。 |
| R19 | **`llm-pi-ai.config.providers` 子键三方合并**：模板 provider id 权威；用户新增 provider 保留；模板 provider 走字段级 merge3；结构校验失败整 provider 回模板。`llm-pi-ai` 的其它 config 键模板权威。 | P0-5/D8：不合并则用户路由下轮被模板覆盖；用户段写同行会整块替换 `config`，不可行（§5.3.1）。 |
| R20 | **行级 `disabled` 与 role 正交、对所有托管行 carry**（模板值为 `!!js` 的行除外）：`disabled: false` ≡ 缺省；模板 `!!js` 行出现 plain `disabled` → 模板权威 + WARN。算法见 §5.3.2。 | 宿主 `/plugin` 开关写手会写 `disabled`（`dsh-plugin-manager/src/patch.ts:25-78`），不 carry 就每轮打架。 |
| R21 | **迁移 external carry**：只抽取「与源模板默认不同的叶」；`next_eff = applyExt(template)`；`ancestor` 仍存**未加 ext 的模板投影**；marker 缺失才生效。 | P0-7/P0-8：既让迁移值首轮生效，又让它之后按「用户改动」稳定存活；不冻结未来的模板默认更新。 |
| R22 | **carry 组原子性**：组内任一叶校验失败 → 整组回模板 + WARN。组由 `CARRY_GROUPS` 声明（`agent-default-model` 三元组、`subagent` 无组、`permission` 无组）。 | P1：`provider` 有效但 `model` 已被删时，不能只 carry 一半。 |
| R23 | **三种 absent 分支不得绕过 external carry**：文件不存在、托管行不存在、托管行的 `config` 不存在，均有显式规格（§4.6.2）。 | P0-8：原伪码在 `currentText` 缺失时直接返回整模板，正是首启迁移路径；行缺失时 `current` 未定义。 |
| R24 | **渲染行的 `name` 规则**：始终写模板 `name`（同一引号风格）；当前行缺 `name` 而模板有 → 补上（算语义变化，一次重写）；当前 `name` 与模板不同 → 该行不适用（R17），不采用其 `name`。 | P1：`name` 决定 patch 行是否被宿主应用（`patch.ts:97-100`），不能随手丢或改。 |
| R25 | `yaml` **精确钉 `2.9.1`**（不是 `^2.9.1`），`pnpm-lock.yaml` 必须同提交更新。 | 发布后范围重解析会换版本；`pnpm install --frozen-lockfile`（`.github/workflows/ci.yml:172`，oldfox 记的 169-170 是同一 job 的邻近行）会红。 |
| R26 | **CI 判据 = 宿主全部写手的并集**：`settings.describe()` ∪ `/plugin` 可达 entry ∪ `/model` 保存 ∪ sanitize；每个托管 id 必须在 `ROLE` 里，且 `authority` 行的 plugin Config **没有 volatile 字段**（用 schema 判定，否则失败）。 | P1：`agent-default-model` 走 `saveSelection`（`dsh-agent-default-model/src/index.ts:82-97`），`settings.describe` 盖不到。 |
| R27 | **语义相等行不移动**；只有缺失块按模板顺序追加到 EOF。后果（insert 挂载顺序、reset 后行移到 EOF）必须在文档写明。 | P1：移动会改 insert 挂载顺序，收益为零。 |
| R28 | **结构断言**（fatal，不写）：① 顶层 span 单调不重叠；② `lineStart(range[0])..range[0]` 必须含 `-`（`- # 注释` 与 `id:` 异行 → fatal）；③ 顶层缩进前缀必须是纯空白。 | P1：`- # 注释` 异行时替换会留下 null 序列项，loader 对 entry id 的处理直接抛错。 |
| R29 | **备份与 WARN 的 path 级一致性**：任何备份必须附 `paths[]`（`<id>.<path>: current → expected`），标量值截断到 80 字符；侧车丢失、权威行差异、新托管行同一套格式。 | P1：原 §4.3 的「权威行不备份、不报 path」与 R10 矛盾；没有 path 的 WARN 无法排查。 |

---

## 1. 现状盘点（读到的关键事实）

### 1.1 写手盘点：实际 6 个 + 1 个删除者

| 写手 | 何时写 | 写法 | 持 `package.json.lock` | 证据 |
|---|---|---|---|---|
| provisioner | 每次客户端启动，宿主 spawn 之前（同步 `spawnSync`） | 整文件从内嵌模板重写；3 字段行级 merge | 否（新增，见 §6.3） | `packages/shell/bin/dsh-opentui.mjs:310-319`（provision）→ `:490-527`（host pre-launch）；`provision-inproc-profile.mjs:1283-1322` |
| 宿主 config-editor（`settings.mutate`、`agentDefaultModel.saveSelection`、其它 `edit` 调用方） | 运行期 `/settings`、`/model` 写 | `parseDocument` → 改 AST → `String(document)` 整文件重写 | **是**（`dsh-config-editor/src/index.ts:93`） | `dsh-config-editor/src/index.ts:93,105-141`；`dsh-agent-default-model/src/index.ts:82-97` |
| 宿主 plugin-manager `writePluginEnabled` | 运行期 `/plugin` 启用/禁用 | `parseDocument` → 改 `disabled` / 删仅剩 id+disabled 的行 → 整文件重写 | **否**（只有 `hmr.runExclusive`，`dsh-plugin-manager/src/index.ts:1312-1316`） | `dsh-plugin-manager/src/patch.ts:25-78`；调用 `index.ts:928-939` |
| 宿主 `sanitizeProfile` | 启动恢复路径 | `renameSync` 把 patch 挪走（等价于删除） | 调用方负责排他（模块注释） | `dsh-app-boot/src/profile-sanitize.ts:15-40` |
| 客户端 `LocalSettingsStore.mutate` | 宿主不可用时的 local-file 模式（seam 已拒绝，但代码仍在） | 行级写托管行 | 否 | `packages/shell/src/client/local-config-faces.ts:283-316` |
| 客户端 `LocalLoginFace.registerRoute` | `/login` 注册 provider 路由 | 行级改 `llm-pi-ai.providers` | 否 | `local-config-faces.ts:668-708`；接线 `bridge-session-seam.ts:1585` |
| 客户端 append-system sync | 客户端 lifecycle 启动 | **注释 marker 管理的 insert 块** | 否 | `packages/shell/src/client/append-system.ts:310-339,349-360,382`；调用 `lifecycle.ts:1103` |

后三个客户端写手今天写的是 **`DEFAULT_PROFILE='opentui'`**（`lifecycle.ts:91`；`local-config-faces.ts:14`；`bridge-session-seam.ts:2273,2290`）。改名之后同一份代码会把目标切到 provisioner 的 inproc profile，所以 **R6 的退役必须先于改名提交**（P0-6）。

`plugin_manager.runPluginCommand` 本身不写 patch，但它在整段 pnpm 期间持 `package.json.lock`（`dsh-plugin-manager/src/operations.ts:602-608`；CLI `dsh plugin add` 的等待上限是 120s，`dsh/src/plugin.ts:89`）。

### 1.2 宿主写的是什么、写在哪

- `configEditor.edit()` 先 `readFile`，再用 `yaml.parseDocument(before, { customTags: js })`，改完 `writeFileAtomic(path, String(document), { mode: 0o600 })`（`dsh-config-editor/src/index.ts:105-141`）。
- 目标行查找：`findLastIndex(item isMap && getIn([i,'id']) === entry.id && !item.has('insert') && (!item.has('name') || name 相同))`（`index.ts:116-118`）→ **同 id 的最后一行**。
- 若 `next` 与 `inherited` 深相等：**遍历所有顶层同 id 的非 insert 行**，删除 `config`，只余 id/name 时整行删除（`index.ts:119-126`）。注意它不按 `name` 过滤删除范围。
- 否则没有该行就 `document.add({id, name, config})`（**追加到文件末尾**，`index.ts:126`）；有则 `setIn([index,'config'], createNode(next))`（`index.ts:127`）。
- 写前自检「是否被 home patch/命令行覆盖」：`isDeepStrictEqual(effective.config, next)`，否则抛错（`index.ts:134-140`）。
- 失败回滚：把 `before` 写回（`index.ts:144-147`）。
- `configuration()` 的 `overridden` 集合 = 任意「同 id、非 insert、带 `config`」的行（不看 name），`inherited()` 先把目标层的 `config` 剥掉再组合（`index.ts:58-64,66-99`）。这两处只影响表单基线，不影响落盘值，但解释了为什么「同 id 多行」会让表单与运行时不一致。

结论：**宿主只写托管行，但它重写整份文件**。它是格式归一化器，不是归属者。

### 1.3 模板与当前 merge 的缺陷

- 模板 16 个顶层块（`provision-inproc-profile.mjs:194-644`）：`llm-pi-ai`、`tool-bash`、`tool-todo`、`tool-fs`、`tool-fs-search`、`agent-instructions`、`tool-result-pruner`、`insert: tool-ask-user`、`tool-web`、`permission`、`insert: dsh-opentui-approval-gate`、`insert: mcp-context7`、`agent-default-model`、`subagent`、`insert: dsh-opentui-session-shim + session-controller`、`session-log-deepseek`。
- 现有 merge 只处理 3 个叶（`patch-runtime-merge.mjs:75-210`），由 `provisionPatch()` 在 `:1266`（import）与 `:1297`（调用）接入；且是**行级正则**；模板 `!!js`、折行、注释放到以后都会让它误判。它在本设计里被 converge 取代（阶段 1b 退役）。
- `provisionPatch()` 的幂等判据是 `current === nextContent`（`provision-inproc-profile.mjs:1299`）——字节比较；备份判据是 md5 白名单（`:1308-1315`）；写前先 `renameSync(patchPath, backupPath)` 把活文件挪走（`:1310-1313`），**rename 与写入之间崩溃会丢文件**。
- `PATCH_REVISION` 只是模板 hash（`:648`），被当作「本轮已收敛」的标记用（`:1292,1299`）。
- `PATCH_HEADER` 由 `PATCH_HEADER + PATCH_TEMPLATE` 在运行时拼成（`:649-650`），所以**源码里 header 不进模板字面量**；R13 的空行位置必须按输出文本考虑，不是按源码行。

### 1.4 宿主可写面（settings）

- settings 服务把「改动」合并进**整份 config**：`mergeLayers(strip(raw, form), next)`（`dsh-settings/src/index.ts:411-421`）。`strip` 保留非 volatile 的原字段（如 `session-log-deepseek.maxBytes`），`next` 来自表单投影（`:397`）。
- `mergeLayers` 对 plain object 是**深合并**，数组整体替换（`dsh-settings/src/index.ts:166-186`）。
- 因此每次 `/settings` 写都会把该行的**完整 config**（volatile 字段 + 原非 volatile 字段）落盘。carry 必须是「整块 config」，叶白名单会漏掉 `presets`、`maxBytes` 这类字段。
- seam 的 `/settings` 白名单是 3 命名空间 / **5 字段**：`subagent.{maxActiveSubagents,maxDepth}`、`permission.{defaultPreset,presets}`、`session-log-deepseek.enabled`（`packages/shell/src/client/bridge-settings-route.ts:26-31`、`local-config-faces.ts:52-66`）。
- **事实修正（P1）**：`permission.presets` **不是** volatile，只有 `defaultPreset` 是（`dsh-permission-presets/src/index.ts:158-192`）。`settings.mutate` 会拒绝非 volatile 路径（`dsh-settings/src/index.ts:400-410`、`isVolatilePath` 于 `dsh-settings/src/schema.ts:74-84`），所以 `presets` 今天只能手改 patch。它是用户数据，整块 carry 覆盖它，无害；D1 的 carry 起点仍应包含它。
- 客户端 local-file 模式拒绝写：`bridge-session-seam.ts:1458-1483`（`#settingsSource !== 'host'` 直接返回 `ok:false`）。

### 1.5 其它相关事实

- 宿主 watches 该文件并在变化时重载：`dsh-hmr/src/index.ts:385,406`（`patchFiles = [profile.patchPath, join(profile.home, PROFILE_PATCH_FILENAME)]`）。
- patch 层顺序：bundle patches → profile patch → **home patch**（`$DSH_HOME/cordis.patch.yml`）→ overlays（`dsh-app-boot/src/profile-context.ts:74-86`）。home patch 会赢过 profile patch；此时宿主写会被 `index.ts:134-140` 拒绝。
- patch 应用是逐键 `target[key] = value`（`cordis-plugin-include/src/patch.ts:102-105`）；`config` 是**一个键**，所以同 id 的后一行带 `config` 会**整块替换**前一行的 config，而不是深合并；`insert` 先建 entry、后建 entryMap（`:63-95`）；`name` 不匹配就整行跳过（`:97-100`）。
- 组合入口 `composeEntries` 走同一套 `applyEntryPatches`（`dsh-app-boot/src/profile.ts:755-762`），所以“整块替换 config”对 bundle 层同样成立。
- `configEditor.entries()` 只返回**唯一 id** 的 entry（`dsh-config-editor/src/index.ts:58-64`）：两个同名 insert 会让该 id 永远不可达。
- `llm-pi-ai.Config` 只有 `providers` 一个键且整块 volatile（`dsh-llm-pi-ai/src/config.ts:383-385`）；provider id 若要用宿主凭据 record，必须匹配 `^[a-z][a-z0-9-]*$`（`dsh-credentials/src/index.ts:19-22,69-76`；`dsh-llm-pi-ai/src/auth.ts:143-170`）。
- 宿主也有「备份 + 丢弃全部 patch」的恢复路径 `sanitizeProfile`（`dsh-app-boot/src/profile-sanitize.ts:15-40`），所以我们解析失败时更不能覆盖。

### 1.6 两个迁移源的现场（P0-7）

**源 A：`~/.dsh/profiles/opentui/cordis.patch.yml`**（550 行 / 19916B，老 HTTP profile）
顶层块：`llm-pi-ai`(:2)、7 个 tool 行(:306-336)、`insert: tool-ask-user`(:346)、`tool-web`(:353)、`web`(:362)、`permission`(:365, `defaultPreset: danger-full-access`)、`insert: mcp-context7`(:381)、`ui-settings-general`(:388)、`agent-default-model`(:392, `opencode-go`/`deepseek-v4.1-flash`/`high`)、`insert: preset-opentui-append-system + 6 个嵌套插件`(:401-546)、`subagent`(:547, 只有 `maxActiveSubagents: 3`，**无 maxDepth**)。无 `session-log-deepseek` 行。

**源 B：`~/.dsh/profiles/opentui-inproc/cordis.patch.yml`**（15442B，0.27.x 的 inproc profile，**本次新增的迁移源**）
- 顶层块与模板同构（`llm-pi-ai`:4、`tool-bash`:302、`tool-todo`:305、`tool-fs`:317、`tool-fs-search`:322、`agent-instructions`:327、`tool-result-pruner`:332、`insert: tool-ask-user`:342、`tool-web`:349、`permission`:355、`insert: approval-gate`:380、`insert: mcp-context7`:393、`agent-default-model`:400、`subagent`:418、`insert: shim+controller`:440、`session-log-deepseek`:453）。
- `permission.defaultPreset` 是模板的 `!!js process.env.DSH_OPENTUI_APPROVAL_GATE === 'off' && …`（:370）——**不是用户值**。
- `subagent` 是 `maxActiveSubagents: 3` + `maxDepth: 1`（:421-422）。
- `session-log-deepseek.enabled: true`（:456）。
- `agent-default-model` 与当前模板逐字相同（`opencode-go`/`deepseek-v4.1-flash`/`high`）。
- `providers` 只有模板声明的 3 个 id（`zai-coding-cn`、`xiaomi-token-plan-cn`、`opencode-go`）；今天 `registerRoute` 写的是 `DEFAULT_PROFILE`，**够不到这个 profile**，所以这里出现的额外 provider 只可能是手工编辑。
- 文件头**没有** R13 要求的空行（第 1-3 行是 header + 模板首注释，第 4 行就是 `- id: llm-pi-ai`）。这意味着今天宿主任何一次 `delete(0)` 都会把 header 一起删掉。

---

## 2. 约束与假设

### 2.1 硬约束（来自评审/决议）

1. 托管段必须能被宿主整文件重写后继续识别（P0-1）。
2. 用户配置必须活过下一轮 provision（D1）。
3. `/settings` 与 `/model` 写的是托管行；用户段解决不了它（P0-2/P0-5）。
4. 迁移不得放宽沙箱、不得整块替换模型表、不得制造重复 insert（P0-4/P0-7）。
5. 改名必须最后提交；客户端写手退役与门禁必须先落地（P0-6）。
6. `.provision.lock` 必须是整轮互斥，活持有者不按时间失效（P0-1）。

### 2.2 由实测得到的补充事实（影响设计）

- 宿主重写：`!!js` 保留但长行按 80 列折行；行尾注释被规范成单空格；CRLF→LF；连续空行被压缩；BOM 被丢弃（附录 B）。
- **首行删除的注释归属（本次复测）**：
  - `# h\n# rev\n# model route:\n- id: a` → 三行注释全在 `item0.commentBefore`，`delete(0)` 后全部消失。
  - `# h\n# rev\n\n# model route:\n- id: a` → 仍然全在 `commentBefore`，**同样全部消失**（空行插在 header 与模板注释之间不行）。
  - `# h\n# rev\n# model route:\n\n- id: a` → 整块成为 `document.commentBefore`，`delete(0)` 后**全部存活**。
  - ⇒ R13 的空行必须加在「模板自带首注释之后」。
- `- # 注释` 与 `id:` 异行时，`item.range[0]` 落在 `id:` 行，`lineStart(range[0])..range[0]` 只有缩进、没有 `-`（附录 B.8）。按设计替换该 span 会留下悬空 `- # 注释` 的 null 序列项，loader 侧 `entry.id` 直接抛错。
- 语义上折行只发生在空格处，重新解析回原字符串；所以「折行」只影响字节，不影响值（B.4）。

### 2.3 本文的本地待澄清问题（按推荐答案继续设计）

| # | 问题 | 推荐答案 | 理由 |
|---|---|---|---|
| L1 | D2 的 `dsh-approval-policy` 是否写成模板顶层行？ | **是**，追加在模板末尾（`session-log-deepseek` 之后），`config: { windowSeconds: 300 }` | 只有顶层行才能进入 carry；宿主首次写会自己造一个顶层行，与其让它不可控，不如模板声明 |
| L2 | `agent-default-model` 算不算用户值？ | **算**，纳入 carry（R22 的原子组） | 三个字段全 `volatile()`（`dsh-agent-default-model/src/index.ts:51-55`）；宿主 `/model` 可达（`:82-97`） |
| L3 | 是否新增 `yaml` 运行时依赖？ | **是**，精确 `2.9.1`（R25） | 需要 node range/comment/折行；正则方案在 `- insert:` 和多行标量上不可靠；发布后 `^` 会重解析出新版本 |
| L4 | 解析失败是 fail-fast 还是 WARN 覆盖？ | **fail-fast，不写** | 覆盖会毁掉用户区；宿主自身有 sanitize 兜底 |
| L5 | 侧车文件（ancestor 状态）放哪？ | `profiles/<p>/.patch-ownership.json` | 不污染 YAML；宿主不读；丢失时退化到 base-unknown（安全方向） |

### 2.4 参数化前置：D8-Q1 / D8-Q2（未拍板，本文不替用户选）

D8 子票（`tickets/2026-11-24-inproc-D8-login-modes.md:41-56`）有两项待用户拍板：

- **D8-Q1 OAuth 回调载体**：A 只挂官方 `dsh-host-webserver`（127.0.0.1 + 临时端口）；B bridge 新增 `authorization.*` 帧 + 客户端自开回调端口；C 本次只做第三方列表 + 自定义 + key 走宿主凭据。
- **D8-Q2 API key 落点**：A 走 `credentials.set` → `~/.dsh/.credentials.yaml`；B 保留 per-profile `provider-keys.json` + 新宿主读取通道。

本文的依赖关系（写清楚，避免实施时误以为被阻塞）：

| 本文设计 | 依赖 D8-Q1 | 依赖 D8-Q2 |
|---|---|---|
| R19 `providers` 子键合并 | **否**（只看 dict 内容，不看 key 存在哪） | **否**（只关心 `apiKeyEnv` 这个 ref 名，不关心值存哪） |
| R21/§7.3 迁移抽取清单 | **否**（不迁 `providers`） | **否**（不迁 key） |
| 新增 provider 的**写入通道** | 否 | **是**（`06:630` 的「`/login` 只写 provider-keys.json」验收口径作废，见 §12） |
| account 入口是否可用 | **是**（不在 06 范围） | 否 |

一条硬约束先写死：**任何客户端写手都不得直接改托管 patch**（R6）。`providers` 的写入通道只能是 (a) 宿主 settings/credentials 通道（把 `dsh-api-settings-controller` 加进 inproc 组合，08 §5.1），或 (b) 一个**非 patch 的 sidecar**，由 provisioner 在锁内合并（代价：下次启动才生效）。两条都不依赖 Q1。**「在用户段写一条 `- id: llm-pi-ai`」不可行**：patch 的 `config` 是一个键、整块替换（§1.5），用户行的 `config.providers` 会把模板 providers 整块顶掉。这条结论对 D8 §7 的「改造为写用户段」是硬否决，需回写。

---

## 3. 归属模型

### 3.1 三层定义

1. **托管身份集（managed identity）**
   - `M_ID`：模板中所有**非 insert 顶层行的 id**。运行时由 `PATCH_TEMPLATE` 解析得到（不手写列表，避免漂移）。
   - `M_INS`：模板中所有顶层 `- insert:` 块包含的**嵌套 id 集合**（`tool-ask-user`、`dsh-opentui-approval-gate`、`mcp-context7`、`dsh-opentui-session-shim`、`session-controller`）。
   - `R_ID` / `R_INS`：已退役的托管 id/insert id（硬编码常量，初始为空）。模板删行时把 id 挪进来，用于删除遗留块。
2. **托管块范围（managed span）**：命中托管身份的顶层 item，其范围 = `[lineStart(item.range[0]), item.range[2])`。`range` 是 yaml 的字节偏移；`lineStart` 回退到该行行首（含 `- `）。被替换/删除的只有这个区间。**span 含末行换行**（B.5），替换块也必须以换行结尾。
3. **用户区（user region）**：文件里所有**不在任何托管 span 内**的字节。包括：空行、独立注释块、外来顶层行、preamble（除非我们主动更新）、文件尾注释。**永不改写**（唯一例外见 R13/R2）。

> 回答「按 row id 集合还是按位置」：**身份按 id 集合判定，范围按位置（parser 给出的字节区间）截取**。这是唯一能同时满足「宿主重排/折行后仍认得出」和「用户字节不动」的组合。

### 3.2 识别（classify）

对 `doc.contents.items` 每个顶层 item：

```
classify(item):
  if isMap(item) && item.has('insert') && isSeq(item.get('insert')):
      ids = insert.items.map(e => isMap(e) ? e.get('id') : undefined).filter(isString).sort()
      target = item.get('id')                     // insert-into-group 形态
      return { kind: 'insert', key: `insert@${target ?? ''}:${ids.join(',')}`, ids }
  if isMap(item) && isString(item.get('id')) && !item.has('insert'):
      return { kind: 'row', key: `id:${item.get('id')}`, id: item.get('id') }
  return { kind: 'foreign' }
```

匹配规则（不是全等匹配，避免模板增删一个嵌套项就失联）：

- **行**：`id ∈ M_ID ∪ R_ID` → managed；否则 foreign。
- **insert 块**：`ids ∩ M_INS ≠ ∅` → managed，映射到「交集最大」的模板 insert 块（并列取对称差最小者）。`R_INS` 同理用于退役。
- **一个 managed insert 块里出现、模板块没有的嵌套 id：保留**（P0-4/R18）。用户往托管块里加东西属于用户值：
  - 该 entry 不参与判等、不参与重复计数、不因它重写整块；
  - 块因其它原因需要重写时，用户 entry 以 AST 克隆方式**追加在模板 entry 之后**（保持它们的相对顺序）；位置改变要 WARN 一次（`insert-user-entry-moved`）。
- **一个 insert 块里出现 `id ∈ M_ID` 的嵌套 entry：剔除该 entry**，WARN。理由：托管行必须是顶层非 insert 行，否则同一 id 会以两条 entry 出现，`entries()` 直接把它从可寻址集合里剔除（`dsh-config-editor/src/index.ts:58-64`）。
- 两个 current 块同时命中同一个模板块（重复 insert）：视为 `duplicates`，保留第一个，删其余（R3 的位置规则同样适用于块）。

### 3.3 切分（split）与结构断言（R28/R9）

- 用 `parseDocument(currentText, { customTags: [js] })` 拿 AST + `range`；**不做行扫描**（本机实测：块标量里可以有顶格的 `- id: fake`，行扫描会切错；附录 B.5）。
- 断言（任一失败 → 结构异常 → 不写、失败退出、带 `line:col`）：
  1. 所有 span 单调递增且不重叠；
  2. 对每个顶层 item：`head = text.slice(lineStart(range[0]), range[0])` 必须匹配 `/^[ \t]*-([ \t]+#.*)?[ \t]*$/`，即 **`-` 必须与首个节点同一逻辑行**。`- # note\n  id: a` 的 `head` 只有 `"  "` → fatal（附录 B.8），否则替换后会留下 null 序列项，loader 报错；
  3. 顶层缩进前缀（第一个 `- ` 之前的空白）必须是纯空白；非空白 → fatal。
- 空行/注释不在 `range` 内，所以天然被保留。**不要**把 `commentBefore` 并进 span。
- 行尾注释在 `range` 内（实测 `range[2]` 含行尾注释，B.1）；只有在该行被重写时才可能丢失 → 提取该行全部 comment 文本，与模板注释集比对，有外来文本 → 备份 + WARN（`foreign-comments`）。

### 3.4 有效值（R3/R17）与写回

#### 3.4.1 有效行值（P0-3）

宿主对每一条 patch 行做：`id` 必填 → `entryMap.get(id)` → `name` 不匹配整行跳过 → 对行内每个键 `target[key] = value`（`patch.ts:87-105`）。因此：

```
rowsOf(C, id) = [item ∈ C.contents.items | isMap(item) ∧ item.get('id') == id ∧ ¬item.has('insert')]
nameOfTemplate(id) = templateRow(id).has('name') ? templateRow(id).get('name') : ABSENT

applicable(row, id):
  ¬row.has('name')                    → true
  nameOfTemplate(id) == ABSENT        → false        # 无法核对，按外来行处理
  row.get('name') == nameOfTemplate(id) → true
  其它                                 → false        # 宿主整行跳过

E(id) = { keys: {}, present: false, skipped: [] }
for row in rowsOf(id)（文件顺序）:
   if ¬applicable: E.skipped.push(row); continue
   E.present = true
   for (k, v) in row.items: E.keys[k] = v            # 逐键 last-wins
```

由此：

- `E.config = E.keys.config ?? ABSENT`，`E.name = E.keys.name ?? ABSENT`，`E.disabled = E.keys.disabled ?? ABSENT`，`E.extra = E.keys \ {id,name,config,disabled}`。
- 同 id 后一行只写 `disabled`、不写 `config` → 前一行的 `config` **仍然生效**（这是「后行无该键时前行仍生效」）。
- 同 id 后一行带 `config` → 前一行的 `config` **整块被替换**（`config` 是一个键，不深合并）。
- `name` 不匹配的行：`E.skipped`，**保留原字节、不删、不参与重复计数**，WARN 一次 `row-name-mismatch`（带行号）。
- 写回位置：`anchor(k) = 第一个 applicable 行`；其余 applicable 行删除（`duplicates`）。`skipped` 行不参与。

#### 3.4.2 托管行/块的写回去向

输出 = 在 `currentText` 上做**从后往前**的定点替换（保证偏移不失效）：

| 情形 | 动作 |
|---|---|
| 行/块语义等于 expected | 不替换（保留宿主格式、保留位置，R27） |
| 行语义不等（carry/merge/authority） | 用 `renderBlock(expected)` 替换 `anchor` span；删除其余 applicable span |
| 同 id 多次出现 | 值按 R3 折叠；位置保留第一个 applicable 行；其余删除（备份 `duplicates`） |
| 模板有、文件缺 | 追加到 EOF（按模板顺序），连同样本行的**前置注释块**一起追加 |
| `key ∈ R_ID/R_INS` | 删除 span，日志一行 |
| 托管 insert 块（R18） | 模板 entry 逐 id 判等；全部相等且无 `id ∈ M_ID` 冲突 → **不写**；否则整块重写为「模板 entry + 用户新增 entry（追加在后）」 |
| preamble 缺失/修订号过期/首注释块未分离 | 见 3.4.3（R13） |
| 行级 `disabled`（R20） | 与 role 正交：先按 §5.3.2 算出 expected.disabled；`false` 归一化为「不写这个键」；模板 `!!js` 行写模板原值 |

`renderBlock(expected)`：

- 若该行相对模板**没有任何 carry/merge 变化，也没有 ext 变化** → 直接取模板字面量（从模板文本里按同一 row 的 `lineStart..range[2]` 切片），EOL 换成本文件的 EOL。字节级稳定。
- 若有变化 → 克隆模板该 item 的 AST 节点，`setIn(['config', ...])` 写入合并值，剥掉顶层 `commentBefore/comment`（那段注释在用户区已有），`String(doc, { lineWidth: 0 })` 序列化。**绝不**从 JS 值重建整行（会丢 `!!js` 标签）。
- `name`：见 §3.4.5（R24）。
- EOL：用被替换行所在行的 EOL；追加块用文件的主导 EOL；其余字节原样。
- 根缩进：若顶层序列整体带缩进（非本工具产物），记下 `- ` 之前的空白前缀，渲染/追加时按同一前缀重排；前缀含非空白字符 → 结构异常（R9/R28）。
- `!!js`：模板节点的 tag 原样保留；carry **不允许**写入 `!!js` 叶（见 §5.1）。

#### 3.4.3 preamble 修复（R13，P1）

目标形态（输出文本）：

```
# dsh-opentui inproc profile patch — GENERATED by …         ← header line 1
# profileRevision: <hash>                                   ← header line 2
# model route (managed by provision-opentui-profile.mjs …):  ← 模板自带首注释
                                                             ← 空行（必须在这里）
- id: llm-pi-ai
```

`needsPreambleRepair` 为真当且仅当：

1. 文件头的 header 两行缺失或 revision 不等于当前值；或
2. 文件开头存在一段连续的注释块（可跨空行分隔的多段，按 yaml 的 `commentBefore` 归属判定：**首个顶层 item 的 `commentBefore` 非空**）——即注释块与首行之间没有空行。

修复动作（无备份：只插入换行，不丢信息）：

- 情形 1：在文件**最前面**写入 `PATCH_HEADER`（两行，各带换行）。
- 情形 2：在「首注释块的最后一行」与「首个顶层 token」之间插入一个空行。实现上：若 `item0.commentBefore !== null`，取该 commentBefore 的末行对应的原始字节位置（`range[0]` 之前的最后一个非空注释行），在其后插入 `\n`。
- 两件事可以同时发生。修复后重新解析再切分（偏移已变）。

**源码编码与锚测试（必须同提交）**：R13 在模板输出里多一行。两种编码：

- A（推荐）：在 `PATCH_TEMPLATE` 的首注释行后加一个真正的空行 → 源码行数 +1 → `patch-runtime-merge.test.ts:161` 的 `src.slice(565,578)` 锚必须同提交改成新行号（并在 ledger 记录「因 R13 整体 +1」）。
- B（锚不变）：把空行写成首注释行末尾的 `\n` 转义（`…:\n` + 源码换行），不新增源码行；代价是可读性差、后续容易被“整理”掉。

本文选 A；若实施者坚持 ledger 锚零位移，选 B，但必须加一条源码注释说明原因。

#### 3.4.4 语义相等行不移动（R27，P1）

不移动是**规则**，不是遗漏。后果必须写明：

1. **非 insert 行**：不同 id 的行之间顺序对 patch 应用无影响（各自按键合并到自己的 entry）。同 id 多行已在 R3 折叠为一个 applicable 行，顺序影响被消除。
2. **insert 块**：挂载顺序 = 文件顺序（`patch.ts:63-95`：无 id 的 insert 按文件顺序 `push`）。用户若移动了块，挂载顺序与模板顺序不同；本文不纠正。当前模板的 4 个块之间无初始化顺序依赖，块内 `shim → session-controller` 的顺序由模板块保证。风险记为 §10.1。
3. **宿主 reset 删行后**：缺行只能追加到 EOF（R23），该行从此位于文件末尾；对 id-targeted 行无语义影响。被 reset 删除的 **insert 块**追加到 EOF，它与其它块的相对顺序因此可能与模板不同（挂载顺序随之改变）；单块内的 entry 顺序仍由模板保证。
4. **用户把行放到 EOF 之后又改模板**：我们不会把它移回模板位置，只更新内容。

新增测试 #40：语义相等的行/块在写回后位置不变（用带标记的注释块前后夹住）。

#### 3.4.5 渲染行的 `name`（R24，P1）

- 模板行有 `name` → expected 必须包含该 `name`，引号风格与模板一致（优先走模板字面量切片，或 AST 克隆保留 style）。
- 当前行缺 `name`、模板有 → 算一次语义变化（重写该行），补上 `name`。理由：无 `name` 的行会应用到任何同 id 的 entry，范围被放大。
- 当前行 `name` 与模板不同 → 按 R17 视为非 applicable（宿主同样跳过），不采用其 `name`、不删该行。
- 模板行无 `name` → expected 也不写 `name`；当前行若带 `name`，按 `name-unverifiable` WARN 并按 skipped 处理（无法核对 entry 实际 name）。
- 集成断言（R26/§8.2-15）：用 bundle patches + 模板组合出 entry 树，断言每个 `M_ID` 都没有 `name mismatch` 警告。今天模板的 name 与 `dsh-base/cordis.patch.yml` 的 entry name 一致（抽查：`llm-pi-ai`:135-136、`permission`:264-265、`subagent`:363-364、`session-log-deepseek`:43-44、`agent-default-model`:90-91、`tool-bash`:281-283）。

### 3.5 边界用例处理表（必须能应对的 10 类）

| 用例 | 处理 | 依据/实测 |
|---|---|---|
| `!!js` 标签 | 解析时传 `customTags:[{tag:'tag:yaml.org,2002:js', resolve:v=>v}]`；投影为 `{$js: payload}`；比较时 tag 参与；渲染时保留 tag | `dsh-config-editor/src/index.ts:110-113,128-133`；附录 B.1/B.4 |
| 注释（独立行） | 在 `range` 外，永不触碰 | 附录 B.3 |
| 行尾注释 | 在 `range` 内；行被重写则丢失；重写前提取并与模板注释集比对，有外来文本 → **备份 + WARN 列出** | 附录 B.1 |
| CRLF | 分析前保留原文；替换用本行 EOL；比较按解析值；宿主下次写回 LF 属格式归一化，不算用户改动 | 附录 B.2 |
| 长行被宿主折行 | 投影比较前由 parser 还原；折行只插在空格处 → 值不变 | 附录 B.4 |
| 重复 id | 值按 R3 逐键折叠；位置保留第一个 applicable；其余删除；备份 `duplicates` | `index.ts:116-118`、`patch.ts:102-105` |
| 托管 insert 块内用户新增 entry | **保留**；不因它重写整块；块需重写时追加在模板 entry 之后（R18） | P0-4 |
| 同 id 但 `name` 不匹配的行 | 整行跳过、保留、不删、不计数，WARN（R17） | `patch.ts:97-100` |
| `- # 注释` 与 `id:` 异行 | 结构异常 → fatal，不写（R28） | 附录 B.8 |
| 块标量内含顶格 `- ` | parser 给 range，行扫描不可用 | 附录 B.5 |

---

## 4. 语义等价判定与三方合并

### 4.1 为什么不能字节比较

宿主每次 `/settings`、`/model`、`/plugin` 都 `parseDocument → String` 整文件重写：折行长行、CRLF→LF、压缩连续空行、丢弃 BOM、规范化行尾注释空格（附录 B）。因此「当前字节 == 模板字节」永远不成立（P0-1 已实测 3 个 `.bak-*`）。判据必须是**值层**的。

### 4.2 投影（projection）

```
P(node):
  map      -> { key: P(value) }                   // 重复 key => 返回 NEVER_EQUAL 哨兵
  seq      -> [ P(item), ... ]
  scalar:
    tag == 'tag:yaml.org,2002:js' -> { $js: payload }   // payload 已由 parser 折叠还原
    tag == null (core)            -> value               // string/number/bool/null
    other                          -> { $tag: tag, value }
  alias    -> P(resolve(alias))
```

- **不比较**：引号风格、缩进、折行、注释、键序、空行。
- **比较**：值、数组顺序、`!!js` 的存在与 payload、重复 key（直接判不等 → 强制重写）。
- 数字 `3` 与 `3.0` 视为相等（语义等价，允许）。
- `rowEq(a,b) = isDeepStrictEqual(P(a), P(b))`。判定是**全函数**：任何不确定（重复 key、未知 tag、解析告警）都返回「不等」，即偏向重写（安全方向）。
- 行级投影 `RV(row)` 按角色收敛为可比较的形状。**`name`（R24）与 `disabled`（R20）单独判定，不进入 role 值**；role 值只包含其余字段：
  - `carry`：`{ config }`（`config` 缺失 → `ABSENT`）
  - `merge:providers`（`llm-pi-ai`）：`{ providers, restConfig }`（`restConfig` = 除 `providers` 外的 config，逐键比较）
  - `authority`：`{ config, ...extra }`（config/extra 模板所有）
  - 行级相等 = `roleEq` ∧ `nameEq` ∧ `disabledEq`；三者任一不等都算「写」。

### 4.3 侧车（ancestor）——回答「没被用户改过怎么判」

只比较 current 与模板无法区分「用户设成 3」和「旧模板默认就是 3」；后果是模板默认值永远更新不了。因此引入三方：

- **`ancestor` = 上一轮 converge 所采用的模板投影**（`next`，不含 external carry），按角色存（`name`/`disabled` 不进 `ancestor`，见 §4.3.1）：
  - `carry`：`{ config }` 完整投影；
  - `merge:providers`：`{ providers, restSha256 }`（providers 存值，其余 config 存 hash）；
  - `authority`：config+extra 的 `sha256`。
- **`current` = R3/R17 的有效行值**（`E` 按角色投影）。
- **`next` = 新模板该行的投影**；`next_eff = applyExt(next, ext)`（R21）。
- `authority` 行的相等判定是 `sha256(canonical(RV(current))) == state.rows[id].ancestorSha256`；carry/merge 行是 `rowEq(RV(current), ancestor)`。

判定：

```
ancUnknown = (state 不存在 || state 版本未知 || state.rows[id] 不存在)
untouched  = (!ancUnknown && rowEq(current, ancestor))
```

**为什么必须存 `next` 而不是写出的结果**：若存写出的结果，用户设 `maxDepth=2`、我们写出 2 并记 `ancestor=2`，下一轮 `current==ancestor` 会被判「未改」→ 回模板 1，用户值每轮被重置。存模板投影时：`ancestor=1`、`current=2` → 判「改过」→ carry 2，稳定。这是本次修订对原文的**语义修正**（原 §4.3/§4.4 的 `base` 定义有误）。

#### 4.3.1 侧车文件

`profiles/<p>/.patch-ownership.json`（0600，tmp+rename）：

```json
{ "version": 1,
  "templateRevision": "3e0cafa23235d81c",
  "writtenAt": "2026-11-24T09:50:00.000Z",
  "rows": {
    "subagent":        { "role": "carry", "disabled": false,
                         "ancestor": { "name": "@deepseek-ai/dsh-subagent", "config": { "maxActiveSubagents": 3, "maxDepth": 1 } } },
    "permission":      { "role": "carry", "disabled": false,
                         "ancestor": { "name": "@deepseek-ai/dsh-permission-presets", "config": { "presets": { }, "defaultPreset": { "$js": "…" } } } },
    "llm-pi-ai":       { "role": "merge:providers", "disabled": false,
                         "ancestor": { "name": "@deepseek-ai/dsh-llm-pi-ai", "providers": { }, "restSha256": "sha256:…" } },
    "tool-bash":       { "role": "authority", "disabled": false, "ancestorSha256": "sha256:…" }
  } }
```

- `disabled` 存在每个 row 的顶层（R20/§5.3.2），不属于 `ancestor`：它是独立 carry 字段。
- `ancestor` 里不含 `disabled`/`name`；`name` 由模板决定（R24）。
- `version !== 1` → 按 unknown 处理（不猜测）。
- 侧车在 patch 写成功后、同一把锁内写；写失败只 WARN（下次退化为 unknown，安全方向）。
- 侧车**只影响合并方向**，不影响输出值；所有丢失路径都退化为「carry current」。

#### 4.3.2 误判方向（明确）

| 方向 | 触发条件 | 后果 | 可接受性 |
|---|---|---|---|
| 误判成「改过」 | 侧车丢失/损坏；或用户把值改回了上一轮模板默认 | 多 carry 一次旧值 → 新默认不生效；权威行多一次 `.bak` | 可接受：不丢用户值，代价是默认值滞后一个版本 |
| 误判成「没改」 | `current == ancestor` 但用户其实改过（只能是「改成了与上一轮模板完全相同的值」） | 采用新默认，覆盖那个「恰好等于旧值」的选择 | 唯一不可消除的歧义；无法从两个快照区分。已在 §10.3 记为开放问题 |

注意：**绝不会**因为「格式变化」误判成改过——投影不看格式。

#### 4.3.3 侧车丢失的处置（P1/R29）

`state === undefined`（缺失/损坏/未知版本）：

- carry/merge 行：`expected = carryFromCurrent(current, next_eff)`（current 的叶覆盖 next；数组原子；current 新增键保留）。**默认值不更新**。
- authority 行：`expected = next_eff`；若 `current != next_eff`，列 path（这些差异无法归因，可能是用户改的，也可能是旧模板）。
- 备份：整轮**一次** `.bak`，reason=`base-unknown`；`paths[]` 列出所有 `current != next_eff` 的 path（权威行也列）。这与 R10 的「base 未知」备份事件一致，不再有「权威行不备份、不报 path」的例外。

### 4.4 三方合并（merge3）

#### 4.4.1 正常分支

```
merge3(anc, cur, nxt, rowId):
  if eq(cur, ABSENT): return nxt                       # 行/config 缺失由 R23 处理，不走这里
  if anc == ABSENT:   return carryFromCurrent(cur, nxt)
  out = {}
  for path in unionPaths(anc, cur, nxt):               # 逐叶；数组是原子；map 递归
     a = get(anc, path); c = get(cur, path); n = get(nxt, path)   # 缺失 = ABSENT
     if eq(c, a):           out[path] = n               # 用户没动 → 模板（含删除）
     else if eq(n, a):      out[path] = c               # 只有用户动 → 用户
     else if eq(c, n):      out[path] = c               # 双方改成一样
     else:                  out[path] = c               # 双方都改 → 见 4.4.2
  return out
```

- 用户删除的键：`c == ABSENT && a != ABSENT` → `out = ABSENT`（保持删除）；若该 path 在 `REQUIRED_PATHS[rowId]` → 取 n + WARN（当前所有 carry 行都没有 required path，`agent-default-model` 用 R22 的组校验兜底）。
- 类型变化（map→scalar 等）：按冲突处理（current 胜 + WARN）。

#### 4.4.2 双方都改（P1）

- 默认：**current 胜**，WARN `carry-conflict`，带 `rowId`、`path`、`ancestor/current/next` 的截断值（标量 ≤ 80 字符；数组/对象只写 `differs`）。
- 不做「安全叶模板胜」的自动裁决：安全边界由**模板权威行**承担（`tool-*` 开关、`permission` 之外的沙箱配置、模型表都不在 carry 里）；在 carry 行里按值猜测“更安全”会引入不可审计的策略。此决定写入 §10.3 开放问题，若 D1 需要更强姿态可加路径白名单。

### 4.5 迁移外部 carry（R21，P0-7/P0-8）

`externalCarry`（下称 `ext`）是 D6 迁移传给 converge 的一次性输入：

```js
ext = {
  source: 'opentui-inproc' | 'opentui',
  values: { 'subagent.maxActiveSubagents': 2, 'subagent.maxDepth': 3, 'session-log-deepseek.enabled': false },
  dropped: [ { path: 'permission.defaultPreset', reason: 'template-authority' } ],
}
```

规则：

1. **只抽取偏离值**：源值必须与**源侧模板值**不同才进入 `values`（否则是 no-op，不写）。`opentui-inproc` 的源侧模板 = 当前模板；`opentui` 的源侧模板 = 旧模板的文档默认（`subagent.maxActiveSubagents: 3`；`agent-default-model` = `opencode-go`/`deepseek-v4.1-flash`/`high`）。这样 ext 永远不会冻结未来的模板默认更新。**已知局限**：inproc profile 上次是由哪版模板写的我们不知道；源值恰好等于当前模板值时按「未改」处理，属于 §4.3.2 同类固有歧义，不额外猜测。
2. `next_eff = applyExt(next, ext)`：只作用于 carry 行/组；叶级 `setIn`；校验与 carry 相同（`!!js` 拒绝、R22 组校验、模型存在性）。
3. **`ancestor` 存未加 ext 的模板投影**。首轮写出 `next_eff` 后，下一轮 `current(=ext 值) != ancestor(=模板值)` → 判「改过」→ carry current，稳定；不会在第二轮被模板默认顶掉。
4. 生效条件：`<newprofile>/.migration.json` 不存在。marker 存在 → `ext = undefined`。
5. 崩溃重入：若 patch 已写、marker 未写，下一轮 ext 重新计算、`current` 已含 ext 值 → 结果相同（幂等）。
6. ext 校验失败（如模型已不在新表）→ 丢弃该 path，日志 `dropped <path> reason=<code>`，继续。

### 4.6 写/不写判定（完整算法）

#### 4.6.1 主流程

```
converge(templateText, currentText, state, ext):
  T = parse(templateText)                      # 进程内缓存；解析失败 = 构建期 bug，抛错
  tpl = indexTemplate(T)                       # rows、insert blocks、revision

  if currentText == ABSENT:                    # R23-①
     plan = for each template block: expected = applyExt(rowValue(tpl), ext)
     return { write: true, content: renderFull(plan), reason: 'absent',
              backupReason: undefined, paths: [], sidecar: sidecarOf(plan, ancestor=tpl) }

  C = parse(currentText)
  if C.errors: return { write:false, fatal:'parse', diagnostic: linePos }
  if !isSeq(C.contents): return { write:false, fatal:'shape' }

  blocks = split(C, currentText)               # §3.3（含 R28 断言）
  occ = groupBy(blocks, key)

  for k in templateKeys ∪ retiredKeys:
     E[k]        = effectiveRow(k)             # R3/R17：值按逐键折叠
     anchor[k]   = firstApplicableOccurrence(k)
     if applicableOccurrences(k) > 1: duplicates.push(k)

  for each managed row k:
     role  = ROLE[k]                            # carry | merge:providers | authority
     cur   = rowValue(E[k], role)               # ABSENT 行 → ABSENT
     next  = rowValue(tpl[k], role)
     nextE = applyExt(next, ext?[k])            # R21
     anc   = stateRow(k)                        # 角色化：carry/merge 存投影；authority 存 sha256
     {expected, backup, warns} = decide(role, anc, cur, nextE, k)
     expected.disabled = carryDisabled(cur.disabled, anc?.disabled, nextE.disabled, k)   # R20，与 role 正交
     append warns; merge backup reason

  for each template insert block b:
     curBlock = matchBlock(blocks, b)           # 交集最大
     if curBlock == MISSING:      missingBlocks.push(b)
     else if blockDiffers(curBlock, b): rewriteBlocks.push(b)   # R18

  write = missingRows || duplicates || retired || missingBlocks || rewriteBlocks
          || any(k => !rowEq(E[k], expected[k]))
          || preambleNeedsRepair

  if !write: return { write:false, reason:'semantically equal' }
  content = splice(currentText, blocks, expected, missing, duplicates, retired, preamble)
  return { write:true, content, backupReason, paths, carried, drift, droppedComments, warnings,
           sidecar: sidecarOf(expected, ancestorRowValues=tpl) }
```

#### 4.6.2 三种 absent 分支（P0-8/R23）

| 情形 | 规格 |
|---|---|
| **文件不存在**（`currentText == ABSENT`） | 不解析、不备份；`expected = applyExt(模板投影)`；`ancestor = 模板投影（未加 ext）`；`reason='absent'`；写出后写侧车，再写 marker。**不得**像原伪码那样直接 `renderFullTemplate()` 绕过 ext。 |
| **托管行不存在**（`E[id].present == false`） | carry/merge：`expected = next_eff`（模板 + ext）；authority：`expected = next_eff`。**不备份、不 WARN**（§6.5：宿主 reset 删行无内容丢失）。`ancestor` 正常更新为模板投影。 |
| **托管行存在但 `config` 缺失**（`E.config == ABSENT`） | 视为「宿主 reset 成继承」：`expected = next_eff`；`name`/`disabled` 按 R20/R24 处理；不备份。若 `E.extra` 非空（用户加的其它顶层键）→ 按 role 处理（carry：忽略并 WARN `row-extra-key`；authority：丢弃 + WARN `drift`）。 |

#### 4.6.3 备份原因与 path 报告（R10/R29）

优先级（每轮最多一个 `.bak`）：

```
duplicates > foreign-comments > drift > new-managed-row > base-unknown
```

- `base-unknown`：只在 `state === undefined` 时贡献；**一次**，覆盖整文件（§4.3.3）。
- `new-managed-row`：`state` 存在但 `state.rows[id]` 缺失，且该行在文件里已存在（用户区升级为托管）→ `expected = next_eff` + 备份 + 列出被替换的 path。
- `drift`：authority 行 `current != ancestor`。
- `foreign-comments`：任一被重写的行/块含模板之外的注释。
- `duplicates`：同 id 多个 applicable 行 / 同模板块多个命中。
- 返回的 `paths[]` 统一格式：`<rowId>.<dot.path>: <current|ABSENT> → <expected|ABSENT>`，标量截断 80 字符。WARN `warnings[]` 与之一一对应。

`decide(role, anc, cur, nextE, k)` 的定义（就是 4.3.3 + 4.6.2 + 4.4 的组合，写死避免实现漂移）：

| 条件（按顺序） | carry | merge:providers | authority |
|---|---|---|---|
| 行不存在 / `config` 不存在 | `nextE`，不备份 | `nextE`，不备份 | `nextE`，不备份 |
| **无侧车**（`state == undefined`） | `carryFromCurrent(cur, nextE)` + `base-unknown` | `providersMerge(ABSENT, cur, nextE)` + `base-unknown` | `nextE` + `base-unknown`（若 `cur != nextE`） |
| **侧车有、该 row 缺失**（新托管行） | `nextE` + `new-managed-row` | `providersMerge(ABSENT, cur, nextE)` + `new-managed-row` | `nextE` + `new-managed-row` |
| `eq(cur, anc)` | `nextE` | `nextE` | `nextE` |
| 其它 | `merge3`（R22 组校验） | `providersMerge`（§5.3.1） | `nextE` + `drift` |

### 4.7 幂等保证

`converge(converge(x)) == converge(x)`：第二次运行时 `current == expected`、preamble 已修复、ancestor 已更新 ⇒ `write:false`。单测第 20 条（§8.1）强制；带 ext 的场景由第 27 条强制。

---

## 5. carry 清单

### 5.1 规则

1. **carry-enabled 行 = 整块 `config` 三方合并**（不是叶白名单）。凡是该行 plugin `Config` 里有 `volatile()` 字段的，必须进这张表。
2. 模板权威行 = 不做 carry；差异 → drift（备份 + 逐 path WARN + 覆盖）。
3. 新增模板行时，若其 plugin 有 volatile 字段，**同一次改动**必须把它加进 `ROLE`/`CARRY_GROUPS`；CI 用 R26 的写手并集判据兜底（§8.2-6）。
4. carry 校验：必须是 plain map；深度 ≤ 6；序列化 ≤ 64KiB；节点数 ≤ 2000；**current 侧要写入的叶不允许是 `!!js`**（遇到则拒绝该叶 + WARN，模板值胜出）——因为宿主写的是求值后的值，把表达式再塞回去会改变执行语义。`ancestor`/`next` 侧可以是 `!!js`（那是模板表达式，例如 `permission.defaultPreset`），比较时 tag 参与投影即可。
5. 行级 `disabled` 单独按 R20/§5.3.2 处理（对所有托管行生效，与 role 正交）。
6. carry 组按 R22 原子生效。

### 5.2 清单（起点 + 补全）

| 行 id | 角色 | 必存键 | 为什么是用户值 | 证据 |
|---|---|---|---|---|
| `subagent` | carry | `maxActiveSubagents`、`maxDepth` | `/settings` 的委派容量/深度；两者 `volatile()` | `dsh-subagent/src/index.ts:197-198`；seam `local-config-faces.ts:54-56` |
| `permission` | carry | `defaultPreset`、`presets`（**D1 漏项**） | 审批档位与自定义 preset。`defaultPreset` 是 volatile；**`presets` 不是 volatile**（事实修正），只能手改 patch，但仍是用户数据，整块 carry 覆盖它 | `dsh-permission-presets/src/index.ts:158-192`；seam `local-config-faces.ts:57` |
| `session-log-deepseek` | carry | `enabled` + 非 volatile 原字段（如 `maxBytes`） | 用户开关；宿主 `strip()` 会保留非 volatile 原字段并一起落盘，整块 carry 才能原样带回 | `dsh-session-log-deepseek/src/index.ts:59-62`；`dsh-settings/src/index.ts:411-421` |
| `dsh-approval-policy`（D2 新增模板行） | carry | `windowSeconds`、`origins`、`defaultOutcome`、`sessions` | 4 个字段全 `volatile()`；300s 窗口必须活过 provision；`origins/sessions` 是用户白名单 | `<home>/profiles/opentui/node_modules/@aiwayds/dsh-approval-policy/lib/index.js:54-60`；其 patch 行 `- insert: id: dsh-approval-policy` |
| `agent-default-model` | carry（组） | `provider`、`model`、`reasoningEffort` | 3 个字段全 `volatile()`；宿主 `/model` 经 `saveSelection` 写它，**不经过 settings 命名空间** | `dsh-agent-default-model/src/index.ts:51-55,82-97` |
| `llm-pi-ai` | **merge:providers** | `config.providers`（其余 config 模板权威） | `providers` 整块 volatile；`/login` 自定义入口要新增 provider（D8），不合并就下轮被覆盖 | `dsh-llm-pi-ai/src/config.ts:383-385`；`dsh-llm-pi-ai/src/index.ts:138-172` |

`CARRY_GROUPS`（R22）：

```js
CARRY_GROUPS = {
  'agent-default-model': ['provider', 'model', 'reasoningEffort'],
}
```

`ROLE`：

```js
ROLE = {
  'llm-pi-ai': 'merge:providers',
  'subagent': 'carry', 'permission': 'carry', 'session-log-deepseek': 'carry',
  'dsh-approval-policy': 'carry', 'agent-default-model': 'carry',
  // 其余 M_ID：'authority'
}
```

**注意**：`insert` 块里的 entry 不在 `ROLE` 里；它们按 R18 的 entry 级规则（模板权威 + 用户新增保留）。

### 5.3 明确**不** carry / 部分 carry 的行

| 行 | 处理 | 理由 |
|---|---|---|
| `tool-bash` | authority | `disabled: !!js` 是平台开关，不属用户值 |
| `tool-todo` / `tool-fs` / `tool-fs-search` / `agent-instructions` / `tool-result-pruner` / `tool-web` | authority | 无 volatile 字段；模板编码的功能/安全开关 |
| 4 个 insert 块 | R18（entry 级） | 无 volatile 配置；用户新增保留，模板 entry 权威 |
| 退役 id（`R_ID`） | 模板删了就该删 | — |
| `llm-pi-ai` 的 `providers` 之外的 config 键 | authority | 模板没有其它键；用户添加的键丢弃 + WARN `drift` |

#### 5.3.1 `llm-pi-ai.providers` 子键合并（R19，P0-5）

前提事实：`config` 是一个键、整块替换（§1.5），所以**只能**在托管行内合并，不能靠用户段或第二条 `- id: llm-pi-ai`。`/settings` 走 `mergeLayers(strip(raw), next)`，`providers` 是 volatile 整块，`strip` 会把它从 raw 里去掉后整体写回投影——落盘结果仍是完整 dict（`dsh-settings/src/index.ts:397-421`）。

```
providersMerge(P_anc, P_cur, P_next, rowId):
  out = {}
  for id in unionKeys(P_next, P_cur):
    if id ∉ P_next:
       out[id] = P_cur[id]                       # 用户新增：原样保留（含所有字段）
       if id 不匹配 /^[a-z][a-z0-9-]*$/:
           warn('provider-id-unstorable', id)    # 宿主凭据 record 存不下，但路由可走 env
       continue
    n = P_next[id]
    if id ∉ P_cur:
       out[id] = n; warn('provider-restored', id)   # 模板 provider 必须存在
       continue
    c = P_cur[id]
    if P_anc == ABSENT:
       out[id] = n; warn('provider-template-authority', id)   # 未知基线：模板整块权威
       continue
    a = P_anc[id] ?? ABSENT
    if eq(c, a):  out[id] = n                    # 用户没动过这个 provider → 模板整块更新
    else:         out[id] = mergeProvider(a, c, n, id)
  return out

mergeProvider(a, c, n, id):
  m = merge3(a, c, n, rowId='llm-pi-ai', pathPrefix=['providers', id])
      # 逐字段；数组（models/modelOverrides/headers 的值）原子；
      # 双方都改 → current 胜 + path 级 WARN（§4.4.2）
  for k in keys(n):
     if k ∉ m: m[k] = n[k]; warn('provider-shape-restored', id, k)     # 模板声明键必须存在
  if n.api 有值 且 m.api ∉ API_ENUM:              # provider.ts:30-64 的 4 个值
     return n + warn('provider-api-invalid', id)
  if n.models 是非空数组 且 (m.models 不是非空数组) 且 n 无 modelOverrides:
     return n + warn('provider-models-invalid', id)
  return m
```

补充规则：

- **用户改模板 provider 的字段**：按字段级 merge3 保留（`apiKeyEnv` 改 ref 名也算用户值；它只是引用名，不是凭据值）。
- **用户删模板 provider**：恢复模板值 + WARN（模板 provider 是产品承诺的路由）。
- **用户改 `models` 数组**：数组原子，用户改后的整个数组生效；模板对同一数组的更新不会逐项合并（避免删模型又“复活”）。冲突 WARN 写明。
- **用户新增 provider 的 key 落点**：不影响合并（Q2 参数化）。`apiKeyEnv` 只是一个名字；值存哪由 D8-Q2 决定。
- **侧车**：`merge:providers` 行必须存 `providers` 完整投影（不是 hash），否则无法做字段级三方；其余 config 存 hash。
- **迁移**：`providers` 整体不迁（§7.2/§7.3）；`opentui-inproc` 里手工新增的 provider → 丢弃 + `reason=credentials-channel-pending`（Q2 未定，搬过去也拿不到 key）。

#### 5.3.2 行级 `disabled`（R20，P1）

宿主 `/plugin` 的启用/禁用写 `disabled`，不写 config（`dsh-plugin-manager/src/patch.ts:25-78`）。它与 role 正交：

```
carryDisabled(cur, anc, next, id):
  if templateRow(id).disabled.tag == 'tag:yaml.org,2002:js':
       if cur 是 plain boolean: warn('disabled-js-overwritten', id)   # 宿主 /plugin 会覆盖表达式
       return next                                    # 模板表达式权威（例如 tool-bash 的平台开关）
  c = cur ?? false; a = anc ?? false; n = next ?? false
  if c == a: return n                                 # 未改 → 模板
  return c                                            # 用户改过（双方都改也 current 胜 + WARN）
```

- `expected.disabled = false` → **不写这个键**（`false ≡ 缺省`，避免每次渲染出无意义的 `disabled: false`）。
- `expected.disabled = true` → 写 `disabled: true`。
- 侧车在每个 row 上存 `disabled` 的归一化值（§4.3.1）。
- 模板 `!!js` 行（当前只有 `tool-bash`）被 `/plugin` 写成 plain 值 → 模板胜 + WARN；这是「保住平台开关」的代价，与 §10.1-11 同类的用户意图被覆盖。

### 5.4 `agent-default-model` 的附加校验与原子性（R22，P1）

carry 前校验（在组内一起做，任一失败 → 整组回模板 + WARN `carry-group-rejected`）：

1. `provider` 必须存在于 `next_eff.llm-pi-ai.providers` 的 key 集合（注意：`providers` 本身可能被 R19 合并后含用户新增 id；校验用合并后的集合）。
2. `model` 必须存在于该 provider 的 `models[].id`，或该 provider 声明了 `modelOverrides` 且其键包含该 model（`catalog.ts:873-894`）。
3. `reasoningEffort` 若存在，且该 model 的 `reasoningEfforts` 有声明 → 必须是其键之一；未声明 → 原样 carry。
4. 整组要么全部 carry（`provider`/`model` 必在，`reasoningEffort` 可缺省），要么整组回模板。**不允许**只 carry `reasoningEffort` 或只 carry `provider`。

证据：`dsh-agent-default-model/src/index.ts:51-55`（三字段 volatile）、`:82-97`（saveSelection）；`dsh-llm-pi-ai/src/catalog.ts:873-894`（modelOverrides 互斥规则）。

---

## 6. 写权与时序

### 6.1 现状（6 个写手 + 1 个删除者）→ 目标

目标模型：

| 面 | 权限 | 强制手段 |
|---|---|---|
| 启动期 provisioner | **唯一**托管段写手 | 代码归属 + 两把锁 + 本文算法 |
| 运行期宿主 config-editor | 托管行内用户值（config）的**唯一**写手 | `package.json.lock`；客户端只走宿主 |
| 运行期宿主 plugin-manager `writePluginEnabled` | 托管行 `disabled` 的写手 | **无锁**（只 `hmr.runExclusive`）→ R16 写后校验 + R20 carry |
| 运行期宿主 `sanitizeProfile` | 删除整个 patch（恢复路径） | 调用方排他；converge 按 absent 处理（R23） |
| 客户端本地 faces | **不写 patch** | 删除/退役下列写路径 + `no-client-patch-writers` 门禁 |
| 用户手工编辑 | 允许，但只保证用户区存活；托管行内手改按 carry/drift 处理 | 文档写明「edit the script, not this file」 |

必须退役的三个客户端写手（§1.1），**先于改名提交**（P0-6）：

1. `LocalSettingsStore.mutate`（`local-config-faces.ts:287-316`）：local-file 模式必须**只读**。seam 已在 `bridge-session-seam.ts:1458-1483` 拒绝写；把 store 的 `mutate` 删除或改为返回 `ok:false`，杜绝未来接线。
2. `LocalLoginFace.registerRoute`（`local-config-faces.ts:668-708`，接线 `bridge-session-seam.ts:1585`）：改为**不写托管 patch**。新 provider 的写入通道按 §2.4（宿主设置通道或 provisioner sidecar），不是 `registerRoute`。key 的落点按 D8-Q2。注意 `registerRoute` 今天写的是 `DEFAULT_PROFILE='opentui'`，改名后会切到 provisioner 的 patch，所以这条是改名前置条件。
3. `append-system` 的 marker 管理块（`append-system.ts:310-339,349-360`，启动调用 `lifecycle.ts:1103`）：M3 在 inproc 从未生效；marker 方案正是 P0-1 否决的形态。整块退役（保留 `~/.dsh/APPEND_SYSTEM.md` 文件读取能力的不变）。

强制手段（不是安全边界，是代码不变量）：

- 测试：`packages/shell/test/no-client-patch-writers.test.ts` 扫 `packages/shell/src`，只允许 `readFileSync`/`existsSync` 出现，禁止 `writeFileSync|atomicWrite|renameSync` 作用于 `cordis.patch.yml`（白名单：provisioner 脚本目录与 lib）。
- 文档：CONTEXT.md 增补「profile patch 是宿主运行期文件，客户端只读」。**对已有文件的修改以 patch 文本提出，由执行者落地**：

```diff
--- a/CONTEXT.md
+++ b/CONTEXT.md
@@
+## profile patch 归属
+- `profiles/<p>/cordis.patch.yml` 是宿主运行期文件：客户端源码只读，不写。
+- 托管段由 provisioner 在启动期收敛；用户区字节归用户。
+- 运行期写手只有宿主（config-editor 的 `config`、plugin-manager 的 `disabled`）。
```

- 运行时：seam 的 local-file 分支继续诚实拒绝（已有行为，勿回退）。

### 6.2 时序（启动期，P0-2 重排）

```
bin/dsh-opentui.mjs
  ├─ spawnSync(provision-inproc-profile.mjs)   :310-319   ← 同步；非零 → 打印并 exit 1（已实现）
  └─ ensureHost() / host pre-launch            :490-527   ← 之后宿主才读 patch
--repair-bridge 路径                             :223-229   ← 先杀本 home 的 stale 实例，再 provision
```

provisioner 内部执行序（`[n/8]` 是既有盘点标签，**不再等于执行序**）：

```
[1/8] host gate
        └─ 一次 package.json.lock（R7/R16）
             [2/8] manifest（写 package.json）
             [7/8] patch（converge + 备份 + 原子写 + 写后校验 + 侧车）
           释放锁
[3/8] bridge copy（本地 FS）
[4/8] companions（唯一的 pnpm；**不持** package.json.lock，最长 10 分钟）
[5/8] verify（companion 一致性）
[6/8] identity
[8/8] shim（本地 FS）
```

理由（写清，避免实施时又挪回去）：

- manifest 与 patch 的写都在毫秒级，合并为一次锁获取，减少与宿主 `/settings`（默认只等 2s，`dsh-atomic-write/src/index.ts:197`）的接触面。
- patch 不依赖 companion 安装；companion 只改 manifest/node_modules，不改 patch。
- 若 companion 安装被杀，patch 已收敛，下次启动不会看到“半收敛”的 patch。
- **禁止**在 step 4 期间持 `package.json.lock`：否则宿主 `/settings` 会在 2s 后失败，`/plugin install` 会互相等待。

### 6.3 锁协议

#### 6.3.1 `.provision.lock`（整轮互斥，R14，P0-1）

文件：`<profile>/.provision.lock`，0600，JSON 记录：

```json
{ "pid": 12345, "nonce": "8f2c…", "startedAt": 1795…, "heartbeatAt": 1795…, "step": "4/8 companions" }
```

- **获取**：`openSync(path,'wx',0o600)` + `writeSync` + `closeSync`。记录写完后**重读**，`pid+nonce` 相符才算持有（沿用现有做法，`provision-inproc-profile.mjs:815-862` 的意图）。
- **判定 stale（只有两种）**：
  1. 记录可解析，且 `pid` 已死（`process.kill(pid,0)` 抛 `ESRCH`；`EPERM` = 活着）；
  2. 记录**不可解析/为空**，且文件 mtime 年龄 > `LOCK_CORRUPT_GRACE_MS`（默认 1000ms）。宽限期内的空记录视为「持有者正在 create 与 write 之间」，只等待。
- **活持有者永不按时间判 stale**：去掉 `LOCK_STALE_MS` 与 `Date.now()-ts > 30s` 分支（`provision-inproc-profile.mjs:152-155,798-808`）。`heartbeatAt`/`step` 只用于进度提示，不参与接管判定。
- **接管（claim）**：与宿主同构，但 holder 判定用我们自己的 `provisionHolderExited(record)`（JSON 解析 + pid 探活），不是宿主的 `${pid}\n` 版本。
  ```
  record = readRaw(lockPath)
  claim  = `${lockPath}.takeover-${sha256(record).slice(0,16)}`
  writeFileSync(claim, `${pid}\n`, { flag:'wx', mode:0o600 })   // EEXIST → 别的 contender 在接管，等
  if readRaw(lockPath) !== record || !provisionHolderExited(record): 放弃（别人换了新锁）
  unlink(lockPath)
  finally: unlink(claim)（失败无害：claim 只对同一 record 有效）
  ```
- **corrupt 宽限期的竞态为什么不会双持**：获取流程是「create → write → 重读校验（pid+nonce）→ 才开始工作」。一个被调度暂停超过宽限期的持有者，即使锁被别人接管，它写入的是已 unlink 的旧 inode；随后的重读会看到新持有者的记录，校验失败 → 它不进入临界区。即「校验后才工作」是不双持的根。
- **等待**：`PROVISION_LOCK_WAIT_MS` 默认 30000，环境变量 `DSH_OPENTUI_PROVISION_LOCK_WAIT_MS` 可覆盖（0 = 不等待）。退避 50ms→500ms。每 ~5s 打一行「waiting: holder pid=… step=… age=…」。常量集中在一处（`provision-run-lock.mjs`）：`LOCK_CORRUPT_GRACE_MS=1000`、`PROVISION_LOCK_WAIT_MS=30000`；判死/判接管的纯函数 `classifyLock(record, now, pidAlive)` 单独导出，便于单测（#37/#38）。
- **等不到 → 明确失败**：stderr 三行（谁持有、哪一步、怎么恢复），**退出码 2**（与通用失败 1 区分）。launcher 已经在非零时 `exit 1`（`bin/dsh-opentui.mjs:310-319`），不会启动宿主，也就不会带半成品启动。**不再 SKIP 并返回 0**（原 `:1520-1527`）。
- **释放**：`finally` 里只删仍属于自己（`pid+nonce`）的锁；被接管后不删别人的锁（沿用 `:864-874` 的意图，判据换成 nonce）。
- **分钟级窗口为什么安全**：
  - 本客户端的宿主在 provision 结束后才 spawn（`:310-319` → `:490-527`），期间没有任何本客户端宿主读 profile。
  - 另一个窗口要么等到锁（首启 ~1s；带 companion 安装可能到分钟级）要么在 30s 后明确失败；**不会**带半成品启动。
  - 已存在的宿主（单实例 adopt）不拿 `.provision.lock`；它对 profile 的写只有 config-editor（拿 `package.json.lock`）和 `/plugin` 开关（无锁）。前者靠 R7 串行，后者靠 R16 写后校验。
  - companion 安装（可能 10 分钟）**不持** profile 锁，所以宿主 `/settings` 不会被阻塞。
  - 所有 profile 文件写都是 tmp+rename 原子提交，崩溃最多留下旧文件或 tmp，不会留半个文件。

#### 6.3.2 `package.json.lock`（宿主同一把锁，R15，P0-2/P1）

`scripts/lib/profile-lock.mjs` 必须**逐字复刻**宿主协议（`dsh-atomic-write/src/index.ts:197,238-273`）：

- 文件名：`profiles/<p>/package.json.lock`（不是 `package.json` 本身）。
- 内容：**`${process.pid}\n`**，仅此。宿主的 `holderExited` 只接受 `/^\d+\n$/`（`index.ts:112-127`）；写 JSON 会让崩溃后的锁**永远无法被宿主接管**。
- 创建：`writeFile(lockPath, `${pid}\n`, { flag:'wx', mode:0o600 })`（宿主同款，`index.ts:250`）；`EEXIST` = 竞争；`EPERM` 且 `lstat` 确认存在 = 竞争（Windows）。
- 接管：只在记录可解析且 pid 被证明已退出（`ESRCH`）时；走 claim 文件（`index.ts:150-178`），claim 名 = `<lock>.takeover-<sha256(record).slice(0,16)>`，claim 创建后**重读 + 重新探活**，仍成立才 `rm`。
- **pid 复用**：`process.kill(pid,0)` 成功但那是复用了 pid 的无关进程 → 宿主与我们都**永不接管**（`index.ts:226-227` 的注释明确此行为）。见 §6.5 恢复路径。
- 等待：退避 20ms→200ms（与宿主一致）；上限 `PROFILE_LOCK_WAIT_MS` 默认 120000，环境变量 `DSH_OPENTUI_PROFILE_LOCK_WAIT_MS` 可覆盖。超时 → 退出码 2，文案给出持有者 pid、锁路径、以及「另一个窗口的 `/plugin install` 可能正在运行」。
- 释放：`rm(lockPath, { force:true })`（与宿主一致，`index.ts:271`）；若非自己的记录则先 WARN 再删（宿主自己也是无条件删，保持兼容）。
- **锁序**：先 `.provision.lock`，后 `package.json.lock`；**禁止反向**（宿主只拿后者，反向会死锁）。临界区内容：读 patch → converge → 备份（copy）→ 原子写 → 写后校验 → 写侧车；manifest 写在同一临界区内。
- 备份用 `copyFile` 再 rename 覆盖，**不要**先把活文件 `renameSync` 走（原 `provision-inproc-profile.mjs:1310-1313` 的崩溃窗口）。
- **manifest（`package.json`）的写也在同一把锁内**（宿主 reload 以它为同步点）。现在是裸写，且两处都存在「先 rename 活文件再写新文件」的崩溃窗口：step 2/8（`provision-inproc-profile.mjs:1417-1424`）与 companion 清理（`:937-939`）；统一改为「先 copy 备份 → tmp+rename 覆盖」。step 4 的 `dsh plugin add` 自己会写 manifest，那是在它自己的锁内；我们不在它之后重写 manifest。
- mode：`0o600`，与宿主一致（`dsh-config-editor/src/index.ts:141`）。

### 6.4 竞态矩阵

| # | 场景 | 机制 | 结果 |
|---|---|---|---|
| 1 | 两个客户端同启 | `.provision.lock` 整轮串行；第二个等 ≤30s，超时 exit 2 | 不会带半成品启动（P0-1） |
| 2 | 客户端 B 启动时宿主 A 在跑（单例 adopt） | B 的 patch 写在 `package.json.lock` 内；A 的 `/settings` 也拿锁 | 后写者基于前者的结果；B 的侧车记的是模板投影，下一轮把 A 的写识别为用户改动并 carry |
| 3 | 宿主 A 正在 `/plugin install`（持锁整段 pnpm） | B 等 `PROFILE_LOCK_WAIT_MS`（120s）后 exit 2，文案点名 holder | 不静默降级、不无限等 |
| 4 | 宿主 A 的 `/plugin` 开关（**无锁**）落在 B 的写窗口内 | B 写后 re-read 校验：内容 ≠ 自己写的 → WARN `concurrent-write`、**跳过侧车**、exit 0 | 文件是 A 写的完整合法文件；下一轮收敛 |
| 5 | provisioner 写 vs 宿主 HMR reload | rename 原子提交；watcher 只看到旧或新完整文件（`dsh-hmr/src/index.ts:385,406`；`dsh-atomic-write` 模块注释 :1-10） | 无半文件 |
| 6 | provisioner 写 vs 宿主 settings/model 写 | 同一把 `package.json.lock`；宿主在锁内 `readFile`（`dsh-config-editor/src/index.ts:105-111`） | 串行 |
| 7 | 锁持有者崩溃 | pid 死 → claim 接管（`dsh-atomic-write/src/index.ts:150-178,259`） | 一次只有一个接管者 |
| 8 | pid 被复用 | 宿主与我们**都不接管**；provisioner 等到上限后 exit 2，文案给锁路径 + 「确认没有 dsh 在运行后手工删除」 | 不会双持；需人工恢复（§6.5） |
| 9 | `.provision.lock` 空/损坏 | mtime < 1s 等待；> 1s 视为可接管（claim） | 崩溃残留可自愈 |
| 10 | 侧车与文件不一致 | 侧车只影响「合并方向」，不影响输出值；不一致退化为 carry-current | 安全方向 |
| 11 | 非协作写手（老版本/手工） | 锁内：读 → converge → **写前再读一次**并与输入比对；不一致 → 丢弃结果重跑一次（最多 1 次）；仍不一致 → 放弃 + WARN，下轮重试（写后校验兜底） | 不覆盖未知写入 |
| 12 | 宿主 sanitize 删了 patch | 文件缺失 → R23-①，写整模板（+ext） | 自愈 |

### 6.5 失败处理

| 失败 | 行为 |
|---|---|
| 解析失败 / 顶层不是 sequence | **不写**；stderr 打 `file:line:col` + 原文片段；退出非零（R9） |
| span 重叠/越界 / `- #` 异行 / 根缩进非空白 | 同上（结构异常，R28） |
| `.provision.lock` 超时（活持有者） | 退出码 2；三行文案：holder pid + step + age；锁路径；「确认没有 provisioning 在运行后可删除该锁；pid 可能被复用」 |
| `.provision.lock` pid 复用 | 同「超时」；**不自动删锁**。`--repair-bridge` 只能杀掉本 home 的客户端/宿主，杀不掉复用 pid 的无关进程 |
| `package.json.lock` 超时 | 退出码 2；提示另一个窗口可能在 `/plugin install`，稍后重试 |
| 写后校验发现外来写 | WARN `concurrent-write`；跳过侧车；退出 0（文件是宿主写的合法内容） |
| 备份失败 | 不写（备份是前置条件），退出非零 |
| 原子写失败 | 删除 tmp；原文件不动；退出非零 |
| 侧车写失败 | patch 已写成功；WARN；下次按 base-unknown 处理 |
| 模板 hash 变化但语义无变化 | 仅更新 preamble（一次/版本） |
| 托管行被宿主 reset 删除 | 下轮重新追加（不备份、不 WARN——无内容丢失） |
| home patch 覆盖托管行 | provisioner 只 WARN 一次；宿主写会被 `dsh-config-editor/src/index.ts:134-140` 明确拒绝（不是静默） |

---

## 7. 迁移转换规格（P0-4 + P0-7）

原则：**迁移按「叶路径」抽取，不按「行」抽取**。patch 合并是 `target[key]=value` 整块替换（`patch.ts:102-105`），任何整行搬运都可能把沙箱/模型表翻回去。

### 7.1 文件级

| 项 | 迁/不迁 | 理由 |
|---|---|---|
| `profiles/opentui/config.json` | **迁**（整份拷贝，tmp+rename） | 纯客户端偏好；键白名单校验，未知键保留 + WARN（D6 §7.2） |
| `profiles/opentui/keybindings.json` | **迁**（存在时） | 纯客户端 |
| `profiles/opentui/provider-keys.json` | **迁**（存在时，0600）；但**不把它当宿主可见凭据** | 宿主不读该文件（08 §4）；是否继续使用由 D8-Q2 决定 |
| `~/.dsh/.credentials.yaml` | **不迁** | home 级、跨 profile 共享，新 profile 直接可用 |
| `~/.dsh/sessions/` | **不迁** | home 级共享 |
| `package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml` / `node_modules` | **不迁** | 新 profile 由 provisioner 生成；老 profile 的 `link:` 依赖会整批拖垮 pnpm（oldfox P1-7） |
| `upgrade-overrides.json` / `cordis.yml` / `patches/` / `.plugin-manager/` / `*.bak-*` | **不迁** | 宿主/旧机制产物，留在老目录 |

### 7.2 源 A（老 `opentui`）patch 逐项

| 老块 | 迁/不迁 | 理由 |
|---|---|---|
| `llm-pi-ai`（78 模型，:2） | **不迁（硬禁止）** | 整块替换会把模板模型表整体换掉；老表多 4 个 id（`glm-5.4`/`mimo-v2.6-pro-ultraspeed`/`hy4-flash-free`/`qwen4-max`），D2 已决定不补 |
| `permission`（`defaultPreset: danger-full-access`，:365） | **不迁（硬禁止）** | 会把沙箱从 `workspace-write` 静默放宽回 `danger-full-access`（ADR-0011 T9）。**连 `presets` 也不迁** |
| `- insert: preset-opentui-append-system + persona/agent-instructions/time-context/office/plugin-manager/plugin-market`（:401-546） | **不迁（硬禁止）** | inproc 下从未生效；约 146 行死重量；陈旧副本将来会 shadow 新预设。`.bak` 留底 |
| `- insert: tool-ask-user`（:346） | **不迁** | 模板已有；再插一份 = 两条同 id entry → `entries()` 剔除该 id（`dsh-config-editor/src/index.ts:58-64`） |
| `- insert: mcp-context7`（:381） | **不迁** | 同上，重复 insert |
| `- id: web`（:362） | **不迁** | inproc 无 web-app bundle，目标是「entry not found」；anysearch 由 bundle patch 自己钉住 |
| `- id: ui-settings-general`（:388） | **不迁** | 对应 bundle 不挂载，死行 |
| 7 个 tool 行 / `agent-instructions` | **不迁** | 模板逐字重生；搬过去只会产生重复 id |
| `agent-default-model`（:392） | **条件迁（叶级）**：仅当 `provider`/`model` 在新模板模型表中存在时，迁 `provider`/`model` 两个叶；`reasoningEffort` 只在 R22 组校验通过时随组迁 | 本机与模板逐字相同 → 实际 no-op；其他机器上若用户用 `/model` 选过模型，搬叶不搬行避免整块覆盖 |
| `subagent`（`maxActiveSubagents: 3`，无 `maxDepth`，:547） | **条件迁（叶级）**：只迁 `maxActiveSubagents`（与模板相同则 no-op）；**不迁 `maxDepth`**（源里没有），保留模板 `1`；**绝不搬行** | `maxDepth: 1` 是 R2-3 安全钉（闭孙子委派）；源里没有就等于用户没设过 |

### 7.3 源 B（`opentui-inproc`）抽取清单（P0-7，本次新增）

原则：`opentui-inproc` 是 0.27.x 的实际运行 profile，是**同一产品线的上一代**。只抽取「与当前模板不同」的 carriable 叶；`permission`/`providers` 仍禁止。

| 路径 | 迁/不迁 | 规则 |
|---|---|---|
| `subagent.maxActiveSubagents` | **迁** | 必须是整数 ≥ 1；与模板（3）相同 → 不产生 ext；不同 → ext |
| `subagent.maxDepth` | **迁**（按本轮任务口径；oldfox 曾把它列为待用户拍板项） | 必须是整数 ≥ 1；与模板（1）相同 → 不产生 ext；不同 → ext。用户把它调大是显式选择，不是我们放宽 |
| `session-log-deepseek.enabled` | **迁** | 必须是 boolean 字面量（`true`/`false`）；`!!js` 或其它 → 丢弃 `reason=invalid-value` |
| `permission.defaultPreset` | **不迁** | inproc patch 里是模板的 `!!js` 表达式（:370），**不是用户值**；迁移决策按模板权威处理（该行在 converge 里仍是 carry 角色，二者不冲突）。若源里是 plain scalar（用户在 inproc 用 `/settings` 改过），仍不迁，日志 `dropped permission.defaultPreset reason=template-authority`；首启 notice 写明「审批默认档位保持 workspace-write；如需放开请在 /permission 里改」 |
| `permission.presets` | **不迁** | 同源 A；`sandbox-loosening-forbidden` |
| `llm-pi-ai`（含 `providers`） | **不迁** | `model-table-template-owned`；手工新增的 provider id 逐条日志 `dropped providers.<id> reason=credentials-channel-pending`（D8-Q2 未定，搬过去宿主也解析不到 key） |
| `agent-default-model.{provider,model,reasoningEffort}` | **条件迁（整组）** | 三者作为 R22 组：与模板相同 → no-op（本机即如此）；不同且通过 §5.4 校验 → 整组 ext；否则整组丢弃 + WARN |
| 4 个 insert 块 / 其余 tool 行 / append preset | **不迁** | 模板权威或重复 insert（同 §7.2） |

**源优先级（两个源都存在时）**：逐叶取**第一个「包含该字段」的源**（`opentui-inproc` 优先；该源没有这个字段才回退 `opentui`），再与模板比较，只有不同才产生 ext。**不能**因为 inproc 的值恰好等于模板就回退到 `opentui`——那会把更老的意图复活。理由：inproc 是用户最近使用的 profile。这条覆盖 D6 现在写的「`opentui-inproc` 忽略」——对 patch 叶值不成立，对 `config.json` 仍成立（D6 原文语境是 config.json）。

### 7.4 执行顺序与幂等

不可换序（D6 §2）：`provision（写托管段，内部带 ext）→ 写 marker`。

- **不再有「provision 之后再按叶写一遍迁移值」的第二条写路径**。ext 作为 converge 的输入（§4.5），与日常收敛共用同一套投影/备份/校验/锁。
- marker：`<newprofile>/.migration.json`，含 `{from, at, version, digest, migrated[], dropped[{id,path,reason}]}`。
- 可重入：marker 存在 → 不读旧 profile、`ext=undefined`；老 profile 只读不写。
- 老 patch 备份到 `<newprofile>/.migrated-from/<source>-cordis.patch.yml`（一次性）。
- 崩溃点分析（为什么幂等）：
  - patch 写成功、marker 未写 → 下一轮 ext 重算，`current` 已含 ext 值，`ancestor` 是模板投影 → merge3 取 current，结果相同；
  - marker 写成功、notice 未打 → 下次只打 notice（notice 不写文件）。

### 7.5 丢弃项的日志呈现（必须是用户可见的）

1. 首启一条汇总 notice：「迁移完成：迁入 N 项，丢弃 M 项；备份见 …」。
2. 每个丢弃项一行，固定结构 `dropped <id-or-path> reason=<code>`，reason 取值：
   `sandbox-loosening-forbidden`、`model-table-template-owned`、`append-preset-unused`、`duplicate-insert`、`dead-row-no-bundle`、`row-replaced-by-leaf`、`model-id-not-in-template`、`template-authority`、`credentials-channel-pending`、`invalid-value`。
3. 4 个被丢弃的模型 id **逐一点名**（D2 要求发布说明提示）。
4. `permission` 丢弃时必须显式写：「审批默认档位保持 workspace-write；如需放开请在 /permission 里改」。
5. 日志走 provisioner 的 stdout/stderr（启动期可见），同时写进 `.migration.json` 供支持排查；不得只写 debug 日志。
6. 迁移写失败 → 不写 marker，下次重试；不得静默跳过。

### 7.6 对 D1 / D3 / D6 的回写建议（patch 文本，本文件不落地）

P0-6/P0-7 的落点是别的票面。以下是必须回写的**内容**（执行者落地时按各自文件格式调整）：

```diff
--- a/tickets/2026-11-24-inproc-D6-migration.md
+++ b/tickets/2026-11-24-inproc-D6-migration.md
@@ 一、迁移面清单
-| `profiles/opentui/cordis.patch.yml` | 3 个 insert 块 … | 只做白名单抽取 … 可搬 `agent-default-model`、`subagent` 上限 |
+| 两个源：`opentui` 与 `opentui-inproc` | 只做白名单抽取。`opentui-inproc` 必迁 `session-log-deepseek.enabled`、`subagent.maxActiveSubagents`、`subagent.maxDepth`；`permission.defaultPreset` 在 inproc 是 `!!js` 模板表达式，按模板权威不迁 |
@@ 二、执行时序
-T1 先 provision 新 profile … T2 再写用户段 … patch 用户段合并（白名单抽取）
+T1 provision 新 profile，converge 接收 externalCarry（叶值来自两源）→ 一次写成
+T2 只写 config.json（patch 迁移值已在 T1 内完成，不存在第二条写路径）
@@ 四、并发
-- **两个客户端同时首启**：provision 已有 `.provision.lock`（O_EXCL + 30s stale），marker 作第二道闸。
+- **两个客户端同时首启**：`.provision.lock` 整轮互斥、活持有者不按时间失效、等不到即失败（06 R14）；marker 作第二道闸。
@@ 六、真机验证矩阵
-| 只有 `opentui-inproc`（从 0.27.x 升上来） | 无配置可迁，直接 provision |
+| 只有 `opentui-inproc` | 迁移 `session-log-deepseek.enabled` / `subagent.maxActiveSubagents` / `subagent.maxDepth`；`permission` 与 `providers` 记 dropped |
```

```diff
--- a/tickets/2026-11-24-inproc-D1-config-home.md
+++ b/tickets/2026-11-24-inproc-D1-config-home.md
+## 回写（06 修订 2）
+- carry 起点补 `permission.presets`（非 volatile，只能手改 patch，但仍是用户数据）。
+- 「原字节原顺序保留」修正为：provisioner 写不改用户区字节；宿主重写是格式归一化，不视为用户修改。
+- 侧车 `.patch-ownership.json` 的 `ancestor` 是**模板投影**，不是写出的结果（否则用户值每轮被重置）。
```

```diff
--- a/tickets/2026-11-24-inproc-D3-teardown.md
+++ b/tickets/2026-11-24-inproc-D3-teardown.md
+- 客户端 3 个 patch 写手（LocalSettingsStore.mutate / LocalLoginFace.registerRoute / append-system sync）的退役与 `no-client-patch-writers` 门禁，必须**先于** profile 改名提交（06 R6/§6.1）。
```

---

## 8. 测试矩阵

### 8.1 单测（纯函数 `scripts/lib/patch-converge.mjs`，无 fs/时钟）

| # | 用例 | 断言 |
|---|---|---|
| 1 | 文件不存在 | 写完整模板；preamble 含 R13 空行；`reason='absent'`；无备份 |
| 2 | 宿主重写样本（折行 `!!js`、行尾注释空格规范化、LF、连续空行压缩） | `write:false` |
| 3 | CRLF 输入 + 语义等价 | `write:false`；若有写，新块用 CRLF |
| 4 | `!!js` 折行 vs 同文本 plain scalar | 前者等价，后者不等（tag 参与投影） |
| 5 | 长行折行 / 行尾注释 | 等价，不重写 |
| 6 | 独立注释/空行在行与行之间、文件尾 | 写回后逐字节相同 |
| 7 | carry 叶（`subagent.maxDepth=2`） | 写入 2；`ancestor` 记 1；第二次运行 `write:false`；**第三次运行仍为 2**（防「写出的结果当 ancestor」回归） |
| 8 | 模板权威行 drift | 覆盖为模板 + `backupReason='drift'` + `paths[]` 含该 path |
| 9 | 重复 managed id | 值按 R3 逐键折叠；位置保留第一个 applicable；删其余；`backupReason='duplicates'` |
| 10 | 缺 managed 行 | EOF 追加（含模板注释），第二次 no-op；无备份、无 WARN（R23-②） |
| 11 | retired id | 删除 + 一行日志 |
| 12 | **托管 insert 块内有用户新增 entry** | 模板 entry 全等 → `write:false` 且用户 entry 逐字节保留；模板 entry 变了 → 整块重写，用户 entry 追加在模板 entry 之后 + WARN `insert-user-entry-moved` |
| 13 | insert 块里出现 `M_ID` 的嵌套 entry | 剔除该 entry + WARN，托管行正常追加 |
| 14 | 非法 YAML / 非 sequence | `write:false, fatal`，带 line:col |
| 15 | carry 叶是 `!!js` | 拒绝 carry、模板值胜出、WARN |
| 16 | 块标量内含 `- id: fake` | 切分正确（parser range） |
| 17 | BOM / 混合 EOL | 用户区字节保留 |
| 18 | preamble 被删 / 修订号过期 / 首注释块未分离 | 重写 preamble + 插入 R13 空行；一次写；二次 no-op |
| 19 | **同 id、`name` 不匹配的行** | 不采用其 config、不删、不参与重复计数、WARN `row-name-mismatch`；模板行仍生效 |
| 20 | 幂等 | `converge(converge(x))` 第二次 `write:false` |
| 21 | 三方合并（ancestor=模板） | a=1/c=2/n=3 → 2；a=1/c=1/n=3 → 3；c 删 key → 保持删除；a=1/c=2/n=2 → 2 |
| 22 | state 缺失（base-unknown） | carry current（默认值不更新）+ 一次备份 `base-unknown` + `paths[]` 列出所有差异（含权威行） |
| 23 | 侧车损坏 / 版本未知 | 同 22 |
| 24 | `permission.presets` 自定义字典 | 整块 carry 后仍在；注释：`presets` 非 volatile，只能手改 |
| 25 | `agent-default-model` 指向已删模型 | **整组**回模板 + WARN `carry-group-rejected`；不允许只保留 reasoningEffort |
| 26 | 新托管行（state 存在但缺该 row） | 采用 `next_eff`、备份 `new-managed-row`、`paths[]` 列出被替换项 |
| 27 | **文件不存在 + externalCarry** | ext 值写入；`ancestor` 记模板投影；有 marker 的下一轮 `write:false`；无 marker 的下一轮得到相同内容（`write:false`，幂等） |
| 28 | 托管行不存在（宿主 reset） | 重新追加 `next_eff`；无备份、无 WARN；`ancestor` 更新 |
| 29 | 托管行存在但 `config` 缺失 | 采用 `next_eff` 的 config；不备份；`disabled`/`name` 按 R20/R24 |
| 30 | merge3 双方都改 | current 胜 + WARN `carry-conflict`（带 path 与截断值） |
| 31 | 逐键 last-wins | 行1 `{config:{a:1}}` + 行2 `{disabled:true}` → config.a=1 且 disabled=true；行1 `{config:{a:1}}` + 行2 `{config:{b:2}}` → config={b:2}（a 被整块替换） |
| 32 | providers 合并 | 用户新增 id 保留；模板 id 更新生效；用户改模板 provider 字段保留；用户删模板 provider → 恢复 + WARN；用户改坏 `api`/`models` → 整 provider 回模板 + WARN |
| 33 | providers + base-unknown | 模板 id 整块权威 + WARN `provider-template-authority`；用户新增 id 保留 |
| 34 | `disabled` carry | `/plugin` 写的 `true/false` 存活；`false` ≡ 缺省；模板 `!!js` 行出现 plain 值 → 模板胜 + WARN |
| 35 | **R13** | 生成的完整内容解析后 `delete(0)`，`String(doc)` 仍含 `# profileRevision:` 与模板首注释（附录 B.7） |
| 36 | **`- # 注释` 异行** | `fatal='shape'`，带 line:col；不写 |
| 37 | `.provision.lock` 活持有者 + 年龄 1h | `classifyLock`（纯函数）返回「活、不可接管」；永不因年龄判 stale |
| 38 | `.provision.lock` 死 pid / 损坏记录 | 死 pid → 可接管；损坏 < grace → 不可接管；> grace → 可接管（`classifyLock`，无 sleep） |
| 39 | 迁移抽取（纯函数） | 两源优先级正确；与模板相同的值不产生 ext；`permission`/`providers` 不产生 ext；非法值进 dropped |
| 40 | 语义相等行不移动 | 行/块写回后前后注释位置不变；只缺行时才追加 EOF |

### 8.2 集成（真实 provisioner + 真实宿主 config-editor，临时 `DSH_HOME`）

1. **三轮交替写**：provision → 宿主 `settings.mutate(subagent,maxDepth=2)` → provision → 断言 2 存活；→ `mutate(maxDepth=3)` → provision → 3 存活；每轮后：每个 managed id 恰好一行、无新 `.bak`、`describe()` 值正确。
2. 同上覆盖 `permission.defaultPreset`、`permission.presets`（手改 patch + provision 存活）、`session-log-deepseek.enabled`、`dsh-approval-policy.windowSeconds`。
3. **锁互斥**：外部先持 `package.json.lock`（模拟宿主），provisioner 等待后收敛；宿主持锁期间 provisioner 不写半成品。
4. **崩溃接管**：锁文件写死 pid → provisioner 接管；claim 文件存在时第二个 contender 不双持。
5. **宿主格式归一化**：先让宿主 edit 一次（整文件重写），再 provision → `write:false`。
6. **写手并集覆盖（R26）**：
   - `settings.describe()` 的每个命名空间 id ∈ `M_ID` → 必须在 `ROLE` 里（carry/merge）；
   - `/plugin` 可达的托管 id → `disabled` 由 R20 覆盖；其 config 必须在 `ROLE`，或该行的 plugin Config 被证明**没有 volatile 字段**（authority 合法）；
   - `/model` 的 `saveSelection` 目标 `agent-default-model` → 必须在 `CARRY_GROUPS`；
   - `sanitizeProfile` → 只走 absent 分支，不需要 per-row 覆盖；
   - 失败时列出未覆盖 id；对钉定宿主版本执行，宿主升级必须重跑。
7. **home patch 遮蔽**：放一份含 `subagent` 的 `$DSH_HOME/cordis.patch.yml` → provisioner WARN，宿主 mutate 返回明确错误。
8. **迁移夹具**：老 patch 含 `danger-full-access`、多 4 个模型、重复 insert、append preset；`opentui-inproc` 夹具含 `enabled:false`、`maxDepth:3`、`maxActiveSubagents:5` → 迁移后：`permission` 行不存在（模板默认）、模型表等于模板、insert 唯一、`session-log-deepseek.enabled=false`、`subagent` 5/3、日志列出全部丢弃项、第二次运行 no-op。
9. **首启 fresh HOME**（与 D7 联动）：只有 provisioner 能建目录时也能收敛。
10. **`--dry-run`**（建议新增）：打印将写/不写、carry 项、drift 项、ext 项，不落盘。
11. **`.provision.lock` 整轮互斥**：两个 provisioner 并发（第一个 sleep 3s 模拟 companion）；第二个等 ≤ 上限后 **exit 2**，stderr 含 holder pid/step；第一个完成后第三个正常收敛。**断言第二个从未 SKIP-0**。
12. **`.provision.lock` 死 pid 双 contender**：手工写一个死 pid 的锁，同时起两个 provisioner → 只有一个接管（claim），另一个等待/失败，不出现双持。
13. **`package.json.lock` 互操作**：用宿主的 `withFileLock` 持锁 N 秒 → provisioner 等到上限后 exit 2；反向：provisioner 崩溃留 `${pid}\n` → 宿主能接管（这是 R15 的核心回归）。
14. **无锁写手竞态**：在 provisioner 写 patch 的同一毫秒窗口内用 `writePluginEnabled` 风格写一次 → 断言 `concurrent-write` WARN、侧车未更新、退出 0、下一轮收敛且用户 `disabled` 存活。
15. **name 正确性**：用 bundle patches + 模板组合 entry 树 → 每个 `M_ID` 都没有 `name mismatch` 警告。
16. **`yaml` 钉版**：`packages/shell/package.json` 的 `dependencies.yaml === '2.9.1'`；`pnpm-lock.yaml` 同提交含该精确版本；`pnpm install --frozen-lockfile` 绿（`.github/workflows/ci.yml:172`）。

### 8.3 真机验收（本机，人工/脚本）

1. `/settings` 改 `maxDepth` → 重启客户端 → 值存活，`maxActiveSubagents` 不变。
2. 改 `defaultPreset` 为 `read-only` → 重启 → 存活，且实际沙箱为 read-only。
3. `session-log-deepseek.enabled=false` → 重启 → 存活。
4. `dsh-approval-policy.windowSeconds=120` → 重启 → 存活；`/settings` 的 other 区显示正确。
5. 连续启动 3 次 → `ls profiles/opentui-monday/*.bak*` 无新增。
6. 宿主 reset（把值改回默认）导致行被删 → 下次启动恢复该行，且不产生备份。
7. 升级到「模板某托管行变了」的版本 → 该行更新，carry 行的用户值仍在。
8. 回退 0.27.x → 旧客户端仍只读 `profiles/opentui`，不受影响。
9. `--repair-bridge`（有活宿主）→ 先杀后 provision，无半文件。
10. 手工在托管行里加行尾注释 → 下次 provision 备份 + WARN 列出该注释（不静默吞）。
11. `/plugin` 关掉 `tool-web` → 重启 → 仍关（R20）；再开 → 重启 → 仍开。
12. 两个窗口同启（第一个强制 `DSH_OPENTUI_COMPANION_LATEST` 走安装）→ 第二个给出可读的「正在准备 profile」失败信息，不出现半成品启动。
13. 宿主 reset 删除首行 → 文件头两行与模板首注释仍在（R13 真机验证）。

---

## 9. 备选方案与否决理由

### 9.1 注释标记法（`# BEGIN USER` / `# END USER` / `# managed: <id>`）

**否决。** 三条实测/代码证据：

- 宿主 reset 会 `delete(index)` 删掉托管行并带走其 `commentBefore`（`dsh-config-editor/src/index.ts:119-126`；附录 B.3 实测首行注释被连带删除）。标记行要么被删，要么被 yaml CST 重新挂到相邻节点，位置漂移。
- 宿主整文件重写会压缩连续空行、重排注释归属（附录 B.2/B.3），标记与内容的相对位置不稳定。
- 标记本身不携带「这一行归谁」的语义；用户只要把标记挪一行，归属就错。id 集合是结构事实，标记是约定，前者更可靠。

### 9.2 整文件 YAML round-trip 全量重写

**作为 provisioner 写路径否决，作为比较手段采用。**

- 否决理由：(a) 用户区字节保证消失（折行/空行压缩/CRLF/BOM，附录 B）；(b) provisioner 必须与宿主**同一 yaml 版本**才能字节稳定，而宿主 yaml 随 dsh 升级；(c) 仍然会在删行时丢 `commentBefore`；(d) 会重写模板锚定行（`packages/shell/test/patch-runtime-merge.test.ts:161` 的 566-578 字节锚会红）。
- 采用的部分：解析用于分类/投影/range，渲染**单个托管块**时克隆模板 AST 再序列化（`lineWidth: 0`）。用户区永远不经过序列化器。
- 这也是为什么本设计把宿主定义为「格式归一化器」：它的整文件重写不可避免，我们只能让语义比较对它免疫。

### 9.3 把用户配置移出 patch（独立文件 / D1 候选 A）

**不作为本次方案，但保留为长期方向。**

- 宿主 `configEditor.documentPath` 固定为 `profileContext.patchPath`（`dsh-config-editor/src/index.ts:52-53`），`/settings` 只写这个文件。要移出 patch，必须换掉 settings 通道（D1 候选 C：挂 `settings-controller` 行 + bridge settings 通道），工期与回归面都更大。
- 即使移出「客户端配置」（config.json/keys/presets 已在别的文件），`/settings` 仍然会写 patch 的托管行——问题不消失，只是少一个写手。
- 结论：先做本文的两方写权 + 三方 carry；等 settings-controller 落地后，可把 patch 完全变成宿主所有，provisioner 只保证「模板行存在」。本设计的 §3–§5 不阻碍那条路。

### 9.4 其它被否的小方案

| 方案 | 否决理由 |
|---|---|
| P0-2(a) 托管行不带 `config:` | 模板的 `permission.presets`、模型表、tool 开关、`subagent` 钉都是 load-bearing，去掉会改运行时行为 |
| 只用叶白名单 carry（扩到 10 个字段） | 宿主写的是整份 config（`dsh-settings/src/index.ts:411-421`），新增字段/非 volatile 原字段必漏；每加一个插件就要改代码 |
| 用 md5/字节白名单判「模板未变」 | P0-1 的根因；宿主重写后 md5 永远不在白名单 → 每轮备份 |
| 把 ancestor 存进 patch 注释（`# managedDigest:`） | 首行删除会连带删 header 注释（附录 B.3）；且注释里塞 JSON 会被行宽折行。侧车文件更稳 |
| 依赖 dsh 安装目录里的 yaml | 路径随全局安装布局变化，且宿主升级会换版本；不可控 |
| 手写行扫描器代替 yaml parser | 块标量里的顶格 `- ` 会切错（附录 B.5）；注释/折行规则不可靠 |
| 在用户段写 `- id: llm-pi-ai` 来保留用户 provider | `config` 整块替换（§1.5），会把模板 providers 全顶掉 |
| `.provision.lock` 按 mtime/年龄判 stale | P0-1 的根因；活持有者被接管后两个 provisioner 同时写 |
| 把 `package.json.lock` 记成 JSON | 宿主只认 `${pid}\n`（`dsh-atomic-write/src/index.ts:112-127`）；JSON 记录会让崩溃锁永远不可被宿主接管 |
| `yaml@^2.9.1` | 发布后用户机器重解析范围；`--frozen-lockfile` 也可能因范围解析不一致失败（R25） |

---

## 10. 风险、不可逆点、开放问题

### 10.1 风险

1. **carry 表静态漂移**：新插件行有 volatile 字段但没进表 → 下次 provision 覆盖用户值。缓解：R26 写手并集测试 + 权威行 drift 备份。
2. **`yaml` 版本漂移**：精确钉 `2.9.1`（R25），宿主升级 yaml 后序列化风格可能变化。缓解：投影只依赖 core schema + `!!js` 一种 tag；单测固定宿主重写样本。
3. **`current == ancestor` 的固有歧义**：用户把值改回上一轮模板默认 → 被当作未改 → 新默认覆盖。无法从两个快照区分；记为开放问题。
4. **锁协议复制**：两份实现（宿主/我们）可能漂移；claim 与 `${pid}\n` 是硬约束。缓解：集成测试双向互斥与互相接管（§8.2-4/13）。
5. **pid 复用**：宿主与我们都不接管；若用户机器上恰有进程复用 pid，启动会一直失败到人工删锁。原文「不永久卡死」的说法错误（`dsh-atomic-write/src/index.ts:226-227` 明确保留到 operator 处理）。缓解：错误文案给路径与判定步骤；`--repair-bridge` 不能解决复用场景。
6. **宿主 `/plugin` 开关无锁**：写窗口内的 lost update 无法完全消除，只能靠写后校验暴露（§6.4 #4）。窗口是毫秒级，代价是一轮 WARN。
7. **insert 块顺序**：用户移动块后挂载顺序与模板不同（R27）。当前模板无跨块顺序依赖；未来新增有依赖的块必须写测试。
8. **providers 合并的结构校验是“浅”的**：我们只校验模板声明的键、`api` 枚举、`models` 非空；宿主 schema 的其它约束（headers、compat、超时）无法在 provisioner 复刻。非法用户 provider 会留在文件里，由宿主配置加载报错。选择：不裁剪用户数据（避免静默丢配置）。
9. **R13 是一次性全量重写**：所有用户文件都会在升级后首启被插入一个空行；`profileRevision` 变化也会触发一次写。这不是抖动（一次/版本）。
10. **迁移的 `maxDepth`**：本次按任务口径迁；如果产品后来认为 `maxDepth` 应由新 profile 重新钉 1，需要在发布说明里改口。
11. **`permission.defaultPreset` 的 `!!js` 被 plain 值取代**：用户一旦在 `/settings` 改档位，`DSH_OPENTUI_APPROVAL_GATE=off` 对该 profile 不再生效（R22 的 carry 会保留用户的 plain 值）。这是保留用户值的代价；在 drift/carry WARN 中写明一次。`permission` 是 carry 行，模板 `!!js` 只作为 ancestor/next 参与投影，不会被写回成求值后的字符串。

### 10.2 不可逆点

1. 首次收敛会把老 patch 的托管行替换成模板值（用户区保留）；只剩 `.bak`。
2. `permission`/`llm-pi-ai`/append preset 不迁移 = 这 4 个模型 id、自定义 permission 行、append 预设在新 profile 永久消失（发布说明必须写）。
3. 客户端三个 patch 写手退役后，`/login` 不再能新增 provider 路由（只能走 §2.4 的通道）；`registerRoute` 的外部调用方（如果有脚本）会失效。
4. 侧车文件成为收敛正确性的一部分；删掉它会让下一轮退化为「carry current」（默认值滞后，不丢值）。
5. 用户新增 provider 若在旧 profile 手工存在、且 D8-Q2 选 B，则迁移时被丢弃，需要在新 profile 重新添加（日志会点名）。

### 10.3 开放问题

1. `current == ancestor` 时如何区分「未改」与「改回旧值」？（可选：在侧车里记录用户的编辑时间戳/来源，但宿主不提供写来源。）
2. 是否允许用户通过手工编辑托管行来覆盖模板默认（当前：carry-enabled 行允许，权威行被覆盖）？产品语义需要一句明确的话。
3. home patch（`~/.dsh/cordis.patch.yml`）要不要也纳入同一套归属？当前只 WARN + 依赖宿主拒绝写。
4. 侧车是否要加签名/版本迁移？当前 `version:1`，未知版本按 unknown base 处理。
5. Windows 上的锁/rename 行为（`dsh-atomic-write` 有 transient 重试）未实测；claim 文件的 `wx` 语义在 Windows 上需实测。
6. carry 冲突是否要引入「模板收紧优先」的路径策略？本文选 current 胜 + WARN（安全边界由权威行承担）；若 D1 要求更强姿态，需要一张可审计的路径表。
7. D8-Q1/Q2 未拍板：account 入口与 key 落点决定 `/login` 的可用范围，但不影响本文的合并规则（§2.4）。

---

## 11. 自评审

**薄弱点**

- 三方基线是新增状态；它只影响合并方向，不影响输出值，所有丢失路径都退化为「carry current」。但实现者容易把它当成权威源——必须写死在契约里（`ancestor` = 模板投影，不是写出的结果）。
- `ancestor` 语义修正是本次的关键改动；如果实施者照原文实现「写出的结果当 base」，用户值会每轮被重置。单测 #7 专门防这个。
- 「整块 config carry」依赖宿主写的确实是整份 config；如果宿主某天改成只写 diff，`ancestor/current/next` 仍然成立（三方按叶），所以不脆。
- `renderBlock` 用模板 AST 序列化时，carry 值里的嵌套对象/数组会按 yaml 默认风格输出，可能与模板风格不同——只影响字节，不影响语义，且第二次运行 no-op。
- R19 的 providers 合并是本设计里唯一「部分权威」的行，规则最长、最容易实现错。必须按 §5.3.1 的伪码写，并有 #32/#33 覆盖。
- R13 的 preamble 修复是唯一会往用户区插入字节的操作；只在声明条件下发生（header 缺失/未分离），无内容丢失。

**隐藏耦合**

- `patch.ts` 的 `name` 守卫（`:97-100`）与 `config-editor` 的 `name` 守卫（`:116-118`）必须与我们的 expected `name` 规则一致，否则出现「宿主追加行 → 我们收敛 → 宿主再追加」的循环。规则见 §3.4.5。
- 宿主 `strip()` 保留非 volatile 原字段（`dsh-settings/src/index.ts:411-421`）：这就是为什么 carry 必须是整块 config，而不是 volatile 叶。
- HMR watcher（`dsh-hmr/src/index.ts:385`）让 provisioner 的写变成「运行时事件」；锁不能覆盖 watcher，只能靠原子 rename 保证读者看到的完整文件。
- `writePluginEnabled` 不拿 `package.json.lock`（`dsh-plugin-manager/src/patch.ts:25-78`），这是 R16 写后校验存在的唯一原因。
- 宿主 `sanitizeProfile` 会把 patch 整个挪走；converge 的 absent 分支必须能重建它。

**单点故障**

- `profiles/<p>/package.json.lock` 若被非协作进程永久占用 → provision fail-fast（不静默降级）。这是有意的：patch 不收敛时桥 profile 本来就是错的。
- `.provision.lock` 的 pid 复用 → 启动失败，需人工删锁；这是「不双持」的代价。
- 侧车丢失 → 默认值滞后一个版本，但用户值不丢。

**与上游/其它票的耦合**

- D2 的 `dsh-approval-policy` 模板行必须在模板**末尾**追加，避免移动 ledgers 锚定的 566-578 行（`packages/shell/test/patch-runtime-merge.test.ts:161`）。R13 已经会导致 +1 行，D2 的行必须在同一个提交里追加，并一起更新锚测试。
- D6 的迁移必须走同一 converge 入口 + `externalCarry`；D7 的 workspace 契约与本文无关，但同在启动期临界区内，注意不要持锁做安装。
- D1 的「原字节原顺序保留」需要改写为：**provisioner 写不改用户区字节（R13 的空行插入除外）；宿主重写是格式归一化，不视为用户修改**。
- D8 的 `/login` 新增 provider 通道不能写托管 patch；见 §2.4。

---

## 12. 分期落地建议

| 阶段 | 内容 | 退出条件 |
|---|---|---|
| 1a | `scripts/lib/patch-converge.mjs`（纯函数）+ 单测 §8.1 全部；模板 preamble 按 R13 修正；新增 `yaml` 依赖，**精确 `2.9.1` + lockfile 同提交**；`patch-runtime-merge.test.ts:161` 的锚同提交更新 | 单测绿；`pnpm install --frozen-lockfile` 绿；锚测试按新行号绿 |
| 1b | `provisionPatch()` 改调 converge；`profile-lock.mjs`（`${pid}\n` + claim）；`.provision.lock` 语义重写（R14）；步骤重排（manifest+patch 同一临界区，早于 step 4）；写后校验；备份 copy 语义；侧车 | 集成 §8.2-1/3/4/5/11/12/13 绿；真机 §8.3-1..5/12 |
| 1c | `ROLE`/`CARRY_GROUPS` 落地（`permission.presets`、`agent-default-model` 组、`disabled`）；`providers` 子键合并；模板末尾追加 `dsh-approval-policy` 行（L1） | §8.2-2/6/15 绿；真机 4 项存活；`/model` 选择存活 |
| 1d | 退役客户端 3 个写手；`no-client-patch-writers` 测试；`/login` 改走 D8 的通道（**不写托管 patch**）；本阶段必须在改名提交之前合并 | 门禁绿；`/login` 新增 provider 在下一轮 provision 后仍在（合并规则生效）；原 §12-1d 的「只写 provider-keys.json」验收口径作废（key 不写托管 patch，落点按 D8-Q2） |
| 1e | 迁移：两个源 + `externalCarry` + 日志 + `.migration.json` + `.migrated-from/`（D6 按 §7.6 回写） | §8.2-8/9 绿；真机迁移一次性通过；`opentui-inproc` 源的三叶迁移有夹具 |
| 5b | （后续，不在本文）改名 `opentui-monday` + 旧目录归档提示 | oldfox 顺序要求：1d 已合并 |

阶段 1a–1e 全部在一个 minor 内完成；不引入半态（D3）。

---

## 附录 A：模块契约（只到签名，不含实现）

```js
// packages/shell/scripts/lib/patch-converge.mjs  — 纯函数，无 fs/时钟/env
export const CONVERGE_POLICY_VERSION = 1
export const ROLE = { /* §5.2 */ }
export const CARRY_GROUPS = { 'agent-default-model': ['provider','model','reasoningEffort'] }
export const RETIRED_MANAGED_IDS = new Set([])     // 模板删行时迁入
export const RETIRED_INSERT_IDS = new Set([])

/** @typedef {{ source:'opentui'|'opentui-inproc', values:Record<string,unknown>, dropped:{path:string,reason:string}[] }} ExternalCarry */

/** @returns {{
 *   write: boolean,
 *   content?: string,
 *   reason: 'absent'|'semantically-equal'|'managed-diff'|'missing'|'duplicates'|'retired'|'preamble',
 *   backupReason?: 'duplicates'|'foreign-comments'|'drift'|'new-managed-row'|'base-unknown',
 *   backupPaths: string[],
 *   carried: string[], drift: string[], droppedComments: string[],
 *   warnings: string[], fatal?: 'parse'|'shape'|'span',
 *   sidecar?: { version:1, templateRevision:string, writtenAt:string, rows:object }
 * }}
 */
export function convergePatch({ template, current, state, externalCarry })

/** 工具：给测试/诊断用 */
export function project(text)                        // -> { values, byKey, warnings }
export function effectiveRow(text, id, templateName) // -> E(id)，R17
export function merge3(ancestor, current, next, opts) // §4.4
export function providersMerge(anc, cur, next, rowId) // §5.3.1
export function renderManagedBlock(templateText, key, expected)
```

```js
// packages/shell/scripts/lib/patch-ownership-state.mjs
export function readState(profileDir)     // ENOENT/corrupt/version!=1 -> undefined
export function writeState(profileDir, state)   // tmp+rename, 0600
```

```js
// packages/shell/scripts/lib/profile-lock.mjs  — 复刻宿主协议（R15）
export async function withProfileWriteLock(profileDir, fn, { waitMs = 120_000 } = {})
```

```js
// packages/shell/scripts/lib/provision-run-lock.mjs  — 整轮互斥（R14）
export function classifyLock(record, now, pidAlive)   // 纯函数：#37/#38
export function provisionHolderExited(record)         // JSON 解析 + pid 探活
export function acquireProvisionRunLock(profileDir, { waitMs = 30_000, onWait } = {})
// -> { release(), token } | throws ProvisionLockError（调用方 exit 2）
```

`provisionPatch()` 的新形状：

```js
await withProfileWriteLock(profileDir, async () => {
  const current = readPatchFile()                 // undefined when absent
  const state = readState(profileDir)
  const ext = readMigrationCarry(profileDir)      // undefined when marker exists
  const plan = convergePatch({ template: PATCH_CONTENT, current, state, externalCarry: ext })
  if (plan.fatal) fail(...)                       // 不写
  if (plan.backupReason) backupCopy(patchPath, plan.backupReason)
  if (plan.write) atomicWrite(patchPath, plan.content, 0o600)
  const after = readPatchFile()
  if (plan.write && after !== plan.content) {
    warn('concurrent-write: another host writer landed after this pass; skipping the sidecar')
    return report(plan)                            // exit 0；下一轮收敛
  }
  writeState(profileDir, plan.sidecar)
  report(plan)
})
```

## 附录 B：本机实测记录（yaml 2.9.1，node 26.8.1）

**B.1 折行与行尾注释**

```
输入:  disabled: !!js process.platform === 'win32'   # trailing note
输出:  disabled: !!js process.platform === 'win32' # trailing note
       defaultPreset: !!js process.env.X === 'off' &&
         'danger-full-access' || 'workspace-write'     ← 80 列折行
```
`range[2]` 含行尾注释；重写该行会丢注释 → 需备份 + WARN。

**B.2 行尾/空行/BOM**

- CRLF 输入 → `String(document)` 全 LF。
- `# h\n\n\n\n- id: a` → `# h\n\n- id: a`（连续空行压成一个）。
- `\uFEFF# h\n- id: a` → BOM 丢失。

**B.3 注释归属与删除**

- `# h\n- id: a`：注释是 `item.commentBefore`；`document.delete(0)` 后注释一并消失。
- `# h\n\n- id: a`：注释存活（doc 级）。
- `# h1\n# h2\n\n# rc\n- id: a`：三行全挂在 item 上，删除行后全丢。
- ⇒ header/revision 必须与首行之间留空行，且空行必须在**整个首注释块之后**（B.7）。

**B.4 `!!js` 折行语义**

折行只发生在空格处，重新解析后 payload 与原字符串逐字相同（`JSON.stringify(toJS())` 比较为 `true`）。⇒ 语义相等可判，字节永远不等。

**B.5 range/块标量**

- 顶层 item `range` 从 `id:` 起（不含 `- `），`range[2]` 含末行换行。
- 块标量里可以出现顶格 `- id: fake`，parser 的 range 仍正确；行扫描会切错。
- 多 item 时 `range[2]` 到下一个 item 的 `- ` 之前（实测：`- id: a\n…\n- id: b` 的两个 range 分别 `[2,52]`/`[54,60]`）。

**B.6 非法 `!!js` payload**

`!!js foo === 'a # b'` 与 `!!js foo === 'a: b'` 直接是 YAML 解析错误（`#`/`: ` 破坏 plain scalar）。⇒ 模板里的 `!!js` 必须保持 plain-safe；解析失败一律 R9。

**B.7 R13 复测（2026-11-24）**

用真实 header + 模板首注释：

| 形态 | `item0.commentBefore` | `delete(0)` 后 header 存活 |
|---|---|---|
| `header\n# model route\n- id: llm-pi-ai`（当前输出） | 三行全在 | **否** |
| `header\n\n# model route\n- id: llm-pi-ai` | 三行全在 | **否** |
| `header\n# model route\n\n- id: llm-pi-ai` | `null`（`doc.commentBefore`） | **是** |

⇒ 空行必须加在模板自带首注释**之后**。原 R13 的「模板 header 末尾加空行」说法（空行在 header 与模板注释之间）**无效**。

**B.8 `- # 注释` 与 `id:` 异行**

```
- # note        →  item.range[0] 指向第二行的 id:
  id: a             lineStart(range[0])..range[0] == "  "（没有 '-'）
```
按 `[lineStart(range[0]), range[2])` 替换会留下 `- # note` 的 null 序列项；loader 侧对 entry id 的访问抛错。⇒ R28 断言，fatal 不写。`-  # note`（两个空格）同样。

**B.9 顶层缩进**

`  - id: a` → `range[0]` 前的前缀是 `"  - "`；`range[0]` 从 `id:` 起。根缩进前缀（`"  "`）必须被渲染/追加沿用（§3.4.2），否则混排缩进会让下一次解析失败。
