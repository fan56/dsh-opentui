/**
 * Format the local extractor output into the committed CapIR (capir/capir.json).
 *
 * The extractor (a developer-machine-only tool) emits raw parse results; this
 * script is the *only* place that stamps the provenance declaration onto the
 * generated file. Do not paste the declaration by hand.
 *
 *   node scripts/gen-capir.mjs <extractor-json> <output-json> [provenance-json]
 *   node scripts/gen-capir.mjs --check [extractor-json] [output-json] [provenance-json]
 *
 * `--check` regenerates in memory and byte-compares against the output file,
 * exiting 1 on any drift. It is the CI anti-laundering gate: an edit to the
 * committed capir/capir.json that was not produced by a re-run cannot pass.
 * With no paths, --check uses the committed inputs below.
 *
 * Provenance (source_branch/source_version) is read from an independent input
 * file, never hardcoded here: a host rc bump updates provenance in one place.
 *
 * The declaration is emitted as the first key and kept on the first physical
 * line of the JSON so CI can assert it by line as well as by field value.
 * Strict JSON is preserved (no comment syntax).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ATTRIBUTION =
  "Derived from deepseek-ai/deepseek-harness (MIT, Copyright (c) 2026 DeepSeek)"
const SCHEMA = "dsh-opentui.capir/2"
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const fail = (msg) => {
  console.error("gen-capir: " + msg)
  process.exit(1)
}

const argv = process.argv.slice(2)
const checkMode = argv[0] === "--check"
const paths = checkMode ? argv.slice(1) : argv
if (paths.length > 3) {
  console.error("usage: gen-capir.mjs [--check] <extractor-json> <output-json> [provenance-json]")
  process.exit(2)
}
const input = resolve(paths[0] ?? resolve(ROOT, "capir/extractor-input.json"))
const output = resolve(paths[1] ?? resolve(ROOT, "capir/capir.json"))
const provenancePath = resolve(paths[2] ?? resolve(ROOT, "capir/provenance-input.json"))

const src = JSON.parse(readFileSync(input, "utf8"))
const prov = JSON.parse(readFileSync(provenancePath, "utf8"))

if (!Array.isArray(src.artifacts)) fail("extractor JSON has no artifacts[]")
if (src.totals == null) fail("extractor JSON has no totals")
for (const key of ["repository", "license", "copyright", "source_branch", "source_version", "artifact_glob", "extraction", "formatting"]) {
  if (typeof prov[key] !== "string" || prov[key].length === 0) {
    fail("provenance input missing or empty: " + key)
  }
}

// --- 静态全集校验：拒绝任何内部不一致，不为了对上数字硬凑 ---
const artifacts = src.artifacts.map((a) => {
  if (!a.package) fail("artifact missing package")
  if (!Array.isArray(a.methods)) fail("artifact missing methods[]: " + a.package)
  return {
    package: a.package,
    dir: a.dir,
    js: a.js,
    dts: a.dts,
    namespaces: a.namespaces,
    methods_dts: a.methods_dts,
    methods_js: a.methods_js,
    js_keys_match_dts: a.methods_js_match_dts,
    // fixup suggestion #3: the value is a per-artifact method COUNT, not a
    // map. Renamed to endpoints_count under schema/2 (extractor keeps its
    // own input key `endpoints_map`; only the emitted CapIR field changes).
    endpoints_count: a.endpoints_map,
    scope_variants: a.scope_variants,
    methods: a.methods.map((m) => ({
      id: `${a.package}#${m.key}`,
      namespace: m.namespace,
      name: m.name,
      kind: m.kind,
      class: m.class,
    })),
  }
})

const allMethods = artifacts.flatMap((a) => a.methods)
const ids = allMethods.map((m) => m.id)
if (new Set(ids).size !== ids.length) fail("duplicate method id")
if (allMethods.some((m) => m.class !== "W")) fail("non-W method in static set")
if (allMethods.some((m) => m.kind !== "unary" && m.kind !== "stream")) {
  fail("unexpected method kind")
}
if (artifacts.length !== src.totals.artifacts) fail("artifact count mismatch")
if (allMethods.length !== src.totals.methods_dts) fail("method count mismatch")
const kinds = {
  unary: allMethods.filter((m) => m.kind === "unary").length,
  stream: allMethods.filter((m) => m.kind === "stream").length,
}
if (kinds.unary !== src.totals.methods_by_kind.unary) fail("unary count mismatch")
if (kinds.stream !== src.totals.methods_by_kind.stream) fail("stream count mismatch")

const capir = {
  attribution: ATTRIBUTION,
  schema: SCHEMA,
  provenance: {
    repository: prov.repository,
    license: prov.license,
    copyright: prov.copyright,
    source_branch: prov.source_branch,
    source_version: prov.source_version,
    artifact_glob: prov.artifact_glob,
    extraction: prov.extraction,
    formatting: prov.formatting,
  },
  counting_rules: src.counting_rules,
  totals: {
    artifacts: artifacts.length,
    methods: allMethods.length,
    methods_by_kind: kinds,
    methods_by_class: { W: allMethods.length },
    endpoints_session_controller: src.totals.endpoints_session_controller_map,
    endpoints_global_map_sum: src.totals.endpoints_global_map_sum,
    scope_variants_global: src.totals.scope_variants_global,
  },
  artifacts,
}

let text = JSON.stringify(capir, null, 2) + "\n"
// Keep the declaration on the first physical line while staying strict JSON.
const declLine = `  "attribution": ${JSON.stringify(ATTRIBUTION)},`
if (!text.startsWith("{\n" + declLine)) fail("attribution line not at head")
text = "{" + declLine.trimStart() + text.slice(("{\n" + declLine).length)

if (checkMode) {
  let actual
  try {
    actual = readFileSync(output, "utf8")
  } catch {
    fail("--check: output file missing: " + output)
  }
  if (actual === text) {
    console.log(`capir --check: byte-identical (artifacts=${artifacts.length} methods=${allMethods.length}) -> ${output}`)
  } else {
    const aLines = text.split("\n")
    const bLines = actual.split("\n")
    let at = 0
    while (at < aLines.length && at < bLines.length && aLines[at] === bLines[at]) at++
    console.error(`gen-capir --check: DRIFT at line ${at + 1}`)
    console.error(`  expected: ${JSON.stringify(aLines[at] ?? "<eof>")}`)
    console.error(`  actual:   ${JSON.stringify(bLines[at] ?? "<eof>")}`)
    console.error("  committed capir.json was not produced by the current generator/inputs; re-run gen-capir.mjs.")
    process.exit(1)
  }
} else {
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, text, "utf8")
  console.log(`capir: artifacts=${artifacts.length} methods=${allMethods.length} ` +
    `unary=${kinds.unary} stream=${kinds.stream} -> ${output}`)
}
