# PREREGISTRATION — 真机抓帧视觉缺陷修包（审批卡文案折行 + 两处提示不渲染）/ 4 项机器断言（write-once，实现与证据捕获前落盘，never edited after capture）

本文件在任何实现改动、测试写入与证据捕获之前写入磁盘。它是本刀最终汇报 `expected` 列的冻结预测值。
状态与 observed 值事后依据 `pass criterion` 判定；禁止回改本文件的 `expected`。

- Preregistered at (UTC): 2026-11-23T04:49Z
- Worktree / branch: `/Users/qingguee/repo/dsh-opentui-wt-uibatch-1123` @ `feat/ui-batch-1123`
- Pre-change HEAD: `8127420a267dfbb4bf35b99c77bd4b9e525c9a32`
- 流程：W5（`docs/workflows/w5-proof-evidence.md`）预注册 write-once。
- 范围：两处缺陷、按缺陷分 2 个 commit；禁止 push。commit message 冻结：
  1. `fix(ask): fit session verdict labels on one line`
  2. `fix(settings): surface permission scope hints (picker header + settings row)`
- 冻结面：bridge 包 / seam / provisioner / `verify/` / 皮肤主题零 diff；`packages/shell/dist/` 零 diff。

> **never edited after capture**：正文在证据捕获前落盘，捕获后不回改。若事后追加裁决附则，仅以「附则」段落追加，不修改正文断言。
> **成文方式声明**：一次性成文（非逐节顺写）；E1→E4 按任务顺序编号，无逐节时间戳冒充。

## 已定位根因（输入事实，捕获前已从代码坐实）

- 缺陷 1：审批卡 [a]/[s] 文案过长，legacy footer 按钮行在 60 列卡宽内折行断词（真机帧已由主 agent 坐实）。
- 缺陷 2a：`ctx.pickOne` 第 3 参 `headerLine` 在真机 host entry（`examples/v2-entry.tsx` pickOne）里被接收但从未转发给 `DialogSelect`——源码注释明写「v2 does not paint it — pre-existing gap」；`DialogSelect` 自身只有在收到 `description` prop 时才在标题下渲染提示行。故 `headerLine` 实参再正确也到不了渲染层。修法走任务允许的替代展示位：把提示并入 picker 的 `title`（v2-entry 确实转发 title），保留 `headerLine` 第 3 参不动以不破坏 /resume 契约与既有测试。
- 缺陷 2b：`settings-panel.tsx` 把 scope 提示并进 `item.source`；生产 modal 的 `fromItem()` 只复制 `item.note`、丢弃 `item.source`，而列表层与编辑器层只渲染 `currentRow().note` / `row.note`。故提示到达不了任何渲染面。修法：scope 同时进 `item.note`（并保留 `item.source` 里的副本，不改既有 `source` 断言），使其随 `fromItem` 进入 `row.note`，在聚焦底栏与编辑态渲染。

## 预注册 expected（E1–E4）

criterion 一律机器可判、环境无关；不写 `present=true` 类运行时宿主状态断言；不依赖真机/网络/宿主版本可达性。全部在仓库内 render fixture / locale 文件 / 命令输出下运行。

