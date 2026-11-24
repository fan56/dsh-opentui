# 05 — 老 `opentui` profile 18 个 `@aiwayds/*` 插件与 inproc catalog 的功能对等差距

调研日期 2026-11-24；仓库 `/Users/qingguee/repo/dsh-opentui-wt-inproc-only` HEAD `153c8ce`。
全程只读：`~/.dsh` 未写入、未改源码、未 git commit、未打印任何 token/key/secret 值（provider 只看 `apiKeyEnv` 键名存在性）。

证据分类约定：`~/.dsh/profiles/opentui/cordis.patch.yml:NN` 记为「老 patch」；`packages/shell/scripts/provision-inproc-profile.mjs:NN` 记为「inproc 模板」；`packages/shell/scripts/lib/inproc-companions.mjs:NN` 记为「catalog」；插件证据写成 `@aiwayds/<name>/<file>:NN`（安装于 `~/.dsh/profiles/opentui/node_modules/`）；宿主证据写成 `@deepseek-ai/dsh-base/cordis.patch.yml:NN`（安装于 `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/`）。

---

## 0. 结论先行：要补清单概要

| # | 结论 | 证据 |
|---|---|---|
| 0.1 | 18 个插件中 **1 个默认已装**（subagent-registry）、**8 个已在 catalog 但 opt-in**、**9 个不在 catalog**、**0 个严格因 HTTP/web-app 宿主服务缺失而无法工作**。所有插件的必需宿主服务（`llm`/`settings`/`commands`/`tools`/`agents`/`subagents`/`session`/`web`/`userQuestions`/`skills`/`credentials`）都在 `dsh-base` 的 patch 里，不在 `dsh-web-app`。 | catalog:35-99；`@deepseek-ai/dsh-base/cordis.patch.yml:34,79,105-109,109,125,259,265,321,488-505,516`（`web`/`settings`/`llm`/`user-questions`/`credentials-local`/`permission`/`tools`/`tool-web` 全在 base） |
| 0.2 | **真正需要补进 catalog 的只有 3 个**：`dsh-topics-memory`、`dsh-cron`、`dsh-workflow`。它们是老 provisioner `recommended` 默认层的成员，但被 inproc catalog 漏掉。 | `packages/shell/scripts/lib/provision-plan.mjs:79-95`（recommended 5 项）；catalog:35-99（只列了 9 项，无这 3 个） |
| 0.3 | 另外 6 个不在 catalog 的（dcp / feishu / web-search-tavily / llm-proxy / profile-switch / agent-dispatch）**都是老 provisioner 显式 `EXCLUDED_PLUGINS`**，本机是人工塞进 18 bundles 的；默认建议**不补**。 | `provision-plan.mjs:106-115`；老 patch 对应的 `~/.dsh/profiles/opentui/package.json:9-26` |
| 0.4 | feishu 是唯一的「实际 (d)」：不是因为服务缺失，而是 **(i) 私有包不在 npm**（catalog 的 `npm view dist-tags` + `dsh plugin add` 机制无法安装）、**(ii) 抢占 `userQuestions` ask 槽且无回退**（inproc 的 ask/审批由 bridge 拥有）、**(iii) 富功能依赖 web-app 的 `agentPresets`/`workspaceRegistry`（可降级但不完整）**。 | `@aiwayds/dsh-feishu/cordis.patch.yml:11-12`；`@aiwayds/dsh-feishu/lib/binder.js:276-282`、`@aiwayds/dsh-feishu/lib/bot.js:1091,1120`；`@deepseek-ai/dsh-web-app/cordis.patch.yml:617-618`；catalog:48（ask 由 bridge 拥有）；`provision-plan.mjs:109` |
| 0.5 | patch 配置层面，**inproc 模板已经覆盖老 patch 的绝大多数行**；实质缺口是 **4 个模型 ID**（`glm-5.4`/`mimo-v2.6-pro-ultraspeed`/`hy4-flash-free`/`qwen4-max`）和 **APPEND_SYSTEM preset**（inproc 从未真正生效，属新增能力而非回归）。`web.searchProvider: anysearch` 不需要补模板行——anysearch companion 自带该 patch。 | 老 patch:59,99,185,286；inproc 模板:193-483；`@aiwayds/dsh-web-search-anysearch/cordis.patch.yml:21-22`；`tickets/2026-11-18-m3-append-inventory.md:14-22,59` |

