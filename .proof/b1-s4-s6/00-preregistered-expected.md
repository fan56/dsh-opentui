# B1 第二刀（S4/S5/S6）预注册 — 客户端 seam 路由切宿主 + 真实值显示

- 切片：B1 S4/S5/S6 — seam `settings.describe/mutate` 宿主优先 + `source` 标注；`/agents` caps 与 settings 数值以宿主 describe 为唯一权威；面板来源徽标 / 空值拦截 / maxDepth 只读
- 设计依据：`research/2026-11-23-ui-batch/05-settings-runtime-channel-design.md` §4.2 / §4.4 / §7 S4-S6 / §9 Q1/Q3/Q4
- 依赖：B1 S1/S2（commit `2434f6f`，`packages/bridge/src/settings-adapter.ts` + 桥内 resolver）——本刀消费它，不改它
- 流程：W5（`docs/workflows/w5-proof-evidence.md`）预注册 write-once
- 分支：`feat/ui-batch-1123` @ `87aa56f59bf8c631087da1f0ccc00f47c36d0c04`（实现前 head）
- 工具链：node v26.8.1 / bun 1.4.4
- 证据目录：`.proof/b1-s4-s6/`

> **never edited after capture**：本文件正文在证据捕获前落盘，捕获后不回改。若事后追加裁决附则，仅以「附则」段落追加，不修改正文断言。
>
> **成文方式声明**：一次性成文（非逐节顺写）；各 E 行按 E1→E8 顺序编号，无逐节时间戳冒充。

## 一、机器可判 Expected（E1–E8，环境无关）

> W5-CE 4.2 禁环境依赖子句：以下判定式全部基于 synthetic fake transport / 临时目录内 synthetic patch 文件 / 纯函数返回值 / 门禁命令输出，
> 不含 `present=true` 类运行时宿主状态断言。真机 inproc 宿主「describe 真值热生效」列入 NOT RUN（见第四节），不混入 E 行 pass criterion。

| # | assertion | expected (FROZEN) | pass criterion（机器可判、环境无关） | changed path | level | evidence file | depends on |
|---|---|---|---|---|---|---|---|
| E1 | 宿主在场：`settings.describe()` 走宿主 wire | 返回 `{source:"host", ...}`，`namespaces` 的数值来自 fake `"settings.describe"` reply（非本地文件数字） | 单测断言 fake transport 收到 `settings.describe` 一次；返回 doc `source==="host"`；`subagent.value.maxActiveSubagents` 严格等于 wire stub 值，且不等于临时目录 patch 内的本地数字 | seam + 新单测 | unit | `01-seam-route.log` | — |
| E2 | 宿主在场：`settings.mutate()` 走宿主 wire | 转发到 fake `"settings.mutate"`，带原样 ns/ops/revision；返回 host 的 mutate 结果；本地 patch 字节不变 | 单测断言 `settings.mutate` 请求 params.ns/ops/expectedRevision 逐字段等于入参；本地 patch 文件 `readFileSync` 前后字节相等 | seam + 新单测 | unit | `01-seam-route.log` | E1 |
| E3 | 宿主缺席（fake 对 describe 抛错）→ 降级本地文件 | `settings.describe()` 返回 `{source:"local-file", sourceDetail.reason:<非空>}`；本地 patch 字节不变（只渲染、不写） | 单测断言 fake 抛错后 doc `source==="local-file"` 且 `sourceDetail.reason` 非空字符串；后续 `mutate()` 返回 `{ok:false}`，transport 未收到 `settings.mutate`，本地 patch 字节不变 | seam + 新单测 | unit | `01-seam-route.log` | — |
| E4 | n/a 不回落本地数字 | local-file 态下 `buildHostItems(doc)` 的数字行 value 为 `n/a` 且 `editable===false`；`agents.officialCaps()` 返回 `source:"unavailable"` 且**不含** maxActiveSubagents/maxDepth 数值（即便本地 patch 有 3/1） | 单测断言数字行 `value==="n/a"`、`editable===false`、`note` 含原因；caps 无数值字段；`agentLimitsRows` 对应两行 value 为 `n/a` | panel + seam + 新单测 | unit | `02-panel-source.log` | E3 |
| E5 | 空值拦截（宿主数字行禁 unset） | `planHostWrite(item, "")` 返回 `{ok:false}`，错误提示含「清空/回落继承值」语义（新 i18n key） | 单测断言空字符串与纯空白字符串都 `ok===false` 且 error 等于新 key 的 en 文案；断言不产生任何 `{op:"unset"}` ops | panel + i18n + 新单测 | unit | `02-panel-source.log` | — |
| E6 | maxDepth 在此模式只读 | `buildHostItems(hostDoc, true)` 的 `subagent.maxDepth` 行 `editable===false` 且 note 含「钉死/安全约束」；`maxActiveSubagents` 行仍 `editable===true` | 单测断言 maxDepth 不可编辑、note 命中新 key；maxActive 可编辑（证明不是整体只读） | panel + i18n + 新单测 | unit | `02-panel-source.log` | — |
| E7 | 来源感知写入成功提示 | host 态成功写 → 文案含「即时生效」；local-file 态成功写 → 文案含「已写入本地文件 / 重启宿主生效」 | 单测断言纯函数 `settingsWriteStatus` 两种 source 的返回分别命中两个新 en key 文案；不复用旧的「changes are saved instantly」冒充热生效 | panel + i18n + 新单测 | unit | `02-panel-source.log` | — |
| E8 | 冻结面 + typecheck 零回归 | 冻结文件 git diff 为 0；`pnpm typecheck:entry` 退出码 0；受影响包 scoped 测试全绿；无新增 NOT_WIRED 文案串 | `git diff --quiet HEAD -- handshake.ts capir/ capcontract/ ledger/ provenance.json packages/bridge/src/index.ts provision-inproc-profile.mjs` 退出码 0；typecheck 退出码 0；`grep -c 'NOT_WIRED'` 对新增源码为 0 | 全刀 | gate | `03-typecheck-gate.log` | E1-E7 |

