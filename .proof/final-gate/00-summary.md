# UI batch 1123 — 最终门禁验证报告（只验证 + 取证）

- 检出：`/private/tmp/uibatch-verify-wt`（独立检出，HEAD=`733e859dbb82008bd3d040ff16f19ed2e371f5eb`，detached，分支来源 `feat/ui-batch-1123` 最终提交）
- 时间：2026-11-23 T06:44Z–06:50Z
- 证据目录：`/private/tmp/uibatch-verify-wt/.proof/final-gate/`（原始输出均为 `.out`/`.txt`；脚本内部自带的 `gate-run.log`/`env-precheck.log` 另存了 `.out` 副本）
- 约束遵守：未 push、未改产品代码、未碰 `/Users/qingguee/repo/dsh-opentui-wt-uibatch-1123` 工作树内容（仅只读扫描其 `.proof`）、未 kill/操作任何进程。

---

## 步骤 0 — HEAD 记录：PASS

- `git rev-parse HEAD` → `733e859dbb82008bd3d040ff16f19ed2e371f5eb`
- 文件：`00-head.out`

## 步骤 1 — 逐条测试明细：FAIL（1 条红）

每文件单独 `bun test <file> 2>&1 | tee ...`，exit code 取 `PIPESTATUS[0]`，逐条 `(pass)` 行保存在对应 `.out`。

- tui-base：19 个文件全部 exit 0。含 composer-copy、subagents-hotkey、permission-picker-hint-ft、settings-panel、settings-panel-panelkit、commands、key-trace、key-trace-v2、approval-card-ft、ask-verdict-labels-ft、bridge-approval-card、widgets-dock、widgets-dock-render、widgets-dock-tabs-r2、merged-dock、r5-panel-focus-borders、pane-focus、r7-settled-subagents、r8-subagent-brief（R8 实际文件名 `r8-subagent-brief.test.ts`）。
- b2c：`find packages -name '*.test.ts' -o -name '*.test.tsx' | grep -iE 'b2c|r8|subagent-brief'` 仅命中 `r8-subagent-brief.test.ts`；**无文件名含 `b2c` 的测试文件**（N/A，非失败）。
- shell：7 个文件中 6 个 exit 0；`shell-shell-render-regression-ft` **exit 1**（8 pass / 1 fail / 45 expect）。
  - 失败项：`shell render regression battery (widths / resize / empty / dock-hide / error) > dock activity frame appears during a turn and hides after end + linger`
  - 失败点：`packages/shell/test/shell-render-regression-ft.test.tsx:203`（断言 202 行 `expect(settled).not.toContain("d5 active task")` 不成立；`hydrate([])` 后帧仍显示 `● Todos (0/1) └─ ● d5 active task`，dock 未按预期隐藏）。
- bridge：全量 381 pass / 0 fail；33 个逐文件明细全部 exit 0。
- 文件：`pertests/*.out`（26 个包级明细 + 33 个 bridge 逐文件明细）、`pertests/manifest.txt`

## 步骤 2 — 三包全量：FAIL（shell 同一条红）

| 包 | 结果 | exit |
|---|---|---|
| tui-base | 1639 pass / 1 skip / 0 fail（1640 tests / 115 files） | 0 |
| bridge | 381 pass / 0 fail（381 tests / 33 files） | 0 |
| shell | 1355 pass / 5 skip / **1 fail**（1361 tests / 85 files） | 1 |

shell 唯一 fail 为步骤 1 的同一条 dock hide 用例（grep `(fail)` 出现 2 次：正文 1 次 + 末尾汇总 1 次，实际唯一失败 1 条）。
文件：`full-tui-base.out`、`full-bridge.out`、`full-shell.out`、`exitcodes.txt`

## 步骤 3 — typecheck:entry：PASS

- `pnpm typecheck:entry` → exit 0
- 文件：`03-typecheck-entry.out`

## 步骤 4 — capcontract：PASS

- `node scripts/check-capcontract.mjs` → exit 0
- 文件：`04-capcontract.out`

## 步骤 5 — 台账确定性：PASS

- `node scripts/gen-ledger.mjs` 两次：
  - run1 `ledger/ledger.json` = `5fd0b0d55e987676da99110e53b9799058d94ce0a196a3f9a36ec8dbaafa33f4`
  - run2 `ledger/ledger.json` = `5fd0b0d55e987676da99110e53b9799058d94ce0a196a3f9a36ec8dbaafa33f4`
  - run1 `ledger/ledger.md` = `cc181613d64da21db570186ce86ee9cf108940ae1187ad26bddc40ef47db87b8`
  - run2 `ledger/ledger.md` = `cc181613d64da21db570186ce86ee9cf108940ae1187ad26bddc40ef47db87b8`
  - 两次均与基线字面一致，确定性与基线比对同时成立。
