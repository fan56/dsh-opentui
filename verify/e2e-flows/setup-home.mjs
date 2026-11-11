#!/usr/bin/env node
// Scratch DSH_HOME builder for the e2e flow suite.
//
//   node setup-home.mjs --home <dir> --workspace <dir> --port <fakeModelPort>
//                       [--template <dshHome>]
//
// Builds an ISOLATED home for one scenario:
//   profiles/opentui/  — the real `opentui` profile's manifest/config copied
//                        from --template (default $DSH_HOME || ~/.dsh), with
//                        node_modules a READ-ONLY symlink to the template
//                        profile's node_modules (never written through), and a
//                        hand-written cordis.patch.yml that routes the host at
//                        the local fake model ONLY.
//   models-store.json  — one provider `fake-gw` (openai-completions) whose
//                        baseUrl is the fake model.
//   .credentials.yaml  — NOT created. The fake route authenticates through the
//                        DSH_FAKE_API_KEY env ref (a placeholder value the
//                        runner exports), so no real secret is ever copied.
//
// The workspace gets `.dsh/config.yml` pinning provider/model at the fake
// route — the same workspace-overlay staging the real client reads.
//
// Everything is written under --home; the template home is only READ.
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : def
}

const home = resolve(arg('home', ''))
const ws = resolve(arg('workspace', ''))
const port = String(arg('port', '0'))
const template = resolve(arg('template', process.env.DSH_HOME || join(homedir(), '.dsh')))
const PROFILE = 'opentui'
const TEMPLATE_PROFILE = join(template, 'profiles', PROFILE)

if (!home || !ws) { console.error('usage: setup-home.mjs --home <dir> --workspace <dir> --port <n>'); process.exit(2) }
if (!existsSync(TEMPLATE_PROFILE)) {
  console.error(`template profile missing: ${TEMPLATE_PROFILE} — run the client once on a dev machine to provision it`)
  process.exit(3)
}

rmSync(home, { recursive: true, force: true })
mkdirSync(join(home, 'profiles', PROFILE), { recursive: true })
mkdirSync(ws, { recursive: true })
chmodSync(home, 0o700)

// --- profile manifest + non-node_modules files -------------------------------
const pkgPath = join(TEMPLATE_PROFILE, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
writeFileSync(join(home, 'profiles', PROFILE, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
for (const name of ['config.json', 'cordis.yml']) {
  const from = join(TEMPLATE_PROFILE, name)
  if (existsSync(from)) cpSync(from, join(home, 'profiles', PROFILE, name))
}
// deterministic profile prefs: no stale theme migration, auto-resume OFF by
// default (scenario 1 asserts a plain boot is a NEW session)
const cfgPath = join(home, 'profiles', PROFILE, 'config.json')
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
const templatePatchPath = join(TEMPLATE_PROFILE, 'cordis.patch.yml')
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
writeFileSync(join(home, 'profiles', PROFILE, 'cordis.patch.yml'), `${routeText}${keptEntries ? keptEntries + '\n' : ''}`)

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

// --- node_modules: read-only view of the template profile -------------------
symlinkSync(join(TEMPLATE_PROFILE, 'node_modules'), join(home, 'profiles', PROFILE, 'node_modules'), 'dir')

// --- workspace overlay: pin the session route -------------------------------
mkdirSync(join(ws, '.dsh'), { recursive: true })
writeFileSync(join(ws, '.dsh', 'config.yml'), 'model:\n  provider: fake-gw\n  model: demo-1\n')

console.log(`E2E_HOME=${home}`)
console.log(`E2E_WS=${ws}`)
console.log(`fake-gw baseUrl: http://127.0.0.1:${port}/v1`)
