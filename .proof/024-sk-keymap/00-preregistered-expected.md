# PREREGISTRATION — 024 SK keymap FocusRouter 四层捕获栈切片（write-once；捕获前落盘，never edited after capture）

本文件在任何 FocusRouter 实现改动与任何证据捕获之前写入磁盘。它是 SK 报告 `expected` 列的冻结预测值。
状态与 observed 值事后仅依据 `pass criterion` 判定，写入 `/Users/qingguee/repo/wayfinder-web-profile/research/024-sk-keymap-slice.md`；禁止回改本文件的 `expected`。

- Preregistered at (UTC): 2026-11-20T17:46Z
- Worktree / branch: `/Users/qingguee/repo/dsh-opentui-wt-024-capir` @ `feat/024-capir`
- Pre-change HEAD（基线 + change ref 锚点）: `4db780a1c810247ff2d693e8432610a63b3a2772`（S2 GREEN 态，clean）
- Host: `dsh --version` = `0.2.2-rc.5`；真机配方 = tmux + `capture-pane -e` 数值 `.ans` 帧，**禁 PNG / 视觉模型**
- Evidence directory: `.proof/024-sk-keymap/`
- Profile(s): FEATURE（键路运行时路由）+ DESIGN（四层捕获栈契约）+ negative-control（modality 泄漏反例 / 既有键位回归）
- Acceptance target（用户原话逐字）: "实现 FocusRouter 四层捕获栈：统一 ownership、消灭手写垫片；落点遵循 v3 §3.4，ADR-0008 衔接条款落 docs/adr/……门禁：既有测试全绿不删；新增栈行为测试；真机 tmux capture-pane -e 采集 .ans 数值帧（禁 PNG 视觉模型）覆盖：modal 键位归属、turn 跑时 Esc、面板 PgUp/PgDn、基础键位回归。keymap 是 P0 高发区——真机证据必须逐项，不许只跑单测自称 PASS。"
- SK 条款（计划 §三）: 独立切片、带真机门禁、禁「顺带」；JUDGMENT 集中在交互手感类；**SK 切片票补 ADR-0008 衔接条款定稿**（oldfox 终裁 suggestion）。

## 一、历史坑（已一手定位，作为反例来源）

| P0 病史 | 一手出处（仓内） | 本片结构性消灭方式 |
|---|---|---|
| `mode:"global"` 注册无 mode 谓词 + 注册晚者先命中 → turn 跑时 Esc 被 `TurnCancelKeys` 抢走 | `docs/adr/0008-input-ownership-for-keyboard-routing.md:39-75`（缺陷段）、`packages/tui-base/src/context/keymap.tsx:220` | FocusRouter 在 `createLayer` 边界对 page-tier 层统一施加 ownership 合取；无手写 `pageOwns()` 亦不泄漏 |
| panel-kit 不进 `dialog.stack` → PgUp/PgDn 漏到 transcript | `docs/adr/0008...:84-89`（bug 状态表）、`packages/panel-kit/src/stack.tsx:68,260-264` | panel/dock frame 进统一捕获栈；overlay-tier 分页层胜出，main-tier transcript 被结构否定 |
| 各面板手写垫片 = 无 ownership 证词 | `packages/tui-base/src/routes/session/pane-focus.tsx:139,166`、`transcript-scroll.tsx:48`、`docs/activity-scroll-input.md:18` 记录的 `dialog.stack.length === 0` 垫片群 | 垫片只剩 leaf widget；路由判定集中到 FocusRouter 的 `allows(tier)` |

## 二、四层捕获栈行为断言（modal > overlay > main > global 优先级矩阵）

层定义（捕获等级 rank：modal=3 > overlay=2 > main=1 > global=0）：

| tier | 承载 surface（ADR-0008 frame kind 映射） | 典型键 |
|---|---|---|
| modal | `dialog`（确认框 / stop-confirm / confirm dialog） | Esc / Enter / Ctrl+C（关闭确认） |
| overlay | `panel`（/settings /agents）、`dock`（ask）、search/picker | PgUp/PgDn（面板分页）、导航、Esc ladder |
| main | `page` 上的交互层（transcript scroll、pane focus、TurnCancelKeys） | PgUp/PgDn（transcript）、F6、Esc（arm stop） |
| global | `page` 上的 app-wide 层（leader、command palette、quit、session tabs） | `<leader>1..9`、`ctrl+1..0`、`ctrl+p`、`app_exit` |

**冻结的捕获优先级矩阵（E1 的 expected；`✓`=该层 enabled，`✗`=否定）**

