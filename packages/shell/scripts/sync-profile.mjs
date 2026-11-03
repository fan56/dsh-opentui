#!/usr/bin/env node
/**
 * Deploy the local build into the dsh profile — the manual dev loop, codified:
 *
 *   1. bun build-host.ts                    — rebuild packages/shell/dist-host
 *   2. rsync dist-host contents             — overlay the profile's installed
 *                                              @aiwayds/dsh-opentui copy
 *   3. solid-js patch + patchedDependencies — keep the client-build pin
 *                                              pnpm-install-proof
 *   4. direct re-pin of solid-js exports    — idempotent belt-and-braces
 *
 * Safe to re-run at any time; prints a summary of what was done.
 * Run from anywhere (paths resolve from this file); `npm run sync` works too.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureSolidPatch, pinSolidJsExports } from './solid-js-pin.mjs'

const shellDir = dirname(dirname(fileURLToPath(import.meta.url))) // packages/shell
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const profileDir = join(DSH_HOME, 'profiles', 'dsh-opentui')
const dstPkg = join(profileDir, 'node_modules', '@aiwayds', 'dsh-opentui')

const done = []
const fail = (msg) => {
  console.error(`[sync-profile] ${msg}`)
  process.exit(1)
}

if (!existsSync(dstPkg)) fail(`profile package ${dstPkg} not installed — run the dsh installer or pnpm install in the profile first`)

// 1. rebuild the host bundle. The bunfig preload that remaps solid-js to the
//    client build lives in packages/shell, so bun MUST run with that cwd.
const build = spawnSync('bun', ['build-host.ts'], { cwd: shellDir, stdio: 'inherit' })
if (build.status !== 0) fail('bun build-host.ts failed')

// 2. overlay the fresh dist-host into the profile's installed package.
//    Plain `rsync -a` of the contents (no --delete): dist-host is fully owned
//    by the build, and it ships its own node_modules — copy those too.
const srcDist = join(shellDir, 'dist-host')
const dstDist = join(dstPkg, 'dist-host')
if (!existsSync(srcDist)) fail(`no dist-host at ${srcDist} — build produced nothing?`)
mkdirSync(dstDist, { recursive: true })
const rsync = spawnSync('rsync', ['-a', `${srcDist}/`, `${dstDist}/`])
if (rsync.status !== 0) fail(`rsync failed: ${(rsync.stderr || '').toString().trim()}`)
done.push(`rsync dist-host -> ${dstDist}`)

// 3. keep the solid-js client pin pnpm-install-proof
const { patchWrote, workspaceNote } = ensureSolidPatch(profileDir)
done.push(`solid-js patch ${patchWrote ? 'written' : 'already current'} (${workspaceNote})`)

// 4. idempotent direct re-pin of the installed solid-js exports
const pinState = pinSolidJsExports(profileDir)
if (pinState === 'missing') fail('solid-js not installed in the profile — pnpm install in the profile first')
done.push(`solid-js exports ${pinState === 'pinned' ? 're-pinned to' : 'already pinned to'} client build (dist/solid.js)`)

console.log('[sync-profile] done:')
for (const step of done) console.log(`  - ${step}`)
console.log(`[sync-profile] profile: ${profileDir}`)