- `git status --porcelain ledger/ capir/ capcontract/` → 输出为空（工作树干净）。
- 文件：`05-ledger.out`

## 步骤 6 — build-bridge：PASS

- `bun scripts/build-bridge.mjs` → exit 0
- 文件：`06-build-bridge.out`

## 步骤 7 — real-client-gate：FAIL（环境前置，red 原样记录）

- 按 `docs/test-framework.md §8.2` 建软链：`node_modules/@deepseek-ai/dsh-client-connection` → `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-connection`；`git check-ignore -v` → `.gitignore:1:node_modules/`（确认被忽略）。
- **PROTECTED_PID 机制说明（重要，与任务描述有出入）**：脚本 `scripts/real-client-gate.sh:62` 读取单个 PID，第 95 行用 `[ "$p" = "$PROTECTED_PID" ]` 做**单值精确比较，不支持逗号分隔**。任务文本假设逗号分隔，实测不成立，故按脚本实际格式传单个 PID。
- 本次运行中动态 `pgrep -f uibatch-global` 得到主 agent 进程 `1960`（tmux 包装）/ `1963`（node dsh-opentui）/ `3016`（client）/ `3082`（watchdog）。**豁免 PID=1963**（脚本选中的 node dsh-opentui），输出中显示 `PRESENT (whitelist excluded, untouched)`；1906/3016/3082 均未被 kill/操作，且不匹配 orphan 模式。
- gate 仍在 env precheck 红：`FAIL env precheck: 4 orphan process(es)`，实际为 `2406 / 6907 / 20307 / 93105`（均为 `/opt/homebrew/bin/dsh --profile opentui --no-open --port ...`，非 uibatch-global、非主 agent 进程，未 kill、未豁免）。退出码 2。
- **summary.json 未生成**（gate 在 precheck 阶段即停止），故 results 总数/PASS/FAIL 实数不可得——这是 precheck 红灯的直接后果，不是漏跑证据。
- 文件：`07-real-client-gate.out`、`real-client-gate/gate-run.out`、`real-client-gate/env-precheck.log`
- 注：证据里早期手写的 `13627/13906` 为上一次 frame 会话的旧 PID，运行时已换成上面的动态 PID；实际生效豁免以输出中的 `PROTECTED_PID=1963` 为准。

## 步骤 8 — 干净 clone + frozen-lockfile：FAIL（shell 同一条红，其余全绿）

- `git clone --no-local ... /private/tmp/uibatch-cleanclone3` → exit 0，clone HEAD 与源一致。
- `pnpm install --frozen-lockfile` → exit 0，输出 `Lockfile is up to date, resolution step is skipped`（**up to date**）。
- `node scripts/check-capcontract.mjs` → 0；`bun scripts/build-bridge.mjs` → 0；`bun scripts/build-client.mjs` → 0。
- 三包全量：tui-base exit 0（1639 pass / 1 skip / 0 fail）；bridge exit 0（381 pass / 0 fail）；shell exit 1（1355 pass / 5 skip / **1 fail**）。
- shell 失败项与步骤 1/2 逐字相同（`dock activity frame appears during a turn and hides after end + linger`），排除陈旧安装/本地状态因素。
- 文件：`08-clean-clone.out`、`08-exitcodes.txt`

## 步骤 9 — 脱敏扫描：PASS

- `node scripts/scan-stdio-secrets.mjs --self-test` → exit 0，`self-test: PASS`，10 个 pattern / 10 个 fixture 全部 `detected=true`。
- 主工作树 `.proof` 下列出的 21 个目录全部扫描，每个 exit 0，`hits=0`（无 HIT 行）。命中规则若触发，脚本只输出 pattern/文件路径/offset，不打印值；本次零命中。
- 文件：`09-secret-scan.out`、`09-exitcodes.txt`

## 步骤 10 — E2E ×3：FAIL（3 个 family，与豁免集合逐项一致；无新失败 family）

三次均为同一 HEAD `733e859`，同一 `PROTECTED_PID=1963`（运行时豁免主 agent node dsh-opentui 进程），命令原样 `bash e2e/families/run-all.sh --skip-container`，未杀任何进程。

