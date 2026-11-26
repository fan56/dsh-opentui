# 测试分层（Testing Taxonomy）

本文定义四层测试：**unit / ft / ui / e2e**，每层的命令、前置条件、通过标准、失败长什么样，
以及哪些改动必须过哪层。它与 [verification-gates.md](./verification-gates.md) 互补：后者讲
"真机证据为什么不可替代"，本文讲"哪类证据用哪条命令固化下来"。

一条命令看完当前分层：`bun run test:list`（脚本生成，永远是代码的真实归属）。

---

## 1. 四层定义

| 层 | 测什么 | 命令 | 前置 | 通过标准 | 失败长什么样 |
|---|---|---|---|---|---|
| **unit** | 纯函数 / 状态机 / 手造 ctx 的行为 | `bun run test:unit` | 只需 `bun` + 依赖装好 | `0 fail`，**且 0 skip**（env-gated 用例已从本层剔除） | `(fail) <describe> > <test>` + 断言 diff + `N pass / M fail` |
| **ft** | 真实渲染器（`testRender` / `@opentui/core/testing`）或真实装配（entry→host 的 `verify:` 契约、composer/keymap/面板），不需要网络 | `bun run test:ft` | 只需 `bun` | 同上，0 fail | 同上；帧断言失败会带 `received` 帧内容 |
| **ui** | 视觉/布局数值：tmux 抓屏 + ANSI 断言（行数、列宽、边框字符、SGR、对比度），几何矩阵 80×24 / 120×34 / 45×30 / 100×45 / 120×52 | `bun run test:ui` | `tmux`、`bun`、`dsh`、可解析的 `@deepseek-ai/dsh-client-connection`；scratch HOME 由真 inproc provisioner 生成 | 每个几何的每条数值断言 `PASS`；退出码 0 | `FAIL <geom> <item> — <数值>`；抓屏留在 `verify/ui-matrix-out/`、`verify/agents-mount-out/`；退出码 1 = 断言失败，2 = 环境缺失 |
| **e2e** | 真客户端 + 真宿主（scratch `DSH_HOME`）+ 完整用户流程；离线腿用**本地假/mock 模型**，live 腿用真模型 | `bun run test:e2e` | `tmux`、`dsh`、profile；live 腿是显式 opt-in：`DSH_E2E_LIVE=1` + 真实 credentials；`/agents` bun 门是 `DSH_AGENTS_E2E=1` | 离线腿（flows 17 场景 + steer-queue）全 `PASS`；**默认未启用 live 时**，未跑的 live/opt-in/退役腿逐条打印 `NOT RUN`，汇总为 `INCOMPLETE` 而非 `PASS`；显式 `DSH_E2E_LIVE=1` 时 live 腿必须实跑 | 退出码 1 + 失败项原始 detail；退出码 2 = 环境缺失；显式 `DSH_E2E_LIVE=1` 后 live 腿 exit 2、显式 `DSH_AGENTS_E2E=1` 后 agents 门 exit 2 都令 tier 非零（不再绿色 `INCOMPLETE`）；recorded FAIL / crash 优先于 env 原因（先判 exit 1 再判 exit 2）；抓屏在 `verify/*-out/` |

环境缺失时 **exit 2 并列出缺项**（`test:ui/e2e: environment missing — NOT RUN (this is not a pass)`）。
不静默 skip、不把 skip 计为通过。

### 1.1 归属规则（`scripts/test-tier.mjs` 实现）

- `*.test.ts` 里文件名带 `-ft`、导入 `@opentui/core/testing`、调用 `testRender(` /
  `createTestRenderer(`、或测试名前缀 `verify:` → **ft**；
- `agents-mount-client.test.ts`（`DSH_AGENTS_E2E`）默认 skip，属于 **e2e**，从 unit/ft
  剔除（skip 不是 pass）；`runE2e()` 现在显式接线该 bun 包装：flag 未设置时打印
  `NOT RUN`，设置时实跑并计结果，不再只是矩阵里的一行；显式 `DSH_AGENTS_E2E=1`
  时该门 exit 2 也令 tier 非零，不会静默绿；
- `failed` 合成保留**第一个非零**（产品 FAIL = 1 优先），后续腿的 exit 2（环境 /
  `NOT RUN`）不覆盖；所有腿仍全部实跑（`keepFirst(current, run(...))`，不用会短路
  而跳过后续腿的 `|| failed` 写法）；
