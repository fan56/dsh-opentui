# dsh-opentui 验证体系（Verification Workflow）

## 完成的定义（Definition of Done）
一个 UI/功能改动"完成"当且仅当以下五层全绿：
1. **UT**：`bun test` — 纯逻辑单元（状态机/i18n/config/widget 行高计算）
2. **FT**：headless testRender 帧测试 — 断言**渲染后的帧**（不是源码推断）：
   布局、行数、截断、边框、颜色存在性
3. **E2E**：tmux 驱动真会话 + **时间序列采样**（0.5s 间隔）：
   - 闪烁 = presence toggle 计数 > 阈值
   - 单行默认 = 带边框多行采样 = 0
   - 溢出 = 输入框区域内出现 widget 字形
   - 截断 = widget 行长度 ≈ 终端宽
   - 清空 = 轮后 N 秒 widget 消失
4. **视觉审核**：tmux capture -e → PNG 渲染 → 亲眼 Read 验收（禁 grep-only 收尾）
5. **parity 对照**：与 dsh-tui-pi 同场景对拍（见 `verify/run-parity.mjs` —
   **unwired**：未接入 `scripts/test-tier.mjs` 的任何层，其默认 profile 名已过时，
   默认不跑）

## 当前状态
- UT 层：`bun run test:unit` — 77 文件 / 1299 用例（2026-11-14 实测；分层明细见
  [docs/testing.md §1.1](../docs/testing.md)）
- FT 层：`bun run test:ft` — 32 文件 / 268 用例，含 shell 渲染测试试点
  （`packages/shell/test/*-ft.test.tsx`：金丝雀 / 冒烟 / 渲染回归 / 按键路由 / 事故映射）
- E2E：`bun run test:e2e` — 本地 flows（假模型，默认）+ 容器套件（mock 模型）+ live 腿（opt-in）
- parity：`verify/run-parity.mjs` 存在但 **unwired**，默认 profile 名已过时，不在任何门禁内

## 运行
```
bun run test:unit                          # UT（bun test 分层跑批）
bun run test:ft                            # FT（真实渲染器帧测试）
bun run test:e2e                           # E2E（假模型默认腿 + 容器套件）
# node verify/run-parity.mjs              # 与 tui-pi 对拍 — unwired, default profile name deprecated
```

## R3 scratch-only 驱动（hard cap / pending abort）

```
bun verify/e2e-flows/r3-hardcap-abort.ts --out /tmp/r3-evidence
node verify/e2e-flows/run-flows.mjs --only=r3-hardcap-abort --keep
```

- 真链路：`apply()` 从 `packages/bridge/src/index.ts` 直接加载；NDJSON 帧走真
  `session.open` / `session.send` / `turn.abort` / ask answerer；registry 的 timer
  与 `settleExternal(aborted)` 全为产品代码。harness **不直接调用任何 registry 方法**。
- 注入面仅两个：config `maxAskWaitMs`（缩硬帽，默认 1h 不变）与 fake ctx 的
  `agent.cancel()` 触发真 AbortSignal（复刻宿主 driver 行为）。二者都不改产品语义。
- journal：registry 产出的 `ask.requested` / `ask.cancelled` 事件对象逐字写入 scratch
  `journal.jsonl`；只替换宿主 journal 的**存储后端**，不合成 journal 行。证据目录
  位于 scratch tmpdir，不写 `~/.dsh`、不写 `.proof/`、不 commit。
- `turn.abort` 是真实协议帧（`{method:'turn.abort', params:{turnId}}`），不是 UI
  Escape（旧证据里 Escape 被审批卡绑成 Reject，`/stop` 被当作 Allow）。
- 断言全部机器可判：终态行数、`settleReason`、`outcome`、`code`、`source`、frame
  `reason`；任一失败脚本退出码 1。

## R5 scratch-only 驱动（bridge stdin EOF → connection-closed）

```
bun verify/e2e-flows/r5-connection-closed.ts --out /tmp/r5-evidence
bun verify/e2e-flows/r5-connection-closed.ts --resume-last --journal /tmp/r5-evidence/journal.jsonl --out /tmp/r5-evidence
node verify/e2e-flows/run-flows.mjs --only=r5-connection-closed --keep
```

- 真链路与 R3 同一 harness：`apply()` 直接加载 `packages/bridge/src/index.ts`，
  真 NDJSON 帧走 `session.open` / `session.send` / host `approval/request`，真 registry
  产出 `ask.requested` / `ask.cancelled` 事件对象，逐字写入 scratch `journal.jsonl`。
  只替换宿主 journal 的**存储后端**，不合成 journal 行、不直调 registry 方法。
