# B4 修包 — 预注册预期（2026-11-23）

范围：s 键真语义（behavior:'session'）+ 审批卡文案人话化 + settings permission 行提示修正。
分支：feat/ui-batch-1123。时间盒 30 分钟。

本文件在实现前写定：机器断言全部为确定性断言，不依赖任何环境变量、宿主配置、运行时
开关、真机抓帧或时序。凡「若环境 X 则 Y」式子句一律禁止写入断言；环境相关观察只能进
JUDGMENT 节，且不影响机器断言的通过/失败。

## 用户已拍板（输入事实，非待验证项）
1. s = 本会话放行全部写操作：answer() 对 gate 清单 4 工具逐个 grant，不改 setApprovalPolicy。
2. always/session 宿主 verdict 仍 allowed-once（ADR-0011:52 折算），宿主交互不变。
3. always grant 作用域 = 本会话 + 注册子代理同名工具（ADR-0011:142-147）。

## 机器断言（实现后必须逐条由测试/命令输出证明）

### A1 session 分支对 4 工具各产生一条 grant
- 造一个 approval ask（escalation:true），answer 传 `behavior:'session'` + verdict `allowed-once`。
- `registry.sessionGrants('s1')` 集合 == {bash, write, edit, apply_patch}，4 项全中，无第 5 项。
- 每个工具恰好一条 journal 授予行（Set 去重前 4 行，去重后仍 4 项）。

### A2 always 行为不变
- always answer 仍只对当前 ask 的单一 toolName 落 grant；`sessionGrants('s1')` 不含其余 3 个 gate 工具。
- always 的 escalation 校验与错误码、错误文案逐字不变。

### A3 宿主 verdict 仍 allowed-once
- session/always answer 的 wire 参数 verdict 均为 `allowed-once`（seam 折算，勿改 bridge-session-seam.ts）。
- answer() 的 settlement.outcome 仍为 `approved`；journal RESPONDED 行 verdict 仍 `allowed-once`。

### A4 journal 重建覆盖 session 放行
- session answer 产生的 journal 行经 `alwaysGrantToolsFromJournal('s1', rows)` 重建 == 4 个 gate 工具全集。
- 把重建结果喂给新 `AskRegistry.restoreSessionGrants('s1', tools)`，新 registry 对 4 个工具 `hasGrant` 全为 true。
- 重复重放同一 journal 不产生重复/额外工具（幂等）。

### A5 文案键值落盘（i18n）
- en.json / zh-CN.json 中 `overlay.ask.allowAlways`、`overlay.ask.allowSession` 的值分别为约定人话文案。
- 卡片 [a]/[s] 键提示保留（turn-overlays.tsx bind:"a"/bind:"s" 不变）。
- 新增 `settings.note.permissionPresetScope` 键在两落地，defaultPreset 行挂接该提示。
- zh-CN.json host zone subtitle 不再含「实时生效」误导措辞；en 对应行不再含 "host live"。

### A6 测试与类型
- `bun test packages/bridge/test/ask-registry.test.ts packages/bridge/test/ask-journal.test.ts` 全绿。
- `bun run typecheck:entry`（tui-base）通过。
- bridge 测试从 src 导入，不依赖 dist；若 typecheck 触发 dist 依赖则先 `bun scripts/build-bridge.mjs`。

## JUDGMENT（人工观感，不进机器断言）

- J1 审批卡 [a]/[s] 新人话文案比旧值长：需在真机观察卡片宽度是否会因文案变长而被
  clipText 截断；若截断，评估是否缩短文案（用户拍板：「文案长度对卡片宽度的影响」需记录）。
  本项不影响机器断言通过。
- J2 settings permission 行提示较长，末端可能被截断；真机观察后再决定是否精简，不影响机器断言。
