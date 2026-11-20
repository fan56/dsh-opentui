Gate: PASS | Profile: FEATURE | Change ref: 21f65a5 (dock batch) + 83047ee (settings batch) on feat/0233-ui-batch; base cca2db1 = v0.23.2
Result: PASS
Acceptance target (user verbatim): "todo 我发现经常不会被更新…"（同簇 UI 反馈批）与本批三条原始诉求："think 渐隐特效，不在 activity 板子里…和 transcript 重叠了" / "think 虽然选了显示 5 行，实际开始的时候，还是只显示一行" / "todo 的效果不太好，应该显示 ToDo |- abc"（符号 11-20 拍板统一 ├─/└─）；ask description "颜色太暗" 修复随批
Expected registered (UTC): 2026-11-20T05:46Z（注：三条断言的 expected 值先于本登记由调查报告规格预定义——渐隐≈2.3s 保留期、树形标题+├─/└─、设置落盘路径与优先级；本登记时仅补登记序，未改任何 expected）
Assertion total N: 3
Working tree: 两个功能 commit 已入分支；.proof/ 本报告未提交（随 next commit 入库）
Touched: widgets-dock.tsx（latch/tween/todoTreeLines/compact lower/args 兼容）、merged-dock.ts（scene C 树）、dsh-blue.json（@dialog tint）、ui-state.ts（新）、settings-modal.tsx、v2-entry.tsx、i18n locales、9 个测试文件

Changed behaviors（每条=diff 内新/改分支，reverse 均有基线）:
1. widgets-dock.tsx:1519 latch 追加 think/tool 可见性 + :1476 compact lower 树形 — 板子跨 turn 边界保持至渐隐完 | baseline: 全局 0.23.2 同尺寸同 prompt 时间线
2. widgets-dock.tsx:604 todoTreeLines + merged-dock:486/compact 双路 — todo 树形（>8 行降级旧 summary）| baseline: 全局 0.23.2 @120x29 旧单行帧
3. ui-state.ts + settings-modal — think 行数落 ui-state.json、boot 本地优先、bridge 模式诚实失败 | baseline: 0.23.2 configSave 静默 no-op（调查实证 bridge-session-seam.ts:2745 无 configSave）
4. dsh-blue.json @dialog muted neutral.400→300 — 单测锁定（dsh-blue dialog muted test）
5. todoArray 接受对象载体 — 单测锁定（真实 journal 帧形状两路）

| id | assertion | expected | pass criterion (checkable) | changed path | level required | evidence file | depends on |
|----|-----------|----------|---------------------------|--------------|----------------|---------------|------------|
| A1 | turn 结束后 activity 帧保持至 think 渐隐完 | busy→idle 后 frame=1 保持 ≥1s（think 保留期 ~2.3s）随后落下；0.23.2 基线 idle 后 ≤200ms 即落 | 02 时间线含 idle 后 ≥5 个 frame=1 采样且终态 FRAME_DROPPED；01 基线 idle 后首个采样即 frame=0 | widgets-dock.tsx (latch :1519) | Artifact + reverse | 01-pre-change-fade-timeline.txt, 02-fade-timeline.txt | |
| A2 | 120x29 紧凑终端 todo 渲染为树 | 帧含 `● Todos (d/n)` 与 `├─ `/`└─ ` 子行；基线为旧 `todos [✓]d/n · x` 单行 | 04 帧含标题+≥2 树形子行且无 `todos [✓`；00 基线含 `todos [✓` 且无 `Todos (` | widgets-dock.tsx (todoTreeLines/compact :1476), merged-dock.ts (:486) | Artifact + reverse | 00-pre-change-120x29.txt, 04-todo-tree-120x29.txt | |
| A3 | think 行数设置落盘且本地优先 | UI 保存 5 后 ui-state.json={"session":{"activity_panel_height":"5"}}；重启后设置页显示 5（current）| 03 文件内容逐字节匹配该 JSON；重启回读在会话中实测为 `5  (current)`（13:39 现场帧，见 notes）；boot 读取路径有单测（ui-state.test.ts 9 例+settings-write-honesty 6 例全绿） | ui-state.ts, settings-modal.tsx, v2-entry.tsx (resolveBootGear) | Artifact + reverse | 03-uistate.json | |

Assertion status: A1: PASS | A2: PASS | A3: PASS

Observed:
- A1: 0.23.3（02）idle 后 frame=1 持续至 t≈5400ms（think 行 `💭 thought · 0.7s` 在帧内可见）后落下；0.23.2（01）t=7600 busy=1/frame=1 → t=7800 busy=0/**frame=0**（≤200ms 即落）。
- A2: 04（0.23.3, 120x29, turn 后 in_progress）= `● Todos (0/3) / ├─ ● india2 / ├─ ○ juliet2 / └─ ○ kilo2`；00（0.23.2 同尺寸同 prompt）= `todos [✓]0/3 · foxtrot2` 单行。
- A3: 03 = `{"session":{"activity_panel_height":"5"}}`（UI 保存即时写）；重启后 /settings 显示 `Think display lines 5`、编辑弹层 `5  (current)`（13:39 实测，帧未落盘——本行证据=文件+单测+现场观察三合，见 notes）。

$ # evidence commands (real surface)
$ # 基线：DSH_HOME=/private/tmp/prechange-home 全局 dsh-opentui 0.23.2（tmux v0231:pre3, 120x29）
$ tmux send-keys 'Think step by step…OK.' ; 采样循环 200ms → 01
$ tmux send-keys 'Use the todo_write tool…' ; 轮询 → 00
$ # 改动后：wt-uipolish dist 构建（13:26）TUI（tmux v0231:m, 120x29）
$ 同款 prompt → 02 / 04
$ /settings → TUI-specific → Think display lines → 选 5 → cat ~/.local/state/opencode/ui-state.json → 03；重启 → /settings 复查

Evidence: .proof/0233-ui-batch/{00-pre-change-120x29.txt, 01-pre-change-fade-timeline.txt, 02-fade-timeline.txt, 03-uistate.json, 04-todo-tree-120x29.txt, report.md}

## Notes
- A3 的「重启回读 5 (current)」帧在 13:39 实测时未落盘（两次补采走错导航层，第三次面板已被 toggle 关闭）；该观察为现场实录，机器可复核面=03 文件+15 例设置单测（含 boot 读取优先级与坏 JSON 容错）。不满足 Artifact 级的该子项如实降级说明，主判据（文件+单测）为 Artifact 级。
- 附带发现（不阻塞本批，均记档）：①设置面板 Esc/← 不关闭（0.23.2 同样存在，`/settings` 重输可关）=存量 UX 缺口 P3；②FA 调查的「陈旧 running 行」待核不变。
- 单测：全量 tui-base+shell+i18n = 2677 pass / 4 skip / 0 fail（陈旧断言按新行为更新并逐条记录）；settings-panel-panelkit 一例为既有全局态污染 flake（单跑绿）。
- todo 树的 frame 模式（scene C）与 compact 模式（≤30 行）双路均已实机验证（agent 200x50 帧 + 主 agent 120x29 帧）。

## Failure rounds
(none — first-round PASS)
