# PREREGISTRATION — R1 输入框复制（write-once，捕获前落盘，never edited after capture）

本文件在任何实现改动与证据捕获之前写入磁盘。它是 R1 报告 `expected` 列的冻结预测值。
状态与 observed 值事后依据 `pass criterion` 判定，写入报告；禁止回改本文件的 `expected`。

- Preregistered at (UTC): 2026-11-23T01:29Z
- Worktree / branch: `/Users/qingguee/repo/dsh-opentui-wt-uibatch-1123` @ `feat/ui-batch-1123`
- Pre-change HEAD: `fff0a3b5d10844669406669419f7cd8b64888d18`
- 挂载面事实（一手核验）：当前线上挂载 `component/prompt/index.tsx` 的 `<Prompt>`（`routes/session/index.tsx:1678`、`routes/home.tsx:102`）；配置走 `config/index.tsx` → `config/keybind.ts`。`config/v1/*` 在 src 内无 Provider 挂载。证据：`research/2026-11-23-ui-batch/01-composer-copy-facts.md:13`。
- 选区/剪贴板通道：聚焦 textarea = `TextareaRenderable extends EditBufferRenderable`，暴露 `hasSelection()`/`getSelectedText()`/`selectAll()`；写入通道 `src/clipboard.ts` 的 `writeText(destination:"all-available")`。证据：同 research 文件 §4。
- 键位层事实（一手核验）：app 层 ctrl+c 终端选区拦截为 `keymap.intercept("key", …, {priority:101})`（`app.tsx:589-598`）；@opentui/keymap 0.8.1 的 intercept 在 layer dispatch 之前运行（`index.js:2974-3002`），且仅当 interceptor 调用 `stopPropagation()` 才吞掉事件。composer 的无选区行为由 `prompt.clear`（`component/prompt/index.tsx:956-962`）与 shell 模式 ctrl+c（`:991-1006`）提供，本片一字不改。
- Evidence directory: `.proof/r1-composer-copy/`
- Acceptance target（用户拍板，`research/2026-11-23-ui-batch/00-decisions.md:3-6`）: 有选区 → `clipboard.write(getSelectedText())`；无选区 → 完全走既有行为（清空输入行/空输入退出，不变）。键位 ctrl+c（全平台）+ super+c 并绑（终端不透传则无损）。不做 ctrl+y。

## 预注册 expected（E1–E4）

criterion 一律机器可判、环境无关；不写 `present=true` 类运行时状态断言；不写终端是否透传 cmd+c 等环境依赖子句。

| id | assertion | expected（FROZEN，捕获前填） | pass criterion（checkable） | changed path | level | evidence file | depends on |
|----|-----------|------------------------------|----------------------------|--------------|-------|---------------|------------|
| E1 | 新增 copy binding id 与默认键位 | `config/keybind.ts` 的 `Definitions` 含 `input.copy`，默认字符串恰为 `ctrl+c,super+c`；`prompt.clear` 默认仍为 `ctrl+c`；`app.exit` 默认仍为 `ctrl+c,ctrl+d,<leader>q` | 单测：`TuiKeybind.defaultValue("input.copy") === "ctrl+c,super+c"` 且 `defaultValue("prompt.clear") === "ctrl+c"` 且 `defaultValue("app.exit")` 未变；`TuiKeybind.parse({})` 含 input.copy 键 | `packages/tui-base/src/config/keybind.ts` | Unit | `04-copy-unit.log` | — |
| E2 | 有选区 → 写剪贴板一次 | 对有选区源（hasSelection=true, getSelectedText="selected text"）调用 copy 处理，`clipboard.write` 恰调用 1 次且实参为 `"selected text"`；返回 true | 单测断言 `writes.length === 1 && writes[0] === "selected text"`；调用次数计数由 mock 记录 | `packages/tui-base/src/component/prompt/copy.ts`（纯处理函数）+ `component/prompt/index.tsx`（调用点） | Unit | `04-copy-unit.log` | — |
| E3 | 无选区 → 不写剪贴板且不改既有清空行为 | hasSelection=false 时，`clipboard.write` 调用 0 次，copy 处理返回 false（不拦截、不 preventDefault，事件继续由既有 `prompt.clear`/空输入退出路径处理）；`prompt.clear` 绑定层与其 enabled 条件字节未变 | 单测断言 `writes.length === 0 && result === false`；`prompt.clear` 层断言为 structural（源码中 `bindings: ["prompt.clear"]` 与其 `store.prompt.text !== ""` enabled 仍存在） | `packages/tui-base/src/component/prompt/copy.ts`, `component/prompt/index.tsx` | Unit | `04-copy-unit.log` | — |
| E4 | composer 层优先并 preventDefault（有选区时 ctrl+c 不吃掉、不落 app 层） | copy 绑定层 priority 高于 `prompt.clear`（0）与 shell ctrl+c（1），取 priority=2；绑定默认 `preventDefault !== false`（keymap 默认 true → 命中即 preventDefault + stopPropagation）；app 层 intercept 代码块（`app.tsx:586-599`）字节未改 | 单测/结构断言：`input.copy` binding value 不是 `preventDefault:false` 对象；`component/prompt/index.tsx` 含 `priority: 2` 且 `bindings: ["input.copy"]` 的层；`git diff` 不含 app.tsx | `component/prompt/index.tsx`, `config/keybind.ts` | Unit + structural | `04-copy-unit.log` | E1, E2 |

非断言证据项：`01-env-snapshot.log`（node/bun/branch+SHA）、`04-copy-unit.log`（bun test）、`05-typecheck.log`（package typecheck）。

## 门禁预期

- 受影响 package `@dsh-opentui/tui-base`：`bun test` 全绿（既有断言不改）；`bun run typecheck` 退出码 0。
- 既有测试文件路径不改其断言；新增测试仅覆盖 E1–E4。

## USER-JUDGMENT 预案（≤5 项，三类边界；记录 + 默认，不拦门禁）

- U1（交互手感）：复制成功后是否 toast。默认：无提示（用户拍板暂定），仅失败走既有 `toast.error` 通道。
- U2（文案措辞）：新 binding 描述文字与命令标题。默认：`Copy selected input text` / `Copy selection`，沿用英文 keybind 描述风格，无 i18n 改动。
- U3（真机手感）：mac 终端是否透传 cmd+c 给应用。NOT RUN（终端配置问题，代码内不可判）；不透传时终端原生复制生效，无损失。

## PASS 判定式

E1–E4 全达成 ∧ tui-base `bun test` 全绿 ∧ `typecheck` 退出码 0 ∧ 无未声明 NOT RUN ∧ JUDGMENT 项均有默认记录 → PASS。
真机 cmd+c 透传为显式 NOT RUN，不拦技术门禁。红就红着报。

## 反作弊与边界

- 不改 app.tsx 的 interceptor、不改粘贴/全选/readline 键、不做 ctrl+y、不动 config/v1/*。
- commit 只含本 concern 文件；research/ 等其他 subagent 的未跟踪文件与改动一律不 add。
