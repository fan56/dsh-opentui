# PREREGISTRATION — frozen expected values (write-once, never edited)

This file was written to disk BEFORE the formal task5b rerun evidence capture.
It is the preregistered `expected` column for the task5b fix report. Do not edit
after capture. Status/observed values are decided later against the `pass
criterion` column and live in `report.md`, never by rewriting `expected` here.

- Preregistered at (UTC): 2026-11-20T14:48Z
- Base worktree / branch: `/Users/qingguee/repo/dsh-opentui-wt-024-capir` @ `feat/024-capir`
- Pre-fix HEAD (evidence baseline): `0a63feeba51277ddf8d32977dea2cb9aa2a4a9eb` (clean at freeze)
- Fix scope: R1–R6 + gate patch + I-probe move + A6 re-registration (oldfox ruling `024-base-task5-review-oldfox.md`)
- Profile(s): FEATURE + DATAFLOW + negative-control
- Evidence directory: `.proof/024-base-task5b/`
- Old evidence package `.proof/024-base-task5/` (Gate FAIL, A5/A6) is preserved byte-for-byte and NOT edited.

## Environment snapshot (plan E discipline — host already upgraded to rc.5)

- `dsh --version` measured = `0.2.2-rc.5` (old package was rc.4). Upgrade report:
  `/Users/qingguee/repo/wayfinder-web-profile/research/024-host-rc5-upgrade-executed.md`.
- rc.5 capability surface measured still = **75** ids; `permissionPresets` still catalog-only
  (no `set`). **Ledger exclusions remain untouched** — no re-reconciliation in this knife.
- Node v26.8.1 / bun 1.4.4 / pnpm 10.33.0 / Darwin 25.6.0 arm64.

## A6 premise-change rationale (why a NEW preregistration, not an edit of the old one)

The old package's A6 expected `direct ctx.typert throws 'cannot get property ... without inject'`.
That premise came from a day-1 instrumented copy with NO inject declaration. Change a199bf1
declared `inject:['typert']` (v2.1 clause C; generated `dispatch.ts:13-16` and bridge
`index.ts:354` in the pre-fix tree), so under cordis semantics direct access is legal; the
real host confirmed `direct ctx.typert OK local-present` (`024-base-task5/07-w-roundtrip-real.log:13`).
Oldfox ruling §二 expressly permits re-registering this one line under the premise "inject
declared => direct legal". Per rule 1.4 last sentence, the new expected cites the concrete
clause (v2.1 C / a199bf1 diff) and the old package's FAIL row stays archived unchanged.

NOTE (transparent, written at preregistration time, not from a runtime result): R1 removes the
fabricated `TypertLocalFace`/`local.invoke` call surface; R2 injects `CapHostInvoke`; R3 wires
`session/list` through the shipped `createCapInvoke` export reusing `resolveSessionController`.
R4.3 changes the W-roundtrip probe to drive that shipped export instead of injecting a verbatim
dispatcher copy. These are the fix's own clauses in the oldfox ruling, not runtime observations.

## Preregistered rerun assertions (R1–R7)

| id | rerun item (oldfox §四) | expected (FROZEN) | pass criterion (checkable) | evidence file | depends on |
|----|------------------------|-------------------|----------------------------|---------------|------------|
| R1 | V2d/V3 W roundtrip real via shipped bundle (A5 fixed) | `session/list` via shipped `createCapInvoke` returns non-error `{items}` result; handshake READY observed=75; no `local.invoke is not a function` | real-host smoke stderr shows `[CAP-SMOKE] W roundtrip via createCapInvoke ... "ok":true,"hasItems":true` AND `[handshake] READY observed=%d ... 75 75 0`; no `not a function` | `07-w-roundtrip-shipped.log` | — |
| R2 | A6/V2e re-registration (premise changed) | fallback `list().length=75`; direct `ctx.typert` OK local-present (a199bf1 inject:['typert']); sessionController present=true at stable window | smoke stderr shows `[CAP-SMOKE] direct ctx.typert "OK local-present"`, `"listLength":75`, and `I-probes@stable ... "key":"sessionController","present":true` | `07-w-roundtrip-shipped.log` | R1 |
| R3 | A1/A2 regeneration reconciliation (R6) | `gen-capir --check` byte-identical 43/257 sc=27; `gen-capcontract --check` byte-identical 3 files/257 methods (new baseline); `gen-ledger` two runs sha identical; @manual 12-name set | each generator prints expected byte-identical/sha; check-capcontract `@manual method-name set` PASS (12 names) | `03-regeneration.log` | — |
| R4 | A8/V4 gate + new assertions (R4) | check-capcontract full gate green with new host-face provenance + dispatch executability assertions; negative self-test catches fabricated `*Face`/`local.invoke` | `node scripts/check-capcontract.mjs` → `PASS=13 NOT_RUN=0 FAIL=0` exit 0; `--negative-self-test` → PASS with DETECTED line | `04-gate-full.log`, `04b-gate-negative.log` | R3 |
| R5 | bridge unit tests (R4.2) | all bridge tests green incl. new `capcontract-dispatch.test.ts` (8 cases) and I-probe expectation | `cd packages/bridge && bun test` → `188 pass / 0 fail`; new test file 8 pass | `05-bridge-unittest.log` | — |
| R6 | V2c pos/neg + V3 coldstart/break smoke (I-probe move) | headless suite FAIL=0; real cold start READY observed=75 with `I-probes@stable` (no apply-time I-probes); stdio break graceful close 0 | `bun scripts/verify-capability-handshake.ts` → `summary: FAIL=0`; cold-start/break runs close code=0 with expected log lines | `06-headless-suite.log`, `06b-coldstart.log`, `06c-breakpipe.log` | — |
| R7 | real CI | NOT RUN (push/PR forbidden in fix knife) | report NOT RUN list contains the real-CI item; no push performed | `report.md` | — |

Non-assertion evidence items planned: `01-env-snapshot.log` (rc.5 + SHA), `02-typecheck.log`,
`08-bridge-typecheck.log`, `report.md` (rerun status table + A6 old/new comparison + commit SHA).
Assertion total N=7 (R1–R7); sum of statuses must equal 7.
