# ask-router × bridge ask 仲裁只读调查

日期：2026-11-24。仅读源码与已装 `@aiwayds/dsh-ask-router@0.7.0`；未启动宿主、未改代码。

## 结论先行

**按当前工作树默认 roster（`packages/shell/scripts/lib/inproc-companions.mjs:43-49` 已把 ask-router 设 `defaultOn`）无已证实的功能冲突（严重度低）；引入任何 `askSurfaces` surface 后存在静默饥饿风险（严重度中）。** 本机现有 `opentui-inproc` 尚未安装 router，仅有 registry（`~/.dsh/profiles/opentui-inproc/package.json:4-13`），所以下列“同时挂载”结论来自源码链而非真机日志。0.7.0 的 ask-router **不提供/抢占 `userQuestions` 服务槽**，只是依赖该服务、提供 `askSurfaces` 并注册 waterfall 应答者。bridge 的 `ask.request` 是宿主→stdio 客户端的输出帧，不是 router 消费的共享槽。两者不会因此重复应答、重复弹 UI 或占槽失败；waterfall 只让第一个不调用 `next()` 的应答者处理请求。

必读票 `tickets/2026-11-24-inproc-D2-companion-parity.md:45` 与 `research/2026-11-24-inproc-only/05-companion-parity.md:37` 的“重复占槽”判断与当前 0.7.0 实现不符。router patch 注释 `~/.dsh/profiles/opentui/node_modules/@aiwayds/dsh-ask-router/cordis.patch.yml:2-9` 仍保留旧槽位说法；其 README `:7,12-14` 已明示单 provider 槽位在 rc 时代移除。

## 两侧注册 / 消费链

- **宿主发问**：base 挂 `user-questions`（`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml:79-80`）；`UserQuestionService.ask()` 调 `ctx.waterfall('user-questions/request', …)`（同宿主 `dsh-user-questions/src/index.ts:291-352`）。
- **ask-router**：patch 插入 `dsh-ask-router`（已装包 `cordis.patch.yml:11-14`）；`inject=['userQuestions']` 只是依赖（`lib/index.js:106`）；apply 提供 `askSurfaces`（`:107-110`）并注册 `user-questions/request`（`:117-120`）。**零 surface 时 `next()` 让位**；有 surface 时 fan-out、先答先得（`:64-105`）。全部 surface 失败会 reject，不回调 `next()`（`:86-95`）。
- **bridge**：根作用域注册 `approval/request` 与 `user-questions/request`（`packages/bridge/src/index.ts:3731-3744`）。questions 应答者投影字段后 `ask.create()`（`:3668-3726`），registry 发 `ask.request`（`ask-registry.ts:286-338`）；客户端 `ask.response` 再 `ask.answer()`（`index.ts:4284-4307`）。bridge 两条应答者都**从不调用 `next()`**；测试也明确断言这一点（`packages/bridge/test/ask-answerers.test.ts:209-214`）。
- **仲裁语义**：Cordis waterfall 顺序执行，未调 `next()` 即否决后续链（宿主 `cordis/src/events.ts:237-260`）；监听器按注册顺序 push（`:263-269`）。inproc 初始 bundles 为 base→bridge，companion 随后追加（`packages/shell/scripts/provision-inproc-profile.mjs:148-149,800-805`），静态顺序指向 bridge 先注册；**实际启动时监听器先后未实测**。
- **当前消费者**：全仓实现检索 `askSurfaces` 为 0；已装 `@aiwayds/*` 中只有非默认、明确放弃的 feishu 使用它（`~/.dsh/profiles/opentui/node_modules/@aiwayds/dsh-feishu/lib/bot.js:2206-2213`）。因此默认 roster 下 router 零 surface，questions 实际落到 bridge；approval 则始终由 bridge 独占。

## 现有开关 / 降级能力

- **router 自身**：无 config、env 或启用开关；patch 的 `config:{}` 未被 `apply(ctx)` 读取。唯一主动让位是“零 surface → `next()`”。
- **provision 层**：`DSH_OPENTUI_COMPANIONS` 可替换选择集，`DSH_OPENTUI_COMPANION_LATEST=off` 可全停安装步骤（`packages/shell/scripts/lib/inproc-companions.mjs:115-141`）。但 `managedBundles()` 保留已有 catalog dependency/bundle（`provision-inproc-profile.mjs:795-805`），故它们**只能在尚未安装时阻止新增，不能可靠卸载/停用已挂载的 router**。
- **bridge**：没有 answerer 级开关；仅 `askDeadlineMs` 配置（`index.ts:2810-2825`）。`DSH_OPENTUI_BRIDGE_STDIO` 关闭的是整个 stdio 插件，不是 questions answerer（`:1573,2055-2059`）。可用 `ctx.get('askSurfaces')` 检测 router，但现有代码未检测；router API 只能 `register(surface)`，没有“把当前请求转交”方法。

## 最小改动候选（不裁决）

| 方案 | 改动 | 风险 | 验收 |
|---|---|---|---|
| 1. 每请求动态让位 | `onUserQuestionsRequest` 在 `ctx.get('askSurfaces')?.list().length > 0` 时 `return next()`，否则走现有 bridge；approval 不变。 | 中：依赖 router 位于下游；surface 全失败时仍无 bridge 兜底。 | router 缺失/零 surface/有 surface 三态各仅一个应答者；有 surface 时 bridge 不发 `ask.request`。 |
| 2. bridge 作为 router surface | bridge 检测并 `register()` 一个 surface，questions 根应答者让位；surface.ask 复用现有投影/等待，settled 清理落选请求。 | 高：生命周期、abort、child 路由、先答先得与落选清理需同时正确。 | bridge+另一 surface 先答先得、另一方收起；零 surface、断连、turn 中止均不悬挂。 |
| 3. 显式所有权配置 | 新增 bridge/provision 的 `questionsAnswerer: bridge\|router`（或 env），按配置跳过 questions 根应答者。 | 中：配置漂移；选 router 但零 surface 时会 fail closed。 | 两模式矩阵、非法值拒绝；明确记录零 surface 的失败行为。 |

## 未覆盖项

- 未真实启动“bridge+router”宿主，实际监听器注册顺序、日志与 surface 失败回退均为**未证实**。
- 只核到已装 0.7.0；未验证未来版本，但 catalog 的 `^0.7.0` 守卫会拒绝 0.8+。
- 未评估新增 surface 后的 UI 体验、性能与宿主启动时序。
