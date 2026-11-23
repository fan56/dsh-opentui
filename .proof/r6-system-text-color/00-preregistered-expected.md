# PREREGISTRATION — R6 transcript 斜杠命令输出换色（write-once，捕获前落盘，never edited after capture）

本文件在任何实现改动与证据捕获之前写入磁盘。它是 R6 的冻结 `expected` 预测值。
正文 capture 后未改；observed 与判定写入后续报告，禁止回改本文件 `expected`。

- Preregistered at (UTC): 2026-11-23T01:28Z
- Worktree / branch: `/Users/qingguee/repo/dsh-opentui-wt-uibatch-1123` @ `feat/ui-batch-1123`
- Pre-change HEAD: `fff0a3b5d10844669406669419f7cd8b64888d18`（clean）
- 授权来源: `research/2026-11-23-ui-batch/00-decisions.md` §R6（用户已拍板）+ 实现任务书定案
- 适用流程: W5 预注册 + 验收制（JUDGMENT 只记录不拦）
- Background evidence: `research/2026-11-23-ui-batch/04-transcript-system-color-facts.md` 于本文件落盘时**不存在**（目录仅 `00-decisions.md`），按任务书给出的一手 file:line 定位执行：SeamRow 类型 `seam-rows.ts:71-162`、投影映射 `seam-rows.ts:554-595`、notice relay `seam-rows.ts:503-512`、颜色表 `transcript.tsx:278-312`、分派 `transcript.tsx:384-423`、过滤 `transcript.tsx:379-382`、say 注入 `examples/v2-entry.tsx:852-859`。一手事实若与定位不符，停下报协调者，不自行绕过。
- Evidence directory: `.proof/r6-system-text-color/`
- 证据约定: `*.log` 为 gitignored 采集日志；唯一入库断言文件为本文件。

## 变更面与不变量

- 变更: `packages/tui-base/src/routes/session/seam-rows.ts`（SeamRow 类型 + `message.part.updated` 投影）；`packages/tui-base/src/routes/session/transcript.tsx`（颜色表 + `rowView` 分派）；`packages/tui-base/src/routes/session/search-overlay.tsx`（穷尽 switch 补 system 分支）；单测文件。
- 范围锁定: 只算斜杠命令与其输出（`messageID === "cmd"` 的 text part）。工具执行行（`kind:"tool"`）、子代理状态行（`kind:"subagents"`）、notice relay（`role:"notice"` → assistant）一律不动。
- 渲染约束: system 行用 `<text fg={...}>` 纯文本，**不得**用 `<markdown>`（避免 `#` / `*` 被解释），保留 `row.text` 原文含换行。

## 预注册 expected（E1–E6，机器可判、环境无关）

