# Proof Report: 024-base-task5 / 底座整体验证（V1–V4）与 proof 证据包

- Gate / 门禁: FAIL
- Profile(s) / 证明类型: FEATURE + DATAFLOW
- Result / 结论: FAIL  (identical to Gate)
- Expected registered (UTC) / 预期登记时间: 2026-11-20T14:08Z — frozen in `00-preregistered-expected.md` (sha256 1a153714…) BEFORE any verification run
- Change ref: a199bf1f37be897576f2359c4fde26c34e0186e2 (base HEAD; full base range `08cd2a8..a199bf1` off `origin/main@2a2c5e2`). This is the change under test, NOT this report's commit.
- Working tree: tracked clean (`git diff --name-only` = 0 files); only `.proof/024-base-task5/` untracked; `node_modules/` gitignored after `pnpm install --frozen-lockfile`
- Task: Prove the 0.24 base (V1–V4) works and archive the evidence package; verify two leftovers from task 4.
- Acceptance target (user verbatim) / 验收目标（用户原话）: "任务：dsh-opentui 0.24 底座任务 5——底座整体验证（V1–V4）与 proof 证据包" ; "禁止编造；红就红着报。"
- Changed behaviors / 改动行为: the base commits under test add (1) startup capability handshake with three-state PENDING/READY/DEGRADED and inflated-baseline rejection — baseline method: pre-change commit tree inspection at `2a2c5e2` (handshake module did not exist) → A4/A3; (2) generated capcontract dispatcher for W capabilities — baseline: pre-capcontract tree `2a2c5e2` had no generated layer → A5; (3) ledger expected-surface derivation → A2. Same negative command path captured in `02-pre-change.log`.
- Touched paths / 本次改动 (under test): `capir/capir.json`, `capcontract/{types,dispatch,binder}.ts`, `ledger/{ledger.json,ledger.md,provenance.json}`, `packages/bridge/src/{index.ts,handshake.ts}`, `scripts/{build-bridge.mjs,gen-capir.mjs,gen-capcontract.mjs,gen-ledger.mjs,check-capcontract.mjs,verify-capability-handshake.ts}`. Evidence instruments were ONLY in `/private/tmp` copies; worktree tracked files unchanged (see `12-injection-restore.log`).
- Evidence directory / 证据目录: `.proof/024-base-task5/`
- Assertion total / 断言总数 N: 8

## Acceptance assertions / 验收断言

