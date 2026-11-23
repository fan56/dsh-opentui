# E2E families — 显式环境豁免（2026-11-23 UI 批次）

依据 `docs/workflows/w6-release.md` §一.3（NOT RUN/环境不可达项走显式豁免：裁决人+日期+理由，不静默删除、不自判放行）与 README 测试架构总表「环境不可达项走显式豁免」。

## 裁决人

用户（2026-11-23，发版指令「那你发版本吧」之后由协调者按基线对照事实呈报；本文件为事实记录，豁免是否被接受以用户知悉为准）。

## 事实

本批 `feat/ui-batch-1123` @ `8127420` 跑 `bash e2e/families/run-all.sh --skip-container` 三次，head 三次一致（`HEAD_STABLE=YES`），三次 `E2E UNIFIED: FAIL`、`FAILED_FAMILIES=3`，失败 family 三次完全相同。

对照基线 `origin/main` @ `a3bab25`（v0.26.4，发版前最新 main）：干净 clone、同命令跑 1 次。两版 e2e 脚本（`20-model-domain.sh` / `30-account-credentials-domain.sh` / `run-all.sh`）diff 为空。

| Family | 失败项 | 本批 8127420 | 基线 a3bab25 | 证据差异 | 归因 |
|---|---|---|---|---|---|
| model-domain | `E3 initializeDefaultModel ok=true`、`E4 NOT_WIRED text present`（PASS=10/12） | FAIL | FAIL（同两项） | 仅 `session/list items` 会话数波动（48 vs 42）；错误文案 `provider "deepseek-account" has no available models` 逐字一致 | 预存/环境 |
| account-credentials-domain | `E5 NOT_WIRED text present`（PASS=13/14） | FAIL | FAIL（同一项） | `cap-s2.log` 完全一致；`credentialsControllerPresent:false`、describe/set/DATAFLOW 全 NOT_WIRED 相同 | 预存/环境 |
| verify-gate | `env precheck: N orphan process(es)` | FAIL（2 个） | FAIL（4 个） | 数量不同、性质相同（均为 `dsh --profile opentui --no-open`） | 环境 |

基线另有 3 个 family（pack / exit-code / keymap-modality）FAIL，是基线 clone 未跑 `scripts/build-client.mjs`、缺 `packages/shell/dist/locales` 的构建前置缺失，与上表三项无关，不构成对照结论。

## 根因（环境前提，非产品缺陷）

1. **model-domain E3/E4**：e2e scratch 环境没有 `deepseek-account` 的 provider 配置。日志显示 `modelCatalog` 默认 provider 是 `xiaomi-token-plan-cn`，而 `initializeDefaultModel` 硬查 `deepseek-account` 且无可用模型。E4 的 NOT_WIRED 文本断言：未 wired 的 id 走 `session/create` 返回 `BAD_PARAMS: ... request required` 而非 `NOT_WIRED`（参数校验先于 service 可用性检查）。
2. **account-credentials E5**：同上的 NOT_WIRED 文本问题，叠加环境 profile 未挂载 credentials service。
3. **verify-gate**：env precheck 要求运行前无 orphan dsh host；本机同时存在用户正在跑的 dsh 实例与本轮 e2e 启动后未回收的 host。precheck 明示 `PROTECTED_PID unset; pattern exclusion active`，仅排除 dsh-jev-mcp。

## 为什么不是本批回归

- 本批 30+ commits 的改动面是 settings 通道（B1）、bridge subagent progress（B3）、ask/permission/dock/transcript/UI，无 credentials 或 model 域改动。
- `packages/bridge/src/cap-generic.ts`（NOT_WIRED 产生逻辑）本批未改；`packages/bridge/src/index.ts` 的改动 hunk 集中在 settings arm / progress / ask deadline，未触及 modelCatalog / initializeDefaultModel / credentials dispatch。
- E4/E5 在无 B1 改动的 `a3bab25` 上同样失败且日志逐字一致。

## 证据

`.proof/release-premise/`（`*.log` 按 `.gitignore:4` 不入库）：

- `e2e-3x-summary.log`、`e2e-run-{1,2,3}/`（本批三次）
- 基线工作树 `/private/tmp/e2e-baseline`（本机临时目录，不入库；`.proof/baseline-run-1/`）

## 未达成的字面前提（如实记录）

W6 §一.1 要求「E2E 连续 3 绿」。本批在该机器上**未达成**这一字面前提，达成的是「失败集合与发版前基线逐项等价、且已归因为环境前提」。要让这三项变绿需要：为 e2e scratch 提供 `deepseek-account` provider 配置与 credentials service 挂载，并在无其他 dsh 实例的机器上跑 verify-gate（或用 `PROTECTED_PID` 豁免用户实例）。这三件都不属于本批交付范围。
