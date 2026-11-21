# W6 — 发版流程（tag 驱动）

适用：0.24 tag 前提逐项达成后发布。前置：`024-tag-premise-adjudication-oldfox.md:69-91` 全绿、`024-tag-prep-final.md:91-113` 对账。发布形态（0.24 实际）：main `988c6f0`（FF 合并）→ tag `v0.24.0` → Release 流水线 success → npm `@aiwayds/dsh-opentui` latest=0.24.0 → 本机全局升级 → 全新 scratch home 冷启动冒烟 7/7 PASS（`024-morning-acceptance-report.md:53-57`）。

## 一、tag 前提（发版前逐项对账）

来源：交付计划 §五（`dsh-opentui-024-delivery-plan.md:85-88`）、裁决 4 十项表（`024-tag-premise-adjudication-oldfox.md:69-91`）、最终对账（`024-tag-prep-final.md:91-113`）。

1. **E2E 连续 3 绿** — `e2e/families/run-all.sh` 三次全族 PASS，同 head（`024-e2e-rework.md:64-74`）。
2. **ledger @manual=0** — 口径按裁决：`dimensions.wired_manual`（有 CapIR 对应的 1:1 宿主调用清零）；ADR-0010 协议帧登记于 `wired_protocol` 不计入（`024-tag-premise-adjudication-oldfox.md:10-40`）。落地两刀：session.list 迁生成链（`0ca71c8`）+ wired 维度拆分/#8 拆 #8a/#8b（`6ebd1bf`），`wired_manual.count=0`（`024-tag-prep-final.md:15-39`）。
3. **NOT RUN 清单清零或显式豁免** — `024-e2e-requirements.md:74-79` 35/35 [x]，环境豁免 7 组在册。
4. **全片 proof 归档且 JUDGMENT 裁决齐** — 5 条未跟踪 `.proof` 路径已归档（23 结构化文件入库 + 73 `.log` sha 登记，`024-tag-prep-final.md:41-49`）。
5. **attribution 工件在位** — 仓根 NOTICE + 生成文件声明行，CI #6 断言绿（`:101`）。
6. **PR#14 已处置** — 2026-11-20 关闭+收编（`:102`）。
7. **0234 分支已推远端** — 三分支 SHA 对上（`dsh-opentui-024-delivery-plan.md:113`）。
8. **tag 驱动 CI / verify-pack-locales / 已发布静默跳过** — tag 时动作（`release.yml:22-25`；幂等跳过 `release.yml:4-8`）。
9. **干净 worktree + frozen-lockfile**（0.9.6 教训） — `git status --short` 空 + `pnpm install --frozen-lockfile` up to date（`024-tag-prep-final.md:105`）。
10. **路线 b 明确为 0.24 后** — 计划 §五加注记，不改前提集合（`024-tag-premise-adjudication-oldfox.md:60-65`）。

## 二、发版四段流程

1. **FF 合并到 main**：feature 分支快进合并；main CI run 绿（0.24 main run 44853304407，`024-morning-acceptance-report.md:56`）。合并门禁：底座 N1 C1/C2/C3 状态保持 + 每片门禁绿（`024-base-frozen.md:31-33`）。
2. **tag 驱动 release**：推 `v*` tag 触发 `release.yml`（`on: push: tags: ['v*']`，`:22-25`）。发布包是 `packages/shell`（根 manifest private 无 version）；`npm version`/`npm publish` 在 packages/shell 跑；**`npm publish` 而非 `pnpm publish`**（prepack 写 untracked 产物，pnpm git-clean 会拒）；`--provenance` 需 `id-token: write` + packages/shell 的 repository 字段（`release.yml:10-19`）。已发布版本静默跳过，不成红 run（`release.yml:4-8`）。
3. **npm 轮询确认**：`npm view` 是发布落地的**唯一接受证明**（`release.yml:5-7`）；发布后查 `npm view @aiwayds/dsh-opentui dist-tags` 等 latest 更新（0.24 latest=0.24.0，`024-morning-acceptance-report.md:55`）。
4. **安装版冷启动冒烟**：本机全局升级到发布版本；全新 scratch home 冷启动冒烟 7/7 PASS（`024-morning-acceptance-report.md:55`）。Pack/cold-start job 本地复跑口径见 [README 测试架构总表](README.md#测试架构总表跨-workflow-共享判据)。

## 三、预防条款（0.24 真实陷阱，就地归属）

1. **stale 硬编码计数「70」文案**（发版记录口径）：`real-client-gate.sh` 的「70-item / all 70 items」是 0.23 陈旧文案，真实 64；0.24 tag 前已修脚本文案为 64（`scripts/real-client-gate.sh:4,254`；:249 分节注释仍残留「(70 items)」一处，属无害注释尾巴，修文案时顺带清掉，勿据其计项数），报告与需求清单一律用 64（`024-e2e-rework.md:14`、`024-e2e-requirements.md:80`）。预防：发版呈报的 verify 计数取 harness 实际输出，不引脚本文案；标签「70/70」视作失实须更正（`024-s6-review-oldfox.md:63-73`）。
2. **已发布静默跳过 ≠ 失败**：`release.yml` 幂等，已发布版本 clean skip；`workflow_dispatch` 重跑既有 tag 用于补 GitHub Release，不重复 publish（`release.yml:25-30`）。CI real-client job skipped 同理按配置如实记，非失败（`024-tag-prep-final.md:81`）。
3. **知晓项须带**：偶发一次未复现 flake（单测 shell 首跑 1 fail 重跑 0 fail；verify 80x24 几何组 59/64 重跑 64/64）、旧容器场景显式改期下线（依赖链仍指向 scenarios，`024-tag-prep-final.md:52-58`）、路线 b + I 类 reconcileSubagentIndex 为 0.24 后事项（`024-morning-acceptance-report.md:58`）——发版呈报带上，不隐藏也不当作阻塞。