一句话结论：**删掉老 profile 前，最低限度把 `topics-memory`/`cron`/`workflow` 加进 catalog；其余 15 个要么已在 catalog、要么被老 provisioner 明确排除。不需要为 inproc 引入 `dsh-web-app`。**

---

## 1. 18 插件逐项对账矩阵

分类定义（按任务要求）：
- (a) 已在 catalog 且默认装；
- (b) 在 catalog 但 opt-in（`defaultOn:false`）；
- (c) 不在 catalog，需要新增条目；
- (d) 与 HTTP/web-app 强绑定，inproc 下无法工作。

> 实测修正：严格的 (d)（宿主服务仅存在于 `dsh-web-app`）**为 0 个**。下表把 feishu 标为 `(c)→实际(d)`，原因是安装机制 + ask 槽冲突，而非服务缺失；判断依据逐条给出。

| # | 插件 | 老 pin | 分类 | 宿主服务依赖（含 inproc 是否具备） | web-app 专属依赖 / 降级面 | 证据 |
|---|---|---|---|---|---|---|
| 1 | dsh-subagent-registry | 0.21.0 | **(a)** catalog 唯一默认装 | host `inject=['tools','subagents','agents','skills','systemPrompt']` 全在 base；client 半 `platform:web` + `inject=['slots','layout','connection','remote','remote.session']` 在 inproc 不激活，但 host 半自带 cordis.patch 挂载 | client RPC（`ctx.inject?.(['connection','webServer'])`）在 inproc 不注册；不影响 `use_agent`/`ask_agent` 工具 | catalog:36-42；`@aiwayds/dsh-subagent-registry/package.json`（dsh.client）；`@aiwayds/dsh-subagent-registry/lib/index.js:143,263`；inproc 模板:614-621 |
| 2 | dsh-ask-router | 0.7.0 | **(b)** opt-in | `inject=['userQuestions']`（base 有）；`ctx.get('askSurfaces')` 由自身提供 | inproc 的 ask 由 bridge `ask.request` 帧拥有，catalog 判「无 inproc 行消费、会重复占槽」；opt-in 需先解决 ask 槽仲裁 | catalog:43-49；`@aiwayds/dsh-ask-router/lib/index.js:24,106`；`@aiwayds/dsh-ask-router/cordis.patch.yml:3-6` |
| 3 | dsh-llm-net-retry | 0.8.0 | **(b)** opt-in | `inject=['agents']`（base 有） | 无 web 依赖；但 base 已挂 `llm-retry`（`dsh-llm-retry`），第二层无消费者 | catalog:57-63；`@aiwayds/dsh-llm-net-retry/lib/index.js`（inject）；`@deepseek-ai/dsh-base/cordis.patch.yml:99-100` |
| 4 | dsh-web-search-anysearch | 0.9.0 | **(b)** opt-in | host `inject=['web']` + `ctx.get('credentials')`（**两者都在 base**）；`@deepseek-ai/dsh-web` 是搜索/抓取 HTTP 服务，不是 web UI | client 半 `inject=['slots','locale','remote','remote.credentials']` 在 inproc 不激活 → 设置面板/凭据写入 UI 缺失；但 patch 自带 `web.searchProvider: anysearch`，零配置匿名可用 | catalog:85-91；`@aiwayds/dsh-web-search-anysearch/lib/index.js:21,77`；`@aiwayds/dsh-web-search-anysearch/lib/client.js:437`；`@aiwayds/dsh-web-search-anysearch/cordis.patch.yml:8-22`；`@deepseek-ai/dsh-base/cordis.patch.yml:488` |
| 5 | dsh-mcp-adapter | 0.8.1 | **(b)** opt-in | `inject=['tools']`（base 有）；`/mcp` 用可选 `ctx.inject(['commands'])`（base 有） | 无 web 依赖；inproc patch 已有 `mcp-context7` client 行，但无消费者消费 `mcp_list`/`mcp_call` 元工具 | catalog:78-84；`@aiwayds/dsh-mcp-adapter/lib/index.js:89,2243-2254`；inproc 模板:582-589 |
| 6 | dsh-approval-policy | 0.3.0 | **(b)** opt-in | 无静态 inject；订阅 `approval/request` waterfall（base 的 `approval`=`dsh-user-approval` 在 `:259`） | 无 web 依赖；inproc 已有 bridge `/approval-gate` + `dsh-permission-presets`，catalog 判无消费者 | catalog:50-56；`@aiwayds/dsh-approval-policy/cordis.patch.yml:3-9`；`@deepseek-ai/dsh-base/cordis.patch.yml:259-266`；inproc 模板:545-580 |
| 7 | dsh-model-sync | 0.9.0 | **(b)** opt-in | `inject=['settings']`；`ctx.get('piAiCatalog')`（来自 base 的 `dsh-llm-pi-ai`）、`ctx.get('launchEnvironment')`（宿主 app-boot 常驻，base 的 `dsh-llm-pi-ai`/`dsh-credentials-local` 也用它）、`ctx.get('llm')`/`credentials` 均在 base | 无 web-app 专属服务；inproc 模板自己 pin 了 provider 模型表，catalog 判「无同步消费者」 | catalog:64-70；`@aiwayds/dsh-model-sync/lib/index.js:30,119,184,370`；`@deepseek-ai/dsh-base/cordis.patch.yml:125-135`；inproc 模板:193-483 |
| 8 | dsh-llm-stats | 0.9.0 | **(b)** opt-in | `inject=['commands']`（base 有）；订阅 `session/event`（base 有） | 无 web 依赖；inproc client 路径无 `/usage` 消费者 | catalog:71-77；`@aiwayds/dsh-llm-stats/cordis.patch.yml:3-7`；`@aiwayds/dsh-llm-stats/lib/index.js` |
| 9 | dsh-vault | 0.8.2 | **(b)** opt-in | `inject=['settings','skills']`（base 有） | 无 web 依赖；「secret storage; no consumer in the minimal inproc set」 | catalog:92-98；`@aiwayds/dsh-vault/lib/index.js` |
| 10 | dsh-topics-memory | 0.26.0 | **(c) 需补 catalog** | `inject=['systemPrompt','tools','settings','agents','llm','skills']` **全部在 base** | 无 web-app 专属服务；可直接按 catalog 机制安装 | `provision-plan.mjs:79-82`（recommended）；`@aiwayds/dsh-topics-memory/lib/index.js:66`；`@aiwayds/dsh-topics-memory/cordis.patch.yml:7-8` |
| 11 | dsh-cron | 0.7.1 | **(c) 需补 catalog** | `inject=['settings','agents','tools','skills']` 全在 base；可选 `ctx.inject(['sessionController'])`（**inproc 已有真实 controller + shim**）、`['sessionQuery']`（base）、`['workspace']`（web-app 专属，仅可选增强）、`['commands']`（base） | `workspace` 缺失时只影响工作区相关增强，插件主体可加载 | `provision-plan.mjs:84-88`；`@aiwayds/dsh-cron/lib/index.js:33,194-197,241,284`；inproc 模板:623-634 |
| 12 | dsh-workflow | 0.2.3（本机 `link:` 到 `/Users/qingguee/repo/dsh-workflow`） | **(c) 需补 catalog** | `inject=['commands','subagents','agents','tools','systemPrompt','jobs','skills']` 全在 base | 无 web 依赖；但本机是本地 link 安装，catalog 的 `npm view dist-tags` + `@latest` 路径未验证（推测 npm 上有发布版） | `provision-plan.mjs:90-94`；`@aiwayds/dsh-workflow/lib/index.js:30`；老 profile `package.json:50`；catalog:199-213 |
| 13 | dsh-dcp | 0.14.2 | **(c) 不建议补** | `static inject=['llm','tokenMeter','sessions','sessionProjections','commands','skills']` 全在 base；功能上可工作 | 老 provisioner 的排除理由就是「web-app-preset isolated; an idle no-op in this profile」——在老 profile 里本就是空转，inproc 无更高价值 | `provision-plan.mjs:108`；`@aiwayds/dsh-dcp/lib/index.js:112`；`@aiwayds/dsh-dcp/cordis.patch.yml:3-14` |
| 14 | dsh-web-search-tavily | 0.7.0 | **(c) 不建议补（有替代）** | `inject=['web']` + `ctx.get('credentials')`（都在 base），host 侧可工作 | **需要 Tavily API key**；无 client 半 → inproc 无 UI 写凭据，只能靠 `dsh-credentials` 文件/env 预置；老 provisioner 排除理由即「requires an API key」；anysearch 已覆盖搜索需求 | `provision-plan.mjs:113`；`@aiwayds/dsh-web-search-tavily/lib/index.js`；`@aiwayds/dsh-web-search-tavily/README.md:21`；`@aiwayds/dsh-web-search-tavily/cordis.patch.yml:3-7` |
| 15 | dsh-llm-proxy | 0.8.1 | **(c) 不建议补** | `inject=['skills']`（base 有）；on start 替换进程级 undici dispatcher | 无 web 依赖，但老 provisioner 判「not part of the shell workflow」；与 inproc 网络面无消费者 | `provision-plan.mjs:112`；`@aiwayds/dsh-llm-proxy/lib/index.js`；`@aiwayds/dsh-llm-proxy/cordis.patch.yml:3-6` |
| 16 | dsh-profile-switch | 0.4.1 | **(c) 不建议补** | `inject=['commands','userQuestions']`（base 有）；可选的 `ctx.get('dshTuiModelSelection')`（来自 `dsh-tui-pi`，inproc 无）、`ctx.get('sessionController')`（inproc 有 shim）、`agentDefaultModel`（base） | 两者皆无时回退到 `.dsh-profile` 文件 pin（README 明说）；但「切 profile」本就由 launcher 负责，老 provisioner 已排除 | `provision-plan.mjs:114`；`@aiwayds/dsh-profile-switch/lib/commands.js:13-17,55-56,104,131`；`@aiwayds/dsh-profile-switch/README.md:115-127` |
| 17 | dsh-agent-dispatch | 0.3.1 | **(c) 不建议补** | `ctx.get('tools')`/`ctx.get('subagents')`（base 有）；依赖 `dsh-subagent-registry` 的 `use_agent` 可见性（默认 companion 已装）；需 Jev key，默认 `mode:off` | 无 web 依赖；但 inproc 的 `dsh-jev-core` 是 0.1.5（registry 依赖），agent-dispatch 需要 `^0.2.0`（老 profile 是 0.2.0）→ 版本冲突需处理；老 provisioner 判「not part of the shell workflow」 | `provision-plan.mjs:110`；`@aiwayds/dsh-agent-dispatch/lib/index.js:176-177,284`；`@aiwayds/dsh-agent-dispatch/cordis.patch.yml:8-9`；本机 inproc `dsh-jev-core@0.1.5` vs 老 profile `0.2.0` |
| 18 | dsh-feishu | 0.18.0 | **(c)→实际(d)** | 必需 host 服务（`commands`/`llm`/`skills`/`credentials`/`userQuestions`/`sessions`/`sessionQuery`/`sessionPersistence`/`attachments`/`permissionPresets`/`agentDefaultModel`）**都在 base**；可选的 `agentPresets`（仅 web-app）和 `workspaceRegistry`（inproc 有 shim）都用 `try/catch` 或 `?.` 降级 | **三个硬障碍**：①「private plugin, not on npm」→ catalog 的 npm 机制装不了；②`inject=['userQuestions']` 抢占 ask 槽且「does not fall back」，与 bridge 拥有的 ask/审批面冲突；③`agentPresets` 仅 web-app，Feishu 端预设选择不完整 | `@aiwayds/dsh-feishu/cordis.patch.yml:8-12`；`@aiwayds/dsh-feishu/lib/binder.js:276-282`；`@aiwayds/dsh-feishu/lib/bot.js:1091,1120`；`@deepseek-ai/dsh-web-app/cordis.patch.yml:617-618`；catalog:48；`provision-plan.mjs:109`；inproc 模板:623-634 |