| id | assertion | expected（FROZEN，捕获前填） | pass criterion（checkable，禁环境依赖子句） | changed path | level | evidence file | depends on |
|----|-----------|------------------------------|--------------------------------------------|--------------|-------|---------------|------------|
| E1 | SeamRow 判别联合新增 system 成员 | 类型联合含 `{ key: string; kind: "system"; text: string; final: true }`；`toStoredRow` 不产生 system（只由 cmd 投影产生） | 单测构造 `const r: SeamRow = { key:"s", kind:"system", text:"x", final:true }` 经 `bun run typecheck` exit 0；源码断言联合含 `kind: "system"` | `packages/tui-base/src/routes/session/seam-rows.ts:71-162` | Unit | `04-bun-test.log`, `05-typecheck.log` | — |
| E2 | cmd 行投影为 system | `projection.apply({ type:"message.part.updated", details:{ messageID:"cmd", part:{ type:"text", id:"cmd-1", text:"model switched" } } })` → `projection.rows.at(-1)` 精确为 `{ key:"system:cmd:cmd-1", kind:"system", text:"model switched", final:true }` | 单测 exact equality（含 key/kind/text/final 四字段），且重复同 partID 的 upsert 不新增行 | `seam-rows.ts:554-595` | Unit | `04-bun-test.log` | E1 |
| E3 | notice relay 不受影响 | `role:"notice"` 事件投影仍精确为 `{ key:"notice:<id>", kind:"assistant", text, final:true }` | 既有 notice 单测原文断言 exact equality 保持绿，未改期望值 | `seam-rows.ts:503-512` | Unit | `04-bun-test.log` | — |
| E4 | assistant 正文 / user 行 / interrupted 行不受影响 | 普通 assistant text part 仍 `kind:"assistant"`；`role:"user"` 仍 `kind:"user"`；`bridge.turn.interrupted` 仍 `kind:"interrupted"` 且 `seq:null` | 单测对上述三类各断言 `kind` 与关键字段 exact equality；既有相关用例保持绿 | `seam-rows.ts:554-595`（assistant）, `:513-552`（user）, `:613-`（interrupted） | Unit | `04-bun-test.log` | — |
| E5 | transcript 用 info 色纯文本渲染 system 行 | 颜色表含 `system: () => theme?.text.feedback.info.base ?? "#565f89"`；`rowView` 含 `case "system"` 返回 `<text fg={color.system()}>{row.text}</text>`，该 case 块内不含 `<markdown` 字符串 | 源码级单测对 `transcript.tsx` 文本做断言：`case "system"` 存在、紧邻 `<text` 且 `fg={color.system()}`、该 case 段无 `<markdown`；`visibleRows` 过滤仍不含 system（黑名单仅 tool/reasoning/subagents） | `transcript.tsx:278-312, 379-382, 384-423` | Unit | `04-bun-test.log` | E1 |
| E6 | 全消费方补齐 + 门禁绿 | `rowSearchText` 穷尽 switch 含 `case "system"` 返回 `row.text`；其余消费方（widgets-dock / merged-dock / lastrequest-dock / think-panel / examples / shell fixture）为 `Extract` 或布尔过滤，无穷尽分支需补；`bun test`（tui-base / shell）exit 0；两包 `bun run typecheck` exit 0 | 命令 exit code 均为 0；源码断言 search-overlay `case "system"` 存在；`git diff` 中 notice relay `:503-512` 与 `void dockSpin()` 类无关点逐字保留 | 上述消费方 + `04-bun-test.log`, `05-typecheck.log` | Gate | `04-bun-test.log`, `05-typecheck.log`, `06-diff.log` | E1–E5 |

## 门禁预期（技术门禁全绿即 PASS）

- `bun test`（tui-base / shell）：exit 0，无失败用例；既有断言 cmd 为 assistant 的用例同步更新并在测试注释注明「R6：cmd 行改 system，颜色 info，非 markdown」。
- `bun run typecheck`（tui-base / shell）：exit 0（穷尽 switch 缺 system 分支会以返回类型错误暴露）。
- `git status`：仅含本刀授权文件；剔除无关文件；单 commit，禁止 push。
- commit message: `feat(transcript): render slash-command output as system rows in info color`。

## USER-JUDGMENT 预案（≤5 项；记录 + 默认，不进技术门禁）

- U1（视觉布局／真机项）：system 行颜色用 `text.feedback.info.base`（solarized/nord 两主题均有值，零主题 JSON 改动），真机深浅是否合适。**用户已拍板先用 info.base**；推荐默认：按拍板保持，验收可调。本项只记录，不拦技术门禁。
- U2（文案措辞／真机项）：cmd 输出含 `#` / `*` 时以纯文本显示、不被 markdown 解释，真机核对可读性。推荐默认：纯文本原样输出（已由 E5 锁死）。

## NOT RUN 声明

- 真机 tmux `capture-pane -e -p` 抓帧由主 agent 在真机配方阶段做；本刀只落机器可判的单测 / 类型检查 / 源码形状证据，不伪造真机帧。
- 本刀不跑 `check-capcontract` / `real-client-gate` / pack 阶梯：改动限于 transcript 行投影 / 渲染与单测，未触碰 CapIR / wire / 分发面。
- `research/2026-11-23-ui-batch/04-transcript-system-color-facts.md` 不存在，未编造其内容；仅按任务书 file:line 一手定位推进，如实际代码与之不符则停下上报。

## PASS 判定式

E1–E6 全达成 ∧ 技术门禁（bun test / typecheck）全绿 ∧ JUDGMENT（U1、U2）有裁决记录 ∧ NOT RUN 已如实声明 → PASS。
USER-JUDGMENT 只记录不拦；红就红着报，不放水。
