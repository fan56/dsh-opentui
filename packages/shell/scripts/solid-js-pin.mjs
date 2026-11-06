/**
 * Shared solid-js client-build pin for the dsh profile.
 *
 * solid-js's "node" export condition resolves to dist/server.js (SSR, no
 * reactive scheduling): under the dsh host's node runtime the TUI renders one
 * frame and then goes dead. Under bun dev the @opentui/solid preload remaps
 * this; the host has no such preload, so the installed package itself must
 * resolve to the client build. Two layers, both managed here:
 *
 *   1. a pnpm patchedDependencies patch — the primary fix, survives any
 *      `pnpm install` in the profile
 *   2. an idempotent direct rewrite of the installed package.json exports —
 *      belt-and-braces for right after an install or a dist-host deploy
 *
 * C1: generalized to the 0.8.2 v2 closure (solid-js@1.9.17). Unlike the old
 * 1.9.12 patch, "./store" KEEPS a pinned entry (client store build): the v2
 * view imports solid-js/store (seam-rows' store) at runtime from the
 * profile's hoisted copy.
 *
 * Used by scripts/install-profile.mjs (before its pnpm install steps) and
 * scripts/sync-profile.mjs (the local-dev deploy loop).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const SOLID_JS_VERSION = '1.9.17'
export const SOLID_PATCH_RELPATH = `patches/solid-js@${SOLID_JS_VERSION}.patch`

// pristine solid-js@1.9.17 package.json -> client-pinned variant:
// - "module" points at dist/solid.js instead of dist/server.js
// - exports["."] drops the worker/deno/node conditions (node used to win and
//   select the SSR build) and resolves straight to dist/solid.js
// - "./store" keeps a pinned entry (client store build) for the v2 view's
//   solid-js/store import
// - the remaining SSR-flavored subpath exports (./web, ./h, ./html, ...)
//   go away; the host bundle imports bare "solid-js" and "solid-js/store" only
export const SOLID_JS_PATCH = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -10,7 +10,7 @@
     "url": "https://github.com/solidjs/solid"
   },
   "main": "./dist/server.cjs",
-  "module": "./dist/server.js",
+  "module": "./dist/solid.js",
   "unpkg": "./dist/solid.cjs",
   "types": "types/index.d.ts",
   "sideEffects": false,
@@ -44,164 +44,17 @@
   ],
   "exports": {
     ".": {
-      "worker": {
-        "types": "./types/index.d.ts",
-        "import": "./dist/server.js",
-        "require": "./dist/server.cjs"
-      },
-      "browser": {
-        "development": {
-          "types": "./types/index.d.ts",
-          "import": "./dist/dev.js",
-          "require": "./dist/dev.cjs"
-        },
-        "types": "./types/index.d.ts",
-        "import": "./dist/solid.js",
-        "require": "./dist/solid.cjs"
-      },
-      "deno": {
-        "types": "./types/index.d.ts",
-        "import": "./dist/server.js",
-        "require": "./dist/server.cjs"
-      },
-      "node": {
-        "types": "./types/index.d.ts",
-        "import": "./dist/server.js",
-        "require": "./dist/server.cjs"
-      },
-      "development": {
-        "types": "./types/index.d.ts",
-        "import": "./dist/dev.js",
-        "require": "./dist/dev.cjs"
-      },
       "types": "./types/index.d.ts",
       "import": "./dist/solid.js",
       "require": "./dist/solid.cjs"
     },
-    "./dist/*": "./dist/*",
-    "./types/*": "./types/*",
-    "./jsx-runtime": {
-      "types": "./types/jsx.d.ts",
-      "default": "./dist/solid.js"
-    },
-    "./jsx-dev-runtime": {
-      "types": "./types/jsx.d.ts",
-      "default": "./dist/solid.js"
-    },
     "./store": {
-      "worker": {
-        "types": "./store/types/index.d.ts",
-        "import": "./store/dist/server.js",
-        "require": "./store/dist/server.cjs"
-      },
-      "browser": {
-        "development": {
-          "types": "./store/types/index.d.ts",
-          "import": "./store/dist/dev.js",
-          "require": "./store/dist/dev.cjs"
-        },
-        "types": "./store/types/index.d.ts",
-        "import": "./store/dist/store.js",
-        "require": "./store/dist/store.cjs"
-      },
-      "deno": {
-        "types": "./store/types/index.d.ts",
-        "import": "./store/dist/server.js",
-        "require": "./store/dist/server.cjs"
-      },
-      "node": {
-        "types": "./store/types/index.d.ts",
-        "import": "./store/dist/server.js",
-        "require": "./store/dist/server.cjs"
-      },
-      "development": {
-        "types": "./store/types/index.d.ts",
-        "import": "./store/dist/dev.js",
-        "require": "./store/dist/dev.cjs"
-      },
       "types": "./store/types/index.d.ts",
       "import": "./store/dist/store.js",
       "require": "./store/dist/store.cjs"
     },
-    "./store/dist/*": "./store/dist/*",
-    "./store/types/*": "./store/types/*",
-    "./web": {
-      "worker": {
-        "types": "./web/types/index.d.ts",
-        "import": "./web/dist/server.js",
-        "require": "./web/dist/server.cjs"
-      },
-      "browser": {
-        "development": {
-          "types": "./web/types/index.d.ts",
-          "import": "./web/dist/dev.js",
-          "require": "./web/dist/dev.cjs"
-        },
-        "types": "./web/types/index.d.ts",
-        "import": "./web/dist/web.js",
-        "require": "./web/dist/web.cjs"
-      },
-      "deno": {
-        "types": "./web/types/index.d.ts",
-        "import": "./web/dist/server.js",
-        "require": "./web/dist/server.cjs"
-      },
-      "node": {
-        "types": "./web/types/index.d.ts",
-        "import": "./web/dist/server.js",
-        "require": "./web/dist/server.cjs"
-      },
-      "development": {
-        "types": "./web/types/index.d.ts",
-        "import": "./web/dist/dev.js",
-        "require": "./web/dist/dev.cjs"
-      },
-      "types": "./web/types/index.d.ts",
-      "import": "./web/dist/web.js",
-      "require": "./web/dist/web.cjs"
-    },
-    "./web/storage": {
-      "types": "./web/storage/types/index.d.ts",
-      "import": "./web/storage/dist/storage.js",
-      "require": "./web/storage/dist/storage.cjs"
-    },
-    "./web/dist/*": "./web/dist/*",
-    "./web/types/*": "./web/types/*",
-    "./universal": {
-      "development": {
-        "types": "./universal/types/index.d.ts",
-        "import": "./universal/dist/dev.js",
-        "require": "./universal/dist/dev.cjs"
-      },
-      "types": "./universal/types/index.d.ts",
-      "import": "./universal/dist/universal.js",
-      "require": "./universal/dist/universal.cjs"
-    },
-    "./universal/dist/*": "./universal/dist/*",
-    "./universal/types/*": "./universal/types/*",
-    "./h": {
-      "types": "./h/types/index.d.ts",
-      "import": "./h/dist/h.js",
-      "require": "./h/dist/h.cjs"
-    },
-    "./h/jsx-runtime": {
-      "types": "./h/jsx-runtime/types/index.d.ts",
-      "import": "./h/jsx-runtime/dist/jsx.js",
-      "require": "./h/jsx-runtime/dist/jsx.cjs"
-    },
-    "./h/jsx-dev-runtime": {
-      "types": "./h/jsx-runtime/types/index.d.ts",
-      "import": "./h/jsx-runtime/dist/jsx.js",
-      "require": "./h/jsx-runtime/dist/jsx.cjs"
-    },
-    "./h/dist/*": "./h/dist/*",
-    "./h/types/*": "./h/types/*",
-    "./html": {
-      "types": "./html/types/index.d.ts",
-      "import": "./html/dist/html.js",
-      "require": "./html/dist/html.cjs"
-    },
-    "./html/dist/*": "./html/dist/*",
+    "./dist/solid.js": "./dist/solid.js",
+    "./dist/solid.cjs": "./dist/solid.cjs",
     "./package.json": "./package.json"
   },
   "keywords": [
@@ -240,4 +93,4 @@
     "coverage": "vitest run --coverage",
     "test-types": "tsc --project tsconfig.test.json"
   }
-}
\\ No newline at end of file
+}
`

// The exports object the pinned package.json must carry (also the target of
// the direct re-pin below). "./store" rides the client store build — the v2
// view imports solid-js/store (seam-rows' store).
export const SOLID_JS_EXPORTS = {
  '.': { types: './types/index.d.ts', import: './dist/solid.js', require: './dist/solid.cjs' },
  './store': { types: './store/types/index.d.ts', import: './store/dist/store.js', require: './store/dist/store.cjs' },
  './dist/solid.js': './dist/solid.js',
  './dist/solid.cjs': './dist/solid.cjs',
  './package.json': './package.json',
}

const WORKSPACE_DEFAULT = `packages:
  - .
nodeLinker: hoisted
autoInstallPeers: false
`

const PATCHED_DEPS_BLOCK = `patchedDependencies:
  solid-js@${SOLID_JS_VERSION}: ${SOLID_PATCH_RELPATH}
`

const PATCH_HEADER_RE = /^patchedDependencies:\s*$/
// A flat-map entry line: `  <key>: <value>` (keys like `solid-js@1.9.17`
// carry no colon; values are patch relpaths). Nested-map or list lines do
// NOT match and mark the block opaque.
const PATCH_ENTRY_RE = /^[ \t]+([^:\s][^:]*):(?:[ \t]+(.*))?$/

/**
 * Parse every top-level `patchedDependencies:` block in the yaml into its
 * flat `pkg@version: relpath` entries. pnpm's patchedDependencies IS a flat
 * string map, so a line-level reader is exact here (a full YAML parser is
 * not available in this dependency-free script). Returns the entries in
 * first-seen order (a duplicated key — the old append bug's shape — keeps
 * its first occurrence), the [start, end) line range of each block, and
 * `opaque: true` when some block holds lines this reader cannot parse (the
 * caller must not rewrite what it cannot reproduce).
 */