矩阵统计：(a)=1、(b)=8、(c)=8（其中 3 建议补 / 5 不建议补）、(c)→实际(d)=1。

补充证据：
- catalog 9 项的 `defaultOn` 与 `reason` 全文见 `catalog:35-99`；`selectCompanions()` 的 `none`/`all`/命名选择见 `catalog:116-124`。
- 本机 inproc profile `package.json` 的 bundles 只有 `[@deepseek-ai/dsh-base, @aiwayds/dsh-opentui-bridge, @aiwayds/dsh-subagent-registry]`，`dependencies` 只有 `dsh-subagent-registry@0.21.0`（`~/.dsh/profiles/opentui-inproc/package.json`），与 catalog 默认集一致。
- 老 profile 的 18 bundles 见 `~/.dsh/profiles/opentui/package.json:9-26`；其中 `dsh-jev-core` 与 `dsh-self-improve` 只是 dependencies（`:37,44`），不是 bundle，不在本次 18 项内。

---

## 2. 老 patch 配置项对账（除插件安装外）

对照源：老 patch（550 行）`~/.dsh/profiles/opentui/cordis.patch.yml` vs inproc 模板（193-647 行）`provision-inproc-profile.mjs`。「等价」指 inproc 模板中存在同一 id 的 row（配置值可有意不同）。

