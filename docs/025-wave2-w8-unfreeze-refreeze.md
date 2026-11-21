# 025 波2 W2-0 — 底座解冻-再冻结证据链

- 日期：2026-11-21
- 流程依据：`docs/workflows/w8-base-unfreeze.md` §二（五步一步不少）、`docs/architecture/08-frozen-surfaces.md` §8.3
- 解冻对象：CapIR 真源（`capir/capir.json` v2→v3）、capcontract 生成层、ledger 生成物、bridge 通用调用臂（dispatch 可执行语义）
- 分支：`feat/025-wave2`，起始基点 `2ca55bd`（0.25 波1 已合并，wired 28/257）
- 架构决策：`docs/adr/0012-wave2-params-table-generic-dispatch.md`（草案）
- 证据包：`.proof/025-w2-0/`（a–d）、`.proof/025-w2-0e/`（e）

## 步骤 1 — 确认必须解冻

CapIR v2 每 method 仅五键、无参数表；通用调用所需的 `service` / 参数序 / JSON Schema 不在静态真源内。方案 §0.1 与 W2-0a 双源干跑（`.proof/025-w2-0/02-dual-source-crosscheck.md`）证明：新增参数是 CapIR 真源维度扩展，不是冻结面外可解决的补面（W1/W2 范式无解），**必须解冻**。

## 步骤 2 — 显式决策

用户三波拍板为解冻决策；评审票 `025-wave2-plan-review-oldfox.md` 与方案 v1.1（AMEND-1..4、C1–C4、S1–S3）为书面裁决；保留条件：anthropic/capir additive-only、deny-list 三族、seam 不透传、既有断言零删除、`@manual=0`、inject 不变。决策落点本记录 + ADR-0012。

## 步骤 3 — 执行变更（全部经正门）

| 切片 | commit | 冻结面动作 | 正门 |
|---|---|---|---|
| W2-0a | `7f249bf` | extractor v2 收编入仓（双源解析、不 regen） | `scripts/extract_capir_artifacts.py` 干跑 |
| W2-0b | `b0a68ac` | CapIR `/2`→`/3`，additive-only 追加字段 | `gen-capir.mjs` 整文件重写 + `--check` |
| W2-0c | `de0d6b1` | SERVICE/PARAMS/WIRE 生成表 + deny-list + gate #11–#16 | `gen-capcontract.mjs --check` |
| W2-0d | `eb86405` | bridge 表驱动 generic arm（休眠：adapters=0）+ 8 单测 | 源码改动 + 单测 |
| W2-0e | `bd37e9e` | ledger 19 条 `deferred_reason` additive-only（schema 仍 `/1`） | `gen-ledger.mjs` 正门重生成 |

冻结面红线复核：`scripts/build-bridge.mjs` 转义段未改；既有测试断言零删除；wired 计数全程 28；`capir/capcontract/ledger` 三处 git diff 仅生成物正门产物。

## 步骤 4 — 受影响 proof 全部重跑（本批实际范围与裁剪）

**机器门**

- `bun test packages/*`：3154 pass / 4 skip / 0 fail（基线 3146 + W2-0d 8 条新增；`.proof/025-w2-0e/01-bun-test-baseline.log`、`:07-bun-test-postledger.log`）。
- `node scripts/check-capcontract.mjs`：PASS=20 / NOT_RUN=0 / FAIL=0（含 capir/capcontract `--check` 字节自洽、deny-list、deny/例外清单、dispatch 可执行 28/257；`:02-check-capcontract-baseline.log`）。
- ledger additive-only 独立审计：14/14 PASS，schema `/1` 不变、257 行 id 序不变、仅 19 行新键、其余 238 行逐字节不变、`ledger.md` 纯末尾追加（`:05-audit-additive.log` + `:04-ledger-*.diff`）。

**握手 + cap-smoke（新 bundle）**

- 能力握手 PENDING→READY：`bun scripts/verify-capability-handshake.ts` 18 PASS / FAIL=0，expected=75/75（`:09-handshake-pending-ready.log`）。
- cap-smoke：`bash e2e/families/10-capability-domains.sh` → bridge-families 8/8（握手/session/隔离/push/model，`:11-cap-smoke.log`）。
- 真机 smoke（非全量 verify70）：`scripts/real-client-gate.sh --only frames` → preflight/provision/handshake framed JSON/composer 7s/6 帧非空（6584–13542 B）/ picker+section 命中，`FAIL=0 REAL_CLIENT_GATE_PASS`（`:12-real-client-gate-frames.log`）。握手往返实测 789 ms（`:13-latency-probe.mjs`）。
- 前置环境自检 SOP：孤儿宿主 / mock-llm / 具名 tmux 均为空，零 kill；PID 98608（dsh-jev-mcp）前后均 not found、未触碰（`:10-env-selfcheck.log`）。

**打包 + 脱敏**

- `npm pack --dry-run`（packages/shell）：35 文件，dist/bridge 三件齐，宿主包目录 0（`:14-pack-dryrun.json`）。prepack 的 cwd 导致 fingerprint 路径注释差异，已一手核为注释级、非停车项（`:14-pack-fingerprint-quirk.md`）。
- 脱敏扫描（证据采集最后一步）：self-test 10/10 pattern detected；证据 52 文件 hits=0（`:15-scan-selftest.log`、`:16-scan-evidence.log`）。

**裁剪论证（AMEND-4 终稿，逐字）**

> W2-0 落地时 CAP_GENERIC_ADAPTERS 为空、wired 计数不变（28）、bridge 可观测行为零变化，故 verify70/E2E 判定域不受本刀影响

据此本批 verify70 全量 **NOT RUN**：判定域未被本刀触碰，且 fingerprint 已变更（见下）；全量收口归 W2-6。真机 flake 家族（host-boot / auto-resume / cookie-mint chmod 时序）沿用已登记口径，未自创家族、未为绿反复重跑；本次真机段一次通过。

**fingerprint 失效声明（AMEND-4 终稿，逐字）**

> generic arm 入 bundle 后 fingerprint 更新，0.24 时代真机证据对新 fingerprint 失效，波2 真机证据自 W2-1 起按新 bundle 重取，W2-6 收尾做一次新 bundle 上的 verify70 收口（或显式 NOT RUN + 理由）

新 bundle fingerprint：`c02e79a97a0e9e5d93613cbe28ad97ca9c5add8f69f19924fbd40bb960723403`（旧 0.24 时代：`76a8333f9f098507d2208aebe4c027044ae331d75555abc91a60beefde0dae28`；`:08-fingerprint-*.json`）。所有 0.24 真机证据对新 fingerprint 失效，本批真机证据按新 bundle 重取。

## 步骤 5 — 重新冻结（新基线）

- **功能冻结点**：`bd37e9e`（W2-0e ledger 正门，W2-0 最后一个触碰冻结面的功能 commit）。
- **记录冻结点**：本记录与 ADR-0012 所在 commit（W2-0 收口 commit；sha 见 `git log`）。
- **生效条件**：分支 CI（`gh workflow run ci.yml --ref feat/025-wave2`）三必需 job 收口且 headSha 与记录冻结点一致；run id 与三 job 结论落 `.proof/025-w2-0e/17-ci-run.json`（证据不入库），并随 W2-0 收口回报。
- 冻结声明：自上述 commit 起，CapIR v3 / capcontract 生成表 / ledger（含 deferred_reason）/ generic arm 休眠态进入新冻结态；后续 W2-1..W2-6 的逐 id 放行按 W1/W2 切片流程走，不再重复底座解冻（除非再动 CapIR 真源或生成链语义）。
