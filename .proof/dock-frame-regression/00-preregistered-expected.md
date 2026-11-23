# Preregistered expected — dock frame regression (release blocker)

## Scope
Single failing case in `packages/shell/test/shell-render-regression-ft.test.tsx`:
`dock activity frame appears during a turn and hides after end + linger`.
Fails at HEAD `733e859`, passes at `8127420`. Time-box 30 min, single commit, no push.

## Bisect conclusion (evidence, isolated worktree `/private/tmp/bisect-dock`, real `pnpm install --frozen-lockfile`)
Chronological order over `8127420..HEAD`, one case each (`bun test ... -t "dock activity frame appears during a turn"`):

| commit | subject | result |
|---|---|---|
| 8127420 | docs(batch) baseline (control) | PASS |
| 7f89410 | mount tabbed activity frame on shipped route | PASS |
| 187a653 | mark the active tab + mouse click path | PASS |
| **36dc77a** | **return focus to composer when the activity dock hides** | **FAIL (first red)** |
| 1e4a237 | settled subagents leave the dock immediately (R7) | FAIL |
| 733e859 | subagent brief with per-batch timer (R8) | FAIL (HEAD) |

First red commit: `36dc77a`.

Setup note: symlinked `node_modules` from the main worktree is NOT a valid
bisect setup — the workspace link `@dsh-opentui/i18n` then resolves to the
main worktree's module while the fixture's `applyI18nConfig()` uses the
checked-out copy, producing a second module instance whose `t()` fail-opens
to raw keys (`overlay.widgets.todosHeader`). Every cell above uses a real
frozen-lockfile install inside the detached worktree.

## Root cause (file:line)
`packages/tui-base/src/routes/session/widgets-dock.tsx:1822-1824` (added by 36dc77a):
```
createEffect(() => {
  if (!activityFrameLatch.shown() && untrack(activePanel) === "activity") resetActivePanel()
})
```
The effect tracks `activityFrameLatch.shown()`. At turn start the push effect
(`:1804-1811`) arms the 60ms defer with `setLatch({ shown:false, pending:"show" })`
(`frameLatchNext`, `:1571-1577`). That `setLatch` notifies the reset effect while
`shown()` is still `false` — the "show pending" window — so it calls
`resetActivePanel()`. Instrumented trace at HEAD:
```
after markPanelActive: activePanel=activity shown=false
live:      activePanel=composer  shown=true  heavy=false
survived:  activePanel=composer  shown=true  heavy=false
```
The frame weight is `panelFocusFrame({ focused: activePanel() === "activity" })`
(`:2098`), so the panel stays single-framed (`┌`) and `expect(survived).toContain("┏")`
fails. The product behavior is otherwise intact: the dock appears during the
turn, stays latched OPEN after turn end while the in_progress todo remains
(D10), and hides once the lower zone is cleared.

## Nature judgment: STALE TEST PREMISE (not a product defect)
- 36dc77a's focus hand-back is intentional and has its own passing test
  (`packages/tui-base/test/widgets-dock-render.test.ts`, B2c-3, added in the same
  commit): on latch hide, a stale activity focus must return to composer.
- Production marks activity active only through `selectActivityDockTab` /
  `onActivityPanelMouseUp` (`widgets-dock.tsx:517-545`), i.e. a tab click or
  alt+1|2 while the framed board is visible. The test pinned activity BEFORE
  the turn, while the dock was hidden — a state the product now deliberately
  clears. That premise is obsolete; the lifecycle assertions are not.
- Fixing product code would alter the intended hide-focus behavior and risk
  R2/R5/R7/R8 coverage; the minimal correct change is to re-establish the
  focus premise where it is valid (after the framed board is up).

## Fix plan (test-only, strength not reduced)
In `shell-render-regression-ft.test.tsx`, case "dock activity frame appears…":
1. Remove the pre-turn `markPanelActive("activity")` (line ~161).
2. After the `live` frame confirms the dock is up, call `markPanelActive("activity")`
   and assert `expect(activePanel()).toBe("activity")` — explicitly fixing the
   "heavy border ⇔ active panel" premise. Add a comment naming 36dc77a.
3. Keep ALL lifecycle assertions unchanged: turn-up content (`live`), post-end
   + linger latch-open with heavy `┏` + `🧩 activity` + tree (`survived`), and
   full hide after `hydrate([])` (`settled`). Net expect() count 10 -> 11.

## Expected machine assertions (green criteria, environment-independent)
- `bun test packages/shell/test/shell-render-regression-ft.test.tsx` — that case PASS, 0 fail in file.
- `bun test packages/shell/test` (packages/shell full) — 0 fail.
- `bun test packages/tui-base/test` (packages/tui-base full) — 0 fail.
- `pnpm typecheck:entry` — exit 0.

## Discipline
- Commit only: this preregistration file + the one test file. Per-file `git add`;
  `git diff --cached --stat` reviewed before commit. No `zh-CN.json`, no other
  agents' untracked proof files. Single commit `test(shell): …`. No push.
- No assertion weakened, skipped, or deleted; no environment-dependent
  criterion; no secrets in evidence.
