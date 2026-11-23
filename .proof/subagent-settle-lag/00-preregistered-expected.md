# R7 子代理 settle 滞留修复 — 预注册（W5，write-once）

- 日期：2026-11-23。
- 分支 `feat/ui-batch-1123`，起始 HEAD `80b7e40`。
- 宿主：darwin arm64。证据目录：`.proof/subagent-settle-lag/`。
- 时间盒：约 35 分钟，不收敛即停车交回已确认机制/证据。
- 本文件正文在实现与取证之前一次性冻结；改动前一手事实引用 handoff §3-B 与 `.proof/r7-r8-subagent-brief/report.md`，捕获后不改。

## 一、改动前一手事实（引用，非本刀重新审计）

- 渲染层四个 dock 面本来就只显示 `status==="running"`（r7-r8 预注册 §一已逐 file:line 坐实）。问题是**状态滞后**：子会话 `turn/end completed` 后，桥未即时发出 settle 状态帧，dock 仍显示它在跑 12–21 秒，直到父侧 `tool-workflow agent-end` 事件到达。
- 实例：第一批 3 个子代理 14:26:24 / 14:26:33 已结束，14:26:35–36 帧仍是 `subagent *3 22s`；14:26:37 第二批创建后显示 `*6 24s`，而宿主真实并发此刻是 3。
- 并发上限 3 生效（`ActivationPool.reserve`，`use_agent` → `manager.materialize → pool.reserve(maxActiveSubagents)`，同父子代理共用一个池）；「6 个同时跑」纯属显示滞后。
- 待证实/推翻的猜想：`agent.settle` 只跟父侧 `tool-workflow agent-end` 走，子 `turn/end` 只更新内部索引。本刀第一件事是证实或推翻，写进 report。

## 二、expected 表（FROZEN，机器可判）

作用域：只改 `packages/bridge`；不动 tui-base/shell 渲染源码（另一 agent 在改）；生成物零 diff。

| id | assertion | expected (FROZEN) | pass criterion（机器可判，无环境依赖子句） | level | evidence file |
|---|---|---|---|---|---|
| E-SET-1 | 子会话 `turn/end`（completed/failed/abort）即时发 settle | 三种终态到达时各 emit 一次 `agent.settle`，帧携带该子会话 id；emit 发生在 turn/end 处理同步路径内 | 单测捕获 emit 调用：`agent.settle` 次数=1、id 匹配、不依赖父 agent-end 触发 | unit | `10-bridge-settle.out` |
| E-SET-2 | 父侧晚到 `agent-end` 不重复 settle、不复活行 | 对已 settle 子代理，父 agent-end 到达后 `agent.settle` 累计次数不增加，且不产生任何把该 id 标回 running 的状态帧 | 单测：先子 settle 再父 agent-end，断言 settle 计数不增、无 running 复活帧 | unit | `10-bridge-settle.out` |
| E-SET-3 | 后台子代理结束后同样 settle | background 子代理 `turn/end` 与前台走同一即时 settle 路径 | 单测：background 子代理 turn/end 后 emit `agent.settle` ×1 | unit | `10-bridge-settle.out` |
| E-SET-4 | 再唤起重新出现 | 该子代理 id 被父任务再次唤起（新一轮 running）后，新状态帧把它标回 running | 单测：settle 后再 running，断言出现 running 帧且 id 匹配 | unit | `10-bridge-settle.out` |
| E-SET-5 | journal 重读仍终态权威 | settle 后 journal 重读（`#subagentJournalLoaded` 守卫不动）不把已 settle 行改回 running | 单测：settle 后触发 journal 重读，断言该 id 仍为终态、无 running 复活帧 | unit | `10-bridge-settle.out` |
| E-REAL-1 | 结束后 1–2 秒内行消失 | 3 个时长错开子代理（sleep 4/10/16），取宿主 journal 各子会话 `turn/end` 时刻 T；在 T+1s、T+2s 的逐秒帧中该 agent 行不存在 | 数值帧断言：对每个 id，T+1 或 T+2 帧文本中无该代理标识；`.ans` 在档 | manual | `20-frames/` + `20-journal.txt` |
| E-REAL-2 | `*N` 递减 | 随三个子代理先后结束，`subagent *N` 中 N 依次 3→2→1→0 | 逐秒帧正则取 N，断言序列含严格递减相邻步；不出现 3→6 这类跳增 | manual | `20-frames/` |
| E-REAL-3 | 计时连续 | 同一批内 elapsed 秒数随墙钟单调递增，单个 settle 不把锚点重置为 0 | 逐秒帧取 `*{N} {t}s` 的 t，断言存活期间的 t 序列非递减 | manual | `20-frames/` |
| E-GATE | bridge 范围门禁 | `packages/bridge` `bun test` 0 fail；`bun scripts/build-bridge.mjs` 成功；生成物 `capir/capir.json`、`capcontract/`、`ledger/` git status 为空 + 双跑 sha 一致 | 命令退出码 0 + 输出在档；git status 三项为空 | gate | `30-gate.out` |

## 三、JUDGMENT 预案（只记录，不拦门禁）

1. 复用既有 `agent.settle` 帧类型、只改发出时机，不新造帧类型/协议——技术默认，非用户判断。
2. 「即时」的口径 = 子 `turn/end` 处理同步路径内发出；验收放宽到 ≤2s 消失以容忍调度抖动。
3. 「计时连续」指同一批锚点不因单个子代理 settle 而重置；整批归零后再起的语义沿用现有 R8 锚点逻辑，不在本刀改。
4. 不碰 tui-base/shell 渲染源码；渲染层 running-only 的不变式由另一 agent 负责，本刀只保证状态帧及时到达。
5. 真机若模型不按预期错峰启动（旧证据里曾把两批并发启动），E-REAL-1/2/3 标 NOT RUN 并以单测覆盖，不拼接、不虚构帧。

## 四、脱敏纪律（W5 §4）

- 帧 `.ans` 只含 UI 文本与数值（`subagent *N`、agent 标识、elapsed 秒数）；不落任何令牌、凭据、cookie。
- wire / emit / proof 三处白名单：只采帧文本与 journal 中 `turn/end` 时间戳，不采会话内容正文。
- 报告只报键名与有无，不报值；不把 suspect 字符串贴进报告。
- 证据采集最后一步跑脱敏扫描；若发现疑似凭据，先剔除再落档，并如实记录剔除动作。

## 五、NOT RUN / 作用域外声明

- 不跑全量测试，只跑 `packages/bridge` 范围（另一 agent 并行改 tui-base/shell）。
- 不 commit、不 push；提交由协调者统一做。
- 不碰主仓、其它 worktree、用户 `~/.dsh`、用户 tmux socket（`default`、`cmdz`）。
- 生成物（`capir/capir.json`、`capcontract/`、`ledger/`）禁止任何变化。
