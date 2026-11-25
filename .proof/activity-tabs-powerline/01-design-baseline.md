---
baseline_meta:
  source_type: pre-existing design file (blocky, 2026-11-24) + user scheme selection
  source_quote_or_path: /Users/qingguee/repo/dsh-opentui-wt-grill-1124/research/2026-11-24-onboard-cwd-tabs/07-powerline-tabs-design.md
  source_sha256: 132fc83159dca2d80b3b4cc624edfa2514bd18ddc25620aedbcb800fb16f21f5
  captured_at_utc: 2026-11-25T02:05:55Z
  baseline_method: byte copy of the original design report; user selection verbatim below; no values reverse-engineered from implementation
---

# User selection (verbatim)

- User answer to the scheme question: 「方案一：两段都实心」 (2026-11-25)
- Acceptance target (user verbatim): 「把这个做完后，用 skill proof-it-works 证明工作。 然后走发版」
- Prior user statement: 「我一开始说 要改 activity 面板的需求，好像你一直没做」

# Original design report (verbatim copy)

# activity 面板 tab 条：powerline 风格设计（2026-11-24）

- 基点：worktree `/Users/qingguee/repo/dsh-opentui-wt-grill-1124`。
- 角色：架构设计，不含实现。本文所有「改哪里」只到函数签名 / 行号 / 结构层，不给可运行代码。
- 素材：现状报告 `research/2026-11-24-onboard-cwd-tabs/01-activity-tabs-current.md`（下称「现状报告」）、`packages/tui-base/src/routes/session/powerline.tsx`（下称「footer」）、`widgets-dock.tsx`、`skin/*`、`theme/assets/v2/dsh-blue.json`（下称「主题文件」）。
- 本文未跑测试、未跑真机。凡是标「未核实」的，都是真机/上游实现层面还没确认的点。

---

## 0. 现状盘点（只列本文会用到的事实）

| # | 事实 | 出处 |
|---|---|---|
| 1 | tab 条现在骑在**上边框**，是 box 的 `title` 字符串，不占额外行 | `widgets-dock.tsx:1922-1927`（注释）、`:2197`（title=）、`:2199`（titleAlignment="left"）、`:2060`（`frameHeight = 2 + 内容行`） |
| 2 | 选中态用 ASCII 方括号 `[ ]`，tab 之间只有两个空格，无图标 | `widgets-dock.tsx:718`（`between = "  "`）、`:735-739`（`activityDockTabLabels`） |
| 3 | 标签文案来自 i18n，en / zh-CN 都是 `1 main` / `2 todo` | `packages/i18n/locales/en.json:704-705`、`zh-CN.json:704-705` |
| 4 | 紧凑模式（终端 ≤30 行）没有边框，tab 条是盒内**第一行**，左 padding 3 | `widgets-dock.tsx:2063-2079`（注释+函数）、`:2163-2164`（height/paddingLeft）、`:2095`（`compactHeight = 1 + ...`） |
| 5 | 点击命中：原点 `screenX + 2`（角 + 边框填充符），区域 = 标签自身宽度，高 2 行 | `widgets-dock.tsx:741-762`、`:1952-1957`（带框）、`:2096-2104`（紧凑，原点再右移 1） |
| 6 | 宽度律：运行时 `stringWidth` / `takeWidth`，禁 `clipToWidth` 二次裁剪 | `widgets-dock.tsx:705-708`（注释）、`util/locale.ts:36-55`、`merged-dock.ts:258-301` |
| 7 | 内容行宽 `width() = max(16, 终端宽 - 4)`；盒标题槽 = 终端宽 - 4 | `widgets-dock.tsx:1790`、`:1921` |
| 8 | 面板边框跟随聚焦：聚焦 heavy + 焦点色，未聚焦 single + muted 色 | `:2107-2110` → `skin/semantic.ts:95-124` |
| 9 | 面板**默认是非聚焦**（`activePanel()` 默认 composer），用户不点它时一直是未聚焦 | 现状报告 §8 + `widgets-dock.tsx:2107-2110`（`focused: activePanel()==="activity"`） |
| 10 | 终端 ≤30 行转紧凑：`COMPOSER_COMPACT_TERMINAL_ROWS = 30` | `skin/semantic.ts:168-174` |
| 11 | 盒顶/底标题各只有一个字符串 + 一个颜色，`bottomTitle` 没有独立颜色字段 | 已安装 `@opentui/core` 0.8.1 `renderables/Box.d.ts:14-18`（`title?` / `titleColor?` / `titleAlignment?` / `bottomTitle?` / `bottomTitleAlignment?`） |
| 12 | `bottomTitle` + 右对齐有生产先例（错误面板） | `component/error-component.tsx:179-192` |
| 13 | 根容器涂了主题底色 `background.base`，所以面板里的「底色块」有已知背景可依 | `app.tsx:1410`（`backgroundColor={theme.background.base}`） |
| 14 | `Renderable.width` / `Renderable.height` / `screenX` / `screenY` 都有公开 getter（可用作命中计算的右边界来源） | 0.8.1 `Renderable.d.ts:252,274,276` |
| 15 | 仓内曾明确**拒绝** Nerd Font 字形（「需要打过补丁的字体，stock 终端和 tmux 下会坏」） | `docs/activity-merged-widget.md:214` |
| 16 | 但 footer 的 powerline 已经用了 U+E0B0 并在用户机上长期运行 | `powerline.tsx:120-121`、`:1039-1041` |
| 17 | VS16 序列在 wcwidth 模式下被打成空白；`🔧`/`🌐` 都是裸码点 | `docs/activity-merged-widget.md:82-89` |
| 18 | emoji / CJK = 2 列，组合符 / VS16 = 0 列；实测 `🏠`=2、`📋`=2、U+E0B0/E0B2/E0B3 = 各 1 列（用本仓 `util/string-width` 跑，见 §A.3） | `util/string-width.ts` 及本次实测 |

由 #13 + #7 得到一个重要巧合：内容行宽是「终端宽 − 4」，在 80 列终端上内容占据第 1…76 列（0 基），右边界离右边框符（第 79 列）正好 **2 列**。所以用户要的「留 2 列」正好等于现有内容行的右边界，tab 条右端和内容行右端能对齐。

