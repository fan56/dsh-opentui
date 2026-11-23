# Proof Report: r1b-copy-consume / 选区 + C-c 必须被复制消费而非清空

- Gate / 门禁: PASS（按最终 HEAD `13411a7` 原始证据改判；改判前 FAIL）
- Result / 结论: PASS（与 Gate 一致；改判前 FAIL）
- Profile(s): FEATURE + 真机 tmux 帧
- Change ref: `84b2ce7`（首个修复：v2 composer 挂 copy 层）；`5f19087`（最终生效：copy 层改用配置 id、无选区+有字+空闲改为清空并消费 + trace）。两个 commit 均在本切片范围内。
- Working tree: 本 agent 只新增本报告；工作树另有他人未提交改动（`packages/i18n/locales/*.json`、`merged-dock.ts`、`widgets-dock.tsx` 等），未触碰。
- Expected registered (UTC): 2026-11-23T04:55Z（见 `00-preregistered-expected.md`，write-once）。
- Assertion total N: 5（F1–F5）
- Acceptance target（用户原话，本轮文档任务）: "内容必须**只依据盘上已有的一手证据**……没有证据的项如实标 NOT RUN / CLAIM，不许补写没跑过的结果"。切片目标（预注册原话）: "selection + C-c must be consumed by copy, never clear"。

## 1. 切片目标与生效 commit

目标一句话：让输入框选区存在时 C-c 触发复制并消费按键、不清空/不退出；无选区时保持既有清空/退出行为。

生效 commit 链（最终以 HEAD 为准）：
- `84b2ce7` "fix(composer): ctrl+c consumes selection instead of clearing (R1 followup)" —— 首个实现。
- `5f19087` "fix(composer): copy via config id, clear-on-ctrl+c with text (oldfox R1 followup)" —— **最终态以它为准**。它把 copy 层从内联 `bind: "ctrl+c"` 改为 `id: "input.copy"`，并把「无选区+有字+空闲」从回落页面退出改成层内 `node.setText("")` + `keyTrace?.composerSet("ctrl-c-clear", 0)` 且消费按键。预注册 F4 描述的 "copy 层 run 返回 false 回落 clear" 已被此 commit 的 A2 行为取代。

## 2. Gate / Result 表（每条预注册 expected 一行）

判定口径：Result 按**最终 HEAD 生效实现**判定；早期 commit 的证据仅作历史基线，最终态无一手原始输出者标 CLAIM。

| id | 预注册 expected（摘要） | Result | 判定依据（原始输出行 / 测试） | 证据文件 | 最终态归属 |
|----|------------------------|--------|------------------------------|----------|-----------|
| F1 | 修复前选区+C-c 不写剪贴板、落到 quit/clear 链 | PASS | 第 7–20 行：选区高亮在，`pbpaste` 保持 `SENTINEL_OLD2`，C-c 后弹出退出确认框，无复制 | `.proof/r1b-copy-consume/01-repro-before.log` | 基线，未随后续 commit 变化 |
| F2 | 根因：copy 层不在发行 v2 bundle；enabled 混用 signal/非 signal | PASS | 第 3–11 行：sourcemap 无 `component/prompt/*`；第 13–23 行 secondary IIFE 分析；engine 第 9–13 行 | `02-rootcause.log`, `03-engine-tests.log:9-13` | 历史定位 |
| F3 | 修复后选区+C-c 复制成功、输入保留、无退出框 | PASS | 第 8–27 行：`pbpaste` 依次为 `R1BAFTERFIX`、`R1BAFTERFIXFINALPROBE`；border `┃`；quit dialog = 0 | `04-repro-after.log`, `05-clipboard-direct.log:8-15` | 帧摄于 84b2ce7 期构建；5f19087 未改选区→复制分支 |
| F4 | 无选区 C-c 行为不变（回落 clear，不写剪贴板） | PASS | 最终 HEAD 具名 `(pass)` 一一对上最终态 A2 行为：`.proof/final-gate/pertests/tui-base-composer-copy.out:18`（A5 ② 无选区有字且空闲 → 清空且 write 0 次、不回落）、`:15`（A1/A2 named input.copy, no inline bind, clear+trace）、`:6`（E3 no selection → no write）。机制由「回落 clear」被 5f19087 改为层内清空并消费，但可观察行为（不写剪贴板、清空、不退出）已被具名用例覆盖 | `.proof/final-gate/pertests/tui-base-composer-copy.out:6,15,18`；真机帧 `frame-pass-1123/04-after-clear.ans`,`20-compact-cleared-by-ctrl-c.ans` | **最终态以 5f19087 A2 为准；预注册 F4 机制描述已被取代，按可观察行为改判 PASS** |
| F5 | 新增引擎单测 pass + tui-base 既有全绿 + typecheck 0 | PASS | 三项在最终 HEAD 均被原始输出覆盖：引擎单测 `pertests/tui-base-composer-copy.out:23-25`（18 pass / 0 fail）；tui-base 全量 `final-2/03-full-tui-base.out` 末尾 1639 pass / 1 skip / **0 fail**；typecheck `final-2/04-typecheck-entry.out` + `00-summary-2.md:78` exit 0。改判前依据的 `03b-full-tui-base.log` 2 fail / `06-typecheck.log` exit=2 均为 5f19087 之前的陈旧结果 | `.proof/final-gate/pertests/tui-base-composer-copy.out:23-25`, `.proof/final-gate/final-2/03-full-tui-base.out`, `.proof/final-gate/final-2/04-typecheck-entry.out`, `.proof/final-gate/00-summary-2.md:78` | 预注册 PASS 判定式 "全绿 + typecheck 0" 在最终 HEAD 达成 |