function parsePatchBlocks(lines) {
  const entries = []
  const seen = new Set()
  const ranges = []
  let opaque = false
  let i = 0
  while (i < lines.length) {
    if (!PATCH_HEADER_RE.test(lines[i])) {
      i++
      continue
    }
    const start = i
    i++
    while (i < lines.length && /^[ \t]+\S/.test(lines[i])) {
      const m = PATCH_ENTRY_RE.exec(lines[i])
      if (!m) {
        opaque = true
        break
      }
      const key = m[1].trim()
      if (!seen.has(key)) {
        seen.add(key)
        entries.push([key, (m[2] ?? '').trim()])
      }
      i++
    }
    ranges.push([start, i])
  }
  return { entries, seen, ranges, opaque }
}

/**
 * Make sure the profile carries the solid-js patch and registers it with
 * pnpm. Call BEFORE any `pnpm install` in the profile — patchedDependencies
 * must be in pnpm-workspace.yaml when install runs for the pin to survive.
 *
 * Creates pnpm-workspace.yaml with the default hoisted layout when missing.
 * An existing yaml is MERGED, never appended beside: all patchedDependencies
 * blocks are read into one flat map, every solid-js key ≠ the current
 * version is dropped (stale after a bump, e.g. a 0.4.3-era
 * `solid-js@1.9.12:` line), every other package's key is kept verbatim, and
 * ONE `patchedDependencies:` block is written back at the first block's
 * position — an upgraded profile can never carry two solid-js patch keys or
 * two patchedDependencies headers (the latter is a hard pnpm error:
 * "duplicate mapping key"). Other top-level keys (packages, nodeLinker,
 * user edits) are preserved byte-for-byte. A block this reader cannot parse
 * is left untouched rather than half-rewritten. Returns what it did.
 */