---

## A. 现有 powerline 词汇表（新设计只能从这里取词）

### A.1 字形

| 用途 | 字形 | 码点 | 显示宽度 | 出处 / 可信度 |
|---|---|---|---|---|
| 实心右箭头 | `\ue0b0` | U+E0B0 | 1 | `powerline.tsx:120-121`（常量）、`:1039-1041`（两种画法）。**用户机已验证可用**（footer 长期运行） |
| 实心左箭头 | `&#xE0B2;` | U+E0B2 | 1（本仓 `stringWidth` 实测） | 仓内**没人用过**；同属 Nerd Font powerline 块，字体里几乎必有，但**真机未核实** |
| 细左箭头 | `&#xE0B3;` | U+E0B3 | 1（同上） | 同上，**真机未核实** |
| 竖线分隔（安全替代） | `│` | U+2502 | 1（但 East-Asian Width = Ambiguous） | **不要用**：本仓已经因为「歧义宽度字形在弹窗后会被吞」而弃用过同类字符（`widgets-dock.tsx:735-739` 注释） |
| 竖线分隔（真正安全） | `\|` | U+007C | 1 | ASCII，永远 1 列 |

结论：**只有 U+E0B0 是「已验证可用」的**。任何新方案的主力字形必须限制在 U+E0B0，其它统一按「候选、需真机确认」处理。

### A.2 段落（segment）怎么拼

footer 的组装规则（`powerline.tsx:1-12` 文件头注释 + `:1030-1044` 实现）：

- 每段 = `<text bg=段色 fg=文字色> + " " + 文字 + " " + </text>`，即**左右各一个空格 padding，算进段宽**（`:1036`）。
- 相邻两段之间插一支箭头：`<text fg=前一段的bg bg=后一段的bg>U+E0B0</text>`（`:1040`）。箭头本身 1 列，左半是前一段颜色、右半是后一段颜色，于是两段「接」成一条链。
- 最后一支箭头：`<text fg=最后一段的bg>`（不带 bg，落在终端默认底上，`:1039`），让条带以箭头收尾。
- 整条 `wrapMode="none"`，绝不换行（`:1036-1041`）。
- 行容器 `flexDirection: "row"`、左侧 `paddingLeft: 1`，右侧用 `flexGrow` 空盒把可选的时钟顶到行尾（`:1030,1047-1048`）。

宽度算法（`fitPowerlineSegments`，`:942-1001`）：每段宽 = `stringWidth(文字) + 2`（`:948`），再加「段数」支箭头各 1 列（`:950`）。这条公式可以直接照搬到 tab 条上。

### A.3 配色 token

| 角色 | 取值 | 出处 |
|---|---|---|
| 无主题兜底调色板 | `POWERLINE_COLORS`（brand `#4D6BFE`、provider `#6A1B9A` 等 11 组） | `powerline.tsx:90-118` |
| 有主题时的调色板 | `powerlinePalette()`：brand=`hue.accent[500]`、provider=`interactive[500]`（会避让 brand） | `:547-569`、`:285-295` |
| 品牌蓝 | `brandBlue(mode)`：dark `#4D6BFE` / light `#3B5BDB` | `skin/identity.ts:33-36,81` |
| 段内文字色 | `autoContrast(bg)`：先 `#1a1a2e` / `#ffffff`，都不到 4.5:1 时退到纯黑/纯白 | `:124-126,183-188` |
| 对比度工具 | `relativeLuminance` / `contrastRatio` | `:157-173` |
| 邻段可辨识下限 | `POWERLINE_MIN_SEGMENT_DISTANCE = 80`（RGB 欧氏距离），低于它箭头看不出分界 | `:260-267` |
| 渐变（footer 专用） | `POWERLINE_RAMP_FAMILIES`、深→浅亮度 0.02→0.55 | `:318-324,506-522` |

注意 `autoContrast` 在品牌蓝上会失败一次：`#4d6bfe` 上白字 4.33:1、`#1a1a2e` 3.94:1，最后落纯黑（4.85:1）。所以**选中段不要直接用品牌蓝当底**，用下面 A.4 的「当前行」配色对更稳。

### A.4 主题色值（dsh-blue，本文所有数值都从这里来）

| token | 路径 | dark | light | 主题文件行 |
|---|---|---|---|---|
| 面板底色 | `background.base` | `#0a0a0f` | `#ffffff` | `dsh-blue.json:330`（dark gray.800）、`:173`（light gray.800） |
| 当前行底 | `background.action.primary.$focused` | `#8599ff` | `#c6d1f7` | `:379`（blue.200）、`:228`（light blue.800） |
| 当前行字 | `text.action.primary.$focused` | `#1e1e22` | `#24379f` | `:328`（gray.600）、`:222`（light blue.200） |
| 次文字 | `text.muted` | `#8a8a8a` | `#8a8a8a` | `:326`（dark gray.400）/ `:169`（light gray.400） |
| 主文字 | `text.base` | `#eeeeee` | `#1a1a1a` | dark gray.200 `:324` / light gray.200 `:167` |
| 抬高底 | `background.raised.base` | `#141419` | `#fafafa` | `:329`（gray.700）、`:172` |
| 边框 | `border.base` | `#3a3f5c` | `#b8bdd8` | `:93`、`:284` |
| 品牌蓝 | `hue.accent[500]` | `#4d6bfe` | `#3b5bdb` | `:382`、`:225` |

「当前行」这一对（底 + 字）不是随便挑的：它是仓内**已存在的选中行语义**（`skin/semantic.ts:128-136` `currentRowColors`，对话框当前行就用它）。实测对比度 dark 6.33:1、light 6.53:1，都过 4.5。tab 选中态复用它，既省事又和产品其它地方一致。

### A.5 降级策略（footer 已有的）

- 宽了先掉低优先级整段（`:965-972`），再降级（`degrade` 字段，`:973-984`），再掉，最后才硬裁一支（`:990-995`）。
- 「硬裁」只对最后幸存的一段做，用的是 `clipToWidth`（`:994`）——**tab 条不能学这条**，本仓的 width 律明确禁 `clipToWidth`（`widgets-dock.tsx:705-708`）。tab 条的降级必须是「整段降档」，不是「裁字」。

