# T9 后 `/model` 会话级读写核查

## 结论

- **会话级**：写可用；读降级。`selectModel` 已接会话级写入并在下一次请求生效；`currentModelSelection` 读的是 `agentDefaultModel.currentSelection()`（默认/冷启动值），不是 live session 的权威路由，seam 自身也标为 `PARTIAL`。
- **全局默认**：**全局默认未实现/不暴露**。`/model` 只调用会话级 `selectModel`；指定范围内没有写 `agent-default-model` 的入口。
- **模型目录**：可用。`modelCatalog` 展开 host provider groups；缺帧时明确 `UNSUPPORTED`，不伪造目录。
- **T9**：**未发现退化**。T9 前后这三个方法体无差异；T9 对该 seam 文件只改了 `DEFAULT_PROFILE` 的导入路径。

## 三条调用链

`BridgeSessionSeam` 直接 `implements SessionSeam`，三个方法就是 seam 成员，无额外适配注册：`packages/shell/src/client/bridge-session-seam.ts:1412`。

1. **读当前选择**：`dispatchLine` → `/model`（`packages/tui-base/src/routes/session/commands.ts:2108-2122`、`:767-769`）→ `currentModelSelection()`（`:831-835`）→ 当前行标记（`:863-868`）→ `BridgeSessionSeam.currentModelSelection()`（`packages/shell/src/client/bridge-session-seam.ts:3993-4006`）→ transport `model.currentSelection` → 注释声明其来源为 `ctx.agentDefaultModel.currentSelection()`（`:3994-3999`）。`packages/shell/src/client/remote-model.ts:10-14` 明确：该 in-process 读数是冷启动标签源，live session 有效选择应读 `session/projections` 的 `modelSelection`。
2. **写下一次请求选择**：`dispatchLine` → `/model provider/model`（`packages/tui-base/src/routes/session/commands.ts:807-823`）或 picker 提交（`:930-935`、`:982-987`）→ `seam.selectModel` → `BridgeSessionSeam.selectModel()`（`packages/shell/src/client/bridge-session-seam.ts:4353-4366`）→ transport `selectModel`，携带 bound/staged `sessionId`（`:4354-4360`）。语义为会话持久化、作用于该会话下一次请求：`packages/shell/src/client/remote-model.ts:18-23`。
3. **读模型目录**：`/model` 裸命令（`packages/tui-base/src/routes/session/commands.ts:831-840`）→ `seam.modelCatalog()` → `BridgeSessionSeam.modelCatalog()`（`packages/shell/src/client/bridge-session-seam.ts:4328-4344`）→ transport `modelCatalog` 的 `groups` → `{providerID, modelID}[]` → picker（`packages/tui-base/src/routes/session/commands.ts:864-868`）。

## T9 前后差异（仅 model 相关）

- `git diff c7df08d^ c7df08d -- packages/shell/src/client/bridge-session-seam.ts`：唯一改动是 `DEFAULT_PROFILE` 从 `lifecycle.ts` 改为 `profile-constants.ts`；`currentModelSelection`、`selectModel`、`modelCatalog` 均未改动。
- `git show c7df08d^:...` 与当前文件对这三个方法做 diff：无输出，方法体一致。
- `git show --stat c7df08d`：删除了 model 相关测试 `packages/shell/test/remote-model-settings.test.ts`（另有 `remote-selection-error.test.ts`）。这是远程 HTTP 栈测试删除，不是 in-process model 方法删除；当前 inproc 仍有正向目录与命令测试。

## 测试证据

- `/model bare opens the picker from the catalog and selects on pick`：断言读取目录、标记 current、提交 `selectModel`、刷新 footer。`packages/tui-base/test/commands.test.ts:513-532`
- `/model provider/model selects directly (no picker)`：断言直接写入且不弹 picker。`packages/tui-base/test/commands.test.ts:544-550`
- `/model bare: an unsupported modelCatalog (inproc bridge) degrades to a notice`：断言 `UNSUPPORTED` 不变成未捕获异常。`packages/tui-base/test/commands.test.ts:1243-1270`
- `currentModelSelection projects provider/model → providerID/modelID when the frame exists`：只验证帧投影。`packages/shell/test/bridge-session-seam.test.ts:576-580`
- `modelCatalog flattens provider groups into {providerID, modelID} rows`：正向展开。`packages/shell/test/bridge-model-flatten-positive.test.ts:29-44`
- `wire-frame value wrapping {value} without groups still degrades UNSUPPORTED`：缺 groups 的诚实降级。`packages/shell/test/bridge-model-flatten-positive.test.ts:58-60`
- `selectEffort() forwards provider/model/reasoningEffort to selectModel and rejects on failure`：验证同一 `selectModel` transport 的接受/拒绝传播，但未断言 `sessionId`。`packages/shell/test/bridge-session-seam.test.ts:754-765`

## 未覆盖项

- 指定测试没有证明：执行会话级 `selectModel` 后，`currentModelSelection()` 会重读该会话的新路由；现有测试只 mock `model.currentSelection` 的返回值。
- 没有直接断言 `selectModel.params.sessionId` 的 bound/staged 传播；host 端实现不在本次只读范围。
- 未运行测试，未检查真实 host 接受后的下一次请求载荷。

## 最小修法草案（不实施）

让 `currentModelSelection()` 在存在 bound/staged `sessionId` 时读取 `session/projections.modelSelection`（`pending` 优先，回退 `lastUsed`）；仅在无会话的冷启动阶段回退 `model.currentSelection`。补一条“`selectModel` 成功后重读返回新会话路由”的桥接测试，并断言请求携带 `sessionId`。