汇总（改判后）：PASS 5（F1,F2,F3,F4,F5） / FAIL 0 / NOT RUN 0 / CLAIM 0。改判前：PASS 3（F1,F2,F3） / FAIL 1（F5） / CLAIM 1（F4）。

## 3. 原始输出指针（存在性 + sha256）

`*.log` 按 `.gitignore:4` 被忽略，不入库；此处登记文件名与完整 sha256 以证明存在与内容未改。

| 文件 | sha256 | 说明 |
|------|--------|------|
| `01-repro-before.log` | `dfb49b93faf4a6190b2ff5bc387b6773b6ff98e74178510000d49b8ebf57f7ba` | 修复前真机反例 |
| `02-rootcause.log` | `e9ef9cc35531d80ba807cfc6753b05a62eae5547f234e54813099898cc1f431d` | 一手根因 |
| `03-engine-tests.log` | `5d391a4bb1da1450e7a22b730b618b886239800f0d60041e54349fde79535704` | 引擎单测 11 pass |
| `03b-full-tui-base.log` | `1314011034e7caa1e25d4b52464b7adb66eb9959781fef9b0ea9329c9533bebc` | 全量 1600 pass/2 fail |
| `04-repro-after.log` | `2374d515b96f3797bc5058ad0bfce731f88c8b357da1f0cad1457a4f6fdb8c1b` | 修复后真机帧 |
| `05-clipboard-direct.log` | `bd8ced990df0120d2ed61fe3cc64ca500a9d39da5256aeba14147af36a447b76` | 剪贴板后端说明 |
| `06-typecheck.log` | `7248383bd8010fe130d8eccea8f537155b58478bd218545f95525d3d2665cf7a` | typecheck exit=2（基线既有） |
| `00-preregistered-expected.md` | `97382c056416560652e460d17649a2bd57bbdc41978e3e3cdd5361c21de5eb37` | 已入库预注册 |

## 4. 已知偏离与诚实声明

- F1 冻结 expected 含「输入行被清空」；`01-repro-before.log:12-20` 实测为「退出确认框弹出、draft 未立即擦除」，日志已如实记录与 main agent 早期观察的差异。判 PASS 仅基于「未复制到剪贴板」这一核心。
- F2 冻结 expected 把根因落在 `enabled` IIFE；一手定位（`02-rootcause.log:3-11`）显示**主因是 v1 copy 层根本不在发行 v2 bundle**，IIFE 只是 v1 的潜伏次要问题（`02-rootcause.log:13-23`）。
- F3 真机帧摄于 `84b2ce7` 期重建包；最终 `5f19087` 改的是无选区分支与配置 id，未对本切片重抓帧。
- `06-typecheck.log` 为基线既有错误集（exit=2），非本刀新增；预注册「typecheck 0」字面未达成，不自创豁免。
- 真机超+F 选区、物理鼠标事件：未在本切片的 own tmux server 驱动（预注册未列，非本刀范围）。

## 5. 主 agent（协调者）真机复验结论

依据 `.proof/frame-pass-1123/report.md`（最终包 sha `aff2afb9…`，13411a7）§2 第 1/2 项：帧 `02`/`03` 对应「有选区 ctrl+c → 写剪贴板、输入保留、不弹退出框」PASS（pbpaste=`ARCHIVE-COPY-9`），帧 `04`/`20` 对应「无选区有字 ctrl+c → 清空输入行、不弹退出框」PASS。两帧直接覆盖 F4 的最终态可观察行为，真机复验与本切片最终态判 PASS 一致。F1/F2 为修复前基线定位，真机复验报告 §3 D1 亦记录同一缺陷与修复 commit，一致。无相反证据。

## 6. 最终 HEAD 复跑（13411a7）

数据来源：`.proof/final-gate/final-2/`（13411a7 那轮三包全量）；逐条明细取自 `.proof/final-gate/pertests/`。

- 三包全量（`final-2/03-full-*.out`）：shell **1356 pass / 5 skip / 0 fail**（1361 tests / 85 files，exit 0）；tui-base **1639 pass / 1 skip / 0 fail**（1640 tests / 115 files，exit 0）；bridge **381 pass / 0 fail**（381 tests / 33 files，exit 0）。exit 见 `final-2/03-full-*.exit`。
- typecheck：`final-2/04-typecheck-entry.out`，exit 0（`00-summary-2.md:78`）。
- 本切片相关明细：`pertests/tui-base-composer-copy.out:23-25` = **18 pass / 0 fail**（含 F4 的 `:6,15,18` 与 A5 行为表 `:17-21`）；`tui-base-subagents-hotkey.out` 8 pass / 0 fail（F5 判定式「tui-base 全绿」的交叉印证，见 batch-review-followups A4）。
- 真机帧：`frame-pass-1123/02,03,04,20`。
