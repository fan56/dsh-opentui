# inproc companion version range 兼容性调查（2026-11-24）

> 只读调查。未改源码/测试/CI，未 git add/commit/stash/checkout/reset，未跑全量测试。
> 调查对象：`feat/inproc-only-1124` 分支上 default roster 11 个 companion 的 `declaredRange` 是否可安全升到 npm `latest`。
> 重点是 oldfox 复审指出的两个跨 minor 过期项：`dsh-ask-router`（^0.7.0 vs 0.8.0）与 `dsh-model-sync`（^0.9.0 vs 0.10.0）。

## 0. 结论先行

两个包都可以**直接升 range**，无需改宿主侧契约：

- `dsh-ask-router@0.8.0`：**SAFE**。零 surface 仍 `next()` 让位，D2 的「运行时 NO CHANGE」前提成立；`{ prepend: true }` 被宿主 cordis 4.1.0 支持。
- `dsh-model-sync@0.10.0`：**SAFE**。peerDependencies 相对 0.9.0 完全未变；新增 `opencode.go.*` 配置默认 `enabled:false`、scheduler 启动即返回；无新 bridge/CapIR/RPC 需求。

推荐 range：`^0.8.0` 与 `^0.10.0`。0.7.x / 0.9.x 没有安全中间版可选（各自最后版本就是当前声明的下限）。

---

## 1. range 单一来源与 11 项范围对账

**源文件**：`/Users/qingguee/repo/dsh-opentui-wt-inproc-only/packages/shell/scripts/lib/inproc-companions.mjs:35-113`（`COMPANIONS[].declaredRange`）。
**默认 11 项名单**：`/Users/qingguee/repo/dsh-opentui-wt-inproc-only/packages/shell/scripts/lib/companion-policy.mjs:4-16`（`DEFAULT_COMPANION_IDS`）。

`queryDistTagLatest` 取 npm `dist-tags.latest`（同文件 `:217-231`）；`decideCompanionInstall` 只在**跨 major 或 0.x 跨 minor**时跳过（`:195-202`），所以同 minor 的 patch（0.8.0 → 0.8.1）仍会安装。

| # | 包 | 当前 range | npm latest | 在 range 内? | 证据 |
|---|---|---|---|---|---|
| 1 | `@aiwayds/dsh-subagent-registry` | `^0.21.0` | 0.21.0 | 是 | `npm view dist-tags.latest` |
| 2 | `@aiwayds/dsh-ask-router` | `^0.7.0` | **0.8.0** | **否（跨 minor）** | 同上；catalog:46 |
| 3 | `@aiwayds/dsh-approval-policy` | `^0.3.0` | 0.3.0 | 是 | 同上；catalog:53 |
| 4 | `@aiwayds/dsh-llm-net-retry` | `^0.8.0` | 0.8.0 | 是 | 同上；catalog:60 |
| 5 | `@aiwayds/dsh-model-sync` | `^0.9.0` | **0.10.0** | **否（跨 minor）** | 同上；catalog:67 |
| 6 | `@aiwayds/dsh-llm-stats` | `^0.9.0` | 0.9.0 | 是 | 同上；catalog:74 |
| 7 | `@aiwayds/dsh-mcp-adapter` | `^0.8.0` | 0.8.1 | 是（同 minor patch） | 同上；catalog:81 |
| 8 | `@aiwayds/dsh-vault` | `^0.8.2` | 0.8.2 | 是 | 同上；catalog:88 |
| 9 | `@aiwayds/dsh-web-search-anysearch` | `^0.9.0` | 0.9.0 | 是 | 同上；catalog:95 |
| 10 | `@aiwayds/dsh-topics-memory` | `^0.26.0` | 0.26.0 | 是 | 同上；catalog:102 |
| 11 | `@aiwayds/dsh-cron` | `^0.7.0` | 0.7.1 | 是（同 minor patch） | 同上；catalog:109 |

=> oldfox 的 9/11 结论复现：仅 ask-router、model-sync 被 `cross_minor` 跳过。其余 patch 漂移（mcp-adapter 0.8.1、cron 0.7.1）不影响安装。

---

## 2. 宿主 pin 基线（用于 peer 对照）