| 老 patch 项 | 老位置 | inproc 模板对应 | 等价? | 说明 |
|---|---|---|---|---|
| `llm-pi-ai` 3 provider 路由（zai-coding-cn / xiaomi-token-plan-cn / opencode-go）+ 模型表 | :2-297 | :193-483 | **部分等价** | 3 provider 与 `apiKeyEnv` 键名（`ZAI_CODING_CN_API_KEY`、`OPENCODE_GO_API_KEY`）完全一致（老 :7,104 / 新 :199,288；xiaomi 两者都不设 key）。模型表有 4 项漂移，见下。 |
| `tool-bash` / `tool-todo`（allowParallelInProgress） | :306-316 | :492-502 | 等价 | 逐字一致 |
| `tool-fs`（applyPatch:false）/ `tool-fs-search`（sampleOverCapGlobResults:false）/ `agent-instructions`（maxBytes:65536）/ `tool-result-pruner`（8192/4096/1024） | :321-342 | :507-528 | 等价 | 逐字一致 |
| `insert tool-ask-user` | :346-348 | :532-534 | 等价 | 同为 insert 行；inproc 无 dsh-tui-pi bundle，理由注释一致 |
| `tool-web`（fetch:true, searchTimeoutMs:60000） | :353-358 | :539-544 | 等价 | 逐字一致 |
| `web`（searchProvider: anysearch） | :362-364 | **无** | **由 companion 覆盖** | inproc 模板 0 命中（`grep searchProvider` 为 0）。但 anysearch companion 自带同一行（`@aiwayds/dsh-web-search-anysearch/cordis.patch.yml:21-22`），opt-in 即生效；不装时 base 的 `deepseek-search-api` 默认可用。见 `tickets/2026-11-18-inproc-profile-inventory.md:160`（「保留才可能断」）。 |
| `permission`（3 presets + defaultPreset） | :365-378 | :545-560 | **有意不同** | 老 `defaultPreset: danger-full-access`（:378）；inproc 默认 `workspace-write`（T9/ADR-0011），`DSH_OPENTUI_APPROVAL_GATE=off` 才回退到 danger-full-access（:560）。presets 三项定义相同。 |
| bridge approval-gate insert | 无 | :570-580 | inproc 新增 | write 类工具默认 `ask`，属安全硬化 |
| `insert mcp-context7`（streamable-http / https://mcp.context7.com/mcp） | :381-387 | :582-589 | 等价 | 逐字一致 |
| `ui-settings-general`（welcomeNoticeVersion: 2026-09-28.1） | :388-391 | **无** | **已按设计删除** | web 客户端专用行；老 inproc inventory 报 `entry not found`（`tickets/2026-11-18-inproc-profile-inventory.md:34,158`）。headless bridge 无该 client 服务。 |
| `agent-default-model`（opencode-go / deepseek-v4.1-flash / high） | :392-397 | :590-595 | 等价 | 逐字一致 |
| `insert preset-opentui-append-system`（完整 agent preset + APPEND_SYSTEM.md persona suffix + plan/compaction/delegation 组） | :401-546 | **无** | **缺口（非回归）** | inproc 模板 0 命中（`preset-opentui-append-system`/`APPEND_SYSTEM`/`dsh-agent-preset` 均 0）。老 inventory 实测该行在 inproc 运行时 `pending (waiting for service: agentPresets)`，从未激活（`tickets/2026-11-18-inproc-profile-inventory.md:79,101,158`）；`c8f891b` 把从未生效的声明从生成模板删掉（`tickets/2026-11-18-m3-append-inventory.md:14-22,59`）。bridge 尚无 section 注入通道，M3 未落地（同文件 :16-20）。 |
| `subagent`（maxActiveSubagents:3） | :547-550 | :608-612 | 等价 + 加固 | inproc 额外 `maxDepth:1`（R2-3  delegation 深度封顶） |
| session shim + session-controller insert | 无 | :623-634 | inproc 新增 | 替代 dsh-web-app 提供 sessionController（fileUploads/workspaceRegistry 由本地 shim 满足） |
| session-log-deepseek（enabled:true） | 无 | :643-646 | inproc 新增 | 宿主可写 volatile 字段的稳定合并位 |

