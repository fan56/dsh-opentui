#!/usr/bin/env node
// provision-inproc-profile.mjs — idempotent provisioning of the fixed
// `opentui-inproc` host profile (ADR-0009 decision 3; T3 of the in-process
// bridge plan).
//
// Invoked by the launcher on EVERY start (S6: bridge is the sole seam; the
// former env escape hatch that skipped provisioning is removed with it).
// The `opentui` profile path is otherwise untouched.
// Eight steps (the first is the host-version gate). Steps 1-3 and 5-8 are
// local-FS only; step 4 (companions) is the one unfrozen step that MAY run a
// package manager (user decision 2026-11-22 — "npm 安装好的时候，registry 和其他几个依赖插件，默认装好").
//
//   [1/8] host     — detect the running dsh version. OUTSIDE the supported
//                    window (>=0.2.2-rc.3 <0.3.0) => fail-fast with the three
//                    fail-fast elements: the host would otherwise skip the
//                    bridge bundle silently (it only records the conflict in
//                    `skippedBundles`) and bridge.hello would time out. INSIDE
//                    the window but not yet exempted => grant the profile-local
//                    exact-version exemption in compatibility.json. Never
//                    grants outside the window: --accept-risk is not a way to
//                    mask a genuine incompatibility.
//   [2/8] manifest — write $DSH_HOME/profiles/opentui-inproc/package.json with
//                    dsh.profile.bundles = [@deepseek-ai/dsh-base,
//                    @aiwayds/dsh-opentui-bridge] PLUS any companion bundles
//                    already declared in dependencies. NO @deepseek-ai
//                    dependency is ever written: the host's installation-first
//                    bundle resolution supplies those bundles from the running
//                    dsh closure (wild-package shadowing is the historical
//                    incident this guard prevents).
//   [3/8] copy     — materialize node_modules/@aiwayds/dsh-opentui-bridge as a

