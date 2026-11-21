# W1 — 新能力域切片（五层接线地图 + 七步标准流程）

适用：新增 CapIR 能力域，或把一段宿主能力接入生成链（S1 /model、S2 credentials/account、S3 主动推、S4 PKCE/stream、S5 config/agents 的实现形态）。前置：底座已冻结（`024-base-frozen.md:3`）。配套 [W5 预注册与证据](w5-proof-evidence.md)、[W4 评审](w4-review-gate.md)、[W7 宿主升级](w7-host-upgrade.md)、[W8 底座解冻](w8-base-unfreeze.md)。出处规则见 [README](README.md)。

## 一、五层接线地图（CapIR → capcontract → bridge → seam → TUI；ledger 为正门台账）

每层只列「动什么 / 禁动什么 / 怎么验」。行号基于本仓 `988c6f0`。

| 层 | 动什么 | 禁动什么 | 怎么验 |
|---|---|---|---|
| **1. CapIR（真源）** | 宿主能力**静态全集**由 extractor 采集；宿主 rc 升级走 [W7](w7-host-upgrade.md) 重跑 extractor | 禁手改 `capir/capir.json`；禁凭空写 id；禁把「已注册/已接线/环境状态」塞进 CapIR（只存全集，随 rc 锚定） | `gen-capir.mjs --check` 字节一致（`check-capcontract.mjs:1-2`）；attribution 首行在位（`capir/capir.json:1`）；声明行覆盖门禁 #6（`check-capcontract.mjs:241`）；id = `<pkg>#<ns>/<method>` 全量自洽（`024-base-task1-review-oldfox.md:35-41`） |
| **2. capcontract（生成物）** | 由 `gen-capcontract.mjs` 重生成 types/dispatch/binder；零 `@deepseek-ai` import、inject 声明式 | 禁手改 `capcontract/{types,dispatch,binder}.ts`；禁在生成物内裸 `ctx.<service>` 访问；禁从 CapIR 臆造参数 schema（CapIR 无 params schema，`024-base-task1-review-oldfox.md:82`） | `gen-capcontract.mjs --check` 字节一致；门禁 #3/#4/#5/#7、`--negative-self-test` 能抓臆造 Face（`check-capcontract.mjs:62-90,337`）；生成物首行声明（`capcontract/types.ts:1`） |
| **3. bridge hostInvoke 注册表** | 增 `CAP_HOST_WIRED_IDS` id（`packages/bridge/src/index.ts:581`）；写 `CAP_*_WIRE_METHODS` **表查找**把客户端帧名映射到 CapIR id，经 `createCapInvoke`→binder→dispatcher→`createCapHostInvoke`（`:907,1183`）；无 id 时显式 `NOT_WIRED`（`:909-911`） | 禁新增 `req.method === '...'` 手抄分支（@manual 面保持 11）；禁 hand-roll 投影用键名剥离代替逐字段白名单；禁把未 wired id 静默空流 | `check-capcontract.mjs` #8a wired_protocol 名集对账、#8b wired_manual==0、#9 host-face provenance、#10 dispatch 可执行（`check-capcontract.mjs:262-301,337,406`）；真机 CAP_SMOKE + `NOT_WIRED` 负例（S1 `024-s1-model-slice.md:70-76`） |
| **4. seam face**（`bridge-session-seam.ts`） | 在 seam 上暴露真实 face（如 `settings`/`agents` 对象 `:1235,1244`），或把某帧从 `unsupported` 改为经生成链路（S1 `024-s1-model-slice.md:39`）；缺服务降级为 `UNSUPPORTED`，不崩 | 禁「永远降级」假绿面（S5 把三处 `{}` degrade 换成真实现，`024-s5-config-slice.md:27`）；禁在 UI 层 mock 数据凑绿（S4 评审 §六.4）；禁为让红转绿绕过降级路径 | 既有 seam 断言一字不改、新增正向 flatten 测试（`024-s2-credentials-slice.md:159`）；`bun test packages/shell`；真机握手 75/75（`024-s2-credentials-slice.md:22`） |
| **5. TUI 命令/面板**（`commands.ts`） | 命令检查 `ctx.seam.X`，无 face 走 `unavailable` notice（`packages/tui-base/src/routes/session/commands.ts:1100-1101`）；hook（openPlugins/openAgents…）在 `v2-entry.tsx` 接线（`025-command-surface-audit.md:8`） | 禁改与能力无关的键位/文案（归 JUDGMENT，W5）；禁把降级 notice 改成假数据 | `.ans` 数值帧（`capture-pane -e -p`，禁 PNG/视觉模型）；verify70 面板项（`024-e2e-rework.md:30`） |
| **台账正门 ledger** | 由 `gen-ledger.mjs` 从 `ledger/provenance.json` **重生成** `ledger.json`/`.md`；登记维度：full / expected(75) / wired_protocol(10) / wired_manual(0) / wired_capir_generated(24) / i_class(6)（`gen-ledger.mjs:9-16`） | 禁手改 ledger 生成物；禁把 @manual 手抄线混进生成 id；禁把 ADR-0010 协议帧计入 @manual（`024-tag-premise-adjudication-oldfox.md:10-40`） | 双跑 sha 一致（幂等）；check #8a/#8b 对账；`wired_manual=0` 为 tag 前提（`024-tag-prep-final.md:15-27`） |

