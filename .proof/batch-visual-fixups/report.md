# Proof Report: batch-visual-fixups / 真机抓帧视觉缺陷修包

- Gate / 门禁: FAIL
- Result / 结论: FAIL  （与 Gate 一致）
- Profile(s): FEATURE + Unit(render) + Gate
- Change ref: `95a116b`（E1 首版长文案——**已被真机复验打回**）；`df699fe`（E1 最终态：always/session 短按钮 + 卡正文图例）；`98a5341`（E2 首版：提示并入 title——**其 title 拼接已被 de33f46 取代**）；`de33f46`（E2 最终态：pickOne 转发 headerLine 到 description、title 恢复纯标题）。最终态以 HEAD 上 `df699fe` + `de33f46` 为准。
- Working tree: 本 agent 只新增本报告；`packages/i18n/locales/*.json` 等他人未提交改动未触碰。
- Expected registered (UTC): 2026-11-23T04:49Z；附则（打回裁决）2026-11-23（见 `00-preregistered-expected.md`，write-once）。
- Assertion total N: 4（E1–E4）
- Acceptance target（用户原话，本轮文档任务）: "内容必须**只依据盘上已有的一手证据**……没有证据的项如实标 NOT RUN / CLAIM"。切片目标（预注册原话）: "真机抓帧视觉缺陷修包（审批卡文案折行 + 两处提示不渲染）"。

## 1. 切片目标与生效 commit

目标一句话：修审批卡按钮 60 列折行，以及 /permission picker 提示与 settings scope 提示不渲染的两处缺陷。

生效 commit 链（最终态以 HEAD 为准）：
- `95a116b` "fix(ask): fit session verdict labels on one line" —— E1 首版长文案，**真机 80 列复验打回**。
- `df699fe` "fix(ask): short verdict buttons with plain-language legend in card body" —— **E1 最终态**：按钮回退 `always`/`session`，大白话移到卡正文 `alwaysHint`/`sessionHint` 图例。E1 冻结的长句文案值已被它取代。
- `98a5341` "fix(settings): surface permission scope hints (picker header + settings row)" —— E2 首版，把 defaultMarkerHint 拼进 `/permission` title。
- `de33f46` "fix(dialog): pickOne forwards headerLine to description slot (oldfox)" —— **E2 最终态**：title 恢复纯 `t("command.permission.pickerTitle")`，提示走 `description: headerLine`。E2 冻结的「提示并入 title」已被它取代；同 commit 还把 settings-panel 的 source 断言改精确（B3）。

## 2. Gate / Result 表

| id | 预注册 expected（摘要） | Result | 判定依据 | 证据文件 | 最终态归属 |
|----|------------------------|--------|----------|----------|-----------|
| E1 | 审批卡 [a]/[s] 缩短且有长度预算：zh「此工具本会话免问」/「写操作本会话全放行」、en「this tool, this session」/「all write tools, this session」；四键精确值 + 渲染整串不折 | CLAIM | `01-ask-labels.log:4-11` 是**打回前**长文案的 3 pass/0 fail；附则裁决后已改为 always/session + 卡正文图例，最终形态在**本目录无新渲染日志/帧** | `01-ask-labels.log:4-11`（旧形态）；最终形态见 `git show df699fe`，无同目录原始输出 | **最终态以 df699fe + 附则为准** |
| E2 | picker title 含 defaultMarkerHint 文案，headerLine 第 3 参仍在；渲染含「当前档以宿主为准」/「host-side」 | CLAIM | `02-picker-hint.log:4-9` 是**98a5341 的 title 拼接**形态 2 pass/0 fail；de33f46 已撤销 title 拼接、改走 description，最终形态在**本目录无新日志/帧** | `02-picker-hint.log:4-9`（旧形态）；最终形态见 `git show de33f46`，无同目录原始输出 | **最终态以 de33f46 为准** |
| E3 | settings permission scope 提示在聚焦行/编辑态可见，note 与 source 都含 scope 文案 | PASS | `03-settings-hint.log:76`（"permission.defaultPreset scope hint is painted on focus and in the editor (2b)" PASS）；`03-settings-hint.log:108-111`（101 pass / 0 fail）。行为面 source 在 de33f46 未改 | `03-settings-hint.log:76,108-111` | 行为仍成立；de33f46 的 B3「toContain→toBe 精确断言」变更无新日志 |
| E4 | scoped 测试 + typecheck 全绿；**2 个 commit**且 message 逐字一致；冻结面零 diff；无 push | FAIL | `04-gate.log:1-4` typecheck exit=0、`:271-274` 253 pass/0 fail；但 `04-gate.log` **无任何 git log / git diff / push 原始输出**，且实际本片有 4 个 commit（含打回的 95a116b、更名后的 df699fe），与冻结的「2 commit + 逐字 message」不符 | `04-gate.log:1-4,271-274`；commit 事实见 `git log --format=%s` | 门禁不确定项按 FAIL 处理 |

