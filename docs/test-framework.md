# Test Framework Handoff Guide

Audience: a fresh session with zero context, holding this repository plus this
document. By the end you should be able to write tests, run the gates, and do
a real-terminal verification without asking anyone anything.

Everything below was verified against the repository on 2026-11-14
(`main` = `cabf835`). When code and this document disagree, the code wins —
then fix this document.

---

## 1. Overview

Four test tiers, one runner (`scripts/test-tier.mjs`), one command to see the
file → tier matrix: `bun run test:list`.

| Tier | What it tests | Command | Needs |
|---|---|---|---|
| **unit** | Pure logic / state machines / hand-built ctx | `bun run test:unit` | bun + installed deps only |
| **ft** | **Real renderer** (`testRender` / `@opentui/core/testing`) or real assembly (`verify:` entry→host contracts); no network, no tmux | `bun run test:ft` | bun only |
| **ui** | Visual/geometry numbers: tmux capture + ANSI/geometry assertions | `bun run test:ui` | tmux, bun, `dsh`, provisioned profile |
| **e2e** | Real client + real host + full user flows (fake/local model by default; live model opt-in) | `bun run test:e2e` | tmux, dsh, podman; live legs opt-in via `DSH_E2E_LIVE=1` |

**ft** means "fixture/renderer test": the test drives the real OpenTUI
renderer in-process through `@opentui/core/testing` and asserts on captured
frames — not on source code, not on mocks of the view layer.

### Classification rules (implemented in `scripts/test-tier.mjs`)

A test file is **ft** if any of these hold:

1. filename matches `/-ft\.test\.tsx?$/`;
2. it imports `@opentui/core/testing`;
3. it calls `testRender(` or `createTestRenderer(`;
4. a test name carries the `verify:` prefix (assembly contracts).

Two env-gated files are forced to **e2e** (a skip is not a pass, so they are
excluded from unit/ft counts): `packages/shell/test/agents-mount-client.test.ts`
(`DSH_AGENTS_E2E`) and `packages/shell/test/remote-live-smoke.test.ts`
(`DSH_REMOTE_SMOKE`). Everything else is **unit**.

`ui` is two tmux scripts (`verify/ui-matrix.mjs`, `verify/agents-mount-repro.mjs`);
`e2e` additionally owns `verify/e2e-flows/run-flows.mjs`, the podman container
suite (`e2e/run-e2e.sh`), and two opt-in live scripts
(`verify/steer-queue-repro.mjs`, `verify/queue-flush-repro.mjs`).

### Current counts (measured, `bun run test:list`, 2026-11-14)

| Tier | Files | Breakdown |
|---|---:|---|
| unit | 77 | panel-kit 4, runtime 1, shell 27, tui-base 45 |
| ft | 32 | panel-kit 10, shell 6, tui-base 16 |
| ui | 2 scripts | geometry matrix over 5 geometries + agents-mount suite |
| e2e | 6 entries | 2 bun files + 4 scripts/suites |

The shell ft files (the renderer pilot): `solid-reactivity-canary-ft` (3 cases,
the false-green canary), `shell-render-smoke-ft` (4), `shell-render-regression-ft`
(9), `key-routing-ft` (6), `shell-render-incident-rows-ft` (4) and
`shell-render-incident-motion-ft` (fade/border incidents). Background and
rationale: `docs/testing.md` (baseline, in Chinese), `docs/adr/0007-*.md`,
`research/README.md` ("Pilot outcome" section).

---

## 2. Harness foundation

**Base = upstream `@opentui/core` 0.8.1 built-in `./testing` facade.** Per
[ADR-0007](./adr/0007-adopt-upstream-testing-utilities.md): do not build a
bespoke harness layer on top of it, and do **not** upgrade `@opentui` in the
first phase. Rationale: 0.8.1 already ships the full testing facade; 0.8.4
couples us to the upstream diff-paint bug timeline and offers nothing we need.

APIs we actually use (all from `@opentui/core/testing` / `@opentui/solid`):

