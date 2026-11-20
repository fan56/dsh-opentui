# PREREGISTRATION — S3 主动推（host→client 事件推送）切片（write-once，捕获前落盘，never edited after capture）

本文件在任何 S3 实现改动与证据捕获之前写入磁盘。它是 S3 报告 `expected` 列的冻结预测值。
状态与 observed 值事后依据 `pass criterion` 判定，写入 `024-s3-push-slice.md`；禁止回改本文件的 `expected`。

- Preregistered at (UTC): 2026-11-20T18:51Z
- Worktree / branch: `/Users/qingguee/repo/dsh-opentui-wt-024-capir` @ `feat/024-capir`
- Pre-change HEAD (baseline + change ref anchor): `d2e0eae3ccf783c081a57983dd5c3e811f5ab6be`（real-client-gate runner GREEN 态，clean worktree）
- Host: `dsh --version` = `0.2.2-rc.5`，macOS arm64（证据头记录；真机帧用 `tmux capture-pane -e -p` 数值流，禁 PNG/视觉模型）
- Evidence directory: `.proof/024-s3-push/`
- Profile(s): FEATURE（推送面经生成链到达 + 反向拒绝）+ DATAFLOW（host stream 项→relay 事件帧→seam 消费）+ negative-control（NOT_WIRED / BAD_PARAMS / B2 订阅泄漏反例）
- Acceptance target（用户原话逐字）: "S3——主动推（host→client 事件推送）适配。B2 stream 臂 AbortController 无释放路径——S3/S4 扩 stream 前必修，属你范围则修；推送面接入生成链路（hostInvoke/事件路径按 kind 表）；seam 端消费；ledger diff + 门禁全项 + 单测 + real-client-gate.sh 实跑本片相关断言；commit→push→CI 三 job 绿为收口。"
- 冻结面声明：不碰 `capir/capir.json` 真源、`scripts/build-bridge.mjs` 转义段、既有断言删除；CapIR W 全集 257 / expected 75 / `@manual` wired 11 / 握手面 75/75 均保持不变。

## 元数据（切片票）

### S3 能力面界定（CapIR 推送类方法 / 事件流）

依 v3 §1(H8)/§3.1 与 T5 §C：主动推 = host→client 的事件流/订阅面，CapIR 中表现为 `kind:'stream'` 的会话观察方法与账号观察方法；事件帧必带 sessionId（v3 §3.1 隔离要求）。本片接线面（新增 3 条，均为 profile expected 面内 W 方法，profile-patch 来源，ledger `in_expected:true`）：

| # | CapIR id | kind | 宿主一手真源（rc.5） | 首帧 / 语义 |
|---|---|---|---|---|
| P-1 | `@deepseek-ai/dsh-api-session-controller#session/observeEvent` | stream | `session-controller/src/index.ts:527-530` `@Remote({mode:'stream'})` → `history/controller.ts:57` `async *observeEvent(request, signal)` | 首帧 `{type:'ready'}`，随后事件帧（`types.ts:657-659`） |
| P-2 | `@deepseek-ai/dsh-api-session-controller#session/observeState` | stream | `session-controller/src/index.ts:560-563` `@Remote({mode:'stream'})` → `stateController.observeState(request, signal)` | 完整 passive state 替换流 |
| P-3 | `@deepseek-ai/dsh-api-session-controller#session/observeProjections` | stream | `session-controller/src/index.ts:538-541` `@Remote({mode:'stream'})` → `historyController.observeProjections(request, signal)` | 首帧 `{type:'ready'}`，随后 projection change 帧（`types.ts:664-667`） |

请求形状（一手，rc.5 `types.ts:399-406,652-654,409-411,550`）：`observeEvent` 入参 `{ address: { kind:'session', sessionId } }`；`observeState`/`observeProjections` 入参 `{ sessionId }`。桥内只透传最小合法形状并对 sessionId 作非空字符串前置校验（BAD_PARAMS 不达宿主）。

**已有推送面（S2 落地，本片只补 B2 释放，不重复接线）**：`@deepseek-ai/dsh-deepseek-account#account/watch`、`#account/watchExpiry`（stream，已 wired）。

**kind 表真源**：`capcontract/dispatch.ts` `CAP_DISPATCH_TABLE` 中 P-1/P-2/P-3 = `"stream"`；`capcontract/types.ts` CAP_METHODS 同值。dispatcher 经 `createCapDispatcher` 把 `kind` 传入 `CapHostInvoke(methodId, kind, params)`；本片 hostInvoke 读 kind，stream 臂返回 **AsyncIterable**（不消费到底），unary 臂保持 Promise（S1/S2 不变）。

### B2（S2 评审 concern B2，必含断言）