---

## B. 三个方案

### B.0 三个方案共用的前提（先定死，不重复）

1. **位置**：带框模式（>30 行）下，tab 条从「上边框标题」移到**盒内最后一行内容行**（紧贴下边框之上），右对齐；紧凑模式（≤30 行）从「第一行」移到**最后一行**。上边框只留活动内容标题（`🔧 tool` 等）+ ` · N/M` 尾巴。
2. **右侧间距 P = 2 列**（默认值，可配置）。带框模式：tab 条最后一个格子落在第 `W-4` 列（80 列时 = 第 76 列，0 基），第 `W-3`、`W-2` 列留空，第 `W-1` 列是右边框。紧凑模式同理，最后一格落 `W-3`，`W-2`、`W-1` 留空。
3. **标签**：`🏠 1 main` / `📋 2 todo`。裸 emoji（U+1F3E0 / U+1F4CB），**不带 VS16**；数字保留；图标不放进 i18n 串（i18n 只留 `1 main` / `2 todo`）。
4. **段宽**：`" 🏠 1 main "` = 11 列（1 空格 + 图标 2 + 空格 + `1` + 空格 + `main` 4 + 1 空格）。`" 📋 2 todo "` = 11 列。均实测。
5. **方括号 `[ ]` 全部去掉**（选中态由底色/字色/箭头表达）。
6. **聚焦不影响 tab 条**（理由见 §B.4）。四个状态 = 选中 × {聚焦, 非聚焦} + 未选中 × {聚焦, 非聚焦}，其中聚焦维度**故意不产生差异**。
7. **箭头只做「段与段之间」和「条带收尾」，不做前置箭头**——前置用左箭头 U+E0B2 才自然，但那个字形没验证过（§A.1）。右对齐 + 全部右箭头 = footer 的形态照搬，零新字形风险。
8. **箭头不许点**。只有标签格子响应鼠标（和现状一致）。

图例：下面的示意图里 `>` 是 **U+E0B0 的占位符**（实际渲染是实心右箭头，1 列），`|` 是 1 列分隔线占位符（方案二用 U+E0B3）；这两个 PUA 字符在多数文档查看器里不可见，所以用占位符保证列宽可数。图里的 `🔧 2 tools` / `✔ write tests` 两行只是内容示意（表示 tab 条在面板里的相对位置），不代表真实文案。所有示意图每行都按运行时 `stringWidth` 核过，宽度恰好 80 列。

---

### B.1 方案一「实心箭头分段」（经典 powerline）

两个 tab **都有底色**，段间一支箭头，条带末尾再收一支箭头。整条永远以「▶」结尾。

80 列 × 长度 40 行，带框，main 选中（dark）：

```
┏━ 🔧 tool ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
│                                                                              │
│ 🔧 2 tools · 1 running                                                       │
│ ✔ write tests                                                                │
│                                                     🏠 1 main > 📋 2 todo >  │
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

todo 选中：格子位置不变，只是两段的底色交换（见下表）。

逐格定义（dark / dsh-blue；`bg=—` 表示不设底色，落在面板底色 `#0a0a0f` 上）：

**状态 T1：选中 main（聚焦与非聚焦相同）**

| # | 列宽 | 文本 | fg | bg |
|---|---|---|---|---|
| 1 | 11 | `" 🏠 1 main "` | `#1e1e22` | `#8599ff` |
| 2 | 1 | U+E0B0 | `#8599ff` | `#141419` |
| 3 | 11 | `" 📋 2 todo "` | `#8a8a8a` | `#141419` |
| 4 | 1 | U+E0B0 | `#141419` | — |

合计 24 列。

**状态 T2：选中 todo（聚焦与非聚焦相同）**

| # | 列宽 | 文本 | fg | bg |
|---|---|---|---|---|
| 1 | 11 | `" 🏠 1 main "` | `#8a8a8a` | `#141419` |
| 2 | 1 | U+E0B0 | `#141419` | `#8599ff` |
| 3 | 11 | `" 📋 2 todo "` | `#1e1e22` | `#8599ff` |
| 4 | 1 | U+E0B0 | `#8599ff` | — |

light 模式替换：选中底 `#c6d1f7`、选中字 `#24379f`、未选中底 `#fafafa`、未选中字 `#6e6e6e`（由 `text.muted` 压到 4.5:1 的等价色，`boostUntilContrast` 会算出同量级值），其余同构。

**紧凑模式（无边框，80 列，main 选中）**：

```
                                                       🏠 1 main > 📋 2 todo >  
```

（tab 条落在最后一行第 54…77 列，第 78、79 列留空。）

点评：最「powerline」，辨识度最高；代价是两块底色在深色底上会形成两个明显色块，emoji 本身是彩色块（见 §E.4），视觉上偏重。且未选中段用 `#141419` 在浅色终端主题下会变成深色块，需要跟随主题（本文都是 token 驱动，没问题）。

---

### B.2 方案二「轻量分隔」（只用细线/斜线做分隔，不上底色）

没有任何底色：两个标签都是纯文字，中间插一支**细箭头**（首选 U+E0B3；真机不行就退 ASCII `|`，同宽 1 列）。选中靠字色区分。

80 列，main 选中（dark）：

```
┏━ 🔧 tool ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
│                                                                              │
│ 🔧 2 tools · 1 running                                                       │
│ ✔ write tests                                                                │
│                                                      🏠 1 main | 📋 2 todo   │
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

逐格定义：

**状态 T1：选中 main（聚焦/非聚焦相同）**

| # | 列宽 | 文本 | fg | bg |
|---|---|---|---|---|
| 1 | 11 | `" 🏠 1 main "` | `#4d6bfe` | — |
| 2 | 1 | U+E0B3 | `#3a3f5c` | — |
| 3 | 11 | `" 📋 2 todo "` | `#8a8a8a` | — |

合计 23 列。

**状态 T2：选中 todo**：第 1 格 fg `#8a8a8a`，第 3 格 fg `#4d6bfe`，分隔符不变。