### 模型表漂移（老 patch 有、inproc 模板无）

| provider | 老 patch 有、模板无 | 模板有、老 patch 无 | 证据 |
|---|---|---|---|
| zai-coding-cn | `glm-5.4` | — | 老 :59-61；模板无 |
| xiaomi-token-plan-cn | `mimo-v2.6-pro-ultraspeed` | — | 老 :99-101；模板无 |
| opencode-go | `hy4-flash-free`、`qwen4-max` | `glm-5.2` | 老 :185-190,286-291；模板 :329-333 |

用户影响：这些都是模型选择器可见项；inproc 模板是生成式权威（每次 provision 覆盖本地 patch），所以老 profile 的模型列表不会自动带过去。是否算「必须补」取决于用户是否实际使用这些模型——本次只读调研无法从 git/日志确认使用频率（标「推测」）。

---

## 3. 要补的清单（按性质分类）

### ① catalog 新增条目（建议做，最低限度）

| 插件 | 建议 short / declaredRange | 证据与理由 |
|---|---|---|
| `@aiwayds/dsh-topics-memory` | `topics-memory` / `^0.26.0` | 老 provisioner recommended 层（`provision-plan.mjs:79-82`）；必需服务全在 base（`@aiwayds/dsh-topics-memory/lib/index.js:66`）；catalog 缺失。 |
| `@aiwayds/dsh-cron` | `cron` / `^0.7.0`（老 pin 0.7.1） | recommended 层（`provision-plan.mjs:84-88`）；必需服务全在 base，sessionController 由 inproc shim 提供（`@aiwayds/dsh-cron/lib/index.js:33,194`；inproc 模板:623-634）。 |
| `@aiwayds/dsh-workflow` | `workflow` / `^0.2.3`（老 provisioner pin 0.2.1，本机 link 0.2.3） | recommended 层（`provision-plan.mjs:90-94`）；必需服务全在 base（`@aiwayds/dsh-workflow/lib/index.js:30`）。**注意**：本机是 `link:` 安装（`~/.dsh/profiles/opentui/package.json:50`），catalog 的 npm-latest 路径未验证。 |

