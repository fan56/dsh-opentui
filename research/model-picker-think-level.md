# /model 两段式选择（模型 → think level）设计

状态：只读调研 + 设计，未实现。日期：2026-11-11。
需求原文：「切换模型的时候, 选完模型, 没让我选 think level. 不管是再跳窗口,还是设计在同一个窗口,用按键选择. 这个功能需要的.」

---

## 0. 结论（推荐方案）

**推荐「跳第二个窗口」**：`/model` 裸形式选中模型后，**先提交模型切换，再弹出第二个 pickOne 窗口**「Select reasoning effort — provider/model」让用户选 think level。

一句话理由：现有组件 100% 复用（pickOne 已是 /think 在用的同一个 effort 窗口）、有两条成熟先例（/login 六步链式 modal、/agents 面板的两段 model→effort 流）、状态清理零成本（每个 pickOne 自管 dialog.clear）、且「先提交模型再问 effort」保住了 `/model` 的肌肉记忆——Esc 掉第二段时行为与今天完全一致。

同窗口两段式被否决的原因：vendored DialogSelect 是单段组件（ui/dialog-select.tsx），做段间回退（stage 2 Esc → 回 stage 1）需要新写 overlay 组件或改共享组件；该组件被 ~10 个面复用（/resume、ask picker、turn-overlays、delivery-choice、dialog-fork/timeline/message、queued prompts），爆炸半径不成比例。

---

## 1. 证据（file:line）

### 1.1 现有模型选择器

- `/model` 命令本体：`packages/tui-base/src/routes/session/commands.ts:386-420`
  - 参数形式 `/model provider/id`：直接 `ctx.seam.selectModel(providerID, modelID)` + `say` + `ctx.refreshFooter?.()`（:390-399）。
  - 裸形式：`ctx.seam.modelCatalog()` → `ctx.pickOne("Select model", ...)` → `selectModel` + `say` + `refreshFooter`（:401-419）。当前行只标 `description: "current"`，未用 currentValue 标记。
- pickOne 契约（SlashCommandContext）：`commands.ts:101-114`（esc/cancel 解析 undefined；`currentValue` 走 α skin `●` 当前标记且选择停在第 0 行）。
- pickOne 实现（唯一宿主）：`packages/tui-base/examples/v2-entry.tsx:442-473` —— `dialog.replace(DialogSelect)`，`renderFilter: false`，`current` + `focusCurrent: false`，选中或 esc 均 `dialog.clear()` 后 resolve。
- vendored DialogSelect 键位：`packages/tui-base/src/ui/dialog-select.tsx:474-579` —— up/down、page_up/down（±10）、home/end、submit（Enter）、escape（"Back"）；**无数字键绑定**。option 支持 `disabled`（:214/:218 过滤）。

### 1.2 think level 现状

- 独立入口 `/think`：`commands.ts:669-708`。读 `seam.thinking.efforts()`（空 → "unavailable" 降级行）→ pickOne「Select reasoning effort」→ `invalidateFooter()` → `await thinking.selectEffort(picked)` → `say("thinking → X (next turn)")` → `refreshFooter()`。
- 无快捷键、无 `/model` 附加参数。生效时机：**下一 turn**（selection 是 per-session 持久的，作用于该 session 的 NEXT request —— `packages/shell/src/client/remote-model.ts:18-23`）。
- seam thinking 面：`packages/tui-base/src/seams/session.ts:484-488`（efforts / currentEffort / selectEffort；ladder 明文注释「real provider data, never a hardcoded off/low/medium/high set」:475-477）。
- adapter 实现：`packages/shell/src/client/session-seam-adapter.ts:362-409`
  - `efforts()`：读当前 route 的 `model.reasoning.efforts`（catalog wire 形状，:363-388）。
  - `currentEffort()`：`selection.reasoningEffort`（:389-392）。
  - `selectEffort(effort)`：= `selectModel({provider, model, reasoningEffort?})`，**undefined 即清除 override**（:393-408）。
- footer 可见性：
  - 数据：`examples/v2-entry.tsx:324-402` `refreshFooterData()`——`thinking.currentEffort()` + `sessionInfo().model` 标签双源 → `decideEffort` → setEffort；未指定且 ladder 含 "high" 时后台写默认 high（`defaultEffortToApply`）。挂载/重载/turn-end 各刷一次；`/model` `/think` 命令收尾手动调 `ctx.refreshFooter`。
  - 渲染：`packages/tui-base/src/routes/session/powerline.tsx:663-668` model 段 `🤖 <model> <icon> <effort>`，装配在 :1044。

