# B1 第一刀（S1/S2）预注册 — bridge 内 ctx.settings 适配器

- 切片：B1 S1/S2 — `resolveSettingsSurface = controller ?? adapt(ctx.get('settings'))` + settings arm 换名 + 适配器单测
- 设计依据：`research/2026-11-23-ui-batch/05-settings-runtime-channel-design.md` §3.4 / §4.3 / §7 S1/S2
- 流程：W5（`docs/workflows/w5-proof-evidence.md`）预注册 write-once
- 分支：`feat/ui-batch-1123` @ `485f0e0c35e4252aa0de777488869cf6a0edc50a`（实现前 head）
- 宿主版本：rc.5（dsh-base / dsh-settings，来自设计书一手核对；本仓未安装宿主源码）
- 工具链：node v26.8.1 / bun 1.4.4
- CapIR 方法集：settings 5 方法；本刀只接 `settings.describe` / `settings.mutate` 两个 W 方法（其余 3 个 full-only，不在 wire，范围外）
- provenance / wired 面预期：`CAP_HOST_WIRED_IDS.length === 28`（S1 4 + S2 15 + S3 3 + S5 2 + w1b 4），无重复；wire id/别名零变化
- @manual 计数预期：0（Wired manual host-copy，ledger/ledger.md:69）
- 删除面：无；冻结面（handshake.ts / CAP_HOST_WIRED_IDS / CAP_SETTINGS_WIRE_METHODS / build-bridge 转义段 / capir/ / capcontract/ / ledger/ / provisioner / provenance.json）零 diff
- 证据目录：`.proof/b1-s1-adapter/`

> **never edited after capture**：本文件正文在证据捕获前落盘，捕获后不回改。若事后追加裁决附则，仅在该日期以「附则」段落追加，不修改正文断言。
>
> **成文方式声明**：本文件一次性成文（非逐节顺写）；各 E 行按 E1→E7 顺序编号，无逐节时间戳冒充。

## 一、机器可判 Expected（E1–E7，环境无关）

> W5-CE 4.2 禁环境依赖子句：以下判定式全部基于 synthetic mock host service / 源码 diff / 门禁命令输出，
> 不含 `present=true` 类运行时状态断言。A1「真机 dsh-base 挂载 config-editor+settings 且 ctx.get('settings') 可解析」
> 在本仓测试环境不可复现，列入 NOT RUN（见第四节），不混入 E 行 pass criterion。

| # | assertion | expected (FROZEN) | pass criterion（机器可判、环境无关） | changed path | level | evidence file | depends on |
|---|---|---|---|---|---|---|---|
| E1 | 在场：synthetic host `settings` 服务暴露 describe/mutate，arm 调用宿主而非本地 | `settings.describe` 返回宿主 stub 的 `{writable,hasDocument,namespaces}` 投影；`settings.mutate(ns,ops,rev)` 原样转发到宿主 stub | 单测断言宿主 stub 被调用（spy 计数 1）、返回值逐字段等于投影结果；namespaces 字段集严格 `{ns,revision,schema,value,base,user,applies,secrets}`，secret 仅 `{path,set}` | `packages/bridge/src/settings-adapter.ts`(new)、`packages/bridge/src/index.ts`、新单测 | unit | `04-adapter-three-state.log` | — |
| E2 | 缺席：无 controller 且无 host settings | arm 抛出现有字面量 `NOT_WIRED: settingsController unavailable for <id>`；客户端 LocalSettingsStore 路径逐字节不变 | 单测断言 error.message 严格匹配既有字符串；`git diff --exit-code` 对 `packages/shell/src/client/bridge-session-seam.ts` + `local-config-faces.ts` 为 0（本刀不碰客户端 seam） | bridge arm + 单测 | unit | `04-adapter-three-state.log` | — |
| E3 | 宿主调用抛错：host settings 在场但 describe/mutate 抛错 | 错误原样上抛（不吞、不改写、不新增 NOT_WIRED 文案）；适配器源码 `NOT_WIRED` 字面量计数为 0 | 单测断言 `rejects.toThrow(originalMessage)` 且错误 name/code 未被重写；`grep -c 'NOT_WIRED' packages/bridge/src/settings-adapter.ts` 结果为 0（文件不存在计 0） | settings-adapter.ts + 单测 | unit | `04-adapter-three-state.log` | E1 |
| E4 | 冻结面计数零变化 | `CAP_HOST_WIRED_IDS.length === 28` 且无重复；settings arm 仍位于 credentials arm 之前；冻结文件 git diff 为 0 | 既有 capcontract 单测全绿；`git diff --quiet HEAD -- <冻结文件清单>` 退出码 0；`grep` 确认 settings 分支行号 < credentials 分支行号 | index.ts（arm/resolver 缝） | unit+gate | `02-gate-full.log`、`04-adapter-three-state.log` | — |
| E5 | capcontract 门禁 + ledger 字节一致 | `node scripts/check-capcontract.mjs` 全项 ok；`node scripts/gen-ledger.mjs --check` 报告字节一致（生成物零 diff） | 两命令退出码 0，输出含全 ok / 一致关键字；`git diff --quiet HEAD -- capir/ capcontract/ ledger/` 退出码 0 | 无（生成物） | gate | `02-gate-full.log`、`03-regen.log` | E4 |
| E6 | 受影响 bun test 全绿，且既有 settings arm 测试断言未被改动 | bridge + shell 受影响测试全部 PASS；既有测试文件的断言字面量零改动 | `bun test packages/bridge/test packages/shell/test` 相关子集退出码 0；`git diff --exit-code` 对既有测试文件（capcontract-model / capcontract-credentials / cap-generic-arm 等）为 0（新单测为新增文件，不算改动既有断言） | 新单测文件 | unit | `04-adapter-three-state.log` | E1,E2,E3 |
| E7 | typecheck:entry 绿 | `pnpm typecheck:entry` 退出码 0 | 命令退出码 0，无 TS 错误 | bridge src | typecheck | `05-typecheck.log` | E1 |

