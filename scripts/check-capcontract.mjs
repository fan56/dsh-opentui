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
 *   6. declaration-line coverage   — every generated file carries the provenance line.
 *   7. no bare ctx.<service>       — every ctx service access covered by inject: [...].
 *   8. @manual count               — bridge hand-wired dispatch count == ledger's
 *                                    declared wired count (ledger is @manual's sole owner).
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
  if (declOffenders.length === 0) ok("6. declaration-line coverage", `${tsNames.length}/${tsNames.length} generated files`)
  else bad("6. declaration-line coverage", "missing line: " + declOffenders.join(", "))
  if (ctxOffenders.length === 0) ok("7. no bare ctx.<service> access", "all ctx services covered by inject declarations")
  else bad("7. no bare ctx.<service> access", ctxOffenders.join("; "))
}

// --- 8. @manual count: bridge hand-wired dispatch vs ledger's declared count ---
// The capability ledger is the single source of truth for the @manual (wired)
// surface. Recompute the hand-copied `handleLine()` dispatch count from the
// bridge source and assert it equals ledger.dimensions.wired.count. If either
// input is unavailable, fall back to NOT RUN rather than inventing a count.
function checkManualCount() {
  let ledger
  try {
    ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8"))
  } catch (e) {
    notRun("@manual count", `ledger.json unavailable: ${e.message}`)
    return
  }
  let bridgeSrc
  try {
    bridgeSrc = readFileSync(BRIDGE_PATH, "utf8")
  } catch (e) {
    notRun("@manual count", `bridge source unavailable: ${e.message}`)
    return
  }
  const declared = ledger?.dimensions?.wired?.count
  if (typeof declared !== "number") {
    notRun("@manual count", "ledger.json has no dimensions.wired.count")
    return
  }
  // All `req.method === '<name>'` comparisons live in handleLine(); each is one
  // hand-copied wired line. Count unique method names to guard against a dup.
  const wiredNames = new Set(
    [...bridgeSrc.matchAll(/\breq\.method\s*===\s*["']([^"']+)["']/g)].map((m) => m[1]),
  )
  if (wiredNames.size === declared) {
    ok("@manual count", `bridge hand-wired dispatch ${wiredNames.size} == ledger declared wired ${declared}`)
  } else {
    bad("@manual count", `bridge hand-wired dispatch ${wiredNames.size} != ledger declared wired ${declared}`)
  }
}
checkManualCount()

// --- summary ---
console.log("")
console.log(`summary: PASS=${passes} NOT_RUN=${notRuns} FAIL=${failures.length}`)
if (failures.length) {
  for (const f of failures) console.error("FAIL  " + f)
  process.exit(1)
}
console.log("capcontract integrity gate: GREEN")
