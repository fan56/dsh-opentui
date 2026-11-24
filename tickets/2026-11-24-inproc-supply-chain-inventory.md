# T12 供给链退役：全量引用盘点与删除清单

- 日期：2026-11-24
- 仓库：`/Users/qingguee/repo/dsh-opentui-wt-inproc-only`
- 分支：`feat/inproc-only-1124`
- 性质：只读调查；未修改源码、测试、CI；未执行测试、git add/commit。调查期间有其他并发改动 inproc companion catalog/query 与测试；本清单行号以最终检索时的 worktree 为准。
- 调查时 worktree 已有未提交改动（CI、migration、inproc provision、若干测试与未跟踪票面）；本文件不触碰它们。

## 1. 口径与总量

检索覆盖 git 已跟踪文件的源码、package/build、CI、测试、e2e/verify、README/docs/tickets/research、fixture/字符串，以及 `.proof/**` 历史机器证据。`bun.lock`/`pnpm-lock.yaml`/`package-lock.json` 命中为 0；两个未跟踪相关文件（`tickets/2026-11-24-inproc-only-review-oldfox-4.md`、`packages/shell/test/approval-policy-template.test.ts`）命中为 0。

候选检索式：`provision-opentui-profile`、`upgrade.mjs`/`runUpgrade`、`parseUpgradeArgs`/`formatUpgradeUsage`/`UPGRADE_DEFAULT_TAG`、`dsh-opentui upgrade`、`upgrade-plan`、`upgrade-overrides`、`provision-plan`、`provision-state`、`e2e-sweep`、`e2e-client`、`companion-policy`、`inproc-companions`、`dsh-model-sync`、launcher `--force`/`--yes` 及其冲突符号。

- **唯一引用点合计：1337 个 `文件:行`，分布于 79 个文件。** 同一行命中多个候选只计一次。
- 非 `.proof` 的现行/历史引用：**633**；`.proof` 生成证据：**704**。
- 分类：**可直接删除 200**；**需先改引用 111**；**需保留 1026**。
- 第 6 节另列“老 profile 名字”导致的运行期/门禁耦合；这些点不属于上述候选符号检索式，不重复计入 1337。

## 2. 关键结论

1. 任务所述“`launcher.mjs` step 3 / step 6a”与当前分支不符：**旧 profile 预供给在 `packages/shell/bin/dsh-opentui.mjs:280-315`（step 3）**；当前 `launcher.mjs` 只保留 argv/help/upgrade 纯逻辑。分支内**没有 step 6a HTTP host 预启**，`bin/dsh-opentui.mjs:46-51` 明确说明只 provision + spawn bun client。
2. `provision-plan` 的 pin **没有被 inproc 路径 import**。`provision-inproc-profile.mjs:138-145` 只 import `inproc-companions.mjs`；后者 `:21` 只 import `companion-policy.mjs`。可以删旧 pin，但必须先删旧 provisioner 与 upgrade 两个消费方。
3. `--force`/`--yes` 当前是**已接线 parser + warning/conflict，但无 kill/reset 副作用**。help 与测试锁定该契约；不能当作无引用死参数直接删。
4. legacy `e2e-client.mjs`/`e2e-sweep.mjs` 仍 import 三个 T9 HTTP stub；stub 构造器会直接抛错。它们不是可用的 inproc e2e。
5. 两个最大耦合风险：**旧 profile 迁移目标/顺序**；**老 profile 名字仍驱动真机门禁 seed 与 repair 进程判定**。详见第 7 节。

## 3. 三组处理表

### A. 可直接删除

| 文件:行 | 引用类型 | 处理动作 | 耦合风险 |
|---|---|---|---|
| `packages/shell/scripts/provision-opentui-profile.mjs:1-806` | 旧 profile provisioner 本体；`:81-103` import `provision-plan` | 整文件删除 | 删除前必须先移除 bin step 3；否则 spawn 失败且 launcher exit 1 |
| `packages/shell/scripts/lib/provision-plan.mjs:1-899` | 旧 pin/override/plugin 规划；`:29-102` pin 表，`:67-70` model-sync pin | 整文件删除 | 旧 provisioner、`upgrade.mjs:55-61`、`upgrade-plan.mjs:15` 都 import；不能先删 |
| `packages/shell/scripts/lib/provision-state.mjs:1` 及全文 | 旧 provisioner 的重试状态；被 `provision-plan.mjs:13` import | 随旧 provisioner 删除 | 与 inproc `provision-run-lock.mjs` 不是同一模块，勿误删 |
| `packages/shell/scripts/upgrade.mjs:1-1149` | upgrade 本体；`:54-74` import launcher/plan | 整文件删除 | 唯一运行期消费者是 bin `:159-160` |
| `packages/shell/scripts/lib/upgrade-plan.mjs:1` 及全文 | upgrade 规划；`:15` import `provision-plan` | 随 upgrade 同提交删除 | 删除 upgrade 后无生产消费方 |
| `packages/shell/scripts/e2e-client.mjs:1-1121` | legacy HTTP topology e2e；`:383-385` import 三个 stub | 整文件删除 | 删除 stub 前必须先删本脚本 |
| `packages/shell/scripts/e2e-sweep.mjs:1-932` | legacy HTTP command sweep；`:116-118,351-353` import 三个 stub | 整文件删除 | 当前 `ensureHost` stub 会抛错，不是有效门禁 |
| `packages/shell/test/provision-script.test.ts:1` 及全文 | 旧 provisioner 真 wiring | 整文件删除 | spawn 目标消失 |
| `packages/shell/test/provision-plan.test.ts:1` 及全文 | 旧 plan/pin/override 单测 | 整文件删除 | import 目标消失 |
| `packages/shell/test/provision-state.test.ts:1` 及全文 | 旧重试状态单测 | 随 helper 删除 | import 目标消失 |
| `packages/shell/test/upgrade-run.test.ts:1` 及全文 | `runUpgrade` 行为/exit code | 整文件删除 | import `upgrade.mjs` |
| `packages/shell/test/upgrade-apply.test.ts:1` 及全文 | upgrade 写盘/备份/回滚 | 整文件删除 | import `upgrade.mjs`/`provision-plan` |
| `packages/shell/test/upgrade-plan.test.ts:1` 及全文 | upgrade-plan 单测 | 整文件删除 | import `upgrade-plan`/`provision-plan` |
| `packages/shell/test/bin-upgrade-args.test.ts:1` 及全文 | upgrade argv/help 契约 | 整文件删除 | 与 launcher upgrade 符号同提交 |
| `packages/shell/bin/dsh-opentui.mjs:117-160` | upgrade 分发、错误分支、lazy import | 删分支；文件保留 | help/exit code/test 联动 |
| `packages/shell/bin/lib/launcher.mjs:562-683` | `UPGRADE_DEFAULT_TAG`、`parseUpgradeArgs`、`formatUpgradeUsage` | 删符号；文件保留 | bin import 与 upgrade 测试同步 |

### B. 需先改引用

