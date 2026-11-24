# dsh 上游 app / web profile 设计调研（只读取证，2026-11-24）

调研对象：全局安装 `@deepseek-ai/dsh@0.2.2-rc.5`（`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh`，含 src/、docs/）与其 339 个 `@deepseek-ai/*` 宿主包。`~/.dsh` 只读，未打印任何凭据值。下文所有结论均给出 `文件:行` 或「包名+文件」；推断标「推测」。

---

## 结论先行

1. **dsh 只有 5 个内置 profile 模板**：`acp`、`web`、`headless`、`sdk`、`sdk-minimal`，定义在 `dsh-official-bundles/src/bundles.ts:10-26`。**不存在名为 `app` 或「app profile」的内置/保留 profile**；`architecture.md:17,23` 与 `README.md:13-20` 均只列这 5 个。所谓「app」是 bundle 后缀（`dsh-web-app` / `dsh-acp-app` / `dsh-sdk-app`），指「应用面 bundle」，不是 profile 类型（推测，依据 `architecture.md:23`）。
2. **`dsh --profile X` 遇不存在目录的行为是双轨**：`X` 命中模板表 → `initProfile()` **创建**；否则**报错** `profile "X" does not exist; create it with 'dsh plugin --profile X add <package>'`（`dsh-app-boot/src/profile.ts:728-741`）。本机 `opentui`、`opentui-inproc`、`tui` 都不在模板表里，属于自定义 profile，全新机器不会自动创建。
3. **「无浏览器 web 面的窄宿主」在上游没有成品 profile**：最接近的是 `acp`（ACP stdio）与 `sdk`（JSON-RPC stdio）——二者都是 `dsh-base` + 一个窄 app bundle，不挂 `dsh-web-app`、不起 HTTP（`dsh-acp-app/cordis.patch.yml:1-23`、`dsh-sdk-app/cordis.patch.yml:1-23`、`README.md:13-15`）。若目标是「保留 controller/config 能力但去掉浏览器与端口」，上游没有现成 profile，需自组 composition（推测）。
4. **controller 是普通 Cordis 插件（Loader 行），不是 bundle**：由 `dsh-web-app/cordis.patch.yml:117-159` 以 `id` + `name: '@deepseek-ai/dsh-api-*-controller'` 插入；`send`面由 base 的 `dsh-settings` / `dsh-config-editor` 提供（`dsh-base/cordis.patch.yml:105-111`）。`modelCatalog` 不是独立服务，而是 `session-controller` 的 `@Remote('modelCatalog')` 方法（`docs/subsystems/session.md:837,930`）。
5. **非 HTTP inproc 宿主已有官方可复用链路**：base 已挂 `dsh-api-gateway`（`ctx.typertGateway`）与 `dsh-api-remote-access`（`dsh-base/cordis.patch.yml:52-59`）；`dsh-client-connection/README.md:34` 明确「shell-owned compositions」用 `connection.rpc.open` 提供等价 Remote 流而不开 WebSocket，`dsh-api-gateway/README.md:41-46` 明确「in-process Connection carrier」与「in-process invocation is unchanged」；`dsh-sdk-app/cordis.patch.yml:56-60` 是官方「不启 Web server 仍挂 connection」的示例。结论：在 inproc 宿主里应保留 base + 按需挂载 controller 行 + 用 in-process carrier，去掉 `dsh-web-app`/`dsh-host-webserver`。
6. **npm 全局升级不会重建已有 profile**：dsh 包无 install/upgrade 钩子（`dsh/package.json:186` `"scripts": {}`）；仅在**启动时**做有限规范化：旧 tuple 精确匹配后换成模板（`dsh-app-boot/src/profile.ts:596-606`）、删除 `RETIRED_BUNDLES`（同文件 `:612-619`，清单在 `bundles.ts:37-42`）、清理 0.1.5 link projections（`:229-237`）。
7. **profile 名是分发契约的一部分**：模板键即保留名（`profile.ts:733-740`、`profile-boot.ts:114-130`）、`desktop` 被 CLI 拒绝（`dsh/src/args.ts:83-87`）、名字注入 `ctx.profileContext.name`（`profile-boot.ts:327-335`）并进入 User-Agent（`profile-boot.ts:270-284`）；本仓也硬编码 `opentui`（`CONTEXT.md:53`、`packages/shell/scripts/lib/provision-plan.mjs:9`，见 `research/upgrade-command-20261116/cli-and-profile-facts.md:121-125`）。
8. **未发现「废弃某个 profile」的官方既有做法**：检索 `docs/`、`docs/upgrade-guide/`、包 README 只找到「废弃 bundle」「重置 profile」的先例，没有移除内置 profile 的迁移脚本（详见「升级/废弃机制」）。