light：选中 `#3b5bdb`、未选中 `#6e6e6e`、分隔 `#b8bdd8`。

**紧凑模式（80 列，main 选中）**：

```
                                                        🏠 1 main | 📋 2 todo   
```

点评：最克制，和现有「标题骑边框」的极简风格最接近，视觉风险最低；但没有底色，选中只靠颜色，弱视/低色深终端下辨识度最低。U+E0B3 未验证，退化成 `|` 时「powerline 味道」基本消失。

---

### B.3 方案三「只有选中项实心 + 箭头只包住选中段」

未选中项无底色；选中项实心，并在它的**右侧**接一支实心右箭头（选中项就是最右那个 tab 时，箭头落在条带末尾）。

80 列，main 选中（dark）：

```
┏━ 🔧 tool ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
│                                                                              │
│ 🔧 2 tools · 1 running                                                       │
│ ✔ write tests                                                                │
│                                                      🏠 1 main > 📋 2 todo   │
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

80 列，todo 选中（箭头滑到条带末尾）：

```
│                                                      🏠 1 main  📋 2 todo >  │
```

逐格定义：

**状态 T1：选中 main（聚焦/非聚焦相同）**

| # | 列宽 | 文本 | fg | bg |
|---|---|---|---|---|
| 1 | 11 | `" 🏠 1 main "` | `#1e1e22` | `#8599ff` |
| 2 | 1 | U+E0B0 | `#8599ff` | — |
| 3 | 11 | `" 📋 2 todo "` | `#8a8a8a` | — |

合计 23 列。

**状态 T2：选中 todo**

| # | 列宽 | 文本 | fg | bg |
|---|---|---|---|---|
| 1 | 11 | `" 🏠 1 main "` | `#8a8a8a` | — |
| 2 | 11 | `" 📋 2 todo "` | `#1e1e22` | `#8599ff` |
| 3 | 1 | U+E0B0 | `#8599ff` | — |

合计 23 列。

light：同 §B.1 的 light 替换。

**紧凑模式（80 列，main 选中）**：

```
                                                        🏠 1 main > 📋 2 todo   
```

点评：只有一个色块，视觉重量介于前两者之间；箭头正好是「填充区出口」，最有方向感。代价是两种选中状态下箭头位置会跳（第 2 格 ↔ 第 3 格），扫视时眼神要追一下；23 列宽度比方案一窄 1 列。

---

### B.4 关于「聚焦 / 非聚焦」为什么不做差异（三个方案通用）

`activePanel()` 默认是 `composer`（`widgets-dock.tsx:2107-2110`），也就是说**日常绝大多数时间活动面板是非聚焦**。如果让「非聚焦」的选中态变暗（比如换成 `accent[700]` `#2a3d9e`），用户看到的常态就是一块发暗的 tab，会误读成「禁用」。聚焦信息已经由面板边框承担（heavy/单线 + 焦点色，`skin/semantic.ts:95-124`），tab 条不需要再编码一次。

如果产品坚持要区分，最小改动是：非聚焦时选中底退一档（dark 用 `#6b82fe`=blue.300，light 用 `#9daff0`=blue.700），且字色重新过一遍 4.5:1；其余不变。这是可选项，不是默认。

---

## C. 宽度、降级、间距、点击区

### C.1 宽度公式

统一符号：

- `W` = 终端列数；带框模式的内容区 = `W - 2`（左右边框各 1 列）；紧凑模式内容区 = `W`。
- `P` = 右侧留白列数，默认 2。
- `seg(x) = 2 + stringWidth(x)`（左右各 1 空格，照抄 footer `powerline.tsx:948` 的 `measure`）。
- `A` = 箭头个数。

```
StripW(方案一) = seg(main) + 1 + seg(todo) + 1       // 段间 1 + 收尾 1
StripW(方案二) = seg(main) + 1 + seg(todo)           // 只有段间
StripW(方案三) = seg(main) + seg(todo) + 1           // 选中段旁 1 支
条带左端列（带框，0 基） = 1 + (W - 2) - P - StripW = W - 1 - P - StripW
条带右端列（带框，0 基） = W - 2 - P
条带左端列（紧凑，0 基） = W - P - StripW
条带右端列（紧凑，0 基） = W - 1 - P
```

**80 列逐列数值**（`seg = 11 + 11 = 22`）：

| 方案 | StripW | 带框：左端列 | 带框：右端列 | 留白列 | 右边框 |
|---|---|---|---|---|---|
| 一 | 24 | 53 | 76 | 77, 78 | 79 |
| 二 | 23 | 54 | 76 | 77, 78 | 79 |
| 三 | 23 | 54 | 76 | 77, 78 | 79 |

紧凑 80 列：

| 方案 | StripW | 左端列 | 右端列 | 留白列 |
|---|---|---|---|---|
| 一 | 24 | 54 | 77 | 78, 79 |
| 二 / 三 | 23 | 55 | 77 | 78, 79 |

注意：带框模式下 76 列正好等于现有内容行的右边界（`width() = W - 4`，`widgets-dock.tsx:1790`）。所以「留 2 列」不是拍脑袋，是让 tab 条和内容右边缘对齐。**这也是 P=2 作为默认值的理由。**

### C.2 窄终端降级阶梯（顺序固定，逐档算宽度，装得下就停）

| 档 | 内容 | 方案一 StripW | 方案二 StripW | 方案三 StripW | 备注 |
|---|---|---|---|---|---|
| L0 | 图标 + 数字 + 名字 + 两侧空格 | 24 | 23 | 23 | 默认 |
| L1 | **先缩 P**：2 → 1 → 0 | 24 | 23 | 23 | 用户指定的默认 2 列被牺牲，但内容不丢 |
| L2 | 去掉两侧空格：`"🏠 1 main"` | 9+1+9+1 = 20 | 9+1+9 = 19 | 9+1+9 = 19 | 段底色紧贴文字 |
| L3 | 去掉名字：`" 🏠1 "`（5 列） | 5+1+5+1 = 12 | 5+1+5 = 11 | 5+1+5 = 11 | 数字还在（Alt 提示） |
| L4 | 去掉空格：`"🏠1"`（3 列） | 3+1+3+1 = 8 | 3+1+3 = 7 | 3+1+3 = 7 | |
| L5 | 只留数字：`"1"`、`"2"` | 1+1+1+1 = 4 | 1+1+1 = 3 | 1+1+1 = 3 | 极端窄 |
| L6 | 整条不画 | — | — | — | 只保留 Alt+1/2；此时没有鼠标目标 |