- 汇总/证据字段（如 `r6-029-driver.ts` 的 `protocolNote`）必须从**实际检查结果**
  动态派生（通过数 / 总数、失败项标签），不得静态写 "proven"；尚未跑到时写
  `NOT RUN`；
- 旧的 `remote-live-smoke.test.ts` 引用已删除（该文件从未存在，是假绿/假红来源）。
  真 live harness 是 **`verify/remote-live-smoke.mjs`** 脚本腿，由 `DSH_E2E_LIVE=1` 接线；
- 其余 → **unit**。

当前基线（2026-11-14 实测，`bun run test:list` + 分层跑批；含 shell 渲染测试试点）：

| 层 | 文件数 | 用例数 | 备注 |
|---|---:|---:|---|
| unit | 77 | 1299 | panel-kit 4（46）+ runtime 1（5）+ shell 27（510）+ tui-base 45（738） |
| ft | 32 | 268 | panel-kit 10（117）+ shell 6（30，shell 渲染测试试点）+ tui-base 16（121） |
| ui | 2 个脚本 | 166 条数值断言（5 个几何：80×24 / 120×34 / 45×30 / 100×45 / 120×52）+ agents-mount 全套 | `verify/ui-matrix.mjs`、`verify/agents-mount-repro.mjs` |
| e2e | 4 个脚本 + 1 个 bun 包装 | 本地 flows **17** 场景 + steer-queue（离线）/ queue-flush + remote-live-smoke（live）；旧 podman 容器套件 025-w3-2 下线 | `verify/e2e-flows/run-flows.mjs`、`verify/steer-queue-repro.mjs`（离线，默认）；`verify/remote-live-smoke.mjs`、`verify/queue-flush-repro.mjs`（live，`DSH_E2E_LIVE=1`）；`packages/shell/test/agents-mount-client.test.ts`（`DSH_AGENTS_E2E=1`） |

ft 的 32 个文件分三处：tui-base 16 个（`composer-delivery-ft`、`composer-history-ft`、
`composer-palette-ft`、`composer-slash-tab-ft`、`entry-slash-deps`、`pane-focus`、
`powerline-settle`、`transcript-codeblock-skin`、`transcript-layout`、
`transcript-markdown-table`、`transcript-scroll`、`widgets-dock-render`，以及
panel-kit 迁移带来的 4 个 panelkit 装配测试）；panel-kit 10 个；shell 6 个
（shell 渲染测试试点，见下）。

**shell 渲染测试试点**（`packages/shell/test/`，2026-11-14）：以真实渲染器 +
固定事件序列的 fixture（`shell-render-fixture.tsx`）为底座，分层为金丝雀
（`solid-reactivity-canary-ft`，防 false-green 的防线——fixture 失效时必红）、冒烟
（`shell-render-smoke-ft`）、渲染回归 9 case（`shell-render-regression-ft`：宽度、
resize、空转录、dock 隐藏、错误态）、按键路由 6 case（`key-routing-ft`）、事故映射
4 case（`shell-render-incident-motion-ft` / `shell-render-incident-rows-ft`）。
断言规范：帧断言一律 `captureCharFrame()` 取真实帧后 `toContain`/正则匹配，不做源码
推断；涉及动画/渐隐的用例用时间预算等待（在预算窗口内采样中间帧），不用裸 sleep；
事故映射里"首次转录读失败"一例按 SHOULD 行为编写，默认 skip，`DSH_TEST_READ_SIGNAL=1`
时打开并对现状翻红（红即产品缺陷报告）。

### 1.2 现有非 bun 资产的归属

