# UI 批次 2026-11-23 决策记录（用户已拍板）

## R1 输入框复制
- 现状：粘贴（bracketed paste + ctrl+v）、全选（super+a）、readline 全套（ctrl+a/e/b/f/k/u/w/d、shift+方向键选区）均已存在。唯一缺口=「把选区写进剪贴板」的 copy 动作。
- 定案：新增 copy 动作——有选区 → clipboard.write(getSelectedText())；无选区 → 走既有行为（清空输入行/空输入退出，不变）。键位：ctrl+c（全平台，含 mac 稳定路径）+ super+c 并绑（终端透传则生效，不透传无损）。
- 不做：ctrl+y（yank）；cmd+z 撤销已存在不动。

## R2 activity 面板 tab 化
- WidgetsDock 增加 tab：tab1=主面板（现在的合并显示，原样保留），tab2=todo 详细内容（复用现有 todo 纯函数）。数据层（merged-dock.ts）不动。
- 切换：鼠标 onMouseUp 点 tab 文本 + 键盘 Alt+1/Alt+2（global keymap 层，仿 dock scroll 层）。tab 状态=模块级 createSignal（仿 mergedDockCursor）。tab 条替换/并入标题区，保持宽度律（fitLine/takeWidth，严禁 clipToWidth 二次裁剪回归）。
- 注意 app autoFocus:false，别依赖 renderer 自动聚焦，用显式 onMouseUp。

## R3 think 渐隐关闭
- dock-visibility.ts:28 DOCK_FADE_OUT_MS 从 300 改 0（等价于注释掉渐隐；行变「2 秒停留后直接消失」，fading 分支永不可达）。常量旁加注释说明原值与关闭原因。
- 禁止动 widgets-dock.tsx:950-952 的 void dockSpin()（已修复事故的响应式重绘点）。
- 两处断言渐隐中间帧的测试（packages/shell/test/shell-render-incident-motion-ft.test.tsx、packages/tui-base/test/widgets-dock-render.test.ts）同步改期望/跳过中间帧断言，commit message 里注明原因，oldfox 评审过目。

## R4 /permission 弹窗 + bug 修复
- bare /permission：把 permissionCatalogLines 打印替换为 ctx.pickOne 弹窗（DialogSelect，方向键+Enter；不做 1-9 数字键快选——AskPanel 路径需宿主新开路径，工作量大不做）。选中值走既有校验/风险确认/face.switch 链路（commands.ts:1899 起）。
- 带参 /permission <preset> 已存在，不动。
- 修 bug：会话未绑定时（首次发消息前、/new 后、/resume 未产生 turn）报 "no active session"。改 bridge-session-seam.ts:1640 用 currentSessionId() ?? stagedSessionId() 兜底，或该窗口给友好提示（「先发一条消息再切换」）——实现时二选一，oldfox 评。
- 已知限制保留：当前会话实际档宿主不回读（host-authoritative），弹窗只标 defaultPreset，不得把 default 伪装成 current（commands.ts:1905-1911 的既有裁决）。

## R5 面板边框粗/细 + 焦点
- 所有常驻带框面板参与（activity 面板含 tab 条、composer 面板、lastrequest dock、notices dock 等，实现时枚举）；弹窗永远是激活态不参与。
- 聚焦=borderStyle heavy + focusedBorderColor + 标题颜色强调；非聚焦=single + visible 的 muted 色。用户强调：非聚焦不可隐身，最少要有点颜色——若现 surfaceBorder 的 unfocusedBorderColor 太暗，提亮并在 USER-JUDGMENT 记录。
- 焦点模型：active panel=最近交互（鼠标点击面板 / composer 打字），默认=composer。复用/扩展 pane-focus（composer|transcript）与新的 active-panel 信号。
- 标题一律只换色（用户拍板方案 3），不做自定义粗体标题渲染（opentui Box 无 titleAttributes，ANSI 进 title 会字面化，历史死路）。

## R6 transcript 系统文字换色
- 范围（用户拍板）：只算斜杠命令与其输出（messageID=cmd 的行）。工具执行行、子代理状态行、notice relay 不动。
- 实现：SeamRow 新增 kind:"system"，seam-rows.ts 把 cmd 行 upsert 为 system；transcript.tsx 颜色表加 system 项 + switch 加 case；用 <text> 纯文本渲染（不用 <markdown>，避免 #/* 被解释）。颜色先用 text.feedback.info.base（solarized/nord 都有值，零主题 JSON 改动）；USER-JUDGMENT 项，验收可调。

## 流程纪律
- 每切片实现前先写 .proof/<切片>/00-preregistered-expected.md（W5）。
- oldfox 每刀评；门禁阶梯 bun test → check-capcontract → real-client-gate → pack 收口；真机抓帧由主 agent 做。
- 每 concern 独立 commit；干净 worktree；分支 feat/ui-batch-1123。