## 二、验证预期

- 受影响 scoped 测试：`packages/shell/test`（seam 路由三态）、`packages/tui-base/test`（面板来源 / caps n/a / 空值 / maxDepth）、`packages/bridge/test`（确认 S1/S2 适配器未被破坏）→ 全绿。
- `pnpm typecheck:entry` → 退出码 0。
- 冻结面 diff 为 0（红线清单逐项核对）。
- 任一项非预期 → 立即停车汇报，不自放宽 criterion。

## 三、USER-JUDGMENT 预案（≤5 项，记录 + 推荐默认，不进技术门禁）

1. `sourceDetail.reason` 文案：推荐对宿主抛错消息做脱敏短句（截断、去换行），不记完整 stack。理由：面板要显示原因但不能泄漏路径/密钥。
2. caps `source` 取值：推荐 `"host" | "unavailable"`（设计 §4.2(c) 允许复用）；`unavailable` 时数值字段**缺失**，由渲染层出 n/a。理由：与既有「缺失字段渲染 n/a」同形，改动面最小。
3. 本地文件数值：保留 `LocalSettingsStore.describe()` 的返回（其它消费者/测试用），但 seam 的 local-file 文档仍带数值仅在 `sourceDetail` 语义下「仅供渲染诊断」，面板与 caps 一律不显示。理由：避免改 s5-local-faces 既有断言。
4. 成功提示挂钩点：推荐纯函数 `settingsWriteStatus(source,label)` 由 modal 的 `flashSaved` 调用。理由：可单测、不依赖组件挂载。

## 四、NOT RUN 声明（如实，不自称全项 PASS）

- **N1 真机热生效**：改 `maxActiveSubagents` 3→5 即时生效、派发 5 个都起、重启仍 5、`/agents` 与 `/settings` 数字一致 → 留 S8 收口刀。本仓未安装宿主源码、无真机 inproc 宿主，仅以 synthetic fake transport 覆盖 seam 路由逻辑。
- **N2 持久化合并（S3）/ 门禁阶梯 real-client-gate + pack（S7）/ conflict code 修复（Q6）**：均为独立切片，本刀不涉及（红线：provisioner、provenance.json、bridge index.ts conflict 段不动）。

## 五、S0 红线自查（实现期逐条核对）

- 不碰：handshake、CAP_HOST_WIRED_IDS、CAP_SETTINGS_WIRE_METHODS、capir/、capcontract/、ledger/、provision-inproc-profile.mjs、provenance.json、packages/bridge/src/index.ts（含 conflict 段）。
- 不新增 NOT_WIRED 文案串。
- 消费 S1/S2 适配器与 resolver，不改其语义。
