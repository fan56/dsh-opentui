# (b) 父策略事件触发器真机失效诊断（2026-11-23）

基线与现象：打包版 + 宿主 `0.2.2-rc.5`。catalog 触发器 (a) 活着（子 seq2 委派钉 never 与 seq3 重钉 ask 同毫秒）；父日志两次 `approval/policy` live append（seq67 ask、seq103 never）成功落盘，但已知子无任何新 policy append，也无 warn。(c) 真机未验证。

诊断测试：`packages/bridge/test/live-trigger-diagnosis.test.ts`（导入真实 `@deepseek-ai/cordis` 4.1.0 / `dsh-session` 0.2.2-rc.5 / `dsh-session-projection` / `dsh-user-approval`，绝对路径指向宿主安装闭包）。3 pass / 0 fail。另用一次性端到端脚本把真实 bridge `apply()` 接到真实 cordis 事件总线 + 真实 SessionStore + 真实 ApprovalService 上跑全链。

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

## 根因结论

**宿主对 `approval/policy` 没有按类型的发布过滤，也没有别的静默写入路径能解释「日志增长 + 子无 append + catalog 正常」的组合；H1/H2/H3 三项一手实证共同否证了「真机 (b) 死因是 approval/policy 不发布」这一假设。**

把真实 bridge `apply()` 接到真实 cordis 事件总线 + 真实 SessionStore + 真实 ApprovalService、真实 `session.open` 绑定后跑全链：catalog 触发 (a) 重钉 ask 成功；随后真实 `approval.setPolicy` 切 never，(b) 立即把子镜像到 never（`child override after parent never: never`，子日志 `never,ask,never`），无 warn。**即在可复现的真宿主装配下 (b) 是通的。**

真机与探针的差额无法在离线探针内复现，候选（需真机进一步取证，不在无证据下断定）：

1. 切策略那一刻该 parent 的 live append 落在一个**非 bridge 监听 ctx 可见 scope 的 session 实例**（H4 类机制：agent 实例/emitCtx 与 bridge 绑定不一致）；catalog 因由另一路径 note 到 index，给人「同一 session」的错觉。
2. 切策略那一刻 bridge 的 `binding` 为空或 index 行 parentSessionId 与事件 sessionId 不等，使 (b) 的守卫/行过滤静默跳过；此路径 `syncChildApprovalPolicy` 不被调用，故无 warn。

**不是宿主行为缺陷、不属于「红牌停车」情形**：宿主发布与读取均已实证正常。但 (b) 是恢复路径的**单点依赖**——它要求那一条父 `approval/policy` 事件恰好被 bridge 的 listener 收到。按评审认可的方向，补一条**已被证明可达的冗余触发器**（父 `turn/start` 时对已知子做全量 re-sync，desired 取实时 `effectivePolicy`），使恢复不再单点依赖那一条事件；不改宿主、不改冻结面。

## 残余 / 登记

- turn/start 冗余钩子要求策略切换后父会话至少再起一个 turn；`/permission` 的 `agent.inject` 会排一个 `user/message`，通常会带起 turn，但若进程在切策略后立即空闲且无后续 turn，(b) 仍是唯一即时路径——保留 (b) 不删。
- 真机复验建议：切 `/permission` 后立刻在父日志确认 `approval/policy` 条目的 `entry.emitCtx` 归属与 bridge 绑定 session 是否同一实例；若不一致则以本冗余触发器接管。