### 1.3 档位来源

- **catalog 暴露档位**：`remote-model.ts:50-57` —— 每个 model 行带 `reasoning?: { efforts: RemoteReasoningEffort[]; defaultEffort?: string }`（`RemoteReasoningEffort = {id, name, description?}` :39-43）；解析在 :139-153（含 `defaultEffort` 透传）。档位集合是 provider 数据，各模型可以不同、可以没有（`reasoning` undefined = 无 ladder）。
- 显示侧硬编码表（仅展示词汇，不是数据源，改 UI 不动它们）：
  - `powerline.tsx:189` `EffortLevel = off|minimal|low|medium|high|xhigh|max`；:192 `DEFAULT_EFFORT = "high"`；:202-215 `isExplicitEffort`/`effectiveEffort`（显式词永不被拉回默认）；:233-239 `decideEffort`；:249-256 `defaultEffortToApply`；:616-628 `EFFORT_ICONS` + `effortIcon`（未知词落 `○`）。
- **关键缺口**：seam 面 `modelCatalog(): Promise<SeamProviderModel[]>` 的行只有 `{providerID, modelID}`（`seams/session.ts:116-119`；adapter `session-seam-adapter.ts:330-339` 组装时**丢掉 ladder**）。`/model` 命令今天拿不到「任意一个模型」的档位——它只能拿到「当前 route」的（thinking.efforts）。
- 已存在的「任意 route 的 ladder」读取：`seam.agents?.modelEfforts(providerID, modelID)`（`seams/session.ts:562`；adapter `session-seam-adapter.ts:480-481` → `remote-host-session.ts:1484-1489`，走缓存的 catalog；in-process 面契约 `shell-session.ts:81` 必有此方法）。/agents 面板正用它（`agents-panel.tsx:780,834`）。

### 1.4 可复用的两步选择先例（不要新造）

1. **/agents 面板的两段 model→effort 流（形态最接近，直接抄规则）**：
   - 纯状态机 `AgentPickerFlow`：`packages/tui-base/src/routes/session/agents-panel.tsx:496-538` —— `beginPickerFlow` / `pickerSelectModel`（ladder 空 → 直接 `done` 提交 `thinking:null`，**跳过第二段**；有 ladder → 进 effort 段）/ `pickerSelectEffort`（**第 0 行 = (provider default)，选中即清 override**）/ `pickerCancel`（任一段 Esc 取消整个变更）/ `effortCursorFor`（记忆档位在第 0 段预选）。
   - 面板驱动：`agents-panel.tsx:757-866`（openModelPicker → chooseModel 读 ladder → stage "effort" → commitModel 双写）。
2. **modal 链式先例**：`/login` 六步链（1 路由 id → … → 6 key），全部用顺序 `ctx.pickOne`/`ctx.promptText` 组成，esc 在任一步中止整条链：`commands.ts:455-463` + 步骤表 `packages/tui-base/src/routes/session/login.ts:69-77`。
3. currentValue 当前标记先例：`/theme`（`commands.ts:838-846`）。

### 1.5 测试覆盖现状

- `/model`：`packages/tui-base/test/commands.test.ts:277-318`（裸形式开 picker + 选中回写、esc 不选、参数形式直选、坏参数 usage）。
- `/think`：`commands.test.ts:538-610+`（选中 → `thinking → low (next turn)`、esc 无操作、无 thinking 面降级、空 ladder 降级）。
- 两段流状态机：`packages/tui-base/test/agents-panel.test.ts:240-280`（空 ladder 直接提交、有 ladder 进第二段且预选、第 0 行清除、任一段 esc 取消、"(provider default)" 行首）。
- catalog/选择 wire：`packages/shell/test/remote-model-settings.test.ts:82+`（catalog 映射含 `reasoning.efforts` 与无 reasoning 模型、`session/selectModel` 往返、默认路由应用）。
- footer/effort 展示：`packages/tui-base/test/powerline.test.ts:566`（default effort policy）+ `packages/tui-base/test/footer-quickwins.test.ts:40,59`（effort 字形 ladder、model 标签解析）。
- adapter thinking 面单测：**无**（`session-seam-adapter.test.ts` 未覆盖 thinking；ladder 解析只有 e2e 兜底）。
- e2e：`e2e/scenarios/30-commands.sh:150-162`（/model 裸形式只断言 catalog 列出 pinned 模型，**不按 Enter 选中**）；:212-247（/think picker 开/关，THINK_GATE 门控）。

