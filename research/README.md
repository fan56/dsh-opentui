# Research index — borrowing opencode test assets for dsh-opentui quality

Round purpose: survey what opencode's test system has that dsh-opentui can
borrow, and decide what to reuse, to raise dsh-opentui's test quality.

**Premise correction (established during this round):** the original premise
was that opencode recently migrated its TUI core to Go. The reality is
inverted — opencode's TUI *was* Go (Bubble Tea) through v1.0.0 and was
removed in the v1.1.0+ rewrite; the current TUI is TypeScript/SolidJS on
`@opentui/core` + `@opentui/solid` — the same framework family dsh-opentui
builds on. This reframes the whole "reuse the harness" question: the Go-era
assets are historical negative examples, and the TS assets are directly
comparable.

All artifacts of this round live in the worktree
`dsh-opentui-wt-test-arch`; the main tree is untouched.

## Documents

1. [dsh-opentui-test-current-state.md](dsh-opentui-test-current-state.md) —
   Read-only audit (2026-11-13) of dsh-opentui's own test system, measured
   from the main working tree. Maps the tier runner scripts (unit / ft / ui
   / e2e), the 112-entry tier inventory, and the CI lanes, including the
   opt-in `real-client` gate. Establishes the baseline the reuse decision is
   made against.

2. [opencode-go-test-architecture.md](opencode-go-test-architecture.md) —
   Facts-only survey of the Go era (snapshot at tag v1.0.0, the last tag with
   Go code). Documents the repo layout, exact test counts (31 `*_test.go`
   files, 97 tests), and the coverage shape: most of the TUI (chat, dialog,
   diff, modal, toast) had no tests at all while the SDK and input modules
   were well covered. Value: historical negative example, not a source of
   portable assets.

3. [opencode-test-cases-ui.md](opencode-test-cases-ui.md) — Survey of
   opencode's current terminal-UI test cases (197 test files in `packages/tui`,
   1,374 test declarations, TS/SolidJS on the same OpenTUI stack we use).
   Catalogs the test-directory layout and the fixture/harness layer
   (`createAppFixture` against a mocked HTTP server, frame predicates,
   SSE-style event injection) that every UI case builds on.

4. [opencode-test-cases-core.md](opencode-test-cases-core.md) — Survey of
   opencode's non-UI tests (~660 files / ~5,442 test functions across core,
   ai, cli, server, ...). Key infrastructure fact: tests are Effect-based DI
   graphs with a network-refusing fetch client, so domains stay testable
   offline. Includes the cassette-based HTTP record/replay ("fake LLM")
   infra.

5. [oldfox-reuse-verdict.md](oldfox-reuse-verdict.md) — The round's judgment
   (2026-11-14), every claim path-backed. Core finding: dsh-opentui already
   pins `@opentui/core` 0.8.1, which already ships the full `./testing`
   facade — so the "build vs adopt harness" question dissolves into
   building the repo-specific fixture layer. Contains the harness-route
   verdict (C: hybrid), the 1-day pilot design, the incident↔case mapping,
   the do-not-port list, and the risk list (top risk: the upstream
   diff-paint bug can poison streaming frame assertions).

## Settled decisions

Decided 2026-11-13 / 2026-11-14 during this round:

1. **Reuse scope includes a self-built harness** — note: this premise was
   since overturned by the verdict (§1): 0.8.1 already ships the upstream
   testing facade, so the harness reduces to a repo-specific fixture layer.
   Pending re-ratification.
2. **Four quality goals** — false greens, render regressions, wiring gaps,
   test-layering clarity.
3. **Incremental pilot** first; no big-bang adoption.
4. **Outputs live in `research/`** (this directory).
5. **The harness is an internal tool only** — not shipped, not published.
6. **The harness absorbs most of the real-client gate; tmux manual testing
   shrinks to a smoke subset.**
7. **First phase is capped at ≤ 1 workday.**
8. **Worktree isolation rule** — all artifacts of this round go in
   `dsh-opentui-wt-test-arch`; the main tree is untouched.

Settled 2026-11-14 (previously "Open decisions (awaiting user)"):

9. **Harness route: hybrid — accepted.** The 2026-11-13 "self-built
   harness" premise is overturned: the upstream `@opentui/core` 0.8.1
   built-in `./testing` facade is the harness substrate; only the
   repo-specific fixture layer is built on top. No bespoke harness
   wrapping, no first-phase upgrade to 0.8.4. Ratified as
   [ADR-0007](../docs/adr/0007-adopt-upstream-testing-utilities.md).
10. **Pilot entry: shell renderer tests 0→1, with a false-green canary
    rider.**
11. **CI untouched in the first phase** — the pilot stays out of CI
    until it has proven value (CI duration creep is a known risk).
12. **Incident-mapped cases: adopt the full mapping table, split in
    two blocks.** The first acceptance gate includes the skeleton +
    the canary + the shell 0→1 case + the 1:1 keymap case + the smoke
    set; the remaining four mapped cases follow immediately after.
