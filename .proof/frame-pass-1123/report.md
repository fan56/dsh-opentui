# 主 agent 安装版真机抓帧验收报告 — 2026-11-23 UI 批次

执行人：协调者（主 agent）本人，未委托 agent 代看帧。依据：`tui-screenshot-verify-by-ans-values`（以 `.ans` 数值/文本为准）与 `packed-artifact-real-machine-gate`（源码全绿 ≠ 安装版可用）。

## 1. 方法

- **被测物**：`npm pack` 产出的安装包，装进独立前缀 `/private/tmp/uibatch-global`，用拷贝的 scratch home（`/private/tmp/uibatch-frame-home`）+ 独立 tmux server（`-L uibatchframe`）启动；不碰用户 `~/.dsh` 与用户进程。
- **最终包**：`aiwayds-dsh-opentui-0.18.3.tgz`，sha256 `aff2afb9530b240b49a900ea8b3aa69580946a5d4fde8586ce31b0d2113cc15a`，由独立检出 `/private/tmp/uibatch-verify-wt` @ `13411a7`（分支 `feat/ui-batch-1123` 最终提交）构建。本目录 `01`–`25` 帧与 `results.txt` 全部出自该包。
- **驱动**：`tmux send-keys` 注入按键；鼠标用真实 ESC 字节的 SGR 序列（`ff-final-stage4.sh` 的 `click()`）。复制结果用 `pbpaste` 实读系统剪贴板（先预置哨兵值再比对）。
- 终端尺寸：带框模式 120×40；紧凑模式 80×24（面板行数 ≤30 走紧凑分支）。

## 2. 最终包验收结果（`results.txt` + 对应帧）

| # | 验收项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 有选区 ctrl+c → 写系统剪贴板、输入行保留、不弹退出框 | PASS（pbpaste=`ARCHIVE-COPY-9`） | `02`、`03` |
| 2 | 无选区有字 ctrl+c → 清空输入行、不弹退出框 | PASS | `04`、`20` |
| 3 | `/permission` 弹窗：标题纯文本，提示在说明行 | PASS | `05` |
| 4 | `/resume` 列头（UPDATED/DIR/SESSION）渲染 | PASS | `06` |
| 5 | 已绑定会话 `/new` 后 1 秒发消息 → 新会话绑定、无 Console 报错、无「未确认输入」 | PASS | `07` |
| 6 | 新会话第二条消息正常（不再静默写旧会话） | PASS | `08` |
| 7 | 审批卡：四按钮完整单行 + 正文两行图例 | PASS | `07` |
| 8 | tab 激活标记（带框）：`[1 main]` ↔ `[2 todo]` | PASS | `09`、`10`、`11` |
| 9 | 鼠标点击 tab 双向（带框）；点后活动面板粗框、输入框细框且可见 | PASS | `09`–`11` |
| 10 | 面板消失后焦点自动回输入框（不击键） | PASS | `12` |
| 11 | R8 简报 `subagent *3 Ns` 计时递增；全部完成后简报与代理区收起 | PASS（3s → 11s；完成后 `*`=0 帧、FIN 回复在） | `14`、`15`、`16` |
| 12 | tab 激活标记 + 鼠标双向（紧凑 24 行） | PASS | `21`–`24` |
| 13 | 审批弹窗打开期间 tab 行完整（ASCII 标签不被吞） | PASS（`[1 main]  2 todo`） | `07` |
| 14 | 24 行下子代理 turn：对话区保留 16 行（底线 6 行） | PASS | `25` |

补充的机器可读事实（取自同一最终包或前一包 `733e859`，帧未单独存档的以会话内原始输出为准，标 CLAIM）：

| 项 | 结果 | 证据级别 |
|---|---|---|
| B3 子代理 tail/round 实时更新 | round 0→1→3、tail 逐秒滚动 | PASS（`ff-r8` 帧文本已引用于会话；最终包 `14`/`15` 含 tail 行） |
| B1 并发上限：请求 6 个子代理，模型回报「active child limit: 3」分两批各 3 个 | 上限被宿主执行 | CLAIM（模型回报文本；`ff-r8` 帧未入库） |
| s 键（本会话放行全部写操作）后第二个 bash 零弹窗 | PASS | 在包 `18f48bf5…`（733e859）上验，帧未存档 → CLAIM |
| a 键（此工具本会话不再问）后第二个 bash 零弹窗 | PASS | 同上 → CLAIM |
| 系统文字 info 色（`38;2;120;169;255`）；dock 2 秒后直接消失无渐隐 | PASS | 在首个包上验，帧 `/private/tmp/frame-01-permission.ans` 未入库 → CLAIM |
| settings Host 分区显示宿主真值、`maxDepth` 无编辑标记（只读）、权限行聚焦显示「仅影响新会话…」 | PASS | 帧未存档 → CLAIM |

## 3. 抓帧发现并已修复的缺陷（单测、评审、机器门禁全部未拦住）

