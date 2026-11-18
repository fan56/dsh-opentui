# `opentui-inproc` profile 只读盘点（加载了什么 / 哪些用不到 / 裁掉会断什么）

日期：2026-11-18
工作区：`/Users/qingguee/repo/dsh-opentui-wt-inproc`
HEAD：`7e66b3f90eb2e308b4acf1dfc99dcbf69393d190`（`feat/inproc-bridge-20261118`）
性质：**只读调研**。未改任何源码 / profile 文件，未 commit。探测用的临时文件在 `/private/tmp/inproc-inventory-probe/`，处置见 §8。
凭据：全程未打印任何密钥值；`.credentials.yaml`、`models-store.json` 等未读取内容。

---

## 0. 结论先行

1. **bundle 列表本身很干净**：`package.json` 只声明 2 个 bundle（`@deepseek-ai/dsh-base` + `@aiwayds/dsh-opentui-bridge`），组合后 103 个插件条目；对比 web profile 205 个、`opentui` 224 个、headless 101 个。**没有 `@deepseek-ai/dsh-web-app` bundle**。
2. **"总打开 web profile" 的真相在 `cordis.patch.yml`，不在 bundle 列表**：`opentui-inproc/cordis.patch.yml`（544 行）与 web 模板 `opentui/cordis.patch.yml` **MD5 完全相同**（`54b66bf37fbbb93a6f9dd204a24473f7`）。`provision-inproc-profile.mjs` 从不生成这个文件，只写 `package.json` 和 bridge symlink。这个文件是逐字拷贝，里面带着为 web-app bundle 写的"补偿行"。
3. **拷贝带来 4 处硬差异**：`preset-opentui-append-system` 运行时 pending（依赖只存在于 web-app 的 `agentPresets` 服务）；`ui-settings-general` patch 行报 `entry not found`；`web.searchProvider: anysearch` 指向未加载的 provider；bridge 需要的 `sessionController` 未声明。详见表 1。
4. **`ctx.get('sessionController')` 运行时确实取不到**，实测 `session.list` 帧返回 `UNSUPPORTED / sessionController service unavailable`。它由 web-app bundle 挂载。
5. **`ctx.sessionPersistence.list()/stat()` 存在，但不能直接替代**：`SessionHeader` 无 `title`、无 `updatedAt`，`/resume` 列表拿不到这两列。需要另走 `sessionQuery` 投影补齐。
6. **裁剪几乎无性能收益**：profile 自身 `node_modules` 只有 1 个 symlink（0B），冷启动到 bridge ready 约 849ms，配置组合约 73ms。真正的成本在宿主 closure（339 个 `@deepseek-ai` 包），而 `dsh-base` 已占 99 个条目，其中大部分是 TUI 必须的。

---

## 1. 模板来源与声明内容

### 1.1 `provision-inproc-profile.mjs` 实际生成什么

| 步骤 | 代码位置 | 产物 |
|---|---|---|
| bundle 列表 | `packages/shell/scripts/provision-inproc-profile.mjs:77` | `BUNDLES = ['@deepseek-ai/dsh-base', '@aiwayds/dsh-opentui-bridge']` |
| 写 manifest | 同文件 `:231-240, :383-385` | `$DSH_HOME/profiles/opentui-inproc/package.json` 的 `dsh.profile.bundles` |
| 写 symlink | 同文件 `:393-403` | `node_modules/@aiwayds/dsh-opentui-bridge -> <安装>/dist/bridge`（绝对链接） |
| 校验 | 同文件 `:425-448` | 禁止 profile 内出现 `@deepseek-ai/*` 副本；bridge fingerprint 校验 |

**该脚本全文没有 `cordis.patch` 字样**（`grep -n cordis.patch packages/shell/scripts/provision-inproc-profile.mjs` 无输出）。它不生成 `cordis.patch.yml`、`cordis.yml`。

### 1.2 实际 profile 文件（scratch home）

```
/private/tmp/m2a-1794976880/home/profiles/opentui-inproc/
├── package.json        dsh.profile.bundles = [dsh-base, bridge]   (provision 生成)
├── cordis.yml          []                                         (空根，固定模板文本)
├── cordis.patch.yml    544 行，MD5 同 web/opentui                 (非 provision 生成)
└── node_modules/@aiwayds/dsh-opentui-bridge -> dist/bridge        (1 个 symlink)
```

