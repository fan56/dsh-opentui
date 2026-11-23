# Proof Report: batch-review-followups / oldfox 评审条件代码收尾

- Gate / 门禁: PASS（按最终 HEAD `13411a7` 原始证据改判；改判前 FAIL。门禁判据 scoped 全绿 / tui-base 全量 0 fail / typecheck 0 均有原始输出）
- Result / 结论: PASS（与 Gate 一致；改判前 FAIL。11 条中 7 条由最终 HEAD 具名 `(pass)` 一一对上改判 PASS；A4/B3/C1/C2 为结构/形态断言，原始 pass 输出不覆盖，维持 CLAIM）
- Profile(s): FEATURE（源码/引擎级）+ Unit(render)
- Change ref: `5f19087`（A1–A5：v2 copy 层配置 id + 无选区清空消费；同 commit 也属 r1b 切片）；`de33f46`（B1–B4：pickOne 转发 headerLine 到 description、撤销 title 拼接、settings source 精确匹配；同 commit 也属 batch-visual-fixups 切片 E2 最终态）；`0690166`（C1/C2：/history refill 加 trace、trace 短路守卫；同 commit 也属 b2b-trace-v2 切片）。
- Working tree: 本 agent 只新增本报告；未触碰他人未提交改动与 `r7-r8-subagent-brief/`。
- Expected registered (UTC): 2026-11-23T05:55:20Z（见 `00-preregistered-expected.md`，write-once）。
- Assertion total N: 11（A1–A5、B1–B4、C1–C2）
- Acceptance target（用户原话，本轮文档任务）: "内容必须**只依据盘上已有的一手证据**……没有证据的项如实标 NOT RUN / CLAIM"。切片目标（预注册原话）: "oldfox 评审条件代码收尾（batch-review-followups）"。

## 1. 切片目标与生效 commit

目标一句话：按 oldfox 对 R1/审批卡/B2 的评审条件，分别收尾 copy 层 id 化、picker description 提示、trace 短路与 /history 来源三处。

生效 commit 链（三者全部在 HEAD，均为最终态）：
- `5f19087` —— A1–A5。
- `de33f46` —— B1–B4（同时是 batch-visual-fixups E2 的最终形态，取代 98a5341 的 title 拼接）。
- `0690166` —— C1/C2（同时是 b2b-trace-v2 V2/V4 的最终形态）。

## 2. Gate / Result 表

**本目录证据现状：`.proof/batch-review-followups/` 自预注册落盘后从未添加任何 `.log`/`.out`/`.ans`/`.txt` 证据文件，目录内只有 `00-preregistered-expected.md`。** 预注册在元数据中写明「结构证据为测试源码断言 + 测试 stdout（本消息汇报）」——即证据只在实现方当时的汇报消息里，未落盘。按 W5「证据包规范」，消息叙述不算在档一手证据；`git show --stat` 只能证明「测试源码被改动」。

**最终 HEAD 复判（本轮）**：改判不依赖本目录，而是引用已入库的 `.proof/final-gate/` 原始输出与 `.proof/frame-pass-1123/` 真机帧。三个 commit 的实现落点相同（`5f19087`→A、`de33f46`→B、`0690166`→C），但最终 HEAD 的具名 `(pass)` 只对**行为断言**（A1/A2/A3/A5/B1/B2/B4）一一对上；**结构/形态/断言强度/调用点断言**（A4/B3/C1/C2）运行时 pass 明细无法证明其写法或形态，仍判 CLAIM。改判后 7 PASS / 4 CLAIM。

