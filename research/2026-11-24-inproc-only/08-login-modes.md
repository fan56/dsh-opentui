# 08 — `/login` 三入口（DeepSeek account / 第三方 provider / 自定义 provider）上游能力调研

- 日期：2026-11-24
- 工作区：`/Users/qingguee/repo/dsh-opentui-wt-inproc-only`（分支 `research/inproc-only-1124`，HEAD `153c8ce`）
- 宿主：dsh `0.2.2-rc.5`，`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh`
- 性质：只读调研（未改源码、未动 `~/.dsh`、未打印任何 key/token 值）
- 路径缩写：`<dsh>` = 宿主包根；`<npm>` = `<dsh>/node_modules/@deepseek-ai`；repo 内路径相对工作区根。
- 关联：D8 子票 `tickets/2026-11-24-inproc-D8-login-modes.md:1-36`、oldfox 二轮 P0-5/P0-6（`tickets/2026-11-24-inproc-only-review-oldfox-2.md:15-16`）、06 归属设计（`research/2026-11-24-inproc-only/06-patch-ownership-design.md`）。

---

## 0. 结论先行

| 模式 | 上游真实能力 | inproc 现状可达性（静态判定，见 §7 未知项） | 凭据落点（上游设计） | 判定 |
|---|---|---|---|---|
| 1 DeepSeek account | **有**：OAuth2 授权码 + PKCE(S256) + 系统浏览器 + 宿主机回环 `/oauth/callback`；**非 device code**、非「平台账号 token 手填」；**单账号**（无账号列表/切换） | bridge 已接线 12 个 `account.*` 帧（`packages/bridge/src/index.ts:650-662,1237-1254`）、seam 与 `/account` 命令已存在（`packages/shell/src/client/bridge-session-seam.ts:1597-1612`；`packages/tui-base/src/routes/session/commands.ts:1836-1867`）；但 `startSignIn` 强依赖 `webServer`（`<npm>/dsh-deepseek-account/src/index.ts:684-685`），而 inproc profile 只挂 `dsh-base`+bridge（`packages/shell/scripts/provision-inproc-profile.mjs:146-149`），`webServer` 仅在 `dsh-web-app` 声明（`<npm>/dsh-web-app/cordis.patch.yml:183-184`）→ **登录会抛 `PlatformAuthError('protocol')`** | `<home>/.credentials.yaml` 的 `records`（`deepseek-account-platform/default` grant + `deepseek-account-platform/device` 设备 id，`<npm>/dsh-deepseek-account/src/index.ts:34-37,740-747,762`） | **需新做**：要么以非 HTTP 方式补齐 webServer/authorization 通道，要么明确 account 入口在 inproc 不可用；现有 `/account signin` 传死 `http://localhost`（`commands.ts:1857`）不足以起 OAuth |
| 2 第三方 provider | **有可枚举清单**：宿主 `llm.listConfigurableProviders` + `llm.listProviders`（`<npm>/dsh-llm/src/index.ts:497-500,510-560`）；pi-ai 目录由 `@earendil-works/pi-ai/providers/all` 提供（`<npm>/dsh-llm-pi-ai/src/catalog.ts:15,187-217`）；catalog provider 还自带 OAuth/device-code 登录流（`<npm>/dsh-llm-pi-ai/src/login.ts:40-47,58-87,131-171`） | **目录读取已接线**：seam（`seams/session.ts:899-906`、`bridge-session-seam.ts:1505-1514,1667-1672`）→ `/login` picker（`commands.ts:549-574`、`login.ts:77-107`），宿主不可用时 degrade 成静态表（`login.ts:24-61`）。**但** pi-ai 的 OAuth 流跑在 Host-local `dsh-authorization`（无 `@Remote`，`<npm>/dsh-authorization/src/index.ts`），bridge 无 `authorization.*` 帧，TUI 无法触发；key 落点仍是坏掉的 `provider-keys.json`（§4） | key 应进 `<home>/.credentials.yaml` 的 `refs`（`apiKeyEnv` 引用，`<npm>/dsh-llm-pi-ai/src/index.ts:209-231`；docs `<dsh>/docs/user/guide/providers.md:13,19-23`）；OAuth grant 进同文件 `records`（`<npm>/dsh-llm-pi-ai/src/auth.ts:29-38,141-186`） | **需小改（目录）/需新做（账号式 OAuth）**：列表面板可直接接线；key 必须改走凭据通道，OAuth 需新增 Host 桥 |
| 3 自定义 provider | **有 schema**：`llm-pi-ai.providers` dict，字段全集 `<npm>/dsh-llm-pi-ai/src/config.ts:104-208,355-385`；自定义路由必填 `api`(4 协议之一)+`baseURL`+≥1 `models[]`（`<npm>/dsh-llm-pi-ai/src/catalog.ts:898-926`、`<npm>/dsh-llm-pi-ai/src/provider.ts:48-64`）；无「直接写 key」字段，只有 `apiKeyEnv` 引用 | `/login` 已有六步自定义链（`commands.ts:592-635`、`login.ts:113-186`）且能写 5 个字段（`login.ts:127-137`）；但写入走 `LocalLoginFace.registerRoute` 行级改托管 patch（`local-config-faces.ts:666-710`），**下一次 provision 被模板覆盖**（06:328,356,583）；且 key 落 `provider-keys.json` 宿主读不到（§4） | 同上：`apiKeyEnv` → `.credentials.yaml refs`；路由定义 → profile `cordis.patch.yml` 的 `llm-pi-ai.providers.<id>`（volatile，`config.ts:383-385`） | **需小改**：接线成本最低，但必须先解决 P0-5(b) 子键合并 + key 落点两处硬阻塞，否则「登录成功但路由/密钥消失」 |

