# think 渐隐 + /permission 事实调查（两轮合并）

> 调查性质：只读调查，未修改任何文件、未建分支、未 commit。
> 范围：`/Users/qingguee/repo/dsh-opentui`，当前 checkout 为 main `a3bab25`（`v0.26.4`），`3314de5` 是其祖先；已用 `git diff` 核对，下列 fade / permission / 配置相关行的结论对 `3314de5` 同样成立（期间改动只涉及 /goal 重命名、subagent 等无关部分）。
> 内容：第一轮 5 问 + 第一轮「对用户需求的含义」 + 第二轮 4 问补充 + 第二轮「补充判断」。

---

# 第一轮调查

## 1. think 块渐隐

**结论**：渐隐不是 CSS/opacity，而是「2 秒全亮停留 + 300ms 把行的前景色混合到背景色」，由 `dock-visibility.ts` 的纯时间状态机 + `widgets-dock.tsx` 的颜色混合 + `seam-rows.ts` 的 2.3s 行保留定时器三处协作实现；触发点是 think 段 collapse（收到正文/tool/turn 结束时）。

- 常量与触发条件：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/dock-visibility.ts:25` `DOCK_LINGER_MS=2000`、`:28` `DOCK_FADE_OUT_MS=300`、`:32` `DOCK_LINE_RETENTION_MS=2300`、`:38-40` `dockRemovalMs`；`:70-80` `dockLineVisibility` 按 stopAt+now 给出 `live/lingering/fading/hidden`，fading 时 progress 0→1，混到背景。
- 颜色实际落地：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/widgets-dock.tsx:458-469` `skinDockLineFg`，`:462` 在 fading 时 `mixSkinColor(target, background, progress)`，hidden 时直接背景色。
- 锚点来源：同文件 `:990-1003` 非 streaming 行取 `fadeOutAt = skinStopAt(row)`；`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/seam-rows.ts:674-686` collapse 时冻结 elapsedSec 并 `scheduleThinkFade`，`:355-369` 定时器 2.3s 后 drop 行，`:237` `thinkFadeMs = dockRemovalMs(motionDecorationsEnabled())`。
- 已知问题证据：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/widgets-dock.tsx:936-942` 注释「Clock law (M1)」——只有 streaming 分支读 `dockSpin`，think-only 时 tick 无人订阅、不重绘，帧停在满色；修复是 `:950-952` 无条件 `void dockSpin()`。测试：`/Users/qingguee/repo/dsh-opentui/packages/shell/test/shell-render-incident-motion-ft.test.tsx:7-20,72-144`、`/Users/qingguee/repo/dsh-opentui/packages/tui-base/test/widgets-dock-render.test.ts:8-13,94`；CHANGELOG `/Users/qingguee/repo/dsh-opentui/packages/shell/CHANGELOG.md:877`；考古线索 `/Users/qingguee/repo/dsh-opentui/research/oldfox-reuse-verdict.md:122`。
- **最小注释范围**：改 `dock-visibility.ts:28` 一个常量（`DOCK_FADE_OUT_MS=0`，retention 随之变 2000，`dockLineVisibility` 只有 lingering→hidden，永进不了 fading 分支）。注意独立的入场渐隐 `SKIN_FADE_IN_MS=400`（`widgets-dock.tsx:123`）不受影响；上述 2.0–2.3s 中间帧断言会失败，需同步跳过/改测试。

## 2. /permission 现状

**结论**：已完整镜像 web，且**已经支持 `/permission <preset>` 直接改权限**；bare 输出 catalog，有参走宿主 `commands/execute`，但不能读取当前会话 preset。

- 注册与执行：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/commands.ts:1876-1938`。`:1879-1893` 取 face/catalog，失败给诚实提示；`:1895-1897` bare 打印；`:1899-1904` 参数按 catalog 校验；`:1912-1921` 高风险 preset 二次确认；`:1923` `face.switch(target.value)`；`:1924-1934` 按 matched/ok 输出 `no /permission command` / failed / `permission preset set to …`（文案 `/Users/qingguee/repo/dsh-opentui/packages/i18n/locales/en.json:40-51`）。
- 宿主镜像路径：`/Users/qingguee/repo/dsh-opentui/packages/shell/src/client/bridge-session-seam.ts:1429-1439` face，`:1639-1651` 发 `commands.execute` 的 `/permission <preset>`；二次白名单 `/Users/qingguee/repo/dsh-opentui/packages/shell/src/client/bridge-permission.ts:43-65`。
- 不能读当前值：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/commands.ts:405-423`（`permissionCatalogLines` 显式说明 current 由宿主掌握、客户端无可读 projection face）；`:1905-1911` 已删除错误的 "already" 短路。

## 3. 权限模型

**结论**：宿主 preset 是「sandbox 模式 + approval 策略」二元组（read-only/workspace-write → ask，danger-full-access → never）；另有规则级 allow/deny/ask 与应答 once/always/reject；当前生效状态存在宿主 session 的 `approval/policy` 事件里。

- presets：`/Users/qingguee/repo/dsh-opentui/packages/shell/scripts/provision-inproc-profile.mjs:545-560`（三个 preset 及 `defaultPreset`，默认 workspace-write + ask，逃生门环境变量）。
- 规则/应答级别：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/vendor/schema/src/permission.ts:42`（once/always/reject）、`:56`（Effect allow/deny/ask）。
- 状态存储与正确入口：`/Users/qingguee/repo/dsh-opentui/research/2026-11-22-fullaccess-inherit/03-live-trigger-diagnosis.md:35,52`——`setApprovalPolicy(session, policy)` = `session.append("approval/policy",{policy})`，`/permission` 链路是 `commands/execute → ctx.approval.setPolicy(agent,…) → setApprovalPolicy(agent.session,…)`；幂等靠 host `apply()` 的 `current !== name`（`commands.ts:1909-1911`）。
- 目录：`/Users/qingguee/repo/dsh-opentui/packages/shell/src/client/bridge-directory.ts:138-145`（`permissionPresets.catalog` → options/defaultOptions/defaultPreset），类型 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/seams/session.ts:389-391`。
- web profile 的 permission 设置行：**不是** `commands/execute`，是 catalog 提供选项 + `settings.mutate("permission",[{op:"set",path:["defaultPreset"],value}])`：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/settings-panel.tsx:348-380`、`665-695`；契约 `/Users/qingguee/repo/dsh-opentui/research/t18-settings-migration-contract.md:56,135`。`/permission` 命令与 web 命令面板走 commands/execute；设置面板走 settings.mutate，两条路径并存。

