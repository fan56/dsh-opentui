// Bake-time patch: point the pinned provider route's baseURL at the
// in-container mock LLM (127.0.0.1:8642) so every boot of the e2e image
// talks to the scripted mock (e2e/lib/mock-llm.mjs) instead of a real
// provider. Structured YAML edit of the profile patch — the same durable
// store dsh's /login commits routes into — with the yaml module resolved
// from the global dsh closure (the image has no registry access for a bare
// yaml install; same probe as dsh-tui-pi's e2e/lib/patch-setting.mjs).
//
// The route id, model id and apiKeyEnv stay exactly as the installer pinned
// them (zai-coding-cn / glm-5.3-flash / ZAI_CODING_CN_API_KEY): the mock
// keys its phases on the request BODY, never the model name, and the suite's
// footer markers keep asserting the pinned segment. The key env only ever
// carries the placeholder value baked via ENV in the Containerfile — no real
// provider credential exists in this image.
//
// Usage (build-time, from e2e/Containerfile):
//   NODE_OPTIONS= node bake-mock-endpoint.mjs
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const NPM_GLOBAL_ROOT = '/usr/local/lib/node_modules/@deepseek-ai/dsh'
const PROVIDER = process.env.MOCK_PROVIDER || 'zai-coding-cn'
const MOCK_BASE_URL = process.env.MOCK_BASE_URL || 'http://127.0.0.1:8642/v1'
// MOCK_PROFILE selects which profile's patch layer gets the mock baseURL:
// 'dsh-opentui' (default, the baked plugin-face profile) or 'opentui' (the
// client-face profile provisioned at runtime into a scratch DSH_HOME).
const PROFILE_NAME = process.env.MOCK_PROFILE || 'dsh-opentui'
const patchPath = join(
  process.env.DSH_HOME || join(homedir(), '.dsh'),
  'profiles', PROFILE_NAME, 'cordis.patch.yml',
)

const { parse, stringify } = createRequire(join(NPM_GLOBAL_ROOT, 'package.json'))('yaml')
const doc = parse(readFileSync(patchPath, 'utf8')) ?? []
if (!Array.isArray(doc)) {
  throw new Error(`bake-mock-endpoint: ${patchPath} is not a top-level YAML array`)
}

const route = doc.find(entry => entry && entry.id === 'llm-pi-ai')
  ?.config?.providers?.[PROVIDER]
if (!route) {
  throw new Error(`bake-mock-endpoint: providers.${PROVIDER} not found under the llm-pi-ai patch entry`)
}
route.baseURL = MOCK_BASE_URL
writeFileSync(patchPath, stringify(doc), 'utf8')
console.log(`[bake-mock-endpoint] providers.${PROVIDER}.baseURL -> ${MOCK_BASE_URL} (${patchPath})`)