S2 review §二 B2：`createCapHostInvoke` stream 臂在 caller 未传 signal 时 `new AbortController()`，返回后无释放路径（作用域丢失），future caller 不传 signal 且不消费完 iterable 时泄漏宿主订阅。本片扩 stream 面前必修，处置 = 自建 controller 的 iterable 在 `return/throw/自然 done` 时一律 `abort()`（所有权封装），且 relay 侧持有 controller 并在会话切换/关闭/dispose 时显式 abort。**E5 为本片必含断言，不做则本片不收口。**

### 断连恢复 / 降级 / sessionId 隔离

- relay 每会话每方法一订阅，帧带 `sessionId` + relay 内单调 `seq`（同会话按 seq 升序消费，重复/回退 seq 丢弃）；
- stream 结束/报错 → 发 `cap.end{reason}`，seam 订阅状态转 `degraded`；`bridge.dead` → `disconnected`；resume 重建订阅后 `attached` 且 seq 重置；
- seam `onCapPush(sessionId, listener)` 只投该 sessionId 的帧，disposer 后零投递；未知/畸形帧不崩（no-op 或降级）；
- 白名单投影：仅 `methodId/sessionId/seq/type` 落事件帧与日志，不透传宿主 payload 原文（沿用 S2 stdio 脱敏纪律；凭据值零落盘）。

## 预注册 expected（E1–E7，计划 §三模板；JUDGMENT 另列，只记不拦）

| id | assertion | expected（FROZEN，捕获前填） | pass criterion（checkable） | changed path | level | evidence file | depends on |
|----|-----------|------------------------------|----------------------------|--------------|-------|---------------|------------|
| E1 | 推送面 3 条 stream 接入生成链，wired 集对账 | `CAP_HOST_WIRED_IDS` 19→22（+P-1/P-2/P-3）；ledger `in_wired` 19→22、`wired_capir_generated.ids` 18→21；`@manual` wired 11 不变；握手 READY observed=75 expected=75 missing=0 | `[CAP-SMOKE] ... "ledger in_wired=22/257"`；`node scripts/check-capcontract.mjs` `PASS=13 NOT_RUN=0 FAIL=0`（#10 wired 集=ledger in_wired）；smoke stderr `READY observed=75 expected=75 missing=0` | `packages/bridge/src/index.ts` CAP_HOST_WIRED_IDS + `ledger/provenance.json` + `ledger/ledger.json` | Artifact | `02-gate-full.log`, `04-handshake-recheck.log` | — |
| E2 | 事件到达（正向） | P-1 `session/observeEvent` 经 `createCapInvoke`（kind=stream）返回 AsyncIterable；首帧 `{type:'ready'}`（带 800ms 守卫）；P-2/P-3 同路径返回可迭代（首帧或其宿主可达性如实记录） | `[CAP-SMOKE] W push observeEvent ... "kind":"stream","iterableOk":true,"firstType":"ready"`；P-2/P-3 各有 emit（ok 或如实 NOT_WIRED/空流，不伪造） | `packages/bridge/src/index.ts` createCapHostInvoke (session push stream arms) | Artifact | `06-push-smoke.log` | E1 |
| E3 | 顺序（seq 单调 + 去重） | relay 对同一 sessionId 的事件帧赋单调 seq（自 1 起）；seam 对 `[1,2,2,1,3]` 注入序列只按序投递 `[1,2,3]`，重复/回退 seq 丢弃 | bridge 单测断言 relay 发出 seq=[1,2,3]；shell 单测注入乱序/重复后 listener 收到 `[1,2,3]` | `packages/bridge/src/index.ts` 推送 relay + `packages/shell/src/client/bridge-session-seam.ts` onCapPush | Artifact + machine verdict | `05-bridge-unittest.log`, `05b-shell-unittest.log` | E2 |
| E4 | 断连恢复 / 降级 | stream end/error → bridge 发 `cap.end{reason}` → seam 状态 `degraded`；`bridge.dead` → `disconnected`；resume 重建订阅 → `attached` + seq 重置；未知/畸形 cap 帧不崩 | shell 单测逐个断言状态串 `degraded`/`disconnected`/`attached` 且 seq 重置为 0；畸形帧注入后无 throw | `packages/shell/src/client/bridge-session-seam.ts` onCapPush + `#onBridgeEvent` | Artifact + machine verdict | `05b-shell-unittest.log` | E3 |
| E5 | **B2：自建 AbortController 无订阅泄漏（必含）** | (a) caller 不传 signal 时，hostInvoke stream 臂自建 controller 在 iterable `return()`/`throw()`/自然 done 后 `signal.aborted===true`；(b) 传 caller signal 时不误 abort；(c) relay 在会话切换/关闭/dispose 时 abort 所有该会话 controller，无悬挂订阅 | bridge 单测三例 `abortedOnReturn/abortedOnThrow/abortedOnDone === true` 且 `callerSignalNotAborted === true`；`06-push-smoke.log` 含 `"ownedAbortOnReturn":true`；relay dispose 单测断言 controller 集清空 | `packages/bridge/src/index.ts` createCapHostInvoke stream 臂（owned-abort 封装）+ relay teardown | Artifact + reverse | `00-pre-change.log`, `05-bridge-unittest.log`, `06-push-smoke.log` | E1 |
| E6 | 负例：NOT_WIRED / BAD_PARAMS / BAD_KIND | 未 wired 的 stream id（如 `session/control`）经生成链 → `NOT_WIRED ... ledger in_wired=22/257`；`observeEvent` 缺/空 sessionId → `BAD_PARAMS` 不达宿主；stream id 以错误 kind 调用被拒 | `[CAP-SMOKE] W push negative ... "errorCode":"NOT_WIRED"` 与 `"errorCode":"BAD_PARAMS"`；单测断言宿主方法未被调用 | `packages/bridge/src/index.ts` createCapHostInvoke 前置校验 / fallback | Artifact + reverse | `00-pre-change.log`, `06-push-smoke.log` | — |
| E7 | seam 端消费 + sessionId 隔离 + disposer | `onCapPush(sessionId, listener)` 只投递该 sessionId 的 `cap.event` 帧；另一 sessionId 帧零投递；调用 disposer 后零投递；dispose 时无异常 | shell 单测：注入 sessionA/sessionB 各 2 帧，A listener 收到 2 帧且 sessionId 全为 A；dispose 后再注入 0 投递 | `packages/shell/src/client/bridge-session-seam.ts` onCapPush | Artifact + machine verdict | `05b-shell-unittest.log` | E3 |

