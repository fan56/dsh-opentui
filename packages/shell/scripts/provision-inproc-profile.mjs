#!/usr/bin/env node
// provision-inproc-profile.mjs — idempotent provisioning of the fixed
// `opentui-inproc` host profile (ADR-0009 decision 3; T3 of the in-process
// bridge plan).
//
// Invoked by the launcher ONLY when DSH_OPENTUI_INPROC=1
// (bin/dsh-opentui.mjs); the default `opentui` profile path is untouched.
// Seven local-FS steps (the first is the host-version gate), no pnpm/npm, no install scripts:
//
//   [1/7] host     — detect the running dsh version. OUTSIDE the supported
//                    window (>=0.2.2-rc.3 <0.3.0) => fail-fast with the three
//                    fail-fast elements: the host would otherwise skip the
//                    bridge bundle silently (it only records the conflict in
//                    `skippedBundles`) and bridge.hello would time out. INSIDE
//                    the window but not yet exempted => grant the profile-local
//                    exact-version exemption in compatibility.json. Never
//                    grants outside the window: --accept-risk is not a way to
//                    mask a genuine incompatibility.
//   [2/7] manifest — write $DSH_HOME/profiles/opentui-inproc/package.json with
//                    dsh.profile.bundles = [@deepseek-ai/dsh-base,
//                    @aiwayds/dsh-opentui-bridge]. NO @deepseek-ai/* dependency
//                    is ever written: the host's installation-first bundle
//                    resolution supplies those bundles from the running dsh
//                    closure (wild-package shadowing is the historical
//                    incident this guard prevents).
//   [3/7] symlink  — create node_modules/@aiwayds/dsh-opentui-bridge as an
//                    ABSOLUTE symlink to THIS installation's dist/bridge
//                    (realpath). No link:/file: protocol, no copying.
//   [4/7] verify   — re-read the link and confirm it resolves to dist/bridge;
//                    refuse any @deepseek-ai copy in the profile.
//   [5/7] identity — T5 guard: hash the RESOLVED bridge's index.js and compare
//                    with the build-time fingerprint shipped in THIS
//                    installation's dist/bridge/bundle-fingerprint.json, plus
//                    name / version. No realpath-prefix hard binding.
//   [6/7] patch    — ONLY when DSH_OPENTUI_INPROC=1: generate
//                    $DSH_HOME/profiles/opentui-inproc/cordis.patch.yml from
//                    the embedded inproc-only template (web-app compensation
//                    rows removed, profileRevision stamped). The template also
//                    registers the standalone sessionController shim plus the
//                    real @deepseek-ai/dsh-api-session-controller plugin — no
//                    dsh-web-app bundle is pulled in. Without the env this step
//                    is skipped entirely — old behavior unchanged.
//   [7/7] shim     — ONLY when DSH_OPENTUI_INPROC=1: generate the local shim
//                    package under the profile's node_modules (@aiwayds scope)
//                    that the patch row above resolves. Its @deepseek-ai/cordis
//                    import is resolved by the host against the profile scope,
//                    exactly like the bridge. revision + backup converge it.
//
// T4 — cross-instance mutual exclusion:
//   The whole provisioning run is serialized by `.provision.lock` in the
//   profile dir, created with O_EXCL ("wx"). A live holder makes late
//   instances wait briefly (bounded retries) and then SKIP; a stale lock
//   (holder pid gone, age over threshold, corrupt, or self-leftover) is
//   taken over. The lock is released in `finally`, including on failure.
//   Same-machine only: no cross-host / cross-user semantics.
//
// Idempotency: an existing symlink that resolves to the exact expected target
// is left untouched. An existing entry that points somewhere else is NOT
// overwritten: a conflict is reported (the identity guard below still runs
// and decides whether the resolved artifact is acceptable).
//
// T7 — repair mode (`--repair`, invoked by `dsh-opentui --repair-bridge`):
//   In the normal path the conflict above is report-only. With --repair the
//   SAME lock and the SAME pass are used, but a wrong symlink target (or a
//   non-symlink entry) is replaced with the absolute link to this install's
//   dist/bridge; a missing / wrong manifest is still converged as usual. The
//   T5 identity guard runs afterwards either way — repair fixes the LINK,
//   never the artifact CONTENT, so a fingerprint mismatch still fails.
//
// Hard guard: this script only ever touches the ONE profile named
// `opentui-inproc`. It never runs a package manager and never writes a
// dependency into the manifest.

import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
// P0 fail-fast: ONE text source shared with the handshake path in
// src/client/seam-bootstrap.ts. Both ProvisionError (fingerprint) and
// BridgeBootstrapError (handshake) now carry the same three elements.
import {
  BRIDGE_APPEND_PRESET_NOTICE,
  BRIDGE_REPAIR_HINT,
} from './lib/bridge-failfast-text.mjs'
// Host-version gate. The host only records an incompatible profile bundle in
// `skippedBundles` (no stderr on this path), so the pre-boot check here is the
// point where a mismatch becomes an explicit, actionable failure.
import {
  HOST_PEER_RANGE,
  HOST_VERSION_ENV,
  detectHostVersion,
  ensureHostExemption,
  isHostVersionSupported,
} from './lib/host-compat.mjs'

const PREFIX = 'dsh-opentui(inproc): '
const PROFILE = 'opentui-inproc'
const BRIDGE_NAME = '@aiwayds/dsh-opentui-bridge'
const BUNDLES = ['@deepseek-ai/dsh-base', BRIDGE_NAME]