| id | 预注册 expected（摘要） | Result | 判定依据 | 证据文件 | 最终态归属 |
|----|------------------------|--------|----------|----------|-----------|
| A1 | v2 copy 层用 `id:"input.copy"`、无内联 bind；默认 ctrl+c 与 super+c 均触发 run | PASS | 最终 HEAD 具名 `(pass)` 一一对上：`.proof/final-gate/pertests/tui-base-composer-copy.out:15`（A1/A2 shipped view: named input.copy, no inline bind, clear+trace, id-anchored test）、`:4`（copy binding defaults）、`:21`（config id input.copy→ctrl+x 触发复制，无内联 bind） | `.proof/final-gate/pertests/tui-base-composer-copy.out:4,15,21` | 最终态以 5f19087 为准，具名 pass 覆盖 |
| A2 | 有字无选区且空闲 → `setText("")` + `composerSet("ctrl-c-clear",0)` + run true | PASS | 具名 `(pass)`：`pertests/tui-base-composer-copy.out:15`（A1/A2 clear+trace）、`:18`（A5 ② 无选区有字且空闲 → 清空且 write 0 次、不回落）、`:8`（E4b run() returns the boolean）；`ctrl-c-clear` 来源字面见 `pertests/tui-base-key-trace-v2.out:4` | `pertests/tui-base-composer-copy.out:8,15,18`, `pertests/tui-base-key-trace-v2.out:4` | 同上 |
| A3 | v1 注释删除「永久失活」、改「简化」表述 | PASS | 具名 `(pass)`：`pertests/tui-base-composer-copy.out:16`（A3 v1 comment: no 'permanently inactive' claim; simplification, not proven defect） | `pertests/tui-base-composer-copy.out:16` | 同上 |
| A4 | subagents-hotkey 按 layer id 锚定 + copy 层注释更正 | CLAIM | 结构/锚定方式断言：subagents-hotkey.out 的具名 pass（`:4-14`）覆盖键位/keymap/i18n/渲染提示行为，但**无一条点名「layer id 锚定」这一结构实现**；copy 注释更正 A3 已在相邻断言覆盖，不能替代本条的结构断言 | 无一条一一对上（行为 pass 见 `pertests/tui-base-subagents-hotkey.out:4-14`） | 最终态以 5f19087 为准，结构断言证据不覆盖 → 保持 CLAIM |
| A5 | A2 行为表 5 项引擎级覆盖（5 条新测试） | PASS | 具名 `(pass)` 五条一一对上：`pertests/tui-base-composer-copy.out:17`（①）、`:18`（②）、`:19`（③）、`:20`（④）、`:21`（⑤） | `pertests/tui-base-composer-copy.out:17-21` | 同上 |
| B1 | pickOne 转发 headerLine 到 DialogSelect `description` | PASS | 具名 `(pass)`：`pertests/tui-base-permission-picker-hint-ft.out:4`（en 60 列：提示在 description 行、title 不含提示、title 不折行）、`:5`（zh）、`:6`（/resume 列头走 description 行）。真机帧 `frame-pass-1123/05,06` | `pertests/tui-base-permission-picker-hint-ft.out:4-6`；帧 `frame-pass-1123/05,06` | 最终态以 de33f46 为准 |
| B2 | 撤销 defaultMarkerHint 并入 title，title 纯标题 | PASS | 具名 `(pass)`：`pertests/tui-base-permission-picker-hint-ft.out:4`（title 不含提示）、`:5`（title 纯标题）；batch-visual-fixups 的 `02-picker-hint.log` 仅证伪旧形态 | `pertests/tui-base-permission-picker-hint-ft.out:4,5` | 同上 |
| B3 | settings-panel source 断言由 `toContain` 改完整 `toBe` | CLAIM | 断言强度的结构变更（测试源码 `toContain`→`toBe`）无法由运行时 `(pass)` 输出证明——pass 行不体现断言写法；原始输出不覆盖该形态断言 | 无一条一一对上 | 同上，结构断言保持 CLAIM |
| B4 | permission-picker-hint-ft 按 description 槽重写（en 60 列 + zh + /resume 帧） | PASS | 具名 `(pass)`：`pertests/tui-base-permission-picker-hint-ft.out:4`（en 60 列）、`:5`（zh）、`:6`（/resume 列头 UPDATED/DIR/SESSION 走 description 行）；真机帧 `frame-pass-1123/05-permission-picker.ans`,`06-resume-header.ans`（§2 第 3/4 项 PASS） | `pertests/tui-base-permission-picker-hint-ft.out:4-6`；帧 `frame-pass-1123/05,06` | 同上 |
| C1 | /history onRefill setText 加 `composerSet("history"|"history-refill", ...)` | CLAIM | `key-trace-v2.out:4` 仅证枚举含 `history-refill`、sink 写 `steer-queue`，**无具名 pass 点名 `/history` onRefill 调用点写出该来源**；枚举覆盖不等于调用点覆盖 | 无一条一一对上（枚举 pass 见 `pertests/tui-base-key-trace-v2.out:4`） | 最终态以 0690166 为准，调用点断言证据不覆盖 → 保持 CLAIM |
| C2 | trace 关闭路径以 `keyTrace !== undefined` 短路、plainText 读在 guard 后 | CLAIM | `key-trace-v2.out:10`（V4 disabled env = zero behaviour）只覆盖「关闭零行为」行为面，与 b2b V4 同：冻结的「`!== undefined` 短路 + plainText 读在 guard 后」形态断言无具名 pass 一一对上，且最终态代码形态由 0690166 有意改写 | 无一条一一对上（行为 pass 见 `pertests/tui-base-key-trace-v2.out:10`） | 最终态以 0690166 为准，形态断言保持 CLAIM |