**总阻塞（贯穿三模式）**：inproc profile 只加载 `dsh-base` + bridge（`provision-inproc-profile.mjs:149`）。上游的三条登录相关 Host 面——`dsh-authorization`（OAuth/device-code 流）、`dsh-api-settings-controller`（`settingsController` + `credentialsController`）、`dsh-host-webserver`（OAuth 回调）——都只在 `dsh-web-app/cordis.patch.yml:146-147,183-184` 声明，**均不在 inproc 组合内**。这也解释了客户端为何选择本地文件实现（`local-config-faces.ts:5-17,583-601`）。因此本需求的核心不是「画三个面板」，而是先决定「Host 凭据/授权通道是否进 inproc」。

---

## 1. DeepSeek account：真实路径、落点、多账号

### 1.1 能力：浏览器 OAuth2 + PKCE，非 device code，非手填平台 token

- 包名 **`@deepseek-ai/dsh-deepseek-account`**（`<npm>/dsh-deepseek-account/src/index.ts:1,105-107`）。README 明确：「Sign in through the system browser and keep the account credential in the existing local credential store」（`<npm>/dsh-deepseek-account/README.md:2`）。
- `startSignIn(client, callbackOrigin, loginSource)` 起 attempt，`authorization.begin()` 提交（`index.ts:479-526`）；`run()` 内：
  - `verifier/state` 各 32 字节随机，`challenge = SHA256(verifier)` base64url（`:686-688`）→ **PKCE S256**，非设备码；
  - 在宿主机注册精确路由 `GET /oauth/callback`，校验 `state`、单 `code`（`:700-719`）；
  - 平台端点 `auth_init`（带 `code_challenge/state/redirect_uri/locale/login_source`）→ `authorize_url`（`:721-736`）；回调拿 code → `auth_exchange`（带 `code_verifier/device_id/device_model/os_version`）→ token + `authorized_url`（`:737-751`）；失败时可 `auth_cancel`（`:768,785-792`）；
  - `session.commit({kind:'grant', payload:{version:1,token,issuer}})`（`:762`）落到凭据服务。
- `loginSource` 取 `'web' | 'desktop'`（`:479`），`callbackOrigin` 必须是「浏览器可访问的 loopback HTTP origin」（`:474-475`）；`loginOrigin()` 校验（`login.ts` 无 device code；全宿主 `device_code` 只出现在 pi-ai 的 `<npm>/dsh-llm-pi-ai/src/login.ts:71`）。
- 账号信息来自平台 current-user/profile：`getProfile/getBalance/getNotifications`（`index.ts:227-329`）；`getPlatformSession()` 给嵌入式 Platform 页面用 Host-only token（`index.ts:418-435`；类型 `<npm>/dsh-deepseek-account/src/types.ts:114-124`），**不经过 account RPC**。
- 另一个账号流：`dsh-llm-pi-ai` 为目录 provider 注册 OAuth/device-code 授权流（`registerPiAiFlows`，`<npm>/dsh-llm-pi-ai/src/login.ts:131-171`；`device_code` 事件含 `verificationUri + userCode`，`:52-77`）。但 `openai` 的 OAuth 被明确不提供（`UNSERVED_OAUTH`，`:19-26`）。这条流跑在 Host-local `ctx.authorization`（`dsh-authorization/src/index.ts:189,209,231,283`，**全文件无 `@Remote`**），bridge 没有 `authorization.*` 帧（`packages/bridge/src/index.ts:630-672`），TUI 当前无法调用。
- `<npm>/dsh-anonymous-user-id/src/index.ts:1-15,28-30` 只是 `$DSH_HOME/.anonymous-user-id` 的遥测 UUID，与账号登录无关；不要用它做登录 identity。

### 1.2 落点与多账号