| 栈顶 ownership frame | modal | overlay | main | global | 证词 |
|---|---|---|---|---|---|
| `page` | ✗ | ✗ | ✓ | ✓ | 页面拥有键盘；main/global 层可命中（既有 priority 决定二者间次序，本片不改 priority） |
| `dialog`（modal 确认） | ✓ | ✗ | ✗ | ✗ | 确认框独占 Esc/Enter/Ctrl+C；frame token 相同者才算 owns |
| `panel` | ✗ | ✓（仅该 panel frame） | ✗ | ✗ | 面板分页层胜出，transcript 不滚 |
| `dock`（ask） | ✗ | ✓（dock frame） | ✗ | ✗ | ask 批期间页面 cancel 层不可达 |
| `dialog` 叠在 `panel` 之上 | ✓ | ✗ | ✗ | ✗ | 栈顶 token 唯一；Esc 关闭 dialog，panel 保留 |

不变式：除 `page` 上 main+global 并存外，任一时刻恰有一个 tier 被允许 —— 这是「结构性消灭泄漏」的判据，不依赖任何 `dialog.stack.length === 0` 垫片。

## 三、modality 泄漏负例（冻结）

- **N1 turn 运行时 Esc 归属**：busy turn + 无 overlay → Esc 归 page（main tier，`TurnCancelKeys` arm/interrupt）；busy turn + panel/dock frame 栈顶 → Esc **不**归 page，归栈顶 overlay；busy turn + stop-confirm dialog 栈顶 → Esc 归 modal（关 dialog），page arm 不动。反例（pre-change）：若一个 `mode:"global"` 页面层**省略** `pageOwns` 垫片，panel 栈顶时仍命中（0.24 前病史）——FocusRouter 后必须被结构否定。
- **N2 panel 打开时 PgUp/PgDn 归属**：`panel` 栈顶且列表溢出 → PgUp/PgDn 归 overlay 层（panel 自身分页）；main-tier `TranscriptScrollKeys`/`PaneFocusKeys` 被否定，transcript 不滚动。反例：省略垫片的 transcript 层在 pre-change 下随面板首屏滚动，FocusRouter 后不滚。

## 四、既有键位回归登记（逐项，expected = 现状行为不变）

| 键 | 归属 tier / surface | 冻结现状行为（不得改变） | 证据 |
|---|---|---|---|
| `ctrl+c` idle page | global | 打开 quit 确认 dialog（DialogConfirm） | E4 + 真机帧 |
| `ctrl+c` busy turn | global | 打断 turn 并 arm；连按不越界退出 | E4 |
| `ctrl+c` overlay 栈顶 | overlay | 归 overlay（ask dock=decline），不触发 quit | E2 |
| `esc` busy page | global | arm stop（confirmStop 链：Esc#1 arm → Esc#2 开 dialog → Esc#3 关 dialog） | E2 + 真机帧 |
| `esc` dialog 栈顶 | modal | 关闭最顶层 dialog | E1 + 真机帧 |
| `esc` panel 栈顶 | overlay | 走 panel Esc ladder（requestClose），不关下层 dialog | E1 |
| `pageup/pagedown` page | main | transcript 滚动（`messages_page_up/down`） | E3 + 真机帧 |
| `pageup/pagedown` panel 栈顶 overflow | overlay | panel 自身分页，transcript 不滚 | E3 + 真机帧 |
| `<leader>1..9` / `ctrl+1..0` | global | session tab 快速切换；`sessionTabs.enabled` 门控不变 | E4 |
| `ctrl+p` | global | command palette（app-level layer） | E4（配置/单测级） |
| `f6` | main | 面板焦点切换（pane-focus，既有 priority:1 不改） | E4 |

配置级 expected（冻结）：`app_exit=ctrl+c,ctrl+d,<leader>q`、`session_tab_select_1=<leader>1,ctrl+1`、`command_list=ctrl+p`、`messages_page_up=pageup,ctrl+alt+b` —— 本片不修改 `packages/tui-base/src/config/v1/keybind.ts` 任何绑定。

## 五、ADR-0008 衔接条款定稿文本（本片落 docs/adr/0008 的「R4 linkage」节，冻结）

