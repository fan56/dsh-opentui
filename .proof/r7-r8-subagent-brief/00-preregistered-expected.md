# R7 + R8 预注册（W5，write-once）

- 日期：2026-11-23。成文方式：一次性成文，各节按落盘顺序编号；时间戳如实记录（非逐节顺写）。
- 分支：`feat/ui-batch-1123`。捕获前 HEAD：`0690166`（任务票写的 `36dc77a` 是并行 agent 落刀前的基线；本刀开始时已前进 3 个其他 concern 的 commit，工作树另有他人在改的 shell / bridge / composer 等文件）。
- 宿主：bun 1.4.4 / node v26.8.1 / darwin arm64。证据目录：`.proof/r7-r8-subagent-brief/`。
- 本文件正文在证据捕获前冻结；R7 现状为**改动前一手事实**（§一），捕获后不改。
- 时间盒：35 分钟。

## 一、R7 现状一手事实（改动前审计，逐 file:line）

用户口径：「子 agent 执行完毕，就消失，不要占位置」。目标面：带框 scene A 代理列表 / 紧凑下半区 / 编辑器下 lastrequest-dock / roster（seam-rows `subagents:live`）settle 条目是否让下半区在 turn 结束后存活。工具行（✔use_agent 等）属工具区，不动；/subagents 详情查看器不在范围。

| 面 | 代码位置 | 一手现状 | 结论 |
|---|---|---|---|
| (a) 带框 scene A 代理列表 | `widgets-dock.tsx:1611-1614` `mergedRunningAgents()` = `children.filter(status==="running")`；`merged-dock.ts:190-197` `attributeAgents()` 同样过滤 running，`:464` 取 running 后驱动 scene，`:488` 仅 `agents.map(agentLine)` | 代理行**只来自 running**；settle 后下次构建即无对应行 | 已满足（无残留） |
| (b) 紧凑下半区 `compactLower()` | `widgets-dock.tsx:1983` → `:1644-1652` `mergedCompactLowerLines()` = `todoTreeLines(latestTodos(rows))`，只出 todo 树 | 紧凑下半区**根本不渲染代理行**（running 或 settled 都不渲染） | 已满足（无残留；运行中子代理在紧凑面也无名单行，R8 简报行将补这一缺口） |
| (c) 编辑器下 lastrequest-dock | `lastrequest-dock.tsx:148-168` `lastRequestLines()` 本身只收 running child；**view 层 `:198-202` 再过滤 `id==="lr:echo"`**，只画 👤 echo | 渲染面**不画任何 child 行**（running/settled 都不画） | 已满足（无残留） |
| (d) roster settled 条目与 D10 latch | `seam-rows.ts:451-458` roster 全量 views upsert（含 settled）；但 `widgets-dock.tsx:1619-1621` `mergedLowerHasContent()` 走 `mergedRunningAgents()`（running only）；`:1484-1486` `dockNeedsClock()`、`:1188-1195` `dockTurnActive()` 均 `child.status==="running"` | settled 子代理**不让下半区/latch/动画时钟在 turn 后存活** | 已满足（无残留） |

**R7 结论（预注册冻结）**：四个面在改动前已全部是 running-only，settle 后立即消失。本刀 R7 的工作 = 补「running-only 不变量」的回归测试 + 在 `mergedRunningAgents` / 相关处加口径注释（把用户拍板写进代码），**不改行为**；若真机/测试发现任何残留，按 E-R7 反证处理并如实报告。

## 二、expected 表（FROZEN）