| API | Purpose |
|---|---|
| `testRender(() => JSX, { width, height, useMouse })` | mount a Solid component tree on the real renderer; returns a `TestRendererSetup` |
| `createTestRenderer` | lower-level renderer setup (used by tui-base probes) |
| `mockInput` | feed escape-sequence key input (e.g. `"\u001b[5~"` = PgUp) |
| `setup.captureCharFrame()` | capture the visible buffer as text |
| `setup.captureSpans()` | capture per-cell spans incl. fg color (for fade/gradient assertions) |
| `setup.renderOnce()` | one render pass |
| `setup.waitForVisualIdle({ quietFrames })` | wait until the renderer stops repainting |
| `setup.resize(w, h)` | resize the virtual terminal |
| `setup.dispose()` | teardown (or `await using` / `Symbol.asyncDispose`) |

Known gap vs upstream 0.8.4: a single method, `externalOutputQueue`, which we
do not use and must not use (ADR-0007 upgrade trigger). Do not write tests
against it.

---

## 3. Shell render fixture API reference

File: `packages/shell/test/shell-render-fixture.tsx`. It drives the REAL shell
render path — `RemoteSessionSeam` over a fake `RemoteHostSession` → tui-base's
seam-rows projection → `Transcript` + `WidgetsDock` mounted via `testRender`.
The fake session doubles the `RemoteHostSession` surface at the same boundary
the protocol tests use, so no network and no SDK are involved (CI-stub safe).

### `createShellRenderFixture(options)`

| Option | Type | Meaning |
|---|---|---|
| `width`, `height` | `number` | virtual terminal size; defaults 80 × 32 |
| `stored` | `StoredTranscriptRow[]` | canned durable transcript rows (RAW pre-projection wire shape, `{ kind: "user" \| "assistant", text, final? }`). The REAL stored→seam projection in `src/client/session-seam-adapter.ts` runs on them during `projection.load()`, so projection drift is caught here too |
| `storedFailure` | `Error` | when set, every `storedTranscript` read REJECTS with this error — the incident injection point for read-failure cases |
| `turnScript` | `TurnScript` | scripted live turn; `fixture.send(text)` awaits the script |

The fixture is hydrated (`await projection.load()`) before the test body runs,
so assertions never race the initial load.

### Canned record builders (replayed via `fixture.journal(record)`)

- `userMessageRecord(text)` — `user/message` durable record
- `assistantMessageRecord(text)` — `assistant/message` durable record
- `turnEndErrorRecord(message)` — failed turn; projects to an error row

### Returned handle (`ShellRenderFixture`)

| Member | Meaning |
|---|---|
| `seam` | the real `RemoteSessionSeam` under test |
| `projection` | the seam-rows store (inspect `projection.rows` for store-level asserts) |
| `session` | the fake session (call recording, `setTurnScript`) |
| `journal(record)` | replay one canned durable record through the live feed |
| `send(text)` | run a live turn through the turnScript |
| `waitForFrame(predicate?, { timeoutMs? })` | **time-budget wait** (see below); returns the first predicate-passing normalized frame; default budget 4000 ms |
| `waitForVisualIdle({ quietFrames? })` | upstream idle wait |
| `captureFrame()` | normalized (`trimEnd` per line) char frame |
| `captureSpans()` | span-level capture incl. colors |
| `resize(w, h)` | resize the virtual terminal |
| `dispose()` / `[Symbol.asyncDispose]()` | teardown; use `await using fixture = await createShellRenderFixture(...)` |

**Why our own `waitForFrame` (time budget) instead of the upstream pass-count
version:** the upstream `setup.waitForFrame` counts render passes, which can
outpace async markdown painting. The fixture's version polls on a wall-clock
budget (render → capture → predicate → 25 ms sleep), which is robust to that.
Use it for every wait; use `waitForVisualIdle` only for settle convergence.

### Minimal complete example (from `shell-render-smoke-ft.test.tsx`)

