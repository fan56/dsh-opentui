# PREREGISTRATION — S2 credentials/account unary+stream 切片（write-once，捕获前落盘，never edited after capture）

本文件在任何实现改动与证据捕获之前写入磁盘。它是 S2 报告 `expected` 列的冻结预测值。
状态与 observed 值事后依据 `pass criterion` 判定，写入 `024-s2-credentials-slice.md`；禁止回改本文件的 `expected`。

- Preregistered at (UTC): 2026-11-20T16:53Z
- Worktree / branch: `/Users/qingguee/repo/dsh-opentui-wt-024-capir` @ `feat/024-capir`
- Pre-change HEAD (baseline + change ref anchor): `5b0fab993a35f134c3b827b9a7151f433d93bf5a`（S1 GREEN 态，clean）
- Host: `dsh --version` = `0.2.2-rc.5`（证据头记录；真机配方 tmux + `capture-pane -e`，禁 PNG/视觉模型）
- Evidence directory: `.proof/024-s2-credentials/`
- Profile(s): FEATURE（W 接线运行时）+ DATAFLOW（set→后端 cred 存储往返）+ negative-control（NOT_WIRED / BAD_PARAMS / 脱敏反例）
- Acceptance target（用户原话逐字）: "credentials/account unary 适配（含 S1 评审三条 concern）……account 12 + credentials 3 接入 hostInvoke 注册表（真实服务名一手核验，S1 模式）；inject 扩面后重跑握手 75/75 核对；stream 路径按 kind 表落地；stdio 脱敏纪律必含；真机 E 系列按预注册采集（脱敏扫描对证据包执行一次并把结果入包）。"

## 元数据（切片票）

### account 期望面 = CapIR 12 条（运行时在场已实证，S1 评审 §五.1 / 计划 v2.1 D 勘误）

宿主源码 `@deepseek-ai/dsh-deepseek-account`（rc.5）`#account/*` 恰 **12 条**，服务键 `deepseekAccount`
（`src/index.ts:136` `super(ctx, 'deepseekAccount', { namespace: 'account' })` 一手核验）。逐条 @Remote 真源行号：

| # | CapIR id（前缀 `…#account/`） | kind | @Remote 真源行号 / 方法 |
|---|---|---|---|
| 1 | cancelSignIn | unary | `src/index.ts:533` `@Remote` → `cancelSignIn(attemptId)` :534 |
| 2 | getBalance | unary | `src/index.ts:246` `@Remote` → `getBalance(client)` :247 |
| 3 | getNotificationContent | unary | `src/index.ts:282` `@Remote` → `getNotificationContent(id, client)` :283 |
| 4 | getNotifications | unary | `src/index.ts:256` `@Remote` → `getNotifications(client)` :257 |
| 5 | getProfile | unary | `src/index.ts:227` `@Remote` → `getProfile(client)` :228 |
| 6 | getState | unary | `src/index.ts:205` `@Remote` → `getState()` :206 |
| 7 | hasRunningAccountTasks | unary | `src/index.ts:577` `@Remote` → `hasRunningAccountTasks()` :578 |
| 8 | reportNotificationEvent | unary | `src/index.ts:310` `@Remote` → `reportNotificationEvent(id, event, client)` :311 |
| 9 | signOut | unary | `src/index.ts:551` `@Remote` → `signOut(client)` :552 |
| 10 | startSignIn | unary | `src/index.ts:479` `@Remote` → `startSignIn(client, callbackOrigin, loginSource)` :480 |
| 11 | watch | **stream** | `src/index.ts:621` `@Remote({ name: 'watch', mode: 'stream' })` → `watchState(signal)` :622（底层 `watch()` :612 `observeUpdates`） |
| 12 | watchExpiry | **stream** | `src/index.ts:587` `@Remote({ mode: 'stream' })` → `watchExpiry(signal)` :588 |

kind 交叉核对：`capcontract/types.ts:296-307` CAP_METHODS 中 account 10 unary + watch/watchExpiry 2 stream；
`capcontract/dispatch.ts:20-31` CAP_DISPATCH_TABLE 同值。stream 方法**S1 unary switch 臂不覆盖**，须按 kind 表落地 stream/observe 臂。

**class 语义**：account 全 12 条为 W（wire/client-callable），服务键 `deepseekAccount`，经 `ctx.get('deepseekAccount')`
同 seam 复用（与 S1 `resolveSessionController` 同源模式）。

**安全不变量**：宿主源码明确 `getState(): Promise<AccountView>` 返回「snapshot without credentials or PKCE secrets」
（`src/index.ts:201-218`），`AccountView` 仅 `{status, attempt, links}`——account 面**无凭据值回传**，可安全白名单投影。
`watch`/`watchExpiry` 流元素 `AccountUpdate = {type, state: AccountView}`（同上无密钥）。