| # | 缺陷 | 根因 | 修复 commit |
|---|---|---|---|
| D1 | 输入框选区 + ctrl+c 不复制，反而弹退出确认 | 发行 bundle 挂的是 v2 `SessionComposer`，R1 的 copy 层做在了不在包里的 v1 `<Prompt>` | `84b2ce7`、`5f19087` |
| D2 | 24 行终端上看不到 tab 条 | 面板行数 ≤30 走紧凑分支，R2 只把 tab 条做进带框模式标题 | `7f89410` |
| D3 | 审批卡按钮断词（「写操/作」「Rej/ect」） | 60 列卡内四个带短句的按钮放不下 | `df699fe`（短按钮 + 正文图例） |
| D4 | `/permission` 提示与 settings 行提示都不显示 | `pickOne` 的 `headerLine` 在 v2 入口从未转发；settings `fromItem` 只拷 `note` 丢 `source` | `de33f46` |
| D5 | tab 能切换但无任何激活指示 | 未实现 | `187a653` |
| D6 | 面板消失后输入框停在细框直到击键 | 焦点信号未随 dock 隐藏回落 | `36dc77a` |
| D7 | trace 的 composer 埋点不在发行包里 | 同 D1（做在 v1） | `75999cf`、`0690166` |
| D8 | `/new` 后发消息失败（预存，0.26.4 即有） | 客户端发 `session.open{mode:"new", replace:true}`，违反 ADR-0010；失败后意图被丢弃，后续消息静默写旧会话 | `f08fa9d` |
| D9 | 审批弹窗期间 tab 行中文被吞（`[1       ]  2`） | 上游 opentui「弹窗后面的宽字符丢失」既有缺陷 | `9fe76f3`（zh 标签改 ASCII 规避） |
| D10 | `shell-render-regression-ft` dock 活动帧用例变红 | D6 的焦点回收 effect 清掉了用例提前钉的焦点前提（测试前提过时） | `13411a7` |

误报排除（记档以免重查）：第一次鼠标注入无效是注入方式问题（tmux `-H` 十六进制把字节吞了），处理链本身正确；早期「C-u/C-k 失灵」是对话框吃键造成的假象。

## 4. 未验证 / 已知限制（如实）

1. **cmd+c 未实机验证**：tmux 无法注入 super 修饰键。已改为走键位配置（`input.copy` 默认 `ctrl+c,super+c`），单测覆盖；Ghostty 是否把 cmd+c 透传给程序取决于终端，不透传时走终端原生复制。
2. **错峰完成的干净「3→2」帧未取到**：我的两轮里三个子代理几乎同时结束，简报从 `*3` 直接收起。R7/R8 刀的帧 `.proof/r7-r8-subagent-brief/steer-012-*.ans` 记到过 `*1 12s` + 1 行后消失（计数递减、计时未重置）。「同 turn 内全部跑完再开新一批从 0 计」只有单测，真机未取到。
3. **todo 简报与 subagent 简报合并同行**：我的几轮模型都没调 todo 工具，真机未取到合并行帧；合并文本有单测精确覆盖。
4. **紧凑模式（≤30 行）没有活动面板边框**：R5「所有常驻面板参与粗/细」在紧凑模式下无面可画——活动面板是单行 rule 形态。此时焦点只在输入框与对话区之间体现。属对定案的偏离，需用户知悉。
5. **R7 无行为改动**：审计确认四个面本来就只显示在跑的子代理。
6. **Console 面板与输入框重叠渲染**：上游 diff-paint 既有撕裂，基线 1:1 复现，不在本批修；`/new` 修复后不再有触发它的报错。
7. **trace 开关未做端到端真机取证**：只验证了埋点进了发行 bundle（`composerSet` / `contentChange` 命中）。待下次用户复现输入残留时使用。
8. **预存旁支未修**（oldfox F1 旁支）：已绑定时 `/resume B` 被 `SESSION_LOCKED` 拒绝后，下一条消息仍会写进旧会话。本批只改了 `mode:"new"` 分支。
9. B2「进入输入时显示残留值」原始投诉未定位：判别实验四腿均未复现；已交付 trace 取证开关待复现。

## 5. 环境收尾

抓帧期间 `tmux kill-server` 留下过 3 个孤儿宿主、E2E 留下 3 个；已逐个用 `lsof` 核对 cwd（均为本批工作树或 `/private/tmp/uibatch-*`）后清理，收尾时机器上无残留 dsh 宿主。用户实例未被触碰。

## 6. 帧文件说明

`17`–`19` 是脚本引号 bug 的无效尝试（点击序列没发出，后半行命令被打进了输入框——`18`/`19` 输入框里可见），仅留作记录；紧凑模式点击的有效帧是 `21`–`24`。`ff-final-stage34.sh` 含该 bug，`ff-final-stage4.sh` 为修正版。
