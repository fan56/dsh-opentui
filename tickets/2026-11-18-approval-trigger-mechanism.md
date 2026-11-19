# 审批触发机制调研：stock 宿主到底什么时候弹审批（2026-11-18）

性质：**只读调研**，不改源码、不 commit。工作区 `feat/inproc-bridge-20261118`，HEAD `7d54190`。
时间盒 30 分钟。所有结论带 `文件:行`；未核实项标 UNKNOWN。本文不含任何凭据值。

路径约定：下文 `dsh-<pkg>@0.2.2-rc.3/...` 指 `node_modules/.pnpm/@deepseek-ai+dsh-<pkg>@0.2.2-rc.3_<hash>/node_modules/@deepseek-ai/dsh-<pkg>/...`（版本均为 `0.2.2-rc.3`，hash 已省略）；仓库内文件用仓库相对路径。

**已启用（2026-11-18，ADR-0011 T9，commit `feat(profile): default to workspace-write + approval: ask with the pre-execute gate`）**：本调研的两条结论已落到默认 profile——`defaultPreset: workspace-write`（`approval: ask`，取 §2 的 sandbox 真实收益）+ pre-execute gate 默认 armed（`tools: {bash, write, edit, apply_patch}: ask`，取 §4 目标 B 的审批卡）。逃生门：`DSH_OPENTUI_APPROVAL_GATE=off dsh-opentui` 恢复 T9 前的 `danger-full-access` + gate 关闭；默认 ON。

---

## 0. 结论先行（T9 有没有安全价值）

**分两层，不能混为一谈：**

1. **只把 `approval` 旋钮从 `never` 改成 `ask`（sandbox 仍是 `danger-full-access`）：没有实际安全效果。** 宿主不会因此发起任何审批——审批只在有人先发出"这个问题"之后才工作，而 stock 宿主没有任何内置组件会对普通工具发出 `{kind:'ask'}` 或 `sandbox_permissions` 审批请求。审批卡不会出现。这部分是心理安慰（外加一句 system-prompt 文案变化）。

2. **把整个 preset 换成 `workspace-write`（同时改了 `sandbox` 旋钮）：有真实安全效果，但来自 sandbox，不是来自 approval。** `workspace-write` 让文件沙箱拒绝越界写（硬拒绝 + 升级提示）；`danger-full-access` 则完全不限制。这个收益与审批无关，也不需要装任何 gate。

3. **要让"写类工具（bash / file write）无条件先弹审批卡"，必须再装一个会返回 `{kind:'ask'}` 的 `tools/pre-execute` gate 插件。** 宿主（含全部已安装依赖）**不自带**这样的插件；全依赖树里没有任何实现 emit `{kind:'ask'}`。这正是上一轮 T4 真机必须造夹具插件强制 `bash` 返回 `{kind:'ask'}` 的原因，代码层完全吻合。

一句话：**T9 单独改 preset，只拿到 sandbox 的写限制；approval 那半边不装 gate 就是休眠的。要审批卡必须补 gate 插件（或在 inproc 场景先补 answerer，见 §4）。**

---

## 1. 真实触发链：谁调用 approval waterfall，判定条件是什么

### 1.1 触发链（两条，且只有两条）

| 触发源 | 链 | 证据 |
|---|---|---|
| A. 工具前置决策返回 ask | `tools/pre-execute` waterfall → 某个 listener 返回 `{kind:'ask'}` → `serviceAsk()` → `ctx.approval.request()` → waterfall `approval/request` → answerer | `dsh-tools@0.2.2-rc.3/src/pipeline.ts:200-205`、`:440-481`；决策类型 `dsh-tools/src/contracts.ts:375-379` |
| B. 沙箱升级（模型显式请求） | bash/fs 工具收到 `sandbox_permissions` + `justification` 参数 → `approveEscalation()` → `ctx.approval.request()` → waterfall → answerer | `dsh-sandbox/src/escalation.ts:209-262`（request 在 `:235-242`）；`dsh-tool-bash/src/index.ts:244-267, 502-511`；`dsh-tool-fs/src/sandbox.ts:89-114` |

**两条都不是"preset/approval 策略驱动的自动触发"。** 策略只在请求已经发出后决定它的结局。

### 1.2 判定条件原文

A 路（工具前置决策）——默认放行，只有 listener 显式给 ask 才升级：

```
dsh-tools/src/pipeline.ts:200-206
const gate = await this.ctx.waterfall(
  carrier, 'tools/pre-execute', exec,
  () => Promise.resolve<PreToolDecision>({ kind: 'allow' }),   // ← 默认 allow
)
const askResolution = gate.kind === 'ask'
  ? await this.serviceAsk(exec, gate)                          // ← 只有这里才调 approval.request()
  : { decision: gate, approvalCancelled: false }
```

