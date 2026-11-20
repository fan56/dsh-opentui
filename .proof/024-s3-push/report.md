# Proof Report: 024-s3-push / S3 主动推适配

- Gate / 门禁: PASS  (Result / 结论 below: PASS)
- Profile(s) / 证明类型: FEATURE + DATAFLOW (host stream 项 → relay 事件帧 → seam 消费) + negative-control
- Expected registered (UTC) / 预期登记时间: 2026-11-20T18:51Z（`.proof/024-s3-push/00-preregistered-expected.md`，write-once）
- Change ref: `a0710664ff64beb2f13bd6ec038a48c6f7f6b912`（含全部 S3 实现与预注册的提交；本报告为独立后续提交）
- Working tree: 实现提交后 `tracked clean` 除外：另有并发代理未提交的 harness 修复（`verify/agents-mount-repro.mjs`）与本片日志/帧证据未跟踪；Change ref 指向的 18 文件均在本提交内。
- Task: S3 主动推（host→client 事件推送）适配，含 S2 review B2 的 AbortController 释放修复。
- Acceptance target（用户原话逐字）: "S3——主动推（host→client 事件推送）适配。B2 stream 臂 AbortController 无释放路径——S3/S4 扩 stream 前必修，属你范围则修；推送面接入生成链路（hostInvoke/事件路径按 kind 表）；seam 端消费；ledger diff + 门禁全项 + 单测 + real-client-gate.sh 实跑本片相关断言；commit→push→CI 三 job 绿为收口。"
- Changed behaviors / 改动行为: (1) `createCapHostInvoke` 新增 3 条 session push stream 臂（kind=stream → AsyncIterable，sessionId 必填）；(2) B2：stream 臂自建 controller 由 `withOwnedAbort` 在 return/throw/done 释放；(3) `createPushRelay` 订阅/seq/降级/释放；(4) seam `onCapPush`/`capPushStatus` 消费 cap 帧；(5) gate #10 计数动态化；(6) @manual 计数保持 11、wired 19→22。baseline method: saved copy + inline reconstructed pre-change arm（`00-pre-change.log`，同命令对原实现重建）。
- Touched paths / 本次改动: `packages/bridge/src/index.ts`（CAP_HOST_WIRED_IDS / createCapHostInvoke / withOwnedAbort / probeOwnedAbortRelease / createPushRelay / CAP_SMOKE push probe / disposeBinding+handleOpen+teardown hooks）、`packages/shell/src/client/bridge-session-seam.ts`（CapPushEvent/CapPushStatus/onCapPush/capPushStatus/#onCapPushEvent/#onBridgeEvent/recover attach/bridge.dead）、`ledger/{ledger.json,ledger.md,provenance.json}`、`scripts/check-capcontract.mjs`、`scripts/verify-s3-push.mjs`、2 新单测 + 2 计数快照更新。
- Evidence directory / 证据目录: `.proof/024-s3-push/`
- Assertion total / 断言总数 N: 7（E1–E7，与预注册一致）

## Acceptance assertions / 验收断言

