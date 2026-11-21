// Bake-time patch: the legacy container scenarios assert the pinned model
// route (`zai-coding-cn` / `glm-5.3-flash`) in the powerline footer. That pin
// lives in the `opentui` profile patch, but S6 moved the session onto the
// `opentui-inproc` bridge profile, whose own patch defaults to
// `opencode-go` / `deepseek-v4.1-flash`. The thin root launcher provisions the
// inproc profile with that default, so the legacy footer markers drifted.
//
// This helper re-pins the inproc profile's agent-default-model to the SAME
// route the legacy scenarios (and bake-mock-endpoint.mjs) declare, so the
// assertions keep checking the pinned segment instead of being weakened to
// match a topology default. Structured YAML edit of the same durable patch
// store, with the yaml module resolved from the global dsh closure (same
// probe as bake-mock-endpoint.mjs).
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const NPM_GLOBAL_ROOT = '/usr/local/lib/node_modules/@deepseek-ai/dsh'
const PROVIDER = process.env.MOCK_PROVIDER || 'zai-coding-cn'
const MODEL = process.env.MOCK_MODEL || 'glm-5.3-flash'
const patchPath = join(
  process.env.DSH_HOME || join(homedir(), '.dsh'),
  'profiles', 'opentui-inproc', 'cordis.patch.yml',
)

const { parse, stringify } = createRequire(join(NPM_GLOBAL_ROOT, 'package.json'))('yaml')
const doc = parse(readFileSync(patchPath, 'utf8')) ?? []
if (!Array.isArray(doc)) {
  throw new Error(`bake-inproc-model-pin: ${patchPath} is not a top-level YAML array`)
}
const route = doc.find(entry => entry && entry.id === 'agent-default-model')
if (!route?.config) {
  throw new Error(`bake-inproc-model-pin: agent-default-model entry not found in ${patchPath}`)
}
route.config.provider = PROVIDER
route.config.model = MODEL
writeFileSync(patchPath, stringify(doc), 'utf8')
console.log(`[bake-inproc-model-pin] agent-default-model -> ${PROVIDER}/${MODEL} (${patchPath})`)
