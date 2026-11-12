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
//                        zai-coding-cn / glm-5.3-flash / high). The same step
//                        re-enables `tool-web` (the dsh-web-app bundle ships
//                        it disabled and the `native` preset never turns it
//                        back on) and pins `web.searchProvider` to anysearch —
//                        with or without a plugin tier: this is what makes
//                        `web_search` visible to the model. It also inserts
//                        the default `mcp-context7` client row (streamable
//                        HTTP, no key) so the MCP adapter's mcp_list has a
//                        server to catalog; skipped under `--plugins=none`.
//   [3/5] plugins      — install the default plugin set when a plugin is not
//                        already satisfied (see lib/provision-plan.mjs for the
//                        table and the idempotency rule). `--plugins=core`
//                        narrows the set, `--plugins=none` installs nothing.
//   [4/5] bundles      — clean retired entries out of `dsh.profile.bundles` /
//                        `dependencies` and append missing managed bundles in
//                        install order (ask-router first). Also retires
//                        orphan patchedDependencies entries from the profile's
//                        pnpm-workspace.yaml — a patch whose target package is
//                        no longer a dependency fails every pnpm install with
//                        ERR_PNPM_UNUSED_PATCH (the plugin-mode installer
//                        registered a solid-js patch that 0.9.7 profiles no
//                        longer need). The patch files in patches/ are kept.
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
// package is installed on its own with bounded spaced retries (a transient
// registry failure — TLS reset / ERR_PNPM_META_FETCH_FAIL — dies in seconds,
// a re-attempt after a short gap rides the burst out). A DETERMINISTIC
// failure (ERR_PNPM_UNUSED_PATCH, ERR_PNPM_NO_MATCHING_VERSION, 404-class,
// EACCES/EPERM — classifyPluginAddFailure) skips the retries outright and is
// reported first with an actionable hint; unknown failures still retry.
// A still-failing package is a WARN, never a hard stop (the client still
// launches).
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
  orderPluginAddFailures,
  parseDumpConfig,
  parseTier,
  planMcpPatch,
  planOrphanPatchCleanup,
  planPluginInstall,
  planToolPatch,
  pluginAddArgs,
  pluginAddCommand,
  pluginAddRetryDecision,
  selectPlugins,
} from './lib/provision-plan.mjs'

const TEMPLATE = 'web'
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000
// Bounded retry schedule for a single-spec install that failed (the fallback
// loop below). A transient registry failure (TLS reset / ERR_PNPM_META_FETCH_
// FAIL) exits within seconds, so 3 attempts spaced 5s apart ride the burst
// out without meaningfully extending a healthy provisioning run: the worst
// case adds ~2 fast failures + 2 x 5s per FAILING spec, and a hung `dsh
// plugin add` is still bounded by INSTALL_TIMEOUT_MS per invocation.
// DETERMINISTIC failures (ERR_PNPM_UNUSED_PATCH, ERR_PNPM_NO_MATCHING_VERSION,
// 404/ENOTFOUND, EACCES/EPERM — see classifyPluginAddFailure) are exempt:
// retrying cannot fix them, so the spec gives up on the first hit and the
// summary reports it first with an actionable hint.
const PLUGIN_ADD_ATTEMPTS = 3
const PLUGIN_ADD_BACKOFF_MS = 5000

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
// The model-facing web tools are managed independently of the plugin tier:
// re-enabling `tool-web` and pinning the provider are what make `web_search`
// visible, and the anysearch bundle only installs the provider behind it.
const toolPatch = planToolPatch(existingPatch)
// The default MCP server row rides the adapter, so it is tier-scoped:
// `--plugins=none` installs neither and writes neither (the client alone
// would surface unfolded `mcp__*` schemas, which is not the promised setup).
const mcpPatch = planMcpPatch(existingPatch, { enabled: tier !== 'none' })
const pendingPatchEntries = missingRoute.length + toolPatch.append.length + mcpPatch.append.length
// Stable state suffix for the progress line (task-visible on a dry run too).
const webState = `; tool-web ${toolPatch.toolWeb === 'enabled' ? 'enabled' : 'to enable'}, ` +
  `web search ${toolPatch.web === 'pinned' ? 'pinned' : 'to pin anysearch'}, ` +
  `mcp context7 ${mcpPatch.mcp === 'configured' ? 'configured' : mcpPatch.mcp === 'missing' ? 'to add' : 'skipped (--plugins=none)'}`