| id | assertion | expected (FROZEN) | pass criterion (checkable) | changed path (file:function/route) | level required | evidence file | depends on |
|----|-----------|-------------------|----------------------------|------------------------------------|----------------|---------------|------------|
| E1 | 推送面 3 条 stream 接入生成链，wired 集对账 | 19→22/257；generated ids 18→21；@manual 11 不变；握手 75/75 | gate `PASS=13 NOT_RUN=0 FAIL=0` #10 显示 22/257；smoke `ledger in_wired=22/257`；`READY observed=75 expected=75 missing=0` | `packages/bridge/src/index.ts` CAP_HOST_WIRED_IDS + `ledger/provenance.json` | Artifact | 02-gate-full.log, 04-handshake-recheck.log | — |
| E2 | 事件到达：observeEvent 首帧 ready | `createCapInvoke` kind=stream → AsyncIterable；首帧 `{type:'ready'}` | `06-push-smoke.log` 含 `"method":"observeEvent","kind":"stream","ok":true,"iterableOk":true,"firstType":"ready"`；`14-s3-push-stdio.log` 含 3 条 cap.event 且 seq=1 | `packages/bridge/src/index.ts` createCapHostInvoke (observeEvent arm) | Artifact + DATAFLOW | 06-push-smoke.log, 14-s3-push-stdio.log | E1 |
| E3 | 顺序：seq 单调 + 去重 | relay seq=[1,2,3]；seam 注入 [1,2,2,1,3] → [1,2,3] | bridge 单测 15/15 pass（relay 按方法 seq=[1,2,3]）；shell 单测 5/5 pass（重复/回退 seq 丢弃） | `packages/bridge/src/index.ts` createPushRelay + `packages/shell/src/client/bridge-session-seam.ts` #onCapPushEvent | Artifact + machine verdict | 05-bridge-unittest.log, 05b-shell-unittest.log | E2 |
| E4 | 断连恢复 / 降级 | cap.end→degraded；bridge.dead→disconnected；resume→attached+seq 0 | shell 单测逐条断言状态串 + seq 重置（见 05b） | `packages/shell/src/client/bridge-session-seam.ts` #onCapPushEvent/#onBridgeEvent/recover | Artifact + machine verdict | 05b-shell-unittest.log | E3 |
| E5 | B2：自建 AbortController 无泄漏（必含） | 原实现 return 后 aborted=false（泄漏）；修复后 return/throw/done 均 aborted=true；caller signal 不被误 abort | `00-pre-change.log` `leak:true`；bridge 单测 5 例全 pass；`06-push-smoke.log` `"ownedAbortOnReturn":true` | `packages/bridge/src/index.ts` withOwnedAbort + stream arms | Artifact + reverse | 00-pre-change.log, 05-bridge-unittest.log, 06-push-smoke.log | E1 |
| E6 | 负例：NOT_WIRED / BAD_PARAMS | 未 wired stream id→NOT_WIRED；空 sessionId→BAD_PARAMS 不达宿主 | `06-push-smoke.log` 两条 negative emit（errorCode=NOT_WIRED / BAD_PARAMS，rawCode/errorHead 同源）；bridge 单测负例 pass | `packages/bridge/src/index.ts` createCapHostInvoke 前置校验/fallback | Artifact + reverse | 06-push-smoke.log, 05-bridge-unittest.log | — |
| E7 | seam 端消费 + sessionId 隔离 + disposer | 只投本 sessionId；dispose 后零投递 | shell 单测 5/5 pass（A=[1,2]、B=[1]、disposeA 后 A 不变） | `packages/shell/src/client/bridge-session-seam.ts` onCapPush | Artifact + machine verdict | 05b-shell-unittest.log | E3 |

## Evidence index / 证据清单

| file | level | what it captures | captured at (exact command + time) | redaction | sha256 |
|------|-------|------------------|-------------------------------------|-----------|--------|
| 00-preregistered-expected.md | Artifact | 冻结 expected + B2 必含断言 | write-once 2026-11-20T18:51Z | n/a | (tracked in Change ref) |
| 00-pre-change.log | Artifact + reverse | 重建 pre-change stream arm 泄漏基线 | `bun -e '<reconstruct old arm>'` 2026-11-20T19:00Z | n/a | `109727695f3a113633f518fb3d343814ecfac4c3f912d87ab7e8f190b56dc4a6` |
| 02-gate-full.log | Artifact | check-capcontract 13/0，#10=22/257 | `node scripts/check-capcontract.mjs` | n/a | `a3ab21fd65ceb3c52383056fbccaac413ac2b8836c17e2636f6678cbf0ab6de8` |
| 04-handshake-recheck.log | Artifact | 真机 CAP_SMOKE + 握手 75/75 + push 首帧 | `node scripts/verify-capcontract-roundtrip.mjs` | n/a | `bcd8c8ae1b0274b9671be140e30251db01dd131c13a77221e1d65605cd1f0650` |
| 05-bridge-unittest.log | Artifact | bridge 226 pass / 0 fail（含 S3 15 例） | `bun test packages/bridge` | n/a | `21fd8b5037e68bf63c466deaa17e1a9528e1226372f8bcd9c1d41ac2239e8ef2` |
| 05b-shell-unittest.log | Artifact | shell 1186 pass / 0 fail / 4 skip（含 S3 5 例） | `bun test packages/shell` | n/a | `fd8138cfc94fdbecad5e9f35c6be18a7fa625c5d789bc8e2b6ea96d3709da125` |
| 06-push-smoke.log | Artifact + DATAFLOW | 3 条 push stream emit + B2 + negative | grep of 04-handshake-recheck.log | n/a | `512cb7c111b1b67cc7790418668cf298c52844ef38d6f9591541501f39dc85c1` |
| 09-desens-scan.log | Artifact | 脱敏扫描 41 文件 hits=0 | `node scripts/scan-stdio-secrets.mjs .proof/024-s3-push` | n/a | `4806fd17d2469179630f5000418dbd73aac49a860fd1be3956a96a48871e048d` |
| 10-verify70.log | Artifact | real-client gate verify70 24/58（红项分类见报告） | `scripts/real-client-gate.sh --out .proof/024-s3-push/real-client-gate` | n/a | `76e3b4feeb97794a4094ff053a4ac5bb27416cabdc1c61d47e4ebda29ef04a9c` |
| 14-s3-push-stdio.log | Artifact + DATAFLOW | 真机 stdio cap.event 三帧 + sessionId/seq | `node scripts/verify-s3-push.mjs` | n/a | `094abd0efeb8079a62f3a6540e9ac99853d8582c65008aba24d3855d799e41c1` |
| 14-real-client-gate-*.ans | Artifact | 6 组数值 .ans 帧（`capture-pane -e -p`，禁 PNG） | real-client gate | n/a | tracked in Change ref |