### credentials 期望面 = 3 条（批 1 资产收编 SOP 重推导，禁止套用 account 口径）

**收编 SOP 盘点（先于预注册完成）**：`attempt` 读 `feat/0234-{steer,tooling,keymap}` 分支资产——
`e2e/scenarios/69-login.sh`、`packages/tui-base/test/login.test.ts`、`settings-write-honesty.test.ts`、
`vendor/schema/src/credential.ts`、`src/routes/session/login.ts`、`settings-modal.tsx` **均真实存在**（已一手核对）。
这些是 0.23.4 线行为断言（如 `credentialStatus(ref)` / `login(ref, apiKey)` / `writeSetting` 的 `cred_`/apiKeyEnv 语义），
按收编 SOP 转为切片验收素材；expected 依据 CapIR 契约重推导，不沿用 0.23.4 手抄 wire 语义。

宿主源码 `@deepseek-ai/dsh-api-settings-controller`（rc.5）`#credentials/*` **3 条**，服务键 `credentialsController`
（`src/credentials.ts:71` `super(ctx, 'credentialsController', { namespace: 'credentials' })` 一手核验）：

| # | CapIR id（前缀 `…#credentials/`） | kind | @Remote 真源行号 / 方法 | 敏感面 |
|---|---|---|---|---|
| C-1 | describe | unary | `src/credentials.ts:83` `@Remote` → `describe(refs: string[])` :84 | 读投影：`Record<string, CredentialInfo>`，**宿主 field-by-field 脱敏**（`credentials.ts:63-66` "no method here returns a [secret] value"） |
| C-2 | set | unary | `src/credentials.ts:100` `@Remote` → `set(ref: string, value: string)` :101 | **写携带敏感值 value**：`credentials.ts:93-105` "The value crosses the wire in this direction only: no read path returns it" |
| C-3 | unset | unary | `src/credentials.ts:113` `@Remote` → `unset(ref: string)` :114 | 删引用，无值回传 |

kind 交叉核对：`capcontract/types.ts:339-341` / `dispatch.ts:63-65` 三条均 unary（无 stream）。

**凭据/敏感值零落 stdio 纪律（最高优先）——显式断言（与禁 PNG 同级）**：
1. `credentials/set` 的 `value` 真值**绝不**进入：wire 帧日志、`[CAP-SMOKE] emit` 字段、proof 证据日志三处。
2. 三处一律**白名单化**：仅投影键名（ref）/布尔有无（configured）/错误码；禁止 `JSON.stringify(params)` 原始帧落盘。
3. 交付**脱敏扫描脚本**（切片票交付物，属证据采集非测试层投资）：对证据包执行一次，结果入包。
4. 只报键名与有无，不报值：报告/证据中对凭据仅出现 `ref` 名与 `present:true/false` 或错误码。

### 服务名一手核验汇总（S1 模式复用）

