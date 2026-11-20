# ADR-0008: One input-ownership stack for keyboard routing

Date: 2026-11-16
Status: Accepted (2026-11-16)

## Context

### The two key lanes

Key input enters the renderer at `renderer.keyInput` and splits into two
lanes:

- **The keymap lane.** `packages/tui-base/src/context/keymap.tsx:66`
  creates the default OpenTUI keymap on the renderer. It subscribes with
  `prependListener` (`@opentui/keymap/src/opentui.js:69-72`), so keymap
  handling runs before any listener registered afterwards — including the
  focused input's own handler.
- **The raw `useKeyboard` lane** (`@opentui/solid`). Ordinary listeners with
  no priority, no layer, and no way to declare that another consumer is on
  top.

### Dispatch order

`@opentui/core` `InternalKeyHandler.emitWithPriority`
(`chunk-node-tpjmjvn7.js:293-330`): every global listener runs in
registration order, then the focused renderable's `onKeyDown`. A keymap
binding that handles a key calls `preventDefault()` + `stopPropagation()`,
which ends the walk for that key; a command that returns `false` falls
through to the next consumer.

Layer selection (`@opentui/keymap/chunks/index-0a7ve4a3.js:151-154`): after
the interceptor and mode filters, layers sort by `priority` descending, then
by registration order descending — the newer layer wins a tie. `priority`
defaults to 0 when a layer does not declare one. Mode is a single
`opencode.mode` datum (`keymap.tsx:41`, `keymap.tsx:476-478`), so a layer
either matches the current mode or it does not; modes cannot express a
nested stack.

### The defect: `mode:"global"` means "in every mode"

```ts
// packages/tui-base/src/context/keymap.tsx:220
...(mode === "global" ? {} : { mode: mode ?? MODE.base }),
```

A layer declared `mode: "global"` is registered with **no mode predicate at
all**. "global" was meant to mean "no mode of its own"; it in fact means
"matches in every mode, modal included". Since `priority` is a per-layer
constant and the tie-break is registration order, a page-level global layer
registered by the session page wins over any overlay layer registered by a
provider that mounted earlier: both sit at priority 0, and page layers are
created after `DialogProvider` (`examples/v2-entry.tsx:1475`) and
`PanelKitHost` (`examples/v2-entry.tsx:1484`) because they live in
`V2SessionPage`, their child.

### The reachable broken sequence

The tie is not theoretical. With /agents open, a turn busy and the stop arm
in flight:

1. Esc #1 arms the stop (`turn-cancel.tsx:115-131`).
2. Esc #2 opens the stop **dialog** (`turn-cancel.tsx:122-132` →
   `confirmStopAll` → `dialog.replace`, `examples/v2-entry.tsx:355-390`).
3. Esc #3 should close that dialog. Both modal layers are now enabled: the
   dialog provider's (`ui/dialog.tsx:380-398`, priority 0, registered at
   `v2-entry.tsx:1475`) and the kit's single layer
   (`panel-kit/src/kit.tsx:71-84`, priority 0, registered at
   `v2-entry.tsx:1484`). They tie on priority 0 and the kit layer is newer,
   so it wins — **regardless of which surface is visually on top**. It
   routes Esc into the panel's Esc ladder (`panel.tsx:197-205` →
   `requestClose`), so /agents closes underneath while the stop dialog
   stays open.

The same tie is why Esc/PgUp/PgDn under a panel reach the page today. The
decision below removes the tie instead of re-numbering it.

One correction to the earlier framing: in the shipped configuration Esc
under a busy turn does **not** interrupt immediately. `v2-entry.tsx:1194-1213`
passes `confirmStop`, so Esc #1 arms and Esc #2 opens the stop dialog; only
the legacy path without `confirmStop` (`turn-cancel.tsx:117-121`) interrupts
directly. The leak under a panel is therefore "Esc is consumed by the page
(arming, then a dialog)" rather than "one Esc kills the turn".

### Corrected bug status (installed 0.17.3 == `origin/main` @ ff31d6f)