### Raw output: 00-pre-change.log
```
{"baseline":"pre-change stream arm (S2)","firstType":"ready","ownedSignalAbortedAfterReturn":false,"leak":true}
```

### Raw output: 06-push-smoke.log (key lines)
```
[CAP-SMOKE] I-probe push controller {"present":true,"listFn":true,"directListFn":false}
[CAP-SMOKE] W push stream {"method":"observeEvent","kind":"stream","ok":true,"iterableOk":true,"firstType":"ready","emitWhitelist":["kind","iterableOk","firstType"]}
[CAP-SMOKE] W push stream {"method":"observeState","kind":"stream","ok":true,"iterableOk":true,"firstType":null,"emitWhitelist":["kind","iterableOk","firstType"]}
[CAP-SMOKE] W push stream {"method":"observeProjections","kind":"stream","ok":true,"iterableOk":true,"firstType":"ready","emitWhitelist":["kind","iterableOk","firstType"]}
[CAP-SMOKE] B2 owned-abort {"ownedAbortOnReturn":true}
[CAP-SMOKE] W push negative {"id":"@deepseek-ai/dsh-api-session-controller#session/control","rejected":true,"errorCode":"NOT_WIRED","rawCode":"NOT_WIRED","errorHead":"NOT_WIRED: @deepseek-ai/dsh-api-session-controller#session/control has no inproc host adapter (l"}
[CAP-SMOKE] W push negative {"id":"@deepseek-ai/dsh-api-session-controller#session/observeEvent","rejected":true,"errorCode":"BAD_PARAMS","rawCode":"BAD_PARAMS","errorHead":"BAD_PARAMS: session push stream requires a non-empty sessionId"}
```

### Raw output: 14-s3-push-stdio.log
```
SUMMARY {"source":"real host stdio (shipped bridge bundle)","host_reply_bridge_hello":true,"host_reply_session_open":true,"cap_event_count":3,"cap_end_count":0,"seqs_by_method":{"session/observeEvent":[1],"session/observeProjections":[1],"session/observeState":[1]},"session_ids":["e79f8ff1-07fa-48f9-85e4-a301529ed2b6"],"whitelist":["methodId","sessionId","seq","eventType","reason"]}
CAP.EVENT {"methodId":"@deepseek-ai/dsh-api-session-controller#session/observeEvent","sessionId":"e79f8ff1-07fa-48f9-85e4-a301529ed2b6","seq":1,"eventType":"ready"}
CAP.EVENT {"methodId":"@deepseek-ai/dsh-api-session-controller#session/observeProjections","sessionId":"e79f8ff1-07fa-48f9-85e4-a301529ed2b6","seq":1,"eventType":"ready"}
CAP.EVENT {"methodId":"@deepseek-ai/dsh-api-session-controller#session/observeState","sessionId":"e79f8ff1-07fa-48f9-85e4-a301529ed2b6","seq":1,"eventType":"event"}
```

## Profile-specific section / 分项证明