汇总：PASS 1（E3） / FAIL 1（E4） / NOT RUN 0 / CLAIM 2（E1,E2）。

## 3. 原始输出指针（存在性 + sha256）

| 文件 | sha256 | 说明 |
|------|--------|------|
| `01-ask-labels.log` | `5867c8d96c1920575e42be3e5ba380cc0761d6e23f09b99293c90d5f4db2c391` | 打回前长文案 render 3 pass/0 fail |
| `02-picker-hint.log` | `507075840e9130e0c9974e64c04726e527da7e62a78dad2141eb3c10a73d0349` | 98a5341 title 拼接 2 pass/0 fail（已被 de33f46 取代） |
| `03-settings-hint.log` | `16d61c49b56941e20558fda6fdbc4cc25d652dc4a82b38f1cc585bcbf9e9451d` | settings-panel 101 pass/0 fail，含 2b scope 提示 |
| `04-gate.log` | `7070a1831fb4adf687c98157ff58944cc77c17c97b848ec4aee41094cebbc386` | typecheck exit=0 + scoped 253 pass/0 fail（无 git 证据） |
| `00-preregistered-expected.md` | `224a2afd68f0a703547d6f3b78e0e5db5e7500223b7228a4006317c9be3bea3a` | 已入库预注册（含打回附则） |

## 4. 已知偏离与诚实声明

- **E1/E2 证据是“被打回/被取代形态”**：本目录四份 log 抓于 12:55–12:56，均早于 df699fe（13:19）与 de33f46（14:07）。E1 冻结的长文案、E2 冻结的 title 拼接都已被后续 commit 改掉，最终形态在本目录**没有任何原始输出**（附则只写「渲染帧见最终汇报」「scoped 383 pass」）。按纪律标 CLAIM，不把旧形态的绿冒充最终态。
- **附则的「全量 1610 pass / 1 skip / 0 fail」无在档日志**：本目录没有全量运行输出；而其他切片目录的全量日志（`.proof/b2b-trace-v2/07-full-tui-base-tests.log`、`.proof/r1b-copy-consume/03b-full-tui-base.log`）末尾均为 **1608 pass / 1 skip / 1 fail**（approval card keys ADR-0011 T5a），与附则自报的「0 fail」矛盾。该自报数不采信为证据。
- **E4 commit 纪律字面不成立**：预注册冻结「2 个 commit、message 逐字 `fit session verdict labels on one line` / `surface permission scope hints`」，实际本片 4 个 commit 且含更名后的 df699fe；04-gate.log 也没有 `git log -2` / `git diff 冻结面` / 远端 SHA 的输出，三项无法机器判定，按 FAIL 处理。
- **真机抓帧验收为预注册 NOT RUN**：本刀只做 render 级机器断言，真机 tmux `.ans`、verify70/握手/CAP_SMOKE 不在范围，留给主 agent。
- U1–U4（措辞/布局/技术取向）预案记录 + 默认，不进门禁；U1 的「真机观察后缩短」已被触发并升级为 df699fe 的布局裁决。

## 5. 主 agent（协调者）真机复验结论（留空占位）

见 .proof/frame-pass-1123/report.md（主 agent 抓帧验收报告）。