---

## 2. 交互细节

### 2.1 流程（裸形式 `/model`）

```
/model ↵
  ├─ 窗口 1「Select model」（现状不变：catalog 列表，current 行标 ●）
  │    Enter → 立即 selectModel(provider, model) + say("model → p/m")   ← 提交点在第一段边界
  │    Esc  → 不选，结束（现状不变）
  ▼
  ├─ 读该模型的档位（见 2.4）
  ├─ ladder 为空 → 跳过第二段，结束（与 /agents pickerSelectModel 的空 ladder 臂一致）
  ▼
  └─ 窗口 2「Select reasoning effort — p/m」
       第 0 行：「(model default)」—— 清除 override，行为与今天完全一致
       第 1..n 行：catalog ladder（name + description），current effort 标 ●
       Enter → selectEffort(effort)（复用 /think 的 invalidateFooter → await → refreshFooter 顺序）
       Esc  → 保留第一段已提交的模型，不设 override（= 今天的语义，零回归）
```

- 参数形式 `/model p/m` **保持直选、不弹第二段**（脚本/肌肉记忆面，今天就是一击直达）。
- 模型在第一段边界就提交的理由：第二段 esc/断电/任何异常都不破坏「选了模型 = 模型已切」这一现有契约；`selectModel` 不带 `reasoningEffort` 时 host 清 override 落回模型默认（`session-seam-adapter.ts:393-408`、`remote-model.ts:223-235`），与今天行为逐字节一致。

### 2.2 键盘模型

- 两段都用现有 pickOne/DialogSelect 键位，**不加新键**：↑↓ 移动、Enter 确认、Esc 取消（段 1 = 整体取消，段 2 = 保留模型、不设档位）、PgUp/PgDn/Home/End 白拿。
- **不加数字键**：DialogSelect 无数字键绑定（dialog-select.tsx:474-579），加它是新 keybind 面；档位最多几行，↑↓ 足够。

### 2.3 无档位模型

- **跳过第二段**（不显示 disabled 窗口）。依据：`/think` 空 ladder 已是「unavailable 降级行」契约（commands.ts:678-681），/agents 空 ladder 直接提交（agents-panel.tsx:525）。第二段弹一个空窗或全 disabled 行都会制造「这模型是不是坏了」的误读。
- 跳过时的反馈行合并成一条：`model → p/m (no think levels)`，让用户知道第二段为什么没出现。

### 2.4 档位读取与默认值

- 读取：给 seam `thinking` 面加**可选**臂 `effortsFor?(providerID, modelID)`（`seams/session.ts:484-488`），adapter 委托给已有的 `agents.modelEfforts` 同一条实现（`session-seam-adapter.ts` 一处；in-process 面方法本就存在，`shell-session.ts:81`）。可选臂 → 老宿主缺它时降级跳过第二段，契约与 `/think` 一致。
  - 备选（零接口改动）：`ctx.seam.agents?.modelEfforts(...)`。可用但把 `/model` 耦合到 /agents 的 face 语义上，不推荐；设计按可选臂走。
- 第二段默认预选：**第 0 行「(model default)」**，不引入「上次记忆」。
  - 理由：(a) 当前栈对 per-route effort 没有任何持久化记忆（`selectModel` 换模型即清 override），做记忆等于新增持久化特性，超出本需求；(b) catalog 行已带 `defaultEffort`（remote-model.ts:55），第 0 行描述可显示 `(model default: high)`；(c) /agents 的 effortCursorFor 只在**同一模型已有记录**时预选，本场景刚换模型、无记录，落第 0 行正是它的行为。

### 2.5 状态清理

- 两个 pickOne 各自 `dialog.clear()` 后 resolve（v2-entry.tsx:450-455），命令内两个 `await` 串联即可，**无新状态**：局部变量 `providerID/modelID/ladder` 生命周期 = 命令函数体。无 signal、无 store、无 footer 渲染改动。