| id | assertion | expected（FROZEN，捕获前填） | pass criterion（checkable） | changed path | level | evidence file | depends on |
|----|-----------|------------------------------|-----------------------------|--------------|-------|---------------|------------|
| E1 | 审批卡 [a]/[s] 文案缩短且有长度预算 | zh `allowAlways`=「此工具本会话免问」、`allowSession`=「写操作本会话全放行」；en `allowAlways`="this tool, this session"、`allowSession`="all write tools, this session"；按钮渲染保留 [a]/[s] | 两 locale 文件四键精确值命中；`stringWidth(每个标签) ≤ dialogWidth("medium")/2`（60/2=30，zh 16/18、en 23/29）；渲染测试在 60 列审批卡上断言两个新标签整串出现在渲染输出且不被拦腰折成两行；`bun test <ask-label test>` 退出 0 且 fail=0 | `packages/i18n/locales/{en,zh-CN}.json`、`packages/tui-base/test/ask-verdict-labels-ft.test.tsx` | Unit(render) | `01-ask-labels.log` | — |
| E2 | /permission picker 提示渲染可见 | picker title 含 `command.permission.defaultMarkerHint` 对应文案（zh「● 为默认档；当前档以宿主为准」/ en「● marks the default preset; the active preset is host-side」）；headerLine 第 3 参仍原样传入 | `commands.ts` picker 调用段把提示并入 title 且仍传 headerLine；渲染测试挂载该 title 的 `DialogSelect`，`captureCharFrame()` 含提示关键子串（zh「当前档以宿主为准」/ en「host-side」）；既有 commands 测试「bare opens preset picker…」全绿（headerLine 断言不回退）；`bun test <picker hint test> <commands test>` 退出 0 且 fail=0 | `packages/tui-base/src/routes/session/commands.ts`（仅 picker 调用段）、`packages/tui-base/test/permission-picker-hint-ft.test.tsx` | Unit(render) | `02-picker-hint.log` | — |
| E3 | settings permission scope 提示在聚焦行/编辑态可见 | `item.note` 与 `item.source` 都含 scope 文案（zh「仅影响新会话」/ en「new sessions only」）；`row.note` 渲染 | `buildHostItems` 产出的 permission.defaultPreset 行 note 与 source 均含 scope 子串；panelkit 渲染测试 preselect 该行时 `frame()` 含 scope 子串，Enter 进编辑器后 `frame()` 仍含；既有 settings-panel.test.ts 中 source 断言与 read-only note 断言不破坏；`bun test <settings tests>` 退出 0 且 fail=0 | `packages/tui-base/src/routes/session/settings-panel.tsx`、`packages/tui-base/test/settings-panel-panelkit.test.tsx`（+ 必要的既有断言迁移，逐条在报告登记） | Unit(render) | `03-settings-hint.log` | — |
| E4 | 门禁与提交纪律 | scoped 测试 + typecheck:entry 全绿；2 个 commit；冻结面零 diff、无 push | `bun test <三个新测试文件> packages/tui-base/test/commands.test.ts packages/tui-base/test/settings-panel.test.ts` 退出 0 且 fail=0；`bun run typecheck:entry` 退出 0；`git log -2 --format=%s` 两条 message 与冻结值逐字一致；`git diff 8127420a..HEAD -- bridge seam provisioner verify packages/shell/dist 皮肤主题路径` 输出空；`git status` 无已 push 标记（本地 ahead，远端 main SHA 不变） | 全部改动文件 | Gate | `04-gate.log` | E1,E2,E3 |

## 通用门禁预期

- 受影响包 scoped 测试 + `bun run typecheck:entry` 退出码 0（`04-gate.log`）。
- E1/E2/E3 的渲染断言必须机器可判：基于 `captureCharFrame()` / `stringWidth`，不靠视觉模型、不靠 PNG。
- 冻结面零 diff（bridge 包 / seam / provisioner / verify/ / 皮肤主题 / `packages/shell/dist/`）。

## USER-JUDGMENT 预案（≤5 项，三类边界；记录 + 默认，不拦门禁）

- U1（措辞）：审批卡最终文案的具体字眼。默认：按任务建议值（a「此工具本会话免问」/ s「写操作本会话全放行」；en 同步），机器预算 ≤30 列/标签。
- U2（措辞）：picker title 后缀的呈现形态（整句 vs 短句）。默认：整句并入 title，最小改动、不新增 locale key；若真机观察 title 折行难看，由主 agent 真机裁决后再缩短，不影响机器断言。
- U3（布局）：settings 提示走「聚焦底栏整句」还是「行值短后缀」。默认：聚焦底栏整句（既有 note 渲染路径，零布局改动）；真机若仍不可见再由主 agent 裁决追加行值后缀。
- U4（技术取向）：E3 若既有 `expect(preset.note).toBeUndefined()` 与新行为冲突。默认：该断言编码的是「scope 只进 source」的旧实现细节，随本修包故意变更；逐条迁移为 note 含 scope 并在报告登记，断言强度不降（由「严格 undefined」改为「含 scope 子串」+ source 副本仍断言）。

## PASS 判定式

E1–E4 全达成 ∧ scoped 测试全绿 ∧ `typecheck:entry` 退出 0 ∧ 2 commit message 逐字一致 ∧ 冻结面零 diff ∧ 无未声明 NOT RUN → PASS。
真机抓帧验收由主 agent 做，本刀显式 NOT RUN，不拦技术门禁。红就红着报，不自创豁免。

## NOT RUN 声明

- 真机 tmux 抓帧（`.ans`）与视觉观感：主 agent 负责，本刀只做渲染级机器断言。
- verify70 / 握手 / CAP_SMOKE：不在本刀范围。

## 反作弊与边界

- 不改 bridge 包 / seam / provisioner / verify/ / 皮肤主题 / `packages/shell/dist/`；commit 只含本 concern 文件。
- 既有测试断言不静默删除：E3 若迁移 `note===undefined` 断言，须在报告逐条登记理由与新旧值。
- 措辞强度不超证据：render fixture 绿只写「渲染级绿」，不冒充真机；width budget 只证「≤半卡宽」，不证「全行单行不折」（后者由主 agent 真机验收）。
- 禁止 push。