| symptom | ask picker (shipped) | /settings, /agents (panel-kit) |
|---|---|---|
| Esc reaches page / arms stop | ABSENT — the dialog-stack gate `v2-entry.tsx:1209` is present; the gate was added with the layer itself (92ffd82) | PRESENT — the kit never enters `dialog.stack` (it keeps its own layer list and `top`: `panel-kit/src/stack.tsx:68`, `:260-264`), so the page layer (`mode:"global"`, `context/keymap.tsx:220`, priority 0) stays armed; later registration wins the tie |
| PgUp/PgDn scroll transcript | ABSENT — same gate, `v2-entry.tsx:1172` | PARTIAL — the two panel layers only intercept when that panel is top AND the list overflows (`settings-modal.tsx:953-973`, `agents-panel.tsx:992-1005`) |
| focus transferred into the surface | ABSENT — the picker has no autofocus input | ABSENT — `panel-kit/src/stack.tsx:185-187` blurs only |

The shipped ask surface therefore does **not** leak Esc or PgUp/PgDn: it is
rendered through the dialog stack (`routes/session/turn-overlays.tsx:497-503`),
so the `dialog.stack.length === 0` gates are closed while it is up.

### The ask-panel complaint is about semantics, not routing

The user's actual complaint about the shipped ask panel: **Esc anywhere
declines the whole batch, silently**. `turn-overlay-controller.ts:339-344`
resolves the batch with `[]`; `remote-waterfall.ts:199-222` turns that into
`{ selected: [], custom: "declined" }` per question, and
`remote-host-session.ts:2716-2740` answers the host with it, so the agent
continues on `declined` while every answer typed so far is lost. No key
hint states that Esc means "throw the batch away". That is what the staged
back-out in `docs/ask-user-panel-spec.md` §6 fixes; routing is a separate
defect.

### The ask surface will not be hosted by panel-kit

The redesign does **not** mount the ask surface in panel-kit. It is a
dedicated in-flow dock component at the composer seat (spec §2). panel-kit
cannot express that placement, and changing it to try would put both
shipped panels into the regression surface:

- `packages/panel-kit/src/contracts.ts:355` offers only
  `align?: "center" | "top"`.
- `packages/panel-kit/src/panel.tsx:63-72` (`resolvePanelWidth`) never
  yields full width: the `full` preset is `terminalWidth - 4` and the clamp
  is `terminalWidth - 2`.
- `packages/panel-kit/src/panel.tsx:319-330` makes the outer box
  `position="absolute"` with `justifyContent: "center"` (or
  `paddingTop = height/4` for `align:"top"`) and a scrim over the whole
  screen; sibling layout never reflows, so the transcript cannot shrink into
  the remaining space.
- `packages/panel-kit/src/panel.tsx:74-89`: `height` is a content cap and
  `rows` a fixed frame; the cap is `terminalRows - 4`. None of them is
  "content height, exactly as tall as the content, up to 60%".

Consequently the ask surface leaves the dialog stack entirely. The mask
that hides the ownership hole for ask is gone from day one of the redesign,
so the ownership fix has to land with it, not after.

### Alternatives considered

**(a) Give every modal layer a higher priority number.** Rejected: priority
is a per-layer constant fixed at registration. It cannot express "whatever
is on top right now". Determinism also disappears: two overlays that are
both "priority 10" fall back to registration order, which does not track
stack depth. The stop-dialog-over-/agents sequence above is exactly that
case.

**(b) Make `mode:"modal"` a hard filter for global layers.** Rejected: it
breaks keys that must work in every mode (quit), and it still cannot express
nested stacks — modes are a single datum, not a stack. The stop dialog
opened over a panel is a stack.

**(c) Per-panel shims.** Rejected: cost grows with panel count, and the two
existing panel layers are **not** shims to imitate (see Decision 6).

**(d) Chosen: one input-ownership stack.** An ordered stack of ownership
frames, pushed innermost-last, whose top frame is the only surface allowed
to receive keys.

## Decision

1. **Ownership is a stack, not an enum.** Frames are pushed as surfaces
   open, innermost last; the **top frame wins**. The page frame is the
   bottom frame and is never popped.
   - Page-level `mode:"global"` layers gate on `top() === "page"`.
   - Every overlay layer gates on `top() === self`.
   - No surface compares priorities or registration order to decide
     ownership. With both gates live, at most one layer is enabled, so the
     priority-0 tie that breaks Esc-over-/agents cannot be observed.
   - The identity compared is a frame token (an object/symbol returned by
     `push`), not a kind string: two dialogs stacked on each other, or a
     confirm panel pushed over /settings, are distinct frames.
