# 024 real-client gate runner — evidence bundle

- captured: 2026-11-21 (dsh `0.2.2-rc.5`, worktree `feat/024-capir`, macOS arm64)
- recipe: `scripts/real-client-gate.sh` (idempotent, fresh scratch DSH_HOME, numeric `.ans` only)
- root-cause write-up: `/Users/qingguee/repo/wayfinder-web-profile/research/024-real-client-gate-runner.md`

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

## 3. verify70 — environment UNBLOCKED, real reds (transferred, not fixed)

`node verify/agents-mount-repro.mjs` now runs against a live client:
**23/58 PASS, 35 FAIL** (verbatim log in the untracked `verify70.log`; summary
`verify/agents-mount-out/summary.json`). The client stderr confirms degraded
`configLoad/configRaw/workspaceConfig` on the inproc bridge seam
(`bridge-session-seam.ts:2729-2758`); the bridge dispatches only 12 methods
(no config/agents/settings frames), so the /settings write-back and /agents panel
assertions cannot hold on this seam. Additional cascade reds from harness
keystroke/auto-resume timing (e.g. composer residue `l/settings`, approval dialog).
Per discipline these REAL REDS are NOT fixed as slice work and are transferred to
the coordinator; see B3/C4/E3 in `024-e2e-requirements.md`.