| id | assertion | expected (FROZEN, 00-preregistered-expected.md) | observed (this run) | pass criterion (checkable) | changed path | level required | evidence file | depends on | status |
|----|-----------|-----------------------------------------------|---------------------|----------------------------|--------------|----------------|---------------|------------|--------|
| A1 | CapIR byte-identical + counts reconcile | `byte-identical (artifacts=43 methods=257); sc endpoints=27` | `byte-identical (artifacts=43 methods=257)`, exit 0; sc endpoint ids = 27; 257 distinct `#` ids | `gen-capir --check` exit 0 prints byte-identical; sc id count = 27 | capir/capir.json | Artifact | 03-capir-counts.log | | PASS |
| A2 | Ledger first report + provenance, idempotent | `full=257 expected=75 wired=12 iclass=6 diff_empty=true; provenance chain present; sha identical` | `full=257 expected=75 wired=12 iclass=6 diff_empty=true`; two runs sha256 `e9826514…` identical; provenance closure=138/patch=27/exclusion=1 present | exact counts + diff_empty true + two-run sha equal + chain present | ledger/ledger.json | Artifact | 04-ledger-report.log | A1 | PASS |
| A3 | Real cold start PENDING→READY on stable 75-id surface | `PENDING first; READY observed=75 expected=75 missing=0 fullOnlyIgnored=182; no DEGRADED` | `PENDING` then `READY observed=75 expected=75 missing=0 extra=0 fullOnlyIgnored=182 elapsed=205ms samples=2`; no DEGRADED | stderr shows PENDING before READY with observed=75 expected=75 missing=0; no DEGRADED | packages/bridge/src/handshake.ts | Artifact (real I/O) | 05-real-coldstart.log | | PASS |
| A4 | Inflated expected on stable surface → DEGRADED, no crash | `PENDING no degradation; stable+inflated -> DEGRADED missing=1 subclass absent; suite exit 0` | `PENDING expected=76`; `DEGRADED reason=missing expected methods on stable surface observed=75 expected=76 missing=1 extra=0 fullOnlyIgnored=182`; close code=0; headless `summary: FAIL=0` | raw shows stable-surface DEGRADED missing=1, no crash, suite exit 0 | packages/bridge/src/handshake.ts | Artifact+reverse | 02-pre-change.log, 06-handshake-negative.log, 13-headless-suite.log | | PASS |
| A5 | One W capability via generated dispatch chain returns non-error on real host | `createCapDispatcher dispatch of ...#session/list returns non-error result` | `W roundtrip generated dispatch ok=false error="local.invoke is not a function"`; CAP_DISPATCH_TABLE[id]=`unary`; descriptor exists `service=sessionController invokeType=function` | real-host log shows dispatch reached typert.local with a returned value and no TypeError | capcontract/dispatch.ts | Artifact (real I/O) | 07-w-roundtrip-real.log | A3 | FAIL |
| A6 | ctx.get fallback resolves 75 ids; direct ctx.typert throws; sessionController cause stated | `fallback list=75; direct ctx.typert throws 'without inject'; sessionController present=false with stated cause` | fallback `list().length=75` (real + headless); **direct `ctx.typert` = "OK local-present" on real host (inject declared, no error text)**; headless primary accessor threw (no-typert ctx); sessionController present=false@apply → true@1500ms, key correct | real-host log shows fallback list=75 AND direct-access error text AND written sessionController conclusion | packages/bridge/src/handshake.ts (resolveLocal) | Artifact | 08-fallback-iprobe.log, 07-w-roundtrip-real.log | A3 | FAIL |
| A7 | stdio pipe break → explicit error/shutdown, no crash | `closing pipe -> explicit error/dispose within timeout; no unhandled crash` | after `stdin pipe CLOSED`: `stdio protocol disposed`, `requesting appExit(0) via ctx.get('appExit') for graceful host shutdown`, `host graceful shutdown: fiber disposed`; close code=0 | runner log shows explicit dispose/shutdown after pipe close before timeout; no crash | packages/bridge/src/index.ts | Artifact+reverse | 09-stdio-break.log | A3 | PASS |
| A8 | Local gate green; real CI NOT RUN | `check-capcontract PASS=11 NOT_RUN=0 FAIL=0 exit 0; real CI NOT RUN` | `PASS=11 NOT_RUN=0 FAIL=0`, `capcontract integrity gate: GREEN`, exit 0; real CI declared NOT RUN below | gate stdout shows the summary line and exit 0 | scripts/check-capcontract.mjs | Artifact | 10-ci-gate.log | A1, A2 | PASS |

Assertion status: A1: PASS | A2: PASS | A3: PASS | A4: PASS | A5: FAIL | A6: FAIL | A7: PASS | A8: PASS

Status summary (sum = N = 8): PASS 6 | FAIL 2 | NOT RUN 0 | UNAVAILABLE 0 | BLOCKED 0 | USER-JUDGMENT 0 | PASS-BY-USER 0

## V1–V4 逐条达成状态表 (user-required)

| 验证项 | 子项 | 达成状态 | 一手证据 |
|--------|------|----------|----------|
| V1 装配实测记录 | 三份一手实测汇总 + 环境快照 + 基点 SHA | PASS | `01-env-snapshot.log`; day1 `024-day1-assembly-probe.md`; task4 `024-base-task4-handshake.md §4`; 本任务 `05/07/09` |
| V2a CapIR 计数对账 | 43 / 257 / 27 | PASS | `03-capir-counts.log` |
| V2b ledger 首报告 | 期望面 75 + provenance 证据链 + 幂等 | PASS | `04-ledger-report.log` |
| V2c 握手正例 | READY observed=75 | PASS | `05-real-coldstart.log` |
| V2c 握手负例 | 膨胀期望面 → DEGRADED 不崩（READY 语义注入） | PASS | `06-handshake-negative.log`, `13-headless-suite.log`, `02-pre-change.log` |
| V2d typert.local 真机往返 | 一次 W 能力经生成链路调用 | **FAIL** | `07-w-roundtrip-real.log` — `local.invoke is not a function` |
| V2e fallback 演示 | 逐服务 ctx.get fallback 路径 | PASS（路径已证明；A6 状态因预注册措辞偏差记 FAIL，见下） | `08-fallback-iprobe.log` |
| V2f 遗留核实 1 | sessionController ctx.get present=false 结论 | PASS | `08-fallback-iprobe.log`, `07/05/09` |
| V3 默认链路冷启动 | headless 真机冷启动 | PASS | `05-real-coldstart.log` |
| V3 握手日志三态流转 | PENDING/READY（负例 DEGRADED） | PASS | `05`, `06`, `13` |
| V3 一次 W 往返 | 生成链路 W 调用 | **FAIL**（同 V2d 缺陷） | `07-w-roundtrip-real.log` |
| V3 stdio 管道破裂 → 显式错误 | dispose + appExit(0) 优雅退出，无崩溃 | PASS | `09-stdio-break.log` |
| V4 本地 check-capcontract 全项绿 | PASS=11 FAIL=0 exit 0 | PASS | `10-ci-gate.log` |
| V4 真 CI | push 后由 tag 触发 | **NOT RUN**（本刀禁 push，显式声明） | — |
| 附加：bridge 单测 1 fail 环境归因 | 装依赖后全绿 | PASS | `11-bridge-unittest.log` — 180 pass / 0 fail |

