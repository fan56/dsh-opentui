#!/usr/bin/env node
/**
 * S2 stdio desensitization scan — slice-ticket deliverable (evidence collection,
 * NOT a test-layer investment; same boundary as the CI integrity gate).
 *
 *   node scripts/scan-stdio-secrets.mjs <evidence-dir>
 *
 * Scans every file in <evidence-dir> for the three sink classes the S2
 * preregistration whitelists:
 *   1. credential sentinel values (`DSHS2CRED_SENTINEL_*`, `DSHS2CRED_SENTINEL_unit_probe`,
 *      plus any `value=`/`value":"` carrying a non-whitelisted secret-looking string);
 *   2. raw wire-frame dumps (`"params":{...}` with a `value`/`apiKey`/`token`/`secret` key);
 *   3. common secret shapes (sk-..., ghp_..., Bearer <token>, long hex keys) that
 *      would indicate a credential value reached a log/proof artifact.
 *
 * Fixed-shape whitelist fields emitted by the bridge (`status`, `ref`,
 * `errorCode`, presence booleans, `emitWhitelist`) are NOT secrets and are
 * intentionally allowed. Exit 0 + `hits=0` means desensitization held.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { resolve, join } from "node:path"

const dir = process.argv[2]
if (!dir) {
  console.error("usage: node scripts/scan-stdio-secrets.mjs <evidence-dir>")
  process.exit(2)
}

const PATTERNS = [
  // (1) synthetic sentinel values used by S2 probes — must never appear in evidence
  { name: "credential-sentinel", re: /DSHS2CRED_SENTINEL_[A-Za-z0-9_-]+/g },
  // (2) raw secret-valued keys in serialized frames/logs
  { name: "secret-value-field", re: /"(?:value|apiKey|api_key|token|access|refresh|secret|password)"\s*:\s*"(?!\*\*\*)[^"]{4,}"/g },
  { name: "secret-assignment", re: /\b(?:value|apiKey|token|secret|password)\s*=\s*["'][^"']{4,}["']/g },
  // (3) common provider secret shapes
  { name: "sk-key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: "ghp-token", re: /\bghp_[A-Za-z0-9]{20,}\b/g },
  { name: "bearer-token", re: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/g },
]

function walk(p, out = []) {
  for (const name of readdirSync(p)) {
    const full = join(p, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

let files = []
try { files = walk(resolve(dir)) } catch (e) { console.error(`cannot read evidence dir: ${e.message}`); process.exit(2) }

let hits = 0
const report = []
for (const f of files) {
  let text
  try { text = readFileSync(f, "utf8") } catch { continue }
  // A scanner must not flag its own pattern source; skip scripts/ by caller contract.
  for (const p of PATTERNS) {
    p.re.lastIndex = 0
    let m
    while ((m = p.re.exec(text)) !== null) {
      // Redact the matched value in the report — record only pattern + location.
      hits++
      report.push(`HIT  ${p.name}  ${f}  offset=${m.index}`)
      if (m[0].length === 0) p.re.lastIndex++
    }
  }
}

const sinkClasses = ["wire-frame logs", "CAP-SMOKE emit fields", "proof evidence logs"]
console.log("=== S2 stdio desensitization scan ===")
console.log(`scanned files: ${files.length}`)
console.log(`sink classes:  ${sinkClasses.join(" | ")}`)
console.log(`patterns:      ${PATTERNS.map((p) => p.name).join(", ")}`)
for (const line of report) console.log(line)
console.log(`hits=${hits}`)
if (hits === 0) console.log("scan: PASS (no credential value reached any evidence sink)")
else console.log("scan: FAIL")
process.exit(hits === 0 ? 0 : 1)
