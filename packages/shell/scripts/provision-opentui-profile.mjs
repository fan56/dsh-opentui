#!/usr/bin/env node
// provision-opentui-profile.mjs — idempotent bootstrap of the fixed `opentui`
// host profile (ADR-0005 decisions 3 and 5).
//
// What it does:
//   1. resolves $DSH_HOME (env or ~/.dsh)
//   2. if $DSH_HOME/profiles/opentui already exists → keeps it (idempotent,
//      never recreates); otherwise recreates it from the shipped `web`
//      template via `dsh opentui --from-default-profile web --dump-config`
//      (--dump-config makes dsh compose-and-exit, so the template copy
//      happens WITHOUT booting the profile; verified against the shipped CLI
//      whose help documents "dsh rescue --from-default-profile web — recreate
//      rescue from the shipped web template")
//   3. writes/merges the model route into the profile's `cordis.patch.yml`
//      — the shipped web template ships NO provider route, so without this
//      the profile cannot complete a real model turn (provider auth fails).
//      Flags: --provider <id> --model <id> --reasoning-effort <id>
//      (defaults zai-coding-cn / glm-5.3-flash / high — the same defaults as
//      scripts/install-profile.mjs). Same patch-body shape as
//      install-profile.mjs: an `llm-pi-ai` provider entry (apiKeyEnv derived
//      the dsh way — uppercased, non-alnum → underscore, + _API_KEY) plus an
//      `agent-default-model` row.
//   4. prints what it did and the plugin-install next step:
//      `dsh plugin --profile opentui add <pkg>`
//
// Route idempotency contract (follows install-profile.mjs): per managed
// entry (`llm-pi-ai`, `agent-default-model`), an entry already present in the
// patch layer is left untouched — a re-run never duplicates entries and never
// clobbers a model/provider the user edited. Missing entries are appended
// (never rewritten) so the template's own patch entries survive; the file is
// backed up (*.bak-<ts>) before the first modification.
//
// Hard guard: this script only ever touches the ONE profile named `opentui`.
// It never touches any other profile — in particular the pre-existing
// `dsh-opentui` dev profile (which install-profile.mjs owns).
//
// Requires a global `dsh` on PATH (the real host CLI). The first host boot
// resolves the profile's bundles (@deepseek-ai/dsh-base + dsh-web-app) from
// the installed dsh closure; no explicit pnpm install is needed. The provider
// key is read by the host from the apiKeyEnv environment variable (this
// script only names it in the patch; it never handles key values).

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PROFILE = 'opentui'
const TEMPLATE = 'web'

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

const provider = flag('provider') || 'zai-coding-cn'
const model = flag('model') || 'glm-5.3-flash'
const reasoningEffort = flag('reasoning-effort') || 'high'
// dsh convention: deriveKeyRef — uppercased, non-alnum → underscore, +_API_KEY
const apiKeyEnv = `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`

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
// 2. The profile: keep an existing one; otherwise recreate from the shipped
//    web template, without booting.
// ---------------------------------------------------------------------------
if (!existsSync(profileDir)) {
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
} else {
  console.log(`provision-opentui-profile: ${profileDir} already provisioned — leaving it untouched`)
}

// ---------------------------------------------------------------------------
// 3. Model route: write/merge the provider route into cordis.patch.yml.
//    Per-entry idempotent append (see the contract in the header).
// ---------------------------------------------------------------------------
const patchPath = join(profileDir, 'cordis.patch.yml')

const providerEntry = `- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      ${provider}:
        apiKeyEnv: ${apiKeyEnv}
        models:
          - id: ${model}
            name: ${model}
            input:
              - text
`
const modelEntry = `- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: ${provider}
    model: ${model}
    reasoningEffort: ${reasoningEffort}
`

// Top-level entries only: the file is a YAML array of `- id:` entries, and
// nested plugin ids are indented — the ^ anchor keeps the check off them.
const hasEntry = (text, id) => new RegExp(`^- id: ${id}\\s*$`, 'm').test(text)

// True when the patch layer carries NO top-level entries at all (missing
// file, empty, comments only, or a bare `[]` flow document — the shipped web
// template writes exactly that). Such a file has nothing to merge into: it is
// replaced rather than appended to, because appending after the `[]` document
// terminator would produce an invalid two-document YAML stream (the host's
// single-document parser rejects it at boot).
const isEmptyListDoc = (text) => {
  const body = text
    .split('\n')
    .filter((line) => { const t = line.trim(); return t !== '' && !t.startsWith('#') })
    .join('\n')
    .trim()
  return body === '' || body === '[]'
}

let existing = ''
try {
  existing = readFileSync(patchPath, 'utf8')
} catch {
  /* no patch layer yet — created below */
}

const missing = [
  ['llm-pi-ai', providerEntry],
  ['agent-default-model', modelEntry],
].filter(([id, body]) => !hasEntry(existing, id))

if (missing.length === 0) {
  console.log(
    'provision-opentui-profile: model route already in cordis.patch.yml (llm-pi-ai + agent-default-model) — leaving it untouched',
  )
} else {
  const routeBody = missing.map(([, body]) => body).join('')
  const banner =
    `# model route (managed by provision-opentui-profile.mjs — provider ${provider}, ` +
    `key read by the host from ${apiKeyEnv}):\n`
  if (existing && !isEmptyListDoc(existing)) {
    // Append after the existing entries; back up before the first
    // modification, like install-profile.mjs.
    const backupPath = `${patchPath}.bak-${Date.now()}`
    renameSync(patchPath, backupPath)
    console.log(`provision-opentui-profile: backed up existing patch to ${backupPath}`)
    writeFileSync(patchPath, `${existing.replace(/\n*$/, '\n\n')}${banner}${routeBody}`)
    console.log(
      `provision-opentui-profile: appended route entries [${missing.map(([id]) => id).join(', ')}] to cordis.patch.yml`,
    )
  } else {
    // Missing file or an entry-less document (`[]`): write the list fresh.
    if (existing) {
      const backupPath = `${patchPath}.bak-${Date.now()}`
      renameSync(patchPath, backupPath)
      console.log(`provision-opentui-profile: backed up existing patch to ${backupPath}`)
    }
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(patchPath, `${banner}${routeBody}`)
    console.log(
      `provision-opentui-profile: wrote route entries [${missing.map(([id]) => id).join(', ')}] to cordis.patch.yml`,
    )
  }
}

// ---------------------------------------------------------------------------
// 4. Report.
// ---------------------------------------------------------------------------
console.log(`provision-opentui-profile: model pinned to ${provider}/${model} (effort ${reasoningEffort}, key env ${apiKeyEnv})`)
console.log('provision-opentui-profile: PASS')
console.log(`the '${PROFILE}' profile serves the host Remote protocol (web-app template)`)
console.log(`install plugins with: dsh plugin --profile ${PROFILE} add <package>`)
