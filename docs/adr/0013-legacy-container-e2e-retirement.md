# ADR-0013: Retire the legacy podman `e2e/scenarios/` container layer

Date: 2026-11-22
Status: accepted

## Context

The 0.24 E2E rework replaced the per-slice proof scramble with one unified
E2E layer (`e2e/families/` + the `verify70` gate + unit tests + the CI
`pack-cold-start` gate). The old podman container suite — `e2e/scenarios/`
(21 scenarios + `run-all.sh`), its `Containerfile`, host drivers, bake helpers
and upgrade-registry fixture — was left **in service** past 0.24 by an explicit
adjudication (0.24 tag prep, `024-tag-prep-final.md` §D, commit `988c6f0`),
because two callers still depended on it: `e2e/families/run-all.sh` ran it as
the container family, and `scripts/test-tier.mjs` drove it in the e2e tier.

The red line "never delete existing tests" was adjudicated under the A.5
ruling (`docs/workflows/w4-review-gate.md` §二): it means "never delete
**still-valid coverage**". Tested surfaces that vanished may be deleted with
registration, and generic semantics may be deleted only after a new owner
takes them over.

## Decision

Offline the entire legacy container layer in 025-w3-2. Every one of the 21
scenarios was inventoried; each still-valid assertion was shown to be taken
over by an in-service owner before deletion. Evidence:

- `.proof/025-w3-2/01-legacy-retirement/inventory.md` — 21-scenario assertion inventory
- `.proof/025-w3-2/01-legacy-retirement/takeover-table.md` — 21-row takeover table (STOP=0)
- `.proof/025-w3-2/01-legacy-retirement/deletion-list.md` — deleted-file manifest

Two callers were rewired: `families/run-all.sh` now records the container slot
as **NOT RUN** (explicitly not a pass, not a green family), and
`scripts/test-tier.mjs` no longer invokes the container driver. The shared
offline model `e2e/lib/mock-llm.mjs` is **kept** — it is owned by the in-service
`verify/*` layer, not by the retired container suite.

## Consequences

- The Linux podman environment is no longer a separate E2E leg. Its generic
  semantics are covered by host families / verify70 / unit tests and the CI
  pack-cold-start gate; the two environments were always distinct and never
  stood in for each other's evidence (`families/FLAKY-LAWS.md` §6). The
  container slot's NOT RUN is registered, not faked green.
- Three historical gaps of the old layer (`30-commands` /think effort picker,
  `65-jev-attention` G2/G3 gate-dark/warn, stale-bundle gate-dark arms) are
  retired with it — not "fixed". Their product semantics are covered by the
  unit-test owners named in the takeover table.
- `e2e/families/FLAKY-LAWS.md` keeps container laws as historical (§2/§3/§4/§6)
  in case an in-container family is ever rebuilt; §1/§5 remain live.
- No product code, no frozen surface (CapIR/capcontract/ledger/build-bridge
  escape段), and no existing assertion inside the in-service layer was changed.
