# R7 — 宿主 journal `turn/end` 与面板行消失的时延（0.27.0 安装包真机）

被测物：`npm pack` 产物 `a3619290…`（HEAD `2555fe3`），装进 `/private/tmp/uibatch-global`，全新 scratch home `/private/tmp/ff270h2`，tmux `ff270c`，120×40，`/motion full`。
场景：一条 prompt 让模型用 `use_agent` 并行起 3 个纯推理子代理（禁用工具）。

## 宿主 journal（每个子会话自己的 `turn/end`）

`$DSH_HOME/sessions/--private-tmp-ff270-ws2--/<id>/session.v4.jsonl.zstd`，解压后取 `turn/end` 的 `time`（epoch ms）。父会话 `87faf176`，子会话：

| 子会话 | turn/end (epoch s) | reason |
|---|---|---|
| 4a0d0140 | 1795424496.004 | completed |
| 8c191e1b | 1795424496.394 | completed |
| af1eef9d | 1795424498.038 | completed |

三个子会话 `turn/start` 分别在 1795424492.844 / .851 / .855（同一秒内，即并发起跑，未错峰）。

## 面板观测（逐秒帧 `40-sub-NN.ans`，帧时刻取文件 mtime 亚秒精度）

| 帧 | 相对时刻 | 面板 `subagent *N` | 期望（按 journal：end > t 的子会话数） |
|---|---|---|---|
| 40-sub-07 | t+11.72 | `*3 0s` | 3 |
| 40-sub-08 | t+12.73 | `*3 1s` | 3 |
| 40-sub-09 | t+13.75 | `*3 2s` | 3 |
| 40-sub-10 | t+14.77 | `*1 3s` | 1 |
| 40-sub-11 | t+15.79 | `*1 4s` | 1 |
| 40-sub-12 | t+16.81 | 简报消失 | 0 |

（t=0 为 1795424482。）

## 断言结果

- **E-REAL-1（结束后 ≤2s 行消失）PASS**：
  - end 14.00 → 下一帧 14.77（**765 ms**）已不计该子代理
  - end 14.39 → 同一帧 14.77（**375 ms**）
  - end 16.04 → 下一帧 16.81（**768 ms**）
- **E-REAL-2（`*N` 严格递减）PASS**：3 → 1 → 0。没有 3→6 这类跳增（旧 ERRATA 的显示错误不再出现）。两个子代理在 0.39s 内先后结束，所以没有取到 3→2→1 的逐级帧，但每一步都单调不增。
- **E-REAL-3（计时连续）PASS**：`0s → 1s → 2s → 3s → 4s`，非递减，单个 settle 未重置锚点。
- 子代理行随简报一起消失，父 turn 随后正常收尾。

## 说明

- 三个子代理是并发起跑、先后结束（3.16s / 3.55s / 5.19s），不是人为错峰；预注册 JUDGMENT-5 允许不追求人为错峰。
- 本轮另一条 prompt 的子代理因模型通道抖动未起全，未采用；本文件只记录上面这一次完整序列。
