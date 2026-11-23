# Proof Report: batch-review-followups / oldfox 评审条件代码收尾

- Gate / 门禁: FAIL
- Result / 结论: FAIL  （与 Gate 一致；原因：断言无任何在档一手原始证据，CLAIM 不能撑起 PASS）
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

**关键事实：本切片证据目录 `.proof/batch-review-followups/` 自预注册落盘后从未添加任何 `.log`/`.out`/`.ans`/`.txt` 证据文件，目录内只有 `00-preregistered-expected.md`。** 预注册在元数据中写明「结构证据为测试源码断言 + 测试 stdout（本消息汇报）」——即证据只在实现方当时的汇报消息里，未落盘。按 W5「证据包规范」与本轮任务纪律，消息叙述不算在档一手证据；`git show --stat` 只能证明「测试源码被改动」，不能证明断言通过。因此 11 条断言全部判 CLAIM。

| id | 预注册 expected（摘要） | Result | 判定依据 | 证据文件 | 最终态归属 |
|----|------------------------|--------|----------|----------|-----------|
| A1 | v2 copy 层用 `id:"input.copy"`、无内联 bind；默认 ctrl+c 与 super+c 均触发 run | CLAIM | 预注册断言；对应 commit `5f19087` 改了 `examples/v2-entry.tsx` 与 `composer-copy.test.ts`，但**无测试 stdout 落盘** | 无（仅 `git show 5f19087 --stat`） | 最终态以 5f19087 为准 |
| A2 | 有字无选区且空闲 → `setText("")` + `composerSet("ctrl-c-clear",0)` + run true | CLAIM | 同上；无引擎级日志 | 无 | 同上 |
| A3 | v1 注释删除「永久失活」、改「简化」表述 | CLAIM | 源码级断言；`5f19087` 改了 `component/prompt/index.tsx`，无源码扫描/测试输出落盘 | 无 | 同上 |
| A4 | subagents-hotkey 按 layer id 锚定 + copy 层注释更正 | CLAIM | 源码级断言；无测试输出落盘 | 无 | 同上 |
| A5 | A2 行为表 5 项引擎级覆盖（5 条新测试） | CLAIM | `5f19087` 在 `composer-copy.test.ts` 加 156 行（--stat 可见），但**5 条用例的运行 stdout 不在档** | 无 | 同上 |
| B1 | pickOne 转发 headerLine 到 DialogSelect `description` | CLAIM | `de33f46` 改了 `v2-entry.tsx` 与 `permission-picker-hint-ft.test.tsx`，无 FT 帧/测试 stdout 落盘 | 无 | 最终态以 de33f46 为准 |
| B2 | 撤销 defaultMarkerHint 并入 title，title 纯标题 | CLAIM | `de33f46` 改了 `commands.ts`；batch-visual-fixups 的 `02-picker-hint.log` 只证伪旧 title 拼接形态，不证新形态 | 无 | 同上 |
| B3 | settings-panel source 断言由 `toContain` 改完整 `toBe` | CLAIM | `de33f46` 改了 `settings-panel.test.ts` 6 行；无测试 stdout 落盘 | 无 | 同上 |
| B4 | permission-picker-hint-ft 按 description 槽重写（en 60 列 + zh + /resume 帧） | CLAIM | FT 帧未落盘；预注册声明本批靠 testRender 真帧捕获，但档内无 `.ans` | 无 | 同上 |
| C1 | /history onRefill setText 加 `composerSet("history"|"history-refill", ...)` | CLAIM | `0690166` 改了 `v2-entry.tsx` 3 行、`key-trace.ts` 6 行；b2b-trace-v2 的 `04-key-trace-v2-unit.log` 抓于 13:11、早于该 commit（14:07），不含 C1 用例结果 | 无 | 最终态以 0690166 为准 |
| C2 | trace 关闭路径以 `keyTrace !== undefined` 短路、plainText 读在 guard 后 | CLAIM | `0690166` 改了 `session-composer.tsx`；同上，无该 commit 之后的关键字追踪测试日志落盘 | 无 | 同上 |

汇总：PASS 0 / FAIL 0 / NOT RUN 0 / CLAIM 11。

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

## 5. 主 agent（协调者）真机复验结论（留空占位）

见 .proof/frame-pass-1123/report.md（主 agent 抓帧验收报告）。
