# PREREGISTRATION — B2 按键/输入 trace 取证开关（write-once，捕获前落盘，never edited after capture）

本文件在任何实现改动与证据捕获之前写入磁盘。它是 B2 报告 `expected` 列的冻结预测值。
状态与 observed 值事后依据 `pass criterion` 判定，写入报告；禁止回改本文件的 `expected`。

- Preregistered at (UTC): 2026-11-23T02:08Z
- Worktree / branch: `/Users/qingguee/repo/dsh-opentui-wt-uibatch-1123` @ `feat/ui-batch-1123`
- Pre-change HEAD: `485f0e0c35e4252aa0de777488869cf6a0edc50a`
- Evidence directory: `.proof/b2-key-trace/`
- 需求定案（用户已批准）：`DSH_OPENTUI_KEY_TRACE=<文件路径>` 开启时把按键与输入框文本变化写成 JSONL 取证日志；未设该变量时零行为变化、零 IO。
- 埋点漏斗选择（实现方案，捕获前冻结）：统一选 `context/keymap.tsx` 的 `Keymap.Provider` 内 `keymap.intercept("key", …)`。理由：keymap 在 renderer 的全局 keypress 监听上先于所有 layer dispatch 与 renderable handler 运行（`handleKeyEvent` → keyHooks，@opentui/keymap 0.8.1 `src/index.js:2948-2995,4476`），Provider 在应用根挂载一次，是「所有到达 app 的物理键」的唯一统一漏斗；trace 回调只读 event、不 consume/stopPropagation，因此不改变任何消费链。app.tsx 既有 priority=101 拦截承担选区复制且会吞键，不能作为全量漏斗（会漏掉被它消费的键）。
- 格式参考：`docs/upstream-opentui-paint-bug-draft.md:164-170` 的历史 trace 设想；本实现自研，不照抄其字段（不用 name/seq/by/row）。
- 一手事实：`research/2026-11-23-ui-batch/01-composer-copy-facts.md` §4（composer 结构）；composer 程序化赋值点为 `component/prompt/index.tsx` 的 `input.setText`/`input.insertText`/`input.clear` 各调用点，文本变化统一经该组件 textarea 的 `onContentChange`。

## 预注册 expected（E1–E6）

criterion 一律机器可判、环境无关；不写 `present=true` 类运行时状态断言。文件路径用临时目录注入，不写死任何环境路径。

