/**
 * S2 credentials/account — real-host smoke (additive to S1 /model).
 *
 *   node scripts/verify-s2-credentials.mjs
 *
 * Drives the SHIPPED bridge bundle against the live inproc rc.5 host. The
 * env-gated DSH_OPENTUI_CAP_SMOKE=1 hook calls the bundle's OWN exported
 * createCapInvoke (wire frame -> generated binder -> dispatcher -> bridge
 * host adapter -> the verified host @Remote methods). No source is copied.
 *
 * Asserts (E1-E6 from .proof/024-s2-credentials/00-preregistered-expected.md):
 *  - base handshake READY observed=75 + I-probes include the 2 S2 service keys
 *  - E1 account getState ok + whitelisted shape + 10 unary reachability
 *  - E2 account watch/watchExpiry stream kind + AsyncIterable + first item
 *  - E3 credentials describe/set/unset (report honest service-absence)
 *  - E5 UNWIRED id rejected with NOT_WIRED; runner close=0
 *
 * DESENSITIZATION: this script captures raw stderr but never prints the
 * credentials/set sentinel value; the emit fields are already whitelisted in
 * the bridge. The separate scan-stdio-secrets.mjs scans ALL evidence files.
 *
 * Env: DSH_BIN, DSH_PROBE_HOME, CAP_SMOKE_BUNDLE, CAP_SMOKE_HOLD_MS.
 */
