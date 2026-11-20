# PREREGISTRATION — S4 PKCE/stream 适配切片（write-once，捕获前落盘，never edited after capture）

本文件在任何 S4 实现改动与证据捕获之前写入磁盘。它是 S4 报告 `expected` 列的冻结预测值。
状态与 observed 值事后依据 `pass criterion` 判定，写入 `research/024-s4-pkce-slice.md`；禁止回改本文件的 `expected`。

- Preregistered at (UTC, `date -u`): 2026-11-20T20:20Z
- Worktree / branch: `/Users/qingguee/repo/dsh-opentui-wt-024-capir` @ `feat/024-capir`
- Pre-change HEAD anchor: `8f537fa38b3ddb2ca5c133180495c714caf6432a`（S3 修复刀；BL-1+C-1+C-2 已闭合，S4 前置满足）
- Host: `dsh --version` = `0.2.2-rc.5`，macOS arm64；宿主源码 `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-deepseek-account/src/`
- Evidence directory: `.proof/024-s4-pkce/`
- 前置条款：S3 评审 §五逐条执行；BL-1/C-1 已由 `8f537fa` 闭合，本片不复改其判序/分类语义。
- 冻结面声明：不碰 `capir/capir.json` 真源、`scripts/build-bridge.mjs` 转义段、既有测试断言删除；CapIR W 全集 257 / expected 75 / `@manual` wired 11 / 握手面 75/75 保持不变。PKCE verifier 留宿主持有，桥内不生成、不接收、不落盘。

---

## 一、能力面与服务名一手核验（捕获前已核，写死）

宿主 rc.5 源码一手行号（本片实现期只按此落点，不改 CapIR 真源）：

| 事实 | 一手位置 |
|---|---|
| 服务名 `deepseekAccount`，namespace `account` | `src/index.ts:136` `super(ctx, 'deepseekAccount', { namespace: 'account' })` |
| `startSignIn(client, callbackOrigin, loginSource)` @Remote | `src/index.ts:479-480` |
| PKCE verifier/state 宿主随机生成；challenge=SHA256(verifier) S256 | `src/index.ts:682-684, 723` |
| `authorizeUrl` 由平台 `authorize_url` 拼 `code_challenge/state/redirect_uri/locale` 后写入 attempt view | `src/index.ts:727-737`；`types.ts:28` `SignInAttemptView.authorizeUrl?: string` |
| 回调 `/oauth/callback` 校验 state 恒定时间比较 + code 唯一性 | `src/index.ts:705-715` |
| token 经 `auth_exchange` 用 `code_verifier` 换取，落宿主 `credentials` grant | `src/index.ts:745-760` |
| `getState` doc = "a snapshot without credentials or PKCE secrets" | `src/index.ts:202-206`；但返回对象 `attempt` 在 waiting-browser 期含 `authorizeUrl` → 桥侧必须投影剥离 |
| `cancelSignIn` / `signOut` @Remote | `src/index.ts:533-534 / 551-552` |
| `watchExpiry(signal)` @Remote stream | `src/index.ts:587-588` |
| `watch` = `watchState(signal)` @Remote(name:'watch', mode:'stream')；stream item = `{type, state: AccountView}` | `src/index.ts:612, 621-623`；`types.ts:45-49` |

CapIR id（已 wired，S2 落位，本片只加保护面不加 id）：`account/startSignIn`、`account/cancelSignIn`、`account/signOut`、`account/getState`、`account/watch`、`account/watchExpiry`。`CAP_HOST_WIRED_IDS` 保持 22，不因本片增长。

## 二、PKCE 流程 expected（登录发起 → challenge 流转 → 回调 → token 落地）

1. **发起**：客户端经生成链 `createCapInvoke` 调 `account/startSignIn`（unary），params 只含 `client{version,locale,timezoneOffsetSeconds}`、`callbackOrigin`、`loginSource∈{web,desktop}`；缺/坏字段 → `BAD_PARAMS` 不达宿主；无宿主服务 → `NOT_WIRED`。
2. **challenge 流转**：verifier/state/challenge **只在宿主持有**（一手行号见上）。桥侧从宿主拿到 `AccountView.attempt.authorizeUrl` 后，只允许把它投影成一个布尔 `authorizeUrlReady`，URL 原文（含 `code_challenge=`/`state=`）**不得进入任何帧**。`attempt.phase` 只允许枚举白名单原样透出。
3. **回调**：浏览器访问宿主 `/oauth/callback`，宿主校验 state + code（桥不参与、不记参数、不记 URL）。
4. **token 落地**：宿主用 verifier 完成 exchange 并写 credentials grant；桥侧 `getState` 只投影 `status ∈ {signed-out, credential-stored}`、attempt.phase、布尔 url-ready、links 存在性；**凭据引用与令牌值零落帧**。
5. **取消/登出**：`cancelSignIn`/`signOut` 走已 wired unary，返回同样投影；只回状态枚举，不回 URL/引用/值。