B 路（升级）——只有模型传了 wider 模式才可能升级；重复当前模式直接返回，不需要审批：

```
dsh-sandbox/src/escalation.ts:211              if (mode === effectiveMode) return effectiveMode
dsh-sandbox/src/escalation.ts:215              if (!(WIDER_MODES[effectiveMode] ?? []).includes(mode)) throw ...INVALID_ARGUMENT
dsh-sandbox/src/escalation.ts:221-232          approver/agent 缺失 → ...UNAVAILABLE（不弹卡）
dsh-sandbox/src/escalation.ts:235-242          outcome = await approval.approver.request({...})
dsh-sandbox/src/escalation.ts:64-67            WIDER_MODES = { 'read-only': [workspace-write, danger-full-access],
                                                              'workspace-write': [danger-full-access] }
                                               // danger-full-access 没有可升级目标 ⇒ 永不走 B 路
```

策略判定（请求已发出之后才生效）：

```
dsh-user-approval/src/index.ts:301   if (this.effectivePolicy(session) === 'never') return 'rejected'   // 在 dispatch 前，确定性拒绝
dsh-user-approval/src/index.ts:306-310  ctx.waterfall(scopeTarget(...), 'approval/request', req,
                                          () => Promise.resolve('unavailable'))                       // ask：交给 answerer；无 answerer → unavailable
dsh-user-approval/src/index.ts:314,317  非法/抛错的 answerer 返回值 → 'unavailable'
dsh-user-approval/src/index.ts:56       OUTCOMES = ['allowed-once','rejected','cancelled','unavailable']
dsh-tools/src/pipeline.ts:465-479      只有 allowed-once → allow；其余三种 → deny
```

文档定性（同向）：

- `dsh-user-approval/README.md:28`："The tools pipeline and the sandboxed bash tool route their `ask` decisions through this seam and fail closed when it is absent."
- `dsh-user-approval/README.md:32`："Without a terminal answerer, requests resolve `unavailable` and fail closed; the service itself never prompts a human."
- `dsh-user-approval/README.md:36`：`ask` delegates to answerers；`never` rejects every request deterministically **before interactive dispatch**。
- `dsh-tools/README.md:92,137,112`：`tools/pre-execute` 是 extensible allow/deny/ask gate；`ctx.tools.guard()` 只能追加单调 deny，不能制造 ask。

### 1.3 关键结论

- **approval 策略是"应答策略"，不是"触发策略"。** `never→ask` 不会凭空产生审批请求。
- **A 路的 ask 决策，全依赖树没有任何实现 emit。** grep 命中 `kind:'ask'` 的只有决策类型定义和消费点（`dsh-tools/src/contracts.ts:379`、`dsh-tools/src/pipeline.ts:204,442`）。
- 全依赖树唯一的 `tools/pre-execute` listener 注册是 `dsh-tool-jobs/src/index.ts:286-290`，它只 `next()` 记录输出上限，从不返回 ask。`dsh-bash-local/src/index.ts:8` 和 `dsh-tool-bash/src/index.ts:9` 只是注释/TODO。
- ⇒ **stock 宿主普通写操作不会弹审批卡**，与 T4 真机结论一致。

---

## 2. preset 到执行行为的映射

preset 只是两个**独立**旋钮的打包（`dsh-permission-presets/src/index.ts:59-63`）：`sandbox: SandboxMode` + `approval: ApprovalPolicy`。

默认表（`dsh-permission-presets/src/index.ts:183-190`；inproc 覆盖表 `packages/shell/scripts/provision-inproc-profile.mjs:505-518`）：

| preset | sandbox 旋钮 | approval 旋钮 | 写操作的实际路径 | 是否弹卡 |
|---|---|---|---|---|
| `read-only` | read-only | ask | 文件沙箱拒绝一切写（`FS_SANDBOX_DENIED` / `sandbox.denied`），返回拒绝 + 升级提示 | 否（除非模型据提示发起 B 路升级） |
| `workspace-write` | workspace-write | ask | 工作区内写：沙箱放行、**直接执行**；越界写：沙箱**硬拒绝** + 升级提示 | 否（同上） |
| `danger-full-access` | danger-full-access | never | 文件沙箱不限制；bash/fs 写**直接执行**；B 路无升级目标，A 路无 gate | 否 |

证据：

