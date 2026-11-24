# oldfox 二轮复审记录：06 / 07（2026-11-24，按时限交卷）

- 时长：约 21.5 分钟（上限 40）
- 裁定：**06 = GO-WITH-CONDITIONS**（P0-1…P0-8 先改设计再开工）；**07 = GO-WITH-CONDITIONS**（P0-9…P0-12）
- 路径缩写：`prov` = `packages/shell/scripts/provision-inproc-profile.mjs`；`<dsh>` = 宿主 0.2.2-rc.5 包根；`06`/`07` = `research/2026-11-24-inproc-only/06-…`、`07-…`

## P0（必须改）

| # | 问题 | 要求 |
|---|---|---|
| P0-1 | `.provision.lock` 不提供整轮互斥：活持有者超 30s 被判 stale 接管（`prov:152-155,798-808`）；等约 1s 后 SKIP、退出码 0、launcher 继续启动（`prov:815-862`）。首启迁移 + 10 companion 是分钟级，第二个窗口会带半成品启动 | 活持有者不得按时间判 stale；等不到就明确失败，不 SKIP |
| P0-2 | provisioner 与 `dsh plugin add` 抢同一把 `package.json.lock`，宿主持锁跑完整个 pnpm（`<dsh>/dsh-plugin-manager/src/operations.ts:602-608`）。「毫秒级临界区」只对 provisioner 成立 | 等锁上限覆盖一次安装时长，或把 patch 步骤挪到 step 4 之前 |
| P0-3 | R3「值取最后一次出现」与宿主语义不符：宿主逐键 last-wins（`<dsh>/cordis-plugin-include/src/patch.ts:102-105`），后行无该键时前行仍生效；name 不匹配的行运行时整行跳过（`patch.ts:97-100`） | 有效值 = 逐键取「最后一个含该键且 name 匹配」的出现 |
| P0-4 | R5 与 §3.2 对「托管 insert 块内用户新增 entry」指令相反：§3.2 保留（`06:145`），R5/伪码会删（`06:240,275`） | 二选一并同步伪码与测试 #12 |
| P0-5 | `/login` 自定义 provider 路由无决策；`LocalLoginFace.registerRoute`（`local-config-faces.ts:668-708`）无守卫直达 seam；`llm-pi-ai.providers` 是 volatile，按 06 归权威行 → 用户路由下次启动被覆盖 | **需用户拍板**：(a) 删功能 + 发布说明；(b) `providers` 按子键三方合并（模板权威、用户新增保留） |
| P0-6 | 三个客户端写手退役未进票面、未排进改名之前；三处写入目标都是 `DEFAULT_PROFILE`（`lifecycle.ts:91`、`bridge-session-seam.ts:2273,2290`），改名后写入目标会切到 provisioner 的 patch | 回写 D1/D3/D6，加 `no-client-patch-writers` 门禁，且先于改名提交 |
| P0-7 | 迁移源缺 `opentui-inproc`：今天 `patch-runtime-merge` 刻意保 3 字段（`prov:1266,1297`），D6/06 只清点了老 `opentui` patch | 至少 `session-log-deepseek.enabled=false` 必迁；`permission.defaultPreset` 与 `maxDepth` 是否迁**需用户拍板** |
| P0-8 | converge 两处未定义：`currentText` 不存在时直接返回整模板、绕过 externalCarry（`06:259`，正是首启迁移路径）；carry 行缺失时 `current` 未定义（`06:274`）。另 `yaml` 必须精确钉 `2.9.1`（仓库现无该依赖，发布后用户机器重解析范围；lockfile 须同提交更新，否则 `ci.yml:169-170` 红） | 补 absent 分支规格；`yaml` 钉版 + lockfile 同提交 |
| P0-9 | 07 冲突/不可解析只 WARN 不停：坏契约下继续 step 4 真装分钟级并写坏 `node_modules`，step 5 才 fail；失败文案不提 workspace 冲突 | step 4 前 fail-fast，给两条可执行指引 |
| P0-10 | 修复判据与 guard 判据不一致：guard 用 `existsSync`（对 symlink 也为真，`prov:1479`），修复跳过 symlink；隔离目录留在 profile 内会被 CI `find -path '*@deepseek-ai*'` 命中 | 改为「删 `node_modules` + `pnpm-lock.yaml` 后按契约重装」这类更小失败面 |
| P0-11 | 07 隐式依赖 06 的 yaml 决策却未声明，且写错事实（`07:54`「仓库已有 yaml」不成立） | 声明依赖，或按 P0-12 去掉依赖 |
| P0-12 | 07 的语义合并可整体去掉：新 profile 目录全新，dsh 写手只会产出完整模板或 round-trip，不存在「部分」状态；PATH 前置若放 step 级会毁掉第一个 pass 的「dsh 不在 PATH」覆盖 | 缺失即写、存在且三键相等即通过、其余 fail-fast；PATH 只给第二个 pass，并给第一个 pass 加 `! command -v dsh` 断言 |

