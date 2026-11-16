# Ask-user panel — redesign spec

Date: 2026-11-16
Status: Decided (2026-11-16). Every decision below is settled; this document
records them, it does not propose alternatives. The keyboard-ownership
prerequisite is ADR-0008 (`docs/adr/0008-input-ownership-for-keyboard-routing.md`).

Repository terms follow `CONTEXT.md` (Tui base, Custom layer, Render surface,
Real-client gate, ft/ui/e2e). "The dock" below names the new host component
for the ask surface; it is not a new product concept.

## 1. Scope

In scope: the ask-user surface (the surface that collects answers to the
`ask_user_question` tool), its host component, content path from the wire to
the renderer, keyboard semantics, admission order against the approval card,
focus restoration, transcript replay, and the deletion of the non-live legacy
ask path.

Out of scope: the approval card's content and verdict semantics (unchanged;
only its host slot is shared, §7), the stop-confirmation dialog (unchanged,
still a vendored `Dialog`), the panel-kit `List` control (not used by this
surface), and the web product profile (referenced only as a normalization
precedent, §3).

## 2. Surface: an in-flow dock, not a panel-kit panel

**Host.** A dedicated in-flow dock component. It is **not** mounted in
panel-kit, and panel-kit stays as shipped for /settings and /agents.

