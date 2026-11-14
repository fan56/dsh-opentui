# /btw 排队回答体不渲染（PRODUCT RENDER GAP）— 只读诊断报告

日期：2026-11-11 · main=441edc8（0.9.6）· 调查方式：只读 + 只读测试，未改任何源码

---

## 8. 裁决结果（2026-11-12 增补：本地真机 trace 已裁决 — H-A/H-B 均不成立）

**真因是 H-NEW：e2e mock 的 btw 键取"首个匹配"与 /btw 会话复用相互冲突 —— Q2 的请求体（同一 throwaway session 的历史轮）内嵌 Q1 的 marker，mock 对 Q2 又发了一遍 ANSWER-ONE；ANSWER-TWO 从未上线。面板把"收到的正文"画得好好的。**

本地复现方法：scratch DSH_HOME（clone 用户 profile，baseURL→本地 mock-llm 8643）+ tmux 驱动 61-btw 场景（主回合 busy → Q1 → Esc → Q2 排队 → drained）。修复前 trace（`/private/tmp/btw-trace.log`）：

```
[btw 13:38:05.108] settle why=turn-end err=false deltas=1 ... out len=63 head="E2E-BTW-ANSWER-ONE — the deploy is green" ...
[btw 13:38:15.186] settle why=turn-end err=false deltas=1 ... out len=63 head="E2E-BTW-ANSWER-ONE — the deploy is green" ...
```

两次 settle 都是 63 字符的 ANSWER-ONE（第二次就是 Q2）——既无 `EARLY-EMPTY-SETTLE`（H-B 排除：非空结算），画面也画出了这段正文（H-A 排除：正文在线上、也能画；61-btw 的 GAP warn 只是 grep ANSWER-TWO 失败后落入的分支）。`btwAnswer` 的 `find(bodyText.includes(key))` 按数组序取 Q1 优先（mock-llm.mjs）；green→gap 翻转期客户端零 diff 的解释：翻转变量是 e2e 镜像里的外部 dsh host 版本——新 host 把 throwaway session 的历史轮装进了 LLM 请求体。

**修复**（e2e/lib/mock-llm.mjs）：`btwAnswer` 改"最后出现的 Q key 胜"（`lastIndexOf` 最大者），导出 + run-as-script 门（import 不绑端口）。修复后重放同场景：`settle out len=50 head="E2E-BTW-ANSWER-TWO"`，面板 settle 腿与 bare /btw review 腿均画出 `E2E-BTW-ANSWER-TWO — rollback is one command away.`。单测 pin 在 remote-btw-restart.test.ts（23 pass / 0 fail）。

遗留：61-btw.sh 的 warn 文案仍写 "PRODUCT RENDER GAP"——现在该分支若再触发，配合 `(empty answer)` 占位即可区分"真的空结算/丢行"与"内容错"（本文件未动，不在任务文件清单内）。

---

## 0. 结论一句话

`/btw` 排队（drained）回答的数据链路（mock → `askBtw` → `BtwController.last()` → `BtwPanel` 文本节点）在源码与数据层单测上**全部完好且与本仓改动无关**；gap 最可能是上游 OpenTUI diff-paint 在流式更新后丢行（`docs/upstream-opentui-paint-bug-draft.md` 已引擎级复现的同族缺陷）把 `<text>{run().answer}</text>` 这一行从终端画面上丢掉——**但数据层"提前空结算"竞态未被完全排除**，两者在现有 e2e 证据（仅 warn 字符串，无画面留档）下不可区分。

---

## 1. 场景断言原文（期望渲染什么）

`e2e/scenarios/61-btw.sh:89-106` `wait_answer_body`：

```bash
wait_answer_body() {
  local label="$1" text="$2" timeout="$3" waited=0
  while (( waited < timeout )); do
    if capture | grep -qF -- "$text"; then      # 期望：E2E-BTW-ANSWER-TWO 画进面板
      ok "$label"; return 0
    fi
    sleep 1; waited=$((waited + 1))
  done
  if capture | grep -qF 'Not kept in the session'; then
    warn "$label — the panel paints the settled Last-btw slot but not the answer body (PRODUCT RENDER GAP: ...)"
    return 0
  fi
  bad "$label (timed out ...; no settled slot either)"; ...
}
```

即：settled 的 Last-btw 槽位必须画出**回答正文**（mock 的 `E2E-BTW-ANSWER-TWO — rollback is one command away.`，`e2e/lib/mock-llm.mjs:62-64`）。只画出徽章 `Not kept in the session · /btw reopens this answer` 而无正文 → 记 warn GAP（`:100`）。两条腿：
- 排空结算腿 `61-btw.sh:259`：`wait_answer_body 'second answer settles into the panel' 'E2E-BTW-ANSWER-TWO' 30`
- 裸 /btw 复查腿 `61-btw.sh:316`：`wait_answer_body 'review carries the last answer' 'E2E-BTW-ANSWER-TWO' 10`

