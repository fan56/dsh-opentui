# 子票：`/login` 三入口（DeepSeek account / 第三方 provider / 自定义 provider）

- 类型：grilling（需求已给，细节待上游能力调研）
- 来源：oldfox 二轮 P0-5 追问后用户扩需求（2026-11-24）
- 关联：[oldfox 二轮](2026-11-24-inproc-only-review-oldfox-2.md)、D1、D8 调研 `research/2026-11-24-inproc-only/08-login-modes.md`

## 需求（用户原话）

> `/login` 应该支持 1）DeepSeek account 2）第三方 provider 3）自定义 provider，然后进入不同的场景面板登录、配置。

## 由此确定的约束

1. **`/login` 不能只做「从模板已有 provider 里选」**，必须保留「新增 provider」能力。
2. **P0-5 选 (b)**：`llm-pi-ai.providers` 按子键三方合并——模板 provider 权威，用户新增的保留。这条从「可选」升级为「必须」。
3. **P0-6 的第 2 个写手（`LocalLoginFace.registerRoute`）不能简单退役**；要改造成写新 profile 的用户段（或改走宿主 settings/credentials 通道）。
4. 三个入口各自的凭据落点必须分清：DeepSeek account 与第三方/自定义 provider 的 key 存储位置可能不同（宿主 `.credentials.yaml` vs 客户端 `provider-keys.json`）。

## 待上游调研回答（08-login-modes.md）

- 上游是否存在真正的「DeepSeek account 登录」（device code / OAuth / 账号服务），还是只有 API key；
- 是否有可枚举的已知 provider 目录（供第三方入口列举）；
- 宿主 `llm-pi-ai.providers` 的完整 schema（provider id 规则、baseUrl、apiKeyEnv、models 格式、headers）；
- 三种模式的 key 各自该落哪（host credentialsController vs 客户端 provider-keys）；
- `providers` 能否经宿主 `settings.mutate` 写入，需要扩哪个白名单；
- 现有 `/login` 面板代码面，拆成「三入口 → 子面板」要动哪些文件。

## 面板交互（待拍板）

- 入口形态：命令后先出一个三项选择（account / 第三方 / 自定义），选后进各自面板；
- 第三方入口：列表（来自 provider 目录）→ 填 key → 校验；
- 自定义入口：provider id + baseUrl + key（或 apiKeyEnv）+ 模型列表；
- account 入口：取决于上游是否真有账号流。

## 决议

### 已确定（不依赖用户）

1. P0-5 必须选 (b)：`llm-pi-ai.providers` 子键三方合并，否则自定义路由下轮被模板覆盖。
2. 三个入口的 UI 是最后一步；真正的前置是「Host 凭据/授权通道是否进 inproc」。

### 已拍板（2026-11-24）

**Q1 OAuth 载体 → 走浏览器登录（选 A 的实现路径）**
用户原话「打开浏览器呀」。据此定为：**在 inproc profile 挂官方 `dsh-host-webserver`，仅绑定 127.0.0.1 + 临时端口，不提供服务面**，只为 OAuth 回调；不要自建授权桥（B）、也不要延后（C）。
- 这构成「不开端口」取向的**唯一例外**，必须在发布说明与 profile patch 注释里写明：该 server 只注册 `GET /oauth/callback`，不提供 REST/会话面。
- 已核实可行：`dsh-host-webserver` 的 Config 要求 `host` 为**具体 IP 字面量**（显式拒绝 wildcard，`dsh-host-webserver/src/index.ts:359-366`）、`port` 必填且 `z.natural().max(65535)`（可传 0，`:367`）；服务暴露 `port` getter 与 `origin`（如 `http://127.0.0.1:3080`，`:406,427-435`），绑定后从 `server.address().port` 取真实端口（`:624`）。→ 「127.0.0.1 + 临时端口」方案成立。

**Q2 API key 落点 → `~/.dsh/.credentials.yaml`**
走 bridge 已有的 `credentials.set` → 宿主 `credentialsController`；**弃用 `provider-keys.json`**（宿主从不读它）。