| 事实 | 值 | 证据 |
|---|---|---|
| 宿主兼容窗口 | `>=0.2.2-rc.3 <0.3.0`，floor `0.2.2-rc.3` | `packages/shell/scripts/lib/host-compat.mjs:32,103-104` |
| CI pinned 宿主 | `@deepseek-ai/dsh@0.2.2-rc.3` | `.github/workflows/ci.yml:158,283-284` |
| fresh-home 校验宿主 | `0.2.2-rc.5` | `scripts/verify-fresh-home-provision.mjs:467,486` |
| 宿主 cordis | `~4.1.0` | `npm view @deepseek-ai/dsh@0.2.2-rc.5 dependencies` |
| 宿主 schemastery | `~3.19.0` | 同上 |

---

## 3. 结论表（按包）

### 3.1 `@aiwayds/dsh-ask-router`

| 项目 | 结论 |
|---|---|
| 当前 range / latest | `^0.7.0` / `0.8.0`（发布 2026-11-19T12:44:02Z） |
| peerDependencies | `@deepseek-ai/dsh >=0.2.0-rc.2`（optional）；与 0.7.0 **完全相同** |
| engines | `node >=22.19.0`（未变） |
| exports / API | `main: lib/index.js`，无 exports map；新增导出 `raceAsk`，`routeAsk` 增加可选第三参；无删除/改名 |
| 与当前宿主兼容 | **SAFE** |
| 证据 | 见 §4.1 |
| 推荐 range | `^0.8.0` |

### 3.2 `@aiwayds/dsh-model-sync`

| 项目 | 结论 |
|---|---|
| 当前 range / latest | `^0.9.0` / `0.10.0`（发布 2026-11-23T15:31:46Z） |
| peerDependencies | cordis `^4.0.2`、schemastery `^3.18.4`、`dsh-commands` / `dsh-credentials` / `dsh-launch-environment` / `dsh-settings` 均 `>=0.2.0-rc.2`；全部 optional；与 0.9.0 **逐字相同** |
| engines | `node >=22.19.0`（未变） |
| 与当前宿主兼容 | **SAFE**（默认路径；显式启用 go/zen 时的前提条件见 §4.2） |
| 证据 | 见 §4.2 |
| 推荐 range | `^0.10.0` |

---

## 4. 详细证据

### 4.1 ask-router 0.8.0 是否仍不认领 `userQuestions`

解包路径：
- 0.8.0：`/private/tmp/w27-askrouter/unpacked/package/`
- 0.7.0（基线）：`/private/tmp/w27-tarballs/askrouter-0.7.0/unpacked/package/`

| 事实 | 证据 |
|---|---|
| 0.7.0 `inject=['userQuestions']` 只是**依赖**该服务；提供的是 `askSurfaces`；注册 waterfall 应答者；**零 surface 时 `next()` 让位** | 0.7.0 `lib/index.js:106-121` |
| D2 前提由源码确立：router 不提供/抢占 `userQuestions` 服务槽；默认 roster 零 surface，questions 落到 bridge；bridge-first / router-first 两种顺序均安全，运行时 NO CHANGE | 本仓 `tickets/2026-11-24-inproc-ask-slot-arbitration.md:7-17,41-56` |
| 0.8.0 **保留**同一让位语义：listener 仍是 `surfaces.length === 0 ? next() : raceAsk(...)` | 0.8.0 `lib/index.js:249-252` |
| 0.8.0 注册改为 `{ prepend: true }`，目的是抢在宿主 client bridge 之前；注释明确「with zero surfaces we step aside via next() exactly as before」 | 0.8.0 `lib/index.js:239-252` |
| `prepend` 在宿主 cordis 4.1.0 可用 | `node_modules/.pnpm/@deepseek-ai+cordis@4.1.0_*/node_modules/@deepseek-ai/cordis/src/events.ts:142`（`options.prepend ? 'unshift' : 'push'`）；`lib/index.js:810` |
| D2 的「router-first + 零 surface」已有回归用例，正是 `prepend` 后的实际顺序 | `tickets/2026-11-24-inproc-ask-slot-arbitration.md:65-70`（`packages/bridge/test/ask-answerers.test.ts`） |
| 两侧注册链 | bridge `ctx.on('user-questions/request', onUserQuestionsRequest)` 在 `packages/bridge/src/index.ts:3731-3744`；router `apply()` 在 0.8.0 `lib/index.js:235-253` |
| bundle patch 两版**逐字相同** | 两版 `cordis.patch.yml`（均 `- insert: dsh-ask-router`，无 config 读取） |
| README 两版**逐字相同** | 两版 `README.md`（`diff` 无输出） |

