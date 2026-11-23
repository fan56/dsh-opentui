# /settings 运行时通道 + 真实值显示 — 架构设计

- 日期：2026-11-23
- 性质：**设计文档**（只设计，不实现；未改任何源码，未 commit）
- 范围：`maxActiveSubagents`（及同类宿主 volatile 配置）的写入通道、「真实值显示」数据源、宿主/本地行分类原则、门禁影响、实现切分
- 事实基线：B1 已查实的一手结论 + 本次补充的一手核对（下文逐条 `file:line`）

---

## 0. 结论摘要（先给答案）

1. **通道选型推荐 C2：在 bridge 的既有 settings 分支上加一层「`ctx.settings`（dsh-settings 的 SettingsForms）适配器」，作为 `settingsController` 缺失时的宿主内回退。** 走的是宿主官方写路径（`configEditor.edit` → `fiber.resolveConfig` → loader `_commitVolatile` → 运行中引用就地更新），**CapIR / capcontract / ledger 零改动，不触发 W8**。
2. **不推荐 A（在 inproc profile 挂 `@deepseek-ai/dsh-api-settings-controller`）**：它会把 profile 期望面从 75 抬到 83（新增 8 个 Remote），必须重测 + 重生成 ledger + 显式解冻 + 全量 proof 重跑，成本与收益严重不匹配，且我们只需要其中 2 个方法。
3. **不推荐 B（capcontract 白名单扩展）**：`settings.describe`/`settings.mutate` 的 wire 别名和 hand-wired id **早已存在**（`packages/bridge/src/index.ts:1444-1447`、`:666-667`），缺的不是白名单，是宿主侧服务解析。扩白名单解决不了任何问题。
4. **持久化必须同步做（否则只是把「不生效」换成「重启丢失」）**：`opentui-inproc/cordis.patch.yml` 由 provisioner 每次启动按模板重写，任何运行时写入都会被备份覆盖（`provision-inproc-profile.mjs:1251-1300`）。需要在 provisioner 收敛逻辑里加**限字段白名单合并**（`subagent.maxActiveSubagents`、`session-log-deepseek.enabled`，`permission.defaultPreset` 需 `!!js` 守卫）。
5. **真实值显示**：settings 面板与 `/agents` 的 official caps 一律以**宿主 describe** 为唯一权威源；宿主不可用时显示 `n/a` + 原因，**不再回落到本地文件数字**（回落就是这次 bug 的「骗人」本身）。本地文件值仅用于「本地偏好」区（config.json 键），并在标题里标明两个 profile 的分工。

---

## 1. 现状盘点（读到的关键事实与出处）

### 1.1 断点链条（完整）

| # | 事实 | 出处 |
|---|---|---|
| 1 | 客户端 seam 的 `settings.describe/mutate` 直接走 `LocalSettingsStore`，**完全没有尝试宿主** | `packages/shell/src/client/bridge-session-seam.ts:1416-1419` |
| 2 | `LocalSettingsStore` 读写 `join(home,"profiles",profile,"cordis.patch.yml")`，`profile = DEFAULT_PROFILE = 'opentui'` | `packages/shell/src/client/local-config-faces.ts:231-320`、`packages/shell/src/client/lifecycle.ts:91` |
| 3 | 实际运行的宿主以 `--profile opentui-inproc` 启动 | `packages/shell/src/client/bridge-transport.ts:71,188` |
| 4 | 因此客户端写的 `opentui` patch **不是**宿主读的 `opentui-inproc` patch —— 写入永远到不了消费方 | 由 2+3 直接推出；`local-config-faces.ts:8-17` 的自述与 `bridge-session-seam.ts:3637-3644` 注释均记录同一事实 |
| 5 | inproc 宿主配方 = `@deepseek-ai/dsh-base` + bridge 自身 | `packages/shell/scripts/provision-inproc-profile.mjs:149` |
| 6 | `dsh-base` **挂载了** `config-editor` 与 `settings`（dsh-settings）两个服务（仅在没有 `profileContext` 时 disabled） | `…/dsh-base/cordis.patch.yml:105-112` |
| 7 | `dsh-base` **没有挂载** `@deepseek-ai/dsh-api-settings-controller`（只有 `dsh-web-app` 挂） | `grep api-settings-controller dsh-base/cordis.patch.yml` → 无；`dsh-web-app/cordis.patch.yml:147` |
| 8 | bridge 的 settings 分支只解析 `ctx.get('settingsController')`，缺失即 `NOT_WIRED` | `packages/bridge/src/index.ts:1259-1288`、resolver `:1741-1756` |
| 9 | wire 别名与 hand-wired id **已经存在**，无需任何契约改动 | `packages/bridge/src/index.ts:1444-1447`（`settings.describe`/`settings.mutate`）、`:664-667`（CAP_HOST_WIRED_IDS） |
| 10 | CapIR 有 5 个 settings 方法：2 个已 wired、3 个 full-only | `capcontract/types.ts:346-350`；`ledger/ledger.md:168-172` |
| 11 | ledger 明确记录：settings/credentials id 已 wired，但运行时 NOT_WIRED（controller 未挂） | `ledger/provenance.json:277`（`wired_capir_generated.note`） |
| 12 | 宿主闸门：`maxActiveSubagents`/`maxDepth` 是 `Volatile<number>`，manager 每次 reserve 才读 getter | `dsh-subagent/src/index.ts:188-197`、`:218-226`；`src/manager.ts:718` |
| 13 | 另外三行同为 volatile：`permission.defaultPreset`、`session-log-deepseek.enabled` | `dsh-permission-presets/src/index.ts:192`；`dsh-session-log-deepseek/src/index.ts:59-60` |
| 14 | 所以「运行中改配置」在宿主侧本来就有官方机制，只是我们没接 | 见 §1.2 |

