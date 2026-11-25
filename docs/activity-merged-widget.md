# Activity merged widget — specification

## Summary

This document freezes the decided design for merging the two currently independent bottom-dock panels — the think/tool activity frame and the todo/subagent frame — into a single `activity` panel rendered as two vertically stacked zones: an **upper zone** for tool (and think) activity rows, and a **lower zone** for the todo tree (todo entries plus subagents). **The two zones are rendered simultaneously and are both visible at all times.**

A prior design made the two zones mutually exclusive with a strictly serial fade-out → locked-height blank frame → fade-in switch. That design is **superseded** (see D2) because long-lived tools such as `await_agent` (timeout 300 s) hold the panel for minutes, and mutual exclusivity left the todo tree and subagents invisible for the entire wait. Block-level zone fades are gone with it; only the existing line-level cadence remains (2000 ms linger + 300 ms color sweep toward background, `packages/tui-base/src/routes/session/dock-visibility.ts:24-32`).

The title reflects what is in progress, composes at most two items (tool / subagent / think), and must never contain the word "todo".

**Important, not a cosmetic caveat:** the runtime data has no direct `todo`↔`subagent` association field. The subagent-to-todo mapping specified here is therefore a deliberately simple rule — **every running subagent hangs under the last `in_progress` todo**, or renders flat when there is none. It is known to misalign in several realistic scenarios (see Data model reality). This is an explicitly accepted approximation, not a correctness guarantee, and implementation must not present it as one.

> Decision source — the user's verbatim Chinese words are preserved below as citations. Statuses used in this spec:
> - **用户拍板** — user-decided, frozen.
> - **confirmed** — a frozen decision confirmed by the user. This includes every item originally chosen as a coordinator default: the user reviewed them all and said "其他我没意见" (I have no objection to the rest). No decision remains pending sign-off.
> - **实现约束** — implementation constraint (reuse an existing mechanism / verified code fact).
>
> Sections explicitly marked **SUPERSEDED** are retained so readers can see why an approach was abandoned; they are not in force.

---

## Decisions

### D1 — Container: simultaneous zones (用户拍板)

Merge the two existing independent panels into the `activity` panel as two stacked zones:

- **Upper zone:** think / tool activity rows, reusing the existing rendering (实现约束: reuse `thinkBlockLines` / `toolLineText` / `toolMarker`, see Implementation touchpoints).
- **Lower zone:** the todo tree — todo entries plus their subagents.
- **Both zones are mounted and visible at the same time.** Render precedence is purely positional: tool rows at the top, todo tree below. There is no active-zone selection and no mutual exclusion.