- 凭据键：`KEY = credentialKey('deepseek-account-platform','default')`、`DEVICE = credentialKey('deepseek-account-platform','device')`（`index.ts:34-35`）；grant schema `{version:1,token,issuer}`（`:36`），device schema `{id:uuid}`（`:37`）；键语法见 `<npm>/dsh-credentials/src/index.ts:19-22,69-76`。
- 启动期 `readRecord(KEY)` 校验 kind/payload/issuer，issuer 不匹配就删（`:191-199`）；运行期 `readCurrentGrant()` 同样校验（`:437-447`）；token 只给白名单 `inferenceOrigin`（`:449-470`）。
- **单账号**：`AccountView.status` 只有 `'signed-out' | 'credential-stored'`（`<npm>/dsh-deepseek-account/src/types.ts:37-42`）；只有一个 `KEY`；`signOut` 直接 `deleteRecord(KEY)`（`:551-571`）；没有任何 list/switch/多 key 的 API。pi-ai 侧同理：一条 provider 一个 `recordKeyFor(providerId)`（`<npm>/dsh-llm-pi-ai/src/auth.ts:29-38`）。
- 消费方：account route 的 provider 是 `deepseek-account`，用 `x-dsh-auth-token` 头带 token（`<npm>/dsh-llm-deepseek-account/src/index.ts:18-20,29-50`），模型表来自账号 `/models`（`:51-98`）；models 页面因此不给它模型编辑器（`<dsh>/docs/user/guide/providers.md:119-132`）。
- API-key 路线是另一条 provider：`deepseek-official`，`apiKeyEnv` 默认 `DEEPSEEK_API_KEY`（`<npm>/dsh-llm-deepseek-api-key/src/config.ts:14-26`、`<npm>/dsh-llm-deepseek-api-key/src/index.ts:20,37-46`）。**DeepSeek account 与 DeepSeek API key 是两条不同 provider 路由**，不要在 account 面板里复用 `apiKeyEnv`。

### 1.3 在 inproc 的可达性（需验证的静态结论）

- `dsh-base` patch 确实挂了 `authorization`、`deepseek-account`、`credentials`、`llm-deepseek-account`（`<npm>/dsh-base/cordis.patch.yml:117-126,549-553`），所以 `ctx.get('deepseekAccount')` 能拿到（bridge 的 S2 解析 `packages/bridge/src/index.ts:1739-1746`，探针 `:2353`）。
- 但 `run()` 第一行 `const webServer = this.ctx.get('webServer'); if (webServer === undefined) throw ...`（`index.ts:684-685`），而 `webServer` 的插件声明只在 `dsh-web-app`（`<npm>/dsh-web-app/cordis.patch.yml:183-184`），inproc 的 `BUNDLES = ['@deepseek-ai/dsh-base', BRIDGE_NAME]`（`provision-inproc-profile.mjs:146-149`）不含 web-app；bridge 包自身 `dependencies: {}`（`packages/bridge/package.json`）。→ 静态结论：`/account signin` 会失败，需实机确认错误码。
- 客户端已有 `/account` 命令（`commands.ts:1836-1867`），`signin` 传 `"http://localhost"`（`:1857`），没有真实 loopback 端口/回调服务；account seam 的 `SeamAccountState` 刻意只投影 `status/attemptPhase/authorizeUrlReady/linksPresent`（`seams/session.ts:735-746`、`bridge-session-seam.ts:1597-1612`），**authorize URL 值不会过 seam**，所以「打开浏览器」这一步目前没有 URL 可展示。

---

## 2. 第三方 provider：可枚举目录与新增字段

### 2.1 权威清单来源

1. **宿主 llm 目录**：`LlmRuntime.listProviders()`（`<npm>/dsh-llm/src/index.ts:497-500`）与 `registerConfigurableProviders()`（`:510-560`）。`LlmConfigurableProvider` 字段：`provider`（route key）、`displayName`、`settingsNs`、`settingsPath`、`declared`（custom 标记）、`defaultBaseURL`、`baseURLEnv`、`nativeAuth{env,oauth}`、`error`（`<npm>/dsh-llm/src/types.ts:246-293`）。注释明确「Configuration surfaces merge this directory with listProviders()」（`:246-250`）。
2. **pi-ai 内置目录**：`builtinProviders()` from `@earendil-works/pi-ai/providers/all`（`<npm>/dsh-llm-pi-ai/src/catalog.ts:15,187-217`）；`directoryEntries()` 把「全部 catalog id」+「当前 profiles 声明的 route」并集注册，`settingsPath: ['providers', provider]`、catalog 条目附 endpoint/nativeAuth（`<npm>/dsh-llm-pi-ai/src/index.ts:138-172,271-286`）。dsh-base 注释说明 catalog 是 dormant，profile 供给才变 live（`<npm>/dsh-base/cordis.patch.yml:128-134`）。docs 里列举的 id 示例：`anthropic/openai/moonshotai/zai`（`<dsh>/docs/user/guide/providers.md:17-23`）。
3. **客户端已经在用**：`providerDirectory.registered()/configurable()/discover()`（`seams/session.ts:899-906`；`bridge-session-seam.ts:1505-1514,1667-1672`）→ `resolveLoginCatalog()`（`commands.ts:549-574`）→ `catalogEntriesFromDirectory()`（`login.ts:77-107`）；失败时降级到静态 `PROVIDER_CATALOG`（`login.ts:24-61`）并提示（`commands.ts:968-969`）。