## 三、stream 生命周期 expected（四件套；新 stream 臂必备）

- (a) **signal 释放**：客户端传入的 signal 透传宿主；桥自建 controller 在 iterable `return()`/`throw()`/自然 done 时 `abort()`（复用 S3 `withOwnedAbort`，不另起机制）。relay 持 controller，`stop(sessionId)`/`stopAll()` 显式释放。
- (b) **BAD_KIND 门**：`account/watch`、`account/watchExpiry` 以 `kind!=='stream'` 调用 → `BAD_KIND`，不达宿主；`kind==='stream'` 但缺宿主方法 → `NOT_WIRED`（不静默空流）。
- (c) **cap.end 降级**：stream 自然结束发 `cap.end{reason:'stream-end'}`；错误发 `cap.end{reason:'unavailable', code ∈ NOT_WIRED|BAD_PARAMS|BAD_KIND|HOST_ERROR}`（复用 S3 `classifyPushErrorCode`）；seam 只降级对应 `(sessionId,methodId)` 订阅，不波及其它流。
- (d) **排序键**：帧按 `(sessionId, methodId)` 复合键计 seq（每订阅自 1 起），seam 按同键判序（BL-1 修复态）；重复/回退 seq 丢弃并计入 `capPushDropCount`。
- **resume 语义（写死，不留实现期即兴）**：采用**显式 start/stop 面**——seam 不自动重订阅；调用方在 `session.open(mode:'resume')` 后显式调用 `start(sessionId)`，在 dispose/切换时显式 `stop(sessionId)`；每次 start 对该会话两方法从 seq=0 重新 arm，已订阅则幂等 no-op。（S3 的三方法 push relay 保持其既有自动 arm 语义，本片不改。）

## 四、watch 帧白名单枚举字段（逐条列出，禁用字段显式否定）

允许落 `cap.event`/`emit`/日志/证据的字段，**逐一**列出：

1. `methodId` — 仅两个 CapIR id 字面量之一（`...#account/watch`、`...#account/watchExpiry`）。
2. `sessionId` — 非空字符串，用于隔离与复合键。
3. `seq` — 正整数，每订阅单调。
4. `eventType` — 枚举白名单：`snapshot` | `credentials-changed` | `expiry` | `event`（未知宿主 type 统一折叠为 `event`，截 64 字符）。
5. `status` — 仅当从 `state.status` 读取且命中枚举 `signed-out` | `credential-stored`；否则 null。（state 投影面，非 cap.event 线协议字段；emit 面可含。）

一律**禁止**透传（字段名级否定，逐条）：`authorizeUrl`、`authorize_url`、`code_challenge`、`code_verifier`、`state`（URL query 参数语义）、`access_token`、`id_token`、`refresh_token`、`token`、`idToken`、`refresh`、`apiKey`、`password`、`value`、`attempt`（原始对象）、`state.attempt`（原始对象）、`links`（URL 原文）。`attempt.phase`、`status`、`authorizeUrlReady` 布尔与 `linksPresent` 布尔是唯一允许的派生量。

## 五、预注册 expected（E1–E8，机器可判；JUDGMENT 另列，只记不拦）

