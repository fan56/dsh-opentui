# alt+1 / alt+2 活动面板 tab 切换失效 — 定位与验收报告

工作树 `/Users/qingguee/repo/dsh-opentui-wt-altfix-1123` @ `fix/alt-dock-tabs-1123`，HEAD `442b387` (= v0.27.0)。
预注册：`.proof/alt-dock-tabs/00-preregistered-expected.md`（动手前落盘，expected 未回改）。

## 二值结论（先给）

- **是否产品缺陷：否。判定为分支 (c) — 注入方式/键盘所有权状态问题，产品键盘切换正常。**
- **是否修好：无需修源码，零源码改动。** 已补一个真实按键路径测试（不是默认值断言），scoped 测试全绿。

真机帧证据（本 worktree 源码构建、自己的 tmux `-L altfix` + scratch home）：
`M-2` → `[2 todo]`、`M-1` → `[1 main]`、字面 ESC 字节 `\e2`/`\e1` 同样双向切换；鼠标对照双向正常。

## 根因（按证据，非猜测）

### 原报告失败的两条可复现原因

1. **注入字节不对（主要）**：`tmux send-keys -l '\e2'`（单引号）发送的是**字面三字节 `\`、`e`、`2`**（xxd `5c 65 32`），不是 ESC+2。
   - 对照实测（`/private/tmp/altfix-inject-probe.sh`）：`-l '\e2'` → `5c 65 32`；`M-2` → `1b 32`；`-l $'\e2'`（bash ANSI-C 真 ESC）→ `1b 32`。
   - 这一条直接解释「`\e2`/`\e1` 不切换」；而 `M-2`/`M-1` 是正确 ESC+digit 字节，在本次真机上**实测能切换**（见帧）。

2. **键盘所有权门（ADR-0008，按设计）**：活动面板 tab 层注册为 page 级全局层，
   `widgets-dock.tsx:2018` 的 `enabled: pageOwns()` 在**有审批弹窗等 overlay 持有键盘**时为 false，
   此时 alt+1/2 每设计不生效；鼠标 handler 是直连、不走该门。
   - 实测：审批弹窗打开帧（frame-10/11）`alt+2` 不改变 tab，与门语义一致。
   - 这与原报告「鼠标正常、键盘不切换」症状相似，是需在现场区分的第二种情形。

### 产品代码无缺陷的证据（逐层证伪）

| 层 | 结论 | 证据 |
|---|---|---|
| D1 解析层 | 正常 | `@opentui/core` `parseKeypress('\x1b2')` → `{name:'2', meta:true}`；`'\x1b1'` → `{name:'1', meta:true}`；kitty 序列 `\x1b[49;3u` 同样 → meta+digit。见 `01-parse-layer.log`。 |
| D2 绑定/竞争 | 正常 | `keybind.ts:205-206` 唯一绑定 `alt+1`/`alt+2`（grep 计数各 1）；无其它 alt+数字绑定；tab 层 `mode:"global"` + `enabled: pageOwns()`，注册顺序无更晚同键层抢占。见 `02-keybinding-audit.log`。 |
| D3 分发层 | 正常 | 新增 `packages/tui-base/test/widgets-dock-tabs-keys.test.ts` 把真 ESC 字节喂进 renderer 输入解析 → keymap → 信号：`main→todo→main` 翻转；弹窗持有键盘时不翻转、pop 后恢复翻转。见 `03-key-path.test.log`。 |
| D4 真机 | 正常 | key-trace 元数据：alt+enter → `{key:"return", alt:true}` 并产生换行 contentChange；`M-2`/真 ESC+2 → `{key:"2", alt:true}`。帧见下。 |

## 改了什么

- **新增** `packages/tui-base/test/widgets-dock-tabs-keys.test.ts`：真实按键路径测试（renderer + keymap + ownership provider 全树，`mockInput.pressKey("2", { meta: true })` → `\x1B2` 真字节），断言 tab 信号翻转 + page-owner 门。既有 `widgets-dock-tabs-r2.test.ts` 断言一字未改（只加不删改）。
- **零源码改动**：未改 `keybind.ts`、`widgets-dock.tsx` 或任何 src。
- **冻结面零改动**：`capir/`、`capcontract/`、`ledger/`、`scripts/build-bridge.mjs`、既有测试断言均未触碰。见 `04-diff-scope.log`。
- 未 commit、未 push、未跑全量测试。

## 红→绿证据

本例**无红→绿**：产品无缺陷，新测试从落盘起即绿。这本身就是分支 (c) 的证据（若真有绑定/优先级缺陷，D3 必红）。
scoped 测试：`bun test test/widgets-dock-tabs-keys.test.ts test/widgets-dock-tabs-r2.test.ts test/key-trace.test.ts` → **21 pass / 0 fail**，见 `03-key-path.test.log`。

## 真机帧（tmux `-L altfix` 120×40 + scratch home + 源码构建）

scratch home 只拷 `.credentials.yaml`/`model-profiles.json`/`models-store.json`/`agents/`，profile 由 bin 自己 provision；
`DSH_OPENTUI_KEY_TRACE` 只写按键元数据。所有帧已脱敏扫描（无 token/key/凭据）。

| 帧 | 操作 | tab 行（去色后） |
|---|---|---|
| `frame-01-mouse-main.ans` | 鼠标点 1 main（复位） | `┏━[1 main]  2 todo` |
| `frame-02-alt2-M.ans` | `M-2` | `┏━1 main  [2 todo]` |
| `frame-03-alt1-M.ans` | `M-1` | `┏━[1 main]  2 todo` |
| `frame-04-alt2-esc.ans` | 真 ESC 字节 `\e2` | `┏━1 main  [2 todo]` |
| `frame-05-alt1-esc.ans` | 真 ESC 字节 `\e1` | `┏━[1 main]  2 todo` |
| `frame-06-mouse-todo.ans` | 鼠标点 2 todo（对照） | `┏━1 main  [2 todo]` |
| `frame-07-mouse-main.ans` | 鼠标点 1 main（对照） | `┏━[1 main]  2 todo` |
| `frame-10-dialog-open.ans` / `11-alt2-in-dialog.ans` | 审批弹窗打开时 alt+2 | 保持 `[1 main]`（page-owner 门按设计生效） |

## 残余风险

1. **现场注入**：若在用户终端仍复现，先用 key-trace（`DSH_OPENTUI_KEY_TRACE`）确认收到 `{key:"1"/"2", alt:true}`；
   不要再用 `-l '\e2'` 单引号。正确写法 `tmux send-keys -l $'\e2'` 或 `tmux send-keys M-2`。
2. **弹窗期间**：如产品要求审批弹窗打开时也能切 tab，需要产品决策改 `pageOwns()` 门（ADR-0008），本次未越权改动。
3. **安装包复测**：本次真机用 worktree 源码构建（同 HEAD `442b387`）；未在 `npm pack` 安装包上另测。若协调者要求，可在包上重跑同一组按键。
4. 新测试在 harness 中不断言帧标题（该 harness 的紧凑分支不安 tab 标题行），只断言信号翻转；真机帧补上视觉证据。

## 收尾

自有 tmux server `-L altfix` 已 `kill-server`；孤儿宿主核对 `ps -eo pid,command | grep 'dsh --profile opentui'` 无本 worktree/`/private/tmp` cwd 残留；未触碰用户 `~/.dsh`、用户 tmux（`default`、`cmdz`）或其它 worktree。
