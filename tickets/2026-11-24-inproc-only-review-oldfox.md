# oldfox 评审记录（2026-11-24）

- 评审对象：map + D1–D6 + `research/2026-11-24-inproc-only/01…05`
- 裁定：**GO-WITH-CONDITIONS**。方向（单 profile、去 HTTP、单版本完成）成立；票面描述的「用户段协议」按原样实现会继续丢配置，首次就地改造不可逆，另有 3 条事实错误。
- 结论：P0-1…P0-5 必须先补设计，否则不开工。

## P0（开工前必须解决）

| # | 问题 | 关键证据 | 要求 |
|---|---|---|---|
| P0-1 | 「用户段 = 注释标记 + 字节比较」会失效：宿主 config-editor 对整份文件 `parseDocument → String` 重写，长行折行 → 字节永不等于模板 → provisioner 每次走 `.bak` + WARN + 覆盖；且 config-editor 的 reset 会 `delete(index)` 删掉标记后一行并带走 `commentBefore` | `dsh-config-editor/src/index.ts:110-141`；`provision-inproc-profile.mjs:1306-1315`；inproc 目录已有 3 个 `.bak-*` | 边界改为「模板 row-id 集合 vs 其余顶层行」，原字节/原顺序；漂移判定改语义等价；解析/切分失败 = 不写 + WARN（fail-safe） |
| P0-2 | 「用户段」修不掉 D1 声称的缺陷：`/settings` 写的是**托管行**（`config-editor.edit` 对同 id 最后一行 `setIn(['config'])`），用户段不参与；实际可写面被 seam 白名单限定为 3 命名空间 / 5 字段，今天真正会被覆盖的只有 `subagent.maxDepth` | `bridge-session-seam.ts:1458-1483`；`bridge/src/index.ts:1267-1290`；`dsh-config-editor/src/index.ts:124-130`；`bridge-settings-route.ts:26-30`；`patch-runtime-merge.mjs:96-160` | 三选一写进票面：(a) 托管行不带 `config:` (b) 全字段语义 merge 替代 3 条正则 (c) 托管行语义未变则不写。单靠用户段替代不了 |
| P0-3 | 全新机器上「profile 创建者」缺 `initProfile` 的 pnpm 契约：inproc provisioner 只 `mkdirSync`，不写 `pnpm-workspace.yaml`（`nodeLinker: hoisted` + `autoInstallPeers: false`）→ 装 companion 时 optional peers 被自动装进 `profiles/*/node_modules/@deepseek-ai` → step 5 硬 fail。CI 抓不到因为 pack 门禁没有 dsh 在 PATH、step 4 直接 WARN 跳过 | `provision-inproc-profile.mjs:1519,1478-1486,1029-1046`；`dsh-app-boot/src/profile.ts:178-217`；`scripts/build-bridge.mjs:20-24`；`ci.yml:235-236` | provisioner 自己写 workspace 契约（或先委托 `dsh plugin --profile <name> add` 建目录），并新增 `fresh-home-provision` 门禁 |
| P0-4 | 迁移不能「老 patch 整段转用户段」：patch 合并是 `target[key]=value` **整块替换**，老 `permission` 行会把模板的 `workspace-write` 覆盖回 `danger-full-access`，`llm-pi-ai` 行会整体替换模型表；重复 `- insert:` id 变不可寻址 | `cordis-plugin-include/src/patch.ts:95-104`；`dsh-config-editor/src/index.ts:38-43`；老 patch 550 行/19916B | 一次性显式转换：legacy `web` 形态检测 → 全量备份 → 只搬允许的 row → 其余丢弃并逐条列名；禁止整段搬运；可重入 |
| P0-5 | 「默认 CI / pack 不受影响」只在「删老 profile」假设下成立，**改名就会红**：`ci.yml:237` 用 `profiles/opentui-inproc`、`:317-320` 扫 `@deepseek-ai` 拷贝、`verify-bridge-handshake.mjs:31` 硬编码 `--profile opentui-inproc` | `ci.yml:237,317-320`；`scripts/verify-bridge-handshake.mjs:31` | 改名挪到**最后一个提交**，同提交清扫 `ci.yml`、6 个 `verify-*.mjs`、`e2e/families/lib/bridge-families.mjs:35`、`verify/agents-mount-repro.mjs:704`、`ledger/*` |

## P1

