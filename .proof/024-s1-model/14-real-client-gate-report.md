# S1 supplementary — real-client gate (2026-11-21)

Environment wall (BLOCKED in the original slice) is broken. `scripts/real-client-gate.sh`
provisions a fresh scratch DSH_HOME and boots a renderable inproc TUI host.

- numeric frame: `14-real-client-gate-model.ans` (`capture-pane -e -p`, 10.8 KB)
- `scripts/verify-s1-model-ans.mjs` on this runner: PASS=4/4
  (TUI reached composer / /model picker opened / provider-model rows / no UNSUPPORTED crash)
- requirement B4 checked off in `024-e2e-requirements.md`
- B3 verify70: environment unlocked but entity REAL RED 23/58 — see `.proof/real-client-gate/report.md`
