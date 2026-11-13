# dsh-opentui — Test System Current State (audit, 2026-11-13)

Read-only inventory of the test system at `~/repo/dsh-opentui` (main working
tree). All numbers below are measured from the working tree on 2026-11-13,
not estimated. No test suite was executed except the read-only
`bun run test:list` classifier (it only walks files and classifies; it does
not run tests).

---

## 1. Scripts map (root `package.json`)

| Script | Command | What it actually does |
|---|---|---|
| `test` | `bun test` | Bare bun test run. Runner is **bun test** everywhere (no vitest/jest). Per the root `bunfig.toml` comment, bun only reads bunfig from cwd, so a root-level `bun test` uses the root preload; CI instead runs it per package (`for p in packages/*/; do (cd "$p" && bun test); done`, ci.yml:44). |
| `test:unit` | `node scripts/test-tier.mjs unit` | Tier runner: pure-logic bun test files, run per package. Refuses an empty tier. |
| `test:ft` | `node scripts/test-tier.mjs ft` | Tier runner: real-renderer / real-assembly files (filename `-ft`, imports `@opentui/core/testing`, `testRender(`/`createTestRenderer(`, or test-name prefix `verify:`). |
| `test:ui` | `node scripts/test-tier.mjs ui` | Runs `verify/ui-matrix.mjs` + `verify/agents-mount-repro.mjs` (tmux capture + numeric ANSI assertions). Preflight: missing tmux/dsh/profile → exit 2 with a named list ("NOT RUN, not a pass"). |
| `test:e2e` | `node scripts/test-tier.mjs e2e` | Local flows (`verify/e2e-flows/run-flows.mjs`, fake model) + container suite (`e2e/run-e2e.sh` via podman, mock model). Live real-model legs are opt-in via `DSH_E2E_LIVE=1`. |
| `test:all` | `node scripts/test-tier.mjs all` | unit → ft → ui → e2e in order; any red = overall red. |
| `test:list` | `node scripts/test-tier.mjs list` | Prints the file → tier matrix. Source of the counts below. |
| `typecheck` | `pnpm -r typecheck` | Per-package `tsc --noEmit`. Note: tui-base full typecheck still carries 58 historical errors (2026-11-10, docs/verification-gates.md §1.2) and is explicitly NOT a gate. |
| `typecheck:entry` | `cd packages/tui-base && bun run typecheck:entry` | `tsc -p tsconfig.entry.json` — roots only the entry assembly chain (v2-entry + slash deps + deps/ctx declaration chain); tsc still transitively checks the whole import closure. Owns zero errors. |
| `verify:assembly` | `cd packages/tui-base && bun test -t 'verify:'` | Runs only the assembly-contract tests named `verify:` in tui-base. |

Package-level scripts: `panel-kit` and `runtime` and `shell` and `tui-base`
each have `typecheck` (`tsc --noEmit`); only tui-base has `typecheck:entry`;
only shell has `prepack` (build-client.mjs). `panel-kit` also has a plain
`test: bun test`.

The tier classifier (`scripts/test-tier.mjs:41-72, 74-84`): file name `-ft`,
`@opentui/core/testing` import, `testRender(`/`createTestRenderer(` call, or
a `"verify:` test-name prefix → **ft**; the two env-gated live files
(`agents-mount-client.test.ts`, `remote-live-smoke.test.ts`) → **e2e**;
everything else → **unit**.

## 2. Test inventory

`bun run test:list` on 2026-11-13: **112 tier entries total**.

| Tier | Files | panel-kit | runtime | shell | tui-base | Non-bun assets counted in tier |
|---|---:|---:|---:|---:|---:|---|
| unit | 77 | 4 | 1 | 27 | 45 | — |
| ft | 27 | 10 | 0 | 0 | 17 | — |
| ui | 2 | — | — | — | — | `verify/ui-matrix.mjs`, `verify/agents-mount-repro.mjs` |
| e2e | 6 | — | — | 2 | — | `verify/e2e-flows/run-flows.mjs`, `verify/steer-queue-repro.mjs` (live), `verify/queue-flush-repro.mjs` (live), `e2e/run-e2e.sh` |
| **total** | **112** | 14 | 1 | 29 | 62 | 5 |

Raw `*.test.ts(x)` file counts per package (find, excluding node_modules and
`packages/shell/dist-host`): panel-kit 14, runtime 1, shell 29, tui-base 62
= 106 bun test files; the remaining 6 tier entries are scripts/suites.

