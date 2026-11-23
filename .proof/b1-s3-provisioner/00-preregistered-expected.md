# B1 第三刀（S3 + N2 + provenance 评审票）预注册

- 切片：S3 provisioner 限字段合并 + N2 `settings/conflict` 按 code/name 判定 + provenance note 评审票
- 设计依据：`research/2026-11-23-ui-batch/05-settings-runtime-channel-design.md` §1.3 / §3.4 / §4.3(a) / §6.1 / §7 S3 / Q6
- 流程：W5（`docs/workflows/w5-proof-evidence.md`）预注册 write-once；证据目录 `.proof/b1-s3-provisioner/`
- 分支：`feat/ui-batch-1123` @ `87aa56f`（实现前 head）
- 工具链：node v26.8.1 / bun 1.4.4
- 冻结面：capir/ + capcontract/ 生成物 + ledger/ledger.{json,md} + build-bridge 转义段 + 握手/wired 表字面量零 diff
- S0 结论：bridge settings arm 属 hostInvoke 臂、provisioner 属 profile 模板；变更不落 W8 冻结面（设计 §7 S0）
- ledger 基线 sha256：`ledger/ledger.json` = `5fd0b0d55e987676da99110e53b9799058d94ce0a196a3f9a36ec8dbaafa33f4`；`ledger/ledger.md` = `cc181613d64da21db570186ce86ee9cf108940ae1187ad26bddc40ef47db87b8`

> **never edited after capture**：本文件正文在证据捕获前落盘，捕获后不回改；事后裁决只以「附则」追加。
> **成文方式声明**：一次性成文，E 行按 E1→E7 顺序编号，无逐节时间戳冒充。

## 一、机器可判 Expected（E1–E7，禁环境依赖子句）

> W5-CE 4.2：以下判定式全部基于源码文本 / 纯函数 / 临时目录夹具 / 门禁命令输出；不含 `present=true` 类运行时状态断言。
> 真机 inproc 宿主热生效与持久化（设计 §6.3 / §7 S8）为后续收口刀，不混入本刀 pass criterion。

| # | assertion | expected (FROZEN) | pass criterion（机器可判、环境无关） | changed path | level | evidence file |
|---|---|---|---|---|---|---|
| E1 | provisioner 合并保留运行期 `subagent.maxActiveSubagents` | 当前 patch 中 `maxActiveSubagents: 5` → 重写后仍为 `maxActiveSubagents: 5`，且 `maxDepth: 1` 与整段模板行序逐字节不变 | 临时目录夹具：写 current/template 两文件 → 调用纯合并函数 → 断言输出含 `    maxActiveSubagents: 5`、`    maxDepth: 1` 顺序不变，除目标行外与模板逐字节相等 | `scripts/lib/patch-runtime-merge.mjs`(new)、`scripts/provision-inproc-profile.mjs` 收敛段、新单测 | unit | `03-provisioner-merge.log` |
| E2 | `permission.defaultPreset` 的 `!!js` 守卫语义 | 当前 patch 仍为模板同一 `!!js` 表达式 → 合并后保留模板 `!!js` 行、无 override 注记；当前为普通标量 → 输出普通标量且带 WARN 注记 | 纯函数断言两分支输出 + note 文本；非法/重复键 → 不合并、输出=模板、带 WARN | 同上 | unit | `03-provisioner-merge.log` |
| E3 | 模板行号引用未移动 | 脚本内 ledger 引用的 `provision-inproc-profile.mjs:566-578` 区块（approval-gate `insert` 行）逐字节不变 | 源码文本断言：按行取脚本 566-578（1-indexed）等于固定锚文本；`git diff` 对模板段为空 | provisioner（仅收敛段 + import） | unit | `03-provisioner-merge.log` |
| E4 | 冲突码按 code/name 判定 | `code='SETTINGS_CONFLICT'` 或 `name='SettingsConflictError'` → frame code `'settings/conflict'`；普通 Error（message 含 "conflict" 但无 code/name）→ `'INTERNAL'`；NOT_WIRED → `'UNSUPPORTED'` | 纯函数 `classifySettingsFrameCode` 单测；源码 `grep` 无 `/conflict/i` 正则残留 | `packages/bridge/src/index.ts`、新单测 | unit | `04-conflict-classification.log` |
| E5 | capcontract 门禁 GREEN + 生成物零 diff | `node scripts/check-capcontract.mjs` 全项 ok；`git diff --quiet HEAD -- capir/ capcontract/ ledger/ledger.json ledger/ledger.md` 退出码 0 | 命令退出码 0 + 输出含 `GREEN`；diff 退出码 0 | 无（生成物） | gate | `05-gate.log` |
| E6 | ledger 双跑字节一致 + note 不内嵌 ledger | `node scripts/gen-ledger.mjs` 连跑两次；每次后 `ledger/ledger.json` / `ledger/ledger.md` 的 sha256 等于基线；`git diff --quiet HEAD -- ledger/ledger.json ledger/ledger.md` 退出码 0 | sha256 两跑相等且等于 E 行基线；`provenance.json` note 更新后 ledger 文件 diff 仍为空 | `ledger/provenance.json`(note 字面量) | gate | `06-gen-ledger-double.log` |
| E7 | 受影响测试 + typecheck 绿 | shell provisioner/subagent 测试、bridge settings 测试全绿；`pnpm typecheck:entry` 退出码 0 | `bun test` 相关子集退出码 0；typecheck 退出码 0 | 新单测 + bridge src | unit+typecheck | `07-tests-typecheck.log` |

