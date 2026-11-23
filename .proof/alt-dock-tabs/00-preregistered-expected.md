# PREREGISTRATION — alt+1 / alt+2 活动面板 tab 切换失效定位与修复（write-once，动手前落盘）

本文件在任何诊断实验、代码改动、证据抓帧之前写入磁盘。它是本切片的 `expected` 冻结预测；
observed 事后按 `pass criterion` 判定，禁止回改本文件 `expected`。

- Preregistered at (UTC): 2026-11-23T10:48Z
- Worktree / branch: `/Users/qingguee/repo/dsh-opentui-wt-altfix-1123` @ `fix/alt-dock-tabs-1123`
- Pre-change HEAD: `442b387`（= v0.27.0，`origin/main`）
- Evidence directory: `.proof/alt-dock-tabs/`
- 冻结面（零改动）：`capir/`、`capcontract/`、`ledger/`、`scripts/build-bridge.mjs` 转义段、既有测试断言（只加不删改）。
- 脱敏纪律：报告/帧只保留 ANSI 帧文本与按键元数据；**不落 token/key/凭据/用户输入原文**。scratch home 只拷 `.credentials.yaml` / `model-*.json` / `agents/`；key-trace 文件只保存按键元数据行、不贴输入框内容。证据日志中不出现真实凭据值。
- 措辞强度：criterion 一律机器可判、环境无关；**禁止写环境依赖子句**（不写"真机上/某终端/某版本上通过"，不写 `present=true` 类运行时状态断言）。真机帧只作旁证，不进技术门禁。

## 一手事实（给定，不重验）

- 安装包 0.27.0 + tmux 120×40 + `/motion full`、`\e2`/`\e1`/`M-2`/`M-1` 四种键盘注入均不切换；鼠标双向正常。
- 绑定：`config/keybind.ts:205-206`（`alt+1`/`alt+2`）；注册：`widgets-dock.tsx:2021-2033`（global 层，`enabled: pageOwns()`）。
- 现有测试 `widgets-dock-tabs-r2.test.ts` 只测默认值，无真实按键路径测试。

## 三分支判定（动手前冻结决策规则）

| 分支 | 判据（机器可判、环境无关） | 动作 |
|---|---|---|
| (a) 绑定/优先级缺陷 | 注入对照通过（alt+enter 产生 `meta:true`）；解析层通过（ESC+digit → `meta:true,name:'2'`）；但真实按键路径下 `session.dock.tab.*` 命令未把信号翻转 | 修代码 + 补真实按键路径测试 |
| (b) 解析层不认 ESC+digit | `parseKeypress('\x1b2')` 不产生 `{name:'2',meta:true}` | 在可行范围内改绑定/补解析，不动冻结面 |
| (c) 注入方式无效、产品正常 | 注入对照不产生 `meta:true`（alt+enter 与 alt+2 都收不到） | 换真实终端路径取证，不为"修"而改代码 |

诊断漏斗（顺序固定）：D1 解析层单测（`@opentui/core` `parseKeypress`）；D2 键位竞争静态审查（注册顺序/优先级/其它 alt 绑定）；D3 真实按键路径测试（keymap 层喂 ESC 序列，断言信号翻转）；D4 真机 key-trace 对照（alt+enter 与 alt+2 元数据）。

## 预注册 expected（FROZEN）

| id | assertion | expected（FROZEN） | pass criterion（机器可判、环境无关） | changed path | level | evidence file | depends on |
|---|---|---|---|---|---|---|---|
| D1 | 解析层认 ESC+digit | `parseKeypress('\x1b2')` → `name:'2', meta:true`；`'\x1b1'` → `name:'1', meta:true` | 单测/脚本断言两个字面量对象的 `name` 与 `meta` 字段精确相等；不改 `@opentui/core` | 不改（只读诊断） | unit | `01-parse-layer.log` | — |
| D2 | 无键位竞争 | `alt+1`/`alt+2` 在 `keybind.ts` 全文件唯一；其它 alt 绑定不与数字键冲突；tab 层 `enabled` 纯 `pageOwns()` | grep 计数：`"alt+1"\|"alt+2"` 绑定字面量各 == 1；tab 层 `enabled: pageOwns()` 存在且无 overflow 门 | `keybind.ts`,`widgets-dock.tsx`（只读诊断） | structural | `02-keybinding-audit.log` | — |
| D3 | 真实按键路径可翻转 tab（红→绿） | 通过 keymap 分发层喂 ESC 序列（`\x1b2`/`\x1b1`）后 `activityDockTab()` 由 main→todo→main | 新测试：注入 ESC 序列到按键分发，断言信号依次 `main`→`todo`→`main`；**改动前此测试红、改动后绿** | test 文件（新建）+ 根因文件 | unit（真实按键路径） | `03-key-path.test.log` | D1,D2 |
| D4 | 鼠标回归不破 | 鼠标左键仍切换 tab，非左键不切换 | 既有测试 E3 鼠标用例断言不改且仍绿（只加不删改断言） | 不改既有断言 | unit | `03-key-path.test.log` | — |
| F1 | 冻结面零改动 | `git diff --name-only` 不含 `capir/`、`capcontract/`、`ledger/`、`scripts/build-bridge.mjs`；既有测试断言文本未删改 | diff 范围断言：冻结路径出现次数 == 0；既有测试文件仅新增、原断言逐字保留 | 改动范围受控 | diff | `04-diff-scope.log` | — |
| F2 | scoped 测试全绿 | `bun test packages/tui-base/test/<改动相关>.test.ts` 退出码 0 | 命令输出退出码 0、失败用例数 0 | tui-base | unit | `03-key-path.test.log` | D3 |

## 门禁预期

- D1–D4、F1–F2 全达成；不跑全量测试（只跑 tui-base 相关 scoped）。
- `git diff` 范围仅限根因文件 + 新测试 + `.proof/alt-dock-tabs/`。
- 判定分支 (a)/(b)/(c) 必须有 D1/D2/D3/D4 的证据支撑，不得凭猜测。

## USER-JUDGMENT 预案（记录 + 推荐默认，不进技术门禁）

1. 若分支 (b) 成立且需改默认绑定：默认**不改默认键位**，优先在解析/分发层补 ESC+digit 支持（不越权冻结面）；若必须改键位，先记录再按协调者裁决。
2. 若分支 (c) 成立：默认**不改产品代码**，交付真实按键路径证明 + 推荐注入方式修正。
3. 真机帧抓取失败（起不来 app）：默认退回源码入口 `packages/shell/bin/dsh-opentui.mjs`（`DSH_HOME`/`DSH_AGENTS_HOME` 指 scratch），帧作旁证；不影响 D1–D4 门禁。

## NOT RUN 声明

- 不跑全量测试、不 commit、不 push。
- 真机帧为旁证（环境依赖），不进 D1–F2 机器门禁；criterion 全部环境无关。

## PASS 判定式

D1∧D2∧D3（红→绿）∧D4∧F1∧F2，且分支结论有 D1/D2/D3/D4 证据支撑，无未声明 NOT RUN，JUDGMENT 项均有默认记录 → PASS。
红就红着报，不自行放宽 criterion、不改本文件 expected。