**Q3（2026-11-24 追加拍板）新增 provider 的写入通道 → 宿主 `settings.mutate`**
`LocalLoginFace.registerRoute` 退役后，`/login` 与 `/settings` 走**同一条官方通道**：inproc profile 挂 `settings-controller` 行 + 扩 `bridge-settings-route.ts` 白名单（加入 `llm-pi-ai.providers`）。不新增 bridge 专用帧，也不保留客户端文件写手。

### 由决策派生的必做项

1. **TUI 必须拿到 authorize URL 才能开浏览器**：当前 account seam 只投影 `status/attemptPhase/authorizeUrlReady/linksPresent`，**URL 值不过 seam**（`research/2026-11-24-inproc-only/08-login-modes.md` §1.3；`bridge-session-seam.ts:1597-1612`）。需要在 bridge 增加/扩展帧把 URL 暴露给客户端，或让宿主自己调系统浏览器打开。→ 设计此项时需确认是否触发 bridge 协议版本变更（v1 兼容性）。
2. **客户端 `/account signin` 现在传死 `http://localhost`**（`commands.ts:1857`），必须改为真实的 loopback origin（含端口），与 host server 实际监听端口一致。
3. **`providers` 子键合并（P0-5b）仍是硬前置**：自定义 provider 写入必须活过 provision。
4. **`registerRoute` 不退役，改造**：写入目标改为新 profile 用户段，key 改走 credentials 通道。
5. **bridge `settings` 白名单扩容**（`bridge-settings-route.ts:26-31`）：`llm-pi-ai.providers` 若要经宿主 `settings.mutate` 写，需要放进白名单并在 inproc 挂 `settings-controller`（当前未挂）。


### 备选记录（拍板时的选项，留档）

**Q1 OAuth 回调载体**

| 选项 | 内容 | 代价 |
|---|---|---|
| A（建议） | inproc profile 只挂官方 `dsh-host-webserver`（127.0.0.1 + 临时端口，不提供服务面），一套代码打通 account 与第三方 OAuth | 与「不开端口」取向有例外，需白名单说明 |
| B | bridge 新增 `authorization.*` 帧 + bun 客户端开本地回调端口，宿主不启 server | 需自己拼授权流（上游是偏石实现，等同 fork），工期最长 |
| C | 本次只做「第三方列表 + 自定义 + key 走宿主凭据」，account/第三方 OAuth 延后 | 工期最短，功能缺两块 |

**Q2 API key 落点**

| 选项 | 内容 | 代价 |
|---|---|---|
| A（建议） | 改走 bridge 已有 `credentials.set` → `~/.dsh/.credentials.yaml`（跨 profile、脱敏、宿主真读）；弃用 `provider-keys.json` | 无 |
| B | 保留 per-profile `provider-keys.json`，由 bridge 新增宿主侧读取通道 | 需新做宿主读取逻辑并维护两套 |

### 调研事实（08-login-modes.md）

- account：`dsh-deepseek-account` 浏览器 OAuth2+PKCE；`startSignIn` 强依赖 `webServer`（`<npm>/dsh-deepseek-account/src/index.ts:684-685`），inproc 无该服务 → 现必失败；grant 存 `.credentials.yaml` 的 `records`，**单账号**。
- 第三方：目录可枚举且客户端已接（`llm.listConfigurableProviders`）；pi-ai 的 OAuth/device-code 跑在 Host-local `ctx.authorization`（无 `@Remote`），TUI 够不到。
- 自定义：`providers.<id>` 必填 `api`（4 协议之一）+`baseURL`+≥1 `models[]`，**无直写 key 字段**，只有 `apiKeyEnv` 引用。
- **现存缺陷**：`provider-keys.json` 宿主从不读；`registerRoute` 写的是托管 patch 行，下轮 provision 被覆盖。→ 今天 inproc 下的「登录成功」可能是假的，列入阶段 0 真机验证。