gap 首次记录：`0d951bb`（2026-11-11）commit message："61-btw: a settled Last-btw slot whose answer body is not painted is recorded as the known render gap instead of a timeout"。

---

## 2. 数据流（源码可证）

```
mock-llm.mjs phase=btw（一次性整段答案，mock-llm.mjs:346-356）
→ host 守护进程（外部 dsh，不在本仓）翻成 session/follow 帧
→ askBtw 内联 pump（packages/shell/src/client/remote-btw.ts:106-150）
   text-delta → out 累加(:124-131)；event turn/end → finish(:134-145)；onEnd/onFailed → finish(undefined)(:147-148)
→ RemoteHostSession.btwAsk（packages/shell/src/client/remote-host-session.ts:1742-1779）
→ session-seam-adapter.ts:415-417（纯透传）
→ BtwController.#start/#settle（packages/tui-base/src/routes/session/btw-overlay.tsx:117-144）
   onDelta → run signal；resolve → #settle → last signal → 队列头 #start(next)
→ BtwPanel.shown() = run() ?? last()（btw-overlay.tsx:152）
→ <text>{run().answer}</text>（btw-overlay.tsx:162）；徽章(:169-177)
→ 接线：v2-entry.tsx:501-509（ask/snapshot/onDelta 全部传入）；commands.ts:555-566
```

---

## 3. 竞争假设与排除证据

### H-A：上游 OpenTUI diff-paint 丢行（渲染层）——**最可能，未排除**
支持证据：
- `docs/upstream-opentui-paint-bug-draft.md`：引擎级最小复现（无应用代码），流式文本喂入时 **114/125 采样帧有行缺口**（0.7.0 与 0.8.2 同签名、跨 run 确定），SIGWINCH 与**全新 renderer/solid 树重挂载都不恢复**；"tail item in-place mutate" 的富形状损伤最重。e2e 用的正是同一 `tmux capture-pane` 采样法。
- 同一次 61 跑的主回合腿独立记录了同族现象（`61-btw.sh:270-292`：mock `stream=complete phase=main-slow` 但 DONE 永不画上）。
- **绿→gap 翻转而渲染/数据代码零改动**：`8c8091b`（"first green runs of 61-btw"）时 `:244` 还是硬断言 `wait_pane ... 'E2E-BTW-ANSWER-TWO'` 且跑绿；`git diff 8c8091b 0d951bb` 显示 `remote-btw.ts`、`remote-stream.ts` **零 diff**，`btw-overlay.tsx` 仅改了 idle DialogPrompt 的 Esc 路由（3536b45），`BtwPanel`/`BtwController` 一字未动。确定性数据丢失不可能在相同字节码下一次画一次不画。
- 该家族非确定（"observed once" 类记录），与绿→gap 的时间线一致。

### H-B：数据层"提前空/错结算"（askBtw 竞态）——**未完全排除（非确定变体）**
机制：`remote-btw.ts` 的 pump 对**任何**顶层 `turn/end` 帧或 `onEnd/onFailed` 都 `finish(undefined)` → 以**当时**的 `out`（可为 ""）resolve（:106-150）。Q2 复用 Q1 的 throwaway session（`previousSessionId`，:47,70,85），若 host 在 attach 后补发旧事件帧或流提前 end/失败，Q2 以 "" 结算 → `last.answer=""` → 徽章画、正文空，**症状完全一致**。单测也证明"零 chunk + turn/end ⇒ 空 answer"（remote-btw-restart.test.ts:110-114 `expect(await next).toBe("")`）。
排除/削弱的证据：
- 确定性变体被排除：协议文档 `remote-follow.ts:5-8`——durable 前缀（含旧 turn/end）装在**开头 snapshot 帧内**，而 askBtw 的 pump 只认 `assistant-stream`/`event` 顶层帧、忽略 snapshot；主会话 follow 明确注释"snapshot 内 turn/end 是历史，不结算 live await"（remote-follow.ts:513-514）。
- 并发 busy 守卫不会打断排队提升：`#btwBusy` 的 `finally` 在 controller `.then` 前跑（remote-host-session.ts:1749,1777-1779 + promise 语义）。
- 实测：本机只读跑数据层单测 `bun test packages/tui-base/test/btw-overlay.test.ts packages/shell/test/remote-btw-restart.test.ts` → **22 pass / 0 fail**（含二次提问复用 session、turn 错误、空流路径）。
- 无法排除的部分：onEnd/onFailed 早到、prompt 拒绝（"error: …" 正文同样会被场景记为 GAP，因为 `wait_answer_body` 只 grep 标记串）这类**非确定**竞态，需要真机画面/trace 才能区分。

