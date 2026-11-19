# 0.23.0 立项：默认翻转 + 幽灵/视图两修

日期：2026-11-19。分支：`feat/023-flip-sweep-20261119`（基点 main `975a9a3`，即 v0.22.0 发版 commit）。
事实底稿：workhorse 只读调查（2026-11-19，全文 file:line 落地，未打印任何凭据/日志值）。
接替文档：`/private/tmp/handoff-dsh-opentui-0220-shipped-20261119.md`。

## 决策状态图例

- **[已拍板]**：用户在前序会话显式拍板，或已写入 ADR/CHANGELOG 公开承诺。
- **[临时假设]**：本轮口询未获用户回答，按主协调者推荐执行；**发版前必须复核，可随时推翻**。

## 范围（0.23.0）

| 项 | 内容 | 依据 | 状态 |
|---|---|---|---|
| T1 | registry sweep 杀 aborted 幽灵 running | ADR-0010:218① | [已拍板] |
| T2 | 子 journal 补 rounds/lastLine/model（ctrl+g） | ADR-0010:218② | [已拍板] |
| T3 | 默认翻转 + `--remote` 移除 | CHANGELOG.md:17-19 公开承诺 | [已拍板] |
| T4 | env 逃生门 `DSH_OPENTUI_INPROC=0` 保留 | 主协调者推荐 | [临时假设] |
| — | M3-09 legacy preset 清理 | tickets/2026-11-18-m3-append-inventory.md:86,111 | **暂缓**（票面写明需用户拍板） |
| — | 恢复阶段二（退避/心跳/fingerprint 确认流） | ADR-0010:51 | **推 0.24**（除 ADR 枚举外无细则） |
| — | aborted 残留上游 issue | ADR-0010:130 | **只本地起草**（外发需用户确认） |

## 事实底稿（关键项，全量见 workhorse 报告）

1. ADR-0010 修订记录末条 = `docs/adr/0010-session-seam-lifecycle-contract.md:218`。
2. CHANGELOG 承诺原文：`CHANGELOG.md:17` "Flipping the default to the bridge is planned for 0.23.0."；`:18-19` `--remote` slated for removal in 0.23.0。
3. remote sweep 参考：`packages/shell/src/client/remote-subagents.ts:277-304`（`refreshFromList()`：`session/list` → 过滤 `origin==="subagent"` + `parentSessionId` 匹配 → `row.running===false` 且本地 running → 直接写 `status:"completed"`，**不走 `#settle()` helper**，best-effort try/catch）。触发点：`remote-host-session.ts:2619-2621`（turn 末）+ `:2849-2855`（api-session/added）。**remote 无 recover 触发点**——ADR 的 "recover 时 sweep" 是 bridge 侧新增要求。
4. bridge 钩子：turn 末 = `packages/bridge/src/index.ts:990` `finalizeTurn()`，`turn/end` 分支 `:1199-1202`，idle 安全网 `:1758`。**bridge 无 `recover` 事件**；恢复由 client RPC 驱动：`bridge-session-seam.ts:1218` `recoverSession()`（注释 `:1216` "no retry loop"）、`bridge-transport.ts:352` `recover()`。注册表读能力已有：`session.list` handler `index.ts:1945`（透传 `ctx.sessionController.list`，字段含 `running`/`parentSessionId`/`origin`）。
5. ctrl+g 恒 0 根因 = 数据源没接（非解析 bug）：`bridge-session-seam.ts:512-514` 注释自认 "bridge only sees the parent journal, so rounds stays 0, lastLine/model are absent"；`rounds` spawn 时硬编码 0（:629, :680），settle 继承（:553）；model/lastLine 无赋值来源。remote 口径：`remote-subagents.ts:589-601`（descriptor→model）、`:603-628`（assistant/message→rounds++、lastLine 尾部）。
6. 子 journal 真实样本（结构已验证）：`~/.dsh/sessions/.../<childId>/session.v4.jsonl.zstd`，zstd JSONL，每行 `{seq,type,data}`；`subagent/descriptor` 带 agentModel/agentProvider/label；`request/context` 带 model/contextWindow/provider；`assistant/message` 每行计 1 round。
7. M3-09：清理 legacy `opentui` profile 的合成 preset `preset-opentui-append-system`（`~/.dsh/profiles/opentui/cordis.patch.yml:393-540`，保留 managed marker 393-394），需 `managedSpan()`（`append-system.ts:313`）导出复用；inproc profile 不做（provisioning 会覆盖）。**暂缓。**
8. aborted 残留：宿主在父 turn aborted 时不写 `subagent-settled` 行（真机样本 `2d692fc9`），本机无宿主仓 → 上游动机 UNKNOWN。代码自知注释：`bridge-session-seam.ts:591-595`、`bridge/src/index.ts:1081-1082`。

