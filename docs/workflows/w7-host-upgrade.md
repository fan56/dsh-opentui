# W7 — 宿主 rc 升级应对

适用：宿主二进制版本升级（0.24 实际 rc.4 → rc.5）。前置：新 rc 可解析、CapIR 真源按旧 rc 锚定。出处：`dsh-opentui-024-delivery-plan.md:89`（extractor 重跑+ledger diff+proof 重跑；HOST_PEER_RANGE 与 CapIR 同 PR）、`024-host-rc5-upgrade-precheck.md`、`024-host-rc5-upgrade-executed.md`、`024-base-core-review-oldfox.md:54-57`（CapIR rc.5 vs 被测 rc.4 的口径）、`024-base-frozen.md`。

## 一、升级三步（extractor 重跑 → ledger diff → proof 重跑）

1. **extractor 重跑**：按新 rc 宿主源码重跑 extractor 生成 `capir/extractor-input.json` → `gen-capir.mjs` 重生成 `capir/capir.json`；attribution 首行、257 计数口径、id 体系（`id = package + "#" + dts_key`）不变（`024-base-task1-review-oldfox.md:35-41`）。provenance `source_version` 须随新 rc 更新——旧实现把 `source_branch`/`source_version` 硬编码在 gen-capir 而非 extractor 输入内，升级重跑会「静默撒谎」，须解决（`024-base-task1-review-oldfox.md:58,74`）。HOST_PEER_RANGE 与 CapIR 同 PR（`dsh-opentui-024-delivery-plan.md:89`）。
2. **ledger diff**：重跑 `gen-ledger.mjs`（正门，禁手改生成物），对账 diff：全集计数、expected 面、method_exclusions。0.24 先例：rc.5 新增 `permissionPresets/set`（`@Remote`），移除该条 exclusion；rc.4 被测二进制无此方法，属 CapIR(rc.5) vs 被测二进制(rc.4) 的**环境修正记法**，非宿主漂移判定（`024-base-core-review-oldfox.md:56`）。
3. **proof 重跑**：底座与所有受 rc 影响的切片 proof 重跑（握手 75/75、计数对账、真机 smoke）。这是底座解冻条款的一部分——CapIR 真源随 rc 换版，须显式决策（见 [W8](w8-base-unfreeze.md)，`024-base-frozen.md:3,22-29`）。

## 二、升级前 preflight / 升级后验证（rc.5 实例）

- **preflight**（`024-host-rc5-upgrade-precheck.md`）：查 `npm view @deepseek-ai/dsh dist-tags`（latest/next 指向目标 rc，`:41`）；记回滚命令 `npm install -g @deepseek-ai/dsh@<old>`（`:18,212`）。
- **执行**（`024-host-rc5-upgrade-executed.md:59`）：`npm install -g @deepseek-ai/dsh@<new>`（exit=0）；PATH 唯一 dsh；dsh-llm stub 显式版本规避。
- **升级后验证**（`024-host-rc5-upgrade-executed.md:13,49,107`）：断链 symlink 数前后一致（232 个 farm 自动跟随升级，名字集合不变 145=145）；dist-tags 无假 latest；inproc 宿主启动 + typert 注册 75 条 + tui admitted。
- **观察项**：npm `allowScripts` 告警，手册未预见的 postinstall 未运行，核心验证路径通过；koffi/node-pty 等原生产物未覆盖列观察项，不擅自补跑（`024-host-rc5-upgrade-executed.md:131`）。

## 三、预防条款（0.24 真实陷阱，就地归属）

1. **断链 symlink / last-provision-wins（多 worktree 交叉污染）**：真机 home 的 bridge symlink 指向已删 worktree 而断链 → `BRIDGE_TIMEOUT`（`024-s6-legacy-slice.md:60,196`）。机制（行号为 S6 报告记录的**清偿前**历史态，当前 HEAD 已是 copy 修复态）：`provision-inproc-profile.mjs:1086` realpath 固化绝对 symlink → `:1135-47` `--repair` 无条件替换任何错 target（**last provision wins**）；两 worktree 共用 DSH_HOME → profile 路径唯一 → 谁最后 provision 谁拥有链接 → A 的 launcher 加载 B 的 bundle（`024-s6-legacy-slice.md:188-199`）；232 个 `@deepseek-ai/*` 手工软链农场在真机存在，测试/脚本依赖它在「干净 worktree + frozen-lockfile」下必红（同报告 `:60,87`；0.9.6 教训）。
   - **预防（已落地清偿）**：绝对 symlink → **构建期 copy 真实目录**（`provision-inproc-profile.mjs` [3/7]，幂等 sha 匹配跳过）；`--repair` 保留 CLI 兼容但 no-op，冲突 report-only 与 symlink 创建/修复删除；`real-client-gate.sh` readlink 断言退役 → 真实目录 + index.js sha256 匹配断言（`024-s6-legacy-slice.md:311-320`）；交叉污染验证：A/B 两 worktree 不同 commit provision 同一 scratch → 旧代码遇真实目录报 conflict + 指纹失配 FAIL loud，删 worktree 后重建无悬链（`:316-320`）；T5 指纹守卫拒陈旧/漂移（`024-e2e-requirements.md:16`）。
   - 升级纪律：host closure symlink 自动跟随升级但须验断链（`024-host-rc5-upgrade-precheck.md:44`）；新 worktree 无软链 + `pnpm install --frozen-lockfile` 全链是 tag 门禁（`024-s6-legacy-slice.md:334-338`）。
2. **CapIR/被测二进制版本错配**：握手期望面按 profile 期望面，不按全集；版本口径失配会被误判为宿主漂移（首日 D 条勘误：`web-profile-capability-architecture.md:171` 静态解析说「缺 account」被运行时实测 12 条在场推翻，`024-day1-review-oldfox.md:70-82`）。预防：升级后先跑运行时实测对账（diff 非空先修映射数据重推导，不判漂移），根因未查登记勘误、实测优先（`024-day1-review-oldfox.md:40,77`）。
