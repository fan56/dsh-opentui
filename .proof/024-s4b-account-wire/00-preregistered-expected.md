# 024 S4b account wire 补刀 — 预注册期望（R1）

> 捕获前落盘，never edited。基点 `feat/024-capir @ 76c8257`（S5 交付 head）。
> 依据：`024-s5-review-oldfox.md` §五 R1 裁决 / §六.1 前置门；`024-s4-review-oldfox.md` §六.1 第二/三项、§六.2 字面欠账（scanner config 值负例）；`024-s4-pkce-slice.md` §二/§三、`024-s5-config-slice.md` §七。
> PASS 判定式：E1–E8 达成 ∧ 门禁全绿 ∧ verify70 64/64、real-client-gate 64/64 不回归 ∧ 冻结面未碰 ∧ 脱敏扫描最后一步 hits=0。

---

## 0. R1 范围裁定（冻结）

- 立 S4b，S6 开工前完成，不并入 S6（`024-s5-review-oldfox.md` §五）。
- 本刀只做**新增接线**：account wire 入口表 + 应答白名单投影 + bridge 二进制帧级测试 + 真机 `s2-account: section=yes`。
- 红线：不改冻结面（`capir/capir.json` 真源 / `capcontract/*` / `build-bridge.mjs` 转义段 / ledger 生成物须走 gen-ledger 正门）；凭据值零落盘；不碰 S6 范围（legacy seam 删除 / symlink 债不属本刀）。

---

## 1. E1 — account wire 入口表（12 条中哪些走 stdio 帧）

参照 `CAP_MODEL_WIRE_METHODS` / `CAP_SETTINGS_WIRE_METHODS`（表查找，非手抄 `req.method ===` 行；@manual 保持 11）。新增 `CAP_ACCOUNT_WIRE_METHODS`：客户端帧名 → CapIR W id（`@deepseek-ai/dsh-deepseek-account#account/<name>`）。

| # | CapIR id 尾 | 客户端帧名 | 传输 | 请求形状 (params) | 应答形状 (result) |
|---|---|---|---|---|---|
| 1 | account/getState | `account.getState` | stdio unary | `{}` | **投影四字段**（见 §2） |
| 2 | account/hasRunningAccountTasks | `account.hasRunningAccountTasks` | stdio unary | `{}` | `{ running: boolean }` |
| 3 | account/getProfile | `account.getProfile` | stdio unary | `{ client }` | `{ present: boolean }` |
| 4 | account/getBalance | `account.getBalance` | stdio unary | `{ client }` | `{ present: boolean }` |
| 5 | account/getNotifications | `account.getNotifications` | stdio unary | `{ client }` | `{ count: number }` |
| 6 | account/getNotificationContent | `account.getNotificationContent` | stdio unary | `{ id, client }` | `{ present: boolean }` |
| 7 | account/reportNotificationEvent | `account.reportNotificationEvent` | stdio unary | `{ id, event, client }` | `{ ok: true }` |
| 8 | account/startSignIn | `account.startSignIn` | stdio unary | `{ client, callbackOrigin, loginSource }` | **投影四字段**（见 §2） |
| 9 | account/cancelSignIn | `account.cancelSignIn` | stdio unary | `{ attemptId }` | **投影四字段**（见 §2） |
| 10 | account/signOut | `account.signOut` | stdio unary | `{ client }` | **投影四字段**（见 §2） |
| 11 | account/watch | `account/watch` | 非 unary wire | relay stream（S5 C4 已接线） | 不经本表；沿用 `createAccountWatchRelay` cap.event |
| 12 | account/watchExpiry | `account/watchExpiry` | 非 unary wire | relay stream（S5 C4 已接线） | 不经本表；沿用 `createAccountWatchRelay` cap.event |

- 10 条 unary 进 stdio 帧路由表；2 条 stream 由既有 relay 承载（不新增 hand-wire、不复制 dispatcher）。
- 既有 4 条 `CAP_MODEL_WIRE_METHODS` 与 2 条 `CAP_SETTINGS_WIRE_METHODS` 零改动。
- 错误路径：`NOT_WIRED`/`unavailable` → `UNSUPPORTED`；`BAD_PARAMS`/`BAD_KIND` → `INTERNAL`（与 model/settings 臂同纪律），错误 message 不回显任何值。
- ledger：12 个 account CapIR id 已在 `CAP_HOST_WIRED_IDS`/ledger in_wired（S2 落地），本刀**不新增 id**，故 `24/257` 与 `@manual 11` 不变；若门禁显示漂移则走 gen-ledger 正门重生成，禁止手改生成物。

## 2. E2 — 白名单投影字段枚举（`projectAccountViewForFrame`）

视图类四方法（getState / startSignIn / cancelSignIn / signOut）的 result 只含下列**固定四字段**，逐字段构造（非 spread、非键名过滤）：

| 字段 | 类型 | 允许值 / 规则 |
|---|---|---|
| `status` | string\|null | 仅 `signed-out` / `credential-stored`；其它→null |
| `attemptPhase` | string\|null | 仅 `initializing`/`waiting-browser`/`exchanging`/`committing`/`succeeded`/`cancelled`/`expired`/`failed`；其它→null |
| `authorizeUrlReady` | boolean | `attempt.authorizeUrl` 为非空字符串→true，否则 false（**URL 值只贡献布尔，永不复制**） |
| `linksPresent` | boolean | `links` 非 undefined/null→true（**links 只过存在性，usageUrl/topUpUrl 原文不出帧**） |

