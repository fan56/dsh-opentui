#!/usr/bin/env node
// gen-ledger.mjs — reproducible capability ledger generator (024 base task 3).
//
// Inputs (both in-repo, immutable during a run):
//   capir/capir.json          — static CapIR full set (43 artifacts / 257 methods), task-1 output
//   ledger/provenance.json    — hand-maintained mapping + evidence data (bundle->contribution-package
//                               mapping, method-level exclusions, measured 75 ids, manual surfaces).
//
// Outputs (fully regenerated on every run, never hand-edited):
//   ledger/ledger.json        — JSON source of truth: per-method rows with expected/wired flags,
//                               provenance, reconciliation result, manual wired + I-class surfaces.
//   ledger/ledger.md          — generated human-readable report.
//
// Reconciliation is a HARD GATE: if the derived expected surface differs from the measured
// steady-state set, the script exits non-zero and writes nothing. Corrections belong in
// ledger/provenance.json (mapping data), NEVER in capir/capir.json.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'))

const capir = read('capir/capir.json')
const prov = read('ledger/provenance.json')

// --- derive expected surface from provenance mapping ------------------------
const artifacts = Object.fromEntries(capir.artifacts.map((a) => [a.package, a]))
const allMethods = capir.artifacts.flatMap((a) => a.methods)
const allIds = new Set(allMethods.map((m) => m.id))

const basePkgs = prov.derivation.base_closure_capir_contribution_packages
const patchPkgs = prov.derivation.profile_patch_contribution_packages.map((p) => p.package)
const contribPkgs = [...new Set([...basePkgs, ...patchPkgs])]
const exclusions = new Set(prov.derivation.method_exclusions.map((e) => e.id))

const expected = new Set()
for (const pkg of contribPkgs) {
  const a = artifacts[pkg]
  if (a === undefined) throw new Error(`mapping references unknown CapIR package: ${pkg}`)
  for (const m of a.methods) if (!exclusions.has(m.id)) expected.add(m.id)
}

// --- reconciliation gate ---------------------------------------------------
const measured = new Set(prov.reconciliation.measured_ids)
const derivedMinusMeasured = [...expected].filter((id) => !measured.has(id)).sort()
const measuredMinusDerived = [...measured].filter((id) => !expected.has(id)).sort()
if (derivedMinusMeasured.length > 0 || measuredMinusDerived.length > 0) {
  console.error('RECONCILIATION FAILED — derived expected surface != measured steady-state set')
  console.error('  derived - measured (extra):', derivedMinusMeasured)
  console.error('  measured - derived (missing):', measuredMinusDerived)
  console.error('  Fix ledger/provenance.json mapping data, then re-run. Do NOT edit capir/capir.json.')
  process.exit(1)
}
for (const id of expected) {
  if (!allIds.has(id)) throw new Error(`expected id not in CapIR full set: ${id}`)
}

// --- assemble ledger -------------------------------------------------------
// oldfox 裁决 1: the hand-wired wire surface splits into two dimensions.
// wired_protocol (ADR-0010 frames, no CapIR counterpart) is NOT @manual;
// wired_manual (1:1 host copies with a CapIR id) IS the @manual count source.
// S1 removed model.currentSelection; the 0.24 final knife removed session.list
// (the last wired_manual entry) onto the generated chain, so wired_manual is 0.
const protocol = prov.wired_protocol.methods
const manual = prov.wired_manual.methods
// The wired CapIR set is the UNION of capir_ids carried by both wire dimensions
// (protocol entries are null today; manual is empty after the 0.24 knife) and
// the generated-capcontract ids. Generated ids are NOT hand-copied req.method
// lines, so they must not inflate either wire-dimension count or #8a's name set.
const generatedWiredIds = (prov.wired_capir_generated?.ids ?? [])
const wiredCapirIds = new Set([...[...protocol, ...manual].map((w) => w.capir_id).filter(Boolean), ...generatedWiredIds])
for (const id of generatedWiredIds) {
  if (!allIds.has(id)) throw new Error(`generated wired id not in CapIR full set: ${id}`)
}