if (pendingPatchEntries === 0) {
  say(2, 'model route', `${provider}/${model} (already pinned)${webState}`)
} else if (dryRun) {
  say(2, 'model route', `${provider}/${model} (would write ${pendingPatchEntries} patch entries)${webState}`)
} else {
  const routeBanner = missingRoute.length > 0
    ? `# model route (managed by provision-opentui-profile.mjs — provider ${provider}, ` +
      `key read by the host from ${apiKeyEnv}):\n`
    : ''
  const routeBody = missingRoute.map(([, body]) => body).join('')
  const webBanner = toolPatch.append.length > 0
    ? `${missingRoute.length > 0 ? '\n' : ''}# model-facing web tools (managed by ` +
      `provision-opentui-profile.mjs — anysearch needs no key; tool-web is disabled by ` +
      `@deepseek-ai/dsh-web-app and re-enabled here):\n`
    : ''
  const mcpBanner = mcpPatch.append.length > 0
    ? `${missingRoute.length > 0 || toolPatch.append.length > 0 ? '\n' : ''}# MCP (managed by ` +
      `provision-opentui-profile.mjs — the adapter's mcp_list/mcp_call need a client row; ` +
      `context7 needs no key and a failed/offline connection is non-fatal):\n`
    : ''
  const patchBody = `${routeBanner}${routeBody}${webBanner}${toolPatch.append.join('')}${mcpBanner}${mcpPatch.append.join('')}`
  const backupPatch = () => {
    if (!existingPatch) return
    const backupPath = `${patchPath}.bak-${Date.now()}`
    renameSync(patchPath, backupPath)
    console.log(`${PREFIX}backed up existing patch to ${backupPath}`)
  }
  if (existingPatch && !isEmptyListDoc(existingPatch)) {
    backupPatch()
    writeFileSync(patchPath, `${existingPatch.replace(/\n*$/, '\n\n')}${patchBody}`)
  } else {
    backupPatch()
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(patchPath, patchBody)
  }
  say(2, 'model route', `${provider}/${model} (wrote ${pendingPatchEntries} patch entries)${webState}`)
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

function runPluginAdd(specs, { captureStderr = false } = {}) {
  return spawnSync('dsh', pluginAddArgs(PROFILE, specs), {
    // The per-spec retry captures stderr (the batch install keeps it live) so
    // the failure classifier can read pnpm's error codes; the captured text
    // is echoed back right after the run so nothing the user used to see is
    // swallowed.
    stdio: captureStderr ? ['inherit', 'inherit', 'pipe'] : 'inherit',
    env: { ...process.env, DSH_HOME: dshHome },
    timeout: INSTALL_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  })
}

/** Echo a captured stderr back to the terminal (tail only — pnpm banners can
 *  be long, the error code is at the end). */
function echoCapturedStderr(stderr) {
  const text = typeof stderr === 'string' ? stderr : stderr?.toString() ?? ''
  if (text.trim()) console.error(text.trimEnd().slice(-2000))
}

/** Synchronous pause (this script is spawnSync end to end; there is no event
 *  loop to await on). */
function pauseSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

const failedInstalls = [] // { spec, failure: { kind, code, hint } }
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
      // Each failing spec gets bounded spaced retries (PLUGIN_ADD_ATTEMPTS /
      // PLUGIN_ADD_BACKOFF_MS): a transient registry failure rides the burst
      // out instead of WARN-ing the plugin away on the first drop. A
      // DETERMINISTIC failure (pluginAddRetryDecision) is exempt — retrying
      // cannot fix it, so the spec gives up on the first hit. The terminal
      // failure stays a WARN + failedInstalls entry — never a silent pass
      // (the e2e npm-install boot leg asserts the delivered set).
      for (const spec of specs) {
        let installed = false
        for (let attempt = 1; attempt <= PLUGIN_ADD_ATTEMPTS && !installed; attempt += 1) {
          if (attempt > 1) {
            say(3, 'plugins', `${spec} failed — retry ${attempt - 1}/${PLUGIN_ADD_ATTEMPTS - 1} in ${PLUGIN_ADD_BACKOFF_MS / 1000}s…`)
            pauseSync(PLUGIN_ADD_BACKOFF_MS)
          }
          const retry = runPluginAdd([spec], { captureStderr: true })
          echoCapturedStderr(retry.stderr)
          const decision = pluginAddRetryDecision(retry, { attempt, attempts: PLUGIN_ADD_ATTEMPTS })
          if (decision.action === 'installed') {
            installedCount += 1
            installed = true
          } else if (decision.action === 'failed') {
            const detail = retry.error ? retry.error.message : `(exit ${retry.status})`
            failedInstalls.push({ spec, failure: decision.failure, detail })
            if (decision.failure.kind === 'deterministic') {
              say(3, 'plugins', `${spec}: ${decision.failure.code} — deterministic, not retrying`)
            }
            break
          }
        }
      }
    }
    // Summary: deterministic failures first, each with its one-line fix; the
    // retried-then-failed ones follow without a hint.
    for (const { spec, failure, detail } of orderPluginAddFailures(failedInstalls)) {
      warn(
        `could not install ${spec}${failure.code ? `: ${failure.code}` : ` ${detail}`}` +
          ` — continuing${failure.hint ? ` — ${failure.hint}` : ''}`,
      )
    }
    const failedSuffix = failedInstalls.length > 0 ? `, failed ${failedInstalls.length}` : ''
    say(3, 'plugins', `installed ${installedCount}, skipped ${skipped}${failedSuffix}`)
  }
}