**0.7.x → 0.8.0 行为 diff（仅新版多出的面）**：新增 `raceAsk`（0.8.0 `lib/index.js:114-186`）——当**存在** surface 时把 surface 分支与下游 `next()` 分支并行竞速、先到先得、下游胜出时用 `settled(request, 'downstream answerer')` 收起 surface，并加一次性 gate 防僵尸回答；`routeAsk` 的落选收起改走同一 race-scoped dispatcher。默认 roster 无 surface（`askSurfaces` 全仓 0 消费者，见 D2 票 `:17`），因此这条新路径在 inproc 下**不触发**。对宿主 cordis 的唯一新要求是 `on(..., { prepend:true })`，宿主 4.1.0 已支持。

**判断**：D2 前提在 0.8.0 仍成立，无需改 bridge answerer、无需新增仲裁/让位逻辑。`^0.8.0` 可直接升。

### 4.2 model-sync 0.10.0 的宿主面 / 配置 schema

解包路径：
- 0.10.0：`/private/tmp/w27-modelsync/unpacked/package/`
- 0.9.0（基线）：`/private/tmp/w27-tarballs/modelsync-0.9.0/unpacked/package/`

**peer 与运行时依赖**
- 两版 `package.json` 的 `peerDependencies` / `peerDependenciesMeta` 逐字相同；无新增 peer 地板。
- 0.10.0 编译产物 `lib/index.js:18-38` 的运行时 import 只有 `@deepseek-ai/schemastery` + 本包内部模块。`dsh-settings` / `dsh-credentials/types` / `dsh-commands` 均为 `import type`（`src/index.ts:27,32,35`），emit 后擦除，不会在宿主缺包时抛模块解析错误。
- 版本下限对照：宿主 0.2.2-rc.3/5（cordis 4.1.0、schemastery 3.19.0）满足 cordis `^4.0.2`、schemastery `^3.18.4`、各 `dsh-*` `>=0.2.0-rc.2`。

**所需宿主服务（均已在 inproc/base 具备）**

| 服务 | 用途 | 是否 inproc 具备 |
|---|---|---|
| `settings` | 默认 settings-mode 写入（`inject=['settings']`，`src/index.ts:132`） | 是，dsh-base 挂载 |
| `commands` | `/model-sync`、`/opencode-status` 注册（`src/index.ts:1336-1416,1421-1450`）；0.9.0 已用同一机制（0.9.0 `src/index.ts:566-588`） | 是，dsh-base 有 commands |
| `llm` / `piAiCatalog` | 仅 deprecated overlay 模式使用（`:615-637`），缺失时返回降级文案不抛错 | 是/或缺均不阻塞 |
| `credentials` + `launchEnvironment` | **仅 go/zen 显式启用时**解析 key（`provider-native.ts:106-143`），且带 env 回退 | 是（base credentials-local + app-boot launchEnvironment） |
| `profileContext` | **仅 go 迁移账本**需要（`opencode-go-profile.ts:46-53`）；inproc profile 名 `opentui-inproc` 由宿主注入 `ctx.profileContext.name` | 是 |

**没有新增 bridge / CapIR / RPC 契约**：0.10.0 的新命令走宿主 `commands` registry（与 0.9.0 同一机制），不经过 stdio bridge；`credentials.resolve(ref)` 是宿主进程内 cordis 服务方法，不是 bridge 上的 `userQuestions`/`approval` RPC；`piAiCatalog` 只存在于已废弃的 overlay 降级路径。本仓 `ledger/` / `capir/` / `packages/bridge` 无需改动。

**配置 schema 变化（全部为新增、默认值零行为）**