- account → `ctx.get('deepseekAccount')`（源 `dsh-deepseek-account/src/index.ts:136`），运行时在场（S1 §五.1 + 计划 D 勘误：account/* 12 条运行时已注册）。
- credentials → `ctx.get('credentialsController')`（源 `dsh-api-settings-controller/src/credentials.ts:71`），namespace `credentials`（`credentials.ts:71`）。
- 另 `dsh-client-ui-connector-account#connectorAccounts/*` 3 条**不在本片期望面**（ledger expected 内 account 相关共 15，但 S2 只接本片 12+3=15 条 CapIR id；connector-account 3 条保持 wired 面外，膨胀负例不覆盖）。

### wired 面预期

- `CAP_HOST_WIRED_IDS` 由 4（session/list + 3 model）→ **19**（+12 account +3 credentials）；ledger `methods[].in_wired` 4 → **19**（19/257）。
- `wired_capir_generated.ids` 由 3 → **18**（+15；session/list 仍 hand-wired @manual 不重复）。
- `wired_surface_manual` **保持 11**（本片不新增 `req.method ===` 手抄分支；account/credentials 表查找经生成链，不入 @manual）。
- **inject 扩面**：`inject` 增加 `deepseekAccount`、`credentialsController` 两键（I-probe 从 6 → 8 观测键，但 ledger i_class count=6 服务维度不变；新增两个仅观测不降级）；握手 READY observed/expected 面**保持 75/75**（账户/凭据服务是 I 类观测，不增 W descriptor，expected 75 不变）。门禁 #7（no bare ctx.<service>）须仍绿。

## stream 路径策略（S1 unary 模式不覆盖，按 kind 表落地）

- dispatcher 传 `kind` 给 `createCapHostInvoke`（`CapHostInvoke(methodId, kind, params)`）。S1 忽略 `_kind`；S2 在 hostInvoke 内**读 kind**：
  - `kind === 'unary'`：直调宿主方法，返回 Promise（同 S1）。
  - `kind === 'stream'`：对 `account/watch`、`account/watchExpiry` 调宿主 async generator（`watchState(signal)` / `watchExpiry(signal)`），
    返回 **AsyncIterable**（不 `await` 消费到底）——hostInvoke Promise<unknown> resolve 为该 iterable；
    `signal` 由 params 提供（缺省新建 AbortController，probe 后 abort 释放）。
- **降级与断言策略**：stream 方法若宿主缺该方法 → 显式 `NOT_WIRED`（与 unary 同纪律，不静默空流）；
  smoke 对两条 stream 各取首个元素（带超时守卫）断言 `type ∈ {snapshot, credentials-changed}` 且 `state.status` 合法，
  并断言元素形状无凭据字段（白名单投影）；超时/空流按 leg 记录，不伪造。
- CapIR 契约无 event frame（`types.ts` TODO）——stream 元素不落 stdio；emit 只报 `{method, kind:'stream', hasFirst, firstType, unlockedKeys:[...]}` 白名单。

## 预注册 expected（E1–E6，计划 §三模板）

| id | assertion | expected（FROZEN，捕获前填） | pass criterion（checkable） | changed path | level | evidence file | depends on |
|----|-----------|------------------------------|----------------------------|--------------|-------|---------------|------------|
| E1 | account 10 unary wired 经生成链到宿主 | `ctx.get('deepseekAccount')` 的 10 个 unary @Remote 全部经 `createCapInvoke` 返回 ok；`getState()` 返回 `{status:'signed-out'\|'credential-stored', attempt, links}` 白名单形状（无凭据字段）；`hasRunningAccountTasks()` 返回 boolean | `[CAP-SMOKE] W account getState ... "ok":true,"status":"signed-out"` 且 emitted 键集 ⊆ {status,attemptPhase,linksPresent}；10 条各一条 emit ok=true 或宿主领域错误（非 NOT_WIRED） | `packages/bridge/src/index.ts` createCapHostInvoke (account unary arms) + CAP_HOST_WIRED_IDS | Artifact | `06-account-smoke.log` | — |
| E2 | account 2 stream 按 kind 表落地 | `account/watch`、`account/watchExpiry` 经 dispatcher 传 `kind:'stream'` → hostInvoke stream 臂返回 AsyncIterable；取首元素 type ∈ {snapshot, credentials-changed}，state.status 合法；emit 只含白名单键 | `[CAP-SMOKE] W account stream ... "kind":"stream","hasFirst":true,"firstType":"snapshot"`；两方法各有 emit；iterable 可被 `Symbol.asyncIterator` 检测 | `packages/bridge/src/index.ts` createCapHostInvoke (stream arm, kind read) | Artifact + reverse | `06-account-smoke.log` | — |
| E3 | credentials describe/set/unset wired + 脱敏 | `credentials/describe` 经生成链返回 `Record<ref, CredentialInfo>`（键名+有无，宿主脱敏）；`credentials/set` 携合成哨兵值写入 scratch cred 存储后 describe 可见键存在；`credentials/unset` 后消失；三处日志零明文哨兵 | `[CAP-SMOKE] W credentials describe/set/unset ... ok=true`；set 的 emit 无 `value` 字段；`grep` 三处零命中哨兵串；DATAFLOW：同一 ref 在 set 后 present:true、unset 后 present:false | `packages/bridge/src/index.ts` createCapHostInvoke (credentials arms) | Artifact + DATAFLOW | `07-credentials-smoke.log` | — |
| E4 | inject 扩面后握手面不漂移 | 增加 `deepseekAccount`/`credentialsController` inject 观测键后，重跑握手 READY observed=75 expected=75 missing=0；I-probes@stable 两新键 present=true（或如实记为 timing artifact）；门禁 #7 绿 | smoke stderr `READY observed=75 expected=75 missing=0`；`I-probes@stable` 含 `{"key":"deepseekAccount","present":true}` 与 `{"key":"credentialsController","present":true}`；`check-capcontract #7 PASS` | `packages/bridge/src/index.ts` inject + `packages/bridge/src/handshake.ts` iClassKeys（观测键） | Artifact | `04-handshake-recheck.log`, `02-gate-full.log` | — |
| E5 | 负例：NOT_WIRED / BAD_PARAMS / stream 缺宿主降级 | 未 wired 的 CapIR id（如 `session/create`）仍 `NOT_WIRED ... ledger in_wired=19/257`；`credentials/set` 缺 value 或 bad ref → `BAD_PARAMS` 且不达宿主；stream 方法缺宿主方法 → NOT_WIRED（负例单测） | stderr `NOT_WIRED` 且 `ledger in_wired=19/257`；单测断言 BAD_PARAMS 不达宿主 + stream 缺方法 NOT_WIRED | createCapHostInvoke fallback / params 校验 | Artifact + reverse | `08-negative.log`, 单测日志 | — |
| E6 | stdio 脱敏扫描（三处白名单） | 对证据包执行脱敏扫描脚本：wire 帧日志 / CAP-SMOKE emit / proof 日志三处零命中凭据哨兵值（合成串 `DSHS2CRED_SENTINEL_<uuid>`）；仅键名/有无/error-code 落盘 | `scripts/scan-stdio-secrets.mjs <evidence-dir>` exit=0，`hits=0`，报告写三处扫描文件数与零命中 | `scripts/scan-stdio-secrets.mjs`（新增，证据采集非测试层投资） | Artifact + reverse | `09-desens-scan.log` | E3 |

非断言证据项：`01-env-snapshot.log`（rc.5 + SHA + date）、`02-gate-full.log`（check-capcontract #1–#10 全绿，#8=11 names，#10 wired=ledger=19）、`03-regen.log`、`04-handshake-recheck.log`、`05-bridge-unittest.log`、`05b-shell-unittest.log`、`06-account-smoke.log`、`07-credentials-smoke.log`、`08-negative.log`、`09-desens-scan.log`、`10-verify70.log`、`11-pack.log`、`12-ci.log`、`report.md`。

## 门禁预期（技术门禁全绿即 PASS）

- check-capcontract 全项：`PASS=13 NOT_RUN=0 FAIL=0`（#8 名集=11 不变；#9 host-face provenance 绿；#10 wired 集=ledger in_wired=19）。
- bridge 单测：全绿（既有断言一字不改；新增 account/credentials/stream 用例可加，不删旧断言）。
- shell 全量单测：全绿（既有断言不改，C2 新增正向 flatten 用例可加）。
- bun build / gen-capir `--check` / gen-capcontract `--check` 字节一致；gen-ledger 两次 sha 相同（幂等）。
- verify 脚本（70 项）：若环境 BLOCKED 如实登记（S1 同口径），不谎报 PASS。
- pack 门禁：按 ci.yml pack-cold-start 原文本地复跑。
- 脱敏扫描：`scripts/scan-stdio-secrets.mjs` 对证据包执行一次，hits=0。
- 真 CI：`gh workflow run ci.yml --ref feat/024-capir` 三 job 全绿（Pack/handshake、test ubuntu、test macos）；红就红报。

## concern 带掉（S1 评审）

- **C1**（E2 判定弱化）：E2E 重跑时修正判定式（等待后台保存后读回 / 断言 session 级 selection 生效），报告显式记录「criterion 部分未按字面达成」——本片**记入 024-e2e-requirements.md 清单，E2E 时执行**，不本片修复。
- **C2**（正向 UI 零覆盖）：补一条 handleLine wire 帧 → seam 正向 flatten 测试（groups→rows），低成本，本片落地于 shell 单测。
- **C3**（NOT RUN 缺单一实体）：建 `/Users/qingguee/repo/wayfinder-web-profile/research/024-e2e-requirements.md`，汇总冻结文档 + S1/S2 各片 NOT RUN/BLOCKED 可勾销清单，末期按此勾销。

## USER-JUDGMENT 预案（≤5 项，三类边界；记录 + 默认，不拦门禁）

技术 PASS 判定不依赖下列项；每项记录 + 推荐默认（只选无风险方案）：

- U1（视觉布局）：account/凭据面板在 80×24 下的呈现是否舒适。默认：沿用现有 settings/login 布局，不改样式。
- U2（交互手感）：sign-in / sign-out 交互手感与快捷键冲突。默认：沿用现有键位，不新增快捷键。
- U3（文案措辞）：登录/登出/凭据写入成功失败提示措辞。默认：沿用现有 i18n，不新增文案。

## PASS 判定式（按任务口径）

E1–E6 全达成 ∧ 技术门禁全绿 ∧ 脱敏扫描 hits=0 ∧ NOT RUN 无未声明项 ∧ JUDGMENT 全有裁决记录 → PASS。
USER-JUDGMENT 项只记录不拦；默认只选无风险方案（沿用现状）。真 CI 红就红着报。

## 反作弊与边界

- 不改 CapIR 真源（capir/capir.json）、不改 N1 转义段（scripts/build-bridge.mjs 冻结只读）、不改既有测试断言、不删既有测试。
- 凭据值绝不入仓/报告/日志（只报键名与有无）；哨兵值为合成随机串，仅用于证明脱敏，不落三处 sink。
- 旧证据包（`.proof/024-s1-model/`、`.proof/024-base-task5*`）一字不改留档。
- 未 wired 的 238 个 W id 保持 NOT_WIRED（膨胀期望面负例）。