| 文件:行 | 引用类型 | 处理动作 | 耦合风险 |
|---|---|---|---|
| `packages/shell/bin/dsh-opentui.mjs:21,280-315` | step 3 文档、旧 profile 参数转发、spawn | 删旧预供给；旧参数契约另行收口 | `--provider/--model/--reasoning-effort/--plugins/--dry-run` 目前只服务旧 provisioner |
| `packages/shell/bin/dsh-opentui.mjs:285,336-414` | `opentuiProfileDir` 与 legacy preference migration 写入目标 | 先确定迁移归属/顺序，再删旧目录引用 | inproc provisioner 已在 `:1572` 前执行 migration；bin 之后又写旧 `opentui`，可能漏迁/重建旧 profile |
| `packages/shell/bin/lib/launcher.mjs:43,405-448` | `PROFILE='opentui'`、`classifyProcess` host 判定 | 随旧 HTTP profile 退役调整 | `--repair-bridge` 的 stale sweep 只认 `--profile opentui`，不认 inproc host |
| `packages/shell/bin/lib/launcher.mjs:112-127,254,323-327` | 旧 provisioning flags allowlist/value-taking/help | 与 step 3 同提交改/删 | inproc client 只解析 `--new/--resume-last/--session`，其余忽略 |
| `packages/shell/test/bin-launcher.test.ts:1` 及全文相关段 | launcher parser/help/conflict/async harness | 同步改；不删整文件 | harness `:676-738` 依赖 `--dry-run` 与旧 scripts tree |
| `README.md:52-111,127-188,206,225,268,359-379` | upgrade、双 profile、旧插件表、legacy e2e 文档 | 更新现行文档 | 用户可见契约；不能只删代码 |
| `docs/verification-gates.md:39,105,120` | 旧 provisioner/真机 profile 前置 | 更新现行门禁说明 | 老 profile 不再是 fresh install 产物 |
| `.github/workflows/ci.yml:80,88,94,129-140` | e2e 注释、real-client 老 profile 前置 | 改注释与 preflight | clean runner 将不再有 `profiles/opentui` |
| `scripts/test-tier.mjs:22,139-140,191` | ui/e2e 默认老 profile 与 smoke profile | 先改 seed/preflight | 否则 ui/e2e exit 2，CI 可能假绿 |
| `scripts/real-client-gate.sh:125-126,156,224,231` | 老 host 清理、preflight、seed | 先改 seed | inproc 握手本身不依赖老 profile，但 gate 前置依赖 |
| `e2e/families/lib/family-lib.sh:39` | family scratch seed | 先改 seed | 缺老 profile 时当前 `|| true` 会静默缺配置 |
| `verify/agents-mount-repro.mjs:49,192,207,211,247,335,686` | 老 profile preflight/seed/config/patch/lock | 先改 seed 与 lock 判定 | 当前还混用 inproc patch 分支 `:706` |
| `verify/ui-matrix.mjs:53,103,272,276,296-297,359` | 老 profile seed/config/patch/lock | 先改 seed 与 lock 判定 | fresh 环境不可跑 |
| `verify/text-leak-audit.mjs:66,134,193,208,244,252` | 老 profile seed/config/patch/lock | 先改 seed 与 lock 判定 | fresh 环境不可跑 |
| `verify/queue-flush-repro.mjs:30,58,73,79` | 老 profile seed/lock | 先改 seed 与 lock 判定 | fresh 环境不可跑 |
| `verify/steer-queue-repro.mjs:41,75,90,99,113,132` | 老 profile seed/config/patch/lock | 先改 seed 与 lock 判定 | fresh 环境不可跑 |
| `verify/w1a-six-commands.mjs:23,37,44-45,57` | 老 profile preflight/seed/config/patch | 先改 seed | 缺 profile 直接 exit 2 |
| `verify/e2e-flows/setup-home.mjs:8,37-38,47,54,57,61,114,135` | 以老 profile 为模板 | 先改 fixture/seed | 不能静态假 profile；需真 provisioner 到 scratch HOME |
| `verify/e2e-flows/run-flows.mjs:31,70,201,389,410` | 老 profile preflight/lock/config | 先改 seed 与 lock 判定 | 默认 e2e tier 会失效 |
| `scripts/verify-s1-model-ans.mjs:20,33,42,61` | 老 profile preflight/seed/config | 先改 seed | fresh 环境不可跑 |
| `scripts/verify-sk-keymap-ans.mjs:32,46,59,85` | 老 profile preflight/seed/config | 先改 seed | fresh 环境不可跑 |
| `packages/shell/test/agents-mount-client.test.ts:35-36` | real-client 老 profile 前置 | 与 CI preflight 同步改 | self-hosted job 直接失败 |
| `packages/shell/scripts/provision-inproc-profile.mjs:194,584` | 模板注释残留旧 provisioner 名 | 仅改文案 | 非运行期耦合 |
| `verify/agents-mount-repro.mjs:8,202` | 注释引用 `e2e-sweep` | 随 legacy e2e 删除更新 | 非运行期耦合 |
| `packages/shell/package.json:14-16` | `files: ["bin","scripts",...]` 通配打包 | 无需改 manifest；删文件后自然不发布 | 无逐文件引用；prepack `:28` 也不调用退役脚本 |
| `packages/shell/test/client-fakes.ts:5`；`packages/shell/test/remote-session-ops.test.ts:17` | HTTP stub 类型/未使用 runtime import | 删 `transport.ts` 前先迁移/删除这些 import | 否则测试编译/加载失败 |

### C. 需保留

| 文件:行 | 引用类型 | 处理动作 | 耦合风险 |
|---|---|---|---|
| `packages/shell/scripts/lib/companion-policy.mjs:1-16` | inproc 默认 companion ID 表 | 保留 | 被 `inproc-companions.mjs:21` 与 fresh-home verifier 消费 |
| `packages/shell/scripts/lib/inproc-companions.mjs:42-120,177-303` | inproc catalog/range/latest 决策 | 保留 | 不 import `provision-plan`；与旧 pin 表数据重复但无代码耦合 |
| `packages/shell/scripts/provision-inproc-profile.mjs:138-145,924-1033` | inproc companion 安装/readback | 保留 | 版本来源见第 5 节 |
| `packages/shell/test/inproc-companions.test.ts:1` 及全文 | inproc latest/range/no-downgrade 契约 | 保留 | 删除旧 pin 不应改这些期望 |
| `packages/shell/test/provision-inproc-companions.test.ts:1` 及全文 | 真 provisioner companion wiring | 保留 | 验证 exact latest/`@latest` fallback |
| `packages/shell/test/fresh-home-provision.test.ts:1` 及全文；`scripts/verify-fresh-home-provision.mjs:1` 及全文 | shipped companion policy/catalog gate | 保留 | 明确依赖 `companion-policy.mjs`/`inproc-companions.mjs` |
| `packages/shell/bin/lib/launcher.mjs:64-103,291-306,317-318`；`packages/shell/bin/dsh-opentui.mjs:81-115,275-278` | launcher `--force/--yes` 现状契约 | 保留至另行决策；若删除必须同步 help/tests | 当前有 warning/conflict/exit code 测试 |
| `packages/shell/test/bin-launcher.test.ts:377-413,423-441,746-756` | `--force/--yes` conflict/help/退出码锁定 | 保留 | 是“不可直接删参数”的直接证据 |
| `CHANGELOG.md`、`docs/adr/**`、`research/**`、`tickets/**`、`.proof/**` 的第 8 节命中 | 历史发布/决策/调研/机器证据 | 保留原文 | 可能含旧行号/旧语义；不重写历史 |
| `packages/shell/scripts/lib/migration.mjs:250,360`；`packages/shell/scripts/lib/migration-io.mjs:143`；`packages/shell/scripts/provision-inproc-profile.mjs:1397` | 老 profile 作为迁移来源 | 保留 | D5 决议保留旧目录；删供给链不等于删用户旧 profile |

## 4. `--force` / `--yes` 的真实语义（只列事实）

| 调用 | 当前行为 | 证据 |
|---|---|---|
| `--force` | parser 消费；非 `--version` 调用 stderr 警告一次；**不 kill/reset**；继续正常 launch，最终沿用 bun child exit code | `launcher.mjs:86-89`；`bin/dsh-opentui.mjs:100-102,275-278`；`bin-launcher.test.ts:746-756` |
| `--yes` | parser 消费；单独使用先 warning，再 `yes-without-force`，exit 2 | `launcher.mjs:96-99,302-305`；`bin/dsh-opentui.mjs:100-110`；`bin-launcher.test.ts:406-412` |
| `--force --yes`（任意顺序） | 允许；warning 一次；继续正常 launch | `bin-launcher.test.ts:746-756` |
| `--repair-bridge --yes` | 允许；不输出 reserved warning；`yes` 不被 repair 分支读取；repair 自己做当前 DSH_HOME 的 stale sweep + inproc `--repair` | `launcher.mjs:298-300`；`bin/dsh-opentui.mjs:97-100,224-245` |
| `--repair-bridge --force` | warning 后 `repair-force`，exit 2 | `bin/dsh-opentui.mjs:100-114`；`bin-launcher.test.ts:377-403` |
| `--force upgrade` | warning 后拒绝，exit 2 | `bin/dsh-opentui.mjs:131-134`；随 upgrade 退役一起消失 |
| `upgrade --yes` / `-y` | upgrade 自己的“跳过确认”语义，非 launcher reserved flag | `launcher.mjs:617-618,670`；`upgrade-run.test.ts:727-783`；随 upgrade 退役 |
| `-- --force` / `-- --yes` | standalone `--` 后原样 passthrough，不由 launcher 消费 | `launcher.mjs:59-61,73-80`；`bin-launcher.test.ts:303-310` |
| `--version --force` | version 绝对短路，exit 0，不打印 reserved warning | `bin/dsh-opentui.mjs:87-102`；`bin-launcher.test.ts:38-39` |

