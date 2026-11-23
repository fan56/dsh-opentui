# PREREGISTRATION — R4 `/permission` 弹窗 + 会话未绑定 bug（write-once，捕获前落盘，never edited after capture）

本文件在任何实现改动与证据捕获之前写入磁盘。它是 R4 的冻结 `expected` 预测值。
正文 capture 后未改；observed 与判定写入后续报告，禁止回改本文件 `expected`。

- Preregistered at (UTC): 2026-11-23T01:38Z
- Worktree / branch: `/Users/qingguee/repo/dsh-opentui-wt-uibatch-1123` @ `feat/ui-batch-1123`
- Pre-change HEAD: `c79071a1627fd66fc25f60fbdca9a6eeef17f325`
- 授权来源: `research/2026-11-23-ui-batch/00-decisions.md` §R4（用户已拍板）+ 本 wave 定案（不得偏离）
- 适用流程: W5 预注册 + W3 缺陷修复
- Evidence directory: `.proof/r4-permission-dialog/`
- 证据约定: `*.log` 为 gitignored 采集日志；唯一入库断言文件为本文件
- 成文方式: 一次性成文（各 E 行同一时刻冻结，非逐节顺写），如实登记。

## 变更面与不变量

- 变更 1（bare picker）: `packages/tui-base/src/routes/session/commands.ts` 的 `/permission` bare 分支，`permissionCatalogLines` 打印替换为一次 `ctx.pickOne`；选项由 `catalog.options` 映射 `title`/`value`/`description`；`currentValue` 只传 `catalog.defaultPreset`（标「默认」，严禁标为「当前档」）。选中值进入既有 `:1899` 起的校验/风险确认/`face.switch` 链路。取消=无操作（不 switch）。
- 变更 2（bug）: `packages/shell/src/client/bridge-session-seam.ts` `#permissionSwitch` 的 agentId 由 `currentSessionId()` 改为 `currentSessionId() ?? stagedSessionId()`；命令侧在两值皆空时给可执行提示（新 i18n 键），不向用户抛裸 `no active session` 错。
- 变更 3（i18n）: `packages/i18n/locales/en.json`、`zh-CN.json` 仅插入两个新键（picker 标题、无会话提示），禁整文件重写。
- 不变量: 带参 `/permission <preset>` 逻辑不动；`danger-full-access`/`auto` 风险二次确认保留；`permissionCatalogLines` 纯函数与既有断言不动；`commands.ts:1905-1911` 的 host-authoritative 裁决不动；不做 1–9 数字键快选。

## 预注册 expected（E1–E6，机器可判、环境无关，禁环境依赖子句）

