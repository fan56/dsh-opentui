# oldfox verdict: reusing opencode test assets in dsh-opentui

Date: 2026-11-14. Judge: oldfox (analysis only; no implementation proposed).
Inputs: the four research docs in this directory + read-only source checks in
`/Users/qingguee/repo/dsh-opentui` and `~/Downloads/opencode-survey`.
Every claim below carries a path; unverified items are marked **speculation**.

Hard fact established up front (it reframes the whole "harness" question):

- dsh-opentui pins `@opentui/core|solid|keymap` **0.8.1** everywhere
  (`packages/{shell,runtime,panel-kit,tui-base}/package.json`).
- **0.8.1 already ships the full `./testing` facade**: package.json exports
  map has `"./testing"`; `testing.d.ts` re-exports test-renderer / mock-keys /
  mock-mouse / mock-tree-sitter-client / terminal-capabilities / spy /
  `ManualClock` / `TestRecorder`
  (`node_modules/.pnpm/@opentui+core@0.8.1_.../@opentui/core/testing.d.ts`).
  `test-renderer.d.ts` declares `createTestRenderer`, `mockInput`,
  `renderOnce`, `waitForFrame`, `waitForVisualIdle`, `captureCharFrame`,
  `captureSpans`, `resize`, `kittyKeyboard`; `mock-keys.d.ts:80` declares
  `pasteBracketedText`. `@opentui/solid` 0.8.1 `index.d.ts:5` exports
  `testRender` returning `TestRendererSetup` from `@opentui/core/testing`.
- dsh-opentui **already builds on it**: the ft tier classifier keys on
  `@opentui/core/testing` imports and `testRender(`/`createTestRenderer(`
  (`scripts/test-tier.mjs:41-72`); 27 ft files exist, 17 in tui-base
  (research/dsh-opentui-test-current-state.md §2).
- opencode runs `@opentui/core`/`@opentui/solid` **0.8.4** (bun.lock:1910,1930)
  via `catalog:`. Gap = 3 patch releases (0.8.1 → 0.8.4). The .pnpm store of
  the dsh-opentui main tree also holds 0.7.0 and 0.8.2 — someone has already
  been evaluating upgrades (measured, `node_modules/.pnpm/` listing).

---

## 1. Harness route: A (upstream testing tool) vs B (in-repo rewrite) vs C (hybrid)

**Verdict: C, but with the emphasis inverted from what the task framing
assumed — the upstream testing tool is not something to adopt, it is already
installed and already in use at our pinned 0.8.1. What is missing, and what
the "harness" actually reduces to, is (a) opencode's repo-specific *fixture
layer* (app boot against a mocked server, frame-normalization helpers,
waitFor* wrappers) reimplemented for our client/host topology, and (b) CI
wiring for surfaces that today have zero renderer tests (shell).**

Evidence:

- The API surface opencode's 197 tui test files build on
  (`createTestRenderer`, `mockInput`, `captureCharFrame`, `waitForVisualIdle`,
  `testRender`) exists verbatim in our installed 0.8.1 (paths above). The
  premise "self-built harness" was predicated on this not existing; that
  premise is factually wrong, as the task brief itself suspected.
- What opencode adds on top is thin and repo-specific:
  `packages/tui/test/fixture/app.ts` = `createAppFixture()` = real renderer
  from `createTestRenderer()` (fixture/app.ts:1,26) + `Bun.serve({ port: 0 })`
  mocked server (app.ts:38) + `Symbol.asyncDispose` teardown (app.ts:78-84),
  plus `frame.ts`/`tui-client.ts`/`tui-runtime.ts` helpers. None of that is
  upstreamable or directly copyable — it mocks *their* HTTP server; we have a
  ws mux client (`packages/shell/src/client/events-source.ts`,
  `mux-frame.ts`) + resident host, so our fixture must mock
  `@deepseek-ai/dsh-client-connection` instead (pattern already proven in
  `packages/shell/test/transport-connect-retry.test.ts` via `mock.module`,
  and `test/client-fakes.ts`).
