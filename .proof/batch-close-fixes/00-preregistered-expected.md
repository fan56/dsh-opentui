# PREREGISTRATION — 批次收口修复刀（oldfox 终评放行前置条件）/ 5 项机器断言（write-once，实现与证据捕获前落盘，never edited after capture）

本文件在任何实现改动与证据捕获之前写入磁盘。它是本刀报告 `expected` 列的冻结预测值。
状态与 observed 值事后依据 `pass criterion` 判定，写入最终汇报；禁止回改本文件的 `expected`。

- Preregistered at (UTC): 2026-11-23T03:06Z
- Worktree / branch: `/Users/qingguee/repo/dsh-opentui-wt-uibatch-1123` @ `feat/ui-batch-1123`
- Pre-change HEAD: `9caab9b2d13f2c8a74fab44d0310ffe894eb8f08`（S4 落地提交；本刀在其上修复）
- Runtime: node v26.8.1 / bun 1.4.4
- Evidence directory: `.proof/batch-close-fixes/`
- 流程：W5（`docs/workflows/w5-proof-evidence.md`）预注册 write-once。
- 范围：五件事逐项独立 commit（trace 敏感性注释搭车第 1 项），预计 4–5 个 commit；禁止 push。
- 冻结面照旧：handshake / CAP_* / capir / capcontract / ledger 生成物 / build-bridge 转义段零 diff；
  `provenance.json` 只走评审票通道（本刀第 5 项票 `.proof/batch-close-fixes/00-provenance-ticket-2.md`）。

> **never edited after capture**：正文在证据捕获前落盘，捕获后不回改。若事后追加裁决附则，仅以「附则」段落追加，不修改正文断言。
> **成文方式声明**：一次性成文（非逐节顺写）；E1→E5 按任务顺序编号，无逐节时间戳冒充。

## 预注册 expected（E1–E5）

criterion 一律机器可判、环境无关；不写 `present=true` 类运行时宿主状态断言；不依赖真机/网络/宿主版本可达性。
全部在仓库内 fake-transport / 真渲染 fixture / 门禁命令输出下运行。

| id | assertion | expected（FROZEN，捕获前填） | pass criterion（checkable） | changed path | level | evidence file | depends on |
|----|-----------|------------------------------|-----------------------------|--------------|-------|---------------|------------|
| E1 | 2 个 shell real-renderer 失败修复（R5 漏网） | 两文件各在受影响用例 setup 显式 `markPanelActive("activity")`，并在 `afterEach` 调 `resetActivePanel()`；两文件单跑 0 fail、shell 全量 0 fail | 命令 `bun test packages/shell/test/shell-render-regression-ft.test.tsx packages/shell/test/shell-render-incident-motion-ft.test.tsx` 退出 0 且 fail=0；`grep -c 'markPanelActive("activity")'` 两文件各 ≥1；`grep -c 'resetActivePanel'` 两文件各 ≥1；`bun test packages/shell/test` 退出 0 且 fail=0 | `packages/shell/test/shell-render-regression-ft.test.tsx`、`packages/shell/test/shell-render-incident-motion-ft.test.tsx` | Unit(render) | `01-shell-render-fixes.log`、`06-shell-full.log` | — |
| E2 | B3 reasoning-delta 折叠进 lastLine | `assistantMessageLastLine` / `noteChildProgress` 路径把子代理 `reasoning-delta` 也折进该 child 的 lastLine（对齐宿主 remote-subagents.ts:529） | 桥单测：发子会话 `reasoning-delta` 后，该 child 的 `childProgress` lastLine 含该 delta 文本；`bun test <bridge progress test>` 退出 0 且 fail=0；不新增 wire id、不改 protocolVersion | `packages/bridge/src/index.ts` + 桥测试 | Unit | `02-bridge-reasoning-fold.log` | — |
| E3 | B3 残留清理：noteSettled 清 childProgress/progressSentFp | settle 后该 child 的 `childProgress` 条目与 `progressSentFp` 指纹残留均被清除 | 桥单测：该 child settle 后，`childProgress` 不再含该 childId、`progressSentFp` 不再含该 childId 的指纹；后续同 childId progress 不再复活该条目；`bun test <bridge progress test>` 退出 0 且 fail=0 | `packages/bridge/src/index.ts` + 桥测试 | Unit | `03-bridge-settle-cleanup.log` | E2 |
| E4 | conflict 判定口径统一（shell ↔ bridge） | shell `/conflict/i` message fallback 不再作为唯一判定：改为与 bridge 同口径的 code/name 判定；若保留 message fallback 必须带「显示层宽容语义，与 bridge 判定口径不同」注释，且两侧各归各单测 | shell/bridge 单测全绿、退出 0；`grep -n '/conflict/i'` 的残留用法若存在必带 display-tolerance 注释；code/name 判定分支有在档单测；冻结面零 diff | `packages/shell/src/client/bridge-settings-route.ts`（+ 必要时 bridge 侧）+ 单测 | Unit | `04-conflict-unify.log` | — |
| E5 | provenance 第二票 + note 更新 + gen-ledger 双跑 sha | 第二张票 `.proof/batch-close-fixes/00-provenance-ticket-2.md` 落盘（理由/前后文/保留条件）；note 中过时的 "faces still use REAL local file I/O" 一句改为 S4 落地后准确表述；gen-ledger 双跑 sha256 字节一致 | 票文件三段齐备；`grep -n 'REAL local file I/O'` 于 provenance.json 的命中句已含 S4 时效限定（不再无期限声称 faces 走本地文件）；`node scripts/gen-ledger.mjs` 连跑两次，产物 sha256 前 8 位相同且 `git diff` 对 ledger 生成物为 0 | `ledger/provenance.json` + 票文件 | Gate | `05-provenance-genledger.log` | — |