| id | assertion | expected（FROZEN） | pass criterion（checkable） | evidence file |
|----|-----------|-------------------|----------------------------|---------------|
| E1 | PKCE/auth 能力在 hostInvoke 注册表且服务名一手核验 | `CAP_HOST_WIRED_IDS` 含 6 个 PKCE/auth id 且总数仍 22；rc.5 `index.ts:136` 服务名 `deepseekAccount` 与桥 `resolveDeepSeekAccount` ctx.get 键一致 | bridge 单测断言 6 id ∈ 注册表 + length=22；`01-env-snapshot.log` 记一手行号与源码 sha | `05-bridge-unittest.log`, `01-env-snapshot.log` |
| E2 | PKCE 四阶段投影：只布尔/枚举过帧 | startSignIn → getState → cancelSignIn/signOut 全链：注入含 `authorizeUrl`（`code_challenge=`/`state=`）的 stub 视图；投影后 `status` 命中枚举、`attempt.phase` 命中枚举、`authorizeUrlReady===true`，且 `JSON.stringify(投影)` 对 sentinel/`code_challenge=`/`state=` 零命中 | bridge 单测断言投影字段集精确 + 三敏感串零命中；`pre/post` 反例：未投影原文命中 sentinel，投影后零命中 | `05-bridge-unittest.log`, `03-pkce-leak-prepost.log` |
| E3 | auth URL 四层禁入（wire / emit / 日志 / 证据） | 同一次 PKCE 流里：wire 帧对象、CAP-SMOKE emit 串、ctx.logger 调用串、证据包文件全文——四层各对 `code_challenge=`/`state=`/`authorizeUrl=`/sentinel 零命中；emit 仅含 `authorizeUrlReady` 布尔 | 单测四层捕获断言零命中；证据包 `node scripts/scan-stdio-secrets.mjs .proof/024-s4-pkce` exit=0 hits=0 | `05-bridge-unittest.log`, `09-desens-scan.log` |
| E4 | stream 四件套（a/b/c/d） | watch/watchExpiry 及新增 relay 满足 signal 释放 / BAD_KIND / cap.end 分类 / 复合键判序四件；`cap.end.code` 为有界枚举 | bridge + shell 单测逐件断言；`withOwnedAbort` return/throw/done 释放，caller signal 不被误 abort | `05-bridge-unittest.log`, `05b-shell-unittest.log` |
| E5 | **同 session 双 stream 交错集成测试**（watch + watchExpiry） | relay emit 直接泵入真实 seam；同 session 两方法并发，交错 8 帧（各 4）；两流各 `seq=[1,2,3,4]`、总投递 8、去重集 8、`capPushDropCount=0`；pre-change（无复合键）RELAY 同计划投递仅 4、丢 4 | shell 集成测试 pass + pre/post 对照日志（旧键检出丢弃） | `05c-integration-unittest.log`, `03-pkce-leak-prepost.log` |
| E6 | 负例三重 | BAD_PARAMS（坏 client/空 callbackOrigin/坏 signal）、NOT_WIRED（无宿主服务/未 wired id）、流程中途 cancel（cancelSignIn 后 watch 收到 terminal phase 且无 URL）均到位，不达宿主或显式降级 | 单测三重断言；真机 smoke 如实记 HOST_ERROR（scratch 无登录态），不伪造 token 落地 | `05-bridge-unittest.log`, `06-pkce-smoke.log` |
| E7 | 脱敏负例缺口 S3'(a) 补齐 | 扫描器 `--self-test` 对 6 pattern（credential-sentinel / secret-value-field / secret-assignment / sk-key / ghp-token / bearer-token）逐条植入并各捕获 ≥1 hit；另新增 auth-URL pattern 逐条捕获 | `node scripts/scan-stdio-secrets.mjs --self-test` exit=0 且每 pattern `detected=true` | `08-desens-negative.log` |
| E8 | 门禁全项 + CI 三 job 绿 | check-capcontract `PASS=13 NOT_RUN=0 FAIL=0`（22/257、@manual 11 不变）；gen 双跑 sha 一致；build exit=0；bridge/shell 全单测 0 fail；verify70 22 项 [S5]+[AG] 豁免不动；CI 三 required job success | 见门禁表；CI run headSha=本片提交 | `02-gate-full.log`, `03-regen.log`, `05c-build-typecheck.log`, `10-verify70.log`, `12-ci.log` |

**PASS 判定式**：E1–E8 全达成 ∧ 门禁绿 ∧ NOT RUN 无未声明项 ∧ JUDGMENT 全有裁决记录；verify70 `36/58`（22 豁免）按 8056f73 判据人工核对为 PASS-with-exemptions，`--allow-red` 仍缺则如实记录，不自判放行；S5 收口前不得静默续豁免。

## 六、JUDGMENT（只记不拦，默认无风险）

- J1（交互手感）：登录发起后的浏览器跳转时机与返回 TUI 的手感 → 记录，沿用现有流程，不新增快捷键。
- J2（文案措辞）：登录中/已登录/已登出/失效提示措辞 → 记录，沿用现有 i18n，不新增文案。
- J3（视觉布局）：登录态指示在 80×24 下的位置/遮挡 → 记录，沿用现有布局，不改样式。

## 七、NOT RUN（同步勾进 `024-e2e-requirements.md`，不静默删除）

- NR1：真机完整 PKCE 登录（需登录态 + 浏览器回调 + provider 凭据；scratch home 无登录态，仅可达 startSignIn HOST_ERROR invalid URL，如实记，不伪造 token 落地）。
- NR2：watchExpiry 首帧（scratch 无 expiry 事件；iterableOk=true 但 hasFirst=false，如实记）。
- NR3：verify70 [S5]15 + [AG]7 共 22 项豁免（S5 收口，本片不动台账，合入后须 58/58）。
- NR4：真机配方 `--allow-red` 机制仍缺（按 8056f73 判据人工核对，raw exit=1 如实记录）。
- NR5：shell tsc 2 条预存错误（`session-seam-adapter.ts:182`，未触碰文件，8056f73 基线相同），非本片引入。