`cordis.yml` 注释说明组合顺序：**bundle 列表 → `cordis.patch.yml` → `--patch` 覆盖层**（`opentui-inproc/cordis.yml:1-3`）。

### 1.3 `cordis.patch.yml` 完整内容归类（544 行）

| 行段 | 内容 | 性质 |
|---|---|---|
| `:1-291` | `llm-pi-ai` 配置：3 个 provider（`zai-coding-cn` / `xiaomi-token-plan-cn` / `opencode-go`）+ 约 50 个 model 条目 | TUI 必需（provider/model 注册） |
| `:300-334` | `tool-bash` / `tool-todo` / `tool-fs` / `tool-fs-search` / `agent-instructions` / `tool-result-pruner` 的 `disabled: false` 恢复 | web-app 补偿行；无 web-app 时多数为 no-op |
| `:337-342` | insert `tool-ask-user` | TUI 必需（preset 内的 ask_user 工具） |
| `:343-352` | `tool-web` 恢复（`fetch: true`） | web-app 补偿行；no-op |
| `:353-358` | `web.config.searchProvider: anysearch` | **web 模板残留**：本 profile 未加载 anysearch provider |
| `:359-372` | `permission` presets（默认 `danger-full-access`） | 覆盖 base 默认，需确认是否有意 |
| `:374-381` | insert `mcp-context7`（`@deepseek-ai/dsh-mcp-client`） | 未知/可选 |
| `:382-385` | `ui-settings-general`（`@deepseek-ai/dsh-client-ui-settings-general`） | **残留**：运行时报 `entry not found` |
| `:386-391` | `agent-default-model`（provider `opencode-go`，model `deepseek-v4.1-flash`） | TUI 必需 |
| `:393-540` | insert `preset-opentui-append-system`：完整 agent preset（persona + 工具 + plan/compaction/delegation 组） | **web 模板残留**：运行时 pending，依赖 `agentPresets` 服务 |
| `:541-544` | `subagent.maxActiveSubagents: 3` | 覆盖 base 默认 |

---

## 2. 表 ①：声明 vs 实际加载

测量方法：`DSH_HOME=/private/tmp/m2a-1794976880/home dsh --profile <p> --dump-config`（组合树，不挂载）；宿主以 `dsh --profile opentui-inproc --no-open` + `DSH_OPENTUI_BRIDGE_STDIO=1` 起 7s 抓 stderr；bridge 帧探测见 §3。

| 层 | 声明（dump-config） | 实际挂载（运行时） | 差异 |
|---|---|---|---|
| `@deepseek-ai/dsh-base` | 99 条 | 99 条激活 | 0 |
| `@aiwayds/dsh-opentui-bridge` | 1 条（`dsh-opentui-bridge`） | 1 条激活 | 0 |
| `cordis.patch.yml` 新增条目 | 3 条（`tool-ask-user` / `mcp-context7` / `preset-opentui-append-system`） | 2 条激活；`preset-opentui-append-system` **pending** | **1** |
| `cordis.patch.yml` 覆盖行 | 约 40 行 | 不产生新条目；`ui-settings-general` 报 `entry not found` | **1** |
| `sessionController` 服务 | 未声明（不在任何 bundle/patch） | 不存在；`session.list` → `UNSUPPORTED` | **1** |
| `web.searchProvider=anysearch` | 配置行存在 | anysearch provider 未加载（base 只有 `deepseek-search-api`） | **1** |
| **合计** | **103 条目** | **102 激活 + 1 pending** | **4 处硬差异** |

运行时 stderr 原文（`run-opentui-inproc.stderr`）：
```
dsh: warning: 1 entry did not activate
preset-opentui-append-system (@deepseek-ai/dsh-agent-preset): pending (waiting for service: agentPresets)
```
`--dump-config` stderr 原文：
```
dsh: [.../opentui-inproc/cordis.patch.yml] patch: entry "ui-settings-general" not found
```

对照 profile 规模（`--dump-config` 条目数）：