删除影响（事实推断，非产品建议）：

- help 文本明确列出两个 reserved flag（`launcher.mjs:317-318`），测试要求包含（`bin-launcher.test.ts:423-441`）。
- 直接删 parser/known flag 后，`--force` 从“警告后继续”变成 unknown option/exit 2；`--force --yes`、`--repair-bridge --yes` 的现有成功路径也会变；`--yes` 单独使用仍是 exit 2，但文案/冲突路径会变。
- README 没有正常 launcher flags 表，只让用户看 `--help`（`README.md:50`）；CHANGELOG/ADR 中描述的是历史 kill 语义，与当前 no-op 不同。
- `tickets/2026-11-24-inproc-D3-teardown.md:38-54` 记录了拟议的全用户进程 kill/清锁语义，但当前代码未实现；本报告不据此改变现状分类。

## 5. `provision-plan` pin 与 inproc 耦合；companion 版本来源

### 5.1 是否有 import 耦合

**没有。**

- `provision-inproc-profile.mjs:138-145` 只 import `./lib/inproc-companions.mjs`。
- `inproc-companions.mjs:21` 只 import `./companion-policy.mjs`。
- `companion-policy.mjs:4-16` 只有默认 ID；catalog/range 在 `inproc-companions.mjs:42-120`。
- 旧 pin 的消费方只有：`provision-opentui-profile.mjs:81-103`、`upgrade.mjs:55-61`、`upgrade-plan.mjs:15`，以及对应旧测试。
- `@aiwayds/dsh-model-sync` 在旧 pin 表 `provision-plan.mjs:67-70` 与 inproc catalog `inproc-companions.mjs:72-76` 各有一份；这是**数据重复**，不是引用。删旧 pin 不会改变 inproc 的 `^0.10.0` guard。
- 同理，`provision-state.mjs` 是旧链路 helper；inproc 使用的是 `provision-run-lock.mjs`（`provision-inproc-profile.mjs:1237`）与 `profile-lock.mjs`（`:1236`），必须保留。

### 5.2 现状版本来源

1. 选择 roster：`DSH_OPENTUI_COMPANION_LATEST` 默认开启，只有 `0/false/off` 关闭；`DSH_OPENTUI_COMPANIONS` 可替换默认 ID，支持 `none/all`（`inproc-companions.mjs:29-32,122-149`）。
2. 当前已装版本：读 scratch/profile `node_modules/<pkg>/package.json`（`provision-inproc-profile.mjs:840-846`）。
3. 目标版本：对有界并发批次执行 `npm view <name> dist-tags --json`，取 `latest`；单包 timeout 9 秒、总预算 20 秒、并发 4（`inproc-companions.mjs:25-27,224-303`；`provision-inproc-profile.mjs:936-944`）。
4. 安装 spec：可解析 latest 且通过 range guard 时装 exact `pkg@<resolved>`；查询失败且未安装时用 `pkg@latest`；查询失败但已安装则保留（`:170-210`）。
5. 不降级：已装版本等于/高于 latest 时 skip（`:203-208`）。
6. 写入方式：`dsh plugin --profile opentui-inproc add ...specs`（`provision-inproc-profile.mjs:1001-1006`），随后 readback（`:1020-1033`）。
7. registry 来源：`npm view` 只传 cwd/env，不传 `--registry`；因此沿用 npm 自身配置（profile `.npmrc`、用户 `.npmrc`、npm 环境变量）。inproc 代码**没有** `DSH_UPGRADE_REGISTRY` 分支。

### 5.3 现状缺口（不设计方案）

- 旧 pin/override 退役后，companion 没有仓库内固定版本；目标是移动的 npm `latest`，仅由 catalog `declaredRange` 阻止跨 major（0.x 跨 minor）。
- latest 超出 range 时永久 skip，直到 catalog range 更新；没有显式 upgrade 命令兜底。
- 当前已改为有界并发查询（并发 4、总预算 20 秒、单包 9 秒）；但预算耗尽/失败仍进入 `@latest` 或 skip 分支，版本目标依旧非固定。
- 没有旧 upgrade 的 `upgrade-overrides.json`、profile backup、rollback；companion 失败只 WARN/清理半写声明。
- fresh profile + registry 不可解析时安装 `@latest`，最终仍由 pnpm/dsh 解析；不是可复现固定版本。
- inproc catalog 与旧 pin 表当前重复维护；旧表删除后只剩 inproc 这一份版本约束真源。

## 6. 老 profile 名字造成的额外运行期/门禁耦合

这些点不在候选符号检索式中，单列如下；删除旧 provisioner 前必须处理，否则“代码删了但 fresh 机器门禁/迁移仍找 `opentui`”。

| 文件:行 | 引用类型 | 处理动作 | 耦合风险 |
|---|---|---|---|
| `packages/shell/bin/lib/launcher.mjs:43,434-435` | repair stale sweep 的 profile 常量/匹配 | 改判定或保留兼容 | 当前只把 `dsh --profile opentui` 识别为 host；inproc host 不匹配 |
| `packages/shell/bin/dsh-opentui.mjs:285,359,406,413` | 旧 profile migration 写入目标 | 与 inproc migration 统一归属 | 可能重新创建旧 profile 或漏迁 preference |
| `.github/workflows/ci.yml:88,94,134` | real-client 前置老 profile | 改 preflight/seed | clean self-hosted runner 缺目录即 fail |
| `scripts/test-tier.mjs:22,139-140,191` | ui/e2e 默认 profile | 改 seed/preflight | ui/e2e exit 2 |
| `scripts/real-client-gate.sh:224,231` | preflight/seed | 改 seed | 真机 gate 失效 |
| `e2e/families/lib/family-lib.sh:39` | family seed | 改 seed | `|| true` 静默缺配置 |
| `verify/agents-mount-repro.mjs:49,192,207` | preflight/seed | 改 seed | 真机 gate 失效 |
| `verify/ui-matrix.mjs:53,103,272` | preflight/seed | 改 seed | 真机 gate 失效 |
| `verify/text-leak-audit.mjs:66,134,193` | preflight/seed | 改 seed | 真机 gate 失效 |
| `verify/queue-flush-repro.mjs:30,58,73` | preflight/seed | 改 seed | 真机 gate 失效 |
| `verify/steer-queue-repro.mjs:41,75,90` | preflight/seed | 改 seed | 真机 gate 失效 |
| `verify/w1a-six-commands.mjs:23,37,44` | preflight/seed | 改 seed | 真机 gate 失效 |
| `verify/e2e-flows/setup-home.mjs:37-38,47,54` | 模板/scratch profile | 改 fixture/seed | 默认 e2e 失效 |
| `verify/e2e-flows/run-flows.mjs:31,70,410` | preflight/config | 改 seed | 默认 e2e 失效 |
| `scripts/verify-s1-model-ans.mjs:20,33,42` | preflight/seed | 改 seed | 真机 gate 失效 |
| `scripts/verify-sk-keymap-ans.mjs:32,46,59` | preflight/seed | 改 seed | 真机 gate 失效 |
| `packages/shell/test/agents-mount-client.test.ts:35-36` | 测试内 preflight | 与 CI 同步改 | real-client job fail |
| `packages/shell/scripts/lib/migration.mjs:250,360`；`packages/shell/scripts/lib/migration-io.mjs:143` | 老 profile 作为迁移来源 | 保留 | D5 决议旧目录保留；不是供给链删除对象 |

## 7. 最大两个耦合风险