Decision source (user's verbatim):

> "await_agent 这类工具会长期占用面板（timeout 300s），互斥会导致几分钟看不到 todo 和 subagent"

### D2 — SUPERSEDED: mutually exclusive zones with serial switching

> **SUPERSEDED — not in force.** Retained only to explain the abandoned approach.

The former design mounted exactly one zone at a time and switched between them with a strictly serial transition:

1. Current zone fully fades out — **250 ms**.
2. A blank frame whose height is locked to the previous frame's height (no collapse).
3. Incoming zone fully fades in — **400 ms**.

Reverse direction was symmetric. The state machine also defined zone switch triggers, a "框高锁定" (height lock), and "打断语义" (interrupt semantics) for a switch arriving mid-transition.

**Why superseded:** the user rejected mutual exclusivity itself (see D1 decision source). A long-running tool such as `await_agent` (300 s timeout) would keep the upper zone active for minutes, hiding the todo tree and subagents for the whole interval — exactly the information the operator needs while waiting. With both zones now visible simultaneously there is nothing to switch, so the entire switch state machine, the height lock, the switch triggers, the interrupt semantics, and all block-level fades are void. The only remaining motion is the line-level cadence in D3. No height is "held" through a blank frame any more.

### D3 — Zone motion: line-level cadence only (用户拍板; 实现约束 for mechanism)

There are no block/zone-level fades. Each rendered line keeps the existing line-level lifecycle:

- A stopped row lingers fully visible for **2000 ms**, then its color sweeps toward the background over **300 ms** (`packages/tui-base/src/routes/session/dock-visibility.ts:24-32`, `DOCK_LINGER_MS = 2000` at `:25`, `DOCK_FADE_OUT_MS = 300` at `:28`, `DOCK_LINE_RETENTION_MS` at `:32`).
- The per-line entrance fade also exists (`SKIN_FADE_IN_MS = 400`, `packages/tui-base/src/routes/session/widgets-dock.tsx:84`), keyed by stable `line.id` via the module-level `lineFirstSeen` registry (`packages/tui-base/src/routes/session/widgets-dock.tsx:262-281`, reset per session at `:286-288`). Because timing is by first sight of the id, re-rendering a line does not replay its fade (see Rejected alternatives).

Motion tier gating is unchanged (D14). In `reduced` and `off`, decorations are disabled and rows jump straight to their final color.

### D4 — Title bar (confirmed; tool-priority sub-rule is 用户拍板)

Title text is composed from at most two items joined by ` · `, in priority order **tool > subagent > think**. The word "todo" never appears. Format:

```
┏━ <item>[ · <item>] ━━━...━━━┓
```

- The tab strip is **not** part of this border title (2026-11-25 powerline redesign). It is a real row inside the panel: the **last content row** in both layouts, right-aligned with two blank columns before the right border. The framed box spends one extra row on it (`frameHeight = 3 + content rows`); compact mode (≤ 30 rows) keeps its height by moving the existing tab row from the first to the last line. Only the composed activity item(s) and the ` · N/M` overflow suffix remain in the title above.
- The strip uses two solid segments (`🏠 1 main` / `📋 2 todo`, bare emoji, no VS16) joined and closed by U+E0B0 arrows. Selection is encoded by segment background/text colors, never by ASCII brackets or focus state. Narrow terminals shrink the right padding (2 → 1 → 0) before dropping whole label parts; names are never cut in half.

Selection table (exhaustive):

| Current content | Title |
|---|---|
| tool + subagent | `🔧 tool · 🤖 subagent` |
| tool only | `🔧 tool` |
| subagent only (with or without a todo) | `🤖 subagent` |
| think only | `💭 think` |
| think + tool (no subagent) | `🔧 tool` |
| think + subagent (no tool) | `🤖 subagent` |
| both zones empty | `🧩 activity` |

- The tool glyph is `🔧` (U+1F527) with **no** VS16 — user-decided 2026-11-17 because VS16 sequences are blanked by the real renderer (see the defect note below).
- "think + tool → `🔧 tool`" is explicitly user-decided (tool wins over think); the remaining rows are confirmed by the user ("其他我没意见").

### Known upstream rendering defect — VS16 in wcwidth mode (2026-11-17, awaiting user decision)

- **Evidence:** a real-machine tmux `capture-pane` of the actual `CliRenderer` wrote ZERO bytes for U+1F6E0 (`🛠`) and U+FE0F (VS16); the title rendered as `┏━  tool · 🤖 subagent` (leading blank where the glyph belongs). `🧩`, `🤖`, and the ZWJ sequence `👨‍💻` render correctly.
- **Root cause:** the `@opentui/core` 0.8.1 native addon, in wcwidth width mode (the fallback when Unicode mode-2027 detection fails), renders any grapheme containing U+FE0F as a single blank cell; the JS side does not strip VS16.
- `OPENTUI_FORCE_UNICODE=1` makes every VS16 variant render at full width; `OPENTUI_FORCE_WCWIDTH=1` blanks all of them. Observed to be nondeterministic across runs. Upstream fix required; not fixable in our trees.
- **Consequence:** D4's "VS16 is mandatory on the wrench" cannot be guaranteed on real terminals; the title may lose the glyph.
- **Measured alternatives** (same harness, both `<text>` and box title, border stays aligned): `🔧` U+1F527 renders at 2 columns; `🧰` U+1F9F0 renders at 2 columns; bare `🛠` and bare `⚙` render but only 1 column; `⚙️` U+2699+VS16 is blanked like `🛠️`.
- **Status:** both exposed glyphs were resolved on 2026-11-17 by dropping VS16: the activity title uses `🔧` (U+1F527) and the footer provider segment uses `🌐` (U+1F310), both user-decided. The underlying upstream defect remains and still blanks any future VS16 grapheme.

Decision source (user's verbatim, preserved):

> "todo 不是进行时状态"

A todo is a state record, not an in-progress activity, so it is excluded from the title by definition. "只有 subagent（有无 todo 都一样）→ 🤖 subagent" — the presence of a todo does not change the title.

### D5 — Inline row icons (用户拍板; 实现约束 for marker reuse)

Keep the existing per-row icons:

- think row: `💭 thinking · <secs> · <snippet>`
- tool row: `⚙/✔/✘ <tool name> <subject> · <secs> · <detail>` (reuse the existing `toolMarker`; 实现约束). In **coexistence mode** (todo zone has content, D8) this is trimmed to `⚙ <tool name> · <Xs>`: the `subject`, parameters, and `detail` are dropped. The leading glyph still follows `toolMarker` (`⚙` running / `✔` done / `✘` failed) and `· <Xs>` is the elapsed time — dynamic while the tool runs, final once it finishes. Only **tool-only mode** (no todo content) keeps the full `subject`/`detail` format above.

### D6 — Todo entry rendering (用户拍板 for glyphs/format and cancelled glyph; active-only display is 用户拍板)

Decision source (user's verbatim):

> "重点显示 active 的事情，没执行的 todo，可以不显示。"

- **Display policy (active-only):** the lower zone renders **only** entries with `status = in_progress`. `pending`, `completed`, and `cancelled` entries are **not rendered**. The todo zone therefore normally holds only **1–3 rows**; the 10-line cap and scroll window (D8) are a safety valve for extreme concurrency, not the normal path.
- **Empty lower zone:** if there is no `in_progress` todo **and** no running subagent, the entire lower zone is not rendered. If there is no `in_progress` todo **but** running subagents exist, those agents render flat with no parent row (D7).
- Status glyphs — parsing definitions are retained for all four statuses, but only `●` is actually rendered under the active-only policy:
  - `●` = in_progress — the sole glyph that appears in the lower zone.
  - `○` = pending — defined, but **does not appear** under the current display policy; keep its parsing/definition, do not delete it.
  - `✓` = completed — defined, but **does not appear** under the current display policy; keep its parsing/definition, do not delete it.
  - `⊘` = cancelled — defined, but **does not appear** under the current display policy; keep its parsing/definition, do not delete it.
- `cancelled` is defined as `⊘`, distinct from `○` (用户拍板). The existing implementation degrades cancelled to `○` (pending) at `packages/tui-base/src/routes/session/widgets-dock.tsx:344-348`; retain the distinct `⊘` definition in the parser per that decision (even though cancelled rows are not rendered under active-only).
- Entry line: `<status> <index> <content>` — **no separate `#` column**; the index sits directly after the status glyph.
- Agent sub-lines use tree branches: `├─ ` for a non-last child, `└─ ` for the last child. Branch indentation aligns just after the index.
- Agent line format: `<label> · <Xs> · round <N> · <lastLine tail snippet>`.

### D7 — Subagent attribution and ordering (用户拍板; ordering and flat fallback are confirmed)

All running subagents attach to a single parent: **the last `in_progress` todo** — the last `in_progress` entry by plan order, not the last todo overall. There is no sequential pairing, no text matching, and no timing inference.

Decision source (user's verbatim):

> "所有运行中的 subagent 一律挂在最后一条 in_progress todo下面（不是最后一条 todo，是最后一条处于 in_progress 的）。不做任何顺序配对、不做文本匹配、不做时间推断。"

Attribution cases (exhaustive):

- **No `in_progress` todo:** all running subagents render flat, with no parent row — semantically they are the main agent's subagents. This holds whether or not any todos exist. There is no "attach to last" fallback because there is no `in_progress` todo to attach to.
- **Exactly one `in_progress` todo:** all running subagents hang under that single todo.
- **Multiple `in_progress` todos:** all running subagents hang under the **last** one (the last `in_progress` entry in the array); every other `in_progress` todo has no agent under it.
- **Parent completes:** when the parent `in_progress` todo becomes `completed` (and is no longer rendered, D6), its agents automatically re-attach to the new last `in_progress` todo; if none remains, they render flat.

- **Ordering (confirmed):** with `pending`/`completed`/`cancelled` todos no longer rendered (D6), only `in_progress` entries appear, and they keep **original plan order**. The rank reordering is abandoned (`packages/tui-base/src/routes/session/widgets-dock.tsx:350-355` `statusRank`, and the sort/slice window at `:465-476`) — sorting collapses to "in_progress in plan order". `TODO_MAX_ROWS = 5` (`packages/tui-base/src/routes/session/widgets-dock.tsx:337`) is abolished; the 10-line scroll window in D8 is only a safety valve for extreme concurrency (D8).

> **Approximation warning (not a guarantee):** there is **no direct `todo`↔`subagent` association field in the runtime data**. This rule is a deliberately simple approximation and is known to misalign. See Data model reality for the concrete failure scenarios and code evidence.

Decision source (user's verbatim): "用户已接受近似误差" — the approximation is accepted, so no precise-backlink design is to be added.

### D8 — Height allocation and scrolling (用户拍板 for the 10-line total cap and the coexistence 1-line tool zone; the tool-only 3-line allocation is confirmed)

Height is a **single 10-line total** on non-compact terminals (tool zone + todo zone + scroll indicators). This total is a hard upper bound / safety valve, not a normal-path target: under D6's active-only display rule the lower zone normally holds only **1–3** `in_progress` rows. How that total is split depends on whether the todo zone has content:

- **Coexistence mode — todo zone has content (用户拍板):** the upper tool zone is fixed to **exactly 1 line**. Budget = **1 tool line + at most 9 lower-zone lines = 10 lines total**. That one tool line shows only the tool name and elapsed time (`⚙ <tool name> · <Xs>`, D5); the `subject`, parameters, and `detail` are dropped. If more than one tool row is present, only the **latest** one is rendered (the tail, consistent with `slice(-maxLines)`).
- **Tool-only mode — no todo content (confirmed):** the tool zone keeps its existing behavior — **min 1, max 3 lines**, each with the full D5 `subject`/`detail` — and no lower zone is shown.
- **Normal case:** the lower zone shows only `in_progress` entries (D6), so it is typically 1–3 lines; the 10-line cap and the scroll window below engage only when many `in_progress` todos run concurrently.
- **Empty lower zone:** if there is no `in_progress` todo and no running subagent, the lower zone is not rendered at all (D6). If there is no `in_progress` todo but running subagents exist, the agents render flat with no parent row (D7).
- The lower todo zone takes the remainder of the 10-line total. Combined visible content never exceeds 10 lines in either mode.
- Overflow in the lower zone scrolls. The title bar shows the lower-zone position `N/M` on its right side.
  - Decided 2026-11-17: when everything fits (no lower-zone overflow) the title prints NO `N/M`; `N` = 1-based first visible item (`start + 1`), `M` = total lower-zone items (`lowerRaw.length`).
- Bottom indicator: `▼ N more`. Top indicator: `▲ N more`.
- A scroll indicator occupies **one line of visible height** (counted against the 10-line budget, not drawn on top of it).

### D9 — Scroll input (confirmed)

- **Primary channel = mouse wheel.** The main client path boots with renderer mouse capture enabled (`useMouse: true`, `packages/tui-base/examples/v2-entry.tsx:1687`; plugin dist-host path `packages/runtime/src/engine.ts:39`). The `mouse` config item is a boolean that defaults to `true` (`packages/tui-base/src/config/index.tsx:261`, `:324`; v1 `packages/tui-base/src/config/v1/index.tsx:74`, `:129`). Wheel events reach the app: the live `onMouseScroll` handler forwards them to the transcript scrollbox via `processMouseEvent` (`packages/tui-base/src/component/session-frame.tsx:308-316`). `ScrollBox` itself handles wheel steps and bar dragging (`scrollByWheel`, `onMouseEvent`, `handleBarMouse`, `startAutoScroll`, `@opentui/core` `ScrollBox.d.ts:132-148`, version 0.8.1), with an in-repo `<scrollbox maxHeight={5}>` precedent (`packages/tui-base/src/routes/session/composer/subagents-tab.tsx:252`).
  - Decided 2026-11-17: right-pane-active is a documented wheel dead zone — the full-pane overlay (`session-frame.tsx:300-323`) covers the dock, so no overlay wheel forwarding is added; wheel scrolls the dock only when the left/session pane is active.
- **Optional keyboard fallback:** `ctrl+alt+↑` / `ctrl+alt+↓`, used only when the wheel is unavailable (e.g. a terminal that does not deliver wheel events). Implemented 2026-11-17 as command ids `session.dock.scroll.up` / `session.dock.scroll.down` (defaults `ctrl+alt+up` / `ctrl+alt+down`, `config/keybind.ts`) on a **global** layer; the same chords on `which-key.scroll.up/down` are inert (no which-key layer exists in this repo). The layer is active **only when** the lower zone overflows and `useIsPageOwner()` holds (`createLayer`'s `enabled` is also multiplied by `useInteractivity()`, so right-pane-active disables it); otherwise the keys are a no-op.
- **Must not** occupy `pageup`, `pagedown`, `home`, or `end`: the transcript already uses `session.page.up` / `session.page.down` (`packages/tui-base/src/config/keybind.ts:186-190`).
- Composer focus does not affect the keyboard fallback's effectiveness — the guard is overflow-and-overlay only, not focus domain.
- **Scope:** the `mini` split-footer runtime still boots with `useMouse: false` (`packages/tui-base/src/mini/runtime.lifecycle.ts:165`). This design covers only the main client path; the mini runtime is out of scope.

### D10 — Lower zone decoupled from turn lifecycle (confirmed)

- The `turnActive` determination is **not modified** (`packages/tui-base/src/routes/session/widgets-dock.tsx:1163`).
- When a turn ends but the todo list has not been cleared, the lower zone **continues to render** in a FlatDock-equivalent form. It must **not** depend on `activityFrameLatch` (`packages/tui-base/src/routes/session/widgets-dock.tsx:1093`, shown gate at `:1202`): the lower zone is not hidden by the frame latch's turn-boundary deferral.

### D11 — Compact-terminal degradation (confirmed)

- When `terminalRows ≤ COMPOSER_COMPACT_TERMINAL_ROWS` (`= 30`, `packages/tui-base/src/skin/semantic.ts:134`; not 24), the scrollable lower zone is **not rendered**.
- Upper zone: keeps the 2-line rule form.
- Lower zone: collapses to a single-line summary, reusing `todosSummaryLine` (`packages/tui-base/src/routes/session/widgets-dock.tsx:402-417`; call site `:454-456` already applies this threshold to the table).
- The 10-line cap (D8) and scrolling apply only on non-compact terminals (`terminalRows > 30`).

### D12 — Relationship with the gear system (confirmed)

- `session.activity_panel_height` (`1 / 5 / 7 / 10 / all`, schema at `packages/tui-base/src/config/index.tsx:186`) is reinterpreted for the merged frame as the frame's **total content-line cap**: a numeric gear `N` renders `N` content lines, and `all` renders 10. The older 2/3-row terminal budget and per-block half-split from `activityPanelCapSpec` survive **only in the FlatDock fallback** (the idle path when the merged frame is not shown); they do not constrain the merged frame.
- The 10-line cap in this document is that ceiling — the merged frame never exceeds it. D8's split (1 tool line + at most 9 lower-zone lines in coexistence mode) still governs how those lines are allocated; D12 changes only the total the gear sets.
- Effective total cap for the merged frame is `min(gear, 10)`: a numeric gear caps the visible lines at that number and `all` (unbounded gear) still uses the 10-line ceiling (decision approved by the user on 2026-11-17).

### D13 — Right-boundary alignment (confirmed; enforcement is 实现约束)

- **Hard requirement.** All row padding and cropping must be computed at render time with the runtime `stringWidth` (`packages/tui-base/src/util/string-width.ts`) — **never** from a character count, and **never** from a fixed width minus a byte/character estimate. Emoji (including ZWJ sequences) and CJK glyphs count as width 2; VS16 / combining characters as width 0.
- Every rendered row's visible width must **strictly equal** the container's inner width, with the right border landing on the composer's right border (`todosTableWidth` precedent at `packages/tui-base/src/routes/session/widgets-dock.tsx:419-431`).
- This is enforced by a **mandatory assertion test** (see Implementation touchpoints and Acceptance criteria) that feeds a row containing emoji, CJK, VS16, and ZWJ and checks the rendered visible width equals the container inner width. "Looks aligned" is not a pass condition.

### D14 — Gradient availability (用户拍板; 实现约束 for tiers)

Gradients/decorations exist only in the `motion = full` tier. In `reduced` and `off`, decorations are disabled; the line-level color change is immediate (no sweep). Tier source and read site are implementation constraints (`packages/tui-base/src/skin/motion.ts:156-178`).

### D15 — LastRequestDock disposal (confirmed)

Remove the running-children rows from `lastrequest-dock` (keep the `●` echo). Reason: subagents are now rendered in the activity lower zone; leaving the running rows in the footer dock would show the same subagent twice (activity lower zone and composer footer dock). The existing running-children source is `packages/tui-base/src/routes/session/lastrequest-dock.tsx:142-162`.

---

## Rejected alternatives

- **Per-todo precise attribution.** Rejected: the runtime data model has no field linking a subagent to a todo (see Data model reality). Implementing precise attribution would require inventing and threading a new linkage through the seam, which is out of scope. The user instead decided to hang every running subagent under the **last `in_progress` todo** (D7); do not reintroduce backlinks "for correctness".

- **Single-trunk scheme** (one unified continuous list merging activity rows and todo items into a single tree). Rejected: it mixes transient in-progress activity with static todo state, the two zone types have different row grammars (D5 vs D4), and the lower zone needs its own height allocation and 10-line scroll window (D8) independent of the upper zone. The mutual-exclusivity / serial-blank-frame rationale that originally rejected this option is void with D2 superseded; the rejection now rests on row-grammar separation and independent scroll/height control.

- **Zone-level fade-in / cross-fade between zones.** Rejected: an entrance fade already exists at the *line* level (`SKIN_FADE_IN_MS = 400`, `packages/tui-base/src/routes/session/widgets-dock.tsx:84`) and is keyed by stable `line.id` through the module-level `lineFirstSeen` registry (`:262-281`). A zone-level fade would (a) conflict with / double the line-level fade, (b) require re-keying lines on every zone appearance, and (c) contradict the user's removal of block-level motion in D2/D3. Since both zones are now always mounted, there is no zone appearance event to fade on. Keep the per-line mechanism only.

- **Keyboard-only scrolling.** Rejected: with renderer mouse capture enabled by default on the main path (`useMouse: true`, `packages/tui-base/examples/v2-entry.tsx:1687`; `packages/runtime/src/engine.ts:39`; config default `packages/tui-base/src/config/index.tsx:324`), the wheel is available as the primary scroll channel (D9), so making keyboard the sole channel would discard a working input. `ctrl+alt+↑/↓` is retained only as a fallback for terminals that do not deliver wheel events. (An earlier revision of this spec rejected wheel scrolling based on a stale comment at `packages/tui-base/src/routes/session/transcript-scroll.tsx:36-38`; that premise is false.)

- **`pageup` / `pagedown` / `home` / `end` for the scroll window.** Rejected: `pageup`/`pagedown` are bound to the transcript (`session.page.up` / `session.page.down`, `packages/tui-base/src/config/keybind.ts:186-190`). Use `ctrl+alt+↑/↓` instead (D9).

- **Rank-based todo reordering and the `TODO_MAX_ROWS = 5` window.** Rejected (superseded by D7): since only `in_progress` todos are rendered (D6), sorting collapses to "in_progress in original plan order" and rank reordering has nothing to reorder among non-visible statuses; it would still reshuffle the visible `in_progress` rows. The fixed 5-row window is replaced by the 10-line scroll cap, which is now only a safety valve for extreme concurrency. Render `in_progress` entries in plan order.

- **Nerd Font icons.** Rejected: Nerd Font glyphs require a patched font and break on stock terminals and under tmux. The verification path is real tmux `capture-pane` (see Acceptance criteria), which must render correctly with a stock font. The emoji set in D4/D5 is portable; keep it.

---

## Data model reality

Evidence anchors below are provided as verified facts, not re-derived.

- **Todo has only `content` and `status`.** Fields defined at `packages/tui-base/src/util/todo.ts:8-23`. Todo data source is `latestTodos`, which takes the last non-failed `todowrite` line, at `packages/tui-base/src/routes/session/widgets-dock.tsx:393-400`.
- **Subagent has no task description** and no todo reference. Fields defined at `packages/tui-base/src/seams/session.ts:317-345`. Only running subagents are rendered, sourced at `packages/tui-base/src/routes/session/lastrequest-dock.tsx:142-162`, and pushed from `packages/shell/src/client/session-seam-adapter.ts:706-717`.
- **No association field exists.** There is no `todoId`, no task id, and no shared key between a todo record and a subagent record. The rule in D7 is therefore a uniform "last `in_progress` todo" attachment, not grounded in any real association — it cannot distinguish which todo an agent actually belongs to.
- **Double-paint law**: within a turn, journal events are suppressed and the view is refreshed only by live delta (`packages/shell/src/client/session-seam-adapter.ts:80-88`, `packages/shell/src/client/session-seam-adapter.ts:770-775`). Any snapshot used to decide D7 attribution (which todo is the last `in_progress`) must be the current live delta, not a replayed journal.
- **Middle-band budget is a hard contract**: the 80-column middle band has only 8 rows (transcript floor 6 + activity rule 2), documented at `packages/tui-base/src/routes/session/widgets-dock.tsx:440-446`. This is why the compact-terminal single-line collapse (D11) is mandatory, not cosmetic.
- **Clock stops in the todo-only case**: `dockNeedsClock` (`packages/tui-base/src/routes/session/widgets-dock.tsx:1002-1005`) returns `false` when there are dock lines but no running subagent children — i.e. a todo-only lower zone with no running agent. In that case the animation clock is paused (call site `:1139`), so any lower-zone indicator that relied on the clock would not animate.
- **Mouse is enabled; plain drag-select is app-owned.** Renderer mouse capture is on by default on the main client path (`useMouse: true`, `packages/tui-base/examples/v2-entry.tsx:1687`; `packages/runtime/src/engine.ts:39`; config default `packages/tui-base/src/config/index.tsx:324`, `packages/tui-base/src/config/v1/index.tsx:129`), so in-app wheel scrolling is live (`packages/tui-base/src/component/session-frame.tsx:308-316`). The user-visible trade-off is text selection: terminal-native drag-select/copy now requires **Shift+drag**, while a **plain drag** is taken over by the app via `copyOnSelectRelease` (`packages/tui-base/src/util/selection.ts:41`). This replaced the earlier batch-`5f0f0b5` state in which the renderer disabled mouse capture so the terminal always kept native drag-select and Cmd+C; batch `56c0100` (pane-focus) re-enabled it. The `mini` split-footer runtime is the one remaining exception (`packages/tui-base/src/mini/runtime.lifecycle.ts:165`).

Known misalignment scenarios (the D7 "last `in_progress` todo" rule will be wrong in these):

1. **Main dispatches work before creating the todo** ("main 先派活后建单"): the agent exists before any in_progress todo, so it renders flat at first, then re-attaches once a todo becomes in_progress — wrong either way.
2. **Todo snapshot is stale** ("todo 快照过期"): `latestTodos` reflects the last non-failed `todowrite` line, which can lag the subagent's actual active task; the agent attaches to whatever entry is currently last in_progress, which may be outdated.
3. **Agent belongs to an earlier in_progress todo** ("agent 属于更早的 in_progress todo"): the last-in_progress rule piles every running agent under the single last in_progress todo, so agents that actually belong to earlier in_progress todos are shown under the wrong parent.
4. **Todo order changes after spawn**: re-ordering or rewriting the todo list shifts which entry is last in_progress, so running agents re-attach to a different todo. (Plan-order rendering in D7 removes the *rank-induced* reshuffle, but an author-driven reorder can still change which todo is last.)
5. **Agent outlives its todo**: a subagent still running after its parent todo completes is re-attached to whatever in_progress todo is now last, producing a false association. (With no in_progress todo at all, it renders flat.)

---

## Implementation touchpoints

Each item names the file and the section to change. Anchors are `path:line`.

- **Frame / title shell.** `packages/tui-base/src/routes/session/widgets-dock.tsx` (`mergedTitleText` / `frameHeight`) — border follows focus, `title`, `titleAlignment: left`. Produce the D4 composed title (with `N/M` from D8); tabs are no longer folded into it. The powerline strip is a separate last-row renderable (`DockTabStripView`), fed by `dockTabStripLayout`, and the framed box height is `3 + content rows`. Title string i18n base: `packages/i18n/locales/en.json:594` ("activity").
- **Frame height.** `packages/tui-base/src/routes/session/widgets-dock.tsx:1180` — currently `2 + think.length + tool.length`. Replace with simultaneous-zone height: tool zone is exactly 1 line in coexistence mode (name + time only, latest tool row) and up to 3 lines in tool-only mode (D8); lower zone takes the remainder up to the 10-line total cap. There is no locked blank frame (D2 superseded).
- **Line crop width / right alignment (hard requirement).** `packages/tui-base/src/routes/session/widgets-dock.tsx:1142` — `Math.max(16, dimensions().width - 4)`. Crop and pad with the runtime `stringWidth` only, never a character count or a fixed width minus a byte estimate (D13; `packages/tui-base/src/util/string-width.ts`). A **mandatory assertion test** must feed a row containing emoji, CJK, VS16, and ZWJ and assert the rendered visible width strictly equals the container inner width; "looks aligned" is not a pass. Border-width precedent: `todosTableWidth` at `packages/tui-base/src/routes/session/widgets-dock.tsx:419-431`.
- **Think row rendering.** `packages/tui-base/src/routes/session/widgets-dock.tsx:546-566` (`thinkBlockLines`) — upper zone; keep D5 format `💭 thinking · <secs> · <snippet>`.
- **Tool row rendering.** `packages/tui-base/src/routes/session/widgets-dock.tsx:518-534` (`toolLineText`) and `packages/tui-base/src/routes/session/widgets-dock.tsx:508-510` (`toolMarker`) — upper zone; keep D5 format and marker.
- **Visibility lifecycle.** `packages/tui-base/src/routes/session/dock-visibility.ts:24-32` (LINGER 2000 / FADE_OUT 300 / RETENTION 2300, `:25`/`:28`/`:32`) and `:70-80` (state decision). Keep as-is for line-level cadence (D3). Do not extend it to drive zone selection — there is no zone switch (D2 superseded).
- **Line-level fade.** `packages/tui-base/src/routes/session/widgets-dock.tsx:296-306` (`skinDockLineFg` → `mixSkinColor` toward background) and the `lineFirstSeen` registry at `:262-281` / reset at `:286-288`. This is the only fade mechanism; no zone fades.
- **Whole-frame show/hide.** `packages/tui-base/src/routes/session/widgets-dock.tsx:1201-1241` — `<Show when={activityFrameLatch.shown()}>`; `false` falls back to `FlatDock`. Keep the fallback intact, but the **lower zone must render regardless of the latch** (D10), so it survives turn end through the FlatDock-equivalent path.
- **Frame latch / defer.** `packages/tui-base/src/routes/session/widgets-dock.tsx:1022` (`ACTIVITY_FRAME_DEFER_MS = 60`), `:1053-1093` (`createFrameLatch`, `activityFrameLatch`), push at `:1163`. Reuse for the no-ghost-border criterion, but do not gate the lower zone on it (D10).
- **Animation clock.** `packages/tui-base/src/routes/session/widgets-dock.tsx:1138-1141` (`onAnimationTick` → `dockSpin`) and `dockNeedsClock` at `:1002-1005`. Note the todo-only clock-stop case in Data model reality: lower-zone indicators must not require the clock when no agent is running.
- **Motion tiers.** `packages/tui-base/src/skin/motion.ts:156-178` — source of full/reduced/off; D14 reads this to decide decoration vs immediate color.
- **Todo data source + active-only filter.** `packages/tui-base/src/routes/session/widgets-dock.tsx:393-400` (`latestTodos`) with fields at `packages/tui-base/src/util/todo.ts:8-23`. Filter to `status = in_progress` only (D6); do not render `pending`/`completed`/`cancelled`. Render the surviving entries in original plan order per D7; remove the `statusRank` sort and `TODO_MAX_ROWS` slice (`:350-355`, `:465-476`).
- **Todo table / compact fallback.** `packages/tui-base/src/routes/session/widgets-dock.tsx:451-456` (`todosTableLines`) and `todosSummaryLine` at `:402-417`; compact threshold already applied at `:454-456`. Extend the single-line summary to D11's scroll-zone suppression.
- **Subagent data source + attribution.** `packages/tui-base/src/routes/session/lastrequest-dock.tsx:142-162` (running only) with fields at `packages/tui-base/src/seams/session.ts:317-345`, pushed from `packages/shell/src/client/session-seam-adapter.ts:706-717`. Apply D7: hang every running subagent under the last `in_progress` todo, or render flat when there is none; re-attach to the new last `in_progress` todo when the parent completes.
- **Footer dock disposal.** `packages/tui-base/src/routes/session/lastrequest-dock.tsx:142-162` — remove running-children rows, keep `●` echo (D15).
- **Scroll indicators.** `▼ N more` / `▲ N more` and title `N/M` from the frame/title section; reserve one visible line each (D8). The 10-line scroll window is a safety valve for extreme concurrency only; under D6 the lower zone is normally 1–3 `in_progress` rows.
- **Wheel scroll (primary) + scroll keys (fallback).** The wheel path already exists: `onMouseScroll` → `sessionScroll.processMouseEvent` (`packages/tui-base/src/component/session-frame.tsx:308-316`), backed by `ScrollBox` wheel handling (`@opentui/core` `ScrollBox.d.ts:132-148`, version 0.8.1) and the `<scrollbox maxHeight={5}>` precedent (`packages/tui-base/src/routes/session/composer/subagents-tab.tsx:252`). For the keyboard fallback, `packages/tui-base/src/context/keymap.tsx:220` (mode `"global"`) — register `ctrl+alt+↑/↓` with the overflow + no-overlay guard (D9). Do not bind `pageup`/`pagedown`/`home`/`end` (`packages/tui-base/src/config/keybind.ts:186-190`). The keymap path is `context/keymap.tsx`, not `ui/keymap.tsx`.
- **Stale mouse comments/docs — correct alongside implementation, do not change code now.** `packages/tui-base/src/routes/session/transcript-scroll.tsx:36-38` and `packages/tui-base/README.md:291-294` still describe the renderer as `useMouse: false` with no in-app wheel events (references to batch `5f0f0b5`, since reversed by batch `56c0100`). Both are outdated and should be corrected when this design is implemented.
- **Known paint bug (context, not a change target).** `docs/upstream-opentui-paint-bug-draft.md` — under sustained repaint, diff-paint drops rows; only process restart reliably recovers. With block fades gone, exposure is lower, but long `await_agent` turns still repaint — verify under long streaming turns.
- **Compact threshold source.** `packages/tui-base/src/skin/semantic.ts:134` — `COMPOSER_COMPACT_TERMINAL_ROWS = 30`.

---

## Risks

- **Wheel availability / drag-select trade-off.** Mouse capture is enabled by default on the main path (`useMouse: true`, `packages/tui-base/examples/v2-entry.tsx:1687`; `packages/runtime/src/engine.ts:39`). In-app wheel scrolling (D9) therefore depends on the terminal delivering wheel events; where it does not, the `ctrl+alt+↑/↓` keyboard fallback must cover scrolling. The user-visible cost of mouse capture is text selection: **plain drag** is intercepted by the app's copy-on-select handler (`copyOnSelectRelease`, `packages/tui-base/src/util/selection.ts:41`), so native terminal drag-select/copy requires **Shift+drag**. Verify both the wheel path (`packages/tui-base/src/component/session-frame.tsx:308-316`) and the Shift+drag fallback under acceptance.
- **Keyboard attribution / collisions.** The keymap is a global subscription with no focus domain (`packages/tui-base/src/context/keymap.tsx:220`). `ctrl+alt+↑/↓` is global and can collide with existing global keys; it must be a no-op unless the lower zone overflows and no overlay is open (D9). Composer focus must not change this.
- **Double-paint of subagents.** If the `lastrequest-dock` running rows are not removed (D15), the same subagent appears in both the activity lower zone and the composer footer dock.
- **Clock stop in todo-only case.** `dockNeedsClock` returns `false` with no running agent (`packages/tui-base/src/routes/session/widgets-dock.tsx:1002-1005`), pausing the clock. Lower-zone indicators must not depend on it.
- **Frame latch / ghost border.** The 60 ms defer suppresses a one-frame `┌─activity` ghost (`packages/tui-base/src/routes/session/widgets-dock.tsx:1022`). Keep the fallback path ghost-free while rendering the lower zone through turn end (D10).
- **Motion tiers.** Decorations only in `full`; `reduced`/`off` must jump straight to final color (D3/D14). A leak of decoration into `off` is a spec violation.
- **Right-boundary drift.** Any padding computed from character count instead of `stringWidth` will misalign the right border at 80 columns, especially with emoji and VS16 in tool/title rows (D13).
- **Paint-bug exposure under long turns.** Sustained repaint can drop rows (`docs/upstream-opentui-paint-bug-draft.md`). The removed block fades lower the risk, but scrolling a long todo window during a 300 s `await_agent` still repaints frequently; verify under long streaming turns.
- **VS16 rendering exposure.** Any new label carrying U+FE0F is blanked in wcwidth mode (see the known-upstream-defect note under D4). The only two live occurrences found on the main path were the activity title wrench and the footer provider lead; both were switched to bare emoji (`🔧`, `🌐`) on 2026-11-17. A repo-wide sweep is still worthwhile before adding decorative emoji.

---

## Acceptance criteria

Verification is split into two executable paths. **Path 1** covers timing, sequences, and state-machine decisions with pure functions and an injected clock. **Path 2** covers terminal end-state with real tmux capture. Path 1 runs in `packages/tui-base/test/`, following `frame-latch-reactive.test.ts` and `widgets-dock.test.ts`.

### Path 1 — pure-function unit tests (injected clock)

- **Title composition.** Assert the full D4 table: tool+subagent → `🔧 tool · 🤖 subagent`; tool only → `🔧 tool`; subagent only → `🤖 subagent`; think only → `💭 think`; think+tool → `🔧 tool`; think+subagent → `🤖 subagent`; both empty → `🧩 activity`. Assert the tool glyph is `🔧` (U+1F527) with no U+FE0F, and the string **never contains "todo"** in any state.
- **Height allocation.** In **tool-only mode** (no todo content), with tool content of 0/1/2/5 lines, assert the tool zone is clamped to [1,3] and each line shows full D5 `subject`/`detail`. In **coexistence mode** (todo content present), assert the tool zone is exactly 1 line regardless of how many tool rows exist (only the latest is kept), and the lower zone receives the remaining lines up to the 10-line total. Assert combined visible lines ≤ 10 in both modes, and that the normal lower-zone size is 1–3 `in_progress` rows (the cap is a safety valve). Assert compact (`terminalRows ≤ 30`) takes the single-line path and renders no scroll zone.
- **Coexistence tool zone is exactly 1 line, name + time only.** In coexistence mode, assert the upper tool zone renders exactly one line matching `⚙ <tool name> · <Xs>` (leading glyph per `toolMarker`: `⚙`/`✔`/`✘`), and that the line contains **no** `subject` text, **no** parameter string, and **no** `detail`. With several tool rows present, assert only the latest row is rendered.
- **Active-only rendering.** Given a todo list mixing `in_progress`, `pending`, `completed`, and `cancelled`, assert the lower zone renders **only** the `in_progress` rows; `pending`/`completed`/`cancelled` rows are absent. Assert that with no `in_progress` todo and no running subagent the entire lower zone is not rendered, and that with no `in_progress` todo but a running subagent the agent renders flat.
- **10-line cap and indicators (concurrency safety valve).** With more than 10 **concurrent `in_progress`** todo lines, assert title `N/M` and `▼ N more` / `▲ N more` counts; assert each indicator consumes one visible line (indicator + content never exceeds 10).
- **Motion tiers.** For `full` / `reduced` / `off`, assert decoration on/off and that `off` is an immediate hard cut (no color sweep). Assert `SKIN_FADE_IN_MS` entrance fade is keyed by `line.id` first sight and does not replay on re-render.
- **Overlay guard.** Assert `ctrl+alt+↑/↓` is a no-op when an overlay is open, and a no-op when the lower zone does not overflow.
- **Attribution / ordering.** Assert every running agent hangs under the **last** `in_progress` todo (with 1, 2, or many in_progress todos, all agents go under the last; other in_progress todos get none); no-in_progress → flat agents; when the parent completes, agents re-attach to the new last in_progress todo (or go flat if none). Assert `in_progress` entries render in original plan order (no rank reshuffle); `cancelled` glyph is `⊘` (distinct from `○`) in the parser even though cancelled rows are not rendered; `TODO_MAX_ROWS` window is not used.
- **Lifecycle.** Assert the lower zone still renders after turn end with todos uncleared, independent of `activityFrameLatch`.
- **Clock-stop.** Assert todo-only with no running agent does not require the animation clock for its indicators.

### Path 2 — tmux `capture-pane` end-state assertions

> Note: the two zones are now simultaneous, so "switch stable" means the row-level transition has settled (e.g. a tool row is removed when `await_agent` completes, or todo rows change). Assert the following after each settled transition.

- **Old rows gone / new rows complete (no residue).** After a tool row is removed, assert its line is absent; after content changes, assert the full todo tree and all tool rows are present — no half-drawn or leftover rows.
- **Title string exact match.** Capture the title bar and assert it equals the expected D4 string for the current content, with the tool glyph `🔧` (U+1F527), no U+FE0F, and **no "todo"** substring.
- **Right boundary — mandatory `stringWidth` assertion.** At 80 columns, assert every rendered row's visible width **strictly equals** the container inner width (right border on column `columns - 1`), computed by the runtime `stringWidth` (emoji and CJK = 2, VS16/combining = 0, ZWJ handled as part of the sequence). The assertion must explicitly feed a row containing **emoji, CJK, VS16, and ZWJ** and verify the visible width equals the container inner width — this is a must-pass check, not a "looks aligned" visual inspection. Assert no box break.
- **Active-only rendering.** Assert only `in_progress` todo rows appear; `pending`/`completed`/`cancelled` rows are absent. Assert no lower zone at all when there is no `in_progress` todo and no running subagent.
- **10-line cap and indicators (concurrency safety valve).** With more than 10 **concurrent `in_progress`** todos, assert at most 10 visible content lines in the lower zone, with correct `N/M` and `▼ N more` / `▲ N more` counts.
- **Motion off tier.** In `off` (and `reduced`), assert no gradient/sweep decoration — an immediate color change, not a fade.
- **Compact terminal.** At `terminalRows ≤ 30`, assert the lower zone is a single line (reusing `todosSummaryLine`) and no scroll window is drawn; the upper zone keeps the 2-line rule form.
- **No duplicate subagent.** Assert a single subagent does not appear in both the activity lower zone and the composer footer dock simultaneously.
- **Overlay key guard.** With an overlay open, send `ctrl+alt+↑`/`ctrl+alt+↓` and assert the lower-zone scroll position does not change.
- **No ghost border at turn boundary.** Assert no one-frame `┌─activity` (or empty border) at turn start/end across repeated turns.
- **Last-in_progress attribution is documented, not hidden.** Confirm the UI/spec does not present the "last `in_progress` todo" rule as a guaranteed association; the misalignment scenarios in Data model reality are known and accepted.

---

## Open questions

None. Every rule is specified and confirmed — the user reviewed all previously-pending defaults with "其他我没意见" (I have no objection to the rest). No decision awaits user sign-off.

---

Design frames: /private/tmp/dsh-activity-merge-proto-v2/frames/
