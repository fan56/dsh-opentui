# PREREGISTRATION — S1 /model 切片（write-once，捕获前落盘，never edited after capture）

本文件在任何实现改动与证据捕获之前写入磁盘。它是 S1 报告 `expected` 列的冻结预测值。
状态与 observed 值事后依据 `pass criterion` 判定，写入 `report.md`；禁止回改本文件的 `expected`。

- Preregistered at (UTC): 2026-11-20T15:38Z
- Worktree / branch: `/Users/qingguee/repo/dsh-opentui-wt-024-capir` @ `feat/024-capir`
- Pre-change HEAD (baseline + change ref anchor): `b37b78ab42520fac8168e0c229d0903186585f9e`（底座冻结态，clean）
- Host: `dsh --version` = `0.2.2-rc.5`（证据头记录，真机配方 tmux + `capture-pane -e`，.ans 数值口径，禁 PNG/视觉模型）
- Evidence directory: `.proof/024-s1-model/`
- Profile(s): FEATURE（W 接线运行时）+ DATAFLOW（选择→持久）+ negative-control（NOT_WIRED 降级）
- Acceptance target（用户原话，逐字）: "S1 /model 功能适配（纯 W 首刀）……把 model 三方法接入 hostInvoke 注册表（CAP_HOST_WIRED_IDS + createCapHostInvoke，真实路径复用现有 ctx.get 服务调用）；/model 命令与选择走生成链路；删除 model.currentSelection 手抄 wire 线；未 wired 保持 NOT_WIRED。"

## 元数据（切片票）

- CapIR 方法集 = `modelCatalog` / `selectModel` / `initializeDefaultModel`（class W，id 前缀 `@deepseek-ai/dsh-api-session-controller#session/`）+ `model.currentSelection`（@manual 手抄 wire 线，本片删除）。
- provenance：纯 W（三方法来自 profile-patch 的 session-controller 贡献，CapIR 真源不改）。
- 删除面：`req.method === 'model.currentSelection'` 手抄 wire 分支；该帧改由生成链路（createCapInvoke → binder → dispatcher → hostInvoke）以 `modelCatalog().default` 投影服务，保持 seam 启动读契约不变。
- wired 面预期：`CAP_HOST_WIRED_IDS` 由 1（session/list）→ 4（session/list + 三 model）；ledger `methods[].in_wired` 由 1 → 4（4/257）。
- @manual 计数预期：`wired_surface_manual.methods` 由 12 → 11（删 `model.currentSelection` 条目）；check-capcontract #8 以 11 个 `req.method ===` 名集双向相等为绿。

## 前置（capcontract files/prepack 方案）

- N1 pack 门禁全绿已由底座冻结记录覆盖（`024-base-frozen.md` V4 run 44762359675 pack-cold-start 全链 success；tarball 契约断言通过）。本片按计划 §三「不重复」，仅本地按 ci.yml 原文复跑一遍作回归证据。
- 预判：生成目录 `capcontract/` 为根级 `.ts`，`npm pack --dry-run` 需确认 its files 白名单收录（driver 在 packs dist + .ts 源）。若实测发现确需入 files 白名单，最小落地（仅加 `capcontract` 至 package.json files），并在报告登记；否则记录「无需变更」。

## 预注册 expected（E1–E5，计划 §三模板）