panel-kit cannot express this placement (ADR-0008, "The ask surface will not
be hosted by panel-kit"):

- only `align?: "center" | "top"` exists (`panel-kit/src/contracts.ts:355`);
- `resolvePanelWidth` never yields full width — the `full` preset is
  `terminalWidth - 4` and the clamp is `terminalWidth - 2`
  (`panel-kit/src/panel.tsx:63-72`);
- the outer box is `position="absolute"` with vertical centring (or
  `paddingTop = height/4`) and a full-screen scrim
  (`panel-kit/src/panel.tsx:319-330`), so sibling layout never reflows;
- `height`/`rows` are a content cap and a fixed frame height capped at
  `terminalRows - 4` (`panel-kit/src/panel.tsx:74-89`) — not "content
  height, up to 60% of the terminal".

Extending that placement kernel would put both shipped panels into the
regression surface.

**Seat.** Bottom-docked, full width, occupying the composer seat, in the
page's normal layout flow — a sibling of the transcript in the same column,
never an absolutely-positioned layer. Today the composer sits in the bottom
slot of `Transcript` (`routes/session/transcript.tsx:459-465`) with the
scrollbox above it (`transcript.tsx:366-382`). The change lifts that slot out
to the page root column (where `Transcript`, `PowerlineFooter` and
`HintsLine` already are, `examples/v2-entry.tsx:1055`, `:1221-1236`) so the
dock and the composer swap in the same in-flow position:

- while the dock is open the composer is not mounted in that seat;
- the transcript stays visible above and **reflows** into the rows the dock
  leaves (the scrollbox is `flexGrow`; nothing is covered and no scrim is
  painted);
- on settle the composer returns with its draft intact (the draft lives in
  composer state, not in the component).

A vendored `Dialog` opened while the dock is up (the stop confirm, a model
picker) is pushed above the dock in the ownership stack (ADR-0008); the dock
keeps its state and its input text, loses keys for the dialog's lifetime and
regains them when the dialog closes.

**Height.** `min(60% of terminal height, content height)`; the dock never
takes more than 60% of the rows and never shows empty padding below the
content. When content exceeds the cap the body scrolls internally and the
footer carries an overflow indicator (same tone/glyph family as the kit
`List` indicator).

The cap is a **function of the live terminal height**, so it is reactive: a
resize during a batch re-clamps at the next layout pass and only the scroll
position is clamped (the batch, the cursor and the draft are untouched). No
key is queued or dropped by a resize. The precedent for a live-dependent
frame size is `panel-kit/src/panel.tsx:82-89` (`resolvePanelRows` reads the
terminal height), except the dock is content-sized under the cap rather than
fixed.

**Narrow terminals.** panel-kit's compact threshold is `width < 64 ||
height < 20` (`panel-kit/src/panel.tsx:57-61`); the dock adopts the same
width threshold (64 columns):

- `marker + number + label + badge` is never truncated or horizontally
  scrolled. Below 64 columns the badge drops to its own continuation line,
  indented to the label column, under the label's wrapped text. The row grows
  vertically; the description line keeps its own continuation line below it.
- The footer keeps the Esc hint and the queue indicator. When they do not
  fit, the overflow indicator collapses to a count (`↑↓ N`) and the queue
  indicator to `+N`; the Esc hint is the last thing dropped.
- Digits `1`–`9` still quick-pick; the numbers are single characters and
  never dropped.

**Zero options.** A question whose `options` is empty renders only the
resident inline input row (§5). Digits are moot (no option rows), there is
no list-focus state, and the dock opens with the input focused. Enter commits
the typed answer; Esc follows the ladder in §6 with the "return to the list"
stage removed for that question. Multi-question batches and the review page
are unaffected.

**Not the current dialog.** Today the ask batch is a centred `Dialog`
(`ui/dialog.tsx:42-46` hardcodes medium = 60 columns) opened without a
`size` (`routes/session/turn-overlays.tsx:497-503`), so a long question is cut to
60 columns. The new surface is not a `Dialog`.

**Frame.** The dock keeps the ask tone used today (`tone: "warning"`,
`turn-overlays.tsx:497-503` as passed to `dialog.replace`) so the approval and
ask surfaces stay distinguishable; row styling matches /settings
(`routes/session/settings-modal.tsx`) — same gutter, same muted description
tone, same selected-row treatment. The frame is the dock's own; no kit chrome
is reused.

**Rows.** Option rows are hand-rendered inside a `<scrollbox>`. panel-kit's
`List` is not used: `List` pages rather than scrolls
(`panel-kit/src/controls/list.tsx:349-382`, `resolveListPage` /
`nextListPage`), and it only handles keys while it is the focused renderable
(`list.tsx:663-719` on the box's `onKeyDown`, `list.tsx:719` `focusable`), so
it cannot host a resident live input row.

**Row anatomy.**

```
› 1. Option label                              [Recommended]
    Muted, wrapped, indented description continuation line.
```

- Line 1: cursor marker, number, label, optional badge — one line where it
  fits (§2 narrow terminals).
- Line 2+: the option's description, muted, indented to the label column,
  wrapped to the available width (no truncation).
- Multi-select rows carry a checkbox glyph before the number (see §4).

## 3. Content plumbing

### What the code does today

- **Question.** `packages/shell/src/client/remote-waterfall.ts:136-153`
  (`questionsView`) builds `{ id, prompt, options, multiSelect? }`. `prompt`
  is `prompt ?? question ?? header`, so `header` can silently become the
  prompt text.
- **Options.** The same function maps each option to a single string
  (`label ?? value ?? raw`). `description` is dropped.
- **Question detail.** `detail` is not carried at all: absent from
  `SeamAskQuestion` (`packages/tui-base/src/seams/session.ts:200-209`),
  absent from `RemoteQuestion`, absent from `questionsView`.
- **Header at render time.** `header` is declared on `SeamAskQuestion`
  (`seams/session.ts:200-209`) but no renderer reads it;
  `routes/session/turn-overlays.tsx` never references `.header`.
- **Transcript parser.** `packages/shell/src/features/ask-transcript.ts:78-84`
  merges the header into the question string (`${header}: ${question}`) and
  maps every option to its label only, dropping descriptions. `AskEntry`
  (`packages/shell/src/client/seam-types.ts:22-35`) has slots for
  `question`, `options: string[]`, `selected`, `custom`, `declined` only.
  There is no `header`, `description` or `detail` slot, so §3's "keep detail
  for replay" and §9's replay block would contradict each other unless the
  entry is extended — which §9 does.

### What it must do

1. `RemoteQuestion` options become structured:
   `{ label: string; description?: string }[]` (was `string[]`).
   `questionsView` passes `description` through and carries `header`,
   `description`, `detail` on the question (the `detail` field is read from
   the wire object when present).
2. `SeamAskQuestion.options` becomes the same structured shape; add
   `detail?: string`. `header` and `description` stay as declared.
3. The picked value remains the **label string** — selection, the answer
   envelope, and the transcript replay keep using labels, so the wire shape
   of answers does not change.
4. `packages/shell/src/features/ask-transcript.ts` keeps `header`, option
   descriptions and `detail` when parsing `tool/call` arguments, and stops
   merging the header into the question. It emits the extended `AskEntry`
   from §9.
5. `id` stays the correlation key between request and answer.

### Recommended-suffix normalization (normative)

The rule must not depend on an external package, so it is stated here:

- Trim the label. A trailing parenthesised token is a candidate: ASCII
  `(...)` or full-width `（...）`, after the label's last non-space
  character.
- Compare the token inside the parentheses, case-insensitively and after
  trimming spaces, against `recommended` and `推荐`.
- On a match, strip the whole token **and** the whitespace before it. The
  badge carries the label from `overlay.ask.recommended`.
- Only a trailing, fully parenthesised token matches. Free text such as
  "not recommended" or "推荐 but slow" is not stripped.
- Never produce an empty label: if stripping leaves nothing, keep the
  original text and do not render a badge.

External reference, **not** a local fact: the web profile's
`dsh-client-ui-user-questions/src/client/QuestionComposer.tsx` is the
precedent this copy came from, but that package is not part of this
repository and that file is not present on the authoring machine. The rule
above is the contract; do not cite the external file as evidence in tests or
comments.

### Rendering

- `header` renders as an eyebrow line above the question title (muted,
  small, one line). It is never concatenated into the question.
- `question.detail` renders as wrapped body text below the title, muted.
- The question text wraps fully. The current `truncate70`
  (`routes/session/turn-overlays.tsx:126-128`, used at `:258` and `:391`) and
  the 61-cell option truncation (`ui/dialog-select.tsx:978-981`) do not apply
  to this surface: the new rows are hand-rendered and wrap, and the question
  title is no longer composed through the dialog title string.

## 4. Options

- **Numbered.** Rows are numbered in display order; digits `1`–`9` are
  quick-pick (`1` = first option).
- **Recommended badge.** The trailing `(Recommended)` / `（推荐）` token is
  stripped by the §3 rule and re-rendered as a `Recommended` badge on the
  row.
- **Recommended pre-selection.** Recommended options are pre-selected in the
  draft, single- and multi-select alike. Pre-selection never submits: the
  batch still needs Enter (or a digit pick) to commit.
- **Multi-select glyphs.** Use the panel-kit `Check` glyph vocabulary, not
  the current text prefix `[x]` / `[ ]`
  (`turn-overlays.tsx:192-202` with `overlay.ask.checkedOption` /
  `overlay.ask.uncheckedOption`): `✔` for checked (success tone) and `✘` for
  unchecked (faint tone), matching `panel-kit/src/controls/check.tsx:58-69`.
  No tri-state glyph is used.
- **More than 9 options.** Digits stop applying. Arrows, PgUp/PgDn, Home/End
  keep working.
- **Zero options.** Only the inline input row exists; digits do nothing. See
  §2 and §6.

## 5. Free text — resident inline input

The last row of the list is a live, focusable input, always rendered:

```
✎ <placeholder>
```

There is no mode switch and no screen replacement: the current design swaps
the whole picker for a prompt (`turn-overlays.tsx:298-357`, deleted with
`AskCustomInputView`).

**Focus model.** The dock owns focus when it opens. The list owns focus when
there is at least one option row. The input takes focus when (a) the cursor
moves onto the last row, or (b) a non-digit printable character is typed
while the list is focused — the character is inserted and focus moves to the
input. Digits `1`–`9` are reserved for quick-pick while the list is focused
(§4); they type digits only once the input holds focus. A zero-option
question opens with the input focused.

**Keys in the input.**

- Enter commits the typed answer for the current question (then follows §6:
  submit or advance).
- Esc returns focus to the list without committing and without changing the
  draft answer. For a zero-option question there is no list to return to:
  Esc takes the next ladder stage (§6).
- All other printable characters, Backspace/Delete, and cursor movement keys
  belong to the input.

**Keymap constraints (verified; these must hold in the implementation).**

1. A keymap layer with no `target` keeps running even while an input is
   focused, and it is checked **before** the focused
   input because the keymap prepends its listener
   (`packages/tui-base/src/context/keymap.tsx:66` →
   `@opentui/keymap/src/opentui.js:69-72`; dispatch order
   `@opentui/core` `chunk-node-tpjmjvn7.js:293-330`). Keys the input must own
   are therefore released by having the dock layer's command `return false`
   — the pattern already used in `routes/session/settings-modal.tsx:840-965`
   (the panel layer stays mounted and yields per key).
2. The dock pushes an ownership frame while it is open (ADR-0008) and its
   layer is gated on that frame, not on a dialog-stack test. Page layers are
   off for the whole batch.
3. Digit quick-pick and typing digits are mutually exclusive: gate the digit
   commands off while the input holds focus, e.g.
   `enabled: () => renderer.currentFocusedRenderable !== inputEl`.
4. The panel-kit router is irrelevant here; it only routes
   `escape/enter/space/up/down/left/right` (`panel-kit/src/kit.tsx:27-35`)
   and the dock does not use it. Digits `1`–`9`, PgUp/PgDn and Home/End are
   plain bindings in the dock's own layer.
5. Space, Left and Right must be released to the input while it is focused
   (they are characters / cursor movement there). The same `return false`
   mechanism as constraint 1.
6. `ScrollBoxRenderable` has no focus-follow. Scroll the focused row into
   view explicitly: give rows stable ids and call
   `scrollChildIntoView(<rowId>, { align: "nearest" })`, and/or re-run on
   `afterLayout`. Working reference: `routes/session/search-overlay.tsx:190-206`
   (sticky suspended, stable `seam-row-<key>` ids,
   `scrollChildIntoView(id, { align: "start" })`). Do **not** copy
   `component/dialog-integration.tsx:1004-1010`: it calls
   `scrollChildIntoView(row.id)` on a row renderable whose rows never receive
   an `id` prop, so the argument is `undefined` and the call is a guarded
   no-op — it proves nothing about focus-follow and would leave the dock
   scrolling nowhere.

## 6. Interaction semantics

| State | Key | Result |
| --- | --- | --- |
| Single-select, one question | Enter or digit | Submit the batch immediately |
| Single-select, several questions | Enter or digit | Select and advance to the next question |
| Multi-select | Space | Toggle the highlighted option |
| Multi-select | Enter | Confirm that question and advance |
| Inline input focused | Enter | Commit that answer (then submit or advance) |
| Inline input focused | digits | Type digits |
| Anywhere | `left` / `right` | Previous / next question (multi-question batches only) |

**Esc — always a staged back-out.** One key, one meaning per state, never an
immediate decline from inside the stack. The ladder is monotonic (no cycle):

1. inline input focused → return focus to the list (no commit); for a
   zero-option question, continue to stage 2 directly;
2. list focused on question *i* > 1 → previous question;
3. list focused on question 1 (or a zero-option question 1) → **decline the
   whole batch and close the dock** — this is the outermost level;
4. review page → the last question (editing). The review page is forward of
   the questions, not an outermost level, so it never declines.

The original draft routed "first question → review page" and "review → last
question", which is a cycle with no reachable decline; the ladder above is
the corrected form.

A persistent footer hint always states what Esc does right now
(`esc: back to options`, `esc: previous question`, `esc: review`,
`esc: decline`). The hint is part of the footer line, next to the overflow
indicator. The review-page hint (`overlay.ask.esc.review`) reads
`esc: back to question`.

**Ctrl+C — the same ladder, one extra step at the outermost level.** Ctrl+C
walks the same back-out stages. At the outermost level the **first** Ctrl+C
declines the batch and closes the dock. **Inside the dock, Ctrl+C never
interrupts the turn and never arms the quit chain** — not at any stage, not
at the outermost one. A **second** Ctrl+C, now on the page, is what
interrupts the turn:

- the dock's Ctrl+C resolves the same decline envelope as Esc stage 3 and
  closes; the turn keeps running;
- the page-level Ctrl+C (the turn is still busy) calls `interrupt` through a
  **non-arming interrupt path**: it must not press or arm the quit gate.

**Hazard this pin closes.** `turn-cancel.tsx:134-147` currently does both in
one command: `ctrlC()` checks the quit gate, then `if (props.busy())
props.interrupt()`, then `arm("ctrl-c", …)` unconditionally. A naive reading
of "first press declines, second press interrupts" would let that second
press arm the quit chain, and a third press inside the 500 ms window
(`CTRL_C_QUIT_WINDOW_MS`, `turn-cancel.tsx:39-41`) would call `props.quit()`
and exit the application from a key sequence the user read as "dismiss the
panel, stop the turn". Required shape:

```ts
// page-level Ctrl+C, turn busy: interrupt, do not touch the gate
if (props.busy()) {
  props.interrupt()
  return true // no gate.press(), no arm()
}
// turn idle: the existing double-press quit gate
if (gate.press() === "quit") { disarm(); props.quit(); return true }
arm("ctrl-c", () => gate.reset())
```

The quit chain therefore arms **only on an idle page**, where there is no
turn to interrupt. Acceptance test: three consecutive Ctrl+C presses with a
busy turn and an open dock end at "turn interrupted, app still running".

**Acknowledged divergence.** `turn-cancel.tsx:1-33` documents the shipped
convention "ctrl+c (1st) interrupts **and** arms quit; ctrl+c (2nd) quits".
This spec intentionally diverges: the press that interrupts no longer arms.
The reason is the hazard above — a dock decline must not be one press away
from quitting the application — and the cost is that quitting now requires
two presses from an idle page instead of one press from a busy turn followed
by one more. The divergence is deliberate and must be documented in
`turn-cancel.tsx` when the code changes.

**Decline envelope unchanged.** A decline (Esc stage 3, or the dock's Ctrl+C)
resolves the existing envelope `{ id, selected: [], custom: "declined" }`.
The controller resolves `[]` (`routes/session/turn-overlay-controller.ts:339-344`);
the waterfall builds the per-question envelopes
(`packages/shell/src/client/remote-waterfall.ts:199-222` — `answersValue`,
with `declinedValue` used by `remote-host-session.ts:2716-2740` on a provider
error). No protocol change. The answers typed before the decline are
discarded — that is the user-visible defect this staged ladder exists to
prevent users from hitting by accident: it now takes one Esc per stage plus
one deliberate decline, with the footer saying so.

## 7. Admission order: approval and ask never coexist

One interaction slot; first-come-first-served; the next pending interaction
opens automatically when the current one settles.

- **One slot, one host.** The dock is the single in-flow interaction slot.
  The approval card keeps its component and verdict semantics
  (`ApprovalCard`, `routes/session/turn-overlays.tsx:42-66`;
  `confirmApproval` / `rejectApproval`); only its host moves from the
  vendored centered `Dialog` into this slot. The ask and approval surfaces
  are never visible at the same time.
- **First-come-first-served.** The controller already assigns one monotonic
  id from a single counter to both kinds (`#seq`,
  `turn-overlay-controller.ts:66`, incremented for approvals at `:98` and for
  asks at `:145-146`). Both per-kind queues are FIFO, so the two heads are
  the oldest of each kind; the slot shows whichever head has the **smaller
  id**. The dock owns the slot decision; the controller keeps both queues.
