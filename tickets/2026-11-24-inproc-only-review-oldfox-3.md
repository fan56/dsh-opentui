# oldfox 终审记录：06/07 修订稿（2026-11-24）

- 时长：约 13 分钟（限 25）
- 裁定：**GO-WITH-CONDITIONS**。12 条 P0 在设计稿内闭环（P0-5、P0-6 只算部分解）；开工前需：票面回写 + 新洞 N1/N2/N3 + 两项拍板记录。

## 1. P0 判定表

| # | 判定 | 关键依据 |
|---|---|---|
| P0-1 | 已解 | 活持有者只按 pid 探活、永不按年龄判 stale（06:814-817）；等锁 30s、退避 50→500ms（06:828）；超时 exit 2（06:829）→ launcher exit 1（`bin/dsh-opentui.mjs:310-319`）；SKIP-0 路径（`prov:1520-1527`）明确删除 |
| P0-2 | 已解（两项都选） | 步骤重排：manifest+patch 同一把 `package.json.lock`、早于 step 4，step 4 不持锁（06:783-801）；等锁 120s、超时 exit 2（06:847）；别的窗口正在装插件时明确失败 |
| P0-3 | 已解 | 逐键 last-wins + name 不匹配整行跳过（06:253-280），与 `patch.ts:97-105` 逐行一致；§8.2-15 集成断言兜底 |
| P0-4 | 已解 | 选「保留用户新增」；R5/R18/§3.2/§3.4.2/§3.5/测试 #12 全部同向，无残留相反指令 |
| P0-5 | **部分解** | 字段级 merge3 已覆盖「用户改模板 provider 字段」（06:680-695、测试 #32）；但 registerRoute 退役后 **`/login` 没有可用的 providers 写入通道**，且 sidecar 锁内合并无规格（06:199、06:659）→ 需拍板 |
| P0-6 | **部分解** | 设计已补（06:80-94、736-770，R6 先于改名）；**票面未回写**：所有票里搜不到 `no-client-patch-writers`，`D6:59` 仍写「30s stale」、`D6:75` 仍写「opentui-inproc 忽略」 |
| P0-7 | 已解（缺拍板记录） | 第二迁移源已补（06:135-147、921-936）；enabled/maxActiveSubagents/maxDepth 迁、defaultPreset 不迁。但后两项是拍板项，稿内自行决定 → 若用户曾在 inproc 设 `read-only`，迁后会被放宽，与「不得放宽沙箱」冲突 |
| P0-8 | 已解 | 三个 absent 分支确定（06:562-568）；`yaml` 钉 2.9.1 + lockfile 同提交（R25、§8.2-16）；已核仓库当前无 yaml 依赖 |
| P0-9 | 已解（稿内） | fail-fast 在装 companion 之前（07:31、93），文案带两条指引；「只 WARN 继续」已删。残留：D7 票面 `:29,:31` |
| P0-10 | 已解（稿内） | 修复=删 `node_modules`+`pnpm-lock.yaml` 重装（07:111-120）；quarantine/symlink 豁免已取消。残留：D7 票面 `:31` |
| P0-11 | 已解 | 依赖声明 + 错误事实已改（07:35、74） |
| P0-12 | 已解（稿内） | 缺失即写、三键相等通过、其余 fail-fast（07:71-77、85-89）；PATH 只给第二个 pass（07:137-139）；第一个 pass 加 `! command -v dsh`。残留：D7 票面 `:29` |

R13 复测成立（空行加在整个首注释块之后，`delete(0)` 后 header 存活，`String(doc)` 往返仍在）。

## 2. 新洞