1. **迁移数据归属与顺序**：bin 在 inproc provision 之后仍把 `profiles/dsh-opentui` 的偏好写到 `profiles/opentui/config.json`（`bin/dsh-opentui.mjs:336-414`），而 inproc provisioner 自己已从旧 `opentui`/`opentui-inproc` 读取并迁移（`provision-inproc-profile.mjs:1240-1241,1397`）。直接删旧 provisioner/`opentuiProfileDir` 会同时改变“谁创建目标、谁先迁移、最终配置落在哪个 profile”。这比 pin 表删除危险。
2. **老 profile 名字仍是运行期门禁与 repair 判定输入**：真机 gate 大量 preflight/seed `profiles/opentui`，同时 `launcher.mjs:43,434-435` 的 host 判定只认 `--profile opentui`。删供给链后，fresh 机器会出现“默认 CI 绿、真机 gate 零覆盖”，repair 的 stale sweep 也认不到 inproc host。必须与删旧 provisioner 同批或提前一批完成 seed/判定改造。

## 8. 删除顺序与建议提交批次

### 必须同一提交

- `upgrade.mjs` + `upgrade-plan.mjs` + bin upgrade 分支 + launcher upgrade parser/help/default tag + 四个 upgrade 测试文件 + README upgrade 段。
- 旧 provisioner + `provision-plan.mjs` + `provision-state.mjs` + 三个旧 provision 测试 + bin step 3 + 旧参数 allowlist/help/tests 收口。`provision-plan` 不能先于旧 provisioner 删。
- legacy e2e 两脚本 + HTTP 三 stub（`lifecycle.ts`、`transport.ts`、`remote-host-session.ts`）+ `client-fakes.ts`/`remote-session-ops.test.ts` import 修改 + 相关 README/CI/verify 注释。
- 真机 gate seed/preflight 改造与删旧 provisioner 同批，或严格前一批完成；不能后补。

### 建议批次（只划分，不执行）

1. **Batch 1 — legacy e2e / HTTP stub 退役**：删 `e2e-client`/`e2e-sweep` 与三个 stub；修测试类型/未使用 import；更新现行文档/注释。可独立于 profile 供给链。
2. **Batch 2 — upgrade 子命令退役**：删 upgrade 实现/plan/parser/tests/README。此批暂时保留 `provision-plan.mjs`，因为旧 provisioner 仍 import。
3. **Batch 3 — 旧 profile 供给链与门禁 seed 原子退役**：先带 D5 scratch-HOME 真 provisioner fixture/seed 改造，再同提交删旧 provisioner、pin/state/helper/tests、bin step 3、旧参数契约与 inproc 模板注释；同步 CI/test-tier/verify/e2e family。迁移目标与顺序在此批收口。
4. **Batch 4 — launcher `--force/--yes` 契约**：单独处理，不在 Batch 2/3 顺带删。若决定删除，需同步 parser/known flags/help/conflict/warning/退出码测试；若实现 D3 语义，还需同时改 host/provisioner 进程判定与清锁顺序。

历史 `CHANGELOG`、ADR、research、tickets、`.proof` 不批量改写；现行 README/docs 随对应批次更新。

## 9. 全量引用索引（1337 个唯一 `文件:行`）

说明：同一文件的同一候选聚合为一行；行号列是该候选的全部命中。A/B/C 与第 3 节一致。`.proof` 全部归 C，作为历史证据保留。

### A 可直接删除