### 2.2 「加一个已知 provider」要写什么

- 目录条目是**引用**，不是配置：UI 选中一个 catalog provider 后，真正写的是 `llm-pi-ai.providers.<id>` profile（`index.ts:160`；`<dsh>/docs/user/guide/providers.md:15,19-23`）。
- 最小 profile（已知 id）：`apiKeyEnv: <ENV_REF>` 即可——catalog 提供 endpoint/协议/模型（`<npm>/dsh-llm-pi-ai/src/config.ts:104-123,501-524`；现有 `providerProfileFor()` 就是这个形状，`login.ts:127-137`）。
- 若要覆盖或补全（网关/改模型）：`displayName`、`api`（4 协议之一）、`baseURL`、`models`（`<dsh>/docs/user/guide/providers.md:27-33,67-79`；schema 见 §3）。
- 协议可选值固定 4 个：`openai-completions` / `openai-responses` / `anthropic-messages` / `google-generative-ai`（`<npm>/dsh-llm-pi-ai/src/provider.ts:30-64`），docs 也逐一对应（`providers.md:29`）。Bedrock/Vertex/Azure/Codex 不在可手填协议表内（`provider.ts:36-46`）。
- key 用 `apiKeyEnv`（CredentialRef，POSIX 变量名），**没有直接 key 字段**（`<npm>/dsh-llm-pi-ai/src/config.ts:356,534`）；宿主按 ref 解析环境/凭据文件（`<npm>/dsh-llm-pi-ai/src/index.ts:209-231`）。
- 账号式登录（OAuth/device-code）若也要在第三方入口提供：流已注册但不跨 Remote（§1.1），需新增 Host 桥 + TUI 面板，是**新做**而非接线。

---

## 3. 自定义 provider：`llm-pi-ai.providers` 完整 schema

### 3.1 schema 位置与整体规则

- 运行时 schema：`<npm>/dsh-llm-pi-ai/src/config.ts:355-385`；`Config = z.object({ providers: z.dict(profile).default({}).volatile() })`（`:383-385`）——**providers 整块 volatile**。
- `providers` 是 **dict，key 即 provider 路由 id**（`config.ts:104-105,250-258`）；列表形态会被拒绝（`:445-447`）。id 非空（`:452`）。schema 没有更严的字符约束，但要用存储凭据（`llm-pi-ai/<id>` record）时 id 必须匹配 `^[a-z][a-z0-9-]*$`（`<npm>/dsh-credentials/src/index.ts:19-22,69-76`；`<npm>/dsh-llm-pi-ai/src/auth.ts:143-170,163-170` 报 `UNSTORABLE_PROVIDER_ID`）。客户端当前校验更宽：`^[A-Za-z0-9_-]+$`（`login.ts:144-150`）与写 YAML 的 `^[A-Za-z0-9_.-]+$`（`local-config-faces.ts:702`）——**这两处与宿主 record grammar 不一致，需收敛**。
- 字段全集（`config.ts:104-208`，schema `:355-380`）：
  - 认证/身份：`apiKeyEnv`（CredentialRef）、`displayName`；
  - 路由：`api`（4 协议之一，`provider.ts:48-64`）、`baseURL`、`headers`（Fetch 校验，`config.ts:419-431`）；
  - 模型：`models[]`、`modelOverrides`；`defaultContextWindow`（1_000_000）、`defaultMaxTokens`（128_000）、`defaultInput`（`[text]`）；
  - 行为：`compat`、`reasoning`、`thinkingBudgets`、`cacheRetention`、`transport`、`timeoutMs`、`websocketConnectTimeoutMs`、`streamIdleTimeoutMs`（300_000）、`retryPolicy`；
  - 图片：`maxRequestImageBytes`（20MiB）、`maxRequestImages`（50）、`imageOffloadCountQuantum`（10）、`requestImagePixelBudget`（2048²）、`requestImageMaxBytes`（1MiB）。
- **key 只能走引用**：`apiKeyEnv` 是环境变量名，解析不到就 `MISSING_CREDENTIAL`（`config.ts:534`；`<npm>/dsh-llm-pi-ai/src/index.ts:209-231`）；没有 `apiKey:` 直接字段。

