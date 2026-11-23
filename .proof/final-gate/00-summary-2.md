# UI batch 1123 — 最终门禁验证报告（第二轮，13411a7）

- 检出：`/private/tmp/uibatch-verify-wt`（独立检出，HEAD=`13411a784899b36d3dd9be3646a6971120c57eb3`，detached，来源 `feat/ui-batch-1123` 最终提交）
- 时间：2026-11-23 T07:22Z–07:35Z（UTC）
- 本轮证据根目录：`/private/tmp/uibatch-verify-wt/.proof/final-gate/final-2/`（原始输出均为 `.out`/`.txt`）；gate 脚本自带输出在 `.proof/final-gate/real-client-gate-2/`
- 约束遵守：未 push、未改产品代码与测试；未碰用户 `~/.dsh`；临时 SDK 软链用后已删除；仅扫描主工作树 `.proof`（只读）；未 kill 任何进程（运行前后均无本批宿主进程）

## 总览

| 步骤 | 项 | 结论 |
|---|---|---|
| 0 | HEAD + orphan 进程检查 | PASS |
| 1 | real-client-gate | **FAIL**（verify70 63/64，1 条 detached-HEAD 环境归因） |
| 2 | 三包全量（shell / tui-base / bridge） | PASS（0 fail） |
| 3 | 逐条明细（7 文件） | PASS（7/7 exit 0） |
| 4 | typecheck:entry / check-capcontract / gen-ledger 双跑 / pack 计数 | PASS |
| 5 | 干净 clone + frozen-lockfile + 构建 + 全量 | PASS（0 fail） |
| 6 | 脱敏扫描（self-test + 45 目录） | PASS（hits=0） |
| 7 | 宿主进程/软链清理 | PASS |

**本批产品回归：0。** 唯一红灯为步骤 1 的 verify70 单条检查，归因于验证检出处于 detached HEAD（详见 Fail 归因），非本批提交引入。

---

## 步骤 0 — HEAD 记录与前置环境：PASS

- `git rev-parse HEAD` → `13411a784899b36d3dd9be3646a6971120c57eb3`；`git status --porcelain` 初始仅有未跟踪 `?? .proof/final-gate/`
- 运行前 `ps -eo pid,command | grep 'dsh --profile'` → **NO_DSH_PROCESSES**；tmux 仅存在既有的 `dshopentui`、`iso`（均非本批，不匹配 gate 的 `^(rc-gate-|agents-mount-)` 模式）
- 文件：`00-head-2.out`

## 步骤 1 — real-client-gate：FAIL（1 条，detached HEAD 环境归因）

- 按 `docs/test-framework.md §8.2` 建软链 `node_modules/@deepseek-ai/dsh-client-connection` → 全局 dsh 包；`git check-ignore -v` → `.gitignore:1:node_modules/`（确认被忽略）；用后已删除
- 命令：`bash scripts/real-client-gate.sh --out .proof/final-gate/real-client-gate-2`
- **env precheck：PASS** — `PASS  env precheck: no orphan dsh/mock-llm/named-tmux`。无 orphan，故无需 PID/cwd 归因；仅模式排除项 `dsh-jev-mcp` PID=1118/85245/99956（EXCLUDED，untouched）
- frames：`TOTAL 10/10 PASS`（basic / quit modal / agents paging / model picker / account section 各含非空+真实数据+无凭证泄漏）
- **verify70：FAIL** — `FAIL  verify70: exit 1`；`agents-mount: 63/64 checks passed`
- **summary.json 实数**：`results` 总数 **64**，PASS **63**，FAIL **1**（字段 `ok`，非 `status`）
- **verdict 行**：`=== verdict: FAIL=1 ===`；**`REAL_CLIENT_GATE_PASS` 未出现**（grep：NOT_FOUND）；gate exit=1
- 文件：`02-real-client-gate.out`、`real-client-gate-2/gate-run.log`、`real-client-gate-2/verify70.log`（副本 `02-verify70.log`）、`02-summary.json`、`02-summary-json-counts.txt`

### FAIL 归因（重要）

- 失败项：`composer context: a git workspace renders the branch segment in the top border`
- 输出：`expected: " · HEAD"`；实际帧 `┏━ /private/tmp/uibatch-verify-wt · 13411a7 ━━━…┓`
- 根因：`verify/agents-mount-repro.mjs:1299` 用 `git -C REPO rev-parse --abbrev-ref HEAD` 取期望分支名；本检出为 detached HEAD，该命令返回字面量 `HEAD`，而产品渲染的是短 SHA `13411a7`，二者不可能相等。属于**验证检出 detached-HEAD 环境产物**：在命名分支（如 `feat/ui-batch-1123`）检出下该检查期望值会是真实分支名并与产品渲染一致。
- 不是本批回归：本批仅 `13411a7`（纯测试修复）与 `9fe76f3`（zh-CN 两个 tab 标签改 ASCII）；上一轮 733e859 的本批唯一回归（shell dock-hide）已由 13411a7 修复，本轮三包全量 0 fail 印证。

## 步骤 2 — 三包全量：PASS（0 fail）

| 包 | 结果 | exit |
|---|---|---|
| shell | 1356 pass / 5 skip / **0 fail**（1361 tests / 85 files，38.66s） | 0 |
| tui-base | 1639 pass / 1 skip / **0 fail**（1640 tests / 115 files，41.79s） | 0 |
| bridge | 381 pass / **0 fail**（381 tests / 33 files，5.10s） | 0 |

