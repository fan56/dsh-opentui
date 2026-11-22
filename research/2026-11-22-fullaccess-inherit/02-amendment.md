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

测试 `packages/bridge/test/session-event-scope.test.ts` 导入真实的 `@deepseek-ai/cordis` 4.1.0 + `@deepseek-ai/dsh-scope`（bridge 声明的 devDep），对这两个包执行真实 dispatch / scope-filter；`dsh-session` 的发布 + 重入守卫是**忠实复刻**（按宿主行号一一对照），不是导入该包（宿主二进制在工作区外，故意不设为 bridge devDep）。证明：

1. **untagged 根 listener 收到父 + 子会话事件**。宿主 `HOST/dsh-session/lib/index.js:1596-1608,1666-1673` 用 `collectSessionCallbacks(entry.emitCtx, [entry.carrier, 'session/event', ...args])` 发布；`:1947-1950` `carrier = scopeTarget(session, scopeOf(store.ctx))`、`emitCtx = this.ctx`（store 的 ctx）。`HOST/dsh-scope/lib/index.js:312-337` `scopeTarget` 的 filter：listener 无 tag → 全局采纳；外层 scope 的 listener 收到所有后代 scope 事件；下层 tag 被排除——"events flow up the chain, never down"。bridge 用根 `ctx.on('session/event', ...)`（untagged），因此看到总线上所有会话的 live 事件。
2. **兄弟 scope 收不到别的分支事件**（scope 单向），所以无关 scope 不会误入。
3. 由于根 listener 理论上能看到其他会话事件，(c) 用子的持久 header 做显式守卫：`session.header.parentSession === binding.sessionId && session.header.origin === 'subagent'`（`HOST/dsh-subagent/lib/index.js:292-303` `childSessionMeta` 写入这两个字段）。此时子尚未进 subagent index（catalog 未到），不能用 index 判定。

### 3.2 关键偏差：同步 append 会被宿主拒绝 → queueMicrotask 延迟

实证（`session-event-scope.test.ts` 第三个用例，复刻宿主 `publicationEntry` 的 `appending` 守卫）：在子会话自己的 `session/event` listener 里同步 `childSession.append()` 会抛 `session append cannot reenter while another append is being published`（宿主 `HOST/dsh-session/lib/index.js:1660-1674` 在 `entry.appending === true` 期间同步调用 observer，`publicationEntry()` 检测重入）。宿主会 catch 并只记 warn，但子策略不会被改 → 安全缺口仍在。

修复：(c) 的 sync 通过 `queueMicrotask(() => syncChildApprovalPolicy(...))` 延迟到当前 publish 展开之后再 append。宿主 `appendDelegatedPolicyOverrides` 在 `setup()` 的 `await workingDirectory.set(...)` 之前完成，microtask 在该 await 处排空，仍早于 `submitMaterialized()` 的首个 turn 投递，时序窗口照样收口。测试用 `flushMicrotasks()` 等待该延迟。

## 4. resume 缺口：R2-1 已修 + 残余竞态登记

### 4.1 原登记低估的两层缺口（NO-GO 原因）

oldfox round2 指出原 §4 只写了"seed 不发布"，漏掉更结构性的一层：

1. **(a)/(c) 不触发**：resume/TUI 重启后，子的委派钉与 catalog 都是 seed（`HOST/dsh-session/lib/index.js:1426` "Seed events never publish on session/event"），不产生 live 事件。
2. **(b) 结构性失效**：重启后 `getSubagentIndex(ctx)` 是全新空表；`syncFromList` 只在 `reconcileSubagentIndex` 里调，而它只有 `subagents.interrupt`(:4047) 与 `subagents.stopChildren`(:4080) 两个调用点。于是 `/permission` 切 ask 的父 `approval/policy` 事件到达时 (b) 遍历 0 行 → 什么都不钉。端到端：full access 派子 → 退出 → resume → /permission 切 ask → 续跑子 → gate 读子 `never` → bypass → 静默放行（v0.26.2 同场景=可见拒绝）。

### 4.2 R2-1 修复（已实现）

