# 面板配色接线规格（/settings 面板 → 主题语义角色）

日期：2026-11-13 · 仓库：`~/repo/dsh-opentui`（main=a8e3927，0.11.0）· 只读调研，未改源码
读者：实现任务。文末 §8 给出可直接复核的命令。

---

## 1. 结论摘要

1. 主题切换链路本身是通的：`/theme` → `themes.set()` → `ThemeProvider` 的 `selected` memo → `ComponentTheme` 的响应式 getter → `PanelKitHost` 的 `panelTheme` accessor → 面板重绘（§2.2）。**缺的不是"切换"，是"映射"**。
2. `/settings` 右侧内容区发黑有三个叠加原因：
   - 内容区底 = `ComponentTheme.background.base`（dsh-blue dark `#0a0a0f`），与 59% 黑 scrim 只有 **1.06:1**，面板本质就是"黑盒"（`panel-kit-host.tsx:44` + 探针实测）。
   - `text.faint` 在主题层被 expand 默认成 `text.muted`，`text.disabled` 三个主题也都等于 muted → 次级文字没有层级，全是一片灰（`expand.ts:52`）。
   - `text.danger` 投影自 `text.action.destructive.base`，三个主题该 token 都是**背景色**（`#0a0a0f`/`#1a1b26`/`#282828`）→ 错误/危险文字 1.0:1，纯隐形（`panel-kit-host.tsx:56`）。
3. 编辑器视图（`EditorView`）整段是裸 `<text>`，没有 `fg` → 走渲染器/终端默认色，完全脱离主题系统（`settings-modal.tsx:1283-1344`）。这正是"编辑器选项不跟主题变"的直接原因。
4. 方案：在 `PanelTheme` 增加 5 个语义槽位（`background.content`、`text.code/system/user/heading`），修正 `text.danger`、`border.focused`，内容区改用主题自带的 raised 阶梯。**零硬编码**，全部在 `projectPanelTheme()` 内投影。

---

## 2. 主题真源与数据流

### 2.1 主题文件（两代格式并存）

| 主题 | 文件 | 格式 | 证据 |
|---|---|---|---|
| dsh-blue（默认） | `packages/tui-base/src/theme/assets/v2/dsh-blue.json` | v2 `{base,light,dark}` | `theme/index.ts:50-55`、`seams/theme.ts:16-18`（`DEFAULT_THEME="dsh-blue"`） |
| opencode / opencode2 | `.../assets/v2/opencode.json`、`opencode2.json` | v2 | `theme/index.ts:10-12, 27-43` |
| tokyonight / gruvbox 等 32 个 | `.../assets/*.json` | v1 `{defs,theme}` | `theme/index.ts:57-79`（`DEFAULT_THEMES` + `listThemes`） |
| 用户自定义 | `discoverThemes()` 扫 `themes/` 目录 | v1 或 v2 | `theme/discovery.ts:4-22` |

- v1 → v2 迁移：`parseTheme`（`theme/index.ts:85-97`）走 `migrateV1`（`vendor/theme/src/tui/v1-migrate.ts`）；`text.base/muted` 在 `:126-136`，`markdown.*` 在 `:210-224`，`syntax.*` 其后。
- v2 展开与默认值：`expand.ts:38-66`。**关键坑**：`faint` 缺省 = `$text.muted`（`expand.ts:52`），所以所有主题的 faint 与 muted 同值；`formfield/action` 的 `$state` 缺省回落到 base（`expand.ts:75-95`）。

### 2.2 切换时值如何流动

```
/theme 对话框          themes.set(name)   store.active 变化
dialog-theme-list.tsx:30-42  →  context/theme.tsx:345-358
        ↓
selected memo (context/theme.tsx:303-320) → resolveThemeDocument(document, mode)
        ↓
current: createComponentTheme(tokens)  (theme/component.ts:5-46)  ← 全是 getter，响应式
        ↓
PanelKitHost: () => projectPanelTheme(theme) → PanelKitProvider  (panel-kit-host.tsx:126-136)
        ↓
Panel 每层再包一个 Provider（淡出投影，panel.tsx:319）→ 控件 usePanelTheme() 实时读（panel-kit/src/theme.ts:94-97）
```