### H-C：与 steer/queue 的 ComposerPendingRow 耦合 —— **已排除（源码可证）**
`BtwController` 自持四个 signal（btw-overlay.tsx:52-55），不读 composer 状态；`v2-entry.tsx:501-509` 独立实例化；`commands.ts:561` 仅调 `ctx.openBtw`。`⏸ 排队等待`/ComposerPendingRow 属主 composer 队列（composer-state.ts / transcript.tsx / session-composer.tsx），与 btw 无共享 store。`verify/steer-queue-repro.mjs` 验证的是另一条链路（busy Enter 弹 steer/queue 选择框）。唯一共享面是 dialog stack 容器本身。

### H-D：solid-js 解析为 server 构建 / createEffect 空转（历史教训）—— **已排除（本场景）**
该教训只适用于裸 bun test 渲染断言；容器 e2e 用真实 bundle。且同一面板同一响应式路径把 Q1 的 `E2E-BTW-ANSWER-ONE` 画出来了（`61-btw.sh:236-255` 的 ONE 检查），若 reactivity 断裂，question 与 answer 两个兄弟节点会一起消失。

---

## 4. 解读陷阱（下次跑场景前必读）

`BtwPanel` 徽章在 `shown()` 为 **undefined** 时也画 settled 串（btw-overlay.tsx:169-177：`shown()?.status === "streaming" ? ... : "Not kept in the session..."`）。所以"画了徽章"≠"last() 存在"。**review 腿若打开的是 PANEL（而非 Ask anything 输入框）才证明 `last()` 存在**（btw-overlay.tsx:219 的 review 门）。另：`wait_answer_body` 无法区分"正文是空/error 文本"与"正文正确但被 diff-paint 丢掉"——两者记同一 warn。区分手法：带 `-e` capture 看 **question 行**是否在（question 与 answer 是同一 Show 块的兄弟节点；question 在而 answer 不在 ⇒ H-A 权重大增）。

---

## 5. 未验证项

1. 未在容器重跑 61-btw（宿主机环境自动 skip；本次只读诊断不允许起容器长跑）——gap 无法现场复现，只能引用 0d951bb 的记录。
2. H-A 与 H-B(非确定变体) 在现有仓库产物内不可区分：没有 gap 那次跑的画面留档（warn 字符串是唯一痕迹）；`askBtw` 无 `DSH_OPENTUI_DEBUG` trace（对照 remote-follow.ts:144-149 有 followTrace，remote-btw.ts 没有）。
3. host 守护进程源码不在本仓（`session/follow` 回放语义只能引 client 侧协议注释 remote-follow.ts:5-8，不能读 host 实现核对）。

---

## 6. 用户可自行复核的最小命令

```bash
cd /Users/qingguee/repo/dsh-opentui
# 1) 数据层全绿（本次已实测：22 pass / 0 fail）
bun test packages/tui-base/test/btw-overlay.test.ts packages/shell/test/remote-btw-restart.test.ts
# 2) 绿跑→gap 之间 btw 渲染/数据代码零改动（输出应为空 diff + 仅 Esc 注释/路由改动）
git diff 8c8091b 0d951bb -- packages/shell/src/client/remote-btw.ts packages/shell/src/client/remote-stream.ts
git diff 8c8091b 0d951bb -- packages/tui-base/src/routes/session/btw-overlay.tsx
# 3) gap 断言原文与首次记录
sed -n 89,106p e2e/scenarios/61-btw.sh
git log -1 --format=%B 0d951bb | grep -A1 '61-btw'
# 4) 引擎级渲染家族证据
sed -n 1,60p docs/upstream-opentui-paint-bug-draft.md
# 5) 容器内真机复跑（区分 H-A/H-B，需 podman/docker 环境）
e2e/run-e2e.sh   # 或既有容器入口；跑 61 后保留 pane capture + mock log
```

---

## 7. 最小修复方案（按证据等级分两步，均不牵动 steer/queue）

1. **先加区分 instrumentation（低风险，先做）**：给 `remote-btw.ts` 的 pump/finish 路径加 `DSH_OPENTUI_DEBUG` trace（照抄 remote-follow.ts:144-149 的 followTrace），并在 `BtwPanel` 的 settled 分支把 `answer.length` 放进 debug 输出或在 answer 为空串时不渲染空 `<text>` 而渲染 `(empty answer)` 占位（btw-overlay.tsx:162 附近）。下一次容器跑即可判 H-A/H-B。
   - 不牵动 steer/queue：只动 askBtw（shell client 第二会话流）与 BtwPanel 渲染分支，composer 队列不经过这两个文件。
2. **若确认 H-A（渲染家族）**：修在 `BtwPanel`（btw-overlay.tsx:153-179）——把 streaming/`Thinking…`/settled 三态拆成互斥分支节点（按 `status`+`answer===""` 给文本节点换 key/`<Show keyed>`），让 settle 时是**节点替换**而非同一 `<text>` 的 in-place 文本突变（draft 文档指认 in-place tail mutate 是损伤放大器）。同时向上游提 bug（draft 已备好）。渲染层修复天然与 steer/queue 无共享代码；若上游补丁落地，本仓只需升 vendored @opentui 版本。
