# W3 — 产品缺陷票流程（测试层红线外）

适用：E2E / 真机配方暴露的缺陷落在**测试层红线外**（产品 boot / 时序 / renderer / host 依赖），执行者不得自行改产品代码，须上报 → 用户拍板 → 修复刀 + 修复前反例。前置：缺陷已一手复现并定位到产品面。配合 [W4](w4-review-gate.md) 评审。出处：`024-e2e-rework.md:4,84,113-115`、`024-verify70-red-adjudication-oldfox.md:82-91`、`024-morning-acceptance-report.md:3,45-51`。

## 一、判定：什么算「测试层红线外」

- **红线内**（执行者可改）：门禁脚本、harness 定位器、证据采集脚本、预注册文案、断言更新（非删除）——属门禁资产，不算产品缺陷（`024-verify70-harness-fix.md:1-6`）。
- **红线外**（须上报）：产品启动时序、宿主连接/凭据、renderer 行为、bundle 分发机制。典型：E2E 容器族 `cookie-mint.ts:48 RETRY_WINDOW_MS=2000` 对慢 VM 首启不足 → `CredentialsFileMissingError`，容器 `20-start` TUI 起不来（`024-e2e-rework.md:84,115`）；[R] click-to-focus 曾疑 renderer autoFocus 缺陷（`024-verify70-red-adjudication-oldfox.md:66`）。
- 判红三档（oldfox 分档法见 [W4](w4-review-gate.md)）：结构性红（收敛于某切片）、harness 级联/断言缺陷（修 harness 后应绿）、疑似真缺陷 `[R]`（bisect 定责或缺陷票，二选一缺一即 FAIL）。

## 二、流程四步

1. **一手复现 + 定位**（不伪造、不沉默）：跑出问题帧、scratch 隔离、记录根因到 `file:line` 与证据路径；真机 gate 与容器 E2E 是两套环境，互不冒充覆盖（`024-e2e-rework.md:85-87`）。E2E 容器族因此**不计入 3 绿**，如实报 BLOCKED（同报告 `:87,115`）。
2. **上报 + 用户拍板**：通过 `RespondToCoordinator` 上报，写明现象/根因/修法候选（如「拉长/轮询 grant 等待」或「容器路径走 inproc bridge 绕过 cookie-mint」，`024-e2e-rework.md:84`）。判定类项走验收制——用户/协调者拍板，执行不自判放行。
3. **修复刀（授权后）**：改产品代码须显式授权；先落**修复前反例**锁住缺陷（S3 B2 修复先 `00-pre-change.log` 记 `leak:true` 再改，`024-s3-push-slice.md:23,56`；verify harness 修复同样留 pre-fix 帧，`024-verify70-harness-fix.md:26-39`）。修复后反例须转绿。
4. **重验面 + 评审**：按 [W4](w4-review-gate.md) 定复验范围（是否属底层架构变更决定扩不扩），跑门禁阶梯 + 真机配方 + CI 三 job；登记 NOT RUN/豁免，不静默删除。

## 三、`[R]` 误报的 bisect 定责范式（不立假票）

`pane-focus: click focuses transcript` 曾「干净会话仍红」，被疑 SK FocusRouter 或 renderer 缺陷。处置（`024-verify70-harness-fix.md:41-58`）：

- bisect 到 `bf74277^`（SK 之前）用同套 harness 复跑 → 同样 PASS，判**非 SK 引入**；
- 探针时序对照：冷启动立刻点击 NOT_FOCUSED、UI settle 后点击 FOCUSED → 假阴性来自探针在 renderable 就绪前取帧；
- 结论 **NOT-A-DEFECT**，立定责票存档，**不立产品缺陷票**（「无可复现产品缺陷，立票即造假」），bisect 分支满足 oldfox §1.1(e) 二选一。

预防：疑似真缺陷先 bisect + settle 对照，再决定是否升级为产品缺陷票；不可凭单次红帧立票。

## 四、预防条款（0.24 真实陷阱，就地归属）

1. **慢环境固定时序窗（cookie-mint 2s 教训）**：`cookie-mint.ts:48` 旧 `RETRY_WINDOW_MS=2000` 是「经验值」，慢 VM 首启写 grant 超过 2s 即 `CredentialsFileMissingError`。根因：固定常量未从证据推导、无轮询兜底。预防：
   - 等待窗口从**实测证据**推导并留余量（本仓现行 `DEFAULT_RETRY_WINDOW_MS=30_000`，注释明记「2000ms window proven too short on a cold/slow VM」，`packages/shell/src/client/cookie-mint.ts:57-58,74`）；
   - 用**轮询锁/grant 文件**替代固定 sleep（verify70 并入 E2E 时 oldfox §5.2 要求 cleanup 固定 `sleep 6` 改轮询 lock 消失，超时再告警，`024-verify70-red-adjudication-oldfox.md:105`）；
   - 慢时钟环境只认 **IMAGE ID**，不信墙钟（容器 VM 时钟慢约 1h48m，`024-e2e-rework.md:81`）；
   - 时序窗写入预注册风险段 + 故障注入验证，不写死环境依赖子句（W5）。
2. **环境不可达 ≠ 实现回归**：需账号态/live busy turn/浏览器回调/expiry 触发的项，走显式豁免而非缺陷票（`024-e2e-requirements.md:60-72`）；误判会造成「造票」或「放水」两头错。
