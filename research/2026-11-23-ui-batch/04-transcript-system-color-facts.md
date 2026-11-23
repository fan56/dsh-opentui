# Transcript 系统执行文字着色：只读调查结论（2026-11-23）

调查范围：`/Users/qingguee/repo/dsh-opentui`（外层那个 `dsh-opentui/dsh-opentui` 只是启动脚本文件，不是目录）。本文件为只读调查产物，未修改任何源码文件。

## 1. transcript 渲染结构、消息 kind 与着色

结论：数据模型 `SeamRow` 有 7 种 kind：`user`/`assistant`/`interrupted`/`reasoning`/`tool`/`subagents`/`ask`；但 transcript 滚动区只画 `user`/`interrupted`/`assistant`/`ask` 四种，`tool`/`reasoning`/`subagents` 被显式过滤掉（移到 dock），命令回显、notice relay、error 全部落进 `assistant`。

证据：
- 类型定义 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/seam-rows.ts:71-162`
- 过滤 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/transcript.tsx:379-382`
- 颜色表 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/transcript.tsx:278-312`
- 分派 `rowView` `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/transcript.tsx:384-423`
- assistant 用 `<markdown>` + `fg=color.text()`（theme.text.base）渲染 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/transcript.tsx:338-357`
- user：带边框 box，`borderColor=hue.interactive[400]`，文字 `text.action.primary.base`，带 0.4s 淡入 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/transcript.tsx:386-400`、`:280`、`:288`、`:246-262`
- interrupted：琥珀色边框+文字（`text.feedback.warning.base`）`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/transcript.tsx:401-415`、`:301`
- ask：问题/表头 `text.muted`，答案 `text.action.primary.base` `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/transcript.tsx:543-566`
- 非投影行：loading 用 `text.feedback.info.base` `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/transcript.tsx:483-487`；pending queue 用 `text.muted`+斜体、steer 用 `text.action.primary.base` `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/transcript.tsx:491-513`

## 2. 斜杠命令回显的类型

结论：`/theme`、`/permission` 等所有 `ctx.say()` 输出在投影层变成普通 `kind:"assistant"` 行（key 前缀 `assistant:cmd:cmd-N`），与 assistant 正文走完全相同的 `<markdown>` + `text.base` 路径，当前**没有任何类型区分**。

证据：
- `say` 契约文档 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/commands.ts:191-195`
- `/theme` 文案 `t("command.theme.set")` → `ctx.say(...)` `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/commands.ts:1699-1732`；字符串 `/Users/qingguee/repo/dsh-opentui/packages/i18n/locales/en.json:169`
- `/permission` 每行都 `ctx.say` `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/commands.ts:1877-1936`；`available presets:` 构造 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/commands.ts:414-423`
- say → projection 的注入实现 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/examples/v2-entry.tsx:852-859`（`messageID:"cmd"`, `part.type:"text"`）
- 投影映射 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/seam-rows.ts:554-595`（`:573` kind=assistant，`:586` key=`assistant:cmd:cmd-N`）
- host relay notice（`role:"notice"`）同样映射为 assistant `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/seam-rows.ts:503-512`

## 3. 子代理状态行的绘制部件

结论：字面串「日志位置已定位，现在并行取证。」在源码里**没找到**（它是运行时子代理内容 tail）。这类行不在 transcript 里：它们画在编辑器上方的 activity/merged dock 下半区，由 `agentLine()` 生成，内容为 `<label> · <elapsed> · round N · <lastLine tail>`，其中 tail 就是子代理最后一行执行文字；颜色是蓝色 `agent` accent。

证据：
- 子代理 tail 拼入行 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/merged-dock.ts:390-411`（`:396` `widthTail(agent.lastLine)`）
- 蓝色 agent accent 定义与取色 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/widgets-dock.tsx:1260-1277`、`:1294`、`:1307-1312`、`:1316-1346`
- dock 数据来源 `mergedRunningAgents()` `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/widgets-dock.tsx:1479-1482`，注入 `agents` `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/widgets-dock.tsx:1621`
- transcript 明确过滤 `subagents` 行 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/transcript.tsx:328-332`、`:379-382`
- 旧 `lastrequest-dock` 已只保留用户请求回显，不再画子代理行 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/lastrequest-dock.tsx:197-201`

## 4. 主题取色与“新增语义色”的先例

结论：组件读的是 `ComponentTheme`（即 `ResolvedTheme`），token 家族为 `hue`/`categorical`/`text{base,muted,faint,action,formfield,feedback{error,warning,success,info}}`/`background`/`border`/`scrollbar`/`diff`/`syntax`/`markdown`，另有 `source/increase/decrease/surface` 方法；组件通过 `useThemeOptional()` 取，全部有 hex fallback。

证据：
- token 列表 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/vendor/theme/src/tui/types.ts:25-73`
- 包装器 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/theme/component.ts:1-51`
- 组件取色 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/context/theme.tsx:375-393`

