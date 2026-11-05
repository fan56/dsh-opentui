#!/usr/bin/env node
// Boot-smoke for @aiwayds/dsh-opentui: verify the npm pack artifact boots as
// a real dsh profile plugin.
//
//   1. npm pack this package → tarball
//   2. scratch $DSH_HOME/profiles/smoke-opentui with the tarball as a file:
//      dep, the dsh.profile.bundles entry, and a patch layer (LLM provider
//      route + default model pin + our plugin insert)
//   3. pnpm install inside the scratch profile
//   3.5 pin solid-js to its client build (its "node" condition resolves to
//      the SSR dist/server.js — first frame renders, then updates go dead)
//   4. link @deepseek-ai/dsh-llm from the global dsh closure into the
//      profile's hoisted node_modules (the plugin resolves it by walking up)
//   5. boot `dsh --profile smoke-opentui` for real, let it render for 12s,
//      then SIGTERM
//
// Requires a global `dsh` on PATH (the real host, not a dev copy). On CI
// without dsh this must skip, not fail: prints "smoke skipped: no global
// dsh" and exits 0.
//
// Pass criteria: the boot output shows the OpenTUI rendered (the '提问'
// prompt label) or entered the alt-screen (\x1b[?1049h), and carries none
// of the loader failure markers. Exit 0 = pass; the scratch dir is removed.
// On failure the scratch dir is kept and printed together with the last 40
// output lines.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..') // packages/shell
const ownName = '@aiwayds/dsh-opentui'
const profileName = 'smoke-opentui'
const bootSeconds = 12

function fail(message, output = '') {
  console.error(`smoke-boot: FAIL — ${message}`)
  if (output) {
    const lines = output.split('\n')
    console.error(lines.slice(-40).join('\n'))
  }
  console.error(`smoke-boot: scratch kept at ${work}`)
  process.exit(1)
}

// A global dsh is a hard prerequisite of this smoke: without it (CI) skip.
const whichDsh = spawnSync('which', ['dsh'], { encoding: 'utf8' })
if (whichDsh.status !== 0 || !whichDsh.stdout.trim()) {
  console.log('smoke skipped: no global dsh')
  process.exit(0)
}

const work = mkdtempSync(join(tmpdir(), 'dsh-opentui-smoke-'))
const home = join(work, 'dsh-home')
const profile = join(home, 'profiles', profileName)
mkdirSync(profile, { recursive: true })

// Phase 1 — pack: the tarball under test is whatever npm pack emits now.
const pack = spawnSync('npm', ['pack', '--json', '--pack-destination', work], { cwd: pkgRoot, encoding: 'utf8' })
if (pack.status !== 0 || pack.error) fail('npm pack failed', `${pack.stdout}\n${pack.stderr}`)
let tarballName
try {
  // Lifecycle scripts (prepack) print to stdout before the JSON array —
  // slice from the first "[" so JSON.parse sees only the payload (the old
  // whole-string parse fell back to the bare closing "]" line and failed).
  const jsonStart = pack.stdout.indexOf('[')
  if (jsonStart < 0) throw new Error('no JSON array in npm pack output')
  const packed = JSON.parse(pack.stdout.slice(jsonStart))
  tarballName = packed.at(-1).filename
} catch {
  tarballName = pack.stdout.trim().split('\n').at(-1)
}
const tarball = join(work, tarballName)
if (!existsSync(tarball)) fail(`npm pack reported ${tarballName} but the file does not exist`)

// Phase 2 — scratch profile: same shape as the user's real profiles
// (bundles entry in package.json, empty cordis root, hoisted workspace, and
// the patch layer copied from scripts/install-profile.mjs).
const provider = 'zai-coding-cn'
const model = 'glm-5.3-flash'
const apiKeyEnv = `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`

writeFileSync(join(profile, 'package.json'), JSON.stringify({
  name: 'dsh-profile-smoke-opentui',
  private: true,
  dependencies: {
    [ownName]: `file:${tarball}`,
  },
  dsh: {
    profile: {
      bundles: [
        '@deepseek-ai/dsh-base',
        ownName,
      ],
    },
  },
}, null, 2) + '\n')

writeFileSync(join(profile, 'cordis.yml'), '# dsh profile root — an empty entry list. The tree is composed as patches.\n[]\n')

writeFileSync(join(profile, 'pnpm-workspace.yaml'), 'packages: []\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')

writeFileSync(join(profile, 'cordis.patch.yml'), `# dsh-opentui scratch smoke profile patch
- id: llm-pi-ai
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
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: ${provider}
    model: ${model}
    reasoningEffort: high
- insert:
    - id: dsh-opentui
      name: "${ownName}"
      config:
        theme: catppuccin-mocha
`)

// Phase 3 — install the tarball into the scratch profile (pnpm if available,
// otherwise a pinned npx copy).
const pnpmProbe = spawnSync('pnpm', ['--version'], { encoding: 'utf8' })
const pnpmCmd = pnpmProbe.status === 0 ? ['pnpm'] : ['npx', '-y', 'pnpm@10.18.3']
const install = spawnSync(pnpmCmd[0], [...pnpmCmd.slice(1), 'install'], { cwd: profile, encoding: 'utf8' })
if (install.status !== 0 || install.error) fail('pnpm install in the scratch profile failed', `${install.stdout}\n${install.stderr}`)

