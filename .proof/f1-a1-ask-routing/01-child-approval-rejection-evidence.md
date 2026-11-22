# F1 收尾 — 子会话审批被拒：逐跳证据（2026-11-22，真机实证 + 源码定位）

## 结论（一句话）

宿主 `dsh-subagent` 在委派时把子会话的 approval policy **钉死为 `never`**（`source: delegation`），
`dsh-user-approval.decide()` 在派发 `approval/request` waterfall **之前** 直接 `return 'rejected'`
（`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-user-approval/lib/index.js:200`），
bridge 的 F1 answerer（`onApprovalRequest`）**从未被调用**，因此：无 `ask.request` 帧 → 无子卡 →
子工具拿到 `Error: the user rejected tool "write"/"bash"`。这与 TUI 上看到的卡**无关**（见 hop 2）。

## 逐跳证据（每跳给可核对的一手来源）

### hop 0 — 真机会话（压缩 JSONL，已就地解压只读）

文件（`/private/tmp/dsh-demo-home/sessions/--private-tmp-fxv--/`）：
- 父：`072ee130-.../session.v4.jsonl.zstd`
- 子：`4e61c2d8-.../`、`486d39d2-.../`、`b94f0b07-.../`

父会话所有审批：`seq18 approval/asked write → seq21 approval/decided allowed-once`、
`seq54 … bash → seq57 allowed-once`、`seq79 … write → seq82 allowed-once`（父卡 Enter=Allow 成功，成立）。

子会话 **每个** 审批：
```
(1795344403248, 15, tool/call,      {name:"write", callId:"call_fc55df50e88048768aa6f3be", ...})
(1795344403249, 16, approval/asked, {id:"080842b1-...", toolName:"write", callId:"call_fc55df50e88048768aa6f3be"})
(1795344403249, 17, approval/decided,{id:"080842b1-...", outcome:"rejected"})   <-- 同一毫秒
(1795344403249, 18, tool/result,     {error:{name:"ApprovalError",code:"APPROVAL_REJECTED"}, text:"Error: the user rejected tool \"write\""})
```
`approval/asked` 与 `approval/decided` 时间戳**完全相同**（0ms 间隔），中间无人按键；
三个子会话的 6 次审批全部如此。另有：`seq2 approval/policy {policy:"never", source:"delegation"}`（每个子会话）。

### hop 1 — 宿主按 policy 短路，answerer waterfall 未触发

`dsh-user-approval/lib/index.js`：
- `:153-168 request()`：先 append `approval/asked`（:157），再 `await this.decide(req, session)`（:163）。
- `:200 decide()`：`if (this.effectivePolicy(session) === "never") return "rejected";`
  —— **在 :201 的 `ctx.waterfall(scopeTarget(req.agent, req.agent), "approval/request", ...)` 之前**。
- `:177-186 effectivePolicy/overrideOf`：取会话日志里最后一条 `approval/policy` 的 `policy`。

⇒ policy=never 时，bridge 注册的 `approval/request` answerer（`index.ts:3156 onApprovalRequest`）
根本不会被 cordis waterfall 调用。

### hop 2 — TUI 上那两张“子卡”其实带的是父 callId（关键纠错）

`/private/tmp/fxv-frames/04-child-card.ans`：`⚠ Approval: bash` +
`bash {"callId":"call_f108ae55d7c84aae8c88cd3a", ...}` —— 该 callId 是**父会话** seq54 的 bash 调用。
`/private/tmp/fxv-frames/05-child-approved.ans`、`06-child2-card.ans`：
`⚠ Approval: write` + `callId:"call_ed73df7781b7402db55755d9"` —— 父会话 seq79 的 write 调用。

