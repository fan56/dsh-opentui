#!/usr/bin/env node
/**
 * 024 stdio desensitization scan — slice-ticket deliverable (evidence collection,
 * NOT a test-layer investment; same boundary as the CI integrity gate).
 *
 *   node scripts/scan-stdio-secrets.mjs <evidence-dir>       # scan evidence
 *   node scripts/scan-stdio-secrets.mjs --self-test           # negative control
 *
 * Scans every file in <evidence-dir> for the sink classes the slices whitelist:
 *   1. credential sentinel values (`DSHS2CRED_SENTINEL_*` plus any value=/
 *      value":" carrying a secret-looking string);
 *   2. raw wire-frame dumps (`"params":{...}` with a secret-valued key);
 *   3. common secret shapes (sk-..., ghp_..., Bearer <token>, secret assignment);
 *   4. S4 PKCE auth-URL neighbours (code_challenge= / state= / authorizeUrl field).
 *   5. S4-review §六.2 / S5 S-S5a config-value欠账: credential-bearing keys that
 *      can ride inside a settings/config namespace VALUE document (a whole
 *      config doc must never reach an evidence sink).
 *
 * `--self-test` is the S2-review S3'(a) negative-control gap: it plants one
 * synthetic fixture PER pattern in an isolated temp dir and requires every
 * pattern to fire (detected=true). This proves the scanner is not a no-op for
 * sk-key / ghp / bearer / secret-assignment (previously untested) and for the
 * new S4 auth-URL patterns. No real secret is ever planted or stored.
 *
 * Fixed-shape whitelist fields emitted by the bridge (`status`, `ref`,
 * `errorCode`, presence booleans, `emitWhitelist`, `urlReady`) are NOT secrets
 * and are intentionally allowed. Exit 0 + hits=0 means desensitization held.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { resolve, join } from "node:path"
import { tmpdir } from "node:os"

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
  // (4) S4 PKCE auth-URL neighbours — value patterns, not the bare field name
  { name: "auth-url-challenge", re: /[?&]code_challenge=[A-Za-z0-9._~+/-]{8,}/g },
  { name: "auth-url-state", re: /[?&]state=[A-Za-z0-9._~+/-]{8,}/g },
  { name: "auth-url-field", re: /"(?:authorizeUrl|authorize_url)"\s*:\s*"[^"]{8,}"/g },
  // (5) S4-review §六.2 / S5 S-S5a: config/settings namespace VALUE documents
  // must never carry a credential-shaped key. The field-level allow-list keeps
  // these out at runtime; this pattern is the evidence-sink backstop. Redacted
  // (`***`) values are allowed. Keys overlap secret-value-field on purpose so a
  // config doc leak is caught even if only one pattern's key set is consulted.
  { name: "config-value-secret", re: /"(?:apiKey|api_key|token|accessToken|access_token|refreshToken|refresh_token|secret|clientSecret|client_secret|password|passwd|credential|authorization)"\s*:\s*"(?!\*\*\*)[^"]{4,}"/g },
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

/** One scan pass: returns total hits + a per-pattern count map. */
function scanFiles(files) {
  const byPattern = Object.fromEntries(PATTERNS.map((p) => [p.name, 0]))
  const report = []
  let hits = 0
  for (const f of files) {
    let text
    try { text = readFileSync(f, "utf8") } catch { continue }
    for (const p of PATTERNS) {
      p.re.lastIndex = 0
      let m
      while ((m = p.re.exec(text)) !== null) {
        // Record only pattern + location — the matched value is never echoed.
        hits++
        byPattern[p.name]++
        report.push(`HIT  ${p.name}  ${f}  offset=${m.index}`)
        if (m[0].length === 0) p.re.lastIndex++
      }
    }
  }
  return { hits, byPattern, report }
}

/** S3'(a) negative control: one fixture per pattern, each must be detected. */
function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "dsh-desens-selftest-"))
  const fixtures = {
    "credential-sentinel": "DSHS2CRED_SENTINEL_planted_negative_control",
    "secret-value-field": '{"value":"planted_negative_secret_abc123"}',
    "secret-assignment": 'token = "planted_negative_assignment_abc123"',
    "sk-key": "sk-plantednegativekey0123456789abcdef",
    "ghp-token": "ghp_plantednegativeghp0123456789abcdef",
    "bearer-token": "Bearer plantednegativebearer0123456789abcdef",
    "auth-url-challenge": "https://example.invalid/dsh/authorize?code_challenge=plantedchallenge123456",
    "auth-url-state": "https://example.invalid/dsh/authorize?state=plantedstate123456789",
    "auth-url-field": '{"authorizeUrl":"https://example.invalid/dsh/authorize?code_challenge=x"}',
    // S4-review §六.2 / S5 S-S5a config-value class: a settings namespace VALUE
    // document carrying a credential-shaped key must be detected (no real secret).
    "config-value-secret": '{"ns":"llm-pi-ai","value":{"apiKey":"planted_config_value_secret_abc123"}}',
  }
  try {
    for (const [name, text] of Object.entries(fixtures)) {
      writeFileSync(join(dir, `${name}.txt`), `${text}\n`)
    }
    const { byPattern } = scanFiles(walk(dir))
    // A fixture may legitimately trip more than one pattern; require >=1 each.
    const detected = Object.fromEntries(PATTERNS.map((p) => [p.name, byPattern[p.name] > 0]))
    console.log("=== stdio desensitization scanner — negative control (S3'(a) + S4b-b config-value) ===")
    console.log(`patterns: ${PATTERNS.length}, fixtures: ${Object.keys(fixtures).length}`)
    for (const p of PATTERNS) {
      console.log(`  ${detected[p.name] ? "detected=true " : "detected=false"}  count=${byPattern[p.name]}  ${p.name}`)
    }
    const missing = PATTERNS.filter((p) => !detected[p.name]).map((p) => p.name)
    if (missing.length > 0) {
      console.log(`self-test: FAIL (undetected patterns: ${missing.join(", ")})`)
      process.exit(1)
    }
    console.log("self-test: PASS (every pattern caught a planted negative; scanner is not a no-op)")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const arg = process.argv[2]
if (arg === "--self-test") {
  selfTest()
} else {
  if (!arg) {
    console.error("usage: node scripts/scan-stdio-secrets.mjs <evidence-dir> | --self-test")
    process.exit(2)
  }
  let files = []
  try { files = walk(resolve(arg)) } catch (e) { console.error(`cannot read evidence dir: ${e.message}`); process.exit(2) }
  const { hits, report } = scanFiles(files)
  const sinkClasses = ["wire-frame logs", "CAP-SMOKE emit fields", "proof evidence logs", "S4 PKCE auth-URL neighbours", "config/settings namespace values"]
  console.log("=== stdio desensitization scan ===")
  console.log(`scanned files: ${files.length}`)
  console.log(`sink classes:  ${sinkClasses.join(" | ")}`)
  console.log(`patterns:      ${PATTERNS.map((p) => p.name).join(", ")}`)
  for (const line of report) console.log(line)
  console.log(`hits=${hits}`)
  if (hits === 0) console.log("scan: PASS (no credential/auth URL value reached any evidence sink)")
  else console.log("scan: FAIL")
  process.exit(hits === 0 ? 0 : 1)
}
