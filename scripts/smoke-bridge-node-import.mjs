#!/usr/bin/env node
/**
 * Real-Node import smoke for the SHIPPED bridge bundle.
 *
 *   node scripts/smoke-bridge-node-import.mjs [path/to/index.js]
 *
 * This gate must run under node, never bun: bun tolerates named imports that
 * node rejects (e.g. `close` from `node:fs/promises`), so a bun-based import
 * cannot catch a bundle that the real dsh host is unable to load. The script
 * checks its own runtime, then dynamically imports the bundle and asserts the
 * expected top-level exports, surfacing any SyntaxError from the import.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

if (process.versions.bun !== undefined) {
  console.error('[bridge-node-import] FAIL: this smoke must run under node, not bun')
  process.exit(2)
}

const bundle = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL('../packages/shell/dist/bridge/index.js', import.meta.url))
if (!existsSync(bundle)) {
  console.error(`[bridge-node-import] FAIL: bundle missing (run the bridge build first): ${bundle}`)
  process.exit(2)
}

try {
  const mod = await import(pathToFileURL(bundle).href)
  if (mod.name !== 'dsh-opentui-bridge' || typeof mod.apply !== 'function') {
    throw new Error(`unexpected exports: name=${String(mod.name)} apply=${typeof mod.apply}`)
  }
} catch (err) {
  console.error(`[bridge-node-import] FAIL: ${err instanceof Error ? err.stack : String(err)}`)
  process.exit(1)
}

console.log(`BRIDGE_NODE_IMPORT_OK node=${process.versions.node} bundle=${bundle}`)
