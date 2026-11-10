#!/usr/bin/env node
// provision-opentui-profile.mjs — idempotent bootstrap of the fixed `opentui`
// host profile (ADR-0005 decisions 3 and 5).
//
// Runs on EVERY launcher start (bin/dsh-opentui.mjs), so every step is
// idempotent and cheap when there is nothing to do. Five progress steps:
//
//   [1/5] profile      — keep an existing $DSH_HOME/profiles/opentui, else
//                        recreate it from the shipped `web` template via
//                        `dsh opentui --from-default-profile web --dump-config`
//                        (--dump-config makes dsh compose-and-exit, so the
//                        template copy happens WITHOUT booting the profile).
//   [2/5] model route  — write/merge the provider route into the profile's
//                        `cordis.patch.yml`. The web template ships NO
//                        provider route, so without this the profile cannot
//                        complete a real model turn. Flags: --provider <id>
//                        --model <id> --reasoning-effort <id> (defaults
//                        zai-coding-cn / glm-5.3-flash / high).
//   [3/5] plugins      — install the default plugin set when a plugin is not
//                        already satisfied (see lib/provision-plan.mjs for the
//                        table and the idempotency rule). `--plugins=core`
//                        narrows the set, `--plugins=none` installs nothing.
//   [4/5] bundles      — clean retired entries out of `dsh.profile.bundles` /
//                        `dependencies` and append missing managed bundles in
//                        install order (ask-router first).
//   [5/5] verify       — `dsh opentui --dump-config`; "skipping profile
//                        bundle" lines become WARN lines, never a failure.
//
// Idempotency contract (step 3): a plugin needs no work only when
//   (a) it is in the profile `dependencies`,
//   (b) `node_modules/<pkg>/package.json` exists and its version satisfies the
//       pinned version, and
//   (c) its name is in `dsh.profile.bundles`.
// A dep pinned with a local spec (link:/file:/workspace:) always counts as
// satisfied — a local development pin is never replaced by a registry version.
// Missing deps/versions → ONE batched `dsh plugin --profile opentui add
// <specs...>`; on failure the pnpm build-script skeleton is approved and each
// package is retried once on its own; a still-failing package is a WARN, never
// a hard stop (the client still launches).
//
// Step 4 reparses the profile manifest after the install: `dsh plugin add`
// already reconciles bundles for new dependencies, so this only fills the gaps
// (historic profiles) and enforces the managed order. Any manifest write is
// preceded by a `.bak-<ts>` copy.
//
// Hard guard: this script only ever touches the ONE profile named `opentui`.
//
// Dry run: `--dry-run` (or DSH_PROVISION_DRY_RUN=1) prints what it would do —
// commands, entry counts — and writes nothing.
//
// Requires a global `dsh` on PATH for the creating/installing/verifying steps;
// a dry run needs neither. The provider key is read by the host from the
// apiKeyEnv environment variable (this script only names it in the patch; it
// never handles key values).

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_TIER,
  PREFIX,
  PROFILE,
  RETIRED_PROFILE_ENTRIES,
  cleanupDependencies,
  formatStep,
  isDryRun,
  mergeBundles,
  parseDumpConfig,
  parseTier,
  planPluginInstall,
  pluginAddArgs,
  pluginAddCommand,
  selectPlugins,
} from './lib/provision-plan.mjs'

const TEMPLATE = 'web'
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000