//                    REAL DIRECTORY COPY of THIS installation's dist/bridge.
//                    S6 symlink-debt retirement: no absolute symlink (no path
//                    binding, no multi-worktree last-writer-wins, no dangling
//                    link when a worktree is removed). Converged every launch;
//                    idempotent when the copy's index.js hash matches.
//   [4/8] companions — install the minimal companion set (default: the
//                    @aiwayds/dsh-subagent-registry bundle, which self-mounts
//                    the `use_agent` tool through its own cordis.patch.yml).
//                    Resolves `latest`, guards major/downgrade, skips when
//                    already at that version, and is disabled wholesale by
//                    DSH_OPENTUI_COMPANION_LATEST=off. A failed install OR a
//                    missing global `dsh` is a WARN (never a boot blocker):
//                    stale manifest declarations from a half-write are removed
//                    and hosts without dsh skip companions with a warning.
//                    Step 5 then verifies that whatever remains declared in
//                    the manifest is fully mounted.
//   [5/8] verify   — confirm the bridge is a real directory carrying the
//                    shipped files; refuse any @deepseek-ai copy in the profile;
//                    cross-check companion manifest deps <-> bundle entries <-
//                    -> installed node_modules (no half-provisioned state).
//                    Step 4 drops stale declarations an unsuccessful add left
//                    behind, so this guard never blocks a boot for something
//                    the provisioning pass itself could not install offline.
//   [6/8] identity — T5 guard: hash the materialized bridge's index.js and
//                    compare with the build-time fingerprint shipped in THIS
//                    installation's dist/bridge/bundle-fingerprint.json, plus
//                    name / version. No realpath-prefix hard binding.
//   [7/8] patch    — generate $DSH_HOME/profiles/opentui-inproc/cordis.patch.yml
//                    from the embedded inproc-only template (web-app
//                    compensation rows removed, profileRevision stamped). The
//                    template also registers the standalone sessionController
//                    shim plus the real @deepseek-ai/dsh-api-session-controller
//                    plugin — no dsh-web-app bundle is pulled in. Companion
//                    mounts ride their own bundle patches (activated by the
//                    manifest bundle entries), so no duplicate rows are added
//                    here.
//   [8/8] shim     — generate the local shim package under the profile's
//                    node_modules (@aiwayds scope) that the patch row resolves.
//                    Its
//                    @deepseek-ai/cordis import is resolved by the host against
//                    the profile scope, exactly like the bridge. revision +
//                    backup converge it.
//
// T4 — cross-instance mutual exclusion:
//   The whole provisioning run is serialized by `.provision.lock` in the
//   profile dir, created with O_EXCL ("wx"). A live holder makes late
//   instances wait briefly (bounded retries) and then SKIP; a stale lock
//   (holder pid gone, age over threshold, corrupt, or self-leftover) is
//   taken over. The lock is released in `finally`, including on failure.
//   Same-machine only: no cross-host / cross-user semantics.
//
// Idempotency: an existing bridge directory whose index.js hash matches THIS
// install's build-time fingerprint is left untouched; a stale directory, a
// leftover symlink, or a missing entry is replaced with a fresh copy.
//
// `--repair` / `--repair-bridge`: still accepted for CLI/caller compatibility,
// but a no-op for the bridge materialization — the copy converges
// unconditionally on every provision. The T5 identity guard always runs after
// convergence, so a fingerprint mismatch still fails loud.
//
// Hard guard: this script only ever touches the ONE profile named
// `opentui-inproc`. The ONLY package-manager call is step [4/8], scoped to the
// explicit companion catalog; it never writes a @deepseek-ai dependency into
// the manifest (those bundles come from the running dsh closure).

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  cpSync,
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
// Companion policy is a pure table; only the spawn and registry query live
// here (see step [4/8]). Mirrors dsh-tui-pi's companion-latest pattern.
import {
  COMPANIONS,
  COMPANION_LATEST_ENV,
  decideCompanionInstall,
  queryDistTagLatest,
  selectCompanions,
} from './lib/inproc-companions.mjs'

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
// Testability seam: the fail-fast tests point this at a bogus bridge dir to
// drive the fingerprint-mismatch path without mutating the real build artifact.
// Unset in production (the shipped dist/bridge is authoritative).
const bridgeDirRaw = process.env.DSH_OPENTUI_TEST_BRIDGE_DIR || join(pkgRoot, 'dist', 'bridge')
const fingerprintPath = join(bridgeDirRaw, 'bundle-fingerprint.json')

const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', PROFILE)
const manifestPath = join(profileDir, 'package.json')
const linkPath = join(profileDir, 'node_modules', ...BRIDGE_NAME.split('/'))
const lockPath = join(profileDir, LOCK_NAME)

// --- Inproc patch ownership ------------------------------------------------
// S6: the patch/shim steps are unconditional (the env escape hatch that used
// to skip them is removed with the legacy seam). The launcher runs this script
// on every start; --repair-bridge and direct invocation converge identically.
const TOTAL_STEPS = 8
const COMPANION_INSTALL_TIMEOUT_MS = 10 * 60 * 1000
const PATCH_NAME = 'cordis.patch.yml'
const patchPath = join(profileDir, PATCH_NAME)
const PATCH_REVISION_MARKER = '# profileRevision: '
// Local shim package generated under the profile's node_modules. It lives in
// the @aiwayds scope (never @deepseek-ai — see the guard in step [5/8]) so the
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

# Delegation depth cap (full-access-inherit R2-3). The host's maxDepth is an
# ABSOLUTE depth: lead=0, direct child=1, resolveChildDepth rejects when
# childDepth > maxDepth (dsh-subagent:2963 schema default(1), :3007 read every
# dispatch, :1497 decision). Pin 1 = only the main Agent may spawn direct
# children; grandchildren (depth 2) are rejected, closing the R2-3 silent-pass
# hole. Pinning also survives any host schema-default drift. NEVER use 0 here:
# a direct child is depth 1 > 0, so every delegation is refused (dispatch dead).
# maxDepth is volatile() (runtime-changeable); this patch sets its INITIAL
# default, which is exactly what the host validates into the volatile ref.
# Only this inproc template carries a subagent config row (dsh-base/web rows
# have none), so no other supply template needs the pin.
- id: subagent
  name: "@deepseek-ai/dsh-subagent"
  config:
    maxActiveSubagents: 3
    maxDepth: 1