```tsx
import { describe, expect, test } from "bun:test"
import {
	assistantMessageRecord,
	createShellRenderFixture,
	userMessageRecord,
} from "./shell-render-fixture.tsx"

describe("smoke", () => {
	test("stored journal rows reach the transcript frame", async () => {
		await using fixture = await createShellRenderFixture({
			stored: [
				{ kind: "user", text: "stored user question" },
				{ kind: "assistant", text: "stored assistant answer", final: true },
			],
		})

		const frame = await fixture.waitForFrame(
			(f) => f.includes("stored user question") && f.includes("stored assistant answer"),
		)
		expect(frame).toContain("stored user question")
		expect(frame).toContain("stored assistant answer")
		// Negative norm: content never fed must never appear.
		expect(frame).not.toContain("never-rendered-token")
	})

	test("a canned journal record repaints the live frame", async () => {
		await using fixture = await createShellRenderFixture()
		expect(fixture.captureFrame()).not.toContain("replayed user line")

		fixture.journal(userMessageRecord("replayed user line"))
		const frame = await fixture.waitForFrame((f) => f.includes("replayed user line"))
		expect(frame).toContain("replayed user line")
	})
})
```

For key-routing tests see `packages/shell/test/key-routing-ft.test.tsx`: it
mounts the real key chain (`Keymap.Provider` + `TranscriptScrollKeys` over the
Transcript scrollbox with a focused textarea standing in for the composer) and
asserts routing by observable effect (scrollbox scrollTop, visible rows, editor
cursor), feeding keys as escape sequences via `mockInput`.

---

## 4. Assertion discipline

Non-negotiable norms (enforced by review; violations produced real incidents):

1. **`captureFrame()` + paired assertions.** Every positive `toContain` gets
   a negative `not.toContain` for content never fed. Never assert on source
   code or store state alone — the frame is the truth.
2. **No whole-frame snapshots.** Substring/regex assertions over normalized
   frames only (`normalizeFrame` trims trailing whitespace per line).
   Whole-frame equality breaks on any unrelated paint change.
3. **Avoid long-streaming frame assertions.** The upstream diff-paint
   dropped-lines bug (reproduced on 0.7.0 and 0.8.2, unfixed) corrupts frames
   during sustained streaming. Scope every renderer test to short settled
   bursts; use `waitForVisualIdle` before the final capture. See
   `docs/upstream-opentui-paint-bug-draft.md` and ADR-0007.
4. **Every wait is a predicate + time budget.** No bare `sleep(500)` guesses.
   Use `fixture.waitForFrame(predicate)` (4 s budget) or, for animation
   timing, sample frames inside an explicit time window (see the fade recipe
   in §8). A timeout throws with the last frame attached, so failures are
   self-documenting.

---

## 5. The false-green canary

File: `packages/shell/test/solid-reactivity-canary-ft.test.tsx`.

**What it guards.** Without the `[test].preload` of `@opentui/solid/preload`
in `packages/shell/bunfig.toml`, bun resolves `"solid-js"` to the **server
(SSR) build** (`dist/server.js`), whose `createEffect` is a NO-OP. Reactive
tests then render nothing and still pass — every reactive test silently
vacuums. The defense is the preload; the canary is the proof that the defense
is actually active.

**The three dimensions** (all three fail under the server-build resolve):

1. **Loaded build identity** — `import("solid-js")` must carry the client
   build's `cancelCallback` export. The preload's bun plugin swaps
   `server.js` → `solid.js` at LOAD time; `import.meta.resolve` is unchanged
   (it still points at `dist/server.js` either way), so identity can only be
   checked through an export only the client build carries. This is why the
   canary does not (cannot) use `import.meta.resolve`.
2. **Effect execution** — a `createEffect` registered in `createRoot` must run
   on a signal write (0 runs under SSR).
3. **Reactive propagation to the frame** — a signal-driven component mounted
   through `testRender` must repaint when the signal changes (a no-op effect
   pins the first frame forever).

**Where the defense lives:** `packages/shell/bunfig.toml`, both the top-level
`preload` (covers `bun run`) and the `[test].preload` section (bun 1.4.x: `bun
test` only honors the `[test]` one). Other packages carry the same shape in
their own `bunfig.toml` — CI runs `bun test` per package precisely because
bun reads bunfig from the cwd.

**How to self-prove the canary (deliberate break, do this once by hand):**