阈值（带框，P=2）：L0 需要 `W - 2 - 2 >= 24` → `W >= 28`（方案一）/ `W >= 27`（二、三）。紧凑：`W >= 26` / `W >= 25`。40 列的情形：方案一正好占满一行（`│` + 12 空格 + 24 列条带 + 2 空格 + `│` = 40 列），即 40 列终端还不需要降级；到 28 列（方案一）/ 27 列（方案二、三）才开始降 L1。

**禁止**：任何一档都不许裁字（不许出现半个 `main`）。要么整档降，要么不画。这与 `widgets-dock.tsx:705-708` 的 width 律一致。

### C.3 与右下角 2 列的保证方式（实现层的硬要求）

不要用「空格填满剩余宽度」的写法（那正是 `dockTabBarLayout` 现在的做法，`:721-722` 的 `tailGap`）——一旦哪里算错就会顶到边框。正确做法是交给布局引擎：

- tab 行容器：`flexDirection="row"`、`width="100%"`、`height={1}`、`justifyContent="flex-end"`、`paddingRight={P}`。
- `justifyContent: flex-end` 保证内容贴右；`paddingRight` 保证留白。两层保险，任何一侧算错另一侧兜底。
- 行宽来自 `dockBox.width` 而不是 `dimensions().width`（面板宽度可能不等于终端宽，`Renderable.width` 可用，见 §0 表 #14）。
- 行内每个格子是独立的 `<text wrapMode="none">`，绝不整条拼一个字符串（否则没法给每格不同底色，也没法保证不换行）。

### C.4 鼠标命中区怎么算

命中区**必须**和绘制用同一份格子数据（每格带 `tab?: "main" | "todo"`），否则改配色就会改错点击区——现状的 `dockTabAtPosition` 就是从布局宽度反推的，`:746-762`，两处容易漂。建议改成：

```
dockTabStripLayout(opts) -> { cells: Cell[]; stripWidth: number }
Cell = { text: string; fg: Color; bg?: Color; tab?: "main" | "todo" }
```

命中时：

```
stripLeft = box.screenX + (framed ? 1 : 0) + innerWidth - P - stripWidth
           // 等价于 box.screenX + box.width - (framed ? 1 : 0) - P - stripWidth
row       = framed ? box.screenY + box.height - 2   // 最后一个内容行
                    : box.screenY + box.height - 1
纵向容差   = framed ? { row, row + 1 }（多算下边框那行，点边框也能切，误触无副作用）
                    : { row }
横向：从 stripLeft 开始累加每格宽度，落在 tab 非空的格子内 → 该 tab
```

80 列时的具体命中区（带框，`screenX=0`，`screenY=0`，盒高 H）：

| 方案 / 状态 | main 可点列 | todo 可点列 | 可点行 |
|---|---|---|---|
| 一（两状态同） | 53…63 | 65…75 | H-2, H-1 |
| 二（两状态同） | 54…64 | 66…76 | H-2, H-1 |
| 三 T1（main 选中） | 54…64 | 66…76 | H-2, H-1 |
| 三 T2（todo 选中） | 54…64 | 65…75 | H-2, H-1 |

（方案三里箭头会移动，所以两个状态的可点区不同——这正是「命中必须从格子数据算」的理由。）

---

## D. 渲染路径建议

### D.1 `bottomTitle` 够不够？——**不够**，三个方案都不够

| 需求 | `bottomTitle` 能否满足 | 依据 |
|---|---|---|
| 显示在下边框上、右对齐、不占内容行 | 能 | `Box.d.ts:14-18`、先例 `error-component.tsx:179-192` |
| 每段不同底色（方案一/三的核心） | **不能**，它是一个字符串，没有分段着色能力 | `Box.d.ts` 只有 `bottomTitle` + `bottomTitleAlignment`，颜色字段只有 `titleColor` |
| 箭头两色（左半前段色 / 右半后段色） | **不能**，同上 | `powerline.tsx:1040` 靠的是**每格独立 `<text>` 的 fg+bg** |
| 选中/未选中不同字色（方案二） | **不能**，整串一个颜色 | 同上 |
| 鼠标命中 | 能（自己按字符串宽度反推） | 不含着色问题 |

补充：`bottomTitle` 具体用哪个颜色（是否复用 `titleColor`）在原生 addon 里，**未核实**；但即使复用，也是整串一个颜色，结论不变。

**所以**：要让 powerline 真的「有底色、有双色箭头」，必须自己画一行真实的 renderable，不能用盒标题。这是本设计对现有实现最大的结构性改动。

### D.2 推荐路径：盒内新增最后一行内容行

- 结构：`<box flexDirection="row" width="100%" height={1} justifyContent="flex-end" paddingRight={P}>` + 每格一个 `<text wrapMode="none" style={{ fg, bg }}>`。这与 footer 的 `<For>` 结构同构（`powerline.tsx:1030-1044`），可以照抄思路。
- 带框模式高度：`frameHeight = 2 + 内容行`（`:2060`）→ `3 + 内容行`。**代价：活动面板少一行内容**。这是唯一有实质代价的地方。
- 紧凑模式：高度不变（`compactHeight` 已含 1 行 tab 条，`:2095`），只是这一行从「第一行」挪到「最后一行」——把 `<For each={[compactTabBarLine()]}>`（`:2170`）从内容列表头部移到尾部即可。
- 上边框标题：`mergedTitleText()`（`:1935-1950`）去掉 `head`（tab 部分），只保留 `base` + 尾缀 ` · N/M`。尾缀的右对齐逻辑（`:1946-1949`）原样保留。

**省掉那一行的两个备选（都不推荐，列出来是为了让决策可见）：**