| 文件:行 | 引用类型 | 处理动作 | 耦合风险 |
|---|---|---|---|
| `packages/shell/bin/dsh-opentui.mjs:131-132` | launcher --force/--yes | 删除 upgrade 分支/解析/help 符号；文件本身保留 | CLI 分发、help、exit code 与测试联动 |
| `packages/shell/bin/dsh-opentui.mjs:124, 133, 138, 143, 150, 155` | upgrade CLI/help | 删除 upgrade 分支/解析/help 符号；文件本身保留 | CLI 分发、help、exit code 与测试联动 |
| `packages/shell/bin/dsh-opentui.mjs:159-160` | upgrade.mjs/runUpgrade | 删除 upgrade 分支/解析/help 符号；文件本身保留 | CLI 分发、help、exit code 与测试联动 |
| `packages/shell/bin/lib/launcher.mjs:578, 580, 617, 670, 675` | launcher --force/--yes | 删除 upgrade 分支/解析/help 符号；文件本身保留 | CLI 分发、help、exit code 与测试联动 |
| `packages/shell/scripts/e2e-client.mjs:122, 382, 1034, 1092, 1118` | e2e-client | 整文件随旧 HTTP/profile 供给链删除 | 仅旧链路使用；需与消费方原子删除 |
| `packages/shell/scripts/e2e-sweep.mjs:346` | e2e-client | 整文件随旧 HTTP/profile 供给链删除 | 仅旧链路使用；需与消费方原子删除 |
| `packages/shell/scripts/e2e-sweep.mjs:5, 80, 500-501, 919` | e2e-sweep | 整文件随旧 HTTP/profile 供给链删除 | 仅旧链路使用；需与消费方原子删除 |
| `packages/shell/scripts/lib/provision-plan.mjs:67` | dsh-model-sync | 整文件随旧 HTTP/profile 供给链删除 | 仅旧链路使用；需与消费方原子删除 |
| `packages/shell/scripts/lib/provision-plan.mjs:1, 16` | provision-opentui-profile | 整文件随旧 HTTP/profile 供给链删除 | 仅旧链路使用；需与消费方原子删除 |
| `packages/shell/scripts/lib/provision-plan.mjs:9, 13, 465` | provision-state | 整文件随旧 HTTP/profile 供给链删除 | 仅旧链路使用；需与消费方原子删除 |
| `packages/shell/scripts/lib/provision-plan.mjs:355` | upgrade CLI/help | 整文件随旧 HTTP/profile 供给链删除 | 仅旧链路使用；需与消费方原子删除 |
| `packages/shell/scripts/lib/provision-plan.mjs:353, 356, 421` | upgrade-overrides | 整文件随旧 HTTP/profile 供给链删除 | 仅旧链路使用；需与消费方原子删除 |
| `packages/shell/scripts/lib/provision-state.mjs:1` | provision-opentui-profile | 整文件随旧 HTTP/profile 供给链删除 | 仅旧链路使用；需与消费方原子删除 |
| `packages/shell/scripts/lib/upgrade-plan.mjs:4, 10, 15, 439, 456` | provision-plan | 整文件随旧 HTTP/profile 供给链删除 | 仅旧链路使用；需与消费方原子删除 |
| `packages/shell/scripts/lib/upgrade-plan.mjs:295` | upgrade-overrides | 整文件随旧 HTTP/profile 供给链删除 | 仅旧链路使用；需与消费方原子删除 |
| `packages/shell/scripts/provision-opentui-profile.mjs:2, 393, 399, 404` | provision-opentui-profile | 整文件随旧 HTTP/profile 供给链删除 | 仅旧链路使用；需与消费方原子删除 |
| `packages/shell/scripts/provision-opentui-profile.mjs:28, 103` | provision-plan | 整文件随旧 HTTP/profile 供给链删除 | 仅旧链路使用；需与消费方原子删除 |
| `packages/shell/scripts/provision-opentui-profile.mjs:109, 161, 163, 495` | provision-state | 整文件随旧 HTTP/profile 供给链删除 | 仅旧链路使用；需与消费方原子删除 |
| `packages/shell/scripts/provision-opentui-profile.mjs:158, 489, 679` | upgrade CLI/help | 整文件随旧 HTTP/profile 供给链删除 | 仅旧链路使用；需与消费方原子删除 |
| `packages/shell/scripts/provision-opentui-profile.mjs:47` | upgrade CLI/help, upgrade-overrides | 整文件随旧 HTTP/profile 供给链删除 | 仅旧链路使用；需与消费方原子删除 |
| `packages/shell/scripts/provision-opentui-profile.mjs:160, 229` | upgrade-overrides | 整文件随旧 HTTP/profile 供给链删除 | 仅旧链路使用；需与消费方原子删除 |
| `packages/shell/scripts/upgrade.mjs:9, 1071` | launcher --force/--yes | 整文件随旧 HTTP/profile 供给链删除 | 仅旧链路使用；需与消费方原子删除 |
| `packages/shell/scripts/upgrade.mjs:61, 332` | provision-plan | 整文件随旧 HTTP/profile 供给链删除 | 仅旧链路使用；需与消费方原子删除 |
| `packages/shell/scripts/upgrade.mjs:86` | provision-state | 整文件随旧 HTTP/profile 供给链删除 | 仅旧链路使用；需与消费方原子删除 |
| `packages/shell/scripts/upgrade.mjs:54, 76, 95, 967` | upgrade CLI/help | 整文件随旧 HTTP/profile 供给链删除 | 仅旧链路使用；需与消费方原子删除 |
| `packages/shell/scripts/upgrade.mjs:18, 84, 348, 474, 496, 584, 642, 732, 866` | upgrade-overrides | 整文件随旧 HTTP/profile 供给链删除 | 仅旧链路使用；需与消费方原子删除 |
| `packages/shell/scripts/upgrade.mjs:74` | upgrade-plan | 整文件随旧 HTTP/profile 供给链删除 | 仅旧链路使用；需与消费方原子删除 |
| `packages/shell/scripts/upgrade.mjs:953` | upgrade.mjs/runUpgrade | 整文件随旧 HTTP/profile 供给链删除 | 仅旧链路使用；需与消费方原子删除 |
| `packages/shell/scripts/upgrade.mjs:2` | upgrade.mjs/runUpgrade, upgrade CLI/help | 整文件随旧 HTTP/profile 供给链删除 | 仅旧链路使用；需与消费方原子删除 |
| `packages/shell/test/bin-upgrade-args.test.ts:69, 116, 133-134, 141-142, 158` | launcher --force/--yes | 整文件随退役目标同提交删除 | import/断言目标消失；不能只删实现 |
| `packages/shell/test/bin-upgrade-args.test.ts:6-7, 9, 15, 22, 24-25, 29-31, 33, 37-38, 40, 44, 46, 71, 75-76, 78-80, 84, 88-89, 91-92, 96, 100, 107, 110, 114, 121, 124, 128, 132, 136, 149, 153, 155, 168` | upgrade CLI/help | 整文件随退役目标同提交删除 | import/断言目标消失；不能只删实现 |
| `packages/shell/test/bin-upgrade-args.test.ts:70, 118, 143` | upgrade CLI/help, launcher --force/--yes | 整文件随退役目标同提交删除 | import/断言目标消失；不能只删实现 |
| `packages/shell/test/provision-plan.test.ts:1, 433, 665, 676, 679, 682, 685, 688, 787` | provision-opentui-profile | 整文件随退役目标同提交删除 | import/断言目标消失；不能只删实现 |
| `packages/shell/test/provision-plan.test.ts:40` | provision-plan | 整文件随退役目标同提交删除 | import/断言目标消失；不能只删实现 |
| `packages/shell/test/provision-plan.test.ts:41` | provision-state | 整文件随退役目标同提交删除 | import/断言目标消失；不能只删实现 |
| `packages/shell/test/provision-plan.test.ts:711` | upgrade CLI/help | 整文件随退役目标同提交删除 | import/断言目标消失；不能只删实现 |
| `packages/shell/test/provision-plan.test.ts:712, 790` | upgrade-overrides | 整文件随退役目标同提交删除 | import/断言目标消失；不能只删实现 |
| `packages/shell/test/provision-script.test.ts:1, 20, 139, 157, 188, 233, 263` | provision-opentui-profile | 整文件随退役目标同提交删除 | import/断言目标消失；不能只删实现 |
| `packages/shell/test/provision-script.test.ts:17` | provision-plan | 整文件随退役目标同提交删除 | import/断言目标消失；不能只删实现 |
| `packages/shell/test/provision-script.test.ts:80` | provision-state | 整文件随退役目标同提交删除 | import/断言目标消失；不能只删实现 |
| `packages/shell/test/provision-script.test.ts:189` | upgrade CLI/help | 整文件随退役目标同提交删除 | import/断言目标消失；不能只删实现 |
| `packages/shell/test/provision-state.test.ts:17` | provision-state | 整文件随退役目标同提交删除 | import/断言目标消失；不能只删实现 |
| `packages/shell/test/upgrade-apply.test.ts:203` | launcher --force/--yes | 整文件随退役目标同提交删除 | import/断言目标消失；不能只删实现 |
| `packages/shell/test/upgrade-apply.test.ts:6, 19` | provision-plan | 整文件随退役目标同提交删除 | import/断言目标消失；不能只删实现 |
| `packages/shell/test/upgrade-apply.test.ts:1` | upgrade CLI/help | 整文件随退役目标同提交删除 | import/断言目标消失；不能只删实现 |
| `packages/shell/test/upgrade-apply.test.ts:15, 411, 466` | upgrade-overrides | 整文件随退役目标同提交删除 | import/断言目标消失；不能只删实现 |
| `packages/shell/test/upgrade-apply.test.ts:7, 215, 692, 729` | upgrade.mjs/runUpgrade | 整文件随退役目标同提交删除 | import/断言目标消失；不能只删实现 |
| `packages/shell/test/upgrade-plan.test.ts:6, 24, 436, 515` | provision-plan | 整文件随退役目标同提交删除 | import/断言目标消失；不能只删实现 |
| `packages/shell/test/upgrade-plan.test.ts:22` | upgrade-plan | 整文件随退役目标同提交删除 | import/断言目标消失；不能只删实现 |
| `packages/shell/test/upgrade-run.test.ts:728, 762` | launcher --force/--yes | 整文件随退役目标同提交删除 | import/断言目标消失；不能只删实现 |
| `packages/shell/test/upgrade-run.test.ts:14, 569` | upgrade-overrides | 整文件随退役目标同提交删除 | import/断言目标消失；不能只删实现 |
| `packages/shell/test/upgrade-run.test.ts:6` | upgrade-plan | 整文件随退役目标同提交删除 | import/断言目标消失；不能只删实现 |
| `packages/shell/test/upgrade-run.test.ts:7, 20-21, 164, 176, 219, 237, 256, 305, 350, 392, 463, 508, 549, 583, 604, 613, 634, 646, 674, 727, 738, 783` | upgrade.mjs/runUpgrade | 整文件随退役目标同提交删除 | import/断言目标消失；不能只删实现 |

### B 需先改引用

