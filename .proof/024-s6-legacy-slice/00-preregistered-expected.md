# 024 S6 legacy seam 清偿 + symlink 债 — 预注册期望（步骤 0，never edited after capture）

> 捕获前落盘。基点 `feat/024-capir @ 43a6ff9`（S4b 交付 head，CI run 44824002599 绿）。
> 依据：`024-s6-conflict-adjudication-oldfox.md` §A.4 执行条款 8 条 / §A.2 差异面表 / §A.5 退役登记口径 / §B 并行条件 / §D 重验范围；`024-s5-review-oldfox.md` §六 7 条；`024-s6-legacy-slice.md` §八–§十一 甄别与停车报告。
> PASS 判定式：Commit1 换桥 ft 门禁绿（5 ft 断言零改动）→ 开闸 Commit2 删除（全包单测 + verify70 64/64 + 真机配方 + CI 三 job 绿）→ Commit3 symlink 清偿 + 交叉污染验证 → Commit4 scanner 负例 → 冻结面未碰 + 脱敏扫描最后一步 hits=0。
> 提交分立：换桥 / 删除 / symlink / scanner 各自独立 commit、分开 prereg；先建绿是后删开闸条件，禁止混提。

---

## 0. 范围与红线（冻结）

- 删除集按 §8.3 + 裁决 §A.4.5；`shell-render-fixture.tsx` 从「被动受影响」改为**主动改造项**（Commit1）。
- `transport-connect-retry.test.ts` / `client-fakes.ts` / CI stub 两步列入**退役 + 接管登记**（§A.4.6），非「连带退役」。
- 红线：冻结面（`capir/capir.json`、`capcontract/*`、`ledger/*` 真源、`scripts/build-bridge.mjs` 转义段）git diff 空；凭据零落盘；不删仍然有效的覆盖（被测面消亡随删 + 退役登记）；5 ft 断言零改动为目标。
- 5 个 section 断言（S4b `s2-account`）已被裁决 C「可接受非弱化」，本刀不改。

## 1. A.2 差异面表（换桥后 ft 覆盖归宿，预注册登记）

| 差异面 | RemoteSessionSeam（现） | BridgeSessionSeam（换后） | 覆盖归宿 |
|---|---|---|---|
| 驱动边界 | RemoteHostSession 方法级 double（fixture fakeSession） | BridgeTransport 帧级 double（request/onEvent） | 帧级 double 更接近生产；先例 `bridge-session-seam.test.ts:65-73` |
| stored 管线 | session.storedTranscript → StoredTranscriptRow → adapter 内投影（专属，随删） | journal.replay 帧 → `bridgeReplayRowsToSeamTranscript`（复用 `journalToTranscriptRows`，`:457`） | bridge 侧管线有单测 + 换桥后 ft 经生产路径再覆盖 |
| live turn | callback 直通 | turn.start/turn.token/turn.tool/turn.end 帧 + generation 状态机（`:3581+`） | 换桥后 ft 首次覆盖生产 turn 帧路径（新增覆盖） |
| journal 重放 | session.onJournalRecord listener | transport.onEvent 帧 → `projectJournalRecord`（同一投影器，`:509`） | 投影器同一，零丢失 |
| status() | fakeSession getter | 帧驱动内部状态机 | ft 若断言含状态 UI，帧序保真即可 |

**结论**：语义覆盖不等价——严格更强。唯一如实损失 = RemoteSessionSeam 专属 stored 投影段覆盖，其被测对象本身消亡。

## 2. Commit1 — 先建：fixture 换桥（步骤 1–4）

- `shell-render-fixture.tsx:238` `new RemoteSessionSeam(session)` → `new BridgeSessionSeam({ transport: <fake BridgeTransport>, ctx, dshHome, workspaceDir })`。
- fake transport 实现 `request(method, params)` + `onEvent(listener)`（`bridge-session-seam.ts:132-138`），范式抄 `bridge-session-seam.test.ts:65-73`。
- **scratch dshHome/workspaceDir 强制注入**（ctor `:1491-1507` 构造 `LocalSettingsStore/LocalConfigStore/LocalAgentsFace` 读真 home）——fixture 须用 `mkdtempSync`，禁止隐式读 `~/.dsh`。
- 驱动 API 映射：`journal(entry)` → fake transport 发 event 帧（消费面 `#onBridgeEvent`）；`turnScript` → `session.send` 后回放 turn.start→token→tool→end 帧序；stored → `journal.replay` reply rows（`{seq,type,payload}`）。
- 5 ft 测试（key-routing / smoke / regression / incident-rows / incident-motion）断言**零改动**；如出现文案时序差异，逐条列「原文→新文+原因」，禁放宽，保留至少一条「文本不出现即红」负例。
- 门禁：`bun run test:ft` 本地绿 + 全包单测零新增红；CI `test:ft` 步绿；G5 shell tsc 基线显式登记。

## 3. Commit2 — 删除（步骤 5–7，开闸条件=Commit1 CI 绿）

- 先迁共享导出：`projectJournalRecord`（`session-seam-adapter.ts:826`）等；G5 两条 TS2339（`:182`）随迁清偿。
- 删：RemoteSessionSeam 类、`transport.ts`、`remote-host-session` 及 legacy-only remote-* 族、env hatch（`seam-bootstrap selectSeamKind/createRemote`、`client-entry:453-466`、`v2-entry createRemote`）、launcher usage 行、`BRIDGE_LEGACY_REMOTE_HINT`、provision INPROC 跳过分支（`:7,36,44,137-142`）。
- CI stub 两步（ci.yml:31-48,115-125）随 transport.ts 删一并退役，前提=无 SDK 下 test job 仍绿。