2. **The dialog provider pushes one frame per `dialog.stack` entry.** Its
   modal layer becomes
   `enabled: () => store.stack.length > 0 && owns(topFrame(store.stack))`
   (`ui/dialog.tsx:342`, `:380-398`). Nothing else about the dialog lane
   changes.
3. **panel-kit pushes one frame per `layers()` entry** and its single modal
   layer gates on `owns(panelTopFrame)`. panel-kit must stay independent of
   `tui-base` (it is consumed through structural bridges today:
   `PanelKeymapHost`, `kit.tsx:48-60`), so the stack arrives as one more
   structural bridge on `PanelKitHost` — `push()/pop(token)/owns(token)` —
   wired by the host at `v2-entry.tsx:1484`. panel-kit keeps its own
   `layers()`; the ownership frames mirror it.
4. **The ask dock pushes a `dock` frame while open.** Its own layer is an
   overlay layer gated on `owns(dockFrame)`; page layers are therefore off
   for the whole batch, not just while an overlay happens to be on the
   dialog stack.
   - **Normative rule for every in-flow surface: never push its ownership
     frame above an absolutely-positioned overlay.** Dialogs and panel-kit
     panels are `position="absolute"` (`ui/dialog.tsx:87`,
     `panel-kit/src/panel.tsx:320`), so they remain visually on top after an
     in-flow surface pushes. If the dock admitted while a dialog or panel
     was open, `dock` would become the top frame and the dock's Esc ladder
     would consume a key aimed at the overlay — silently declining the ask
     batch. A review found exactly that window in the first cut of the
     admission effect.
   - Therefore **admission waits for page ownership and re-evaluates
     reactively**: a new ask opens only while the top frame is the page
     frame, and the admission effect re-runs on `top()` changes so a queued
     ask admits as soon as the overlay closes. The gate lives in admission,
     not in `dock.open`'s frame push: the frame is pushed in the same call
     that enqueues the admitted request (`dock-host.tsx:250-257`), and
     `turn-overlays.tsx:163-169` reads the page-ownership predicate before
     calling it.
5. **The ask surface is not a panel-kit panel** (reasons above). It is an
   in-flow dock at the composer seat (spec §2). panel-kit stays as-is for
   /settings and /agents.
6. **Keep both panel paging layers; do not delete them.** They are the
   panels' own paging functionality, not leak shims:
   - the kit router carries only
     `escape/enter/space/up/down/left/right` (`kit.tsx:27-35`), so
     PgUp/PgDn/Home/End have no other home;
   - `agents-panel.tsx:1005-1063` is one layer that also carries the
     `m/t/d/v/l` hotkeys and the editors' Return commit
     (`agents-panel.tsx:1059-1062` are four of its bindings, not a layer);
   - `settings-modal.tsx:992-1002` is the settings list's pager.

   Once page layers are ownership-gated, the priority-2 competition that
   these layers were written against no longer exists: the layers stay, and
   their `priority` can be reconsidered (or dropped) as a separate cleanup.
   They are not part of this change.
7. **Focus is explicit, not a microtask race.** panel-kit already restores
   focus on close (`stack.tsx:119-146` via `queueMicrotask`; `closeAll`
   `:238-251`); what it does **not** do is focus into the panel on open —
   `stack.tsx:211-213` blurs the previously focused renderable and nothing
   calls `focus()`. The panel also never becomes the focused renderable
   (`panel.tsx:331-342` is not `focusable`). The ask dock is not a dialog
   entry and not a kit layer, but `TurnOverlayHost.onIdle`'s 3 ms reclaim
   still runs on every drain, ask drains included
   (`turn-overlays.tsx:132-134`). It is safe because both that reclaim and
   the dock's post-layout `bindComposerFocus` are guarded by
   `!composerRef.focused()` (`v2-entry.tsx:291-293`, `:890-892`): exactly
   one effective `focus()` call lands per settlement, and the second path is
   a no-op rather than suppressed (spec §10). A test pins one call
   (`dock-host.test.tsx:298-331`).
8. **`TurnCancelKeys` keeps one instance and one layer,** gated on
   `top() === "page"` for both Esc and Ctrl+C. There is no second
   always-on quit layer: while any overlay frame (including the dock) is on
   top, Ctrl+C belongs to that overlay and quit is unreachable. The arm
   state stays inside one `createTurnCancel` (`turn-cancel.tsx:135-199`), so
   the double-press windows are unchanged. On a busy turn, the press
   immediately after a dock Ctrl+C decline must not arm the quit gate: it
   consumes a one-shot non-arming interrupt (`turn-cancel.tsx:69-85`,
   `:183-188`). An ordinary page-level Ctrl+C on a busy turn still presses
   the gate and arms, exactly as in 0.17.3
   (`turn-cancel.tsx:189-196`); the invariant is that three
   consecutive presses never quit inside the window (spec §6).

