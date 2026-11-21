# 旧容器场景下线 — 删除面清单（2026-11-21T19:35Z）

- `git rm` 35 个 tracked 文件，`git diff --cached --stat -- e2e/` = **35 files changed, 6293 deletions(-)**；无新增。
- 保留：`e2e/lib/mock-llm.mjs`（新层共享假模型，verify/* 与 remote-btw-restart.test.ts 引用）；`e2e/families/*`（在役族）；`e2e/README.md`（改写为退役说明）。

## 删除文件逐条 + 被测面归属

| 分类 | 文件 | 数量 | 归属 |
|---|---|---|---|
| 场景 | `e2e/scenarios/10-install.sh` … `80-onboard.sh`（21 场景） | 21 | takeover-table.md 逐条接管 / plugin-era 腿消亡（ADR-0005） |
| 场景 runner | `e2e/scenarios/run-all.sh` | 1 | 聚合器随场景层下线 |
| 镜像 | `e2e/Containerfile` | 1 | 容器构建层下线 |
| 宿主驱动 | `e2e/run-e2e.sh`、`e2e/run-client-e2e.sh` | 2 | 两个调用点已改线（run-all.sh NOT RUN；test-tier.mjs 去驱动） |
| 共享脚本 | `e2e/lib/common.sh`、`client-face-setup.sh` | 2 | 仅场景层引用（一手 grep：外部零引用） |
| bake 助手 | `e2e/lib/bake-inproc-model-pin.mjs`、`bake-jev-chain.mjs`、`bake-mock-endpoint.mjs`、`bake-subagent-registry.mjs` | 4 | 仅场景层/Containerfile 引用 |
| mock | `e2e/lib/mock-jev.mjs` | 1 | 仅 `65-jev-attention` 场景引用（新层 spin 链由单测接管） |
| fixture | `e2e/fixtures/upgrade-registry/{README.md,serve.mjs,build-fixture.mjs}` | 3 | 仅 `11-upgrade` 场景引用（升级语义由 upgrade-* 单测 + CI pack gate 接管） |
| **合计** | | **35** | |

## 修改文件（非删除）

- `e2e/families/run-all.sh` — 容器族槽改 NOT RUN（≠ PASS，不计绿），`--skip-container` 保留 no-op。
- `e2e/families/FLAKY-LAWS.md` — 顶部加 025-w3-2 退役状态注；容器条目标历史口径。
- `e2e/README.md` — 改写为在役族说明 + 退役证据索引 + mock-llm 保留说明。
- `e2e/lib/mock-llm.mjs` — 仅头注释订正（Containerfile bake → verify/* 共享），行为零改。
- `scripts/test-tier.mjs` — e2e tier 去容器驱动 + 去 podman 前置 + list 去 `run-e2e.sh`。
- `docs/testing.md`、`docs/test-framework.md` — e2e 层描述去掉容器套件。
- `docs/adr/0013-legacy-container-e2e-retirement.md` — 新增 ADR。

## 冻结面 / 既有断言核对

- `capir/`、`capcontract/`、`ledger/`、`scripts/build-bridge.mjs`：本刀 git diff 空（待收口复核）。
- 既有测试断言：本刀零改（仅删旧场景层自身，且有接管表；在役层断言只加不删改）。

## 台账注记（不手改生成物）

- `ledger.json` / `ledger.md` / `provenance.json` 是 gen-ledger 正门生成物，**不手改**。
- 本刀注记仅落证据链：`.proof/025-w3-2/01-legacy-retirement/{inventory,takeover-table,deletion-list}.md` + `docs/adr/0013-...md` + `e2e/README.md`。
- 若后续需要生成物级台账条目，须走 `scripts/gen-ledger.mjs` 正门，不在本刀手改。
