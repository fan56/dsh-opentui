# PREREGISTRATION — W3 缺陷修复：`/new` 后发消息失败（write-once，捕获前落盘，never edited after capture）

本文件在任何实现改动与证据捕获之前写入磁盘。它是本切片 `expected` 列的冻结预测值。
状态与 observed 值事后按 `pass criterion` 判定写入报告；禁止回改本文件的 `expected`。

- Preregistered at (UTC): 2026-11-23T06:00Z
- Worktree / branch: `/Users/qingguee/repo/dsh-opentui-wt-uibatch-1123` @ `feat/ui-batch-1123`
- Pre-change HEAD (baseline + change ref anchor): `36dc77af81f4672e7ad3489d1e6cab48f3b24bd3`（工作树有其他 agent 未提交改动，commit 只含本切片白名单文件）
- Toolchain: bun 1.4.4 / node v26.8.1 / darwin arm64
- Host bridge: `packages/bridge/src/index.ts`（只读）、transport `packages/shell/src/client/bridge-transport.ts`（只读）
- 真机：自有 tmux server + 自有 scratch HOME（绝不碰 `uibatchframe` / 用户 `~/.dsh` / 用户进程）；帧用 `capture-pane -e -p` 数值 `.ans`，禁 PNG/视觉模型
- Evidence directory: `.proof/new-session-fix/`
- 授权：用户已拍板本版一起修；方案 = oldfox 完整规格 A（先 close 后 open，失败码分类，F1 pending 恢复），不自选放宽
- Acceptance target（任务原话要点）：`/new` 后下一条消息必须成功绑定新会话；close-before-open（ADR-0010:58 `OPEN → CLOSING → OPENING(newId)`）；open 永不带 `replace:true`；transport 本地拒绝类错误恢复 pending 且保持 attached；bridge 守卫不动

## 修复前反例（pre-fix counterexample，FROZEN；改动前必须一手捕获）

改动前在 seam fake-transport 上驱动 attached 会话的 `/new` + `turn()`，捕获到以下**反例**（锁住缺陷，禁止只凭代码阅读声称）：

- C1（违约 wire）：`newSession()` 后 `turn()` 发出的 `session.open` params == `{mode:"new", replace:true}`；该帧到真 bridge（`index.ts:3920-3923`）回 `BAD_PARAMS`。
- C2（F1 意图丢弃）：`session.open` 失败后紧接的下一次 `turn()` **不再发任何 `session.open`**，直接发 `session.send`；`status().sessionAttached === true` 但 `currentSessionId() === undefined` —— 消息静默写进旧会话 journal，界面无会话 id。

证据文件：`00-pre-change.log`（捕获时间戳与逐行输出写入其中）。反例转绿 = E1/E2/E3 的修复后断言。

## 改动白名单（commit 只含这些；逐文件 git add，提交前 `git diff --cached --stat` 核对）

- `packages/shell/src/client/bridge-session-seam.ts`（turn staged-open + newSession 注释）
- `packages/shell/test/bridge-session-seam.test.ts`（改 1 处 + 新增回归）
- `packages/bridge/test/` 下**新增**的一个测试文件（BAD_PARAMS 守卫）
- `.proof/new-session-fix/00-preregistered-expected.md`（本文件）

bridge 源、ADR、provenance、transport 一律不动；close 不挪出 `turn()`。

## 预注册 expected（E1–E9，FROZEN）