子会话真实的 callId（`call_fc55df…`/`call_602eb1…`/`call_ed73df…` 之外，见 hop 0）**从未出现在任何卡片帧里**。
即：F1-A1/A3 的“弹卡”这半条链路真机并未被子审批触发；看到的是父会话自身审批（在子代理运行期间弹出）。
所以“按 Allow 却收到 rejected”不是卡片应答错位，而是**两件独立的事**：父卡 Allow→父工具放行（成功），
子工具被 policy 自动 rejected（无卡）。

### hop 3 — policy 来源：`dsh-subagent` 委派时钉死 never

`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-subagent/lib/index.js`：
- `:355-361 captureDelegatedPolicyOverrides()`：`approvalPolicy: parent.ctx.get("approval") === void 0 ? void 0 : "never"`
  注释 `:345-351` 明写 "the approval policy is pinned to 'never' regardless of the parent's own policy"。
- `:372-381 appendDelegatedPolicyOverrides()`：向**子会话日志** append `approval/policy {policy:"never", source:"delegation"}`。
- `:1943-1948 setup()`：`child.session.append("subagent/descriptor", …); appendDelegatedPolicyOverrides(child.session, …)`，
  在子 turn 启动前完成；`:1566 establishCatalogChild(parent.session, …)` 在 admit 回调里 append 父侧 `subagent/catalog`。

profile 父策略是 `workspace-write`（`approval:"ask"`），故父会话 ask 正常；委派覆盖把它改成 never。

### hop 4 — 应答链各跳（若 policy 为 ask 时的路径，已由源码 pin；真机本轮子审批未走到）

- seam `#answerAsk`（`packages/shell/src/client/bridge-session-seam.ts:4220-4293`）：
  子 ask 带 `parentSessionId` → `approvalArgs` 附 `eventId`（`:375-381`），
  `#approvalParams` 回 `{eventId, kind:"approval", verdict}`（`:4138-4159`）。
- transport wire：`ask.response`（`:4264`）。
- bridge `handleAskResponse`（`packages/bridge/src/index.ts:3682-3705`）：
  `ask.answer(binding.sessionId, parsed.value)`（`:3693`，用父键应答，符合 T5 不变量）。
- registry 查键（`packages/bridge/src/ask-registry.ts:406-428`）：
  `#pending.get(params.eventId)` → `entry.deliveredTo !== sessionId` 门；
  子 ask `create` 时 `deliveredTo = input.sessionId = target.sessionId = binding.sessionId`（`:296` + `index.ts:3061`），
  与应答父键一致 → 不是候选 b 的错位。
- settle：`ask.answer` verdict→outcome（`:444-458`）；`ask.settled` → `waitForAnswerer` →
  `onApprovalRequest` 映射（`index.ts:3078-3084`）approved→allowed-once / denied→rejected。
- 候选 a（C1 byName 串卡）：仅当 `eventId` 缺失时 `#matchApproval` fallback（`turn-overlay-controller.ts:380-385`）；
  子 ask 恒带 eventId（hop 4 首行），强 NO-match；且卡片只决定 escalation/eventId 关联，
  应答 eventId 由 seam `#approvalParams(request, …)` 用**自身** request.eventId，不会被父卡串改。
- 候选 c（ask-router 0.7.0）：只 `on('user-questions/request')`（插件 `lib/index.js:117`），**不碰** `approval/request`。
- 候选 d（onApprove/modal 错位）：`DialogConfirm onConfirm→allowed-once`（`turn-overlays.tsx:84`）；
  父卡 Enter=Allow 真机成立，同一代码路径，子卡无独立提交值来源。

## 修复方向

在 bridge 收到父侧 `subagent/catalog`（`index.ts:2779-2800`）时，若子会话仍在 binding 父下且当前
effective policy 确为 delegation 的 `never`，向**子会话日志** append `approval/policy {policy:"ask"}`
（等价于宿主 `setApprovalPolicy`），让 `decide()` 走 waterfall → bridge answerer → 子卡应答链。
不改冻结面；fail-closed：解析不到子会话/服务时保持原样，仍由宿主 never→rejected。