| 资产 | 层 | 依赖 | 理由 |
|---|---|---|---|
| `verify/agents-mount-repro.mjs` | **ui** | tmux + 真客户端 + scratch `DSH_HOME`；**无模型 turn** | 面板/键位/双几何（120×34、80×24）抓屏与行数断言 → 视觉布局 |
| `verify/ui-matrix.mjs` | **ui** | 同上 | 纯数值：行数、列宽、边框、SGR、对比度，五几何矩阵 |
| `verify/e2e-flows/run-flows.mjs` | **e2e（离线，默认跑）** | tmux + 真客户端 + 真宿主 + scratch `DSH_HOME` + **本地假模型**（无 key、无网络） | **17 个场景**（13 基线 + 4 个 0.29 新增）：`new-empty`、`single-turn`、`tool-turn`、`steer`、`queue`、`flush`、`resume`、`host-restart`、`settings`、`mcp`、`r3-hardcap-abort`、`r5-connection-closed`、`r6-child-routing`、`prune-lifecycle`、`scroll-new-messages`、`todo-write-scroll`、`r6-029`；数量以源码 `scenario(...)` 为准（`grep -c '^scenario(' verify/e2e-flows/run-flows.mjs`）；每次运行建独立 tmux socket + 独立 DSH_HOME |
| `verify/steer-queue-repro.mjs` | **e2e（离线，默认跑）** | tmux + 真宿主 + `e2e/lib/mock-llm.mjs`（无 key、无网络） | 断言 busy Enter 选择、Queue/Steer 回执、abort 后队列保留 —— 不再被 `DSH_E2E_LIVE` 挡住 |
| `verify/queue-flush-repro.mjs` | **e2e（live，opt-in）** | 真宿主 + **真实模型 turn**；`DSH_E2E_LIVE=1` 才跑 | `/flush` 在真实 turn 生命周期中的投递顺序 |
| `verify/run-parity.mjs` | e2e（未接线） | tmux + 真模型 + 对拍 profile | 目标是对拍 `dsh-tui-pi` 的 `tui` profile；当前机器无该 profile，且默认 profile 名已过时。**默认不跑**，见 §4 缺口 |
| ~~`e2e/run-e2e.sh` + `scenarios/*`~~ | **RETIRED 025-w3-2** | ~~podman 容器套件~~ | 21 场景下线；仍有效覆盖由 families/verify70/单测/CI pack gate 接管，见 `.proof/025-w3-2/01-legacy-retirement/takeover-table.md` |
| `packages/shell/test/agents-mount-client.test.ts` | **e2e（已接线，`DSH_AGENTS_E2E=1`）** | 转调 `agents-mount-repro.mjs` | 供 CI self-hosted job 使用的 bun 包装；unit/ft 不重复跑；flag 未设置时 runner 打印 `NOT RUN` |
| `verify/remote-live-smoke.mjs` | **e2e（live，opt-in）** | 真宿主 + 真模型 + 真实 credentials（路径引用） | 最小 live harness：scratch home + 空 workspace，最多 2 个真 turn（纯文本 + 只读 `bash echo`），断言回复 / 工具行 / footer / journal；详见 §1.3 |

### 1.3 最小 live harness（`verify/remote-live-smoke.mjs`）

`DSH_E2E_LIVE=1` 时由 `scripts/test-tier.mjs` 驱动；不设置该 flag 时脚本以
退出码 2（`NOT RUN (ENV)`）结束，不会假绿。显式启用后若 live 腿自身以 exit 2
结束（环境/provider 问题），tier 也以 exit 2 收尾，**不再给绿色 `INCOMPLETE`**；
默认未启用时仍保持原行为（exit 0 + `INCOMPLETE`）。设计约束：

- **隔离**：`mkdtemp` 的 scratch `DSH_HOME` + 空 workspace，走真 in-process
  provisioner；真实 `~/.dsh` 从不被写入；
- **凭据**：真实 `.credentials.yaml`（`DSH_HOME_REAL` 或 `~/.dsh`）在 scratch
  home 中以**符号链接按路径引用**。密钥值不进 argv、不进日志（输出经 `scrub()`
  脱敏）、不复制成假 key；无凭据即 `NOT RUN`；
  `verify/queue-flush-repro.mjs`（另一条 live 腿）复用同一凭据引用契约：
  scratch home 里只放符号链接，缺凭据同样退出码 2 = `NOT RUN (ENV)`；
- **最多 2 个真 turn（真实断言口径）**：
  - turn 1 prompt 只含 `LIVE_SMOKE_TEXT_PING_7F3A`，要求把其中的 `PING` 换成
    `PONG` 后原样输出。完整标记 `LIVE_SMOKE_TEXT_PONG_7F3A` 是**派生值，从不写进
    prompt**，且必须在**非用户/非 composer 行**（排除 `❯` 用户行与 `┃` composer
    行）找到——composer 回显 prompt 不构成回复证据；
  - turn 2 prompt 只含 `LIVE_SMOKE_TOOL_PING_7F3A`，要求执行只读命令
    `echo LIVE_SMOKE_TOOL_PING_7F3A | sed 's/PING/PONG/'` 并报告输出。`sed`
    只替换 `PING` 子串，`LIVE` 前缀保持不变，所以期望标记是
    `LIVE_SMOKE_TOOL_PONG_7F3A`，且必须出现在 **`⎿` 工具结果行**（只认 `⎿`，
    不再把 tool / 工具 字样当结果证据），不能只凭 composer prompt 或模型的文字转述；
  - 提交 turn 1 后**先正向等待 busyFrame**（footer `esc stop` / `esc 停止`，短间隔
    100ms 轮询，避免漏掉瞬态 busy 帧），确认 turn 被接受后才等回复；busy 是否被
    观察到也计入 `record` 与失败数；
  - 两轮还断言 footer 消息/工具计数增长、turn 1 后 busy hint（`esc stop`）消失
    （composer placeholder 在流式输出时仍常亮，不能当 settled 证据；该等待结果
    也计入 record 与失败数），以及 scratch `sessions/` 下持久 journal 文件的存在与增长；
