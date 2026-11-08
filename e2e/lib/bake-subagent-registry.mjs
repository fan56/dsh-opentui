// Bake-time wiring: add @aiwayds/dsh-subagent-registry (use_agent's home —
// the dispatch plugin's capability gate refuses auto keyword turns without
// use_agent visible + a non-empty roster) to a profile's dependencies and
// bundle membership, so the 62/70/65 family can dispatch subagents. The
// plugin-face image installs this via `dsh plugin add` at scenario runtime;
// the client face's scratch profile (provisioned fresh from the web
// template) gets it here instead, resolved by the pnpm install that
// start_tui's client branch runs right after this script.
//
// Deliberately NOT `dsh plugin add`: that path needs a packed tarball and
// per-profile plugin plumbing at runtime; the profile-bundle route is the
// same one bake-jev-chain.mjs uses for dispatch/jev-core (62's own BAKE
// RECIPE note: "install @aiwayds/dsh-subagent-registry as a profile bundle
// member"). The registry's agent-roster seeding (oldfox/rubber-duck/
// workhorse.md) does not happen on this route — scenarios seed looper.md
// themselves, which feeds the roster leg.
//
// Usage (runtime, from start_tui's client branch):
//   DSH_HOME=/tmp/client-dsh MOCK_PROFILE=opentui node bake-subagent-registry.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const REGISTRY = '@aiwayds/dsh-subagent-registry'
// Pinned 0.19.0 — the release 62/65 pin their `dsh plugin add` path to
// (0.18.0 dies at load on this host wave).
const VERSION = process.env.REG_VERSION || '0.19.0'
// MOCK_PROFILE selects the target profile: 'dsh-opentui' (default) or
// 'opentui' (the client-face profile provisioned into a scratch DSH_HOME).
const PROFILE_NAME = process.env.MOCK_PROFILE || 'dsh-opentui'
const pkgPath = join(
  process.env.DSH_HOME || join(homedir(), '.dsh'),
  'profiles', PROFILE_NAME, 'package.json',
)

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
pkg.dependencies = { ...(pkg.dependencies || {}), [REGISTRY]: VERSION }
const bundles = new Set(pkg.dsh?.profile?.bundles || [])
bundles.add(REGISTRY)
pkg.dsh = { ...(pkg.dsh || {}), profile: { ...(pkg.dsh?.profile || {}), bundles: [...bundles] } }
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
console.log(`[bake-subagent-registry] ${pkgPath}: deps + bundles += ${REGISTRY} ${VERSION}`)
