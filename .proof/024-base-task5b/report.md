# Proof Report: 024-base-task5b / 底座解冻修复刀 R1–R6 重跑

- Gate / 门禁: **GREEN**
- Profile(s): FEATURE + DATAFLOW + negative-control
- Result: **GREEN** (7 rerun assertions R1–R7 all PASS; real CI NOT RUN)
- Expected registered (UTC): 2026-11-20T14:48Z — frozen in `00-preregistered-expected.md` BEFORE the formal rerun capture (first rerun log `01-env-snapshot.log` 14:48:40Z)
- Base worktree: `/Users/qingguee/repo/dsh-opentui-wt-024-capir` @ `feat/024-capir`; pre-fix HEAD `0a63feeba51277ddf8d32977dea2cb9aa2a4a9eb`
- Ruling basis: `/Users/qingguee/repo/wayfinder-web-profile/research/024-base-task5-review-oldfox.md` (GREEN + R1–R6 + gate patch + A6 re-registration + I-probe + 7-item rerun list)
- Old package `.proof/024-base-task5/` (Gate FAIL, A5/A6) preserved byte-for-byte, not edited (prereg sha256 `1a153714…` unchanged; `git status --short .proof/024-base-task5/` empty).

## 0. 一句话结论

任务 5 的两条红项按 oldfox 裁决修复并重跑：A5 的臆造 `local.invoke` 调用面已从生成物与模板删除，改为 host-adapter 注入 + shipped bundle 真实导出面 `createCapInvoke` 走 `session/list` wired 线，真机往返 `ok=true, hasItems=true`；A6 按「inject 声明后 direct 合法」前提在新包重预注册。7 项重跑全部达成，门禁新增断言全绿且负例实测能抓臆造 `*Face`。CapIR 真源、ledger 排除项、旧证据包一字未改。真 CI 维持 NOT RUN（禁 push）。

## 1. 预注册 expected 对照结果

`00-preregistered-expected.md` 于 2026-11-20T14:48Z 落盘，早于首个正式重跑命令（14:48:40Z）。全程未改写 expected。

| id | rerun item | expected (FROZEN) | observed | status |
|----|-----------|-------------------|----------|--------|
| R1 | V2d/V3 W 往返真机（shipped bundle） | session/list via createCapInvoke 非错误 `{items}`；READY observed=75；无 not-a-function | `[CAP-SMOKE] W roundtrip via createCapInvoke ... "ok":true,"hasItems":true,"items":0`；`READY observed=%d ... 75 75 0`；无报错 | **PASS** |
| R2 | A6/V2e 重预注册 | fallback=75；direct OK；sessionController stable present=true | `"OK local-present"`；`"listLength":75`；`I-probes@stable ... sessionController present=true` | **PASS** |
| R3 | A1/A2 再生成对账 | capir 43/257 sc=27；cc byte-identical；ledger 双跑 sha 一致；@manual 12 | 全部命中；ledger sha `e9826514…` 两跑一致、与旧包相同 | **PASS** |
| R4 | A8/V4 门禁 + 新断言 | check-capcontract 全绿含新断言；负例能抓臆造 Face | `PASS=13 NOT_RUN=0 FAIL=0` exit 0；`--negative-self-test` DETECTED + PASS | **PASS** |
| R5 | bridge 单测 | 全绿含新 dataflow 8 例 | 新测试 8 pass/0 fail；全量 188 pass/0 fail | **PASS** |
| R6 | V2c pos/neg + V3 coldstart/break | headless FAIL=0；冷启动 READY；break 优雅退出 | headless `summary: FAIL=0`；cold close 0 + READY + I-probes@stable；break close 0 + dispose/appExit/shutdown | **PASS** |
| R7 | 真 CI | NOT RUN | report NOT RUN 清单含此项；未 push | **PASS**（按口径=如实 NOT RUN） |

Status summary (sum = N = 7): PASS 7 | FAIL 0 | NOT RUN 0 | UNAVAILABLE 0 | BLOCKED 0 | USER-JUDGMENT 0 | PASS-BY-USER 0.

## 2. R1–R6 逐条落位证据

