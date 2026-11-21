# 07 测试架构（门禁阶梯的职责分层）

> 出处约定见 [README.md](README.md)。**命令表、何时必跑、判绿口径的逐层清单在 `docs/workflows/README.md` 的「测试架构总表」**；本文只说明每层**守什么结构不变量、为什么不能互相替代**，不复制那张表。评审分档协议见 `docs/workflows/w4-review-gate.md`。

## 7.1 判绿通则（结构约束）

判绿通则的权威表述在 `docs/workflows/README.md`（测试总表末段：机器可判才进门禁、环境不可达显式豁免、既有断言零删除）。本节只钉其结构属性：门禁是回归网，删除断言等于静默降覆盖（`024-s2-credentials-slice.md:109-115`）。

## 7.2 阶梯的六层职责

| 层 | 守的结构不变量 | 为什么不能被上一层替代 | 出处 |
|---|---|---|---|
| 单测（`bun test packages/*`） | bridge/seam 逻辑、投影字段集、seq 判序、负例（NOT_WIRED/BAD_PARAMS/stream 四件套）；捕获栈矩阵与帧计数 | 纯函数/模块级，无 bundle、无宿主、无终端 | `packages/tui-base/test/focus-router.test.tsx`；`024-s2-credentials-slice.md:109-115`（既有断言零删除） |
| 契约门禁（实为 14 项） | CapIR/capcontract 字节级自洽、引用完整、`@deepseek-ai` 扫描零、声明行覆盖、无裸 `ctx.<service>`、`wired_protocol` 名集、`wired_manual==0`、host-face provenance(#9)、dispatch 可执行(#10) | 只跑纯 Node 对已提交文件，不联网、不构建；#9/#10 由臆造 Face 红事件立 | `scripts/check-capcontract.mjs:1-21,250-304,349-411`；`docs/workflows/README.md:61`；`024-base-core-review-oldfox.md:30-49` |
| 真机配方（名 verify70，实 64 项） | 真 TUI 起机、composer、pane-focus、palette、settings/agents、80x24、auto-resume 等**只有真实渲染才暴露**的行为 | keymap 病史全是真渲染才现形的 P0；无需 runner 条件 | `scripts/real-client-gate.sh:4,249-256`；`024-s6-review-oldfox.md:63-73`（「70」为陈旧文案，真实 64）；v3 `:108` |
| E2E families | pack 门禁 + CapIR 能力域 + 握手/降级 + sessionId 隔离 + exit code + keymap/modality + verify-gate 的**跨进程/跨会话**行为 | 单元层看不到进程边界、sessionId 串台与信号退出码 | `e2e/families/run-all.sh`；`e2e/families/40-exit-code.sh:1-11`；`024-e2e-rework.md:22-31,64-74` |
| pack / 冷启动 | tarball 只含 dist/bridge、无 `@deepseek-ai` 副本、fresh-prefix 安装、握手；桥 bundle 内 `@deepseek-ai/*` 仅 import | 验证分发形态与 symlink 依赖，源码层门禁看不到 npm tarball | `024-s1-model-slice.md:88,91`；`docs/adr/0009-inprocess-session-bridge.md:48`；CI `Pack / cold start / bridge handshake` job |
| 干净 worktree + frozen-lockfile | 无手工软链依赖、lockfile 最新 | 0.9.6 教训；多 worktree 交叉污染会使 green 不可信 | `024-s6-legacy-slice.md:334-338`；`024-tag-premise-adjudication-oldfox.md:83` |

另有一条**证据 sink backstop**：脱敏扫描（`scripts/scan-stdio-secrets.mjs`）只在证据采集最后一步跑，self-test 每 pattern 命中 + 证据零命中（`024-s4-pkce-slice.md:77,114`）。它是采集侧防线，不是功能门禁（见 [06](06-security-privacy.md)）。

## 7.3 已知 flake 与「70 vs 64」口径

- verify 门禁既存 flake：5 复跑中 1 次 63/64（composer branch segment 首帧 paint 时序，非能力面回归；`024-tag-premise-adjudication-oldfox.md:87`）。处理按 w4 分档法，不自判豁免。
- `real-client-gate.sh:4,249` 的「70 items」是陈旧文案，实际 64 项（`024-s6-review-oldfox.md:63-73`）；`docs/workflows/README.md:62` 已如实登记。
- CI `real-client` job skipped 是 workflow 条件（`vars.DSH_REAL_CLIENT_GATE` 未开），非失败；本地 `real-client-gate.sh` 实跑 PASS，两者不互相冒充（`024-tag-premise-adjudication-oldfox.md:88`）。

## 7.4 与 workflows 的接口

- 每层**命令、触发时机、判绿短语** → `docs/workflows/README.md:58-68`。
- 门禁阶梯执行顺序（每片） → `docs/workflows/w1-capability-slice.md` / `w2-command-face.md`。
- RED 停车、裁决即终稿、verify70 五档表 → `docs/workflows/w4-review-gate.md`。
- 发版 tag 前提十项对账 → `docs/workflows/w6-release.md`。
- 底座 V1–V4 全绿与冻结门槛 → `024-base-frozen.md:5-15`。

## 维护责任

门禁层数、某层的判定职责或已知 flake/口径（70 vs 64）变化时更新本文档；仅调整命令参数或触发时机（不改职责）时只更新 workflows 的测试总表。