---

## 3. 影响面清单

| 文件 | 改动 |
|---|---|
| `packages/tui-base/src/routes/session/commands.ts` | `/model` 裸形式 run()：第一段选中后提交模型，读 `effortsFor`，非空则第二段 pickOne + selectEffort；`say` 文案微调。唯一必改的生产文件 |
| `packages/tui-base/src/seams/session.ts` | `thinking` 面加可选 `effortsFor?(providerID, modelID): Promise<SeamEffortOption[]>`（~4 行注释+签名） |
| `packages/shell/src/client/session-seam-adapter.ts` | `thinking` 对象加 `effortsFor`，委托 `this.#session.modelEfforts(pid, mid)`（~3 行） |
| footer 渲染（powerline.tsx / v2-entry.tsx） | **不改**。refreshFooter 已在 /model 收尾被调，effort 段自动跟随新 route |
| DialogSelect / pickOne 宿主 | **不改** |
| keybind / 配置 | **不改**（无新键） |

测试新增：`commands.test.ts` 补 3-4 例（空 ladder 跳段、第二段选中 → selectEffort 调用序、第二段 esc → 模型已提交且无 selectEffort、缺 effortsFor 臂降级）。

## 4. 风险

- **肌肉记忆**：裸形式 `/model` 从「Enter 一次完事」变成「Enter → (Enter 或 Esc)」。受影响键位仅此一条路径；参数形式与全局键位（config/keybind.ts）零变化。缓解：第二段默认行 `(model default)` 双击 Enter = 语义上最接近旧行为的路径；Esc = 模型已切、行为与今天逐字节一致。
- **e2e 30-commands.sh:150-162**：只开 picker 验 catalog 列出，不按 Enter 选中 → 两段化不破坏它（picker 开、Esc 关，第二段根本不出现）。
- **`/think` 语义漂移**：无。/think 仍是独立入口；两段只是复用同一窗口形态与提交顺序（invalidateFooter → await selectEffort → refreshFooter，commands.ts:699-706）。
- **busy-gate / 并发**：pickOne 是命令内 await，与 /login 链同一并发模型；无新的竞态。footer 默认 high 写入链（defaultEffortToApply）已有 seq 守卫（v2-entry.tsx:323-361），第二段 esc 路径不触碰它。
- **adapter 覆盖缺口**：thinking 面本来就没有单测（见 1.5）；新臂要补 commands.test.ts fake seam 用例，否则 e2e-only。

## 5. 最小验证手段

1. **单测（首选，足够闭环）**：`packages/tui-base/test/commands.test.ts` 沿用 RecordingSeam fake（:21+，已含 modelEfforts 间谍位 :72）加四例：
   - 裸形式选中有 ladder 模型 → 断言 `selectModel:p/m` 与 `selectEffort:low` 两次调用及 `thinking → low (next turn)` 行；
   - 第二段 esc → 只有 `selectModel:p/m`，无 selectEffort；
   - 空 ladder → 只有 selectModel + `(no think levels)` 行；
   - seam 缺 `effortsFor` 臂 → 同空 ladder 臂（降级）。
   运行：`bun test packages/tui-base/test/commands.test.ts`（不跑容器）。
2. **ui-matrix（可选，视觉回归）**：`verify/ui-matrix.mjs` 场景 3/5 覆盖 slash/footer 帧形态；两段化不改 footer 几何，预期全绿。
3. **e2e（不必须，且本任务约定不跑）**：如要补，30-commands.sh 已有 /think picker 开关断言样板（:212-247），可照抄一段「/model → Enter → 'Select reasoning effort' 出现 → Esc」；依赖 dist-host 重建门控。

## 6. 未验证项

- `effortsFor` 走 `#session.modelEfforts` 时对**in-process**（非 remote）模式的真实返回形状未实测（契约在 shell-session.ts:81，remote 实现在 remote-host-session.ts:1484-1489；in-process 宿主实现文件未逐行确认）。
- catalog `defaultEffort` 在各 provider 的实际填充率（决定第 0 行描述能否稳定显示 `(model default: high)`）。
- 无档位模型的实际占比（跳段路径的触发频率，只影响文案取舍，不影响正确性）。