## 预注册 expected 对照结果

逐条见上表 `expected (FROZEN)` vs `observed`。`00-preregistered-expected.md` 在 2026-11-20T14:08Z 落盘，早于所有验证命令（首个验证 `01-env-snapshot.log` 采集于 14:09:26Z）。全程未改写 expected。

- A1/A2/A3/A4/A7/A8：observed 命中 pass criterion，且与 frozen expected 一致 → PASS。
- A5：frozen expected = 非错误结果；observed = `local.invoke is not a function`。**不改写 expected**，按 pass criterion 判 FAIL，并作为大缺陷升级（见下）。
- A6：frozen expected 含「direct ctx.typert throws 'without inject'」；真机 observed = direct access OK（bundle 已声明 `inject:['typert']`，故直接访问合法）。criterion 要求的「direct-access error text」在真机日志中不存在 → 按 criterion 判 FAIL。**这是预注册前提错误，不是实现回归**：该预期来自 day1 在无 inject 声明的插桩副本上的观测；a199bf1 依 v2.1 C 条款已声明 inject。A6 的实质（fallback list=75、sessionController 结论）由 `08-fallback-iprobe.log` 证明成立。

## 遗留核实结论

1. **sessionController ctx.get present=false（任务 4 遗留 1）**：**不是服务名写法差异，也不是真缺失，而是注册时序**。证据链：(a) rc.4 与 rc.5 宿主源码均为 `super(ctx, 'sessionController', {namespace:'session'})`（`08-fallback-iprobe.log`）；(b) 真机运行时 `session/list` descriptor 的 `service = "sessionController"`（`07-w-roundtrip-real.log`）；(c) apply() 当刻 I 探针 present=false，但稳定窗口后（1500ms）复测 present=true（05/07/09 三份日志一致）。结论：宿主在 bridge `apply()` 探针之后才注册该服务；W 面 75 条比对不受影响（握手 READY）。任务 4 的「服务名不一致」假设被证伪，建议把 I 探针的观测点从 apply 当刻移到稳定窗口后，或把该条登记为「时序观测项」——属小改，未在本刀实施（见 NOT RUN/建议）。

## 大缺陷升级（Big defect — 停下报告交协调者，未修复）

`capcontract/dispatch.ts createCapDispatcher()`（生成物，23d504c）以 `local.invoke(id, params)` / `local.stream(id, params)` 调用 W 能力；但真机宿主 `typert.local` 的真实 API 是 `{get, hasSeen, list, subscribe}`（宿主源 `packages/typert/registry/src/service.ts:531-539`，rc.4 二进制实测一致），**没有 invoke/stream**。真机证据：`07-w-roundtrip-real.log` 中 `W roundtrip generated dispatch ok=false error="local.invoke is not a function"`。该生成函数因 `index.ts` 尚未引用而在 shipped bundle 中被 tree-shake；本刀把 dispatch.ts 的生成函数**逐字**注入 /tmp bundle 副本（未改 CapIR、未改 worktree tracked 文件）才得以在真机上下文执行该调用路径。

