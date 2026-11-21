# W4 — oldfox 评审协议

适用：每片 proof 汇总后、合并前，交 oldfox 做只读一手复验与分档裁决。前置：切片证据包已提交（[W5](w5-proof-evidence.md)）。评审者**只评审不改码**（全部负例/复跑在 /tmp 或 scratch，仓内零改动）。出处：`024-base-core-review-oldfox.md:4`、`024-s1-review-oldfox.md:4`、`024-day1-review-oldfox.md:9-11`。

## 一、评审方法（一手复验，非转抄）

- 报告 + 证据包 + 全量 diff 逐文件读；门禁脚本亲手重跑、CI `gh run view` 亲查、宿主源码一手抽核（`024-s4-review-oldfox.md:4`）。
- 等级沿用 **RED（必须改，阻断）/ AMEND（修订条款）/ GREEN（放行，记注意事项或勘误）/ concern / suggestion**（`024-day1-review-oldfox.md:11`）。
- 总裁决结构：先「先说结果」给 GREEN/RED + 例外三项分级处置；concern/suggestion 不拦门禁但登记去处（`024-s1-review-oldfox.md:5,32-52`）。
- 复核要害：生成链是否为真（服务名一手核验）、冻结面 git diff 空、断言非空转（负例自测）、CI headSha 对上、NOT RUN/JUDGMENT 无静默删除（`024-s1-review-oldfox.md:9-30`）。

## 二、RED 停车条款：授权面外一手事实即停

- 执行中若发现**超出授权面**的一手事实（某模块实际被更多存活面引用、删除面比甄别结论大、生产 boot 耦合），立即停下报告、不改码、不自作主张扩大删除面（`024-s6-legacy-slice.md:216,288,298`）。
- 先例：S6 Commit2 开闸后复核发现 `transport.ts`/`remote-host-session.ts` 是生产 boot 宿主连接面（`:1590,:1599,:1608,:1613,:1765,:1809`），超出裁决授权 → 回滚全部未提交改动、停车，交二次裁决（`024-s6-legacy-slice.md:288-305`）。
- 处置三选一交裁决：扩大授权面重写 / 收窄删除面保留 / oldfox 重裁；不自判（`024-s6-commit2-adjudication-oldfox.md:20-43`）。
- 与红线张力：红线「不删既有测试」语义是「不得删除仍有效的覆盖」，被测面消亡随删须登记、通用语义先迁移接管（A.5 口径，`024-s6-conflict-adjudication-oldfox.md:59-61`）；此口径一次写死，后续不逐文件请示。

## 三、裁决条款即终稿

- oldfox 裁决中的「可粘贴条款」写入计划/预注册后，**条款文本即终稿，免再评审轮次**（`024-day1-review-oldfox.md:17`、`024-day1-review-oldfox.md:107-115`）。
- 裁决落盘后按条款执行；执行中偏差如实记录（如 S6 Commit1 的 A.4.3 机制偏差：durable 记录无 live frame 类型，改用同一投影器，属机制校准非断言改动，D 条不触发重裁，`024-s6-legacy-slice.md:271`）。
- 裁决自我修正也入档：S6 冲突裁决 C.2 更正 S5 评审「section=no=无 stdio 入口」的误判，结论不变（`024-s6-conflict-adjudication-oldfox.md:82-84`）。

## 四、复验面怎么定

- **默认范围**：门禁全项 + 单测 + verify70（真实计数）+ 真机配方 + CI 三必需 job（`024-s6-conflict-adjudication-oldfox.md:92-104`）。
- **是否「底层架构变更」决定扩不扩**：渲染链下游零改动 → 不属底层变更，无需新增 e2e/扩大 verify70；风险集中在 fake transport 帧序保真，由 ft 断言本身守（`024-s6-conflict-adjudication-oldfox.md:94-104`）。若触及断言内容本身超过「零改动+时序差异说明」，停下重裁。
- **删除/换桥类**：换桥 commit 的门禁绿是后删 commit 的开闸条件，**两 commit 分立各过 CI**（`024-s6-conflict-adjudication-oldfox.md:104`）。
- **结构性删除后**增补完成性验证：grep 零命中断言、bin-launcher harness 等价断言、typecheck 基线重登（`024-s6-commit2-adjudication-oldfox.md:93-103`）。
- 采信 vs 亲验：干净 worktree+frozen-lockfile 全链若未复跑，可由 CI 三 job + Pack 冷启动在无软链 runner 上绿作旁证「采信」（`024-s6-review-oldfox.md:114`）。

