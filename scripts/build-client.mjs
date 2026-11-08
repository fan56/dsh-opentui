/**
 * Build the client-mode bundle (plugin-mode retirement, batch B1): a
 * self-contained JS bundle of packages/shell's client entry for the npm
 * client distribution — the published package ships this bundle and its
 * bin is launched by bun (no --preload: the solid transform runs at BUILD
 * time here instead of the launcher's runtime preload).
 *
 *   bun scripts/build-client.mjs     # -> packages/shell/dist/client/index.js
 *   bun packages/shell/dist/client/index.js
 *
 * Shape notes:
 * - target "bun" — the client runs under bun (FFI, import attributes, bun
 *   export conditions all match the launcher's `bun --preload ...` run).
 * - Solid JSX transform: tui-base's OWN @opentui/solid bun plugin (0.8.x,
 *   the renderer context the v2 view graph runs on) — the same package the
 *   runtime resolves inside the bundle. build-host.ts is the precedent for
 *   the plugin import path.
 * - The v2 entry (tui-base/examples/v2-entry.tsx) is reached through a
 *   COMPUTED dynamic import in client-entry.tsx ("opaque to tsc"). A
 *   bundler cannot statically resolve a computed specifier, so an onLoad
 *   rewrite pins it to the literal path for the build only — the source
 *   file keeps its tsc-opaque form and the direct-run path is unchanged.
 * - @opentui/core stays EXTERNAL: it dlopens a native library and resolves
 *   parser assets (parser.worker.js, tree-sitter) via import.meta.url —
 *   both break when bundled into a foreign directory. The published client
 *   package depends on @opentui/core (installed beside the bundle); solid
 *   /keymap/solid-js are plain JS and ship INSIDE the bundle.
 * - @deepseek-ai/dsh-client-connection stays EXTERNAL (red line): the SDK is
 *   DeepSeek private code, distributed only inside a global dsh install's
 *   node_modules closure — inlining it here would redistribute it in a
 *   public npm tarball. It is listed explicitly so the bundler keeps the
 *   `import("@deepseek-ai/dsh-client-connection/client")` in
 *   src/client/transport.ts as a RUNTIME import even in a dev checkout
 *   where a closure symlink makes the package resolvable at build time. At
 *   runtime the bin (bin/dsh-opentui.mjs) bridges resolution by symlinking
 *   the SDK from the global dsh closure into the package's node_modules.
 * - The idle reaper spawn resolves `join(import.meta.dir, "../scripts",
 *   "idle-reaper.mjs")` — in the bundle that is dist/scripts/, so the
 *   reaper script is copied there.
 *
 * The output is gitignored (root .gitignore: dist/).
 */
import { copyFileSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const shellDir = join(repoRoot, "packages", "shell")
const tuiBaseDir = join(repoRoot, "packages", "tui-base")
const outDir = join(shellDir, "dist", "client")

// Solid bun plugin from tui-base's own resolution context (0.8.x) — must
// match the @opentui/solid the bundled view graph resolves at runtime.
const solidPluginModule = await import(
  join(tuiBaseDir, "node_modules", "@opentui/solid", "scripts", "solid-plugin.js")
)
const solidPlugin = solidPluginModule.default ?? solidPluginModule

const V2_LITERAL = '"../../tui-base/examples/v2-entry.tsx"'
const NEEDLE = "await import(v2Specifier)"
// v2-entry's loadShell(): five more computed specifiers, "../../" + "shell/src/client/"
const SHELL_IMPORT_RE = /import\(SHELL \+ "([^"]+)"\)/g
// lifecycle.ts loadRealMint(): `dynamicImport(specifier)` wrapper defeats
// tsc until cookie-mint.ts lands — under the bundler the wrapped import
// stays a computed runtime import and breaks in the bundle.
const MINT_NEEDLE = "await dynamicImport(specifier)"

