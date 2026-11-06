// Bake-time wiring: add the jev consumption chain (@aiwayds/dsh-agent-dispatch
// + its @aiwayds/dsh-jev-core library) to the dsh-opentui profile so the image
// carries a plugin that actually READS JEV_ENDPOINT — the infrastructure
// prerequisite for the 65-attention scenario (ported from dsh-tui-pi's
// 76-attention-early-stop). The A5 inventory found the image's @aiwayds
// closure holding only dsh-opentui: JEV_ENDPOINT was baked but had no reader.
//
// What lands in the profile (mirroring dsh-tui-pi's e2e/latest-profile pins
// and the dev machine's own dsh-opentui profile):
//   - dependencies: @aiwayds/dsh-agent-dispatch 0.2.2, @aiwayds/dsh-jev-core
//     0.1.5 (the versions the reference ran; jev-core is also dispatch's own
//     ^0.1.0 dependency — pinning it at the root makes the hoist deterministic
//     and keeps the 76-style "resolves from the profile node_modules" probe
//     honest).
//   - dsh.profile.bundles: both ids appended (the dispatch plugin's own
//     bundle patch then inserts it with `config: {}`).
//   - cordis.patch.yml: one id-targeted override row switching dispatch on —
//     `mode: auto` + a logDir. The tui profile's real-machine trial uses
//     `mode: once` (verdict-on-request via `/dispatch <task>`), but the
//     opentui shell intercepts every leading-slash turn at the composer
//     ("unknown command: /dispatch" — verified in the rebuilt image), so the
//     explicit triggers can never reach the agent pre-step here. `mode: auto`
//     keeps the plugin's default autoKeywords gate: a plain turn whose text
//     hits a task verb ("run", "dispatch", ...) fires ONE jev call at
//     JEV_ENDPOINT; verdicts land in <logDir>/verdicts.ndjson. Fail-open is
//     total: with mock-jev not running, a keyword hit fails silently and the
//     turn proceeds (relevant for scenarios that never start the mock).
//     The profile patch applies AFTER every bundle layer, so this row wins
//     over the bundle patch's off-mode default.
//
// The pnpm install itself runs in the Containerfile step (not here) so the
// NPM_REGISTRY build arg applies. This script only edits the two files.
//
// Usage (build-time, from e2e/Containerfile):
//   NODE_OPTIONS= node bake-jev-chain.mjs
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const NPM_GLOBAL_ROOT = '/usr/local/lib/node_modules/@deepseek-ai/dsh'
const DISPATCH_VERSION = process.env.DISPATCH_VERSION || '0.2.2'
const JEV_CORE_VERSION = process.env.JEV_CORE_VERSION || '0.1.5'
const DISPATCH = '@aiwayds/dsh-agent-dispatch'
const JEV_CORE = '@aiwayds/dsh-jev-core'
const profileDir = join(
  process.env.DSH_HOME || join(homedir(), '.dsh'),
  'profiles', 'dsh-opentui',
)

// --- package.json: deps + bundle membership ---------------------------------
const pkgPath = join(profileDir, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
pkg.dependencies = { ...(pkg.dependencies || {}), [DISPATCH]: DISPATCH_VERSION, [JEV_CORE]: JEV_CORE_VERSION }
const bundles = new Set(pkg.dsh?.profile?.bundles || [])
bundles.add(DISPATCH)
bundles.add(JEV_CORE)
pkg.dsh = { ...(pkg.dsh || {}), profile: { ...(pkg.dsh?.profile || {}), bundles: [...bundles] } }
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
console.log(`[bake-jev-chain] ${pkgPath}: deps + bundles += ${DISPATCH} ${DISPATCH_VERSION}, ${JEV_CORE} ${JEV_CORE_VERSION}`)

// --- cordis.patch.yml: the mode-once override row ----------------------------
// Structured YAML edit with the yaml module resolved from the global dsh
// closure (same probe as bake-mock-endpoint.mjs — no registry access at
// build time for a bare yaml install).
const { parse, stringify } = createRequire(join(NPM_GLOBAL_ROOT, 'package.json'))('yaml')
const patchPath = join(profileDir, 'cordis.patch.yml')
const doc = parse(readFileSync(patchPath, 'utf8')) ?? []
if (!Array.isArray(doc)) {
  throw new Error(`bake-jev-chain: ${patchPath} is not a top-level YAML array`)
}
if (!doc.some(entry => entry && entry.id === 'dsh-agent-dispatch')) {
  // logDir is absolute (container HOME is /root): verdicts.ndjson is the
  // scenario-assertable evidence trail, same role as mock-jev's --log.
  // autoKeywords stays at the plugin default (a non-empty gate is required
  // under mode auto — an empty one is rejected at load).
  doc.push({
    id: 'dsh-agent-dispatch',
    name: DISPATCH,
    config: { mode: 'auto', logDir: '/root/.dsh/jev-verdicts' },
  })
  writeFileSync(patchPath, stringify(doc), 'utf8')
}
console.log(`[bake-jev-chain] ${patchPath}: dsh-agent-dispatch override row (mode: auto, logDir: /root/.dsh/jev-verdicts)`)
