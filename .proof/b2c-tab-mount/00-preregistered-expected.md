# B2c — tabbed activity frame on the shipped route — preregistered expected

Worktree / branch: `/Users/qingguee/repo/dsh-opentui-wt-uibatch-1123` @ `feat/ui-batch-1123`.
HEAD at write: `84b2ce72a28b681860bb95f880d531195183652c`.
Written (UTC): 2026-11-23T05:09:25Z. Write-once; `.log` / `.ans` are gitignored capture artifacts.

> **Timing note (honest)**: root cause, fix design and the unit-level expectations below were established from source analysis + the R2 render tests BEFORE the final tmux capture; this file is written after that final capture. The `expected` values are therefore frozen against the pre-capture analysis, not reverse-engineered from the capture output.

## Root cause (pre-change, from source + installed bundle)

- The shipped client boots `packages/tui-base/examples/v2-entry.tsx` (client-entry.tsx computes `../../tui-base/examples/v2-entry.tsx`; the published `dist/client/index.js` bundle contains `v2-entry.tsx` + `widgets-dock.tsx` sources). WidgetsDock IS mounted there with `turnActive: () => busy()` — no v1/v2 dual-route gap.
- `activityFrameLatch` was latching correctly on the live turn (`turnActive() || lower content || think/tool rows`). The dock WAS in its shown state.
- The real gap is the **compact terminal branch**: `activityFrameMode(terminalRows)` (`widgets-dock.tsx:1216`) returns `"rule"` at `<= COMPOSER_COMPACT_TERMINAL_ROWS` (30, `skin/semantic.ts:174`). The rule branch (`widgets-dock.tsx` around `:1984` pre-change) rendered `activityRuleLines` + `compactLower()` and had NO tab bar and NO read of `activityDockTab`. R2 had wired the tab bar only into the framed box `title` (`mergedTitleText`), which never renders on the shipped 24-row pane. Hence `┃ 活动` + `┃⚙bash sleep...` with no tabs, exactly as captured.
- Reproduced on the shipped bundle at 120x24 in tmux; at 120x36 the framed tab bar (`1 主面板  2 待办`) appears — confirming the row-count gate.

## Fix

- `widgets-dock.tsx` compact branch: add a first-row tab bar via `dockTabBarLayout` + `mergedLineView` (CJK-safe path), a `compactTabAtPosition` mouse hit test, and route the content through `activityDockTab()` (`main` = rule lines + lower zone; `todo` = `todoTabLines`; empty todo => bar-only empty state). `compactHeight()` updated to account for the tab row.
- No route change, no frame-threshold change, no i18n key change, no bridge/seam/provisioner/dist diff.

## Preregistered expected (E1–E4, machine-checkable)

| id | assertion | expected (FROZEN) | pass criterion | changed path | evidence |
|----|-----------|-------------------|----------------|--------------|----------|
| E1 | compact terminal mounts tab bar | a real-render WidgetsDock at height 24 paints a leading row `1 main  2 todo` (en test locale) | render test asserts `occupied[0].trimEnd() === "   1 main  2 todo"` at 24 rows | `widgets-dock.tsx`, `widgets-dock-render.test.ts` | test run log |
| E2 | main tab unchanged | `activityDockTab()==="main"` still paints the rule form (`bash` tool line present) | render test asserts `bash` present in main, bar row still leading | same | test run log |
| E3 | alt+2 / alt+1 switch | `setActivityDockTab("todo")` writes the signal the global keymap `session.dock.tab.*` commands use; todo paints the tree and drops the rule lines; `setActivityDockTab("main")` restores | render test drives the module signal and asserts todo tree `romeo` present + `bash` absent, then main restores `bash` | same | test run log |
| E4 | shipped-route real frame | on the rebuilt installed bundle at 120x24, during a live turn the dock top shows `1 主面板  2 待办`; after `M-2` the tab row persists | `capture-pane` `.ans`/`.txt` contains the literal `1 主面板  2 待办` on the dock top row | n/a (evidence only) | `/private/tmp/b2c-final-main.ans`, `/private/tmp/b2c-final-todo.txt` |

## Gate expectations

- `bun test packages/tui-base/test/widgets-dock-render.test.ts` + R2/dock unit files: all green.
- `bun run typecheck:entry` (tui-base): exit 0.
- Single commit `fix(dock): mount tabbed activity frame on the shipped route (R2 followup)`; no push; no `packages/shell/dist` source diff committed (build output is gitignored).

## NOT RUN

- Mouse SGR click injection (`ESC[<0;x;yM`) not exercised on the real pane; the hit-test is pure-function covered by the R2 tab-bar test.
- v1/v2 dual-route hypothesis: disproved (single v2-entry boot); no route migration performed.

## Observation (not a gate, reported to coordinator)

- While a permission dialog is open on a 24-row pane, the compact dock's CJK glyphs were observed blanked in the rebuilt bundle; after the dialog is dismissed the tab bar renders `1 主面板  2 待办` correctly. This reproduces with clean pre-fix source too, so it is pre-existing and out of this slice's scope; recorded, not silently passed.