## P1（要点）

- merge3 无「双方都改」分支：安全叶被模板收紧 + 用户改过时模板值被静默丢弃，至少 WARN。
- 侧车丢失时权威行差异覆盖但无 path 级 WARN；`06:241`「不备份」与 R10 矛盾。
- **R13 无效（实测）**：空行必须加在模板自带首注释之后，否则 `document.delete(0)` 后 `# profileRevision` 不存活。
- `- # 注释` 与 `id:` 不同行时 `range[0]` 在第二行，按设计替换会留下 null 序列项，loader `entry.id` 抛错（`patch.ts:31`）→ 加 R9 断言。
- §8.2-6 判据不准：`agent-default-model` 走 `/model` 的 `saveSelection`，`settings.describe` 盖不到；判据应为「宿主全部写手的并集」。
- `permission.presets` 不是 volatile（只有 `defaultPreset` 是），整块 carry 已覆盖、无害。
- pid 复用后宿主与复刻实现都永不接管（`<dsh>/dsh-atomic-write/src/index.ts:226-227`）→ 06 的「不永久卡死」表述错误。
- 锁协议复刻必须含 claim 文件（`atomic-write:150-178`），否则两个 contender 同时判死锁会双持。
- 07 门禁 companion 走 `latest`，CI 应钉版。

## 已核成立（不成立的说法也列了）

- A2 range 方案成立（锚点 id、每次现算、实测块标量/折行 `!!js`/CRLF 正确）。
- A3 insert 挂载顺序不会偏移（无 id 的 insert 按文件顺序 push）。
- A6 `yaml` 依赖只影响 provisioner（裸 node 脚本，不经 `build-client.mjs`）；客户端 external/包体不受影响；不建议 vendored。
- A7 模型存在性前置校验设计里已有。
- B 契约字节与 dsh 模板逐字等价（`profile.ts:184-189`）；`packages: [.]` 足够；根因成立。

## 未审

1. Windows 锁与 rename。
2. home patch（`$DSH_HOME/cordis.patch.yml`）是否纳入同一套归属。
3. 06 §8 测试矩阵逐条完整性。
4. 悬空 provider/model 的运行时后果。
5. rc.3（CI 钉）与 rc.5（本机）`initProfile` 条件差异。
6. launcher 6a 预启动包是否也调用 `provisionAppendSystem`。

## 任务序列（oldfox 给，粗粒度）

1. 票面回写 + 两项用户拍板（`/login` 路由去留；inproc 源 `permission`/`maxDepth` 是否迁）——阻塞其余全部。
2. 06 设计修订（P0-1…P0-5、P0-7、P0-8、R13）— 可与 3 并行。
3. 07 设计修订（P0-9…P0-12，采纳「缺失即写、否则断言」）— 可与 2 并行。
4. 纯函数 converge + 单测；yaml 精确钉版、lockfile 同提交 — 可与 5 并行。
5. workspace 契约步骤、fail-fast、重装式修复、门禁第二 pass（PATH 按命令作用域）。
6. provisioner 接线（锁含 claim、`.provision.lock` 语义修正、侧车、备份策略）— 依赖 4；锁/侧车/备份同提交。
7. 写手退役 + `no-client-patch-writers` 测试 + 迁移（含 inproc 源）— 依赖 1、6；**先于改名提交**。