- **Why the slot must own it, not `pendingAsk`.** `pendingAsk` is set the
  moment the ask *request* arrives, even while an approval is showing
  (`answer()` pushes into `#asks` at `:145-146`; the current display effect
  prefers the approval at `turn-overlays.tsx:463-483`). So
  `pendingAsk !== undefined` cannot mean "the ask is on screen", and a dock
  keyed on `pendingAsk` would open underneath a pending approval. The dock
  reads both heads and the shared id.
- **Queue indicator.** When a second interaction is pending behind the shown
  one, the footer shows `还有 N 个待回答` (en: `N more waiting`), where N is
  the count of pending interactions with an id greater than the shown one
  (approvals plus asks). The copy is an i18n key (`overlay.ask.queued`), not
  a hard-coded string; N is a count argument. The indicator also appears
  when the shown interaction is an approval.
- **Hand-off.** On settlement the dock swaps its content to the next head in
  the same mounted slot — no dock unmount/remount between interactions, so
  the ownership frame and keymap layers do not churn (the churn defect is
  documented at `turn-overlays.tsx:447-453`).
- **Retired mechanism.** The `TurnOverlayHost` `dialog.replace` effect is
  deleted (`turn-overlays.tsx:461-505`), including its trailing
  `dialog.clear()` — with approval and ask gone from the dialog stack that
  call would close whatever dialog the page itself opened. The stop-confirm
  dialog and other vendored dialogs stay on the dialog stack and take
  keyboard ownership through ADR-0008 like any other frame.