// Phase 3.5 — pin solid-js to its CLIENT build (same fix as
// scripts/install-profile.mjs): solid-js's "node" export condition resolves
// to dist/server.js (SSR) — the first frame renders and then the screen goes
// dead (no reactive updates) under the host's node runtime. The @opentui/solid
// preload only remaps this under bun dev, so in a real dsh boot the fix is
// rewriting the installed package's exports. Without it this smoke could pass
// on the first frame while a real session is a dead screen.
{
  const solidPkg = join(profile, 'node_modules', 'solid-js', 'package.json')
  try {
    const solidJson = JSON.parse(readFileSync(solidPkg, 'utf8'))
    solidJson.exports = {
      '.': { types: './types/index.d.ts', import: './dist/solid.js', require: './dist/solid.cjs' },
      './dist/solid.js': './dist/solid.js',
      './dist/solid.cjs': './dist/solid.cjs',
      './package.json': './package.json',
    }
    writeFileSync(solidPkg, JSON.stringify(solidJson, null, 2))
  } catch (err) {
    fail(`could not pin solid-js to its client build in the scratch profile — TUI updates would be dead: ${err.message}`)
  }
}

// Phase 4 — closure link: the plugin imports @deepseek-ai/dsh-llm, which the
// tarball's peerDependencies cannot satisfy from the registry. Hoist it from
// the global dsh installation's node_modules closure.
const dshBin = whichDsh.stdout.trim()
const dshReal = realpathSync(dshBin)
const closureDshLlm = join(dirname(dirname(dshReal)), 'node_modules', '@deepseek-ai', 'dsh-llm')
if (!existsSync(closureDshLlm)) {
  fail(`the global dsh closure at ${dirname(dirname(dshReal))}/node_modules has no @deepseek-ai/dsh-llm — cannot link the plugin's peer import`)
}
const scopeDir = join(profile, 'node_modules', '@deepseek-ai')
mkdirSync(scopeDir, { recursive: true })
rmSync(join(scopeDir, 'dsh-llm'), { force: true })
symlinkSync(closureDshLlm, join(scopeDir, 'dsh-llm'), 'dir')

// The boot environment: `npm run`/spawned shells leak npm_config_* and this
// repo's node_modules/.bin into PATH; either can shadow or confuse the global
// dsh host. Strip both so the smoke always exercises the real CLI.
const env = { ...process.env, DSH_HOME: home, NODE_OPTIONS: '--experimental-ffi' }
const pathSep = process.platform === 'win32' ? ';' : ':'
env.PATH = (env.PATH ?? '')
  .split(pathSep)
  .filter((seg) => seg && seg !== join(pkgRoot, 'node_modules', '.bin'))
  .join(pathSep)
for (const key of Object.keys(env)) {
  if (key.startsWith('npm_config_')) delete env[key]
}

// Phase 5 — real boot: spawn the TUI host piped, let it render for the boot
// window, then SIGTERM. The piped boot is a valid render proof (the plugin
// enters alt-screen and paints the prompt even without a TTY).
const child = spawn('dsh', ['--profile', profileName], {
  cwd: profile,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
child.stdout.on('data', (chunk) => { output += chunk })
child.stderr.on('data', (chunk) => { output += chunk })
let settled = false
const exitPromise = new Promise((resolve) => {
  child.once('exit', (code, signal) => resolve({ code, signal }))
  child.once('error', (err) => { if (!settled) resolve({ code: null, signal: null, error: err }) })
})
const killTimer = setTimeout(() => child.kill('SIGTERM'), bootSeconds * 1000)
const exit = await exitPromise
settled = true
clearTimeout(killTimer)
if (exit.error) fail(`failed to start dsh: ${exit.error.message}`)

// Phase 6 — assertions: the UI must have rendered (prompt label or
// alt-screen enter) and the loader must not have failed.
const rendered = output.includes('提问') || output.includes('\x1b[?1049h')
if (!rendered) {
  fail(`dsh booted for ${bootSeconds}s but the OpenTUI never rendered (no prompt label, no alt-screen enter)`, output)
}
const failureMarkers = ['did not activate', 'failed to import', 'cannot get property']
const hit = failureMarkers.filter((marker) => output.includes(marker))
if (hit.length > 0) {
  fail(`the boot output carries loader failure markers: ${hit.join(', ')}`, output)
}
// A leaked 'dist/server.js' means the solid-js pin (phase 3.5) failed and the
// runtime pulled the SSR build — first frame would look fine, updates dead.
if (output.includes('dist/server.js')) {
  fail("the boot output leaks 'dist/server.js' — solid-js resolved to its SSR build despite the client pin", output)
}

// Phase 7 — pass: clean up the scratch dir.
rmSync(work, { recursive: true, force: true })
console.log(`smoke-boot: PASS — ${ownName} from the packed tarball rendered in a real dsh boot (SIGTERM after ${bootSeconds}s, exit signal ${exit.signal ?? 'none'})`)