// --- T4 lock tuning (same-machine only) -------------------------------------
const LOCK_NAME = '.provision.lock'
const LOCK_STALE_MS = 30_000 // a live holder older than 30s is treated as stale
const LOCK_RETRY_MS = 25 // backoff between attempts while a peer holds the lock
const LOCK_MAX_ATTEMPTS = 40 // <= ~1s of waiting before a peer is skipped

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const bridgeDirRaw = join(pkgRoot, 'dist', 'bridge')
const fingerprintPath = join(bridgeDirRaw, 'bundle-fingerprint.json')

const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', PROFILE)
const manifestPath = join(profileDir, 'package.json')
const linkPath = join(profileDir, 'node_modules', ...BRIDGE_NAME.split('/'))
const lockPath = join(profileDir, LOCK_NAME)

// --- Inproc patch ownership (gated by DSH_OPENTUI_INPROC=1) -----------------
// The launcher sets this on the opt-in startup path; --repair-bridge and direct
// invocation do not. Keeping the gate HERE makes those paths byte-for-byte
// identical to the pre-patch behavior.
const INPROC_MODE = process.env.DSH_OPENTUI_INPROC === '1'
const TOTAL_STEPS = INPROC_MODE ? 7 : 5
const PATCH_NAME = 'cordis.patch.yml'
const patchPath = join(profileDir, PATCH_NAME)
const PATCH_REVISION_MARKER = '# profileRevision: '
// Local shim package generated under the profile's node_modules. It lives in
// the @aiwayds scope (never @deepseek-ai — see the guard in step [4/7]) so the
// host resolves it from the profile scope; its own @deepseek-ai/cordis import
// is routed by the host's runtime interception to the same dsh closure that
// serves the bridge. The patch row uses this bare package name.
const SHIM_PACKAGE = '@aiwayds/dsh-opentui-session-shim'
const SHIM_DIR = join(profileDir, 'node_modules', ...SHIM_PACKAGE.split('/'))
const SHIM_INDEX_PATH = join(SHIM_DIR, 'index.mjs')
const SHIM_PKG_PATH = join(SHIM_DIR, 'package.json')
const SHIM_REVISION_MARKER = '// shimRevision: '
const PATCH_TEMPLATE = `# model route (managed by provision-opentui-profile.mjs — provider zai-coding-cn, key read by the host from ZAI_CODING_CN_API_KEY):
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      zai-coding-cn:
        apiKeyEnv: ZAI_CODING_CN_API_KEY
        models:
          - id: glm-4.5
            name: glm-4.5
            input:
              - text
          - id: glm-4.5-air
            name: glm-4.5-air
            input:
              - text
          - id: glm-4.6
            name: glm-4.6
            input:
              - text
          - id: glm-4.6v
          - id: glm-4.7
            name: glm-4.7
            input:
              - text
          - id: glm-5
            name: glm-5
            input:
              - text
          - id: glm-5-turbo
            name: glm-5-turbo
            input:
              - text
          - id: glm-5.1
            name: glm-5.1
            input:
              - text
          - id: glm-5.2
            name: GLM 5.2
            input:
              - text
          - id: glm-5.3
            name: GLM 5.3
            input:
              - text
          - id: glm-5.3-flash
            name: glm-5.3-flash
            input:
              - text
          - id: glm-5.3-flashx
            name: glm-5.3-flashx
            input:
              - text
          - id: glm-5.3-flashx-legal
            name: glm-5.3-flashx-legal
            input:
              - text
          - id: glm-5.3-highspeed
      xiaomi-token-plan-cn:
        models:
          - id: mimo-v2.5-asr
            name: mimo-v2.5-asr
            input:
              - text
          - id: mimo-v2.5-tts
            name: mimo-v2.5-tts
            input:
              - text
          - id: mimo-v2.5-tts-voiceclone
            name: mimo-v2.5-tts-voiceclone
            input:
              - text
          - id: mimo-v2.5-tts-voicedesign
            name: mimo-v2.5-tts-voicedesign
            input:
              - text
          - id: mimo-v2.6-flash
            name: MiMo-V2.6-Flash
            contextWindow: 1048576
            input:
              - text
              - image
            compat:
              thinkingFormat: deepseek
              supportsReasoningEffort: false
          - id: mimo-v2.6-pro
            name: MiMo-V2.6-Pro
            contextWindow: 1048576
            input:
              - text
              - image
            compat:
              thinkingFormat: deepseek
              supportsReasoningEffort: false
      opencode-go:
        apiKeyEnv: OPENCODE_GO_API_KEY
        models:
          - id: beam-free
            name: Beam Free
            contextWindow: 1048576
            input:
              - text
          - id: claude-haiku-5-5
            name: Claude Haiku 5.5
            contextWindow: 1000000
            input:
              - text
              - image
          - id: deepseek-v4-pro
            name: DeepSeek V4 Pro
            contextWindow: 1000000
            input:
              - text
            reasoningEfforts:
              high: high
              max: max
            compat:
              thinkingFormat: deepseek
          - id: deepseek-v4.1-flash
            name: DeepSeek V4.1 Flash 1017
            contextWindow: 1000000
            input:
              - text
              - image
            reasoningEfforts:
              low: low
              high: high
              max: max
            compat:
              thinkingFormat: deepseek
          - id: gemini-4-argon
            name: Gemini 4 Argon
            contextWindow: 1048576
            input:
              - text
              - image
          - id: glm-5.2
            name: GLM-5.2
            contextWindow: 1000000
            input:
              - text
          - id: glm-5.3
            name: GLM-5.3
            contextWindow: 1000000
            input:
              - text
          - id: glm-5.3-flash
            name: GLM-5.3-Flash
            contextWindow: 1000000
            input:
              - text
              - image
          - id: gpt-5.6-luna
            name: GPT-5.6 Luna
            contextWindow: 1050000
            input:
              - text
              - image
          - id: gpt-6-luna
            name: GPT-6 Luna
            contextWindow: 1050000
            input:
              - text
              - image
          - id: grok-4.7
            name: Grok 4.7
            contextWindow: 500000
            input:
              - text
              - image
          - id: hy3
            name: Hy3
            contextWindow: 256000
            input:
              - text
          - id: hy4
            name: Hy4
            contextWindow: 1048576
            input:
              - text
              - image
          - id: hy4-preview
            name: Hy4 preview
            contextWindow: 1024000
            input:
              - text
          - id: iceman-contributor-free
            name: Iceman Contributor Free
            contextWindow: 262144
            input:
              - text
          - id: kimi-k2.7-code
            name: Kimi K2.7 Code
            contextWindow: 262144
            input:
              - text
              - image
          - id: kimi-k3
            name: Kimi K3
            contextWindow: 1048576
            input:
              - text
              - image
          - id: kimi-k3.1-pro
            name: Kimi K3.1 Pro
            contextWindow: 1048576
            input:
              - text
              - image
          - id: longcat-2.0
            name: LongCat-2.0
            contextWindow: 1000000
            input:
              - text
          - id: longcat-2.5-free
            name: LongCat 2.5 Free
            contextWindow: 1000000
            input:
              - text
              - image
          - id: mimo-v2.5
            name: MiMo V2.5
            contextWindow: 1000000
            input:
              - text
              - image
          - id: mimo-v2.5-pro
            name: MiMo V2.5 Pro
            contextWindow: 1048576
            input:
              - text
          - id: mimo-v2.6-flash
            name: MiMo-V2.6-Flash
            contextWindow: 1048576
            input:
              - text
              - image
          - id: mimo-v2.6-pro
            name: MiMo-V2.6-Pro
            contextWindow: 1048576
            input:
              - text
              - image
          - id: minimax-m3
            name: MiniMax-M3
            contextWindow: 1000000
            input:
              - text
              - image
          - id: minimax-m3.1-flash
            name: MiniMax M3.1 Flash
            contextWindow: 1000000
            input:
              - text
              - image
          - id: muse-spark-1.2-contributor
            name: Muse Spark 1.2 Contributor
            contextWindow: 1048576
            input:
              - text
              - image
          - id: muse-spark-1.3-contributor
            name: Muse Spark 1.3 Contributor
            contextWindow: 1048576
            input:
              - text
              - image
          - id: qwen3.7-plus
            name: Qwen3.7 Plus
            contextWindow: 1000000
            input:
              - text
              - image
          - id: qwen3.8-flash
            name: Qwen3.8 Flash
            contextWindow: 1000000
            input:
              - text
              - image
          - id: qwen3.8-max
            name: Qwen3.8 Max
            contextWindow: 1000000
            input:
              - text
              - image
          - id: step-5-preview
            name: Step 5 Preview
            contextWindow: 1000000
            input:
              - text
              - image
# Toolface restore (toolfix 2026-11-08), mirroring the tui profile's ambient
# tool rows. The @deepseek-ai/dsh-web-app bundle disables the dsh-base ambient
# tool rows (tool-bash/tool-todo/…) and recomposes them per agent preset, but
# this profile's effective default preset resolves to \`native\` = ambient
# composition (registry 0.19.0 agent-preset-registry default), which left the
# main session without todo and subagent sessions without bash. These rows are
# the last patch layer, so they win per id. Forms copied verbatim from the
# dsh-base/tui ambient rows.
- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: !!js process.platform === 'win32'
- id: tool-todo
  name: '@deepseek-ai/dsh-tool-todo'
  # disabled: false must be stated explicitly — id-targeted patch rows merge
  # per key (config replaces wholesale), so an omitted \`disabled\` inherits the
  # web-app's \`disabled: true\` on the ambient row.
  disabled: false
  config:
    allowParallelInProgress: true
# The subagent face also composes from the ambient rows, and the web-app
# disabled the file tools + instructions service the tui ambient face has on:
# without these, spawned agents get bash but no read/write/search surface.
# Forms copied verbatim from the dsh-base rows (tui ambient state).
- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'
  disabled: false
  config:
    applyPatch: false
- id: tool-fs-search
  name: '@deepseek-ai/dsh-tool-fs-search'
  disabled: false
  config:
    sampleOverCapGlobResults: false
- id: agent-instructions
  name: '@deepseek-ai/dsh-agent-instructions'
  disabled: false
  config:
    maxBytes: 65536
- id: tool-result-pruner
  name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
  disabled: false
  config:
    thresholdChars: 8192
    headChars: 4096
    tailChars: 1024
# tui mounts ask_user ambient via its dsh-tui-pi bundle; this profile has no
# equivalent bundle (its @aiwayds/dsh-opentui bundle is skipped by the host),
# so the row is inserted here instead of overridden.
- insert:
    - id: tool-ask-user
      name: '@deepseek-ai/dsh-tool-ask-user'
# Web search restore (webtool 2026-11-10). The dsh-web-app bundle disables the
# ambient tool-web row and the effective default preset is \`native\` (ambient
# composition), so the main session had no web_search/web_fetch tool. This row
# is the last patch layer and wins per id. Form copied verbatim from dsh-base.
- id: tool-web
  name: '@deepseek-ai/dsh-tool-web'
  disabled: false
  config:
    fetch: true
    searchTimeoutMs: 60000
- id: permission
  name: "@deepseek-ai/dsh-permission-presets"
  config:
    presets:
      read-only:
        sandbox: read-only
        approval: ask
      workspace-write:
        sandbox: workspace-write
        approval: ask
      danger-full-access:
        sandbox: danger-full-access
        approval: never
    # T9 (ADR-0011): default to the confined + ask preset. Escape hatch: set
    # DSH_OPENTUI_APPROVAL_GATE=off to restore the pre-T9 permissive default.
    defaultPreset: !!js process.env.DSH_OPENTUI_APPROVAL_GATE === 'off' && 'danger-full-access' || 'workspace-write'

# Pre-execute approval gate (ADR-0011 T9). Armed BY DEFAULT for the write tools
# the host actually registers (verified in dsh-tool-bash/src/index.ts:393 and
# dsh-tool-fs/src/{write,edit,apply-patch}.ts): it returns {kind:'ask'} for them,
# driving approval.request -> bridge answerer -> ask.request -> TUI approval card.
# Read-only tools (read/search/glob/...) are untouched and pass via next().
# Escape hatch: DSH_OPENTUI_APPROVAL_GATE=off sets enabled=false (and reverts the
# preset above), restoring the old frictionless behavior. Never default to off.
# See tickets/2026-11-18-approval-trigger-mechanism.md.
- insert:
    - id: dsh-opentui-approval-gate
      name: '@aiwayds/dsh-opentui-bridge/approval-gate'
      config:
        enabled: !!js process.env.DSH_OPENTUI_APPROVAL_GATE !== 'off'
        reason: 'Write operations require human approval'
        tools:
          bash: ask
          write: ask
          edit: ask
          apply_patch: ask

# MCP (managed by provision-opentui-profile.mjs — the adapter's mcp_list/mcp_call need a client row; context7 needs no key and a failed/offline connection is non-fatal):
- insert:
    - id: mcp-context7
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: context7
        transport: streamable-http
        url: https://mcp.context7.com/mcp
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: opencode-go
    model: deepseek-v4.1-flash
    reasoningEffort: high

- id: subagent
  name: "@deepseek-ai/dsh-subagent"
  config:
    maxActiveSubagents: 3

# Standalone sessionController support (no dsh-web-app bundle). The real
# controller needs 13 injects; 11 come from dsh-base, and the two web-only ones
# (fileUploads, workspaceRegistry) are satisfied by the local shim package
# generated in step [7/7]. No connection shim: dsh-api-gateway's optional
# ctx.inject(['connection']) calls connection.rpc.intercept(...), which a no-op
# stub cannot honor; leaving connection absent only keeps the controller's
# SessionMediaReferences sub-plugin pending, which does not block list().
- insert:
    - id: dsh-opentui-session-shim
      name: '@aiwayds/dsh-opentui-session-shim'
    - id: session-controller
      name: '@deepseek-ai/dsh-api-session-controller'
`
const PATCH_REVISION = createHash('sha256').update(PATCH_TEMPLATE).digest('hex').slice(0, 16)
const PATCH_HEADER = `# dsh-opentui inproc profile patch — GENERATED by provision-inproc-profile.mjs; edit the script, not this file.\n${PATCH_REVISION_MARKER}${PATCH_REVISION}\n`
const PATCH_CONTENT = `${PATCH_HEADER}${PATCH_TEMPLATE}`
// MD5 of the web/opentui template this profile used to copy verbatim (see
// tickets/2026-11-18-inproc-profile-inventory.md §0). A local file matching it
// is an unowned legacy copy and is replaced without a backup.
const KNOWN_PATCH_MD5 = new Set(['54b66bf37fbbb93a6f9dd204a24473f7'])