| 条款 | 落位 | 一手证据（file:line / log） |
|------|------|------------------------------|
| R1 生成物去调用面 | `scripts/gen-capcontract.mjs` dispatch 模板删除 `TypertLocalFace`/`resolveTypertLocal`/`local.invoke|stream`/`CAPCONTRACT_BUNDLE` inject；保留 `CAP_DISPATCH_TABLE`、`lookupCapKind`（错误文本 `capcontract: unknown method id` 原样） | 重生成 `capcontract/dispatch.ts` 头 + `lookupCapKind`/`createCapDispatcher(hostInvoke)`；`03-regeneration.log` byte-identical |
| R2 dispatch 改 host-adapter 注入 | `CapHostInvoke = (methodId, kind, params) => Promise<unknown>`；`createCapDispatcher(hostInvoke)` 只查表定 kind 后委托 | `capcontract/dispatch.ts` 尾部；`capcontract/binder.ts` `createProjectionBinder(hostInvoke)` |
| R3 bridge wired host adapter | `index.ts` 新增 `CAP_HOST_WIRED_IDS`（session/list 单条，对齐 ledger `in_wired=1/257`）、`createCapHostInvoke`（复用 `resolveSessionController` + `controller.list`）、`createCapInvoke`；未 wired 显式 `NOT_WIRED` | `index.ts` host adapter 段；`05-bridge-unittest.log` NOT_WIRED 两例；`07-w-roundtrip-shipped.log` ok=true |
| R4 门禁补丁（3 条） | check-capcontract 新增 #9 host-face provenance（负例钉）+ #10 dispatch executability（常驻消费方/wired 对账/test presence）；`capcontract-dispatch.test.ts` dataflow 单测；smoke 走 shipped bundle 导出面 | `04-gate-full.log` PASS=13；`04b-gate-negative.log` DETECTED；`05-bridge-unittest.log` 8 pass；`07-w-roundtrip-shipped.log` |
| R5 路线 b 登记不进本刀 | descriptor.invoke + TypertClientRemote shim 仍为 TODO，CapIR params schema 无字段；未实现、未赌这条线 | `capcontract/dispatch.ts` / `binder.ts` TODO 注释；本刀 diff 无 remote shim |
| R6 再生成与对账同步 | 三文件再生成，`--check` byte-identical 跟随新基线；ledger wired 名单（@manual 12）未变故 ledger 数据不动；第 7 条 no-bare-ctx 自动满足 | `03-regeneration.log`；`04-gate-full.log` #7/#@manual PASS |

## 3. 新门禁负例实测（证明能抓臆造 Face）

`node scripts/check-capcontract.mjs --negative-self-test` 用一个内存中的毒化样本
（`interface FakeLocalFace { invoke(...) }` + `ctx.typert.local.invoke(id, params)`）跑同一套
provenance 判定，不触碰任何仓内文件。实测输出（`04b-gate-negative.log`）：

```
negative-self-test: DETECTED -> fabricated local.invoke/local.stream call; self-invented *Face interface
negative-self-test: PASS (predicate rejects fabricated *Face + local.invoke)
```

这正是任务 5 红项的缺陷类别（臆造 `*Face` + `local.invoke`）。判定器同时扫描生成物
**与生成器模板**（缺陷源在模板 `gen-capcontract.mjs`），堵住「只钉生成物、模板回归等再生成才暴露」的漏 Path。

## 4. A6 新旧口供对照说明

| 项 | 旧包 `.proof/024-base-task5/` | 新包 `.proof/024-base-task5b/` |
|----|------------------------------|------------------------------|
| 前提 | 无 inject 声明（day1 插桩副本） | a199bf1 依 v2.1 C 条款声明 `inject:['typert']`（bridged `index.ts:354`） |
| expected（direct） | `ctx.typert throws 'cannot get property ... without inject'` | `direct ctx.typert OK local-present`（inject 后合法） |
| observed | direct OK（与 expected 冲突）→ 判 **FAIL** | direct `"OK local-present"` → 命中 expected → **PASS** |
| fallback | list=75（成立） | `"listLength":75` → PASS |
| sessionController | present=false@apply → true@1500ms（人工解释） | I 探针移到稳定窗口，`I-probes@stable ... sessionController present=true` → PASS |
| 文件处置 | 原样留档，FAIL 行不改（sha 不变） | 新开预注册文件，NOTE 引用裁决 §二前提变更依据 |

红着报 + 前提变了重开预注册，二者都对；旧包一字未回写。

## 5. 7 项重跑结果表