const result = await Bun.build({
  entrypoints: [join(shellDir, "src", "client-entry.tsx")],
  target: "bun",
  format: "esm",
  outdir: outDir,
  naming: { entry: "index.[ext]" },
  plugins: [
    // ORDER MATTERS: registered before the solid plugin — plugin onLoad
    // resolution is first-match-wins, and this rewrite must own
    // client-entry.tsx (the file carries no JSX, so the solid transform
    // has nothing to do on it).
    {
      name: "client-v2-static-import",
      setup(build) {
        // client-entry.tsx: pin the computed v2-entry specifier to the
        // literal path so the bundler inlines the v2 view graph.
        build.onLoad({ filter: /client-entry\.tsx$/ }, (args) => {
          let src = readFileSync(args.path, "utf8")
          if (!src.includes(NEEDLE)) {
            throw new Error(
              `[build-client] client-entry.tsx no longer contains "${NEEDLE}" — the v2-entry dynamic import shape changed, update this rewrite`,
            )
          }
          src = src.replace(NEEDLE, `await import(${V2_LITERAL})`)
          return { contents: src, loader: "tsx" }
        })
        // tui-base/examples/v2-entry.tsx: loadShell() pulls five shell
        // client modules through the computed `SHELL + "…"` prefix — pin
        // each to its literal path (relative to tui-base/examples) so the
        // bundler inlines them too. Modules keep their lazy dynamic-import
        // semantics inside the bundle.
        build.onLoad({ filter: /v2-entry\.tsx$/ }, (args) => {
          const src = readFileSync(args.path, "utf8")
          const rewritten = src.replace(SHELL_IMPORT_RE, (_m, name) => `import("../../shell/src/client/${name}")`)
          if (rewritten === src) {
            throw new Error(
              `[build-client] v2-entry.tsx no longer matches ${SHELL_IMPORT_RE} — the loadShell computed-import shape changed, update this rewrite`,
            )
          }
          return { contents: rewritten, loader: "tsx" }
        })
        // lifecycle.ts: pin loadRealMint() to the (existing) cookie-mint
        // module — the dynamicImport-wrapper idiom cannot be statically
        // resolved by the bundler. Both loop specifiers collapse to the one
        // literal; the first iteration wins, the second is dead.
        build.onLoad({ filter: /client\/lifecycle\.ts$/ }, (args) => {
          const src = readFileSync(args.path, "utf8")
          if (!src.includes(MINT_NEEDLE)) {
            throw new Error(
              `[build-client] lifecycle.ts no longer contains "${MINT_NEEDLE}" — the cookie-mint dynamic-import shape changed, update this rewrite`,
            )
          }
          // drop the now-dead wrapper line too (bun keeps unused vars, and
          // the leak guard below must not see its import(specifier))
          return {
            contents: src
              .replace(MINT_NEEDLE, 'await import("./cookie-mint.ts")')
              .replace(/const dynamicImport = \(specifier: string\): Promise<unknown> => import\(specifier\)\n/, ""),
            loader: "ts",
          }
        })
      },
    },
    solidPlugin,
  ],
  external: ["@opentui/core", "@deepseek-ai/dsh-client-connection"],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

// The bundle's import.meta.dir is dist/client -> the reaper path becomes
// dist/scripts/idle-reaper.mjs; ship it there.
mkdirSync(join(shellDir, "dist", "scripts"), { recursive: true })
copyFileSync(join(shellDir, "scripts", "idle-reaper.mjs"), join(shellDir, "dist", "scripts", "idle-reaper.mjs"))

const bundle = join(outDir, "index.js")
const sizeKb = Math.round(readFileSync(bundle).byteLength / 1024)
console.log(`[build-client] built ${bundle} (${sizeKb} KB)`)

// Non-zero exit if the graph leaked a COMPUTED runtime import (a leftover
// `const v2Specifier = ...` declaration is fine — the call must be gone):
// the bundle must boot without the repo.
const out = readFileSync(bundle, "utf8")
const leaked = [...out.matchAll(/import\(\s*[A-Za-z_$][\w$]*\s*[+)]/g)].map((m) => m[0])
if (leaked.length > 0) {
  console.error("[build-client] bundle still contains computed dynamic import(s):", [...new Set(leaked)])
  process.exit(1)
}
