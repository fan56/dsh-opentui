# PREREGISTRATION — S5 config 宿主清偿 + /agents face（write-once，捕获前落盘，never edited after capture）

本文件在任何 S5 实现改动与证据捕获之前写入磁盘。它是 S5 报告 `expected` 列的冻结预测值。
状态与 observed 值事后依据 `pass criterion` 判定，写入 `research/024-s5-config-slice.md`；禁止回改本文件的 `expected`。

- Preregistered at (UTC, `date -u`): 2026-11-20T20:45Z
- Worktree / branch: `/Users/qingguee/repo/dsh-opentui-wt-024-capir` @ `feat/024-capir`
- Pre-change HEAD anchor: `3704a541cc7472ef5d6d4c5ce651a86ef300dc88`（S4 PKCE/stream 切片）
- Host: `dsh --version` = `0.2.2-rc.5`，macOS arm64
- Evidence directory: `.proof/024-s5-config/`
- 上游裁决：`024-verify70-red-adjudication-oldfox.md` §1.1/§2/§4；计划 `dsh-opentui-024-delivery-plan.md` §三 v2.2 增补；S4 报告 G3/G4 移交
- 冻结面声明：不碰 `capir/capir.json` 真源、`scripts/build-bridge.mjs` 转义段、`capcontract/*` 生成物；既有测试断言零删除；凭据/密钥值零落盘（只报键名与有无）。
- 降级删除纪律：`bridge-session-seam.ts` 的 `configLoad/configRaw/workspaceConfig` 全量降级、`settings-modal` configSave honest-failure、`commands.ts:1156` agents unavailable 三处必须被真实实现替换，禁止「永远降级」的假绿。

---

## 一、门禁判定式（写死，S5 proof 判定式 = verify70 58/58 全绿）

```
S5 PASS = verify/agents-mount-repro.mjs（经 scripts/real-client-gate.sh 统一环境）实跑 58/58，且：
(a) 22 项豁免红（[S5]15 + [AG]7）逐项转绿，evidence 见 §二/§三；
(b) 完整性 13/0（check-capcontract PASS=13 NOT_RUN=0 FAIL=0）；
(c) bridge/shell 全单测 0 fail；脱敏扫描 hits=0 + --self-test 全 pattern 命中；
(d) 真机环境项全 PASS（preflight/provision/handshake/composer/6 组 .ans 帧非空）；
(e) commit→push→CI 三 job 绿。
任何一项不满足即 S5 FAIL；能力不可达项须按 oldfox §1.1 显式立归类申请，禁止自判豁免。
```

---

## 二、22 项豁免红 → expected（FROZEN；逐条对应 verify70 record item 与裁决编号）

### [AG] 7 项 —— agents face 进 stdio 契约后 `/agents` 打开 8 层 PanelStack 模态

| 裁决# | verify70 record item（FROZEN） | expected（FROZEN） | 收敛机制 |
|---|---|---|---|
| 1 | `/agents opens the manager panel (panel-kit modal)` | PASS：`NAME MODEL THINK DEEP LIMITS` 表头或 limits 首层出现，无 `not mounted`/`unavailable` | `seam.agents` 真实现 + `commands.ts` 删 unavailable 降级 |
| 2 | `/agents modal frame uses the 116-cell xlarge preset` | PASS：面板宽 = min(116, cols-2) | 同上，面板真实挂载 |
| 3 | `/agents l opens the limits layer` | PASS：`maxRounds/background/maxActiveSubagents/maxDepth` 四键齐全 | `agents.officialCaps()` 经 settings.describe 真读 |
| 4 | `/agents limits layer paints both official subagent caps` | PASS：`maxActiveSubagents`/`maxDepth` 渲染真实数值（非 n/a） | 同上 |
| 5 | `/agents Esc leaves the limits layer` | PASS：回到 table 层 | 面板真实层栈 |
| 6 | `/agents Esc closes the modal` | PASS：模态关闭 | 面板真实层栈 |
| 7 | `/agents close prints the exit summary` | PASS：`Agents (unchanged\|updated)` | 面板真实退出摘要 |

