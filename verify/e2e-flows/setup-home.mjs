#!/usr/bin/env node
// Scratch DSH_HOME builder for the e2e flow suite.
//
//   node setup-home.mjs --home <dir> --workspace <dir> --port <fakeModelPort>
//
// Builds an ISOLATED home for one scenario by running the real in-process
// provisioner against the scratch HOME (never reads ~/.dsh), then pinning its
// only model route at the local fake model:
//   profiles/<active>/ — real provisioned manifest/config/patch/node_modules
//   models-store.json  — one provider `fake-gw` (openai-completions) whose
//                        baseUrl is the fake model
//   .credentials.yaml  — NOT created. The fake route authenticates through the
//                        DSH_FAKE_API_KEY env ref (a placeholder value the
//                        runner exports), so no real secret is ever copied.
//
// The workspace gets `.dsh/config.yml` pinning provider/model at the fake
// route — the same workspace-overlay staging the real client reads.
//
// Everything is written under --home.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_PROFILE } from '../../packages/shell/scripts/lib/profile-name.mjs'
import { provisionScratchProfile } from '../lib/scratch-profile.mjs'

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : def
}

const home = resolve(arg('home', ''))
const ws = resolve(arg('workspace', ''))
const port = String(arg('port', '0'))
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PROFILE = DEFAULT_PROFILE

if (!home || !ws) { console.error('usage: setup-home.mjs --home <dir> --workspace <dir> --port <n>'); process.exit(2) }

rmSync(home, { recursive: true, force: true })
mkdirSync(home, { recursive: true })
mkdirSync(ws, { recursive: true })
chmodSync(home, 0o700)
let profileDir
try {
  profileDir = provisionScratchProfile({ home, repo: REPO })
} catch (error) {
  console.error(`e2e-flows: ${error.message}`)
  process.exit(3)
}

// deterministic profile prefs: no stale theme migration, auto-resume OFF by
// default (scenario 1 asserts a plain boot is a NEW session)
const cfgPath = join(profileDir, 'config.json')
const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {}
cfg.skinMigration = 1
cfg.autoResume = 'off'
if (typeof cfg.theme !== 'string' || cfg.theme === '') cfg.theme = 'dsh-blue'
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n')

// --- the ONLY model route: the local fake model ------------------------------
// The template patch carries the ambient tool rows (tool-bash/tool-fs/…),
// permission, web and MCP rows that make the host's tool catalog real; keep
// every entry verbatim and only replace the model route entries. Text-level
// split: the template patch uses a `!!js` YAML tag the plain parser rejects.
const templatePatchPath = join(profileDir, 'cordis.patch.yml')
const routeText = `# e2e-flows scratch profile — provider fake-gw points at the local fake model.
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      fake-gw:
        apiKeyEnv: DSH_FAKE_API_KEY
        displayName: E2E Fake Gateway
        api: openai-completions
        baseURL: http://127.0.0.1:${port}/v1
        models:
          - id: demo-1
            name: demo-1
            contextWindow: 65536
            maxTokens: 8192
            input:
              - text
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: fake-gw
    model: demo-1
    reasoningEffort: high
`
let keptEntries = ''
if (existsSync(templatePatchPath)) {
  const blocks = []
  let current = null
  for (const line of readFileSync(templatePatchPath, 'utf8').split('\n')) {
    if (/^- id: /.test(line)) {
      if (current) blocks.push(current)
      current = [line]
    } else if (current) current.push(line)
  }
  if (current) blocks.push(current)
  keptEntries = blocks
    .filter((b) => !/^- id: (llm-pi-ai|agent-default-model)\s*$/.test(b[0]))
    .map((b) => b.join('\n').replace(/\n+$/, ''))
    .join('\n')
}
writeFileSync(templatePatchPath, `${routeText}${keptEntries ? keptEntries + '\n' : ''}`)

// --- model catalog entry (pickers / session/modelCatalog) --------------------
writeFileSync(join(home, 'models-store.json'), JSON.stringify({
  'fake-gw': {
    models: [{
      id: 'demo-1',
      name: 'E2E Demo 1',
      api: 'openai-completions',
      provider: 'fake-gw',
      baseUrl: `http://127.0.0.1:${port}/v1`,
      reasoning: true,
      input: ['text'],
    }],
    checkedAt: 0,
    lastModified: 0,
    etag: '"e2e-fake"',
  },
}, null, 2) + '\n')

// --- workspace overlay: pin the session route -------------------------------
mkdirSync(join(ws, '.dsh'), { recursive: true })
writeFileSync(join(ws, '.dsh', 'config.yml'), 'model:\n  provider: fake-gw\n  model: demo-1\n')

console.log(`E2E_HOME=${home}`)
console.log(`E2E_WS=${ws}`)
console.log(`fake-gw baseUrl: http://127.0.0.1:${port}/v1`)
