# PREREGISTRATION — B2 followup: composer 侧 trace 埋点迁移到发行 v2 路由（write-once，捕获前落盘）

本文件在任何实现改动与证据捕获之前写入磁盘。它是本切片的 `expected` 冻结预测值。
状态与 observed 事后依据 `pass criterion` 判定，禁止回改本文件的 `expected`。

- Preregistered at (UTC): 2026-11-23T05:09Z
- Worktree / branch: `/Users/qingguee/repo/dsh-opentui-wt-uibatch-1123` @ `feat/ui-batch-1123`
- Pre-change HEAD: `84b2ce72a28b681860bb95f880d531195183652c`
- Evidence directory: `.proof/b2b-trace-v2/`
- 问题（一手事实）：发行客户端 bundle 由 `examples/v2-entry.tsx` → `src/routes/session/session-composer.tsx` 挂载，不含 v1 `src/component/prompt/index.tsx`。B2 首轮埋点全落在 v1，发行包永不触发。共享按键漏斗 `src/context/keymap.tsx` 的 `key` 行有效。
- 基线（改动前实测，`packages/shell/dist/client/index.js`）：sink 定义已在 bundle（`DSH_OPENTUI_KEY_TRACE` ×1、`composerSet` ×2、`contentChange` ×2、`keyTrace` ×4），但 `keyTrace?.` 调用点计数 = **0** —— sink 被 keymap 拉入，composer 侧零调用。
- 需求定案：v2 composer 文本变化写 `contentChange` 行；每个程序化赋值点写 `composerSet(from, len)` 行；env 关闭时零行为变化；v1 埋点保留不动。
- 来源词表：沿用 `key-trace.ts` 既有枚举，追加 `steer-queue`（v2 busy 提交选择队列/转向后的清空），追加处在枚举注释注明。
- 脱敏纪律：trace 文件含用户输入片段（`head` ≤32 字符），属敏感数据面；证据目录只保存源码 grep / 测试输出 / bundle grep，**不保存任何真实 trace 文件、不贴用户输入内容**；日志中只出现测试夹具自造的 ASCII 串。

## 来源映射表（捕获前冻结）

| v2 赋值点（当前 HEAD file:line） | 语义 | `from` |
|---|---|---|
| `session-composer.tsx` interceptSubmit `apply` 回调 | slash 缩写展开改写 | `other` |
| `session-composer.tsx` slash 命令消费后的 `editor.setText("")` | 命令清空 | `other` |
| `session-composer.tsx` busy chooser 分支 `editor.setText("")` | 转向/入队后的清空 | `steer-queue` |
| `session-composer.tsx` 普通提交 `editor.setText("")` | 提交后的清空 | `submit-clear` |
| `session-composer.tsx` `recallStep` ↑ `textarea.setText(step.text)` | 历史召回 | `history` |
| `session-composer.tsx` `recallStep` ↓ `textarea.setText(step.text)` | 历史召回/草稿恢复 | `history` |
| `session-composer.tsx` `completeKey` `textarea.setText(result.text)` | slash Tab 补全改写 | `other` |

不埋点项（附一手理由，捕获前冻结）：
- `composer-state.ts` 的 `:136/:156-175/:191/:212-215` 是 renderer-free 决策核心的**状态字段赋值**（draft 槽、history.move 返回值、reset 清草稿、queueItems），全文件无任何 `setText`/textarea 访问（改动前 grep 实证）。在其内部记 `composerSet` 会产出与真实输入框写入不对应的伪事件，故只在真正写 textarea 的 `session-composer.tsx` 埋点。
- `paste` 源在 v2 由 `TextareaRenderable.handlePaste` 原生处理，无程序化赋值点；粘贴后的文本变化经 `contentChange` 记录。`reset` 源在 v2 无对应 textarea 写入（`resetDeliveries()` 只清队列/回执，不动草稿文本）。两者保留在枚举中供 v1 兼容，v2 不强行产出。
- `v2-entry.tsx:1287` `composerRef.node().setText(text)`（/history 的 onRefill）是发行包内另一处外部赋值，但该文件非本片所有权（刚被 84b2ce7 改动，非必要不动）；记为已知缺口，不在本片埋点。

## 预注册 expected（V1–V5）

criterion 一律机器可判、环境无关；不写 `present=true` 类运行时状态断言。