// --- Standalone sessionController shim template -----------------------------
// Generated into the profile's node_modules (step [7/7]) so its runtime imports
// are resolved from the profile scope by the host, exactly like the bridge.
// The real controller imports fileUploads / workspaceRegistry as TYPES ONLY;
// only the narrow methods below are ever called, so no dsh-web-app closure is
// needed. No `connection` shim on purpose (see the patch template comment).
const SHIM_INDEX_TEMPLATE = `// Standalone sessionController support for the opentui-inproc profile.
// GENERATED by provision-inproc-profile.mjs; edit the script, not this file.
import { Service } from '@deepseek-ai/cordis'

class FileUploadsShim extends Service {
  constructor(ctx) {
    super(ctx, 'fileUploads')
  }

  // SessionController[Service.init] registers its Agent resolver via
  // ctx.effect, which uses the return value as a disposer. No uploads happen
  // in the inproc profile, so both resolver and disposer are no-ops.
  registerAgentResolver(_resolve) {
    return () => {}
  }

  // Unknown/unstaged receipt: the real service returns undefined for an id it
  // never staged. Returning undefined is the faithful value, not a fabricated
  // empty upload that could be mistaken for a real attachment.
  resolve(_agent, _receiptId) {
    return undefined
  }

  // Commands uses \`using binding = ...\` then commit(). A no-op binding with
  // both commit() and Symbol.dispose keeps the prompt flow from throwing if a
  // non-list RPC ever reaches it (the inproc bridge only exposes session.list).
  bindPrompt(_agent, _receiptIds, _requestId) {
    return {
      commit() {},
      [Symbol.dispose]() {},
    }
  }

  retirePrompt(_agent, _requestId) {}
}

class WorkspaceRegistryShim extends Service {
  constructor(ctx) {
    super(ctx, 'workspaceRegistry')
  }

  // ArchivedSessionGate reads this at init. An empty array means no session is
  // archived, so list() needs no archive filtering.
  get archivedSessionIds() {
    return []
  }

  // session.create / fork RPCs (not exposed by the inproc bridge) would reach
  // these; empty / undefined is the honest "no workspaces exist" answer.
  get(_id) {
    return undefined
  }

  list() {
    return []
  }
}

export function apply(ctx) {
  ctx.plugin(FileUploadsShim)
  ctx.plugin(WorkspaceRegistryShim)
}
`
const SHIM_REVISION = createHash('sha256').update(SHIM_INDEX_TEMPLATE).digest('hex').slice(0, 16)
const SHIM_INDEX_CONTENT = `${SHIM_REVISION_MARKER}${SHIM_REVISION}\n${SHIM_INDEX_TEMPLATE}`
const SHIM_PKG_CONTENT = `${JSON.stringify({
  name: SHIM_PACKAGE,
  version: '0.1.0',
  type: 'module',
  main: './index.mjs',
  private: true,
}, null, 2)}\n`