先例（照抄用，二选一）：
- 最省事、无需改 JSON：`DockAccent` 语义色模式——声明一个新 accent 名，配 hue ramp 优先级 + 对比度校验 + 暗/亮 fallback，取色函数 `dockAccentColor()` 自动适配所有主题 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/widgets-dock.tsx:1277-1346`（`agent` 是现成例子）。
- 若要真正的主题 token：`text.feedback.info` 在 solarized 与 nord 都显式有 dark/light 值 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/theme/assets/solarized.json:46-49`、`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/theme/assets/nord.json:46-49`，由迁移层映射到 `text.feedback.info.base` `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/vendor/theme/src/tui/v1-migrate.ts:147-155`，v2 主题里同样有 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/theme/assets/v2/dsh-blue.json:38-48`，消费端示例 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/transcript.tsx:306`。注意新增 token 需同步 schema/类型，改动面比 accent 模式大。

## 5. 粗体/斜体/dim 的现有手段

结论：统一用 `@opentui/core` 的 `TextAttributes`，写在 `<text attributes={...}>` 或 span style 上，可与 `fg` 并用；transcript 自己已在用斜体。

证据：
- import `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/transcript.tsx:45`
- 斜体（排队等待行）`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/transcript.tsx:495-503`
- 斜体（dock think 行）`/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/widgets-dock.tsx:1789-1795`
- DIM `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/feature-plugins/system/diff-viewer.tsx:832-837`
- BOLD `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/ui/toast.tsx:90-94`；BOLD/DIM 集中映射 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/context/panel-kit-host.tsx:105-112`

## 对用户需求的含义

「系统执行文字换色」不是一处改色能解决的：**只有一部分天然可区分**。

- 已天然可区分：user 框、interrupted 行、ask replay、pending queue/steer、tool/reasoning/subagents（在 dock，各自有 accent 色）、notices dock（muted 正文 + warning 标记）。这些只要调对应颜色表即可。
- 必须新增分类：斜杠命令回显、`role:"notice"` relay、`error: ...` 本地错误行。三者目前全被塞进 `kind:"assistant"`，与模型正文共用 `text.base` + `<markdown>`；仅靠 key 前缀（`assistant:cmd:`/`notice:`/`error:`）在视图层特判虽然 diff 最小，但把协议语义编码进字符串，建议不要作为长期方案。

建议最小改法：在 `SeamRow` 加一个 `kind:"system"`（或 `system|systemError`），在 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/seam-rows.ts:507-512` 和 `:554-595` 分别把 notice 与 `messageID === "cmd"` 的 text part upsert 成该 kind（`final:true`）；在 `/Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/transcript.tsx:278-312` 加一个 `system` 颜色项，在 `:384-423` 的 switch 加 case，用 `<text fg=... attributes=...>` 纯文本渲染而非 `<markdown>`（避免回显里的 `#`/`*` 被当 markdown 解释）。颜色值优先复用既有 `text.feedback.info.base` / `text.muted`（两个主题下都有值，零 JSON 改动）；若要独立语义色，按 `DockAccent` 模式新增一个 accent/hue 映射即可，不必为 30+ 个主题 JSON 逐一加 token。

本次为只读调查，未修改任何源码文件；未执行 git commit。