## 4. 弹窗基建

**结论**：能复用，直接入口是 `ctx.pickOne` → `DialogSelect` / `useDialog().stack`；但「1–9 数字键编号选择」属于 AskPanel 底部 dock，不是 dialog.stack 的能力。

- 通用弹窗：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/commands.ts:207-225` `SlashCommandContext.pickOne(title, options, headerLine?, currentValue?, extras?)`；`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/ui/dialog.tsx:343`（stack 定义）、`:482-484`（`get stack()`）、`:537-541`（渲染栈顶）；组件 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/ui/dialog-select.tsx`。`/permission` 已经用它做风险确认（`commands.ts:1913-1920`），其它命令如 `/model`、`/resume` 也都在用（`:810,1122,1613,1715`）。
- 0.18.3 的数字键面板：`/Users/qingguee/repo/dsh-opentui/CHANGELOG.md:568-574`（底部全宽 ask dock、编号行、1–9 快选）；实现 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/ask-panel.tsx:131`、`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/ask-keys.ts:222-224,288-294`；由宿主 ask 事件驱动 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/turn-overlays.tsx:280`。`DialogSelect` 本身没有 1–9 快选（只绑定方向键/Enter，见 `dialog-select.tsx:541-570`）。

## 5. 带参/set 与本地配置

