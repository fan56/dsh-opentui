# E2E warn triage — 容器 client face 五组（本轮日志）

只读分析产物，不属于发版 commit。输入：`/tmp/e2e-g1.log`、`/tmp/e2e-g2.log`、`/tmp/e2e-g3-trace.log`、`/tmp/e2e-g4.log`、`/tmp/e2e-g5.log`。

## 0. 总数核对

口径：仅统计测试判定行 `^  warn `（排除各 suite 的 `N warn` 汇总行、pnpm 自身的 `WARN Tarball download average speed` 网络提示——后者是 registry 限速噪音，不是测试判定）。

| 日志 | warn 判定行 | 与日志内 TOTAL 行 |
|---|---|---|
| e2e-g1.log | 0 | TOTAL 0 warn ✓ |
| e2e-g2.log | 2 | TOTAL 2 warn ✓ |
| e2e-g3-trace.log | 5 | TOTAL 5 warn ✓ |
| e2e-g4.log | 5 | TOTAL 5 warn ✓ |
| e2e-g5.log | 2 | TOTAL 2 warn ✓ |
| **合计** | **14** | **与基线 14 一致，基线无误** |

分布：30-commands×2、61-btw×2、62-hard-stop×3、65-jev-attention×1（已另行处理，见下）、68-resume×4、71-search×1、72-agents×1。

排除项（按任务要求不重复报告）：
- `65-jev-attention` 的 spin gate skip（g4:59）——接线与 TTL 已修，计数含它但不triage。
- `30-commands` 的 `/model` 描述 marker——已改，本轮日志中已不出现（g2 的 2 条 warn 是另外两条，见下表）。

## 1. 逐条 triage