影响：V2d 与 V3「一次 W 往返」不成立；生成链路的 W 调用契约与宿主运行时 API 不匹配。descriptor 本身存在且 `invoke` 为 function（`service=sessionController, invocation.kind=direct`），但调用它需要 `TypertClientRemote` 上下文（控制试调用报 `Reflect.get called on non-object`）。修复需契约层重设计（生成 dispatcher 增加 host-local 适配或改用 descriptor.invoke + remote），属大缺陷，按纪律**不自行修复**，交协调者裁决。

## Evidence index / 证据清单

| file | level | what it captures | captured at (exact command/action) | redaction | sha256 |
|------|-------|------------------|------------------------------------|-----------|--------|
| 00-preregistered-expected.md | prereg | frozen expected values, written before any run | 2026-11-20T14:08Z | n/a | 1a153714eecfc3c118bf5fc816e8e37d1a82d8edcf568a4fe010cf93ff2c0991 |
| 01-env-snapshot.log | Artifact | V1 环境快照 + SHA | shell snapshot block, 14:09:26Z | n/a | ee41d5ff9717e34a47fa78bef61013f2e441ef517cd21a3a21bbe2be3472681b |
| 02-pre-change.log | Artifact | 反向基线：2a2c5e2 无握手/降级代码 | `git cat-file`/`git grep` at 2a2c5e2 | n/a | 6988a32cb34ad6159bad460d4e697cc56933451022cbb371889bc9ff0a935097 |
| 03-capir-counts.log | Artifact | A1 CapIR 计数 | `node scripts/gen-capir.mjs --check` | n/a | 271445f5070bc52e16dc24af6136e7c1d6b480ddddacc182f748a24490f25b0d |
| 04-ledger-report.log | Artifact | A2 ledger 报告 + provenance + 幂等 | `node scripts/gen-ledger.mjs` ×2 | n/a | 8e32df43cfce7ee722ed28e3fd60bda10b315290e71f81d1456e6562dc226e98 |
| 05-real-coldstart.log | Artifact (real I/O) | A3/V3 冷启动 PENDING→READY | `node /private/tmp/task5-run.mjs 8000 normal` | n/a | e3a1a718cb5235730ed291e930f542c6537345d62e886ec40972731453121492 |
| 06-handshake-negative.log | Artifact+reverse | A4 膨胀基线 → DEGRADED | `DSH_OPENTUI_T5_INFLATE=1 node /private/tmp/task5-run.mjs 8000 normal` | n/a | c2c9bd1d26493f29751b55ad1923da7d5f4441947c49679c0f85cb29bb723f32 |
| 07-w-roundtrip-real.log | Artifact (real I/O) | A5/A6 W 往返失败 + descriptor + I 复测 | `node /private/tmp/task5-run.mjs 8000 normal` (corrected probe) | n/a | 1c731e5c69333c54e99ced3a8bbb7cc878f0eec2c509de792713bf68012b3faf |
| 08-fallback-iprobe.log | Artifact | A6 fallback + 遗留 1 结论 | `bun /private/tmp/task5-fallback-probe.ts` + host source read | n/a | 474ae2d01ff864a64bb597a7297608ea92f7d990d91fb122faa505258b924aa6 |
| 09-stdio-break.log | Artifact+reverse | A7 stdio 管道破裂 | `node /private/tmp/task5-run.mjs 8000 breakpipe` | n/a | 931725d836525e33c79f71befe990183c4b461284d3b66b041ab6904af02fd95 |
| 10-ci-gate.log | Artifact | A8 check-capcontract | `node scripts/check-capcontract.mjs` | n/a | 76457ecfbffad47582a82ba932e0221d83be708e32f3527a51924baf355ab725 |
| 11-bridge-unittest.log | Artifact | 附加：装依赖后 bridge 单测 | `pnpm install --frozen-lockfile` then `cd packages/bridge && bun test` | n/a | 64392d8a7a0cd530665f63cc92a36146237b5125de2fb247c333d9d73436dc6d |
| 12-injection-restore.log | Artifact | 注入物恢复 + diff clean | symlink restore + git diff/sha block | n/a | d9164b7cf1002255fde6b8e7b50e0e25d32b5879aabbc4dd0d3c4d348dc8f976 |
| 13-headless-suite.log | Artifact | A4 headless 五组用例 | `bun scripts/verify-capability-handshake.ts` | n/a | 2fccbafc261e8ebb6893ff97afdc9206b2534db23f3995ddc9b8a8f5e7ba5939 |