**结论**：带参已实现（`commands.execute` 的 `/permission <preset>`）；宿主另有 `permissionPresets/set` 方法，但**未放行到 bridge**；本地配置文件路径存在，且 `/settings` 已经在写它。

- `permissionPresets/set` 存在：`/Users/qingguee/repo/dsh-opentui/capcontract/types.ts:532,802,2043`（wire 名 `permissionPresets.set`）；但通用放行集 `/Users/qingguee/repo/dsh-opentui/capcontract/types.ts:2312-2344` 只有 catalog，没有 set；方法排除记录 `/Users/qingguee/repo/dsh-opentui/docs/architecture/04-ledger-provenance.md:37`。要用它需扩白名单 + confirm 闸 + 重跑 ledger，属新能力切片。
- 本地配置路径：`/Users/qingguee/repo/dsh-opentui/packages/shell/src/client/local-config-faces.ts:231-236`（`{home}/profiles/{profile}/cordis.patch.yml`），profile 为 `opentui`（`retired HTTP lifecycle module:91`、`/Users/qingguee/repo/dsh-opentui/packages/shell/src/client/bridge-session-seam.ts:2197-2199`），即 `~/.dsh/profiles/opentui/cordis.patch.yml`；`:287-319` `settings.mutate` 原子写入该文件，白名单允许 `permission.defaultPreset`。YAML 格式见 `/Users/qingguee/repo/dsh-opentui/packages/shell/scripts/provision-inproc-profile.mjs:545-560`（`- id: permission` / `config.presets` / `defaultPreset`）。注意 provisioning 会重写 `opentui-inproc` 的 patch，外部手改会被备份覆盖（同文件 `:1269-1294`），所以应走 `settings.mutate` 而不是手改。

## 第一轮：对用户需求的含义