1. `--force` 与跨客户端生命周期仍未决议，而它们是被删机制的唯一使用者；删完等于「静默空转或 exit 2」。
2. **改名后 `--profile opentui` 正是 bridge 子进程 argv**，`launcher.mjs:42,452-455` 与 `safe-kill.ts:31,151,227` 会把活宿主识别成可杀对象 → 改名必须与 kill 路径退役**原子提交**。
3. 8 个默认装的两个现实副作用：`approval-policy` 对 subagent/scheduled 起源 `windowSeconds:60 / defaultOutcome:'rejected'`（卡片还在屏上宿主已自动 reject，行为变更非同「双层确认」）；10 个 companion ⇒ 启动前串行 10 次 `npm view`（各 30s 超时）最多约 300s。
4. 改名清单不完整：漏 `verify-capcontract-roundtrip.mjs:67`、`verify-s3-push.mjs:42`、`verify-s1-model.mjs:49`、`verify-s2-credentials.mjs:54`、`verify-sk-keymap-ans.mjs:62`、`bridge-families.mjs:35`、`agents-mount-repro.mjs:704`、`ledger/*`。
5. 删 4 个模型 id 的 resume 风险未验证：老会话 last-selection 指向已删 id 时恢复会绑定失败，需实测。
6. 文档自相矛盾：ADR-0009:79 仍写 `opentui-inproc` 是契约、CONTEXT:52-54 写产品 profile 固定 `opentui`、map 的 out-of-scope 还写「不改 opentui-inproc 名」——与 D1 决议相反，实施者会照错文件做。
7. 老 profile 遗留物无归属：转换后 19 个旧依赖（含 `link:/Users/qingguee/repo/dsh-workflow`）、lock、57 项 node_modules、5 份 `.bak`、`upgrade-overrides.json`、`.provision-state.json` 全部留下；`link:` 目标不在时后续 `pnpm` 整批失败。

## 事实核验裁定

| 结论 | 裁定 |
|---|---|
| 02「HTTP 宿主只剩 4 件事」 | 成立，但**只核了读面**，漏掉写面（`/settings` 经宿主 config-editor 全量重写 patch） |
| 03/05「0 个插件因缺 web-app 不可用」 | 成立 |
| 03「所有 `/` 命令已有 bridge 路径」 | 成立，无反例；`/settings` 在宿主面不可用时的只读降级是既有状态 |
| 04「dsh 不会自动重建非模板 profile」 | 成立；但 dsh 报错里建议的 `dsh plugin --profile X add` 会顺手建一个**只有 dsh-base** 的 profile，客户端仍起不来 |
| 03 §4 / D5「默认 CI 与 pack 不受影响」 | **不成立**（改名前提下），见 P0-5 |
| D1「回退旧版会按 web 模板覆写该目录」 | **不成立，实际更严重**：老 provisioner 目录存在时不补回 `dsh-web-app`，降级后老客户端探不到 HTTP 宿主 → TUI 不渲染；同时把 12 条遗留 row 永久写进 patch |

## 顺序修正（oldfox）

- 改名不能放阶段 1（会全程门禁红）：1a 分段协议（仍用旧名）→ 1b 首次转换（仍用旧名）→ … → 5a 门禁清扫 → **5b 最后提交翻常量 + 旧目录归档提示**。
- **D5 门禁必须提到「删 boot 链」之前**：判定拆除是否安全的那道门，不能在拆完之后才修。
- `--force` / 多客户端决议必须在退出路径改造之前。
- 阶段 0 应加三项实测：(a) 一次真实 `/settings` 写 → 重启 → 字段保留；(b) fresh HOME + dsh 在 PATH 的 provision；(c) 真降级尝试。**「写路径」才是最大未知，不是双开。**

## 不可逆点（补）

1. 首次启动即改写老 patch，只剩 `.bak`（手工回滚）。
2. `upgrade` 退役后失去本地 pin/降级通道，跨 minor 必须等本产品发版。
3. 降级彻底断（HTTP 宿主探不到 + `opentui-inproc` 目录不存在，双断）。
4. 删老 provisioner = web 模板创建路径永久消失。
5. profile 目录语义从「客户端自有配置目录」变成「provisioner 托管目录」。
6. 删 4 个模型 id 后历史会话无回填方案。
7. `opentui-inproc` 名退役 → 外部脚本静默失败 + ADR 契约条款作废。
8. 老 append 块留在 patch 里是永久死重量。