| profile | 条目数 | 来源分布 |
|---|---|---|
| headless | 101 | base 99 + headless 2 |
| **opentui-inproc** | **103** | base 99 + bridge 1 + patch 3 |
| web | 205 | base 99 + web-app 103 + feishu 1 + approval-policy 1 + patch 1 |
| opentui | 224 | base 99 + web-app 103 + 其他 @aiwayds 21 + patch 3 |

**差异条数：4**（另有约 40 条覆盖行在 inproc 中多数退化成 no-op，不计入硬差异）。

---

## 3. 表 ②：每项用途归类与依据

分类口径：`TUI 必需` / `仅服务端(HTTP/路由/web UI)` / `web 模板带进来的无关项` / `未知`。
"依据"列写提供服务 + 被谁 inject/依赖；服务注册信息来自宿主 0.2.2-rc.3 的 `cordis.patch.yml` 与 `lib/*.d.ts`。

| 组（条目数） | 代表条目（完整清单见本节末） | 分类 | 依据 |
|---|---|---|---|
| A 核心框架/配置/存储（19） | `plugin-manager`, `typert-gateway`, `storage`, `jobs`, `remote-access` | TUI 必需 | cordis 插件框架、Typert RPC 网关、本地存储；base patch `:16-117`。`remote-access` 为 RPC 访问控制，非 web UI |
| B LLM/provider 注册（8） | `llm`, `llm-pi-ai`, `llm-deepseek`, `agent-default-model` | TUI 必需 | `dsh-llm` 提供 `listModels/resolveModel`（`dsh-llm/lib/types/index.d.ts:181,191`）；`llm-pi-ai` 由 base patch `:135-136` 挂载，模型表在 `cordis.patch.yml:2-291` |
| C session 持久化/查询/标题（11） | `session`, `session-persistence-jsonl`, `session-query-sqlite`, `session-projection` | TUI 必需 | `ctx.sessionPersistence.list/stat`（`dsh-session-persistence/lib/types/index.d.ts:160,166`）；`sessionQuery` 提供 FTS5（`dsh-session-query/lib/types/index.d.ts:63,70`） |
| D agent/规划/子代理/工作流（28） | `agent`, `plan-mode`, `subagent`, `workflow-ptc`, `tool-todo` | TUI 必需 | base patch `:363-428`；`tool-subagent*` 供 `/delegate` 与预设 `delegation` 组使用 |
| E 工具执行/沙箱/审批（26） | `tool-bash`, `tool-fs`, `approval`, `permission`, `credentials` | TUI 必需 | `approval`=`@deepseek-ai/dsh-user-approval`（base patch `:259-262`），`permission`=`dsh-permission-presets`（`:264`）；**ask 审批就在 base，不在 web-app** |
| F 附件/MCP（2） | `attachment-local`, `mcp-resources` | TUI 必需 | base patch `:146, 84`；附件上传与 MCP 资源读取 |
| G web 搜索/抓取 HTTP 后端（5） | `web`, `web-search-deepseek`, `tool-web` | TUI 必需（HTTP 后端，非 web UI） | base patch `:484-500`；`dsh-web` 是搜索/抓取服务，提供 `listProviders`，`tool-web` 暴露 `web_search/web_fetch`。**不要与 web UI 混淆** |
| H 桥（1） | `dsh-opentui-bridge` | TUI 必需 | `packages/bridge/cordis.patch.yml:6-8` 以 id `dsh-opentui-bridge` 挂载 |
| I patch 新增（3） | `tool-ask-user` / `mcp-context7` / `preset-opentui-append-system` | 见下 | `tool-ask-user`：TUI 必需（preset 内 `ask_user` 工具，且无 `dsh-tui-pi` bundle 提供）；`mcp-context7`：**未知/可选**（`cordis.patch.yml:374-381`）；`preset-opentui-append-system`：**web 模板带进来的无关项**（依赖 `agentPresets`，仅 web-app 提供，运行时 pending） |

**完整 103 条目分组清单**（每行 `id` — `name`）：