| # | 场景 | warn 原文（节选） | 分类 | 依据 | 建议动作 |
|---|---|---|---|---|---|
| 1 | 30-commands (g2:63) | `the active row's fg was not captured (only /motion at 38;5;255): … (known in-container stale-paint family); the highlight colours are covered by the composer-palette ft tests` | 已知不修 | 脚本自带记账 `e2e/scenarios/30-commands.sh:80-93`（"the row area paints stale until the next keystroke (the known in-container behavior)"）；ft 覆盖真实存在：`packages/tui-base/test/composer-palette-ft.test.ts`；上游根因记账 `docs/upstream-opentui-paint-bug-draft.md:11,26`（diff-paint 残留/SIGWINCH 不愈，0.7.0 与 0.8.2 同签名） | 无。等上游修复 |
| 2 | 30-commands (g2:105) | `plugins panel opened but roster is not the expected empty state` | **该修（e2e 期望过时）** | 脚本注释 `30-commands.sh:293-295` 声称 "roster is empty-by-construction"——但 client 面每个容器都会把 `@aiwayds/dsh-subagent-registry` 与 `@aiwayds/dsh-agent-dispatch` bake 进 scratch profile（`e2e/lib/common.sh:213-222` ensure_client_profile，62/70/65 家族 dispatch 所必需），roster 永非空 → 该 ok 分支在本组合不可达，warn 每轮必响且注释失实。空态文案已有 ft 覆盖：`packages/tui-base/test/commands.test.ts:460`（"no plugins installed"） | 改 30-commands 的期望：roster 含 registry/dispatch 两个已知 bundle 属合法状态；或只保留 panel-open 契约、roster 内容降级为记录 |
| 3 | 61-btw (g3:22) | `second answer settles into the panel — … (PRODUCT RENDER GAP: the queued/drained answer text is not painted; the mock served phase=btw for the call)` | **已有专门任务在裁决** | 工作树存在未提交的 `research/btw-render-gap.md` 及 btw 相关源码改动（`packages/tui-base/src/routes/session/btw-overlay.tsx` 等）。按任务要求不下结论 | 等裁决任务结论 |
| 4 | 61-btw (g3:36) | `review carries the last answer — … (PRODUCT RENDER GAP: …)` | **已有专门任务在裁决** | 同上 | 同上 |
| 5 | 62-hard-stop (g3:51) | `E2E-HS-LADDER-DONE never landed — the ladder did not fire; client-face gap (batch B5 finding): the maxRounds ladder caps are staged onto the settings ns dsh-opentui, whose owning plugin entry was retired with the plugin face …` | 已知不修（记账完备）；但记账前提已过时，见该修清单 #2 | 脚本记账 `e2e/scenarios/62-hard-stop.sh:196-203`（"the stop-evidence legs record the gap honestly (warn, not fail) until the client chain grows a cap provider"）+ `:166-171`（B5 说明）；源码记账 `packages/shell/src/client/remote-host-session.ts:496-504` 与 `packages/shell/src/subagent-policy.ts:27-34`（均引用 "the B5 e2e finding: an unbounded looper child"）。dispatch/loop 腿仍是硬断言 | 本轮维持 warn-not-fail；见该修清单 #2 |
| 6 | 62-hard-stop (g3:60) | `round bound not enforced: 174 hs-loop rounds, no stop — client-face gap (batch B5 finding): …` | 同 #5 | 同 #5 | 同 #5 |
| 7 | 62-hard-stop (g3:61) | `no phase=hs-final — the ladder did not stop the child; client-face gap (batch B5 finding): …` | 同 #5 | 同 #5 | 同 #5 |
| 8 | 65-jev-attention (g4:59) | `jev spin-verdict feed not wired … skipping` | 已另行处理 | 任务声明：接线与 TTL 已修。不重复报告 | 无 |
| 9 | 68-resume (g4:102) | `picker headerLine (UPDATED/DIR/SESSION) is not painted on the client face — v2 pickOne drops headerLine (documented gap, v2-entry.tsx); the row cells below carry the column semantics` | 已知不修 | 源码记账 `packages/tui-base/examples/v2-entry.tsx:440-441`："`headerLine` stays the /resume slot (v2 does not paint it — pre-existing gap, unchanged)"；列语义由行内单元格断言承担（warn 原文自带） | 无 |
| 10 | 68-resume (g4:104) | `tiny stub is listed: the client-face list carries no sizeBytes for the stub fixture, so the 1KB floor fails open (documented fail-open contract) — Phase B records the same` | 已知不修 | 源码记账 `packages/tui-base/src/routes/session/resume-picker.ts:65-69`："rows WITHOUT a size pass (fail open — a missing stat must never empty the picker by itself, the reference contract)"；行为有单测 `packages/tui-base/test/resume-picker.test.ts:47-55`（"floor is inclusive; missing size fails open"） | 无 |
| 11 | 68-resume (g4:113) | `empty-filtered copy is unreachable here: sizeBytes is absent for the stub fixture, so filterSessionsBySizeFloor fails open and the row renders (same documented contract as Phase A)` | 已知不修 | 同 #10 同一契约（resume-picker.ts:65-69）；filter 行为本身（有 sizeBytes 时的过滤）在 resume-picker.test.ts 有覆盖 | 无 |
| 12 | 68-resume (g4:115) | `Phase B quit (needed the Ctrl+C fallback)` | 已知不修（环境限制） | `e2e/lib/common.sh:457-463` KNOWN LIMITATION (v1)："inside the current container image none of these paths has been observed to exit the app … same family as the upstream paint/input bugs in docs/upstream-opentui-paint-bug-draft.md. Revisit when the upstream fix lands."；quit_tui 的 Ctrl+C/Ctrl+D 回退本身是设计好的降级路径（common.sh:464-503） | 无。等上游修复 |
| 13 | 71-search (g5:66) | `ctrl+alt+f is bound to BOTH session.searchSessions and session.page.down (keybind.ts conflict) — the scroll action wins; the chord leg is skipped, /search covers the surface` | **该修的真问题（产品侧 keymap 冲突）** | 源码坐实双重绑定：`packages/tui-base/src/config/keybind.ts:107`（`"session.searchSessions": keybind("ctrl+alt+f", …)`）与 `:184`（`"session.page.down": keybind("pagedown,ctrl+alt+f", …)`）——同一 chord 两处注册，scroll 赢，`session.searchSessions` 的 chord 入口不可达（死绑定）。e2e 侧已记账绕过：`e2e/scenarios/71-search.sh:132-148`（"a product keymap conflict, not a stale expectation … Drop this skip when the conflict is resolved"） | 产品侧改绑定（如 searchSessions 换 chord 或 page.down 去掉 ctrl+alt+f 腿），随后删 71-search.sh:143-143 的 skip 分支 |
| 14 | 72-agents (g5:82) | `corpus was re-seeded (subagent registry sample agents) — the empty-corpus copy is not reachable in this composition; the table state is asserted next` | 已知不修（组合依赖状态） | 脚本记账 `e2e/scenarios/72-agents.sh:62`（"The registry plugin seeds sample agents at INSTALL time (62-hard-stop)"）与 `:79-82`（"corpus is empty is a composition-dependent state … the table is the other legitimate state"）；空态文案有 ft 覆盖：`packages/tui-base/test/agents-panel.test.ts:91-95、206-211`（"no agents in … yet" / "zero agents"） | 无 |

