# PREREGISTRATION — B3 宿主 subagent 实时进度接入桥 / `agent.progress` 加法帧（write-once，实现与捕获前落盘，never edited after capture）

本文件在任何实现改动与证据捕获之前写入磁盘。它是 B3 报告 `expected` 列的冻结预测值。
状态与 observed 值事后依据 `pass criterion` 判定，写入报告；禁止回改本文件的 `expected`。

- Preregistered at (UTC): 2026-11-23T02:21Z
- Worktree / branch: `/Users/qingguee/repo/dsh-opentui-wt-uibatch-1123` @ `feat/ui-batch-1123`
- Pre-change HEAD: `2434f6fe6432686274e9b3dde51f614e875519d9`
- Runtime: node v26.8.1 / bun 1.4.4
- Evidence directory: `.proof/b3-agent-progress/`
- 需求定案（用户拍板，根治）：桥新增**加法帧** `agent.progress` 把子代理运行时的 rounds/tail 实时送进客户端，修复 spawn 时一次性 journal 读取导致 rounds=0 / tail 空、直到 settle 才刷新的冻结缺陷。帧协议为桥↔客户端自有协议，加法帧不改 protocolVersion、不触发 W8。
- 一手事实（宿主 live 面，已核）：`cb.onSubagentUpdate`（host 包 `@aiwayds/dsh-opentui@0.5.0` dist-host/index.js:1784-1798，产出含 `rounds`/`lastLine`/`elapsed`/`label` 的子代理快照）；该快照的喂数事件为 `agent/assistant-stream` 的 `text-delta`（:1941-1950，逐块累加 lastLine）与 `assistant/message`（:1752-1765，rounds+1 且 lastLine 取末行）。
- 接线可行性一手结论（实现前冻结，不得硬绕）：`onSubagentUpdate` 不是 cordis 事件，而是宿主 TUI 会话适配器 `turn(userText, cb)` 收到的 `cb` 回调对象字段（dist-host/index.js:1591-1593,2152-2159）；宿主包内无任何 `ctx.emit('subagent*')`（grep 零命中）。桥插件在 inproc 下与宿主共享 cordis `ctx`（已订阅 `session/event` / `agent/assistant-stream`，index.ts:3464-3465），并非进程隔离；但桥从不持有该 `cb` 对象，`ctx.on('onSubagentUpdate')` 不存在。**因此桥不直接订阅不可达的回调**，改为折叠喂给该回调的同一批 cordis live 事件（子代理 `assistant-stream` text-delta + 子会话 `assistant/message`，均由 `subagent/catalog` 索引确定父子归属），在桥内合成等价进度快照并发出 `agent.progress` 帧。这是用户要的「接实时事件根治」，不硬造不可达订阅。
- 节流参数（实现前冻结，常量化 + 注释）：每 child 窗口 `400ms`（合法区间 300–500ms）；leading 边缘首帧即时发、窗口内后续合并为尾值、窗口结束 trailing 必发；`agent.settle` 不受节流、即时且终态权威；发 settle 前先冲刷该 child 的 pending progress 并清 timer，保证 progress 不晚于 settle 到达。

## 预注册 expected（E1–E8）

criterion 一律机器可判、环境无关；不写 `present=true` 类运行时状态断言；不依赖真机/网络/宿主版本可达性。断言对象为桥协议单测 + 客户端折叠单测，全部在仓库内 fake-cordis-ctx / fake-transport 下运行。