- 面板侧不再读 tui-base 上下文（决策 D1，`panel-kit/src/theme.ts:1-11`），唯一注入点就是 `projectPanelTheme`。
- 主题行在设置面板里也是同一路径：`settings-panel.tsx:999-1000`（`case "theme": themes.set(..., {persist:false})`），提交后 `settings-modal.tsx:464` 触发。
- `/settings` 的 modal host 挂在 `PanelKitHost` 之内（`examples/v2-entry.tsx:1185-1210` 包住 `V2SessionPage`，`SettingsModalHost` 在 `:779`），所以投影链有效。

### 2.3 转录侧的语义角色（要复用的一套）

`routes/session/transcript.tsx:267-284`：

| 角色 | token | dsh-blue dark | tokyonight dark | gruvbox dark |
|---|---|---|---|---|
| 正文 | `text.base` | `#eeeeee` | `#c8d3f5` | `#ebdbb2` |
| user 消息 | `text.action.primary.base` | `#eeeeee` | `#c8d3f5` | `#ebdbb2` |
| reasoning / 次级 | `text.muted` | `#8a8a8a` | `#828bb8` | `#928374` |
| code（行内/块内文本） | `markdown.code` / 块文本 `markdown.codeBlock` | `#7fd88f` / `#eeeeee` | `#c3e88d` / `#c8d3f5` | `#fabd2f` / `#ebdbb2` |
| 标题 | `markdown.heading` | `#8599ff` | `#c099ff` | `#83a598` |
| 链接/信息 | `markdown.link` / `feedback.info.base` | `#8599ff` / `#56b6c2` | `#82aaff` / `#82aaff` | `#8ec07c` / `#fabd2f` |
| error / warning / success | `text.feedback.*.base` | `#e06c75` / `#f5a742` / `#7fd88f` | `#ff757f` / `#ff966c` / `#c3e88d` | `#fb4934` / `#fe8019` / `#b8bb26` |
| accent（焦点/光标） | `hue.interactive[500]` | `#4d6bfe` | `#82aaff` | `#83a598` |
| code block 边框 | `border.base`（`transcript.tsx:317`） | `#3a3f5c` | `#737aa2` | `#665c54` |
| 用户消息边框 | `unfocusedBorderColor` = `border.base`（`skin/semantic.ts:49-52`） | 同上 | 同上 | 同上 |
| 当前行 | `background.action.primary.focused` + `text.action.primary.focused`（`skin/semantic.ts:90-100`） | `#8599ff` / `#1e1e22` | `#ffffff` / `#1a1b26` | `#ffffff` / `#282828` |

（数值为本次探针实测，见 §8.1。）

---

## 3. 面板当前取色与"一片黑"定位

### 3.1 `projectPanelTheme()` 现在投影的字段

`panel-kit-host.tsx:40-78`：

| PanelTheme 字段 | 来源 | dsh-blue dark 实测 |
|---|---|---|
| `background.surface` | `theme.background.base` | `#0a0a0f` |
| `background.raised` | `theme.background.raised.high` | `#1e1e22` |
| `background.scrim` | 硬编码 `RGBA(0,0,0,150)`（唯一字面量，`:46-48`） | 黑 59% |
| `text.base/muted/faint` | 同名 token | `#eeeeee` / `#8a8a8a` / `#8a8a8a` |
| `text.accent` | `hue.interactive[500]` | `#4d6bfe` |
| `text.disabled` | `text.action.primary.disabled` | `#8a8a8a` |
| `text.danger` | `text.action.destructive.base` | **`#0a0a0f`（=背景）** |
| `text.warning/success` | `feedback.*.base` | `#f5a742` / `#7fd88f` |
| `row.activeBg/activeFg` | `background.action.primary.focused` / `text.action.primary.focused` | `#8599ff` / `#1e1e22`（6.33:1，正常） |
| `border.base/focused` | 都是 `theme.border.base`（只改线宽） | `#3a3f5c` |
| `border.warning` | `feedback.warning.base` | `#f5a742` |
| `identity` | `hue.accent[500]` / `[300]` | `#4d6bfe` / `#6b82fe` |

### 3.2 消费面（panel-kit 内实际读取）

`grep -rho "theme()\.[a-zA-Z.]*" packages/panel-kit/src | sort | uniq -c`：

```
16 text.muted  6 attributes.keyHint  5 text.disabled  5 row.activeFg  4 text.base
3 text.accent  3 attributes.title   2 text.faint     2 row.activeBg  1 text.danger
1 border.base  1 border.focused    1 background.surface
```

