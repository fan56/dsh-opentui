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
| **ui** | 视觉/布局数值：tmux 抓屏 + ANSI 断言（行数、列宽、边框字符、SGR、对比度），几何矩阵 80×24 / 120×34 / 120×41 / 120×50 | `bun run test:ui` | `tmux`、`bun`、`dsh`、`~/.dsh/profiles/opentui`、可解析的 `@deepseek-ai/dsh-client-connection` | 每个几何的每条数值断言 `PASS`；退出码 0 | `FAIL <geom> <item> — <数值>`；抓屏留在 `verify/ui-matrix-out/`、`verify/agents-mount-out/`；退出码 1 = 断言失败，2 = 环境缺失 |
| **e2e** | 真客户端 + 真宿主（scratch `DSH_HOME`）+ 完整用户流程；容器套件用**假模型**，live 腿用真模型 | `bun run test:e2e` | `tmux`、`dsh`、profile、`podman`（容器腿）；live 腿另需 provider key | 容器套件打印 `E2E RESULT: PASS`；live 脚本退出码 0 | 退出码 1 + 失败项原始 detail；退出码 2 = 环境缺失；抓屏在 `verify/*-out/` |

环境缺失时 **exit 2 并列出缺项**（`test:ui/e2e: environment missing — NOT RUN (this is not a pass)`）。
不静默 skip、不把 skip 计为通过。

### 1.1 归属规则（`scripts/test-tier.mjs` 实现）

- `*.test.ts` 里文件名带 `-ft`、导入 `@opentui/core/testing`、调用 `testRender(` /
  `createTestRenderer(`、或测试名前缀 `verify:` → **ft**；
- `agents-mount-client.test.ts`（`DSH_AGENTS_E2E`）和 `remote-live-smoke.test.ts`
  （`DSH_REMOTE_SMOKE`）默认 skip，属于 **e2e**，从 unit/ft 剔除（skip 不是 pass）；
- 其余 → **unit**。

当前基线（2026-11，main 之后一个 release 提交）：

| 层 | 文件数 | 用例数 | 备注 |
|---|---:|---:|---|
| unit | 68 | 704 | runtime 1 + shell 24 + tui-base 43 |
| ft | 12 | 50 | 全部在 tui-base |
| ui | 2 个脚本 | 56 条数值断言 + agents-mount 全套 | `verify/ui-matrix.mjs`、`verify/agents-mount-repro.mjs` |
| e2e | 2 个 bun 文件 + 3 个脚本/套件 | 场景见下 | `remote-live-smoke`、`steer-queue-repro`、`queue-flush-repro`、`e2e/` 容器套件 |

ft 的 12 个文件：`composer-delivery-ft`、`composer-history-ft`、`composer-palette-ft`、
`composer-slash-tab-ft`、`entry-slash-deps`、`pane-focus`、`powerline-settle`、
`transcript-codeblock-skin`、`transcript-layout`、`transcript-markdown-table`、
`transcript-scroll`、`widgets-dock-render`。

### 1.2 现有非 bun 资产的归属

| 资产 | 层 | 依赖 | 理由 |
|---|---|---|---|
| `verify/agents-mount-repro.mjs` | **ui** | tmux + 真客户端 + scratch `DSH_HOME`；**无模型 turn** | 面板/键位/双几何（120×34、80×24）抓屏与行数断言 → 视觉布局 |
| `verify/ui-matrix.mjs` | **ui** | 同上 | 纯数值：行数、列宽、边框、SGR、对比度，四几何矩阵 |
| `verify/steer-queue-repro.mjs` | **e2e** | tmux + 真宿主 + **真实模型 turn** | 断言 busy Enter 选择、Queue/Steer 回执、abort 后队列保留 —— 完整用户流程 |
| `verify/queue-flush-repro.mjs` | **e2e** | 同上 | `/flush` 在真实 turn 生命周期中的投递顺序 |
| `verify/run-parity.mjs` | e2e（未接线） | tmux + 真模型 + 对拍 profile | 目标是对拍 `dsh-tui-pi` 的 `tui` profile；当前机器无该 profile，且默认 profile 名已过时。**默认不跑**，见 §4 缺口 |
| `e2e/run-e2e.sh` + `scenarios/*` | **e2e** | podman + 容器内 tmux + **mock LLM** | 真客户端 + scratch `DSH_HOME` + 假模型的完整流程（启动、命令面、主题、resume、steer…） |
| `packages/shell/test/agents-mount-client.test.ts` | e2e 别名 | 转调 `agents-mount-repro.mjs` | 供 CI self-hosted job 使用的 bun 包装；unit/ft 不重复跑 |
| `packages/shell/test/remote-live-smoke.test.ts` | **e2e** | 真宿主 + 真模型（wave 1–3） | 真 host 生命周期、会话、模型目录、附件、重启 |

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
4. **e2e 的 live 腿依赖真实模型**：输出受模型/网络影响，断言以回执行文本为主，存在 flake 风险；
   容器腿（mock 模型）是稳定基线。
5. **Windows 不支持 ui/e2e**：tmux 依赖使其只能在 macOS/Linux 跑；unit/ft 跨平台。
6. **对比度只测默认主题**：`ui-matrix` 用主题默认 fg/bg 计算 WCAG 比值，主题切换后的对比度
   未矩阵化。

---

## 5. 退出码约定

| 码 | 含义 |
|---|---|
| 0 | 该层全部通过 |
| 1 | 有断言失败（测试/脚本自身红） |
| 2 | 环境缺失（缺 tmux/dsh/profile/podman/key），或 e2e 有腿被显式禁用（`*_LIVE=0`/`*_PODMAN=0`）导致结果不完整；**不是通过** |

`bun run test:all` 依次跑 unit → ft → ui → e2e，任一层红即整体红。
`DSH_E2E_LIVE=0` / `DSH_E2E_PODMAN=0` 会显式打印 `SKIPPED ... NOT RUN, not counted as passed`，
只用于本地缩短回路，不能作为合入证据。
