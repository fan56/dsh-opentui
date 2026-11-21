# 025 波3 — CI 真机门禁启用决策（结构性不可行，保留条件 skip）

- 时点：2026-11-21T19:24Z；分支 `feat/025-wave3`；执行仓 `/Users/qingguee/repo/dsh-opentui-wt-024-capir`。
- 一手证据：`.proof/025-w3-2/02-ci-gate/`（`probe.md` / `01-probe.log` / `02-recent-run-jobs.json` / `03-ci-job-prereq.txt` / `04-enable.log` / `05-enable-jobs.log` / `06-restore.log` / `decision.md`）。

## 结论（先说结果）

**不启用 CI 真机门禁，保留 `vars.DSH_REAL_CLIENT_GATE` 默认关（变量未设 = skip）。** 根因是结构性不可行：仓库无任何带 `dsh-profile` 标签的 self-hosted runner，而 `real-client` job 固定 `runs-on: [self-hosted, dsh-profile]`；GitHub-hosted runner 被 `ci.yml` 一手注释判为不能满足 job 的 tmux / 全局 dsh / provisioned profile / provider key 三前提。非配置微调可解，故如实登记并写清启用手册，不硬凑绿。

## 实验（一次，已恢复）

| 时点 | 动作 | 结果 |
|---|---|---|
| 探测 | `gh variable list` / `gh variable get DSH_REAL_CLIENT_GATE` | 变量表空；目标开关 not found |
| 探测 | `gh api .../actions/runners` | `total_count:0`（零 self-hosted runner） |
| 探测 | `gh run view 44938871568`（head `78af4db`） | 三核心 job success；real-client skipped |
| 授权写 | `gh api -X POST .../actions/variables` 置 `DSH_REAL_CLIENT_GATE=true` | 成功（`04-enable.log`，19:18:43Z） |
| 触发 | `gh workflow run ci.yml --ref feat/025-wave3` | run **44940250721** |
| +33s | 查 jobs | real-client **queued**；三核心 in_progress |
| +2m50s | 查 jobs | ubuntu + Pack success；real-client 仍 **queued** |
| +4m | 查 jobs | macos 也 success（三核心全绿）；real-client 仍 **queued** |
| 恢复 | `gh run cancel 44940250721` + `gh api -X DELETE .../variables/DSH_REAL_CLIENT_GATE` | run conclusion=cancelled；变量复核 not found（默认 skip 恢复） |

实验证明：开关写入本身不破坏门禁（三核心 job 全绿）；但 `real-client` 仅会 queued 等一个不存在的 runner，永不执行、永不转绿。

## 启用手册（条件达成后再开）

1. 在仓库注册至少一台带 `dsh-profile` 标签的 self-hosted runner（当前 blocker = 0 台）。
2. 该 runner 须具备：全局 `dsh`（`ci.yml:133`）、provisioned `~/.dsh/profiles/opentui`（`:134`）、`tmux`（`:132`）、provider API key in env（真实 model turn；凭据仅在 runner env，零落盘）。
3. 安全：job 已限制 `workflow_dispatch` / 同仓 PR（`:104`），防 fork PR 借真机凭据外泄；runner 需与不可信 PR 隔离。
4. 开关：`gh api -X POST repos/fan56/dsh-opentui/actions/variables -f name=DSH_REAL_CLIENT_GATE -f value=true` → `gh workflow run ci.yml --ref <branch>` → 核对 real-client 由 queued 转 running/completed。回滚：对应 `-X DELETE .../variables/DSH_REAL_CLIENT_GATE`。
5. 成本：需长期维护带真凭据的 runner（provisioning / 凭据轮换 / fork-PR 隔离）；hosted matrix 无法替代。启用前先本机 `scripts/real-client-gate.sh` 实跑 PASS 作 runner 环境等价基线。
6. 判绿口径：job 真跑后按 harness 实际输出计数（verify70 准确 64 项；脚本 banner「70」是 0.23 陈旧文案），不硬凑绿、不为绿反复重跑。

## 已验证 / 未验证

- 已验证：开关生效→job queued；三核心 job 全绿；取消+恢复原状；无凭据值落盘（仅键名与 run id）。
- NOT RUN（不伪造）：real-client job 内真机 tmux gate 本体（无 runner，从未执行）。本机 `scripts/real-client-gate.sh` 实跑属另一套环境（w3-1/波2 proof 在档），不冒充 CI job 结果（W6 §三.2）。

## 停车与否

不停车。结构性不可行如实登记、开关恢复默认、启用手册写清；不构成产品回归、不阻塞发版。