即：`text.danger`、`text.faint` 已有消费点但取值为隐形/同 muted；没有任何"值/代码/标题/系统"角色，所以面板只能把一切压到 base/muted 两档。

### 3.3 内容区当前取色（元素级）

- 内容区容器 `settings-modal.tsx:1171` 没有 `backgroundColor`，透出 Panel 的 `theme().background.surface`（`panel.tsx:301`）。
- 分节标题条 `:1172-1176` 用 `chrome().titleBand`，正文文字 `text.base`。
- 行列表 `List`：`list.tsx:768` → `toneColor`（`list.tsx:534-546`）：`muted→text.muted`，默认 `text.base`；徽标 `:807` 用 `text.accent`；描述 `:813` 用 `text.muted`（选中行 `row.activeFg`）。
- 行数据：`rowListItems`（`settings-modal.tsx:592-600`）——可编辑行给 `badge:"✎"`，**不可编辑行一律 `tone:"muted"`**。
- 编辑器视图 `EditorView`（`settings-modal.tsx:1248-1347`）全部裸 `<text>`：标题 `:1283`、note `:1285`、子菜单 `:1291/:1293`、枚举选项 `:1310`、选项分页 `:1315`、输入标签/值 `:1321-1322`、提示 `:1341-1343`。**无 `fg` → 主题无关**。

### 3.4 为什么观感"一片黑"

| 证据 | 数值 |
|---|---|
| `chrome().content`（=`background.base`） vs scrim | **1.06:1**（dsh-blue dark）；tokyonight 1.23、gruvbox 1.42 |
| `navBand` vs `content` | 1.19:1（几乎分不出导航带） |
| `faint` vs `content` | 5.72:1，但 **faint == muted**，层级为零 |
| `disabled` == `muted`（三主题、明暗两模式都成立） | 探针实测 |
| `text.danger` vs `content` | **1.00:1**（错误行不可见） |
| 编辑器区文字 | 非主题色（渲染器默认） |

结论：背景阶梯只有 1.06–1.23:1，"黑"来自 `background.base` 作内容底；"看不清/没有层级"来自 muted/faint/disabled 三合一；"编辑器选项不跟主题"来自裸 `<text>`。

---

## 4. 接线方案

### 4.1 PanelTheme 槽位增补（精确字段名与来源）

在 `packages/panel-kit/src/contracts.ts:147-203` 增加/修改，`packages/tui-base/src/context/panel-kit-host.tsx:40-78` 同步投影：

| 新字段 | 来源 token（ComponentTheme） | 语义（对齐转录） |
|---|---|---|
| `background.content` | `theme.background.raised.base` | 面板内容底，主题自带 raised 阶梯的第一级（dsh-blue `#141419`、tokyonight `#1e2030`、gruvbox `#3c3836`） |
| `text.code` | `theme.markdown.code` | 代码/字面量（枚举选项、设置值、代码块文字） |
| `text.user` | `theme.text.action.primary.base` | user 角色（可编辑标记 ✎） |
| `text.system` | `theme.text.feedback.info.base` | system/提示角色（N/A 行、导航计数、状态行） |
| `text.heading` | `theme.markdown.heading` | 标题/分组表头/分节标题 |
| `text.danger`（修正） | `theme.text.feedback.error.base`（现为 `action.destructive.base`） | 错误语义 |
| `border.focused.color`（修正） | `theme.hue.interactive[500]`（现为 `border.base`） | 焦点可见（与 `skin/semantic.ts:53-57` 同源） |

连带必须改的三处（否则新槽位不生效/不过测试）：
1. `panel-kit/src/theme.ts:176-183` `resolvePanelChrome`：`content = theme.background.content`；`titleBand = fadeColor(content, navBand, 0.5)`；`navBand = theme.background.raised`；`divider = theme.border.base.color`。
2. `panel-kit/src/theme.ts:208-245` `fadeTheme`：把 `background.content` 与 4 个新 text 槽位一起做 mix，否则入场淡入时新槽位不动。
3. `panel-kit/src/fallback.ts`：`FALLBACK_THEME` 补齐同名字段（唯一允许的字面量文件）。

### 4.2 元素 → 角色映射表