### 3.2 必填项与交叉校验

- `models[]` 条目：`id` 必填（`config.ts:347-350`）；可选 `name`、`contextWindow`、`maxTokens`、`input`（`text|image`）、`reasoningEfforts`（false 或 level→wire 值）、`compat`（`config.ts:331-345`）。
- 非 catalog 路由必须同时给 `api`、`baseURL`、至少一个 model，否则 `strict` 校验直接报错（`<npm>/dsh-llm-pi-ai/src/catalog.ts:898-904,918-926`）；空 `models` 等同「沿用 catalog」（`:865-868`）。
- `modelOverrides` 不能与 `models` 同用，且只适用于 catalog 路由（`catalog.ts:873-894`）；重复 model id、空 id 被拒（`:914-916`）。
- 写入时 `assertServiceable()` 只校验「新/改」的 provider（`<npm>/dsh-llm-pi-ai/src/config.ts:387-399,441-551`），但宿主 `settings.write` 还会二次校验所有路径都是 volatile（`<npm>/dsh-settings/src/index.ts:400-410`）。
- docs 的完整手填示例：`providers.md:67-79`（最小）、`:89-113`（defaultInput / modelOverrides）、`:142-157`（reasoningEfforts）、`:163-172`（compat.thinkingFormat）、`:188-201`（compat 网关修正）。

### 3.3 客户端自定义面板当前只覆盖 5 字段

- `CUSTOM_STEPS` 六步（route id / display name / protocol / base URL / models / key，`login.ts:113-120`）；`buildCustomEntry()` 只产 `{id,name,api,baseURL,models,displayName}`（`login.ts:165-186`）；`providerProfileFor()` 产 `{apiKeyEnv}` + 上述非 catalog 字段（`login.ts:127-137`）。`headers/compat/reasoning/超时` 等只能手改 patch（`<dsh>/docs/user/guide/providers.md:53-57,182-217`）。→ 三入口自定义面板若号称「完整配置」，要么补字段，要么明确只做最小集 + 提示手改 patch。

---

## 4. 凭据落点对比（三种模式各自该存哪）

| | `<home>/.credentials.yaml`（宿主 `dsh-credentials-local`） | `profiles/<profile>/provider-keys.json`（客户端 `LocalLoginFace`） |
|---|---|---|
| 路径 | `$DSH_HOME/.credentials.yaml`（默认 `~/.dsh`；config.path 可覆盖），`<npm>/dsh-credentials-local/src/index.ts:60-61,82-94` | `join(home,'profiles',profile,'provider-keys.json')`，`local-config-faces.ts:607-610` |
| 作用域 | **跨 profile 共享**（按 DSH_HOME，不按 profile，`:88-94`） | **按 profile 隔离**（路径含 profile） |
| 内容 | v1 文档 `refs: <ENV_REF>→string` + `records: <scope/id>→{kind:'api-key'\|grant,...}`（`:166-230`；类型 `<npm>/dsh-credentials/src/types.ts:31-60`） | 扁平 JSON `ref→key`（`local-config-faces.ts:712-721`） |
| 谁读 | 宿主全链路：`llm-pi-ai` 解析 `apiKeyEnv`（`<npm>/dsh-llm-pi-ai/src/index.ts:209-231`）、`deepseek-account` 读 grant（`<npm>/dsh-deepseek-account/src/index.ts:34-36,437-470`）；客户端自己的 agent 也直接读 refs（`packages/shell/src/agent/config.ts:31-52,110`） | **只有客户端**：`credentialStatus()`/`login()`/`logout()`（`local-config-faces.ts:646-664`）；宿主 src 全仓 grep 无 `provider-keys` |
| 权限 | 0600 创建 + 启动检查 group/other 位（`<npm>/dsh-credentials-local/src/index.ts:96-145`）；跨进程写锁（`:100-112`） | 0600 tmp + rename（`local-config-faces.ts:723-735`）；无跨进程锁 |
| 脱敏 | `describe/describeRecord` 只返回 `{configured,source,writable,masked?}` / `{configured,kind,writable}`，无 value（`<npm>/dsh-credentials/src/types.ts:62-75`；`<npm>/dsh-credentials-local/src/index.ts:648-656,674-690`）；远程控制器再逐字段投影（`<npm>/dsh-api-settings-controller/src/credentials.ts:45-52,83-91`） | 注释承诺无 value 过 frame/log（`:596-601`）；没有 masked preview 概念；`credentialStatus` 返回布尔（`:646-650`） |
| 多 key/多账号 | refs 可存任意多个 ENV_REF；records 可存任意多个 `<scope>/<id>`，但 **DeepSeek account 用自己的单 key `(deepseek-account-platform/default)`，没有多账号语义**（§1.2）；`modifyRecord` 串行化读-改-写（`<npm>/dsh-credentials/src/index.ts:236-250`、local `:692-727`） | 扁平 map 可存多个 ref；无 grant/refresh/账号概念；无并发控制 |

