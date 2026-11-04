#!/usr/bin/env node
// `npm pack` runs from this package dir, but LICENSE / NOTICE / README.md /
// CHANGELOG.md live at the repo ROOT — the files-array entries pointed at
// paths that do not exist here, so every published tarball (0.1.0-0.4.3)
// silently shipped without them. prepublishOnly copies the four root files
// in; they are gitignored and never committed (single source of truth).
import { copyFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgDir = resolve(here, '..')
const root = resolve(pkgDir, '../..')
for (const f of ['LICENSE', 'NOTICE', 'README.md', 'CHANGELOG.md']) {
	copyFileSync(join(root, f), join(pkgDir, f))
}
console.log('pack-meta: copied LICENSE NOTICE README.md CHANGELOG.md from repo root')