1. `bottomTitle` + **单色**扁平条（只有方案二的「无高亮」形态可行）。省 1 行，但失去选中态，等于退回「靠颜色以外的东西也区分不出来」的状态。**否决**：选中态是硬需求。
2. 绝对定位/负 margin 把条带画到下边框那一行上。0.8.1 是否支持这套定位**未核实**，而且会破坏「内容行宽 = W-4」的既有假设。**否决**：收益 1 行，风险是整个面板的边框绘制。

### D.3 对 motion 三档的影响

- **文字：无影响**。三档本来就不改变 tab 文本（现状报告 §1；`motion.ts:150-161` 只影响帧率）。
- **高度：** 带框 +1 行是常量，不参与高度 tween（tween 走 `dockHeightContentLines`，`:300-317,345-391`），不会引入闪烁。
- **不要给底色加过渡**：本仓对边框有「禁止动画」的明文规定（`skin/semantic.ts:23-24`），底色块同理——切换 tab 时直接换色。若坚持要淡入，必须走 `motionDecorationsEnabled()`（仅 full 为 true，`motion.ts:163-178`），这会多一条依赖路径，不建议。

### D.4 对 i18n 的影响

- 键不变（`overlay.widgets.tab.main/todo`，`en.json:704-705`、`zh-CN.json:704-705`），值保持纯名字。
- **图标不要进 i18n**：一旦进串，翻译可以顺手删掉它或换成带 VS16 的变体（VS16 会被打成空白，`docs/activity-merged-widget.md:82-89`）。
- 文案以后本地化（例如 zh 改成 `1 主面板`，宽度 8 → `seg = 13`）时，公式自动适配；但所有位置常量必须由 `stringWidth` 现算，**不许出现硬编码 11 / 24**。

### D.5 对现有测试的影响

会红，且必须在同一批里改（否则等于放过了回归）：

| 文件 | 行 | 断言内容 | 处置 |
|---|---|---|---|
| `test/widgets-dock-tabs-r2.test.ts` | 112-135 | `dockTabAtPosition` 以 `screenX + 2` 为原点、标签区外无效 | 重写为右对齐原点 + 格子驱动 |
| 同上 | 138-147 | `dockTabBarLayout` 各段拼起来恰好 `innerWidth` | 该函数不再被生产代码使用；改为断言 `stripWidth` 与右端列 |
| 同上 | 152-160 | `[1 main]` / `[2 todo]` 方括号标记 | 方括号取消，改为断言格子 `tab` 标记与 fg/bg |
| `test/widgets-dock-render.test.ts` | 665-671 | 顶边框标题包含 `[1 main]  2 todo` | 改为：顶边框**不含** tab；底行含新条带 |
| 同上 | 756-757 | 同上（另一场景） | 同上 |
| 同上 | 847、952、961、970 | 紧凑模式第 0 行等于 `   [1 main]  2 todo` | 改为：最后一行、右对齐、新文案 |
| `test/widgets-dock-tabs-keys.test.ts` | 全文 | Alt+1/2 绑定 | 不应变；跑一遍确认 |
| `test/r5-panel-focus-borders.test.ts` | — | 聚焦边框 | 不应变（tab 条不吃聚焦） |

新增必须写的测试（对应本仓既有硬约定）：

1. 80 列下每一行渲染宽度严格等于容器内宽、右边框落在第 79 列（`docs/activity-merged-widget.md:304` 的强制断言）。
2. 条带右端与右边框之间恰好 P 列空白（P=2/1/0 三档各一张）。
3. 行内含 `🏠`（2 列）、`📋`（2 列）、U+E0B0（1 列）时宽度仍精确（这些就是 §E 的宽度风险，测试要钉住）。
4. 命中：每格（含箭头）逐列扫一遍，只有 `tab` 非空的格子返回 tab。

---

## E. 风险清单（每条都写「真机要看什么」）

| # | 风险 | 为什么会有 | 真机验证时看什么 |
|---|---|---|---|
| E1 | **U+E0B0 在本机之外不存在** | `docs/activity-merged-widget.md:214` 明文拒绝过 Nerd Font；footer 破了例（用户裁决）。方案一/三完全依赖这个字形 | 换一台没装 Nerd Font 的机器 / stock iTerm2：箭头位置是「豆腐块」还是空白？需要一个开关（见 E9） |
| E2 | **U+E0B3（方案二细箭头）未验证** | 仓内从没用过；只有 E0B0 用过（`powerline.tsx:121`） | 打一行 `printf '\ue0b3'`，`capture-pane` 数字节；不行就退 ASCII `\|`（同宽 1 列，布局不变） |
| E3 | **歧义宽度字形**（`│` U+2502、`▏` U+258F 等） | East-Asian Width = Ambiguous，CJK 终端里可能画 2 列，导致右边界漂 1 列 | 用 `LANG=zh_CN.UTF-8` + 「ambiguous=wide」的终端跑 80 列，量右边框是否仍落第 79 列。**本设计已把这些字形排除**，验证是为了确认没被偷偷用回 |
| E4 | **emoji 与 powerline 混排的视觉** | emoji 是彩色位图，通常会盖掉底色，段底色只在两侧的 1 空格里可见；箭头紧贴 emoji 时高度也可能不齐 | 80 列截帧看：`🏠` 方块周围底色是否连续？箭头尖是否和 emoji 中线对齐？如果「色块被 emoji 咬掉」很明显，方案一降级为方案三 |
| E5 | **wcwidth 模式** | 0.8.1 在 wcwidth 模式下会吞 VS16 序列（`docs/activity-merged-widget.md:82-89`） | `OPENTUI_FORCE_WCWIDTH=1` 跑一遍：`🏠`/`📋` 是否仍占 2 列、右边框是否仍对齐。禁用 VS16 的前提下预期正常，但要实测 |
| E6 | **弹窗遮挡**（源码注释说的「swallowed behind modal dialogs」） | 现状注释 `widgets-dock.tsx:735-739` 记录 `▸`/`●`/CJK 在弹窗后面被吞 | 打开任意对话框压在活动面板上，`capture-pane` 看 tab 条那几格是否变空。若 PUA 字形被吞 → 方案二（纯文字）变成唯一安全选项 |
| E7 | **未选中段底色与终端主题冲突** | 方案一给未选中段涂 `#141419`，比面板底 `#0a0a0f` 亮一点；如果用户把终端背景设成非 `background.base`，色块会像「贴片」 | 用一个明显不同的终端底色（例如纯黑 + 透明背景）跑：色块边缘是否难看？需要的话未选中段改成「不设底色 + 细边框感」 |
| E8 | **多一行内容**：活动面板少一行 | 带框模式 `frameHeight` +1（`:2060`） | 80×31（刚过紧凑阈值的第一档）场景：内容是否被挤到看不全？高度 tween 是否有跳变（`:345-391`） |
| E9 | **没有 fallback 开关** | 一旦 E1/E2/E6 任一成立，用户没有退路 | 建议加配置 `ui.dockTabs = "powerline" \| "plain"`，`plain` = 方案二的 ASCII 版（`\|` 分隔 + 无底色）。默认 `powerline` 符合用户诉求 |
| E10 | **点错区**（尤其方案三箭头会移动） | 命中区与绘制数据若分家就会漂 | 逐列点 23/24 格，箭头格必须无响应；`screenX` 非 0（面板不在最左）时仍正确 |
| E11 | **窄终端压字** | 有人为了「保住 tab」去裁字 | 30、28、26 列各截一张，确认是「整档降级」而不是半个 `main` |
| E12 | **i18n 本地化后宽度变化** | 现在 en/zh 文案相同，将来可能不同 | 把 zh 值临时改成 `1 主面板` 跑一遍，确认条带整体左移、右边界不动 |

