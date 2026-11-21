# W5 — 预注册 + 证据包 + 验收制

适用：任何切片实现前先落预注册，采集中按纪律建 `.proof/` 证据包，汇总时按验收制处理判定项。前置：切片票已落。配合 [W1](w1-capability-slice.md)、[W4](w4-review-gate.md)。出处：`024-s1-model-slice.md:4,52-68,99-107`、`024-s2-credentials-slice.md:13-26`、`024-s5-config-slice.md:151-157`、`.proof/024-s1-model/00-preregistered-expected.md`。

## 一、预注册（先落盘、write-once）

`00-preregistered-expected.md` 须在**任何实现/证据捕获前**写入 `.proof/<slice>/`，`never edited after capture`（`.proof/024-s1-model/00-preregistered-expected.md:1-4`）。内容：

- 元数据：CapIR 方法集、provenance、wired 面预期、@manual 计数预期、删除面、宿主版本、分支/SHA、证据目录（同文件 `:6-20`）。
- expected 表（E1–En）：每行含 assertion / expected(FROZEN) / pass criterion（机器可判、checkable）/ changed path / level / evidence file / depends on（`:29-35`）。
- 门禁预期 + USER-JUDGMENT 预案（≤5 项，三类边界）+ NOT RUN 声明（`:39-50`）。

**deferred 修订**：若裁决事后追加附则（如 S6 二次裁决），头的 `never edited` 措辞须精确为「正文 capture 后未改；附则为此日期裁决追加」，避免字面冲突（S6 终评 S2，`024-s6-review-oldfox.md:97-99`）。

## 二、证据包规范（`.proof/<slice>/`）

文件命名约定（S1 `024-s1-model-slice.md:52-68`）：

| 文件 | 内容 |
|---|---|
| `00-preregistered-expected.md` | 冻结 expected + 判定式 + JUDGMENT 预案（唯一入库的断言文件） |
| `00-pre-change.log` | **反例基线**：改动前目标 id 全 `NOT_WIRED` / leak:true（修复前反例） |
| `01-env-snapshot.log` | 宿主版本 / node / bun / branch + SHA / 证据捕获前后各记一次 head |
| `02-gate-full.log` | check-capcontract 全项结果 |
| `03-regen.log` | gen-capir/gen-capcontract `--check` 字节一致；gen-ledger 双跑 sha 相同 |
| `04-*.log` / `05-*.log` | 单测、build、握手、CAP_SMOKE 探针 |
| `0N-*.ans` | 真机 tmux `capture-pane -e -p` 数值帧（**禁 PNG/视觉模型**） |
| `0N-verify70.log` | verify 全量逐项 + BLOCKED 声明 |
| `report.md` | proof-it-works 判定（Gate PASS/BLOCKED + E1–En expected→observed + round log） |

- `*.log` 按 `.gitignore:4` 被 gitignore，入库靠预注册 md / `.ans` / `report.md`；tag 前提要求 proof 归档时，结构化证据（bridge-probe.mjs + `.ans`）入库、`.log` 逐文件 sha256 登记（`024-tag-prep-final.md:41-49,137-216`）。
- **日志 sha 索引**：预注册与报告的日志文件带 sha256 前 8 位（`024-s1-model-slice.md:54-68`）；归档的 gitignored `.log` 有完整 sha256 清单（`024-tag-prep-final.md:142-216`）。
- **round log / criterion 变更透明性**：任何计数快照更新（如 registry 4→19→22），旧 criterion 逐字记入测试注释 + 报告 round log，断言强度不降（S2 `024-s2-credentials-slice.md:109-115`）。预注册 frozen 不回改；证据文件映射偏差（预注册分文件名 vs 实际合并文件）如实登记非隐瞒（S4 `024-s4-pkce-slice.md:126-128`）。
- **提交=被测**：CI headSha 对上 + diff 复核补闭（证据包自身未必可证，C-S5a，`024-s5-review-oldfox.md:24`）。