# Companion mounts (2026-11-22 unfreeze). The minimal set installed by
# provision-inproc-profile.mjs step [4/8] is @aiwayds/dsh-subagent-registry,
# which registers the use_agent / ask_agent tools globally and carries its OWN
# cordis.patch.yml mount row. That row is activated by the dsh.profile.bundles
# entry that dsh plugin add writes into package.json — no duplicate row is added
# here (a same-id insert from this profile layer would only shadow the bundle's
# own patch). DSH_OPENTUI_COMPANION_LATEST=off skips the install; the default
# roster stays the locally-defined agents under $DSH_HOME/agents.

# Standalone sessionController support (no dsh-web-app bundle). The real
# controller needs 13 injects; 11 come from dsh-base, and the two web-only ones
# (fileUploads, workspaceRegistry) are satisfied by the local shim package
# generated in step [8/8]. No connection shim: dsh-api-gateway's optional
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
// Generated into the profile's node_modules (step [8/8]) so its runtime imports
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

/**
 * Companion bundles already declared in the manifest must survive the step-2
 * convergence: otherwise every launch would strip them and step 4 would
 * reinstall. Only packages from OUR catalog that the manifest already declares
 * are preserved, so a stray dependency can never smuggle a bundle in.
 */
const managedBundles = (existing) => {
  const declared = COMPANIONS
    .filter((entry) => Object.prototype.hasOwnProperty.call(existing?.dependencies ?? {}, entry.name))
    .map((entry) => entry.name)
  return [...new Set([...BUNDLES, ...declared])]
}

const desiredManifest = (existing) => ({
  ...existing,
  dsh: {
    ...(existing?.dsh ?? {}),
    profile: {
      ...(existing?.dsh?.profile ?? {}),
      bundles: managedBundles(existing),
    },
  },
})

