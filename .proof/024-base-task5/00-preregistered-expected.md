# PREREGISTRATION — frozen expected values (write-once, never edited)

This file was written to disk BEFORE any verification command was run. It is the
preregistered `expected` column for the task-5 report. Do not edit after capture.
Status/observed values are decided later against the `pass criterion` column and
live in `report.md`, never by rewriting `expected` here.

- Preregistered at (UTC): 2026-11-20T14:08Z
- Change ref under test: a199bf1f37be897576f2359c4fde26c34e0186e2 (base HEAD; base range 08cd2a8..a199bf1 off origin/main@2a2c5e2)
- Tree state at preregistration: `git status --short` empty (clean); HEAD a199bf1
- Profile(s): FEATURE + DATAFLOW
- Evidence directory: .proof/024-base-task5/

Acceptance target (user verbatim): "任务：dsh-opentui 0.24 底座任务 5——底座整体验证（V1–V4）与 proof 证据包" ; pass line "禁止编造；红就红着报。"

NOTE (transparent, written at preregistration time, not from a runtime result):
source inspection of `/Users/qingguee/repo/deepseek-harness-pr/packages/typert/registry/src/service.ts:531-539`
shows the real host `typert.local` = `{ get, hasSeen, list, subscribe }` (no
`invoke`/`stream`), while the generated capcontract dispatcher
`capcontract/dispatch.ts createCapDispatcher()` calls `local.invoke(...)` /
`local.stream(...)`. A5's expected is therefore the INTENDED behavior; if the
real-host runtime does not match it, A5 is recorded FAIL by its pass criterion,
never by rewriting this expected. This is a potential big defect to escalate,
not a grounds for a silent fix.

## Preregistered acceptance assertions (A1–A8)

| id | assertion | expected (FROZEN) | pass criterion (checkable) | changed path | level required | planned evidence file | depends on |
|----|-----------|-------------------|----------------------------|--------------|----------------|-----------------------|------------|
| A1 | CapIR true source regenerates byte-identically and counts reconcile | `gen-capir --check = byte-identical (artifacts=43 methods=257); session-controller endpoints=27` | `node scripts/gen-capir.mjs --check` exit 0 prints `byte-identical (artifacts=43 methods=257)`; node count of `capir/capir.json` session-controller endpoint ids = 27 | capir/capir.json (base 08cd2a8) | Artifact | 03-capir-counts.log | |
| A2 | Ledger first report + provenance chain, idempotent | `full=257 expected=75 wired=12 iclass=6 diff_empty=true; provenance chain present; two runs sha256 identical` | `node scripts/gen-ledger.mjs` prints `full=257 expected=75 wired=12 iclass=6 diff_empty=true`; `ledger.json.reconciliation.diff_empty === true`; provenance.derivation has closure+patch+exclusions; two consecutive runs produce identical ledger.json sha256 | ledger/ledger.json (a199bf1) | Artifact | 04-ledger-report.log | A1 |
| A3 | Real dsh cold start logs PENDING then READY on the stable 75-id surface | `PENDING first; READY observed=75 expected=75 missing=0 fullOnlyIgnored=182; no DEGRADED` | captured host stderr contains `[handshake] PENDING` before `[handshake] READY observed=75 expected=75 missing=0`; no `[handshake] DEGRADED` line | packages/bridge/src/handshake.ts (a199bf1) | Artifact (real driven I/O) | 05-real-coldstart.log | |
| A4 | Inflated expected baseline on a stable non-empty surface → DEGRADED, no crash; PENDING has no degradation | `PENDING no degradation; stable surface + inflated expected -> DEGRADED missing=1 subclass absent; headless suite exit 0` | `bun scripts/verify-capability-handshake.ts` case2 assertions PASS, `summary: FAIL=0`, process exit 0; raw logs show PENDING then DEGRADED with missing=1 | packages/bridge/src/handshake.ts (a199bf1) | Artifact + reverse | 02-pre-change.log, 06-handshake-negative.log | |
| A5 | One real W capability invoked via generated dispatch chain on the real inproc host returns a non-error result | `createCapDispatcher(ctx) dispatch of @deepseek-ai/dsh-api-session-controller#session/list returns a non-error result on the real host` | real-host probe stderr shows the dispatched W id reaching `typert.local` and a returned value (no `TypeError`/`not a function`); CAP_DISPATCH_TABLE marks it `unary` | capcontract/dispatch.ts (23d504c) | Artifact (real driven I/O) | 07-w-roundtrip-real.log | A3 |
| A6 | ctx.get('typert') fallback resolves the 75-id surface; direct ctx.typert throws; sessionController probe cause determined | `fallback local.list().length=75; direct ctx.typert throws 'cannot get property ... without inject'; sessionController present=false with a stated cause (service-name mismatch vs truly absent)` | real-host probe stderr shows fallback list=75, direct-access error text, and a written conclusion for sessionController backed by an enumerated host service-name check | packages/bridge/src/handshake.ts resolveLocal fallback (a199bf1) | Artifact | 08-fallback-iprobe.log | A3 |
| A7 | stdio pipe break yields an explicit error/shutdown rather than silent hang or unhandled crash | `closing stdio pipe -> explicit error/dispose message within timeout; no unhandled crash` | runner log shows an explicit transport error/dispose line after the pipe is closed, before runner timeout | packages/bridge/src/index.ts stdio seam (a199bf1 lifecycle) | Artifact + reverse | 09-stdio-break.log | A3 |
| A8 | Local check-capcontract full gate green; real CI explicitly NOT RUN | `check-capcontract PASS=11 NOT_RUN=0 FAIL=0 exit 0; real CI = NOT RUN (push out of scope)` | gate stdout shows `summary: PASS=11 NOT_RUN=0 FAIL=0` and exit 0; report NOT RUN list contains the real-CI item | scripts/check-capcontract.mjs (a199bf1) | Artifact | 10-ci-gate.log | A1, A2 |

Non-assertion evidence items planned: 01-env-snapshot.log (V1), 11-bridge-unittest.log
(environment attribution of the 1 fail), 12-injection-restore.log (restore proof,
diff clean). V1-V4 status table, NOT RUN list, USER-JUDGMENT list and final gate
live in report.md.