export function ensureSolidPatch(profileDir) {
  mkdirSync(join(profileDir, 'patches'), { recursive: true })
  const patchPath = join(profileDir, SOLID_PATCH_RELPATH)
  let patchWrote = false
  if (!existsSync(patchPath) || readFileSync(patchPath, 'utf8') !== SOLID_JS_PATCH) {
    writeFileSync(patchPath, SOLID_JS_PATCH)
    patchWrote = true
  }

  const wsPath = join(profileDir, 'pnpm-workspace.yaml')
  const currentKey = `solid-js@${SOLID_JS_VERSION}`
  if (!existsSync(wsPath)) {
    writeFileSync(wsPath, WORKSPACE_DEFAULT + PATCHED_DEPS_BLOCK)
    return { patchWrote, workspaceNote: 'workspace created' }
  }

  const original = readFileSync(wsPath, 'utf8')
  const lines = original.split('\n')
  const { entries, seen, ranges, opaque } = parsePatchBlocks(lines)
  if (opaque) {
    return {
      patchWrote,
      workspaceNote: 'patchedDependencies is not a flat map — pnpm-workspace.yaml left untouched',
    }
  }

  // One merged block: non-solid-js keys verbatim, other-version solid-js
  // keys dropped, the current key ensured (its existing value is kept when
  // already registered).
  const droppedStale = entries.filter(([key]) => /^solid-js@/.test(key) && key !== currentKey).length
  const kept = entries.filter(([key]) => !/^solid-js@/.test(key) || key === currentKey)
  const hadCurrent = seen.has(currentKey)
  if (!hadCurrent) kept.push([currentKey, SOLID_PATCH_RELPATH])
  const mergedBlock = [
    'patchedDependencies:',
    ...kept.map(([key, value]) => `  ${key}:${value ? ' ' + value : ''}`),
  ]

  let text
  if (ranges.length === 0) {
    // No existing block — append one at the end.
    text = original.replace(/\n*$/, '\n') + PATCHED_DEPS_BLOCK
  } else {
    // Rebuild with ONE merged block at the position of the first one; the
    // remaining block spans collapse away.
    const out = []
    let r = 0
    for (let i = 0; i < lines.length; ) {
      if (r < ranges.length && i === ranges[r][0]) {
        if (r === 0) out.push(...mergedBlock)
        i = ranges[r][1]
        r++
        continue
      }
      out.push(lines[i])
      i++
    }
    text = out.join('\n')
  }

  const notes = []
  if (ranges.length > 1) notes.push('duplicate patchedDependencies blocks merged')
  if (droppedStale > 0) notes.push('stale solid-js patch keys removed')
  notes.push(hadCurrent ? 'patch already registered' : 'patch registered in existing workspace')
  if (text !== original) writeFileSync(wsPath, text)
  return { patchWrote, workspaceNote: notes.join('; ') }
}