**实例行号（表查找模式）**：S1 `CAP_MODEL_WIRE_METHODS`（`index.ts:1201-1206`，含 `model.currentSelection→modelCatalog` 投影）；S5 `CAP_SETTINGS_WIRE_METHODS`（`:1230-1233`）；S4b `CAP_ACCOUNT_WIRE_METHODS`（`:1248-1259`，10 unary；2 stream 走 `createAccountWatchRelay` 不进表）；0.24 收尾 `CAP_SESSION_WIRE_METHODS`（`:1220-1222`，session.list 迁链）。handleLine 分派点：`:3695` / `:3737` / `:3776` / `:3805`。

## 二、七步标准流程

出处：`dsh-opentui-024-delivery-plan.md:58`（流程骨架）、各片报告（S1–S6、SK）。

### 步骤 1 — 切片票 + 预注册（先落盘）

按 [W5](w5-proof-evidence.md) 写 `00-preregistered-expected.md`：冻结 expected 机器断言 + pass criterion + JUDGMENT 预案 + 脱敏纪律。预注册须在**任何实现/捕获前**写盘（S1 `024-s1-model-slice.md:4` sha 留痕；SK `024-sk-keymap-slice.md:13-15`）。expected 用机器可判、环境无关的子句（预防条款见 W5）。

### 步骤 2 — 能力面定位（CapIR 有 id / 无 id 分流）

- **有 id**（在 CapIR 全集且属 profile expected 面）：走生成链，按五层地图接入。expected 面 = bundle 声明闭包从全集过滤（禁安装面 node_modules 解析）；257 全集只做计数对账、禁作握手基线（`dsh-opentui-024-delivery-plan.md:33-37`）。
- **无 id** 分流：
  - 桥协议面（多步/有状态/依赖 I 类服务，无 CapIR 同名 id）：登记 ADR-0010 `wired_protocol`，不计 @manual（`024-tag-premise-adjudication-oldfox.md:10-40`）。
  - 需 extractor 扩展：走 [W7](w7-host-upgrade.md)；若变更冻结面走 [W8](w8-base-unfreeze.md)。
- 一手核验宿主服务名与 @Remote 行号（`super(ctx,'<key>')`），写进预注册（S4 `024-s4-pkce-slice.md:44`）。

### 步骤 3 — 实现（最小改动、冻结面未碰）

按五层地图逐层落；@manual 手抄线片内即删（`dsh-opentui-024-delivery-plan.md:86`）；commit 只 `git add` 本片文件，剔除共享未跟踪 proof 路径（`024-s4-pkce-slice.md:152`）。红线自检：`capir/capir.json`、`capcontract/*`、`build-bridge.mjs` 转义段、ledger 生成物不在 diff（S5 `024-s5-config-slice.md:170`）。