## 三、验收制（JUDGMENT 只记录不拦）

- 技术 PASS 判定式：机器可判项（E1–En 门禁/单测/smoke）+ 门禁绿 + NOT RUN 无未声明 + JUDGMENT 有裁决记录（`024-s1-model-slice.md:72`、`024-s4-pkce-slice.md:30`）。
- USER-JUDGMENT 三类边界（视觉布局 / 交互手感 / 文案措辞），每片 ≤5 项，**记录 + 推荐默认（只选无风险方案），不进技术门禁**（`dsh-opentui-024-delivery-plan.md:71,94`；S1 `024-s1-model-slice.md:99-107`；晨验收已按默认拍板 `024-morning-acceptance-report.md:34-43`）。
- E3/BLOCKED、E5/NOT RUN 等结果面缺口：按预注册判定式，声明内的 BLOCKED/NOT RUN **不自称全项 PASS**，如实留给协调者裁决/末期 E2E（S1 `024-s1-model-slice.md:12-16`）。
- NOT RUN 单一索引：`research/024-e2e-requirements.md`，逐项 `[ ]→[x]` 写证据路径，无法覆盖走显式豁免栏（裁决人+日期+理由），不静默删除（`024-e2e-requirements.md:5-9,53-80`）。

## 四、预防条款（0.24 真实陷阱，就地归属）

1. **凭据脱敏三处白名单**：凭据/密钥/auth URL 值禁止落 wire 帧、CAP-SMOKE emit、proof 日志三处 sink。预防：
   - wire 层逐字段投影构造函数式白名单（非 spread/键名过滤）：account 视图四固定字段、URL 值只贡献布尔（`projectAccountViewForFrame`，`index.ts:397`；S4 `024-s4-pkce-slice.md:61`）；settings describe 三 ns 逐字段 allow-list（`local-config-faces.ts:50-72,189-235`）；
   - emit 层白名单字段（如 cap.event 四元 + eventType 枚举，S4 `024-s4-pkce-slice.md:57`）；
   - 证据扫描 `scan-stdio-secrets.mjs .proof/<slice>` 零命中，负例自测每 pattern 能抓（S2 `024-s2-credentials-slice.md:24`，S4 9→10 pattern self-test 10/10，`024-s6-legacy-slice.md:326-330`）；
   - 三处纪律源于计划 S2 切片票必含项（`dsh-opentui-024-delivery-plan.md:62`）。凭据值零落盘、只报键名/布尔（S4 `024-s4-pkce-slice.md:151`）。扫描固定为最后一步捕获（12-ci.log 落盘后重扫，S5 `024-s5-config-slice.md:151-157`）。
2. **预注册禁环境依赖子句（present=true 两次翻车）**：S1 E2「default == 所选值」基于错误宿主行为假设（S1 concern C1）；S2 E4 pass criterion 要求 `credentialsController present:true`，实际结构性 `present:false`（服务未挂载），报告判 PASS 且转述漏掉 present=true 字样、未走变更记录（S2 concern B1，`024-s2-review-oldfox.md:46`）。根因：criterion 混入环境状态断言。预防：**criterion 写成机器可判且环境无关**；禁写「present=true」类运行时状态断言，改「有观测记录且如实」；预注册时已知可能字面未达成的，当场写进「合法 PARTIAL 条件」，不捕获后放宽（`024-s2-review-oldfox.md:59-60`）。翻车已在 S1 C1、S2 E4/B1 出现两次，第三次要防。
3. **locale 变更致 grep 假阴**（证据采集侧，W2 给 gate 侧条款）：真机 `.ans`/面板断言 grep 必须 locale-complete 或 pin harness scratch 语言（en pinned 先例 7a81d9d；zh 面板「账号」「输入消息」补词），否则 locale 切换造成假阴性（`024-s6-review-oldfox.md:125`）。裁决人+理由入显式豁免区，不静默删。