Categories:

- **Unit** (77): pure logic, state machines, hand-built ctx. Example
  clusters: shell `remote-*.test.ts` protocol suite (11 files), tui-base
  composer/theme/transcript/slash logic, panel-kit pure tests (motion,
  theme-roles, contract-compile).
- **ft** (27): headless real-renderer tests (`testRender`,
  `@opentui/core/testing`) and `verify:` assembly-contract tests
  (`entry-slash-deps.test.ts`, `vendored-closure.test.ts`, `panel-kit-wiring.test.tsx`, …).
- **App-level test benches (ui tier)**: `verify/ui-matrix.mjs` (geometry ×
  scene matrix, 5 geometries 80×24/120×34/45×30/100×45/120×52, ~166 numeric
  assertions per docs/testing.md) and `verify/agents-mount-repro.mjs`
  (**70 `record(...)` checks** counted by grep, covering /agents, /settings,
  pane-focus, slash palette, composer context, 80×24 geometry, auto-resume).
  Both drive the real launcher through tmux with a scratch `DSH_HOME` and an
  offline mock model.
- **e2e**:
  - Default local flows: `verify/e2e-flows/run-flows.mjs` — **10 scenarios**
    (new-empty, single-turn, tool-turn, steer, queue, flush, resume,
    host-restart, settings, mcp), real client + real resident host + local
    fake model (`fake-model.mjs`), per-scenario scratch DSH_HOME.
  - Container suite: `e2e/run-e2e.sh` + `e2e/scenarios/run-all.sh` — **20
    scenario scripts** (10-install, 20-start, 22-search, 30-commands,
    40-mock-llm, 50-resize-exit, 60-ask-user, 61-btw, 62-hard-stop,
    63-cache-hit, 64-session-stats, 65-jev-attention, 66-preset, 67-theme,
    68-resume, 69-login, 70-steer, 71-search, 72-agents, 80-onboard) run
    inside a podman container (`e2e/Containerfile`: ubuntu 24.04 + node 26 +
    tmux + global dsh + workspace snapshot) with a mock LLM.
  - Live (opt-in `DSH_E2E_LIVE=1`): `packages/shell/test/remote-live-smoke.test.ts`,
    `verify/steer-queue-repro.mjs`, `verify/queue-flush-repro.mjs`.
- **True real-machine (tmux) scripts**: `verify/agents-mount-repro.mjs`,
  `verify/ui-matrix.mjs`, `verify/steer-queue-repro.mjs`,
  `verify/queue-flush-repro.mjs`, `verify/e2e-flows/run-flows.mjs`,
  `verify/run-parity.mjs` (**unwired** — defaults to a retired profile name
  `dsh-opentui`; docs/testing.md §4.2).

## 3. Gates

| Gate | Command | Covers | Where defined |
|---|---|---|---|
| typecheck:entry | `bun run typecheck:entry` | Entry assembly chain declaration completeness (v2-entry + slash deps + deps/ctx chain); zero-error policy. Exists because of the `/agents` incident (see §6). | docs/verification-gates.md §1.2 |
| verify:assembly | `bun test -t '^verify:'` | Entry→host wiring contracts; runs without ~/.dsh, tmux or a provider key. Prefix anchored `^verify:` so a garbled prefix cannot widen the filter. | docs/verification-gates.md §1.1, ci.yml:58-64 |
| ft tier | `bun run test:ft` | Named FT layer so "a green full-suite run cannot hide an empty ft layer" (ci.yml:46-48). |
| tmux real-machine gate | `node verify/agents-mount-repro.mjs` (or `DSH_AGENTS_E2E=1 bun test test/agents-mount-client.test.ts` in packages/shell) | Real launcher + real tmux; /agents and /settings mounting, layering, keys, auto-resume, 80×24 geometry. 70 checks; exit 0 + all `PASS` + `summary.json` `results[].ok` all true + `fallbackSeen: false` required. **Local-only before merging keymap/panel/command-surface changes** ("whoever runs it, pastes it" rule). | docs/verification-gates.md §1.3, §2 |
| Visual matrix | `node verify/ui-matrix.mjs` | Numeric ANSI assertions: row counts, column widths, border chars, SGR attributes, WCAG contrast ≥6:1; 5-geometry matrix. | docs/testing.md §1 ui row |
| e2e default | `bun run test:e2e` | 10 local flows (fake model) + 20 container scenarios (mock model, podman). Deterministic, key-free baseline. | docs/testing.md §1 e2e row |
| e2e live | `DSH_E2E_LIVE=1 bun run test:e2e` | Real model turns; explicitly opt-in so an expired key cannot turn the tier red for a non-product reason. Skip is printed, never counted as a pass. | scripts/test-tier.mjs:33-39, 182-198 |