非断言证据项：`01-env-snapshot.log`（rc.5 + SHA + date）、`02-gate-full.log`、`03-regen.log`（gen-capir/gen-capcontract/gen-ledger 字节一致 + ledger 双跑 sha）、`04-handshake-recheck.log`、`05-bridge-unittest.log`、`05b-shell-unittest.log`、`05c-typecheck-build.log`、`06-push-smoke.log`、`09-desens-scan.log`、`10-verify70.log`、`11-pack.log`、`12-ci.log`、`14-real-client-gate-*` 帧/日志、`report.md`。

## 门禁预期（技术门禁全绿即 PASS）

- check-capcontract 全项：`PASS=13 NOT_RUN=0 FAIL=0`（@manual 11 名集不变；#10 wired 集=ledger in_wired=22）。
- bridge 单测全绿（含新增 push/B2 用例；既有断言一字不改）；shell 全量单测全绿（含新增 seam 消费用例）。
- bun build / gen-capir `--check` / gen-capcontract `--check` 字节一致；gen-ledger 两次 sha 相同（幂等）。
- 脱敏扫描：`scripts/scan-stdio-secrets.mjs .proof/024-s3-push` exit=0 `hits=0`（推送帧白名单零敏感值）。
- verify 脚本（70 项）：`scripts/real-client-gate.sh --out .proof/024-s3-push` 实跑；verify70 结构性红按 oldfox 裁决文档（若已产出）豁免口径执行，未出则以「红项分类记录」处理，**不自判放行**。
- pack 门禁：ci.yml pack-cold-start 原文本地复跑；真 CI `gh workflow run ci.yml --ref feat/024-capir` 三 job 绿，红就红报。

## JUDGMENT（只记不拦，收口三类边界）

- J1（交互手感）：推送事件触发的模态/卡片出现时机与视觉呈现是否自然（machine 可判帧到达与 seq，不可判手感）→ 记录，不进机器门禁。
- J2（文案措辞）：降级/断连提示（如「推送已降级」「连接已断开」）的中文措辞是否贴切 → 记录，不进机器门禁。
- J3（视觉布局）：推送驱动的 modal 在 80x24 下的遮挡/排布 → 记录，不进机器门禁。

## NOT RUN（同步勾进 `024-e2e-requirements.md`，不静默删除）

- NR1：live turn 下的事件流全链（需要账号态 + 模型可驱动 turn；scratch home 无账号/模型，仅可达 `ready` 首帧与机器可达层）。
- NR2：verify70 中 config/agents/settings 写回与 pane-focus 等断言（inproc seam 只暴露 12 wire 方法，无 config/agents/settings 帧——结构不匹配，非本片回归；按 oldfox 裁决口径或红项分类记录处理）。
- NR3：账号失效推送（`deepseek-account/session-expired`、`model-sign-in-required`）真机触发（需登录态环境；本片不扩此 additive 帧，留 S5/E2E）。
- NR4：PKCE/stream 客户端流（S4 范围；本片只做 B2 释放前置修复）。
