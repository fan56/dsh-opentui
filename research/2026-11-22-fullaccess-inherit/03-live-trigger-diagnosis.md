# (b) 父策略事件触发器真机失效诊断（2026-11-23）

基线与现象：打包版 + 宿主 `0.2.2-rc.5`。catalog 触发器 (a) 活着（子 seq2 委派钉 never 与 seq3 重钉 ask 同毫秒）；父日志两次 `approval/policy` live append（seq67 ask、seq103 never）成功落盘，但已知子无任何新 policy append，也无 warn。(c) 真机未验证。

诊断测试：`packages/bridge/test/live-trigger-diagnosis.test.ts`（导入真实 `@deepseek-ai/cordis` 4.1.0 / `dsh-session` 0.2.2-rc.5 / `dsh-session-projection` / `dsh-user-approval`，绝对路径指向宿主安装闭包）。3 pass / 0 fail。另用一次性端到端脚本把真实 bridge `apply()` 接到真实 cordis 事件总线 + 真实 SessionStore + 真实 ApprovalService 上跑全链。

## 真机铁证（boot 实测，env-gated 诊断探针，探针代码未提交已 checkout 丢弃）

用户在家用真机加环境变量门控探针，boot 实测拿到决定性证据：

```
dispatch 时 sync：SYNC-STEP childSession=ok appendFn=function        → append 成功（子活着，catalog/(c) 路径）
switch 时 (b) sync：SYNC desiredOverride=never
                    SYNC-STEP childSession=UNDEF appendFn=undefined → 静默跳过
```

**真机根因**：子会话在自己 turn 结束时被宿主从 `sessions` 服务 **detach**，`sessions.get(childId)` 返回 `undefined`。`syncChildApprovalPolicy` 在 `childSession === undefined` 时静默早返回（无 append、无 warn）——这正好复现「父日志有 approval/policy、子无新 append、无 warn」。(a)/(c) 触发器之所以一直正常，是因为它们只在子活着时（spawn / 首事件）触发；而 (b)/(b2) 发生在父侧切换时刻，此时子已 detach。

旁证（同一探针，纠正先前误判）：
- **(b) 投递正常**：`approval/policy` 事件确实到达 BINDING（探针有行），故不是「事件不到」。
- **(c) 真机活着**：未知子首事件触发的 SYNC 比 catalog 早 5ms（(c) 抢先入表 + sync）。
- **setPolicy 幂等短路**：preset 全局状态与会话策略分离，会让人误以为切换没生效（只是观测假象）。
- 早期 A/B 的「真机死路」全部由此根因解释；boot 2 里 boot 1 的孩子本就不在 index，(b) 不认是**正确行为**（会话归属隔离生效），非缺陷。

**客户端修法 (b3)**：扩展 `onSessionEvent` 的 `sessionId !== binding.sessionId` 分支——来自**已知 index 子**（`index.has(sessionId)`，parentage 已是 durable 事实，无需 header）且 `type === 'turn/start'` → `syncChildApprovalPolicy(sessionId, binding.sessionId)`（desired 走实时 `effectivePolicy`）。子 turn/start 先于本轮任何工具调用；宿主 resume/续跑 continuable 子时重新挂回 sessions 服务（此刻 `sessions.get` 可解析、append 可用），于是：
- never→ask（危险方向）：resume 子首事件=turn/start → 重钉 ask → 本轮写操作正常弹卡；
- ask→never：resume 子 → 镜像 never → 本轮写零卡。

保留 (b)/(b2)/(c)/(i) 不动（各自覆盖活着子的即时路径 / restart 路径）。(b2) 对 detached 子天然 no-op（`sessions.get` 只解析 live 会话，已在注释写明）。

## 一手代码证据（宿主路径前缀 `HOST=/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`）

- `dsh-session/lib/index.js:1561-1568` `append(type,data)` → `commit(event, entry)`；`:1660-1674` `commit()` **不区分事件类型**，一律 `collectSessionCallbacks(entry.emitCtx, [entry.carrier, "session/event", ...args])` → `invokeContainedSessionObservers(...)`。
- `:1271-1273` `collectSessionCallbacks = ctx.events.dispatch("emit", args)`；cordis `lib/index.js:830-842` `_resolve` 只用 `args[0]` 作 carrier、`args[1]` 作事件名，**没有按 `event.type` 过滤**。
- `dsh-user-approval/lib/index.js:82-85` `setApprovalPolicy(session, policy)` = `session.append("approval/policy", {policy})`；`:124-133` `setPolicy` 调它后 `agent.inject(...)`。`:177-189` `effectivePolicy = overrideOf ?? config.policy ?? "ask"`、`overrideOf` 读投影 handle。
- `dsh-session/lib/index.js:1666,1673` `commit` 仅在 `entry !== void 0 && callbacks !== void 0` 时通知 observer；`:1649-1652` `publicationEntry()` 对未 `enter` 的独立 session 返回 `undefined`。