| id | assertion | expected（FROZEN） | pass criterion（checkable） | changed path | level | evidence file |
|----|-----------|-------------------|----------------------------|--------------|-------|---------------|
| V1 | 枚举兼容 + 新来源 | `ComposerSetSource` 保留 v1 七个来源并新增 `steer-queue` | 单测/结构：`key-trace.ts` 中八个字符串字面量全部出现；`resolveTraceFromEnv` 与 `createTraceSink` 行为不变（E2–E6 既有断言不改） | `src/util/key-trace.ts` | Unit + structural | `04-key-trace-v2-unit.log` |
| V2 | v2 文本变化 → contentChange | SessionComposer textarea `onContentChange` 调用 `keyTrace?.contentChange(value.length, value)`，`value` 取自 `textarea.plainText` | 结构断言：session-composer.tsx 含 `keyTrace?.contentChange` 且在 `onContentChange` 块内；单测：注入 sink 后 `contentChange` 行字段精确且 `head` ≤32 | `src/routes/session/session-composer.tsx` | Unit + structural | `04-key-trace-v2-unit.log` |
| V3 | 每个程序化赋值点带正确来源 | 7 个 setText 赋值点各自紧随（≤2 行）一个 `traceSet(<来源>)`；来源集合 ⊆ {history, submit-clear, steer-queue, other} 且映射与上表逐项一致 | 结构断言：逐行扫描 session-composer.tsx，`/setText\(/` 赋值行计数 = 带 trace 的计数；七个来源字面量中的映射项逐一出现；`apply` 回调展开也计入 | `src/routes/session/session-composer.tsx` | Structural | `04-key-trace-v2-unit.log` |
| V4 | env 关闭零行为变化 | 所有埋点为 `keyTrace?.` 可选调用；`resolveTraceFromEnv({})` → undefined；无 sink 时调用不产生文件 | 结构断言：session-composer.tsx 的 trace 调用均为 `keyTrace?.` 形式、无裸 `keyTrace.` 解引用；单测：干净 env 下 live sink 为 undefined 且临时目录为空 | `src/routes/session/session-composer.tsx`, `test/key-trace-v2.test.ts` | Unit + structural | `04-key-trace-v2-unit.log` |
| V5 | **发行 bundle 含 v2 埋点** | `bun scripts/build-client.mjs` 退出码 0；产物 `packages/shell/dist/client/index.js` 中出现 **调用点** `keyTrace?.contentChange(` 与 `keyTrace?.composerSet(`（非仅 sink 定义），且含 `steer-queue`、`history`、`submit-clear` 来源字面量；source map 的 `sources` 含 `session-composer.tsx` | grep 产物（保存完整匹配行到 `06-bundle-grep.log`）：`grep -c 'keyTrace?\.' index.js` ≥ 2；逐来源字面量命中；`grep -c 'session-composer.tsx' index.js.map` ≥ 1。改动前基线 `keyTrace?.` 计数 = 0 | `scripts/build-client.mjs`（命令，不改）, 产物 gitignored | Build artifact grep | `06-bundle-grep.log` |

非断言证据项：`01-env-snapshot.log`（node/bun/branch+SHA）、`05-typecheck-entry.log`（typecheck:entry）、`07-tests-and-typecheck.log`（受影响包测试输出）。

## 门禁预期

- 受影响 package `@dsh-opentui/tui-base`：新增 `test/key-trace-v2.test.ts` 全绿；既有 `key-trace.test.ts` 断言不改且仍绿；`bun run typecheck:entry` 退出码 0。
- `bun scripts/build-client.mjs` 退出码 0；产物 grep 满足 V5。
- v1 `component/prompt/index.tsx` 埋点零改动（git diff 实证）。

## USER-JUDGMENT 预案（三类边界；记录 + 默认，不拦门禁）

- U1（交互手感）：是否新增 trace 开关键位/命令。默认：无，纯环境变量控制（需求定案，与 B2 一致）。
- U2（文案措辞）：新来源字面量 `steer-queue`。默认：按任务词表原样落盘，不改既有来源字符串。
- U3（真机手感）：trace 文件的实际取证判读。NOT RUN（使用阶段人工取证，代码层不可判）；本片只保证埋点进入发行包。

## PASS 判定式

V1–V5 全达成 ∧ tui-base 受影响测试全绿 ∧ `typecheck:entry` 退出码 0 ∧ build-client 退出码 0 ∧ 无未声明 NOT RUN ∧ JUDGMENT 项均有默认记录 → PASS。
红就红着报，不自行放宽 criterion、不改本文件 expected。

## 反作弊与边界

- 仅追加埋点：不改任何按键/粘贴/提交/历史行为分支；不改 app.tsx、keymap.tsx（B2 首轮成果保留）。
- 不碰 widgets-dock.tsx / transcript.tsx / dock 相关（另一 agent 正在修 tab 挂载）、v2-entry.tsx（84b2ce7 刚改）、v1 Prompt（保留埋点）。
- key-trace.ts 仅追加枚举成员（+注释）；不改 sink 实现、不改 ENV_NAME、不改字段格式。
- commit 只含本 concern 文件；其他 subagent 的未跟踪/已改文件一律不 add；禁止 push。