可选（不建议默认加）：`web-search-tavily`（需 API key + 无 inproc 凭据 UI，`provision-plan.mjs:113`）；`dcp`（老 profile 里已空转，`provision-plan.mjs:108`）。
明确不加：`feishu`（私有包 + ask 槽冲突 + agentPresets）、`agent-dispatch`（jev-core 版本冲突 + 默认 off，`provision-plan.mjs:110`）、`llm-proxy`、`profile-switch`（均被老 provisioner 排除）。

### ② 默认安装策略变更（决策项，非必做）

- 老 provisioner 的默认 tier 是 `recommended` = 12 插件（`provision-plan.mjs:18,82`）；inproc 默认只有 1 个（catalog:119，`selectCompanions()` 在 env 未设时只取 `defaultOn`）。要复刻老 profile 默认行为，需把 8 个 opt-in 全部默认装，或要求用户设 `DSH_OPENTUI_COMPANIONS=all`（catalog:121-123）。
- **建议不做全默认**：catalog 的设计意图明确是「每个候选必须有一个 inproc 消费者才默认装」（catalog:9-14，各 entry 的 `reason`）。当前 8 个 opt-in 多数标注「no consumer / already covered」（catalog:48,55,62,69,76,83,90,97）。把 topics-memory/cron/workflow 补进 catalog 时也应先 `defaultOn:false`，由用户显式 opt-in。
- 证据链：catalog:116-124 的选择逻辑；inproc 模板:614-621 说明 companion mount 依赖 bundle 条目激活，不重复写 patch 行。