1. Neutralize the preload:
   ```
   cd packages/shell
   sed -i.bak 's/preload = \["@opentui\/solid\/preload"\]/preload = []/g' bunfig.toml
   ```
   Break BOTH the top-level and the `[test]` section (bun test reads only the
   `[test]` one; breaking both proves the file is the guard).
2. `bun test test/solid-reactivity-canary-ft.test.tsx`
   **Expected red: all three dimensions fail** — identity misses
   `cancelCallback`, the effect test sees 0 runs, the frame test times out
   waiting for the repainted text.
3. Restore (`rm bunfig.toml.bak`), re-run: **expected green**.

Red on 1+2+3 and green after restore proves the canary watches the actual
defense, not something adjacent.

---

## 6. Adding a new test

1. **Place it** next to its package: `packages/shell/test/`,
   `packages/tui-base/test/`, `packages/panel-kit/test/`,
   `packages/runtime/test/`. Never outside a workspace package (the tier
   runner rejects that).
2. **Name it.** Renderer/assembly tests: `<topic>-ft.test.tsx` (the `-ft`
   suffix makes the tier explicit; the runner also auto-detects
   `@opentui/core/testing` / `testRender(` / `createTestRenderer(` / `verify:`
   prefixes, but do not rely on the implicit path). Pure logic:
   `<topic>.test.ts`.
3. **Write it** under the norms of §4. Reuse `shell-render-fixture.tsx` for
   anything that goes through the shell render path; write a local fake
   `RemoteHostSession` (copy the shape from `key-routing-ft.test.tsx`) for
   other seams. No network, no SDK, no `~/.dsh` access in unit/ft tests.
4. **Verify the tier assignment:** `bun run test:list` — the new file must
   appear in the tier you intended. A renderer test landing in `unit` means
   the naming/markers are wrong.
5. **Run the gates** (§7):
   - `bun run test:ft` (and `bun run test:unit` if you touched unit files)
   - `bun run typecheck:entry`
   - `bun run verify:assembly`
   - full suite: `for p in packages/*/; do (cd "$p" && bun test); done`
6. **Commit.** Watch out for the parallel-agent pitfalls in §9
   (`index.lock`).

Note: tests run per package (`cd <pkg> && bun test <files>`) because bun reads
each package's `bunfig.toml` for the `[test].preload`.

---

## 7. Gates & CI

### Local gates (mandatory before merge)

| Gate | Command | What it owns |
|---|---|---|
| Full suite | `for p in packages/*/; do (cd "$p" && bun test); done` | everything (unit + ft + assembly contracts) |
| ft tier | `bun run test:ft` | names the ft contract explicitly so a green run cannot hide an empty ft layer |
| Entry typecheck | `bun run typecheck:entry` | the entry assembly chain only (tui-base carries historical package-wide errors; this leg owns zero) |
| Assembly | `bun run verify:assembly` (= `cd packages/tui-base && bun test -t '^verify:'`) | entry→host wiring contracts |

`bun run test:ui` / `test:e2e` are local (or self-hosted) only — they need
tmux, a global `dsh`, a provisioned profile, and (for e2e) podman.

### Hosted CI (`.github/workflows/ci.yml`, `test` job, macOS + Ubuntu matrix)

1. `pnpm install --frozen-lockfile`
2. stub `@deepseek-ai/dsh-client-connection` (resolution-only package written
   into `packages/shell/node_modules/`; it throws if actually invoked)
3. per-package `bun test` (full suite)
4. `bun run test:ft`
5. `bun run typecheck:entry`
6. `bun test -t '^verify:'` in tui-base (assembly)

So hosted CI covers unit + ft + the two gates. `test:ui` / `test:e2e` are NOT
CI steps (no tmux / global dsh / profile / provider key on hosted runners).
Their absence in CI is not a pass — the local run is mandatory for those tiers
(`docs/testing.md` §3).

### `real-client` job (opt-in, skipped by default)

Gated on repository variable `DSH_REAL_CLIENT_GATE=true` AND a self-hosted
runner labelled `dsh-profile` AND event = `workflow_dispatch` or same-repo PR
(fork PRs are excluded — the gate runs with real credentials). It runs
`DSH_AGENTS_E2E=1 bun test test/agents-mount-client.test.ts` (tmux capture of
/agents mount + slash palette) and uploads captures. Default state: skipped.