---

## F. 推荐

**选方案三「只有选中项实心 + 箭头只包住选中段」。**

理由：

1. 只用 **U+E0B0** 一个字形，而这是唯一在用户机上被长期验证过的 powerline 字形；方案二要靠未验证的 U+E0B3，方案一还要两块底色互相区分，风险更高。
2. 只有一个色块，在深色终端上不会把面板下半截切成两截；同时选中态的辨识度明显高于方案二（有实心块，不只靠颜色）。
3. 宽度 23 列，比方案一窄 1 列，窄终端更早能显示完整条带（L0 档 27 列即可）。
4. 箭头语义正确：箭头是「填充区的出口」。选中 main 时箭头正好指向另一个 tab（todo）；选中 todo（最右）时箭头在条带末尾收口，和 footer 的收尾箭头同一个习惯。两个状态下箭头只在「段间」和「条带末尾」之间移动一格，不会让人找不到。

被否方案：

- **方案一**：视觉最「powerline」，但两块底色 + emoji 混排（E4）+ U+E0B0 覆盖率（E1）三件事叠在一起，翻车时最难看；且 `#141419` 未选中底在非标准终端底色上会像贴片（E7）。可作为 `ui.dockTabs = "powerline"` 里的进阶样式，不作默认。
- **方案二**：最安全、最克制，但选中态只靠一个字色差（`#4d6bfe` vs `#8a8a8a`），在低色深/弱视场景下最弱；而且它的「powerline」感依赖 U+E0B3，用不了就退化成一根 ASCII 竖线，等于没做 powerline。**建议把它做成 fallback 档**（`plain`），而不是默认。
- **`bottomTitle` 路径**：省 1 行，但整串单色，三个方案都实现不了（§D.1）。否决。

必须同时承认的取舍：本推荐让活动面板**少一行内容**（§D.2 / E8），并让顶边框不再有 tab（信息密度下降一点）。这是「把 tab 条移到右下角」的必然代价，不是实现细节。

---

## G. 附录：预览脚本规格（机器可读）

给写预览脚本的人：下面这份数据足够画出效果，不需要读源码。**颜色全部来自 dsh-blue dark**（若要看浅色，用 `light` 那张表整体替换；主题文件行号见 §A.4）。

约定：

- `bg: null` = 不涂底色，即终端默认底（dsh-blue 下等于 `#0a0a0f`，`app.tsx:1410`）。
- 宽度按 `stringWidth` 算；`🏠`、`📋` = 2 列，`\ue0b0` = 1 列，空格 = 1 列。**不要用字符数**。
- 坐标 0 基，从左到右。`stripLeft` 见 C.1 公式。
- 每个 `state` 的 `cells` 拼起来必须恰好等于 `stripWidth`。