**关键结论（现状缺陷）**：`/login` 现在做「patch 注册 `apiKeyEnv` + 把 key 写 `provider-keys.json`」（`commands.ts:450-475`、`local-config-faces.ts:653-657,666-710`），但宿主解析 `apiKeyEnv` 只看 `ctx.credentials`（即 `.credentials.yaml`）或 launch env（`<npm>/dsh-llm-pi-ai/src/index.ts:220-230`），**不读 provider-keys.json**。客户端也没有把该文件的 key 注入宿主 env（launcher/lifecycle 的 env 构造无此逻辑；`packages/shell/bin/dsh-opentui.mjs:536`、`retired HTTP lifecycle module:1115`）。因此：除用户恰好在环境导出了同名 ref，否则登录后的 provider 会 `MISSING_CREDENTIAL`。`credentialStatus()` 的「本地 store 有 key 就算 configured」（`local-config-faces.ts:646-650`）给出的是**假阳性**。

**应存位置**：
- DeepSeek account → `.credentials.yaml records`，由宿主 `deepseek-account` 自己写 grant（不是 TUI 写 key）。
- 第三方/自定义 provider 的 API key → `.credentials.yaml refs`，走 `credentials.set(ref,value)`（远程 API `<npm>/dsh-api-settings-controller/src/credentials.ts:100-119`）；OAuth grant 走 `ctx.authorization` → `credentials.modifyRecord`。
- `provider-keys.json` 只能继续当「客户端本地缓存/离线占位」，不能作为宿主可见的凭据源；若要保留，必须新增「写 `.credentials.yaml` 或注入宿主 env」的桥，否则与 06 阶段 1d「`/login` 只写 provider-keys.json」的验收口径（`06:630`）冲突。

---

## 5. 设置面可写性：`providers` 能否经 `settings.mutate` 写入

### 5.1 Host 侧：技术上可以

- `llm-pi-ai.providers` 整块 volatile（`<npm>/dsh-llm-pi-ai/src/config.ts:383-385`）；
- `dsh-settings.mutate(ns, ops, expectedRevision)` 允许 volatile 路径：`volatileForm` + `isVolatilePath` 校验（`<npm>/dsh-settings/src/index.ts:368-375,383-390`），通过 `configEditor.edit()` 把整份 config 写回 patch 行（`:391-422`）；`ns` 必须是可配置 plugin entry（`:383-385`，inproc patch 里 `id: llm-pi-ai` 存在，`provision-inproc-profile.mjs:194-195`）；
- bridge 已接线 `settings.describe/mutate`（`packages/bridge/src/index.ts:667-671`），seam 的 `SeamSettingsOp` 支持任意 `path: string[]`（`seams/session.ts:680-682`），所以 `['providers','<id>',...]` 形态结构可行。
- **但**宿主控制器 `dsh-api-settings-controller` 只在 `dsh-web-app` 声明（`<npm>/dsh-web-app/cordis.patch.yml:146-147`），inproc 组合没有（§0）。于是 `settings.describe` 失败 → seam 标 `local-file`（`bridge-session-seam.ts:1442-1455`）→ `mutate` 直接拒绝（`1461-1476`）；客户端文件头也写明这一点（`local-config-faces.ts:5-17`）。**结论：Host 能力存在，但当前 inproc 不可用；要走这条路必须把 controller 加进 inproc 组合（新依赖，非纯客户端改动）。**

### 5.2 客户端白名单：必须同时改两处

- `packages/shell/src/client/bridge-settings-route.ts:24-31`：`SETTINGS_NS_VALUE_FIELDS` 仅 `subagent / permission / session-log-deepseek`，共 5 字段；非白名单 ns 的 `value` 被丢弃只留 `ns+revision`（`:44-54`）。
- `packages/shell/src/client/local-config-faces.ts:49-66`：`SETTINGS_NAMESPACES` / `NS_VALUE_FIELDS` 同样 3 ns/5 字段（注释明确两表必须同步：`bridge-settings-route.ts:24-25`）。`mutate` 只接受白名单 ns + 首段（`local-config-faces.ts:23-24`）。
- 需要新增 `llm-pi-ai: ['providers']` 到两表；但注意 `providers` 是嵌套 dict，现有 `projectRow()` 逐字段 `{type: typeof value}` 重建 schema（`bridge-settings-route.ts:55-65`）、`LocalSettingsStore` 的行级标量编辑（`local-config-faces.ts:95-140` 一带）不适配对象值；`settings` 面板是否允许展示/编辑这个大对象，需要单独设计（不要直接把 patch 文本塞进字段）。
- 06 设计明确写「宿主可写 providers，但本产品没有可达写面（seam 白名单外）」（`06:328`）和「seam 白名单 3 ns/5 字段」（`06:68`）——这两句都会因本需求失效，须回写设计。