汇总（改判后）：PASS 7（A1,A2,A3,A5,B1,B2,B4） / FAIL 0 / NOT RUN 0 / CLAIM 4（A4,B3,C1,C2）。改判前：PASS 0 / FAIL 0 / NOT RUN 0 / CLAIM 11。A4/B3/C1/C2 均为结构/形态/断言强度或调用点断言，运行时 `(pass)` 明细无法一一对上，按纪律保持 CLAIM。

## 3. 原始输出指针（存在性 + sha256）

本目录**没有任何 `.log`/`.out`/`.ans`/`.txt` 证据文件可登记**。唯一在档文件：

| 文件 | sha256 | 说明 |
|------|--------|------|
| `00-preregistered-expected.md` | `ca4ce5cc498a413290df739fcf4c6fc40f737242813cf61f047930c72cd1b1cb` | 已入库预注册（唯一文件） |

相关但**不属于本目录**的证据（仅作交叉引用，不充当本切片判定依据）：
- `.proof/r1b-copy-consume/03-engine-tests.log`（`5d391a4b…`，抓于 5f19087 之前）
- `.proof/b2b-trace-v2/04-key-trace-v2-unit.log`（`261392a9…`，抓于 0690166 之前）
- `.proof/batch-visual-fixups/02-picker-hint.log`（`50707584…`，98a5341 的 title 旧形态）

三个 commit 的 `git show --stat` 已在父任务调查阶段核对（A1–A5→5f19087、B1–B4→de33f46、C1/C2→0690166），只能证明改动存在，不能证明行为通过。

## 4. 已知偏离与诚实声明

- **证据包缺失（最重要）**：预注册明确写「结构证据为测试源码断言 + 测试 stdout（本消息汇报）」，但汇报消息不属于可复核的在档证据；11 条断言无一条有本目录内的原始输出支撑。这是「预注册写了但没有任何证据支持」的全量清单。
- 预注册的基线「7 个 scoped 文件 226 pass / 0 fail」也只是文字记录，本目录没有对应 baseline log 文件。
- 预注册声明 NOT RUN：真机 tmux `.ans` 帧（本批靠 testRender 真帧，但档内同样没有 `.ans`）；bridge/seam/dock 不在判定域。
- 门禁预期要求 scoped 全绿、tui-base 全量 0 fail、typecheck 0；本目录没有这三类的任何运行输出，不能声称达成。其他切片目录的全量日志显示 tui-base 全量末尾存在 1 fail（approval card keys ADR-0011 T5a），故「全量 0 fail」也不成立。
- 不自行放宽 criterion、不以 commit --stat 代替测试结果、不补写没跑过的输出。

## 5. 主 agent（协调者）真机复验结论

依据 `.proof/frame-pass-1123/report.md`（最终包 sha `aff2afb9…`，13411a7）：B 面提示由真机帧 `05-permission-picker.ans`（§2 第 3 项「标题纯文本、提示在说明行」PASS）、`06-resume-header.ans`（第 4 项「列头 UPDATED/DIR/SESSION」PASS）直接覆盖，支持 B1/B2/B4 改判；A 面 copy 由帧 `02`/`03`（有选区复制）、`04`/`20`（无选区清空）覆盖，与 A1/A2 行为一致；§3 D1/D4/D7 记录根因与修复 commit 一致。C 面（trace）按 §4 第 7 项未做端到端真机取证，C1/C2 维持 CLAIM 与真机复验一致。A4/B3 为测试结构/断言强度断言，真机帧与运行时 pass 均无法证明写法，维持 CLAIM。

## 6. 最终 HEAD 复跑（13411a7）

数据来源：`.proof/final-gate/final-2/` 与 `.proof/final-gate/pertests/`。

- 三包全量（`final-2/03-full-*.out`）：shell 1356 pass / 5 skip / 0 fail；tui-base 1639 pass / 1 skip / 0 fail；bridge 381 pass / 0 fail。exit 均 0。
- typecheck：`final-2/04-typecheck-entry.out` exit 0（`00-summary-2.md:78`）——满足预注册门禁「typecheck 0」。
- 本切片相关明细 pass 计数：`pertests/tui-base-composer-copy.out:23-25` = 18 pass / 0 fail（A1/A2/A3/A5）；`pertests/tui-base-permission-picker-hint-ft.out:8-10` = 3 pass / 0 fail（B1/B2/B4）；`pertests/tui-base-subagents-hotkey.out:16-18` = 8 pass / 0 fail（A4 行为面，结构断言仍 CLAIM）；`pertests/tui-base-key-trace-v2.out:12-14` = 7 pass / 0 fail（C 面行为，形态断言仍 CLAIM）；`pertests/tui-base-settings-panel.out` 47 pass / 0 fail（B3 相邻面）。
- 真机帧：`frame-pass-1123/02,03,04,05,06,20`。
