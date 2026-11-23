# 00 — verify70 迁移 + 宿主持久化补齐 预注册（batch-gate）

- 日期：2026-11-23
- 分支 / SHA：`feat/ui-batch-1123` / `b16d31515f297bd230bcc6e8bee05082a265c027`（实现前）
- 环境：dsh `0.2.2-rc.5` · bun `1.4.4` · node `v26.8.1` · 宿主 profile `opentui-inproc`
- 证据目录：`.proof/batch-gate/`（本文件 write-once；正文为实现前冻结的 expected 与结论；实测结果写入 `report` 节并标注 capture 后追加）
- 依据：裁决采纳设计书 §4.3(a) 原方案；`research/2026-11-23-ui-batch/05-settings-runtime-channel-design.md §4.3(a)`、失败模式表；commit `9caab9b`（B1 S4-S6）、`5a2abeb`（B1 S3）；`docs/workflows/w5-proof-evidence.md`。

## 0. 持久化洞的发现（实现前一手事实，裁决依据）

真机探针 `/tmp/sl-persist-probe.mjs`（真 inproc 宿主 + 同 provisioner 配方，只写临时 scratch home）实测：

| 阶段 | `session-log-deepseek.enabled` | `profiles/opentui-inproc/cordis.patch.yml` |
|---|---|---|
| mutate false 前 | `true` | — |
| mutate false 后 | `false`（热生效） | 含 `- id: session-log-deepseek … enabled: false` |
| 重跑 provisioner（=真实 launcher 每次启动路径 `bin/dsh-opentui.mjs:310`）后重启宿主 | **`true`（回落默认）** | **session-log-deepseek 条目被删除** |

- 写入链路：`dsh-settings/src/index.ts:368 mutate` → `configEditor.edit`（`:391`）→ `writeFileAtomic(documentPath)`（`dsh-config-editor/src/index.ts:141`）；`documentPath = profileContext.patchPath`（`:34`）= `<DSH_HOME>/profiles/opentui-inproc/cordis.patch.yml`，格式为 YAML 序列条目（`- id / name / config`）。
- 丢失根因：`packages/shell/scripts/lib/patch-runtime-merge.mjs` 的白名单只有 `maxActiveSubagents`、`permission.defaultPreset`；模板 `provision-inproc-profile.mjs` 也无 `session-log-deepseek` 行。S3 预注册第 41 行明确「新增 session-log-deepseek 模板行：推荐否（超范围）」，故第三刀跳过。N1 探针旧版重启步骤未重跑 provisioner，导致 N1-d 误报「持久成立」。
- 裁决：补齐 §4.3(a) 原方案，不用断言改动掩盖洞。

## 1. Expected 表（FROZEN，机器可判）

| id | assertion | expected (FROZEN) | pass criterion | changed path | level | evidence |
|---|---|---|---|---|---|---|
| E1 | provisioner 模板末尾（ledger 锚 `:566-578` 之后）追加 `session-log-deepseek` 显式行 | 模板含该行；`:566-578` 逐字节不变 | 行号锚单测 `patch-runtime-merge.test.ts` 的 `:566-578 stays byte-for-byte anchored` PASS；approval-gate-profile + subagent-depth-profile 单测 PASS | `provision-inproc-profile.mjs` | unit | `report` §E1 |
| E2 | `mergeRuntimeFields` 白名单 += `session-log-deepseek.enabled` | 沿用 `!!js`/非法值拒绝范式 | 单测：mutate false → 重跑 provisioner → 仍 false；非法值/重复行 → WARN 且不合并 | `patch-runtime-merge.mjs` + `patch-runtime-merge.test.ts` | unit | `report` §E2 |
| E3 | ledger 冻面零 diff | `ledger/` 生成物字节不变 | `git diff --exit-code ledger/` 空 | — | gate | `report` §E3 |
| E4 | verify70 patch 路径指向宿主实际写入文件 | `patchEntry` 读 `profiles/opentui-inproc/cordis.patch.yml` | 源码核对 `bridge-transport.ts:71,188` 宿主 `--profile opentui-inproc`；[25]/[28] 新断言 PASS | `verify/agents-mount-repro.mjs` | real | `report` §E4 |
| E5 | [25]/[28] 迁移为最强式 | 翻转 + fresh describe 读回 + 宿主 patch（正确路径）含值 + 经 provisioner 收敛后仍含 | gate 64/64；断言旁注释引用 B1 S4-S6 + 本次补齐 | `verify/agents-mount-repro.mjs` | real | `report` §E5 |
| E6 | N1 探针重启步骤修正 | 重跑 provisioner + 重启宿主；两个 ns 值都保留 | 探针输出 `restart_persist_*` 均 true | `.proof/batch-gate/n1-probe.mjs` | real | `report` §E6 |
| E7 | typecheck:entry | exit 0 | `pnpm typecheck:entry` exit 0 | — | gate | `report` §E7 |
| E8 | real-client-gate 全量 | verdict 0 FAIL（64/64） | `scripts/real-client-gate.sh` 末行 `REAL_CLIENT_GATE_PASS`；软链保留 | — | gate | `report` §E8 |

## 2. 帧甄别结论（实现前判定，write-once）