---

## 内置 profile 清单表

| 名称 | bundle 列表（`dsh.profile.bundles`） | 是否内置模板 | 目录不存在时 | 面/传输 | 证据 |
|---|---|---|---|---|---|
| `acp` | `dsh-base`, `dsh-acp-app` | 是 | 自动 `initProfile` 创建 | ACP stdio，无 HTTP | `dsh-official-bundles/src/bundles.ts:11-13`；`dsh-acp-app/cordis.patch.yml:1-23`；`README.md:13` |
| `web` | `dsh-base`, `dsh-web-app` | 是 | 自动创建 | 浏览器 + HTTP，默认 `127.0.0.1:3080` | `bundles.ts:14-16`；`dsh-web-app/cordis.patch.yml:183-208` |
| `headless` | `dsh-base`, `dsh-headless` | 是 | 自动创建 | 一次性 runner，无 server | `bundles.ts:17-19`；`README.md:14` |
| `sdk` | `dsh-base`, `dsh-sdk-app` | 是 | 自动创建 | JSON-RPC stdio，无 Web server | `bundles.ts:20-22`；`dsh-sdk-app/cordis.patch.yml:56-60`；`README.md:15` |
| `sdk-minimal` | `dsh-sdk-minimal`（唯一例外，不叠 base） | 是 | 自动创建 | 独立最小 SDK 树 | `bundles.ts:23-25`；`architecture.md:23` |
| `desktop` | Electron 应用独占 | 保留名，非模板 | CLI 拒绝 boot/dump | Electron Host + 完整 Web 应用 | `dsh/src/args.ts:83-87`；`README.md:20`；`architecture.md:51` |
| 其他任意名（本机 `tui`/`opentui`/`opentui-inproc`） | 无模板；`dsh plugin` init 时用 `['@deepseek-ai/dsh-base']` | 否 | **报错**，须先 provision | 取决于自定义 bundles/patch | `dsh-app-boot/src/profile.ts:45,733-740`；`bundles.ts:44-45`；`dsh/src/plugin.ts:48` |

**profile 目录由谁生成/包含什么**（`dsh-app-boot/src/profile.ts:5-14`）：

- `package.json`：`initProfile()` 写入 `{ name, private: true, dependencies: {}, dsh: { profile: { bundles } } }`，已存在则不覆盖（`:198-217`）。
- `cordis.patch.yml`：由 `initProfile()` 写入空数组模板 `[]`（`:174-178,213-214`）；是用户自己的 patch 层。
- `cordis.yml`：由 launcher 在 `prepareProfile()` 每次启动时**重写为空 entry list**（`dsh/src/profile-boot.ts:80-88,194-200`），仅作为 Loader 的 include 根。
- `pnpm-workspace.yaml`：`initProfile()` 写入 `nodeLinker: hoisted`、`autoInstallPeers: false`（`profile.ts:180-216`）。
- `node_modules` / `pnpm-lock.yaml`：由 `dsh plugin`（转发 pnpm）生成，非 launcher（`dsh/src/plugin.ts:71-108`）；运行时另有 installation-first / profile-second 的两锚点解析（`profile.ts:629-662`）与父级 `profiles/node_modules` 拦截层（`:145-157,386-419`）。
- `compatibility.json`：profile 本地版本豁免，独立文件、非 manifest/patch（`profile-compatibility.ts:9-15`）。
- bundle 列表本身：`dsh-official-bundles/src/bundles.ts`（`PROFILE_TEMPLATES` / `DEFAULT_PROFILE_BUNDLES` / `OPTIONAL_BUNDLES` / `ON_DEMAND_BUNDLES`），由 v0.2.1-rc.2 从 app-boot 迁入（`docs/upgrade-guide/v0.2.1-rc.2/official-bundle-lists/guide.md`）。

