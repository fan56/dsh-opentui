# Proof Report: 024 SK keymap FocusRouter four-tier capture stack

- Gate / 门禁: BLOCKED (render-frame rows only; machine part PASS)
- Profile(s): FEATURE + DESIGN + negative-control
- Expected registered (UTC): 2026-11-20T17:46Z (`00-preregistered-expected.md`); oldfox §四 amendment 17:55Z (`00b-amendment-oldfox-s2-review.md`)
- Change ref: `bf7427732c0aa3a548605dd664c3225be9b48df1` (code commit; report commit is separate)
- Working tree: tracked clean at Change ref; raw `.log` artifacts gitignored per repo convention; prereg + amendment + four `.ans` files committed
- Task: four-tier capture stack (modal > overlay > main > global) unified on ADR-0008 ownership; no handwritten shims; ADR-0008 linkage finalized
- Acceptance target (user verbatim): "实现 FocusRouter 四层捕获栈：统一 ownership、消灭手写垫片；落点遵循 v3 §3.4……门禁：既有测试全绿不删；新增栈行为测试；真机 tmux capture-pane -e 采集 .ans 数值帧（禁 PNG 视觉模型）覆盖：modal 键位归属、turn 跑时 Esc、面板 PgUp/PgDn、基础键位回归。keymap 是 P0 高发区——真机证据必须逐项，不许只跑单测自称 PASS。"
- Changed behaviors: (1) `Keymap.createLayer` ANDs a `capture` tier gate into `enabled` (baseline: pre-change `enabled: enabled() ? options.enabled : false`, verbatim in `00-pre-change.log`, method = saved copy of original source via `git show 4db780a1`); (2) `FocusRouterProvider` replaces `InputOwnershipProvider` in the production tree; (3) dialog/turn-cancel/transcript-scroll/pane-focus/panel-kit-bridge/agents-panel layers declare tiers; (4) ADR-0008 R4 linkage section added
- Touched paths: `packages/tui-base/src/context/focus-router.tsx` (new), `context/keymap.tsx`, `context/panel-kit-host.tsx`, `ui/dialog.tsx`, `routes/session/{turn-cancel,transcript-scroll,pane-focus,agents-panel}.tsx`, `examples/v2-entry.tsx`, `test/focus-router.test.tsx` (new), `scripts/verify-sk-keymap-ans.mjs` (new), `docs/adr/0008-...md`; NOT touched: bridge, inject, keybind config, settings/*
- Evidence directory: `.proof/024-sk-keymap/`
- Assertion total N: 8

## Acceptance assertions / 验收断言

| id | assertion | expected | pass criterion (checkable) | changed path | level | evidence file | depends on |
|----|-----------|----------|----------------------------|--------------|-------|---------------|------------|
| E1 | four-tier precedence matrix | 5 rows x 4 tiers as frozen | all cells equal frozen matrix; single enabled tier off-page | focus-router.tsx:resolveCapture | Artifact | 03b-focus-router-unit.log | — |
| E2 | turn-time Esc ownership + no-shim page layer denied | page owns on page; modal owns under dialog; page denied under panel | N1 unit assertions + reverse case; no shim needed | focus-router.tsx + keymap.tsx:createLayer | Artifact + reverse | 00-pre-change.log, 03b-focus-router-unit.log | E1 |
| E3 | panel PgUp/PgDn ownership | overlay pager wins, transcript denied | N2 unit assertions | focus-router.tsx + panel-kit-host.tsx | Artifact + reverse | 03b-focus-router-unit.log | E1 |
| E4 | existing key regression | 4 keybind strings + priorities + pageOwns alias unchanged | source assertions; keybind.ts diff = none | config/v1/keybind.ts (unchanged) + keymap.tsx | Artifact | 04-key-regression.log | — |
| E5 | ADR-0008 linkage landed | R4 linkage section with 4 clause keywords | grep -c >= 4 | docs/adr/0008-...md | Artifact | 05-adr-linkage.log | — |
| E6 | tests green, no existing assertion deleted | bun test 3082 pass/0 fail; new tests 13 pass; existing test files diff=0 deletions | command exit codes + numstat | tests (new file only) | Artifact | 03-all-tests.log, 03b-focus-router-unit.log | — |
| E7 | real tmux `.ans` frames x4 (modal / esc / paging / basic) | four raw ANSI frames with per-item ownership observation | script executes + raw files landed + honest exit; render ownership = BLOCKED when no host | scripts/verify-sk-keymap-ans.mjs | Artifact + BLOCKED | 06-09-ans-run.log, 06b-ans-retry-stdout.log, 06-ans-*.ans, 07-*.ans, 08-*.ans | E1,E2,E3 |
| E8 | real CI three jobs green | Pack / test ubuntu / test macos success | gh run view conclusion success x3 | CI (config unchanged) | Artifact | 12-ci-result.log | E6 |

Assertion status: E1: PASS | E2: PASS | E3: PASS | E4: PASS | E5: PASS | E6: PASS | E7: BLOCKED (render rows) — machine part: PASS | E8: PASS

## Evidence index / 证据清单

| file | level | what it captures | exact command / action | redaction | sha256(16) |
|------|-------|------------------|------------------------|-----------|-----------|
| 00-pre-change.log | Artifact | pre-change createLayer gate (reverse baseline) | `git show 4db780a1:...keymap.tsx \| sed -n '207,265p'` | n/a | 8f4e99d63561607d |
| 01-env-snapshot.log | Artifact | HEAD/branch/version/date | `date -u; git rev-parse HEAD; dsh --version; ...` | n/a | b5721eef9627ccea |
| 02-gate-full.log | Artifact | capcontract 13/0 GREEN | `node scripts/check-capcontract.mjs` | n/a | c1684eb331957c06 |
| 02b-typecheck.log | Artifact | workspace tsc (pre-existing failures) | `pnpm -r typecheck` | n/a | — |
| 02c-typecheck-baseline.log | Artifact | same failures on clean baseline (stash probe) | baseline `pnpm --filter ... typecheck` | n/a | — |
| 02d-tui-base-typecheck.log | Artifact | 58 pre-existing errors, none in changed files | `pnpm --filter @dsh-opentui/tui-base typecheck` | n/a | — |
| 02e-typecheck-entry.log | Artifact | entry typecheck GREEN | `pnpm run typecheck:entry` | n/a | 747a4a5b501622b1 |
| 03-all-tests.log | Artifact | full suite 3082 pass / 4 skip / 0 fail | `bun test` | n/a | 332c27acd7b6494f |
| 03b-focus-router-unit.log | Artifact | 13 new stack tests, 82 expects | `bun test packages/tui-base/test/focus-router.test.tsx` | n/a | 22f79abd658336e2 |
| 04-key-regression.log | Artifact | keybind/priority/alias unchanged | `git diff --quiet HEAD -- keybind.ts; grep ...` | n/a | 91827c51af1a54f3 |
| 05-adr-linkage.log | Artifact | R4 linkage section + 4 clauses | `grep -n ... docs/adr/0008-...md` | n/a | 400fc11ff066f56f |
| 06-09-ans-run.log | Artifact + BLOCKED | real capture attempt, four-line declaration | `node scripts/verify-sk-keymap-ans.mjs .proof/024-sk-keymap 45` | n/a | 3afcc44dbdf4ba2d |
| 06-09-ans.err.log | Artifact | BRIDGE_TIMEOUT raw stderr | tmux client stderr | n/a | 458fa13c6454af78 |
| 06-ans-modal.ans / 06-ans-esc.ans / 07-ans-pgup-pgdn.ans / 08-ans-basic.ans | Artifact (empty, BLOCKED) | four numerically-captured frames; empty because no renderable host | `tmux capture-pane -e -p -t SESS` | n/a | committed empty files |
| 10-verify70.log | BLOCKED declaration | verify70 not re-run; same wall as S1/S2 | reason/Tried/Excluded/Remaining risk four lines | n/a | — |
| 11-pack.log | Artifact | local pack, tarball bridge entries | `npm pack` in packages/shell | n/a | — |
| 12-ci-trigger.log | Artifact | workflow run URL | `gh workflow run ci.yml --ref feat/024-capir` | n/a | — |
| 12-ci-result.log | Artifact | 3 jobs success, real-client skipped | `gh run view 44788415896 --json ...` | n/a | 996cf9348d365e7b |
| 13-desens-scan.log | Artifact | hits=0 over 26 files | `node scripts/scan-stdio-secrets.mjs .proof/024-sk-keymap` | n/a | 62e6c67906a92748 |

### Raw output: 06-09-ans.err.log (BLOCKED evidence, verbatim key lines)
```
dsh-opentui client boot failed: BridgeBootstrapError: dsh-opentui inproc bridge seam failed [BRIDGE_TIMEOUT]: bridge handshake rejected: no reply for bridge.hello within 30000ms
Fix: dsh-opentui --repair-bridge
```

### Raw output: 12-ci-result.log
```
{"conclusion":"success","jobs":[{"conclusion":"success","name":"Pack / cold start / bridge handshake"},{"conclusion":"success","name":"test (ubuntu-latest)"},{"conclusion":"success","name":"test (macos-latest)"},{"conclusion":"skipped","name":"real-client"}],"status":"completed","url":"https://github.com/fan56/dsh-opentui/actions/runs/44788415896"}
```

## Gate judgment / 门禁判定

- [x] Binding: acceptance target verbatim; touched paths declared; >=1 evidence item on this diff
- [x] Change ref names the code commit (bf74277); working tree free text; changed paths filled
- [x] Every assertion has checkable criterion, changed path, evidence file
- [x] At least one machine verdict (E1–E6, E8 all machine-judged); >=1 reverse case (E2/E3, `00-pre-change.log`)
- [x] `depends on` graph acyclic; no NOT RUN rows
- [x] Real driven I/O at Change ref (tmux capture attempt + CI run + full bun suite)
- [ ] Render-frame assertions (E7) — BLOCKED, not PASS; four-line declaration in `06-09-ans-run.log`

Gate: BLOCKED — machine part PASS. Result: BLOCKED (E7 render rows only; no NOT RUN rows).
`real-client` CI job is skipped by workflow condition `vars.DSH_REAL_CLIENT_GATE == 'true'` (identical to S2 run 44784342341); the three required jobs (Pack / test ubuntu / test macos) are all success.
