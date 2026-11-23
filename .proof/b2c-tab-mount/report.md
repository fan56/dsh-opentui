# Proof Report: b2c-tab-mount / 发行路由 24 行挂载带 tab 的活动框

- Gate / 门禁: FAIL
- Result / 结论: FAIL  （与 Gate 一致）
- Profile(s): FEATURE + 真机 tmux 数值帧
- Change ref: `7f89410`（正文 E1–E4：24 行紧凑分支挂 tab bar）；`187a653`（附则 A1–A6：鼠标点击链诊断 + 激活标记）；`36dc77a`（附则 A7：dock 隐藏后焦点回落 composer）。最终态以 HEAD 上三者叠加为准。
- Working tree: 本 agent 只新增本报告，并把未入库的 `01-main-24row.ans` / `02-after-alt2-24row.txt` 纳入本批；他人未改动的文件未触碰。
- Expected registered (UTC): 正文 2026-11-23T05:09:25Z；附则 2026-11-23T05:47:17Z（见 `00-preregistered-expected.md`，write-once）。
- Assertion total N: 11（正文 E1–E4 + 附则 A1–A7）
- Acceptance target（用户原话，本轮文档任务）: "内容必须**只依据盘上已有的一手证据**……没有证据的项如实标 NOT RUN / CLAIM"。切片目标（预注册原话）: "a real-render WidgetsDock at height 24 paints a leading row `1 main  2 todo`"。

## 1. 切片目标与生效 commit

目标一句话：在发行客户端 120×24 紧凑终端上挂载「主面板/待办」活动 tab 行，并让切换、激活标记、鼠标命中与 dock 隐藏后焦点回落都生效。

生效 commit 链：
- `7f89410` —— 紧凑分支加 `dockTabBarLayout` + `mergedLineView` tab 行、命中测试、内容走 `activityDockTab()`。
- `187a653` —— 前文 A1–A6：确认 SGR 注入方式才是点击无效的根因、统一激活 tab 的 ASCII `[]` 标记、命中区随标记宽度。
- `36dc77a` —— A7：`activityFrameLatch` 隐藏时若焦点在 activity 则回落 composer。
- 注意：附则 A4 的激活标记是**后加**形态（`[1 主面板]  2 待办`），取代正文 E1/E4 冻结的无标记形态（`1 主面板  2 待办`）；E1/E4 的最终状态以附则 A4 的带标记形态为准。

## 2. Gate / Result 表

| id | 预注册 expected（摘要） | Result | 判定依据 | 证据文件 | 最终态归属 |
|----|------------------------|--------|----------|----------|-----------|
| E1 | 24 行紧凑挂载 tab 行（`1 main  2 todo`） | CLAIM | 判定式要求 render test 断言 `occupied[0].trimEnd()`；目录**无任何 `.log` 测试输出**。仅有真机帧，且 en 字面未在帧中出现 | 无测试日志（真机帧 `01-main-24row.ans` 反而显示无 tab 行） | 形态已被 A4 带标记版取代 |
| E2 | main tab 仍画 `bash` 工具行 | CLAIM | 判定式为 render test 断言 `bash` 在 main；无测试日志；真机帧 10/12 出现 bash 非正式断言 | 无测试日志 | 同上 |
| E3 | alt+2/alt+1 切换，todo 树 `romeo` 在、rule 行消失 | CLAIM | 判定式要求 render test 驱动 signal 断言 `romeo`；无测试日志；真机帧 11 显示 `[2 待办]` 激活，但未见 `romeo` 字样 | 无测试日志；帧 `11-compact-todo-active.ans` | 同上 |
| E4 | 发行包 120×24 真机两模式显示 `1 主面板  2 待办` | CLAIM | 预注册点名的 `/private/tmp/b2c-final-main.ans`、`/private/tmp/b2c-final-todo.txt` **不在证据目录**；目录内 `01`(无 tab) 与 `02`(有 tab) 两张 24 行帧相互矛盾；无 60/120 行号可核对 | `01-main-24row.ans:27-29`、`02-after-alt2-24row.txt:29` | 形态已被 A4 带标记版取代 |
| A1 | 点击无效根因是 `-H` 注入方式，处理链正确 | CLAIM | 判定式要求 stdin debug log + mouse debug log；附则自报 PASS 并描述日志内容，但目录内**无对应原始日志文件** | 无（附则文字自报） | 附则新增，最终态以此为准 |
| A2 | 可靠注入法为 `$'\e[<...'` 字面 ESC | CLAIM | 判定式要求 `.ans` 帧 + debug hook；hook 原始输出不在目录；帧无法单独证明注入法 | 帧 `10/11/20/21`，无 debug hook 日志 | 附则新增 |
| A3 | 紧凑 + 带框双模式各留点击前/后帧 | PASS | 帧文件确实存在且 tab 激活标记从 `[1 主面板]` 迁到 `[2 待办]` 再迁回；`20/21/22` 带框帧同理 | `10-compact-main-active.ans`,`11-compact-todo-active.ans`,`12-compact-main-back.ans`,`20/21/22-*.ans` | 附则新增 |
| A4 | 激活标记统一来源，两模式带 `[]` | PASS | 帧含字面串：`10`/`20`= `[1 主面板]  2 待办`，`11`/`21`= `1 主面板  [2 待办]`；单测精确断言的原始输出不在目录 | `10/11/20/21-*.ans`（en 单测日志缺失） | 附则新增；取代正文 E1/E4 无标记形态 |
| A5 | 切换后标记迁移 | PASS | 帧序列 `10→11→12`、`20→21→22` 标记往返迁移；渲染测试 stdout 不在目录 | `10/11/12/20/21/22-*.ans` | 附则新增 |
| A6 | 命中区随标记宽度（R2 hit-zone 复测） | CLAIM | 判定式为 `widgets-dock-tabs-r2.test.ts` 单测复测；目录无任何测试日志；commit `187a653` 仅证明改了测试源码 | 无测试日志 | 附则新增 |
| A7 | dock 隐藏后焦点回落 composer | PASS | 帧 `30` 显示 dock 消失后 composer 自动重框 `┏━`、无需击键；渲染测试 B2c-3 的 stdout 不在目录 | `30-focus-after-hide.ans` | 附则新增 |

