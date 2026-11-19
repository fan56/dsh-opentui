/**
 * Build the in-process bridge bundle (T2a): a node-runnable ESM bundle of
 * packages/bridge's entry, emitted into packages/shell/dist/bridge so it can
 * ride along inside the dsh-opentui tarball (T2 adds dist/bridge to files).
 *
 *   bun scripts/build-bridge.mjs        # -> packages/shell/dist/bridge/index.js
 *   bun packages/bridge/src/index.ts    # (source entry, not the shipped form)
 *
 * Shape notes (mirrors scripts/build-client.mjs, the repo's existing Bun.build
 * convention — no new bundler):
 * - target "node", format "esm": the bridge is loaded by the dsh host's node
 *   process, not by the bun TUI. No bun-only API may leak into the bundle.
 * - No runtime imports in the skeleton; the host closure (cordis, dsh-base)
 *   stays EXTERNAL by declaration so a future import of a host service is
 *   never inlined — @deepseek-ai packages must not be copied into a profile.
 * - outDir is dist/bridge (gitignored at the root). The built directory is a
 *   self-contained cordis bundle: package.json + cordis.patch.yml sit next to
 *   index.js, so the host can load it by package name from a profile symlink.
 * - The host peer (@deepseek-ai/dsh-base) is deliberately NOT declared in the
 *   workspace manifest (packages/bridge/package.json). It is injected into the
 *   DIST manifest at build time, below. Reason: pnpm's autoInstallPeers folds
 *   every peerDependency into the workspace graph and ignores
 *   peerDependenciesMeta.optional, so declaring it in the workspace pulled the
 *   entire host dependency tree into the lockfile (239 -> 957 packages). The
 *   shipped artifact still advertises the peer as optional for the host loader.
 * - T5 also emits bundle-fingerprint.json (name/version/sha256 of index.js)
 *   after the bundle is written; the bin-side guard uses it as the authority
 *   for verifying the bridge a profile symlink resolves to.
 */
import { createHash } from "node:crypto"
import { copyFileSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
// Single source of truth: the SAME window the provisioner gates on. The
// workspace manifest deliberately carries no peer (pnpm would pull the host
// closure into the lockfile), so the range is injected into the dist manifest
// here and read by the host's evaluatePluginCompatibility at load time.
import { HOST_PEER_NAME, HOST_PEER_RANGE } from "../packages/shell/scripts/lib/host-compat.mjs"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const bridgeDir = join(repoRoot, "packages", "bridge")
const outDir = join(repoRoot, "packages", "shell", "dist", "bridge")

/** One prefix rule for the whole host-closure scope: a future `@deepseek-ai/*`
 *  import must never be copied into the bundle (that is a host-code copy, the
 *  shape of the historical wild-package incident). `external` is a string[]
 *  in Bun.build, so the general rule is expressed as an onResolve plugin while
 *  the specifier check itself lives in this single predicate. */
const isHostPackage = (specifier) =>
  specifier === "@deepseek-ai" || specifier.startsWith("@deepseek-ai/")

const keepHostPackagesExternal = {
  name: "keep-host-packages-external",
  setup(build) {
    build.onResolve({ filter: /^@deepseek-ai(?:\/|$)/ }, (args) =>
      isHostPackage(args.path) ? { external: true } : undefined,
    )
  },
}

// Two entrypoints from the same package: the stdio bridge (index.ts) and the
// standalone pre-execute approval gate (approval-gate.ts). Both are loaded by
// the host as cordis plugins; the gate gets its own row in the inproc profile
// patch so it can be enabled independently of the bridge. The same
// external/plugin rules apply to both (no @deepseek-ai code is ever copied).
const sharedBuild = {
  target: "node",
  format: "esm",
  outdir: outDir,
  // Known host-closure specifiers, spelled out for the record (the bridge may
  // stop importing a given one, but the rule stays); the plugin is the
  // prefix-based guard for any future @deepseek-ai/* import.
  external: [
    "@deepseek-ai/dsh-base",
    "@deepseek-ai/cordis",
    "@deepseek-ai/dsh-llm",
    "@deepseek-ai/dsh-llm/message",
  ],
  plugins: [keepHostPackagesExternal],
}
const main = await Bun.build({
  ...sharedBuild,
  entrypoints: [join(bridgeDir, "src", "index.ts")],
  naming: { entry: "index.[ext]" },
})
const gate = await Bun.build({
  ...sharedBuild,
  entrypoints: [join(bridgeDir, "src", "approval-gate.ts")],
  naming: { entry: "approval-gate.[ext]" },
})

if (!main.success || !gate.success) {
  for (const log of [...main.logs, ...gate.logs]) console.error(log)
  process.exit(1)
}
console.log(`[build-bridge] built approval gate bundle at ${join(outDir, "approval-gate.js")}`)

// The bundle is shipped as an installable directory: package.json declares
// main/exports as ./index.js, so it must live alongside the JS in dist/bridge.
// Copy the workspace manifest, then inject the host peer at build time. Everything
// else (name, version, type, dsh.bundle.patch, files, ...) is preserved verbatim.
const bridgePkg = JSON.parse(readFileSync(join(bridgeDir, "package.json"), "utf8"))
bridgePkg.peerDependencies = { [HOST_PEER_NAME]: HOST_PEER_RANGE }
bridgePkg.peerDependenciesMeta = { [HOST_PEER_NAME]: { optional: true } }
writeFileSync(join(outDir, "package.json"), `${JSON.stringify(bridgePkg, null, 2)}\n`)
copyFileSync(join(bridgeDir, "cordis.patch.yml"), join(outDir, "cordis.patch.yml"))

const bundle = join(outDir, "index.js")
const sizeKb = Math.round(readFileSync(bundle).byteLength / 1024)
console.log(`[build-bridge] built ${bundle} (${sizeKb} KB)`)

// T5 — build-time fingerprint. This is the AUTHORITATIVE identity of the
// embedded bridge: the bin-side guard (provision-inproc-profile.mjs step 4)
// re-hashes the RESOLVED artifact and compares name/version/sha256 against
// this file. It is generated after Bun.build has emitted index.js and after
// package.json has been copied, so name/version come from the very package
// being shipped and the hash covers the exact bytes of index.js. The bridge's
// own package.json is deliberately not trusted as self-attestation.
const shippedPkg = JSON.parse(readFileSync(join(outDir, "package.json"), "utf8"))
const sha256 = createHash("sha256").update(readFileSync(bundle)).digest("hex")
const fingerprint = { name: shippedPkg.name, version: shippedPkg.version, sha256 }
const fingerprintPath = join(outDir, "bundle-fingerprint.json")
writeFileSync(fingerprintPath, `${JSON.stringify(fingerprint, null, 2)}\n`)
console.log(`[build-bridge] wrote ${fingerprintPath} (${fingerprint.name}@${fingerprint.version}, sha256 ${sha256.slice(0, 12)}…)`)
