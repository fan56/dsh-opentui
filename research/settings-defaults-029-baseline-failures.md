# settings-defaults-029 — 基线 6 失败单列跟踪（只读登记，不宣称修复）

> **SUPERSEDED（2026-11-26，029 release gate）**：下表 6 项在 029 发版门槛复测中已全部转绿，不再是未解决的基线失败。本文件保留为历史登记，仅作溯源，不作为当前失败清单或发版阻塞依据。当前状态以 `.proof/029-release-gate/` 下的复测日志为准。

登记时间（UTC）：2026-11-25T13:00Z。来源：round 2 验证报告 `report-round2.md` §四与两组包测试原始输出。本文件只把失败逐条列出并附 clean 基线对照，**不做修复、不判定为已解决、责任归属待定**。

## 一、背景与口径

- 命令：`bun test packages/shell packages/tui-base`（在 worktree `/Users/qingguee/repo/dsh-opentui-wt-settings-defaults` 运行）。
- 本轮工作树结果：`2724 pass / 3 skip / 6 fail / 12988 expect / 2733 tests / 187 files`，`EXIT=1`。
- clean 基线构造：`git archive 666f235 | tar -x -C /Users/qingguee/.cache/dsh-round2-baseline-666f235`（对共享仓库只读，无 `git worktree add`），`node_modules` 以 `cp -a` 复制使 workspace 相对软链解析到基线自身；HEAD 锚点 `666f235c8575986b52c2dd6b42fb2441d0d25482`，写盘时工作树 clean。
- clean 基线结果：`2715 pass / 3 skip / 6 fail / 12926 expect / 2724 tests / 187 files`，`EXIT=1`。
- 失败集合逐条相同；工作树多出的 9 个测试全部通过，失败数由 round 1 的 7 降为 6 来自独立的 V-F1 修复，**与下列 6 项无关**。
- 透明记录：首次基线尝试用软链 `node_modules`，相对软链解析到被修改树，该次输出 `baseline-step2-packages-invalid-symlink-probe.out` **不作为判定依据**。

> 证据路径：原 `.proof/settings-defaults-029/round2/` 在本任务执行期间被并发的 proof 外部化改动迁至
> `/Users/qingguee/repo/doc/dsh-opentui/proof/_worktrees/dsh-opentui-wt-settings-defaults/settings-defaults-029/round2/`。
> 下列文件名均相对该目录；内容未改。

## 二、逐条失败清单

| # | 失败名（verbatim，`(fail) <测试名>`） | clean 666f235 基线 | 本轮工作树 | 判定 | 责任归属 |
|---|---|---|---|---|---|
| 1 | `provision-inproc-profile.mjs host gate > in-window host: exemption granted before any mutation, PASS` | FAIL | FAIL | 基线已存在，非 settings-defaults-029 引入 | 待定 |
| 2 | `provision-inproc-profile.mjs host gate > out-of-window host: explicit failure with three elements, no mutation` | FAIL | FAIL | 基线已存在，非本切片引入 | 待定 |
| 3 | `provision-inproc-profile.mjs host gate > undetectable host: fails loud instead of assuming compatibility` | FAIL | FAIL | 基线已存在，非本切片引入 | 待定 |
| 4 | `bin integration: async client spawn maps child exit code / signal (PR B) > deprecated --force/--yes warn once without changing the client exit code` | FAIL | FAIL | 基线已存在，非本切片引入 | 待定 |
| 5 | `bin integration: async client spawn maps child exit code / signal (PR B) > launcher exits with the fake bun shim exit code` | FAIL | FAIL | 基线已存在，非本切片引入 | 待定 |
| 6 | `bin integration: async client spawn maps child exit code / signal (PR B) > launcher exits 128 + SIGTERM when fake bun kills itself with SIGTERM` | FAIL | FAIL | 基线已存在，非本切片引入 | 待定 |

原始输出定位（基线 / 工作树）：`baseline-step2-packages.out:180,195,210,657,681,705` / `verify-step2-packages.out:180,195,210,659,683,707`（另各有一次汇总段重复列出，见 `:3236-3241` / `:3245-3250`）。

## 三、分组与线索（只读观察，不是修复结论）

- 第 1–3 项集中在 `provision-inproc-profile.mjs host gate`，属供给链/host gate 面；与 settings-defaults-029 改动的 `subagent-policy.ts`、`seams/config.ts`、`settings-panel.tsx`、i18n 文案无交集。
- 第 4–6 项集中在 `bin integration: async client spawn maps child exit code / signal (PR B)`，属 launcher 退出码/信号映射面；与上述改动面无交集。
- 两组在 clean 基线与本轮工作树均同样失败，故「既有测试 0 fail」不成立是**切片前既存状态**，不是本切片回归。按预注册 PASS 判定式，严格总判定仍为 FAIL，直到这些失败被其责任方单独处理。

## 四、处置边界

- 本文件不声称任何一项已修、已绿、已豁免；未运行任何针对这 6 项的复测或捞绿动作。
- 责任归属：待定。建议发版/集成切片按上面两组分别指派（供给链 host gate、bin launcher 退出码），本切片不代认。
- 不 commit / push；`.proof` 外部化与其他工作树的孤儿进程清理均不在本文件范围。