- A（19）：tool-plugin-manager — @deepseek-ai/dsh-plugin-manager/tools；plugin-manager — @deepseek-ai/dsh-plugin-manager；timer — @deepseek-ai/cordis-plugin-timer；hmr — @deepseek-ai/dsh-hmr；typert — @deepseek-ai/dsh-typert-registry；typert-loader — @deepseek-ai/dsh-typert-loader；typert-gateway — @deepseek-ai/dsh-api-gateway；config-editor — @deepseek-ai/dsh-config-editor；settings — @deepseek-ai/dsh-settings；storage — @deepseek-ai/dsh-storage；storage-json — @deepseek-ai/dsh-storage-json；storage-domain — @deepseek-ai/dsh-storage-domain；working-directory — @deepseek-ai/dsh-working-directory；tool-working-directory — @deepseek-ai/dsh-tool-working-directory；commands — @deepseek-ai/dsh-commands；command-feedback — @deepseek-ai/dsh-command-feedback；remote-access — @deepseek-ai/dsh-api-remote-access；plugin-package-inventory-deepseek — @deepseek-ai/dsh-plugin-package-inventory-deepseek；jobs — @deepseek-ai/dsh-jobs-local。
- B（8）：llm — @deepseek-ai/dsh-llm；deepseek-llm-api-extensions — @deepseek-ai/dsh-deepseek-llm-api-extensions；llm-pi-ai — @deepseek-ai/dsh-llm-pi-ai；llm-retry — @deepseek-ai/dsh-llm-retry；llm-deepseek — @deepseek-ai/dsh-llm-deepseek-api-key；llm-deepseek-account — @deepseek-ai/dsh-llm-deepseek-account；agent-default-model — @deepseek-ai/dsh-agent-default-model；token-meter — @deepseek-ai/dsh-token-meter。
- C（11）：session — @deepseek-ai/dsh-session；session-log-deepseek — @deepseek-ai/dsh-session-log-deepseek；session-persistence-jsonl — @deepseek-ai/dsh-session-persistence-jsonl；session-query-sqlite — @deepseek-ai/dsh-session-query-sqlite；session-projection — @deepseek-ai/dsh-session-projection；session-projection-cache — @deepseek-ai/dsh-session-projection-cache；session-title — @deepseek-ai/dsh-session-title；session-title-llm — @deepseek-ai/dsh-session-title-first-prompt-llm；session-checkpoint-policy — @deepseek-ai/dsh-session-checkpoint-policy；session-telemetry-otel — @deepseek-ai/dsh-session-telemetry-otel；otel — @deepseek-ai/dsh-otel。
- D（28）：agent — @deepseek-ai/dsh-agent；user-questions — @deepseek-ai/dsh-user-questions；goal — @deepseek-ai/dsh-goal；goal-round-driver — @deepseek-ai/dsh-goal-round-driver；command-goal — @deepseek-ai/dsh-command-goal；plan-mode — @deepseek-ai/dsh-plan-mode；agent-instructions — @deepseek-ai/dsh-agent-instructions；compaction-basic — @deepseek-ai/dsh-compaction-basic；command-compact — @deepseek-ai/dsh-command-compact；subagent — @deepseek-ai/dsh-subagent；agent-team — @deepseek-ai/dsh-agent-team；tool-agent-team — @deepseek-ai/dsh-tool-agent-team；subagent-spawn-in-process — @deepseek-ai/dsh-subagent-spawn-in-process；subagent-fork-in-process — @deepseek-ai/dsh-subagent-fork-in-process；tool-subagent-control — @deepseek-ai/dsh-tool-subagent-control；tool-subagent — @deepseek-ai/dsh-tool-subagent；tool-subagent-fork — @deepseek-ai/dsh-tool-subagent；ptc-runtime — @deepseek-ai/dsh-ptc-runtime-node；workflow-ptc — @deepseek-ai/dsh-workflow-ptc；tool-workflow — @deepseek-ai/dsh-tool-workflow；tool-result-pruner — @deepseek-ai/dsh-compaction-tool-result-pruner；image-offload — @deepseek-ai/dsh-compaction-image-offload；tool-todo — @deepseek-ai/dsh-tool-todo；tool-goal — @deepseek-ai/dsh-tool-goal；repeat-tool-reminder — @deepseek-ai/dsh-repeat-tool-reminder；timeout-policy — @deepseek-ai/dsh-tool-call-timeout-policy；spill-local — @deepseek-ai/dsh-spill-local；spill-policy — @deepseek-ai/dsh-spill-policy。
- E（26）：authorization — @deepseek-ai/dsh-authorization；credentials — @deepseek-ai/dsh-credentials-local；deepseek-account — @deepseek-ai/dsh-deepseek-account；approval — @deepseek-ai/dsh-user-approval；permission — @deepseek-ai/dsh-permission-presets；shell-env — @deepseek-ai/dsh-shell-env；subprocess — @deepseek-ai/dsh-subprocess-local；sandbox — @deepseek-ai/dsh-sandbox-local；sandbox-policy — @deepseek-ai/dsh-sandbox-policy；bash-sandbox — @deepseek-ai/dsh-bash-sandbox；pwsh-sandbox — @deepseek-ai/dsh-pwsh-sandbox；tool-bash — @deepseek-ai/dsh-tool-bash；tool-pwsh — @deepseek-ai/dsh-tool-pwsh；tool-fs — @deepseek-ai/dsh-tool-fs；tool-fs-search — @deepseek-ai/dsh-tool-fs-search；fs-observation-policy — @deepseek-ai/dsh-fs-observation-policy；skill — @deepseek-ai/dsh-skill；skill-filesystem — @deepseek-ai/dsh-skill-filesystem；tool-skill — @deepseek-ai/dsh-tool-skill；tool-jobs — @deepseek-ai/dsh-tool-jobs；fs-sandbox — @deepseek-ai/dsh-fs-sandbox；tool-executor-native — @deepseek-ai/dsh-tool-executor-native；tool-executor-ptc — @deepseek-ai/dsh-tool-executor-ptc；tools — @deepseek-ai/dsh-tools；system-prompt — @deepseek-ai/dsh-system-prompt；agent-loop — @deepseek-ai/dsh-agent-loop。
- F（2）：attachment-local — @deepseek-ai/dsh-attachment-local；mcp-resources — @deepseek-ai/dsh-mcp-resources。
- G（5）：web — @deepseek-ai/dsh-web；web-search-deepseek — @deepseek-ai/dsh-web-search-deepseek；web-deepseek-api — @deepseek-ai/dsh-web-deepseek-api；web-fetch-http — @deepseek-ai/dsh-web-fetch-http；tool-web — @deepseek-ai/dsh-tool-web。
- H（1）：dsh-opentui-bridge — @aiwayds/dsh-opentui-bridge。
- I（3）：tool-ask-user — @deepseek-ai/dsh-tool-ask-user；mcp-context7 — @deepseek-ai/dsh-mcp-client；preset-opentui-append-system — @deepseek-ai/dsh-agent-preset。