/**
 * Directly re-pin node_modules/solid-js/package.json to the client build.
 * Idempotent: returns 'already' when the installed file already matches,
 * 'pinned' after a rewrite, 'missing' when solid-js is not installed.
 */
export function pinSolidJsExports(profileDir) {
  const solidPkg = join(profileDir, 'node_modules', 'solid-js', 'package.json')
  let pkgJson
  try {
    pkgJson = JSON.parse(readFileSync(solidPkg, 'utf8'))
  } catch {
    return 'missing'
  }
  if (pkgJson.module === './dist/solid.js' && JSON.stringify(pkgJson.exports) === JSON.stringify(SOLID_JS_EXPORTS)) {
    return 'already'
  }
  pkgJson.module = './dist/solid.js'
  pkgJson.exports = SOLID_JS_EXPORTS
  writeFileSync(solidPkg, JSON.stringify(pkgJson, null, 2))
  return 'pinned'
}

/**
 * The installer's dependency-unfold keeps the profile's existing deps; a
 * direct solid-js dep left by an older pin (e.g. "1.9.12" from the 0.4.3
 * era) wins the root hoist over the patchedDependencies fix above and puts
 * the SSR build at node_modules/solid-js. Replace any solid-js spec that is
 * not the pinned version; an absent dep stays absent (the patch key alone
 * owns the pin — a profile without a direct dep gains none).
 */
export function pinSolidJsDependency(deps) {
  if (deps['solid-js'] !== undefined && deps['solid-js'] !== SOLID_JS_VERSION) {
    return { ...deps, 'solid-js': SOLID_JS_VERSION }
  }
  return deps
}