- 沙箱语义：`dsh-sandbox-policy/src/index.ts:63-73`（read-only：不能改文件；workspace-write：仅 workspace 可写；danger-full-access：不限制）。
- fs 写拒绝：`dsh-tool-fs/src/sandbox.ts:138-144`（`FS_SANDBOX_DENIED` → `[sandbox: file access denied under <mode> mode]` + escalation hint）；无 `sandbox_permissions` 时 `:96-98` 直接返回 standingPolicy 并执行。
- bash 写拒绝：`dsh-tool-bash/src/render.ts:45-50, 110-114`（`sandbox.denied` → denial marker + escalation hint）。
- preset 播种：`dsh-permission-presets/src/index.ts:233-235`（`agent/created` → `pinInitialPermission`）、`:438-444`（新 session 写 `permission/preset` + `sandbox/mode` + `approval/policy` 三个事件）、`:398-418`（切换路径）。
- 挂载前提：`dsh-permission-presets/src/index.ts:215-216`——未挂 confining executor（`ctx.shell.sandboxMode === undefined`）时插件加载直接报错。

**注意**：拒绝和审批是两套机制。沙箱拒绝是本地硬拒，不经过 `approval`；只有模型按提示用 `sandbox_permissions` 重试才进入 B 路审批。

---

## 3. `workspace-write + approval: ask`、不装 gate 时的写工具行为

| 情形 | 结果 | 证据 |
|---|---|---|
| bash 在工作区内写文件 | **直接执行**，无审批、无卡 | `dsh-tool-bash/src/index.ts:506-511`（无 `sandbox_permissions` → 用 standingPolicy 直接执行）；A 路无 gate emit ask |
| fs write/edit 在工作区内写 | **直接执行**，无审批、无卡 | `dsh-tool-fs/src/sandbox.ts:96-98, 103-113` |
| bash/fs 越界写 | **直接拒绝**（沙箱），不是审批卡；结果里带升级提示 | `dsh-tool-bash/src/render.ts:45-50`；`dsh-tool-fs/src/sandbox.ts:138-144` |
| 模型按提示带 `sandbox_permissions` 重试 | 这时才发起审批（B 路）；stock 宿主有 answerer 时弹卡，无 answerer 时 fail-closed | `dsh-sandbox/src/escalation.ts:235-262`；`dsh-user-approval/src/index.ts:306-318` |
| 若策略是 `never`（现状） | 即使模型发起升级，`decide` 在 dispatch 前直接 `rejected`，仍不弹卡 | `dsh-user-approval/src/index.ts:301`；`NEVER_SENTENCE` 还明确叫模型别设 `sandbox_permissions`（`src/index.ts:74`） |

⇒ 回答任务的三个问句：**不会弹审批（正常写）；会直接执行（工作区内）；越界写会直接拒绝（沙箱），不是审批。**

---

## 4. 是否需要额外组件 / 候选与最小落地

### 4.1 宿主自带候选盘点

| 候选 | 是否自带能发 ask 的 gate | 结论 |
|---|---|---|
| 全依赖树扫描 `kind:'ask'` emit | **无** | 只命中类型定义与消费点（§1.3）。没有现成策略插件可装 |
| `tools/pre-execute` listener | 仅 `dsh-tool-jobs`（`src/index.ts:286-290`） | 只 `next()`，不发 ask；与审批无关 |
| `ctx.tools.guard()` | 内置（`dsh-tools/README.md:92`） | 只能追加**单调 deny**，不能制造 ask；可作为"纯拒绝"方案但不能做审批 |
| `permission` preset 的 `auto` 集成 | `dsh-permission-presets/src/index.ts:75-86, 306-316` | 只是 bundle（danger-full-access + ask）+ 外部 `registerAuto(admit)` 钩子；本身不是 pre-execute ask gate |
| 沙箱升级路径（B 路） | 内置（`dsh-sandbox/src/escalation.ts`） | 唯一内置的审批触发，但**只在沙箱拒绝后、模型主动请求时**触发；覆盖不了常规写 |

**结论：宿主不自带可直接启用的"写工具全部先审批"策略插件。**

### 4.2 最小落地方案（按目标二选一）

**目标 A：只想限制写范围（安全收益来自 sandbox）**
- 改 `packages/shell/scripts/provision-inproc-profile.mjs:518` `defaultPreset: danger-full-access` → `workspace-write`（或 `read-only`）。
- 不需要任何新插件；越界写被沙箱硬拒。代价：工作区外写会失败，模型需靠升级提示重试；无人工审批卡。

