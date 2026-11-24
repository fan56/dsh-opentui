# 子票：用户配置放在哪

- 类型：grilling（需用户拍板）
- 阻塞：其它所有工作（闸门）
- 关联：地图 `2026-11-24-inproc-only-map.md`；证据 `research/2026-11-24-inproc-only/01-provisioning.md` §D、`03-references-and-gates.md` §1.5/§6

## Question

删掉老 `opentui` profile 后，用户配置（settings、config、provider keys、presets、快捷键）的落点定在哪？

## 现状

- 客户端本地配置面以 `DEFAULT_PROFILE='opentui'` 为目录写文件：`bridge-session-seam.ts:2273,2278-2280`、`local-config-faces.ts:231-232,333,498-499,608-609`。实际文件是 `~/.dsh/profiles/opentui/{cordis.patch.yml,config.json,provider-keys.json,...}`。
- inproc provisioner **每轮整体重写**自己的 `cordis.patch.yml`（`provision-inproc-profile.mjs:1275-1322`）。直接把配置面指过去 = 用户设置被覆盖。

## 候选

| 方案 | 做法 | 代价 | 风险 |
|---|---|---|---|
| A. 独立配置目录 | 新目录（如 `~/.dsh/opentui-client/`）承载 settings/config/keys/presets；一次性从老 profile 抽取迁移；provisioner 完全不碰 | `LocalSettingsStore`/`LocalConfigStore`/`LocalPresetFace`/`LocalLoginFace` 改路径 + 一次性迁移脚本 + 回滚方案 | 低：与 provision 写权彻底解耦；老目录可保留只读 |
| B. 指进 inproc profile | 客户端继续读写 `profiles/opentui-inproc/`，provisioner 改为「只重写托管段、保留用户段」（类似 append-system 的 managed marker） | 需给 patch 加段标记协议，provisioner 重写逻辑改造；一处写坏就丢用户配置 | 中高：写权冲突面长期存在 |
| C. 官方 settings 面 | 用 dsh base 的 `config-editor`/`settings` + 挂 `settings-controller` 行（R4 路径），配置落 dsh 官方位置 | 需在 inproc 挂 controller 行 + bridge 增 settings 通道；改动最大 | 中：与上游对齐最好，但工期最长、回归面最大 |

## 推荐

A。理由：配置面本来就是纯本地文件 I/O（`02 §2`），换目录是一行参数级的改动；B 会把「每轮重写」这个硬冲突永久留在系统里；C 的正确性依赖 bridge 增加 settings 通道，属于另一个项目。

## 决议记录

**2026-11-24 用户拍板（profile 名后经用户改定）：**

0. **profile 名定为 `opentui-monday`（2026-11-24 已定稿为长期名）**。目录 `$DSH_HOME/profiles/opentui-monday`，`opentui` 与 `opentui-inproc` 两个旧名都退役。
   - 代价等同「新名」方案：改名面 106 处 + 配置从 `profiles/opentui` 迁移（`config.json`/`keybindings`/`provider-keys`/`presets`/patch 用户段）。
   - 名字是分发契约且**用户可见**：welcome hero 树根标签（`v2-entry.tsx:1940`）、宿主 User-Agent 后缀（dsh `profile-boot.ts:270-284`）。
   - **评审修正（oldfox）**：profile 名**不参与**握手/指纹（`bridge.hello` 只回 protocolVersion/bridgeVersion/hostVersion/capabilities，`bridge/src/index.ts:4618-4642`；`bundle-fingerprint` 只有 name/version/sha256），契约风险只在「目录名 + 用户脚本/patch 条件」。
   - **评审修正**：改名必须放最后一个提交，且与 kill 路径退役原子提交（`launcher.mjs:42,452-455`、`safe-kill.ts:31` 会把 `--profile opentui` 的 bridge 子进程当成可杀宿主）。

1. **配置落新 profile 的 `cordis.patch.yml` 用户段**：provisioner 改为「托管段重写、用户段保留」。

> **旧方案描述作废（oldfox P0-1/P0-2）**：不能用「注释标记 + 字节比较」，也不能靠用户段修掉 `/settings` 覆盖问题。正确形态见下。

### 分段协议（按评审重写，实施依据）

