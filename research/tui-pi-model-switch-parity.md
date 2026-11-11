# 模型/档位切换链 parity 审计：dsh-opentui vs dsh-tui-pi vs web profile（官方）

日期：2026-11-11。只读审计，未改任何代码。
分层规矩（用户 11-11 定调）：**client↔server 通信层照 web profile 官方实现；功能/行为语义层以 tui-pi 为标准；UI/交互 opentui 自有，不照抄。**

- tui-pi 仓库：`/Users/qingguee/repo/dsh-tui-pi`（per-surface 插件，in-process TUI）
- opentui 仓库：`/Users/qingguee/repo/dsh-opentui`（client/server 分离，client bundle + resident host）
- web profile 官方实现：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-model-selection@0.2.2-rc.1`（`lib/client.js` + `lib/types/client/*.d.ts`，已安装闭包，无本地源码 checkout）

两个真 bug（11-11 背景）：
① sessionless 时用户选的模型被 host 默认路由覆盖、底栏不更新；
② 切换失败仍回显 `model → xxx` 成功。
两个 bug 都在下面找到了源码级根因（见「单方面劣化」清单第 1/2/4 条）。

---

## ① 证据：对照表

记号：tui-pi = `/Users/qingguee/repo/dsh-tui-pi`；opentui = `/Users/qingguee/repo/dsh-opentui`；web = `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-model-selection`（下称 `model-selection pkg`）。

| # | 面 | tui-pi 做法（file:line） | web profile 做法（file:line） | opentui 做法（file:line） | 是否劣化 | 该照抄谁 |
|---|---|---|---|---|---|---|
| 1 | `/model` 命令注册与分发 | TUI 本地注册 + ctx.commands 双面注册，agentless 时免建 session 直接跑：`src/commands.ts:153-174`（`registerLocal` + `bridge.getAgent() === undefined` 分支）、`src/index.ts:1120-1131`、`src/index.ts:1247` | composer 内嵌 ModelSelect 组件（非 slash 命令），per-session 注入：`model-selection pkg lib/types/client/slots.d.ts:20-62`（`conversation.input.model.label`/`ModelSelectInjected`） | slash 表 `/model`：`packages/tui-base/src/routes/session/commands.ts:394-477`；裸形式开 picker，`provider/model` 参数形式直发 | 基本对齐（命令 vs 组件是 UI 层差异） | opentui 自有（UI），语义照 tui-pi |
| 2 | 两段式：选完模型再问 think level | `pickModel` 内 stage-2：`src/selectors.ts:465-520`；**整段选完才 resolve 一次提交**；stage-2 esc = 放弃整个选择：`src/selectors.ts:509-513` | 同一弹层两级 pane（root→effort），`chooseEffort` 提交完整 selection：`model-selection pkg lib/client.js:1423-1432`（`chooseEffort` → `submit({provider: state.current…})`） | stage-1 先 `selectModel` 提交再开 stage-2：`commands.ts:427-432`（"the model switch commits HERE, at the stage-1 boundary"）；stage-2 esc 保留已切模型 | **劣化（语义）**：esc 中途 = 半个选择已生效 | tui-pi |
| 3 | sessionless 暂存：选择存哪 | bridge 内存 selection ref + `selectionUserPinned` 防默认重播种：`src/session.ts:352-359`、`src/session.ts:2351-2359`（`setSelection`）；建 session 时以 `agentOptions` 带入：`src/session.ts:2328` | **无 sessionless 态**：web 每个 conversation 都有 sessionId，directory 按 session 建，选择直接走 durable RPC：`model-selection pkg lib/client.js:871-881`（`select()` → `sessions.selectModel({sessionId,…})`）；`store.pending` 仅作未决态展示 | `#pendingModel` 内存暂存：`packages/shell/src/client/remote-host-session.ts:937-943`（facade `selectModel` sessionless 分支）；`#ensureSession` 创建时补发：`remote-host-session.ts:2109-2119` | 机制对齐（暂存→建 session 补发），但读数坏了（见 #4） | web（补发时机：attach 后、首条消息前）＋ tui-pi（pin 语义） |
| 4 | sessionless 读数（footer 显示暂存还是 host 默认） | footer 与选择**同一 ref**：`src/footer.ts:222-233`（`source.getSelection()`）→ 暂存立即上屏 | footer/trigger 读 `projected.next ?? catalog.default`，pending 未决时 trigger 显示 spinner：`model-selection pkg lib/client.js:967-995`（`syncInputs`）+ 注释 `lib/client.js:1141-1143` | `currentModelSelection()` sessionless 返回 **catalog default，完全不读 `#pendingModel`**：`remote-host-session.ts:963-967`（`if (sessionId === undefined) return this.defaultModelSelection()`）；footer 只读它：`packages/tui-base/examples/v2-entry.tsx:376-381` | **劣化（bug ① 读侧根因）** | web（合并序 pending ?? projection ?? default）＋ tui-pi（footer 读同一 ref）。opentui 自己的 btwAsk 已是正确写法：`remote-host-session.ts:1761`（`#pendingModel ?? (await this.currentModelSelection())`） |
| 5 | effort 与 model 耦合：改档位时 provider/model 用哪个 | `/think` 从**当前选择（含暂存）**取 provider/model，永不碰默认路由：`src/index.ts:1276-1306`；同 provider 保留 effort、跨 provider 重置：`src/selectors.ts:465-471` | `chooseEffort` 显式用 `state.current.provider/model` 重发完整 selection：`model-selection pkg lib/client.js:1424-1431` | adapter `selectEffort` 读 `currentModelSelection()`（sessionless = **host 默认**）再 `selectModel({provider, model, effort})`：`packages/shell/src/client/session-seam-adapter.ts:397-412` | **劣化（bug ① 写侧根因）**：sessionless 下任何 effort 写入都会把暂存覆盖成 host 默认路由 | tui-pi（语义：effort 只作用于当前选择）；实现序照 web（完整 selection 提交） |
| 6 | footer 自动写默认档位（auto-high） | **不存在**：footer 纯读，无任何写回：`src/footer.ts:220-233`（全文件无 selectEffort/saveSelection） | 不存在：菜单提交才算选择，被动渲染不写路由 | footer refresh 每次都可能自动 `selectEffort("high")`：`v2-entry.tsx:349-360`（`decision.explicit === undefined` → `seam.thinking.selectEffort(target)`），helper `packages/tui-base/src/routes/session/powerline.tsx:249-256` | **劣化**：成为 #5 的常驻触发器（mount/turn-end 都跑一次） | tui-pi（行为层：展示默认≠写默认）。若保留 display 默认 "high"，只删写回臂 |
| 7 | 失败可见性：selectModel 失败 | 命令体 throw → `CommandService.tryExecute` catch → error notice：`src/commands.ts:202-212`；`llm.resolveCallConfig` 校验失败即抛：`src/index.ts:1233-1235` | `directory.select` 返回 `RemoteResult`，失败写 store `error` + `status='error'` 并返回给 UI：`model-selection pkg lib/client.js:888-895` + `lib/types/client/directory.d.ts:28-64`；UI Toast `code: message`：`lib/client.js:1403-1411`（`settleSelection`）+ 菜单内 error 条 `lib/client.js:1603-1607` | adapter `.catch(console.error)` 吞掉：`session-seam-adapter.ts:348-355`、`397-412`；facade live 分支也吞：`remote-host-session.ts:925-929`、`2114-2118`；命令随后**无条件**回显成功：`commands.ts:406-407`、`432/445/449`、`/think` 的 `commands.ts:760-761` | **劣化（bug ② 根因）** | web（失败必须带 code+message 呈现；opentui 在 transcript say 一行 error 即可，UI 形式自有） |
| 8 | 失败可见性：持久化失败 | `persistDefaultModel` 返回错误串，拼进成功文案：`src/session.ts:2386-2433`、`src/index.ts:1237-1245`（`tui.persist.failed`） | 持久化在 host 侧（session/selectModel durable per session），客户端无二次持久化 | sessionless `/model` **无任何持久化**：`commands.ts:396-477` 全流程无 settings 写；暂存只活在 client 进程内存（重启丢）。live session 走 host durable（OK） | **劣化**：跨进程/重启不保留用户选择 | tui-pi（默认模型进 settings 命名空间；web 的 durable per-session RPC 在 live 态 opentui 已有） |
| 9 | 提交前校验 route 真实存在 | `resolveCallConfig({provider, model})`：`src/index.ts:1233-1235`（provider 不存在即抛，选择不落） | catalog 里选的（选项即 catalog 行），天然不存在幽灵 route；select 结果 host 裁决：`model-selection pkg lib/client.js:880-895` | 参数形式 `/model a/b` 与 picker 行都可直接提交，无预校验；sessionless 时 host 也不裁（只暂存）：`commands.ts:398-409`、`remote-host-session.ts:940-942` | **劣化**：幽灵 route 可暂存且回显成功 | tui-pi（预校验）＋ web（host 裁决结果回传） |
| 10 | 档位列表来源（reasoning levels） | host 实时数据 `llm.resolveModelInfo(...).reasoning.efforts`：`src/selectors.ts:149-165`、`473-499` | host-generation catalog：`remote.session.modelCatalog()`，per-model `reasoning{efforts,defaultEffort}` 按 host 代缓存：`model-selection pkg lib/client.js:711-771`（`ModelCatalogDirectory`），`reasoningFor` 723-728 | 同一 catalog 字段：`remote-model.ts:113-164`（解析 `reasoning.efforts` + `defaultEffort`）；adapter `efforts()` 读当前 route 的 ladder：`session-seam-adapter.ts:362-388`；`effortsFor` 任意 route：`391-392` | 对齐（同一 host RPC 同一字段） | 无需改 |
| 11 | effort 默认值（defaultEffort）的使用 | stage-2 无 kept effort 时**预选 high**（写死倾向，但只影响光标）：`src/selectors.ts:501-508` | `reasoningFor(selection)?.defaultEffort` 作为未指定时的默认：`model-selection pkg lib/client.js:869-870`（`select()` 内 `nextEffort`）、`syncInputs` 972-973 | 解析了 `defaultEffort`（`remote-model.ts:150`）但 **没用**：stage-2 无预选、无 defaultEffort 回落 | 轻微差异（非 bug） | web（用 defaultEffort 做 display/预选；不要学 tui-pi 写死 high） |
| 12 | 重连/新 host generation | 进程内无此问题（in-process） | `resetConnected` 使未决选择失效、catalog 换代重载：`model-selection pkg lib/client.js:925-934`、`773-795` | catalog 缓存有失效机制（凭据/设置推送）：`remote-model.ts:104-115`、`166-169`；但 `#pendingModel` 跨 host 重启是否保留未见处理（facade 进程内存） | 待验证（见 ③） | web（换代时清 pending，别把旧代选择补发到新代） |
| 13 | 启动入口 / surface 区分 | profile `tui` 的 bundles = `dsh-base + @aiwayds/dsh-tui-pi + …`，**无 dsh-web-app**：`~/.dsh/profiles/tui/package.json`（dsh.profile.bundles）；插件 in-process 起终端 UI → `dsh --profile tui` 即 TUI，无 web | `web` profile = `dsh-base + dsh-web-app`：`~/.dsh/profiles/web/package.json` —— `dsh --profile web` 起 web 是**设计如此** | opentui profile **从 `web` 模板克隆**：`packages/shell/scripts/provision-opentui-profile.mjs:87`（`const TEMPLATE = 'web'`）、`:137`（`--from-default-profile web`）；实际 bundles 含 `@deepseek-ai/dsh-web-app`：`~/.dsh/profiles/opentui/package.json` → `dsh --profile opentui` = **起 web 并开浏览器**；TUI 只能走 `dsh-opentui` bin（`packages/shell/bin/dsh-opentui.mjs` → `dist/client/index.js`） | **劣化（入口陷阱）**：profile 组成与 web profile 同构，直接 `dsh --profile opentui` 得到 web | 分层裁决：client/server 分离是 ADR-0005 架构（照 web profile 的 client↔host 模式，保留）；但**坑本身**要么改 profile 组成（tui-pi 式：profile 不含 web-app），要么在 provision 时让 `dsh --profile opentui` 明确报错引导。这是产品决策，先记录 |
| 14 | UI（列表渲染/颜色/布局/预选样式） | FW 表格、★收藏、隐藏分区、`/` 过滤：`src/selectors.ts:308-361` | 双级菜单、badge、spinner-in-trigger：`model-selection pkg lib/client.js:1140-1730` | vendored dialog-select、headerLine、current 标记 | — | **opentui 自有，不照抄**（用户定调）。唯一跨界点：失败文案内容必须带 host 错误（见 #7） |

补充引用（tui-pi 侧佐证）：
- 暂存防覆盖（pin 优先于设置重播种）：`src/session.ts:519-535`（`if (this.handle === undefined && !this.selectionUserPinned) this.seedSelectionFromDefault(true)`）。
- workspace 覆盖只在没有用户选择时暂存（与 tui-pi pin 同构）：`remote-host-session.ts:1414-1418`（`this.#pendingModel === undefined` 才 stage）。
- host 侧 durable selection（live 态两仓同构）：tui-pi `src/session.ts:2358`（`handle?.agent.model.select(...)`）；opentui `remote-host-session.ts:944-949`（`session/selectModel` RPC，round-trip 返回 host 裁决：`remote-model.ts:223-235`）。

---

## ② 结论

### A. opentui 单方面劣化清单（全部有源码证据）

1. **sessionless 读数绕过暂存**（bug ① 读侧）：`currentModelSelection()` 在无 session 时返回 catalog default，不读 `#pendingModel` —— `remote-host-session.ts:963-967`。用户 `/model` 选 X 后 footer/`/model` current 仍显示 host 默认。
2. **effort 写入覆盖暂存路由**（bug ① 写侧）：`selectEffort` 用 `currentModelSelection()`（sessionless = host 默认）的 provider/model 重发 `selectModel`，直接覆盖 `#pendingModel` —— `session-seam-adapter.ts:397-412`。
3. **footer 自动写 "high" 充当常驻触发器**：每次 mount/turn-end footer refresh 都可能自动 `selectEffort("high")`，即 #2 的覆盖随时发生 —— `v2-entry.tsx:349-360`。tui-pi 与 web profile 均无此写回。
4. **失败吞掉 + 假成功回显**（bug ②）：adapter/facade 三处 `.catch(console.error)`（`session-seam-adapter.ts:352-354,409-411`、`remote-host-session.ts:927-928,2116-2117`），命令层无从得知失败，无条件 `ctx.say("model → …")`（`commands.ts:407,449`、`761`）。
5. **无提交前校验**：tui-pi 有 `resolveCallConfig` 预校验（`index.ts:1233-1235`），opentui 参数形式与 picker 均可直接暂存幽灵 route 并回显成功。
6. **sessionless 选择无持久化**：tui-pi 写 settings 命名空间（`session.ts:2386-2433`）且失败可见；opentui 暂存仅进程内存，client 重启即丢。
7. **两段式 esc 语义**：opentui stage-1 已提交，stage-2 esc 留下半个选择（`commands.ts:427-432` 注释明说）；tui-pi esc = 整个选择放弃（`selectors.ts:509-513`）。
8. **跨 provider 切换时 effort 一律清空**：opentui stage-1 `selectModel` 不带 effort（`commands.ts:432`）；tui-pi 同 provider 保留 effort、仅跨 provider 重置（`selectors.ts:465-471`）。
   → **状态（11-11 复核：提交层已对齐；stage-2 光标预选为保留的 UI 层差异）**。两段式重构（第一段不提交、Esc 放弃整体）后逐条对照：tui-pi 规则一句话 = **当前 effort 只在同 provider 的模型切换中存活**——存活时它是 stage-2 的预选光标（`selectors.ts:466-471`、`501-508`），新模型无档位（或 ladder 解析失败）的回退提交也显式带上它（`selectors.ts:479-498`），只有显式选 default 行才清掉（`selectors.ts:514-517`）。opentui 对齐证据：显式 `(model default)` = 清、显式选档 = 设、Esc = 全放弃（`commands.ts:509-517`、`532-535`）；**已修（本次）**：空 ladder 回退提交现在同 provider 时读提交前快照的当前 effort 并随 `selectEffort` 补写、跨 provider 仍重置（`commands.ts:463-494`，单测 `commands.test.ts` 「a same-provider pick on a ladder-less model carries the current effort」+「a cross-provider pick … never consults or carries the effort」，`bun test` 96 pass / 0 fail）。**保留差异（不照抄，UI 层）**：tui-pi stage-2 光标预选 keptEffort 行（裸 Enter = 保档，`selectors.ts:504-508` + `openEffortPicker` preselect `113-121`）；opentui 光标钉死第 0 行 `(model default)`（裸 Enter = 清档）——`pickOne` 的 `focusCurrent:false` 是 e2e 67 bare-Enter 契约（`v2-entry.tsx:442-473`），属 UI/交互层（用户定调 opentui 自有），不在命令层对齐。原条目的行号引用（`commands.ts:432` 单段式）已过时。

### B. 两边都一样 / 都没有问题的点

- live session 下都走 host durable per-session selection（tui-pi `agent.model.select` / opentui `session/selectModel` RPC）。
- 档位列表同源：都是 host `session/modelCatalog`（或 in-process 等价物）的 `reasoning.efforts`，无硬编码 ladder（opentui `remote-model.ts:113-164`、tui-pi `selectors.ts:149-165`）。
- workspace overlay 模型偏好只在无用户选择时生效（opentui `remote-host-session.ts:1414-1418` ≈ tui-pi pin 规则）。
- 模型不可用时的 effort 保留文案（web `retainedEffort`）与 opentui/tui-pi 的降级路径各有实现，不算劣化。

### C. 修复清单（按层）

**client↔server 通信层 —— 照 web profile：**
1. **读合并序改为 `pending ?? projection ?? catalog.default`**。web 的 `syncInputs` 即此序（`lib/client.js:967-995`）；opentui 自己在 `btwAsk` 里已经写对了一次（`remote-host-session.ts:1761`）。落点：`RemoteHostSession.currentModelSelection()`（`remote-host-session.ts:963-967`）与 footer 读数（`v2-entry.tsx:376-381`）。
2. **select 的失败按 RemoteResult 语义回传 UI，不许在通信层吞**。web：`directory.select` 返回结果并把 `code: message` 写入 store（`lib/client.js:888-895`），UI Toast/错误条呈现（`lib/client.js:1403-1411,1603-1607`）。落点：去掉 `session-seam-adapter.ts:352-354,409-411` 与 `remote-host-session.ts:927-928,2116-2117` 的吞错，把 rejection 抛回 seam；opentui 的 wire 层（`remote-model.ts:223-235`）本身就会 throw host 裁决结果，直接可用。
3. **host 换代/重连时清未决暂存**，避免把旧代选择补发到新代。web：`resetConnected`/`resetGeneration`（`lib/client.js:925-934,773-795`）。落点：opentui follow 断链重挂路径清/重验 `#pendingModel`。
4. 暂存补发时机（attach 后、首条消息前）两仓一致（`remote-host-session.ts:2109-2119`），保持。

**功能/行为语义层 —— 照 tui-pi（tui-pi 正确处即标准）：**
1. sessionless 用户选择必须进"选择 ref"并 pin 住（`selectionUserPinned`，`session.ts:352-359,2351-2359`）；设置/目录重播种不得覆盖 pin（`session.ts:519-535`）。
2. `/think`/stage-2 改档位只能作用于**当前选择（含暂存）**，provider/model 永不被默认路由顶替（`index.ts:1276-1306`）；同 provider 保留 effort、跨 provider 才重置（`selectors.ts:465-471`）。
3. 两段式 esc = 放弃整个选择，stage-1 不得提前提交（`selectors.ts:508-513` 对 `commands.ts:427-432`）。
4. 失败必须可见：命令回显要区分成功/失败文案，持久化失败拼进回显（`index.ts:1237-1245` 的 `tui.persist.failed` 模式）。
5. 提交前校验 route 存在（`resolveCallConfig` 等价物：对暂存 route 跑一次 catalog 命中检查即可，`remote-model.ts:196-200` 的 `modelContextWindow` 已示范按 catalog 查行）。
6. sessionless 默认模型持久化到 settings（tui-pi `persistDefaultModel` → `agent-default-model` 命名空间，`session.ts:2386-2433`）。
7. 删除 footer 自动写 "high"（对照 tui-pi footer 纯读，`footer.ts:220-233`）；"未指定默认显示 high" 可保留为 display-only。

**UI/交互层 —— opentui 自有，不照抄：**
- 列表布局、颜色、两段式弹层形态、transcript say 行 vs web Toast —— 全部保留 opentui 现状。唯一约束来自语义层：失败文案内容必须含 host 错误码/消息（呈现形式不拘）。

---

## ③ 未验证项与用户自行复核的最小命令

未验证（只读审计未执行运行时行为）：
1. host 断链重挂后 `#pendingModel` 的实际存活行为（代码未见显式清理，行为需实测）。
2. web profile 在"全新 conversation 未发首条消息"时 `session/create` 的确切时机（web 前端是否 eager 建 session 未从已装闭包确认；不影响结论——web 的 select 永远带 sessionId）。
3. `dsh --profile opentui` 起 web 的运行时表现（遵守约束未启动任何 dsh 进程）；profile 组成证据来自 `~/.dsh/profiles/opentui/package.json` 与 provision 脚本静态阅读。

复核命令（全部只读）：
```bash
# bug ① 读侧：currentModelSelection 忽略暂存
sed -n '963,967p' /Users/qingguee/repo/dsh-opentui/packages/shell/src/client/remote-host-session.ts
# bug ① 写侧：selectEffort 用 currentModelSelection 重发
sed -n '397,412p' /Users/qingguee/repo/dsh-opentui/packages/shell/src/client/session-seam-adapter.ts
# footer 自动写 high
sed -n '344,360p' /Users/qingguee/repo/dsh-opentui/packages/tui-base/examples/v2-entry.tsx
# bug ② ：吞错 + 无条件成功回显
sed -n '348,355p' /Users/qingguee/repo/dsh-opentui/packages/shell/src/client/session-seam-adapter.ts
sed -n '404,410p' /Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/commands.ts
# opentui profile 是 web 模板克隆（入口陷阱）
grep -n "TEMPLATE" /Users/qingguee/repo/dsh-opentui/packages/shell/scripts/provision-opentui-profile.mjs
python3 -c "import json;print(json.load(open('$HOME/.dsh/profiles/opentui/package.json'))['dsh']['profile']['bundles'])"
# tui-pi 对照（pin / footer 同源 / esc 语义 / 预校验）
sed -n '2351,2359p' /Users/qingguee/repo/dsh-tui-pi/src/session.ts
sed -n '222,233p' /Users/qingguee/repo/dsh-tui-pi/src/footer.ts
sed -n '501,513p' /Users/qingguee/repo/dsh-tui-pi/src/selectors.ts
sed -n '1233,1245p' /Users/qingguee/repo/dsh-tui-pi/src/index.ts
# 差异 8 复核（11-11 更新）：tui-pi keptEffort 规则 vs opentui 已修的空 ladder 回退
sed -n '465,520p' /Users/qingguee/repo/dsh-tui-pi/src/selectors.ts
sed -n '463,494p' /Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/commands.ts
# web 官方实现（读合并序 / 失败回传 / effort 用 current）
sed -n '967,995p' ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js
sed -n '869,895p' ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js
sed -n '1423,1432p' ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js
```
