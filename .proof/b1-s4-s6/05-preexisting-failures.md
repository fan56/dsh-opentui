# B1 S4/S6 — full scoped sweep: 2 PRE-EXISTING failures (not introduced by this slice)

- Command: `bun test packages/shell/test packages/tui-base/test packages/bridge/test packages/i18n/test`
- Result: 3355 pass / 6 skip / **2 fail** (`04-scoped-full.log`)
- Timestamp: 2026-11-23T02:49Z

## The two failures

1. `shell render regression battery > dock activity frame appears during a turn and hides after end + linger`
   - `shell-render-fixture.waitForFrame: timed out after 4000ms` (frame-timing fixture).
2. `incident regressions: paint continuity (real renderer, canned events) > bordered todos box draws its content rows inside the border`
   - `bottomIdx === -1` (no heavy `┗` frame border in the canned frame).

## Baseline verification (machine-checked)

`git stash push -u` → re-run only the two owning test files on pristine HEAD
(`87aa56f59bf8c631087da1f0ccc00f47c36d0c04`) → **same 11 pass / 2 fail** → `git stash pop` (changes restored, verified).

Neither failing file imports settings-panel / agents-panel / bridge-session-seam / bridge-settings-route;
both exercise the widgets-dock / dock-visibility render path, which this slice does not touch.

Conclusion: pre-existing/environmental (real-renderer frame fixture). Not a property of B1 S4-S6.
All B1-targeted assertions are green: `01-seam-route.log` (218 pass), `02-panel-source.log` (211 pass),
`03-typecheck-gate.log` (typecheck exit 0, frozen diff 0, new NOT_WIRED literals 0).