- **(i)** bind 完成（`session.open` 新开 / resume / 幂等重连）以及每次 `reconcileSubagentIndex` 的 `syncFromList` 之后，对本 binding index 的全部 rows 逐个 `syncChildApprovalPolicy(childId, binding.sessionId)`，desired 用**实时** `effectivePolicy`（不缓存事件值）。这同时是 F2 自愈钩子（R2-2）。
- **(ii)** (c) 放宽为"未知会话的首个 live 事件"：`session.id !== binding.sessionId && !rows.has(id)` 时读子 header，`origin==='subagent' && parentSession===binding.sessionId` → **必须 `noteCatalog` 入 index**（硬性要求：入表而非一次性 seen-set——seen-set 会把 resume 子排除在 (b) 之外，等价重造 F1）+ `queueMicrotask` sync。入表后该子即被 (b) 接管。

覆盖形态：`resume 后父已 ask`（(b) 空表 no-op → Stop reconcile → (i) 重钉）与 `resume 后父切 ask`（事件到达时空表 → Stop reconcile 读实时 ask → 重钉）；测试还覆盖 (ii) header 不匹配不入表不同步、无 live 事件不误入表。

### 4.3 残余竞态（登记，本批不修）

resume 子的**第一条 live 事件就是被门控工具执行本身**时，门的 `tools/pre-execute` 可能先于 (ii) 的 deferred sync 读到子的 stale `never` → 该次调用被静默放行。加剧情形：该子尚未被 `session.list` 收录（syncFromList 也拿不到），此调用后既不产生 catalog 也无后续 live 事件兜底。有 (i) 后面已经足够窄（仅限"list 里都没有的晚 resume 子 + 首事件即门控执行"的交集），本批不修；登记的下批方向：gate 对 origin==='subagent' 且非本 binding 已知子系的 session 不走 bypass（见 §5 R2-3 守卫思路）。

## 5. R2-3 / R2-4 登记项

### 5.1 R2-3 — 深度 ≥2 孙代静默放行（默认不可达，本批不修）

宿主对任意深度的子都钉 `never`（`captureDelegatedPolicyOverrides` 不判深度），而本镜像只覆盖 binding index 的**直接子**（`parentSessionId === binding.sessionId`）。当 `maxDepth >= 2` 时，孙代（其 parentSession 是子、不是 binding）不会被 (a)/(c)/(i) 同步，保持 `never` → gate bypass → 任何世界都静默放行。默认 `maxDepth=1`（`dsh-subagent` 默认）下孙代不可达，故本批不修。登记的守卫思路：门对 `origin==='subagent'` 且不在本 binding 已知子系（直接子 + 递归后代）里的 session 不走 bypass（fail-safe 发 ask），留待下批。

### 5.2 R2-4 — dsh-scope devDep 版本 delta（选择：登记核对结论，不升级）

bridge 声明 `@deepseek-ai/dsh-scope` `0.2.2-rc.3`，宿主闭包为 `0.2.2-rc.5`。核对结论（2026-11-22）：两者的 `lib/index.js`（357 行）与 `lib/types/**` **逐字节一致**（`diff` 退出码 0），(c) 实证依赖的 `scopeTarget`/`scopeOf`/cordis `Context.filter` 契约完全相同；cordis 两侧同为 `4.1.0`。故不升级（避免无收益的 lockfile 抖动），以本登记为核对结论。若后续宿主升级 rc.5 引入 scope 行为变化，需重跑 `session-event-scope.test.ts` 并复核本结论。

## 6. 与 01 sketch 的偏差（累计）

- 恢复路径从"父切回 ask + catalog 重放"改为"父 `approval/policy` 事件"(b) + "bind/reconcile 全量 re-sync"(i) + "未知子首事件"(ii)；旧的手工重发 catalog 测试被替换为事件驱动测试。
- (c) 的 append 延迟一个 microtask（§3.2），因宿主重入守卫；(ii) 放宽到任意 live 事件并强制 `noteCatalog` 入表（§4.2）。
- (b) 用事件携带的 `data.policy` 作为 desired（而非纯 `effectivePolicy(parentSession)`），避免投影 listener 注册顺序竞态；(a)/(c)/(i) 用实时 effectivePolicy。
- gate bypass 日志 info→debug（full access 下每写调用一条），`GateContext.logger.debug` 可选。
- 补 `ctx.get('approval')` 抛错的 gate 用例（P1-1 死脚手架复活）。
- F2 自愈链文字订正为真实链条：(c) fail → (a) catalog 兜底 → (b) 下次父策略事件 / (i) Stop 全量 re-sync（R2-2）；"委派钉下一事件重试"的说法不成立（委派钉一生只 append 一次）。