/** Version actually mounted in the profile node_modules, or undefined. */
function installedCompanionVersion(name) {
  try {
    return JSON.parse(readFileSync(join(profileDir, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')).version
  } catch {
    return undefined
  }
}

/**
 * A failed `dsh plugin add` can leave a dependency + bundle row behind without
 * ever installing node_modules. Left alone, step [5/8] would turn that
 * half-write into a permanent boot blocker on later (offline) starts, with no
 * self-heal path. Drop only the stale declarations — healthy companions and
 * the user's own dependencies are untouched — so the failure stays a WARN and
 * provisioning always yields a usable profile.
 */
function dropUnmountedCompanions(reason, only = null) {
  const manifest = readManifest()
  if (!manifest?.dependencies || typeof manifest.dependencies !== 'object') return 0
  const bundles = Array.isArray(manifest.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : null
  const stale = COMPANIONS.filter((entry) =>
    (!only || only.includes(entry.name)) &&
    Object.prototype.hasOwnProperty.call(manifest.dependencies, entry.name) &&
    installedCompanionVersion(entry.name) === undefined)
  if (stale.length === 0) return 0
  for (const entry of stale) {
    delete manifest.dependencies[entry.name]
    if (bundles) {
      const at = bundles.indexOf(entry.name)
      if (at !== -1) bundles.splice(at, 1)
    }
    warn(`companion ${entry.name}: ${reason}; dropping stale declaration (companions are optional)`)
  }
  const tmpPath = `${manifestPath}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmpPath, `${JSON.stringify(manifest, null, 2)}\n`)
  renameSync(tmpPath, manifestPath)
  say(4, 'companions', `dropped ${stale.length} stale companion declaration(s) — profile stays usable`)
  return stale.length
}

/**
 * Only the companion step needs a global dsh; a satisfied run stays offline.
 * Absence is NOT an error: companions are optional, so the caller degrades to
 * a WARN and leaves the profile fully bootable (e.g. hosted CI runners have no
 * global dsh). `which` itself missing/failing is treated the same way.
 */
function dshOnPath() {
  try {
    const which = spawnSync('which', ['dsh'], { encoding: 'utf8' })
    return which.status === 0 && Boolean(which.stdout.trim())
  } catch {
    return false
  }
}

/**
 * Step [4/8] — install the minimal companion set.
 *
 * The install is done through `dsh plugin add`, which is the one supported way
 * to put a @aiwayds package into a profile: it writes the dependency, appends
 * the bundle entry (that entry is what activates the plugin's OWN
 * cordis.patch.yml mount row), and installs node_modules — including the
 * registry's `dsh-jev-core` dependency, which the client's spin-attention
 * probe then finds in the profile. With `nodeLinker: hoisted` +
 * `autoInstallPeers: false` in this profile, no @deepseek-ai peer is copied
 * into the profile, so step [5/8]'s no-@deepseek-ai guard still holds.
 *
 * Companions are optional: an install failure is a WARN, never a boot blocker.
 * A half-write (dependency declared, package missing) is cleaned up here —
 * immediately after a failed add, and on later offline starts — so step [5/8]
 * never hard-fails on a state this step itself could not resolve.
 */
function provisionCompanions() {
  const selected = selectCompanions(process.env)
  if (selected.length === 0) {
    const off = ['0', 'false', 'off'].includes(String(process.env[COMPANION_LATEST_ENV] ?? '').trim().toLowerCase())
    say(4, 'companions', off ? `skipped (${COMPANION_LATEST_ENV}=off)` : 'none selected')
    return
  }

  const manifest = readManifest() ?? {}
  const specs = []
  let unavailable = 0
  for (const entry of selected) {
    const currentPin = installedCompanionVersion(entry.name)
    const resolved = queryDistTagLatest(entry.name, { cwd: profileDir, env: process.env })
    if (resolved === null && currentPin === undefined &&
        Object.prototype.hasOwnProperty.call(manifest.dependencies ?? {}, entry.name)) {
      // A previous add left the dependency behind but never mounted the
      // package. Offline there is no way to heal it: drop the stale declaration
      // instead of handing step [5/8] an unrecoverable hard fail.
      dropUnmountedCompanions('declared but not installed, and offline', [entry.name])
      note(`companion ${entry.name}: skip (offline-stale)`)
      unavailable++
      continue
    }
    const decision = decideCompanionInstall({
      packageName: entry.name,
      declaredRange: entry.declaredRange,
      resolved,
      currentPin,
    })
    if (decision.action === 'skip') {
      note(`companion ${entry.name}: skip (${decision.reason})`)
    } else {
      note(`companion ${entry.name}: ${currentPin ?? 'absent'} -> ${decision.spec} (${decision.reason})`)
      specs.push(decision.spec)
    }
  }

  if (specs.length === 0) {
    say(4, 'companions', unavailable > 0
      ? `skipped ${unavailable} of ${selected.length} (unavailable)`
      : `already satisfied (${selected.length}/${selected.length})`)
    return
  }

  if (!dshOnPath()) {
    // Companions are optional: a missing host CLI is a WARN, never a boot
    // blocker. Give an actionable next step and leave a usable profile.
    warn(
      `no global \`dsh\` on PATH; skipping optional companions. ` +
        `Install dsh and re-run provisioning to auto-install them, or set ${COMPANION_LATEST_ENV}=off to skip them permanently.`,
    )
    // A previous failed add may have left a half-written declaration. Drop it
    // so step [5/8] never blocks a boot over a package we cannot install here.
    dropUnmountedCompanions('no global dsh on PATH')
    say(4, 'companions', 'skipped (no global `dsh` on PATH; companions are optional)')
    return
  }
  const run = spawnSync('dsh', ['plugin', '--profile', PROFILE, 'add', ...specs], {
    stdio: 'inherit',
    env: { ...process.env, DSH_HOME: dshHome },
    cwd: profileDir,
    timeout: COMPANION_INSTALL_TIMEOUT_MS,
  })
  if (run.error) {
    warn(`companion install failed to start: ${run.error.message}`)
    dropUnmountedCompanions('install failed to start')
    say(4, 'companions', `installed 0 of ${specs.length} (failed to start)`)
    return
  }
  if (run.status !== 0) {
    warn(`dsh plugin add exited ${run.status}; companions are optional — the client still launches`)
    dropUnmountedCompanions(`dsh plugin add exited ${run.status}`)
    say(4, 'companions', `installed 0 of ${specs.length} (exit ${run.status})`)
    return
  }

  // Readback: an exit 0 is not proof the requested versions landed.
  const landed = specs.filter((spec) => {
    const at = spec.lastIndexOf('@')
    const name = spec.slice(0, at)
    const pin = spec.slice(at + 1)
    const actual = installedCompanionVersion(name)
    return pin === 'latest' ? actual !== undefined : actual === pin
  })
  if (landed.length !== specs.length) {
    const missing = specs.filter((spec) => !landed.includes(spec))
    warn(`companion version readback mismatch: ${missing.join(', ')}`)
    dropUnmountedCompanions('version readback mismatch')
  }
  say(4, 'companions', `installed ${landed.length} of ${specs.length}`)
}

/**
 * Step [5/8] cross-check: the companion state has three views — manifest
 * dependencies, manifest bundles and installed node_modules. A provisioning
 * pass that updated only one of them is a "two-state drift"; refuse to boot
 * rather than booting a profile that composes a bundle it cannot resolve.
 * Only catalog packages are considered, so a user's own dependencies are
 * never touched or judged here.
 */
function verifyCompanionState() {
  const manifest = readManifest()
  if (!manifest) return 0
  const dependencies = manifest.dependencies ?? {}
  const bundles = manifest.dsh?.profile?.bundles ?? []
  const declared = COMPANIONS.filter((entry) =>
    Object.prototype.hasOwnProperty.call(dependencies, entry.name))
  for (const entry of declared) {
    if (!bundles.includes(entry.name)) {
      fail(
        `companion drift: ${entry.name} is a dependency but not a profile bundle`,
        `Re-run provisioning (dsh-opentui --repair-bridge) to restore the bundle entry. ` +
          `Set ${COMPANION_LATEST_ENV}=off only when you intend to manage companions yourself.`,
      )
    }
    if (installedCompanionVersion(entry.name) === undefined) {
      fail(
        `companion drift: ${entry.name} is declared but not installed in the profile`,
        `Re-run provisioning (dsh-opentui --repair-bridge), or remove the dependency from ${manifestPath} ` +
          `if the companion is no longer wanted.`,
      )
    }
  }
  return declared.length
}

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

/** True when `dir` is an up-to-date copy of this install's bridge: its
 *  index.js sha256 matches the build-time fingerprint. Used to make the
 *  bridge-copy materialization idempotent across launches/worktrees. */
function stateIsCurrentCopy(dir, fingerprintFile) {
  try {
    const fp = readJsonObject(fingerprintFile)
    if (!fp || typeof fp.sha256 !== 'string') return false
    return sha256File(join(dir, 'index.js')) === fp.sha256
  } catch {
    return false
  }
}

/** Remove whatever occupies `path` (symlink, file or directory) so the correct
 *  copy can be created in its place. ENOENT is a no-op. */
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

  say(6, 'identity', `name=${fp.name} version=${fp.version} sha256=${fp.sha256.slice(0, 12)}…`)
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
    say(7, 'patch', 'already current, skipping')
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
  say(7, 'patch', `wrote ${patchPath} (profileRevision ${PATCH_REVISION})`)
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
    say(8, 'shim', 'already current, skipping')
    return
  }
  say(8, 'shim', `wrote ${SHIM_DIR} (shimRevision ${SHIM_REVISION})`)
}

