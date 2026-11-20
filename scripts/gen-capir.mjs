/**
 * Format the local extractor output into the committed CapIR (capir/capir.json).
 *
 * The extractor (a developer-machine-only tool) emits raw parse results; this
 * script is the *only* place that stamps the provenance declaration onto the
 * generated file. Do not paste the declaration by hand.
 *
 *   node scripts/gen-capir.mjs <extractor-json> <output-json>
 *
 * The declaration is emitted as the first key and kept on the first physical
 * line of the JSON so CI can assert it by line as well as by field value.
 * Strict JSON is preserved (no comment syntax).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"

const ATTRIBUTION =
  "Derived from deepseek-ai/deepseek-harness (MIT, Copyright (c) 2026 DeepSeek)"
const SCHEMA = "dsh-opentui.capir/1"

const [, , inputArg, outputArg] = process.argv
if (!inputArg || !outputArg) {
  console.error("usage: gen-capir.mjs <extractor-json> <output-json>")
  process.exit(2)
}
const input = resolve(inputArg)
const output = resolve(outputArg)

const src = JSON.parse(readFileSync(input, "utf8"))
const fail = (msg) => {
  console.error("gen-capir: " + msg)
  process.exit(1)
}

if (!Array.isArray(src.artifacts)) fail("extractor JSON has no artifacts[]")
if (src.totals == null) fail("extractor JSON has no totals")

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
    endpoints_map: a.endpoints_map,
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
    repository: "deepseek-ai/deepseek-harness",
    license: "MIT",
    copyright: "Copyright (c) 2026 DeepSeek",
    source_branch: "feat/companion-install-hint",
    source_version: "0.2.2-rc.5",
    artifact_glob: "packages/**/lib/typert.remote-client.js",
    extraction: "local read-only; scripts/extract_capir_artifacts.py",
    formatting: "scripts/gen-capir.mjs",
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

mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, text, "utf8")

console.log(`capir: artifacts=${artifacts.length} methods=${allMethods.length} ` +
  `unary=${kinds.unary} stream=${kinds.stream} -> ${output}`)
