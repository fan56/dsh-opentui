#!/usr/bin/env node
/**
 * Dev/publish closure linker for @aiwayds/dsh-opentui.
 *
 * The plugin imports `@deepseek-ai/dsh-llm` (createUserMessage). Those
 * packages are not consumable from the public npm registry, so they resolve
 * from the global dsh install's own closure:
 *   $(realpath $(which dsh))/node_modules/@deepseek-ai
 * via a plain symlink. ALL @deepseek-ai/* must resolve to that single
 * closure instance (one @deepseek-ai/cordis in the type/runtime graph).
 *
 * Links into `node_modules/@deepseek-ai/` NEXT TO the package root that
 * contains this script's parent — works for the dev repo checkout and for
 * any install layout where the package sits inside a node_modules tree.
 *
 * Self-guarding: exits 0 silently when there is no global dsh install.
 * Never throws — safe as a postinstall step.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)))

function findDshClosure() {
  const override = process.env.DSH_CLOSURE_DIR
  if (override) {
    try {
      const dir = realpathSync(override)
      if (existsSync(join(dir, 'dsh-llm'))) return dir
    } catch {
      /* bad override — fall through */
    }
  }
  try {
    const bin = execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim()
    if (!bin) return undefined
    const real = realpathSync(bin)
    const closure = join(dirname(dirname(real)), 'node_modules', '@deepseek-ai')
    return existsSync(join(closure, 'dsh-llm')) ? closure : undefined
  } catch {
    return undefined
  }
}

const closure = findDshClosure()
if (!closure) {
  if (process.env.DSH_OPENTUI_DEBUG) console.warn('[dsh-opentui] no global dsh closure found; skipping link')
  process.exit(0)
}

// Link beside the package root's node_modules (dev repo) and one level up
// (hoisted profile install: pkg at <profile>/node_modules/@aiwayds/...).
const targets = [join(pkgRoot, 'node_modules', '@deepseek-ai'), join(dirname(pkgRoot), '..', 'node_modules', '@deepseek-ai')]
for (const scopeDir of targets) {
  if (!scopeDir.includes('node_modules')) continue
  mkdirSync(scopeDir, { recursive: true })
  const link = join(scopeDir, 'dsh-llm')
  try {
    rmSync(link, { force: true })
    symlinkSync(join(closure, 'dsh-llm'), link, 'dir')
  } catch {
    /* never fail an install over a link */
  }
}
if (process.env.DSH_OPENTUI_DEBUG) console.log(`[dsh-opentui] linked dsh-llm from ${closure}`)
process.exit(0)