**目标 B：要写工具真正弹审批卡**
- 仍需改 preset 到 `workspace-write`（或保留 danger-full-access 也行，但那样沙箱不拒绝、模型没有升级动机，B 路也用不上）。
- **必须新增一个本地 gate 插件**：注册 `ctx.on('tools/pre-execute', (exec, next) => ...)`，对 `bash` / `write` / `edit` / `apply_patch` 等写类工具返回 `{kind:'ask', reason, displayReason}`（这正是 T4 夹具做的事，代码依据 `dsh-tools/src/pipeline.ts:200-205`）。
- 在 profile 增加该插件行（参照 `provision-inproc-profile.mjs:505-518` 的 patch 行写法）。
- **inproc 拓扑额外前提**：`@deepseek-ai/dsh-user-approval` 的 waterfall 需要一个 terminal answerer（`README.md:32`）。inproc bridge 目前没有注册 `approval/request` answerer（见 `tickets/2026-11-18-ask-permission-gap.md:63, 88-112`），所以只加 gate 会导致写工具全部 fail-closed 被拒、`unavailable`、且无卡。要么同时实现 answerer + 双向帧（该票 §4 估 7~9 项），要么在 inproc profile 里挂一个可用的 host UI answerer（UNKNOWN：是否有现成包可直接挂）。

代价对比：目标 A = 1 行配置；目标 B = 1 个 gate 插件 + profile 行 +（inproc 场景）answerer 通道。

---

## 5. 未知项

1. inproc profile 实际挂载的 confining bash/fs executor 是哪一层（web-app bundle 不在本仓 `node_modules`，无法确认）；但 `dsh-permission-presets` 能加载即隐含 `ctx.shell.sandboxMode !== undefined`（`dsh-permission-presets/src/index.ts:215-216`）。
2. stock 宿主 UI 的 terminal answerer 由哪个包提供（本仓不含宿主 UI 应用）；`dsh-user-approval/README.md:32` 只给出契约。
3. inproc bridge 内 `ctx.get('approval')` 是否可解析、scoped waterfall 订阅是否需要额外 gate——沿用 `tickets/2026-11-18-ask-permission-gap.md:150` 的 UNKNOWN，需真机确认。
4. 把默认 preset 改成 ask 后，模型实际发起 B 路升级（写越界后重试）的频率——属行为概率，代码只能证明"可能"，不能证明"常见"。

---

## 6. 事实 / 证据速查表

| # | 事实 | 文件:行 |
|---|---|---|
| 1 | pre-execute 默认 `allow`，只有 `{kind:'ask'}` 才调 `serviceAsk` | `dsh-tools/src/pipeline.ts:200-206` |
| 2 | `serviceAsk` 是 tools 路唯一 `approval.request()` 调用点 | `dsh-tools/src/pipeline.ts:440-481`（request 在 `:457`） |
| 3 | `PreToolDecision` 类型含 allow/deny/ask/cancel | `dsh-tools/src/contracts.ts:375-379` |
| 4 | 全树无 `{kind:'ask'}` emit；唯一 listener 只 `next()` | grep 结果；`dsh-tool-jobs/src/index.ts:286-290` |
| 5 | 升级路只在 `sandbox_permissions` 参数存在时发审批 | `dsh-sandbox/src/escalation.ts:209-242` |
| 6 | `danger-full-access` 无升级目标 | `dsh-sandbox/src/escalation.ts:64-67` |
| 7 | `never` 在 dispatch 前确定性拒绝 | `dsh-user-approval/src/index.ts:301` |
| 8 | 无 answerer → `unavailable`；只有 `allowed-once` 放行 | `dsh-user-approval/src/index.ts:306-318`；`dsh-tools/src/pipeline.ts:465-479` |
| 9 | 策略不提示人；ask 委派给 answerer | `dsh-user-approval/README.md:28,32,36` |
| 10 | preset = sandbox + approval 两个独立旋钮 | `dsh-permission-presets/src/index.ts:59-63` |
| 11 | 默认 preset 表（workspace-write=ask / danger-full-access=never） | `dsh-permission-presets/src/index.ts:183-190` |
| 12 | inproc T9 目标：当前 defaultPreset=danger-full-access | `packages/shell/scripts/provision-inproc-profile.mjs:505-518`（`:518`） |
| 13 | sandbox 模式语义（拒绝/放行） | `dsh-sandbox-policy/src/index.ts:63-73` |
| 14 | fs/bash 越界写是硬拒绝 + 升级提示，不是审批卡 | `dsh-tool-fs/src/sandbox.ts:138-144`；`dsh-tool-bash/src/render.ts:45-50` |
| 15 | inproc bridge 无 approval answerer | `tickets/2026-11-18-ask-permission-gap.md:63, 88-112` |