### [S5] 15 项 —— settings/config 面进 stdio 契约

| 裁决# | verify70 record item（FROZEN） | expected（FROZEN） | 收敛机制 |
|---|---|---|---|
| 8 | `/settings opens the Settings modal (section nav + instant-save band)` | PASS：模态 + 七段 nav（含 Host）+ instant-save band | `seam.settings.describe` 真读 |
| 10 | `/settings all seven nav sections are reachable` | PASS：General/TUI-specific/Host/Models/Plugins/Agent presets/Account 全可达 | 同上 |
| 11 | `/settings Host section renders the four whitelisted rows from the live document` | PASS：`subagent.maxActiveSubagents/maxDepth/permission.defaultPreset/session-log-deepseek.enabled` 四行来自 live describe | `settings.describe` 经生成链路 |
| 12 | `/settings marks other namespaces read-only ("本 TUI 不消费")` | PASS：非白名单 ns 显示只读注记 + rev N | `settings.describe` 提供 namespace + revision |
| 13 | `settings selects the host row with the keyboard` | PASS：↑↓ 选中 `session-log-deepseek.enabled` 行 | Host 行可达（#11） |
| 14 | `settings saves the host toggle on Enter (instant model)` | PASS：Enter 后行值即时翻转 | `settings.mutate` 经生成链路 |
| 15 | `settings writes a host row (session-log-deepseek.enabled=*) into cordis.patch.yml` | PASS：scratch `cordis.patch.yml` 出现 `enabled: <bool>`，且退出 confirm 关闭 | `settings.mutate` 落宿主 patch |
| 16 | `/settings saves print the exit summary` | PASS：`Settings updated:` | 有真实写才有摘要 |
| 17 | `settings re-reads the host write through settings/describe` | PASS：重开模态 fresh describe 显示新值 | `settings.describe` 真读 |
| 18 | `settings restores the host row (session-log-deepseek.enabled=*)` | PASS：恢复原值 + patch 回写 + 关闭 | `settings.mutate` 经生成链路 |
| 19 | `settings saves motion=<full> on Enter (instant model)` | PASS：`✎ motion <target>` | `configSave` 真实现替换 honest-failure 降级 |
| 20 | `settings writes motion=<full> into the profile config.json` | PASS：scratch `config.json` 的 `motion === target` | `configSave` 真写 profile config |
| 21 | `settings writes motion back to <auto>` | PASS：`config.json` 的 `motion` 恢复原值 | 同上 |
| 34 | `auto-resume: autoResume:"last" restores the stored transcript` | PASS：fixture 历史在重启后重现 | `configLoad` 真读 `autoResume` |
| 35 | `auto-resume: autoResume:"last" paints one 'resumed …' notice` | PASS：`resumed <title> · <time ago>` 提示出现 | 同上 |

---

## 三、S5 新增能力 expected（机器可判，E1–E8）