| id | assertion | expected（FROZEN，捕获前填） | pass criterion（checkable，禁环境依赖子句） | changed path | level | evidence file | depends on |
|----|-----------|------------------------------|--------------------------------------------|--------------|-------|---------------|------------|
| E1 | bare `/permission` 弹窗含全部 catalog 选项 | `ctx.pickOne` 被调用恰好 1 次；options 长度 === `catalog.options.length`，且每个 option 的 `title` === `option.name ?? option.value`、`value` === `option.value`、`description` === `option.description`；第四参数 `currentValue` === `catalog.defaultPreset`；bare 不再逐行打印 catalog | 单测对固定两选项 catalog 断言 picks 长度 1、选项 title/value/description 逐项相等、currentValue 等于 defaultPreset；`ctx.lines` 不含 `available presets:` | `commands.ts:1895-1897` | Unit | `04-bun-test.log` | — |
| E2 | 选中值进入既有 switch 链路 | pickOne mock 返回 `"danger-full-access"` 且风险确认返回 `"ack"` 时，`face.switch` 以同一值被调用 1 次，并输出 `permission preset set to <value>` | 单测断言 `permissionSwitchCalls` 等于 `["danger-full-access"]` 且 set 文案含该值 | `commands.ts:1899-1937` | Unit | `04-bun-test.log` | E1 |
| E3 | 取消=无操作 | pickOne mock 返回 `undefined` 时，`face.switch` 调用数 0，且不输出任何失败文案 | 单测断言 `permissionSwitchCalls` 长度 0、`ctx.lines` 不含 `failed`/`set to` | `commands.ts` bare 分支 | Unit | `04-bun-test.log` | E1 |
| E4 | 风险确认流保持 | 非风险档（如 `safe-extra`）直接 switch、无第二次 pick；`danger-full-access` 仍触发第二次确认，返回 `cancel` 不 switch、返回 `ack` 才 switch；既有 `commands.test.ts:2173-2259` 用例语义不变 | 单测对非风险档断言 picks 长度 1（仅 picker）、对风险档-cancel/ack 断言 picks 长度 2 且 switch 调用符合 ack/cancel | `commands.ts:1912-1921` + `commands.test.ts:2173-2259` | Unit | `04-bun-test.log` | E1, E2 |
| E5 | 会话未绑定：staged 兜底 + 友好提示 | seam 层：当 `currentSessionId()` 为空、`stagedSessionId()` 为 `"s-resumed"` 时，`commands.execute` 的 `agentId` 为 `"s-resumed"`（不再报 `no active session`）。命令层：当两值皆空时，输出可执行提示文案、不调 `face.switch`、不输出裸 `no active session` 错 | seam 单测断言 wire params `agentId === "s-resumed"`；命令单测断言提示行存在、`permissionSwitchCalls` 长度 0 | `bridge-session-seam.ts:1640` + `commands.ts`（switch 前守卫） | Unit | `04-bun-test.log`, `05-bun-test-seam.log` | — |
| E6 | 受影响包测试 + 类型检查全绿；带参路径与既有裁决不动 | `packages/tui-base`、`packages/shell` 的 `bun test` exit 0；`typecheck:entry` exit 0；`git diff` 中带参分支 `commands.ts:1899-1904` 校验与 `:1905-1911` host-authoritative 注释逐字保留 | 命令 exit code 均为 0；diff 含上述上下文且无删除/改写 | 上述测试文件 + 源码 | Gate | `04-bun-test.log`, `05-bun-test-seam.log`, `06-typecheck.log`, `07-diff.log` | E1–E5 |

## 门禁预期（技术门禁全绿即 PASS）

- `bun test`（tui-base / shell）：exit 0，无失败用例；既有 permission 用例不得靠删除断言换绿。
- `typecheck:entry`：exit 0。
- `git status`：仅含本刀授权文件（commands.ts、bridge-session-seam.ts permission 段、两测试文件、两个 locale、本 proof 目录）；共享 locale 只插新键。单 commit，禁止 push。
- commit message: `feat(permission): bare /permission opens preset picker; tolerate unbound session`。

## USER-JUDGMENT 预案（≤5 项；记录 + 默认，不进技术门禁）

- U1（文案措辞／真机项）：picker 标题与「默认」标记在真机弹窗中的观感（当前档不可读，只标 default）。**定案**：`currentValue` 只传 `defaultPreset`，严禁伪装为当前档（`commands.ts:1905-1911`、`00-decisions.md` §R4）。推荐默认：按定案保持，真机文案若拗口由主 agent 微调文案键，不回退语义。本项只记录，不拦技术门禁。
- U2（交互手感／真机项）：方向键+Enter 的 DialogSelect 手感；不做 1–9 数字键快选（定案）。推荐默认：按定案保持，真机如需数字键须另开能力切片。本项只记录。
- U3（文案措辞）：无会话友好提示「先发一条消息再切换权限」的 en/zh 措辞。推荐默认：直译、可执行；真机可调文案，不改语义。

## NOT RUN 声明

- 真机 tmux `capture-pane -e` 抓帧由主 agent 在真机配方阶段做；本刀只落机器可判的单元与类型检查证据，不伪造真机帧。U1–U3 的真机观感留待该阶段，按 JUDGMENT 只记录不拦。
- 1–9 数字键快选按定案不做，不纳入本刀判定域。
- 本刀不跑 `check-capcontract` / `real-client-gate` / pack 阶梯：改动限于命令的 picker 分支、seam 的 agentId 兜底、i18n 文案与测试，未触碰 CapIR / wire / 分发面。

## PASS 判定式

E1–E6 全达成 ∧ 技术门禁（bun test / typecheck:entry）全绿 ∧ JUDGMENT（U1–U3）有裁决记录 ∧ NOT RUN 已如实声明 → PASS。
USER-JUDGMENT 只记录不拦；红就红着报，不放水。