| 项 | 要求 |
|---|---|
| 边界 | 托管段 = 模板里固定 row-id 集合的顶层行；用户区 = 其余全部顶层行 + 注释 + 空行，**原字节原顺序**保留 |
| 切分 | 按 `^- ` 切顶层块 + id 匹配；**禁止 marker 语义**（config-editor reset 会删掉标记后一行并带走 `commentBefore`，`dsh-config-editor/src/index.ts:110-141`） |
| 漂移判定 | 托管行**语义等价**即不写；不比较字节（config-editor 会折行长行，字节永不相等） |
| 备份 | 只在 revision 未知或用户区不可解析时才 `.bak`；不做「每次 WARN 覆盖」 |
| 运行时值 carry | 弃用 3 条正则，改为**模板行上的整块 config 三方合并**（base=模板投影 / current / next，见 06 §4）；判定按「值差」而非键白名单：`!!js` 表达式与模板相同即视为未改，literal 且与模板不同即视为用户值 |
| rebuild / 侧车 | 侧车 `.patch-ownership.json` 存基线投影；**不写的轮次也要在锁内补写侧车**（终审 N1：否则侧车丢失后旧默认值会被永久保留且无 WARN） |
| 写权 | 运行期只允许宿主 config-editor 写；客户端三个 patch 写手全部收口（`LocalSettingsStore.mutate` 已死、`LocalLoginFace.registerRoute` 改造、`append-system` 随 HTTP boot 一起退役），并加 `no-client-patch-writers` 门禁 |
| 失败面 | 结构切分/解析失败 ⇒ 不写 + 退出非 0（fail-safe，不复原文件）；重复 id ⇒ 值取「最后一个含该键且 name 匹配」的出现，写回保留第一次位置 |
| `providers` 子键合并 | `llm-pi-ai.providers` 按子键三方合并：模板 provider 权威、用户新增的保留、用户改模板字段按 merge3；**写入通道 = 宿主 `settings.mutate`**（2026-11-24 拍板：inproc 需挂 `settings-controller` 并扩 `bridge-settings-route.ts` 白名单，与 `/settings` 同一条官方通路） |

### 对「3 字段缺陷」的修正（oldfox P0-2 + 2026-11-24 实测 C）

票面原话「只保留 3 个字段导致 `/settings` 其它写入被覆盖」**把影响说大了**；实测更进一步：
- 可写面被 seam 白名单限定为 3 命名空间（`bridge-settings-route.ts:26-31`），而 `patch-runtime-merge` 的 carry 列表**恰好就是这三个字段** → **今天不存在可达的设置丢失路径**；
- `subagent.maxDepth` 在 UI 是只读（`read-only · pinned by the profile to 1`）；
- 装上 `dsh-approval-policy` 后其行也是只读（`read-only · not consumed by this TUI`），**300 秒窗口今天设不进去**（`research/2026-11-24-inproc-only/12-verifyC-settings-reachability.md`）。

因此本设计的动机改为：**为即将扩大的写面做准备**（`dsh-approval-policy.{windowSeconds,...}`、`llm-pi-ai.providers`），而不是修现存 bug。实施时必须**同时**改两张表：`bridge-settings-route.ts` 的 `SETTINGS_NS_VALUE_FIELDS` 与 `local-config-faces.ts` 的 `NS_VALUE_FIELDS`（文件注释要求两表同步），并让新键进 carry。

## 由此产生的改动（供实施引用）

- **改名面**：`grep` 合计 106 处（去历史文档/`.proof` 后）。生产代码 2 处真引用 `bridge-transport.ts:71,188`；脚本 `real-client-gate.sh:181-182,243,263`；CI `ci.yml:237`；测试 4 个文件；`.proof/*` 历史产物不动。
- **配置迁移**：`profiles/opentui` → `profiles/opentui-monday` 的 `config.json`、`keybindings`、`provider-keys`、`presets`、以及 patch 用户段。
- **旧目录处置**：`opentui`（52M，20 bundles）与 `opentui-inproc`（2.3M）都退役；迁移完成后保留一版兼容提示，不自动删除。
- **分发契约**：ADR-0009 把 `opentui-inproc` 名记为契约；改名 + 新名都属契约变更，需要 provision 时处理存量两个旧目录（提示/归档）。
- **回退安全**：旧版 dsh-opentui 只认 `opentui`（bin step 3/6a，`01-provisioning.md` §2.1），新旧版本目录互不覆写；这是选新名（而不是留 `opentui`）的主要收益。