const say = (step, label, value = '') => console.log(`${PREFIX}[${step}/${TOTAL_STEPS}] ${label}${value ? ` — ${value}` : ''}`)
const warn = (message) => console.error(`${PREFIX}WARN ${message}`)
const note = (message) => console.log(`${PREFIX}${message}`)

class ProvisionError extends Error {
  constructor(message, detail = '') {
    super(message)
    this.detail = detail
  }
}

// Throw instead of process.exit so a `finally` block can always release the
// lock. The top-level handler sets a non-zero exit code after cleanup.
//
// P0 fail-fast: EVERY failure is self-contained with all three elements.
// Element 1 (diagnosis, incl. the identity guard's expected/actual lines) is
// the caller's `message`/`detail`; elements 2 + 3 now come from the ONE shared
// source so the fingerprint path can never again omit the mode notice that
// the handshake path alone used to print.
function fail(message, detail = '') {
  const fullDetail = [detail, BRIDGE_REPAIR_HINT, BRIDGE_APPEND_PRESET_NOTICE]
    .filter(Boolean)
    .join('\n')
  throw new ProvisionError(message, fullDetail)
}

// Synchronous sleep: the whole script is synchronous, so a blocking wait is
// appropriate here. Atomics.wait is permitted on the Node.js main thread.
function sleepSync(ms) {
  const buf = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(buf, 0, 0, ms)
}