### ③ 需要在 inproc 里挂的服务/行（按必要性排序）

| 项 | 动作 | 证据 |
|---|---|---|
| provider 模型表 4 项漂移 | 若要与老 profile 完全一致，在 inproc 模板补 `glm-5.4`（zai-coding-cn）、`mimo-v2.6-pro-ultraspeed`（xiaomi）、`hy4-flash-free`/`qwen4-max`（opencode-go）；模板已有 `glm-5.2`，保留 | 老 patch:59,99,185,286；模板:193-483 |
| `web.searchProvider: anysearch` | **不需要补模板行**：opt-in anysearch companion 自带该 patch（`@aiwayds/dsh-web-search-anysearch/cordis.patch.yml:21-22`）；不装时 base 的 deepseek provider 默认生效 | 模板 `searchProvider` 0 命中；`tickets/2026-11-18-inproc-profile-inventory.md:160` |
| `sessionController` | 已在 inproc 模板挂载真实 controller + shim（:623-634），新增 cron/profile-switch 无需再挂 | 同左 |
| `mcp-context7` client 行 | 已在模板（:582-589）；mcp-adapter opt-in 后即可消费 | 同左 |
| tool 恢复行 / agent-default-model / subagent 上限 / permission presets | 均已在模板（:492-560,590-612）；无需动作 | 同左 |
| `ui-settings-general` | 不挂：web client 专用，inproc 报 entry not found | 老 patch:388-391；`tickets/2026-11-18-inproc-profile-inventory.md:34` |
| APPEND_SYSTEM preset | 不属于 companion：需要 bridge 的 systemPrompt.section 注入（M3）才有意义；当前 inproc 从未生效 | `tickets/2026-11-18-m3-append-inventory.md:16-22,59`；`packages/shell/scripts/lib/bridge-failfast-text.mjs:26` 的 `BRIDGE_NO_APPEND_NOTICE` |

### ④ 只能放弃的功能（说明原因）