## 二、门禁预期

- `node scripts/check-capcontract.mjs`：预期全项 ok（含 #10 dispatch executability：bridge 仍 import binder、仍含 NOT_WIRED 路径、wired registry 与 ledger in_wired 28/257 一致；#16 generic wire table 31 adapters 不变）。
- `node scripts/gen-ledger.mjs --check`：预期生成物字节一致（无新 id，settings 两个 id 已在 wired 集合，expected 集不变）。
- `bun test`（bridge + shell 受影响子集）：预期全绿。
- `pnpm typecheck:entry`：预期全绿。
- 任一项非一致 → 立即停车汇报，不修生成物、不自放宽 criterion。

## 三、USER-JUDGMENT 预案（≤5 项，记录 + 推荐默认，不进技术门禁）

1. `hasDocument` 取值：推荐 `true`（与控制器硬编码 `true` 对齐，见设计 §8.1.3）。理由：bridge 无 fs 依赖，避免环境耦合；二选一已定，写进适配器契约注释。
2. 适配器文件名：推荐 `settings-adapter.ts`（任务书示例名）。纯命名，不影响断言。
3. secret 投影宽度：推荐 `{path,set}` 严格 allow-list（与设计 §3.1 一致）。理由：零 secret 值落 wire。
4. 宿主方法缺失时错误前缀：推荐非 NOT_WIRED 的 `HOST_UNAVAILABLE:` 描述性错误。理由：满足 E3「不新增 NOT_WIRED 文案」，且诚实区分「宿主在场但方法缺失」与「宿主缺席」。

## 四、NOT RUN 声明（如实，不自称全项 PASS）

- **N1 真机 A1 复核**：`ctx.get('settings')` 在 inproc 宿主中可解析、describe/mutate 真值热生效（改 `maxActiveSubagents` 3→5 即时生效、派发验证、重启持久化）→ 留给 S8 收口刀。本刀测试环境不可复现（本仓未安装 dsh-settings/dsh-base 源码，无真机 inproc 宿主），仅以 synthetic mock host service 覆盖逻辑。
- **N2 冲突码修复（Q6）**：设计 §3.4 指出的「bridge 按 message 正则 /conflict/i 判冲突，而 SettingsConflictError 文案无 conflict 词」缺陷位于 `index.ts:4486-4492` stdio 帧处理，超出本刀 S0 范围（解析器缝回退 + arm 换名 + 单测），不在本刀修复；登记为后续切片。
- **N3 provisioner 持久化合并（S3）**、**客户端 seam 路由（S4）**、**面板/agents 显示（S5/S6）**、**门禁阶梯 real-client-gate/pack（S7）**：均为后续刀，本刀不涉及。

## 五、S0 红线自查（实现期逐条核对）

- 范围仅：解析器缝回退 + arm 调用点换名 + 适配器文件 + 单测。
- 不碰：handshake.ts、CAP_HOST_WIRED_IDS、CAP_SETTINGS_WIRE_METHODS、build-bridge 转义段、capir/、capcontract/ 生成物、provisioner、provenance.json。
- settings arm 保持位于 credentials arm 之前（共享包前缀，现有注释 :1258 载明）。
- 适配器不新增任何 NOT_WIRED 文案串。
- A1 用 mock host service 覆盖逻辑，真机复核留收口刀（见 N1）。
