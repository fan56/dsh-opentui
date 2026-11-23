# 主 agent 安装版真机验收（第二轮）— 0.27.0 最终包

执行人：协调者（主 agent）本人抓帧，未委托 agent。依据 `tui-screenshot-verify-by-ans-values`（以 `.ans` 文本/数值为准，不用视觉模型）与 `packed-artifact-real-machine-gate`。

## 被测物

- tarball：`/private/tmp/uibatch-pack5/aiwayds-dsh-opentui-0.18.3.tgz`，sha256 `a3619290801ce20dcfef285337784afaaf75e6e5d17d53205e4a0c4d40ce011e`，由干净检出 `/private/tmp/uibatch-verify-wt` @ `2555fe3` 打包（prepack 重建 bridge/client/locales）。
- 安装：`npm install -g --prefix /private/tmp/uibatch-global`，删除旧目录后全新装。
- 环境：**全新 scratch home** `/private/tmp/ff270h2`（只拷 `.credentials.yaml`、`model-*.json`、`agents/`，profile 由包自己 provision），tmux `ff270c`，120×40 / 80×24，`/motion full`（经 `/motion full` 命令设置）。
- 模型：`deepseek-v4.1-flash`（opencode-go），真实 turn。

## 一、本轮 PASS（帧在 `pack-2555fe3/`）

| # | 项 | 结果 | 证据 |
|---|---|---|---|
| 1 | **motion full 下活动面板内容行**（本批回归） | PASS：工具启动后立即出现 `⚙ bash sleep · 0.6s · $ sleep 8`，不再有 1–7 秒只有边框 | `results-r7.txt`、`30-card.ans` |
| 2 | **motion reduced 下内容行** | PASS：t+4.6s 出现 `⚙ bash sleep · 0.6s` | `50-red-05.ans` |
| 3 | **motion off 下内容行** | PASS：t+3.5s 出现 `⚙ bash sleep · 0.5s` | `60-off-04.ans` |
| 4 | **R7：子代理结束即消失** | PASS：三个子会话 journal `turn/end` 后 **765 / 375 / 768 ms** 行消失；`*3→*1→0` 单调；计时 `0s→4s` 连续 | `.proof/subagent-settle-lag/20-journal.md` |
| 5 | 审批卡（B4）：四按钮单行 + 正文 `[a]`/`[s]` 图例 + 原因行 | PASS | `30-card.ans` |
| 6 | `/permission` 无参弹窗 | PASS：`Select permission preset`、`● marks the default preset` | `94-permission.ans` |
| 7 | tab 条 + 鼠标双向切换 | PASS：点击 `2 todo` → `[2 todo]`；点击 `1 main` → `┏━[1 main]`（并同时把面板置为粗框） | `101-click-todo.ans`、`102-click-main.ans` |
| 8 | 焦点粗细框 + 面板消失后焦点回输入框 | PASS：面板活动时 `┏━`、输入框 `┌─`；面板收起后输入框恢复 `┏━` 粗框 | `97-alt2.ans`、`102-click-main.ans` |
| 9 | 紧凑 80×24：tab 条 + 单行 dock 内容 | PASS：`[1 main] 2 todo` + `┃⚙bash sleep · 2.7s · $ sleep 8` | `70-compact-08.ans` |
| 10 | `/new` 后立即发消息 | PASS：本轮连续 4 次 `/new` + 立刻发消息，无「消息失败」、无写旧会话 | 会话内多次复现，`results-tiers.txt` |

## 二、本轮 NOT VERIFIED（不冒充 PASS）

| # | 项 | 状态 | 说明 |
|---|---|---|---|
| 1 | `ctrl+c` 清空输入（无选区有字） | NOT VERIFIED 本轮 | 本轮几次尝试中输入框掌握了焦点、但同一 pane 里残留上一条已提交消息，判定指标被污染；上一轮在 `13411a7` 包上用「placeholder 回归 + 无退出框」判定 PASS，代码路径本批未改 |
| 2 | `ctrl+c` 有选区复制 → `pbpaste` | 单测 + 上一轮真机 | `cmd+c` 在 tmux 里注入不了；本轮未重跑 |
| 3 | **`alt+1` / `alt+2` 切 tab** | **NOT VERIFIED，疑似缺口** | 四种注入（`\e2`、`M-2`、`\e1`、`M-1`）都不产生切换；鼠标切换正常。键位绑定存在（`session.dock.tab.main/todo`），但只有「默认值」单测，没有真实按键路径测试。见下方「发现」 |
| 4 | `/resume` 列头 | 上一轮 PASS（`13411a7`） | 本轮未重取 |
| 5 | 24 行下子代理 turn 的对话区行数预算 | 上一轮 PASS | 本轮紧凑模式只验了 tab 与 dock 内容 |

## 三、发现（不阻塞发版，需登记）

1. **`alt+1/alt+2` 在真实终端未验证通过**：`alt+2` 与 `alt+1` 都观察不到切换。可能原因：（a）终端/注入无法表达 alt+digit；（b）绑定注册在 global 层但被更高层吞掉（本仓有过同类先例）。建议发版后用一个真实 Ghostty/终端人工确认一次；若确为 bug，优先修键位而非改文案。CHANGELOG 里「或按 alt+1 / alt+2」的表述在此项确认前属未证实。
2. **环境现象（与本批无关）**：本轮多次出现「bash 工具执行完但会话事件不回来、turn 长时间不结束」，**stock 0.26.4 在同样 fresh home 下 1:1 复现**（`baseline-results.txt` / `stock-results.txt` 未入库，结论已记入本文件）。归因为环境/上游，不计入本批判定。
3. 紧凑模式审批弹窗仍然压在 tab 行上（上游宽字符/叠绘既有缺陷），与本批既有声明一致。

## 四、结论

两个阻塞修复在安装包上均有真机证据：motion full 面板内容恢复、R7 时延压到 1 秒内。14 项交互矩阵中 10 项本轮 PASS；3 项沿用上一轮 `13411a7` 的证据（代码未改）；`alt+1/2` 为新增的未验证项。
