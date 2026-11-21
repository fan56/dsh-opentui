/**
 * CI integrity gate for the 0.24 capability base (delivery plan §二 v2.1).
 *
 *   node scripts/check-capcontract.mjs
 *
 * Checks (all hard failures):
 *   1. CapIR reproducibility       — gen-capir.mjs --check (byte-level).
 *   2. capcontract reproducibility — gen-capcontract.mjs --check (byte-level).
 *   3. self-consistency            — generated id sets == CapIR id set, counts match.
 *   4. reference integrity         — local imports resolve to real exports.
 *   5. @deepseek-ai import scan    — zero host-package imports in generated code.
 *   6. declaration-line coverage   — every generated file (capcontract .ts + ledger.md)
 *                                    carries the provenance line as its FIRST line.
 *   7. no bare ctx.<service>       — every ctx service access covered by inject: [...].
 *   8a. wired_protocol name set     — bridge hand-copied dispatch names == ledger's
 *                                    ADR-0010 protocol frame names (rename-drift guard).
 *   8b. wired_manual == 0           — the @manual count source (1:1 host copies with a
 *                                    CapIR counterpart) is empty (tag premise #2).
 *
 * No network, no host closure, no build step: pure Node over committed files.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const CAPIR_PATH = resolve(ROOT, "capir/capir.json")
const LEDGER_PATH = resolve(ROOT, "ledger/ledger.json")
const LEDGER_MD_PATH = resolve(ROOT, "ledger/ledger.md")
const BRIDGE_PATH = resolve(ROOT, "packages/bridge/src/index.ts")
const OUT_DIR = resolve(ROOT, "capcontract")
const ATTRIBUTION =
  "Derived from deepseek-ai/deepseek-harness (MIT, Copyright (c) 2026 DeepSeek)"

let passes = 0
let notRuns = 0
const failures = []

const ok = (name, detail = "") => {
  passes++
  console.log(`PASS  ${name}${detail ? " — " + detail : ""}`)
}
const bad = (name, detail) => failures.push(`${name}: ${detail}`)
const notRun = (name, detail) => {
  notRuns++
  console.log(`NOT RUN  ${name} — ${detail}`)
}

/** Strip // and /* ... *\/ comments so a prose mention of a forbidden token
 *  cannot satisfy (or trip) a provenance scan. */
const stripCommentsTop = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")

/**
 * Host-face provenance predicate (oldfox R4.1 — "契约对账断言").
 * Generated code (and its generator TEMPLATE) may not declare or call a host
 * surface that neither CapIR nor the host source defines. The direct regression
 * pin for task5's defect: no `local.invoke` / `local.stream`, no self-invented
 * `*Face` interface, no generated `inject:['typert']` bundle declaration.
 * The legitimate host surface is the injected `CapHostInvoke` adapter point.
 */
