#!/usr/bin/env node
// build-fixture.mjs — generate the offline npm registry fixture that scenario
// 11-upgrade serves on 127.0.0.1.
//
// One tarball per plugin in the launcher's shipped PLUGIN_SET, at the shipped
// pin — except the package named by --bump, which gets its patch version
// incremented so the upgrade command sees an available update. The pins are
// read from the REAL provision-plan.mjs (never copied here), so the fixture
// cannot drift away from what provisioning considers satisfied.
//
// Everything is written into <out>:
//   tarballs/<slug>-<version>.tgz   valid npm tarballs (package/ root)
//   packuments/<slug>.json          packument skeleton; serve.mjs rewrites
//                                    dist.tarball with the live origin
//   meta.json                       bump/current/target, the profile manifest
//                                    dependencies + bundles, tarball paths
//
// Tarballs are plain directories packed with `tar`, no npm registry involved.
//
// Usage:
//   node build-fixture.mjs --plan <provision-plan.mjs> --out <dir> \
//        [--bump <package-name>]
//
// All output is English; exit 0 on success, 1 on a usage/environment error.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const opt = (name) => {
  const inline = args.find((arg) => arg.startsWith(`--${name}=`))
  if (inline) return inline.slice(name.length + 3)
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : undefined
}

const planPath = opt('plan')
const outDir = opt('out')
const bumpName = opt('bump') ?? '@aiwayds/dsh-cron'
if (!planPath || !outDir) {
  console.error('build-fixture: usage: build-fixture.mjs --plan <provision-plan.mjs> --out <dir> [--bump <name>]')
  process.exit(1)
}

const { PLUGIN_SET } = await import(pathToFileURL(planPath).href)
if (!Array.isArray(PLUGIN_SET) || PLUGIN_SET.length === 0) {
  console.error(`build-fixture: ${planPath} exports no PLUGIN_SET`)
  process.exit(1)
}
const bumpPlugin = PLUGIN_SET.find((plugin) => plugin.name === bumpName)
if (!bumpPlugin) {
  console.error(`build-fixture: ${bumpName} is not in PLUGIN_SET (${PLUGIN_SET.map((p) => p.name).join(', ')})`)
  process.exit(1)
}

/** 0.7.0 -> 0.7.1; anything unparsable is a hard error (the fixture must be
 *  deterministic, never silently "bumped" to the same version). */
function bumpPatch(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-.*)?$/.exec(String(version))
  if (!match) {
    console.error(`build-fixture: cannot bump non-semver version ${JSON.stringify(version)}`)
    process.exit(1)
  }
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
}

const slugOf = (name) => name.replace(/^@/, '').replace(/\//g, '-')

rmSync(outDir, { recursive: true, force: true })
mkdirSync(join(outDir, 'tarballs'), { recursive: true })
mkdirSync(join(outDir, 'packuments'), { recursive: true })

// Fixed publish time for every fixture version. pnpm's minimumReleaseAge gate
// (when a user's config enables it) refuses versions published "too recently";
// a 2024 timestamp keeps the fixture installable on any machine without
// touching that setting. This is the reason the field is not "now".
const PUBLISHED_AT = '2024-01-01T00:00:00.000Z'

const plugins = []
const tarballs = {}
const packuments = {}

for (const plugin of PLUGIN_SET) {
  const version = plugin.name === bumpName ? bumpPatch(plugin.version) : plugin.version
  const slug = slugOf(plugin.name)
  const staging = join(outDir, 'staging', slug)
  mkdirSync(join(staging, 'package'), { recursive: true })
  // A stub package: no dependencies, no install scripts, no engines.dsh and no
  // peer requirements, so `dsh plugin add`'s compatibility preflight has
  // nothing to reject and pnpm has no transitive work to resolve.
  writeFileSync(
    join(staging, 'package', 'package.json'),
    `${JSON.stringify(
      {
        name: plugin.name,
        version,
        description: `offline upgrade fixture for ${plugin.name}`,
        license: 'Apache-2.0',
        main: 'index.js',
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(join(staging, 'package', 'index.js'), `export const fixture = ${JSON.stringify(plugin.name)}\n`)

  const tarballName = `${slug}-${version}.tgz`
  const tarballFile = join(outDir, 'tarballs', tarballName)
  execFileSync('tar', ['-czf', tarballFile, '-C', staging, 'package'])
  const bytes = readFileSync(tarballFile)
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  const shasum = createHash('sha1').update(bytes).digest('hex')
  const tarballPath = `/${plugin.name}/-/${tarballName}`
  tarballs[tarballPath] = `tarballs/${tarballName}`

  packuments[plugin.name] = {
    name: plugin.name,
    'dist-tags': { latest: version },
    versions: {
      [version]: {
        name: plugin.name,
        version,
        license: 'Apache-2.0',
        main: 'index.js',
        dist: { tarball: tarballPath, integrity, shasum },
      },
    },
    time: {
      created: PUBLISHED_AT,
      modified: PUBLISHED_AT,
      [version]: PUBLISHED_AT,
    },
    modified: PUBLISHED_AT,
  }

  plugins.push({ name: plugin.name, shippedPin: plugin.version, servedVersion: version })
  console.log(`build-fixture: ${plugin.name} ${version === plugin.version ? plugin.version : `${plugin.version} -> ${version}`}`)
}

for (const [name, document] of Object.entries(packuments)) {
  writeFileSync(join(outDir, 'packuments', `${slugOf(name)}.json`), `${JSON.stringify(document, null, 2)}\n`)
}
// The staging trees only exist to feed `tar`; leaving them would double the
// fixture's file count for no reason.
rmSync(join(outDir, 'staging'), { recursive: true, force: true })

const meta = {
  bump: { name: bumpPlugin.name, current: bumpPlugin.version, target: bumpPatch(bumpPlugin.version) },
  plugins,
  tarballs,
  profile: {
    // The scratch profile manifest scenario 11 writes: every managed plugin is
    // a dependency at its shipped pin and is listed as a profile bundle, so
    // provisioning's idempotency plan can reach "already satisfied" and the
    // override is the only thing that can change the cron pin.
    name: 'opentui-profile',
    version: '0.0.0',
    private: true,
    dsh: { profile: { bundles: PLUGIN_SET.map((plugin) => plugin.name) } },
    dependencies: Object.fromEntries(PLUGIN_SET.map((plugin) => [plugin.name, plugin.version])),
  },
}
writeFileSync(join(outDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`)
console.log(`build-fixture: ready at ${outDir} (bump ${meta.bump.name} ${meta.bump.current} -> ${meta.bump.target})`)
console.log(`build-fixture: packument for ${bumpName}: ${basename(join(outDir, 'packuments'))}/${slugOf(bumpName)}.json`)
