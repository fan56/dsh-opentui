# T9 后 `/model` 会话级读写核查

## 结论

- **会话级**：写可用；读降级。`selectModel` 已接会话级写入并在下一次请求生效；`currentModelSelection` 读的是 `agentDefaultModel.currentSelection()`（最近保存的部署默认），不是 live session 的权威路由，seam 自身也标为 `PARTIAL`。
- **部署默认副写**：host 的 `selectModel` 会后台调用 `agentDefaultModel.saveSelection(selected)`，因此 `/model` 会静默改写新会话默认。`model.currentSelection` 实际是「最近保存的部署默认」，不能代表会话 live 路由。这一结论来自 rc.2 安装包源码；rc.5 形状尚未逐行核对。
- **模型目录**：可用。`modelCatalog` 展开 host provider groups；缺帧时明确 `UNSUPPORTED`，不伪造目录。
- **T9**：**未发现退化**。T9 前后这三个方法体无差异；T9 对该 seam 文件只改了 `DEFAULT_PROFILE` 的导入路径。

## 三条调用链

`BridgeSessionSeam` 直接 `implements SessionSeam`，三个方法就是 seam 成员，无额外适配注册：`packages/shell/src/client/bridge-session-seam.ts:1412`。

1. **读当前选择**：`dispatchLine` → `/model`（`packages/tui-base/src/routes/session/commands.ts:2108-2122`、`:767-769`）→ `currentModelSelection()`（`:831-835`）→ 当前行标记（`:863-868`）→ `BridgeSessionSeam.currentModelSelection()`（`packages/shell/src/client/bridge-session-seam.ts:3993-4006`）→ transport `model.currentSelection` → 注释声明其来源为 `ctx.agentDefaultModel.currentSelection()`（`:3994-3999`）。`packages/shell/src/client/remote-model.ts:10-14` 明确：该 in-process 读数是冷启动标签源，live session 有效选择应读 `session/projections` 的 `modelSelection`。但 `session/projections` 当前在 bridge 为 `NOT_WIRED`，不能直接读取后宣称问题已解决。
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

## session/projections 接线现状

`session/projections` 当前在 bridge 为 `NOT_WIRED`。接线需 host arm、`CAP_HOST_WIRED_IDS`、wire 及 provenance/ledger 再生，不属于 client-only 改动。因此不能把「读 `session/projections` 即可」作为本次最小修法。

## oldfox 决策：RESTORE

**结论：RESTORE，不做 DEPRECATE/NO ACTION。**

### 根因

`/think` → `thinking.selectEffort()` 先读 `currentModelSelection()` 再写 `selectModel`；会话路由≠部署默认时会把模型改回默认。`#catalogEfforts()`、`currentEffort()`、`sessionInfo().model` 也依赖同一来源。

### 最小实现

全部 client 侧，无新 bridge 帧/协议版本：

1. `bridge-session-seam.ts` 新增 `#modelRoute` 缓存，复用 journal drain/replay；折叠 `model/selection`=pending、`request/header.config`=lastUsed；pending 与 lastUsed 相同则清 pending；会话切换清空。
2. `currentModelSelection()`：有 bound/staged session 时返回 `pending ?? lastUsed`；无会话/缓存未建立才回退 `model.currentSelection`；缓存缺失且有会话时可触发一次尾部 replay。
3. `selectModel`/`selectEffort` 回包写入缓存；`currentEffort()`/`#catalogEfforts()` 改读同一缓存。
4. 测试：seam journal 折叠、pending 消费、回包立即生效、无会话回退；tui-base `/think` 在默认 B/会话 A 时只改 effort，不改回 B。

### 风险

- journal 折叠与 host `applyModelSelectionProjection` 漂移。
- 首次读竞态。
- `saveSelection` 副写默认。
- 读放大必须缓存。
- 旧会话无 `model/selection` 时回退默认。

### 验收条件

1. 会话 A 最后请求 p1/m1、部署默认 p0/m0；`/resume A` 后 footer/picker/`/think` ladder 显示 p1/m1；`/think` 只改 effort。
2. `/model p2/m2` 后未发下一轮 footer 立即显示 p2/m2；发完一轮仍是 p2/m2。
3. 冷启动无会话走 `model.currentSelection`；旧 bridge/旧会话不抛错、不显示假路由。
4. seam + commands 测试全绿；不触碰 capcontract/ledger。
5. 报告保留「默认值被 selectModel 副写」说明。

### 未覆盖

- rc.5 projection 形状未逐行核。
- 真机 `selectModel` → 下一轮载荷未验。
- inproc `saveSelection` 落盘未真机验。