Exit-code contract (docs/testing.md §5): 0 = pass, 1 = assertion failure,
2 = environment missing — **never a silent skip, never a pass**.
Missing-prerequisite handling in `scripts/test-tier.mjs:132-159` exits 2
with a named missing-item list.

### The "tmux real-machine 14-item" checklist

**Not found in the repository.** Grep for `14 项 / 14项 / 14-item / 14 items
/ checklist / 手工清单` over docs/, research/, verify/, README.md, CONTEXT.md
returns no hit. The historical 14-item manual gate appears to have been
superseded by scripts: `verify/agents-mount-repro.mjs` now carries **70**
named checks (grep count of `record(` calls) and `verify/ui-matrix.mjs`
carries the geometry matrix. The gate's current shape is a script + a
documented evidence rule (docs/verification-gates.md §2: PR must paste
command + geometry + `N/M checks passed` + captures), not a numbered list.

## 4. E2E container specifics

- Switch: `E2E_SCENARIOS` env var filters scenarios
  (`e2e/run-e2e.sh:71-72` passes it into the container; default list of all
  20 in `e2e/scenarios/run-all.sh:21`). **A misspelled scenario id fails
  silently — run-all.sh just runs fewer scenarios** (research/e2e-inventory.md
  §6.7 documents this as a hazard).
- Driver: `e2e/run-e2e.sh` (podman build + run) and
  `e2e/run-client-e2e.sh` (single-scenario variant, defaults
  `E2E_SCENARIOS=20-start`).
- Isolation: profile NOT baked into the image; `lib/common.sh`
  `ensure_client_profile` provisions it at runtime into a scratch
  `DSH_HOME` (`/tmp/client-dsh`). Nothing touches host state
  (e2e/README.md).
- Known container hazards (research/e2e-inventory.md §6): orphan
  mock/TUI processes poison the next scenario in the same container
  (failure cascade C14, common.sh:89-103); `80-onboard` runs last on
  purpose and calls `tmux kill-server`; a missing bake step once caused a
  silent "0 pass 0 fail 1 warn" skip of 61-btw (since fixed with
  per-scenario `ensure_client_profile`).

## 5. CI (`.github/workflows/ci.yml` — the only workflow)

Triggers: `push` to `main`, all `pull_request`s, `workflow_dispatch`.
**No `schedule:` cron anywhere** — consistent with the org policy of no
scheduled CI.

Job `test` (matrix: macos-latest + ubuntu-latest):

1. `pnpm install --frozen-lockfile`
2. Node inline script writes a **stub** `@deepseek-ai/dsh-client-connection`
   into `packages/shell/node_modules` (the package is not on the registry
   and runners have no global dsh; the stub throws if actually invoked —
   ci.yml:30-40).
3. Per-package full bun test: `for p in packages/*/; do (cd "$p" && bun test); done`
4. `bun run test:ft` (named FT tier)
5. `cd packages/tui-base && bun run typecheck:entry`
6. `cd packages/tui-base && bun test -t '^verify:'`

Job `real-client` (opt-in real-machine gate):

- Condition: repo variable `DSH_REAL_CLIENT_GATE == 'true'` AND
  (`workflow_dispatch` OR same-repo PR — fork PRs are excluded to protect
  self-hosted credentials; ci.yml:88-89).
- Runs on `[self-hosted, dsh-profile]` with preflight (tmux, dsh,
  `~/.dsh/profiles/opentui` — named missing-item errors), then
  `DSH_AGENTS_E2E=1 bun test test/agents-mount-client.test.ts`, then uploads
  `verify/agents-mount-out/` as artifact. Skipped by default.

Not in CI, by explicit documented decision (ci.yml comments + docs/testing.md
§3): `test:ui`, `test:e2e`, the container suite, live legs. "CI not running
them ≠ passed, and ≠ failed" — their conclusions come only from local or
self-hosted runs.

## 6. Documented gaps & incidents

### Incidents (with evidence)