汇总：PASS 4（A3,A4,A5,A7） / FAIL 0 / NOT RUN 0 / CLAIM 7（E1,E2,E3,E4,A1,A2,A6）。

## 3. 原始输出指针（存在性 + sha256）

`*.log`/`*.ans` 按 `.gitignore:4` 及 UI capture 规则被忽略；此处登记文件名与完整 sha256。

| 文件 | sha256 | 入库状态 |
|------|--------|----------|
| `01-main-24row.ans` | `ac017dbcc19176107db85d12a47bccc72584ea2b07cdf2ae53e11c4333e2b5f9` | 本批 `git add`（8347 B，<200KB，未入库） |
| `02-after-alt2-24row.txt` | `92678017186f0fcc283f3242d4906c15a6edee96e5017b83ee00caf04213339e` | 本批 `git add`（3994 B，<200KB，未入库） |
| `10-compact-main-active.ans` | `0f0c77912dc619c8a18f384f24538383ff30d264b601e746dba027d4776de6fc` | commit `187a653` 已入库 |
| `11-compact-todo-active.ans` | `7b1583582a6f428ae8bda6f701e4e2fe1e1e40950e03c17ff6253f818bd774d3` | 已入库 |
| `12-compact-main-back.ans` | `cf91166dac47c860ff53d1883940255e2aaa7b0625b87020e23ba2bcd13d6094` | 已入库 |
| `20-framed-main-active.ans` | `625bfa1841397e9dced6e4abba2373d04d56d1e2a9abb5e1e5bdfdac7c58e499` | 已入库 |
| `21-framed-todo-active.ans` | `68c186f2ad49761e55e921bf377650289aedf0d81a2ae7898c38c1c21915624a` | 已入库 |
| `22-framed-main-back.ans` | `c05190c7470daf0f1c955174035a6793ceb8ebb4921f6ef799b58647325cfd7b` | 已入库 |
| `30-focus-after-hide.ans` | `7580883f00a0f11544af9f461f3499ba60db2ad65bef966363980d3666b7ea5f` | commit `36dc77a` 已入库 |
| `00-preregistered-expected.md` | `597b0f17413a606ae3d310bf8dcae4b9d429a2673cab0818bd85349fe05b6f21` | 已入库 |

## 4. 已知偏离与诚实声明

- **断言无测试原始输出**：E1/E2/E3/A6 的 pass criterion 全部是 render/hit-zone 单测断言，但目录内**没有任何 `.log` 测试输出**；附则对 A1/A2/A5 所述「debug hook」「渲染测试绿」也只是自报文字，没有原始日志。这些项一律 CLAIM，不借 commit 的 `git show --stat`（仅证明测试源码被改）充当测试结果。
- **E4 帧证据缺失且自相矛盾**：预注册点名的 `/private/tmp/b2c-final-main.ans`、`/private/tmp/b2c-final-todo.txt` 不在证据目录；现存 24 行帧 `01` 无 tab 行、`02` 有 tab 行，无行号/构建指纹可判定二者对应关系。
- **locale 与形态**：预注册 E1/E2 用 en（`1 main  2 todo` / `romeo`），真机帧是 zh 且为附则 A4 的带标记形态（`[1 主面板]  2 待办`）；没有 en 真机帧或单测日志，不能把 zh 帧当作 en 断言的机器判定。
- **跨切片矛盾（A7 相关）**：本切片帧 `30` 显示 dock 隐藏后 composer 重框；但 `.proof/new-session-fix/11b-render-rerun.log:16-22` 与 `11-shell-full.log` 中「dock activity frame appears during a turn and hides after end + linger」单测在最终工作树上 **FAIL**（期望 `┏` 仍可见而实际仍保留带 tab 的活动框，`[1 main]  2 todo`）。该矛盾留给主 agent 真机复验裁决，本报告不改 A7 判定、也不宣称全绿。
- 预注册已列入 NOT RUN：物理鼠标硬件事件（只验 tmux 注入的 SGR 字节路径），未做。
- 权限弹窗打开时紧凑 dock CJK 空白：预注册记为既有问题、非本片范围，未修。

## 5. 主 agent（协调者）真机复验结论（留空占位）

见 .proof/frame-pass-1123/report.md（主 agent 抓帧验收报告）。
