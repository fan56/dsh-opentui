# 旧 e2e/scenarios 逐条接管对照表（A.5 口径，21 行，2026-11-21T19:24Z）

- 判据：仍有效覆盖必须先被 0.24 统一 E2E 层（families / verify70 / 单测 / CI pack gate）接管，逐条列证据后才删；被测面消亡项单列消亡载体。
- 证据列均为本地 worktree @ `78af4db` 一手路径（family 脚本 / verify 脚本 / test 名 / CI job）；新层为宿主 macOS 真机 + CI，与旧 podman Linux 容器是两套环境（FLAKY-LAWS §6），互不冒充——下表接管的是**通用语义**，容器环境的下线是显式范围收敛，非「同一环境已绿」。
- 裁决列：DELETE-TAKENOVER（语义被新层接管）/ DELETE-RETIRED（被测面随旧插件时代消亡）/ STOP（仍有效且未接管 → 停车）。STOP 行必须为 0 才可执行删除。

| # | 场景 | 仍有效? | 接管证据（新架构，file:line / test 名） | 裁决 |
|---|---|---|---|---|
| 1 | 10-install | 部分（plugin 腿消亡） | `e2e/families/00-pack-gate.sh`（capcontract 完整性 + pack-locales）；`.github/workflows/ci.yml` `pack-cold-start` job（npm pack → fresh prefix 安装 → cold start → bridge handshake，:211-318）；`packages/shell/test/bin-launcher.test.ts`、`provision-plan/script/state.test.ts` | DELETE-RETIRED(plugin legs, ADR-0005) + DELETE-TAKENOVER |
| 2 | 11-upgrade | 是 | `packages/shell/test/bin-upgrade-args.test.ts`（flag/usage）；`upgrade-plan.test.ts`、`upgrade-apply.test.ts`（`--save-exact compatibility`、override、rollback、lock）、`upgrade-run.test.ts`；`ci.yml` pack-cold-start 真实 npm/pnpm 安装链 | DELETE-TAKENOVER |
| 3 | 20-start | 是 | `verify/agents-mount-repro.mjs` record('composer context: the composer top border embeds the working directory'…)（575+）；`powerline.test.ts`、`composer-footer-hint.test.ts`；`e2e/families/40-exit-code.sh`（composer reached）；`80-keymap-modality.sh` 真机 .ans | DELETE-TAKENOVER |
| 4 | 22-search | 是 | `packages/tui-base/test/search-overlay.test.ts`、`sessions-search-resume.test.ts`；`commands.ts` `session.search` 键位（22-search 场景自身 head 一手） | DELETE-TAKENOVER |
| 5 | 30-commands | 是 | `verify/agents-mount-repro.mjs` palette items（1153 'slash palette renders more than 6 rows'、1100 '/thi + Tab completes'、1123 skill row）；`commands.test.ts`、`slash-palette.test.ts`、`slash-complete.test.ts`、`slash-usage.test.ts`、`model-picker.test.ts` | DELETE-TAKENOVER |
| 6 | 40-mock-llm | 是 | `verify/e2e-flows/run-flows.mjs`（默认 e2e，本地假模型完整流）；`verify/agents-mount-repro.mjs`（mock LLM server 常驻）；`e2e/lib/mock-llm.mjs` **保留**为新层共享资产（verify/* + remote-btw-restart.test.ts 引用）；turn 系列单测 | DELETE-TAKENOVER |
| 7 | 50-resize-exit | 是 | `verify/agents-mount-repro.mjs` 80x24 组（1181-1251，5 项）；`e2e/families/40-exit-code.sh`（quit-confirm → exit 0）；`terminal-size.test.ts`；`bin-launcher.test.ts`（SIGTERM→143 信号映射族） | DELETE-TAKENOVER |
| 8 | 60-ask-user | 是 | `ask-answerers.test.ts`、`ask-dispatch.test.ts`、`ask-frames.test.ts`、`ask-journal.test.ts`、`ask-registry.test.ts`、`ask-transcript.test.ts`、`bridge-questions-panel.test.ts`、`bridge-session-ask.test.ts`、`turn-overlays.test.ts` | DELETE-TAKENOVER |
| 9 | 61-btw | 是 | `btw-overlay.test.ts`、`btw-overlay-render.test.ts`、`bridge-side-session.test.ts`、`remote-btw-restart.test.ts`（直接 import mock-llm.btwAnswer）；`verify/e2e-flows/run-flows.mjs`；W2-1 已真机 .ans 在档 | DELETE-TAKENOVER |
| 10 | 62-hard-stop | 是 | `subagent-policy.test.ts`、`subagent-policy-hooks.test.ts`、`subagent-policy-spin.test.ts`（ladder round bound + wrap-up + force-stop 机器判定） | DELETE-TAKENOVER |
| 11 | 63-cache-hit | 是 | `footer-refresh.test.ts`、`footer-quickwins.test.ts`、`token-estimate.test.ts`（CH 率计算与 reactive 刷新） | DELETE-TAKENOVER |
| 12 | 64-session-stats | 是 | `session-info.test.ts`（panel 行 + decode 窗定价）；`token-estimate.test.ts` | DELETE-TAKENOVER |
| 13 | 65-jev-attention | 是 | `spin-attention.test.ts`、`subagent-policy-spin.test.ts`（spin verdict → early stop 链）；G2/G3 历史 warn 面随旧层下线，语义由单测接管 | DELETE-TAKENOVER |
| 14 | 66-preset | 是 | `preset-migration.test.ts`、`commands.test.ts`（/preset 注册 + 确认 dialog 路径） | DELETE-TAKENOVER |
| 15 | 67-theme | 是 | `theme-seam.test.ts`、`theme-contrast.test.ts`、`theme-roles.test.ts`、`theme-v1-migrate.test.ts`、`skin-migration.test.ts`、`skin-semantic.test.ts` | DELETE-TAKENOVER |
| 16 | 68-resume | 是 | `resume-picker.test.ts`、`sessions-search-resume.test.ts`、`session-list.test.ts`（UPDATED/DIR 列 + 显示下限 + 空态） | DELETE-TAKENOVER |
| 17 | 69-login | 是 | `login.test.ts`（六步表单 + Esc 放弃，unit table 已含 collision arm）；`bridge-directory.test.ts`、`capcontract-credentials.test.ts`、`s4b-account-wire-frame.test.ts`（双写脱敏） | DELETE-TAKENOVER |
| 18 | 70-steer | 是 | `remote-subagents.test.ts`、`subagents-stop.test.ts`；`verify/steer-queue-repro.mjs`、`verify/queue-flush-repro.mjs`（live opt-in）；`verify/e2e-flows/run-flows.mjs` | DELETE-TAKENOVER |
| 19 | 71-search | 是 | `h3-plugins-search.test.ts`、`plugins-panel-detail.test.ts`、`plugins-panel-confirm-cancel.test.ts`、`bridge-plugins-manager.test.ts`、`search-overlay.test.ts`（panel + FTS + Esc 两级） | DELETE-TAKENOVER |
| 20 | 72-agents | 是 | `agents-panel.test.ts`；`verify/agents-mount-repro.mjs` `/agents` 14 项 record（591-674，全阶梯）；`agents-mount-client.test.ts`、`agents-mount-entry.test.ts`（CI self-hosted 包装） | DELETE-TAKENOVER |
| 21 | 80-onboard | 部分（plugin 腿消亡） | `ci.yml` `pack-cold-start` job（fresh prefix + cold start + handshake，:286-318）；`e2e/families/00-pack-gate.sh`；`provision-plan/script/state.test.ts`；`e2e/families/40-exit-code.sh` | DELETE-RETIRED(plugin legs, ADR-0005) + DELETE-TAKENOVER |

## 汇总判定

- 行数 = 21（与 inventory 一致）；STOP 行 = **0** → 满足 §0 停车边界，**可执行下线**。
- 仍有效覆盖逐条有新层接管证据（无空证据行）；无「直接删、无主题无证据」。
- 容器 Linux 环境本身的覆盖下线（不复刻新容器内族）属显式范围收敛：旧层 21 场景通用语义已由宿主 families/verify70/单测 + CI pack gate 接管；真机 gate 与容器 E2E 本就是两套环境（FLAKY-LAWS §6），容器层不再单列为族，runner 记为 NOT RUN（≠ PASS）并写明理由。
- 三处历史遗留（30-commands /think、65 G2/G3、部分 gate-dark 依赖）随旧层下线，不掩饰为「修好」；语义已归入新层单测。
