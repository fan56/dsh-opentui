# R4 typecheck 失败归因（06-typecheck.log 的 TS2322）

- 切片：UI batch 2026-11-23 / R4（`.proof/r4-permission-dialog/`）。
- 工作树：`/Users/qingguee/repo/dsh-opentui-wt-uibatch-1123`，分支 `feat/ui-batch-1123`。
- 成文时刻：2026-11-23。
- 性质：本文件为证据归因，解释 `06-typecheck.log` 中错误的来源；原始日志如实保留，不改写。

## 原始记录（06-typecheck.log）

```
src/routes/session/widgets-dock.tsx(1937,60): error TS2322: Type '{ children: Element[]; flexDirection: "row"; width: "100%"; flexShrink: number; wrapMode: string; }' is not assignable to type 'BoxProps'.
  Property 'wrapMode' does not exist on type 'BoxProps'.
```

运行命令：`cd packages/tui-base && bun run typecheck:entry`（`tsc -p tsconfig.entry.json`）。

## 归因结论：错误不在 R4 改动面

1. **R4 提交不碰该文件**：R4 证据目录随提交 `7cb5bd3`（`feat(permission): bare /permission opens preset picker; tolerate unbound session`）落地。该提交的改动面仅为 `packages/tui-base/src/routes/session/commands.ts`、`packages/i18n/locales/{en,zh-CN}.json`、`packages/shell/src/client/bridge-session-seam.ts` 及对应测试；**不含** `packages/tui-base/src/routes/session/widgets-dock.tsx`。
2. **R4 提交时该文件不足 1937 行**：`git show 7cb5bd3:packages/tui-base/src/routes/session/widgets-dock.tsx | wc -l` = **1930**。错误定位的第 1937 行在 R4 提交点并不存在，故 TS2322 不可能来自 R4 自身代码。
3. **来源为并发 R2 切片的中间态**：同一工作树内 R2（dock/tabs）切片正并发改写 `widgets-dock.tsx`（该提交点行数已增至 2064）。报错形态是 `<box ... wrapMode="...">`——`wrapMode` 是 `<text>` 的合法属性，却不属于 `BoxProps`；这是并发中间态里该属性被误挂在 box 上的产物，与 R4 的 `/permission` 预设选择器改动无因果关系。

## 终态验证

- 在批次终态重跑 `cd packages/tui-base && bun run typecheck:entry`（`tsc -p tsconfig.entry.json`）：**exit 0，无输出**，typecheck 绿（实测于 2026-11-23）。
- 当前 HEAD 上 `wrapMode="none"` 仅出现在 `<text>` 元素（`widgets-dock.tsx:1953,2081,2092`），用法合法；TS2322 已随并发切片收敛而消失。
- 结论：R4 的 E6 门禁（typecheck:entry exit 0）在终态成立；`06-typecheck.log` 记录的是并发窗口的瞬时失败，非 R4 交付缺陷。