合计 19+8+11+28+26+2+5+1+3 = **103**，与 dump-config 一致。

---

## 4. 表 ③：裁剪影响矩阵

| 项 | 去掉后谁断 | 有无替代 | 代价 / 风险 |
|---|---|---|---|
| `cordis.patch.yml` 中 `preset-opentui-append-system`（`:393-540`） | 无功能断（当前 pending，从未激活） | 不需要；如真要 APPEND_SYSTEM persona，需引入 `dsh-agent-preset-registry`（web-app 的 `agentPresets`）或改由客户端注入 system prompt | 删掉可消除启动 warning；但会失去"APPEND_SYSTEM.md 生效"的意图（当前其实也没生效） |
| `cordis.patch.yml` 中 `ui-settings-general`（`:382-385`） | 无功能断（报 `entry not found`） | 无 | 删掉消除 dump-config 报错 |
| `cordis.patch.yml` 中 `web.searchProvider: anysearch`（`:353-358`） | 若保留，`web_search` 调用会失败（`WEB_PROVIDER_CONFIGURED_MISSING`）；**建议改为 `deepseek-search-api` 或删除该行让 base 默认生效** | 有：base 已配 `deepseek-search-api`（base patch `:484-488`） | 不是"裁掉就断"，是"保留才可能断"。需实测 `tool-web` 确认 |
| `mcp-context7`（`:374-381`） | context7 MCP 工具不可用 | 无（可选功能） | 低 |
| `dsh-web-app` bundle（当前不在列表，若曾考虑加入） | **加入**会引入 sessionController / modelCatalog / agentPresets / 103 个 web 条目 + 40M+ node_modules；**去掉**（现状）则 `session.list`、`session/modelCatalog` RPC 不可用 | `session.list` 可退到 `sessionPersistence.list()`（见 §5.2）；`modelCatalog` 可退到 `llm.listModels()`（见 §5.3） | 这是本盘点的核心：现状即"已裁掉 web-app"，桥侧 `session.list` 因此 UNSUPPORTED |
| `@deepseek-ai/dsh-base` bundle | **全部功能断**：LLM、session、工具、审批、agent、web 搜索后端 | 无 | **绝对不能裁**；99 条目里绝大多数 TUI 必需 |
| `@aiwayds/dsh-opentui-bridge` | in-process bridge 不存在，TUI 无法连宿主 | 无 | **绝对不能裁** |
| base patch 中 tool 恢复行（`:300-334, :343-352`） | 无（无 web-app 时 web-app 未 disable 这些行） | 不需要 | 删掉是纯清理，无收益 |
| `session-title-llm`（C 组） | 标题自动生成为空，列表可能用 fallback 标题 | `session-title` fallback（5 词/40 字节） | 若追求极简可裁，但影响 `/resume` 可读性 |