- **scratch-only 审批门**：scratch provision 与 runtime 都设
  `DSH_OPENTUI_APPROVAL_GATE=off`，避免只读 `bash` turn 被审批卡阻断；**仅 scratch
  home 生效，真实 `~/.dsh` 从不被触碰**，其他场景不继承该 env。harness 仍从不
  自动批准：真出现 Allow once / permission / 批准之类的审批卡时立即 `NOT RUN`，
  从不发送批准键；
- **ENV 判定收窄**：`DSH_LIVE_SMOKE_WALL_MS`（默认 240s）墙钟超时一律 `NOT RUN`；
  provider 401 / 429 / 5xx / auth / timeout 只在**明确 provider/error 通知**
  （错误字形或 error/provider 标签与错误短语同行）或 **stderr** 上判定，不再扫
  整个 pane 的任意数字/timeout（计数器、seq、文件名和正常文案都可能含它们）；
  stderr 数字带**单词边界**（`\b401\b` / `\b429\b` / `\b5\d{2}\b`），文件名或
  计数器里恰好含这些数字不算 ENV 判定。客户端挂死、环境缺项同样退出码 2 =
  `NOT RUN`，**既不是产品 PASS 也不是产品 FAIL**；
- **最终判定顺序**：先判 recorded FAIL / crashed（exit 1），再判 envReason
  （exit 2 `NOT RUN`）——已记录的产品 FAIL 不被后续 env 原因掩盖；
- 抓屏（已脱敏）和 `summary.json` 落在 `verify/remote-live-out/`，该目录含持有
  真实凭据进程的调试输出，已在 `.gitignore` 中排除。

旧的 `packages/shell/test/remote-live-smoke.test.ts` 是死引用（文件从未存在），
已从 runner、矩阵和本文档中删除；不要恢复它。

---

## 2. 哪些改动必须过哪层

| 改动 | unit | ft | ui | e2e |
|---|:--:|:--:|:--:|:--:|
| 纯函数 / 解析 / 状态机 | 必过 | — | — | — |
| composer / keymap / queue / settings 的行为 | 必过 | **必过** | 建议 | — |
| 面板挂载、层级、焦点回收、slash 命令面 | 必过 | **必过** | **必过** | 建议 |
| 布局常量（composer 高度、palette 行数、powerline/footer 高度） | 必过 | **必过** | **必过**（80×24 + 120×34） | — |
| 主题 / SGR / 对比度 / 边框字符 | — | 必过 | **必过** | — |
| 入口装配（`client-entry.tsx`、`v2-entry.tsx`、`buildSlashDeps`） | 必过 | **必过**（`typecheck:entry` + `verify:`） | **必过** | 建议 |
| 客户端 ↔ 宿主协议、会话生命周期、steer/queue 端到端 | 必过 | — | — | **必过** |

"必过"= 合 main 前本地跑绿并贴证据；CI 只兜 unit + ft（见 §3）。

---

## 3. CI 接线

- `.github/workflows/ci.yml` 的 `test` job：`pnpm install` → 逐包 `bun test`（全量）→
  `bun run typecheck:entry` → `bun test -t '^verify:'` → **新增 `bun run test:ft`**。
  `test:ft` 把 ft 契约显式命名，避免"全量绿但没人知道 ft 覆盖了什么"。
- `test:ui` / `test:e2e` **不在 hosted runner 上跑**：没有 tmux、没有全局 `dsh`/profile、
  没有 provider key。已有的 self-hosted `real-client` job 保持 opt-in
  （仓库变量 `DSH_REAL_CLIENT_GATE=true` + `dsh-profile` 标签 + 同仓 PR/workflow_dispatch）。
