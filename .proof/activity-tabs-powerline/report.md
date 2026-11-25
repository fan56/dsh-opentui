# Proof Report: activity-tabs-powerline / 证明报告：activity 面板 powerline tab 条

- Gate / 门禁: PASS
- Profile(s) / 证明类型: DESIGN + FEATURE
- Expected registered (UTC) / 预期登记时间: 2026-11-25T02:20:55Z
- Change ref: 30f70ff (commit containing this change; amended after the implementation review; the report commit is separate)
- Working tree: tracked clean; `.proof/` is added by this report commit; `packages/shell/dist/` is ignored build output
- Task: Move the activity dock tab strip from the framed box title (and the compact first row) to a right-aligned last content row, and render it as the powerline scheme 1 (two solid segments, U+E0B0 arrows between segments and closing the strip).
- Acceptance target (user verbatim) / 验收目标（用户原话）: "把这个做完后，用 skill proof-it-works 证明工作。 然后走发版"
- Changed behaviors / 改动行为:
  1. Framed placement + title + box height: tabs leave the top-border title and become the last content row; box height = content rows + 3 -> A1, A3; reverse: A5 (pre-change top border).
  2. Compact placement: tabs move from the first row to the last row -> A4; reverse: A5 (pre-change first row).
  3. Selection rendering: one cell source swaps the solid segment; U+E0B0 arrows bound the segments -> A2; reverse: A7 (arrow cells are not clickable; the old top-border origin no longer hits).
  4. Width degradation ladder -> A6; reverse: A5 narrow 27-col capture (pre-change top-border title truncated by takeWidth).
  5. Cell-driven hit testing -> A7; reverse: A7 old top-border origin no longer hits.
  Baseline method: pre-change worktree at commit 482d710 (`/Users/qingguee/repo/dsh-opentui-wt-inproc-only`, client rebuilt from that commit at 2026-11-25T10:22Z); the same capture script and the same commands produced `00-pre-change.log` and the raw `00-pre-*.ans` files.
- Touched paths / 本次改动: `packages/tui-base/src/routes/session/widgets-dock.tsx` (activityDockTabLabels, dockTabStripLayout, dockTabStripCells, DockTabStripView, dockTabAtPosition, mergedTitleText, frameHeight); `packages/tui-base/src/skin/semantic.ts` (dockTabStripColors); `packages/tui-base/test/widgets-dock-tabs-r2.test.ts`; `packages/tui-base/test/widgets-dock-render.test.ts`; `packages/shell/test/shell-render-incident-motion-ft.test.tsx`; `docs/activity-merged-widget.md`; `CHANGELOG.md`
- Evidence directory / 证据目录: `.proof/activity-tabs-powerline/`
- Assertion total / 断言总数 N: 7

## Acceptance assertions / 验收断言

