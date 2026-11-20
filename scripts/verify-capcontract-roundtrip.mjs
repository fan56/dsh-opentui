/**
 * 024 base task5b — real-host W roundtrip smoke (oldfox R4.3, rerun item 1).
 *
 *   node scripts/verify-capcontract-roundtrip.mjs
 *
 * Drives the SHIPPED bridge bundle against the live inproc host. The bridge's
 * env-gated `DSH_OPENTUI_CAP_SMOKE=1` hook calls the bundle's OWN exported
 * `createCapInvoke` (wire frame -> generated binder -> generated dispatcher ->
 * bridge-injected host adapter -> resolveSessionController -> sessionController
 * .list). No dispatcher source is copied or injected into a /tmp bundle: the
 * code under test is byte-for-byte the shipped artifact.
 *
 * Asserts (all must hold):
 *  - handshake reaches READY observed=75 (surface unchanged by the fix)
 *  - `[CAP-SMOKE] W roundtrip via createCapInvoke ... ok=true hasItems=true`
 *  - direct `ctx.typert` is OK (a199bf1 inject:['typert'] declared — A6)
 *  - `I-probes@stable` records sessionController present=true (oldfox §三)
 *
 * The scratch home's bridge symlink is temporarily repointed at the freshly
 * built shipped bundle and always restored in `finally`. Env overrides:
 *   DSH_BIN, DSH_PROBE_HOME, CAP_SMOKE_BUNDLE, CAP_SMOKE_HOLD_MS
 */
import { spawn } from "node:child_process"
import { readlinkSync, readFileSync, existsSync } from "node:fs"

const ROOT = process.cwd()
const DSH_BIN = process.env.DSH_BIN || "/opt/homebrew/bin/dsh"
const DSH_HOME = process.env.DSH_PROBE_HOME || "/private/tmp/dsh-probe-home-024"
const BUNDLE_DIR = process.env.CAP_SMOKE_BUNDLE || `${ROOT}/packages/shell/dist/bridge`
const HOLD_MS = Number(process.env.CAP_SMOKE_HOLD_MS || 6000)
const BRIDGE_LINK = `${DSH_HOME}/profiles/opentui-inproc/node_modules/@aiwayds/dsh-opentui-bridge`

const fail = (msg) => {
  console.error(`FAIL  ${msg}`)
  process.exitCode = 1
}

// Precondition: the shipped bundle must expose the real export we are about to
// drive (and no fabricated local.invoke surface).
try {
  const exported = readFileSync(`${BUNDLE_DIR}/index.js`, "utf8")
  if (!/createCapInvoke/.test(exported)) {
    fail("shipped bundle does not export createCapInvoke (rebuild with: bun scripts/build-bridge.mjs)")
    process.exit(1)
  }
} catch (e) {
  fail(`shipped bundle unreadable: ${e.message}`)
  process.exit(1)
}

let originalLink
try {
  originalLink = readlinkSync(BRIDGE_LINK)
} catch (e) {
  fail(`cannot read scratch bridge symlink ${BRIDGE_LINK}: ${e.message}`)
  process.exit(1)
}

const { execFileSync } = await import("node:child_process")
try {
  execFileSync("ln", ["-sfn", BUNDLE_DIR, BRIDGE_LINK])
} catch (e) {
  fail(`cannot repoint scratch bridge symlink: ${e.message}`)
  process.exit(1)
}

const child = spawn(DSH_BIN, ["--profile", "opentui-inproc"], {
  env: {
    ...process.env,
    DSH_HOME,
    DSH_OPENTUI_BRIDGE_STDIO: "1",
    DSH_OPENTUI_CAP_SMOKE: "1",
  },
  stdio: ["pipe", "pipe", "pipe"],
})
let stderr = ""
child.stderr.setEncoding("utf8")
child.stderr.on("data", (c) => { stderr += c })
let stdout = ""
child.stdout.setEncoding("utf8")
child.stdout.on("data", (c) => { stdout += c })
child.on("error", (e) => { stderr += `\n[runner] spawn error ${String(e)}\n` })

const timer = setTimeout(() => { try { child.kill("SIGTERM") } catch {} }, HOLD_MS)
const killer = setTimeout(() => { try { child.kill("SIGKILL") } catch {} }, HOLD_MS + 2000)

await new Promise((resolve) => {
  child.on("close", (code, signal) => {
    clearTimeout(timer)
    clearTimeout(killer)
    console.log(`[runner] close code=${code} signal=${signal}`)
    resolve()
  })
})

// Restore the scratch symlink no matter the verdict.
try {
  execFileSync("ln", ["-sfn", originalLink, BRIDGE_LINK])
} catch (e) {
  fail(`cannot restore scratch bridge symlink: ${e.message}`)
}

console.log("--- captured stderr (filtered) ---")
for (const line of stderr.split("\n")) {
  if (/handshake|CAP-SMOKE|SMOKE-LOG|disposed|shutdown/.test(line)) console.log(line)
}
console.log("--- end captured stderr ---")

// The logger tee keeps the printf-style format string and appends args (the
// same shape as the task5 evidence), so READY is `observed=%d ... samples=%d 75 75 0 ...`.
const readyLine = stderr.split("\n").find((l) => /\[handshake\] READY observed=/.test(l)) ?? ""
const readyOk = /missing=0/.test(readyLine) && /samples=%d 75 75 0/.test(readyLine)
const iStableLine = stderr.split("\n").find((l) => /I-probes@stable/.test(l)) ?? ""

const checks = [
  ["handshake READY observed=75 expected=75 missing=0", readyOk],
  ["W roundtrip via shipped createCapInvoke ok=true", /\[CAP-SMOKE\] W roundtrip via createCapInvoke .*"ok":true/.test(stderr)],
  ["W roundtrip hasItems=true", /\[CAP-SMOKE\] W roundtrip via createCapInvoke .*"hasItems":true/.test(stderr)],
  ["direct ctx.typert OK (A6 inject)", /\[CAP-SMOKE\] direct ctx\.typert "OK local-present"/.test(stderr)],
  ["fallback ctx.get typert list=75 (A6)", /\[CAP-SMOKE\] ctx\.get typert fallback .*"listLength":75/.test(stderr)],
  ["I-probes@stable sessionController present=true", /I-probes@stable/.test(iStableLine) && /"key":"sessionController","present":true/.test(iStableLine)],
]
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS  ${name}`)
  else fail(name)
}
console.log(`summary: PASS=${checks.filter((c) => c[1]).length}/${checks.length}`)
process.exit(process.exitCode || 0)