### 3.1 退役登记（A.4.6，每文件一行：被测面=已删模块 X；等价覆盖接管于 Y）

| 测试文件 | 被测面 | 接管 / 处置 |
|---|---|---|
| `session-seam-adapter.test.ts` | RemoteSessionSeam 类（删）；`projectJournalRecord` 迁出 | projector 断言迁至新模块测试；seam 专属面随删 |
| `shell-render-fixture.tsx` | **主动改造**（Commit1），非退役 | 换 BridgeSessionSeam；5 ft 断言零改动 |
| `transport-connect-retry.test.ts` | `transport.ts` ClientConnection（删） | **通用语义先核**（见 §4）：retry/reconnect 语义接管于 bridge A3/A6/A7 recovery 族 |
| `client-fakes.ts` | `transport.ts` 类型（删） | 13 文件共享 fake：类型面迁 bridge 等价类型或随对应测试文件退役 |
| `remote-*.test.ts` 族（13 文件） | 对应 legacy-only remote-* 模块（删） | 被测面随删；通用语义（如 `ask-transcript`/journalToTranscriptRows）断言保留并迁新模块 |
| `bin-launcher.test.ts` `DSH_OPENTUI_INPROC:'0'` 用例 | env hatch（删） | 该行为随删；usage 不再广告逃生舱的断言须保（`:462`） |
| `append-system.test.ts` / `m3-ride-isolation.test.ts` | append 旧路径（随 provision INPROC 分支删） | 被测面随删；登记 |

### 3.2 通用语义前置核（A.4.6(a)：transport-connect-retry）

retry-cap 专属断言（`ConnectionRetryExhaustedError.after N retries` / `authority`）是 `ClientConnection` 专属语义，随 transport.ts 删。其**通用**语义「连接失败重试 + 宿主 stderr tail 进入 surfaced error」在存活侧已有等价覆盖（0b 一手证据）：
- `bridge-transport.ts:150` `diagnostics` getter（stderr tail）+ `:283-293` `#onDead` 把 tail 写进 deadCause.message；
- `bridge-transport.test.ts:150`（BRIDGE_DEAD reject）、`:164`（structured deadCause）、`:190`（DEAD 一次发布）；
- `bridge-recover.test.ts:110-232` A3 recover 状态机（DEAD→RECOVERING→HANDSHAKE→READY / respawn 失败 / 握手失配 / cooldown / close 终态）；
- `lifecycle.test.ts:309-332` boot 失败与 readiness timeout 的 diagnostics tail 进入 `err.message`（含 `plugin failed to load: boom` 原文断言）。

**裁定（执行者，按 A.4.6(a)）**：通用语义「重试/连接失败 + 宿主诊断尾巴 surfaced」在存活侧已被 A3/A6/A7 recovery 族 + lifecycle tail 断言等价覆盖（file:line 如上）；专属 retry-cap 类语义随被测面消亡。故**无需在 bridge-transport 侧补新断言**，可直接退役 `transport-connect-retry.test.ts`。若 Commit2 实测删除后门禁出现该语义覆盖空洞，则先补后删。

## 4. Commit3 — symlink 清偿（B.1/B.3，独立 commit）

- 方式预注册：bridge 作为 **packaged 真依赖**随安装进入 prefix `node_modules`（Node 解析），消灭 profile 内绝对 symlink；`--repair` 分支（provision `:1135-47`）、`post-write verify`（`:1161-64`）、gate `readlink` 断言（`real-client-gate.sh:124-129`）随之退役。
- 交叠注意：`provision-inproc-profile.mjs` symlink 段（`:1084-1164`）与 seam 段 INPROC 跳过（`:7,36,44,137-142`）属不同 commit；若 symlink 先落地，seam 删除 commit 须基于新基线 rebase 后重跑门禁。本计划顺序 = seam 先 / symlink 后，避免 rebase。
- 多 worktree 交叉污染验证：两 worktree 各 provision 到同一 scratch DSH_HOME → 互跑 `bridge.hello`（协议 1）+ fingerprint 断言 → 删一方后另一方冷启动仍 PASS（无悬链 / 无 BRIDGE_TIMEOUT）。

## 5. Commit4 — scanner config 负例 pattern（B.2，独立 commit）

- `scan-stdio-secrets.mjs` pattern 表 + config 值负例自测（S4b-b / S5 S-S5a 字面欠账）。
- 脱敏扫描保持最后一步，31 文件计数闭环沿用。

## 6. 验证面（§D）

1. Commit1：`test:ft` 本地绿 + CI 绿；全包单测零新增红；G5 基线显式登记。
2. Commit2：全包单测 + verify70 **64/64**（N=64 不变）+ 真机配方（含 s2-account section=yes）+ CI 三必需 job。
3. 冻结面：capir/capcontract/ledger/build-bridge 转义段 git diff 空。
4. 干净 worktree（无本地软链）+ `pnpm install --frozen-lockfile` 全链（0.9.6 教训）。
5. pack 门禁；G5 typecheck（迁移后 2 条消失、无新错误）。
6. 两 commit 各自独立过 CI；先建绿是后删开闸条件。