| 功能 | 放弃原因 | 证据 |
|---|---|---|
| Feishu 远程驱动（手机派单/卡片审批/预设选择） | 私有包不在 npm（catalog 机制装不了）+ 抢占 bridge 的 ask 槽且无回退 + `agentPresets` 仅 web-app | `@aiwayds/dsh-feishu/cordis.patch.yml:8-12`；`@aiwayds/dsh-feishu/lib/binder.js:279`；catalog:48；`provision-plan.mjs:109` |
| `dsh-dcp` 动态上下文压缩 | 老 profile 里已是空转（web-app-preset isolated），删 profile 不产生新损失 | `provision-plan.mjs:108` |
| `dsh-profile-switch` 运行时切 profile | launcher 职责；inproc 的 live 选择通道（`dshTuiModelSelection` web/TUI 专属）缺失，只剩文件 pin 回退 | `provision-plan.mjs:114`；`@aiwayds/dsh-profile-switch/README.md:115-127` |
| `dsh-agent-dispatch` Jev 事前派发 | 非 shell workflow；默认 off；`dsh-jev-core` 版本冲突（inproc 0.1.5 vs 需要 ^0.2.0） | `provision-plan.mjs:110`；本机两 profile 的 `dsh-jev-core/package.json` |
| `dsh-llm-proxy` 进程级 LLM 分流 | 非 shell workflow，inproc 无消费者 | `provision-plan.mjs:112` |
| Tavily 搜索 | 需 API key 且 inproc 无凭据写入 UI；anysearch 已满足零配置搜索 | `provision-plan.mjs:113`；`@aiwayds/dsh-web-search-tavily/README.md:21` |
| web 客户端设置面（welcomeNotice 等） | `dsh-web-app`/client UI 不随 inproc 启动；属设计裁剪 | 老 patch:388-391；`tickets/2026-11-18-inproc-profile-inventory.md:34` |
| APPEND_SYSTEM.md persona 注入 | inproc 从未生效；bridge 无 section 通道（M3 未落地），不是删 profile 导致的回归 | `tickets/2026-11-18-m3-append-inventory.md:16-22,59` |

---

## 4. 未知项 / 未验证

1. **模型漂移的实际使用**：`glm-5.4`/`mimo-v2.6-pro-ultraspeed`/`hy4-flash-free`/`qwen4-max` 是否被用户真正在老 profile 里选用过——需查会话历史或日志，本次只读调研未做（推测层面：只是 catalog 演进不同步）。
2. **真实 inproc 启动验证**：`~/.dsh/profiles/opentui-inproc` 存在的 patch 是 2026-11-23 生成的（`cordis.patch.yml` mtime 11-23 12:56），但本次未启动 dsh、未抓 stderr，因此 companion 在 inproc 下的实际激活/挂起状态以代码与 inventory 证据为准，非本轮真机日志。`tickets/2026-11-18-m3-append-inventory.md:112`（Q5）同样标注本机无 inproc 运行日志。
3. **`dsh-workflow` 的 npm 可发布性**：本机用 `link:` 安装；catalog 的 `npm view dist-tags` 路径若找不到该包会回退 `@latest`（catalog:172-176,199-210），是否成功未验证。
4. **`dsh-feishu` 的私有 registry 可达性**：其 cordis.patch 明说「private plugin, not on npm」；若未来要支持 inproc，需另设计安装通道与 ask 槽仲裁，超出本次 catalog 范围。
5. **`dsh-jev-core` 双版本共存**：若强行把 agent-dispatch 加入 inproc，pnpm 能否正确嵌套 0.1.5/0.2.0 未实测。
6. **`dsh-web` 的性质**：`dsh-web` 是搜索/抓取 HTTP 后端服务，**在 dsh-base 里**（`@deepseek-ai/dsh-base/cordis.patch.yml:488`），不要与 `dsh-web-app`/web UI 混淆（`tickets/2026-11-18-inproc-profile-inventory.md:134`）。因此任何依赖 `ctx.web` 的插件都不因「无 web-app」而自动失效。