6 个被覆盖的 `.ans` 逐帧判定：**全部保留新帧**。差异分四类，均可解释：

| 帧 | 差异类别 | 对照说明 | 结论 |
|---|---|---|---|
| `s1-model` | R5 边框色 `20;20;20→36;37,40`；section 标题色 `100;100;102→49;70;105`（聚焦/accent）；环境文本（worktree 路径/分支、时钟） | R5 `unfocusedBorderColor`（semantic.ts:46-73）；环境文本非 UI 回归 | 保留 |
| `s2-account` | R5 边框色同上；**settings 来源提示**：`默认权限 preset danger-full-access→workspace-write`、`Host 15→16`（宿主权威 describe 取代 local-file 值） | B1 S4-S6「真实值显示」；正是已知 settings 来源变化 | 保留 |
| `sk-06-esc` | R5 边框色 `48;48;48→87;90;96`；环境文本 | R5 非聚焦边框提亮 | 保留 |
| `sk-06-modal` | R5 边框色 `20;20;20→36;37;40`；逗号位移（thinking 动画时序，非确定性）；环境文本 | 动画帧时序；无不可解释项 | 保留 |
| `sk-07-pgup-pgdn` | R5 边框色 `20;20;20→36;37,40`；环境文本 | 同上 | 保留 |
| `sk-08-basic` | R5 边框色 `48;48;48→87;90;96`；环境文本（worktree 路径、随机引语 `鲸鱼唱歌→咸鱼翻身`、时钟） | 边框 R5；引语/时钟非确定性 | 保留 |

- 无不可解释差异（无丢行、无新报错、无布局破损）。环境文本（worktree 路径、时钟、随机引语、动画相位）随每次 gate 运行变化，revert 反而会写回与本工作树不符的陈旧路径，故保留。

## 3. 门禁预期 + JUDGMENT 预案 + NOT RUN

- 门禁：E1/E2/E3/E7 unit+gate 全绿；E8 目标 64/64。
- JUDGMENT（≤5，记录不拦）：J1 R5 边框色提亮观感；J2 settings 来源提示文案；J3 保留帧中环境文本（路径/时钟/引语）。三项均为已知默认，不进技术门禁。
- NOT RUN：真实多客户端并发写冲突（non-volatile home patch 覆盖分支）——本刀不引入，沿 S3 既有单测覆盖，声明 NOT RUN。
- 措辞强度：单 run 在场绿只写「一次在场绿」；不写「C/D 均绿」。

## 4. report（capture 后追加，正文未改）

- **E1 observed PASS**：模板末尾追加 session-log-deepseek 显式行（provision-inproc-profile.mjs 末段，位于 :566-578 锚之后）；行号锚单测 `provision-inproc-profile.mjs:566-578 stays byte-for-byte anchored` PASS；approval-gate-profile(3)/subagent-depth-profile(3) 全 PASS。
- **E2 observed PASS**：patch-runtime-merge.mjs 新增 `findEntryEnabled`/`safeBoolean` + session-log 合并块；4 条新单测（false 合并 / idempotent / 非布尔拒绝 / 默认无需合并）全 PASS；整文件 12 pass 0 fail。真机 probe 再次确认：mutate false → reprovision → `enabled: false` 仍在，`!!js` 审批行未动。
- **E3 observed PASS**：`git diff ledger/` 空，冻面零 diff。
- **E4 observed PASS**：bridge-transport.ts:71,188 确认宿主 `--profile opentui-inproc`；patchPath 已改指 `profiles/opentui-inproc/cordis.patch.yml`。
- **E5 observed PASS**：gate verify70 中两条由红转绿，LOG 逐字：`settings writes a host row (…) into host patch.yml, persisted across provisioning — … value survives provisioner re-convergence` 与 `settings restores the host row (…) … persisted across provisioning`。附带 flip + fresh describe（[24]/[27]）+ 收敛后仍含值。
- **E6 observed PASS**：n1-probe.mjs 重启步骤改为重跑 provisioner + 重启宿主，双字段验证；证据 `.proof/batch-gate/step6-n1-corrected/n1-result.json`：`hot_effective=true`、`sld_hot_effective=true`、`restart_persist=true`、`sld_restart_persist=true`、`reprovision_on_restart.ok=true`。更正此前 N1-d 误报。
- **E7 observed PASS**：`pnpm typecheck:entry` exit 0。
- **E8 observed PASS（一次在场绿）**：`bash scripts/real-client-gate.sh` → `=== verdict: FAIL=0 ===` / `REAL_CLIENT_GATE_PASS`；verify70 64/64；summary.json results=64 passed=64 failed=0；软链（bridge 目录副本）保留、未动。env precheck/postcheck 均无孤儿。
- **单测汇总**：`bun test packages/shell/test/` → 1348 pass / 5 skip / 0 fail。
- **帧甄别**：6 帧按 §2 结论全部保留；gate 重跑后重解码差异类别不变（R5 边框、settings 来源值、环境文本），无不可解释项。
- **提交 concern 分**：(1) 持久化补齐（provisioner 模板 + merge + 单测）；(2) verify70 迁移 + patch 路径修正；(3) N1 探针修正。（可并入其一，按实际 commit 记录。）
