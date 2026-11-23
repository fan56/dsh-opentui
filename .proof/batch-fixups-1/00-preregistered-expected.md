# PREREGISTRATION — oldfox R4/R5/B4 评审条件代码收尾（write-once，捕获前落盘，never edited after capture）

本文件在任何实现改动与证据捕获之前写入磁盘。它是本批 4 项小修的冻结 `expected` 预测值。
正文 capture 后未改；observed 与判定写入后续汇报，禁止回改本文件 `expected`。

- Preregistered at (UTC): 2026-11-23T02:20Z
- Worktree / branch: `/Users/qingguee/repo/dsh-opentui-wt-uibatch-1123` @ `feat/ui-batch-1123`
- Pre-change HEAD: `2434f6fe6432686274e9b3dde51f614e875519d9`
- 授权来源: oldfox 评审条件（R4-2 / R4-3 / B4-3 / R5-2），时间盒 30 分钟
- 适用流程: W5 预注册（全部断言机器可判、环境无关，禁环境依赖子句）
- Evidence directory: `.proof/batch-fixups-1/`
- 成文方式: 一次性成文（各 E 行同一时刻冻结，非逐节顺写），如实登记。

## 变更面与不变量

- R4-2: `commands.ts` bare `/permission` 的 `pickOne` 第 3 参 `headerLine` 由 `undefined` 改为一行提示（`command.permission.defaultMarkerHint`）；第 4 参仍为 `catalog.defaultPreset`，「default 非 current」定案不变。
- R4-3: 无绑定会话守卫整体挪到 `pickOne` 之前；拦截条件逐字不变（`currentSessionId()` 与 `stagedSessionId()` 皆空才拦）。
- B4-3: `ask-registry.ts` 的 `behavior:'session'` 分支加与 `always` 同款 `escalation === true` 前置校验；非 escalation 走同款 `INVALID_RESPONSE` 拒绝路径。
- R5-2: `widgets-dock.tsx` 的 `onCleanup` 补 `resetActivePanel()`（pane-focus.tsx 导出）。
- 禁碰: `packages/bridge/src/index.ts` 与 `bridge-session-seam.ts`（B3 刀并行修改中）。
- 文件所有权: commands.ts、locales（小段插入）、ask-registry.ts 及其测试、widgets-dock.tsx（onCleanup 段）及其测试、`.proof/batch-fixups-1/`。

## 预注册 expected（E1–E7，机器可判、环境无关）

| id | assertion | expected（FROZEN，捕获前填） | pass criterion（checkable，禁环境依赖子句） | changed path | level | evidence | depends on |
|----|-----------|------------------------------|--------------------------------------------|--------------|-------|----------|------------|
| E1 | R4-2 headerLine 提示 | bare `pickOne` 第 3 参 `headerLine` 等于 `t("command.permission.defaultMarkerHint")`，en 值逐字 `● marks the default preset; the active preset is host-side`，zh 值逐字 `● 为默认档；当前档以宿主为准`；第 4 参 `currentValue` 仍 == `catalog.defaultPreset` | 单测断言 `picks[0].headerLine` 含 "default preset" 且含 "host-side"；两 locale 文件各含该键且值逐字相等；`currentValue` 断言不变 | `commands.ts:1901-1910`、`en.json`/`zh-CN.json` | Unit | `04-bun-test.log` | — |
| E2 | R4-3 守卫前移 | 两 id 皆空时，`permCmd().run(ctx,"")` 输出 `command.permission.noSession` 文案且 `ctx.hooks.picks` 长度 0、`permissionSwitchCalls` 长度 0 | 单测断言 `picks` 长度 0（不再先弹 picker）；既有 staged 兜底用例仍 switch 成功 | `commands.ts`（守卫移至 picker 前） | Unit | `04-bun-test.log` | — |
| E3 | B4-3 session escalation 校验 | 非 escalation 的 approval ask，`behavior:'session'` answer 返回 `{ok:false, code:INVALID_RESPONSE, message:'behavior:"session" needs a granted escalation'}`；`hasGrant`/sessionGrants 不产生任何放行 | 单测断言 result.ok=false、code/message 逐字相等、sessionGrants 无该会话工具；`always` 原拒绝路径逐字不变 | `ask-registry.ts:439-443` 附近 | Unit | `05-bun-test.log` | — |
| E4 | B4-3 escalation 正例不变 | escalation:true 的 approval ask，`behavior:'session'` answer 仍 ok=true，4 gate 工具全 grant | 既有 A1 单测绿；新断言 result.ok=true | `ask-registry.ts` | Unit | `05-bun-test.log` | E3 |
| E5 | R5-2 cleanup 复位 | 挂载 WidgetsDock，标记 `activity` 为 active，`dispose()` 触发 `onCleanup` 后 `activePanel() === "composer"` | 渲染层单测：mount→markPanelActive("activity")→setup.dispose()→断言 activePanel() 为 "composer" | `widgets-dock.tsx:1782-1788` | Unit | `06-bun-test.log` | — |
| E6 | 受影响包测试 + 类型全绿 | `bun test`（tui-base / bridge / i18n 相关 scoped）+ `bun run typecheck:entry` exit 0 | 各命令 exit code 均为 0 | 上述测试文件 + 源码 | Gate | `04/05/06/07-*.log` | E1–E5 |
| E7 | commit 结构 + 禁碰文件 | 恰好 3 个 commit，message 逐字为指定三条；`git diff` 不含 `packages/bridge/src/index.ts` 与 `bridge-session-seam.ts` | commit message 逐字相等；`git show --stat` 里无禁碰文件；禁止 push | 全仓 | Gate | 汇报文本 | — |

## 门禁预期

- 三个 commit：① `fix(permission): clarify default marker and guard before picker (oldfox R4)`（R4-2+R4-3）② `fix(ask): require escalation for session verdict (oldfox B4)`（B4-3）③ `fix(dock): reset active panel on dock cleanup (oldfox R5)`（R5-2）。
- 每 commit 只含授权文件；共享 locale 只插新键、不整文件重写；禁 push。
- 断言强度不降：既有 E1/E5/R5 等用例断言保留，只新增或收紧。

## JUDGMENT（人工观感，不进机器断言）

- J1（文案措辞）：新 headerLine 提示在真机弹窗的观感，当前档不可读只标 default；定案不变。只记录，不拦门禁。
- J2（交互手感）：R4-3 守卫前移后未绑定窗口 UX 更直接；真机观察后若有异议由协调者裁决，不改机器断言。

## NOT RUN 声明

- 真机 tmux 抓帧不在本刀判定域；本刀只落机器可判的单测与类型检查证据。
- 不跑 check-capcontract / real-client-gate / pack 阶梯（改动限于命令 picker、ask-registry 校验、dock cleanup 与 i18n 新键，未触碰 CapIR / wire / 分发面）。

## PASS 判定式

E1–E7 全达成 ∧ 门禁全绿 ∧ JUDGMENT 有记录 ∧ NOT RUN 如实声明 → PASS。
USER-JUDGMENT 只记录不拦；红就红着报，不放水。
