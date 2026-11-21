# W2 — 轻量补命令 / 补 seam face

适用：在已有能力域上补 slash 命令、面板入口，或补一个 seam face（底层能力已存在或属纯桥协议面）。比 [W1](w1-capability-slice.md) 短——复用 W1 的五层地图与门禁阶梯，不重走全链。前置：理解 [W1 五层接线地图与七步流程](w1-capability-slice.md) 与门禁阶梯（README 测试架构总表）。出处的行号基于 `988c6f0`（0.24 发布树）与 `025-command-surface-audit.md`（静态只读对账）。

## 一、判定口径（先分类再动手）

补命令前先判「瓶颈在哪一层」，避免改错层。`025-command-surface-audit.md:10-23` 给出四类：

| 状况 | 瓶颈层 | 处理 |
|---|---|---|
| host 已 wired 或无需 host，但 `ctx.seam.X` 无 face | **seam face**（第 4 层） | 补 face（本 workflow 主场） |
| CapIR 已有 id、未 wired | **bridge hostInvoke 注册表**（第 3 层） | 按 W1 表查找接线（`CAP_*_WIRE_METHODS`） |
| host 有 RPC 但 CapIR 无 id（expected 面外） | **CapIR + 生成链** | 走 [W1](w1-capability-slice.md) 全链；若动 CapIR 真源走 [W8](w8-base-unfreeze.md) |
| 纯 UI 面板本地数据（无 host 依赖） | **commands.ts / 面板** | 只加命令注册与 hook 接线，无能力面变更 |

运行时链路：`client-entry.tsx:440` 加载 `v2-entry.tsx` 的 `bootClientV2` → `seam-bootstrap.ts:247` 造 `BridgeSessionSeam`，之后无 face 后期挂载；故命令可用性只取决于 `ctx.seam.X` 是否存在 + `ctx.openX` hook 是否已接（`025-command-surface-audit.md:6-8`）。hook 已在 `v2-entry.tsx:1010-1063` 全接（`openBtw/openSearch/openPlugins/openAgents/...`）。

## 二、补 seam face + commands.ts 模式

1. **seam face**（`packages/shell/src/client/bridge-session-seam.ts`）：以真实实现暴露 face 对象或方法。参考已落地的 `settings`（`:1235-1240`，describe/mutate/identity→`local-config-faces.ts:190/238` 真文件 I/O）与 `agents`（`:1244-1251`）。cap-smoke 可见但无 face 的能力（如 account 12 条，`025-command-surface-audit.md:128`）属「有底层能力无命令」面。
2. **命令注册**（`packages/tui-base/src/routes/session/commands.ts`，`coreCommands()` `:597-1637`）：标准降级模式——无 face 走 `ctx.say(t("command.X.unavailable"))` 并 return；有 `ctx.openX` 则打开面板；否则读 face 数据列条目。范例：

```
name: "/plugins",
run(ctx) {
  if (!ctx.seam.plugins) { ctx.say(t("command.plugins.unavailable")); return }
  if (ctx.openPlugins) { ctx.openPlugins(); return }
  const plugins = ctx.seam.plugins()
  if (plugins.length === 0) { ctx.say(t("command.plugins.none")); return }
  for (const p of plugins) ctx.say(t("command.plugins.entry", { name: p.name, version: p.version }))
}
```
出处：`commands.ts:1097-1114`。注意 `openPlugins` 分支在 `unavailable` return **之后**——无 face 时面板永远打不开（`025-command-surface-audit.md:42`）。

3. **面板入口**：hook 已在 `v2-entry.tsx` 接线则无需改动；纯本地 FS 面板（如 `/skills`，`skills-panel.tsx:1-24`）不依赖 host RPC。

## 三、`/plugins` 实例（0.24 审计 → 0.25 补齐）

审计结论（`025-command-surface-audit.md:42,59,75,91-92,106-118,143`）：

- 0.24 状态：**降级**（`if (!ctx.seam.plugins)` 命中 unavailable）；`openPlugins` 在 `v2-entry.tsx:1026` 已接但到不了。
- 根因两类：① `seam.plugins` face 未实现（host manager 15 条 RPC 全缺，CapIR gap）；② `plugins()` 本身可读本地列表，但 seam 没接。
- 15 条 plugin-manager gap：`cancelInstall/inspect/installBundle/listBundles/listPlugins/listVersionExemptions/listVersions/readBundleDetail/registries/removeBundle/setBundleEnabled/setPluginEnabled/setVersionExemption/updateBundle/waitForInstall`（`025-command-surface-audit.md:91-92`）。
- 补齐路径裁决：若只做「本地插件列表可读」→ 补 `seam.plugins` face（低成本，属 seam face 未实现类）；若要做完整管理器面板 → 15 条 RPC 需进 expected 面，走 W1 全链 + 可能 W8 解冻。
- 预注册 expected（W5）：`/plugins` 从降级转可用，真机面板出插件行、无 unavailable notice；脱敏纪律按 W5（插件清单可能含路径/URL）。

## 四、门禁阶梯（复用 W1，逐级）

1. `bun test packages/*` — seam/commands 单测 0 fail；既有断言更新非删除。
2. `node scripts/check-capcontract.mjs` — 若新增 wired id：`PASS=14`、#8a/#8b/#10 对账；若无能力面变更：确认门禁不回归即可。
3. `bash scripts/real-client-gate.sh --out ...` — 真机命令项 + `.ans` 数值帧（禁 PNG）；若补的是 account 类，注意 s2-account section 判定（见预防条款）。
4. `npm pack --dry-run` + CI 三 job 绿；run URL/headSha 入报告。

按 [W4](w4-review-gate.md) 评审（命令改动 JUDGMENT 类只记不拦）。

## 五、预防条款（0.24 真实陷阱，就地归属）

1. **locale 变更致 grep 假阴**（S4b C-S4b-a）：S5 config 真写把 profile 切成 zh-CN，Account 导航标签从 `Account` 变 `账号`，gate grep `account|账户|/login` 不含「账号」→ `s2-account: section=no` 假阴，曾被误读为「account 面无 stdio 入口」（S6 终评 C.2 自我修正）。根因：harness 定位器非 locale-complete。预防：grep 补 locale 词（`real-client-gate.sh:238` 现为 `account|账户|账号|/login`），属**修断言 false-negative 非放宽**，判定语义仍是「真 /settings 面板出现 Account 分区」；同类先例 `🧠→⌨`（`:S3 harness`）、composer `输入消息`（`real-client-gate.sh:174-176`）；**断言等价性须由 oldfox 复核**（`024-s6-conflict-adjudication-oldfox.md:73-88`）。分离表述：section=yes 只证「分区可见」，wire 安全由帧级测试独立证（`024-s4b-account-wire.md:14,84`）。
2. **注释与实现不符**：`/model` 的降级注释（`commands.ts:656-661` 称无 modelCatalog wire）在 S1 接链后过期，但代码实际可用（`025-command-surface-audit.md:63`）。预防：补命令时核对命令注释与 seam face/bridge 接线现状，勿据过期注释判断瓶颈；必要时随补丁更正注释（`024-s5-config-slice.md` 同纪律）。