### 1.2 宿主官方写路径确实能热生效（关键证据）

- `dsh-settings` 的 `mutate/update` 要求字段是 volatile（`dsh-settings/src/index.ts:376-390`），最终调用 `configEditor.edit`（`:390`、`:420`）。
- `configEditor.edit` 依次：`fiber.resolveConfig(next)` → 落盘 profile patch → `reconcileProfilePatches(root, patches, 'dsh', [id])`（`dsh-config-editor/src/index.ts:87-150`，成功回滚逻辑在 `:141-147`）。
- loader 对「仅 volatile 变化」的 entry **不重挂载**，只做 `_commitVolatile()` 就地写入运行中引用并 `emit('loader/volatile-update')`（`cordis-plugin-loader/lib/index.js:513-556`）。
- 结论：**`settings.mutate("subagent", [{op:"set",path:["maxActiveSubagents"],...}])` 在当前进程内即时生效、且不打断正在跑的子代理。** 这直接否定了「必须重启」这一现状，也说明通道选型不需要任何宿主插件改造。

### 1.3 持久化陷阱（设计必须一起解决）

- `provisionPatch()` 每次启动把 `opentui-inproc/cordis.patch.yml` 收敛到脚本内嵌模板：字节不等就**备份 + 覆盖重写**（`provision-inproc-profile.mjs:1251-1300`）。
- 模板里 `subagent` 行写死 `maxActiveSubagents: 3` / `maxDepth: 1`（`:608-612`），`permission.defaultPreset` 用 `!!js` 表达式（`:560`）。
- 因此：**运行时写入 profile patch 的值，重启必然被丢弃**；重写还会在 profile 目录留下 `.bak-*` 噪音（`~/.dsh/profiles/opentui-inproc/` 现存 2 个）。
- 另有一条层序事实：宿主层序为 bundle patch → profile patch → **`$DSH_HOME/cordis.patch.yml`** → 命令行 overlay（`dsh-app-boot/src/profile-context.ts:74-88`）。`configEditor.edit` 在写入后校验「生效值 == 写入值」，若被 home patch 覆盖会直接抛错（`dsh-config-editor/src/index.ts:139-141`）。当前 `~/.dsh/cordis.patch.yml` 不存在（已核）。

### 1.4 显示侧现状

- `/settings` 的 4 个 Host 行：`subagent.maxActiveSubagents`、`subagent.maxDepth`、`permission.defaultPreset`、`session-log-deepseek.enabled`（`packages/tui-base/src/routes/session/settings-panel.tsx:126-137`）。
- `/agents` 的 official caps 来自 `LocalAgentsFace.officialCaps()`，内部就是 `LocalSettingsStore.describe()`（`local-config-faces.ts:466-475`；seam 装配 `bridge-session-seam.ts:1500`）——**本地文件的值**。
- 客户端本地兜底默认值 `NS_DEFAULTS.subagent.maxActiveSubagents = 1`（`local-config-faces.ts:71`）与宿主 schema 默认 8（`dsh-subagent/src/index.ts:197`）、模板值 3 三者不一致：**同一个概念三个数字**，这本身就是「骗人」的一部分。
- 面板 header 显示 `identity()` 的 profile（`opentui`），而真正服务的是 `opentui-inproc`——显示与事实不符（`bridge-session-seam.ts:1420-1421`）。

---

## 2. 约束与假设

### 2.1 硬约束

- 只设计，不写产品代码；接口只到签名/契约层。
- 宿主侧优先：能走宿主官方服务的，不在客户端重造文件写入。
- 安全：跨 seam 的 settings 帧只允许**字段级白名单投影**（AMEND-2 / oldfox §六.2），不出现整文档透传；secret 只以 `{path,set}` 形式出现。
- 冻结面：`capir/`、`capcontract/`、`ledger/`、`build-bridge.mjs` 转义段、握手/完整性相关代码默认禁动，改动走 W8 显式解冻。
- 会话不中断：settings 写入不得导致已跑子代理被重挂载。

### 2.2 假设（逐条标注可信度）