## 通用门禁预期（搭车项）

- trace 敏感性注释：`packages/tui-base/src/util/key-trace.ts` 头部加一行「trace 文件记录用户输入片段，属敏感数据面，勿入日志/工单」（随第 1 项 commit 搭车）。机器可判：`grep -n '敏感数据面' packages/tui-base/src/util/key-trace.ts` 命中 ≥1。
- 受影响包 scoped 测试 + `typecheck:entry` 退出码 0（`06-verify.log`）。
- 冻结面零 diff（handshake / CAP_* / capir / capcontract / ledger 生成物 / build-bridge 转义段）。

## USER-JUDGMENT 预案（≤5 项，三类边界；记录 + 默认，不拦门禁）

- U1（技术取向，第 1 项）：shell 用例锚定 heavy 字形 vs 改用非 heavy 标题文本定位。默认：照 tui-base 先例 `markPanelActive("activity")` + afterEach 复位，最小改动、保留原断言强度。
- U2（判定口径，第 4 项）：shell 彻底删 `/conflict/i` fallback vs 保留并注释为显示层宽容。默认：按代码现实定；若旧宿主无 code 的现实存在则保留并加注释声明口径不同 + 各归各单测。
- U3（措辞，第 5 项）：provenance note 更新句的具体措辞。默认：settings/config/agents seam faces 经宿主服务（source-aware，缺席降级 local-file）、credentials 仍 NOT_WIRED/本地，按 S4 实际写。

## PASS 判定式

E1–E5 全达成 ∧ trace 注释命中 ∧ 受影响包 scoped 测试全绿 ∧ `typecheck:entry` 退出 0 ∧ shell 全量 0 fail ∧ 冻结面零 diff ∧ gen-ledger 双跑 sha 一致 ∧ 无未声明 NOT RUN → PASS。
真机联调不在本刀范围，显式 NOT RUN，不拦技术门禁。红就红着报，不自创豁免。

## 反作弊与边界

- 不改 handshake / CAP_* / capir / capcontract / ledger 生成物 / build-bridge 转义段；provenance.json 只走票通道。
- 既有测试断言不删不改（除第 1 项加 setup + afterEach、第 2/3/4 项新增断言）；新增测试仅覆盖 E2/E3/E4。
- 不碰未跟踪的 research/ 文件（01–05）、他人 proof 与其它 concern 源码；commit 只含本 concern 文件；禁止 push。
- 措辞强度不超证据：单测绿只写 scoped 绿，不冒充真机；gen-ledger 双跑一致只写字节 sha 一致。
