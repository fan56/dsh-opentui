# 026 web-mirror — 切换流（映射 #3–#11）一手核验与停车登记

> 本文件是切片 3 的「已验证部分」：逐方法一手核验 rc.5 安装包 / CapIR / expected face / 放行状态 / bridge arm / profile compose，结论是全部切换子流**需 W8 解冻生成器面 + profile compose**，按任务书「不硬造」登记「等宿主升级」停车。无假切换实现。
> 核验时点：`2026-11-22`（与 `.proof/026-web-mirror/00-preregistered-expected.md` 同批）。宿主 `dsh 0.2.2-rc.5`。分支 `feat/026-web-mirror`。
> 蓝本：`wayfinder-web-profile/research/026-web-profile-implementation-deep-dive.md` 映射表 #3–#11 + 分类汇总。

## 1. 逐方法一手核验（宿主有 RPC ≠ TUI 可用）

| 方法（深读映射行） | rc.5 安装包 | CapIR（冻结 257） | `CAP_HOST_WIRED_IDS` 预期表 | `CAP_GENERIC_ADAPTERS` 放行集 | bridge arm / profile compose | 判定 |
|---|---|---|---|---|---|---|
| `session/working-directory/get`+`set`（#3/#4） | SDK 面有（深读 1.2(a)），非 Typert Remote | **0 命中** | 无 | 无 | 无 | **缺方法**：CapIR 需 W8 解冻新增 + SDK 传输私有方法；等宿主升级 |
| `directoryPicker/pick` / `list` / `createDirectory`（#5） | 有：`dsh-api-workspace-controller/lib/typert.remote-client.d.ts:13-15,31-33,53-55`（`(path,signal)` / `(path\|undefined,signal)` / `(signal)`），宿主另装 `dsh-host-directory-picker*` | 有（createDirectory/list/pick） | 有（`:96-98`） | 无 | **无 bridge arm**（`createCapHostInvoke` 无 workspace 分支，落 `:1378 NOT_WIRED has no host arm`）；`inject` 只 `['agents',...HANDSHAKE_INJECT]`（`index.ts:618`），无 `workspaceController` 服务 | **需 W8**：补 host arm + service compose + inject；停车 |
| `workspace/create`（#6） | 有：同上 d.ts `:19,35,57`（`{request}` → `WorkspaceCreateValue`） | 有 | 有（`:100`） | 无 | 同上无 arm/compose | **需 W8**：停车 |
| `workspace/follow`（#2 显示数据源，切片 2 已登记） | 有：同上 d.ts `:21,37,59`（stream） | 有 | 有（`:102`） | 无（且 stream 不在 generic unary  arm 范围） | 同上无 arm/compose | **需 W8**：cwd 显示已退化为 `session/list.cwd` basename，不取 title/path |
| `session/create`（#7 下游） | 有 | 有 | 有 | n/a（hand-wired） | 已 wired（bridge session family arm） | 可用，但上游 #5/#6 缺 → 整条切换流仍停 |

一手出处：
- 宿主安装包：`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-api-workspace-controller/lib/typert.remote-client.d.ts`（本批实读，上面 file:line）。
- 本仓：`capir/capir.json`（working-directory 0 / workspace+directoryPicker 有）；`capcontract/types.ts:96-109`（expected face）、`:2343`（generic 放行 31，无这些 id）；`packages/bridge/src/index.ts:618`（inject）、`:1024-1038`（放行门）、`:1374-1378`（最终 NOT_WIRED 兜底）、无 workspace arm（grep 实查）；`node scripts/check-capcontract.mjs` PASS=22。

## 2. 停车登记（等宿主升级 / W8）

| 映射行 | 子流 | 处置 |
|---|---|---|
| #3 | 原地 cd 写路径 working-directory get/set | **停车**：CapIR 命中 0。需先把该 SDK 面纳入 CapIR 真源（W8 解冻生成器面）+ 桥接私有 protocol 方法 + profile compose；当前不实现 cd。 |
| #4 | 原地 cd 结果 `{cwd}` 校验 | **随 #3 停车**：1:1 校验逻辑仅在 #3 打通后适用。 |
| #5 | 换目录① directoryPicker/pick/list/createDirectory | **停车**：宿主有 RPC，但 CapIR 有 id 却无 bridge arm、无 generic 放行、无 service compose/inject。需 W8（补 arm）+ profile compose。TUI 文本路径输入也缺宿主校验 RPC，不硬造。 |
| #6 | 换目录② workspace/create 登记 | **停车**：同 #5。 |
| #7 | 换目录③ openWorkspace→connectBlank→sessions.create | **停车**：`session/create` 已 wired，但 blank 发现依赖 workspace 投影（#2 缺）→ 整流不可用。 |
| #8 | 切换成功刷新 pendingWorkspaceId | **随 #7 停车**：适配点（改以「新 sessionId 出现在 list」为落地条件）记录，待上游打通再实现。 |
| #9 | 切换错误 picker Modal | **随 #5 停车**：适配点（TUI 提示条/overlay + 重试）记录。 |
| #10 | 切换错误 createFailed toast | **随 #7 停车**：适配点（文案映射 TUI 通知、不吞错）记录。 |
| #11 | 两套语义取舍 (a)/(b) | **部分登记**：命名约定 `/cwd`=显示（已实现，切片 2）；「新项目」入口依赖 #3/#5，停车。 |

## 3. 未来实现须走的门（不越界）

1. **W8 解冻生成器面**：CapIR 真源加 working-directory 私有方法（#3）；重跑 gen-capir/gen-ledger，冻结面 diff 显式决策。
2. **bridge host arm + service compose**：为 directoryPicker/* 与 workspace/create 补 hand arm（或 generic 放行 + service binding），并在 opentui profile 注入 `workspaceController` 服务（当前 `inject` 无此项）。
3. **TUI 适配**（深读映射 #7–#11 已记录）：路径输入替代 OS chooser；blank 发现用 `session/list.cwd` + workspace 归属；新 sessionId 出现为落地条件；错误走 TUI overlay/通知并保留重试；`/cwd` 与新项目入口命名区分。
4. **真机门禁**：W5 预注册 + build fingerprint 先行 + `.ans` answer-bearing + 负例必红 + CI 三 job。

## 4. 纪律声明
- 本切片**未**改动 capir.json / ledger（冻结面 diff=0）；未新增任何 wired id。
- 未实现任何假切换 / 假 cd；所有缺方法子流如实登记「等宿主升级」。
- 无凭据值落盘；SENTINEL 仅固定合成串。