- 触发方式只有一种：两个 pending ask 升起后对 fake stdin 发一次 `'end'`，等价真
  stdin EOF。**不发** `session.close` / `turn.abort` / Escape / 信号；`agent.cancel()`
  为 no-op。驱动不注入 config，默认 1h 硬帽保持 armed，`timeout` 抢先即判 FAIL。
- EOF 后不提前 `process.exit`：有界轮询 scratch journal 文件直到两个终态行可读，
  再**直接读文件**断言每 pending id 恰好一条 `settleReason='connection-closed'`、
  `outcome='cancelled'`、`source='teardown'`、`kind='ask.cancelled'` 终态行，且该批 id
  的 `ask.settled` / `ask.cancel` live 帧数为 0。
- `--resume-last` 臂把上述真 journal 行按 `journal.replay` 的 `{seq,type,payload}`
  形状喂给真实 `deriveAskOutcomeNotice`（`ask-outcome.ts`，与 `--resume-last` 恢复共用
  的派生函数），逐 id 断言 notice `id='ask-outcome:<eventId>'`、文本逐字为
  `连接关闭时该请求已取消`。这是真实源码的 projection 级 replay；scratch 夹具无宿主
  session 存储，不启动完整 TUI（见预注册的 NOT RUN）。
- `/quit` 臂保持 **NOT VERIFIED**：pending 时审批卡吞掉 `/quit`（旧证据落 `answered`），
  本驱动不碰产品退出语义、不回改已发布 proof、不以 `/quit` 伪造 `connection-closed`。
- R3 驱动与断言零改动；既有测试只加不删；任一失败脚本退出码 1。

## R6 scratch-only 驱动（真 TUI 子会话 childSessionId 路由）

```
bun verify/e2e-flows/r6-child-routing.ts --out /tmp/r6-evidence
node verify/e2e-flows/run-flows.mjs --only=r6-child-routing --keep
```

- 该驱动跑**真 TUI 客户端**（不是 `apply()` 直调），用本地 `e2e/lib/mock-llm.mjs` 的
  两相位脚本作唯一模型路由：父 marker `E2E_R6_PARENT` 发真实 `use_agent`，子
  marker `E2E_R6_CHILD` 发真实门控 `bash`/`write` 工具调用（工具名从请求 `tools`
  发现，参照 E2E_TOOL；**不**发 `ask_user_question`——宿主对 subagent origin 报
  `DELEGATED_CALLER`）。scratch profile 显式挂载 `use_agent` companion（`registry`）
  并以 `permission: ask` 注册 `r6-asker` 子 agent；F1 重钉在产品代码保持生效。
  driver 从不发 `a` / `s` / `Esc` / `behavior:'always'` / `escalation:true`，
  避免 always/session grant 或拒绝伪造结局。
- 审批卡作答**逐帧**：每次按键前 `capture-pane`，仅当帧含审批卡标题
  （`⚠ Approval:` / `⚠ 审批：`）与确认标签（`allow` / `允许`）才发 `Enter`
  （Allow once）；不是固定 Down×N + Enter。每帧决策写入 `20-r6-console.log`。
- 断言读回 scratch home 的**真压缩 journal**（zstd 解压），要求存在
  `ask.responded{askKind:'approval', settleReason:'answered', outcome:'approved',
  source:'answer', childSessionId}` 行，`sessionId == parentSessionId`、`childSessionId` 非空且 != 父 id；
  再把真行喂给真实 `bridgeReplayRowsToSeamTranscript` / `deriveAskOutcomeNotice`
  断言父 ask 行 0 / notice 1 / 同 id 去重取最大 seq，`/btw` 0、`sessionInfo()` 零新增。
- **不合成 `childSessionId`、不 mock `appendPluginRecord`、不直调 registry、不写 journal 行**。
  真子会话 / 真 approved 行任一不可达时打印 `BLOCKED: <reason>` 并以退出码 2 结束，
  不冒充 PASS。R3/R5 driver 与既有断言零改动。

## 已知教训（每条都真实发生过）
- 字节流 grep 会漏布局破坏（溢出进输入框）→ 必须 FT/E2E 看帧
- 单帧快照漏闪烁 → 必须时间序列采样
- "编译过"≠"渲染对"（height:1 装两行）→ FT 断言行数
- 从零造轮子偏离参考实现 → parity 对拍 + 动手前先 grep 参考仓