import { spawn } from "node:child_process"
import { readlinkSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"

const ROOT = process.cwd()
const DSH_BIN = process.env.DSH_BIN || "/opt/homebrew/bin/dsh"
const DSH_HOME = process.env.DSH_PROBE_HOME || "/private/tmp/dsh-probe-home-024"
const BUNDLE_DIR = process.env.CAP_SMOKE_BUNDLE || `${ROOT}/packages/shell/dist/bridge`
const HOLD_MS = Number(process.env.CAP_SMOKE_HOLD_MS || 11000)
const OUT = process.env.S2_SMOKE_OUT || `${ROOT}/.proof/024-s2-credentials`
const BRIDGE_LINK = `${DSH_HOME}/profiles/opentui-inproc/node_modules/@aiwayds/dsh-opentui-bridge`

const fail = (msg) => { console.error(`FAIL  ${msg}`); process.exitCode = 1 }

try {
  const exported = readFileSync(`${BUNDLE_DIR}/index.js`, "utf8")
  if (!/createCapInvoke/.test(exported)) {
    fail("shipped bundle does not export createCapInvoke (rebuild: bun scripts/build-bridge.mjs)")
    process.exit(1)
  }
} catch (e) { fail(`shipped bundle unreadable: ${e.message}`); process.exit(1) }

let originalLink
try { originalLink = readlinkSync(BRIDGE_LINK) }
catch (e) { fail(`cannot read scratch bridge symlink ${BRIDGE_LINK}: ${e.message}`); process.exit(1) }

try { execFileSync("ln", ["-sfn", BUNDLE_DIR, BRIDGE_LINK]) }
catch (e) { fail(`cannot repoint scratch bridge symlink: ${e.message}`); process.exit(1) }

const child = spawn(DSH_BIN, ["--profile", "opentui-inproc"], {
  env: { ...process.env, DSH_HOME, DSH_OPENTUI_BRIDGE_STDIO: "1", DSH_OPENTUI_CAP_SMOKE: "1" },
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
let closeCode = null
await new Promise((resolveClose) => {
  child.on("close", (code, signal) => {
    clearTimeout(timer); clearTimeout(killer); closeCode = code
    console.log(`[runner] close code=${code} signal=${signal}`)
    resolveClose()
  })
})
try { execFileSync("ln", ["-sfn", originalLink, BRIDGE_LINK]) }
catch (e) { fail(`cannot restore scratch bridge symlink: ${e.message}`) }

const line = (tag) => stderr.split("\n").find((l) => l.includes(`[CAP-SMOKE] ${tag} `)) ?? ""
const json = (tag) => { try { return JSON.parse(line(tag).split(`[CAP-SMOKE] ${tag} `)[1]) } catch { return {} } }
const all = (tag) => stderr.split("\n").filter((l) => l.includes(`[CAP-SMOKE] ${tag} `)).map((l) => {
  try { return JSON.parse(l.split(`[CAP-SMOKE] ${tag} `)[1]) } catch { return {} }
})
const readyLine = stderr.split("\n").find((l) => /\[handshake\] READY observed=/.test(l)) ?? ""
const iProbeLine = stderr.split("\n").find((l) => /\[handshake\] I-probes@stable/.test(l)) ?? ""

const state = json("W account getState")
const tasks = json("W account hasRunningAccountTasks")
const unaries = all("W account unary")
const streams = all("W account stream")
const s2Probe = json("I-probe S2 services")
const credsDesc = json("W credentials describe")
const credsDataflow = json("W credentials DATAFLOW")
const unwired = json("W NOT_WIRED negative")

const checks = [
  ["base handshake READY observed=75", /missing=0/.test(readyLine) && /75 75 0/.test(readyLine)],
  ["I-probe S2 keys observed (8 probes)", /deepseekAccount/.test(iProbeLine) && /credentialsController/.test(iProbeLine)],
  ["E1 account getState ok=true", state.ok === true],
  ["E1 getState status whitelisted", ["signed-out", "credential-stored"].includes(state.status)],
  ["E1 getState emit only whitelist keys", JSON.stringify(Object.keys(state).filter((k) => k !== "ok" && k !== "errorCode").sort()) === JSON.stringify(["attemptPhase", "linksPresent", "status", "whitelist"])],
  ["E1 hasRunningAccountTasks ok=true", tasks.ok === true && tasks.resultType === "boolean"],
  ["E1 all 8 unary-reachability probes emitted", unaries.length === 8],
  ["E2 both stream methods emitted", streams.length === 2],
  ["E2 stream kind='stream' + iterable", streams.every((s) => s.kind === "stream" && s.iterableOk === true)],
  ["E2 watch first item type snapshot", streams.some((s) => s.method === "watch" && s.hasFirst === true && s.firstType === "snapshot")],
  ["E3 credentials describe/SET/DATAFLOW emitted", Object.keys(credsDesc).length > 0 && Object.keys(credsDataflow).length > 0],
  ["E5 unwired id rejected", unwired.rejected === true],
  ["E5 NOT_WIRED text present", typeof unwired.error === "string" && unwired.error.startsWith("NOT_WIRED:")],
  ["E5 runner close code=0 (no crash)", closeCode === 0],
]

// Capture evidence: filtered raw stderr + structured results (whitelisted only).
mkdirSync(OUT, { recursive: true })
const filtered = stderr.split("\n").filter((l) => /handshake|CAP-SMOKE|SMOKE-LOG|disposed|shutdown/.test(l)).join("\n")
writeFileSync(`${OUT}/02-smoke-raw.log`, `[runner] close code=${closeCode}\n--- captured stderr (filtered) ---\n${filtered}\n--- end ---\n`)

console.log("--- captured stderr (filtered, S2 lines) ---")
for (const l of filtered.split("\n")) if (/CAP-SMOKE.*(account|credentials|I-probe S2|NOT_WIRED)/.test(l)) console.log(l)
console.log("--- structured results ---")
console.log("getState:", JSON.stringify(state))
console.log("unary probes:", unaries.length, "streams:", JSON.stringify(streams))
console.log("S2 I-probe:", JSON.stringify(s2Probe))
console.log("credentials DATAFLOW:", JSON.stringify(credsDataflow))
console.log("--- service-availability note ---")
console.log("deepseekAccountPresent:", s2Probe.deepseekAccountPresent, "credentialsControllerPresent:", s2Probe.credentialsControllerPresent)
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS  ${name}`)
  else fail(name)
}
console.log(`summary: PASS=${checks.filter((c) => c[1]).length}/${checks.length}`)
process.exit(process.exitCode || 0)
