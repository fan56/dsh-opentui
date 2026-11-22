# PREREGISTRATION — F1-A1 多会话审批路由（write-once，实现与捕获前落盘）

本文件在任何 F1-A1 实现改动与证据捕获之前写入磁盘。判定只依据可机器断言的判据，禁止环境依赖子句（如 present=true）。

- Preregistered at (UTC, `date -u`): 2026-11-22T08:58Z
- Worktree / branch: `/Users/qingguee/repo/dsh-opentui-wt-f1ask` @ `fix/f1-ask-routing`
- Pre-change HEAD anchor: `ed04642c64deaf38f87f92fceb15a7440ae6a0b3`
- 阶段边界：本刀只做「ask 帧能发出、路由正确 + 子会话身份字段」。deadline（T6）、TUI 挂载与 ask 帧消费（T7）不在本刀。
- 冻结面声明：不改 `capir/capir.json` / `capcontract/` / `ledger/` / `scripts/build-bridge.mjs` 转义段；不删改既有测试断言，只加。

## expected（机器断言）

| # | 判据 | expected |
|---|---|---|
| E1 | 父会话（binding.sessionId）approval ask 路由 | push 1 个 `ask.request`，`payload.sessionId === parent`，无 `childSessionId` / `parentSessionId`；verdict 回写为 `allowed-once` |
| E2 | 已 catalog 注册的子会话 approval ask 路由 | push 1 个 `ask.request`，`payload.sessionId === parent`（投递地址不变，answer/grant 仍在父通道），`payload.childSessionId === childSessionId`，`payload.parentSessionId === parent` |
| E3 | 未知会话（未注册/异父）approval ask | 不 push `ask.request`；host outcome `unavailable`；registry settle code `ASK_CHANNEL_UNAVAILABLE`；`ask.settled` 出现 1 次 |
| E4 | 父会话无 in-flight turn 时 ask | 与 E3 同（回归：既有 fail-closed 不变） |
| E5 | `validateAskRequest` 对新增字段 | `childSessionId` / `parentSessionId` 为可选非空字符串；缺省时解析结果不含这两字段 |
| E6 | 门禁 | 定向 `ask-answerers`/`ask-frames` 测试绿；`bun test` 全量绿；`pnpm run typecheck:entry` 绿；`pnpm run verify:assembly` 绿；`node scripts/check-capcontract.mjs` 绿 |

## 判后记录

observed 值在验证后写入提交说明与汇报文本；禁止回改本文件。