## 实现任务与文件边界（同 worktree 并行，禁止越界）

### T1+T2（同一 agent，子代理可见性修复）

**目标**
- sweep：turn 末 + recover 两处触发。镜像 remote `refreshFromList()` 判定语义（`session.list` → `origin==="subagent"` + `parentSessionId===本会话` → `running===false` 且 catalog 内仍 running → settle）。settle 语义对齐现有 catalog settle 路径；best-effort，读失败不得当空数组处理（沿用 session 持久化铁律）。
- journal：`subagentViews()` 填充 rounds/lastLine/model——惰性打开子会话 journal（`ctx.sessionPersistence.open(id,'read')`），缓存；rounds=assistant/message 行数、lastLine=末条尾部、model=request/context.model（缺失回退 `subagent/descriptor.agentModel`）。读失败降级现状，不阻塞。

**文件边界（owned）**：`packages/bridge/src/index.ts`、`packages/shell/src/client/bridge-session-seam.ts`、对应测试文件。
**禁止**：碰 CLI/env/help/CHANGELOG（T3 领地）。跨边界需求 → 停下报告。

### T3（另一 agent，翻转）

**目标**
- 默认语义翻转：无 env → bridge；`DSH_OPENTUI_INPROC=0` → 旧 remote seam；`1` 仍有效（幂等）。
- 移除 `--remote` flag（走既有未知 flag 校验路径，did-you-mean）。
- 更新 help/文档/CHANGELOG 0.23.0 草稿段（按仓库惯例）。
- 修正所有断言旧 opt-in 行为的测试。

**文件边界（owned）**：CLI/launch/env 解析、help 文案、CHANGELOG、docs、相关测试。
**禁止**：碰 `packages/bridge/src/index.ts`、`bridge-session-seam.ts`（T1+T2 领地），冲突项停下报告。

## 验收门禁（发版前全过）

1. 各自单测 + typecheck 绿（worktree 内，干净依赖）。
2. oldfox 终审（实现完成后统一审 diff）。
3. 真机抓帧：场景 A（Esc 中断→幽灵应被 sweep 收掉）、ctrl+g（rounds/model/lastLine 有值）——主协调者自己抓帧看图，`.ans` 数值为准。
4. CI 全绿（含 build-bridge + pack/cold-start gate，0.22.0 三红教训：spawn 真实脚本的测试必须声明全部前置）。
5. 发版：tag 驱动 CI；**发布动作须当次用户确认**。

## 风险与回滚

- 默认翻转是用户可见行为变化 → `DSH_OPENTUI_INPROC=0` 逃生门 + 下一补丁版可回退。
- sweep 误杀：严格限定 `origin==="subagent"` + `parentSessionId` 匹配 + 仅对本地仍 running 的 child settle；不做 wall-clock 兜底（ADR 前提）。
- journal 读失败：不得当空（rounds 归零即有回归风险）——保持现状降级并注释原因。

## 未决（等用户）

1. M3-09 是否 0.23.0 同批（票面倾向同批，待显式拍板）。
2. 上游 issue 是否外发。
3. 四项 [临时假设] 复核：T4 逃生门、sweep 双触发、范围收敛、阶段二推 0.24。
