# 功能开发与补全 Workflow 索引（0.24 验证版）

本目录把 dsh-opentui 0.24 全线（底座 → S1–S6 + SK → E2E 统一重构 → tag 发布）验证过的开发/测试流程编纂为一组**自包含、可自由组合**的模块。每个 workflow 单独可读，按场景组合。条款均给出处；出处分两类：

- `报告名.md:行号` — 位于 wayfinder-web-profile 仓 `research/` 目录（0.24 执行/评审报告全文），**不在本产品仓**。
- `路径/file:行号` — 位于本产品仓（基线 `feat/024-capir @ 988c6f0`，0.24.0 发布树）。

## 适用与角色

- **开新功能**（新能力域，CapIR 无现成 id 或需走生成链接线）→ 走 W1。
- **补功能**（已有域扩展：补命令、补 seam face、补面板入口）→ 走 W2。
- 四类角色贯穿全流程：
  - **实现执行**：按 workflow 落代码、采证据、跑门禁。
  - **评审把关**（oldfox）：只读一手复验 + 分档裁决；RED 停车、裁决条款即终稿（W4）。
  - **协调拆活**：切片票、呈报、待拍板项归集；不替评审下判定。
  - **用户验收制**：JUDGMENT 类（视觉布局/交互手感/文案措辞）**只记录不拦**，默认取无风险方案（W5）。
  - 依据：`dsh-opentui-024-delivery-plan.md:58`（每片标准流程）、`:94`（三类边界、每片 ≤5 项）、`024-s1-model-slice.md:99-107`（验收制记录+默认）、`024-morning-acceptance-report.md:3,34-43`（用户授权判定项记录不拦）。

## 模块索引（前置依赖）

| 模块 | 主题 | 前置依赖 | 何时用 |
|---|---|---|---|
| [W1 新能力域切片](w1-capability-slice.md) | 五层接线地图 + 七步标准流程 | 底座已冻结（`024-base-frozen.md:3`） | 新增 CapIR 能力域 / 走生成链接线 |
| [W2 轻量补命令/补面](w2-command-face.md) | seam face + commands.ts + 门禁阶梯 | W1 的门禁阶梯与五层地图（引用，不重述） | 补 slash 命令 / 面板入口 / 已有 id 接线 |
| [W3 产品缺陷票](w3-defect-fix.md) | 测试层红线外上报 → 用户拍板 → 修复刀+反例 | 已确认缺陷在测试层红线外 | 容器/E2E 暴露的产品 boot/时序缺陷 |
| [W4 oldfox 评审协议](w4-review-gate.md) | RED 停车、裁决即终稿、复验面、分档法 | 切片证据包已提交（W5） | 每片 proof 汇总后、合并前 |
| [W5 预注册与证据包](w5-proof-evidence.md) | 预注册/证据包/验收制/脱敏/负例/sha 索引 | 切片票已落盘 | 任何切片实现前先落盘、采集中 |
| [W6 发版](w6-release.md) | FF 合并 → tag 驱动 release → npm 轮询 → 安装版冷启动冒烟 | tag 前提全绿（`024-tag-premise-adjudication-oldfox.md:69-91`） | 0.24 tag 前提达成后 |
| [W7 宿主 rc 升级应对](w7-host-upgrade.md) | extractor 重跑 + ledger diff + proof 重跑 | 宿主新 rc 可用、CapIR 锚定 | 宿主版本升级（如 rc.4→rc.5） |
| [W8 底座解冻](w8-base-unfreeze.md) | 冻结面清单 + 显式决策 + 受影响 proof 重跑 + 转义段只读 | 底座已冻结（`024-base-frozen.md`） | 必须改 CapIR/build-bridge 转义段等冻结面 |

## 组合配方表（典型场景怎么拼）

| 场景 | 组合顺序 | 说明 / 出处 |
|---|---|---|
| 开新功能域（新能力域） | **W5 → W1 → W4 → W6** | 先落预注册，走 W1 五层地图+七步，oldfox 评审后随发版；0.24 底座→S1–S6 即此配方（`dsh-opentui-024-delivery-plan.md:52-72`） |
| 补命令/UI 入口（已有域扩展） | **W5 → W2 → W4** | 复用 W1 门禁阶梯，不重走全链；以 `/plugins` 为例见下 |
| 修产品缺陷 | **W3 → W4** | 测试层红线外上报 → 用户拍板 → 修复刀+修复前反例 → 评审（`024-e2e-rework.md:113-119`、`024-verify70-harness-fix.md:41-58`） |
| 发版 | **W6** | tag 前提裁决全绿后（`024-tag-premise-adjudication-oldfox.md:69-91`） |
| 宿主升级 | **W7** | extractor 重跑+ledger diff+proof 重跑（`dsh-opentui-024-delivery-plan.md:89`） |
| 动底座（冻结面） | **W8 → W4** | 显式解冻决策 + 受影响 proof 重跑 + 评审（`024-base-frozen.md:3,22-29`） |

各 workflow 的「预防条款」节收录了 0.24 真实踩过的陷阱；陷阱不单列文件，按归属就地拆分。

## 0.25 应用示例：补 `/plugins` 命令（走 W5 → W2 → W4）