**交互别名**：`dsh <name>` 展开为 `dsh --profile <name>`（`dsh/src/args.ts:205-209`）；`dsh --profile X --from-default-profile web` 用内置模板整体替换自定义 profile（`profile-boot.ts:108-177`、`args.ts:169`）。

---

## app vs web 差异表

「app」列取官方两个窄 app bundle：`acp`（自动化 stdio）与 `sdk`（工具调用 stdio）。它们都不是「无浏览器的 web 面」，而是各自协议面；这是本调研最重要的纠偏。

| 维度 | `web` profile | `acp` profile | `sdk` profile | 证据 |
|---|---|---|---|---|
| bundles | `dsh-base` + `dsh-web-app`（+ bundle 内含 5 个 preset patch 文件） | `dsh-base` + `dsh-acp-app` | `dsh-base` + `dsh-sdk-app` | `bundles.ts:14-22`；`dsh-web-app/package.json` `dsh.bundle.patch` |
| 是否起 HTTP | 是；`webserver` 行 `host: ctx.webStartup.host ?? '127.0.0.1'`、`port: ... ?? 3080`，`connection` 挂 `/api` | 否 | 否；patch 明写 `# Share native desktop tools and model context without starting a Web server.` | `dsh-web-app/cordis.patch.yml:183-189,234-245`；`dsh-acp-app/cordis.patch.yml:1-23`；`dsh-sdk-app/cordis.patch.yml:56-60` |
| 传输 | 浏览器 fetch/SSE + `/api/remote.mux` WebSocket；HTTP 有 token/cookie 认证 | stdin/stdout NDJSON ACP 帧，stdout 保留给协议 | JSON-RPC stdio；`connection` 行存在但无 webserver | `dsh-web-app/cordis.patch.yml:231-245`；`dsh-acp-app/README.md:12,27`；`README.md:13,15` |
| 应用启动行 | `web-startup`（`@deepseek-ai/dsh-web-app/startup`）+ `web-runtime`；`--help` 不提供 `webStartup` 因而不 bind | `acp-app-startup` + `acp`（`inject: [acpAppStartup]`），`--help` 直接退出 | `sdk-app-startup` + `sdk-jsonrpc-server` | `dsh-web-app/cordis.patch.yml:8-13,172-208`；`dsh-acp-app/cordis.patch.yml:11-20`；`dsh-sdk-app/cordis.patch.yml:11-21` |
| controller 行 | `session-controller`、`job-controller`、`terminal-controller`、`workspace-files`、`settings-controller`、`workspace-controller`、`api-remotes` | 无（只有 base 的 gateway/remote-access） | 无 controller；有 `connection`/`file-upload`/`workspace`/`schedule` 等 host 工具行 | `dsh-web-app/cordis.patch.yml:117-129,146-159,252-253`；`dsh-base/cordis.patch.yml:52-59`；`dsh-sdk-app/cordis.patch.yml:56-88` |
| config 面 | base `config-editor` + `settings`；浏览器 Settings 页 + `settings-controller` | base `config-editor` + `settings`，无 Remote 投影 | 同左 | `dsh-base/cordis.patch.yml:105-111`；`docs/capability-seams.md:692-693,704-706` |
| modelCatalog | 由 `session-controller` 提供（`session/modelCatalog`） | 无 controller，故无该 Remote（base 的模型路由能力仍在） | 无 controller Remote | `docs/subsystems/session.md:837,930`；`dsh-api-session-controller/README.md:13` |
| 浏览器 roster / UI | 大量 `dsh-client-ui-*`、`modules`、`client-hmr` | 无 | 无 | `dsh-web-app/cordis.patch.yml:218-495` |
| agent plane | Web 面 disable base 的 tool 行，改由 per-session preset 挂载 | 继承 base 的 host-plane 行 | 继承 base，且仅追加少量行 | `dsh-web-app/cordis.patch.yml:497-620`；`dsh-acp-app/cordis.patch.yml:22-23`；`dsh-sdk-app/cordis.patch.yml:24-35` |
| HMR | base 的 config-only HMR 开启 | YAML 关闭（一条 stdio 连接不观察替换 bridge） | YAML 关闭 | `architecture.md:27`；`dsh-acp-app/README.md:63`；`dsh-sdk-app/cordis.patch.yml:23-24` |