| id | assertion | expected（FROZEN） | pass criterion | evidence |
|----|-----------|-------------------|----------------|----------|
| E1 | settings.describe/mutate 进生成链路 + 服务名一手核验 | `CAP_HOST_WIRED_IDS` 含 `@deepseek-ai/dsh-api-settings-controller#settings/describe` 与 `#settings/mutate`（22→24）；rc.5 `dsh-api-settings-controller/src/index.ts:86` `super(ctx,'settingsController',{namespace:'settings'})` 与桥 `resolveSettingsController` 的 `ctx.get('settingsController')` 一致 | bridge 单测断言 2 id ∈ 注册表 + length=24 + askedKey=`settingsController`；一手行号记入 `01-env-snapshot.log` | `05-bridge-unittest.log`, `01-env-snapshot.log` |
| E2 | seam.settings 真读真写（非降级） | `configLoad/configRaw/workspaceConfig` 从 scratch profile config.json / workspace overlay 真读；`configSave` 真写；`settings.describe()` 返回 live document；`settings.mutate()` 真写 cordis.patch.yml | shell 单测断言 seam 四 config 面读回 scratch fixture 值、settings 面 describe/mutate 往返；三处 degradeOnce 日志不再出现 | `05b-shell-unittest.log` |
| E3 | /agents face 真数据（非降级） | `seam.agents.list()` 返回 scratch `agents/*.md` 解析行；`officialCaps()` 经 settings ns `subagent` 真读 maxActiveSubagents/maxDepth；`dir()` 指向 scratch agents 目录；`body()/modelEfforts()` 真数据 | shell 单测断言 list 行来自 fixture、caps 数值来自 describe stub、degrade 计数为 0 | `05b-shell-unittest.log` |
| E4 | 降级路径删除可证 | `bridge-session-seam.ts` 无 `configLoad/configRaw/workspaceConfig` 的 `return {}` 降级；`settings-modal.tsx:480` `configNotPersistable` honest-failure 分支不再命中；`commands.ts:1160` `if (!ctx.seam.agents) unavailable` 删除 | 源码 grep 断言 + 真机 verify70 #1/#8/#14/#19 转绿（无降级文案） | `04-source-audit.log`, verify70.log |
| E5 | 完整性/生成可复现 | check-capcontract `PASS=13 NOT_RUN=0 FAIL=0`；ledger in_wired 24/257、@manual 11 不变；gen 双跑 sha 一致；冻结面 git diff 空 | 见门禁表 | `02-gate-regen.log` |
| E6 | 真机 22 项转绿 + 58/58 | `node verify/agents-mount-repro.mjs` 实跑 58 PASS / 0 FAIL；[S5]15+[AG]7 全绿；非豁免 36 项保持绿（无回归） | verify70.log summary `58/58 checks passed`；逐项 evidence 见 §二/§三 | `10-verify70.log` |
| E7 | 脱敏扫描 + 负例自测 | `scan .proof/024-s5-config` hits=0；`scan --self-test` 9/9 pattern 命中；新增 config/settings/agents 帧无 secret 值落盘 | 见门禁表 | `08-desens-negative.log`, `09-desens-scan.log` |
| E8 | 门禁全项 + CI 三 job 绿 | build exit=0；真机握手 6/6、CAP_SMOKE 14/14；真机配方环境项全 PASS；CI run headSha=本片提交，三 required job success | 见门禁表；CI run URL 记入报告 | `02/05/06/10/12-*` |

**PASS 判定式**：E1–E8 达成 ∧ 门禁绿 ∧ NOT RUN 无未声明 ∧ JUDGMENT 全有裁决记录 ∧ verify70 58/58。

---

## 四、脱敏断言（写死，配置/设置/agents 面的 secret 暴露面）

- `settings.describe` 宿主已 redact（secrets 只 `{path,set}`）；桥与 seam **禁止**透传 secret value / token / apiKey / password / authorizeUrl / code_challenge / state / 任何 `value` 原始文本到帧或证据。
- `configLoad/configSave/configRaw/workspaceConfig` 只承载非敏感偏好键（motion/autoResume/theme/lang/footerHints/...）；凭据字段命中脱敏正则即 FAIL。
- agents face 只承载 agent 定义 markdown 的 model/thinking/deep/maxRounds/background/body；body 含用户 prompt 文本，证据包只记键名与布尔，不落 body 原文。
- 证据包 `node scripts/scan-stdio-secrets.mjs .proof/024-s5-config` exit=0 hits=0；`--self-test` 9 pattern 全 detected=true。

---

## 五、JUDGMENT（只记不拦，默认无风险）

- J1（交互手感）：/agents 面板 8 层键盘层栈的 Esc 回退手感 → 沿用现有 panel-kit，不新增快捷键。
- J2（文案措辞）：settings 只读注记 / agents limits n/a 文案 → 沿用现有 i18n。
- J3（视觉布局）：settings 七段 nav / agents NAME..LIMITS 表在 116 格 xlarge 的排布 → 沿用现有布局，不改样式。