| 文件:行 | 引用类型 | 处理动作 | 耦合风险 |
|---|---|---|---|
| `.github/workflows/ci.yml:80` | e2e-client | 更新注释或门禁前置 | 真机门禁不能静默 skip |
| `README.md:170` | dsh-model-sync | 更新现行产品文档；历史段落不重写 | 用户可见 CLI/双 profile/upgrade 契约 |
| `README.md:363, 372` | e2e-client | 更新现行产品文档；历史段落不重写 | 用户可见 CLI/双 profile/upgrade 契约 |
| `README.md:362, 366` | e2e-sweep | 更新现行产品文档；历史段落不重写 | 用户可见 CLI/双 profile/upgrade 契约 |
| `README.md:67, 110` | launcher --force/--yes | 更新现行产品文档；历史段落不重写 | 用户可见 CLI/双 profile/upgrade 契约 |
| `README.md:54, 60-61, 103` | upgrade CLI/help | 更新现行产品文档；历史段落不重写 | 用户可见 CLI/双 profile/upgrade 契约 |
| `README.md:71, 81, 86` | upgrade-overrides | 更新现行产品文档；历史段落不重写 | 用户可见 CLI/双 profile/upgrade 契约 |
| `docs/verification-gates.md:105` | provision-opentui-profile | 更新现行门禁说明 | 旧 provisioner 已不作为入口 |
| `packages/shell/bin/dsh-opentui.mjs:8-9, 81-82, 85, 99-101, 107-109, 112-113, 225, 275` | launcher --force/--yes | 删 step 3 旧 profile 转发；旧 migration 目标另行收口 | `opentuiProfileDir` 仍被 legacy preference migration 写入 |
| `packages/shell/bin/dsh-opentui.mjs:21, 281, 305` | provision-opentui-profile | 删 step 3 旧 profile 转发；旧 migration 目标另行收口 | `opentuiProfileDir` 仍被 legacy preference migration 写入 |
| `packages/shell/bin/dsh-opentui.mjs:165` | upgrade CLI/help | 删 step 3 旧 profile 转发；旧 migration 目标另行收口 | `opentuiProfileDir` 仍被 legacy preference migration 写入 |
| `packages/shell/bin/dsh-opentui.mjs:64` | upgrade CLI/help, launcher --force/--yes | 删 step 3 旧 profile 转发；旧 migration 目标另行收口 | `opentuiProfileDir` 仍被 legacy preference migration 写入 |
| `packages/shell/bin/lib/launcher.mjs:3, 13, 54, 86, 94, 96, 242, 297-299, 302-304, 317-318, 572, 585` | launcher --force/--yes | launcher `--force/--yes` 现状保留；若删除需同步 help/tests | 当前 help、conflict、warning、exit code 已被测试锁定 |
| `packages/shell/bin/lib/launcher.mjs:563, 595, 600, 660, 662, 664, 666` | upgrade CLI/help | 删除 upgrade parser/default tag/usage | `bin/dsh-opentui.mjs` 与 upgrade 测试同步 |
| `packages/shell/bin/lib/launcher.mjs:674` | upgrade-overrides | 删除 upgrade parser/default tag/usage | `bin/dsh-opentui.mjs` 与 upgrade 测试同步 |
| `packages/shell/bin/lib/launcher.mjs:18` | upgrade.mjs/runUpgrade | 删除 upgrade parser/default tag/usage | `bin/dsh-opentui.mjs` 与 upgrade 测试同步 |
| `packages/shell/scripts/provision-inproc-profile.mjs:194, 584` | provision-opentui-profile | 仅更新模板注释中的旧脚本名 | 行为不变；避免误读为 inproc 依赖旧 provisioner |
| `packages/shell/test/bin-launcher.test.ts:1, 19, 33, 36, 38-40, 50-52, 55, 60, 64, 69, 157, 270, 303, 310, 320, 378-380, 383-386, 390-392, 397-398, 406-407, 410, 428-429, 503, 528, 599, 746, 748, 750` | launcher --force/--yes | 同步改断言/harness；不删整文件 | 同时覆盖 timeout、repair、client exit mapping 等保留能力 |
| `packages/shell/test/bin-launcher.test.ts:419, 477` | upgrade CLI/help | 同步改断言/harness；不删整文件 | 同时覆盖 timeout、repair、client exit mapping 等保留能力 |
| `packages/tui-base/src/feature-plugins/system/storybook/highlights.tsx:16` | launcher --force/--yes | 先改引用再删目标 | 存在运行期或文档消费 |
| `verify/agents-mount-repro.mjs:8, 202` | e2e-sweep | 更新注释或门禁前置 | 真机门禁不能静默 skip |

### C 需保留