| id | assertion | expected | pass criterion (checkable) | changed path (file:function/route) | level required | evidence file | depends on |
|----|-----------|----------|---------------------------|------------------------------------|----------------|---------------|------------|
| A1 | Framed 80x40: strip is the last content row, right-aligned, gap 2, border at col 79 | strip spans 0-based cols 53..76 (width 24: seg 11 + arrow 1 + seg 11 + arrow 1); cols 77,78 blank; right border col 79; main seg bg RGB(133,153,255); todo seg bg RGB(20,20,25) | captured ANSI: strip row = bottom-border row - 1; cells at 53..63 bg=133,153,255; 64 arrow 1 col fg=133,153,255/bg=20,20,25; 65..75 bg=20,20,25; 76 arrow 1 col fg=20,20,25; col 77,78 have no text; col 79 is the box border | packages/tui-base/src/routes/session/widgets-dock.tsx (framedStrip -> dockTabStripLayout; DockTabStripView) | Artifact | 02-framed-80x40.ans | |
| A2 | Framed 80x40: Alt+2 swaps the solid segment to todo, geometry unchanged | strip stays 0-based 53..76; todo seg bg RGB(133,153,255) at 65..75; main seg bg RGB(20,20,25) at 53..63; arrow at 64 now fg=20,20,25/bg=133,153,255; trailing arrow fg=133,153,255 | same parsing as A1 on the post-key capture; all four cell widths unchanged (11/1/11/1) | packages/tui-base/src/routes/session/widgets-dock.tsx (dockTabStripCells, DockTabStripView) | Artifact | 02-framed-80x40-alt2.ans | A1 |
| A3 | Framed: top border no longer carries tab labels; box height is content rows + 3 | top border row contains no `main`/`todo`/`[` bracket marker; strip row sits exactly one row above the bottom border | captured top border text has no `main`/`todo`; row(strip)=32 = row(bottom border)=33 - 1; pre-change 00 log shows `[1 main]` in the row that is now the top border | packages/tui-base/src/routes/session/widgets-dock.tsx (mergedTitleText, frameHeight) | Artifact + reverse | 02-framed-80x40.ans, 00-pre-change.log | A1 |
| A4 | Compact 80x24: strip is the last activity row, right-aligned, gap 2 | strip spans 0-based 54..77 (width 24); cols 78,79 blank; no box border on that row | captured last non-empty activity row contains both labels and both U+E0B0 glyphs; parsed cell columns 54..77; cols 78,79 blank; the row has no border glyph | packages/tui-base/src/routes/session/widgets-dock.tsx (compactStrip -> dockTabStripLayout; DockTabStripView) | Artifact | 02-framed-80x24.ans | |
| A5 | Reverse: pre-change build at 482d710 has the old layout at the same commands | pre 80x40: top border contains `[1 main]`; pre 80x24: first activity row contains `[1 main]`; pre narrow 27x40: top border is the tab title, clipped by takeWidth | raw pre-change captures contain `[1 main]` on the described rows and contain no U+E0B0; post-change captures contain U+E0B0 and no `[1 main]` | packages/tui-base/src/routes/session/widgets-dock.tsx (activityDockTabLabels pre-change) | Artifact + reverse | 00-pre-change.log, 00-pre-80x40.ans, 00-pre-80x24.ans, 00-pre-27x40.ans | |
| A6 | Degradation boundary 27x40: padding steps 2 -> 1 before any text degrades | strip width stays 24; 0-based cols 1..24; col 25 blank; right border col 26; labels still `1 main` / `2 todo` (no half-cut) | captured strip row: seg widths 11/11, arrows at 12 and 24; text contains both full labels; col 25 is blank; col 26 is the right border | packages/tui-base/src/routes/session/widgets-dock.tsx (dockTabStripLayout, DOCK_TAB_PADDING_STEPS) | Artifact + reverse | 02-framed-27x40.ans | |
| A7 | Cell-driven hit testing: arrow cells are not clickable and the old top-border origin no longer hits | dockTabAtPosition at the framed strip row returns `main` inside 53..63, `undefined` on arrow col 64, `todo` inside 65..75, `undefined` on trailing arrow col 76, and `undefined` for the old top-border origin (x=5, y=0) | `bun -e` transcript prints exactly those five verdicts (plus the forgiving bottom-border row) with no assertion error | packages/tui-base/src/routes/session/widgets-dock.tsx (dockTabAtPosition) | Artifact + reverse | 06-hit.log | |

## Evidence index / 证据清单