// --- C3 (025-wave2 W2-0e): deferred_reason additive-only gate ---------------
// Provenance carries the 19 显式不做 ids from plan §4.4 (52 gap - 30 必做 - 3 可选).
// The key lands on those gap rows only; ledger schema stays /1 (no bump), and no
// existing key/value is touched. Fail loud on any drift — never silently patch.
const DEFERRED_REASON_VALUES = new Set(['no-tui-consumer', 'stream-no-relay', 'dual-source-risk'])
const deferredBlock = prov.deferred_reasons
if (deferredBlock === undefined) throw new Error('C3: ledger/provenance.json missing deferred_reasons (W2-0e front-door data)')
const declaredEnum = [...(deferredBlock.enum ?? [])].sort()
if (JSON.stringify(declaredEnum) !== JSON.stringify([...DEFERRED_REASON_VALUES].sort())) {
  throw new Error(`C3: deferred_reasons.enum drift: ${declaredEnum.join(', ')}`)
}
const deferred = deferredBlock.ids ?? {}
const deferredIds = Object.keys(deferred)
if (deferredIds.length !== 19) throw new Error(`C3: deferred_reasons.ids must carry exactly 19 ids, got ${deferredIds.length}`)
for (const [id, reason] of Object.entries(deferred)) {
  if (!DEFERRED_REASON_VALUES.has(reason)) throw new Error(`C3: bad deferred_reason "${reason}" for ${id}`)
  if (!allIds.has(id)) throw new Error(`C3: deferred id not in CapIR full set: ${id}`)
  if (!expected.has(id)) throw new Error(`C3: deferred id not in profile expected surface: ${id}`)
  if (wiredCapirIds.has(id)) throw new Error(`C3: deferred id is wired (gap-only): ${id}`)
}

const rows = allMethods
  .map((m) => ({
    id: m.id,
    package: m.id.slice(0, m.id.indexOf('#')),
    namespace: m.namespace,
    name: m.name,
    kind: m.kind,
    class: m.class,
    in_full: true,
    in_expected: expected.has(m.id),
    in_wired: wiredCapirIds.has(m.id),
    provenance: expected.has(m.id)
      ? (basePkgs.includes(m.id.slice(0, m.id.indexOf('#'))) ? 'base-closure' : 'profile-patch')
      : 'full-only',
    // additive-only: present on the 19 deferred ids, absent on the other 238.
    ...(deferred[m.id] === undefined ? {} : { deferred_reason: deferred[m.id] }),
  }))
  .sort((a, b) => a.id.localeCompare(b.id))

const ledger = {
  attribution: prov.attribution,
  schema: 'dsh-opentui.ledger/1',
  generated_by: 'scripts/gen-ledger.mjs',
  inputs: ['capir/capir.json', 'ledger/provenance.json'],
  dimensions: {
    full: {
      artifacts: capir.artifacts.length,
      methods: allMethods.length,
      by_kind: capir.totals.methods_by_kind,
      by_class: capir.totals.methods_by_class,
      endpoints_session_controller: capir.totals.endpoints_session_controller,
      endpoints_global_map_sum: capir.totals.endpoints_global_map_sum,
    },
    expected: {
      profile: prov.profile.name,
      count: expected.size,
      contribution_packages: contribPkgs,
      exclusions: prov.derivation.method_exclusions.map((e) => ({ id: e.id, mapping_kind: e.mapping_kind })),
      method_ids: [...expected].sort(),
    },
    wired_protocol: {
      mark: prov.wired_protocol.mark,
      count: protocol.length,
      methods: protocol,
    },
    wired_manual: {
      mark: prov.wired_manual.mark,
      count: manual.length,
      methods: manual,
    },
    wired_capir_generated: {
      mark: prov.wired_capir_generated?.mark ?? 'n/a',
      count: generatedWiredIds.length,
      ids: generatedWiredIds,
      in_wired_total: rows.filter((r) => r.in_wired).length,
    },
    i_class: {
      mark: prov.i_class_manual.mark,
      count: prov.i_class_manual.services.length,
      services: prov.i_class_manual.services,
    },
    provenance: {
      profile: prov.profile,
      derivation: prov.derivation,
      dsh_base_dep_verification: prov.dsh_base_dep_verification,
    },
  },
  reconciliation: {
    measured_source: prov.reconciliation.measured_source,
    measured_host_binary: prov.reconciliation.measured_host_binary,
    measured_count: measured.size,
    derived_count: expected.size,
    derived_minus_measured: derivedMinusMeasured,
    measured_minus_derived: measuredMinusDerived,
    diff_empty: derivedMinusMeasured.length === 0 && measuredMinusDerived.length === 0,
    first_run_naive_diff: prov.reconciliation.first_run_naive_diff,
    mapping_corrections_applied: prov.reconciliation.mapping_corrections_applied,
  },
  methods: rows,
}