## 五、分档法（verify70 红项裁决范式）

来源：`024-verify70-red-adjudication-oldfox.md:36-78`。

| 档 | 含义 | 处置 | 收敛时点 |
|---|---|---|---|
| `[S5]` | 结构性红：inproc seam 能力面按设计缺席（agents/settings/configSave/configLoad），非回归 | 豁免至 S5；S5 proof 必须 verify70 全量复跑、22 项逐项转绿，未转绿立 NOT RUN/缺陷票，禁止静默续豁免 | S5（config 面进 stdio 契约） |
| `[AG]` | 结构性红但切片归属未定（计划缺口：/agents 7 项无切片认领） | 与 S5 同批豁免，但**独立条目登记**，不藏 S5 名下蒙混 | S5 收敛；并入 v2.2 S5 范围（`dsh-opentui-024-delivery-plan.md:54`） |
| `[H]` | harness 级联/断言缺陷 | **不豁免**；修 harness 后下一次门禁复跑必须全绿，红即 FAIL | 随下一次任意切片门禁复跑 |
| `[R]` | 疑似真缺陷（click-to-focus） | **不豁免**；bisect 定责并修复，或显式缺陷票 + 复跑证据，二选一缺一即 FAIL | 立即（见 [W3](w3-defect-fix.md)） |
| `[M]` | 被掩蔽待复跑 | harness 修复后复跑定档 | 随 [H] 修复 |

门禁判定式（`024-verify70-red-adjudication-oldfox.md:12-35`）：环境项全 PASS 才进入判定；非豁免项全 PASS；豁免仅限 `[S5]`/`[AG]` 表内项且带清偿承诺；`[H]`/`[R]` 不计入豁免。35 红 = `[S5]15 + [AG]7 + [H]9 + [R]1 + [M]3`。harness 三处修复（submit C-u 精确清场 / 批次 fail-fast 守卫 / 80x24 `🧠→⌨` 定位器）后 23/58 → 36/58，13 项可恢复红全绿（`024-verify70-harness-fix.md:8-20`）。

## 六、预防条款（0.24 真实陷阱，就地归属）

1. **verify harness 自身缺陷分档（不可当能力面红豁免）**：执行者报告曾把 9 项 `[H]` 大部分笼统归入「seam 能力面不匹配」，oldfox 干净会话一手复跑证伪，纠正「级联红不得随 S5 豁免，否则门禁放水」（`024-verify70-red-adjudication-oldfox.md:80`）。预防：逐项对照帧证据 + 源码门控点 + 干净会话抽样复跑再定档；执行者不自判放行（S3 `024-s3-push-slice.md:101-107`）。
2. **stale 硬编码计数「70」当计数（验证记录失实）**：S6 报告 §二十写「verify70 70/70」，真实为 **64/64**；「70」唯一来源是 `scripts/real-client-gate.sh:4,254` 的 0.23 陈旧文案（脚本现文案已修为 64，`:254`）。根因：把脚本文案当真实项数，是「不冒充」纪律的单点破口（`024-s6-review-oldfox.md:63-73`）。预防：计数从 harness 输出动态取值或在报告用准确数；`real-client-gate.sh` 文案与实际计数同步；评审逐项核日志 PASS 行数（S5 评审逐行点数 64，`024-s5-review-oldfox.md:14`）。同类：check #10 成功消息硬编码 `(1/257)`（S1 suggestion，`024-s1-review-oldfox.md:54`；S3 已修动态，`024-s3-push-slice.md:68`）。