// ---------------------------------------------------------------------------
// 4. Bundles: clean retired entries, append missing managed bundles in the
//    install order (ask-router first); retire orphan pnpm patches whose
//    target package left the dependency graph (they hard-fail every install
//    with ERR_PNPM_UNUSED_PATCH).
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

  // Orphan pnpm patches: a patchedDependencies entry whose target package is
  // no longer a dependency makes every `pnpm` install fail with
  // ERR_PNPM_UNUSED_PATCH (the retired plugin-mode installer registered such
  // a solid-js patch). The check runs against the post-cleanup dependency
  // set — the same set pnpm sees — and is orthogonal to the manifest write
  // below: bundles can be up to date while a stale patch still blocks
  // installs. The patch FILE in patches/ is kept (record of what was applied);
  // only the workspace registration is dropped. No pnpm-workspace.yaml means
  // nothing to clean — none is created.
  const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
  const patchPlan = parsedManifest !== null && existsSync(workspacePath)
    ? planOrphanPatchCleanup(readFileSync(workspacePath, 'utf8'), Object.keys(depClean.dependencies))
    : null

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

  // Retire orphan patches AFTER the manifest write: the logs read as bundle
  // summary first, orphan-patch retirement second. `patchPlan` is null
  // without a readable manifest or without a pnpm-workspace.yaml — both are
  // no-ops (a corrupt manifest already warned above; no workspace file is
  // ever created here).
  if (patchPlan?.opaque) {
    warn('pnpm-workspace.yaml patchedDependencies is not a flat map — leaving it untouched')
  } else if (patchPlan?.removed.length > 0) {
    if (dryRun) {
      say(4, 'bundles', `would retire ${patchPlan.removed.length} orphan patch (${patchPlan.removed.map(([key]) => key).join(', ')}) (dry run)`)
    } else {
      const backupPath = `${workspacePath}.bak-${Date.now()}`
      renameSync(workspacePath, backupPath)
      console.log(`${PREFIX}backed up ${workspacePath} to ${backupPath}`)
      writeFileSync(workspacePath, patchPlan.text)
      for (const [key] of patchPlan.removed) {
        say(4, 'bundles', `retired orphan patch ${key} (its target is no longer a dependency)`)
      }
    }
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
