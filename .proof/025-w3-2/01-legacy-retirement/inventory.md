# 旧 e2e/scenarios 盘点（write-once 证据，2026-11-21T19:20Z）

- 一手来源：`e2e/scenarios/*.sh` 逐文件头注释 + 断言行（本地 worktree @ `78af4db`），非转抄。
- 范围：21 场景 + `run-all.sh`；同批受影响的支撑层 `e2e/lib/*`、`e2e/fixtures/*`、`e2e/Containerfile`、`e2e/run-e2e.sh`、`e2e/run-client-e2e.sh` 另在 deletion-list.md 登记。
- 口径：A.5（W4 §二）「不删既有测试」= 不得删除仍有效的覆盖；被测面消亡随删须登记、通用语义先迁移接管。

## 逐场景断言主题（21）

| # | 场景 | 断言主题（一手摘录） | 被测面状态 |
|---|---|---|---|
| 1 | 10-install | npm pack 完成；全局安装 + bin 解析；npm 包携带 client bundle；重复安装幂等 | plugin-era 腿已随 ADR-0005 retire；client 安装语义仍有效 |
| 2 | 11-upgrade | 离线 fixture：dry-run 计划零写；真实安装 --save-exact；override 落盘；二次 up-to-date；provisioning 尊重 override | 仍有效 |
| 3 | 20-start | composer placeholder/hint；provider/model powerline；时钟走动；编辑器回显/退格（斜杠面板镜像） | 仍有效 |
| 4 | 22-search | Ctrl+Shift+F 搜索面板；footer hint；负例 No matches；正例 2 命中；n/N 走动；Esc 关闭；重开新查询 | 仍有效 |
| 5 | 30-commands | '/' 面板 6 行/行形/首行高亮；/cl /mo 过滤；清-还原；Esc；裸 /model 降级；unknown；编辑器活性；/think /hotkeys /plugins 组 | 仍有效（/think 硬断言为旧遗留缺口，见下 note） |
| 6 | 40-mock-llm | mock SSE 流十 tick → transcript；E2E-TPS-TURN-DONE；footer provider 段 | 仍有效 |
| 7 | 50-resize-exit | 80x24 ↔ 140x36 存活；24 行内面板；/quit 干净退出；Ctrl+C x2 干净退出；退出后再启动 | 仍有效 |
| 8 | 60-ask-user | dock 面板 tab 条；单选/多选行形；自动前进；空格切换；review 页；submit；envelope 二维数组证据 | 仍有效 |
| 9 | 61-btw | side panel 开/Thinking/答案；queue 提示；settle hint；主行进度；bare /btw 行为（含产品缺口 skip） | 仍有效 |
| 10 | 62-hard-stop | maxRounds=5 + grace=2 在 round 7 触发；wrap-up 被忽略；use_agent 子进程 force-stop；DONE | 仍有效 |
| 11 | 63-cache-hit | 无 usage→无 CH；90%/20%/55% 三率；session 模式热切换 | 仍有效 |
| 12 | 64-session-stats | /session 面板 token/cache/speed/session/model/turns 行；真实 decode 窗定价 | 仍有效 |
| 13 | 65-jev-attention | jev verdict trail ≥2；早停 round bound；⏻!/spin 标记（gate 依赖，G2/G3 warn） | 仍有效（部分 gate-dark 历史遗留） |
| 14 | 66-preset | /preset picker / notice；/preset next 确认 dialog；Esc cancel / Enter 切换；footer dsh(name) | 仍有效 |
| 15 | 67-theme | /theme picker；apply feedback；config.json 持久化；skin 迁移重启；颜色指纹自校准 | 仍有效 |
| 16 | 68-resume | /resume UPDATED/DIR 列；1KB 显示下限；empty-filtered copy；G0 旧 picker 探测 | 仍有效 |
| 17 | 69-login | Add provider picker；六步自定义表单；base URL 校验；commit 双写（settings+credentials）；Esc 放弃 | 仍有效 |
| 18 | 70-steer | Subagents picker → Enter → steer prompt → seam.steerChild；success echo；mock-log 证据；Esc cancel | 仍有效 |
| 19 | 71-search | /plugins panel bundle 表 / / 过滤 / state 列；ctrl+alt+f；/search 全文；Esc 两级 | 仍有效 |
| 20 | 72-agents | /agents 表 NAME/MODEL/DEEP/DESCRIPTION；空 corpus；字段层；limits 层；Esc 导航 | 仍有效 |
| 21 | 80-onboard | fresh DSH_HOME → provision → repo-root launcher boot；composer/provider 段 | plugin-era 腿已随 ADR-0005 retire；onboard 语义仍有效 |

## 依赖链（一手核对，改期理由复核）

- `e2e/families/run-all.sh:80`（容器族）→ `e2e/run-e2e.sh:87` → `bash /e2e/scenarios/run-all.sh`。
- `scripts/test-tier.mjs:206`（e2e tier）直接 `bash e2e/run-e2e.sh`；`:223` all-tier list 同列。
- 改期出处：`/Users/qingguee/repo/wayfinder-web-profile/research/024-tag-prep-final.md` §D（commit `988c6f0`）；本批执行下线即兑现该改期承诺。

## note（历史遗留，不掩盖）

- 30-commands `/think` effort-picker 15s 超时（mock 无 reasoning-effort ladder）；65 G2/G3 gate-dark/warn —— 均属旧 scenarios 层的历史遗留缺口，已记 `024-tag-prep-final.md` §遗留 3；下线不「修」它们，只把仍有效语义交给新架构（见 takeover-table.md）。