| file | level | what it captures | captured at (exact command/action + time) | redaction | sha256 |
|------|-------|------------------|-------------------------------------------|-----------|--------|
| 00-pre-change.log | Artifact | pre-change baseline: old tab placement at 482d710 | `node .proof/activity-tabs-powerline/capture-tabs.mjs --repo /Users/qingguee/repo/dsh-opentui-wt-inproc-only --out ... --prefix 00-pre --port 45124 --geoms 80x40,80x24,27x40` at 2026-11-25T02:25Z | n/a | 63448cb698eeb2235698dac868eadabcca9a40cdee49adb984a161a6dfa39a45 |
| 00-pre-80x40.ans | Artifact + reverse | raw ANSI of the old framed layout (tabs in top border) | same run at 2026-11-25T02:25Z | n/a | c5b1d7dad855bf4f8e7463e964b16550b79366bf001f59195b47eab75f11b444 |
| 00-pre-80x24.ans | Artifact + reverse | raw ANSI of the old compact layout (tabs in first row) | same run at 2026-11-25T02:25Z | n/a | afa2e1a91a63b6af5f39b93ff8024d05cb5a074a7566e51daff9d7f5a04109a0 |
| 00-pre-27x40.ans | Artifact + reverse | raw ANSI of the old 27-col layout (title clipped by takeWidth) | same run at 2026-11-25T02:25Z | n/a | cccd1e74a2b92ce5f1e86e8e0da4cddf4a2b5359f4ad14beb1260137551ac265 |
| 02-framed-80x40.ans | Artifact | dark framed 80x40, main selected | `node .proof/activity-tabs-powerline/capture-tabs.mjs --repo .../dsh-opentui-wt-ui-tabs --out ... --prefix 02-framed --port 45123 --geoms 80x40,80x24,27x40` at 2026-11-25T02:41Z | n/a | eac503492ecec67f3905f017c2a93ce1cfe76ffa1ff2feb491d34628869cb5bc |
| 02-framed-80x40-alt2.ans | Artifact | dark framed 80x40 after Alt+2 (todo selected) | same run at 2026-11-25T02:41Z | n/a | 253404dd33ba648f2d1e3eac0be7beddb5f084e056644aad40758c305f6c7180 |
| 02-framed-80x24.ans | Artifact | dark compact 80x24, main selected | same run at 2026-11-25T02:41Z | n/a | 0246b6bca6647b6c297395ccd3c89e8bc510965822dd6b8adf1778df49f174b6 |
| 02-framed-80x24-alt2.ans | Artifact | dark compact 80x24 after Alt+2 (todo selected) | same run at 2026-11-25T02:41Z | n/a | 792407301c4a6ec0e486a7bb1fe371c63d83b0d31646df44f86d48b9e684f26b |
| 02-framed-27x40.ans | Artifact + reverse | 27-col framed, padding stepped to P=1 with full labels | same run at 2026-11-25T02:41Z | n/a | 4f8e9ce476acd6b7e802a14f2db6d2c0fe6db4b832d5505c7b2012b15c0e4fdc |
| 04-light-80x40.ans | Artifact | light theme framed 80x40, main selected | `node .proof/activity-tabs-powerline/capture-tabs.mjs --repo .../dsh-opentui-wt-ui-tabs --out ... --prefix 04-light --port 45125 --geoms 80x40 --light` at 2026-11-25T02:43Z | n/a | 55fb63305546f7ad8f581d6f2e5b446d1f78b6ad1e5afa125ec65eca60b8996d |
| 06-hit.log | Artifact + reverse | `bun -e` hit-test verdicts on the changed functions | `cd /Users/qingguee/repo/dsh-opentui-wt-ui-tabs && bun -e '...dockTabAtPosition...'` at 2026-11-25T02:39Z | n/a | d6cffb25560b6d6171c9ad55e6c20f79bdfff76fb494b69ea3851a42b060e2d8 |
| 07-render-tests.log | Artifact | render-level mouse tests + shell ft row-count test | `cd packages/tui-base && bun test test/widgets-dock-tabs-r2.test.ts test/widgets-dock-render.test.ts` and `cd packages/shell && bun test test/shell-render-incident-motion-ft.test.tsx` at 2026-11-25T02:44Z | n/a | 5d19bce38ce2814db911831e068e8b676c0f75d80393d7a5881150120ed066aa |
| 01-design-baseline.md | Artifact | design baseline with fixed meta block | copied at 2026-11-25T02:05Z | n/a | 4f7b0b515d0bdca3027a629d8876039bdd1194e99865b1f15edb456a0ffdfdd8 |

### Raw output: 00-pre-change.log

```
$ node .proof/activity-tabs-powerline/capture-tabs.mjs --repo /Users/qingguee/repo/dsh-opentui-wt-inproc-only --out /Users/qingguee/repo/dsh-opentui-wt-ui-tabs/.proof/activity-tabs-powerline --prefix 00-pre --port 45124 --geoms 80x40,80x24,27x40
# pre-change build: commit 482d710 (client rebuilt 2026-11-25T10:22Z from that commit)
# captured 2026-11-25T02:25Z

## 00-pre-80x40.txt (rows containing a tab label, 0-based index)
32: "┌─[1 main]  2 todo 🧩 activity─────────────────────────────────────────────────┐"

## 00-pre-80x24.txt (rows containing a tab label, 0-based index)
17: "   [1 main]  2 todo"

## 00-pre-27x40.txt (rows containing a tab label, 0-based index)
31: "┌─[1 main]  2 todo 🧩 act─┐"
```

### Raw output: 02-framed-80x40.ans (plain rows + parsed ANSI facts)

