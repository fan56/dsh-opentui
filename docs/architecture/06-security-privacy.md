# 06 安全与隐私（脱敏 / 投影 / auth URL / 转义段）

> 出处约定见 [README.md](README.md)。不变量在此；证据包采集步骤见 `docs/workflows/w5-proof-evidence.md`。

## 6.1 脱敏三处白名单与中央剥离

stdio 是明文管道：凭据/敏感值不得写入 stdio 日志；诊断日志只记 method-id + 状态码（v3 `:100`）。0.24 收敛为**三处白名单**：

| 面 | 机制 | 出处 |
|---|---|---|
| wire | `sanitizeFrameForWire` 在 `writeFrame` 中央剥离：`S4_AUTH_FORBIDDEN_KEYS`（`authorizeUrl`/`authorize_url`/`code_challenge`/`code_verifier`/`access_token`/`id_token`/`refresh_token`）按**键名**从任意出帧对象递归剥离（深度 ≤12），不改值、数组保留 | `packages/bridge/src/index.ts:377-382,434-449`；`:2175-2178`（writeFrame 唯一序列化点） |
| emit | relay 只 emit 固定四键 `cap.event`（`methodId/sessionId/seq/eventType`），原始 account 状态与 authorizeUrl 从不上线；eventType 白名单、未知折叠为 `event` 且不回显原文 | `index.ts:773-811,834-835`；`024-s4-pkce-slice.md:61` |
| proof | CAP_SMOKE 只 emit 白名单键名/布尔/枚举（如 `{"urlReady":false,"urlInFrame":false,"whitelist":[...]}`），宿主原文不落盘；证据侧 `scan-stdio-secrets.mjs` 兜底 | `index.ts:2017,2042,2050-2052`；`024-s4-pkce-slice.md:57`；`024-s5-config-slice.md:151-157` |

**中央性**：`sanitizeFrameForWire` 只挂在 `writeFrame`（`index.ts:2178`），因此任何未来 caller（reply / emit / relay）都无法绕过它把 authorizeUrl 写进帧（`:434-438`）。CAP-SMOKE 的 `emit` 走 stderr、不在 guard 内，是设计内豁免——但该面当前只发白名单键名/布尔/枚举（`024-s4-review-oldfox.md:39`）。

## 6.2 auth URL 四层禁入

auth URL（`SignInAttemptView.authorizeUrl`，含 `code_challenge`/`state`；PKCE verifier 留宿主侧）的值**永不跨帧**。四层捕获（`024-s4-pkce-slice.md:23,50-61`）：

1. **wire**：guard 对原始结果去 auth 键 → 零命中（`index.ts:434-449`）。
2. **emit**：relay 四字段白名单 → 零命中（`index.ts:834-835`）。
3. **日志**：错误经 `classifyPushErrorCode` 收敛为有界枚举 `NOT_WIRED/BAD_PARAMS/BAD_KIND/HOST_ERROR`（`index.ts:681-695`），seam degrade 只报 `code`（`024-s4-pkce-slice.md:23`）。
4. **证据**：`scan .proof/<slice>` 零命中；自测每 pattern 命中（`024-s4-pkce-slice.md:77,114`；`024-s5-config-slice.md:131-132`）。

边界（不可当绝对不变式引用）：guard 只剥键名不改写值（`replyError.message` 若宿主错误内嵌 URL 会过帧，当前宿主不含）；深度 >12 整棵放行；键改名可绕（`024-s4-review-oldfox.md:44,115`）。这是**键名级 + 现有调用面级**的闭合。

## 6.3 逐字段白名单投影（settings / account）

键名剥离不够时改用构造式白名单：

- **account**：`projectAccountViewForFrame` 只产出 `status ∈ {signed-out, credential-stored}`、`attemptPhase ∈ {8 个有界枚举}`、`authorizeUrlReady`（布尔，仅存在性）、`linksPresent`（布尔）；非白名单一律 `null`/布尔（`index.ts:370-408`）。非 view unary 方法用 `projectAccountScalarResult` 只回 `running/present/count/ok`（`:410-432`）。四个 view 返回方法必须走投影，**不得依赖键名剥离**——后者会放过 `links.usageUrl/topUpUrl` 原文（`024-s4-review-oldfox.md:96`；`index.ts:1260-1264`）。
- **settings**：`LocalSettingsStore.describe()` 对三个 namespace（`subagent`/`permission`/`session-log-deepseek`）按 `NS_VALUE_FIELDS` **逐字段构造** value 与 schema，无宿主对象 spread；非白名单 ns 只给 `{ns, revision}` 零 value 字段；`mutate()` 只接受白名单 ns + 首段路径（`packages/shell/src/client/local-config-faces.ts:47-72,189-235,239-261`；评审 `024-s5-review-oldfox.md:28`）。`configSave()` 只接受 `CONFIG_KEYS`（`local-config-faces.ts:76-82,318`）。

## 6.4 凭据纪律（只报键名）

`CredentialInfo` 由宿主逐字段 redact 成「键名 + 有无」，永不有值（`index.ts:330-342`；宿主侧 `@deepseek-ai/dsh-api-settings-controller/src/credentials.ts:63-66,88-90`，非本仓文件）；桥不 import 宿主包，按稳定 `this.name` 映射错误类（`ADR-0010:144-154`）。证据与日志约定：凭据/密钥值零落盘，只记键名与有无/布尔；sentinel 运行时构造、不入盘（`024-s2-credentials-slice.md:8`；`024-s4-pkce-slice.md:151`；`024-s5-config-slice.md:157,172`）。

## 6.5 N1 转义段冻结（禁扩 needle）

`scripts/build-bridge.mjs:110-123` 的转义段把产物中字面量 `@deepseek-ai/dsh-llm` 替换为 `@deepseek-ai\u002fdsh-llm`：JS 解析后字符串逐字节不变，但移除了 CI inline-guard 会误判的字面子串（guard 只禁「实现内联」，合法内联的是 ledger 能力**数据**）。这是 **build-output-only** 变换，不改真源/ledger/CapIR/握手语义（`:119-120`）。冻结条款 C1：该段**只读、禁扩 needle、禁放宽**，改动须显式评审票（`024-base-frozen.md:18,29`）。

## 维护责任

脱敏白名单、投影字段集、错误码分类、凭据上报口径或 build-bridge 转义段发生变化时必须更新本文档；新增出帧面须同步 6.1 三处白名单表。