No secrets/tokens appeared in any evidence; no redaction applied. Status codes, error codes and all asserted values left intact.

### Key raw excerpts (verbatim from cited files)

`05-real-coldstart.log` (positive):
```
[SMOKE-LOG] [dsh-opentui-bridge][handshake] PENDING timeout=%dms expected=%d poll=%dms stability=%d I-probes=%s 10000 75 100 2 [{"key":"agents","present":true},{"key":"sessionPersistence","present":true},{"key":"agentDefaultModel","present":true},{"key":"appExit","present":true},{"key":"sessionController","present":false},{"key":"systemPrompt","present":true}]
[SMOKE-LOG] [dsh-opentui-bridge][handshake] READY observed=%d expected=%d missing=0 extra=%d fullOnlyIgnored=%d elapsed=%dms samples=%d 75 75 0 182 205 2
```

`06-handshake-negative.log` (READY-semantics negative):
```
[SMOKE-LOG] [dsh-opentui-bridge][handshake] PENDING timeout=%dms expected=%d poll=%dms stability=%d I-probes=%s 10000 76 100 2 [...]
[SMOKE-LOG] [dsh-opentui-bridge][handshake] DEGRADED%s reason=%s observed=%d expected=%d missing=%d extra=%d fullOnlyIgnored=%d  missing expected methods on stable surface 75 76 1 0 182
[runner] mode=normal hold=8000 close code=0 signal=null
```

`07-w-roundtrip-real.log` (defect):
```
[T5-PROBE] session/list descriptor {"id":"@deepseek-ai/dsh-api-session-controller#session/list","service":"sessionController","namespace":"session","invocation":{"kind":"direct"},"invokeType":"function"}
[T5-PROBE] I-probe recheck @1500ms {"agents":true,"sessionPersistence":true,"agentDefaultModel":true,"appExit":true,"sessionController":true,"systemPrompt":true}
[T5-PROBE] W roundtrip generated dispatch {"id":"@deepseek-ai/dsh-api-session-controller#session/list","ok":false,"error":"local.invoke is not a function"}
```

`09-stdio-break.log`:
```
[runner] stdin pipe CLOSED at 1795184035013
[SMOKE-LOG] [dsh-opentui-bridge] stdio protocol disposed
[SMOKE-LOG] [dsh-opentui-bridge] requesting appExit(0) via ctx.get('appExit') for graceful host shutdown
[SMOKE-LOG] [dsh-opentui-bridge] host graceful shutdown: fiber disposed
[runner] mode=breakpipe hold=8000 close code=0 signal=null
```

## Gate judgment / 门禁判定

- [x] All gate items for FEATURE+DATAFLOW present (real driven I/O, positive + reverse, pre-change baseline, idempotent multi-hop data, no mock on real path)
- [x] Binding: acceptance target quoted verbatim; touched paths declared; >=1 evidence item on the diff (A3/A4/A6 execute `packages/bridge/src/handshake.ts` at Change ref a199bf1; A1/A2 inspect capir/ledger)
- [x] Change ref names the change commit; working tree free text; changed path filled for all rows
- [x] Every assertion has a checkable criterion, changed path and evidence file; >=1 machine-judged row (6 of 8 are machine-verdict PASS)
- [x] Real driven I/O transcript at Change ref (real host dsh 0.2.2-rc.4, instrumented /tmp copy only)
- [x] Reverse case on decidable boundary backed by `02-pre-change.log` (no handshake at base) + real-host inflated-baseline DEGRADED
- [x] No anti-cheat red line triggered; no `expected` rewritten; no silent fix of the discovered defect
- [x] Assertion total N=8; every row has a legal status; sum=8; no `depends on` cycle; USER-JUDGMENT rows would be leaves (none used)
- [ ] PASS requires all non-UJ rows PASS — **NOT met: A5 FAIL (big defect), A6 FAIL (preregistration premise mismatch)**

Result: FAIL — failing ids A5, A6. A5 is a genuine implementation defect (generated W dispatcher incompatible with real host `typert.local`), escalated to coordinator, not fixed this knife. A6 is a frozen-expected vs real-host-behavior mismatch recorded FAIL without rewriting expected; its substantive fallback/sessionController conclusions are established in `08-fallback-iprobe.log`. Machine part other than these two rows: PASS.

## Re-run evidence / 回修证据