```
30: "└──────────────────────────────────────────────────────────────────────────────┘"
31: "┌─🧩 activity──────────────────────────────────────────────────────────────────┐"
32: "│                                                     🏠 1 main   📋 2 todo   │"
33: "└──────────────────────────────────────────────────────────────────────────────┘"

$ node parse-frames.mjs 02-framed-80x40.ans
{"row":32,"total":"33/41","plain":"│                                                     🏠 1 main   📋 2 todo   │",
 "bg":[{"start":0,"end":52,"bg":null},{"start":53,"end":54,"bg":"#8599ff"},
       {"start":56,"end":63,"bg":"#8599ff"},{"start":64,"end":66,"bg":"#141419"},
       {"start":68,"end":75,"bg":"#141419"},{"start":76,"end":79,"bg":"#0a0a0f"}],
 "arrows":[{"col":64,"fg":"#8599ff","bg":"#141419"},{"col":76,"fg":"#141419","bg":"#0a0a0f"}]}
main-text:  57:"1" fg=#1e1e22 bg=#8599ff | 59:"m" ... | 63:" " fg=#1e1e22 bg=#8599ff
todo-text:  69:"2" fg=#8a8a8a bg=#141419 | 71:"t" ... | 75:" " fg=#8a8a8a bg=#141419
gap-77-78:  77:" " fg=#ffffff bg=#0a0a0f | 78:" " fg=#ffffff bg=#0a0a0f
border-79:  79:"│" fg=#626573 bg=#0a0a0f
```
(The U+E0B0 arrows are PUA glyphs; the plain `.txt` rendering shows them as empty cells, the ANSI parse above reports their real columns/colors.)

### Raw output: 02-framed-80x40-alt2.ans (Alt+2)

```
32: "┃                                                     🏠 1 main   📋 2 todo   ┃"
{"row":32,"bg":[{"start":0,"end":52,"bg":null},{"start":53,"end":54,"bg":"#141419"},
 {"start":56,"end":63,"bg":"#141419"},{"start":64,"end":66,"bg":"#8599ff"},
 {"start":68,"end":75,"bg":"#8599ff"},{"start":76,"end":79,"bg":"#0a0a0f"}],
 "arrows":[{"col":64,"fg":"#141419","bg":"#8599ff"},{"col":76,"fg":"#8599ff","bg":"#0a0a0f"}]}
```

### Raw output: 02-framed-80x24.ans (compact)

```
17: "   ┃ activity"
18: ""
19: "                                                       🏠 1 main   📋 2 todo"
{"row":19,"total":"20/25","bg":[{"start":0,"end":53,"bg":null},{"start":54,"end":55,"bg":"#8599ff"},
 {"start":57,"end":64,"bg":"#8599ff"},{"start":65,"end":67,"bg":"#141419"},
 {"start":69,"end":76,"bg":"#141419"},{"start":77,"end":77,"bg":"#0a0a0f"}],
 "arrows":[{"col":65,"fg":"#8599ff","bg":"#141419"},{"col":77,"fg":"#141419","bg":"#0a0a0f"}]}
```
After Alt+2 the same row has main `#141419` and todo `#8599ff` with the arrow fg/bg swapped (raw: 02-framed-80x24-alt2.ans).

### Raw output: 02-framed-27x40.ans (P=1 boundary)

```
31: "│ 🏠 1 main   📋 2 todo   │"
{"row":31,"total":"32/41","bg":[{"start":0,"end":0,"bg":null},{"start":1,"end":2,"bg":"#8599ff"},
 {"start":4,"end":11,"bg":"#8599ff"},{"start":12,"end":14,"bg":"#141419"},
 {"start":16,"end":23,"bg":"#141419"},{"start":24,"end":26,"bg":"#0a0a0f"}],
 "arrows":[{"col":12,"fg":"#8599ff","bg":"#141419"},{"col":24,"fg":"#141419","bg":"#0a0a0f"}]}
```

### Raw output: 04-light-80x40.ans

```
32: "│                                                     🏠 1 main   📋 2 todo   │"
{"row":32,"bg":[{"start":0,"end":52,"bg":null},{"start":53,"end":54,"bg":"#c6d1f7"},
 {"start":56,"end":63,"bg":"#c6d1f7"},{"start":64,"end":66,"bg":"#fafafa"},
 {"start":68,"end":75,"bg":"#fafafa"},{"start":76,"end":79,"bg":"#ffffff"}],
 "arrows":[{"col":64,"fg":"#c6d1f7","bg":"#fafafa"},{"col":76,"fg":"#fafafa","bg":"#ffffff"}]}
selected fg #24379f (cells 53/57/59/62), unselected fg #6c6c6c (cells 65/69/71/74)
```

### Raw output: 06-hit.log