### 步骤 4 — 机器门禁阶梯（逐级，红即停）

```
bun test packages/*                          # 单测：0 fail；既有断言零删除
node scripts/check-capcontract.mjs           # 契约门禁：PASS=14 NOT_RUN=0 FAIL=0
bash scripts/real-client-gate.sh --out ...   # 真机配方：exit 0 / REAL_CLIENT_GATE_PASS
npm pack --dry-run + ci.yml Pack job         # pack 冷启动握手
```

逐级含义与判绿见 [README 测试架构总表](README.md#测试架构总表跨-workflow-共享判据)。stream 类另需：defer 释放、BAD_KIND 门、cap.end 降级、复合键判序、同 session 多流交错集成测试（S4 `024-s4-pkce-slice.md:24-25,69-73`）。

### 步骤 5 — proof 证据包

按 [W5](w5-proof-evidence.md) 采 `.proof/<slice>/`：`00-preregistered-expected.md` + `00-pre-change.log`（反例基线）+ 门禁日志 + 真机 smoke + `.ans` + NOT RUN 声明 + `report.md`；脱敏扫描为**最后一步**（`024-s4-review-oldfox.md` §六.7）。

### 步骤 6 — oldfox 评审

按 [W4](w4-review-gate.md) 提交报告 + 证据；RED 停车条款生效（授权面外一手事实即停）。

### 步骤 7 — push + CI 三 job

push 分支 → `gh workflow run ci.yml --ref <branch>` → 核 `test (ubuntu)` / `test (macos)` / `Pack / cold start / bridge handshake` 三 job success，`real-client` skipped 如实记（`024-s1-model-slice.md:93-97`）。CI run URL 与 headSha 入报告。

## 三、预防条款（0.24 真实陷阱 → 现象 / 根因 / 预防）

1. **生成物 tree-shake 漏测**（现象→根因→预防）：生成物被打包后，helper 级测试过、线上路径不过。根因：测试直接调 `sanitizeFrameForWire` helper 而非驱动 `writeFrame`，且生成代码可能被 tree-shake 漏在 bundle 外（S4 评审 C4：`createAccountWatchRelay` constructed-but-unwired；S4 E3-wire helper 级）。预防：**生成物必须走 shipped bundle 验证**——bridge 二进制帧级测试起真子进程、走真实 stdio、驱动 shipped bundle 的 `apply()`（S4b `024-s4b-account-wire.md:57-71`）；CI 在 bun test 前先 build bundle，pack job 断言 guard 符号在 bundle 内（`024-s4-pkce-slice.md:56`）。
2. **多流 seq 键不一致**（S3 BL-1）：relay 按 `(sessionId, methodId)` 每订阅独立计 seq，seam 按 `sessionId` 单一 `lastSeq` 判序 → 同 session 第 2、3 条 stream 帧被静默丢弃；全部既有门禁看不出，因为 relay/seam 各测一半、无衔接（`024-s3-review-oldfox.md:6-51`）。预防：判序键统一为复合键 `${sessionId}|${methodId}`；丢弃路径加计数观测；**必须补 relay emit → seam consume 同 session 多方法交错集成测试**（S4 `024-s4-pkce-slice.md:69-73`）；预注册写死多流交错子句。
3. **臆造 API 无校验面（#9/#10 门禁由来）**：底座任务 5 曾出现臆造 `*Face`/`ctx.typert.local.invoke`（无真实校验面），门禁形同虚设（`024-base-core-review-oldfox.md:30-49`）。预防：新增 #9 host-face provenance（剥注释后扫 `local.invoke|*Face|inject:['typert']`，`check-capcontract.mjs:62-69,337`）+ #10 dispatch 可执行（shipped bridge 导入 binder、registry 与 ledger in_wired 对账，`:406`）+ `--negative-self-test` 证明谓词能抓臆造（`:75-90`）；#8 从计数比对升级为名集比对防换名漂移（`024-base-core-review-oldfox.md:47-49`）。
