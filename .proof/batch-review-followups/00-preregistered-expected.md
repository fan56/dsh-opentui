# 预注册 — oldfox 评审条件代码收尾（batch-review-followups）

> 本文件在**任何实现/证据捕获前**落盘（W5 §一），`never edited after capture`。
> 正文一次成文；节内时间戳为落盘顺序记录，非逐节顺写。
> 分支 `feat/ui-batch-1123`；预注册时 HEAD `65420585d9f167e7c6da4f84f7a6b3c57a593ec5`；
> 落盘 UTC `2026-11-23T05:55:20Z`。时间盒 35 min。
> 单刀集中改（`v2-entry.tsx` 的 copy 层与 pickOne 两段同一文件），按 concern 分 3 commit。

## 元数据

- CapIR 方法集：不适用（本批是已发行 UI 的缺陷收尾，非 CapIR 切片）。
- provenance：oldfox 评审条件（commit 84b2ce7 / 98a5341 / 75999cf 的 followup）。
- wired 面：发行入口 `packages/tui-base/examples/v2-entry.tsx` 的 copy 层与 pickOne。
- @manual 计数预期：无（不新增 @manual）。
- 删除面：撤销 `commands.ts` 中把 defaultMarkerHint 并入 `/permission` picker title 的写法。
- 宿主版本：bundled en/zh locale（`packages/i18n/locales/*.json`）；Node/Bun 测试环境。
- 证据目录：`.proof/batch-review-followups/`；结构证据为测试源码断言 + 测试 stdout（本消息汇报）。

## 基线（改动前，先于此文件捕获）

`cd packages/tui-base && bun test` 7 个 scoped 文件（composer-copy / subagents-hotkey /
permission-picker-hint-ft / settings-panel / commands / key-trace-v2 / approval-card-ft）：
**226 pass / 0 fail**。基线红证据：发行 v2 的 copy 层仍为内联 `bind: "ctrl+c"`（无 `id`），
`component/prompt/index.tsx:981-988` 仍含「编译成永久失活」措辞，`pickOne` 未转发 `headerLine`，
`/permission` title 仍拼接 defaultMarkerHint。

## Expected 表（E1–En，机器可判）

