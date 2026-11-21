# 05 TUI 层（焦点路由 / 面板 / 命令面）

> 出处约定见 [README.md](README.md)。结构在此；补命令的操作步骤见 `docs/workflows/w2-command-face.md`。

## 5.1 FocusRouter 四层捕获栈（ADR-0008 R4）

键盘入口分两车道：keymap lane（`prependListener` 先于其他 listener）与 raw `useKeyboard` lane（`docs/adr/0008-input-ownership-for-keyboard-routing.md:10-20`）。历史缺陷根源是 `mode:"global"` 实际「在每个模式匹配」+ 同 priority 下注册序决胜，导致 modal 层按渲染层级而非视觉层级抢键（ADR-0008 `:39-75`）。

ADR-0008 先确立**单一输入所有权栈**（`page`/`dialog`/`panel`/`dock` frame，`top()` + `owns(frame)` 是唯一判据；`:154-178`）。024 SK 的 R4 收紧为 **FocusRouter**（v3 §3.4 / ADR-R4）：它是同一栈的分层视图，捕获优先级

```
modal (3) > overlay (2) > main (1) > global (0)
出处：docs/adr/0008...:352-370；packages/tui-base/src/context/focus-router.tsx:9,36-47
```

映射（单一来源 `tierOfFrame`，`focus-router.tsx:49-61`）：dialog frame → `modal`；panel/dock → `overlay`；page frame 同时承载 `main` + `global`。唯一结构门是 `FocusRouter.allows(tier, frame?)`（`focus-router.tsx:86-108`），`resolveCapture`（`:74-84`）对 modal/overlay 还要求 frame token 身份精确相等（两个叠放的 dialog 是不同 frame）。

不变量（ADR-0008 `:370-392`；源码 focus-router.tsx）：

1. **无第二所有权**：`FocusRouterProvider` 嵌 `InputOwnershipProvider`，dialog/panel/dock 宿主读同一栈；无 bridge/inject/service 面（ADR `:372-376`；`focus-router.tsx:158-164`）。
2. **垫片仅在叶**：`useIsPageOwner()` 改为委托 router 的 main 门，名字保留为兼容别名使未改调用点与断言继续工作（ADR `:377-382`；`focus-router.tsx:124-136`）。
3. **既有 priority 不变**：四层决定「哪些层启用」，不决定 keymap `priority`；page 帧上 main 与 global 同启，相对顺序仍是既有 priority + 注册序（pane-focus 1 / agents hotkey 2）（ADR `:383-387`）。
4. **歧义键保持现状**：Esc arm→confirm、Ctrl+C busy 中断并 arm、overlay 下 Ctrl+C 归 overlay（quit 不可达）、数字快速切 session 均不改；交互手感差异记 USER-JUDGMENT，不拦构建（ADR `:388-392`）。

无 provider 的裸 FT harness 回退到 pre-ownership `enabled` 行为（`focus-router.tsx:119-122,131-136`，ADR `:394-396`）。验证矩阵与帧计数测试在 `packages/tui-base/test/focus-router.test.tsx`（ADR `:397-399`）。

## 5.2 panel-kit 与 overlay 供给边界

panel-kit 保持对 tui-base 零依赖，通过结构桥接 `PanelKitHost` 接收 `push()/pop(token)/owns(token)`（`ADR-0008:172-178`；provider 嵌套见 [01](01-system-topology.md) §1.3）。关键结构事实：

- panel-kit 自带 `layers()` 与其栈顶（`panel-kit/src/stack.tsx:68,260-264`），**不进入 `dialog.stack`**——这是历史 Esc 泄漏的机制原因（ADR-0008 `:88-90`）。
- ask 表面不交给 panel-kit：它是 composer 位的 in-flow dock（`ADR-0008:108-131,200-202`）；规范条款是「in-flow 面不得把所有权帧推到绝对定位 overlay 之上」，admission 等 page ownership 才 admit（`:183-199`）。
- 既有 panel paging 层（PgUp/PgDn 等）保留为面板自身功能，不是泄漏垫片（ADR `:203-216`）。