一律禁止出帧（负例探针）：`authorizeUrl`、`authorize_url`、`code_challenge=`、`state=`（URL 参数）、`code_verifier`、`access_token`/`id_token`/`refresh_token`、`attempt.id`、`attempt.expiresAt`、`links.usageUrl`/`links.topUpUrl`、任意 credential 值。

## 3. E3 — bridge 二进制帧级测试清单（helper 级 → 路径级）

起**真实 bridge 进程/stdio**，驱动 shipped bundle 的 `apply()` 读 stdin NDJSON、写 stdout NDJSON，收帧断言（非直接调 helper）：

| id | 用例 | 断言 |
|---|---|---|
| F1 | `account.getState` 视图含 authorizeUrl（waiting-browser sentinel） | reply.result 键集恰为投影四字段；`authorizeUrlReady=true`；stdout 全文零 `authorizeUrl`/sentinel/`code_challenge=`/`state=`/links URL 原文 |
| F2 | `account.startSignIn` 同样视图 | 同 F1（负例：URL 值字段不得原文出帧） |
| F3 | `account.cancelSignIn` / `signOut` | 投影四字段在案、零 URL |
| F4 | `hasRunningAccountTasks` / notification family | 应答为有界形状（boolean/count/ok），零宿主原文字符串 |
| F5 | 未知 account 方法 / 缺宿主 | `ok:false` 且 `error.message` 只含 NOT_WIRED/unavailable 枚举，零值回显 |
| F6 | 既有 model/settings 帧 | 入口表零改动后仍可达（不回归抽验） |

- 负例 URL 运行时构造（host stub 在 `ctx.get('deepseekAccount')` 注入），证据只记键名+布尔，值不落盘。
- shipped bundle 由 `bun scripts/build-bridge.mjs` 产出（CI 在 bun test 前已构建）；测试从测试文件相对路径解析 bundle，不用 cwd 假设。

## 4. E4 — 真机 section 断言（期望 `section=yes`）

- 载体：`scripts/real-client-gate.sh` 的 `s2-account: section=` 行（`/settings` → Account section 快照 grep）。
- 期望：`section=yes`（从 S5 的 `no` 翻转）。
- **一手根因发现（如实记录，不虚构因果）**：S2/S3/S4 的 `.proof/*/real-client-gate/gate-run.log` 均为 `section=yes`，S5 单独退化为 `no`；原因不是"无 stdio 入口"，而是 S5 config 真写把 profile 语言切成 zh-CN，Account 导航标签由 `Account` 变 `账号`，而 gate 的 grep `account|账户|/login` 不含 `账号`。gate 目标是"Account 分区在面板可见"，该断言应在两种 locale 下等价成立。
- 处置：把 `账号` 补入 gate grep 白名单（locale 补全，与 S3「🧠→⌨」/S5「输入消息」同类 harness 定位器修复），使 en/zh 两 locale 均判定真；**不弱化断言**（仍要求真实 /settings 面板出现 Account 分区）。
- 边界：section=yes 证明的是"Account 分区在面板可见"，account wire 入口的**安全性**由 E3 帧级测试独立证明，二者不互相冒充；报告须明确区分。

## 5. E5 — C4 relay 生产接线核对（S5 已落地，本刀只核对）

- `createAccountWatchRelay` 在 `apply()` 内构造（`accountRelay`），start×2（resume/fresh open）、stop×1（binding 替换）、stopAll×1（teardown）共 4 处应在位；本刀不新增/不改动，只核对并留证。

## 6. E6 — 门禁 / 单测 / verify70 / real-client-gate

| 项 | 期望 |
|---|---|
| check-capcontract | `PASS=13 NOT_RUN=0 FAIL=0`；#8 `@manual`=11；#10 `24/257` |
| gen 可复现 | capcontract --check byte-identical；gen-ledger 双跑 sha 一致；冻结面 git diff 空 |
| 构建 | `bun scripts/build-bridge.mjs` / build-client.mjs EXIT=0 |
| 全包单测 | bridge 243+N / 0 fail；shell / tui-base / i18n / panel-kit / runtime 0 新增红 |
| verify70 | `64/64`、exit=0（S5 基线不回归） |
| real-client-gate | exit=0、`REAL_CLIENT_GATE_PASS`、6 组 .ans 非空、`s2-account: section=yes` |
| 脱敏 | `--self-test` 9/9；证据目录 hits=0（最后一步捕获，含 ci log 后重扫） |

## 7. E7 — CI / commit

- commit→push→`gh workflow run ci.yml --ref feat/024-capir`（授权）；三必需 job 全 success、real-client skipped。
- 提交前剔除共享未跟踪：`.proof/024-s3-fix/`、`.proof/024-s3-push/real-client-gate/`、`.proof/024-s4-pkce/real-client-gate/bridge-probe.mjs`、`.proof/024-s5-config/real-client-gate/bridge-probe.mjs` 及其 real-client-gate 目录保持 untracked，不搭车。

## 8. E8 — 交付报告

`/Users/qingguee/repo/wayfinder-web-profile/research/024-s4b-account-wire.md`：入口表、投影字段枚举、帧级测试证据（含负例）、真机 section 翻转证据（含根因）、门禁全项、CI run URL、commit SHA、遗留。