| # | 级别 | 内容 | 改法 |
|---|---|---|---|
| **N1** | P1（开工前） | **侧车不自愈**：不写的轮次不落侧车（06:556），伪码无条件 `writeState` 但为 undefined（06:1284）；侧车丢失+文件等于模板 → 永远 `write:false` → 之后旧默认值被永久保留且无 WARN（06:460,476） | 不写的轮次若 state 缺失/损坏/`templateRevision` 过期，在同一把锁内补写；加单测 |
| **N2** | P1 | 修订记录写「pid 复用恢复路径」（06:15），正文没有；实际是「不接管、人工删锁」，`--repair-bridge` 也不覆盖 → 崩溃后低号 pid 被复用会永久 exit 2 | 判活改 pid+启动时间或 argv；或让 `--repair-bridge` 能接管 |
| **N3** | P1（跨票） | D3 的 `--force` 收尾删 `.provision.lock`，但击杀清单不含 provisioner 进程 → 被杀 launcher 的 provisioner 子进程可能还活着，清锁后下一个窗口并发再跑 | provisioner 加进击杀清单；清锁放击杀之后，且校验 pid+nonce |
| N4 | P2 | step 4 仍有锁外写 manifest：`dropUnmountedCompanions`（`prov:920-942`）未纳入锁内 | 并入同一临界区 |
| N5 | P2（07） | workspace 步骤是否在 `package.json.lock` 内未定义；宿主 `recordPendingBuilds` 读不到按 `{}\n` 处理再整份重写 → 锁外写会丢更新 | 并入 manifest 同一临界区 |
| N6 | P2（07） | 「不存在部分态」前提不成立；fail-fast 本身安全，但改名提交前存量目录若只有 `allowBuilds` 会每次 fail-fast | 需 `--repair-bridge` 恢复路径 |
| N7 | P2（07） | fail-fast 负向路径零门禁（CI 每次都传 `--repair-bridge`） | 加负向用例 |
| N8 | P2 | 结构断言致命时客户端无法启动且无修复入口（R9/R28） | `--repair-bridge` 支持备份后按模板重建 |
| N9 | suggestion | 侧车示例把 `name` 放进 `ancestor`（06:431-436），正文说不含（06:442） | 二选一 |
| N10 | suggestion | 07 行号引用过期（`06:27,48,107`、不存在的「Q3」） | 更新引用 |

## 3. 对 B 题两问的直接回答

- **ancestor = 模板投影：正确**。用户改过（c≠a,n=a）保留；没改（c=a）吃新默认；双方都改 current 胜并 WARN；「改回旧默认」的固有歧义稿内已承认（06:452）。「没改却被判改过」只在侧车缺失时发生（即 N1）。
- **07 在存量目录上不会误判**：改名后目录全新 → 缺失即写；老目录不删不改名；`pnpm-workspace.yaml` 不迁（06:903）。
- R14–R29 抽核无互相矛盾（未做全组合）。

## 4. 最终任务序列

| # | 任务 | 原子性 / 前置 |
|---|---|---|
| T1 | 票面回写 D1/D3/D5/D6/D7（按 06:960-995、07:188-198 的 patch 文本）+ N3/N1/N2 设计补丁 + 三项拍板记录（P0-5 写入通道、P0-7 两个键、D5:36 fixture 改口） | 纯文档；阻塞 T5/T8/T9 |
| T2 | `yaml` 精确 `2.9.1` + `pnpm-lock.yaml` | 单提交，无前置；**第一条可动手** |
| T3 | converge 纯函数 + §8.1 单测（#7/#27）+ R13 模板空行 + `patch-runtime-merge.test.ts:161` 锚更新 + D2 的 approval-policy 模板行 | 依赖 T2 |
| T4 | provisioner 接线：`profile-lock.mjs`（`${pid}\n`+claim）、`.provision.lock` 新语义（exit 2）、步骤重排、备份 copy、写后校验、侧车（含 N1） | 必须一个提交；依赖 T3、T1 |
| T5 | 07 实现：workspace step `[3/9]` + `--repair-bridge` 扩展 + 负向 fail-fast 测试 + N4/N5 | 与 T4 同一临界区，紧随 |
| T6 | CI 门禁：第一 pass `! command -v dsh`、第二 pass（命令作用域 PATH + pins）、`verify-fresh-home-provision.mjs`、profile 名取常量 | 依赖 T5 |
| T7 | 写手退役 + `no-client-patch-writers` + ROLE/CARRY_GROUPS/providers 合并；`/login` 通道部分等 D8 | 必须先于改名；依赖 T1、T4 |
| T8 | 迁移：两源 + externalCarry + marker + `.migrated-from/` | 依赖 T4、T7；改名提交在其后 |

## 5. 未审（13 项，结转 6 + 新增 7）

结转：Windows 锁/rename；home patch 归属；06 §8 矩阵逐条；悬空 provider/model 运行时后果；rc.3 与 rc.5 `initProfile` 差异；launcher 6a 是否调用 `provisionAppendSystem`（只 grep 三目录，无定论）。

新增：`tool-result-pruner` volatile 前提（查错目录名，实际是 `dsh-compaction-tool-result-pruner`）；`.provision.lock` claim 协议真实并发行为；`mergeProvider` 结构校验与宿主 `provider.ts:30-64` 一致性；07 companion pins 新接口；`--repair-bridge` 扩展的调用方兼容性；§8.2-10 的 `--dry-run`；**launcher 预启动宿主用 `profile:'opentui'`（`bin/dsh-opentui.mjs:503`），需确认 adopt 的宿主实际跑在哪个 profile**（影响 06 的「运行中宿主读写 inproc profile」假设）。
