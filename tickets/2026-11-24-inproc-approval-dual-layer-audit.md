# approval-policy 与 bridge approval-gate 双层行为审计

## 结论：部分不符

- **不符**：“双层”不是两次确认，也不是 300s + bridge 等待串行叠加。
- **符合**：oldfox 的“行为变更”定性——approval-policy 用超时窗口包住 bridge 的单次 answerer。
- **符合**：`windowSeconds: 300` 已进入源码模板。
- **不符**：迁移“用户段 carry 白名单”未包含 `dsh-approval-policy.windowSeconds`。
- **未证实**：当前本机实际挂载行为；`opentui-inproc` 已生成 patch 中没有 approval-policy 条目，也没有双层联合测试。

## 两侧调用链

1. **触发与宿主审批**
   - bridge `approval-gate` 只注册 `tools/pre-execute`，命中写工具返回 `{kind:'ask'}`，本身没有 approval answerer：`packages/bridge/src/approval-gate.ts:141-175,200-255`。
   - 宿主先检查策略；`never` 在 waterfall 前直接 `rejected`，否则才派发 `approval/request`：本机 rc.2 `dsh-user-approval/lib/index.js:197-201`。

2. **approval-policy → bridge**
   - `prepend:true` 保证 policy 位于 bridge 前：本机 `dsh-approval-policy/lib/index.js:169-186`。
   - 命中 unattended 后立即调用 `next()`，并与 `windowSeconds` race；不是先等 300s 再转发：同文件 `:116-137,147-167`。
   - bridge answerer 创建 `ask.request`、等待 `ask.response`、返回宿主 outcome；`_next` 未使用，属于真正转发并占住 waterfall，不是 return 占位：`packages/bridge/src/index.ts:3601-3665,3737,4284-4306`。
   - bridge 默认 `askDeadlineMs=null`，只有 1h hard cap：`packages/bridge/src/index.ts:2810-2825`；`packages/bridge/src/ask-registry.ts:123-125,292-337`。

**实际次数**：普通交互为一张卡、一次 bridge 等待；subagent/scheduled 在策略为 `ask` 且目标可投递时也是**一张卡、一次等待**，只是最多等 300s。宿主策略 `never` 是零确认；bridge 立即返回 `unavailable` 时不等待 300s；`windowSeconds:0` 时不调用下游、立即拒绝。

## 配置语义

- `origins` 默认 `['subagent','scheduled']`；判定顺序为 `sessions` glob → `all` → subagent header → 最后一条 provenance user message。`schedule` 属 scheduled，`cron` 需显式加入；人类 steer 会恢复交互路径：本机 `dsh-approval-policy/lib/index.js:54-62,88-137`。
- `windowSeconds`：0–86400，默认 60，volatile；schema 未强制整数。0 表示不转发、立即采用 `defaultOutcome`。
- `defaultOutcome`：仅超时采用，默认 `rejected`，可选 `unavailable`；下游先返回则原 outcome 获胜。
- 模板注释“origins 默认空”**错误**：`packages/shell/scripts/provision-inproc-profile.mjs:651-657`。

## 模板 / carry 状态

- 源码模板已有 300s：`packages/shell/scripts/provision-inproc-profile.mjs:653-657`。
- 普通幂等 converge 的 nested insert carry 已支持：`packages/shell/scripts/lib/patch-ownership.mjs:18-25,1202-1213`。
- **迁移白名单未包含**：`packages/shell/scripts/lib/patch-ownership.mjs:43-50`；`packages/shell/scripts/lib/migration.mjs:63-69`。
- 而且 migration 只记录 insert id、不读取 nested config，externalCarry 也没有落到 nested insert 的完整路径：`packages/shell/scripts/lib/migration.mjs:175-193`。
- 本机 `~/.dsh/profiles/opentui-inproc/cordis.patch.yml` 无 approval-policy/windowSeconds，不能声称已实际生效。

## 测试覆盖矩阵

| 场景 | 覆盖结论 | 证据 |
|---|---|---|
| subagent 自动拒绝 | 部分：window=0 单测；宿主 `never` 前置拒绝有源码及集成测试说明，但未与 policy 联合 | `dsh-approval-policy/test/gate.test.mjs:137-143,217-225`；`packages/shell/test/child-approval-integration.test.ts:1-20,276-287` |
| scheduled | 部分：predicate 单测；无 bridge 端到端 | `dsh-approval-policy/test/gate.test.mjs:137-148` |
| 普通交互审批 | 分开覆盖：policy 直接 next、bridge 正常推卡，无合并栈测试 | `dsh-approval-policy/test/gate.test.mjs:206-214`；`packages/bridge/test/ask-answerers.test.ts:274-329` |
| answerer 不被饿死 | 单测证明窗口内回答获胜；无真实 bridge 联合验证 | `dsh-approval-policy/test/gate.test.mjs:174-180` |
| 300s / carry | 未覆盖：没有断言 300，也没有 approval-policy nested carry/迁移测试 | `packages/shell/test/migration.test.ts:558-622` |

## 最小修法候选

1. **补迁移 carry 闭环**：将 `dsh-approval-policy.windowSeconds` 加入两份白名单，按有限数及 0–86400 校验，并让 externalCarry 能写入 nested insert。风险：涉及迁移安全边界，必须补拒绝非法值测试。
2. **固定模板契约**：新增 300s 与 origins 默认值断言，修正“origins 默认空”的注释。风险低。
3. **补双层联合测试**：覆盖 subagent/scheduled/交互、窗口内回答、300s 超时及超时后迟到回答清理。风险低；若产品要求超时即撤卡，再单独统一计时/取消责任，**不要**直接给 bridge 全局加 300s deadline，否则会改变普通交互行为。

## 未覆盖项

- 实际 Cordis 合并挂载。
- 当前生成 profile 的实际生效状态。
- scheduled 真实 provenance 的端到端行为。
- policy 超时后 bridge pending 卡片的迟到响应。

静态源码表明迟到响应不会改变宿主已记录的拒绝结果，但可能短暂遗留可响应卡片；此风险未测试。
