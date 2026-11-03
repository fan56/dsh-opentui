#!/usr/bin/env node
// provision-opentui-profile.mjs — idempotent bootstrap of the fixed `opentui`
// host profile (ADR-0005 decisions 3 and 5).
//
// What it does:
//   1. resolves $DSH_HOME (env or ~/.dsh)
//   2. if $DSH_HOME/profiles/opentui already exists → prints "already
//      provisioned" and leaves it untouched (idempotent, never clobbers)
//   3. otherwise recreates it from the shipped `web` template via
//      `dsh opentui --from-default-profile web --dump-config`
//      (--dump-config makes dsh compose-and-exit, so the template copy
//      happens WITHOUT booting the profile; verified against the shipped CLI
//      whose help documents "dsh rescue --from-default-profile web — recreate
//      rescue from the shipped web template")
//   4. prints what it did and the plugin-install next step:
//      `dsh plugin --profile opentui add <pkg>`
//
// Hard guard: this script only ever creates the ONE profile named `opentui`.
// It never touches any other profile — in particular the pre-existing
// `dsh-opentui` dev profile.
//
// Requires a global `dsh` on PATH (the real host CLI). The first host boot
// resolves the profile's bundles (@deepseek-ai/dsh-base + dsh-web-app) from
// the installed dsh closure; no explicit pnpm install is needed.

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PROFILE = 'opentui'
const TEMPLATE = 'web'

function fail(message, detail = '') {
  console.error(`provision-opentui-profile: FAIL — ${message}`)
  if (detail) console.error(detail.trimEnd())
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 1. Resolve the dsh home.
// ---------------------------------------------------------------------------
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', PROFILE)
console.log(`provision-opentui-profile: dsh home ${dshHome}`)

// ---------------------------------------------------------------------------
// 2. Idempotency: an existing profile is left untouched.
// ---------------------------------------------------------------------------
if (existsSync(profileDir)) {
  console.log(`provision-opentui-profile: ${profileDir} already provisioned — leaving it untouched`)
  console.log(`install plugins with: dsh plugin --profile ${PROFILE} add <package>`)
  process.exit(0)
}

// ---------------------------------------------------------------------------
// 3. Recreate from the shipped web template, without booting.
// ---------------------------------------------------------------------------
const which = spawnSync('which', ['dsh'], { encoding: 'utf8' })
if (which.status !== 0 || !which.stdout.trim()) {
  fail('no global `dsh` on PATH — install the dsh host CLI first')
}

console.log(`provision-opentui-profile: creating ${profileDir} from the shipped '${TEMPLATE}' template`)
const run = spawnSync(
  'dsh',
  [PROFILE, '--from-default-profile', TEMPLATE, '--dump-config'],
  {
    // DSH_HOME is explicit so the profile lands in the resolved home even
    // when the caller's env was missing or divergent.
    env: { ...process.env, DSH_HOME: dshHome },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  },
)
if (run.error) fail(`failed to run dsh: ${run.error.message}`)
if (run.status !== 0) {
  fail(
    `\`dsh ${PROFILE} --from-default-profile ${TEMPLATE} --dump-config\` exited ${run.status}`,
    [run.stderr, run.stdout].filter(Boolean).join('\n').slice(-2000),
  )
}
if (!existsSync(profileDir)) {
  fail(
    `dsh exited 0 but ${profileDir} was not created — unexpected CLI behavior; refusing to continue`,
    run.stdout.slice(-2000),
  )
}

// ---------------------------------------------------------------------------
// 4. Report.
// ---------------------------------------------------------------------------
const files = readdirSync(profileDir).sort()
console.log('provision-opentui-profile: created:')
for (const file of files) console.log(`  ${join(profileDir, file)}`)
console.log('provision-opentui-profile: PASS')
console.log(`the '${PROFILE}' profile serves the host Remote protocol (web-app template)`)
console.log(`install plugins with: dsh plugin --profile ${PROFILE} add <package>`)
