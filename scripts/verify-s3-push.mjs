/**
 * S3 主动推 — real-host stdio push proof (evidence collector, not a test layer).
 *
 * Spawns the REAL host with the shipped bridge bundle, speaks the stdio
 * protocol (bridge.hello → session.open), and captures the host→client
 * `cap.event` / `cap.end` frames produced by the S3 push relay. Only whitelisted
 * fields (methodId / sessionId / seq / eventType / reason) are printed.
 *
 *   node scripts/verify-s3-push.mjs [--hold-ms N]
 *
 * The scratch bridge symlink is repointed at dist/bridge and always restored.
 */
import { spawn, execFileSync } from "node:child_process"
import { readlinkSync, readFileSync } from "node:fs"

const ROOT = process.cwd()
const DSH_BIN = process.env.DSH_BIN || "/opt/homebrew/bin/dsh"
const DSH_HOME = process.env.DSH_PROBE_HOME || "/private/tmp/dsh-probe-home-024"
const BUNDLE_DIR = process.env.CAP_SMOKE_BUNDLE || `${ROOT}/packages/shell/dist/bridge`
const BRIDGE_LINK = `${DSH_HOME}/profiles/opentui-inproc/node_modules/@aiwayds/dsh-opentui-bridge`
const HOLD_MS = Number(process.argv[2] || 6000)

const fail = (message) => { console.error(`FAIL  ${message}`); process.exitCode = 1 }

try {
  if (!/createCapInvoke/.test(readFileSync(`${BUNDLE_DIR}/index.js`, "utf8"))) {
    fail("shipped bundle lacks createCapInvoke — rebuild first")
    process.exit(1)
  }
} catch (e) {
  fail(`bundle unreadable: ${e.message}`)
  process.exit(1)
}

let originalLink
try { originalLink = readlinkSync(BRIDGE_LINK) } catch (e) {
  fail(`cannot read scratch bridge symlink: ${e.message}`)
  process.exit(1)
}
execFileSync("ln", ["-sfn", BUNDLE_DIR, BRIDGE_LINK])

const child = spawn(DSH_BIN, ["--profile", "opentui-inproc"], {
  env: { ...process.env, DSH_HOME, DSH_OPENTUI_BRIDGE_STDIO: "1" },
  stdio: ["pipe", "pipe", "pipe"],
})
let stdout = ""
child.stdout.setEncoding("utf8")
child.stdout.on("data", (chunk) => { stdout += chunk })
let stderr = ""
child.stderr.setEncoding("utf8")
child.stderr.on("data", (chunk) => { stderr += chunk })

const send = (frame) => child.stdin.write(`${JSON.stringify(frame)}\n`)
send({ id: 1, method: "bridge.hello", params: { protocolVersion: 1 } })
await new Promise((resolve) => setTimeout(resolve, 1200))
send({ id: 2, method: "session.open", params: { mode: "new" } })
await new Promise((resolve) => setTimeout(resolve, HOLD_MS))

try { child.kill("SIGTERM") } catch { /* already gone */ }
const killer = setTimeout(() => { try { child.kill("SIGKILL") } catch { /* already gone */ } }, 2000)
await new Promise((resolve) => child.on("close", () => resolve()))
clearTimeout(killer)
try { execFileSync("ln", ["-sfn", originalLink, BRIDGE_LINK]) } catch (e) {
  fail(`cannot restore scratch bridge symlink: ${e.message}`)
}

const frames = stdout.split("\n").filter(Boolean).flatMap((line) => {
  try { return [JSON.parse(line)] } catch { return [] }
})
const capEvents = frames.filter((f) => f.type === "cap.event" && f.payload && typeof f.payload === "object")
const capEnds = frames.filter((f) => f.type === "cap.end" && f.payload && typeof f.payload === "object")
const hello = frames.find((f) => f.id === 1)
const opened = frames.find((f) => f.id === 2)
const seqsByMethod = {}
for (const frame of capEvents) {
  const p = frame.payload
  if (typeof p.seq !== "number" || typeof p.methodId !== "string" || typeof p.sessionId !== "string") continue
  const key = p.methodId.split("#").at(-1)
  ;(seqsByMethod[key] ??= []).push(p.seq)
}
const summary = {
  source: "real host stdio (shipped bridge bundle)",
  host_reply_bridge_hello: hello?.ok === true,
  host_reply_session_open: opened?.ok === true,
  cap_event_count: capEvents.length,
  cap_end_count: capEnds.length,
  seqs_by_method: seqsByMethod,
  session_ids: [...new Set(capEvents.map((f) => f.payload.sessionId))],
  whitelist: ["methodId", "sessionId", "seq", "eventType", "reason"],
}
console.log(`SUMMARY ${JSON.stringify(summary)}`)
for (const f of capEvents) {
  const p = f.payload
  console.log(`CAP.EVENT ${JSON.stringify({ methodId: p.methodId, sessionId: p.sessionId, seq: p.seq, eventType: p.eventType })}`)
}
for (const f of capEnds) {
  const p = f.payload
  console.log(`CAP.END ${JSON.stringify({ methodId: p.methodId, sessionId: p.sessionId, reason: p.reason })}`)
}
if (stderr.trim() !== "") console.log("--- host stderr (tail) ---\n" + stderr.split("\n").slice(-12).join("\n"))

const ordered = Object.values(seqsByMethod).every((seqs) => seqs.every((s, i) => s === i + 1))
if (!(summary.host_reply_bridge_hello && summary.host_reply_session_open && capEvents.length > 0 && ordered)) {
  fail("push proof incomplete (hello/open/cap.event/ordered seq)")
}