1. **`/agents` not mounted incident (2026-11)** — docs/verification-gates.md
   §3. `ctx.openAgents` was `undefined` at runtime because three layers each
   dropped the same field; the entry file's `// @ts-nocheck` hid the excess
   property from the compiler. Only the real-machine tmux script could see
   "the panel didn't open". Direct cause of the `typecheck:entry` gate and
   the `verify:` contract tests (`test/entry-slash-deps.test.ts`).
2. **solid-js resolving to the SSR build / no-op `createEffect`** — bunfig.toml
   comments (root, tui-base, shell): without the `[test].preload` of
   `@opentui/solid/preload`, "every reactive test silently vacuums" (renders
   nothing and still passes). This is the "silently-vacuuming reactive test"
   class of false green; research/btw-render-gap.md H-D calls it a historical
   lesson ("solid-js resolves to server build / createEffect idles").
3. **61-btw green→gap flip** — research/btw-render-gap.md: scenario 61-btw
   asserted `E2E-BTW-ANSWER-TWO` and went green at commit `8c8091b`, then
   recorded a GAP at `0d951bb` with **zero diff** in the rendering/data code;
   root cause not conclusively identified (H-A upstream OpenTUI diff-paint
   corruption vs H-B askBtw race); a root cause that could not be reproduced.
4. **Upstream OpenTUI diff-paint corruption** —
   docs/upstream-opentui-paint-bug-draft.md: DRAFT (unfiled) upstream bug
   report; deterministic engine-only repro of screen corruption under
   sustained streaming; SIGWINCH and full renderer remount do not heal it;
   identical on @opentui/solid 0.7.0 and 0.8.2. This makes any frame
   assertion potentially untrustworthy under long streaming turns.
5. **`verify/README.md` is stale** — it still references `packages/kit`
   (package does not exist; only panel-kit/runtime/shell/tui-base) and a
   broken FT state ("Orphan error … reconciler text-node-under-box rule"),
   plus `npm run verify` which is not in any package.json. The current
   authoritative docs are docs/testing.md and docs/verification-gates.md.
6. **Stale baseline numbers in docs/testing.md §1.1** — the table says unit
   70 files / ft 12 files ("ft 全部在 tui-base"); measured today: unit 77 /
   ft 27, and 10 ft files are in panel-kit. The doc's own counts have
   drifted from `bun run test:list`.

### Structural gaps, self-documented (docs/testing.md §4)

1. ui tier has geometry/color coverage but **no animation/flicker timing**
   assertions (`run-parity.mjs` did time-series sampling but is unwired).
2. `verify/run-parity.mjs` **unwired**: defaults to retired profile name
   `dsh-opentui`, parity target is another repo's profile.
3. **ft coverage concentrated in tui-base** (17 of 27 ft files) +
   panel-kit (10); `packages/shell` has zero renderer-level tests — the
   client protocol's "real frame" path is covered only by e2e.
4. e2e live legs depend on a real model; output varies with model/network →
   flake risk; hence opt-in (which also means they run rarely).
5. Windows unsupported for ui/e2e (tmux dependency).
6. WCAG contrast only asserted for the default theme.

### Other keyword findings

- `mock.module` used in 2 test files only
  (`packages/shell/test/transport-connect-retry.test.ts`,
  `packages/shell/test/remote-subagents.test.ts`) — 4 call sites.
- research/e2e-inventory.md documents the silent-skip and failure-cascade
  traps of the container suite (see §4 above).
- Exit-2-not-a-pass discipline ("skip is not a pass") is implemented in
  scripts/test-tier.mjs and stated in both docs.

## 7. Glossary & ADR presence

- `CONTEXT.md` (repo root): **present** — controlled-vocabulary glossary
  (Runtime / Kit / Shell / Starter). Note: the glossary still names a `Kit`
  package (`@dsh-opentui/kit`) that does not exist in `packages/` — same
  staleness as verify/README.md.
- `CONTEXT-MAP.md`: **absent** (repo root and docs/).
- `docs/adr/`: **present** — 6 ADRs: 0001-solid-as-component-layer,
  0002-two-channels-no-shim, 0003-bun-binary-distribution,
  0004-host-profile-route, 0005-client-mode, 0006-vendor-opencode-tui-base.
- Related test docs: `docs/testing.md` (four-tier taxonomy), 
  `docs/verification-gates.md` (real-machine evidence policy),
  `verify/README.md` (stale, see §6.5), `e2e/README.md` (container harness),
  `research/e2e-inventory.md`, `research/btw-render-gap.md`,
  `research/e2e-warn-triage.md`.