| id | assertion | expected（FROZEN，捕获前填） | pass criterion（checkable） | changed path | level | evidence file | depends on |
|----|-----------|------------------------------|----------------------------|--------------|-------|---------------|------------|
| E1 | /model 打开 → 目录列表（modelCatalog 经生成链路） | 真机 smoke 中 `modelCatalog` 经 shipped `createCapInvoke` 返回 ok=true，`groups` 为数组且长度 ≥1，`default.provider`/`default.model` 为非空字符串；ledger `in_wired` 含 modelCatalog | `[CAP-SMOKE] W modelCatalog ... "ok":true,"hasGroups":true,"groups":n>=1` 且 ledger.json 该 id `in_wired:true`；.ans 中 /model 面板出现 provider/model 行（若真机 catalog 可渲染） | `packages/bridge/src/index.ts` createCapHostInvoke + CAP_HOST_WIRED_IDS | Artifact | `06-model-smoke.log`, `07-model-ans.txt` | — |
| E2 | 选择 → 变更且持久（selectModel） | `selectModel` 经生成链路 ok=true；紧接再读 `modelCatalog().default` 的 provider/model 等于所选 route（会话级投影已记录）；runner close code=0 | smoke stderr shows `[CAP-SMOKE] W selectModel ... "ok":true` 且随后 `W modelCatalog` 的 `default` provider/model == 所选值；无 `session/model-unavailable` 之外的崩溃 | `packages/bridge/src/index.ts` createCapHostInvoke (selectModel arm) | Artifact + DATAFLOW | `06-model-smoke.log` | E1 |
| E3 | 全新环境首启 → 默认模型（initializeDefaultModel） | 干净 scratch HOME 冷启动，`initializeDefaultModel` 经生成链路 ok=true（无 API key 时落账号首个可用模型；有 key 时 no-op resolve void 亦可），随后 `modelCatalog().default` provider/model 非空 | smoke stderr shows `[CAP-SMOKE] W initializeDefaultModel ... "ok":true` 且 `default` 非空；冷启动 close code=0 | `packages/bridge/src/index.ts` createCapHostInvoke (initializeDefaultModel arm) | Artifact | `06-model-smoke.log`, `06b-coldstart.log` | E1 |
| E4 | 缺服务 → 「未接线」降级态不崩（负例） | 未 wired 的 CapIR id（如 `session/create`）经 `createCapInvoke` 抛 `NOT_WIRED: ... has no inproc host adapter`，runner close code=0 不崩；`model.currentSelection` 在无 sessionController 时返回 UNSUPPORTED 而非 crash | stderr shows `NOT_WIRED` 字符串且 `[runner] close code=0`；无进程异常退出 | `packages/bridge/src/index.ts` createCapHostInvoke (fallback arm) | Artifact + reverse | `08-negative.log` | — |
| E5 | 切换后 session.send 走新模型（行为等价回归） | 基线 = 批 1 收编用例（feat/0234-* 分支）；若今晚收编受阻，标 NOT RUN 并登记 E2E 需求清单 | 若收编完成：真机 .ans 显示切换后 turn 用新 route 且无旧 route 回退；若受阻：报告写 NOT RUN + E2E 需求清单登记项，无伪造证据 | `packages/bridge/src/index.ts` session.send / model 接线 | Artifact（条件） | `09-e5-equivalence.log`（条件） | E2 |

非断言证据项：`01-env-snapshot.log`（rc.5 + SHA + date）、`02-gate-full.log`（check-capcontract #1–#10 全绿）、`03-regen.log`（gen-capir --check / gen-capcontract --check / gen-ledger 幂等）、`04-bridge-unittest.log`、`05-build.log`（bun build）、`10-verify70.log`（verify/agents-mount-repro.mjs 70 项）、`11-pack.log`（ci.yml pack 门禁本地复跑）、`report.md`。

## 门禁预期（技术门禁全绿即 PASS）

- check-capcontract 全项：`PASS=13 NOT_RUN=0 FAIL=0`（#8 名集=11，#9/#10 不回归，#10 wired 集=ledger in_wired=4）。
- bridge 单测：全绿（既有断言一字不改，新增 model arm 用例可加，不删旧断言）。
- bun build / bun run build：成功。
- gen-capir --check / gen-capcontract --check 字节一致；gen-ledger 连续两次 sha 相同（幂等）。
- verify 脚本（70 项）：`node verify/agents-mount-repro.mjs` exit 0 + 全 PASS + summary.json ok 全 true。
- pack 门禁：按 ci.yml pack-cold-start 原文本地复跑，全链 success。

## USER-JUDGMENT 预案（≤5 项，三类边界；记录 + 默认，不拦门禁）

技术 PASS 判定不依赖下列项；每项记录 + 推荐默认（只选无风险方案）：

- U1（视觉布局）：/model 目录列表在 80×24 下的分页/分组呈现是否舒适。默认：沿用现有 dialog-model 布局，不改样式（无风险）。
- U2（交互手感）：/model 面板快捷键（f 收藏/h 隐藏/上下移动）是否与其他键冲突的手感。默认：沿用现有键位，不新增快捷键（无风险）。
- U3（文案措辞）：切换成功/失败提示（`command.model.set` / `switchFailed`）的中文措辞。默认：沿用现有 i18n 文案，不新增文案（无风险）。

## PASS 判定式（按任务口径）

E1–E5 全达成（E5 若合法 NOT RUN 且登记 E2E 清单则不拦）∧ 技术门禁全绿 ∧ NOT RUN 无未声明项 ∧ JUDGMENT 全有裁决记录 → PASS。
USER-JUDGMENT 项只记录不拦；默认只选无风险方案（沿用现状）。红就红着报。

## 反作弊与边界

- 不改 CapIR 真源（capir/capir.json）、不改 N1 转义段（scripts/build-bridge.mjs 冻结只读）、不改既有测试断言。
- 未 wired 的 253 个 W id 保持 NOT_WIRED（膨胀期望面负例）。
- 旧证据包（`.proof/024-base-task5*`）一字不改留档。