**对照本机 profile 实例**（只读 `~/.dsh/profiles/*/package.json`）：`web` = `[dsh-base, dsh-web-app, @aiwayds/dsh-feishu, @aiwayds/dsh-approval-policy]`；`opentui` = `[dsh-base, dsh-web-app, …18 个 @aiwayds/*]`，即从 web 模板克隆的 HTTP 宿主；`opentui-inproc` = `[dsh-base, @aiwayds/dsh-opentui-bridge, @aiwayds/dsh-subagent-registry]`，无 web-app、无 HTTP。这与 `research/tui-pi-model-switch-parity.md:35,62` 的既有结论一致。

---

## controller 供给方式

### 官方供给形态

- **controller 是插件（Loader entry），不是 bundle**：`dsh-api-*` 包的 `package.json` 没有 `dsh.bundle` 字段，只有 `dsh.client`（客户端半声明），例如 `dsh-api-session-controller/package.json`、`dsh-api-settings-controller/package.json`。它们以行的方式由 `dsh-web-app/cordis.patch.yml` 插入：

  | 行 id | 包名 | web patch 行 |
  |---|---|---|
  | `session-controller` | `@deepseek-ai/dsh-api-session-controller` | `:117-118` |
  | `job-controller` | `@deepseek-ai/dsh-api-job-controller` | `:122-123` |
  | `terminal-controller` | `@deepseek-ai/dsh-api-terminal-controller` | `:126-127` |
  | `workspace-files` | `@deepseek-ai/dsh-api-workspace-files` | `:128-129` |
  | `settings-controller` | `@deepseek-ai/dsh-api-settings-controller` | `:146-147` |
  | `workspace-controller` | `@deepseek-ai/dsh-api-workspace-controller` | `:158-159` |
  | `api-remotes` | `@deepseek-ai/dsh-api-remotes` | `:252-253` |

- **服务语义**：`ctx.sessionController` 拥有 Session 命令/历史/follow、Host 生成的 model catalog、workspace opening、Agent 激活策略（`docs/capability-seams.md:688`；`dsh-api-session-controller/README.md:13`）；`ctx.settingsController` / `ctx.credentialsController` 是 settings/credentials seam 到 Remote namespace 的投影，读始终脱敏（`docs/capability-seams.md:692-693`；`dsh-api-settings-controller/README.md:11,26,30`）。`modelCatalog` 明确为 session-controller 的 `@Remote('modelCatalog')`（`docs/subsystems/session.md:930`）。
- **config 面**：底座是 base 的 `config-editor`（写回 active profile patch）与 `settings`（从 active profile entries 组 Config），二者在 `dsh-base/cordis.patch.yml:105-111`；浏览器 Settings 页再加上 `ui-settings-*` 行（`dsh-web-app/cordis.patch.yml:138-147,329-336`）由 settings-controller 提供读写 Remote。
- **传输与网关**：base 已挂 `typert-gateway`（`@deepseek-ai/dsh-api-gateway`）与 `remote-access`（`@deepseek-ai/dsh-api-remote-access`）（`dsh-base/cordis.patch.yml:52-59`）。`docs/api-gateway.md:5-27` 定义 `@Remote` 业务服务经 Gateway 分发；Gateway README 明确 Host 半提供 carrier-neutral RPC，Web carrier 才拥有 `/api` 路由/Fetch bridge/认证，shell-owned carrier 直接 dispatch 同一 Fetch handler（`dsh-client-connection/README.md:34`），并有 in-process Peer (`createPeer`)（`README.md:49`）；Gateway 自身声明「in-process Connection carrier provides equivalent streams directly without opening it」「in-process invocation is unchanged」（`dsh-api-gateway/README.md:41-46`）。`dsh-sdk-app/cordis.patch.yml:56-60` 是官方无 Web server 仍挂 `connection` 的示例。