- 对比上一轮 733e859：shell 由 `1355 pass / 1 fail` 变为 `1356 pass / 0 fail`，dock-hide 回归确认消除。
- 文件：`03-full-shell.out`、`03-full-tui-base.out`、`03-full-bridge.out` 及对应 `.exit`

## 步骤 3 — 逐条明细：PASS（7/7 exit 0）

每文件 `bun test <file>`，默认 reporter，逐条 `(pass)` 可见。任务给的两个路径实际扩展名为 `.test.ts`（非 `.test.tsx`）：`bridge-session-seam.test.ts`、`widgets-dock-render.test.ts`；已按实际文件执行。

| 文件 | exit | (pass) / (fail) |
|---|---|---|
| shell/test/shell-render-regression-ft.test.tsx | 0 | 9 / 0 |
| shell/test/shell-render-incident-motion-ft.test.tsx | 0 | 4 / 0 |
| shell/test/bridge-session-seam.test.ts | 0 | 170 / 0 |
| tui-base/test/widgets-dock-render.test.ts | 0 | 19 / 0 |
| tui-base/test/r7-settled-subagents.test.ts | 0 | 3 / 0 |
| tui-base/test/r8-subagent-brief.test.ts（`ls` 找全，文件名含 r8/subagent-brief 的唯一测试） | 0 | 14 / 0 |
| bridge/test/session-open-replace-guard.test.ts | 0 | 1 / 0 |

- 文件：`04-pert-*.out`（7 个）、`04-pertests-manifest.txt`

## 步骤 4 — 静态检查 / 确定性 / pack：PASS

- `pnpm typecheck:entry` → exit 0（文件 `04-typecheck-entry.out`）
- `node scripts/check-capcontract.mjs` → exit 0（文件 `04-check-capcontract.out`）
- `node scripts/gen-ledger.mjs` 双跑，两次 sha256 一致且与基线字面相同：`ledger/ledger.json` = `5fd0b0d55e987676da99110e53b9799058d94ce0a196a3f9a36ec8dbaafa33f4`；`ledger/ledger.md` = `cc181613d64da21db570186ce86ee9cf108940ae1187ad26bddc40ef47db87b8`；`git status --porcelain ledger/ capir/ capcontract/` → 空（文件 `04-ledger-sha256.txt`、`04-gitstatus.out`）
- pack 计数：`cd packages/shell && npm pack --dry-run` → `npm notice total files: 37`，产物 `aiwayds-dsh-opentui-0.18.3.tgz`（文件 `04-npm-pack.out`）

## 步骤 5 — 干净 clone + frozen-lockfile：PASS（0 fail）

- `git clone --no-local /private/tmp/uibatch-verify-wt /private/tmp/uibatch-cleanclone4` → exit 0，clone HEAD = `13411a784899b36d3dd9be3646a6971120c57eb3`
- `pnpm install --frozen-lockfile` → exit 0，`Lockfile is up to date, resolution step is skipped`，`Packages: +150 ... reused 150, downloaded 0`
- `node scripts/check-capcontract.mjs` → 0；`bun scripts/build-bridge.mjs` → 0；`bun scripts/build-client.mjs` → 0
- 全量：shell 1356 pass / 5 skip / **0 fail**（exit 0）；tui-base 1639 pass / 1 skip / **0 fail**（exit 0）。排除陈旧安装/本地状态因素。
- 文件：`05-clone.out`、`05-install.out`、`05-capcontract.out`、`05-build-bridge.out`、`05-build-client.out`、`05-full-shell.out`、`05-full-tui-base.out`、`05-exitcodes.txt`

## 步骤 6 — 脱敏扫描：PASS（hits=0）

- `node scripts/scan-stdio-secrets.mjs --self-test` → exit 0，`self-test: PASS`，10 pattern / 10 fixture 全部 `detected=true`
- 扫描 **45** 个目录：主工作树 `.proof` 下全部 43 个本批目录（含 `dock-frame-regression`、`r7-r8-subagent-brief`、`batch-gate`、`release-premise` 等）+ 本轮 `final-2/` 与 `real-client-gate-2/`
- 全部 exit 0，`hits=0`，无 `HIT` 行；命中时脚本只报 pattern/路径/offset，本次零命中
- 文件：`06-secret-selftest.out`、`06-secret-scan.out`、`06-secret-scan-exitcodes.txt`

## 步骤 7 — 清理：PASS

- 结束检查 `ps -eo pid,command | grep 'dsh --profile'` → NO_DSH；gate 自身环境 postcheck 亦报 no orphan
- 无本批新增 tmux session（gate 的 `rc-gate-*` 已由脚本清理；仅余既有的 `dshopentui`、`iso`）
- 临时 SDK 软链已删除（§8.2）；`git status --porcelain` 仅 `?? .proof/final-gate/`，产品代码与测试零改动
- 文件：`07-final-process-check.out`、`07-final-gitstatus.out`

---

## Fail 清单（红灯如实记录）

1. **real-client-gate / verify70 — 63/64**：`composer context: a git workspace renders the branch segment in the top border`，expected ` · HEAD` vs actual ` · 13411a7`。归因 detached-HEAD 验证检出（测试用 `--abbrev-ref HEAD` 期望字面 `HEAD`，产品渲染短 SHA），非本批代码回归。gate 因此 verdict `FAIL=1`、exit 1、`REAL_CLIENT_GATE_PASS` 缺失。
2. 其余所有步骤无 FAIL。
