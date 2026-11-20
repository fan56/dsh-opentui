# 024 real-client gate runner — evidence bundle

- captured: 2026-11-21 (dsh `0.2.2-rc.5`, worktree `feat/024-capir` @ S3 落点 a63e636, macOS arm64)
- recipe: `scripts/real-client-gate.sh` (idempotent, fresh scratch DSH_HOME, numeric `.ans` only)
- root-cause write-up: `/Users/qingguee/repo/wayfinder-web-profile/research/024-real-client-gate-runner.md`
- harness-fix rerun write-up: `/Users/qingguee/repo/wayfinder-web-profile/research/024-verify70-harness-fix.md`

## 1. Root cause of the shared S1/S2/SK wall (first-hand)

| scratch seed pattern | host stderr | client symptom |
|---|---|---|
| only `opentui` profile (verify70) | `dsh: profile "opentui-inproc" does not exist` | `BRIDGE_DEAD` (host exit 1) |
| `opentui` + `opentui-inproc` copied from real home (S1/SK) | `skipping profile bundle "@aiwayds/dsh-opentui-bridge": cannot resolve ...` + `approval-gate failed to import` (`ERR_MODULE_NOT_FOUND`) | `BRIDGE_TIMEOUT: no reply for bridge.hello within 30000ms` |
| same, after `provision-inproc-profile.mjs --repair` | (none) | framed `bridge.hello` reply; composer input box in ~6s |

The real home's inproc bridge symlink dangles at a removed worktree
(`dsh-opentui-wt-inproc`), and the source launcher (`dsh-opentui` → `client-entry.tsx`)
does NOT run provisioning (only the published bin does). Copying profiles into a
scratch home therefore carries the dead link; the host silently skips the bundle
and no `bridge.hello` responder exists. `provision-inproc-profile.mjs --repair`
points the link at this checkout's `dist/bridge`, grants the rc.5 exemption and
rebuilds patch/shim — from an EMPTY home it alone is sufficient.

Env factors checked: host starts (but skips bundle / aborts on missing profile);
the 232 `@deepseek-ai/*` symlinks in `profiles/node_modules` are present and NOT
the blocker; cordis.patch/shim are current after provisioning; host version
auto-detected as rc.5 (inside window), `DSH_OPENTUI_HOST_VERSION` not needed.

## 2. Gate run (canonical, `.proof/real-client-gate/`)

- preflight: dsh/node/bun/tmux + launcher + shipped bridge + fingerprint — PASS
- provision (`--repair`): PASS, bridge link -> this checkout's `dist/bridge`
- handshake smoke: `bridge.hello` replied in framed JSON — PASS
- composer readiness (numeric `.ans` input box): PASS in 6s
- numeric `.ans` frames (`capture-pane -e -p`, no PNG): all 6 non-empty
  - `s1-model.ans` 10.8 KB — /model picker + provider/model rows
  - `s2-account.ans` 12.9 KB — /settings → Account section reachable
  - `sk-06-modal.ans` 13.5 KB — modal quit-confirm dialog
  - `sk-06-esc.ans` 6.5 KB — resting frame (full arm→confirm needs live turn)
  - `sk-07-pgup-pgdn.ans` 6.5 KB — /agents panel + PgDn frame
  - `sk-08-basic.ans` 13.5 KB — composer input + footer hints

## 3. verify70 — harness fixes applied; non-exempt items all PASS (36/58)

`node verify/agents-mount-repro.mjs` (clean-session rerun after the harness
fixes) now reports **36/58 PASS, 22 FAIL** (verbatim `verify70.log`, summary
`verify/agents-mount-out/summary.json`). The original 23/58 had 35 reds; oldfox
adjudicated them into 22 structural reds ([S5] 15 + [AG] 7) + 13 recoverable
(9 [H] + 1 [R] + 3 [M]). All 13 recoverable are now GREEN; the 22 remaining are
exactly the adjudicated structural set — no new red, no over-fix.

### 3.1 Harness fixes (gate asset, not slice implementation)
1. `submit()` — `C-u` clear before typing + **exact** read-back (was substring:
   `'l/settings'.includes('/settings')` let a chat message be sent → mock-LLM
   bash-approval modal). This removed the `l/settings` residue at its root.
2. Batch fail-fast guard — an entry guard per batch marks the chain BLOCKED and
   suppresses keys when a previous batch left a key-eating modal open (with
   early-return in `waitPane`/`waitFrame`); fresh `launch()` resets the gate.
   The Settings Esc ladder was also corrected to walk editor→rows→browse→confirm
   so a completed edit no longer parks the modal in the rows sub-pane.
3. `80x24` powerline locator — `🧠` was never painted (frame draws `🤖`/`dsh `/
   `⌨`); located the footer via the `⌨` hint row (fallback `dsh `). Item #33 now
   PASS (composer box rows 11-22, footer row 24/25).

### 3.2 Result mapping to oldfox's 35 adjudicated items
| oldfox档 | 项 | 数 | 复跑 |
|---|---|---|---|
| [H] | #9,#22,#23,#24,#29–33 | 9 | **全 PASS**（116 帧 / exit-confirm / F6 / hint / /thi / skill 行+Tab / palette>6 / 80x24 底界） |
| [R] | #25 click-to-focus | 1 | **PASS** — bisect at bf74277^ (4db780a) with the same recipe also PASS; no SK regression, no product defect (see research report §R) |
| [M] | #26–28 End / wheel / ↑-history | 3 | **全 PASS** |
| [S5] | #8,#10–21,#34,#35 | 15 | FAIL — 豁免，收敛于 S5（config/agents/settings 帧进 stdio 契约） |
| [AG] | #1–7 `/agents` 面板 | 7 | FAIL — 豁免，独立条目登记（不藏 S5 名下），切片归属未定 |

Non-adjudicated baseline items (composer context / dsh-tui absent / paged hint /
motion editor open+Esc / git branch / auto-resume seed+default) remain PASS.

### 3.3 Gate verdict (oldfox §1.1 判定式)
- (a) 环境项全 PASS ✓
- (b) 58 项中非豁免项（36 项中除 22 豁免外 + 13 恢复项）全 PASS ✓
- (c) 豁免项仅限 [S5]+[AG] 22 项；**S5 合入后必须 58/58**——S5 proof 附 verify70
  全量复跑，22 项逐项转绿，未转绿者立缺陷票，禁止静默续豁免
- (d) [H] 9 项 harness 修复后复跑全绿 ✓
- (e) [R] bisect 定责完成：bf74277^ 同配方复跑 click 亦聚焦 ⇒ 非 SK 引入；干净
  会话（UI settle 后）点击聚焦成功，键盘 F6 对照正常 ⇒ 非 renderer 缺陷；无产品
  修复、无已知红（详见 `024-verify70-harness-fix.md` §R）

Note: `scripts/real-client-gate.sh` has no `--allow-red` exemption mechanism yet
(oldfox §5 gap 1), so the script's raw exit remains 1 on the 22 structural reds.
The semantic gate verdict per §1.1 is PASS-with-exemptions; CI does not run this
job (workflow gate `vars.DSH_REAL_CLIENT_GATE` off). Root cause of the 22 reds:
client stderr confirms degraded `configLoad/configRaw/workspaceConfig`
(`bridge-session-seam.ts:2729-2758`); bridge dispatches only 12 methods — no
config/agents/settings frames on the inproc seam. See B3/C4/E3/F2 in
`024-e2e-requirements.md`.
