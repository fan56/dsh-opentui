# 评审票 — ledger/provenance.json note 字面量编辑（B1 第三刀）

- 日期：2026-11-23
- 切片：B1 S3 + N2 + provenance note（分支 `feat/ui-batch-1123`，实现前 head `87aa56f`）
- 对象：`ledger/provenance.json` → `dimensions.wired_capir_generated.note`（:277）中的一句 NOTE
- 变更性质：手工 note 字面量编辑（N1 C1 先例），**非生成物重生成**；`provenance.json` 是 gen-ledger 的输入，不是输出（`scripts/gen-ledger.mjs:6,26,181`）

## 一、理由（为什么必须改）

1. 该 note 现写「credentials AND settings ids reach NOT_WIRED at runtime in the stock opentui-inproc profile」。
2. B1 S1/S2（commit `2434f6f feat(bridge): settings arm resolves inproc host config service`）已在 bridge settings arm 落地 `resolveSettingsSurface = controller ?? adapt(ctx.get('settings'))`（`packages/bridge/src/index.ts:1765`）与适配器（`packages/bridge/src/settings-adapter.ts`）。在 dsh-base 提供 config-editor + settings 的 inproc profile 中，`settings/describe|mutate` 现在走宿主配置服务，不再 NOT_WIRED。
3. 因此该 note 对 settings 的陈述已与代码现实不符，属于「撒谎注释」类债务；credentials 部分（dsh-api-settings-controller 未挂载）仍为真，须保留。
4. 编辑是冻结面字面量编辑，按 `docs/workflows/w8-base-unfreeze.md` 三.1（N1 C1 转义段先例）出显式评审票；不做生成物重生成、不扩 needle、不放宽任何门禁。

## 二、前后文（逐字）

**前（HEAD 原文，引号内为该句全文）：**

> NOTE: credentials AND settings ids reach NOT_WIRED at runtime in the stock opentui-inproc profile (dsh-api-settings-controller not mounted in its base closure); wiring is still declared + unit-tested, and the seam's settings/config/agents faces use REAL local file I/O (LocalSettingsStore/LocalConfigStore/LocalAgentsFace) so no degrade/mock is left.

**后（本刀写入）：**

> NOTE (B1 S1/S2 follow-up, review ticket .proof/b1-s3-provisioner/00-provenance-ticket.md): credentials ids still reach NOT_WIRED at runtime in the stock opentui-inproc profile (dsh-api-settings-controller not mounted in its base closure). settings ids NO LONGER reach NOT_WIRED there: the bridge settings arm resolves the host config service through resolveSettingsSurface (real settingsController first, else the inproc ctx.settings adapter in packages/bridge/src/settings-adapter.ts), so settings/describe|mutate reach the inproc host's config-editor + settings service (dsh-base mounts both). Wiring is still declared + unit-tested; the seam's settings/config/agents faces still use REAL local file I/O (LocalSettingsStore/LocalConfigStore/LocalAgentsFace) until client-side host-first routing lands (design 05 §7 S4) — no degrade/mock is left.

准确性边界（按 N1 C1 字面量编辑先例，只替换上述一句）：
- 其余 S1/S2/S3/S5 + 025-w1b B/C/D 叙述、24 generated ids / 24-of-257 口径逐字保留。
- 客户端 seam 仍走 LocalSettingsStore（S4 未落地），故「faces use REAL local file I/O」仍真；补充「until S4」说明其时效，不假称已切宿主。
- credentials 仍 NOT_WIRED，不改。

## 三、S0 GREEN 引用（本刀不越冻结面的依据）

1. 设计书 `research/2026-11-23-ui-batch/05-settings-runtime-channel-design.md` §6.1/§7 S0：bridge settings arm 判定为 hostInvoke 臂（非三态握手、非 75/75 面、非 wired 表查找）；provisioner 判定为 profile 模板（非生成物）→ 不触发 W8 解冻，需 oldfox 书面一票 + round log。
2. S0 前提已被 S1/S2 刀实现验证：`.proof/b1-s1-adapter/00-preregistered-expected.md` §5「S0 红线自查」逐条核对；`.proof/b1-s1-adapter/02-gate-full.log:25` 记 `capcontract integrity gate: GREEN`（22 PASS / 0 FAIL），`.proof/b1-s1-adapter/08-build.log` 收口。故本刀沿用 S0 GREEN，不重开冻结面判定。
3. 本刀三处改动均落在 S0 GREEN 判定范围内：
   - provisioner 合并逻辑写在收敛段（`provision-inproc-profile.mjs:1251` 之后），模板行序不动，ledger 证据引用的 `:566-578` 逐字节不变（E3 单测锁定）；
   - bridge 冲突分类为同函数正确性修复，不新增/删除 wire id、不新增 NOT_WIRED 文案（E4 单测 + grep 锁定）；
   - 本票对应的 note 字面量编辑不进生成物（gen-ledger 双跑 sha 一致，E6 验证）。
4. 冻结面红线：`capir/`、`capcontract/` 生成物、`ledger/ledger.{json,md}`、`build-bridge.mjs` 转义段、握手/wired 表字面量零 diff（E5/E6 + git status 逐项核对）。

## 四、保留条件与回退

- 若 E6 双跑出现 ledger 字节漂移（note 意外内嵌生成物）→ 立即回退本 note 编辑并停车汇报。
- 若后续 S4 落地使 seam 改走宿主，须再出票更新本 note 的「faces use REAL local file I/O」一句，不静默遗留。