### Proposed shape

Naming and placement, deliberately not an implementation:

```ts
// packages/tui-base/src/context/input-ownership.tsx (sketch)
export type OwnerKind = "page" | "dock" | "dialog" | "panel"

export interface OwnerFrame {
  readonly id: symbol
  readonly kind: OwnerKind
}

export function InputOwnershipProvider(props: ParentProps): JSX.Element

export function useInputOwnership(): {
  /** Never undefined; the page frame is the bottom frame. */
  readonly top: Accessor<OwnerFrame>
  push(kind: OwnerKind): OwnerFrame
  pop(frame: OwnerFrame): void
  /** Top-frame identity check — the ONLY ownership predicate. */
  owns(frame: OwnerFrame): boolean
}
```

- One accessor (`top`) plus one predicate (`owns`). Layers read them inside
  their existing `enabled:` callbacks, so no layer construction changes.
- The page frame is created by the provider and published as
  `pageFrame()`; page layers write `enabled: () => owns(pageFrame())`.
- Overlay layers keep their own reason to be enabled (stack non-empty,
  `active() !== undefined`) **and** add `owns(myFrame)`. The conjunction is
  the whole fix.
- Frame lifecycle mirrors the surface that owns it: push in the same call
  that pushes the dialog/panel/dock entry, pop in the same call that removes
  it. `closeAll` pops every frame it owns.
- panel-kit receives the same three operations through a structural bridge
  so the package keeps its zero-dependency-on-tui-base property.

## Consequences

Positive:

- "Which surface owns the keyboard right now" has one answer, and it is the
  stack order — the same order the user sees.
- The priority-0 tie stops being observable: Esc #3 in the sequence above
  reaches the stop dialog, not the panel underneath.
- The two panel paging layers stay as shipped panels' functionality; the
  competition they were written against is gone, so they no longer need
  priority 2.
- The ask dock cannot leak page keys at any point of its lifecycle,
  including while it is animating open (its frame is pushed before its first
  paint).
- Focus becomes meaningful for the ask surface because restoration is an
  explicit refocus after layout, not a timer race with two competitors.

Negative / cost:

- Every page-level `mode:"global"` layer must migrate to the ownership gate;
  a layer left on `dialog.stack.length === 0` keeps its old leak. The set
  must be enumerated and pinned by tests. Initial set:
  `TranscriptScrollKeys`, `PaneFocusKeys`, `TurnCancelKeys`, and the shell
  page's other always-on key layers.
- The panel-kit frame bridge (and any future out-of-tree host) must push/pop
  in lockstep with its own stack; a missed pop leaves the keyboard stuck.
  Mitigation: the frame is owned by the stack entry and popped in the same
  function that removes the entry, plus stack-depth assertions in tests.
  The dialog provider and the dock live in `tui-base` and use the context
  directly, so they carry no bridge.
- Quit is unreachable while any overlay is open, including the ask dock.
  This is intended: the dock's Ctrl+C ladder ends at "decline and close", so
  a user backs out first and then quits on the page.
- The `PaneFocusKeys` leak surface is wider than PgUp/PgDn and is *not*
  priority-0. Both its layers are `priority: 1` (`pane-focus.tsx:174-188`
  F6, `:197-267` transcript keys at `:199`), so they out-rank the kit's
  priority-0 modal layer **on priority itself**, independent of the
  registration tie. With pane = `transcript` the second layer also carries
  `up/down/home/end/tab/escape` (`pane-focus.tsx:197-267`). Gate both
  layers on ownership; do not treat F6 as harmless.

Risks: the one-shot non-arming interrupt is module-scoped state shared by the
dock and the page layer (`turn-cancel.tsx:69-85`). A stale flag would turn
the next busy-turn press into a non-arming interrupt, so it is consumed
unconditionally on the next Ctrl+C (`:81-85`) and has a test reset (`:77-79`).
An ordinary page-level press still interrupts **and** arms, so the shipped
double-press convention documented at `turn-cancel.tsx:16-22` is unchanged
outside the dock transition; the acceptance case is three presses in a row
never quitting inside the window (spec §6).