- 0.10.0 `Config` 新增 `opencode` 对象（`src/index.ts:219-248`），原有字段一字未改（对比 0.9.0 `src/index.ts:87-131`）：
  - `opencode.go.enabled` 默认 **false** → go sync/迁移/账本/定时全部关闭；
  - `opencode.go.intervalMinutes` 默认 60（floor 15，`opencode-go-source.ts:19`）；
  - `opencode.go.ref` / `modelsUrl` / `routes` / `adoptExisting` / `pinnedModels` / `confirmRemovals` 均为默认零写入；
  - `opencode.zen.enabled` 默认 true，但 `mode` 默认 `login-only`、`modelsUrl` 无默认 → 无列表端点、不触发写。
- `goScheduler.start()` 在 `enabled=false` 时直接返回、不 arm 定时器（`opencode-go-scheduler.ts:181-187`）；`start()` 在 `apply()` 中调用（`src/index.ts:1053-1064`），因此默认启动路径与 0.9.0 一致。
- `credentials/reference-updated` / `settings/document-updated` 监听为新增，但都是宿主已有事件名（`src/index.ts:1058-1063,1282-1302`），0.9.0 已订阅 `settings/document-updated`（0.9.0 `src/index.ts:541-551`）。
- 顶层 `intervalMinutes`（240）/ `startupDelaySeconds`（5）语义未变（两版 `apply()` 相同：`src/index.ts:1280-1281` vs 0.9.0 `:539-540`），即默认 5s 后仍会跑一次 pi.dev settings-mode round —— 这是 0.9.0 既有行为，不是 0.10.0 新增。

**非阻塞性内容漂移（供决策，不是 host contract）**
- 0.10.0 的 builtin snapshot 删除 `glm-5.2`、加入 `hy4` / `hy4-flash-free` / `qwen4-max` / `longcat-2.5-free`（`src/builtin-catalog-snapshot.ts` diff）。inproc 模板当前 pin 了 `glm-5.2`（`provision-inproc-profile.mjs:329-333`）且缺 `hy4-flash-free` / `qwen4-max`（见 `research/2026-11-24-inproc-only/05-companion-parity.md:86-94`）。启用 model-sync 默认 settings-mode round 后模型表可能与模板漂移；这是内容一致性问题，不阻塞 range 升级，是否补齐模板由产品决定。
- `remote-catalog.ts` 新增跨进程锁（`tmpdir()` 下的 `*.dsh-store.lock`，fail-closed 超时 2s），只影响 `models-store.json` 写入，无宿主 API 依赖。

**判断**：`^0.10.0` 可直接升，无需改宿主侧契约；go/zen 为显式 opt-in，启用时需保证宿主有 `profileContext.name`（本仓 profile 名 `opentui-inproc` 已注入）与 credentials ref，二者宿主均已具备。

---

## 5. 中间版本与推荐写法

| 包 | 版本序列（npm `time` 字段） | 最后安全中间版 | 推荐 range | 理由 |
|---|---|---|---|---|
| ask-router | `0.7.0`(2026-11-06) → `0.8.0`(2026-11-19)，无 0.7.1 | 无（`^0.7.0` 已锁死 0.7.0） | **`^0.8.0`** | 0.8.0 已验证 SAFE；保持 catalog 的「0.x minor = breaking boundary」守卫语义（同文件 `:198-202`） |
| model-sync | `0.9.0`(2026-11-06) → `0.10.0`(2026-11-23)，无 0.9.1 | 无（`^0.9.0` 已锁死 0.9.0） | **`^0.10.0`** | 0.10.0 peer 未变、新配置默认零行为；无中间版可退 |

改动范围仅两处：`packages/shell/scripts/lib/inproc-companions.mjs:46` 与 `:67` 的 `declaredRange` 字符串。其余 9 项不需调整（同 minor patch 不会被 `cross_minor` 跳过）。

---

## 6. 未验证 / 边界

- 本次为只读源码 + npm registry 调查，未真机启动 `bridge + ask-router 0.8.0 + model-sync 0.10.0` 的宿主；`prepend` 顺序的零 surface 安全性由宿主 cordis 源码 + D2 既有回归用例覆盖，非新跑 e2e。
- 0.10.0 的 `opencode.go` / `zen` 显式启用路径（迁移 plan/apply/rollback、`/opencode-status`、跨进程账本锁）未做真机演练；默认 `enabled=false` 下不触发。
- 模型表漂移（glm-5.2 等）是否影响用户需查会话历史，本轮未做。
