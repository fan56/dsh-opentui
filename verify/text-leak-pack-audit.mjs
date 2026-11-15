#!/usr/bin/env node
// Packed-artifact leg of the text-leak audit — the 0.16.0 incident's REAL
// shape: an INSTALLED package, not the repo. Repo-green means nothing if the
// packed tarball misses dist/locales (the packaged bin boots an empty registry
// and t()'s fail-open chain paints raw key names on screen).
//
//   node verify/text-leak-pack-audit.mjs
//
// Steps:
//   1. `npm pack` packages/shell (run INSIDE the package dir — prepack builds
//      the client bundle and verifies the locale payload rides the tarball);
//   2. install the tarball into a throwaway prefix
//      (--prefix, default /private/tmp/pack-audit-prefix);
//   3. GREEN leg: run verify/text-leak-audit.mjs against the prefix bin and
//      expect exit 0 (no key leak on any frame);
//   4. RED leg: rename the installed dist/locales away and run the audit
//      again — it MUST exit 1 with key leaks (the gate dictionary stays
//      repo-sourced, so a red here is the app leaking, not the gate blinding).
//
// Exit 0 = green+red legs both behaved; exit 1 = either leg misbehaved.
// Evidence lands under verify/text-leak-pack-out/ (green/, red/, pack-audit-report.md).

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PKG_DIR = join(REPO, 'packages', 'shell')
const PKG_SCOPE_DIR = join('lib', 'node_modules', '@aiwayds', 'dsh-opentui') // npm prefix layout (darwin)
const PREFIX = process.env.PACK_AUDIT_PREFIX || '/private/tmp/pack-audit-prefix'
const OUT = join(REPO, 'verify', 'text-leak-pack-out')
const AUDIT = join(REPO, 'verify', 'text-leak-audit.mjs')

const results = []
const check = (item, ok, detail = []) => {
  results.push({ item, ok, detail })
  console.log(`pack-audit: ${ok ? 'ok' : 'FAIL'} — ${item}${detail.length ? '\n  ' + detail.join('\n  ') : ''}`)
  return ok
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

// 1. pack ---------------------------------------------------------------------
const pack = spawnSync('npm', ['pack', '--pack-destination', OUT], { cwd: PKG_DIR, encoding: 'utf8' })
if (pack.status !== 0) {
  console.error(`pack-audit: npm pack failed:\n${pack.stderr?.slice(-1500)}`)
  process.exit(1)
}
const tgzName = pack.stdout.trim().split('\n').pop()
const tgz = join(OUT, tgzName)
check('npm pack produced a tarball', existsSync(tgz), [tgz])

// 2. install into the throwaway prefix ---------------------------------------
rmSync(PREFIX, { recursive: true, force: true })
const install = spawnSync('npm', ['install', '-g', tgz, '--prefix', PREFIX], { encoding: 'utf8' })
if (install.status !== 0) {
  check('npm install -g into prefix', false, [install.stderr?.slice(-800) ?? ''])
  process.exit(1)
}
const installed = join(PREFIX, PKG_SCOPE_DIR)
const bin = join(PREFIX, 'bin', 'dsh-opentui')
check('tarball installed into prefix', existsSync(bin) && existsSync(installed), [bin, installed])
check('installed package ships dist/locales', existsSync(join(installed, 'dist', 'locales')))

// runAudit leg helper: launches the repo audit pointed at the installed bin.
const runAudit = (leg) => {
  const outDir = join(OUT, leg)
  mkdirSync(outDir, { recursive: true })
  const r = spawnSync(process.execPath, [AUDIT], {
    encoding: 'utf8',
    env: { ...process.env, TEXT_LEAK_LAUNCHER: bin, TEXT_LEAK_OUT: outDir },
  })
  return { r, outDir }
}
const leakCount = (outDir) => {
  try {
    return JSON.parse(readFileSync(join(outDir, 'audit-report.json'), 'utf8')).leaks.length
  } catch { return -1 }
}

// 3. GREEN leg ----------------------------------------------------------------
const green = runAudit('green')
check('GREEN leg: installed bin, intact locales — audit exit 0', green.r.status === 0,
  [`exit=${green.r.status}`, (green.r.stderr ?? '').split('\n').slice(-6).join('\n')])

// 4. RED leg (the 0.16.0 shape): the installed package loses its locales ------
const localesDir = join(installed, 'dist', 'locales')
const localesGone = join(installed, 'dist', 'locales.gone')
renameSync(localesDir, localesGone)
const red = runAudit('red')
const redLeaks = leakCount(join(OUT, 'red'))
check('RED leg: broken locales — audit exit 1', red.r.status === 1,
  [`exit=${red.r.status}`, (red.r.stderr ?? '').split('\n').slice(-6).join('\n')])
check('RED leg: the gate caught key leaks on the frames', redLeaks > 0, [`leaks=${redLeaks}`])
renameSync(localesGone, localesDir) // keep the evidence dir inspectable

// report ------------------------------------------------------------------------
const md = []
md.push(`# packed-artifact text-leak audit — ${new Date().toISOString()}`)
md.push('')
md.push(`Tarball: \`${tgzName}\`; prefix: \`${PREFIX}\`; bin: \`${bin}\``)
md.push('')
for (const r of results) md.push(`- ${r.ok ? 'PASS' : 'FAIL'} — ${r.item}${r.detail.length ? ` (${r.detail.join(' | ').slice(0, 200)})` : ''}`)
md.push('')
md.push('Evidence: green/ + red/ audit-report.{md,json} and the .ans frames.')
writeFileSync(join(OUT, 'pack-audit-report.md'), md.join('\n'))
console.log(`\nreport: ${join(OUT, 'pack-audit-report.md')}`)

process.exit(results.every((r) => r.ok) ? 0 : 1)