## Verification

Regression cases are added in the same change set (see the spec's delivery
section):

1. **Esc over /agents + stop confirm.** With /agents open on a busy turn:
   Esc #1 arms, Esc #2 opens the stop dialog, Esc #3 closes the stop dialog
   and leaves /agents open. No page-level interrupt fires at any step.
2. **PgUp/PgDn over /settings and /agents.** The panel's own pager wins when
   its list overflows; the transcript does not scroll.
3. **No overlay open.** Esc still arms/interrupts, PgUp/PgDn still scroll the
   transcript. Ctrl+C on a busy turn still interrupts **and** arms, as in
   0.17.3; two Ctrl+C presses on an idle page quit (spec §6).
4. **Ask dock open.** Esc and Ctrl+C reach the dock only; the page cancel
   layer never fires. After the dock closes, the next page Ctrl+C consumes
   the one-shot: on a busy turn it interrupts without arming. The press
   after that is an ordinary busy-turn press and arms again (spec §6).
5. **Frame accounting.** Pushing/popping dialog, panel and dock frames
   returns the stack to exactly `[page]`; a leaked frame fails the test.

## R4 linkage — FocusRouter four-tier capture stack (024 SK, 2026-11-21)

Status: linkage finalized by the 024 SK slice (ADR-R4 / v3 §3.4). This section
records how the FocusRouter capture stack refines the mechanism decided above;
it does not open a second ownership state.

ADR-0008 established one input-ownership stack (`page`/`dialog`/`panel`/`dock`
frames; `top()` and `owns(frame)` are the only predicates) to remove the
`mode:"global"` + registration-order tie. ADR-R4 (redesign proposal §3.4, §7
ADR-R4) tightens that mechanism with **FocusRouter**, a tiered view of the same
stack: dialog frames are the `modal` tier, panel and dock frames are the
`overlay` tier, and the page frame hosts `main` and `global`. The keymap lane's
`prependListener` priority and the raw `useKeyboard` lane (Context, "the two key
lanes") remain the two entry lanes this stack arbitrates between.

Capture precedence is `modal (3) > overlay (2) > main (1) > global (0)`.
`FocusRouter.allows(tier, frame?)` is the single structural gate; a layer
declares a `capture` tier and `Keymap.createLayer` ANDs that gate into the
layer's `enabled` at registration time. The resulting invariants:

1. **No second ownership.** FocusRouter is a view over `InputOwnership`; frame
   tokens, push/pop lifecycle and top-identity semantics are exactly Decision
   1–3. `FocusRouterProvider` nests `InputOwnershipProvider` so dialog,
   panel-kit and dock hosts all read the same stack. No bridge, inject or
   service surface is involved.
2. **Shims only at leaves.** The page-level `pageOwns()` / legacy
   `dialog.stack.length === 0` gates are no longer the ownership authority:
   `useIsPageOwner()` now delegates to the router's `main` gate. Panel paging
   layers (Decision 6) are `overlay` tier and keep their own functionality.
   The name `useIsPageOwner` stays as a compatibility alias so untouched call
   sites and their pinned tests keep working.
3. **Existing priorities unchanged.** The four-tier order decides *which tiers
   are enabled*, not keymap `priority`. On the page frame both `main` and
   `global` are enabled; their relative order is still the existing per-layer
   `priority` and registration order (e.g. pane-focus stays `priority: 1`, the
   agents hotkey layer stays `priority: 2`). This avoids behaviour drift.
4. **Ambiguous key decisions keep the status quo.** Esc arm→confirm, Ctrl+C
   busy interrupt-and-arm, Ctrl+C under an overlay belonging to the overlay
   (quit unreachable, Decision 8), and digit session-tab quick switch all stay
   as decided here and in the shipped keybind config. Interaction-feel
   differences are recorded as USER-JUDGMENT and never gate the build.

Where a surface cannot declare a `capture` tier (a bare FT harness without the
provider), layers fall back to their pre-ownership `enabled` behaviour, exactly
as the optional-ownership fallback in Decision 3 already provides. Verification
for the tiered view is added in `packages/tui-base/test/focus-router.test.tsx`
(matrix, leak negatives N1/N2, frame accounting) plus the SK slice's real tmux
`capture-pane -e` evidence in `.proof/024-sk-keymap/`.
