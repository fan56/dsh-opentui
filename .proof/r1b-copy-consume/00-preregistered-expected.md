# PREREGISTRATION — R1b: selection + C-c must be consumed by copy, never clear (write-once, frozen before capture)

本文件在任何实现改动与证据捕获之前写入磁盘。它是 R1b 报告 `expected` 列的冻结预测值；
observed/状态事后依据 pass criterion 判定，禁止回改本文件的 `expected`。

- Preregistered at (UTC): 2026-11-23T04:55Z
- Worktree / branch: `/Users/qingguee/repo/dsh-opentui-wt-uibatch-1123` @ `feat/ui-batch-1123`
- Pre-change HEAD: `8127420a267dfbb4bf35b99c77bd4b9e525c9a32`
- 真机基线（主 agent 已抓帧，本 agent 独立复现）：安装包 `/private/tmp/uibatch-global`；输入 C-a/C-u/C-k/C-e/S-Home 选区高亮均正常；**选区 + C-c → 输入行被清空、pbpaste 为空**，即键落到 clear/exit 链，copy 层未消费。
- 关注代码面（一手核验）：`component/prompt/index.tsx:980-990` 的 `input.copy` 层 `enabled` 为 IIFE：
  `(() => { cursorVersion(); return inputTarget()!==undefined && !disabled() && input?.hasSelection()===true })()`。
  `input.hasSelection()` 为非信号方法；`cursorVersion` 仅在 `onContentChange`/`onCursorChange`（`:1821-1829`）自增。
- keymap 事实（一手核验）：@opentui/keymap 0.8.1 `registerEnabledFields` 把**布尔** `enabled:false` 编译为 `ctx.activeWhen(()=>false)`（永久失活），仅 `function`/ReactiveMatcher 才注册运行时条件；`createLayer` 由 Solid `createEffect` 包裹（`src/solid/index.js:72`）。命令 `run()` 返回 `false` 时事件回落到下一优先级层（R1 P2 测试 `composer-copy.test.ts` 已坐实）。
- 剪贴板通道：`clipboard.write` → `writeText(destination:"all-available")`（`src/clipboard.ts:54-63`）=宿主原生后端( mac pbcopy 系)+OSC52；host `written` 或 terminal `attempted` 即视为成功。
- app 层 interceptor（priority 101，`app.tsx:589-599`）本次一字不改；shell ctrl+c、prompt.clear 默认键位本次不改。
- Evidence directory: `.proof/r1b-copy-consume/`

## 预注册 expected（F1–F5）

criterion 机器可判、环境无关；不写运行时状态猜测为 PASS 的断言。

| id | assertion | expected（FROZEN，捕获前填） | pass criterion（checkable） | level | evidence file |
|----|-----------|------------------------------|----------------------------|-------|---------------|
| F1 | 复现基线 | 修复前，真机 tmux 内「输入文字 → S-Home 选区 → C-c」：输入行被清空，`pbpaste` 取不到被选文字（为空或旧值） | capture-pane 显示输入行清空；`pbpaste` 不含选区文本 | Real (tmux) | `01-repro-before.log` |
| F2 | 根因（enabled 非响应） | 选区由 S-Home 建立时 `onCursorChange` 是否推进 `cursorVersion` 不确定，但 `hasSelection()` 非信号；当 copy 层 `enabled` 求值为布尔 `false` 时 keymap 编译成 `activeWhen(()=>false)` 永久失活，C-c 直接落到 `prompt.clear`（priority 0，text 非空 → enabled）从而清空输入 | 结构断言：`enabled` IIFE 混读 `cursorVersion()` 与非信号 `hasSelection()`；engine 测试复现「enabled 布尔 false 时 copy 层不参与、clear 命中」 | Structural + engine unit | `02-rootcause.log` |
| F3 | 修复后真机行为 | 修复后，「输入文字 → S-Home 选区 → C-c」：输入行保留原文字（不清空），系统剪贴板含被选文字（host 原生后端写入，pbpaste 可读） | capture-pane 输入行仍为原文字；`pbpaste` 输出 == 选区文本 | Real (tmux + mac 直跑) | `04-repro-after.log`, `05-clipboard-direct.log` |
| F4 | 无选区行为不变 | 修复后，无选区时 C-c 仍清空输入行（有字）/空输入退出；copy 层 run 返回 false 回落，不写剪贴板 | engine 单测：selection 消失 → `writes==[]`、`clear==1`；真机无选区 C-c 仍清空 | Engine unit + Real | `03-engine-tests.log`, `04-repro-after.log` |
| F5 | 引擎级单测 | 新增测试覆盖：选区存在 → C-c 触发 `write` 恰一次且 clear 不调用；选区消失瞬间 → run 返回 false 回落 clear | `bun test` 两条新用例 pass；tui-base 既有测试全绿、typecheck 0 | Unit | `03-engine-tests.log` |

非断言证据：`06-typecheck.log`（package typecheck）、提交 diff（commit 单条，message 固定）。

## 门禁预期

- `@dsh-opentui/tui-base`：`bun test` 全绿（既有断言不改），`bun run typecheck` 退出码 0。
- 不改 app.tsx interceptor、不改 keybind 默认值、不改 clipboard.ts；无选区行为完全不变。

## USER-JUDGMENT 预案（记录 + 默认，不拦门禁）

- U1（OSC52/tmux）：tmux 默认 `set-clipboard` 可能吞掉 OSC52 写。默认判定为环境行为；以 mac 原生后端 `pbpaste` 为准，tmux 内 OSC52 是否落地仅记录不拦门禁。
- U2（toast）：复制失败 toast.error 沿用既有通道，不改文案。

## PASS 判定式

F1–F5 全达成 ∧ tui-base `bun test` 全绿 ∧ typecheck 0 ∧ commit 单条 ∧ 无 push → PASS。
若 tmux 内 pbpaste 空但 mac 直跑 host 后端 pbpaste 成功 → 记为环境行为（U1），F3 仍按 mac 直跑判定。红就红着报。

## 反作弊与边界

- 不动 app.tsx、clipboard.ts、keybind.ts 默认键位；只改 copy 层 enabled/run。
- commit 只含本 concern 文件 + 本 proof 目录；其他 subagent 未跟踪文件一律不 add；禁止 push。
- 使用自己的 tmux server 名与拷贝的 scratch home；不 kill 主 agent 的 `uibatchframe` 会话。