// --- T4: lock helpers -------------------------------------------------------
function readJsonObject(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function readLock() {
  const raw = readJsonObject(lockPath)
  if (!raw || !Number.isInteger(raw.pid) || !Number.isFinite(raw.ts)) return undefined
  return raw
}

/** process.kill(pid, 0) probes existence without signalling. EPERM means the
 *  process exists but belongs to another user — treat it as alive (no
 *  cross-user takeover semantics by design). */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function staleReason(lock) {
  if (lock === undefined) return 'lock file is unreadable or corrupt'
  if (lock.pid === process.pid) return `held by self (pid ${lock.pid})`
  if (!pidAlive(lock.pid)) return `holder pid ${lock.pid} no longer exists`
  return `holder pid ${lock.pid} alive but lock age ${Date.now() - lock.ts}ms > ${LOCK_STALE_MS}ms`
}

function isStale(lock) {
  if (lock === undefined) return true
  if (lock.pid === process.pid) return true
  if (!pidAlive(lock.pid)) return true
  return Date.now() - lock.ts > LOCK_STALE_MS
}

/** Exclusive-create the lock. Returns the owned token, or undefined when a
 *  live peer kept it through all retries (caller then SKIPs). Stale locks are
 *  removed and re-contended. Ownership is re-read after create so a concurrent
 *  stale-takeover cannot make two processes both believe they hold it. */
function acquireLock() {
  for (let attempt = 1; attempt <= LOCK_MAX_ATTEMPTS; attempt++) {
    const token = { pid: process.pid, ts: Date.now() }
    let created = false
    try {
      const fd = openSync(lockPath, 'wx', 0o600)
      try {
        writeSync(fd, JSON.stringify(token))
      } finally {
        closeSync(fd)
      }
      created = true
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }

    if (created) {
      const held = readLock()
      if (held && held.pid === token.pid && held.ts === token.ts) {
        if (attempt > 1) note(`acquired provisioning lock on attempt ${attempt}`)
        return token
      }
      // Our create was immediately replaced by another process — do NOT
      // unlink (the lock now belongs to them); just retry.
      sleepSync(LOCK_RETRY_MS)
      continue
    }

    // EEXIST: inspect the holder.
    const lock = readLock()
    if (isStale(lock)) {
      note(`stale provisioning lock (${staleReason(lock)}); taking over`)
      try {
        unlinkSync(lockPath)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      continue
    }
    if (attempt === 1 || attempt % 5 === 0) {
      note(`waiting for provisioning lock (holder pid ${lock.pid}, age ${Date.now() - lock.ts}ms) — attempt ${attempt}/${LOCK_MAX_ATTEMPTS}`)
    }
    sleepSync(LOCK_RETRY_MS)
  }
  return undefined
}

/** Only unlink a lock that is still ours, so a peer that took over after our
 *  stale threshold never loses its own lock to our cleanup. */
function releaseLock(token) {
  if (!token) return
  try {
    const held = readLock()
    if (held && held.pid === token.pid && held.ts === token.ts) unlinkSync(lockPath)
  } catch {
    /* best effort cleanup: never mask the primary provisioning result */
  }
}

// --- Provisioning helpers ---------------------------------------------------
function readManifest() {
  return readJsonObject(manifestPath)
}

const desiredManifest = (existing) => ({
  ...existing,
  dsh: {
    ...(existing?.dsh ?? {}),
    profile: {
      ...(existing?.dsh?.profile ?? {}),
      bundles: [...BUNDLES],
    },
  },
})

function linkState(path) {
  let lst
  try {
    lst = lstatSync(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return { kind: 'absent' }
    throw error
  }
  if (!lst.isSymbolicLink()) return { kind: 'not-symlink' }
  const raw = readlinkSync(path)
  // Resolve a relative target against the link's own directory so comparison
  // is meaningful; a realpath (when resolvable) also collapses link chains.
  const abs = resolvePath(dirname(path), raw)
  let resolved = abs
  try {
    resolved = realpathSync(path)
  } catch {
    /* dangling link — fall back to the lexical absolute target */
  }
  return { kind: 'symlink', raw, abs, resolved }
}

/** Remove whatever occupies `path` (symlink, file or directory) so the correct
 *  symlink can be created in its place. Repair mode only; ENOENT is a no-op. */
function removePath(path) {
  let st
  try {
    st = lstatSync(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  if (st.isDirectory()) rmSync(path, { recursive: true, force: true })
  else unlinkSync(path)
}

// --- T5: bridge identity guard ---------------------------------------------
function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Validate the RESOLVED bridge against the build-time fingerprint shipped in
 *  THIS installation. The fingerprint is the authority (not the bridge's own
 *  package.json, which would be self-attestation), and there is deliberately
 *  NO realpath-prefix check: a repointed link is accepted iff name, version
 *  and index.js hash all match — a 0.23.0 split-package install must work. */
function verifyBridgeIdentity() {
  const fp = readJsonObject(fingerprintPath)
  if (
    !fp ||
    typeof fp.name !== 'string' ||
    typeof fp.version !== 'string' ||
    typeof fp.sha256 !== 'string'
  ) {
    fail(
      'build-time bridge fingerprint is missing or malformed',
      `Expected ${fingerprintPath} with string fields name/version/sha256. Rebuild with: bun scripts/build-bridge.mjs`,
    )
  }

  let resolved
  try {
    resolved = realpathSync(linkPath)
  } catch (error) {
    fail(
      `bridge symlink cannot be resolved: ${linkPath}`,
      `${error?.message ?? error}`,
    )
  }

  const resolvedPkg = readJsonObject(join(resolved, 'package.json'))
  const actualName = resolvedPkg?.name
  const actualVersion = resolvedPkg?.version
  let actualHash
  try {
    actualHash = sha256File(join(resolved, 'index.js'))
  } catch (error) {
    actualHash = `<unreadable: ${error?.code ?? error?.message ?? error}>`
  }

  const mismatches = []
  const add = (field, expected, actual) => mismatches.push({ field, expected, actual: String(actual) })
  if (actualName !== fp.name) add('name', fp.name, actualName)
  if (actualVersion !== fp.version) add('version', fp.version, actualVersion)
  if (actualHash !== fp.sha256) add('sha256(index.js)', fp.sha256, actualHash)

  if (mismatches.length > 0) {
    const fields = mismatches.map((m) => m.field).join(', ')
    const detail = mismatches.map((m) => `  ${m.field}: expected "${m.expected}", actual "${m.actual}"`).join('\n')
    fail(
      `bridge identity check failed — ${fields} mismatch`,
      `Resolved bridge: ${resolved}\n${detail}`,
    )
  }

  say(5, 'identity', `name=${fp.name} version=${fp.version} sha256=${fp.sha256.slice(0, 12)}…`)
  note(`bridge identity OK — ${resolved}`)
}

// --- Host-version gate ------------------------------------------------------
/** Fail loud on an unsupported host; grant the exact exemption when in-window.
 *  Diagnosis carries expected/actual; fail() appends repair + no-append. The
 *  check runs before any profile mutation so a bad host never leaves a
 *  half-provisioned profile behind. */
function verifyHostCompatibility(bridgeDir) {
  let hostVersion
  try {
    hostVersion = detectHostVersion()
  } catch (error) {
    fail(
      'cannot verify the dsh host version before loading the bridge',
      `${error instanceof Error ? error.message : String(error)}\nDetected with \`dsh --version\` (override: ${HOST_VERSION_ENV}=<exact version>).`,
    )
  }

  if (!isHostVersionSupported(hostVersion)) {
    fail(
      `dsh host version is outside the bridge support window — expected ${HOST_PEER_RANGE}, actual ${hostVersion}`,
      `The host would skip ${BRIDGE_NAME} without a usable error and bridge.hello would time out (BRIDGE_TIMEOUT). `
        + `Install a dsh host in ${HOST_PEER_RANGE}, or upgrade dsh-opentui. `
        + `Detection override: ${HOST_VERSION_ENV}=${process.env[HOST_VERSION_ENV] ?? '(unset)'}.`,
    )
  }

  const bridgePkg = readJsonObject(join(bridgeDir, 'package.json'))
  const packageName = bridgePkg?.name
  const packageVersion = bridgePkg?.version
  if (typeof packageName !== 'string' || typeof packageVersion !== 'string') {
    fail(
      'bridge manifest has no name/version for the host-version exemption',
      `${join(bridgeDir, 'package.json')} must declare string name and version.`,
    )
  }

  try {
    const { changed, key } = ensureHostExemption({ profileDir, packageName, packageVersion, hostVersion })
    say(1, 'host', changed
      ? `granted exact-version exemption ${key} for dsh ${hostVersion}`
      : `supported host ${hostVersion}; exemption ${key} already present`)
  } catch (error) {
    fail(
      `could not grant the host-version exemption for ${BRIDGE_NAME} on dsh ${hostVersion}`,
      error instanceof Error ? error.message : String(error),
    )
  }
}

// --- Inproc cordis.patch.yml ownership ------------------------------------
/** Read the profileRevision stamped by this script, if present. */
function readPatchRevision(content) {
  const match = typeof content === 'string' ? content.match(/^# profileRevision: ([0-9a-f]+)$/m) : null
  return match ? match[1] : undefined
}

/** Converge the profile patch to the embedded inproc template.
 *  - exact current content (revision matches) -> no-op (idempotent, no write)
 *  - known web/opentui template copy          -> replace silently (legacy template)
 *  - anything else, incl. a hand-edited output -> timestamped backup + WARN
 *
 *  Marker presence alone is NOT proof of ownership: a user can edit a generated
 *  file while leaving the marker intact. Only a byte-for-byte match with the
 *  current generated content counts as "this script's own output". */
function provisionPatch() {
  let current
  try {
    current = readFileSync(patchPath, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    current = undefined
  }

  const localRevision = readPatchRevision(current)
  if (current === PATCH_CONTENT && localRevision === PATCH_REVISION) {
    say(6, 'patch', 'already current, skipping')
    return
  }

  if (current !== undefined && current.length > 0) {
    const md5 = createHash('md5').update(current).digest('hex')
    if (!KNOWN_PATCH_MD5.has(md5)) {
      const backupPath = `${patchPath}.bak-${Date.now()}`
      renameSync(patchPath, backupPath)
      warn(`cordis.patch.yml was modified outside provisioning (local revision ${localRevision ?? 'absent'}, md5 ${md5} matches neither a known web/opentui template nor the current generated profileRevision ${PATCH_REVISION}); backed up to ${backupPath}`)
    }
  }

  // Atomic write: temp file in the same dir, then rename.
  const tmpPath = `${patchPath}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmpPath, PATCH_CONTENT)
  renameSync(tmpPath, patchPath)
  say(6, 'patch', `wrote ${patchPath} (profileRevision ${PATCH_REVISION})`)
}

// --- Standalone sessionController shim ownership ---------------------------
/** Read the shimRevision stamped by this script, if present. */
function readShimRevision(content) {
  const match = typeof content === 'string' ? content.match(/^\/\/ shimRevision: ([0-9a-f]+)$/m) : null
  return match ? match[1] : undefined
}

/** Converge one generated shim file with the same revision + backup policy as
 *  the patch. Only a byte-for-byte match with the current generated content
 *  counts as this script's own output; any other content is backed up with a
 *  WARN before the authoritative bytes are written atomically.
 *  @returns true when a file was written. */
function convergeShimFile(path, content, label, expectedRevision) {
  let current
  try {
    current = readFileSync(path, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    current = undefined
  }

  const localRevision = expectedRevision === undefined ? undefined : readShimRevision(current)
  if (current === content && localRevision === expectedRevision) return false

  if (current !== undefined && current.length > 0) {
    const backupPath = `${path}.bak-${Date.now()}`
    renameSync(path, backupPath)
    warn(`${label} content differs from the generated form (shimRevision local ${localRevision ?? 'absent'}, expected ${expectedRevision ?? 'n/a'}); backed up to ${backupPath}`)
  }

  mkdirSync(dirname(path), { recursive: true })
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmpPath, content)
  renameSync(tmpPath, path)
  return true
}

/** Generate the local shim package the patch's session-controller row resolves.
 *  Mirrors the patch's convergence policy: exact -> no-op, else backup + WARN
 *  + atomic write. index.mjs carries a shimRevision marker; package.json is a
 *  fixed manifest converged by exact content. */
function provisionShim() {
  const indexChanged = convergeShimFile(SHIM_INDEX_PATH, SHIM_INDEX_CONTENT, 'session controller shim index.mjs', SHIM_REVISION)
  const pkgChanged = convergeShimFile(SHIM_PKG_PATH, SHIM_PKG_CONTENT, 'session controller shim package.json', undefined)
  if (!indexChanged && !pkgChanged) {
    say(7, 'shim', 'already current, skipping')
    return
  }
  say(7, 'shim', `wrote ${SHIM_DIR} (shimRevision ${SHIM_REVISION})`)
}

// --- The provision pass itself (runs under the lock) ------------------------
function runProvision({ repair = false } = {}) {
  if (repair) note('repair mode — a wrong bridge symlink will be rebuilt (content is never repaired)')
  // Prerequisites (read-only) are checked before any mutation.
  if (!existsSync(bridgeDirRaw) || !statSync(bridgeDirRaw).isDirectory()) {
    fail(
      `bridge artifact directory not found: ${bridgeDirRaw}`,
      'Rebuild the bridge (bun scripts/build-bridge.mjs) or reinstall @aiwayds/dsh-opentui so dist/bridge ships with the package.',
    )
  }
  for (const required of ['package.json', 'index.js', 'bundle-fingerprint.json']) {
    if (!existsSync(join(bridgeDirRaw, required))) {
      fail(
        `bridge artifact is incomplete: ${join(bridgeDirRaw, required)} not found`,
        'Expected package.json, index.js and bundle-fingerprint.json in dist/bridge; rebuild with bun scripts/build-bridge.mjs.',
      )
    }
  }
  // The symlink must carry a REAL resolved (absolute) path, never a relative
  // or symlinked-in path that could drift with cwd or a moved install.
  const bridgeDir = realpathSync(bridgeDirRaw)

  // [1/7] Host compatibility: fail loud when the running dsh is outside the
  // supported window (the host would otherwise skip the bridge silently), and
  // grant the exact-version exemption when it is in-window but not exempted.
  verifyHostCompatibility(bridgeDir)

  // [2/7] Manifest: write / converge the profile manifest. Only
  // dsh.profile.bundles is managed; every other field is preserved.
  {
    const existing = existsSync(manifestPath) ? readManifest() : undefined
    if (existsSync(manifestPath) && existing === undefined) {
      fail(`${manifestPath} is not a valid JSON object manifest — leaving it untouched`)
    }
    const desired = desiredManifest(existing ?? { name: `dsh-profile-${PROFILE}`, private: true })
    if (existing !== undefined && JSON.stringify(existing) === JSON.stringify(desired)) {
      say(2, 'manifest', 'already correct, skipping')
    } else {
      mkdirSync(profileDir, { recursive: true })
      if (existsSync(manifestPath)) {
        const backupPath = `${manifestPath}.bak-${Date.now()}`
        renameSync(manifestPath, backupPath)
        console.log(`${PREFIX}backed up ${manifestPath} to ${backupPath}`)
      }
      // Atomic write: a temp file in the same dir, then rename, so a
      // concurrent reader never observes a partially written package.json.
      const tmpPath = `${manifestPath}.tmp-${process.pid}-${Date.now()}`
      writeFileSync(tmpPath, `${JSON.stringify(desired, null, 2)}\n`)
      renameSync(tmpPath, manifestPath)
      say(2, 'manifest', `wrote bundles [${BUNDLES.join(', ')}]`)
    }
  }

  // [3/7] Symlink: create the absolute link, skip when already correct, and
  // ONLY in repair mode replace a wrong target / non-symlink entry. Normal
  // startup stays report-only (a conflict is a WARN, never an overwrite).
  let conflict = null
  {
    const state = linkState(linkPath)
    if (state.kind === 'absent') {
      mkdirSync(dirname(linkPath), { recursive: true })
      try {
        symlinkSync(bridgeDir, linkPath, 'dir')
      } catch (error) {
        fail(`could not create symlink ${linkPath}: ${error?.message ?? error}`)
      }
      say(3, 'symlink', `created ${linkPath} -> ${bridgeDir}`)
    } else if (state.kind === 'symlink' && (state.resolved === bridgeDir || state.abs === bridgeDir)) {
      say(3, 'symlink', 'already points at the bridge artifact, skipping')
    } else if (repair) {
      const desc = state.kind === 'not-symlink'
        ? `${linkPath} is not a symlink`
        : `${linkPath} -> ${state.raw}`
      note(`repairing bridge link (${desc})`)
      try {
        removePath(linkPath)
        mkdirSync(dirname(linkPath), { recursive: true })
        symlinkSync(bridgeDir, linkPath, 'dir')
      } catch (error) {
        fail(`could not repair symlink ${linkPath}: ${error?.message ?? error}`)
      }
      say(3, 'symlink', `repaired ${linkPath} -> ${bridgeDir}`)
    } else if (state.kind === 'not-symlink') {
      conflict = `${linkPath} exists and is NOT a symlink`
    } else {
      conflict = `${linkPath} -> ${state.raw} (expected ${bridgeDir})`
    }
  }

  // [4/7] Verify: report-only for a conflict; never overwrite.
  if (conflict !== null) {
    warn(`conflict, not overwriting: ${conflict}`)
    warn('the profile link was left untouched; the identity guard below decides whether the resolved artifact is acceptable')
    console.log(`${PREFIX}REPORT — conflict detected, no change made to the link`)
  } else {
    const finalState = linkState(linkPath)
    if (finalState.kind !== 'symlink' || (finalState.resolved !== bridgeDir && finalState.abs !== bridgeDir)) {
      fail(`post-write verification failed for ${linkPath}: link does not resolve to ${bridgeDir}`)
    }
    // Explicit guard: no @deepseek-ai package may be present in the profile.
    const deepseekDir = join(profileDir, 'node_modules', '@deepseek-ai')
    if (existsSync(deepseekDir)) {
      fail(
        `forbidden @deepseek-ai packages found in profile: ${deepseekDir}`,
        'The host closure supplies @deepseek-ai/* bundles; they must never be copied into a profile directory.',
      )
    }
    say(4, 'verify', `bridge resolves to ${bridgeDir}; no @deepseek-ai copy in profile`)
  }

  // [5/7] Identity guard always runs, including on the conflict path, so a
  // repointed / replaced bridge cannot slip through as a mere WARN.
  verifyBridgeIdentity()

  // [6/7] Inproc-only patch generation. The gate is here (not just in the
  // launcher) so --repair-bridge / direct runs without the env stay unchanged.
  // [7/7] generates the local shim package that the patch row resolves.
  if (INPROC_MODE) {
    provisionPatch()
    provisionShim()
  }

  console.log(`${PREFIX}PASS`)
}

function main(argv = []) {
  // --repair is passed by `dsh-opentui --repair-bridge`; accept the long form
  // too so the underlying mode is unambiguous when invoked directly.
  const repair = argv.includes('--repair') || argv.includes('--repair-bridge')
  console.log(`${PREFIX}dsh home ${dshHome}`)
  if (!existsSync(dshHome)) {
    fail(
      `DSH_HOME directory does not exist: ${dshHome}`,
      `Create it first (e.g. mkdir -p "${dshHome}"). The opentui-inproc profile must share the existing Harness home, not create an isolated one.`,
    )
  }
  if (!statSync(dshHome).isDirectory()) {
    fail(`DSH_HOME is not a directory: ${dshHome}`)
  }

  // The lock lives inside the profile dir, so make sure it exists first.
  mkdirSync(profileDir, { recursive: true })

  const token = acquireLock()
  if (!token) {
    // A live peer kept the lock: it is provisioning the same profile, so this
    // instance skips its own pass rather than corrupting the shared state.
    note(`SKIP — could not acquire provisioning lock after ${LOCK_MAX_ATTEMPTS} attempts (${LOCK_RETRY_MS}ms backoff); another live instance is provisioning; skipping.`)
    return
  }

  try {
    runProvision({ repair })
  } finally {
    releaseLock(token)
  }
}

try {
  main(process.argv.slice(2))
} catch (error) {
  if (error instanceof ProvisionError) {
    console.error(`${PREFIX}FAIL — ${error.message}`)
    if (error.detail) console.error(error.detail.trimEnd())
  } else {
    console.error(`${PREFIX}FAIL — unexpected error: ${error?.stack ?? String(error)}`)
  }
  process.exitCode = 1
}
