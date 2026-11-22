# full-access 继承返工补充（2026-11-22，oldfox 评审 F1）

基线：`01-gate-policy-faces.md`。本文记录评审 blocker F1 的修复设计、(c) 的验证结论、以及一个本批不修的已知缺口。

## 1. F1 根因（为什么第一版"父切回 ask + catalog 重放"是错的）

一手代码（`HOST=/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`）：

1. catalog 一次性：`HOST/dsh-subagent/lib/index.js:934` `establishCatalogChild()` 是唯一定义，`:1566` 是唯一调用点。它由 `submitMaterialized()` 的 `commit` 回调触发（`:2312-2322`：`submitAdmitted()` 之后 `commit?.()`），每个子只 append 一次 `subagent/catalog`。
2. `/permission` 切换只 append 父日志：`HOST/dsh-permission-presets/lib/index.js:228-230` → `setApprovalPolicy(agent.session, policy)` → `session.append("approval/policy", {policy})`，不重放 catalog。
3. `session/event` 只对 live append 发布：`HOST/dsh-session/lib/index.js:1426` "Seed events never publish on session/event"；`:1660-1674` `commit()` 才发。已写过的 catalog 不会重放。

结论：旧注释/旧测试（`ask-answerers.test.ts` 手工重发 catalog 模拟恢复）描述了一个生产中不存在的触发条件。真实缺口：full access 期间派且仍存活的子保持 delegation `never`，用户切回 ask 后无人重钉 → gate 读到子的 `never` → bypass → 静默放行（修复前同场景是可见拒绝），安全方向反转。

## 2. 三触发器设计

把 `repinChildApprovalPolicy` 泛化为**同步函数** `syncChildApprovalPolicy(childId, parentSessionId, desiredOverride?)`：

- `desired` = 父会话当前有效策略；调用方传入 `data.policy`（父 `approval/policy` 事件的新值）时以其为准，避免依赖投影 listener 的注册顺序。
- `current` = `approval.overrideOf(childSession)`。
- `current !== desired` → `childSession.append('approval/policy', {policy: desired})`；`===` → no-op（**双向**，幂等靠 current-vs-desired，去掉 `repinnedChildren` 一次性短路，否则镜像方向永远只走一次）。
- fail-closed：父会话解析失败 / approval 服务或 effectivePolicy/overrideOf 不可用 / desired 非 ask|never / effectivePolicy 抛错 → 不动子日志 + warn。
- `never → ask` 的实际翻转（自愈发生）记一条 warn（fold-in F2）。

三个触发器：

- **(a)** 父侧 `subagent/catalog` 帧（既有调用点，改调 sync）。
- **(b)** 父侧 `approval/policy` 事件（`session.id === binding.sessionId`）→ 对 subagent index 中本 binding 的全部已知子逐个 sync。这是 full access 恢复（`never→ask`）与镜像（`ask→never`）的真实路径，关闭 F1。
- **(c)** 子侧 `approval/policy` 且 `data.source === 'delegation'`（宿主委派钉，`HOST/dsh-subagent/lib/index.js:372-380` `appendDelegatedPolicyOverrides`，在 `setup()` 中于子首个 turn 之前 append）→ 对该子 sync（父 = `binding.sessionId`）。这一条收口 catalog 时序窗口：`submitMaterialized()`（`:2312-2322`）先 `submitAdmitted()` 唤醒子首个 turn、再 `commit?.()` 写 catalog，旧版存在子首调早于 catalog 的窗口（登记过的 deferred 项，约 1/3 概率）。

## 3. (c) 验证结论：可达，但必须延迟 append

### 3.1 子事件可达 + firehose scope（真实包实证）

测试 `packages/bridge/test/session-event-scope.test.ts`（import 真实 `@deepseek-ai/cordis` + `@deepseek-ai/dsh-scope`，复刻宿主 dispatch 形态）证明：

1. **untagged 根 listener 收到父 + 子会话事件**。宿主 `HOST/dsh-session/lib/index.js:1596-1608,1666-1673` 用 `collectSessionCallbacks(entry.emitCtx, [entry.carrier, 'session/event', ...args])` 发布；`:1947-1950` `carrier = scopeTarget(session, scopeOf(store.ctx))`、`emitCtx = this.ctx`（store 的 ctx）。`HOST/dsh-scope/lib/index.js:312-337` `scopeTarget` 的 filter：listener 无 tag → 全局采纳；外层 scope 的 listener 收到所有后代 scope 事件；下层 tag 被排除——"events flow up the chain, never down"。bridge 用根 `ctx.on('session/event', ...)`（untagged），因此看到总线上所有会话的 live 事件。
2. **兄弟 scope 收不到别的分支事件**（scope 单向），所以无关 scope 不会误入。
3. 由于根 listener 理论上能看到其他会话事件，(c) 用子的持久 header 做显式守卫：`session.header.parentSession === binding.sessionId && session.header.origin === 'subagent'`（`HOST/dsh-subagent/lib/index.js:292-303` `childSessionMeta` 写入这两个字段）。此时子尚未进 subagent index（catalog 未到），不能用 index 判定。

### 3.2 关键偏差：同步 append 会被宿主拒绝 → queueMicrotask 延迟

实证（`session-event-scope.test.ts` 第三个用例，复刻宿主 `publicationEntry` 的 `appending` 守卫）：在子会话自己的 `session/event` listener 里同步 `childSession.append()` 会抛 `session append cannot reenter while another append is being published`（宿主 `HOST/dsh-session/lib/index.js:1660-1674` 在 `entry.appending === true` 期间同步调用 observer，`publicationEntry()` 检测重入）。宿主会 catch 并只记 warn，但子策略不会被改 → 安全缺口仍在。

修复：(c) 的 sync 通过 `queueMicrotask(() => syncChildApprovalPolicy(...))` 延迟到当前 publish 展开之后再 append。宿主 `appendDelegatedPolicyOverrides` 在 `setup()` 的 `await workingDirectory.set(...)` 之前完成，microtask 在该 await 处排空，仍早于 `submitMaterialized()` 的首个 turn 投递，时序窗口照样收口。测试用 `flushMicrotasks()` 等待该延迟。

## 4. 已知缺口（本批不修，登记）

**resume 子不受三触发器覆盖**：恢复的子会话，其委派钉是 seed（构造期注入），而 `HOST/dsh-session/lib/index.js:1426` 明确 "Seed events never publish on session/event"；同时 catalog 也不会重放（见 §1）。因此一个在 full access 期间恢复、且从未产生 live 委派钉事件的子，三触发器都碰不到。本批不修；登记的后续方向是恢复路径显式补一次 live sync（或让 gate 走 child→parent 注册表回退）。

## 5. 与 01 sketch 的偏差（本批）

- 恢复路径从"父切回 ask + catalog 重放"改为"父 `approval/policy` 事件"(b)，并因 (c) 实证增加子委派钉触发器；旧的手工重发 catalog 测试被替换为事件驱动测试。
- (c) 的 append 延迟一个 microtask（§3.2），因宿主重入守卫。
- (b) 用事件携带的 `data.policy` 作为 desired（而非纯 `effectivePolicy(parentSession)`），避免投影 listener 注册顺序竞态；effectivePolicy 仍是 (a)/(c) 的 desired 来源。
- gate bypass 日志 info→debug（full access 下每写调用一条），`GateContext.logger.debug` 可选。
- 补 `ctx.get('approval')` 抛错的 gate 用例（P1-1 死脚手架复活）。