| 面板元素 | 位置 | 当前 | 接线后 |
|---|---|---|---|
| 内容区底 | `settings-modal.tsx:1171` + `panel.tsx:301` | `background.surface`（base，1.06:1） | `background.content`（raised.base） |
| 标题条 | `settings-modal.tsx:1172` | `chrome().titleBand` | 保持 `resolvePanelChrome`（现由 content/navBand 推导） |
| 分节标题文字 | `settings-modal.tsx:1173` | `text.base` | `text.heading` |
| 行标签（可编辑） | `list.tsx:809` | `text.base` | `text.base` |
| 行标签（只读/N/A） | `settings-modal.tsx:597` → `list.tsx:534-546` | `tone:"muted"` → `text.muted` | `text.system` |
| 行值/描述 | `list.tsx:813` | `text.muted` | `text.code`（值字面量；浅色主题有对比度风险，见 §5） |
| ✎ 可编辑徽标 | `list.tsx:807` | `text.accent` | `text.user`（避开浅色主题 accent 4.24:1 风险） |
| › 跳转徽标 | `settings-modal.tsx:599` | `text.accent` | `text.accent`（保留） |
| 选中行 | `list.tsx:799-800` | `row.activeBg/activeFg` | 保留（实测 6.33–18.15:1） |
| 导航计数 | `settings-modal.tsx:1117` → `list.tsx:813` | `text.muted` | `text.system` |
| 分组表头 | `list.tsx:713,721` | `text.muted` | `text.heading` |
| 编辑器标题 | `settings-modal.tsx:1283` | 裸 text | `text.heading` |
| 编辑器 note | `settings-modal.tsx:1285` | 裸 text | `text.system` |
| 子菜单行 | `settings-modal.tsx:1291-1293` | 裸 text | `text.base` / note `text.system` |
| 枚举选项 | `settings-modal.tsx:1310` | 裸 text | `text.code`；`(current)` 后缀单独 `text.system` |
| ▸ 光标 | `settings-modal.tsx:1310` | 裸 text | `text.accent` |
| 选项分页指示 | `settings-modal.tsx:1315` | 裸 text | `text.system` |
| 输入标签 | `settings-modal.tsx:1321` | 裸 text | `text.muted` |
| 输入值 | `settings-modal.tsx:1322` | 裸 text | `text.code` |
| 编辑器提示行 | `settings-modal.tsx:1340-1344` | 裸 text | `text.faint` |
| 状态/错误行 | `settings-modal.tsx:1239-1240` | `text.muted` 一律 | status → `text.system`；error → `text.danger`（修正后） |
| 底部 hint | `slots.tsx:163-167` | `text.faint` | `text.system`（faint 恒等于 muted，避免"假层级"） |
| 分隔线/边框 | `settings-modal.tsx:1167,1219`；`panel.tsx:303-304` | `chrome().divider` / `border.base` | 保留 |
| 焦点边框 | `panel.tsx:233` → `resolveFrameToken` | `border.focused`（色=base） | `border.focused`（色=interactive[500]） |

### 4.3 不需要改的部分

- `row.activeBg/activeFg`、`identity`、`attributes`、scrim、motion/fade 常量：现状可用。
- 主题切换链路（§2.2）无需改动；实现只需在 `projectPanelTheme` 里加键，并在消费点替换 token 名。

---

## 5. 对比度风险点（实测，提案配色按 `content = raised.base` 计算）

| # | 组合 | 前景/背景 | 比值 | 影响 |
|---|---|---|---|---|
| 1 | dsh-blue dark | accent `#4d6bfe` / content `#141419` | **4.24** | `<4.5`：✎ 徽标若继续用 accent 不达标 → 映射到 `text.user` |
| 1b | dsh-blue dark | content `#141419` / page `#0a0a0f` | **1.08** | 面板仅比页面亮一档，仍偏"黑"；需接受或再升一级（`raised.high`） |
| 2 | gruvbox dark | muted `#928374` / content `#3c3836` | **3.16**；heading/accent `#83a598` = 4.31 | 主题自带低对比：只读行、分组表头不达 AA |
| 3 | 浅色模式（three themes） | code/`markdown.code`：dsh-blue `#3d9a57`=3.38、tokyonight `#587539`=3.60、gruvbox `#b57614`=2.75；tokyonight 的 muted 2.20 / heading 2.97 / info 2.77 | 全部 `<4.5` | §4.2 的 value/选项接线在 `themeMode=light` 下会不达标 |
| 4 | 现状 bug | `text.danger` = `background.base` | **1.00** | 任何 error/attention 文字不可见，必须先修 |