### CI stub equivalence

CI has no global `dsh` install, so `packages/shell/node_modules/` has no
`@deepseek-ai/dsh-client-connection` symlink (verified: the worktree
node_modules carries only `cordis`, `dsh-llm`, `schemastery`). This does not
affect the test suite because the transport lazy-imports the SDK and every
test fakes at the `RemoteHostSession` boundary (`test/client-fakes.ts`, and
the fixture's fake session) — the SDK path is never loaded. The CI stub
exists only so RESOLUTION succeeds; it throws if INVOKED.

---

## 8. Real-terminal verification recipes

Renderer tests cannot see real terminal behavior (ANSI output, resize, input
focusing, upstream paint bugs at scale). These recipes are the local
complement. They were used to verify the shell-render pilot against the real
TUI.

### 8.1 Scratch home (never touch the real `~/.dsh`)

```sh
SCRATCH=/private/tmp/dsh-verify-$$   # pick your own name
mkdir -p "$SCRATCH"
cp -cR ~/.dsh/agents ~/.dsh/themes ~/.dsh/profiles "$SCRATCH/"
cp ~/.dsh/model-profiles.json "$SCRATCH/"
# Only if the verification needs a REAL LLM turn:
cp ~/.dsh/.credentials.yaml "$SCRATCH/"
cp ~/.dsh/models-store.json "$SCRATCH/"
# Workspace: a separate empty directory, NOT a repo checkout
mkdir -p /private/tmp/dsh-ws-$$
```

`cp -cR` clones (copy-on-write) — cheap on APFS. All paths must be absolute
(`/private/tmp/...`, not `/tmp/...`) because tmux and the client resolve them
differently.

### 8.2 Worktree boot: temporary SDK symlink

A worktree's `node_modules` has no `@deepseek-ai/dsh-client-connection` (CI
stub equivalence — see §7). The real client boot needs it resolved. Before
booting from a worktree, link the real package from the global dsh install:

```sh
ln -s /opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-connection \
      node_modules/@deepseek-ai/dsh-client-connection
```

(Taken from the worktree root, path verified to exist.) **Delete the symlink
when done** to restore stub equivalence — a leftover symlink makes later test
runs silently different from CI.

### 8.3 tmux boot + readiness poll

```sh
tmux new-session -d -s <name> -x 120 -y 40 -c <ws-dir> \
  "cd <worktree> && DSH_HOME=$SCRATCH DSH_AGENTS_HOME=$SCRATCH/agents ./dsh-opentui"

# Poll until ready (~1-5 s): the composer placeholder is the ready signal.
for i in $(seq 1 20); do
  tmux capture-pane -p -t <name> | grep -q "Type a message" && break
  sleep 0.5
done
```

`-x 120 -y 40` fixes the size so geometry assertions are stable. `DSH_HOME`
redirects the host home; `DSH_AGENTS_HOME` redirects the agents mount.

### 8.4 Driving the app

- **`--session <id>`** loads a specific session at boot (skips session/list).
  Used by the pilot to pin the failure-path verification to one journal.