### 我们要在 inproc 宿主提供这些服务的官方形态（推测，基于以上文件）

1. 保留 `@deepseek-ai/dsh-base` 第一层：得到 gateway、remote-access、settings、config-editor。
2. **不要**引入 `@deepseek-ai/dsh-web-app` / `dsh-host-webserver`；它们把 HTTP 端口和浏览器 roster 一起带来（`dsh-web-app/cordis.patch.yml:183-208,218-495`）。
3. 在 `~/.dsh/profiles/opentui-inproc/cordis.patch.yml` 按 web patch 的 `id`/`name` 写法插入所需 controller 行（`session-controller`、必要时 `settings-controller` / `workspace-controller`）；`modelCatalog` 随 session-controller 一并获得，不单独挂。
4. 在 profile 的 `dependencies` 中加入对应 `@deepseek-ai/dsh-api-*-controller` 包（由 `dsh plugin --profile opentui-inproc add <pkg>` 安装）；bundle 名解析为 installation-first、profile-second（`dsh-app-boot/src/profile.ts:639-662`），这些包已随全局 dsh 安装，可直接被 Loader 解析。
5. Client 半若需要与这些 Remote 通信，采用 in-process carrier：`@deepseek-ai/dsh-client-connection` 的 `installConnection` / `connection.rpc.open` + `@deepseek-ai/dsh-api-gateway/client` 的 `ctx.remote`（`dsh-client-connection/README.md:34,49`；`dsh-api-gateway/README.md:53-60`），用 `createPeer()` 建 owner Peer，不启 Web server。
6. 已有 `@aiwayds/dsh-opentui-bridge` 若是同进程内直接 `ctx.get('sessionController')`，则第 4-5 步中的 Remote/carrier 部分可省略——但需实测确认 bridge 的取数路径（见「未知项」）。

注意：`dsh-api-*/package.json` 里的 `dsh.client.platform: "web"` 是**客户端半**的浏览器平台声明，不代表 Host 半只能在 HTTP 下挂载（`dsh-api-session-controller/package.json` 等；`docs/api-gateway.md:5-27`）。**推测**：Loader 在纯 inproc 环境会跳过这些 client 半；若 bridge 需要 `ctx.remote`，须显式挂 client 行并用 in-process carrier。

---

## 升级/废弃机制

**npm 全局升级发生什么**：

- `dsh/package.json:186` `"scripts": {}`；`dsh-app-boot` / `dsh-official-bundles` 也无 install 钩子（本机检查）。结论：升级只替换全局安装目录，`~/.dsh/profiles/*` **不重建、不覆盖、不迁移**（推测于「无钩子」+ `resolveDshHome()` 只读路径解析：`dsh-home-paths/src/index.ts:135-137`）。本机 opentui profile 内的 `config.json`、`upgrade-overrides.json`、多个 `.bak-*` 是产品侧 provision/升级脚本产物，不是 dsh 宿主读取的官方字段（官方只读 `package.json`、`cordis.patch.yml`、`cordis.yml`、`pnpm-workspace.yaml`、`compatibility.json`）。

**启动时自动规范化（唯一的宿主侧迁移）**：