```
change_ref=30f70ff
stripWidth=24 rightPadding=2 cells=" 🏠 1 main ":main," ":no-tab," 📋 2 todo ":todo," ":no-tab
main-cell-58 -> main
arrow-64 -> undefined
todo-cell-70 -> todo
trailing-arrow-76 -> undefined
old-top-border-origin-5,0 -> undefined
bottom-border-tolerance-58 -> main
```

### Raw output: 07-render-tests.log

```
 38 pass
 1 skip
 0 fail
 314 expect() calls
Ran 39 tests across 2 files. [12.51s]
 4 pass
 0 fail
 96 expect() calls
Ran 4 tests across 1 file. [2.92s]
```

## Profile-specific section / 分项证明

**DESIGN baseline (external source):** `.proof/activity-tabs-powerline/01-design-baseline.md` — fixed meta block: `source_type: pre-existing design file (blocky, 2026-11-24) + user scheme selection`; `source_quote_or_path: /Users/qingguee/repo/dsh-opentui-wt-grill-1124/research/2026-11-24-onboard-cwd-tabs/07-powerline-tabs-design.md`; `source_sha256: 132fc83159dca2d80b3b4cc624edfa2514bd18ddc25620aedbcb800fb16f21f5`; `captured_at_utc: 2026-11-25T02:05Z`; `baseline_method: byte copy of the original design report; user selection verbatim; no values reverse-engineered from implementation`. User selection verbatim: 「方案一：两段都实心」 (2026-11-25). The baseline file was landed before any implementation file was edited (10:05 local; implementation commit at 10:18).

**DESIGN comparison table** (measured viewport 80x40 and 80x24; observed values from `capture-pane -e` ANSI, not a screenshot; tolerance: columns exact, color channels ≤8):

| element | dimension | baseline value | observed value | source files | match |
|---------|-----------|----------------|----------------|--------------|-------|
| strip | left/right column (framed 80) | 53..76 (0-based) | 53..76 | 02-framed-80x40.ans | yes |
| main segment | width | 11 | 11 (53..63) | 02-framed-80x40.ans | yes |
| todo segment | width | 11 | 11 (65..75) | 02-framed-80x40.ans | yes |
| inter-segment arrow | column, width | 64, 1 | 64, 1 | 02-framed-80x40.ans | yes |
| trailing arrow | column, width | 76, 1 | 76, 1 | 02-framed-80x40.ans | yes |
| right gap | columns | 77, 78 blank | 77, 78 blank | 02-framed-80x40.ans | yes |
| right border | column | 79 | 79 (`│`) | 02-framed-80x40.ans | yes |
| selected segment | bg / fg (dark) | #8599ff / #1e1e22 | #8599ff / #1e1e22 | 02-framed-80x40.ans | yes (Δ0) |
| unselected segment | bg / fg (dark) | #141419 / #8a8a8a | #141419 / #8a8a8a | 02-framed-80x40.ans | yes (Δ0) |
| selected segment | bg / fg (light) | #c6d1f7 / #24379f | #c6d1f7 / #24379f | 04-light-80x40.ans | yes (Δ0) |
| unselected segment | bg / fg (light) | #fafafa / #6e6e6e | #fafafa / #6c6c6c | 04-light-80x40.ans | yes (Δ2 ≤ 8) |
| compact strip | columns (80x24) | 54..77 | 54..77 | 02-framed-80x24.ans | yes |
| compact right gap | columns | 78, 79 blank | 78, 79 blank | 02-framed-80x24.ans | yes |
| top border | content | activity title only, tabs absent | `┌─🧩 activity …┐`, no `main`/`todo` | 02-framed-80x40.ans, 00-pre-80x40.ans | yes |
| box height | rows | content rows + 3 | 2 border rows + 1 strip row + 0 content rows = 3 | 02-framed-80x40.ans | yes |
| selection swap | colors | main/todo swap | main #141419, todo #8599ff, arrows swapped | 02-framed-80x40-alt2.ans | yes |
| 27-col degradation | strip columns / P | 1..24, P=1, gap 25, border 26 | 1..24, P=1, gap 25, border 26 | 02-framed-27x40.ans | yes |