## 8. Multi-question flow

**Tab strip.** A top strip of index plus per-question status: `[1 ✓] · 2 · 3`
— brackets on the focused tab, `✓` on an answered one. This is the current
`askTabStrip` (`turn-overlays.tsx:94-109`) normalized: the `(i/n)` title
prefix (`askProgressTitle`, `turn-overlays.tsx:116-119`, composed at `:258`)
is discarded, the strip alone carries progress.

**Review page.** Trigger unchanged: at least two questions, or any
multi-select (`askNeedsReview`, `turn-overlays.tsx:121-124`). The questions
phase keeps its trailing explicit review row (`⏎ Review answers`,
`askQuestionRows` at `turn-overlays.tsx:192-202`), so the page is reachable
before every question is answered.

- Review rows are selectable and show question + current answer.
- Enter on a row jumps back to that question for editing.
- A single Submit row at the bottom submits the whole batch.

**Left/right** keep moving between questions where they already do
(`turn-overlays.tsx:247-248`), including from the review page's question
rows.

## 9. Transcript replay

After settlement the exchange renders as a **structured block**, not a
flattened line:

```
✓ Which database should the migration target?
  → postgres

✓ Should we keep the legacy tables?
  → no
```

`✓ <question>` is muted; `  → <answer>` is accent; one pair per question,
naturally multi-line. A question with a `header` renders it as a muted
eyebrow above the question line; a question with `detail` renders it as a
muted continuation line below the question, matching §3. A declined question
renders `  → declined`. The offered options are carried in the entry but not
repeated in the block: the settled transcript shows what was asked and what
was answered, not the menu.

