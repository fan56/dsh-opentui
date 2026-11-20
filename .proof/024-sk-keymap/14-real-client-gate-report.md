# SK supplementary — real-client gate (2026-11-21)

Environment wall (E1 BLOCKED in the original slice) is broken. Four numeric
`.ans` frames captured via `tmux capture-pane -e -p` (no PNG):

| frame | size | assertion |
|---|---|---|
| `14-real-client-gate-modal.ans` | 13.5 KB | ctrl+c quit-confirm dialog rendered (PASS) |
| `14-real-client-gate-esc.ans` | 6.5 KB | resting frame; full turn-Esc arm→confirm needs live turn (E2 partial) |
| `14-real-client-gate-pgup-pgdn.ans` | 6.5 KB | /agents panel + PgDn rendered (PASS, E4) |
| `14-real-client-gate-basic.ans` | 13.5 KB | composer input + footer hints (PASS) |

`scripts/verify-sk-keymap-ans.mjs` four scenarios all pass on this runner.
E1/E4 checked off, E2 partial (needs live session controller) in `024-e2e-requirements.md`.
B3/C4/E3 verify70: environment unlocked, entity REAL RED 23/58 (see `.proof/real-client-gate/report.md`).
