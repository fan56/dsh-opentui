/**
 * S1 /model — real-host smoke for the three model W methods (additive).
 *
 *   node scripts/verify-s1-model.mjs
 *
 * Drives the SHIPPED bridge bundle against the live inproc rc.5 host. The
 * env-gated DSH_OPENTUI_CAP_SMOKE=1 hook calls the bundle's OWN exported
 * createCapInvoke (wire frame -> generated binder -> generated dispatcher ->
 * bridge-injected host adapter -> resolveSessionController -> the host
 * SessionController model @Remote methods). No dispatcher source is copied.
 *
 * Asserts (E1-E4 from .proof/024-s1-model/00-preregistered-expected.md):
 *  - E1 modelCatalog ok=true + groups>=1 + default provider/model non-empty
 *  - E2 selectModel ok=true on a real host session + catalog readback
 *  - E3 initializeDefaultModel ok=true (void no-op is acceptable)
 *  - E4 an UNWIRED id rejects with the explicit NOT_WIRED text; runner close=0
 *  - base handshake READY observed=75 + session/list roundtrip ok=true
 *
 * Env: DSH_BIN, DSH_PROBE_HOME, CAP_SMOKE_BUNDLE, CAP_SMOKE_HOLD_MS.
 */
import { spawn } from "node:child_process"
import { readlinkSync, readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { DEFAULT_PROFILE } from "../packages/shell/scripts/lib/profile-name.mjs"

const ROOT = process.cwd()
const DSH_BIN = process.env.DSH_BIN || "/opt/homebrew/bin/dsh"
const DSH_HOME = process.env.DSH_PROBE_HOME || "/private/tmp/dsh-probe-home-024"
const BUNDLE_DIR = process.env.CAP_SMOKE_BUNDLE || `${ROOT}/packages/shell/dist/bridge`
const HOLD_MS = Number(process.env.CAP_SMOKE_HOLD_MS || 9000)
const BRIDGE_LINK = `${DSH_HOME}/profiles/${DEFAULT_PROFILE}/node_modules/@aiwayds/dsh-opentui-bridge`

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

const child = spawn(DSH_BIN, ["--profile", DEFAULT_PROFILE], {
  env: { ...process.env, DSH_HOME, DSH_OPENTUI_BRIDGE_STDIO: "1", DSH_OPENTUI_CAP_SMOKE: "1", ZAI_CODING_CN_API_KEY: "offline-e2e-dummy" },
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
await new Promise((resolve) => {
  child.on("close", (code, signal) => {
    clearTimeout(timer); clearTimeout(killer); closeCode = code
    console.log(`[runner] close code=${code} signal=${signal}`)
    resolve()
  })
})
try { execFileSync("ln", ["-sfn", originalLink, BRIDGE_LINK]) }
catch (e) { fail(`cannot restore scratch bridge symlink: ${e.message}`) }

console.log("--- captured stderr (filtered) ---")
for (const line of stderr.split("\n")) {
  if (/handshake|CAP-SMOKE|SMOKE-LOG|disposed|shutdown/.test(line)) console.log(line)
}
console.log("--- end captured stderr ---")

const line = (tag) => stderr.split("\n").find((l) => l.includes(`[CAP-SMOKE] ${tag} `)) ?? ""
const json = (tag) => { try { return JSON.parse(line(tag).split(`[CAP-SMOKE] ${tag} `)[1]) } catch { return {} } }
const readyLine = stderr.split("\n").find((l) => /\[handshake\] READY observed=/.test(l)) ?? ""

const catalog = json("W modelCatalog")
const selected = json("W selectModel")
const after = json("W modelCatalog after select")
const init = json("W initializeDefaultModel")
const unwired = json("W NOT_WIRED negative")
const list = json("W roundtrip via createCapInvoke")

const checks = [
  ["base handshake READY observed=75", /missing=0/.test(readyLine) && /samples=%d 75 75 0/.test(readyLine)],
  ["base session/list roundtrip ok=true", list.ok === true],
  ["E1 modelCatalog ok=true", catalog.ok === true],
  ["E1 modelCatalog groups>=1", typeof catalog.groups === "number" && catalog.groups >= 1],
  ["E1 modelCatalog default provider/model non-empty", typeof catalog.defaultProvider === "string" && catalog.defaultProvider.length > 0 && typeof catalog.defaultModel === "string" && catalog.defaultModel.length > 0],
  ["E2 selectModel ok=true", selected.ok === true],
  ["E2 selected route matches request", selected.selected && selected.route && selected.selected.provider === selected.route.provider && selected.selected.model === selected.route.model],
  ["E2 catalog default readback non-empty", typeof after.defaultProvider === "string" && after.defaultProvider.length > 0],
  ["E3 initializeDefaultModel ok=true", init.ok === true],
  ["E4 unwired id rejected", unwired.rejected === true],
  ["E4 NOT_WIRED text present", typeof unwired.error === "string" && unwired.error.startsWith("NOT_WIRED:")],
  ["E4 runner close code=0 (no crash)", closeCode === 0],
]
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS  ${name}`)
  else fail(name)
}
console.log(`summary: PASS=${checks.filter((c) => c[1]).length}/${checks.length}`)
process.exit(process.exitCode || 0)