**Why it is flat today (verified).**

- The v2 seam row union has no `ask` kind
  (`packages/tui-base/src/routes/session/seam-rows.ts:70-143`).
- `toStoredRow` collapses anything that is not `user`/`tool` into an
  `assistant` row (`seam-rows.ts:145-146`) — the flattening is in that
  function, not in `fromStoredRow`.
- `packages/shell/src/client/session-seam-adapter.ts:208-222` therefore
  pre-flattens an ask row into `question → pick` text before it reaches the
  view.
- The parser does not preserve the fields the block needs:
  `ask-transcript.ts:78-84` merges the header into the question and maps
  options to labels only (§3), and `AskEntry` has no header/detail slots
  (`seam-types.ts:22-35`).

**The change.**

- Extend `AskEntry` (`packages/shell/src/client/seam-types.ts:22-35`):

  ```ts
  export interface AskEntry {
    question: string
    header?: string
    detail?: string
    options: { label: string; description?: string }[]
    selected: string[]
    custom?: string
    declined: boolean
  }
  ```

  `selected` stays label strings, so the answer envelope is untouched.
  Entries built from the wire (the parser) and entries built from the durable
  transcript (`session-seam-adapter.ts`) must both produce this shape; the
  adapter maps its stored rows into it instead of flattening to text.