// --- write JSON ------------------------------------------------------------
writeFileSync(resolve(ROOT, 'ledger/ledger.json'), JSON.stringify(ledger, null, 2) + '\n')

// --- write generated markdown ---------------------------------------------
const d = ledger.dimensions
const md = []
// F4 (024 base review): every generated artifact carries the provenance line
// as its FIRST line — including this markdown report, not just ledger.json.
md.push(`<!-- ${ledger.attribution} -->`)
md.push('')
md.push('# Capability Ledger (generated)')
md.push('')
md.push('> Generated by `scripts/gen-ledger.mjs` from `capir/capir.json` + `ledger/provenance.json`. Do not hand-edit.')
md.push('')
md.push(`attribution: ${ledger.attribution}`)
md.push('')
md.push('## Dimensions')
md.push('')
md.push('| Dimension | Count | Notes |')
md.push('|---|---:|---|')
md.push(`| Full (CapIR) | ${d.full.methods} methods / ${d.full.artifacts} artifacts | unary ${d.full.by_kind.unary} / stream ${d.full.by_kind.stream}; class W ${d.full.by_class.W}; endpoints: sc ${d.full.endpoints_session_controller}, global map sum ${d.full.endpoints_global_map_sum} |`)
md.push(`| Profile expected | ${d.expected.count} methods | profile ${d.expected.profile}; ${d.expected.contribution_packages.length} contribution packages; ${d.expected.exclusions.length} method exclusion(s) |`)
md.push(`| Wired protocol (ADR-0010, not @manual) | ${d.wired_protocol.count} frames | ${d.wired_protocol.mark} |`)
md.push(`| Wired manual (@manual host-copy) | ${d.wired_manual.count} methods | ${d.wired_manual.mark} |`)
md.push(`| Wired (generated capcontract) | ${d.wired_capir_generated.count} methods | ${d.wired_capir_generated.mark} |`)
md.push(`| in_wired total (of ${d.full.methods}) | ${d.wired_capir_generated.in_wired_total} methods | union of wire-dim capir_ids + generated ids |`)
md.push(`| I-class (manual) | ${d.i_class.count} services | ${d.i_class.mark} |`)
md.push('')
md.push('## Reconciliation (first-run closure)')
md.push('')
md.push(`- derived expected surface: **${ledger.reconciliation.derived_count}**`)
md.push(`- measured steady-state (probe §3.2): **${ledger.reconciliation.measured_count}**`)
md.push(`- diff empty: **${ledger.reconciliation.diff_empty ? 'YES' : 'NO'}**`)
md.push('- derived − measured (extra): ' + (ledger.reconciliation.derived_minus_measured.length ? ledger.reconciliation.derived_minus_measured.join(', ') : '(empty)'))
md.push('- measured − derived (missing): ' + (ledger.reconciliation.measured_minus_derived.length ? ledger.reconciliation.measured_minus_derived.join(', ') : '(empty)'))
md.push('')
md.push('Naive first run (declared closure only) derived **49** methods; diff extra 1 (permissionPresets/set), missing 27 (session-controller).')
md.push('Corrections applied in provenance mapping data:')
for (const c of ledger.reconciliation.mapping_corrections_applied) md.push(`  - ${c}`)
md.push('')
md.push('## Contribution package mapping (profile expected surface)')
md.push('')
for (const pkg of d.expected.contribution_packages) {
  const origin = basePkgs.includes(pkg) ? 'base-closure' : 'profile-patch'
  const cnt = artifacts[pkg].methods_dts
  md.push(`- [${origin}] ${pkg} — ${cnt} methods`)
}
md.push('')
md.push('## Method exclusions')
md.push('')
for (const e of prov.derivation.method_exclusions) md.push(`- ${e.id} — ${e.reason}`)
md.push('')
md.push('## Wired protocol frames (ADR-0010, excluded from @manual)')
md.push('')
md.push('| method | kind | source line | protocol nature |')
md.push('|---|---|---:|---|')
for (const w of d.wired_protocol.methods) md.push(`| ${w.method} | ${w.kind} | ${w.source_line} | ${w.note ?? '—'} |`)
md.push('')
md.push('## Wired manual host-copy (@manual count source — must be 0)')
md.push('')
md.push('| method | kind | source line | CapIR id mapping |')
md.push('|---|---|---:|---|')
for (const w of d.wired_manual.methods) md.push(`| ${w.method} | ${w.kind} | ${w.source_line} | ${w.capir_id ?? '—'} |`)
md.push('')
md.push('## Wired CapIR ids via generated capcontract (S1)')
md.push('')
md.push('Not hand-copied `req.method` lines — reconciled with `CAP_HOST_WIRED_IDS` by check-capcontract #10.')
md.push('')
for (const id of d.wired_capir_generated.ids) md.push(`- ${id}`)
md.push('')
md.push('## I-class services (manual registry)')
md.push('')
md.push('| service | members | call sites | W migration |')
md.push('|---|---|---|---|')
for (const s of d.i_class.services) md.push(`| ${s.key} | ${s.members.join(', ')} | ${s.call_sites.join(', ')} | ${s.w_migration} |`)
md.push('')
md.push('## dsh-base dependency verification')
md.push('')
md.push(`- question: ${prov.dsh_base_dep_verification.question}`)
md.push(`- answer: **${prov.dsh_base_dep_verification.answer ? 'YES' : 'NO'}**`)
md.push(`- evidence: ${prov.dsh_base_dep_verification.evidence}`)
md.push(`- conclusion: ${prov.dsh_base_dep_verification.conclusion}`)
md.push('')
md.push('## Full × expected × wired method index (257 rows)')
md.push('')
md.push('| # | id | kind | in_full | in_expected | in_wired | provenance |')
md.push('|---:|---|---|:---:|:---:|:---:|---|')
rows.forEach((r, i) => md.push(`| ${i + 1} | ${r.id} | ${r.kind} | ${r.in_full ? 'Y' : 'N'} | ${r.in_expected ? 'Y' : 'N'} | ${r.in_wired ? 'Y' : 'N'} | ${r.provenance} |`))
// C3 (W2-0e) — appended section only; no existing line above is rewritten.
md.push('')
md.push('## Deferred (no-do) methods — 19 (W2-0e, C3 additive-only)')
md.push('')
md.push('> `deferred_reason` is an additive-only key on the 19 gap rows; schema stays `dsh-opentui.ledger/1`. Source: `025-wave2-plan.md` v1.1 §4.4 显式不做清单.')
md.push('')
md.push('| id | deferred_reason |')
md.push('|---|---|')
for (const [id, reason] of Object.entries(deferred)) md.push(`| ${id} | ${reason} |`)

writeFileSync(resolve(ROOT, 'ledger/ledger.md'), md.join('\n') + '\n')

console.log(`ledger: full=${d.full.methods} expected=${d.expected.count} wired_protocol=${d.wired_protocol.count} wired_manual=${d.wired_manual.count} iclass=${d.i_class.count} diff_empty=${ledger.reconciliation.diff_empty}`)