| 运行 | exit | FAILED_FAMILIES | UNIFIED |
|---|---|---|---|
| 1 | 1 | 3 | FAIL |
| 2 | 1 | 3 | FAIL |
| 3 | 1 | 3 | FAIL |

三次失败 family 完全相同：`model-domain`、`account-credentials-domain`、`verify-gate`。逐项：

- `model-domain`：`FAIL E3 initializeDefaultModel ok=true`、`FAIL E4 NOT_WIRED text present`（E4 其余子项 PASS）— 与 `.proof/release-premise/e2e-exemptions.md` 预期一致。
- `account-credentials-domain`：`FAIL E5 NOT_WIRED text present`（E5 其余子项 PASS）— 与预期一致。
- `verify-gate`：`FAIL env precheck: N orphan process(es)`，N=5/6/7（孤儿子集为 `2406/6907/20307/93105/94259/8263/21551`，均为 `/opt/homebrew/bin/dsh --profile opentui --no-open`，非主 agent 进程）— 与预期一致。
- **预期之外的新失败 family：无**。三次均没有第 4 个 family 变红。

文件：`e2e-run-{1,2,3}.out`（unified 输出）、`e2e-run-{1,2,3}/`（每次 family 明细，从脚本自动生成的 `/tmp/e2e-unified-*` 完整复制）、`10-exitcodes.txt`

---

## 所有 FAIL 项与归因

| # | FAIL 项 | 出现步骤 | 归因 | 依据 |
|---|---|---|---|---|
| 1 | `shell-render-regression-ft` > `dock activity frame appears during a turn and hides after end + linger`（唯一失败，8 pass/1 fail） | 1、2、8（工作树 + 干净 clone 稳定复现） | **本批回归** | 同一文件在 `8127420` 的 `.proof/batch-gate/step1-shell.out`（1344 pass/0 fail）与 `.proof/release-premise/cleanclone-test-shell.log`（1348 pass/0 fail）中 PASS；HEAD=`733e859` 中稳定 FAIL，且干净 clone 复现。引入区间锁定在 `8127420..HEAD`；该区间含 R7 `1e4a237`「settled subagents leave the dock immediately」与 R8 `733e859`「subagent brief with per-batch timer」（`widgets-dock.tsx` +499 行）等 dock 改动，为高嫌疑。未做逐 commit 二分，故仅定位到区间，不指认单个 commit。注：更早的 `.proof/b3-agent-progress/07-render-attribution.log` 曾把该用例归类为预存 timing flake，但那是 `8127420` 之前的状态；`5c13379` 曾试图钉死 motion tier 修掉该 flake 并成功（batch-gate 为证），HEAD 上又变红，属于新退化而非原 flake 延续。 |
| 2 | real-client-gate env precheck：`FAIL env precheck: 4 orphan process(es)`，exit 2 | 7 | **预存/环境** | 4 个 PID 全是外部 `/opt/homebrew/bin/dsh --profile opentui --no-open` host，非本检出、非主 agent 进程；主 agent 进程已按脚本实际格式豁免且未被 kill。`e2e-exemptions.md` 已把 verify-gate orphan 记为环境豁免。 |
| 3 | E2E `verify-gate` family：`env precheck: N orphan process(es)`（N=5/6/7） | 10（三次全中） | **预存/环境** | 同 #2；孤儿子集跨运行递增（其他进程持续产生），性质与豁免文档一致。 |
| 4 | E2E `model-domain`：`E3 initializeDefaultModel ok=true`、`E4 NOT_WIRED text present` | 10（三次全中） | **预存/环境** | `e2e-exemptions.md` 预期集合，基线 `a3bab25` 同两项失败，环境缺 `deepseek-account` provider 配置。 |
| 5 | E2E `account-credentials-domain`：`E5 NOT_WIRED text present` | 10（三次全中） | **预存/环境** | `e2e-exemptions.md` 预期集合，基线同项失败，环境未挂载 credentials service。 |

无「无法归因」项。步骤 3/4/5/6/9 全绿；步骤 0 PASS；步骤 1/2/8 的红均归为同一条本批回归（#1）；步骤 7 的红归为 #2；步骤 10 的红全部落在 #3–#5 的预期豁免集合内。

## 收尾说明

- 取证完成后按 `docs/test-framework.md §8.2` 删除了临时 SDK 软链 `node_modules/@deepseek-ai/dsh-client-connection`，恢复 CI stub 等价状态（该软链本被 `.gitignore:1` 覆盖，未污染工作树）。
- 证据文件清单见 `find .proof/final-gate -type f | sort`（本文件所在目录）。