| id | assertion | expected (FROZEN) | pass criterion (机器可判) | changed path | level | evidence file | depends on |
|---|---|---|---|---|---|---|---|
| A1 | v2 copy 层命令用配置 id，不内联 bind | `id: "input.copy"`，无 `bind: "ctrl+c"` | 源码断言：copy 层含 `id: "input.copy"` 且同对象不含 `bind:`；keymap 引擎级：默认 `ctrl+c` 与 `super+c` 均触发 run | examples/v2-entry.tsx | 引擎级 | test/composer-copy.test.ts | — |
| A2 | 有字无选区且空闲 → 清空并消费 | `setText("")` + `keyTrace?.composerSet("ctrl-c-clear", 0)` + run 返回 true | 引擎级：无选区+有字+空闲 → write 0 次、清空调用 1 次、低优先层未触发；空输入/turn busy → run 返回 false 回落 | examples/v2-entry.tsx, util/key-trace.ts | 引擎级 | test/composer-copy.test.ts | A1 |
| A3 | v1 注释如实表述 | 删除「永久失活」断言，改为「简化，非已证实缺陷修复」 | 源码断言：注释不含「永久失活」；含「简化」与 cursorVersion 重注册事实 | component/prompt/index.tsx | 源码级 | test/composer-copy.test.ts | — |
| A4 | subagents-hotkey 按 layer id 锚定 + copy 层注释更正 | slice 由 `id: "session.subagents"` 锚定；copy 层注释说明位置无功能意义、keymap 按 priority 排序 | 源码断言：测试不再以首个 `Keymap.createLayer` 为切片起点；copy 层注释含 priority 排序表述 | test/subagents-hotkey.test.tsx, examples/v2-entry.tsx | 源码级 | test/subagents-hotkey.test.tsx | — |
| A5 | A2 行为表 5 项引擎级覆盖 | 5 条新测试 | 真 keymap 引擎：①有选区→write+不清空 ②无选区有字空闲→清空+write0+不回落 ③无选区空输入→false ④busy 无选区→false ⑤input.copy 改键 ctrl+x 后 ctrl+x 触发复制 | test/composer-copy.test.ts | 引擎级 | test/composer-copy.test.ts | A1,A2 |
| B1 | pickOne 转发 headerLine 到 description | DialogSelect 调用带 `description: headerLine` | 源码断言：pickOne 的 createComponent(DialogSelect) 含 `description: headerLine`；FT 帧：/permission 提示出现在 description 行、title 不含提示、60 列不折行 | examples/v2-entry.tsx | FT/源码级 | test/permission-picker-hint-ft.test.tsx | — |
| B2 | 撤销 defaultMarkerHint 并入 title | title 为纯 `t("command.permission.pickerTitle")`，提示仍走第 3 参 | 源码断言：title 不再拼接 defaultMarkerHint；commands 测试断言 headerLine 含提示、title 不含 | routes/session/commands.ts | 源码级 | test/commands.test.ts | — |
| B3 | settings-panel source 精确匹配完整 scope 文案 | `toBe` 完整文案串 | 测试断言由 `toContain("new sessions only")` 改为 `toBe("<catalogSource> · <scope>")`，full en 串精确相等 | test/settings-panel.test.ts | 单测级 | test/settings-panel.test.ts | — |
| B4 | permission-picker-hint-ft 按 description 槽重写 | en 60 列 + zh 一帧 + /resume 列头 | FT：description 行含提示、title 不含、不折行（单行）；/resume 帧含 UPDATED/DIR/SESSION 列头；zh 同理一帧 | test/permission-picker-hint-ft.test.tsx | FT 级 | test/permission-picker-hint-ft.test.tsx | B1,B2 |
| C1 | /history onRefill setText 加 traceSet | `keyTrace?.composerSet("history"\|"history-refill", text.length)` | 源码断言：onRefill 块含 composerSet 且 source 为 history 家族 | examples/v2-entry.tsx | 源码级 | test/key-trace-v2.test.ts | — |
| C2 | trace 关闭路径零开销 | `onContentChange` 块以 `keyTrace !== undefined` 短路 | 源码断言：plainText 读取位于 guard 之后；V4 测试更新以反映新形态 | routes/session/session-composer.tsx | 源码级 | test/key-trace-v2.test.ts | — |

## 门禁预期

- scoped：composer-copy / subagents-hotkey / permission-picker-hint-ft / settings-panel / commands / key-trace-v2 / approval-card-ft 全绿（0 fail，断言数不降）。
- tui-base 全量：0 fail（基线全绿，本刀只加测试/改注释，不应引入 fail）。
- typecheck:entry：退出码 0（或维持原有、与本刀无关的既有错误集不变——若基线本就非 0，须记录基线并证明 diff 无新增错误）。
- 禁止 push。

## USER-JUDGMENT 预案（≤5 项，记录不拦）

1. A2「有字无选区→清空输入行」行为：用户已拍板（task 明示），按拍板实现。
2. C1 来源枚举命名：`history`（复用）或新增 `history-refill`；两者皆合法，优先新增明确值以区分 /history 灌入与 ↑/↓ recall。
3. B4 提示「不折行」的 60 列阈值：以真帧单行断言为准，若实测需更宽列数则记录为 judgment 并调整测试宽度（不放宽断言强度）。

## NOT RUN 声明

- 真机 tmux `.ans` 帧：本批为 UI 逻辑收尾，验证靠 testRender 真帧捕获 + keymap 引擎级测试，不采集真机 tmux 帧（无新增 NOT RUN 功能面）。
- bridge / seam / dock 相关：本刀明确不碰，不在判定域。