- **注释渐隐**：精确改法是 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/dock-visibility.ts:28` 把 `DOCK_FADE_OUT_MS` 从 300 改为 0（或注释掉该常量并让 `:32` retention 等于 `DOCK_LINGER_MS`），`:38-40` 的 2s/2.3s 分支自动收敛为「2s 后直接隐藏」；think 行保留定时器无需改。代价是两处 asserting 中间帧的测试要跳过/改期望。不建议动 `widgets-dock.tsx:952` 的 `dockSpin()`——那是修复过的事故点，去掉会重现"不重绘"。
- **弹窗方案**：可行性高、工作量小（约 10–30 行）。把 bare `/permission` 的 `permissionCatalogLines` 输出替换为一次 `ctx.pickOne(..., catalog.options.map(...))`，选中值直接复用现有 `face.switch` 和风险确认链路。若要 0.18.3 那种 1–9 编号 AskPanel，需要新造客户端 ask 请求，工作量明显更高，不建议。
- **带参方案**：**零新增工作量**——`/permission <preset>` 在 0.26 已经可用（`commands.ts:1899-1938` + `bridge-session-seam.ts:1639-1651`），需要做的只是文案/文档说明。若要改成直接调 `permissionPresets.set`（绕过 commands/execute），属中等偏大工作量（bridge 放行 + 确认闸 + ledger/proof 重跑），当前没有必要。

---

# 第二轮补充调查

用户补充的一手事实线索（实际 /permission 输出）：

```
available presets: read-only, workspace-write, danger-full-access
read-only
workspace-write
danger-full-access
default preset: workspace-write
current session preset is host-authoritative (not readable here); use /permission <preset> to set it
```

## 1. 带参修改路径：代码链路完整接通，但真机成功证据缺失，且有明确失败条件

**结论**：`/permission <preset>` 不是"只打印提示"——从命令解析、catalog 校验、风险确认、seam wire 到宿主命令执行都是实装且有单测；但仓库内能找到的真机帧只有失败帧（session 未绑定时），没有成功输出帧，因此只能说"实现已接通"，不能说"所有场景已验证可用"。

- 命令侧完整实现：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/commands.ts:1894-1938`（参数校验 :1899-1904、风险确认 :1912-1921、`face.switch` :1923、结果输出 :1924-1934）。
- seam 与 wire 完整实现：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/seams/session.ts:408-419`、`/Users/qingguee/repo/dsh-opentui/packages/shell/src/client/bridge-session-seam.ts:1631-1651`（发 `commands.execute {agentId, line:"/permission <preset>", submittedAttachments:[]}`）；wire id 已放行 `/Users/qingguee/repo/dsh-opentui/capcontract/types.ts:2343`（agent scope/agentId `:1805`，unary/cancel:signal `:799`）；回复经二次白名单 `/Users/qingguee/repo/dsh-opentui/packages/shell/src/client/bridge-permission.ts:43-65`。
- 单测覆盖：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/test/commands.test.ts:2173-2251`（legal preset 直接 switch、cancel 不 switch、ack switch、matched=false、target==default 仍提交）；`/Users/qingguee/repo/dsh-opentui/packages/shell/test/bridge-session-seam.test.ts:3504-3521`（wire 参数逐字段断言）；`/Users/qingguee/repo/dsh-opentui/packages/bridge/test/cap-generic-arm.test.ts:1211-1227`（解析 agentId 为活体 agent）。
- 宿主端确实 apply：`/Users/qingguee/repo/dsh-opentui/research/2026-11-22-fullaccess-inherit/03-live-trigger-diagnosis.md:52`——`commands/execute(agent,…)` → `ctx.approval.setPolicy(agent,…)` → `setApprovalPolicy(agent.session,…)` → `session.append("approval/policy",{policy})`；这是宿主源码一手考古，不是客户端自证。
- **真机失败证据**：`/Users/qingguee/repo/dsh-opentui/.proof/fullaccess-inherit/02-risk-dialog.ans` 出现风险确认框，但 `/Users/qingguee/repo/dsh-opentui/.proof/fullaccess-inherit/03-switched.ans:3` 与 `04-session-created.ans:3` 输出 `/permission failed: permission.switch: no active session (agentId unavailable)`；全仓 `.proof`/`verify`/`e2e` 搜不到 `permission preset set to ...` 成功帧（只在测试与 i18n 文案里）。
- **失败条件（可复现的逻辑）**：`bridge-session-seam.ts:1640-1643` 只认 `currentSessionId()`；它在 `session.open` 回复时才赋值（同文件 `:3880`、恢复路径 `:2437`），`newSession()` 清空（`:2303`），dispose 清空（`:3972`）。`resumeSession(id)` 只暂存（`:2286`），switch 不读 `stagedSessionId()`（`:2313-2320`）。所以**首次发消息前、/new 后、`/resume` 尚未产生下一 turn 时**都会报上面的错误——真机 proof 的 03/04 正是这种时序。宿主若无 `commands/execute` 则返回 `matched=false`，输出 `no /permission command`（`commands.ts:1924-1927`）。

## 2. "host-authoritative (not readable here)" 的机制与条件

**结论**：这不是某个特殊模式，而是当前客户端的固有状态——仓库里根本没有"读当前会话 preset"的 seam face；只要 catalog 可读，bare 输出必然带这句。