> **R4 linkage — FocusRouter 四层捕获栈对 ADR-0008 机制的收紧（024 SK 定稿）**
> ADR-0008 确立单一 ownership 栈（`page`/`dialog`/`panel`/`dock` frame，`top()` + `owns(frame)` 为唯一判据）。ADR-R4（v3 §3.4）在其上引入 FocusRouter：**把 frame 映射为四层捕获等级 modal > overlay > main > global**（dialog→modal，panel/dock→overlay，page→main+global），并在 keymap 层注册边界 `Keymap.createLayer` 统一施加 ownership 合取。衔接四条：
> 1. **不新开第二套 ownership**：FocusRouter 是 ADR-0008 `InputOwnership` 的 tiered 视图；frame token、push/pop 生命周期、栈顶身份判定沿用 ADR-0008 Decision 1–3，不另建状态。
> 2. **垫片只剩 leaf**：ADR-0008 Decision 6 保留的 panel 分页层归入 overlay tier；页面级 `mode:"global"` 层的 `pageOwns()`／`dialog.stack.length === 0` 垫片由 FocusRouter 在注册边界统一提供，业务层不再手写。`pageOwns()` 保留为等价兼容别名。
> 3. **捕获优先级不改变既有 priority 数值**：四层顺序只决定「哪些 tier 同时 enabled」（栈顶 surface 唯一 tier），层内既有 keymap `priority` 与注册顺序原样保留；main/global 在 `page` 上并存时仍由既有 priority 决定，避免行为漂移。
> 4. **两可决策默认「保持现状」**：Esc 双按 arm-then-dialog、Ctrl+C 忙时 interrupt-and-arm、Ctrl+C overlay 栈顶归 overlay 不退出、数字键 session tab 门控——一律沿用 ADR-0008 Decision 8 与现状配置，不新增/改键位；交互手感类差异只记 USER-JUDGMENT，不拦门禁。

## 六、预注册 expected 表（E1–E8）

| id | assertion | expected（FROZEN） | pass criterion（checkable） | changed path | level | evidence file | depends on |
|---|---|---|---|---|---|---|---|
| E1 | 四层捕获优先级矩阵（§二）成立 | §二矩阵 5 行 × 4 列逐格一致；除 page 外恰一个 tier enabled | focus-router 单测断言矩阵每格；`allows(modal/overlay/main/global)` 返回值与表一致 | `packages/tui-base/src/context/focus-router.tsx`（新增） | Artifact | `03-focus-router-unit.log` | — |
| E2 | N1：turn 运行时 Esc 归属 + 无垫片页面层不泄漏 | panel/dock 栈顶时 page global 层 `allows= false`；dialog 栈顶时 modal `allows=true`、main/global=false；反例中 pre-change 省略垫片会命中、FocusRouter 后否定 | 单测：`allows(global)` 在 overlay 栈顶为 false；`00-pre-change.log` 展示 pre-change 省略垫片层命中；新帧否定 | `packages/tui-base/src/context/focus-router.tsx` + `keymap.tsx`（createLayer 边界） | Artifact + reverse | `00-pre-change.log`, `03-focus-router-unit.log`, `06-ans-esc.log` | E1 |
| E3 | N2：panel PgUp/PgDn 归属 | panel 栈顶 overflow → overlay pager enabled、main transcript denied；transcript 不滚 | 单测 + 真机 .ans 帧：panel 打开后 PgUp/PgDn 帧含 panel 选中变化、transcript 顶部行不变 | `focus-router.tsx` + `panel-kit/src/stack.tsx`（frame 桥接沿用） | Artifact + reverse | `07-ans-pgup-pgdn.log`, `03-focus-router-unit.log` | E1 |
| E4 | 既有键位回归登记逐项不变（§四） | 配置绑定 4 项逐字一致；`pageOwns` 兼容别名仍导出；既有层 priority 未改 | `grep`/单测：4 条 keybind 原文一致；`useIsPageOwner` 仍导出；pane-focus priority=1 不变 | `packages/tui-base/src/config/v1/keybind.ts`（不修改）+ `keymap.tsx` | Artifact | `04-key-regression.log`, `08-ans-basic.log` | — |
| E5 | ADR-0008 衔接条款定稿落 docs/adr/ | `docs/adr/0008-...` 含 `R4 linkage` 节且含 §五四条关键词（不新开第二套 ownership / 垫片只剩 leaf / 不改 priority / 保持现状） | `grep -c` ≥ 4 关键词命中 + 节标题存在 | `docs/adr/0008-input-ownership-for-keyboard-routing.md` | Artifact | `05-adr-linkage.log` | — |
| E6 | 测试门禁全绿，既有断言不删不改 | `git diff` 既有测试文件 0 删除行（`--diff-filter=M` 仅新增）；tui-base + panel-kit + shell 全量单测绿 | 每包 `bun test` exit=0；`git diff --numstat` 既有 test 文件删除列=0 | tests（新增 `focus-router.test.tsx`，既有不改） | Artifact | `02-gate-full.log`, `03-focus-router-unit.log` | — |
| E7 | 真机 tmux `capture-pane -e` 数值 `.ans` 帧逐项（modal / turn Esc / panel PgUp/PgDn / 基础回归） | 四组帧文件存在且非空（ANSI 数值流）；每组正文含对应状态标记；无 PNG、无视觉模型 | `.ans` 文件字节 >0 且 `capture-pane -e` 采集；逐项 PASS 行；若 TUI 90s 未达 composer → BLOCKED 如实登记 | `scripts/verify-sk-keymap-ans.mjs`（新增） | Artifact | `06-ans-esc.log`, `07-ans-pgup-pgdn.log`, `08-ans-basic.log`, `09-ans-modal.log` | E1,E2,E3 |
| E8 | 真 CI 三 job 绿 | `gh workflow run ci.yml --ref feat/024-capir` 触发；test / real-client / pack-cold-start 三 job conclusion=success | `gh run view --json jobs` 三 job 全 success；URL 入报告 | CI workflow（配置不改） | Artifact | `12-ci.log` | E6 |