| # | 假设 | 依据 / 状态 |
|---|---|---|
| A1 | 宿主 `ctx.settings`（SettingsForms）在 inproc 中始终可用 | 已核：dsh-base 挂载，且仅在无 `profileContext` 时 disabled；inproc 由 `dsh --profile` 启动 |
| A2 | inproc 模板里的 `- id: subagent` 行会被 `configEditor.entries()` 收录 | 已核：`describe()` 遍历 `configEditor.configuration()`，活跃 entry 带 `Config` schema 即收录（`dsh-settings/src/index.ts:302-334`） |
| A3 | 「写入后重启生效」是用户观察到的既有现象 | **未验证**：按代码，`opentui` 与 `opentui-inproc` 是两棵文件，本地写入对 inproc 宿主不起作用。用户可能经由另一条 provisioning/启动路径观察到该现象；本设计不依赖此现象成立 |
| A4 | `maxDepth` 在 inproc 的钉 1 是安全契约（R2-3），不是顺手值 | 已核：`provision-inproc-profile.mjs:597-612` 注释 + `full-access-inherit` 返工记录 |
| A5 | 无第三方 home patch 覆盖这些行 | 已核：`~/.dsh/cordis.patch.yml` 不存在；若有，宿主写入会抛「overridden by a home patch」 |
| A6 | dsh-base 与 bridge 的 bundle 顺序保证 bridge 装配时 `settings` 已注册（或被懒解析） | 部分：resolver 为懒解析，装配期顺序不构成风险 |

### 2.3 非目标

- 不做 settings 变更的宿主流推送（`settings/document-updated` → bridge 帧）：CapIR 无 watch 方法，扩帧面要走 ADR-0010 评审，且不影响本次 bug。列入后续可选片。
- 不改 `permissionPresets/set` 的放行问题（独立切片，见 `capcontract/types.ts:2312-2344` 上下文与 `docs/architecture/04-ledger-provenance.md:37`）。
- 不做 settings 面板的整页重排（T18 已定结构）。

---

## 3. 选型对比与推荐

### 3.1 候选对比

| 维度 | A. 挂载 settingsController（profile patch） | B. capcontract 白名单扩展 | C1. commands/execute 复用 | **C2. bridge 内 `ctx.settings` 适配器（推荐）** |
|---|---|---|---|---|
| 写入实际路径 | 控制器 → `ctx.settings` → configEditor.edit | 同 A（前提仍是挂控制器） | 需要一个新宿主命令 | `ctx.settings` → configEditor.edit（**同 A 的下半段**） |
| 是否热生效 | 是（volatile commit） | 是 | 是（若命令存在） | 是（volatile commit） |
| CapIR / capcontract | 不变 | **要改生成物** | 不变 | 不变 |
| ledger | **expected 75→83，必须重测 + 重生成 + W8** | 可能要改排除记录 | 不变 | 不变 |
| 握手 75/75 | **变成 83/83，全部历史证据失效** | 不变 | 不变 | 不变 |
| 需要的宿主侧改动 | profile template 加一行 insert | 生成器 + check #16 + 文案并集 | 新增宿主命令（无现成命令可用，见 3.2） | bridge 增加一个 resolver + 一个投影适配器 |
| 额外收益 | credentials/* 3 个方法也变活 | 无 | 无 | 无 |
| 额外风险 | 期望面/台账大范围返工；3 个用不到的 Remote 常驻 | 门禁链全动 | 需要新增宿主插件面，等于自造能力 | 需要在 bridge 内复刻控制器的字段投影（~30 行，可单测） |
| 工期量级 | 天级（重测 + 全 proof） | 天级 | 不成立 | 小时级 |

### 3.2 为什么 C1 不成立

`settings` 写入必须落到 config-editor 的文档；宿主侧**没有**任何现成的 slash command 承载「改任意配置项」（已核：`dsh-command-*` 只有 compact/feedback/goal；`permission-presets` 只注册了 `/permission` 语义）。要复用 `commands.execute` 就必须自己注册一个命令 —— 那等于新增一个宿主自造面，比 C2 更差（多一层命令解析 + 破坏「配置走 settings 域」的一致性）。

### 3.3 为什么 B 不成立

`settings.describe`/`settings.mutate` 在 bridge 里已是 hand-wired id + wire 别名（`index.ts:664-667,1444-1447`），CapIR 里也早有 5 个方法（`capcontract/types.ts:346-350`）。**问题从来不是「没放行」，而是「宿主没挂那个 Remote owner」。** 扩白名单不改运行时行为，只会让同一份 NOT_WIRED 更方便地被调用。

### 3.4 推荐 C2 的具体形态

在 bridge 内新增 **只读/写入适配层**，把宿主 `ctx.settings`（`SettingsForms`）投影成控制器同形接口：

```ts
// 设计契约（非实现）
interface SettingsSurfaceLike {
  describe(): Promise<{ writable: boolean; hasDocument: boolean; namespaces: unknown[] }>
  mutate(ns: string, ops: unknown[], expectedRevision?: number): Promise<void>
}
// resolveSettingsSurface(ctx) := resolveSettingsController(ctx) ?? adaptSettingsForms(ctx.get('settings'))
```

- 解析顺序：优先真控制器（面向未来宿主/远程场景不变），缺失时回退到 `ctx.settings`。
- 适配器职责（全部可纯函数化、可单测）：
  1. `describe()`：`settings.writable` 直取；`hasDocument` 用 `documentPath` 存在性（或 `true`，与控制器 `hasDocument:true` 对齐，二选一需定）；`namespaces` = `describe({redactSecrets:true})` 逐字段投影为 `{ns, revision, schema, value, base, user, applies, secrets[]}`（与 `namespaceView` 同形，`dsh-api-settings-controller/src/index.ts:46-62`）。
  2. 错误分类：必须按 `error.code === 'SETTINGS_CONFLICT'` 判冲突（`dsh-settings/src/index.ts:48-60`）。**注意现存缺陷**：bridge 现在只按 message 正则 `/conflict/i` 判（`index.ts:4486-4492`），而 `SettingsConflictError` 的文案里没有 "conflict" 一词（`dsh-settings/src/index.ts:59`）——控制器路径下冲突也会被误判为 INTERNAL，本次必须一并修。
  3. 拒绝「非 volatile 字段」是宿主自身行为，适配器不吞错、不改写错误语义。

---

## 4. 方案（按层）

### 4.1 数据架构

本次不涉及新的持久化模型，但有三个数据语义需要钉住：

1. **权威值 = 宿主 describe 的 `value`（volatile 表单投影后的值）**。它不是「文件里那行文本」，而是 `fiber.effectiveConfig` 经 volatile 表单投影后的结果（`dsh-settings/src/schema.ts:47-60`、`index.ts:321`）。这是「真实值」唯一正确定义。
2. **`base` 与 `user` 的语义**：`base` = 继承层（bundle 层）解析值；`user` = 本层覆盖值（`dsh-settings/src/index.ts:322-323`）。UI 若要显示「默认 vs 覆盖」，用这两个字段，而不是猜文件。
3. **`unset` 的真实语义是「回落到继承层值」，不是「删除行」**（`dsh-settings/src/index.ts:368-375`）。对 `subagent.maxActiveSubagents` 而言继承层是 dsh-base 行 → schema 默认 **8**，而 inproc 模板当前是 3。**结论：Host 数字行禁用 unset**（空值=不写），否则用户「清空上限」会把上限从 3 抬到 8，属静默安全降级。客户端现有的 `NS_DEFAULTS=1` 兜底也因此作废（`local-config-faces.ts:71`）。

### 4.2 应用架构

#### (a) 对宿主不可用时的降级：三态数据源

`SeamSettingsDocument` 增加显式来源标注（建议命名，实施时按项目术语定稿）：

```ts
type SeamSettingsSource = "host" | "local-file"
interface SeamSettingsDocument {
  writable: boolean; hasDocument: boolean; namespaces: SeamSettingsRow[]
  source: SeamSettingsSource
  /** source 细节：profile 名 / 文档路径 / 失败原因（脱敏后短句） */
  sourceDetail?: { profile?: string; documentPath?: string; reason?: string }
}
```

- `source="host"`：宿主 describe 成功。所有 Host 行可写；`/agents` caps 有值。
- `source="local-file"`：宿主 describe 失败（NOT_WIRED / transport error）。**Host 行一律只读**，数值显示 `n/a` + 原因；`/agents` caps 显示 `n/a`。本地偏好区（config.json）不受影响（`settingsWritable` 现有逻辑已经这么分，`settings-panel.tsx:742-759`，只需把 feed 的来源换掉）。
- 不引入第三种「读本地文件但假装是宿主值」的状态 —— 这正是本次 bug。

#### (b) 客户端 seam 写入路由

```
settings.describe():
  try host("settings.describe") → 客户端字段白名单投影 → {source:"host", ...}
  catch → LocalSettingsStore.describe() → {source:"local-file", sourceDetail.reason}  // 只用于渲染，且 Host 行只读