| id | assertion | expected（FROZEN，捕获前填） | pass criterion（checkable） | changed path | level | evidence file | depends on |
|----|-----------|------------------------------|----------------------------|--------------|-------|---------------|------------|
| E1 | attached 时 `/new` → 下一次 `turn()` 的 wire 顺序 | `session.close` 紧随 `session.open{mode:"new"}`，且**不存在** `mode==="new" && replace===true` 的 open；`newSession()` 之后、`turn()` 之前**没有** `session.close` | seam-test 断言 requests 顺序数组严格等于 `["session.close","session.open"]`，open params 严格 `{mode:"new"}`；`newSession()` 与 turn 之间 close 计数为 0 | seam `turn()` / seam-test | Unit | `04-seam-test.log` | — |
| E2 | close 失败分类：`SESSION_NOT_OPEN` | close 回 `SESSION_NOT_OPEN` 后仍发 `session.open{mode:"new"}`，turn 正常 resolve，`currentSessionId()` 为新 id | seam-test 新增用例断言 open 已发且 session id 绑定、turn resolve | seam `turn()` | Unit | `04-seam-test.log` | E1 |
| E3 | close 失败分类：transport 本地拒绝/状态未知（F1 回归） | close 回 `BRIDGE_DEAD` / `BRIDGE_RECOVERING` / `BRIDGE_TIMEOUT` 时 turn 以该 code 拒绝、`session.open` 未发、`sessionAttached===true`、`currentSessionId()===undefined`；恢复后下一次 turn 再发 `[session.close, session.open{mode:"new"}]` | seam-test 新增用例逐 code 断言上述四项 + 恢复后 wire 顺序；`BRIDGE_CLOSED` / `BRIDGE_WRITE_FAILED` 同分类由代码同分支覆盖 | seam `turn()` | Unit | `04-seam-test.log` | E1 |
| E4 | close 成功但 open-new 失败 | turn 拒绝、`sessionAttached===false`、pending 不恢复；下一次 turn 自动发 `session.open{mode:"new"}` 且**不带 close** | seam-test 新增用例断言失败后状态 + 第二次 turn 的 requests 严格序列 | seam `turn()` | Unit | `04-seam-test.log` | E1 |
| E5 | resume 分支不变 | attached 时 `resumeSession(B)` 下一次 turn 发 `{mode:"resume", id:B, replace:true}` 且**不发** `session.close` | seam-test 新增用例断言 open params 与 close 计数 0 | seam `turn()`（resume 臂） | Unit | `04-seam-test.log` | — |
| E6 | bridge 守卫有测试保护 | 已有绑定时 `session.open{mode:"new", replace:true}` 回 `BAD_PARAMS`，原绑定不受影响（`dispose()` 未调用、后续 resume 原 id 幂等） | 新增 bridge 测试文件断言 reply.error.code==="BAD_PARAMS"、disposeCalls 为空、resume 原 id 返回同一 sessionId | bridge 测试（新增文件） | Unit | `05-bridge-test.log` | — |
| E7 | 真机 a/b/c/d | 帧文件 `06a`–`06d` 存在且记录：a) 新会话绑定 + 正常回复 + 无 Console 错误面板；b) 第二条消息仍正常，两消息 journal 同属新 id；c) `/new` 后 <1s 发消息成功；d) 未 attached 直接 `/new` 行为不变 | 每帧为 `capture-pane -e -p` 数值帧；journal 目录/文件核对 output 记录两条消息所属 session id 一致且为新 id；d 帧与基线行为对照 | seam（真机） | Artifact | `06a-new-then-message.ans`、`06b-second-message.ans`、`06c-fast-message.ans`、`06d-cold-new.ans`、`07-journal-check.log` | E1–E4 |
| E8 | 应保持绿文件不改 | 指定的 5 个「应保持绿」测试文件字节不变且全绿 | `git diff` 对这 5 个文件为空；bun test 输出 0 fail | 无改动 | Unit | `04-seam-test.log`, `05-bridge-test.log` | — |
| E9 | 门禁阶梯 | seam 全量 0 fail、bridge 全量 0 fail、shell 全量 0 fail、typecheck:entry 成功 | bun test / typecheck 命令输出 0 fail、exit 0 | seam + tests | Gate | `04-seam-test.log`–`08-typecheck.log` | E1–E6 |

非断言证据项：`00-pre-change.log`（修复前反例）、`01-env-snapshot.log`（工具版本 + HEAD）、report.md（observed→判定 + round log）。`*.log` 按 `.gitignore` 不入库；`.ans` 与本报告入库。

## 门禁预期（机器可判项全绿即技术 PASS）

- `bun test packages/shell/test/bridge-session-seam.test.ts`：0 fail。
- 「应保持绿」5 文件：0 fail，且文件未改动。
- bridge 全量：0 fail；shell 全量：0 fail；typecheck:entry：成功。

## USER-JUDGMENT 预案（≤5 项，三类边界；记录 + 默认，不拦门禁）

- U1（交互手感）：`/new` 后 close 与 open 之间是否给用户可见的短暂过渡态。默认：不加新 UI，沿用 turn 期间既有状态（无风险）。
- U2（文案措辞）：close 失败时的用户可见错误文案。默认：沿用现有 BridgeProtocolError 的 code + message 透传，不新增 i18n（无风险）。

## NOT RUN / 合法边界声明

- 真机验证使用自有环境（自有 tmux server + 自有 scratch home）；若某真机子项因环境不可达（无 host / 无凭据）无法覆盖，必须写 NOT RUN + 理由，禁止造帧冒充。
- `SESSION_LOCKED` / `JOURNAL_CORRUPT` 等非本次分类的 open 失败码不在 E 表内，不声称覆盖。

## PASS 判定式（按任务口径）

E1–E9 全达成 ∧ 技术门禁全绿 ∧ 无未声明 NOT RUN ∧ JUDGMENT 有裁决记录 ∧ commit 白名单与 `git diff --cached --stat` 一致 → PASS。
USER-JUDGMENT 项只记录不拦；红就红着报，不放水、不自判放宽。
