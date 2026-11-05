/**
 * Build the host plugin: a self-contained dist-host/ package the dsh
 * profile mounts via `link:`. OpenTUI/solid stay external (installed by
 * the profile); dsh-llm resolves from the global dsh closure through a
 * symlink, exactly like dsh-tui-pi's link-dsh-closure mechanism.
 *
 * Usage: bun build-host.ts [--only-symlink]
 */
import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, realpathSync, rmSync, symlinkSync } from "node:fs"
import { dirname, join } from "node:path"
// batch 10a: the v2 view graph compiles with the SAME @opentui/solid the
// runtime resolves (0.8.1, tui-base's pin) — shell's own dep is still the
// old-stack 0.7.0 and its plugin emits for that runtime.
// @ts-expect-error direct file import, bypassing shell's 0.7.0 resolution
import solidPlugin from "../tui-base/node_modules/@opentui/solid/scripts/solid-plugin.js"

const pkgDir = dirname(new URL(import.meta.url).pathname)
const outDir = join(pkgDir, "dist-host")

function linkDshClosure() {
  const scopeDir = join(outDir, "node_modules", "@deepseek-ai")
  let closure: string | undefined
  try {
    const bin = execFileSync("which", ["dsh"], { encoding: "utf8" }).trim()
    const real = realpathSync(bin)
    closure = join(dirname(dirname(real)), "node_modules", "@deepseek-ai")
  } catch {
    /* no dsh on PATH: skip */
  }
  if (!closure || !existsSync(join(closure, "dsh-llm"))) {
    console.warn("[build-host] global dsh closure not found; dsh-llm will not resolve")
    return
  }
  mkdirSync(scopeDir, { recursive: true })
  const link = join(scopeDir, "dsh-llm")
  rmSync(link, { force: true })
  symlinkSync(join(closure, "dsh-llm"), link, "dir")
  console.log(`[build-host] symlink ${link} -> ${join(closure, "dsh-llm")}`)
}

/** Pin solid-js to its CLIENT build — under node its "node" export condition
 * resolves to dist/server.js (SSR, no reactive scheduling), which is exactly
 * what @opentui/solid's bun preload remaps away in dev. The node edition of
 * that fix is rewriting the installed package's exports. */
async function pinSolidClient() {
  const p = join(outDir, "node_modules", "solid-js", "package.json")
  if (!existsSync(p)) return
  const pkg = JSON.parse(await Bun.file(p).text())
  pkg.exports = {
    ".": { types: "./types/index.d.ts", import: "./dist/solid.js", require: "./dist/solid.cjs" },
    "./dist/solid.js": "./dist/solid.js",
    "./dist/solid.cjs": "./dist/solid.cjs",
    "./package.json": "./package.json",
  }
  await Bun.write(p, JSON.stringify(pkg, null, 2))
  console.log("[build-host] solid-js pinned to client build (dist/solid.js)")
}

if (process.argv.includes("--only-symlink")) {
  linkDshClosure()
  await pinSolidClient()
  process.exit(0)
}

const result = await Bun.build({
  // batch 10a: the plugin entry swaps to the rebuilt tui-base view
  // (host-entry-v2); the old host-entry/ShellHost stay in tree until 10c.
  entrypoints: [join(pkgDir, "src", "host-entry-v2.tsx")],
  target: "node",
  format: "esm",
  outdir: outDir,
  plugins: [solidPlugin],
  external: ["@opentui/core", "@opentui/solid", "@opentui/keymap", "solid-js", "@deepseek-ai/dsh-llm"],
  naming: { entry: "index.[ext]" },
})
if (!result.success) {
  for (const l of result.logs) console.error(l)
  process.exit(1)
}

const manifest = {
  name: "@dsh-opentui/shell",
  version: "0.2.0",
  private: true,
  type: "module",
  main: "index.js",
  exports: { ".": "./index.js" },
  dsh: { bundle: { patch: "./plugin.patch.yml" } },
  dependencies: {
    "@opentui/core": "0.8.1",
    "@opentui/solid": "0.8.1",
    "@opentui/keymap": "0.8.1",
    "solid-js": "1.9.17",
  },
}
await Bun.write(join(outDir, "package.json"), JSON.stringify(manifest, null, 2))
linkDshClosure()
await pinSolidClient()
// ship the welcome whale image inside the bundle dir — welcome.tsx
// resolves it as ./assets/whale.png relative to dist-host/index.js
console.log("built -> packages/shell/dist-host (host plugin)")