settings.mutate(ns, ops):
  if (hostAvailable) → "settings.mutate"（原样 path ops；冲突 → {ok:false,conflict:true}）
  else → 拒绝（NOT_WIRED 语义），绝不静默写本地文件冒充成功
```

- 宿主可用性不缓存在布尔量里「一次性判定后长期信任」：每次 describe 重新尝试（成本是一次 stdio round-trip，面板打开/刷新频率下可接受）；失败结果可在面板打开周期内复用，避免逐行重试。
- 字段级白名单保留在客户端，作为 load-bearing 防线（`local-config-faces.ts:52-75` 的 `SETTINGS_NAMESPACES`/`NS_VALUE_FIELDS`）：宿主 describe 可能包含本 TUI 不消费的 volatile namespace，投影规则仍为「白名单 ns 只留允许字段 / 其他 ns 只留 `ns+revision`」。
- `permission.presets` 不会出现在宿主 describe 里（非 volatile，`dsh-settings/src/schema.ts:47-60` 只保留 volatile 字段）。枚举改由已接线的 `permissionPresets.catalog` 提供（`bridge-session-seam.ts:1623-1630`），这是**已有能力**，不是新增。

#### (c) /agents official caps

- 数据源改为同一条「已解析的 settings 文档」（seam 内单一解析器，不新增第二次 wire 调用）。
- `SeamAgentOfficialCaps` 增加 `source: "host" | "unavailable"`（或复用文档 source）。`unavailable` 时渲染 `n/a`，**不显示本地文件数字**。
- `officialCapSettingsRow(key)` 的 Enter 跳转仅在 `source==="host"` 时启用；否则给出「宿主未提供该设置，无法跳转」提示（避免跳到只读行再被拒）。

#### (d) 宿主/本地行分类原则（问题 3 的答案）

**原则 P1（消费方定位）**：写必须落到该值的读取方。
**原则 P2（可服务性由宿主 describe 判定，不由静态包名单判定）**：namespace 出现在 describe（= 有活跃 entry + 至少一个 volatile 字段）即为「宿主消费且可写」；不出现即「本 profile 未挂载 / 无 volatile 字段」，不得显示为可改。
**原则 P3（客户端只保留一份静态表）**：静态表只用于**安全字段白名单**；「哪些行可写」动态来自 describe。
**原则 P4（操作者钉死的行只读）**：profile 模板显式钉住、且绑安全契约的行标只读并说明理由。

按 P1-P4 对 4 个现有 Host 行落位：

| 行 | 判定 | 依据 |
|---|---|---|
| `subagent.maxActiveSubagents` | **宿主通道**（可写，可持久化） | volatile + inproc 模板有该行 |
| `subagent.maxDepth` | **宿主通道字段，但 inproc 下只读** | volatile，但模板钉 1 是 R2-3 安全契约（`provision-inproc-profile.mjs:597-612`）；放开等于重新打开孙代嵌套 |
| `permission.defaultPreset` | **宿主通道**（可写；持久化需 `!!js` 守卫，见 4.3） | volatile（`dsh-permission-presets/src/index.ts:192`）；注意改的是「新会话默认」，不改当前会话已选预设（宿主权威，`research/2026-11-23-ui-batch/00-decisions.md` R4 已记同一裁决口径） |
| `session-log-deepseek.enabled` | **宿主通道**（可写，可持久化） | volatile（`dsh-session-log-deepseek/src/index.ts:59-60`），dsh-base 行存在 |
| 本地 17 行（theme/motion/hints/…） | **保持本地 config.json** | 只有 TUI 进程消费；宿主无对应 namespace |
| describe 里出现但不在白名单的 ns | **只读行（ns+rev）** | 安全投影；文案从「本 TUI 不消费」改为「宿主消费，本 TUI 不编辑」 |

推论：**不再维护「哪些行属于宿主」的静态清单**；`HOST_SETTINGS_WHITELIST` 退化为「字段级投影 + 展示名」表，行是否存在由 describe 决定。这同时自动修掉「宿主有、客户端没列」和「客户端列了、宿主没有」两类漂移。

### 4.3 系统架构

#### (a) 持久化：provisioner 限字段合并

在 `provisionPatch()` 增加一步「模板化合并」：

1. 先按现有规则读当前文件；若与模板字节相等 → 原样返回（现状不变）。
2. 否则**只**从当前文件里按行提取允许持久化的标量（禁止整份 YAML 解析/重序列化 —— 模板含 `!!js` 标签，`yaml.load` 需要自定义 tag，得不偿失）：
   - 允许键（初版）：`subagent.maxActiveSubagents`、`session-log-deepseek.enabled`、`permission.defaultPreset`。
   - **守卫**：若模板中该键对应行含 `!!js`，且当前文件该键仍是同一表达式 → 不合并；若当前文件已变成普通标量（用户改过）→ 合并普通标量，并保留模板的 `!!js` 行作为注释或直接替换（二选一，建议「替换并在 WARN 里说明 escape hatch 本次被用户值覆盖」）。
3. 把提取值替换进新生成的模板文本，再落盘；备份策略不变（差异 ≠ 已知模板时仍需备份）。

副作用与纪律：
- **不要提交非 volatile 字段的差异**：合并只白名单键，避免触发 entry 重挂载（`cordis-plugin-loader/lib/index.js:513-535`）。
- **新增 `session-log-deepseek` 显式行**：该行今天只在 dsh-base 层，宿主写入会在 profile patch 里**新建**一行；模板显式化后持久化合并才有一致的落点。新行**追加在模板末尾**（session-controller insert 之后），以免移动 `provenance.json` 里引用的 `provision-inproc-profile.mjs:566-578` 行号（该行号被生成进 `ledger/ledger.json:355`）。

#### (b) 失败模式（设计需逐条给出用户可见语义）

| 失败 | 用户可见 |
|---|---|
| `ctx.settings` 也不可用（profileContext 缺失的极端情况） | Host 区折叠 + 原因「宿主未挂载配置服务」；本地偏好区照常 |
| 写入被 home patch 覆盖（`dsh-config-editor/src/index.ts:139-141`） | 显式错误行「该项被 `$DSH_HOME/cordis.patch.yml` 覆盖，请在 home patch 修改」，不重试 |
| 冲突（revision 过期） | 现有「重读 + 重试一次」契约保持（`settings-panel.tsx:600-660`），但依赖 4.2(b) 的 code 判定修复 |
| 写入成功但刷新失败 | 沿用「已写入但未刷新」文案，不伪装成功 |
| 值被 provisioner 覆盖（未实现 4.3(a) 时） | 必须显示「本次运行生效 · 重启回落到 profile 值」；实现 4.3(a) 后改为「已生效并持久化」 |

#### (c) 可观测性

- bridge 侧对 settings 适配器加一条 debug 级日志（不记值，只记 `ns`/`op` 数/revision）。
- 面板 identity 行改为两段：「宿主 profile（权威）」+「本地 profile（config.json）」。宿主 profile 名建议由 composition root 从 transport 启动参数透传（`BridgeSessionSeamOptions` 增 `hostProfile?`），**不扩握手帧**。

### 4.4 UI / 交互设计（只到结构层）

1. `/settings` Host 区
   - 行尾来源徽标：`宿主` / `n/a`；只读行徽标 `只读`。
   - 面板 header：`宿主: opentui-inproc · 文档: <path> · 可写` 或 `宿主未连接（只读）`。
   - 值一律来自 describe；`maxDepth` 行附注「由 profile 钉死（安全约束）」。
   - 数字行编辑器不支持空值提交（P4/4.1(3)）。
2. `/settings` 本地区：保持不变，header 标注来自 `config.json`。
3. `/agents` → 限制区
   - 有 `source=host`：显示数字，Enter 跳对应 settings 行。
   - `unavailable`：`n/a` + 一行提示「宿主未提供；改这里不会影响运行时」。
   - 提供刷新动作（打开面板即刷新，不引入轮询）。
4. 通知（用户已拍板要做的「通知通道」部分）
   - 写成功即时 toast/行内反馈分三档：`已生效（运行中）` / `已保存，重启后生效`（非 volatile 字段，本切片不出现）/ `仅本地文件（宿主未连接）`。
   - 不做 settings 推送订阅（非目标）。

---

## 5. 被否备选与理由

| 备选 | 否决理由 |
|---|---|
| **A. 在 inproc profile 挂 `@deepseek-ai/dsh-api-settings-controller`** | 期望面 75→83（settings 5 + credentials 3，`capcontract/types.ts:346-350`；`dsh-api-settings-controller/src/index.ts:86` 构造器内还 `ctx.plugin(CredentialsController)`）。必须重测实测集 + 改 `provenance.json` + `gen-ledger` 重生成 + W8 显式解冻 + 握手/verify70/E2E 全量重跑。收益只是「用官方 Remote owner 代替 30 行适配器」，代价是整条底座门禁链。**收益/代价严重不匹配**。保留为「远程/多客户端时代」的正解，不是当前最优。 |
| **B. capcontract 白名单扩展** | 解决不了 NOT_WIRED（真正的断点是宿主服务未注册）。而且 settings 的两个方法本来就在 wire 表里。若为「加 confirm 闸」而扩，属独立治理议题。 |
| **C1. `commands/execute` 复用** | 宿主无现成配置命令；须自造命令面，等于新增宿主插件能力，破坏「配置走 settings 域」一致性。 |
| **C3. 宿主插件 watch `cordis.patch.yml` 热加载** | 论证不成立：(1) volatile 值的权威在内存 `effectiveConfig` 的 ref，文件 watch 只能触发 reload —— 而任何 reload 的语义等同于 `reconcileProfilePatches`，绕开 `configEditor` 就丢失并发/冲突/备份/回滚（`dsh-config-editor/src/index.ts:87-150`）；(2) 客户端写的 `opentui` 文件根本不是宿主加载的 `opentui-inproc`（事实 1.1#2-4），watch 它毫无作用；(3) provisioner 每启动重写该文件（1.3），watch 会与 provisioner 抢写；(4) 需要在宿主侧装 watcher 插件 → 又是新增插件面。**否决**。 |
| **C4. 客户端写 `opentui-inproc` patch 文件（绕过宿主，直接改宿主读的文件）** | 违反宿主侧优先纪律；且 `configEditor` 内部的 `withFileLock(package.json)`、写入校验、revision 语义全部绕过，多客户端并发必冲突；`!!js` 行会被整行覆盖。**否决**。 |
| **C5. 只在 UI 上标注「重启生效」** | 不解决 bug（用户诉求是生效），且不解决 `opentui`/`opentui-inproc` 错位导致的「永远不生效」。 |

---

## 6. 风险与不可逆点

### 6.1 门禁影响

| 门禁 | 推荐路径（C2 + provisioner 合并） | 说明 |
|---|---|---|
| W8 底座解冻 | **不触发**（但需 oldfox 一票确认） | 改动落在 `packages/bridge/src/index.ts` 的 hostInvoke arm 与 provisioner；`packages/bridge/src/index.ts` 的冻结范围是「三态握手、75/75 面、wired 表查找」（`docs/workflows/w8-base-unfreeze.md` 一、清单）。本次不改握手、不改 `CAP_HOST_WIRED_IDS` 字面量、不改 wire 表 → 建议按 W8 §二.1 先做「是否真的落在冻结面」的书面判定，判定为否后再动手。 |
| CapIR / capcontract / ledger 生成物 | **零 diff** | 无新 id；`settings/describe|mutate` 已在 wired 集合；expected 集不变（不新增 patch 贡献包；新增的 `session-log-deepseek` 显式行属 base closure 已有包）。验收：`check-capcontract` + `gen-ledger` 双跑字节一致。 |
| 握手 75/75 | 不变 | 不新增 Remote 注册 |
| confirm 闸（`CAP_WRITE_CONFIRM_IDS`） | 不变 | settings 是 hand-wired，本来就不在闸内；**若产品要求加闸，是独立切片**（会改 bridge arm 语义 + 文案并集计数） |
| `check-capcontract` #16 / NOT_WIRED 文案并集 | 需复核 | 若只是新增一个 resolver 回退，不新增/删除 NOT_WIRED 文案则不触发计数 |
| 既有测试 | 需同步 | `packages/shell/test/s5-local-faces.test.ts`（LocalSettingsStore 直测，保留）、`subagent-depth-profile.test.ts`（模板文本断言，合并逻辑后需补新用例）、`packages/shell/test/remote-agent-parity.test.ts`（caps 投影）、`packages/tui-base/test/settings-panel.test.ts`、`agents-panel-panelkit.test.tsx`、`packages/bridge/test/capcontract-model.test.ts`（新增适配器用例）、`verify/agents-mount-repro.mjs`（真机装配） |
| real-client-gate / pack | 必跑 | provisioner 与 bridge 都进包，需 `real-client-gate.sh` + pack 收口 |

### 6.2 具体风险

| 风险 | 影响 | 处置 |
|---|---|---|
| **写入被 provisioner 覆盖**（未做 4.3(a)） | 用户设 5 → 重启回 3，二次伤害信任 | 4.3(a) 与客户端路由同批交付；若必须分批，UI 必须明写「重启回落」 |
| `permission.defaultPreset` 的 `!!js` escape hatch 被覆盖 | `DSH_OPENTUI_APPROVAL_GATE=off` 失效 | 合并守卫（4.3(a) 第 2 条）；或该键不参与持久化合并（live-only + 文案） |
| 把 `maxDepth` 放开 | 重新打开孙代嵌套（R2-3 回归） | inproc 下只读（P4） |
| `unset` 抬到宿主默认 8 | 静默放宽并发上限 | Host 数字行禁 unset（4.1(3)） |
| home patch 覆盖 → 写入必失败 | 用户看到无从下手的报错 | 显式文案 + 指路（4.3(b)） |
| 冲突码判定仍走 message 正则 | 「重试一次」失效，用户看到 INTERNAL | 一并修（按 `error.code`） |
| bridge 适配器与控制器投影漂移 | 未来挂上控制器后行为不一致 | 适配器输出与 `namespaceView` 同形；单测锁定字段集；注释指明保留理由 |
| 下调 `maxActiveSubagents` 不影响已在跑的子代理 | 用户以为「立即收窄」 | UI 文案「新派发按新值；已在运行的不受影响」（`manager.ts:718` 只在 reserve 时读） |
| 会话中断 | 无 | volatile-only 写不重挂载（1.2）；纪律：合并与写入都不得引入非 volatile 差异 |

### 6.3 不可逆点

- 代码层面全部可回滚（无 schema/协议变更）。
- **语义不可逆**：一旦客户端不再写 `opentui/cordis.patch.yml`，任何仍依赖该文件的下游（`verify70`、`e2e`、其它启动路径）会失去「本地值」这一事实来源。落地前必须枚举这些消费者并给出替代断言（建议：`verify70` 改为断言宿主 describe 的值，而非文件文本）。
- **习惯不可逆**：用户手工编辑 `opentui/cordis.patch.yml` 的旧习惯将不再生效；需要在 CHANGELOG 与 `/settings` 帮助里明确「权威文档是宿主 profile 的 cordis.patch.yml」。

---

## 7. 实现步骤切分（每步一个 concern，≤30 分钟）

依赖顺序：S0 → S1 → S2 → {S3, S4} → S5 → S6 → S7 → S8

| 步 | concern | 产出 | 依赖 | 验收（当步即可验） |
|---|---|---|---|---|
| **S0** | 冻结面判定 | 一页判定：bridge settings arm 属「hostInvoke 臂」而非「握手/完整性」；provisioner 属 profile 模板、非生成物 | — | oldfox 书面一票；`docs/architecture/02` round log 记一条 |
| **S1** | bridge 适配器（纯逻辑） | `settings-forms-adapter.ts`：describe 投影、unset/冲突码映射；纯函数 + 单测（synthetic `SettingsForms` 桩） | S0 | 单测覆盖：仅 volatile 字段、secret 只出 `{path,set}`、冲突按 `code` 判、home-patch 覆盖错误原样上抛 |
| **S2** | 接线 resolver | `resolveSettingsSurface = controller ?? adapt(ctx.get('settings'))`；`index.ts` 的 settings 分支改用它（≤15 行 diff）；bridge 单测 | S1 | 只有 `ctx.settings` 时 `settings.describe/mutate` 成功；两者皆无仍 `NOT_WIRED` |
| **S3** | provisioner 持久化合并 | `provisionPatch()` 限字段合并 + 模板末尾追加 `session-log-deepseek` 行；模板文本测试更新 | S0（可与 S1/S2 并行） | 单测：用户改 5 → 重跑 provisioner → 仍 5；`!!js` 行未被普通值冲掉；行号引用未移动（566-578 不变） |
| **S4** | 客户端 settings 路由 | seam `settings.describe/mutate` 宿主优先 + `source` 字段 + 白名单投影 + identity 拆两段；fake transport 单测 | S2 | 宿主可用→`source:"host"` 且值来自 wire；宿主失败→`source:"local-file"` 且 mutate 拒绝；secret/越权 ns 不出帧 |
| **S5** | `/agents` caps 真值 | `SeamAgentOfficialCaps.source`；caps 走同一解析结果；Enter 跳转按 source 门控；i18n | S4 | host 时数字正确；unavailable 时 `n/a` 且不可跳；原 `agentOfficialCaps` 测试更新 |
| **S6** | 面板显示与通知 | settings 面板行来源徽标、header 双 profile、数字行禁空、三档反馈文案；i18n | S3+S4+S5 | 面板测试断言徽标/`n/a`/禁空；无任何「本地值冒充宿主值」路径 |
| **S7** | 门禁阶梯 | `bun test` → `check-capcontract` → `gen-ledger` 双跑字节一致 → `real-client-gate` → pack | S6 | 生成物零 diff；gate 全绿 |
| **S8** | 真机验收 + 文档 | 手动：改 `maxActiveSubagents` 3→5，派发 5 个 → 5 个都起；重启 → 仍 5；`/agents` 与 `/settings` 数字一致；ADR 一条 + W5 prereg 证据 | S7 | `.proof/<slice>/` 证据文件（命令 + 输出 + 时间戳） |

补充纪律：
- S3 与 S4 若分批合入，S6 必须先以「重启回落」文案收口，不可先上 S4。
- 每步独立 commit；S1/S3 可并行（不同文件、无耦合）。

---

## 8. 自评审

### 8.1 薄弱点

1. **适配器复刻官方投影**：`namespaceView` 的字段集可能与宿主未来版本漂移。缓解：只投影我们需要的字段 + `revision/schema/value/base/user/secrets`，缺失即缺失（不猜）；单测用真实 `dsh-settings` 的 describe 输出形状做快照。
2. **provisioner 行级合并的脆弱性**：extract-by-line 依赖模板形状稳定（缩进、`- id:` 块边界）。缓解：复用 `LocalSettingsStore` 已验证的行级读写思路；新增负例测试（手改缩进/重复键 → 不合并且 WARN，不产出坏 YAML）。
3. **`hasDocument` 语义**：控制器硬编码 `true`（`dsh-api-settings-controller/src/index.ts:100`），适配器可选「真文件存在性」或「跟随控制器」。两种都对，但要选一个并写进契约，否则测试会漂。
4. **宿主可用性判定不缓存**：面板每次打开一次 round-trip，若 transport 抖动会闪变「只读」。缓解：单次打开周期内锁定首次结果。

### 8.2 隐藏耦合

- `settings-panel.tsx` 的 `buildHostItems` 依赖 `document.namespaces` 里存在 `subagent`/`permission`；宿主 describe 的 ns 名就是 entry id（`subagent`、`permission`、`session-log-deepseek`），与模板行 id 一致（`provision-inproc-profile.mjs:545,608`）——**这条一致性是隐式契约**，模板改名即面板空行，需在 S3/S6 各加一条断言。
- `permissionCatalog`（`permissionPresets/catalog`）与 `settings.describe` 的 `permission` ns 是两个来源；若 catalog 缺失而 ns 在，枚举回落到 schema enum（现逻辑），变更后依然成立。
- `LocalAgentsFace` 目前同时承担「agent 名单」与「official caps」；改 caps 源时不要顺手把名单读取也切到宿主（`/agents` 名单宿主侧无对应面）。

### 8.3 单点故障

- `ctx.get('settings')` 是唯一写入口。它 disabled 的唯一条件是缺 `profileContext`（dsh-base 行条件）。若未来 launcher 以非 profile 方式启动，宿主通道整体失效 → 面板退化为全只读（可接受、且诚实）。
- provisioner 是唯一持久化点。它被跳过（如用户手工跑旧版本 provisioner）→ 值不持久，但 live 仍生效。

---

## 9. 开放问题（各附推荐答案）

| # | 问题 | 推荐 | 理由 |
|---|---|---|---|
| Q1 | inproc 下 `subagent.maxDepth` 是否放开写？ | **不放开**（只读 + 说明） | 模板钉 1 是 R2-3 安全契约；放开即回归 |
| Q2 | `permission.defaultPreset` 是否进持久化合并？ | **进，但带 `!!js` 守卫** | 用户改过的值应保留；未改时保留 escape hatch。若团队认为 env escape hatch 优先级更高 → 改为 live-only + 文案（次优） |
| Q3 | Host 数字行的「清空」如何定义？ | **禁用清空** | 宿主 unset = 回落继承层（8），属静默放宽 |
| Q4 | 宿主不可用时是否显示「本地文件值 + 未生效」？ | **不显示数字** | 显示非权威数字正是本次 bug |
| Q5 | 是否给 settings 写加 confirm 闸？ | **不加**（本次） | 四行皆上限/开关类，非破坏性；加闸需改 hand-wired arm 语义与门禁计数，属独立治理片 |
| Q6 | 是否顺带修 `settings/conflict` 只按 message 判定？ | **顺带修** | 是同一函数的正确性缺陷，不做则「重试一次」形同虚设 |
| Q7 | 是否需要 settings 推送订阅？ | **本次不做** | 无 CapIR watch 方法，扩帧面需 ADR-0010 评审；不影响本 bug |
| Q8 | `verify70` 等依赖 `opentui` patch 文本的断言如何迁移？ | 改为断言宿主 describe 值 | 权威源变了，断言必须跟随；否则会锁死「骗人」链路 |

---

## 10. 附：建议 ADR

建议新增 ADR（编号实施时取号），标题：**「/settings 的权威值属于宿主，客户端不再代理写 profile 文件」**。要点：背景（两棵 profile 错位 + provisioner 覆盖）、决策（bridge 内 `ctx.settings` 适配器；宿主 describe 为唯一权威；provisioner 限字段合并）、后果（无 CapIR 变更；宿主不可用时全只读；`opentui` 手工编辑不再生效）。
