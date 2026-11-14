# Home/End transcript navigation gap (shell page, plain-transcript state)

Status: Implemented in 65e03d3 (2026-11-14)

## Problem

In the rebuilt shell view, in pure transcript state (nothing editor-focused
holding the keys), plain `home`/`end` have no consumer and are effectively
lazy keys — they do nothing. The keybinds that own them
(`session.first` / `session.last`, `ctrl+g,home,alt+home` /
`ctrl+alt+g,end`) are only implemented by the vendored session route, which
the shell page does not mount.

## Evidence

- `packages/tui-base/src/config/keybind.ts:192-193` — `session.first` and
  `session.last` are bound to `ctrl+g,home,alt+home` / `ctrl+alt+g,end`.
- `packages/tui-base/src/routes/session/index.tsx:997,1065` — the only
  consumers of those commands ("First message" / "Last message") live in the
  vendored route's command layer; the shell page never mounts it.
- `packages/shell/test/key-routing-ft.test.tsx` (GAP NOTE at the tail, lines
  ~299-307) — documents that in the rebuilt shell view
  `TranscriptScrollKeys` binds only `session.page.up`/`session.page.down`
  (`packages/tui-base/src/routes/session/transcript-scroll.tsx:55-68`), and
  with the composer focused, home/end are consumed by the editor as
  buffer-home/buffer-end, so the keys are dead only in pure transcript state.

## Proposed approach

Either arm the shell page's `TranscriptScrollKeys` layer with same-layer
`home`/`end` bindings that scroll the transcript to the first/last row, or
mount consumers for the existing `session.first`/`session.last` commands on
the shell page (reusing the vendored route's run bodies: jump-to-top /
`toBottom()`). The first option keeps the shell page self-contained; the
second reuses the existing command ids so palette/config wiring stays
canonical. Either way the editor-focused path must remain untouched —
buffer-home/buffer-end still win while the composer has focus.

## Acceptance criteria

- In pure transcript state (composer not focused), `home` scrolls the
  transcript to the first row and `end` scrolls to the last row.
- With the editor focused, home/end behavior is unchanged (buffer-home /
  buffer-end in the composer).
- `key-routing-ft.test.tsx` gains contrast cases asserting the pure-transcript
  home/end routing (and that editor focus still takes the keys).