// --- The provision pass itself (runs under the lock) ------------------------
function runProvision({ repair = false } = {}) {
  // S6: --repair is accepted for CLI compatibility but is a no-op — the bridge
  // copy converges unconditionally on every provision (no symlink to repair).
  if (repair) note('repair mode accepted (no-op — bridge copy converges every provision)')
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

  // [1/8] Host compatibility: fail loud when the running dsh is outside the
  // supported window (the host would otherwise skip the bridge silently), and
  // grant the exact-version exemption when it is in-window but not exempted.
  verifyHostCompatibility(bridgeDir)

  // [2/8] Manifest: write / converge the profile manifest. Only
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
      say(2, 'manifest', `wrote bundles [${managedBundles(existing ?? {}).join(', ')}]`)
    }
  }

  // [3/8] Materialize the bridge as a REAL DIRECTORY COPY (S6 symlink-debt
  // retirement). The old design wrote an ABSOLUTE symlink to THIS
  // installation's dist/bridge: that bound the profile to one install path and
  // let multiple worktrees sharing a DSH_HOME leave the link pointing at
  // whichever install provisioned last (A's dsh loading B's bundle = cross-
  // contamination); deleting a worktree left a dangling link → BRIDGE_TIMEOUT.
  // A copy removes the path binding entirely: every provision converges the
  // profile copy to THIS install's bytes, and the fingerprint identity guard
  // below rejects any drift. No symlink, no --repair branch, no conflict
  // report-only path (the flag is accepted for CLI compatibility but is a
  // no-op — convergence is unconditional).
  {
    const state = linkState(linkPath)
    const isReadyDir = state.kind === 'not-symlink' && stateIsCurrentCopy(linkPath, fingerprintPath)
    if (!isReadyDir) {
      const desc = state.kind === 'absent' ? 'absent' : state.kind === 'symlink' ? `symlink -> ${state.raw}` : 'stale directory'
      note(`materializing bridge copy (${desc})`)
      try {
        removePath(linkPath)
        mkdirSync(dirname(linkPath), { recursive: true })
        cpSync(bridgeDir, linkPath, { recursive: true })
      } catch (error) {
        fail(`could not materialize bridge copy at ${linkPath}: ${error?.message ?? error}`)
      }
      say(3, 'bridge-copy', `copied ${bridgeDir} -> ${linkPath}`)
    } else {
      say(3, 'bridge-copy', `${linkPath} already matches this install, skipping`)
    }
  }

  // [4/8] Companion installation. Runs after the bridge copy and before the
  // verify step so a half-provisioned manifest is caught by step [5/8].
  provisionCompanions()

  // [5/8] Verify: linkPath is a REAL directory (never a symlink) carrying the
  // shipped bridge files, and no @deepseek-ai package leaked into the profile.
  // Companion state is cross-checked too (deps <-> bundles <-> node_modules).
  {
    let st
    try { st = lstatSync(linkPath) } catch (error) { fail(`post-write verification failed for ${linkPath}: ${error?.message ?? error}`) }
    if (!st.isDirectory() || st.isSymbolicLink()) {
      fail(`post-write verification failed for ${linkPath}: bridge is not a real directory`)
    }
    for (const required of ['package.json', 'index.js', 'bundle-fingerprint.json']) {
      if (!existsSync(join(linkPath, required))) {
        fail(`post-write verification failed: ${linkPath} is missing ${required}`)
      }
    }
    // Explicit guard: no @deepseek-ai package may be present in the profile.
    const deepseekDir = join(profileDir, 'node_modules', '@deepseek-ai')
    if (existsSync(deepseekDir)) {
      fail(
        `forbidden @deepseek-ai packages found in profile: ${deepseekDir}`,
        'The host closure supplies @deepseek-ai/* bundles; they must never be copied into a profile directory.',
      )
    }
    const companionCount = verifyCompanionState()
    say(5, 'verify', `bridge resolves to ${bridgeDir}; no @deepseek-ai copy in profile; ${companionCount} companion(s) consistent`)
  }

  // [6/8] Identity guard always runs, including on the conflict path, so a
  // repointed / replaced bridge cannot slip through as a mere WARN.
  verifyBridgeIdentity()

  // [7/8] Inproc patch generation + [8/8] the local shim package the patch row
  // resolves. S6: unconditional (no env escape hatch).
  provisionPatch()
  provisionShim()

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