- 明确写在代码注释与输出里：`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/commands.ts:405-423`，其中 `:408-410` 说明 rc.5 宿主虽有 `permissions` projection（含 `currentValue`），但 bridge 只把 `session/observeProjections` 接成裸 push 流、没有消费 face；`:422` 就是用户看到的那行；单测钉住 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/test/commands.test.ts:2136-2149,2152-2160`。
- bridge 侧：`/Users/qingguee/repo/dsh-opentui/packages/bridge/src/index.ts:1116-1157` 只是把 observeProjections 作为 AsyncIterable 返回，不做投影；整个 shell seam 无 `permissions`/`currentValue` 消费者（grep 仅命中上述注释）。
- 真值归属：会话审批策略存在宿主 session 的 `approval/policy` 事件（`/Users/qingguee/repo/dsh-opentui/research/2026-11-22-fullaccess-inherit/03-live-trigger-diagnosis.md:35,52`），而 `default preset` 是 profile/宿主 catalog 的全局默认值（`/Users/qingguee/repo/dsh-opentui/packages/shell/scripts/provision-inproc-profile.mjs:545-560`、`/Users/qingguee/repo/dsh-opentui/packages/shell/src/client/bridge-directory.ts:138-145`）——切换过一次后两者就会不一致，这正是当初禁止把 default 当 current 的原因（`commands.ts:1905-1911`）。
- 条件：catalog 可读 → 输出用户贴的那 6 行；catalog 不可读 → 直接 `catalogUnavailable`（`commands.ts:1884-1893`）。与 session 是否绑定无关。

## 3. 无参弹窗方案的复用入口

- **推荐复用 `ctx.pickOne`（dialog.stack）**：实现在 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/examples/v2-entry.tsx:731-817`——`:773` `dialog.replace(...)`，`:775` `DialogSelect`，`:778-793` 选项映射（title/value/description），`:806` `current`，`:812-813` onSelect/onCancel。栈 API 在 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/ui/dialog.tsx:343`（stack 定义）、`:453-480`（`replace`）、`:482-484`（`get stack()`）。`/permission` 已用它做风险确认（`commands.ts:1912-1920`）。改法：把 bare 分支 `commands.ts:1895-1897` 的 `permissionCatalogLines` 循环换成一次 `ctx.pickOne(t(...), catalog.options.map(...))`，拿到 value 后直接走现有 `:1899` 起的校验/switch 链路。工作量 ~10–30 行 + 单测。**限制**：`DialogSelect` 没有 1–9 快选（`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/ui/dialog-select.tsx:541-570` 只绑方向键/Enter）；`currentValue` 只能传 `defaultPreset` 做"默认"标记，无法标"当前档"（见第 2 条）。
- **数字键方案（0.18.3 那套）**：入口是 `AskPanel` + `ask-keys.ts`——`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/ask-panel.tsx:131`、`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/ask-keys.ts:222-224,288-294`（1–9 绑定）；设计说明 `/Users/qingguee/repo/dsh-opentui/CHANGELOG.md:568-574`。但它由宿主 `ask.request` 事件驱动（`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/turn-overlays.tsx:280`），命令本地无法直接打开；要用于 permission 必须新增客户端发起的 ask 路径并接入 owner/dock 时序，工作量和回归面都明显更大，不建议。
- 结论：弹窗需求用 `ctx.pickOne` 可低成本落地；数字键效果需要额外说明取舍。

## 4. think 渐隐

结论不变。最小改法仍是 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/dock-visibility.ts:28` 把 `DOCK_FADE_OUT_MS` 改为 0（retention `:32` 随之变 2000，fading 分支消失）；不要动 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/widgets-dock.tsx:950-952` 的 `void dockSpin()`，那是已修复事故的响应式重绘点。

## 第二轮：补充判断

- 带参能力**不需要新做**，但建议同时修"session 未绑定时直接报错"：在 `#permissionSwitch` 里用 `currentSessionId() ?? stagedSessionId()`（`bridge-session-seam.ts:1640`），或让命令在该窗口先提示"先发一条消息再切换"；否则用户按 bare 看到的提示会在真机首次使用时直接失败。
- host-authoritative 那行是诚实降级，不是 bug；要消除它必须新增读 `permissions.currentValue` 的 seam face（新能力切片），不应通过把 `defaultPreset` 伪装成 current 来"修"。
- 弹窗用 `ctx.pickOne`；风险档二次确认保留。think 渐隐按第一轮的一行常量改法执行。