| 机制 | 位置 | 触发条件 |
|---|---|---|
| 模板 tuple 归一化 | `dsh-app-boot/src/profile.ts:596-606` | 仅当 profile 名命中模板键且 `dsh.profile.bundles` **精确等于** `INSTALLATION_OWNED_PROFILE_TUPLES[name]`；当前只有 `headless` 一条（`bundles.ts:32-34`），替换为当前模板 bundles 并写回 manifest |
| retired bundle 删除 | `profile.ts:612-619` + `bundles.ts:37-42` | bundle 在 `RETIRED_BUNDLES` 中；当前为 `dsh-experimental-schedule-bundle`、`dsh-experimental-agent-team-profile`；写回 manifest，保留其他字段 |
| 旧 link projections 清理 | `profile.ts:219-237` | 存在 `.dsh-module-fallback` 时解掉指向它的 symlink 并删目录（0.1.5 遗留） |
| 版本不兼容跳过/豁免 | `profile.ts:688-703`、`profile-compatibility.ts:9-15,52-66`；`dsh/src/plugin.ts:18-63` | `engines.dsh` 不匹配时跳过 bundle，除非 profile 的 `compatibility.json` 精确授权；`dsh plugin ... allow-version ... --accept-risk` 写入 |

**profile 名是否是分发契约**：是。模板键即保留名，且大小写不敏感（`profile.ts:733-740`、`profile-boot.ts:114-130`）；`desktop` 被 CLI 拒绝（`args.ts:83-87`）；名字进入 `ctx.profileContext.name` 被 patch 用作条件（`profile-boot.ts:327-335`；`dsh-web-app/cordis.patch.yml:39,51,303,311,321`）、进入 User-Agent suffix（`profile-boot.ts:270-284`）；`dsh plugin --profile <name>` 是安装入口（`plugin.ts:71-108`）。改名会破坏用户脚本与 patch 条件，属于分发契约变更。

**废弃既有做法（找到的先例，均非「废弃 profile」）**：

- 废弃 bundle：`RETIRED_BUNDLES` + 启动时改写 manifest（`bundles.ts:36-42`；`profile.ts:612-619`），先例文档 `docs/upgrade-guide/v0.2.0-rc.2/schedule-bundle-retired/guide.md`（"Start dsh once with each affected profile; no manual edit is needed"）与 `docs/upgrade-guide/v0.2.1-rc.2/session-team-mode/guide.md:18`。
- 用官方模板整体重置自定义 profile：`--from-default-profile`（`dsh/src/profile-boot.ts:108-177`），v0.2.1-alpha.2 起会删除旧目录（含 node_modules 与 cordis.patch.yml）后重建，见 `docs/upgrade-guide/v0.2.1-alpha.2/from-default-profile-replaces-target/guide.md`。**注意**：模板名（含大小写变体）不能作为目标（`profile-boot.ts:124-130`）。
- 包/行退役的迁移文档：`docs/upgrade-guide/v0.2.2-rc.1/...`、`docs/upgrade-guide/v0.2.1-rc.2/model-badge-package-removal/guide.md:11`（移除行后旧 patch 报 not found 并跳过）。
- **未找到**任何「移除内置 profile 名」的迁移脚本或 docs/CHANGELOG 条目。若我们删 `opentui`，应视为**产品侧自定义 profile 的退役**，需自行提供迁移/提示（推测）。

---

## 可复用机制清单