| id | assertion | expected（FROZEN，捕获前填） | pass criterion（checkable） | changed path | level | evidence file | depends on |
|----|-----------|------------------------------|----------------------------|--------------|-------|---------------|------------|
| E1 | 桥把子代理 live 事件合成为 `agent.progress` 加法帧 | 子会话 `assistant/message` 与子代理 `agent/assistant-stream` text-delta 各至少触发一帧 `agent.progress`，payload 字段恰含 `childId`/`sessionId`/`rounds`/`lastLine`/`elapsedSec`（另可含 `turnId`），`sessionId` 为父绑定会话 | 桥单测：fake ctx 先发 `subagent/catalog` 建立父子，再发子会话 `assistant/message` 与子代理 text-delta；`eventFrames("agent.progress").length >= 2`，每帧 payload 对 E1 字段集逐字段存在且类型正确（rounds/elapsedSec 为 number，childId/sessionId/lastLine 为 string），sessionId === 父 sessionId | `packages/bridge/src/index.ts` | Unit | `04-bridge-progress-unit.log` | — |
| E2 | rounds 单调递增、lastLine 取最新文本 | 每个 `assistant/message` 使 rounds +1；text-delta 追加进 lastLine；同 child 后续 progress 帧 rounds 不小于前帧 | 桥单测：连续发 3 条子 `assistant/message` 断言末帧 `rounds === 3`；发 text-delta "abc" 后断言末帧 `lastLine` 含 "abc"；逐帧断言 rounds 序列非递减 | `packages/bridge/src/index.ts` | Unit | `04-bridge-progress-unit.log` | E1 |
| E3 | 节流：窗口内合并、尾值必发、首帧即时 | 400ms 窗口内对同一 child 的 N 次更新，`agent.progress` 帧数 < N 且 >= 2（leading + trailing）；窗口末帧 lastLine 为窗口内最后一次更新的值；首帧在首个更新后同步发出（不等待窗口） | 桥单测：用 fake timers 或真实短等待，窗口内连发多次 text-delta，断言帧数严格小于更新次数且末帧 tail 等于最后一段文本；首帧在第一次更新调用返回后已可见 | `packages/bridge/src/index.ts` | Unit | `04-bridge-progress-unit.log` | E1 |
| E4 | 每 child 独立节流 + settle 即时且冲刷进度 | 两个 child 各自leading 即时发一帧（互不抑制）；`tool-workflow/agent-end` / 子会话 settle 触发的 `agent.settle` 不受节流即时发出，且其前不存在 pending progress 晚到 | 桥单测：childA/childB 各发一次更新，断言各出现 `agent.progress`；随后发 agent-end，断言 `agent.settle` 立即出现，且其后不再新增该 child 的 `agent.progress` 帧 | `packages/bridge/src/index.ts` | Unit | `04-bridge-progress-unit.log` | E1 |
| E5 | 客户端折叠：progress 更新 views 的 rounds/lastLine 并 emit | 中途 `agent.progress` 帧按 childId 更新 `#subagentViews` 中 running child 的 rounds/lastLine/elapsedSec，`onSubagentViews` listener 收到含新值的快照 | 客户端单测：先发 `agent.spawn` 建 running child（rounds=0、无 lastLine），再发 `agent.progress{rounds:3,lastLine:"hi",elapsedSec:2.5}`；断言 `subagentViews()` 对应 child rounds===3、lastLine==="hi"、elapsedSec===2.5，且 listener 快照数增加、末快照含新值；不改 `#subagentJournalLoaded` 一次性守卫（结构断言守卫仍在且语义不变） | `packages/shell/src/client/bridge-session-seam.ts` | Unit | `05-client-fold-unit.log` | — |
| E6 | progress 不伪造行、不污染终态 | 对未知 childId 或已 settle child 的 `agent.progress` 被忽略（不新增行、不改 settled 行）；progress 帧的 sessionId 与当前绑定不符时被丢弃 | 客户端单测：无 spawn 时直接发 progress 断言 roster 仍为空；spawn+settle 后发 progress 断言 settled 行 rounds/lastLine 未被改写；sessionId 不符的 progress 不改变任何 view | `packages/shell/src/client/bridge-session-seam.ts` | Unit | `05-client-fold-unit.log` | E5 |
| E7 | settle 终态覆盖 progress 中间态 | 已 E5 更新过的 running child 在 `agent.settle` 后进入终态，rounds/lastLine 由 settle 路径的 journal 重读/冻结快照决定，progress 中间态不再回写终态 | 客户端单测：progress 设为 rounds=3/lastLine="mid"，再发 `agent.settle`（replies 注入 journal.replay 权威 rounds=9/lastLine="final"），断言 settle 后 view.status 为终态且 rounds/lastLine 为 journal 权威值；其后 progress 帧不再改写该终态 | `packages/shell/src/client/bridge-session-seam.ts` | Unit | `05-client-fold-unit.log` | E5, E6 |
| E8 | spawn/settle 行为不回归 | 既有桥帧测试与客户端生命周期测试全部仍绿；`typecheck:entry` 退出码 0 | 命令：`bun test packages/bridge/test/agent-lifecycle.test.ts packages/bridge/test/<新测试>` 与 `bun test packages/shell/test/bridge-session-seam.test.ts` 全绿；`bun run typecheck:entry` 退出码 0 | `packages/bridge/src/index.ts`, `packages/shell/src/client/bridge-session-seam.ts` | Unit + typecheck | `04-bridge-progress-unit.log`, `05-client-fold-unit.log`, `06-typecheck-entry.log` | E1–E7 |