**DESIGN reverse item (dedicated fields):**
- method / 方法: real-render absence probe (column boundary on the painted frame)
- target / 目标: strip left edge 53 and right edge 76; columns 52 and 77..78 must be blank panel background
- boundary value / 边界值: 52 and 77 (one column past each spec edge; off-by-one would color them)
- raw evidence file / 原始证据文件: 02-framed-80x40.ans
- result / 结果: col 52 bg null/panel, col 53 first selected bg #8599ff; col 76 trailing arrow, cols 77,78 panel bg #0a0a0f, col 79 border — boundary detected exactly, no ±1 drift

**Excluded (spec not given / 规格未给) — "no baseline value exists":**

| element | dimension | declaration |
|---------|-----------|-------------|
| `ui.dockTabs = "powerline" \| "plain"` fallback switch | behavior | no baseline value exists; design lists it as a future fallback recommendation, not a delivered value; out of this task's scope |
| U+E0B0 appearance on a terminal without a Nerd Font | glyph coverage | no baseline value exists; design records it as an environment risk (E1), not a specified rendering value; no such terminal available here |

**UNAVAILABLE (cannot measure here) — none.**

**FEATURE:** positive path: real launcher `dsh-opentui --client` inside tmux at 80x40, 80x24, 27x40 against an isolated scratch `DSH_HOME` (provisioned by `verify/lib/scratch-profile.mjs`), one live turn started with the offline mock LLM (`e2e/lib/mock-llm.mjs`, mock substitutes only the model provider — no network; launcher, bridge host, provisioner and OpenTUI renderer are the real shipped paths), then `tmux capture-pane -p -e`. The capture script, commands and times are in the evidence index. Reverse cases: the same script/commands on the pre-change worktree at 482d710 produce the old top-border/first-row layout (`00-pre-*.ans`); arrow-cell clicks return `undefined` while label cells return the tab (`06-hit.log`); the render tests dispatch real mouse-up events at the painted columns (`07-render-tests.log`, framed and compact). No stub replaces the render/bridge chain.

## Gate judgment / 门禁判定

- [x] All gate items for each selected profile are present (DESIGN a–f; FEATURE a–f)
- [x] Binding: acceptance target quoted verbatim, touched paths declared, >=1 evidence item per profile on this diff
- [x] Change ref names the change commit (30f70ff, not the report commit); working tree is free text; `changed path` filled for every row
- [x] Every assertion has a checkable criterion, a `changed path`, and an evidence file; A1/A2/A3/A4/A6/A7 execute changed paths
- [x] At least one real driven I/O transcript at the change commit (30f70ff): the tmux captures in 02-*/04-*
- [x] One reverse case per changed behavior on the decidable boundary, backed by `00-pre-change.log` and the 00-pre raw frames; DESIGN boundary probe included
- [x] No anti-cheat red line triggered
- [x] No `Claim`-level item is the sole basis for PASS
- [x] Assertion total N = 7; each of the 7 has a status; count matches
- [x] `expected` preregistered at 2026-11-25T02:20:55Z, never rewritten to observed; no criterion changed; no NOT RUN

Assertion status / 断言状态 (one entry per assertion, N total; enum: PASS | FAIL | NOT RUN | UNAVAILABLE | BLOCKED | USER-JUDGMENT | PASS-BY-USER; empty/outside = FAIL):
A1: PASS | A2: PASS | A3: PASS | A4: PASS | A5: PASS | A6: PASS | A7: PASS

Status summary / 状态汇总 (count by status; sum = N):
| status | count |
|--------|-------|
| PASS | 7 |
| FAIL | 0 |
| NOT RUN | 0 |
| UNAVAILABLE | 0 |
| BLOCKED | 0 |
| USER-JUDGMENT | 0 |
| PASS-BY-USER | 0 |

Result: PASS (identical to Gate)

## Re-run evidence / 回修证据

(none — first-round PASS)

## Failure rounds / 回修轮次

| round | what changed | new evidence file | old criterion (verbatim) | re-gate result |
|-------|--------------|-------------------|--------------------------|----------------|
| (none) | — | — | — | — |

## UNAVAILABLE / BLOCKED declarations / 无法验证声明

(none)

## USER-JUDGMENT / PASS-BY-USER / 用户判断项

(none — every in-scope dimension has a machine criterion; visual taste is not asserted)

## Gitignore notice / 忽略提示

`.proof/` is committed in this report commit (312 KB: raw `.ans` frames, plain `.txt`, `report.md`, the design baseline and the capture/parse scripts) so a second agent can inspect every cited number. No `.gitignore` change was made. The ignored `*.log` files (`*.err.log`, `02-framed-run.log`, mock logs) stay local because they are environment noise, not cited evidence.