| 机制 | 位置 | 我们怎么用（一句话） |
|---|---|---|
| `PROFILE_TEMPLATES` 模板表 | `dsh-official-bundles/src/bundles.ts:10-26` | 确认内置模板只有 5 个；`opentui*` 必须由我们自己的 provision 创建，不能指望 dsh 自动补。 |
| `initProfile()` 生成 manifest/patch/workspace | `dsh-app-boot/src/profile.ts:198-217` | 照它生成的三件套（`dsh.profile.bundles`、`[]` patch、hoisted workspace）校验 inproc profile 是否被正确初始化。 |
| `loadProfile()` 双轨「创建 vs 报错」 | `dsh-app-boot/src/profile.ts:728-741` | 对遗留 `opentui` 目录直接报错并引导卸载，而非让 dsh 静默重建一个 HTTP 宿主。 |
| `--from-default-profile` 原子替换 | `dsh/src/profile-boot.ts:108-177`；`args.ts:169` | 若要把 `opentui` 重置成 inproc 形态，可用自定义模板思路重建；但模板名不可用于 shipped 名，且会丢用户 patch/依赖。 |
| `cordis.yml` 每次重写为空 | `dsh/src/profile-boot.ts:80-88,194-200` | 不要在 `cordis.yml` 里塞 row；所有定制写进 `cordis.patch.yml`。 |
| bundle 行 patch 写法（`id` + `name`） | `dsh-web-app/cordis.patch.yml:117-159` | 把需要的 controller 行按同结构复制进 `opentui-inproc/cordis.patch.yml`。 |
| base 已挂载的 Gateway + RemoteAccess | `dsh-base/cordis.patch.yml:52-59` | inproc profile 无需重复挂这两个服务。 |
| `config-editor` + `settings` base 行 | `dsh-base/cordis.patch.yml:105-111` | config 读写底座直接继承；缺的是 Remote 投影时再挂 `settings-controller`。 |
| in-process Connection carrier | `dsh-client-connection/README.md:34,49`；`dsh-api-gateway/README.md:41-46` | 用 `connection.rpc.open` / `createPeer()` 替代 `/api` WebSocket 与 HTTP 端口。 |
| 官方「无 Web server 仍挂 connection」 | `dsh-sdk-app/cordis.patch.yml:56-60` | 作为 inproc profile 去掉 `webserver`、保留 client 能力的 composition 范例。 |
| `RETIRED_BUNDLES` / tuple 归一化 | `bundles.ts:32-42`；`profile.ts:596-619` | 理解升级后 profile 可能被自动改写；不要依赖旧 bundle 名常驻。 |
| `compatibility.json` 豁免 | `profile-compatibility.ts:9-15`；`dsh/src/plugin.ts:18-63` | 若 bridge 依赖的插件 `engines.dsh` 落后，走官方豁免命令而非改全局包。 |
| profile 名条件分支 | `profile-boot.ts:270-284,327-335`；`dsh-web-app/cordis.patch.yml:39,51,303,311,321` | 保留 `opentui-inproc` 名字可继续命中 patch 条件；改名需同步审计所有 `profileContext.name` 判断。 |
| `dsh plugin --profile X add` | `dsh/src/plugin.ts:71-108` | 安装 controller 插件与依赖时继续委托宿主 CLI/pnpm，不自行写 node_modules。 |

---

## 未知项

1. **「app profile」无官方字面定义**：全量检索 `dsh/src`、`README.md`、`docs/` 未出现 `app profile` 字样。本报告的「app」= `*-app` bundle 的语义归纳（推测）。
2. **没有「无浏览器 web 面」的成品 profile**：上游只有 acp/sdk/headless 三种窄宿主；它们都不提供 web 的 controller 三件套。要在 inproc 里同时具备 controller + 无 HTTP，是自组 composition，无官方模板可抄（推测）。
3. **未实测 `dsh.client.platform: web` 的 client 半在纯 inproc 树里的行为**：只静态读了 package.json 与 README；若 bridge 需要 `ctx.remote`，client 行是否会被 Loader 跳过、是否必须显式安装 client 包，需要运行时验证。
4. **未确认 `@aiwayds/dsh-opentui-bridge` 当前取数路径**：它是否通过 Gateway Remote 调 `session/modelCatalog`（本仓 E2E 记录里提到 probe `session/modelCatalog`，见 `CHANGELOG.md:1185`），还是直接 `ctx.get('sessionController')`，本轮未追进 bridge 源码；这决定可复用机制清单第 5 条是否必要。
5. **未检查 Homebrew 安装层是否另有 profile 迁移钩子**：本机 npm 包内无 install 钩子（`dsh/package.json:186`），但 formula/cask 是否在升级时清理 `~/.dsh` 未查（不在本次范围内）。
6. **未验证 `dsh --profile web --help` 之外的「不 bind 但仍挂 controller」配置**：web patch 注释只说 `--help` 不提供 `webStartup` 因而不 bind（`dsh-web-app/cordis.patch.yml:13`）；这是诊断路径，不是可用运行形态。
7. **`~/.dsh/profiles/opentui/config.json`、`upgrade-overrides.json` 的官方对应物未找到**：疑似产品侧 provision/upgrade 脚本私有文件（推测），dsh 宿主源码未引用。
