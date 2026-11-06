#!/usr/bin/env node
/**
 * Idempotent installer for the `dsh-opentui` profile.
 *
 * Creates/repairs ~/.dsh/profiles/dsh-opentui:
 *   package.json      — bundles: dsh-base + @aiwayds/dsh-opentui
 *   cordis.yml        — empty root (the tree is composed by the patch)
 *   cordis.patch.yml  — llm provider route + default model pin + our insert
 *   pnpm-workspace.yaml — hoisted, no subpackages
 * then `pnpm install` inside the profile and links the dsh closure for the
 * plugin's @deepseek-ai/dsh-llm import.
 *
 * Idempotency contract:
 *   - existing patch layer is preserved when it already mounts our entry id;
 *     otherwise the user's file is backed up (*.bak-<ts>) and rewritten
 *   - re-running never downgrades a pinned model the user edited
 *
 * Flags: --provider <id> --model <id> --reasoning-effort <id> --dep <spec>
 * (dep spec: "latest" default for npm installs; "file:/path.tgz" for smoke)
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { ensureSolidPatch, pinSolidJsExports } from './solid-js-pin.mjs'

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const profileDir = join(DSH_HOME, 'profiles', 'dsh-opentui')
const depSpec = flag('dep') || 'latest'
const provider = flag('provider') || 'zai-coding-cn'
const model = flag('model') || 'glm-5.3-flash'
const reasoningEffort = flag('reasoning-effort') || 'high'
// dsh convention: deriveKeyRef — uppercased, non-alnum → underscore, +_API_KEY
const apiKeyEnv = `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`

const backup = (file) => {
  if (existsSync(file)) renameSync(file, `${file}.bak-${Date.now()}`)
}

mkdirSync(profileDir, { recursive: true })

// --- package.json (bundle composition) ---
const pkgPath = join(profileDir, 'package.json')
let pkg = {}
try {
  pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
} catch {
  /* fresh profile */
}
const bundles = new Set(['@deepseek-ai/dsh-base', '@aiwayds/dsh-opentui'])
pkg.name = pkg.name || 'dsh-profile-opentui'
pkg.private = true
pkg.dsh = { profile: { bundles: [...bundles] } }
pkg.dependencies = { ...(pkg.dependencies || {}), '@aiwayds/dsh-opentui': depSpec }
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))

// --- cordis.yml (empty root) + workspace + solid-js patch ---
const cordisYml = join(profileDir, 'cordis.yml')
if (!existsSync(cordisYml)) writeFileSync(cordisYml, '# dsh profile root — an empty entry list. The tree is composed as patches.\n[]\n')
// pnpm-workspace.yaml (created with the hoisted layout when missing) + the
// solid-js patchedDependencies entry (version managed by solid-js-pin.mjs).
// This MUST run before the `pnpm install` steps below: with the patch
// registered, every install itself produces the client-build-pinned
// solid-js instead of wiping it.
const { workspaceNote } = ensureSolidPatch(profileDir)
console.log(`[dsh-opentui] ${workspaceNote}`)

// --- cordis.patch.yml (provider route + model pin + our insert) ---
const patchPath = join(profileDir, 'cordis.patch.yml')
const patchBody = `# dsh-opentui profile patch (managed by @aiwayds/dsh-opentui installer)
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
    reasoningEffort: ${reasoningEffort}
- insert:
    - id: tool-ask-user
      name: "@deepseek-ai/dsh-tool-ask-user"
    - id: tool-todo
      name: "@deepseek-ai/dsh-tool-todo"
      config:
        allowParallelInProgress: false
    - id: dsh-opentui
      name: "@aiwayds/dsh-opentui"
      config:
        theme: catppuccin-mocha
`
const existing = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
if (!(existing.includes('id: dsh-opentui') && existing.includes('name: "@aiwayds/dsh-opentui"'))) {
  if (existing) backup(patchPath)
  writeFileSync(patchPath, patchBody)
}

// --- install ---
function run(cmd, cmdArgs, opts = {}) {
  const res = spawnSync(cmd, cmdArgs, { stdio: opts.capture ? 'pipe' : 'inherit', encoding: 'utf8', cwd: profileDir })
  if (res.status !== 0) throw new Error(`${cmd} exited ${res.status}${opts.capture && res.stderr ? ': ' + res.stderr.slice(0, 300) : ''}`)
  return res
}

const pnpm = (() => {
  try {
    execFileSync('pnpm', ['--version'], { stdio: 'pipe' })
    return ['pnpm']
  } catch {
    return ['npx', '-y', 'pnpm@10.18.3']
  }
})()
run(pnpm[0], [...pnpm.slice(1), 'install'])
run(pnpm[0], [...pnpm.slice(1), 'install'])

// --- pin solid-js to its CLIENT build (belt-and-braces; the primary fix is
// the patchedDependencies patch registered above) ---
{
  const state = pinSolidJsExports(profileDir)
  if (state === 'missing') console.warn('[dsh-opentui] could not pin solid-js — TUI updates may be dead')
  else console.log(`[dsh-opentui] solid-js ${state === 'pinned' ? 'pinned to' : 'already pinned to'} client build (dist/solid.js)`)
}

// --- closure link for the plugin's dsh-llm import (hoisted layout: the
// plugin resolves @deepseek-ai/* by walking up to <profile>/node_modules) ---
import { realpathSync, symlinkSync, rmSync } from 'node:fs'
try {
  const bin = execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim()
  const real = realpathSync(bin)
  const closure = join(dirname(dirname(real)), 'node_modules', '@deepseek-ai')
  if (existsSync(join(closure, 'dsh-llm'))) {
    const scopeDir = join(profileDir, 'node_modules', '@deepseek-ai')
    mkdirSync(scopeDir, { recursive: true })
    const link = join(scopeDir, 'dsh-llm')
    rmSync(link, { force: true })
    symlinkSync(join(closure, 'dsh-llm'), link, 'dir')
    console.log('[dsh-opentui] linked dsh-llm from the global dsh closure')
  } else {
    console.warn('[dsh-opentui] global dsh closure has no dsh-llm; the plugin may fail to load')
  }
} catch {
  console.warn('[dsh-opentui] no global dsh on PATH; skipping closure link')
}

console.log(`[dsh-opentui] profile ready at ${profileDir}`)
console.log(`[dsh-opentui] model pinned to ${provider}/${model} (${reasoningEffort})`)