---

## 5. 裁剪影响面详查

### 5.1 `sessionController`（`session.list` 依赖）——确认不可用

- 挂载点：`@deepseek-ai/dsh-web-app` 的 `cordis.patch.yml:117-118`（`id: session-controller` → `@deepseek-ai/dsh-api-session-controller`）。`dsh-api-session-controller/lib/index.js:3885` 用 `super(ctx, "sessionController", { namespace: "session" })` 注册。
- `dsh-base/cordis.patch.yml` **无** `session-controller` 行（已核对）。
- 运行时证据（本盘点实测，`probe-session-list.mjs`）：
  ```
  SESSION_LIST_REPLY={"id":2,"ok":false,"error":{"code":"UNSUPPORTED",
    "message":"sessionController service unavailable: session.list capability not present",
    "detail":{"capability":"session.list","service":"sessionController"}}}
  ```
- 桥侧代码已防御：`packages/bridge/src/index.ts:329-343` 用 `ctx.get('sessionController')`（带 try/catch），缺失时 `:1184` 回 `UNSUPPORTED`。`inject` 仍仅 `['agents']`（`:240`），所以即使 web-app 加了也未必能通过 `ctx.get` 取到（cordis 对未声明 inject 的服务会抛错，被 catch 吞掉）。
- 影响：`/resume` 选择器拿不到列表（HEAD 的 `session.list` 帧已实现但宿主侧无服务）。

### 5.2 `ctx.sessionPersistence` 能否替代 `sessionController.list()` ——接口够枚举，字段不够

**接口原文**（`$HOST/dsh-session-persistence/lib/types/index.d.ts:160,166`，`$HOST=/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`）：

```ts
abstract stat(id: SessionId, options?: SessionPersistenceStatOptions): Promise<SessionPersistenceSnapshot | undefined>;
abstract list(options?: SessionPersistenceListOptions): Promise<readonly SessionPersistenceSnapshot[]>;
```

JSDoc 原文（同文件 `:161-165`）：`List every stored session visible to this process, in no promised order.` / `without reading the full event log`（`:19-21`）。

**`SessionPersistenceSnapshot` 字段**（同文件 `:19-40`）：
`header: SessionHeader`、`formatStatus?`、`revision`、`eventCount?`、`sizeBytes?`、`location?`。

**`SessionHeader` 字段**（`$HOST/dsh-session/lib/types/types.d.ts:59-100`）：
`version`、`id`、`createdAt`、`cwd?`、`parentSession?`、`isSeeded`、`origin?`、`delegationDepth?`、`agentPreset?`。

**字段是否够**（对照 `tickets/2026-11-18-session-list-feasibility.md:22-34`）：