## 5.3 seam face 供给与降级分支模式

`SessionSeam` 是 TUI 与宿主能力之间的 typed face 层（类型在 `packages/tui-base/src/seams/`）。生产唯一实现是 `BridgeSessionSeam`（[01](01-system-topology.md) §1.3）；inproc bridge 没有对应路由的 face 以「可选方法 + 显式降级」处理。命令的通用模式：

```
if (!ctx.seam.<face>) { ctx.say(t("command.<x>.unavailable")); return }
// 否则走 seam.<face>；宿主错误经 seamFailureReason 映射为文案
```

实例：`/plugins` 在 `commands.ts:1100-1101` 有 `if (!ctx.seam.plugins)` 降级分支（`/plugins` 属「host 已 wired 或无需 host，但 bridge seam 没实现 face」类，`025-command-surface-audit.md:106-118`）；`/login` 因 `seam.login` 缺失降级到 `command.login.unavailable`（`commands.ts:848`，同审计 `:112`）。face 缺失与宿主能力缺失**不是一回事**——审计结论：7 条用户撞到 unavailable 的命令中 5 条是 seam 未接 face，不是 host 能力缺口（`025-command-surface-audit.md:143`）。

S5 起，config/settings/agents 三面由本地真实现供给，不再 `{}` 降级：`LocalConfigStore` / `LocalSettingsStore` / `LocalAgentsFace`（`packages/shell/src/client/local-config-faces.ts:278,182,353`；`024-s5-config-slice.md:81-82`）。其中 settings 走**逐字段白名单构造式**投影（见 [06](06-security-privacy.md) §6.3）。

025-w2-2 `/plugins` 分两**并列不合并**的 face（方案 §5.2，account/login 分域先例同款）：`seam.plugins()` = phase-1 本地安装清单（`<dshHome>/profiles/<profile>/node_modules` 扫描，回答「装了什么」）；`seam.pluginsManager`（手写 face + 二次白名单投影 `bridge-plugins-manager.ts`，回答「管理器视角：enabled/state/version 豁免」）读真 `pluginManager/{listBundles,listPlugins,readBundleDetail,...}` 七条只读 id（W2-2a 放行）。`pluginBundles()` state 列取真数据；服务缺位回退 phase-1 本地清单并标 `stateUnknown`（不假 enabled）+「管理器不可用」行；detail 区读 `readBundleDetail`。写面（8 id）留 W2-3。

## 5.4 27 命令注册表

`packages/tui-base/src/routes/session/commands.ts:597` 的 `coreCommands()` 实读 **27 条**（`/help /new /model /login /logout /quit /resume /clear /flush /btw /session /plugins /skills /search /agents /settings /history /export /subagents /think /hints /language /motion /hotkeys /theme /preset /stop`）。`v2-entry.tsx:365` 以 `withSkillCommands(coreCommands(), skillRows())` 追加 skill 命令后作为 `commands` prop 传给页面（`:976`）。注册表是 `{ name, description, run }` 表，`run` 只通过注入 hooks 触 UI，故可在无渲染器下做表驱动测试（`commands.ts:1-10`）。

**available/unavailable 契约**（0.24 发布态实读）：27 条中可用 17 / 降级 7 / 半可用 3（`025-command-surface-audit.md:143`）。降级命令统一以 `command.<x>.unavailable` 文案上屏（例：`commands.ts:668 /848 /895 /984 /1044 /1068 /1081 /1101 /1128 /1143 /1222 /1272 /1509 /1557`），不静默失败、不把 slash 命令发进模型（dispatch 词法 `commands.ts:16-20`）。`/agents` 是例外：它总打开 panel-kit modal，不走 unavailable 分支（`commands.ts:1156`）。命令可用性口径的变化属 0.25 切片，见 [09](09-extension-points.md)。

## 维护责任

捕获层级/所有权判据、panel-kit 桥接契约、seam face 增减或命令注册表与 unavailable 文案口径变化时更新本文档；仅改命令实现体不动结构时不更新。