## 二、门禁预期

- `check-capcontract`：全项 GREEN（22 PASS，wire 表/wired 集不变）。
- `gen-ledger` 双跑：`ledger/ledger.json` / `ledger/ledger.md` 两次 sha 与基线逐字节一致；note 修改不写入生成物。
- 任一项非一致 → 立即停车汇报，不改生成物、不自放宽 criterion。

## 三、USER-JUDGMENT 预案（记录 + 推荐默认，不进技术门禁）

1. 合并函数落点：推荐新 `scripts/lib/patch-runtime-merge.mjs` 纯模块；`import` 声明放在脚本 :1250 之后（ESM 顶层 import 可位于模块任意顶层位置），避免前移任何行号。理由：满足 E3 行号红线且可单测。
2. 冲突拒绝集合：推荐 `code==='SETTINGS_CONFLICT' || name==='SettingsConflictError'`，移除全部 message 正则判定。理由：设计 §3.4/Q6 明确 code 为权威；message 含 conflict 的普通错误必须落 INTERNAL。
3. provenance note 编辑范围：推荐只替换 `wired_capir_generated.note` 中「credentials AND settings ids reach NOT_WIRED」一句；其余 S1/S2/S3/S5 + 025-w1b 叙述逐字保留。理由：literal 编辑先例（N1 C1），最小化冻结面 diff。
4. 是否新增 `session-log-deepseek` 模板行：推荐**否**（本刀任务书只点名两个合并字段；新增行即便追加末尾也会改 PATCH_REVISION，属超范围）。

## 四、NOT RUN 声明（如实）

- **N1 真机持久化验收**：改 3→5 后重启仍 5、热生效、派发验证（设计 §7 S8）属收口刀；本刀仅以临时夹具覆盖合并逻辑与行号不变。
- **N2 真机 dsh-settings 错误对象**：本仓未安装宿主源码，冲突对象形状按设计 §3.4 的 `{code:'SETTINGS_CONFLICT', name:'SettingsConflictError'}` 契约用 synthetic 对象覆盖。

## 五、S0 五硬条件自查（实现期逐条核对）

1. 范围只含 provisioner 收敛段 + bridge 冲突分类 + provenance note 字面量 + 测试/证据文件。
2. 模板行序不动；ledger 证据引用的 `provision-inproc-profile.mjs:566-578` 不移位（E3）。
3. 不改 CapIR / capcontract / 握手 / wired 表字面量 / build-bridge 转义段；生成物零 diff（E5/E6）。
4. 不新增 NOT_WIRED 文案串；冲突只按 code/name 判定（E4）。
5. 生成物任何非一致 → 停车；单 commit、不 push；git status 逐项核对。