- **CI 不跑 ≠ 未通过，CI 不跑也 ≠ 通过**。ui/e2e 的结论只能来自本地（或 self-hosted）实跑；
  hosted CI 的绿色只覆盖 unit + ft + typecheck。跳过的 job 不构成证据。
- 新增脚本不会让 CI 变红：`test:unit/test:ft` 只依赖 node + bun（runner 自带），
  `test:ui/test:e2e` 不在 CI 调用链上。

---

## 4. 已知缺口（覆盖薄的地方）

1. **ui 层只有几何/颜色，没有动效时序**：闪烁、渐变的帧间变化没有数值断言
   （`run-parity.mjs` 曾做时间序列，但未接入；见下）。
2. **`verify/run-parity.mjs` 未接线**：它默认 `dsh --profile dsh-opentui`，而当前 profile 名是
   `opentui`，且对拍目标是另一仓库的 `tui` 面。接入前需要先修 profile 名并确定对拍基线。
3. **ft 覆盖集中 tui-base**：`packages/shell` 没有 renderer 级测试，客户端协议的"真帧"路径
   只由 e2e 覆盖。
4. **e2e 的 live 腿依赖真实模型**：输出受模型/网络影响，断言以回执行文本为主，存在 flake 风险。
   因此 live 腿是显式 opt-in（`DSH_E2E_LIVE=1`），默认 `bun run test:e2e` 不跑；该命令的默认
   基线是本地 flows（17 场景、本地假模型）+ steer-queue-repro（本地 mock LLM，已移出 live 开关）。
   旧 podman 容器套件已于 025-w3-2 下线（ADR-0013），容器槽记 NOT RUN、不计绿；现行 e2e 覆盖
   由 host families（`e2e/families/`）+ verify70 真机配方（实 64 项）+ 单测 / CI pack gate 接管
   （同 §1.2 与 §5）。key 失效（401/429/5xx/timeout）记为 ENV / `NOT RUN` —— 默认不把整层打红，
   但绝不标为 PASS；runner 逐条打印 `SKIP ... NOT RUN: 原因`，默认汇总用 `INCOMPLETE`。
   显式 `DSH_E2E_LIVE=1` 时 live 腿 exit 2、显式 `DSH_AGENTS_E2E=1` 时 agents 门
   exit 2 均令 tier 非零；recorded FAIL / crash 先于 env 原因判定（见 §5）。
5. **Windows 不支持 ui/e2e**：tmux 依赖使其只能在 macOS/Linux 跑；unit/ft 跨平台。
6. **对比度只测默认主题**：`ui-matrix` 用主题默认 fg/bg 计算 WCAG 比值，主题切换后的对比度
   未矩阵化。

---

## 5. 退出码约定

| 码 | 含义 |
|---|---|
| 0 | 该层全部通过 |
| 1 | 有断言失败（测试/脚本自身红） |
| 2 | 环境缺失（缺 tmux/dsh/profile，或 `DSH_E2E_LIVE=1` 时缺 credentials）；**不是通过**。显式 `DSH_E2E_LIVE=1` 后 live 腿 exit 2、显式 `DSH_AGENTS_E2E=1` 后 agents 门 exit 2 都透传为 tier 非零；但 recorded 产品 FAIL / crash 优先，先判 exit 1 |

`bun run test:all` 依次跑 unit → ft → ui → e2e，任一层红即整体红；`failed` 合成
保留第一个非零（产品 FAIL = 1 优先，后续 exit 2 不覆盖），所有腿仍全部实跑。
e2e 的 live 腿默认就不跑（opt-in `DSH_E2E_LIVE=1`），离线腿（flows 17 场景 +
steer-queue）始终跑。凡有未跑的 opt-in / 退役腿，runner 逐条打印 `SKIP ... NOT RUN: 原因`；
**默认未启用 live 时**以 `test:<tier>: INCOMPLETE — N leg(s) NOT RUN ...; NOT a full PASS`
收尾（退出码仍为 0，保持默认确定性跑批不红）；**显式 `DSH_E2E_LIVE=1` 时**，live 腿
exit 2（环境 / provider 问题）计入失败并令 tier 非零，不再以绿色 `INCOMPLETE` 收尾。
**只有全部腿都实跑且通过时才打印 `test:<tier>: PASS`**。
旧 podman 容器套件已在 025-w3-2 下线（容器槽记 NOT RUN，不计绿）；
`DSH_E2E_PODMAN` 环境变量保留为兼容 no-op，不再影响结果。
