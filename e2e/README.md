# dsh-opentui e2e

This directory hosts the **024 unified E2E layer** (`families/`) and the shared
offline mock model (`lib/mock-llm.mjs`). One command runs every in-service family:

```sh
bash e2e/families/run-all.sh            # all in-service families
bash e2e/families/run-all.sh --skip-container   # --skip-container is a retained no-op
```

In-service families: `00-pack-gate` (outermost), `10-capability-domains`
(handshake±/degrade, session, sessionId isolation, push, model),
`20-model-domain`, `30-account-credentials-domain`, `40-exit-code`,
`80-keymap-modality`, plus the `verify70` gate family via
`scripts/real-client-gate.sh`. The accurate verify count is **64/64** (the
"70" in the gate script's banner is stale 0.23 text). Flaky laws are in
`families/FLAKY-LAWS.md`.

## Legacy `scenarios/` container layer — RETIRED in 025-w3-2

The former podman container suite (`scenarios/` — 21 scenarios + `run-all.sh`,
plus `Containerfile`, `run-e2e.sh`, `run-client-e2e.sh`, `lib/common.sh`, the
bake helpers, `mock-jev.mjs` and the upgrade-registry fixture) was **offlined**
under the A.5 ruling of `docs/workflows/w4-review-gate.md` §二: the red line
"never delete existing tests" means "never delete *still-valid coverage*".
Each of the 21 scenarios was inventoried, and every still-valid assertion was
shown to be taken over by the new architecture (host `families/`, the
`verify70` gate, unit tests, and the CI `pack-cold-start` gate) before deletion.

First-hand evidence:

- `.proof/025-w3-2/01-legacy-retirement/inventory.md` — 21-scenario assertion inventory
- `.proof/025-w3-2/01-legacy-retirement/takeover-table.md` — 21-row takeover table (STOP=0)
- `.proof/025-w3-2/01-legacy-retirement/deletion-list.md` — deleted-file manifest
- `docs/adr/0013-legacy-container-e2e-retirement.md` — the ADR

The retirement was pre-registered and explicitly deferred past 0.24 at
`024-tag-prep-final.md` §D (commit `988c6f0`); this batch executes that
promise. Callers were rewired: `families/run-all.sh` records the container
slot as **NOT RUN** (not a pass, not a green family), and `scripts/test-tier.mjs`
no longer drives the container driver. Container-specific historical flaky
laws are kept (marked historical) in `families/FLAKY-LAWS.md` in case an
in-container family is ever rebuilt.

`e2e/lib/mock-llm.mjs` is deliberately **kept**: it is the shared offline fake
model now owned by the in-service layer (`verify/*-repro.mjs`, `verify/ui-matrix.mjs`,
`verify/text-leak-audit.mjs`, `verify/e2e-flows/*`, and
`packages/shell/test/remote-btw-restart.test.ts` import it). It is not part of
the retired container layer.

## Tier runner (`scripts/test-tier.mjs`) — offline vs. live legs

`bun run test:e2e` drives two OFFLINE legs on every invocation, both against a
scratch `DSH_HOME` and a local model (no provider key, no network):

- `verify/e2e-flows/run-flows.mjs` — **17** scenarios (13 baseline + 4 added:
  `new-empty`, `single-turn`, `tool-turn`, `steer`, `queue`, `flush`, `resume`,
  `host-restart`, `settings`, `mcp`, `r3-hardcap-abort`,
  `r5-connection-closed`, `r6-child-routing`, `prune-lifecycle`,
  `scroll-new-messages`, `todo-write-scroll`, `r6-029`) with `fake-gw` + local
  fake model. The authoritative run count is the in-tree `scenario(...)` list
  (`grep -c '^scenario(' verify/e2e-flows/run-flows.mjs`);
- `verify/steer-queue-repro.mjs` — busy Enter steer/queue + abort, using
  `e2e/lib/mock-llm.mjs`. This leg used to be gated by `DSH_E2E_LIVE`; it is
  offline and therefore no longer blocked by that switch.

Real-model legs are opt-in and never implied by a default green run:

- `DSH_E2E_LIVE=1` runs `verify/remote-live-smoke.mjs` (the minimal live
  harness) and `verify/queue-flush-repro.mjs`. The harness provisions a scratch
  home + empty workspace, performs at most two real turns (a plain-text echo
  and one read-only `bash echo` tool call), asserts reply / tool row / footer /
  durable journal, never auto-approves, and has a wall-clock budget. The real
  `.credentials.yaml` is referenced by symlink into the scratch home — key
  values never reach argv or logs. Provider 401/429/5xx/timeout, missing
  credentials, an approval card, or a hung client exit 2 as `NOT RUN (ENV)`:
  neither a product PASS nor a product FAIL. Captures go to
  `verify/remote-live-out/`.
  `verify/queue-flush-repro.mjs` uses the same credential reference (symlink,
  no key in argv/logs/scratch plaintext; missing key = exit 2 NOT RUN) and now
  requires two observed `#1/#2` queue rows plus two distinct transcript user
  rows in submission order — an empty queue cannot pass its drain check.
- `DSH_AGENTS_E2E=1` runs the `packages/shell/test/agents-mount-client.test.ts`
  bun wrapper (tmux capture of the `/agents` mount); without the flag the tier
  prints `NOT RUN` instead of a silent skip.

There is no longer a `packages/shell/test/remote-live-smoke.test.ts` — that
path was a dead reference to a file that never existed and was removed from the
runner, the matrix and the docs. Any leg that does not run is printed as
`SKIP ... NOT RUN: ...`, and the tier summary is `INCOMPLETE` rather than
`PASS`. A plain `PASS` is printed only when every listed leg actually ran.

## Real-machine gate vs. the E2E families

`scripts/real-client-gate.sh` and the cap-smoke scripts run on the host macOS
with a real dsh (rc.5); the families run on the host with a scratch `DSH_HOME`.
They are separate environments and never stand in for each other's evidence.