| # | 项 | 重跑口径 | 结果 | 证据 |
|---|----|----------|------|------|
| 1 | V2d/V3 W 往返真机 | shipped createCapInvoke → session/list wired → 非错误 + READY=75 | **PASS** | `07-w-roundtrip-shipped.log` |
| 2 | A6/V2e 重预注册 | fallback=75 + direct OK + sessionController stable present | **PASS** | `07-w-roundtrip-shipped.log` |
| 3 | A1/A2 再生成对账 | capir/cc byte-identical，ledger 双跑 sha 一致，@manual 12 | **PASS** | `03-regeneration.log` |
| 4 | A8/V4 门禁 + 新断言 | check-capcontract PASS=13 exit 0，负例能抓 Face | **PASS** | `04-gate-full.log`, `04b-gate-negative.log` |
| 5 | bridge 单测 | 188 pass / 0 fail（含新 8 例） | **PASS** | `05-bridge-unittest.log` |
| 6 | V2c pos/neg + V3 coldstart/break | headless FAIL=0；cold READY + I-probes@stable；break close 0 | **PASS** | `06-headless-suite.log`, `06b-coldstart.log`, `06c-breakpipe.log` |
| 7 | 真 CI（tag 触发） | 维持 NOT RUN（禁 push） | **NOT RUN**（如实） | 本表 + 主报告 |

全项按「红就红着报、绿就绿着报」如实归档。

## 6. NOT RUN（显式）

| 项 | 原因 | 排除范围 |
|----|------|----------|
| 真 CI（tag 触发 GitHub Actions） | 本刀禁 push/开 PR；真 CI 需 push 后由 tag 触发 | V4 真 CI；本地 gate 已代跑 |
| V1 三份一手实测重跑 | 宿主环境除 rc.4→rc.5 外未变；rc.5 能力面已实测 75（升级报告）；ledger 排除项不动 | V1 原始一手实测 |
| 路线 b（descriptor.invoke + remote shim） | R5 明定不进本刀，依赖 CapIR params schema（无）+ 宿主 namespace 成员面未实测 | 全集 257 通用调用 |
| typert.local.subscribe / handshakeTimeoutMs 真机覆盖 / tmux 视觉帧 / 末期 E2E | 原 NOT RUN 清单原样保留 | 同旧包 §5 |

## 7. USER-JUDGMENT

UJ1（stdio 破裂尾随 `HMR is disposed` 文案是否抑制）仍留用户裁决，未在本次修复范围，不阻塞。

## 8. 纪律核对

- 未 push、未开 PR；worktree 本地 commit（SHA 见主报告 `024-base-task5b-fix.md`）。
- CapIR 真源未改：`capir.json` sha256 `fab915a4…` 与旧包快照一致。
- ledger 排除项未改：`ledger.json` sha256 `e9826514…` 两跑一致、与旧包相同。
- 旧证据包未改：`git status --short .proof/024-base-task5/` 空；prereg sha `1a153714…` 一致。
- 未删改既有测试：仅新增 `capcontract-dispatch.test.ts`；bridge 全量 188 pass。
- 真机 smoke 从 shipped bundle 真实导出面执行，scratch symlink 用后恢复（指向 `rc5-capability-probe-20261120`）；无 /tmp 注入副本参与出货面验证。
- 未编造；红项按裁决修复，重跑全绿，真 CI 如实 NOT RUN。

## 9. Evidence index

| file | level | what it captures |
|------|-------|------------------|
| 00-preregistered-expected.md | prereg | frozen expected R1–R7 + A6 premise-change rationale + rc.5 env note |
| 01-env-snapshot.log | Artifact | rc.5 env + key file sha + old package integrity |
| 02-typecheck.log | Artifact | bridge tsc --noEmit exit 0 |
| 03-regeneration.log | Artifact | R3 三生成器对账 + ledger 双跑 sha |
| 04-gate-full.log | Artifact | R4 check-capcontract PASS=13 exit 0 |
| 04b-gate-negative.log | negative-control | R4 负例能抓臆造 Face/local.invoke |
| 05-bridge-unittest.log | Artifact | R5 新 8 例 + 全量 188 pass |
| 06-headless-suite.log | Artifact | R6 headless FAIL=0 + I-probes@stable |
| 06b-coldstart.log | Artifact (real I/O) | R6 真机冷启动 READY + close 0 |
| 06c-breakpipe.log | Artifact (real I/O) | R6 stdio 破裂优雅退出 close 0 |
| 07-w-roundtrip-shipped.log | Artifact (real I/O) | R1/R2 shipped createCapInvoke 往返 + A6 三项 |

`.log` 证据受仓库既有 `.gitignore:4 *.log` 忽略、仅落 worktree 磁盘；两份 `.md` 随本刀提交。