非断言证据项：`01-env-snapshot.log`（node/bun/branch+SHA）、`04-bridge-progress-unit.log`（桥单测）、`05-client-fold-unit.log`（客户端单测）、`06-typecheck-entry.log`（typecheck:entry）。

## 门禁预期

- 受影响 package `@dsh-opentui/bridge`、`@dsh-opentui/shell`、`@dsh-opentui/tui-base`：相关测试 `bun test` 全绿（既有断言不改）；`bun run typecheck:entry` 退出码 0。
- 既有测试文件断言不删不改；新增测试仅覆盖 E1–E8。
- 节流窗口取常量 `400ms`，注释标注合法区间 300–500ms 与「尾值必发、settle 不受节流」；常量值变化须同步改单测时间预期（当前预注册按 400ms 冻结）。

## USER-JUDGMENT 预案（≤5 项，三类边界；记录 + 默认，不拦门禁）

- U1（交互手感）：节流窗口具体毫秒数（300/400/500）。默认：400ms（区间中点，实时性与事件量平衡）。
- U2（文案/字段措辞）：`agent.progress` 帧类型名与 payload 字段名。默认：按定案 `agent.progress` + `childId/sessionId/rounds/lastLine/elapsedSec`（+ 可选 `turnId`）。
- U3（真机手感）：真机委托子代理时 dock tail/round 实时跳动的肉眼确认。默认：NOT RUN（真机联调属使用阶段人工取证，本片只交代码层证据，不作结论）。
- U4（查看器）：`/subagents` 详情查看器仍读 journal（不在本刀范围）。默认：NOT RUN，明确标出。

## PASS 判定式

E1–E8 全达成 ∧ 受影响 bridge/shell/tui-base 测试全绿 ∧ `typecheck:entry` 退出码 0 ∧ 无未声明 NOT RUN ∧ JUDGMENT 项均有默认记录 → PASS。
真机联调（U3）与 /subagents 查看器（U4）为显式 NOT RUN，不拦技术门禁。红就红着报。

## 反作弊与边界

- 只加 `agent.progress` 帧与客户端折叠；不改 spawn/settle 既有语义、不改 `#subagentJournalLoaded` 一次性守卫、不改 protocolVersion/wire/CapIR（加法帧不触发 W8）。
- 不碰他人所有文件：research/ 下其他 subagent 的未跟踪文件（01–05）、B1/B2/b4 等其它 proof 与源码一律不 add；composer/dock/skin/pane-focus/permission 等其它 concern 文件一律不动。
- 不可达回调不得硬绕：不伪造 `ctx.on('onSubagentUpdate')` 订阅、不在桥内假造宿主回调对象；折衷方案（折叠 cordis live 事件）须在报告写明一手接线结论。
- commit 只含本 concern 文件；禁止 push。