| 需求字段 | `sessionPersistence` 能否提供 | 说明 |
|---|---|---|
| `id` | 能 | `header.id` |
| `updatedAt` | **不能** | header 只有 `createdAt`；无 `updatedAt`。`SessionListValue.items[].updatedAt` 来自投影层 |
| `title` | **不能** | header 无 `title`；标题在 `SessionSummary.projections.values.title`（feasibility F8） |
| `cwd` / `blank` / `origin` | 部分 | `cwd`/`origin` 在 header；`blank` 不在 |

结论：`sessionPersistence.list()` **可以枚举 id/cwd/origin/createdAt/sizeBytes**，但 `/resume` 需要的 **title 与 updatedAt 缺失**。若走备选路径，必须再接 `ctx.get('sessionQuery').readTitle*`/`searchSessions`（feasibility F9，`dsh-session-query/lib/types/index.d.ts:63,70`）补字段，投影逻辑比直接照抄 `remote-session-ops.ts:271-305` 更重。**不能作为 `sessionController.list()` 的等代价替代。**

### 5.3 modelCatalog / provider 注册 / ask 审批分别由谁提供

| 能力 | 提供者 | 是否在 web-app | 证据 |
|---|---|---|---|
| `modelCatalog`（`session/modelCatalog` RPC） | `dsh-api-session-controller` → `SessionController.modelCatalog()` | **是**（web-app bundle 的 `session-controller` 行） | `dsh-api-session-controller/lib/types/index.d.ts:116`；`lib/typert.host.js:2201` 定义 `session/modelCatalog` → `service: 'sessionController'` |
| provider 注册 / 模型目录（host 侧 LLM 路由） | `dsh-llm` + `dsh-llm-pi-ai`，**在 `dsh-base`** | **否** | base patch `:34,135-136`；模型表在 `cordis.patch.yml:2-291`；`dsh-llm/lib/types/index.d.ts:181` 有 `listModels` |
| ask 审批（`approval` 服务） | `dsh-user-approval`，**在 `dsh-base`** | **否** | base patch `:259-262`：`policy: ask`（除非 `DSH_PERMISSION_MODE=danger-full-access`） |
| 权限预设 | `dsh-permission-presets`，**在 `dsh-base`** | **否** | base patch `:264-273`；`cordis.patch.yml:359-372` 覆盖为 `danger-full-access` |

**补充**：即使没有 web-app，`llm.listModels()`（base）仍可做模型枚举；但 TUI 客户端当前走的是远端 `session/modelCatalog` RPC（见 `packages/shell/src/client/remote-model.ts`），该 RPC 的服务端只存在于 sessionController。所以"模型下拉列表"在 inproc 下也可能受影响——**这一条未在本次实测中验证，列入未知项 U2**。

---

## 6. 成本

| 指标 | 测量方法 | `opentui-inproc` | 对照（web / opentui） |
|---|---|---|---|
| 冷启动到 bridge ready | spawn `dsh --profile opentui-inproc --no-open` + `DSH_OPENTUI_BRIDGE_STDIO=1`，每 100ms 发 `bridge.ping`，记首个 `protocolVersion:1` 回复 | **849 ms**（`timed-handshake.mjs`，单次） | 未测（无 bridge bundle，不能直接比） |
| 配置组合耗时 | `dsh --profile X --dump-config` 计时 ×3 | 79.7 / 73.4 / 73.3 ms | web 78.7 / 77.1 / 77.2 ms（**无可感知差异**） |
| 插件条目数 | `--dump-config` 解析 `- id:` | **103**（102 激活 + 1 pending） | web 205；opentui 224；headless 101 |
| profile 自身 node_modules | `du -sh` + `find -name package.json` | **0 B，1 个 symlink，0 个 package.json** | web 42M / 56 pkg；opentui 52M / 74 pkg |
| 宿主 closure 可用包 | `ls $HOST \| wc -l` | 339 个 `@deepseek-ai/*`（但按 profile 只加载组合树中的那些） | 同一份 closure |

**判读**：裁剪 `cordis.patch.yml` 的 web 残留行，性能收益≈0（配置组合 73ms 两者相同，profile 依赖已为 0B）。真正的可感知差异是**减少启动 warning** 和**降低配置理解成本**，不是启动速度或磁盘占用。

---

## 7. 候选方案（不替用户拍板）