- Add an `ask` variant to the `SeamRow` union carrying `entries: AskEntry[]`;
  stop flattening in `session-seam-adapter.ts`; pass the entries through.
- Render the block from those entries. The parser that pairs `tool/call` with
  `tool/result` already exists (`packages/shell/src/features/ask-transcript.ts`,
  `parseAskCallArgs` / the answers merge); it supplies question text, header
  and detail on resume/fork.
- `toStoredRow` must project the stored `ask` kind into the new variant
  instead of falling through to `assistant` (`seam-rows.ts:145-146`).

## 10. Focus restoration

Focus restoration after submit or decline is **explicit**, not a race
between timers.

- On settlement, the dock closes its slot and then refocuses the composer
  through the page's existing composer ref (`examples/v2-entry.tsx:1130`)
  **after layout** (run the refocus in the same layout pass the dock's
  removal triggers, e.g. an `afterLayout` callback; a `setTimeout` is not a
  layout guarantee).
- Exactly one owner per transition. The dock is a page component, not a
  dialog and not a kit layer, so three existing mechanisms must not fire for
  it:
  - the vendored dialog's refocus after close
    (`packages/tui-base/src/ui/dialog.tsx:362-378`, a 1 ms timer);
  - `TurnOverlayHost.onIdle`'s reclaim
    (`turn-overlays.tsx:443-445`, a 3 ms timer that checks at 3 ms to beat
    the dialog's 1 ms);
  - panel-kit's microtask `baseFocus` restore
    (`packages/panel-kit/src/stack.tsx:119-146`, `closeAll` `:207-218`).
  The dock does not push a dialog entry or a kit layer, so none of the three
  should run; the implementation must assert that (a test that spies on the
  composer's `focus()` sees exactly one call per settlement).
- If the next queued interaction (§7) takes the slot, do **not** refocus the
  composer: the slot immediately owns focus. Refocus only when the queue
  drains and the dock actually unmounts.
- On open, focus goes into the dock (list, or the input for a zero-option
  question) in the same way; the composer is not mounted in the seat, so
  there is no competing autofocus.

## 11. Legacy path removal

One non-live path is deleted; one path the earlier draft listed is **not**,
because verification showed it is live.

1. The `Question` tool renderer, `routes/session/index.tsx:3694-3726`, and
   its private helpers `parseQuestions` / `parseQuestionAnswers`
   (`routes/session/index.tsx:3832-3846`). The helpers are referenced only by
   that renderer.

**Not deleted: `routes/session/form.tsx`.** It is not dead:
`packages/tui-base/src/routes/home.tsx:11` imports `FormPrompt` and renders
it for global MCP elicitations (`home.tsx:38` lists pending forms,
`:109-116` renders the first one), and `FORM_MODE` (`form.tsx:39`) is the
generic form mode, not an ask mode. The file can only leave the tree
together with the vendored `app.tsx` / `home.tsx` reference routes — a
separate cleanup, not this change set. `routes/session/index.tsx:100`'s
`./form` import and its render branch at `:1661` therefore stay as well.

**What was verified as dead, and how.** Read-only greps over the tree
(`grep -rn`, excluding `node_modules`):

- The shipped client path is `packages/shell/src/client-entry.tsx:346` →
  `packages/tui-base/examples/v2-entry.tsx`. `v2-entry.tsx` imports neither
  `routes/session/index` nor `./form`
  (`grep -n "routes/session/index\|session/form\|FormPrompt"
  packages/tui-base/examples/v2-entry.tsx` → no matches).
- Nothing imports `routes/session/index` at all: the only occurrences of that
  path in `packages/` are comments (`routes/session/transcript.tsx:4`,
  `routes/session/transcript-scroll.tsx:4,82`,
  `routes/session/agents-panel.tsx:84`,
  `packages/shell/test/key-routing-ft.test.tsx:365`,
  `packages/i18n/src/scan.ts:87`).
- `./form` has exactly two importers: `routes/session/index.tsx:100` and
  `routes/home.tsx:11` (this second one is why the file stays). `FORM_MODE`
  is referenced only inside `form.tsx` (`:39,68,538,541,558,650`).
- `parseQuestions` / `parseQuestionAnswers` are referenced only inside
  `routes/session/index.tsx` (`:3696-3697` call sites, `:3832-3846`
  definitions).
- No test imports `routes/session/index`, `FormPrompt` or `FORM_MODE`:
  `grep -rn "session/form\|session/index\|FormPrompt\|FORM_MODE"
  packages/*/test e2e` returns only the comment in
  `packages/shell/test/key-routing-ft.test.tsx:365`.

`routes/session/index.tsx` itself stays in the tree (it is the vendored
reference route; a whole-file deletion is a separate cleanup, not part of
this change set). Only the ask-related block is removed.

## 12. Delivery

- **One change set.** Dock, plumbing, ownership gate, admission slot,
  transcript block, focus restoration, deletions, tests, and the release bump
  land together. No phased rollout: a half-migrated keyboard gate is the
  defect this design exists to remove.
- **Real-machine tmux frame verification is mandatory** before the release:
  boot the real client, drive an ask batch through tmux, capture the frame
  and check the in-flow seat, transcript reflow, the 60% cap, the overflow
  indicator, the eyebrow/detail/description lines, the Recommended badge, the
  digit pick, the inline input, the zero-option question, a batch with a
  pending approval behind it (queue indicator), a resize mid-batch, the
  review page, and the transcript block after settlement. This is the
  `Real-client gate` lane in `CONTEXT.md` terms, not a frame assertion in a
  mock.
- **New regression cases.**
  - Ownership leak, ft tier: with a panel-kit panel open on a busy turn, Esc
    backs out of the panel and does not interrupt the turn; the stop
    confirm's Esc closes the dialog and leaves the panel open; PgUp/PgDn do
    not scroll the transcript. With no overlay open both keep today's
    behavior. These are the ADR-0008 cases and they must fail against the
    current tree.
  - Dock ownership, ft tier: while the dock is open, no page cancel/scroll
    layer fires for Esc, Ctrl+C, PgUp/PgDn or F6; the dock's own Esc ladder
    advances one stage per press and declines only at stage 3.
  - Ctrl+C, ft tier: dock Ctrl+C declines and keeps the turn; the next page
    Ctrl+C interrupts without arming quit; a third press does not quit
    (§6 hazard).
  - Admission, ft tier: ask request arriving during an approval queues with
    the indicator and opens on approval settlement, and the reverse order
    behaves symmetrically (FCFS by id).
  - Focus, ft tier: exactly one composer `focus()` call per settlement, after
    layout; none while a queued interaction takes the slot.
  - Rendering, ft tier: in-flow placement and full width; transcript reflow;
    the 60% cap; resize re-clamp; the overflow indicator; header/detail/
    description present; full-wrap question text (no `…`); Recommended badge
    with the suffix stripped (both width forms); the negative normalization
    cases ("not recommended", an all-suffix label); pre-selection without
    auto-submit; multi-select glyphs; `1`–`9` quick-pick and its absence
    beyond nine options; the zero-option question; the resident input row;
    narrow-terminal badge drop and footer collapse; the review page's
    edit-and-return; the transcript ask block after settlement.
  - Canary: the dock's own keymap layer is the one that resolves Esc while a
    page-level `global` layer exists and is busy (guards the gate itself, not
    the happy path).
- **Release. `0.18.0`.** `packages/shell` carries the released version and
  already ships `0.17.3` (`packages/shell/package.json:3`, `CHANGELOG.md:8`),
  so the next minor is `0.18.0` — not `0.17.0`, which is behind `main`.
  `CHANGELOG.md` gains a `## [0.18.0]` section following the existing
  Keep-a-Changelog shape.

## 13. i18n

New keys (English source, `packages/i18n/locales/en.json`; zh-CN mirrors):

- `overlay.ask.recommended` — the badge label (`Recommended` / `推荐`).
- `overlay.ask.inputPlaceholder` — the resident input placeholder.
- Esc-hint variants: `overlay.ask.esc.back`, `.esc.prevQuestion`,
  `.esc.review`, `.esc.decline`.
- `overlay.ask.overflow` — the overflow indicator line.
- `overlay.ask.queued` — the queue indicator (`{count}` arguments; en
  `{count} more waiting`, zh `还有 {count} 个待回答`).
- `overlay.ask.ctrlC.hint` — the outermost Ctrl+C hint (Ctrl+C declines
  here; the next Ctrl+C, on the page, stops the turn).

Retired keys and their fates:

- `overlay.ask.checkedOption`, `overlay.ask.uncheckedOption` — replaced by
  the glyphs (§4).
- `overlay.ask.questionProgress` and the `{title}: {prompt}` composition
  (`overlay.ask.title`) — replaced by the eyebrow/title/detail stack (§3).
- `overlay.ask.question` — retired **for this surface**. It was the generic
  single-question title (`turn-overlays.tsx:117`); the eyebrow now carries
  `header` and the title line is the prompt, so no generic label remains.
  (The approval surface never used it.)
- `overlay.ask.sentinelLabel` / `overlay.ask.customMark` — replaced by the
  resident input row; the committed answer is the input's value, with no
  separate `✎ <text>` mark.
- `overlay.ask.customTitle` and `overlay.ask.customBackToOptions` — die with
  `AskCustomInputView` (used at `turn-overlays.tsx:310`, `:325`, `:328`).
- `overlay.ask.reviewRow` — kept: the questions phase still offers the
  explicit review row (`askQuestionRows`, `turn-overlays.tsx:192-202`).

The leak-guard baseline (`packages/i18n/test/leak-guard-baseline.json`) is
updated in the same commit.

## 14. Risks and their disposition

- **Key release to the inline input.** The input only receives keys because
  the dock's layer releases them (`return false`, §5 constraint 1). If the
  layer is ever rewritten to consume Enter/Space unconditionally, the input
  becomes read-only in practice. Disposition: the canary case in §12 plus the
  ft input cases.
- **Ownership frame leak.** A dock that fails to pop its frame leaves every
  page layer dead. Disposition: frame push/pop in the same open/close call,
  plus the stack-accounting test (ADR-0008 verification case 5).
- **Approval moved into the slot.** The approval card's host changes even
  though its content does not; a regression in its verdict keys would now
  depend on the dock layer. Disposition: keep the approval's key handling in
  the card (unchanged) and add an ft case for allow/reject from the slot.
- **Description length.** Descriptions wrap; a hostile long description can
  push the dock to the 60% cap on a single option. Disposition: the cap and
  the internal scroll are the guard; no truncation is reintroduced.
- **Narrow terminal.** Below 64 columns the badge and footer degrade as
  specified in §2; the label still wraps and nothing is truncated.
  Disposition: an ft frame case at 50 columns.
- **Review-page return path.** Enter on a review row must restore that
  question's draft (picks, customs, inline text) exactly. The controller
  already keeps per-question `picks` / `customs`
  (`turn-overlay-controller.ts:48-55`); the surface reads them, it does not
  duplicate them.
