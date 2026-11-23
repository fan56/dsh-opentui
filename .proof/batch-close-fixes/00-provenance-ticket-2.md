# 评审票 — ledger/provenance.json note 字面量编辑（批次收口 / provenance 第二票）

- 日期：2026-11-23
- 切片：批次收口修复刀（分支 `feat/ui-batch-1123`，本刀实现前 head `9caab9b2`（S4 落地提交）；第一票后累计提交 `b544a64`）
- 对象：`ledger/provenance.json` → `wired_capir_generated.note` 中的一句 NOTE
- 变更性质：手工 note 字面量编辑（N1 C1 / 第一票 `.proof/b1-s3-provisioner/00-provenance-ticket.md` 先例），**非生成物重生成**；`provenance.json` 是 gen-ledger 的输入，不是输出（`scripts/gen-ledger.mjs:6,26`）。
- 这是该 note 的第二张票：第一票处理 B1 S1/S2（settings 桥臂 resolve host config service）；本票处理 B1 S4（客户端 seam 宿主优先路由落地，`9caab9b`）。

## 一、理由（为什么必须改）

1. 当前 note 写「the seam's settings/config/agents faces still use REAL local file I/O (LocalSettingsStore/LocalConfigStore/LocalAgentsFace) until client-side host-first routing lands (design 05 §7 S4)」。
2. B1 S4（commit `9caab9b`，`.proof/b1-s4-s6/00-preregistered-expected.md` E1–E4）已落地客户端宿主优先路由：`packages/shell/src/client/bridge-session-seam.ts` 的 `settings.describe()` 走宿主 wire、`settings.mutate()` 转发宿主并在宿主缺席时诚实拒绝（不写本地 patch 冒充成功）；`officialCapsFromDocument` / `/agents` 的 caps 取自同一 host describe 文档，host 缺席时返回 `source:"unavailable"`、不回落本地数字（n/a）。
3. 因此「faces still use REAL local file I/O until S4」这句对 settings/config/agents seam 面的陈述已与代码现实不符，属于「撒谎注释」类债务；且该句用 until S4 暗示 S4 尚未落地，现已被 S4 兑现。按第一票「保留条件」第 3 条的约定（S4 落地须再出票更新此句），本票兑现该约定。
4. credentials 部分仍为真（dsh-api-settings-controller 未挂载，credentials ids 仍 NOT_WIRED），必须保留。local-file 降级在 S4 后仍存在，但不再是 seam 的默认来源，而是宿主缺席时的诚实降级（有 source 标注），不能再说 faces 一律走本地文件。

## 二、前后文（逐字）

**前（HEAD 原文，引号内为被替换的那一句）：**

> Wiring is still declared + unit-tested; the seam's settings/config/agents faces still use REAL local file I/O (LocalSettingsStore/LocalConfigStore/LocalAgentsFace) until client-side host-first routing lands (design 05 §7 S4) — no degrade/mock is left.

**后（本刀写入，只替换上述一句）：**

> Wiring is still declared + unit-tested; since B1 S4 landed client-side host-first routing (commit 9caab9b, design 05 §7), the seam's settings/config/agents faces resolve THROUGH the host config service — settings.describe reads the host wire and settings.mutate forwards to it (source-aware: host when present, an explicit source=local-file / source=unavailable degrade when absent, never a faked local success); /agents caps come from the same host describe document (local-file yields n/a with no numbers). No degrade/mock is left; credentials ids still reach NOT_WIRED at runtime (dsh-api-settings-controller not mounted in the stock opentui-inproc profile), unchanged from the first ticket.

准确性边界（按 N1 C1 / 第一票字面量编辑先例，只替换上述一句）：
- NOTE 的其余部分（24 generated ids / 24-of-257 口径、S1/S2/S3/S5 与 025-w1b B/C/D 叙述、credentials 与 settings 桥臂 resolve host config service 的第一票结论、S3 push streams NOT_WIRED 说明）逐字保留。
- 与代码一致性核对：`bridge-session-seam.ts` 的 host-first 路由 + `bridge-settings-route.ts` 的 source-aware 投影（E1–E4 of `.proof/b1-s4-s6/00-preregistered-expected.md`）；credentials 仍 NOT_WIRED 与第一票同。
- 不假称宿主一定在场：S4 有 `source:"local-file"` / `"unavailable"` 的诚实降级，故新句写明「host when present, explicit degrade when absent」，而非无条件「经宿主」。

## 三、S4 GREEN 引用（本刀不越冻结面的依据）

1. 第一票已确立 S0 GREEN（B1 S1/S2，`.proof/b1-s3-provisioner/00-provenance-ticket.md` §三）；S4 是该 GREEN 范围内客户端侧路由落地，`.proof/b1-s4-s6/00-preregistered-expected.md` E8 断言冻结面零 diff + typecheck 退出 0，`.proof/b1-s4-s6/03-typecheck-gate.log` 收口。
2. 本票对应的 note 字面量编辑不进生成物：`provenance.json` 是 gen-ledger 输入，编辑只改 note 文本，不触碰 `ledger/ledger.json` / `ledger/ledger.md` 的派生数据。gen-ledger 双跑 sha256 必须字节一致（本刀 E5 验证）。
3. 冻结面红线：handshake / CAP_* / capir / capcontract 生成物 / `ledger/ledger.{json,md}` / build-bridge 转义段零 diff（本刀验证逐项核对）。

## 四、保留条件与回退

- 若后续在某 profile 挂载了 `dsh-api-settings-controller` 使 credentials ids 不再 NOT_WIRED → 须再出票更新本 note 的 credentials 一句，不静默遗留。
- 若宿主 config service 在某 profile 不在场，S4 的 local-file/unavailable 降级仍为真，本句保留「explicit degrade when absent」，不下硬结论。
- 若 gen-ledger 双跑出现 ledger 字节漂移（note 意外内嵌生成物）→ 立即回退本 note 编辑并停车汇报。