const args = process.argv.slice(2)
/** --name=value or --name value. */
const opt = (name) => {
  const inline = args.find((arg) => arg.startsWith(`--${name}=`))
  if (inline) return inline.slice(name.length + 3)
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

const provider = opt('provider') || 'zai-coding-cn'
const model = opt('model') || 'glm-5.3-flash'
const reasoningEffort = opt('reasoning-effort') || 'high'
const dryRun = isDryRun(args, process.env)
const tier = parseTier(opt('plugins') ?? process.env.DSH_OPENTUI_PLUGINS ?? DEFAULT_TIER)
// dsh convention: deriveKeyRef — uppercased, non-alnum → underscore, +_API_KEY
const apiKeyEnv = `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`

const say = (step, label, value = '') => console.log(formatStep(step, label, value))
const warn = (message) => console.error(`${PREFIX}WARN ${message}`)

function fail(message, detail = '') {
  console.error(`${PREFIX}FAIL — ${message}`)
  if (detail) console.error(detail.trimEnd())
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 1. Resolve the dsh home and the profile.
// ---------------------------------------------------------------------------
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', PROFILE)
const manifestPath = join(profileDir, 'package.json')
console.log(`${PREFIX}dsh home ${dshHome}`)

const requireDsh = () => {
  const which = spawnSync('which', ['dsh'], { encoding: 'utf8' })
  if (which.status !== 0 || !which.stdout.trim()) {
    fail('no global `dsh` on PATH — install the dsh host CLI first')
  }
}

if (existsSync(profileDir)) {
  say(1, 'profile', `reusing ${profileDir}`)
} else {
  say(1, 'profile', `creating from ${TEMPLATE} template…`)
  if (!dryRun) {
    requireDsh()
    const run = spawnSync('dsh', [PROFILE, '--from-default-profile', TEMPLATE, '--dump-config'], {
      // DSH_HOME is explicit so the profile lands in the resolved home even
      // when the caller's env was missing or divergent.
      env: { ...process.env, DSH_HOME: dshHome },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
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
  }
}

// ---------------------------------------------------------------------------
// Manifest helpers — everything below reads the profile through these.
// ---------------------------------------------------------------------------
/** The parsed profile manifest, or null when absent/unreadable. Callers that
 *  write must distinguish null (do not clobber a corrupt file) from {}. */
function readManifest() {
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

const manifestDependencies = (manifest) =>
  typeof manifest.dependencies === 'object' && manifest.dependencies !== null ? manifest.dependencies : {}
const manifestBundles = (manifest) =>
  Array.isArray(manifest.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []

function installedVersion(name) {
  try {
    return JSON.parse(readFileSync(join(profileDir, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')).version
  } catch {
    return undefined
  }
}

/** Backup-then-write the profile manifest (the backup is the contract: a
 *  failed run never leaves the user without their previous manifest). */
function writeManifest(manifest) {
  if (existsSync(manifestPath)) {
    const backupPath = `${manifestPath}.bak-${Date.now()}`
    renameSync(manifestPath, backupPath)
    console.log(`${PREFIX}backed up ${manifestPath} to ${backupPath}`)
  } else {
    mkdirSync(profileDir, { recursive: true })
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

// ---------------------------------------------------------------------------
// 2. Model route: write/merge the provider route into cordis.patch.yml.
//    Per-entry idempotent append: an entry already present is left untouched,
//    so a re-run never duplicates entries or clobbers an edited model.
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

// True when the patch layer carries NO top-level entries at all (missing file,
// empty, comments only, or a bare `[]` flow document — the shipped web
// template writes exactly that). Such a file has nothing to merge into: it is
// replaced rather than appended to, because appending after the `[]` document
// terminator would produce an invalid two-document YAML stream.
const isEmptyListDoc = (text) => {
  const body = text
    .split('\n')
    .filter((line) => { const t = line.trim(); return t !== '' && !t.startsWith('#') })
    .join('\n')
    .trim()
  return body === '' || body === '[]'
}

let existingPatch = ''
try {
  existingPatch = readFileSync(patchPath, 'utf8')
} catch {
  /* no patch layer yet — created below */
}

const missingRoute = [
  ['llm-pi-ai', providerEntry],
  ['agent-default-model', modelEntry],
].filter(([id, body]) => !hasEntry(existingPatch, id))

if (missingRoute.length === 0) {
  say(2, 'model route', `${provider}/${model} (already pinned)`)
} else if (dryRun) {
  say(2, 'model route', `${provider}/${model} (would write ${missingRoute.length} patch entries)`)
} else {
  const routeBody = missingRoute.map(([, body]) => body).join('')
  const banner =
    `# model route (managed by provision-opentui-profile.mjs — provider ${provider}, ` +
    `key read by the host from ${apiKeyEnv}):\n`
  const backupPatch = () => {
    if (!existingPatch) return
    const backupPath = `${patchPath}.bak-${Date.now()}`
    renameSync(patchPath, backupPath)
    console.log(`${PREFIX}backed up existing patch to ${backupPath}`)
  }
  if (existingPatch && !isEmptyListDoc(existingPatch)) {
    backupPatch()
    writeFileSync(patchPath, `${existingPatch.replace(/\n*$/, '\n\n')}${banner}${routeBody}`)
  } else {
    backupPatch()
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(patchPath, `${banner}${routeBody}`)
  }
  say(2, 'model route', `${provider}/${model} (wrote ${missingRoute.length} patch entries)`)
}

// ---------------------------------------------------------------------------
// 3. Plugins: one batched `dsh plugin add` for everything unsatisfied.
// ---------------------------------------------------------------------------
const plugins = selectPlugins(tier)

/** Fill pnpm's allowBuilds skeleton (or write one for our packages) so the
 *  retry can pass pnpm ≥10's ignored-builds gate. Only the closure-linker
 *  postinstalls of these plugins are approved; they no-op on published
 *  tarballs. A user-written allowBuilds block is never overwritten.
 *  Returns whether the workspace file was updated. */
function approvePrintedBuilds(names) {
  const workspace = join(profileDir, 'pnpm-workspace.yaml')
  try {
    const text = readFileSync(workspace, 'utf8')
    if (text.includes('set this to true or false')) {
      writeFileSync(workspace, text.replaceAll('set this to true or false', 'true'))
      return true
    }
    if (text.includes('allowBuilds:')) return false
    const block = ['allowBuilds:', ...names.map((name) => `  '${name}': true`)].join('\n')
    writeFileSync(workspace, `${text.replace(/\n*$/, '\n')}${block}\n`)
    return true
  } catch {
    return false
  }
}

function runPluginAdd(specs) {
  return spawnSync('dsh', pluginAddArgs(PROFILE, specs), {
    stdio: 'inherit',
    env: { ...process.env, DSH_HOME: dshHome },
    timeout: INSTALL_TIMEOUT_MS,
  })
}

const failedInstalls = []
let installedCount = 0

if (tier === 'none') {
  say(3, 'plugins', 'skipped (--plugins=none)')
} else {
  const manifest = readManifest() ?? {}
  const dependencies = manifestDependencies(manifest)
  const bundles = manifestBundles(manifest)
  const installedVersions = Object.fromEntries(
    plugins.map((plugin) => [plugin.name, installedVersion(plugin.name)]),
  )
  const plan = planPluginInstall({ tier, dependencies, bundles, installedVersions })
  const specs = plan.install.map((entry) => entry.spec)
  const skipped = plan.total - plan.install.length

  if (plan.install.length === 0) {
    say(3, 'plugins', `already satisfied (${plan.total}/${plan.total})`)
  } else if (dryRun) {
    say(3, 'plugins', `found ${skipped}/${plan.total}, installing ${specs.length}… → running: ${pluginAddCommand(PROFILE, specs)}`)
    say(3, 'plugins', `dry run: skipped the install (${skipped} already satisfied)`)
  } else {
    requireDsh()
    say(3, 'plugins', `found ${skipped}/${plan.total}, installing ${specs.length}… → running: ${pluginAddCommand(PROFILE, specs)}`)
    const batch = runPluginAdd(specs)
    if (!batch.error && batch.status === 0) {
      installedCount = specs.length
    } else {
      if (batch.error) warn(`plugin install failed to start: ${batch.error.message}`)
      else warn(`plugin install exited ${batch.status}`)
      if (approvePrintedBuilds(plugins.map((plugin) => plugin.name))) {
        say(3, 'plugins', 'approved the printed build scripts (pnpm allowBuilds) — retrying one by one…')
      }
      // Single-package fallback: one bad package must not sink the rest.
      for (const spec of specs) {
        const retry = runPluginAdd([spec])
        if (!retry.error && retry.status === 0) {
          installedCount += 1
        } else {
          failedInstalls.push(spec)
          warn(`could not install ${spec}${retry.error ? `: ${retry.error.message}` : ` (exit ${retry.status})`} — continuing`)
        }
      }
    }
    const failedSuffix = failedInstalls.length > 0 ? `, failed ${failedInstalls.length}` : ''
    say(3, 'plugins', `installed ${installedCount}, skipped ${skipped}${failedSuffix}`)
  }
}

// ---------------------------------------------------------------------------
// 4. Bundles: clean retired entries, append missing managed bundles in the
//    install order (ask-router first).
// ---------------------------------------------------------------------------
{
  const parsedManifest = readManifest()
  const manifest = parsedManifest ?? {}
  const dependencies = manifestDependencies(manifest)
  // In a dry run the install above did not run: treat its specs as delivered
  // so the bundle plan still prints what a real run would append.
  const plannedNames = new Set(selectPlugins(tier).map((plugin) => plugin.name))
  const effectiveDependencies = { ...dependencies }
  if (dryRun) for (const name of plannedNames) if (!(name in effectiveDependencies)) effectiveDependencies[name] = 'dry-run'

  const depClean = cleanupDependencies(effectiveDependencies)
  // Only bundles whose dependency actually landed: a failed install must not
  // leave a bundle entry that cannot resolve at boot.
  const managedOrder = tier === 'none'
    ? []
    : selectPlugins(tier).map((plugin) => plugin.name).filter((name) => name in effectiveDependencies)
  const merged = mergeBundles(manifestBundles(manifest), { managedOrder, retire: RETIRED_PROFILE_ENTRIES })
  const changed = depClean.removed.length > 0 || merged.removed.length > 0 || merged.appended.length > 0 || merged.reordered

  if (parsedManifest === null && existsSync(manifestPath)) {
    warn(`${manifestPath} is not a valid JSON manifest — leaving it untouched`)
    say(4, 'bundles', 'skipped (unreadable profile manifest)')
  } else if (!changed) {
    say(4, 'bundles', `up to date (${merged.bundles.length} entries)`)
  } else if (dryRun) {
    const parts = []
    if (merged.removed.length > 0) parts.push(`would remove ${merged.removed.length} legacy entry (${merged.removed.join(', ')})`)
    if (merged.appended.length > 0) parts.push(`would append ${merged.appended.length} bundle entries`)
    if (merged.reordered) parts.push('would reorder managed bundles (ask-router first)')
    say(4, 'bundles', `${parts.join('; ')} (dry run)`)
  } else {
    const next = { ...manifest, dependencies: depClean.dependencies }
    next.dsh = {
      ...(manifest.dsh ?? {}),
      profile: { ...(manifest.dsh?.profile ?? {}), bundles: merged.bundles },
    }
    writeManifest(next)
    let reported = false
    if (merged.removed.length > 0 || depClean.removed.length > 0) {
      const removed = [...new Set([...merged.removed, ...depClean.removed])]
      say(4, 'bundles', `removed ${removed.length} legacy entry (${removed.join(', ')})`)
      reported = true
    }
    if (merged.appended.length > 0) {
      say(4, 'bundles', `appended ${merged.appended.length} bundle entries`)
      reported = true
    }
    if (merged.reordered) {
      say(4, 'bundles', `${merged.appended.length > 0 ? 'also ' : ''}reordered managed bundles (ask-router first)`)
      reported = true
    }
    if (!reported) say(4, 'bundles', `up to date (${merged.bundles.length} entries)`)
  }
}

// ---------------------------------------------------------------------------
// 5. Verify: compose the profile and report skipped bundles as WARN.
// ---------------------------------------------------------------------------
if (dryRun) {
  say(5, 'verify', 'dry run: skipped')
} else if (!existsSync(manifestPath)) {
  say(5, 'verify', 'skipped (no profile manifest)')
} else {
  requireDsh()
  const run = spawnSync('dsh', [PROFILE, '--dump-config'], {
    env: { ...process.env, DSH_HOME: dshHome },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 2 * 60 * 1000,
  })
  if (run.error || run.status !== 0) {
    warn(`verify: \`dsh ${PROFILE} --dump-config\` ${run.error ? `failed: ${run.error.message}` : `exited ${run.status}`}`)
    say(5, 'verify', `failed${run.error ? '' : ` (exit ${run.status})`} — the client will report boot details`)
  } else {
    const { layers, skipped } = parseDumpConfig(run.stdout, run.stderr)
    for (const line of skipped) warn(line)
    say(5, 'verify', `composed ${layers} layers, ${skipped.length} skipped`)
  }
}

console.log(`${PREFIX}PASS`)