素材：`025-command-surface-audit.md`（静态只读对账，对象 `988c6f0`）。

1. **W5 预注册**（先落盘）：冻结 expected——`/plugins` 从「降级」转「可用」，判绿口径 = 真机面板显示插件列表且无 unavailable notice。JUDGMENT 预案只记视觉/手感/文案三类。
2. **W2 能力面定位**：审计显示 `commands.ts:1100-1101` 已有 `if (!ctx.seam.plugins) { unavailable; return }` 降级分支，`openPlugins` hook 在 `packages/tui-base/examples/v2-entry.tsx:1023` 已接线（hook 全集见 `025-command-surface-audit.md:8`）；瓶颈是 seam 无 `plugins` face（`025-command-surface-audit.md:42,110-118`）。底层 host 面 15 条 plugin-manager RPC 为 CapIR gap（同报告 `:75`、`:91-92`）。
3. **W2 实现**：分两条路裁决——(a) 若只做「本地列表可读」的低成本补齐，优先补 **seam face**（5 条降级命令>/login、/btw、/think、/preset、/plugins 中 /plugins 属 "host 已 wired 或无需 host，但 bridge seam 没实现 face" 类，同报告 `:106-118`）；(b) 若要完整管理器面板，需 15 条 RPC 进 expected 面 → 触发 W1（CapIR gap 扩面）+ W8（若动 CapIR 需解冻）。`plugins()` 本身可读本地列表，管理器全靠 RPC。
4. **门禁阶梯 + W4 评审**：按 W2 的门禁阶梯逐级跑；真机 `/plugins` 帧用 `.ans` 数值口径、locale-complete grep（W5 预防条款）；评审按 W4 分档法处理 gap 类红线，不自判豁免。

## 测试架构总表（跨 workflow 共享判据）

来源：`docs/verification-gates.md`、`scripts/check-capcontract.mjs:1-19`、`scripts/test-tier.mjs`、`024-e2e-rework.md:22-31`、`024-tag-prep-final.md:60-81`、`024-base-frozen.md:5-15`。

| 层 | 测什么 | 何时必跑 | 命令 | 判绿口径 |
|---|---|---|---|---|
| 单测（`bun test packages/*`） | bridge/seam 逻辑、投影、seq 判序、负例 | 每片实现后、每次 push 前 | `for p in packages/*/; (cd $p && bun test)` | 0 fail；既有断言零删除，计数/降级断言「更新非删除」（`024-s2-credentials-slice.md:109-115`） |
| 契约门禁（14 项，原 13+8 拆分） | CapIR 复现/自洽、引用完整、@deepseek-ai 扫描零、声明行覆盖、无裸 ctx、wired_protocol 名集、wired_manual==0、host-face provenance(#9)、dispatch 可执行(#10) | 每片、tag 前、CI 首步 | `node scripts/check-capcontract.mjs` | `PASS=14 NOT_RUN=0 FAIL=0`；#9/#10 由臆造 Face 红事件立（`024-base-task5-review-oldfox.md:10,22,49`；#9 谓词与 `--negative-self-test` 见 `check-capcontract.mjs:62-90,337`，#10 见 `:406`） |
| 真机配方（verify70，实为 **64** 项） | 真 TUI 起机、composer、pane-focus、palette、settings/agents、80x24、auto-resume | 每片（尤其接线/渲染）、tag 前 | `bash scripts/real-client-gate.sh --out .proof/<slice>/real-client-gate` | exit 0 + `REAL_CLIENT_GATE_PASS`；「70」是 `real-client-gate.sh:4,254` 陈旧文案，真实 64（`024-s6-review-oldfox.md:63-73`） |
| E2E families | pack 门禁 + CapIR 能力域 + 握手/降级 + sessionId 隔离 + exit code + keymap/modality + verify-gate | 阶段末、tag 前连续 3 绿 | `bash e2e/families/run-all.sh --skip-container` | `E2E UNIFIED: PASS`（FAILED_FAMILIES=0），连续 3 次同 head（`024-e2e-rework.md:64-74`） |
| pack / 冷启动 | tarball 契约、无 @deepseek-ai 副本、fresh-prefix 安装、握手 | 每片、发版、CI 三 job | `npm pack --dry-run` + ci.yml `Pack / cold start / bridge handshake` job | T8 PASS；tarball 只含 dist/bridge（`024-s1-model-slice.md:88,91`） |
| 干净 worktree + frozen-lockfile | 无手工软链依赖、lockfile 最新 | tag 前、0.9.6 教训后必跑 | `git clone --no-local` + `pnpm install --frozen-lockfile` | install up to date + check-capcontract/build/单测全绿（`024-s6-legacy-slice.md:334-338`） |
| 脱敏扫描（证据 sink backstop） | 凭据/auth URL/密钥值零出帧零落盘 | 每片证据采集**最后一步** | `node scripts/scan-stdio-secrets.mjs --self-test` + `... .proof/<slice>` | self-test 10/10 pattern detected；证据 0 hits（`024-s4-pkce-slice.md:77-97`） |

判绿通则：机器可判项才进门禁；环境不可达项走「显式豁免」（裁决人+日期+理由），不静默删除、不自判放行（`024-e2e-requirements.md:5,9,53-80`）。