- **`chmod 000 <scratch>/sessions/<id>/journal*`** triggers the
  first-transcript-read failure path; restore with `chmod 644` and relaunch
  for the recovery path. (Exact file layout under your scratch
  `sessions/` directory; the pilot's observation: error row appears ~6 s, recovery loads ~1 s.)
- **Slash commands**: `/help`, `/hotkeys`, `/resume`, `/session`, `/settings`
  are all available (registry in
  `packages/tui-base/src/routes/session/commands.ts`). Note: `/hotkeys` output
  is printed INTO the transcript (not an overlay) — it cannot be dismissed
  with Escape/q; capture and move on, or start a new session.
- **F6 = focus the transcript pane** (`PaneFocusKeys`,
  `packages/tui-base/src/routes/session/pane-focus.tsx`). The focused pane's
  border weight changes. The composer textarea is permanently autoFocus, so
  **any test of transcript-state keys (Home/End/↑/↓/PgUp/PgDn as transcript
  scroll) must press F6 first**. With the EDITOR focused, Home/End are editor
  keys (cursor to buffer start/end) and will NOT scroll the transcript.

### 8.5 Capturing evidence

```sh
tmux capture-pane -p -e -t <name> > x.ans   # -e keeps escape sequences
```

Numeric verification over the capture is the norm (grep for expected
strings/SGR sequences), not eyeballing. To force scrolling behavior, shrink
the window: `tmux resize-window -t <name> -x 120 -y 20`.

### 8.6 Poison pill: hand-made session fixtures

If you hand-craft a session journal to stage a scenario: the journal HEADER's
`id`/`cwd` must be self-consistent with the directory path it sits in. The
host validates this (`assertStoredIdentity` in
`@deepseek-ai/dsh-session-persistence-jsonl`): any mismatch makes the ENTIRE
`session/list` RPC reject (enumeration is all-or-nothing), and the client
degrades to "no stored sessions" in `/resume` forever. Symptom looks like a
client bug; it is your fixture. (Recorded in `research/README.md`, host-side
observation.)

### 8.7 Cleanup

- Kill ONLY the tmux session you created: `tmux kill-session -t <name>`.
  NEVER `tmux kill-server` — other agents/sessions live there.
- Delete the temporary SDK symlink (§8.2).
- Delete your scratch home and workspace directories. Do not touch other
  directories under `/private/tmp`.

---

## 9. Known pitfalls

1. **Parallel agents in the same worktree → `index.lock` collisions.** Two
   agents committing concurrently in one worktree race
   `.git/index.lock`. Serialize commits (or have one agent own the commit
   step). Symptom: `fatal: Unable to create '.../index.lock': File exists`.
2. **Module-level slot state leaks across test files.** Subagent slots are
   module-level singletons; without a reset, a slot set by file A changes
   file B's assertions (cross-file pollution under bun's shared process).
   Call `resetSubagentSlotsForTests()` in `beforeEach` — see
   `packages/tui-base/test/subagent-markers.test.ts` (helper exported from
   `packages/tui-base/src/routes/session/subagent-markers.ts`). Audit any new
   module-level registry you introduce for the same hazard.
3. **Fade/animation assertions.** A char frame is color-blind — use
   `captureSpans()` and compare span fg colors with a distance threshold, and
   sample frames inside an explicit time window (real clock; bun:test fake
   timers cannot safely drive the renderer clock). Reference implementation:
   `packages/shell/test/shell-render-incident-motion-ft.test.tsx`
   (`spanFg` / `colorDistance` / `sleepUntil`, driving the fade via the
   exported `setDockSpin` signal). Assert TWO distinct intermediate frames,
   not just the terminal state.
4. **Do not assert on long streaming frames** (§4.3) — the upstream
   diff-paint bug poisons exactly those.
5. **bun reads `bunfig.toml` from the cwd** — always run tests per package
   (`cd packages/<pkg> && bun test ...`), or the `[test].preload` of that
   package is not applied (§5).

---

## 10. References

- `docs/testing.md` — tier taxonomy baseline (Chinese; counts date 2026-11-14)
- `docs/verification-gates.md` — why real-machine evidence is irreplaceable
- `docs/adr/0007-adopt-upstream-testing-utilities.md` — harness route decision
- `docs/upstream-opentui-paint-bug-draft.md` — the diff-paint bug
- `research/README.md` — round index + **Pilot outcome** (case counts, gate
  results, real-client verification, host-side observation)
- `research/oldfox-reuse-verdict.md` — the path-backed reuse verdict
  (harness route, incident↔case mapping, do-not-port list, risk list)
- `research/opencode-test-cases-ui.md` / `opencode-test-cases-core.md` /
  `opencode-go-test-architecture.md` — opencode surveys
- `research/dsh-opentui-test-current-state.md` — pre-pilot baseline audit
- `tickets/` — tracked tickets (e.g. `home-end-transcript-navigation.md`)
- `scripts/test-tier.mjs` — the tier runner (source of truth for §1 rules)