| 文件:行 | 引用类型 | 处理动作 | 耦合风险 |
|---|---|---|---|
| `.proof/025-w3-2/01-legacy-retirement/takeover-table.md:9, 29` | provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/025-w3-2/01-legacy-retirement/takeover-table.md:10` | upgrade-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/b1-s4-s6/04-scoped-full.log:1026, 1084` | inproc-companions | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/b1-s4-s6/04-scoped-full.log:46, 48-49, 134-140, 615-616, 638, 653-654, 690-692` | launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/b1-s4-s6/04-scoped-full.log:1174-1177` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/b1-s4-s6/04-scoped-full.log:851, 1102` | provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/b1-s4-s6/04-scoped-full.log:1342` | provision-state | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/b1-s4-s6/04-scoped-full.log:1218-1221, 1223-1227, 1229-1230` | upgrade CLI/help | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/b1-s4-s6/04-scoped-full.log:1222, 1228` | upgrade CLI/help, launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/b1-s4-s6/04-scoped-full.log:812` | upgrade-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/b1-s4-s6/04-scoped-full.log:922-937, 939` | upgrade.mjs/runUpgrade | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/b1-s4-s6/04-scoped-full.log:938` | upgrade.mjs/runUpgrade, launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/b2c-tab-mount/01-main-24row.ans:5-7, 9` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/b2c-tab-mount/02-after-alt2-24row.txt:5-7, 9` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/b2c-tab-mount/10-compact-main-active.ans:5-7, 9` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/b2c-tab-mount/11-compact-todo-active.ans:5-7, 9` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/b2c-tab-mount/12-compact-main-back.ans:5-7, 9` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/b2c-tab-mount/20-framed-main-active.ans:5-7, 9` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/b2c-tab-mount/21-framed-todo-active.ans:5-7, 9` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/b2c-tab-mount/22-framed-main-back.ans:5-7, 9` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/b2c-tab-mount/30-focus-after-hide.ans:5-7, 9` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/batch-gate/step1-shell.out:991, 1049` | inproc-companions | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/batch-gate/step1-shell.out:46, 48-49, 134-140, 623-624, 646, 661-662, 698-700` | launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/batch-gate/step1-shell.out:1139-1142` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/batch-gate/step1-shell.out:859, 1067` | provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/batch-gate/step1-shell.out:1307` | provision-state | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/batch-gate/step1-shell.out:1183-1186, 1188-1192, 1194-1195` | upgrade CLI/help | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/batch-gate/step1-shell.out:1187, 1193` | upgrade CLI/help, launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/batch-gate/step1-shell.out:820` | upgrade-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/batch-gate/step1-shell.out:887-902, 904` | upgrade.mjs/runUpgrade | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/batch-gate/step1-shell.out:903` | upgrade.mjs/runUpgrade, launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate-2/02-shell.out:999, 1057` | inproc-companions | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate-2/02-shell.out:46, 48-49, 134-140, 631-632, 654, 669-670, 706-708` | launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate-2/02-shell.out:1147-1150` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate-2/02-shell.out:867, 1075` | provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate-2/02-shell.out:1315` | provision-state | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate-2/02-shell.out:1191-1194, 1196-1200, 1202-1203` | upgrade CLI/help | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate-2/02-shell.out:1195, 1201` | upgrade CLI/help, launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate-2/02-shell.out:828` | upgrade-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate-2/02-shell.out:895-910, 912` | upgrade.mjs/runUpgrade | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate-2/02-shell.out:911` | upgrade.mjs/runUpgrade, launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate-2/08-clean-clone.out:3369, 3427` | inproc-companions | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate-2/08-clean-clone.out:2416, 2418-2419, 2504-2510, 3001-3002, 3024, 3039-3040, 3076-3078` | launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate-2/08-clean-clone.out:3517-3520` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate-2/08-clean-clone.out:3237, 3445` | provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate-2/08-clean-clone.out:3685` | provision-state | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate-2/08-clean-clone.out:3561-3564, 3566-3570, 3572-3573` | upgrade CLI/help | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate-2/08-clean-clone.out:3565, 3571` | upgrade CLI/help, launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate-2/08-clean-clone.out:3198` | upgrade-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate-2/08-clean-clone.out:3265-3280, 3282` | upgrade.mjs/runUpgrade | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate-2/08-clean-clone.out:3281` | upgrade.mjs/runUpgrade, launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/08-clean-clone.out:3402, 3460` | inproc-companions | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/08-clean-clone.out:2436, 2438-2439, 2524-2530, 3021-3022, 3044, 3059-3060, 3096-3098` | launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/08-clean-clone.out:3550-3553` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/08-clean-clone.out:3257, 3478` | provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/08-clean-clone.out:3718` | provision-state | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/08-clean-clone.out:3594-3597, 3599-3603, 3605-3606` | upgrade CLI/help | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/08-clean-clone.out:3598, 3604` | upgrade CLI/help, launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/08-clean-clone.out:3218` | upgrade-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/08-clean-clone.out:3298-3313, 3315` | upgrade.mjs/runUpgrade | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/08-clean-clone.out:3314` | upgrade.mjs/runUpgrade, launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/final-2/03-full-shell.out:999, 1057` | inproc-companions | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/final-2/03-full-shell.out:46, 48-49, 134-140, 631-632, 654, 669-670, 706-708` | launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/final-2/03-full-shell.out:1147-1150` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/final-2/03-full-shell.out:867, 1075` | provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/final-2/03-full-shell.out:1315` | provision-state | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/final-2/03-full-shell.out:1191-1194, 1196-1200, 1202-1203` | upgrade CLI/help | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/final-2/03-full-shell.out:1195, 1201` | upgrade CLI/help, launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/final-2/03-full-shell.out:828` | upgrade-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/final-2/03-full-shell.out:895-910, 912` | upgrade.mjs/runUpgrade | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/final-2/03-full-shell.out:911` | upgrade.mjs/runUpgrade, launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/final-2/04-npm-pack.out:37` | e2e-client | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/final-2/04-npm-pack.out:38` | e2e-sweep | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/final-2/04-npm-pack.out:44` | inproc-companions | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/final-2/04-npm-pack.out:51` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/final-2/04-npm-pack.out:46` | provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/final-2/04-npm-pack.out:47` | provision-state | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/final-2/04-npm-pack.out:48` | upgrade-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/final-2/04-npm-pack.out:52` | upgrade.mjs/runUpgrade | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/final-2/05-full-shell.out:999, 1057` | inproc-companions | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/final-2/05-full-shell.out:46, 48-49, 134-140, 631-632, 654, 669-670, 706-708` | launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/final-2/05-full-shell.out:1147-1150` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/final-2/05-full-shell.out:867, 1075` | provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/final-2/05-full-shell.out:1315` | provision-state | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/final-2/05-full-shell.out:1191-1194, 1196-1200, 1202-1203` | upgrade CLI/help | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/final-2/05-full-shell.out:1195, 1201` | upgrade CLI/help, launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/final-2/05-full-shell.out:828` | upgrade-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/final-2/05-full-shell.out:895-910, 912` | upgrade.mjs/runUpgrade | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/final-2/05-full-shell.out:911` | upgrade.mjs/runUpgrade, launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/full-shell.out:1012, 1070` | inproc-companions | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/full-shell.out:46, 48-49, 134-140, 631-632, 654, 669-670, 706-708` | launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/full-shell.out:1160-1163` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/full-shell.out:867, 1088` | provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/full-shell.out:1328` | provision-state | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/full-shell.out:1204-1207, 1209-1213, 1215-1216` | upgrade CLI/help | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/full-shell.out:1208, 1214` | upgrade CLI/help, launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/full-shell.out:828` | upgrade-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/full-shell.out:908-923, 925` | upgrade.mjs/runUpgrade | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/final-gate/full-shell.out:924` | upgrade.mjs/runUpgrade, launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0271/02-shell.out:1002, 1060` | inproc-companions | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0271/02-shell.out:46, 48-49, 134-140, 634-635, 657, 672-673, 709-711` | launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0271/02-shell.out:1150-1153` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0271/02-shell.out:870, 1078` | provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0271/02-shell.out:1318` | provision-state | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0271/02-shell.out:1194-1197, 1199-1203, 1205-1206` | upgrade CLI/help | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0271/02-shell.out:1198, 1204` | upgrade CLI/help, launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0271/02-shell.out:831` | upgrade-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0271/02-shell.out:898-913, 915` | upgrade.mjs/runUpgrade | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0271/02-shell.out:914` | upgrade.mjs/runUpgrade, launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0271/08-clean-clone.out:3376, 3434` | inproc-companions | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0271/08-clean-clone.out:2420, 2422-2423, 2508-2514, 3008-3009, 3031, 3046-3047, 3083-3085` | launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0271/08-clean-clone.out:3524-3527` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0271/08-clean-clone.out:3244, 3452` | provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0271/08-clean-clone.out:3692` | provision-state | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0271/08-clean-clone.out:3568-3571, 3573-3577, 3579-3580` | upgrade CLI/help | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0271/08-clean-clone.out:3572, 3578` | upgrade CLI/help, launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0271/08-clean-clone.out:3205` | upgrade-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0271/08-clean-clone.out:3272-3287, 3289` | upgrade.mjs/runUpgrade | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0271/08-clean-clone.out:3288` | upgrade.mjs/runUpgrade, launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0272/02-shell.out:1002, 1060` | inproc-companions | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0272/02-shell.out:46, 48-49, 134-140, 634-635, 657, 672-673, 709-711` | launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0272/02-shell.out:1150-1153` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0272/02-shell.out:870, 1078` | provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0272/02-shell.out:1318` | provision-state | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0272/02-shell.out:1194-1197, 1199-1203, 1205-1206` | upgrade CLI/help | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0272/02-shell.out:1198, 1204` | upgrade CLI/help, launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0272/02-shell.out:831` | upgrade-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0272/02-shell.out:898-913, 915` | upgrade.mjs/runUpgrade | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0272/02-shell.out:914` | upgrade.mjs/runUpgrade, launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0272/10-npm-pack.out:37` | e2e-client | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0272/10-npm-pack.out:38` | e2e-sweep | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0272/10-npm-pack.out:44` | inproc-companions | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0272/10-npm-pack.out:51` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0272/10-npm-pack.out:46` | provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0272/10-npm-pack.out:47` | provision-state | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0272/10-npm-pack.out:48` | upgrade-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `.proof/release-gate-0272/10-npm-pack.out:52` | upgrade.mjs/runUpgrade | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `CHANGELOG.md:1181, 1185` | e2e-client | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `CHANGELOG.md:1175, 1179, 1212` | e2e-sweep | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `CHANGELOG.md:605-606, 618, 626, 635, 875` | launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `CHANGELOG.md:1236, 1240` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `CHANGELOG.md:735` | provision-state | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `CHANGELOG.md:737` | upgrade CLI/help | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `CHANGELOG.md:748` | upgrade CLI/help, upgrade-overrides | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `CHANGELOG.md:724, 752, 758` | upgrade-overrides | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `docs/adr/0009-server-lifecycle-singleton.md:62, 64-66, 90` | launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `packages/shell/scripts/lib/inproc-companions.mjs:13, 15, 21` | companion-policy | 保留 | inproc companion 路径独立于 provision-plan；同名 package/range 是数据重复而非 import |
| `packages/shell/scripts/lib/inproc-companions.mjs:72` | dsh-model-sync | 保留 | inproc companion 路径独立于 provision-plan；同名 package/range 是数据重复而非 import |
| `packages/shell/scripts/provision-inproc-profile.mjs:145` | inproc-companions | 保留 | inproc companion 路径独立于 provision-plan；同名 package/range 是数据重复而非 import |
| `packages/shell/test/bridge-failfast.test.ts:108` | inproc-companions | 保留 | inproc companion 路径独立于 provision-plan；同名 package/range 是数据重复而非 import |
| `packages/shell/test/fresh-home-provision.test.ts:39, 175, 401, 412` | companion-policy | 保留 | inproc companion 路径独立于 provision-plan；同名 package/range 是数据重复而非 import |
| `packages/shell/test/fresh-home-provision.test.ts:49` | dsh-model-sync | 保留 | inproc companion 路径独立于 provision-plan；同名 package/range 是数据重复而非 import |
| `packages/shell/test/fresh-home-provision.test.ts:65, 177` | inproc-companions | 保留 | inproc companion 路径独立于 provision-plan；同名 package/range 是数据重复而非 import |
| `packages/shell/test/host-compat.test.ts:157` | inproc-companions | 保留 | inproc companion 路径独立于 provision-plan；同名 package/range 是数据重复而非 import |
| `packages/shell/test/inproc-companions.test.ts:13` | companion-policy | 保留 | inproc companion 路径独立于 provision-plan；同名 package/range 是数据重复而非 import |
| `packages/shell/test/inproc-companions.test.ts:25` | inproc-companions | 保留 | inproc companion 路径独立于 provision-plan；同名 package/range 是数据重复而非 import |
| `packages/shell/test/provision-inproc-companions.test.ts:25` | companion-policy | 保留 | inproc companion 路径独立于 provision-plan；同名 package/range 是数据重复而非 import |
| `packages/shell/test/provision-inproc-companions.test.ts:24, 85, 269` | inproc-companions | 保留 | inproc companion 路径独立于 provision-plan；同名 package/range 是数据重复而非 import |
| `research/2026-11-24-inproc-only/01-provisioning.md:82` | dsh-model-sync | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/01-provisioning.md:64` | e2e-client | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/01-provisioning.md:28, 65` | e2e-sweep | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/01-provisioning.md:126` | e2e-sweep, e2e-client | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/01-provisioning.md:72` | inproc-companions | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/01-provisioning.md:108, 118` | launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/01-provisioning.md:12, 40-41, 60, 106, 134, 143` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/01-provisioning.md:42-45, 112` | provision-opentui-profile, provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/01-provisioning.md:22, 85` | provision-opentui-profile, provision-plan, inproc-companions | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/01-provisioning.md:46` | provision-opentui-profile, provision-state | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/01-provisioning.md:47` | provision-opentui-profile, upgrade.mjs/runUpgrade, upgrade CLI/help, upgrade-overrides, provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/01-provisioning.md:14` | provision-opentui-profile, upgrade.mjs/runUpgrade, upgrade-overrides, provision-state | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/01-provisioning.md:30, 68` | provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/01-provisioning.md:92` | provision-plan, e2e-sweep, e2e-client | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/01-provisioning.md:24, 94` | provision-plan, inproc-companions | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/01-provisioning.md:69` | provision-state | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/01-provisioning.md:70` | upgrade-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/01-provisioning.md:62, 116` | upgrade.mjs/runUpgrade, provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/01-provisioning.md:95` | upgrade.mjs/runUpgrade, provision-plan, inproc-companions | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/01-provisioning.md:20, 114` | upgrade.mjs/runUpgrade, upgrade-overrides, provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/02-http-host-residual.md:42, 96` | launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/03-references-and-gates.md:143, 219` | e2e-client | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/03-references-and-gates.md:144, 220` | e2e-sweep | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/03-references-and-gates.md:22, 100, 272` | e2e-sweep, e2e-client | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/03-references-and-gates.md:134` | inproc-companions | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/03-references-and-gates.md:75, 99` | launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/03-references-and-gates.md:72, 80, 257` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/03-references-and-gates.md:77, 131, 259` | provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/03-references-and-gates.md:133` | provision-state | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/03-references-and-gates.md:270` | provision-state, inproc-companions | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/03-references-and-gates.md:241` | upgrade-overrides | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/03-references-and-gates.md:79, 258` | upgrade.mjs/runUpgrade | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/03-references-and-gates.md:78` | upgrade.mjs/runUpgrade, provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/03-references-and-gates.md:101` | upgrade.mjs/runUpgrade, provision-plan, inproc-companions | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/04-dsh-app-web-profiles.md:15` | provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/04-dsh-app-web-profiles.md:104, 155` | upgrade-overrides | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/05-companion-parity.md:42` | dsh-model-sync | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/05-companion-parity.md:6` | inproc-companions | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/05-companion-parity.md:15-17, 45-53, 104-106, 108-109, 113, 133-138` | provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/06-patch-ownership-design.md:313` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/06-patch-ownership-design.md:904` | upgrade-overrides | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/2026-11-24-inproc-only/07-workspace-contract-design.md:13, 145, 153, 155, 157, 160, 183, 204` | inproc-companions | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/agents-command-survey.md:148` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/tui-pi-model-switch-parity.md:35, 107` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/ci-publish-survey.md:101` | launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/cli-and-profile-facts.md:382` | dsh-model-sync | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/cli-and-profile-facts.md:428` | e2e-sweep, e2e-client | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/cli-and-profile-facts.md:44, 55, 69` | launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/cli-and-profile-facts.md:70, 124-125, 206, 225, 227-228, 289, 302` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/cli-and-profile-facts.md:90` | provision-opentui-profile, launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/cli-and-profile-facts.md:15, 71, 412` | provision-opentui-profile, provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/cli-and-profile-facts.md:72, 123, 173, 176, 190-192, 218, 224, 301, 306, 311, 322, 390, 403, 470` | provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/implementation-plan.md:14, 41, 45, 53, 63, 227-229, 262, 464, 722` | launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/implementation-plan.md:263, 269, 288, 353, 429, 705, 710, 768-771` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/implementation-plan.md:343, 690` | provision-opentui-profile, provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/implementation-plan.md:78` | provision-opentui-profile, upgrade CLI/help | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/implementation-plan.md:40, 294, 298, 302, 326, 397, 413, 439, 444, 545, 575, 603, 665, 696, 763-767, 774` | provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/implementation-plan.md:1, 22, 31, 33, 83-85, 115-117, 134-135, 147, 153-154, 167-168, 186, 198, 204, 462, 556, 639` | upgrade CLI/help | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/implementation-plan.md:230, 563-564` | upgrade CLI/help, launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/implementation-plan.md:118` | upgrade CLI/help, upgrade-overrides | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/implementation-plan.md:565, 685` | upgrade CLI/help, upgrade-plan, launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/implementation-plan.md:105, 145, 181, 367, 385, 432, 466, 481, 529, 626, 709` | upgrade-overrides | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/implementation-plan.md:729` | upgrade-overrides, launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/implementation-plan.md:212, 419, 543, 640, 686` | upgrade-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/implementation-plan.md:211, 694` | upgrade-plan, provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/implementation-plan.md:726, 743` | upgrade.mjs/runUpgrade | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/implementation-plan.md:717` | upgrade.mjs/runUpgrade, launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/implementation-plan.md:202, 647` | upgrade.mjs/runUpgrade, upgrade-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/implementation-plan.md:210` | upgrade.mjs/runUpgrade, upgrade-plan, provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/prior-art-and-pitfalls.md:6` | launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/prior-art-and-pitfalls.md:179, 311` | provision-opentui-profile | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/prior-art-and-pitfalls.md:237, 284, 321` | provision-opentui-profile, provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/prior-art-and-pitfalls.md:277-278` | provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/release-mechanics.md:218` | e2e-client | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/release-mechanics.md:109` | provision-opentui-profile, provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/release-mechanics.md:137` | upgrade CLI/help | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `research/upgrade-command-20261116/release-mechanics.md:110` | upgrade.mjs/runUpgrade, upgrade-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `scripts/verify-fresh-home-provision.mjs:36, 106, 167` | companion-policy | 保留 | inproc companion 路径独立于 provision-plan；同名 package/range 是数据重复而非 import |
| `scripts/verify-fresh-home-provision.mjs:376` | inproc-companions | 保留 | inproc companion 路径独立于 provision-plan；同名 package/range 是数据重复而非 import |
| `tickets/2026-11-24-inproc-D2-companion-parity.md:49-50` | inproc-companions | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `tickets/2026-11-24-inproc-D3-teardown.md:34, 38, 53-54, 72` | launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `tickets/2026-11-24-inproc-D4-upgrade-command.md:21` | provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `tickets/2026-11-24-inproc-D4-upgrade-command.md:9` | upgrade.mjs/runUpgrade, upgrade CLI/help, provision-plan | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `tickets/2026-11-24-inproc-D4-upgrade-command.md:15, 25` | upgrade.mjs/runUpgrade, upgrade-plan, provision-plan, inproc-companions | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `tickets/2026-11-24-inproc-D5-gates-and-legacy-dir.md:14` | e2e-sweep, e2e-client | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `tickets/2026-11-24-inproc-D6-migration.md:61` | launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `tickets/2026-11-24-inproc-ask-slot-arbitration.md:7, 22` | inproc-companions | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `tickets/2026-11-24-inproc-only-map.md:45, 62, 71` | launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `tickets/2026-11-24-inproc-only-review-oldfox-3.md:31` | launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `tickets/2026-11-24-inproc-only-review-oldfox.md:19, 42` | launcher --force/--yes | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `tickets/2026-11-24-inproc-only-review-oldfox.md:25` | upgrade-overrides, provision-state | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `tickets/2026-11-24-inproc-provision-contract-audit.md:22` | dsh-model-sync | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |
| `tickets/2026-11-24-inproc-provision-contract-audit.md:15` | inproc-companions | 保留历史证据/决策，不改写 | 可能含旧行号或旧语义；仅作历史记录 |