---

## 6. 客户端 UI 面：现状与「三入口 → 子面板」改动清单

### 6.1 现状（一条命令、两个分支、无 account 入口）

- 命令注册 `packages/tui-base/src/routes/session/commands.ts:958-995`：bare `/login` → `resolveLoginCatalog()` 取目录 → `pickOne(LOGIN_PICKER_TITLE, [CUSTOM_ENTRY, ...entries])`（`:982-985`）；选中 catalog → `commitCatalogLogin()`（`:576-584`，只问一个 masked key）；选中 custom → `runCustomLoginChain()` 六步（`:592-635`）。`/login <id>` 直接定位 catalog entry（`:970-978`）。
- commit 是双写：`registerRoute(entry.id, providerProfileFor(entry))` → `face.login(deriveKeyRef(id), key)`（`commands.ts:450-475`）；seam 实现全部本地文件（`bridge-session-seam.ts:1580-1586` → `local-config-faces.ts:603-736`）。
- 纯数据/表单：`packages/tui-base/src/routes/session/login.ts:24-64`（静态目录 + custom 行）、`:77-107`（真实目录投影）、`:109-186`（标题/步骤/校验/profile 构造）。
- seam 契约：`packages/tui-base/src/seams/session.ts:680-682`（ops）、`:712-733`（`SeamLoginRoute`）、`:735-746`（`SeamAccountState`）、`:899-906`（providerDirectory）、`:1131-1142`（account face）。
- account 已有独立命令 `/account`（`commands.ts:1836-1867`），与 `/login`「严格分离」（注释 `:1831-1835`）；D8 需求要求把它收进 `/login` 的入口。
- 文案：`packages/i18n/locales/en.json`、`zh-CN.json`（`command.login.*` / `command.account.*`）。测试：`packages/tui-base/test/login.test.ts`、`packages/shell/test/s5-local-faces.test.ts:216-240,351`、`packages/shell/test/bridge-session-seam.test.ts:3243`、`packages/shell/test/remote-model-settings.test.ts:345-363`。

### 6.2 要动的文件（按「三入口」拆法）

| 文件 | 改动 |
|---|---|
| `packages/tui-base/src/routes/session/commands.ts` | `/login` 顶层先出三入口（account / 第三方 / 自定义）；把现有 catalog picker 移到「第三方」子面板，六步链移到「自定义」子面板；account 子面板复用/内联 `/account` 的状态机（`getState/startSignIn/cancelSignIn/signOut`，`:1836-1867`）；`commitLoginRoute()` 的双写视 §4/§5 决议替换 |
| `packages/tui-base/src/routes/session/login.ts` | 新增三入口枚举与投影；`PROVIDER_CATALOG`/`catalogEntriesFromDirectory` 保留给第三方子面板；`CUSTOM_STEPS` 扩字段或标注最小集 |
| `packages/tui-base/src/seams/session.ts` | 若 account 状态要显示 authorize URL/attempt 细节，需扩 `SeamAccountState`（当前刻意只有 4 个字段，`:735-746`）；`SeamLoginFace`（`:1113` 一带）可能加 mode 参数 |
| `packages/shell/src/client/bridge-session-seam.ts` | `login` face（`:1580-1586`）与 `account` face（`:1597-1612`）已分离存在；若凭据改走 Host，需加/切 `credentials.describe/set` 调用（bridge 已接 `packages/bridge/src/index.ts:1304-1324`）；`providerDirectory`（`:1505-1514`）已可用 |
| `packages/shell/src/client/local-config-faces.ts` | `LocalLoginFace`（`:603-736`）按决议：退役 `registerRoute`（P0-6）、`login/logout` 改宿主凭据或继续本地；`provider-keys.json` 是否保留需拍板 |
| `packages/shell/src/client/bridge-settings-route.ts` | 若走 `settings.mutate` 写 providers，扩白名单（§5.2） |
| `packages/bridge/src/index.ts` | 若走宿主 authorization OAuth/device-code 或要暴露 `llm-pi-ai` 的凭据 record，需新增 Host 能力帧（现只有 `account.*` + `credentials.{describe,set,unset}` + `settings.*`，`:630-672`） |
| `packages/i18n/locales/{en,zh-CN}.json` | 三入口标题、子面板提示、account 状态/错误文案 |
| 测试 | `login.test.ts`、`s5-local-faces.test.ts`、`bridge-session-seam.test.ts`、`remote-model-settings.test.ts` 及 06 的 `no-client-patch-writers` 门禁 |

---

## 7. 与现有决议的冲突（逐条）