## H1 — `approval/policy` 是否发布 session/event？

**是，与类型无关。** 测试用真实 store 连续 append `approval/policy`/`subagent/catalog`/`tool/call`/`approval/asked`，监听器 4 条全部收到、顺序与写入一致。宿主对 `approval/policy` 无任何按类型的发布过滤。一手：`:1660-1674`。

## H2 — 投递给监听器的 event 形状是否与日志一致？

**一致。** 真实监听器收到 `event.type === "approval/policy"`、`event.data === {policy:"never"}`、`session.id === 写入 session id`，与 `snapshotEvents()` 完全对应。所以 `(b)` 分支的 `type === 'approval/policy'` 与 `data.policy` 两个判据在真宿主上成立。

## H3 — `overrideOf/effectivePolicy` 对 `sessions.get(childId)` 返回的真实 session 是否正常？

**正常。** 真实 `SessionStore.get(id)` 返回的就是 `create()` 的那个活体 session（`===` 成立）；对它 apply 一次 `approval/policy` 后 `overrideOf` 与 `effectivePolicy` 立即读出新值。与 catalog 路径同参数、同实例，无差异。

## H4 — 是否存在绕开 commit/publish 的写入路径？

全宿主闭包只有两处 `append("approval/policy")`：`dsh-user-approval:84`（状态切换、`/permission` 走这条）与 `dsh-subagent:377`（委派钉）。两者都是普通 `session.append`。`/permission` 链路：`commands/execute(agent,…)` → handler `ctx.approval.setPolicy(agent,…)` → `setApprovalPolicy(agent.session,…)`，其中 `agent` 是命令调用点传入的活体 agent，其 session 是 `dsh-agent-loop:1588` `sessions.enter(session)` 的 store-owned 实例。

但确实存在**一个**宿主机制能产出「日志增长、无监听器、无 warn」：未 `enter` 进 store 的**独立 session**（`Session.create()` 不走 `sessions.enter`）的 `append` 落进自己的 log，却因 `entry === undefined` 被 `commit` 跳过 observer 通知（`:1666,1673`）。测试 H4 证明：detached session 写入后本 session log 增长，根 ctx 的 `session/event` 监听器只看到 attached session 那一条。

## 根因结论（已由真机探针确认，取代本文早前的候选推断）

**真机根因：`sessions.get(id)` 只解析 live（store-attached）会话。子会话在自己 turn 结束时被宿主 detach；此后父侧 (b)/(b2) 即便收到 `approval/policy` 事件，`sessions.get(childId)` 也返回 `undefined`，`syncChildApprovalPolicy` 静默早返回——无 append、无 warn。** 铁证见上节 boot 探针两行对照（`childSession=ok` vs `childSession=UNDEF`）。H1/H2/H3 一手实证仍成立：宿主对 `approval/policy` 无类型过滤、形状完好、策略读取正常；先前「宿主不发布」的假设已被否证，而真机差额的真相是**子会话已 detach**。

(b)/(c) 历史表现由此统一解释：(a)/(c) 在子 spawn/首事件时触发，子必 live，故一直正常；(b)/(b2) 在父侧切换时触发，子常已 settle/detach，故静默跳过。早期 A/B 的「真机死路」及 boot 2 里 boot 1 的孩子不在 index，均为 detach + 会话归属隔离的正确行为，非缺陷。

**修法 (b3)（客户端、不改宿主/冻结面）**：已知 index 子的**自己的 `turn/start`** 触发 re-sync（desired 走实时 `effectivePolicy`）。宿主 resume/续跑 continuable 子时会把它重新挂回 sessions 服务，此刻 `sessions.get` 可解析、append 可用；子的 turn/start 先于本轮任何工具调用，因此 both directions 都覆盖。(b)/(b2)/(c)/(i) 保留，各司其职。

## 残余 / 登记

- **「首事件即被门控工具执行」竞态（仍登记，面已极窄）**：若 resume 子的第一条 live 事件**就是**被门控工具执行本身（而非先有 turn/start），(b3) 来不及在门读策略前重钉。但宿主 resume/续跑会先写 `turn/start` 再执行工具，实测 turn/start 先于工具调用，故该窗口仅剩异常序列，本批不修。
- (b2) 父 turn/start 冗余钩子对 detached 子天然 no-op（`sessions.get` 只解析 live 会话）——这是 (b3) 存在的原因，两者互补而非重叠。
- 真机复验（不依赖探针）：切 full access 后续跑同一子 → 写零卡；切回 ask 后续跑 → 卡恢复。