## 2. 该修清单（按优先级）

1. **`keybind.ts` ctrl+alt+f 双绑（产品侧，#13）**——`session.searchSessions` 的 chord 入口被 `session.page.down` 压死，是真实不可达功能（影响低：`/search` 命令覆盖同一 surface，transcript 侧另有 ctrl+shift+f）。改动小：调整一处绑定即可，改完删 71-search.sh 的 skip 分支让 chord 腿转正。
2. **62-hard-stop 的 staging 换靶（e2e 侧，#5-#7 附带发现）**——本轮维持"已知不修"成立（warn-not-fail 记账完备），但记账前提已过时：F1 批次已把 client 面 ladder 的 cap 源接到 profile config.json 顶层 `maxRounds`/`maxRoundsGrace`（`remote-host-session.ts:496-504`"the ladder's caps read live from the CLIENT face's real config layer … through configLoad()"、`subagent-policy.ts:27-34`"the client ladder no longer sources from it"），而 e2e 仍把 caps stage 到已退役的 settings ns patch entry 上（62-hard-stop.sh:136-164）——LADDER_GAP 文案里 "the staging above is kept so a wired cap provider picks it up unchanged" 的"接上即用"已不成立（新 provider 读 config.json，不读 settings ns）。不改的话 force-stop ladder 在 e2e 里永远不会被真正验证。建议：staging 改写到 scratch profile 的 config.json 顶层键（theme 同层的 configLoad seam），预期 ladder 点亮、三条 warn 消失。
3. **30-commands plugins roster 期望过时（e2e 侧，低优先级，#2）**——"empty-by-construction" 注释与 client 面组合事实相反（common.sh:213-222 每容器 bake registry+dispatch），ok 分支永不可达、warn 每轮必响；空态已有 ft 覆盖，仅修期望即可。

61-btw 两条（#3/#4）另有专门任务在裁决，不列入本清单。

其余 8 条（#1、#5-#7、#9-#12、#14）维持"已知不修"：均有源码注释或脚本记账（file:line 见上表），且其中 4 组行为另有 ft/单测覆盖（composer-palette-ft、resume-picker、agents-panel、commands.test）。

## 3. 复核命令（只读）

```bash
# 总数核对（应输出 0/2/5/5/2，合计 14）
for f in /tmp/e2e-g1.log /tmp/e2e-g2.log /tmp/e2e-g3-trace.log /tmp/e2e-g4.log /tmp/e2e-g5.log; do
  printf '%s: %s\n' "$f" "$(grep -c '^  warn ' "$f")"
done

# 各条原文
grep -n '^  warn ' /tmp/e2e-g{1,2,5}.log /tmp/e2e-g3-trace.log /tmp/e2e-g4.log

# 关键源码记账
grep -n 'ctrl+alt+f' /Users/qingguee/repo/dsh-opentui/packages/tui-base/src/config/keybind.ts
grep -n 'CAP SOURCE' /Users/qingguee/repo/dsh-opentui/packages/shell/src/subagent-policy.ts
sed -n '496,504p' /Users/qingguee/repo/dsh-opentui/packages/shell/src/client/remote-host-session.ts
sed -n '440,441p' /Users/qingguee/repo/dsh-opentui/packages/tui-base/examples/v2-entry.tsx
sed -n '65,70p'  /Users/qingguee/repo/dsh-opentui/packages/tui-base/src/routes/session/resume-picker.ts
sed -n '457,463p' /Users/qingguee/repo/dsh-opentui/e2e/lib/common.sh
sed -n '213,222p' /Users/qingguee/repo/dsh-opentui/e2e/lib/common.sh
grep -n 'no plugins installed' /Users/qingguee/repo/dsh-opentui/packages/tui-base/test/commands.test.ts
grep -n 'empty corpus state\|zero agents' /Users/qingguee/repo/dsh-opentui/packages/tui-base/test/agents-panel.test.ts
```