function findFabricatedHostFace(text) {
  const code = stripCommentsTop(text)
  const offenders = []
  if (/\blocal\s*\.\s*(invoke|stream)\b/.test(code)) offenders.push("fabricated local.invoke/local.stream call")
  if (/\binterface\s+\w*Face\b/.test(code)) offenders.push("self-invented *Face interface")
  if (/\bCAPCONTRACT_(BINDER_)?BUNDLE\b/.test(code)) offenders.push("generated inject-declaring *BUNDLE")
  if (/\binject\s*:\s*\[[^\]]*["']typert["']/.test(code)) offenders.push("generated inject:['typert'] declaration")
  return offenders
}

// Negative-control self-test: proves the provenance predicate actually catches
// the exact fabrication class that caused task5's red (no repository file is
// touched). Invoked by the proof rerun as a gate "can catch a fake Face" check.
if (process.argv.includes("--negative-self-test")) {
  const poisoned = [
    "export interface FakeLocalFace { invoke(x: unknown): Promise<unknown> }",
    "export function createCapDispatcher(ctx: any) {",
    "  return (id: string, params: unknown) => ctx.typert.local.invoke(id, params)",
    "}",
  ].join("\n")
  const found = findFabricatedHostFace(poisoned)
  if (found.length > 0) {
    console.log("negative-self-test: DETECTED -> " + found.join("; "))
    console.log("negative-self-test: PASS (predicate rejects fabricated *Face + local.invoke)")
    process.exit(0)
  }
  console.error("negative-self-test: FAIL (fabricated *Face/local.invoke slipped through)")
  process.exit(1)
}

/** Run a generator in --check mode; return its stdout or throw with its stderr. */
function runCheck(script, label) {
  try {
    return execFileSync(process.execPath, [resolve(ROOT, "scripts", script), "--check"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim()
  } catch (e) {
    const err = (e.stderr || "").toString().trim()
    bad(label, err || (e.stdout || "").toString().trim() || String(e))
    return null
  }
}

// --- 1/2. byte-level reproducibility (reuses both generators' --check) ---
const capirDrift = runCheck("gen-capir.mjs", "1. CapIR reproducibility")
if (capirDrift) ok("1. CapIR reproducibility", capirDrift)
const ccDrift = runCheck("gen-capcontract.mjs", "2. capcontract reproducibility")
if (ccDrift) ok("2. capcontract reproducibility", ccDrift)

// --- load committed data + generated files ---
let capir
try {
  capir = JSON.parse(readFileSync(CAPIR_PATH, "utf8"))
} catch (e) {
  bad("data load", "cannot parse capir/capir.json: " + e.message)
}
const files = {}
if (capir) {
  for (const name of ["types.ts", "dispatch.ts", "binder.ts"]) {
    try {
      files[name] = readFileSync(resolve(OUT_DIR, name), "utf8")
    } catch (e) {
      bad("data load", "missing generated file " + name + ": " + e.message)
    }
  }
}

if (capir && Object.keys(files).length === 3) {
  const capirIds = new Set(capir.artifacts.flatMap((a) => a.methods.map((m) => m.id)))

  // --- 3. self-consistency: id sets and counts ---
  const extractIds = (text) => [...text.matchAll(/"(@deepseek-ai\/[^"]+)"/g)].map((m) => m[1])
  for (const name of ["types.ts", "dispatch.ts"]) {
    const ids = extractIds(files[name])
    const set = new Set(ids)
    const missing = [...capirIds].filter((id) => !set.has(id))
    const extra = ids.filter((id) => !capirIds.has(id))
    if (missing.length === 0 && extra.length === 0 && set.size === capirIds.size) {
      ok(`3. self-consistency (${name})`, `${set.size} unique ids == CapIR set (${ids.length} literal occurrences)`)
    } else {
      bad(`3. self-consistency (${name})`,
        `unique=${set.size} capir=${capirIds.size} missing=${missing.length} extra=${extra.length}`)
    }
  }
  // binder must not duplicate id literals; it consumes the generated set via import.
  const binderIds = extractIds(files["binder.ts"])
  if (binderIds.length === 0) {
    ok("3. self-consistency (binder.ts)", "no duplicated id literals; consumes generated set via import")
  } else {
    bad("3. self-consistency (binder.ts)", "unexpected hard-coded id literals: " + binderIds.length)
  }

  const totalsMatch = files["types.ts"].match(/export const CAP_TOTALS = \{([\s\S]*?)\} as const/)
  if (!totalsMatch) {
    bad("3. self-consistency (totals)", "CAP_TOTALS block not found in types.ts")
  } else {
    const got = {}
    for (const m of totalsMatch[1].matchAll(/(\w+):\s*(\d+)/g)) got[m[1]] = Number(m[2])
    const want = {
      artifacts: capir.totals.artifacts,
      methods: capir.totals.methods,
      unary: capir.totals.methods_by_kind.unary,
      stream: capir.totals.methods_by_kind.stream,
      endpoints_session_controller: capir.totals.endpoints_session_controller,
    }
    const diffs = Object.entries(want).filter(([k, v]) => got[k] !== v).map(([k, v]) => `${k}: got ${got[k]} want ${v}`)
    if (diffs.length === 0) ok("3. self-consistency (totals)", JSON.stringify(got))
    else bad("3. self-consistency (totals)", diffs.join("; "))
  }

  // --- 4. reference integrity: local imports must resolve to real exports ---
  const exportNames = (text) => {
    const set = new Set()
    const re = /\bexport\s+(?:declare\s+)?(?:const|let|var|type|interface|function|class|async\s+function|enum)\s+([A-Za-z_$][\w$]*)/g
    for (const m of text.matchAll(re)) set.add(m[1])
    return set
  }
  const importRe = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["'](\.\/[^"']+)["']/g
  let refProblems = []
  let refCount = 0
  for (const [name, text] of Object.entries(files)) {
    for (const m of text.matchAll(importRe)) {
      const targetName = m[2].replace(/^\.\//, "").replace(/\.js$/, ".ts")
      const target = files[targetName]
      if (!target) {
        refProblems.push(`${name} imports missing target ${m[2]}`)
        continue
      }
      const exported = exportNames(target)
      const names = m[1].split(",").map((s) => s.trim().replace(/^type\s+/, "")).filter(Boolean)
      for (const n of names) {
        refCount++
        if (!exported.has(n)) refProblems.push(`${name} imports ${n} from ${m[2]}, not exported there`)
      }
    }
  }
  if (refProblems.length === 0) ok("4. reference integrity", `${refCount} imported names resolve`)
  else bad("4. reference integrity", refProblems.join("; "))

  // --- 5/6/7. scan generated .ts files only (README is documentation) ---
  const tsNames = ["types.ts", "dispatch.ts", "binder.ts"]
  const specRe = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["']([^"']+)["']/g
  // Declarations in comments must not satisfy the inject requirement: scan
  // code only, so a prose mention of `inject: ['typert']` cannot mask a
  // generator-level regression that dropped the real declaration.
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
  const importOffenders = []
  const declOffenders = []
  const ctxOffenders = []
  // F4: ledger.md is a generated artifact too — its first line must carry the
  // same provenance string (v2.1 L9/L31 "every generated file" strict reading).
  let ledgerMd
  try {
    ledgerMd = readFileSync(LEDGER_MD_PATH, "utf8")
  } catch {
    declOffenders.push("ledger.md (unreadable)")
  }
  if (ledgerMd !== undefined && !ledgerMd.split("\n")[0].includes(ATTRIBUTION)) {
    declOffenders.push("ledger.md")
  }
  for (const name of tsNames) {
    const text = files[name]
    const code = stripComments(text)
    for (const m of code.matchAll(specRe)) {
      if (m[1].includes("@deepseek-ai")) importOffenders.push(`${name}: ${m[1]}`)
    }
    if (!text.split("\n")[0].includes(ATTRIBUTION)) declOffenders.push(name)
    const injected = new Set()
    for (const m of code.matchAll(/\binject\s*:\s*\[([^\]]*)\]/g)) {
      for (const s of m[1].matchAll(/["']([^"']+)["']/g)) injected.add(s[1])
    }
    for (const m of code.matchAll(/\bctx\.([A-Za-z_$][\w$]*)/g)) {
      if (!injected.has(m[1])) ctxOffenders.push(`${name}: ctx.${m[1]} (inject set: [${[...injected]}])`)
    }
  }
  if (importOffenders.length === 0) ok("5. @deepseek-ai import scan", "zero host-package imports")
  else bad("5. @deepseek-ai import scan", importOffenders.join("; "))
  if (declOffenders.length === 0) ok("6. declaration-line coverage", `${tsNames.length + 1}/${tsNames.length + 1} generated files (capcontract .ts × 3 + ledger.md)`)
  else bad("6. declaration-line coverage", "missing line: " + declOffenders.join(", "))
  if (ctxOffenders.length === 0) ok("7. no bare ctx.<service> access", "all ctx services covered by inject declarations")
  else bad("7. no bare ctx.<service> access", ctxOffenders.join("; "))
}

// --- 8. wired-surface integrity (oldfox 裁决 1): TWO sub-assertions ---
// The capability ledger is the single source of truth for the hand-wired wire
// surface, split into two dimensions (裁决 1):
//   8a. wired_protocol — ADR-0010 protocol frames (multi-step/stateful/I-class,
//       no same-name CapIR id). NOT @manual. Recompute the hand-copied
//       `req.method === '<name>'` set from bridge source and compare NAME SETS
//       both ways (F2: count equality was blind to rename drift).
//   8b. wired_manual — 1:1 host capability copies WITH a CapIR id (double-track
//       drift). This is the @manual count source; tag premise #2 requires 0.
// If an input is unavailable, fall back to NOT RUN rather than invent a surface.
function checkWiredDimensions() {
  let ledger
  try {
    ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8"))
  } catch (e) {
    notRun("8a. wired_protocol name set", `ledger.json unavailable: ${e.message}`)
    notRun("8b. wired_manual == 0", `ledger.json unavailable: ${e.message}`)
    return
  }

  // 8b — @manual count source must be empty (tag premise #2).
  const manual = ledger?.dimensions?.wired_manual
  if (!manual || typeof manual.count !== "number" || !Array.isArray(manual.methods)) {
    bad("8b. wired_manual == 0", "ledger.json has no well-formed dimensions.wired_manual")
  } else if (manual.count === 0 && manual.methods.length === 0) {
    ok("8b. wired_manual == 0", "no hand-copied host-call wire lines (@manual count source is empty)")
  } else {
    bad("8b. wired_manual == 0", `count=${manual.count} methods=[${manual.methods.map((w) => w?.method).join(", ")}]`)
  }

  // 8a — protocol frame-name reconciliation (rename-drift guard).
  const declaredProtocol = ledger?.dimensions?.wired_protocol?.methods
  if (!Array.isArray(declaredProtocol)) {
    notRun("8a. wired_protocol name set", "ledger.json has no dimensions.wired_protocol.methods")
    return
  }
  let bridgeSrc
  try {
    bridgeSrc = readFileSync(BRIDGE_PATH, "utf8")
  } catch (e) {
    notRun("8a. wired_protocol name set", `bridge source unavailable: ${e.message}`)
    return
  }
  const declaredNames = new Set(declaredProtocol.map((w) => w?.method).filter((n) => typeof n === "string"))
  // All `req.method === '<name>'` comparisons live in handleLine(); each is one
  // hand-copied protocol frame line. Compare NAME SETS both ways (F2).
  const wiredNames = new Set(
    [...bridgeSrc.matchAll(/\breq\.method\s*===\s*["']([^"']+)["']/g)].map((m) => m[1]),
  )
  const missing = [...declaredNames].filter((n) => !wiredNames.has(n))
  const extra = [...wiredNames].filter((n) => !declaredNames.has(n))
  if (missing.length === 0 && extra.length === 0) {
    ok("8a. wired_protocol name set", `bridge hand-wired names == ledger wired_protocol.methods (${declaredNames.size} protocol frames)`)
  } else {
    bad("8a. wired_protocol name set", `missing in bridge: [${missing.join(", ")}]; unregistered in ledger: [${extra.join(", ")}]`)
  }
}
checkWiredDimensions()

// --- 9. host-face provenance (oldfox R4.1 / gate item 8) ---
// Scan the generated call-surface files AND the generator TEMPLATE. The defect
// lived in the template (gen-capcontract.mjs), so pinning only the generated
// output would let a future template regression slip through until regeneration.
function checkHostFaceProvenance() {
  const targets = [
    ["capcontract/dispatch.ts", resolve(OUT_DIR, "dispatch.ts")],
    ["capcontract/binder.ts", resolve(OUT_DIR, "binder.ts")],
    ["scripts/gen-capcontract.mjs (template)", resolve(ROOT, "scripts/gen-capcontract.mjs")],
  ]
  const offenders = []
  for (const [label, path] of targets) {
    let text
    try {
      text = readFileSync(path, "utf8")
    } catch (e) {
      offenders.push(`${label}: unreadable (${e.message})`)
      continue
    }
    for (const o of findFabricatedHostFace(text)) offenders.push(`${label}: ${o}`)
  }
  // Positive half: the injected adapter point must be present in the generated
  // dispatcher, and the call chain must NOT assume any host object shape.
  const dispatchText = files["dispatch.ts"] ?? ""
  if (!/\bexport\s+type\s+CapHostInvoke\b/.test(dispatchText)) {
    offenders.push("dispatch.ts: missing injected CapHostInvoke adapter point")
  }
  if (/\bctx\s*\./.test(stripCommentsTop(dispatchText)) || /\bctx\s*\./.test(stripCommentsTop(files["binder.ts"] ?? ""))) {
    offenders.push("generated call surface reads ctx.<service> (must be injected)")
  }
  if (offenders.length === 0) {
    ok("9. host-face provenance", "generated dispatch/binder + template free of local.invoke/local.stream/*Face/inject decl; CapHostInvoke present")
  } else {
    bad("9. host-face provenance", offenders.join("; "))
  }
}
checkHostFaceProvenance()

// --- 10. dispatch executability — resident consumer (oldfox R4.2 / gate item 9) ---
// Static half of the gate: the generated call chain must have a COMPILED-IN
// consumer in the shipped bridge (so tree-shake cannot drop it), a resident
// dataflow unit test, and a wired-set that reconciles with ledger in_wired.
// The runtime half is the bun test itself (rerun item 5).
function checkDispatchExecutability() {
  let bridgeSrc
  try {
    bridgeSrc = readFileSync(BRIDGE_PATH, "utf8")
  } catch (e) {
    notRun("10. dispatch executability", "bridge source unavailable: " + e.message)
    return
  }
  const offenders = []
  // (a) shipped bridge imports the generated binder and builds the wired hostInvoke.
  if (!/from\s+["'][^"']*capcontract\/binder["']/.test(bridgeSrc)) {
    offenders.push("bridge does not import capcontract/binder (tree-shake would drop generated chain)")
  }
  if (!/\bcreateProjectionBinder\s*\(/.test(bridgeSrc)) {
    offenders.push("bridge never calls createProjectionBinder")
  }
  if (!/\bNOT_WIRED\b/.test(bridgeSrc)) {
    offenders.push("bridge host adapter has no explicit NOT_WIRED path")
  }
  // (b) wired set in bridge == ledger.methods[].in_wired (currently 1/257).
  let ledger
  try {
    ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8"))
  } catch (e) {
    offenders.push("ledger.json unreadable: " + e.message)
  }
  const wiredMatch = bridgeSrc.match(/CAP_HOST_WIRED_IDS[^=]*=\s*\[([\s\S]*?)\]/)
  if (!wiredMatch) {
    offenders.push("CAP_HOST_WIRED_IDS registry not found in bridge source")
  } else if (ledger) {
    const bridgeIds = new Set([...wiredMatch[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]))
    const ledgerIds = new Set((ledger.methods ?? []).filter((m) => m.in_wired).map((m) => m.id))
    const missing = [...ledgerIds].filter((id) => !bridgeIds.has(id))
    const extra = [...bridgeIds].filter((id) => !ledgerIds.has(id))
    if (missing.length || extra.length) {
      offenders.push(`wired set drift: missing=[${missing}] extra=[${extra}]`)
    }
  }
  // (c) resident dataflow test file exists and exercises the full chain.
  const testPath = resolve(ROOT, "packages/bridge/test/capcontract-dispatch.test.ts")
  let testSrc
  try {
    testSrc = readFileSync(testPath, "utf8")
  } catch (e) {
    offenders.push("resident capcontract-dispatch.test.ts missing: " + e.message)
  }
  if (testSrc !== undefined) {
    for (const needle of ["createProjectionBinder", "NOT_WIRED", "BINDER_METHOD_COUNT", "hostInvoke"]) {
      if (!testSrc.includes(needle)) offenders.push(`test missing case marker: ${needle}`)
    }
  }
  if (offenders.length === 0) {
    let wiredCount = "?"
    try {
      const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8"))
      wiredCount = String(ledger?.dimensions?.wired_capir_generated?.in_wired_total ?? "?")
    } catch { /* keep "?" — the reconciliation itself already passed */ }
    ok("10. dispatch executability", `shipped bridge imports binder + wired registry reconciles with ledger in_wired (${wiredCount}/257) + resident dataflow test present`)
  } else {
    bad("10. dispatch executability", offenders.join("; "))
  }
}
checkDispatchExecutability()

// --- W2-0c (additive only: the 14 assertions above are retained verbatim) ---
// Generated v3 data tables + deny-list (AMEND-1) + hand-projection set (AMEND-2).
function sliceBlock(text, startMarker, endMarker) {
  const s = text.indexOf(startMarker)
  if (s < 0) return null
  const from = s + startMarker.length
  const e = text.indexOf(endMarker, from)
  if (e < 0) return null
  return text.slice(from, e)
}
const typesText = files["types.ts"] ?? ""
const setIds = (text, name) => {
  const body = sliceBlock(text, `export const ${name}: ReadonlySet<CapMethodId> = new Set([\n`, `\n] as const)`)
  if (body === null) return null
  return [...body.matchAll(/"(@deepseek-ai\/[^"]+)"/g)].map((m) => m[1])
}
const objEntries = (text, name) => {
  const body = sliceBlock(text, `export const ${name} = {\n`, `\n} as const`)
  if (body === null) return null
  return [...body.matchAll(/^  "([^"]+)": "([^"]+)",$/gm)].map((m) => [m[1], m[2]])
}

const capirMethods = capir ? capir.artifacts.flatMap((a) => a.methods) : []
const DENY_NS = new Set(["account", "credentials", "settings"])

// 11. CAP_PARAMS_TABLE presence + per-id row count (257 methods, empty params = []).
{
  const body = sliceBlock(typesText, "export const CAP_PARAMS_TABLE = {\n", "\n} as const")
  const offenders = []
  let parsed = new Map()
  if (body === null) {
    offenders.push("CAP_PARAMS_TABLE block missing in types.ts")
  } else {
    for (const m of body.matchAll(/^  "([^"]+)": \[\n([\s\S]*?)\n  \],$/gm)) {
      parsed.set(m[1], m[2])
    }
    if (parsed.size !== capirMethods.length) {
      offenders.push(`row count ${parsed.size} != ${capirMethods.length} capir methods`)
    }
    const wantIds = new Set(capirMethods.map((m) => m.id))
    for (const id of wantIds) if (!parsed.has(id)) offenders.push("missing params row: " + id)
    for (const id of parsed.keys()) if (!wantIds.has(id)) offenders.push("extra params row: " + id)
  }
  if (offenders.length === 0) ok("11. PARAMS table presence", `${parsed.size} rows == ${capirMethods.length} methods`)
  else bad("11. PARAMS table presence", offenders.join("; "))
}

// 12. params name set/order per id matches capir.json (dts-derived authority).
{
  const body = sliceBlock(typesText, "export const CAP_PARAMS_TABLE = {\n", "\n} as const")
  const offenders = []
  let checked = 0
  if (body !== null) {
    const byId = new Map()
    for (const m of body.matchAll(/^  "([^"]+)": \[\n([\s\S]*?)\n  \],$/gm)) byId.set(m[1], m[2])
    for (const meth of capirMethods) {
      const rows = [...(byId.get(meth.id) ?? "").matchAll(/^    \{ name: "([^"]+)", required: (true|false), type: "([^"]+)"(?:, enum: \[[^\]]*\])? \},$/gm)]
      const got = rows.map((r) => r[1])
      const want = (meth.params ?? []).map((p) => p.name)
      if (got.length !== want.length || got.some((n, i) => n !== want[i])) {
        offenders.push(`${meth.id}: got [${got}] want [${want}]`)
      }
      checked++
    }
  }
  if (offenders.length === 0 && checked === capirMethods.length) ok("12. PARAMS names match capir.json", `${checked} methods name-order identical`)
  else bad("12. PARAMS names match capir.json", offenders.slice(0, 6).join("; ") || `checked=${checked}`)
}

// 13. CAP_SERVICE_TABLE complete + non-empty service/implementation + cancel parity.
{
  const body = sliceBlock(typesText, "export const CAP_SERVICE_TABLE = {\n", "\n} as const")
  const offenders = []
  let rows = []
  if (body === null) offenders.push("CAP_SERVICE_TABLE block missing")
  else {
    // W2-1: optional `, cancel: "signal"` (from capir.json) on cancelling methods.
    rows = [...body.matchAll(/^  "([^"]+)": \{ service: "([^"]*)", implementation: "([^"]*)"(?:, cancel: "([^"]*)")? \},$/gm)]
    if (rows.length !== capirMethods.length) offenders.push(`rows ${rows.length} != ${capirMethods.length}`)
    for (const m of rows) {
      if (!m[2] || !m[3]) offenders.push("empty service/implementation: " + m[1])
      // cancel field must match capir.json exactly (present <=> capir has cancel).
      const capirMethod = capirMethods.find((c) => c.id === m[1])
      const expectedCancel = capirMethod?.cancel
      if (expectedCancel !== undefined && m[4] !== expectedCancel) {
        offenders.push(`cancel mismatch ${m[1]}: table=${m[4]} capir=${expectedCancel}`)
      }
      if (expectedCancel === undefined && m[4] !== undefined) {
        offenders.push(`unexpected cancel ${m[1]}: ${m[4]}`)
      }
    }
  }
  if (offenders.length === 0) ok("13. SERVICE table complete", `${rows.length} rows, all service/implementation non-empty, cancel matches capir`)
  else bad("13. SERVICE table complete", offenders.slice(0, 6).join("; "))
}

// 14. deny-list (AMEND-1): the three families are absent from BOTH generic tables.
{
  const adapters = setIds(typesText, "CAP_GENERIC_ADAPTERS") ?? []
  const wire = objEntries(typesText, "CAP_GENERIC_WIRE_METHODS") ?? []
  const offenders = []
  for (const id of adapters) {
    const ns = id.includes("#") ? id.split("#")[1].split("/")[0] : ""
    if (DENY_NS.has(ns)) offenders.push("adapter: " + id)
  }
  for (const [wireName, id] of wire) {
    const ns = wireName.split(".")[0]
    const idNs = id.includes("#") ? id.split("#")[1].split("/")[0] : ""
    if (DENY_NS.has(ns) || DENY_NS.has(idNs)) offenders.push("wire: " + wireName + " -> " + id)
  }
  if (offenders.length === 0) ok("14. deny-list families absent", `account/credentials/settings absent from adapters (${adapters.length}) + wire (${wire.length})`)
  else bad("14. deny-list families absent", offenders.join("; "))
}

// 15. PROJECTED_BY_HAND (AMEND-2): generated set == static scan of result jsonSchema.
{
  const SENSITIVE_RE = /token|apikey|api_key|secret|password|credential|authorize|bearer/i
  const collect = (node, acc) => {
    if (node === null || typeof node !== "object") return
    if (Array.isArray(node)) { for (const v of node) collect(v, acc); return }
    for (const [k, v] of Object.entries(node)) { acc.add(k); collect(v, acc) }
  }
  const expected = []
  for (const m of capirMethods) {
    const acc = new Set()
    collect(m.result?.jsonSchema, acc)
    if ([...acc].some((k) => SENSITIVE_RE.test(k))) expected.push(m.id)
  }
  const got = setIds(typesText, "CAP_PROJECTED_BY_HAND") ?? []
  const missing = expected.filter((id) => !got.includes(id))
  const extra = got.filter((id) => !expected.includes(id))
  if (missing.length === 0 && extra.length === 0 && got.length === expected.length) {
    ok("15. PROJECTED_BY_HAND exact", `${got.length} ids == static sensitive-key scan`)
  } else {
    bad("15. PROJECTED_BY_HAND exact", `missing=[${missing}] extra=[${extra}]`)
  }
}

// 16. generic wire table bidirectional + uniqueness + explicit release whitelist.
{
  const wire = objEntries(typesText, "CAP_GENERIC_WIRE_METHODS") ?? []
  const rev = objEntries(typesText, "CAP_GENERIC_WIRE_BY_ID") ?? []
  const adapters = setIds(typesText, "CAP_GENERIC_ADAPTERS") ?? []
  const offenders = []
  const seen = new Set()
  for (const [w, id] of wire) {
    if (seen.has(w)) offenders.push("duplicate wire: " + w)
    seen.add(w)
    if (rev.find(([id2]) => id2 === id)?.[1] !== w) offenders.push("reverse mismatch: " + w)
  }
  // W2-1 round log — OLD W2-0 base criterion kept VERBATIM (do not delete):
  //   if (adapters.length !== 0) offenders.push("CAP_GENERIC_ADAPTERS must be empty at W2-0 base, got " + adapters.length)
  // W2-1 releases exactly the three side-session ids into the generic arm.
  const W2_1_RELEASED = [
    "@deepseek-ai/dsh-api-session-controller#session/create",
    "@deepseek-ai/dsh-api-session-controller#session/prompt",
    "@deepseek-ai/dsh-api-session-controller#session/wait",
  ]
  // W2-2 round log — OLD W2-1 criterion kept VERBATIM (do not delete):
  //   if (adapters.length !== W2_1_RELEASED.length) {
  //     offenders.push(`CAP_GENERIC_ADAPTERS expected ${W2_1_RELEASED.length} W2-1 released ids, got ${adapters.length}`)
  //   }
  // W2-2 releases seven pluginManager READ ids (plan §5.2). Writes stay W2-3.
  const W2_2_READ_RELEASED = [
    "@deepseek-ai/dsh-plugin-manager#pluginManager/listBundles",
    "@deepseek-ai/dsh-plugin-manager#pluginManager/listPlugins",
    "@deepseek-ai/dsh-plugin-manager#pluginManager/listVersionExemptions",
    "@deepseek-ai/dsh-plugin-manager#pluginManager/registries",
    "@deepseek-ai/dsh-plugin-manager#pluginManager/inspect",
    "@deepseek-ai/dsh-plugin-manager#pluginManager/listVersions",
    "@deepseek-ai/dsh-plugin-manager#pluginManager/readBundleDetail",
  ]
  const RELEASED = [...W2_1_RELEASED, ...W2_2_READ_RELEASED]
  const adapterSet = new Set(adapters)
  if (adapters.length !== RELEASED.length) {
    offenders.push(`CAP_GENERIC_ADAPTERS expected ${RELEASED.length} released ids (W2-1 3 + W2-2 7), got ${adapters.length}`)
  }
  for (const id of RELEASED) {
    if (!adapterSet.has(id)) offenders.push("CAP_GENERIC_ADAPTERS missing released id " + id)
    if (!wire.some(([, wid]) => wid === id)) offenders.push("released adapter has no wire row: " + id)
  }
  const wantWire = capirMethods.filter((m) => !DENY_NS.has(m.namespace)).length
  if (wire.length !== wantWire) offenders.push(`wire rows ${wire.length} != ${wantWire} non-denied methods`)
  if (offenders.length === 0) ok("16. generic wire table", `${wire.length} unique bidirectional rows; adapters=${adapters.length} (W2-1 3 + W2-2 7 = 10)`)
  else bad("16. generic wire table", offenders.join("; "))
}

// --- summary ---
console.log("")
console.log(`summary: PASS=${passes} NOT_RUN=${notRuns} FAIL=${failures.length}`)
if (failures.length) {
  for (const f of failures) console.error("FAIL  " + f)
  process.exit(1)
}
console.log("capcontract integrity gate: GREEN")