| id | assertion | expected (FROZEN) | pass criterion（机器可判） | changed path | level | evidence file | depends on |
|---|---|---|---|---|---|---|---|
| E-R7 | settle 后代理行从所有 dock 面立即消失 | (a)(b)(c)(d) 全部 running-only，无「已完成」代理行 | 数据层：`mergedDockLines({agents:[running, completed]})` 只出 1 条 `kind:"agent"`；`mergedLowerHasContent` 对仅 settled roster 行返回 false；纯函数测试绿 | widgets-dock.tsx / merged-dock.ts / test/* | unit | `04-r7-r8-scoped.log` | — |
| E-R8-1 | 简报行文本 = `subagent *{running} {elapsedSec}s`（ASCII，en/zh 同值） | `subagentBriefText(3,12)` → `"subagent *3 12s"`；`(0,_)` → `""` | 断言 exact string；locale 两文件键值均纯 ASCII 且相同 | i18n locales / widgets-dock.tsx | unit | `04-r7-r8-scoped.log` | — |
| E-R8-2 | running=0 不出简报；两简报合并/独占 | 合并 = `todo 1/4 3s  ·  subagent *3 12s`；只有 todo / 只有 subagent 时独占一行；都无时无该行 | `combineBriefText` exact 断言；`mergedDockLines` 带/不带 `options.subagentBrief` 断言行 kind/text | merged-dock.ts / widgets-dock.tsx | unit | `04-r7-r8-scoped.log` | E-R8-1 |
| E-R8-3 | 按批计时锚点语义 | 0→N 记锚；N→M>0 不重置；→0 清锚；再 0→N 从 0 起算 | `subagentBatchAnchor` 序列断言返回锚值/`resetSubagentBriefClock` 后重来 | widgets-dock.tsx | unit | `04-r7-r8-scoped.log` | — |
| E-R8-4 | 两种模式都出简报行，帧高预算不打穿 | 带框 scene A 上半区、紧凑 main 下半区各 ≥1 真帧含 `subagent *`；新增行计入 `frameHeight`/`compactHeight` | 真渲染 `testRender` 抓 spans 断言含 `subagent *3`；80x24 满高 dock 下 transcript 可见行 ≥6 | widgets-dock.tsx / test/* | render | `04-r7-r8-scoped.log` | E-R8-1/2 |
| E-R8-5 | 数据层纯函数 + 宽度律 | `merged-dock.ts` 不调用锚点函数；简报经 `options.subagentBrief` 传入；每行 `lineWidth===innerWidth`，无 clipToWidth 二次裁剪 | grep 断言 + `lineWidth` 断言；既有宽度测试不降强度 | merged-dock.ts | unit | `04-r7-r8-scoped.log` | — |
| E-GATE | 门禁 | scoped 测试全绿；tui-base 全量（失败逐项归因并行改动）；typecheck:entry 绿 | 命令退出码 0 + 输出在档 | — | gate | `04-r7-r8-scoped.log` / `05-full-gate.log` | E-R7..E-R8-5 |
| E-REAL | 真机 a–d | a 简报出现且计时递增；b 某代理 settle → 行消失、`*3`→`*2`、计时不重置；c 全部完成简报与代理区一起收起；d 同 turn 新批从 0 起算 | ≥31 行终端逐秒 `capture-pane -e -p` 帧数值断言，路径 `.ans` 在档 | — | manual | `10-*.ans` … | E-GATE |

## 三、门禁预期 + USER-JUDGMENT + NOT RUN

- 门禁阶梯：scoped `bun test` → tui-base 全量 `bun test` → `typecheck:entry`。全量若红，先判断是否他人在改的并行文件所致，逐项如实报告，不自称全绿。
- USER-JUDGMENT（≤5，只记录不拦）：
  1. 合并分隔符 `  ·  `（两空格）沿用标题 `mergedTitle` 的 ` · ` 家族观感；如过密可调。
  2. 简报色沿用 todo 简报的 `tone:"running"`（warning 色），不新增颜色键。
  3. 紧凑模式只在有 running 子代理时新增简报行（不改变无子代理时的既有高度）。
- NOT RUN 声明：/subagents 详情查看器（用户明确排除）；工具区行（用户明确不动）；packages/shell seam 与 bridge 包（文件所有权排除）。
- 措辞强度：单测只断言对象/文本/锚序列时只写「隔离/文本正确/锚语义正确」，不写「视觉无残留」；真机帧才写「真机帧显示」。