```json
{
  "theme": "dsh-blue",
  "colorMode": "dark",
  "surface": { "default": "#0a0a0f", "border": "#3a3f5c" },
  "geometry": {
    "terminalWidth": 80,
    "framed": { "innerWidth": 78, "rightPadding": 2, "stripRightColumn": 76, "borderColumn": 79 },
    "compact": { "innerWidth": 80, "rightPadding": 2, "stripRightColumn": 77 }
  },
  "palette": {
    "selBg": "#8599ff", "selFg": "#1e1e22",
    "unselBg": "#141419", "unselFg": "#8a8a8a",
    "accent": "#4d6bfe", "sep": "#3a3f5c",
    "arrow": "\ue0b0", "thin": "\ue0b3",
    "legend": { ">": "U+E0B0 rendered cell", "|": "U+E0B3 rendered cell" }
  },
  "schemes": [
    {
      "id": "s1-solid-both",
      "name": "方案一 实心箭头分段",
      "stripWidth": 24,
      "states": {
        "main-selected": {
          "cells": [
            { "text": " 🏠 1 main ", "fg": "#1e1e22", "bg": "#8599ff", "tab": "main" },
            { "text": "\ue0b0",    "fg": "#8599ff", "bg": "#141419", "tab": null },
            { "text": " 📋 2 todo ", "fg": "#8a8a8a", "bg": "#141419", "tab": "todo" },
            { "text": "\ue0b0",    "fg": "#141419", "bg": null,     "tab": null }
          ]
        },
        "todo-selected": {
          "cells": [
            { "text": " 🏠 1 main ", "fg": "#8a8a8a", "bg": "#141419", "tab": "main" },
            { "text": "\ue0b0",    "fg": "#141419", "bg": "#8599ff", "tab": null },
            { "text": " 📋 2 todo ", "fg": "#1e1e22", "bg": "#8599ff", "tab": "todo" },
            { "text": "\ue0b0",    "fg": "#8599ff", "bg": null,     "tab": null }
          ]
        }
      }
    },
    {
      "id": "s2-thin",
      "name": "方案二 轻量分隔",
      "stripWidth": 23,
      "states": {
        "main-selected": {
          "cells": [
            { "text": " 🏠 1 main ", "fg": "#4d6bfe", "bg": null, "tab": "main" },
            { "text": "\ue0b3",    "fg": "#3a3f5c", "bg": null, "tab": null },
            { "text": " 📋 2 todo ", "fg": "#8a8a8a", "bg": null, "tab": "todo" }
          ]
        },
        "todo-selected": {
          "cells": [
            { "text": " 🏠 1 main ", "fg": "#8a8a8a", "bg": null, "tab": "main" },
            { "text": "\ue0b3",    "fg": "#3a3f5c", "bg": null, "tab": null },
            { "text": " 📋 2 todo ", "fg": "#4d6bfe", "bg": null, "tab": "todo" }
          ]
        }
      }
    },
    {
      "id": "s3-sel-only",
      "name": "方案三 只包选中项（推荐）",
      "stripWidth": 23,
      "states": {
        "main-selected": {
          "cells": [
            { "text": " 🏠 1 main ", "fg": "#1e1e22", "bg": "#8599ff", "tab": "main" },
            { "text": "\ue0b0",    "fg": "#8599ff", "bg": null, "tab": null },
            { "text": " 📋 2 todo ", "fg": "#8a8a8a", "bg": null, "tab": "todo" }
          ]
        },
        "todo-selected": {
          "cells": [
            { "text": " 🏠 1 main ", "fg": "#8a8a8a", "bg": null, "tab": "main" },
            { "text": " 📋 2 todo ", "fg": "#1e1e22", "bg": "#8599ff", "tab": "todo" },
            { "text": "\ue0b0",    "fg": "#8599ff", "bg": null, "tab": null }
          ]
        }
      }
    }
  ],
  "layoutRecipes": {
    "framedRow80": {
      "description": "盒内最后一行；左右各一个边框符，条带右端对齐第 76 列",
      "row": ["|border|", "spaces x (76 - 1 - stripWidth + 1 - 1)", "cells...", "2 spaces", "|border|"]
    },
    "compactRow80": {
      "description": "无边框最后一行；条带右端对齐第 77 列",
      "row": ["spaces x (77 - stripWidth + 1)", "cells...", "2 spaces"]
    },
    "topBorderTitle": "只放活动标题，例：┏━ 🔧 tool ━…━┓（不再含 tab）",
    "bottomBorder": "┗ + 78 个 ━ + ┛（80 列下整行 80 宽）"
  },
  "lightOverrides": {
    "surface": { "default": "#ffffff", "border": "#b8bdd8" },
    "palette": {
      "selBg": "#c6d1f7", "selFg": "#24379f",
      "unselBg": "#fafafa", "unselFg": "#6e6e6e",
      "accent": "#3b5bdb", "sep": "#b8bdd8"
    }
  },
  "busyVariantNote": "面板 busy 时边框转 warning 色 #f5a742（未在主题文件里，来自 dsh-blue base 的 text.feedback.warning），tab 条不吃这个状态。"
}
```

画图时的对齐校验：把每行的可见宽度求和，带框行必须 = 80、紧凑行必须 = 80，否则就是某处用了字符数而不是 `stringWidth`。

---

## 自评审（薄弱点 / 隐藏耦合 / 单点故障）

1. **单点故障：U+E0B0**。方案一和方案三的「powerline 感」全压在一个 PUA 字形上。缓解是 `ui.dockTabs` 开关（E9）；但开关本身要新配置项、新测试、新文档，是一笔额外成本，本文没有把它算进工作量估计。
2. **隐藏耦合：`width() = W - 4` 与「留 2 列」**。这两个数字现在恰好一致，看起来像巧合。实现时如果有人在别处改了 `width()`（例如为了修别的对齐 bug），tab 条右端会和内容右端错位。建议在代码注释里把这层关系写死：`P 默认 2，与 width() 的 (W-4) 右边界对齐；改一个必须看另一个`。
3. **薄弱点：`frameHeight` +1 对高度预算的连锁影响**。活动面板只在 >30 行时带框，最紧张的是 31 行终端；少一行内容是否会把某个 3 行上限的区块压到不可用，本文没有量过（未核实）。真机必须覆盖 31 行。
4. **薄弱点：命中逻辑换坐标系**。从「左原点 + 从左累加」换成「右原点 + 从右累加」，是这次最容易引入回归的地方（现状 `dockTabAtPosition` 的 `x - screenX - 2` 就在 `widgets-dock.tsx:753` 一行里，改起来不难，错起来很隐蔽）。必须用「格子数据驱动命中」来消除这条耦合。
5. **未覆盖：鼠标 hover 高亮**。现状 tab 没有 hover 态，本设计也没有加。如果后续要加，需要在每个格子上挂 `onMouseOver`，而 `<text>` 是否支持逐格 hover 效果**未核实**。
6. **未覆盖：键盘焦点可视化**。现在 Alt+1/2 是全局键，没有「tab 获得焦点」这一状态，设计也就没有焦点环。若将来要求可在 tab 间用方向键移动并显示焦点，需要再加一个状态（本文 4 个状态会变 6 个）。

### 本次没核实到的点（诚实清单）

- U+E0B2 / U+E0B3 在用户字体里是否存在、渲染宽度是否真为 1 列（只用本仓 `stringWidth` 算过，那只反映 Unicode 数据库，不反映终端字体）。
- `bottomTitle` 具体用哪个颜色绘制（是否复用 `titleColor`）：在原生 addon 里，没读到。
- 带框模式下 `bottomTitle` 与右角符的间距/裁剪行为（错位风险），没做真机截帧。
- dsh-blue 是否是出厂默认主题名（`theme/index.ts:52-62` 只看到注册），未确认默认值取自哪一层。
- 31 行终端下多一行 tab 条对活动面板内容可用性的实际影响。
- `boostUntilContrast` 在 light 模式下给出的精确值（我按「压到 4.5:1」推的等价色 `#6e6e6e`，函数实际步进可能差 1–2 个灰阶）。
