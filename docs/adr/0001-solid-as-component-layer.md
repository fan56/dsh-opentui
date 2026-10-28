# ADR-0001: Solid as the component layer

Date: 2026-10-28
Status: accepted

## Context

dsh-opentui needs a reactive component model on top of OpenTUI. OpenTUI
ships first-party renderers for React and Solid.

## Decision

Use **Solid** (`@opentui/solid`).

## Consequences

- We can copy MIT-licensed component/theme/keybind code from opencode's
  TUI (the largest OpenTUI+Solid production codebase) with attribution.
  A React choice would have forced translating every reference.
- `@opentui/solid` is the upstream-first renderer (same team as opencode).
- Plugins taking the layer-1 path add a Solid compile step (vite +
  babel-preset-solid); plugins taking the layer-2 path are unaffected.
- Solid's fine-grained signals match the "redraw only what changed" model
  we hand-rolled in pi-tui widgets; no hooks dependency-array pitfalls.