| id | assertion | expected（FROZEN，捕获前填） | pass criterion（checkable） | changed path | level | evidence file | depends on |
|----|-----------|------------------------------|----------------------------|--------------|-------|---------------|------------|
| E1 | env 关 → 无文件、无埋点开销 | `process.env.DSH_OPENTUI_KEY_TRACE` 未设置时，模块导出的 live sink 为 `undefined`；调用 trace API 不产生任何文件 | 单测：在干净 env 下断言导出的 `keyTrace === undefined`；临时目录在调用后仍为空（readdirSync 长度 0）；源码结构断言 keymap 的 intercept 注册被 `if (keyTrace)` 包裹 | `src/util/key-trace.ts`, `src/context/keymap.tsx` | Unit + structural | `04-key-trace-unit.log` | — |
| E2 | env 开 → 按键行落盘且 JSON 合法 | 注入临时文件路径后，`key({key,ctrl,alt,shift,super})` 写一行：`t` 为毫秒整数，`src === "key"`，key/ctrl/alt/shift/super 与入参一致；文件每行 `JSON.parse` 成功 | 单测：写入后读取临时文件，逐行 `JSON.parse` 成功；断言字段精确值；`head`/`len` 不出现在 key 行 | `src/util/key-trace.ts` | Unit | `04-key-trace-unit.log` | — |
| E3 | env 开 → contentChange 行落盘且 JSON 合法 | `contentChange(len,head)` 写一行：`src === "contentChange"`，`len` 为整数，`head` 为入参前 32 字符；head 超过 32 字符时截断 | 单测：读取临时文件断言 `src`/`len`/`head` 精确值；构造 40 字符文本断言 head 长度恰为 32 | `src/util/key-trace.ts` | Unit | `04-key-trace-unit.log` | — |
| E4 | env 开 → composerSet 各来源标注落盘 | `composerSet(from,len)` 对枚举 `draft-restored`/`failure-refill`/`history`/`submit-clear`/`paste`/`reset`/`other` 各写一行；源码中每个程序化赋值点均带有其中一个 `from` 标注 | 单测：7 个来源各调用一次，读取文件断言 7 行 `src === "composerSet"` 且 `from` 集合恰为枚举全集；结构断言 `component/prompt/index.tsx` 中每个 `input.setText`/`input.insertText`/`input.clear` 调用邻近有 `composerSet(` 或统一 helper 调用，且冻结 7 个字符串字面量均出现 | `src/util/key-trace.ts`, `src/component/prompt/index.tsx` | Unit + structural | `04-key-trace-unit.log` | — |
| E5 | 坏路径不崩（写失败静默） | 指向不存在目录的路径时，所有 trace 调用不抛异常、不写文件、app 不受影响 | 单测：`createTraceSink("/nonexistent-dir-.../x.jsonl")` 后三种调用均不 throw | `src/util/key-trace.ts` | Unit | `04-key-trace-unit.log` | — |
| E6 | 惰性初始化 | sink 创建时不打开文件；首次写调用才创建并 append 文件；多次调用追加而非覆盖 | 单测：创建 sink 后断言临时路径不存在；一次写入后文件存在；三次写入后恰 3 行且前序行未被覆盖 | `src/util/key-trace.ts` | Unit | `04-key-trace-unit.log` | — |

非断言证据项：`01-env-snapshot.log`（node/bun/branch+SHA）、`04-key-trace-unit.log`（bun test）、`05-typecheck-entry.log`（typecheck:entry）。

## 门禁预期

- 受影响 package `@dsh-opentui/tui-base`：相关测试 `bun test` 全绿（既有断言不改）；`bun run typecheck:entry` 退出码 0。
- 既有测试文件路径不改其断言；新增测试仅覆盖 E1–E6。
- 写失败静默以「不 throw」为判定，不要求错误日志（trace 不能反过来弄崩 app）。

## USER-JUDGMENT 预案（≤5 项，三类边界；记录 + 默认，不拦门禁）

- U1（交互手感）：是否给 trace 开关键位/命令。默认：无，纯环境变量控制（需求定案）。
- U2（文案措辞）：日志字段名与枚举字符串。默认：按用户批准的规格原样实现（`t`/`src`/`key`/`ctrl`/`alt`/`shift`/`super`/`len`/`head`/`from`）。
- U3（真机手感）：「进入输入态残留字符」的具体复现与取证判定。NOT RUN（属于使用阶段的人工取证，代码层不可判）；本片只提供取证工具，不作结论。

## PASS 判定式

E1–E6 全达成 ∧ 受影响 tui-base 测试全绿 ∧ `typecheck:entry` 退出码 0 ∧ 无未声明 NOT RUN ∧ JUDGMENT 项均有默认记录 → PASS。
真机残留字符复现为显式 NOT RUN，不拦技术门禁。红就红着报。

## 反作弊与边界

- 仅追加埋点，不改任何既有按键/粘贴/提交/历史行为分支；不改 app.tsx。
- 不碰他人所有文件：widgets-dock.tsx / dock-visibility.ts、skin、pane-focus、bridge 包全部。
- v2 `routes/session/composer-state.ts` 为 renderer-free 决策核心、无 textarea 直接赋值，与 vendored Prompt 不同构，本片不埋（任务允许不强制）。
- commit 只含本 concern 文件；research/ 与其他 subagent 的未跟踪/已改文件一律不 add；禁止 push。