非断言证据：`01-env-snapshot.log`（HEAD/version/date）、`02-gate-full.log`、`10-verify70.log`（若 BLOCKED 如实记）、`11-pack.log`、`report.md`。

## 七、门禁预期（技术门禁全绿即 PASS；JUDGMENT 不拦）

- 既有测试：tui-base / panel-kit / shell 全绿，**既有断言一字不改、一测不删**；新增 focus-router 栈行为测试可加。
- 新增栈行为测试：矩阵 5 行、N1/N2 反例、frame 记账（push/pop 回 `[page]`）、无垫片页面层在 overlay 下被否定 —— 全绿。
- typecheck/build：`bun run typecheck`（若脚本存在）与 `bun build` 绿。
- 真机：四组 `.ans` 数值帧逐项采集；TUI 不可达则 BLOCKED 如实登记，不谎报 PASS。
- 真 CI：`gh workflow run ci.yml --ref feat/024-capir` 三 job 全绿；红就红报。

## 八、USER-JUDGMENT 预案（交互手感类，记录 + 推荐默认，不拦门禁）

技术 PASS 不依赖下列项；每项只记录 + 推荐默认（默认一律选「保持现状行为」）：

- U1（交互手感·快捷键冲突感受）：Esc 双按 arm→confirm 的手感、Ctrl+C 在 overlay 下归 overlay 是否与用户直觉冲突。默认：保持 ADR-0008 Decision 8 现状键位，不改。
- U2（交互手感·模态层级可感知性）：panel 打开时 PgUp/PgDn 只滚面板不滚 transcript，用户是否感知到焦点归属。默认：保持现状（面板分页优先）。
- U3（交互手感·数字键）：`<leader>N` / `ctrl+N` session tab 快速切换门控手感。默认：保持现状配置，不新增/改键。

两可键位决策默认规则：凡实现中出现两可，一律选「保持现状行为」并记录于报告 JUDGMENT 节。

## 九、PASS 判定式（按任务口径）

E1–E8 全达成 ∧ 既有测试不删不改且全绿 ∧ 新增栈行为测试绿 ∧ 真机 .ans 逐项（或如实 BLOCKED 且不影响技术项）∧ NOT RUN 无未声明项 ∧ JUDGMENT 全有裁决记录 → 技术 PASS。
USER-JUDGMENT 只记不拦；红线：不碰底座冻结面与 S1/S2 已接线面（keymap 正确性必须时报告说明）；不改既有测试断言（可新增）。真 CI 红就红着报。

## 十、反作弊与边界

- 不修改 `capcontract/` / `capir/` / `ledger/` / `packages/bridge/`（底座冻结面 + S1/S2 已接线面）。
- 不改 `packages/tui-base/src/config/v1/keybind.ts` 任何绑定（既有键位回归基线）。
- 既有测试断言不改、不删；新增测试独立文件。
- 真机证据禁 PNG / 视觉模型，只用 `tmux capture-pane -e` 数值 `.ans` 帧。
- 旧证据包（`.proof/024-base-task5*`、`024-s1-model`、`024-s2-credentials`）一字不改留档。
- NOT RUN 项同步登记入 `/Users/qingguee/repo/wayfinder-web-profile/research/024-e2e-requirements.md`。