1. **P0-5(b) providers 子键三方合并是新需求的前置，不是可选项。**
   - D8 已把 P0-5 选 (b) 升级为「必须」（`tickets/2026-11-24-inproc-D8-login-modes.md:13-15`；oldfox `review-oldfox-2.md:15`）。
   - 现状：客户端 `registerRoute` 直接行级改托管 `llm-pi-ai.providers`（`local-config-faces.ts:666-710`），patch 应用是整块 `target[key]=value`（`<npm>/cordis-plugin-include/src/patch.ts:102-104`，06:26 引），`llm-pi-ai` 在 06 被定为「模板权威、禁止迁移」（`06:328`、R11 `06:26`）。没有子键合并 ⇒ 自定义 provider 路由下轮 provision 被覆盖（06:356,583）。**冲突解法**：在 converge 内对 `providers` 走 dict 子键三方合并（模板 id 权威、用户新增保留），并同步 06 的 §5.3/R11 措辞。
2. **P0-6「退役三个客户端写手」与 D8「保留新增 provider 能力」直接对撞。**
   - 06 要求退役 `LocalLoginFace.registerRoute`（`06:353-357`、阶段 1d `06:630`），验收口径是「`/login` 只写 provider-keys.json」；D8 明确「不能简单退役，要改造成写用户段或走宿主 settings/credentials 通道」（D8:15）。
   - 又因 §4 证明 `provider-keys.json` 宿主不可读，「只写 provider-keys.json」这个验收口径本身不成立。需把 06 的 1d 验收改为「`/login` 不再写托管 patch；key 经 Host credentials 通道落 `.credentials.yaml`；providers 子键由 P0-5(b) 合并保留」，并给 `registerRoute` 一个明确去向（退役或迁移到用户段/Host 通道）。
3. **account 入口与 P0-4「退出路径去 HTTP 化」方向冲突。**
   - DeepSeek account 的 OAuth 回调必须注册在 `webServer`（`<npm>/dsh-deepseek-account/src/index.ts:684-719`），而 02 决议 P0-4 要去掉 HTTP 宿主生命周期（`research/2026-11-24-inproc-only/02-http-host-residual.md:18`）。若「account 入口可用」是硬需求，需要非 HTTP 的回调/授权桥（新设计），或明确 account 入口在 inproc 只显示「不可用」+ 引导去 Web UI。
4. **06 的事实陈述需回写**：`06:328`「本产品没有可达写面（seam 白名单外）」与 §5 的白名单扩展方案冲突；`06:68` 的「3 ns/5 字段」将变成 4 ns/6 字段（或更多）。
5. **路由 id 语法不统一**：宿主 record key 要求小写连字符（`<npm>/dsh-credentials/src/index.ts:19-22`），客户端允许大写/下划线/点（`login.ts:147`、`local-config-faces.ts:702`）。若自定义 provider 走 OAuth/凭据 record，宽 id 会在宿主 `modifyRecord` 抛 `UNSTORABLE_PROVIDER_ID`（`<npm>/dsh-llm-pi-ai/src/auth.ts:163-170`）。三入口表单需统一收窄或明确「只能用 apiKeyEnv」。

---

## 8. 未知项（需实机或拍板）

1. **实机确认（本次只读未跑）**：inproc 宿主里 `/account signin` 是否确实因 `webServer` 缺失而失败；`settings.describe` / `credentials.describe` 帧是否确实是 `NOT_WIRED`（S2/S5 的静态结论来自组件声明与 `local-config-faces.ts:5-17`，未在本次运行时验证）。
2. **回调形态**：若不引入 webServer，`callbackOrigin` 能否由 bridge 自己开一个最小 loopback（与 P0-4 的关系），或是否有宿主内嵌授权页可绕过浏览器回调；上游代码没有现成方案。
3. **多账号语义**：宿主 API 层确认无多账号（§1.2）；产品是否要「多 DeepSeek 账号切换」需要新做账号服务，工作量未估。
4. **第三方 OAuth 的远程化**：`dsh-authorization` 无 `@Remote`，若 TUI 要点「使用 GitHub Copilot 登录」需新增哪些 Host 能力帧、提示/secret 输入如何过 seam，未设计。
5. **`providers` 大对象在 `/settings` 面板的呈现**：白名单扩了之后，`projectRow()` 的对象 schema 构造（`bridge-settings-route.ts:55-65`）是否需要专门的表单，还是 `/login` 独占写入（推荐后者）。
6. **`provider-keys.json` 存废**：保留则需定义与 `.credentials.yaml` 的同步/优先级；删除则 D8/06 的验收口径与新面板一起改。
7. **i18n 文案与命令索引**：现有命令测试用索引定位（`commands.ts:1831-1832,1875-1876` 注释），三入口若新增命令需评估测试迁移；`/login` 内部拆面板不改命令数量则无此风险。