- Version-compatibility cost of route A proper (if "A" means matching
  opencode's 0.8.4): one measured API gap — `externalOutputMode` /
  `externalOutputQueue` do **not** exist in 0.8.1 or 0.8.2 `testing.d.ts`
  (grep, both versions in .pnpm store), while opencode's
  `mini/scrollback.surface.test.ts:42` does
  `Reflect.get(renderer, "externalOutputQueue")`. Copying that specific test
  class requires either an upgrade to ≥0.8.3/0.8.4 (**speculation on exact
  introducing version — cannot verify without 0.8.4 on disk**) or adapting to
  `captureCharFrame` polling. Everything else cited in the case surveys is
  present in 0.8.1.

Why not B: rewriting a renderer test harness that our own dependency already
exports duplicates 27 existing ft files' foundation and forfeits upstream bug
fixes. Why not pure A: there is nothing left to "adopt" at the tool level;
the remaining work is fixtures + wiring, which is inherently ours.

**Confidence: high** on the 0.8.1 API inventory (read from installed d.ts).
**Medium** on the 0.8.4-only status of externalOutputMode (negative evidence
from ≤0.8.2 only).

## 2. First pilot (1 working day, must be evaluable)

**Verdict: main pilot = "shell renderer tests 0 → 1" — build a minimal shell
app fixture (mock connection via the existing `client-fakes`/`mock.module`
pattern + `createTestRenderer`) and land 3–5 cases mapped to our incident
list (see §3: key-capture scope, wake-turn line joining, fade-frame under
fake timers). Rider (mandatory, +30 min, not a separate pilot): a
false-green canary test (see §6). Explicitly not the pilot: pushing the 70
tmux checks into CI — that inverts the agreed direction (harness eats the
automatable majority, tmux shrinks to a smoke subset) and imports the CI-time
and profile-dependency risks of §7.**

Why this pilot best validates harness ROI:

- Shell is the documented structural hole: 30 test files, zero renderer-level
  tests; "the client protocol's real frame path is covered only by e2e"
  (research/dsh-opentui-test-current-state.md §4.3; measured: only
  `mux-frame.test.ts` touches frames, and it is a parser/pump test over a
  fake socket, no renderer).
- Dependencies are already feasible: `packages/shell/package.json` declares
  `@opentui/core|solid|keymap` 0.8.1; `packages/shell/bunfig.toml` already
  carries the `[test].preload` — the fixture can be written today with zero
  version changes.
- It directly attacks three of four stated pains at once: 渲染回归门禁
  (new gate surface), 接线集成断点 (shell = the wiring package where the
  /agents-class incident lived), and 假绿 (canary rider). 测试分层重构 is
  validated implicitly: the new files are ft-tier by the existing classifier
  (`scripts/test-tier.mjs:41-72`) with no classifier changes needed.
- Evaluable in a day: success = N incident-derived cases green in
  `bun run test:ft` on CI (they enter the existing per-package leg,
  ci.yml "for p in packages/*/..."), plus ≥1 deliberately-broken-render
  control demonstrating the case goes red (guard against vacuous green).

**Confidence: high.**

## 3. Minimal reusable case set (incident ↔ opencode case mapping)

| Our incident | opencode case (file:location) | Reuse form & granularity |
|---|---|---|
| latch infinite loop; 421 tests green yet regressed (假绿) | No single case matches; the *structural* antidotes do: negative assertions (`packages/core/test/tool-edit.test.ts` "fails instead of reporting success when the edit leaves the file unchanged") and wake/loop semantics (`packages/core/test/effect/keyed-mutex.test.ts` "removes an interrupted waiter without dropping the holder lock"; `session-run-coordinator.test.ts` "coalesces wakes received during active execution", "runs a wake registered during interruption cleanup") | Port the *norm*, not the code: every regression fix lands with a test asserting the failure mode, and loop/wake logic gets interrupt-and-coalesce cases at pure-logic granularity (our latch is logic, not rendering). | 
| transcript read failure treated as empty array | `packages/core/test/config/config.test.ts` "ignores an invalid file while loading valid config values"; "tolerates unavailable authenticated wellknown config and reloads it later" (research/opencode-test-cases-core.md §6, basic-checklist row "Read failure must not be treated as empty data") | Direct pattern transplant at unit granularity: assert distinct error/sentinel propagation, never `[]`-on-throw. | 
| fade frame not drawn (pure think, no tool) | `packages/tui/test/util/delayed-presence.test.ts` + `component/session-tabs-marquee.test.ts` (jest.useFakeTimers + advanceTimersByTime inside bun:test); `markdown-streaming.test.tsx` (signal-order invariance under `batch()`) | Transplant the fake-clock + per-tick `captureCharFrame()` substring pattern at ft granularity; assert the fade glyph appears at t=delay and is absent before. | 
| PgDn/Home/End swallowed by a higher layer | `packages/tui/test/cli/tui/input-scope.test.tsx` (lines 116–256: "an inactive form leaves Enter, navigation, and paste with the focused peer", "permission layers leave the focused peer's Enter and navigation alone until activated"); `keymap.test.tsx` layer registration | Closest 1:1 match to our incident. Reuse the harness-component pattern: mount real shell keymap stack over a focused peer, `mockInput.pressKey("pgdn"/"home"/"end")`, assert the terminal peer (not the palette) consumed it. ft granularity. | 
| Nerd Font tofu | **No opencode case** (checked: survey has wide-char *measurement* tests only, `prompt/display.test.ts` samples "中文"/ZWJ emoji — no glyph-fallback/tofu cases) | Take the idea, not a case: assert measured cell width + visible form of icon glyphs at fixed width (like `display.test.ts` offset round-trips). Low direct-reuse value; keep in backlog. | 
| border-box row count always 0, hint as fallback | `packages/tui/test/ui/layout.test.ts` (exact boundary clamps, degenerate input 0) + `cli/tui/inline-tool-wrap-snapshot.test.tsx` (fixed-width wrap/truncation via `captureCharFrame`) | Pure-function boundary tests for the box-measure + one ft frame test asserting actual drawn row count, killing the hint-fallback path. Note our `verify/ui-matrix.mjs` already asserts row counts on the real machine — the reuse is moving that class into headless ft. | 
| wake-turn line joining (拼行) | `packages/tui/test/mini/scrollback.surface.test.ts` — `trailingNewline` ownership asserts (lines 362–909: `expect(final[0]?.trailingNewline).toBe(false)` etc.), commit-boundary row slices | The exact failure class. Caveat: their commit-claiming uses `externalOutputQueue` (absent in our 0.8.1, §1) — adapt to `captureCharFrame` line-count/`toContain` assertions on consecutive wake renders instead. ft granularity. | 

**Confidence: high** for scope/line-joining/fade/border mapping (files read);
**medium** for latch (pattern-level mapping, no direct case);
**low (marked)** for tofu (absence verified, remedy speculative).

## 4. Do-not-port list (heavy machinery vs Solid+bun stack)

| Asset | Verdict | Reason |
|---|---|---|
| Effect Layer DI graph (`packages/core/test/lib/effect.ts`) | **Do not port** | It is the injection mechanism for an Effect-TS app. Our app is Solid+bun with no Effect runtime; porting means re-architecting the product, not the tests. Our equivalents already exist and are cheaper: `mock.module` (proven in 2 shell files), `test/client-fakes.ts`, bunfig preload. |
| Effect `TestClock` | **Do not port**; take the cheap substitute | opencode's own TUI tests do NOT use TestClock — they use `jest.useFakeTimers()` inside bun:test (`session-tabs-marquee.test.ts`, `delayed-presence.test.ts`) plus `setSystemTime`. That works identically for us; zero porting cost. |
| Seeded differential fuzzing (patchmark 5,000-case vs commonmark) | **Do not port now** | Only pays where we own a parser and have a reference oracle. We consume upstream markdown rendering, not own it. Revisit only if a dsh-owned parser lands. |
| HTTP cassette record/replay (`packages/http-recorder`) | **Do not port now**; keep the existing `fake-model.mjs`/mock-LLM e2e legs | Cassettes add provider-wire fidelity we don't need for the four stated pains; our failure classes are client-side rendering/wiring, not provider drift. Cassette redaction discipline is a nice-to-have later. |
| Network-refusing fetch harness | **Port the *idea*, lightweight** | A preload/test-setup that fails any test on accidental non-loopback fetch is ~30 lines and directly serves the 假绿/接线 pains (research/opencode-test-cases-core.md §"Setup & assertion techniques" #2). |
| Reserved SSE failure event as observable contract | **Take the idea** | Our client protocol (mux-frame/events-source) should encode mid-stream failure as a distinct frame so tests (and users) can see it — maps to our "transcript read failure" class. Design change though; flag, don't do in the pilot. |
| Golden/contract pinning (event-type enumeration, OpenAPI stability) | **Port, cheap** | Our shell already has 11 `remote-*.test.ts` protocol files; adding exact event-type array pinning is low-cost drift protection. |

**Confidence: high** on Do-not-port items 1–2 (measured substitutes exist);
**medium** on cassettes/fuzzing (judgment call on future needs).

## 5. Go negative-example mirror — where we are isomorphic

From research/opencode-go-test-architecture.md: go tests never ran in CI
(test.yml = bun only), rendering had zero output assertions, and the rewrite
discarded the lot. Our isomorphisms, ranked by danger:

1. **The gate that sees real rendering is off by default.** The 70-check
   tmux gate runs in CI only under `DSH_REAL_CLIENT_GATE == 'true'` on a
   self-hosted runner (ci.yml real-client job; current-state doc §5), i.e.
   "whoever runs it, pastes it". Same shape as go tests existing but never
   executed: the /agents-class incident (current-state doc §6.1) was visible
   ONLY to that gate. Risk: any keymap/panel regression between manual runs
   ships silently. This is the strongest argument for the §2 pilot.
2. **Biggest surface, thinnest tests.** Go TUI: 20,793 non-test lines vs 13
   test files. Us: `packages/shell` = client protocol + UI shell, 30 test
   files but zero renderer-level (current-state §4.3); tui-base carries 58
   historical typecheck errors that are explicitly not a gate
   (current-state §1). Risk: the wiring layer rots first because nothing
   mechanical watches it.
3. **Trust-eroding dead assets.** Go: Prism suites skip-wholesale. Us:
   `verify/run-parity.mjs` unwired with a retired profile name
   (current-state §4.2); a misspelled `E2E_SCENARIOS` silently runs fewer
   scenarios (current-state §4); stale `verify/README.md` and
   docs/testing.md counts (70/12 vs measured 77/27). Risk: engineers stop
   believing the inventory; each stale number is a future false-green alibi.
4. **Non-isomorphic, to be fair:** we DO have exit-2-not-a-pass discipline,
   a named ft tier, and hosted CI running unit+ft — the Go repo had none of
   this. The mirror is partial, concentrated in "rendering truth lives
   outside CI".

**Confidence: high** (all items cited to files/docs).

## 6. Does adopting upstream testing dissolve the solid-SSR false green?

**Verdict: no — it is orthogonal, and mostly already defended. The false
green comes from module resolution (solid-js → `dist/server.js`, no-op
`createEffect`), which `@opentui/core/testing` neither causes nor fixes.
The existing defense is the `[test].preload` in root + shell + tui-base
bunfig.toml (all three read; comments explicitly document the
"silently vacuums" failure). What is missing is any *verification* that the
defense holds — no canary asserts the real solid runtime is active, and the
root preload hard-codes a path into `packages/tui-base/node_modules/...`
(root bunfig.toml), which breaks silently if that layout changes. Required
independent guard for the pilot: one canary test (render a signal-driven
component, assert the frame changes after a signal write — fails under
server-build resolve), plus keeping `mock.module` anchors for the client
connection. New renderer tests in shell automatically inherit shell's
bunfig preload (verified present), so CI's per-package run covers them.**

Evidence: root/shell/tui-base `bunfig.toml` (read in full);
current-state doc §6.2; `mock.module` usage = 2 files
(`transport-connect-retry.test.ts`, `remote-subagents.test.ts`).
**Confidence: high.**

## 7. Risk list (severity order)

1. **[blocker-class for streaming cases] Upstream diff-paint corruption.**
   Draft unfiled bug: screen corruption under sustained streaming, SIGWINCH
   and remount do not heal, identical on @opentui/solid 0.7.0 AND 0.8.2
   (current-state §6.4, docs/upstream-opentui-paint-bug-draft.md). Any
   harness acceptance metric built on long-streaming frame assertions can be
   wrong independent of our code. Mitigation for the pilot: scope cases to
   non-streaming or short-burst frames; do not certify "streaming render
   regressions caught" from day one. Unknown whether 0.8.4 fixes it
   (**speculation** — cannot verify without installing).
2. **Version-pin discipline vs copied tests.** Repo rule: 0.8.1 unified.
   opencode cases authored against 0.8.4; at least one facility
   (`externalOutputQueue`, scrollback commit claiming) is absent ≤0.8.2.
   Every ported case must be checked against the installed 0.8.1 d.ts before
   copying, or the copy fails at import/runtime — a new false-green shape if
   it degrades to a vacuous try/catch.
3. **Snapshot/assertion brittleness.** opencode deliberately avoids
   full-frame equality (dominant style = normalized-frame substring,
   research/opencode-test-cases-ui.md "Assertion techniques" #1; their own
   gap list admits `toContain` can pass while unrelated layout breaks).
   Enforce the same norm in our fixture helpers from day one; our
   ui-matrix's numeric row/column assertions are the stricter complement —
   keep that style for geometry.
4. **CI duration creep.** CI already runs the full per-package suite AND
   `test:ft` again (double execution by design, ci.yml). Renderer tests are
   slower than unit; unbounded growth re-opens the "trim CI" pressure that
   historically pushed ui/e2e out. Budget ft counts per package.
5. **Worktree/symlink discipline.** This analysis lives in a worktree
   (`dsh-opentui-wt-test-arch`); `.pnpm` store evidence came from the MAIN
   tree. Renderer tests executed from a worktree without its own install
   will resolve modules through whatever node_modules layout happens to be
   reachable — and the root bunfig preload path pins into tui-base's
   node_modules explicitly. Pilot must define where it runs (main tree or
   installed worktree) or results are environment-dependent.
6. **Docs drift re-offense.** testing.md counts already wrong once
   (70/12 vs 77/27). Pilot adds files to a tier; same-PR doc update or we
   manufacture Go-style trust erosion ourselves.
7. **Client-connection stub semantics.** CI stubs
   `@deepseek-ai/dsh-client-connection` with a throwing stub (ci.yml). Any
   new shell fixture must `mock.module` it before import; a fixture that
   accidentally imports the real path will pass locally (global dsh
   present) and throw in CI — or worse, be worked around with a skip.

**Confidence: high** on 2/4/5/6/7 (measured), **medium-high** on 1 (bug is
documented with repro; upstream fix status unknown), **high** on 3
(documented in opencode's own gaps).

---

## Summary card

- Harness question dissolves: 0.8.1 already ships `@opentui/core/testing`;
  build fixtures, not a harness.
- Pilot: shell renderer 0→1 with incident-mapped cases + false-green canary.
- Copy cases for: key scope, line joining (adapted), fade timing, box rows,
  read-failure propagation. Skip: tofu (no upstream case).
- Do not port: Effect DI, TestClock, fuzzing, cassettes. Port cheaply:
  refuse-network idea, contract pinning, fake-clock pattern.
- Go mirror: our real-render gate is off-by-default in CI — the live
  isomorphism; shell is our thinnest-tested biggest surface.
- False green: preload exists, canary does not; add the canary.
- Top risk: upstream diff-paint bug poisons streaming frame assertions;
  version-gap (0.8.1 vs 0.8.4) makes blind test-copying a hazard.
