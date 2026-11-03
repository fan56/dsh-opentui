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
 * Used by scripts/install-profile.mjs (before its pnpm install steps) and
 * scripts/sync-profile.mjs (the local-dev deploy loop).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const SOLID_JS_VERSION = '1.9.12'
export const SOLID_PATCH_RELPATH = `patches/solid-js@${SOLID_JS_VERSION}.patch`

// pristine solid-js@1.9.12 package.json -> client-pinned variant:
// - "module" points at dist/solid.js instead of dist/server.js
// - exports["."] drops the worker/deno/node conditions (node used to win and
//   select the SSR build) and resolves straight to dist/solid.js
// - the SSR-flavored subpath exports (./store, ./web, ./h, ...) go away; the
//   host bundle imports bare "solid-js" only
export const SOLID_JS_PATCH = `diff --git a/package.json b/package.json
index ad27a1f..f3aa43a 100644
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
@@ -44,164 +44,12 @@
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
-    "./store": {
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
-      "types": "./store/types/index.d.ts",
-      "import": "./store/dist/store.js",
-      "require": "./store/dist/store.cjs"
-    },
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
`

// The exports object the pinned package.json must carry (also the target of
// the direct re-pin below).
export const SOLID_JS_EXPORTS = {
  '.': { types: './types/index.d.ts', import: './dist/solid.js', require: './dist/solid.cjs' },
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

/**
 * Make sure the profile carries the solid-js patch and registers it with
 * pnpm. Call BEFORE any `pnpm install` in the profile — patchedDependencies
 * must be in pnpm-workspace.yaml when install runs for the pin to survive.
 *
 * Creates pnpm-workspace.yaml with the default hoisted layout when missing;
 * otherwise appends the patchedDependencies key only when not yet present
 * (user edits to the yaml are preserved). Returns what it did.
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
  let workspaceNote
  if (!existsSync(wsPath)) {
    writeFileSync(wsPath, WORKSPACE_DEFAULT + PATCHED_DEPS_BLOCK)
    workspaceNote = 'workspace created'
  } else {
    const ws = readFileSync(wsPath, 'utf8')
    if (ws.includes(`solid-js@${SOLID_JS_VERSION}:`)) {
      workspaceNote = 'patch already registered'
    } else {
      writeFileSync(wsPath, ws.replace(/\n*$/, '\n') + PATCHED_DEPS_BLOCK)
      workspaceNote = 'patch registered in existing workspace'
    }
  }
  return { patchWrote, workspaceNote }
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
