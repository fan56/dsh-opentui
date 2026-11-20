# S2 supplementary — real-client gate (2026-11-21)

- account panel reachable in the renderable inproc TUI: `/settings` → Account section.
- numeric frame: `14-real-client-gate-account.ans` (`capture-pane -e -p`, 12.9 KB),
  plain view `14-real-client-gate-account.log`.
- C1/C5 residual UNCHANGED: `credentialsController` service is still not mounted in
  the opentui-inproc profile closure, so credentials three-method real-machine
  DATAFLOW remains NOT_WIRED (see `06-account-smoke.log`). The account panel frame
  does not change that service-availability fact; C1/C5 stay open.
- B3/C4 verify70: environment unlocked, entity REAL RED 23/58 (see `.proof/real-client-gate/report.md`).