可选缓解（已有实现可复用，不建议本轮新增算法）：`boostUntilContrast(color, background, 4.5)`（`routes/session/widgets-dock.tsx:775-793`，双向走向白/黑并复测）、`contrastRatio/relativeLuminance`（`routes/session/powerline.tsx:155-180`）。

## 6. 验证手段

### 6.1 单测（无需真机）

1. **联动性**（证明"主题变了面板跟着变"）：对 dsh-blue / tokyonight / gruvbox × dark/light，经 `parseTheme → resolveThemeDocument → createComponentTheme → projectPanelTheme` 断言同一元素（如 `text.code`）在不同主题、不同模式下 `toInts()` 不同。现成范式：`packages/tui-base/test/settings-panel-panelkit.test.tsx:1297-1346`（已导入三主题与 `contrastRatio`）。
2. **对比度**：断言 §4.2 每个"元素前景 vs 其背景"≥4.5:1（dsh-blue dark 全绿；gruvbox dark 的 muted/heading 需按 §5 明确豁免或走 `boostUntilContrast`）。
3. **渲染级**：沿用同文件的 `mount()`/`linePaintsBg`/`spanOf`（`:1230-1295`）断言：内容行 span 的 `bg` == `chrome().content`、编辑器选项 span 的 `fg` == `panel.text.code`，并在挂载两种主题时分别断言 `fg` 不同。
4. **零硬编码守卫**：`grep -rnE "#[0-9a-fA-F]{6}|RGBA.fromInts" packages/panel-kit/src` 只允许命中 `fallback.ts`（现有 spec §7.2 规则）。

### 6.2 真机（`/theme` 切换抓帧）

- 启动：`./dsh-opentui`（或 `try-host.sh`），`/settings` 打开面板；tmux 内用 `/theme` 依次切 `dsh-blue`、`tokyonight`、`gruvbox`，每次 `tmux capture-pane -p -e`（保留 ANSI SGR）落盘并 `diff` 同一行，断言内容区行/徽标/选项的 fg/bg 编码随主题变化。逐元素核对：分节标题（heading）、✎（user）、N/A 行（system）、枚举选项（code）、选中行（accent 底）。

---

## 7. 未决项

1. 内容底是否升到 `background.raised.base`（本稿推荐）还是保持 `background.base`：这是可见的外观改动，需产品确认。
2. "设置值"接 `text.code` 在浅色主题不达 AA（§5 #3）；二选一：接受（值为弱信息）或回落 `text.base` + 用属性区分。
3. `text.system` 取 `feedback.info.base`（本稿）还是 `markdown.link`：两者在 tokyonight/gruvbox 不同色，需定一种。
4. 改动跨 `packages/panel-kit`（contracts/theme/fallback）与 `packages/tui-base`（host 投影 + settings-modal）；light 模式的验收标准（与 dark 同标准，或按主题作者值豁免）与版本/CHANGELOG 归属需确认（panel-kit 为私有包，建议同 PR）。

---

## 8. 复核命令

### 8.1 主题投影 / 对比度探针（本次调研实际执行）

```bash
cd ~/repo/dsh-opentui/packages/tui-base
bun /private/tmp/panel-theme-probe/roles.ts      # 三主题 × dark/light 的角色取值
bun /private/tmp/panel-theme-probe/probe.ts      # PanelTheme + PanelChrome 投影与比值
bun /private/tmp/panel-theme-probe/contrast.ts   # 提案配色在 content=raised.base 上的比值
```

### 8.2 定位证据

```bash
sed -n '40,78p'   ~/repo/dsh-opentui/packages/tui-base/src/context/panel-kit-host.tsx
sed -n '176,245p' ~/repo/dsh-opentui/packages/panel-kit/src/theme.ts
sed -n '147,203p' ~/repo/dsh-opentui/packages/panel-kit/src/contracts.ts
sed -n '592,606p;1147,1207p;1248,1347p' ~/repo/dsh-opentui/packages/tui-base/src/routes/session/settings-modal.tsx
sed -n '267,284p' ~/repo/dsh-opentui/packages/tui-base/src/routes/session/transcript.tsx
```

### 8.3 现有测试

```bash
(cd ~/repo/dsh-opentui/packages/tui-base && bun test test/settings-panel-panelkit.test.tsx -t "layered")
(cd ~/repo/dsh-opentui/packages/panel-kit && bun test)
```