FEATURE positive path: `node scripts/verify-capcontract-roundtrip.mjs`（真机 shipped bundle）+ `node scripts/verify-s3-push.mjs`（真机 stdio 协议）；reverse cases: E5（pre-change 泄漏基线 + return/throw/done 释放）/ E6（NOT_WIRED + BAD_PARAMS），均由 00-pre-change.log 与单测机器判定。无 mock 替代真链：CAP_SMOKE 驱动 shipped bundle 的真实 `createCapInvoke` 对活宿主；stdio 探针驱动真实宿主进程。单测中的 structural fake 仅用于 hostInvoke/relay 的分支边界，不替代真机证据。

DATAFLOW expected transformation: host `observeEvent({address},signal)` AsyncIterable item `{type:'ready'}` → bridge relay emits `{type:'cap.event',payload:{methodId,sessionId,seq,eventType}}` → seam `#onCapPushEvent` → `CapPushEvent` to `onCapPush(sessionId)` listeners. Hops: entry=`14-s3-push-stdio.log` CAP.EVENT（同 sessionId e79f8ff1…）/ intermediate=`06-push-smoke.log` firstType=ready / exit=`05b-shell-unittest.log` onCapPush delivered [1,2] and scoped by sessionId.

## Re-run evidence / 回修证据

| file | round | new assertion result |
|------|-------|----------------------|
| 05-bridge-unittest.log (rerun after count snapshot 19→22) | 2 | E1/E5/E6: FAIL → PASS（旧断言 verbatim 保留在测试注释，非冻结面） |
| 06-push-smoke.log (rerun after moving push probe before mutating S1/S2 probes) | 2 | E2/E6: NOT_WIRED(timing) → PASS（首帧 ready + BAD_PARAMS 正确分类） |

## JUDGMENT（只记不拦，不进入断言表）

- J1 交互手感：推送事件触发的模态/卡片出现时机是否自然（机器可判 seq，不可判手感）。
- J2 文案措辞：`cap.end` 降级提示的中文措辞是否贴切。
- J3 视觉布局：推送驱动 modal 在 80x24 下的遮挡/排布。

## verify70 红项分类（不自判放行）

`scripts/real-client-gate.sh` GATE_EXIT=1（环境项全 PASS，六组 .ans 非空；verify70 24/58）。oldfox `024-verify70-red-adjudication-oldfox.md` 已产出，34 项红按档位登记：[S5]+[AG] 22 项结构性红（/agents 7 项独立条目，不藏 S5 名下）豁免至 S5；[H] 9 项 harness 级联/断言缺陷 + [R] 1 项 click-to-focus + [M] 3 项不豁免，随 harness/缺陷处置复跑。本片不自行修复 harness/renderer，也不自判门禁放行；已按裁决口径登记 `024-e2e-requirements.md` F 段。

## Gate judgment / 门禁判定

- [x] 所有选择 profile 的 gate item 存在（FEATURE positive+reverse+boundary；DATAFLOW hop 表）
- [x] Binding：验收目标逐字引用；touched paths 声明；≥1 证据落在本 diff
- [x] Change ref 指向含实现的提交（非报告提交）；working tree 自由文本；FEATURE/DATAFLOW changed path 非空
- [x] 每条断言有可判 criterion / changed path / evidence file；≥1 条执行变更代码路径
- [x] 至少一条真机 I/O transcript（14-s3-push-stdio.log / 06-push-smoke.log）
- [x] 每个变更行为有反例 + 00-pre-change.log 基线
- [x] 未触发 section 8 反作弊红线
- [x] 无 Claim 级单独支撑 PASS
- [x] N=7 已声明；7 条状态见下；无空/非法状态；≥1 机器判定；depends on 无环
- [x] expected 预注册未回改；冲突在采集前修正；NOT RUN 未改标 UNAVAILABLE

Assertion status / 断言状态:
E1: PASS | E2: PASS | E3: PASS | E4: PASS | E5: PASS | E6: PASS | E7: PASS

Status summary / 状态汇总:
| status | count |
|--------|-------|
| PASS | 7 |
| FAIL | 0 |
| NOT RUN | 0 |
| UNAVAILABLE | 0 |
| BLOCKED | 0 |
| USER-JUDGMENT | 0 |
| PASS-BY-USER | 0 |

Result: PASS

（JUDGMENT 三项仅记录、不进入机器门禁；verify70 实体红按 oldfox 裁决分类登记，不构成对 S3 机器断言的自判放行。）