None. First-round collection; no pass criterion was changed. (`07-w-roundtrip-real.log` corrects a probe-side descriptor lookup bug in the /tmp instrumentation only — it adds evidence, it is not an implementation re-run and no assertion criterion changed.)

## Failure rounds / 回修轮次

| round | what changed | new evidence file | old criterion (verbatim) | re-gate result |
|-------|--------------|-------------------|--------------------------|----------------|
| (none — first-round collection; defects reported red, not repaired this knife) | | | | |

## NOT RUN / 未执行清单 (explicit)

| item | reason | excluded scope |
|------|--------|----------------|
| Real CI (tag-triggered GitHub Actions) | 本刀禁 push/开 PR；真 CI 需 push 后由 tag 触发 | V4 真 CI 项；本地 gate 已代跑（10-ci-gate.log） |
| `typert.local.subscribe()` 可选优化验证 | delivery plan §二标为「可选优化…事件语义未实测，采用前须单独验证」，不阻塞底座条款 | 握手轮询方式的订阅替代路径 |
| handshakeTimeoutMs / 环境变量覆盖的真机路径 | task4 遗留 5：headless case3 已验证短超时语义，真机未验证配置覆盖 | handshake 配置覆盖真机路径 |
| tmux `capture-pane -e` TUI 视觉帧 | V3 四项均为日志/状态判读，headless 真机 stderr 已覆盖；TUI 路吞 bridge stderr（day1 §2.4）；本刀未做 PNG/视觉判读，day1 已有 TUI .ans | TUI 视觉手感（列 USER-JUDGMENT/后续切片） |
| 末期统一 E2E 重构 | 交付计划阶段末，S1–S6+SK 合入后、0.24 tag 前 | 全场景族、NOT RUN 清单清零 |

以上 NOT RUN 项均如实声明，未伪装为 PASS；无 `depends on` 前提未满足导致的 NOT RUN。

## USER-JUDGMENT / 用户判断项（≤5，只列真正需要用户眼睛判的）

本刀 V1–V4 全部检查点均为机器可判（计数、日志状态、错误文本、exit code、sha256），未把技术 PASS 转嫁用户。无需用户裁决的机器项列为 0。仅列 1 项与底座相邻、机器判不了的呈现问题：

- id: UJ1 | status: USER-JUDGMENT（不进入机器门禁，不阻塞上述 PASS/FAIL）
- Ask the user: stdio 管道破裂后宿主打 `requesting appExit(0)` 并优雅退出，但随后出现一行 `config reload ... failed / Error: HMR is disposed` 尾巴日志——这条后关闭日志是否需要在 0.24 抑制（避免用户误读为故障）？
- machine already measured: dispose/appExit/graceful-shutdown 三行显式日志存在、close code=0、无未捕获崩溃（09-stdio-break.log）
- why machine cannot judge: 「这行日志是否该显示」属文案/呈现取舍，无机器可判标准；不影响握手/降级/W 面的机器判定
- User verbatim + date: （待用户裁决；未裁决则保持 USER-JUDGMENT，不阻塞门禁 FAIL 结论）

## Gitignore notice / 忽略提示

`.proof/024-base-task5/*.log` 原始证据未经脱敏、无密钥；受仓库既有 `.gitignore:4 *.log` 忽略，仅落在本 worktree 磁盘（15 文件俱在，未推远端），报告与 `00-preregistered-expected.md` 随本刀提交以便复核。未代为修改 `.gitignore`。`node_modules/` 亦被仓库既有 `.gitignore` 忽略（`git check-ignore` 验证）。

## Commit / 提交

- Change ref（被测底座）: a199bf1f37be897576f2359c4fde26c34e0186e2
- Task commit SHA（加入本证据包的提交）: 023cc23509611db82670aefac7ebc96975069bd9（短 023cc23）
- Raw `.log` 证据受仓库既有 `.gitignore:4 *.log` 忽略，仅存在于本 worktree 磁盘（15 个文件俱在）；按 skill 允许 raw 证据可被 gitignore，未代为修改 `.gitignore`。`00-preregistered-expected.md` 与 `report.md` 已提交。
- Discipline: worktree `feat/024-capir` 本地 commit；未 push、未开 PR；CapIR 真源未改（`capir.json` sha256 与 01 快照一致）；负例注入物仅在 /tmp，symlink 已恢复（12-injection-restore.log，RESTORE_MATCH=yes，tracked diff=0）