| 方案 | 做法 | 代价 | 风险 |
|---|---|---|---|
| **A. 保持现状** | 不动 bundle 列表，保留 544 行 web 模板 patch | 0 改动；继续有 1 个 pending warning + 1 个 patch 报错 + `session.list` UNSUPPORTED | `/resume` 列表持续不可用；`anysearch` 配置可能让 web_search 失败；下一个人仍会以为"带着 web profile" |
| **B. 最小裁剪（只改 patch，不动 bundle）** | 删 `preset-opentui-append-system`、`ui-settings-general`、`mcp-context7`、tool 恢复行；把 `searchProvider: anysearch` 改为 `deepseek-search-api` 或删除；保留 provider 表 + `tool-ask-user` + `agent-default-model` | 需逐一回归 preset 行为（APPEND_SYSTEM.md 当前未生效，删除后行为不变）；约 1 小时 | 低：不碰 `dsh-base` / bridge。`session.list` 仍 UNSUPPORTED，需另案解决（feasibility 的桥侧加帧路径） |
| **C. 自建最小 profile** | 新 profile：bundle 仍 `dsh-base`+bridge，patch 从零写（只保留 provider 表、`tool-ask-user`、`agent-default-model`、subagent 上限），彻底不继承 web 模板 | 需要重写并长期维护 ~30 行有效 patch；需设计 APPEND_SYSTEM.md 的新注入方式 | 中：新 profile 需迁移现有凭据引用/默认模型设置；`session.list` 同样 UNSUPPORTED；与 `provision-inproc-profile.mjs` 的"只管 bundle"约定需对齐（谁来写 patch） |

**共同前提**：三个方案都不改变 `sessionController` 缺失的事实。若要恢复 `/resume` 列表，需要独立决策：
- 走 feasibility 推荐路径（桥侧加帧 + `session.list`，依赖 `sessionController`，但它在 web-app 里 → 要么把 `sessionController` 加入桥的 `inject` 并加载 web-app，要么退到 `sessionPersistence` 备选路径）；
- 或走 `sessionPersistence.list()` + `sessionQuery` 补 title/updatedAt 的低风险路径（字段不全，投影更重）。

---

## 8. 未知项（需什么才能确认）

| 编号 | 未知项 | 需要什么 |
|---|---|---|
| U1 | `web.searchProvider: anysearch` 在 inproc 下是否真的让 `web_search` 失败 | 在桥上调用 `tool-web` 的实际工具帧（当前桥未暴露 web 方法），或起一个带 `dsh-web` RPC 的宿主直接调 `web.search` |
| U2 | TUI 客户端模型下拉是否完全依赖 `session/modelCatalog`（web-app），还是能退到 base 的 `llm.listModels()` | 阅读 `packages/shell/src/client/remote-model.ts` 全链路 + 在 inproc 下实测 `/model` 选择器 |
| U3 | `ctx.get('sessionController')` 是否仅因未被 inject 而失败（把 `'sessionController'` 加入桥的 `inject` 是否能取到） | 即使 web-app 未加载，也可做一次注入探针；但注意服务本身未挂载，注入也救不了 |
| U4 | `permission` 默认 `danger-full-access` 是否用户有意（ patch `:359-372` 覆盖 base 的 `workspace-write`） | 用户确认；本次未验证实际审批行为 |
| U5 | `mcp-context7` 是否有可观测用途（有无工具调用它） | 查 TUI 工具面板 / 会话记录里是否有 context7 调用 |

---

## 9. 探测临时文件处置

- `/private/tmp/inproc-inventory-probe/`：本次生成的 dump（`dump-*.txt`）、解析脚本（`parse_dump.py` / `classify.py`）、宿主日志（`run-opentui-inproc.stderr`）、探针脚本（`probe-host.mjs` / `timed-handshake.mjs` / `probe-session-list.mjs`）。**保留未删**，供复核；无密钥值。
- scratch home `/private/tmp/m2a-1794976880/home/`：只读使用（`--dump-config` + 起宿主桥探针），未修改 profile 文件；宿主进程已 SIGTERM 退出，无残留。
- 未创建临时 profile 副本，未改源码，未 commit。
