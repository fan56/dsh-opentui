# 025 波3 批2 收口汇总（2026-11-21T19:58Z）

## Commit 链（从基点 `78af4db`）

| # | sha | 内容 |
|---|---|---|
| 1 | `9450568` | test(w3-2): 旧 podman e2e/scenarios 层下线（A.5 21 行接管表 STOP=0） |
| 2 | `ec828c7` | docs(w3-2): CI 真机门禁启用决策（结构性不可行，保留条件 skip） |
| 3 | `9da42df` | docs(w3-2): W7 rc 升级演练（scratch rc4→rc5→回滚 PASS，日用宿主未动） |
| 4 | `9eb204b` | feat(w3-2): /plugins 消费 waitForInstall face（有界进度轮询 + cancel） |
| 5 | `971ddd4` | feat(w3-2): 手写 discoverModels face + /model discover 入口（PROJECTED_BY_HAND） |
| 6 | `1210d2d` | fix(w3-2): 进度轮询复用 install confirm（保 4-mint 源码守卫） |
| 7 | `54836a4` | fix(w3-2): discoverModels wire 名走生成表（ledger 8a 守卫） |

## 门禁阶梯

- bun test（逐包）：bridge 301 / i18n 50 / panel-kit 163 / runtime 5 / shell 1266(4 skip, ran 1270) / tui-base 1511 = **3296 pass / 4 skip / 0 fail**（3300 ran；实跑读数，详见文末勘误节）。「基线 3275 + 新测 24 = 3299」是推算口径，非实跑值，不再作为本栏读数。
- `node scripts/check-capcontract.mjs`：**PASS=22 / NOT_RUN=0 / FAIL=0**。
- pack dry-run（packages/shell）：exit=0，entryCount=**35**，含 `dist/bridge/index.js`；prepack shell-cwd 重建 fingerprint `fb3b9b2c…`（0.24 已登记 quirk，根 cwd 权威 `0eaebac4…`）。
- 脱敏（最后一步）：self-test 全 pattern detected PASS；证据 38 文件 hits=0 PASS。
- 冻结面：`git diff -- capir capcontract ledger scripts/build-bridge.mjs` = 0 行。
- CI：`gh workflow run ci.yml --ref feat/025-wave3` → run **44943659748**，conclusion **success**，headSha `54836a42048268e5ab45ea3676ea008a8a87f7d0`（= pushed HEAD）；三必需 job 全 success，`real-client` skipped（变量已恢复未设，非失败）。
- push：`78af4db..54836a4 feat/025-wave3 -> origin/feat/025-wave3`。

## 逐项结果

1. 旧容器场景下线：21 场景全登记；STOP 行 0；35 文件删除（6293 行）；两调用点改线（container 槽 NOT RUN ≠ PASS）；ADR-0013 + .proof 三表。
2. CI 真机门禁：结构性不可行（零 self-hosted runner + hosted 无 tmux/dsh/profile/key）；实验性开启一次（run 44940250721，real-client queued，三核心 job 绿）后取消并恢复变量；启用手册落 `research/025-w3-ci-gate-decision.md`。
3. rc 升级演练：scratch rc.4→探测 latest/next=rc.5→升级 rc.5→回滚 rc.4 全 exit=0；日用宿主/profile mtime 不变；`research/025-w3-rc-upgrade-drill.md`。
4a. waitForInstall UI 消费：`pollInstallFace` 有界轮询接 face，真机 running/terminal .ans（终态行=requestId 证明 face 投影驱动）；终态 bundle 复跑 running 帧抓取时序 flake 如实登记，不重跑凑绿。
4b. discoverModels：手写 face（wire+seam 双白名单）+ SENTINEL 负例在档 + `/model discover` 入口；真机帧证明端到端消费，正向发现路径因无 remote 源 NOT RUN 登记。

## 停车与否

**不停车。** 无 blocker；两处门禁红均已修复并复跑全绿（4-mint 守卫复用 confirm；ledger 8a 走生成表 wire 名）；两项真机 flake/NOT RUN 如实登记，无伪造；CI 三 job 绿、headSha 对上。

## 勘误（0.25 收尾，波3 评审 C-1）

- **计数勘误 3299 → 3296**：原「门禁阶梯」栏的 3299 来自「基线 3275 + 新测 24」的推算口径，被误当成实跑值。一手分包日志 `01-bun-test.log` 求和 = 301+50+163+5+1266(shell，ran 1270 减 4 skip)+1511 = **3296 pass / 4 skip / 0 fail（3300 ran）**，与波3 评审 `025-w3-review-oldfox.md` C-1 本地复跑一致。0 fail 两侧一致，无测试缺失；「基线+新增」推算口径与实跑读数分开记，推算值不再充当实跑读数。
- **保留意见补登记（波3 评审 C-2）**：`client.err.log` 的 `connection lost, retry #N` 在 boot 有界轮询修复后**不再是判别信号**——预算内的 retry 文案是正常探测痕迹（w3-1 两次 gate PASS run 的 `gate/client.err.log`、`gate-envcheck/client.err.log` 均含 retry #1-3，见 `.proof/025-w3-1/`）。w1b/wave2 历史曾把该文案当 host-boot 失败形态信号（`025-w1b` C4 分级、`025-wave2-execution-report.md:120`）；修复后判别只认 verdict / typed error / 帧内容，不认 retry 文案。审计勿按 w1b 镜头把 PASS 证据误读为失败。
