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

## Real-machine gate vs. the E2E families

`scripts/real-client-gate.sh` and the cap-smoke scripts run on the host macOS
with a real dsh (rc.5); the families run on the host with a scratch `DSH_HOME`.
They are separate environments and never stand in for each other's evidence.
