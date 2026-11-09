// Client-entry wiring (ADR-0005 bucket (c)): bootClient must chain
// ensureHost → ClientConnection({authority, cookieHeader}) →
// RemoteHostSession → render with zero ShellHost edits, source the theme
// from the session's post-start configLoad(), and shut down CLEANLY
// (dispose session → release host ref — never dispose the host, the
// grace-window re-attach semantics stay intact). Everything runs against
// fakes injected through ClientBootOptions; the exit-path interception is
// exercised against a fake process-like target.
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { aggregateTurnContext, bootCallOrder, bootClient, installExitPaths, themeNameFromConfig } from '../src/client-entry.tsx'
import { RemoteHostSession } from '../src/client/remote-host-session.ts'
import type { ClientConnection, ClientConnectionState, ClientReadyInfo } from '../src/client/transport.ts'
import type { EventsItem } from '../src/client/mux-frame.ts'
import type { EnsureHostOptions, HostHandle } from '../src/client/lifecycle.ts'
import type { ShellSessionSurface } from '../src/client/shell-session.ts'
import type { TurnCallbacks } from '../src/agent/loop.ts'

// ---------------------------------------------------------------------------
// Fakes.
// ---------------------------------------------------------------------------

interface FakeHostHandle extends HostHandle {
  releases: number
  disposed: boolean
}

function fakeHostHandle(overrides: Partial<HostHandle> = {}): FakeHostHandle {
  const handle: FakeHostHandle = {
    profile: 'opentui',
    dshHome: mkdtempSync(join(tmpdir(), 'dsh-client-entry-home-')),
    pid: 4242,
    port: 45931,
    authority: '127.0.0.1:45931',
    cookieHeader: 'dsh-auth-test=v1.abc.def',
    url: null,
    token: null,
    adopted: false,
    refCount: 1,
    releases: 0,
    disposed: false,
    retain() {
      handle.refCount += 1
    },
    release() {
      handle.releases += 1
      handle.refCount = Math.max(0, handle.refCount - 1)
    },
    async dispose() {
      handle.disposed = true
    },
    ...overrides,
  }
  return handle
}

/** The full ClientConnection surface is frozen; the fake only needs the
 * members RemoteHostSession + bootClient touch. */
function fakeConnection(overrides: Partial<ClientConnection> = {}): ClientConnection {
  const ready: ClientReadyInfo = { clientId: 'client-1', host: { home: '/tmp/dsh-fake-home' } } as ClientReadyInfo
  const connection = {
    authority: '127.0.0.1:45931',
    baseUrl: 'http://127.0.0.1:45931',
    connect: () => Promise.resolve(ready),
    rpc: () => Promise.resolve({}),
    onEvent: (_handler: (item: EventsItem) => void) => () => {},
    getState: (): ClientConnectionState => 'connected',
    onStateChange: (_listener: (state: ClientConnectionState) => void) => () => {},
    close: () => Promise.resolve(),
    ...overrides,
  }
  return connection as unknown as ClientConnection
}

interface Recording {
  ensureHostOptions?: EnsureHostOptions
  connectArgs: [string, string][]
  sessionOptions: { connection: ClientConnection; cookieHeader: string; workspace: string; dshHome: string; profile: string }[]
  renderCount: number
}

function makeFakes(label = 'provider/model') {
  const recording: Recording = { connectArgs: [], sessionOptions: [], renderCount: 0 }
  const handle = fakeHostHandle()
  const connection = fakeConnection()
  const session = new RemoteHostSession({
    connection,
    cookieHeader: handle.cookieHeader,
    cwd: '/tmp/never-used',
    // Batch D2 fix (themeNameFromConfig failure root cause): without an
    // explicit dshHome, resolveDshHome(undefined) fell back to the REAL
    // ~/.dsh — a developer profile config carrying `"theme"` leaked into
    // themeNameFromConfig (received "catppuccin-mocha"). Pin the fake home.
    dshHome: handle.dshHome,
    profile: handle.profile,
    socketFactory: () => {
      throw new Error('no sockets in the wiring test')
    },
  })
  session.label = label

  const ensureHost = (options?: EnsureHostOptions): Promise<HostHandle> => {
    recording.ensureHostOptions = options ?? {}
    return Promise.resolve(handle)
  }
  const connect = (authority: string, cookieHeader: string): ClientConnection => {
    recording.connectArgs.push([authority, cookieHeader])
    return connection
  }
  const createSession = (options: { connection: ClientConnection; cookieHeader: string; workspace: string; dshHome: string; profile: string }): RemoteHostSession => {
    recording.sessionOptions.push(options)
    return session
  }
  const render = async (): Promise<{ store: unknown; stop: () => Promise<void> }> => {
    recording.renderCount += 1
    return { store: {}, stop: () => Promise.resolve() }
  }
  return { recording, handle, connection, session, seams: { ensureHost, connect, createSession, render } }
}

// ---------------------------------------------------------------------------
// Boot wiring.
// ---------------------------------------------------------------------------

describe('bootClient wiring', () => {
  test('chains ensureHost → connect(authority, cookieHeader) → session → render in order', async () => {
    bootCallOrder.length = 0
    const { recording, handle, connection, session, seams } = makeFakes()
    const workspace = mkdtempSync(join(tmpdir(), 'dsh-client-entry-ws-'))
    try {
      const boot = await bootClient({
        workspace,
        ensureHost: seams.ensureHost,
        connect: seams.connect,
        createSession: seams.createSession,
        render: seams.render as never,
        exitPaths: false,
        labelBudgetMs: 50,
      })

      // lifecycle: profile + idle-exit per ADR-0005 decisions 3 + 5
      expect(recording.ensureHostOptions).toEqual({ profile: 'opentui', idleExitSec: 60 })
      // carrier: authority + cookie come from the host handle
      expect(recording.connectArgs).toEqual([[handle.authority, handle.cookieHeader]])
      // session facade: workspace cwd + home + profile from the handle
      const so = recording.sessionOptions[0]!
      expect(recording.sessionOptions.length).toBe(1)
      expect(so.connection).toBe(connection)
      expect(so.cookieHeader).toBe(handle.cookieHeader)
      expect(so.workspace).toBe(workspace)
      expect(so.dshHome).toBe(handle.dshHome)
      expect(so.profile).toBe('opentui')
      // boot order: host → carrier → session → start → render (no render
      // before start; the theme read rides between start and render)
      expect(bootCallOrder).toEqual(['ensureHost', 'connect', 'createSession', 'session.start', 'render'])
      expect(recording.renderCount).toBe(1)
      // the boot product carries the live pieces
      expect(boot.host).toBe(handle)
      expect(boot.session).toBe(session)
    } finally {
      rmSync(workspace, { recursive: true, force: true })
      rmSync(handle.dshHome, { recursive: true, force: true })
    }
  })

  test('themeNameFromConfig reads configLoad().theme (workspace overlay source)', async () => {
    const { session } = makeFakes()
    // no workspace overlay in the fake home → undefined → ShellHost default
    expect(themeNameFromConfig(session)).toBeUndefined()
  })

  test('boot completes with the cold-boot label already applied (no generic-label paint)', async () => {
    const { session, seams } = makeFakes('deepseek/deepseek-chat')
    await bootClient({
      ensureHost: seams.ensureHost,
      connect: seams.connect,
      createSession: seams.createSession,
      render: seams.render as never,
      exitPaths: false,
      labelBudgetMs: 1_000,
    })
    // waitForBootLabel saw the real route immediately — no budget burned
    expect(session.label).toBe('deepseek/deepseek-chat')
  })
})

// ---------------------------------------------------------------------------
// Clean shutdown: dispose session → release host ref (grace window intact).
// ---------------------------------------------------------------------------

describe('bootClient shutdown', () => {
  test('shutdown disposes the session and RELEASES the host (never disposes it)', async () => {
    const { handle, session, seams } = makeFakes()
    const boot = await bootClient({
      ensureHost: seams.ensureHost,
      connect: seams.connect,
      createSession: seams.createSession,
      render: seams.render as never,
      exitPaths: false,
      labelBudgetMs: 10,
    })
    expect(handle.releases).toBe(0)
    await boot.shutdown()
    expect(handle.releases).toBe(1)
    expect(handle.refCount).toBe(0) // idle-exit timer arms host-side
    expect(handle.disposed).toBe(false) // grace-window adoption stays possible
    expect(session.currentSessionId()).toBeUndefined() // session disposed cleanly
    // idempotent: a second shutdown is a no-op on the refcount
    await boot.shutdown()
    expect(handle.releases).toBe(1)
  })

  test('last-ref release hands the idle exit to the detached reaper', async () => {
    const { handle, seams } = makeFakes()
    const reapers: { pid: number; port: number; lockPath: string; graceSec: number }[] = []
    const boot = await bootClient({
      ensureHost: seams.ensureHost,
      connect: seams.connect,
      createSession: seams.createSession,
      render: seams.render as never,
      exitPaths: false,
      labelBudgetMs: 10,
      spawnReaper: (args) => reapers.push(args),
    })
    await boot.shutdown()
    expect(reapers).toEqual([
      {
        pid: handle.pid,
        port: handle.port,
        lockPath: join(handle.dshHome, 'opentui-host.opentui.json'),
        graceSec: 60, // the lifecycle default — decision 5's idle window
      },
    ])
  })

  test('no reaper while another ref in this process still holds the host', async () => {
    const { handle, seams } = makeFakes()
    handle.refCount = 2 // our release leaves one live ref
    const reapers: unknown[] = []
    const boot = await bootClient({
      ensureHost: seams.ensureHost,
      connect: seams.connect,
      createSession: seams.createSession,
      render: seams.render as never,
      exitPaths: false,
      labelBudgetMs: 10,
      spawnReaper: (args) => reapers.push(args),
    })
    await boot.shutdown()
    expect(handle.refCount).toBe(1)
    expect(reapers).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Context aggregation (wave-2 wire finding): the turn-end hand-off carries
// prompt + cacheRead + cacheWrite — injected client-side, zero ShellHost
// edits (the plugin bundle is gated to zero diff).
// ---------------------------------------------------------------------------

describe('aggregateTurnContext', () => {
  const baseCallbacks = (): TurnCallbacks => ({
    onThinkingDelta: () => {},
    onContentDelta: () => {},
    onTurnEnd: () => {},
    onApprove: async () => true,
    onToolRun: () => {},
    onError: () => {},
  })

  test('rewrites the turn-end prompt to prompt+cacheRead+cacheWrite (assigned at turn end)', async () => {
    const calls: { prompt: number; completion: number }[] = []
    const fake = {
      label: 'provider/model',
      usage: { prompt: 0, completion: 0, cacheRead: 0, cacheWrite: 0 },
      remoteTailSink: null,
      turn: async (_text: string, cb: TurnCallbacks) => {
        // usage chunks ASSIGN during the turn, before turn end fires
        fake.usage = { prompt: 300, completion: 9, cacheRead: 1000, cacheWrite: 250 }
        cb.onTurnEnd({ prompt: 300, completion: 9 })
      },
    } as unknown as ShellSessionSurface & { usage: { prompt: number; completion: number; cacheRead: number; cacheWrite: number } }

    const adapted = aggregateTurnContext(fake)
    await adapted.turn('hi', { ...baseCallbacks(), onTurnEnd: (u) => calls.push(u) })
    expect(calls).toEqual([{ prompt: 1550, completion: 9 }]) // 300+1000+250
    expect(adapted.label).toBe('provider/model') // passthrough
  })

  test('methods stay bound to the real session (private #field access works)', () => {
    const { session } = makeFakes()
    const adapted = aggregateTurnContext(session as unknown as ShellSessionSurface)
    // usageSummary reads private #turns/#ticker state — a Proxy `this`
    // would throw on #field access; the bound target does not
    expect(Array.isArray(adapted.usageSummary())).toBe(true)
  })

  test('accessors read the real target (settingsSeam getter → #settingsClient, the /login crash)', () => {
    const { session } = makeFakes()
    const adapted = aggregateTurnContext(session as unknown as ShellSessionSurface)
    // get settingsSeam invokes the private #settingsClient() — with the
    // Proxy as `this` the private-brand check throws "Cannot access
    // private method or accessor" (the /login crash via features/login.tsx).
    // The wrapper must compute accessors on the real target.
    const seam = adapted.settingsSeam
    expect(seam).toBeDefined()
    expect(typeof seam!.describe).toBe('function')
    expect(typeof seam!.mutate).toBe('function')
    // sibling surface members pass through the same trap
    expect(adapted.label).toBe('provider/model')
    expect(adapted.usage).toBe(session.usage)
  })
})

// ---------------------------------------------------------------------------
// Accessor audit — the class-kill gate. EVERY public accessor/method of
// RemoteHostSession is driven through the REAL instance + the REAL
// aggregateTurnContext wrapper (the exact object ShellHost receives in
// client mode). Contract (the /login crash, fixed in 3dec270): each member
// must behave IDENTICALLY through the wrapper — no "Cannot access private
// method or accessor" anywhere, and every documented result shape holds.
// The fake connection answers `{}` to every RPC and the socket factory
// throws a business error, so degraded members surface their documented
// degradation ([] / error string / business-error rejection) — the same
// shapes the raw instance produces.
// ---------------------------------------------------------------------------

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const auditSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface AuditFakes {
  session: RemoteHostSession
  adapted: ShellSessionSurface
  workspace: string
  home: string
  rpcs: string[]
  cleanup(): void
}

/** The makeFakes pattern, with managed temp workspace/home dirs (the config
 * seam and the agent files write there) and a recording fake rpc. */
function auditFakes(): AuditFakes {
  const workspace = mkdtempSync(join(tmpdir(), 'dsh-audit-ws-'))
  const home = mkdtempSync(join(tmpdir(), 'dsh-audit-home-'))
  // a real agent definition so listAgents/agentSet exercise real files (row 30)
  mkdirSync(join(home, 'agents'), { recursive: true })
  writeFileSync(
    join(home, 'agents', 'audit-agent.md'),
    '---\nname: audit-agent\nmodel: origin/model\ndescription: audit fixture\n---\n\nbody\n',
  )
  const rpcs: string[] = []
  const connection = fakeConnection({
    rpc: (method: string) => {
      rpcs.push(method)
      return Promise.resolve({})
    },
  })
  const session = new RemoteHostSession({
    connection,
    cookieHeader: 'dsh-auth-audit=v1.abc',
    cwd: workspace,
    workspaceDir: workspace, // the config.yml overlay scope (row 41)
    dshHome: home, // client-local clusters + /reload restart — NEVER the real home
    socketFactory: () => {
      throw new Error('no sockets in the audit')
    },
  })
  const adapted = aggregateTurnContext(session as unknown as ShellSessionSurface)
  return {
    session,
    adapted,
    workspace,
    home,
    rpcs,
    cleanup() {
      rmSync(workspace, { recursive: true, force: true })
      rmSync(home, { recursive: true, force: true })
    },
  }
}

describe('RemoteHostSession accessor audit (through aggregateTurnContext)', () => {
  test('fields read the real target; remoteTailSink SETS land on it (ShellHost.tsx wiring)', () => {
    const f = auditFakes()
    try {
      expect(f.adapted.label).toBe('dsh-host')
      expect(f.adapted.usage).toBe(f.session.usage) // same reference — no re-wrap
      expect(f.adapted.usage).toEqual({ prompt: 0, completion: 0, cacheRead: 0, cacheWrite: 0 })
      expect(f.adapted.lastTurnStats).toBe(f.session.lastTurnStats)
      expect(f.adapted.lastTurnStats).toEqual({ startedAt: 0, endedAt: 0, ms: 0, chars: 0, tokens: 0, tps: null, estimated: true })
      expect(f.adapted.remoteTailActive).toBe(false)
      expect(f.adapted.remoteTailSink).toBeNull()
      const sink = (_rows: { kind: string; text: string; final: boolean }[]) => {}
      f.adapted.remoteTailSink = sink // the /tail wiring goes through the SAME wrapper
      expect(f.session.remoteTailSink).toBe(sink)
      f.adapted.remoteTailSink = null
    } finally {
      f.cleanup()
    }
  })

  test('status getter (fuller wave-2 surface)', () => {
    const f = auditFakes()
    try {
      expect(f.adapted.status).toEqual({ connection: 'connected', turn: 'idle', sessionAttached: false, tailActive: false })
    } finally {
      f.cleanup()
    }
  })

  test('settingsSeam getter drives #settingsClient describe+mutate (the /login crash path)', async () => {
    const f = auditFakes()
    try {
      const seam = f.adapted.settingsSeam
      expect(seam).toBeDefined()
      expect(typeof seam!.describe).toBe('function')
      expect(typeof seam!.mutate).toBe('function')
      // login.tsx openMenu(): describe() → the flat row array with .ns/.revision
      expect(await seam!.describe()).toEqual([])
      // login.tsx writeRoute(): mutate('llm-pi-ai', ops, revision?)
      await expect(
        seam!.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', 'anthropic'], value: { apiKeyEnv: 'ANTHROPIC_API_KEY' } }]),
      ).resolves.toBeUndefined()
      expect(f.rpcs).toContain('settings/describe')
      expect(f.rpcs).toContain('settings/mutate')
    } finally {
      f.cleanup()
    }
  })

  test('lifecycle + turn-control members', async () => {
    const f = auditFakes()
    try {
      expect(f.adapted.currentSessionId()).toBeUndefined()
      const ready = await f.adapted.start()
      expect(ready).toEqual({ clientId: 'client-1', host: { home: '/tmp/dsh-fake-home' } })
      expect(await f.adapted.start()).toBe(ready) // idempotent
      f.adapted.newSession()
      expect(f.adapted.resumeSession('stored-1')).toBe('ok')
      f.adapted.registerAskProvider(async (qs) => qs.map((q) => ({ questionId: q.id, selected: q.options[0] ?? '' })))
      f.adapted.steer('nudge') // no live session: documented silent no-op
      f.adapted.stopRemoteTail()
      f.adapted.abort() // nothing live: settles bookkeeping only
      expect(f.adapted.currentSessionId()).toBeUndefined()
    } finally {
      f.cleanup()
    }
  })

  test('telemetry members', () => {
    const f = auditFakes()
    try {
      expect(f.adapted.cacheHitRate()).toBeNull() // no cache traffic yet
      const summary = f.adapted.usageSummary()
      expect(Array.isArray(summary)).toBe(true)
      expect(summary.length).toBeGreaterThan(0)
      expect(summary.every((line) => typeof line === 'string')).toBe(true)
      expect(summary.some((line) => line.startsWith('turns '))).toBe(true)
    } finally {
      f.cleanup()
    }
  })

  test('model surface (rows 21+22)', async () => {
    const f = auditFakes()
    try {
      await f.adapted.start()
      f.adapted.switchModel('audit-provider', 'audit-model', 'high')
      expect(f.adapted.label).toBe('audit-provider/audit-model (high)') // immediate label swap
      expect(await f.adapted.selectModel({ provider: 'p2', model: 'm2' })).toEqual({ provider: 'p2', model: 'm2' }) // staged, no live session
      expect(await f.adapted.modelCatalog(true)).toEqual({ default: undefined, routableProviders: [], groups: [], failures: [] })
      expect(await f.adapted.defaultModelSelection()).toBeUndefined()
      expect(await f.adapted.currentModelSelection()).toBeUndefined() // cold → catalog default
      await expect(f.adapted.initializeDefaultModel()).resolves.toBeUndefined()
      expect(await f.adapted.listProviders()).toEqual([])
      expect(await f.adapted.configurableProviders()).toEqual([])
    } finally {
      f.cleanup()
    }
  })

  test('session-ops surface (rows 12-20, 26)', async () => {
    const f = auditFakes()
    try {
      await f.adapted.start()
      expect(await f.adapted.listSessions()).toEqual([])
      expect(await f.adapted.listSessions(5)).toEqual([])
      expect(await f.adapted.storedTranscript('any-id')).toEqual([])
      expect(await f.adapted.storedTranscript('any-id', 2)).toEqual([])
      expect(await f.adapted.searchSessions('needle')).toEqual([])
      expect(await f.adapted.renameSession('new title')).toBeUndefined() // no live session
      expect(f.adapted.historyTurns()).toEqual([])
      expect(await f.adapted.listHostCommands()).toEqual([]) // agent-scoped: [] cold
      expect(await f.adapted.executeHostCommand('/anything')).toEqual({ text: 'host command service unavailable' })
    } finally {
      f.cleanup()
    }
  })

  test('preset surface (row 23) + executionMode (row 37)', async () => {
    const f = auditFakes()
    try {
      await f.adapted.start()
      expect(await f.adapted.listPresets()).toEqual([])
      expect(await f.adapted.readPreset('audit-preset')).toEqual({ agentPreset: 'audit-preset', content: '' })
      expect(await f.adapted.selectPreset('audit-preset')).toBeUndefined() // no live session
      expect(f.adapted.currentPresetId()).toBeUndefined()
      f.adapted.switchPreset('audit-preset')
      expect(f.adapted.currentPresetId()).toBe('audit-preset')
      expect(f.adapted.executionMode()).toBe('native') // no preset document → deployment default
    } finally {
      f.cleanup()
    }
  })

  test('settings + credentials surface (rows 24+25)', async () => {
    const f = auditFakes()
    try {
      await f.adapted.start()
      expect(await f.adapted.settingsDescribe()).toEqual([])
      await expect(f.adapted.settingsMutate('ns-1', [{ op: 'set', path: ['a'], value: 1 }])).resolves.toBeUndefined()
      expect(await f.adapted.settingsUpdate('ns-1', { a: 1 })).toEqual({ ns: '' })
      expect(await f.adapted.settingsReplace('ns-1', { a: 2 })).toEqual({ ns: '' })
      expect(await f.adapted.settingsDocument()).toEqual({ writable: true, hasDocument: false, namespaces: [] })
      expect(await f.adapted.credentialStatus('ANTHROPIC_API_KEY')).toEqual({ configured: false })
      // login/logout ride the FAKE rpc — the fake writes nowhere
      await expect(f.adapted.login('ANTHROPIC_API_KEY', 'sk-audit-not-a-real-key')).resolves.toBeUndefined()
      await expect(f.adapted.logout('ANTHROPIC_API_KEY')).resolves.toBeUndefined()
      expect(f.rpcs).toContain('credentials/set')
      expect(f.rpcs).toContain('credentials/unset')
    } finally {
      f.cleanup()
    }
  })

  test('push listeners (rows 24/25/26/28) return callable disposers', () => {
    const f = auditFakes()
    try {
      const disposers = [
        f.adapted.onSettingsUpdated(() => {}),
        f.adapted.onHostCommandsChanged(() => {}),
        f.adapted.onPluginsChanged(() => {}),
        f.adapted.onCredentialUpdated(() => {}),
      ]
      for (const dispose of disposers) expect(typeof dispose).toBe('function')
      for (const dispose of disposers) dispose() // no throw
    } finally {
      f.cleanup()
    }
  })

  test('config seam (row 41): paths, load, save split, keybindings', async () => {
    const f = auditFakes()
    // neutralize the env layer (bucket-(d) precedence) for deterministic asserts
    const savedTheme = process.env.DSH_OPENTUI_THEME
    const savedModel = process.env.DSH_OPENTUI_MODEL
    delete process.env.DSH_OPENTUI_THEME
    delete process.env.DSH_OPENTUI_MODEL
    try {
      expect(f.adapted.configPath()).toBe(join(f.home, 'profiles', 'opentui', 'config.json'))
      expect(f.adapted.configPath('config.yml')).toBe(join(f.workspace, '.dsh', 'config.yml'))
      expect(f.adapted.configPath('keybindings.json')).toBe(join(f.home, 'profiles', 'opentui', 'keybindings.json'))
      expect(f.adapted.keybindingsLoad()).toEqual({}) // missing file → {}
      expect(f.adapted.configLoad()).toEqual({}) // empty base ⊕ no overlay ⊕ no env
      const afterPluginKey = f.adapted.configSave({ retentionDays: 3 }) // plugin key → profile config.json
      expect(afterPluginKey.retentionDays).toBe(3)
      // 67-theme regression (batch F7b contract): /theme persists to the
      // PROFILE config.json ("theme" key, host-face parity) — never the
      // workspace overlay (the pre-fix routing hid the key from the store
      // the e2e and the restart boot read).
      const afterTheme = f.adapted.configSave({ theme: 'dracula' })
      expect(afterTheme.theme).toBe('dracula')
      const profile = JSON.parse(readFileSync(f.adapted.configPath(), 'utf8')) as Record<string, unknown>
      expect(profile).toEqual({ retentionDays: 3, theme: 'dracula' })
      // the workspace overlay carries no theme key (scope guard)
      await expect(f.adapted.refreshWorkspaceConfig()).resolves.toBeUndefined()
      expect(existsSync(join(f.workspace, '.dsh', 'config.yml'))).toBe(false)
      expect(f.adapted.configLoad().theme).toBe('dracula') // the profile base answers
      // the model key still rides the workspace overlay (async write)
      const afterModel = f.adapted.configSave({ model: { provider: 'deepseek' } })
      expect(afterModel.model).toEqual({ provider: 'deepseek' })
      const overlayPath = join(f.workspace, '.dsh', 'config.yml')
      const deadline = Date.now() + 2_000
      while (!existsSync(overlayPath) && Date.now() < deadline) await auditSleep(20)
      expect(readFileSync(overlayPath, 'utf8')).not.toMatch(/^theme:/m)
      expect(readFileSync(overlayPath, 'utf8')).toContain('provider: deepseek')
    } finally {
      if (savedTheme !== undefined) process.env.DSH_OPENTUI_THEME = savedTheme
      else delete process.env.DSH_OPENTUI_THEME
      if (savedModel !== undefined) process.env.DSH_OPENTUI_MODEL = savedModel
      else delete process.env.DSH_OPENTUI_MODEL
      f.cleanup()
    }
  })

  test('client-local wave-3 (row 30/31/39): agents, repair scan, git probe', async () => {
    const f = auditFakes()
    try {
      expect(f.adapted.listAgents()).toEqual([
        {
          name: 'audit-agent',
          description: 'audit fixture',
          model: 'origin/model',
          deep: 1,
          body: 'body',
          file: join(f.home, 'agents', 'audit-agent.md'),
        },
      ])
      expect(f.adapted.agentSet('audit-agent', 'deep', '3')).toEqual({ target: { kind: 'frontmatter' } })
      expect(readFileSync(join(f.home, 'agents', 'audit-agent.md'), 'utf8')).toContain('deep: 3')
      // a missing agent file resolves the business error in-band (the caller
      // paints it) — never a thrown private-brand TypeError
      expect(f.adapted.agentSet('missing-agent', 'model', 'x')).toEqual({
        target: { kind: 'frontmatter' },
        error: 'agent "missing-agent" not found',
      })
      expect(f.adapted.repairScan()).toEqual(['no sessions directory'])
      expect(await f.adapted.gitBranch()).toBe('') // temp dir is not a repo
      expect(await f.adapted.gitBranch(f.workspace)).toBe('')
    } finally {
      f.cleanup()
    }
  })

  test('plugins + skills + reload (rows 27/28/29)', async () => {
    const f = auditFakes()
    try {
      await f.adapted.start()
      expect(f.adapted.listPlugins()).toEqual([])
      expect(await f.adapted.refreshPlugins()).toEqual([])
      expect(f.adapted.listSkills()).toEqual([])
      expect(await f.adapted.refreshSkills()).toEqual([]) // no live session → cache
      expect(f.adapted.lastRestartPid()).toBeUndefined()
      // the fake home has no lifecycle lockfile → the documented no-lock error
      // STRING (never a throw), and NEVER a restart of the real host
      const reload = await f.adapted.reloadPlugins()
      expect(typeof reload).toBe('string')
      expect(reload).toContain('no host lockfile')
      expect(f.adapted.executionMode()).toBe('native')
    } finally {
      f.cleanup()
    }
  })

  test('remote tail + attachments (rows 17/35/36)', async () => {
    const f = auditFakes()
    try {
      // the follow attach needs a socket → the documented contained error STRING
      expect(await f.adapted.startRemoteTail('foreign-id')).toBe('no sockets in the audit')
      expect(f.adapted.remoteTailActive).toBe(false) // ShellHost's flag, untouched
      f.adapted.stopRemoteTail()
      // attachImage with a REAL png (validation + staging through the wrapper)
      const pngPath = join(f.workspace, 'audit-1x1.png')
      writeFileSync(pngPath, PNG_1X1)
      expect(await f.adapted.attachImage(pngPath)).toMatch(/^audit-1x1\.png \(\d+ KB\)$/)
      // fetchHostFile → nothing listens on the fake authority → the wrapped
      // HostFileError (business), not a TypeError
      let fetchError: unknown
      try {
        await f.adapted.fetchHostFile('/tmp/whatever.png')
      } catch (e) {
        fetchError = e
      }
      expect(fetchError).toBeInstanceOf(Error)
      expect((fetchError as Error).message).toContain('GET /api/file failed')
      expect(f.adapted.lastAttachmentIds()).toEqual([])
    } finally {
      f.cleanup()
    }
  })

  test('subagent panel (row 33), cold', async () => {
    const f = auditFakes()
    try {
      expect(f.adapted.childTranscript('child-x')).toEqual([])
      expect(f.adapted.steerChild('child-x', 'go')).toBe(false) // not adopted
      expect(await f.adapted.steerChildDetailed('child-x', 'go')).toEqual({ ok: false, reason: 'no live parent session' })
      expect(f.adapted.subagentViews()).toEqual([])
      await expect(f.adapted.interruptChild('child-x')).rejects.toThrow('no live parent session')
    } finally {
      f.cleanup()
    }
  })

  test('sync-throw parity: readSessionAttachment cold guard', () => {
    const f = auditFakes()
    try {
      let thrown: unknown
      try {
        f.adapted.readSessionAttachment('att-1')
      } catch (e) {
        thrown = e
      }
      expect(thrown).toBeInstanceOf(Error)
      expect((thrown as Error).message).toBe('no live session to read attachments from')
    } finally {
      f.cleanup()
    }
  })

  test('deep chain: failed turn adopts the session id → session-bound members run → abort clears', async () => {
    const f = auditFakes()
    try {
      await f.adapted.start()
      expect(f.adapted.resumeSession('audit-resume-id')).toBe('ok')
      const callbacks: TurnCallbacks = {
        onThinkingDelta: () => {},
        onContentDelta: () => {},
        onTurnEnd: () => {},
        onApprove: async () => true,
        onToolRun: () => {},
        onError: () => {},
      }
      // turn through the WRAPPER (the aggregation closure): session/create
      // rides the fake rpc, then the follow attach needs a socket → the
      // business rejection. The wrapper's post-turn usage read never runs
      // (no onTurnEnd), and NO private-brand TypeError surfaces anywhere.
      let turnError: unknown
      try {
        await f.adapted.turn('audit prompt', callbacks)
      } catch (e) {
        turnError = e
      }
      expect(turnError).toBeInstanceOf(Error)
      expect((turnError as Error).message).toBe('no sockets in the audit')
      // #ensureSession adopted the requested (resume) id BEFORE the attach died
      expect(f.adapted.currentSessionId()).toBe('audit-resume-id')
      expect(f.adapted.status).toEqual({ connection: 'connected', turn: 'starting', sessionAttached: false, tailActive: false })

      // forkAtTurn rides the live id into ops.fork (rpc {}) → business error
      let forkError: unknown
      try {
        await f.adapted.forkAtTurn()
      } catch (e) {
        forkError = e
      }
      expect((forkError as Error).message).toBe('session/fork returned no sessionId')

      // live-session members past their cold guards
      expect(await f.adapted.readSessionAttachment('att-1')).toEqual({ data: '', mediaType: '', bytes: 0 })
      expect(await f.adapted.steerChildDetailed('child-1', 'go')).toEqual({ ok: true })
      await expect(f.adapted.interruptChild('child-1')).resolves.toBeUndefined()
      expect(f.adapted.steerChild('child-1', 'go')).toBe(false) // listed ≠ adopted
      f.adapted.steer('nudge') // live id: fires the steer rpc, returns void
      // btwAsk: create rpc ok → follow attach needs a socket → business reject
      let btwError: unknown
      try {
        await f.adapted.btwAsk('side question', [])
      } catch (e) {
        btwError = e
      }
      expect((btwError as Error).message).toBe('no sockets in the audit')
      expect(f.adapted.historyTurns()).toEqual([]) // journal empty without a follow

      // abort: fresh-session semantics — the id is cleared
      f.adapted.abort()
      expect(f.adapted.currentSessionId()).toBeUndefined()
    } finally {
      f.cleanup()
    }
  })

  test('dispose through the wrapper is clean and idempotent', async () => {
    const f = auditFakes()
    try {
      await f.adapted.start()
      await expect(f.adapted.dispose()).resolves.toBeUndefined()
      await expect(f.adapted.dispose()).resolves.toBeUndefined() // idempotent
    } finally {
      f.cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// Exit-path interception (/quit and Ctrl+C call process.exit inside
// ShellHost; Ctrl+D exits the renderer; SIGTERM/SIGHUP arrive outside).
// ---------------------------------------------------------------------------

describe('installExitPaths', () => {
  test('routes process.exit through shutdown, then the real exit', async () => {
    let realExitCode: number | undefined
    let shutdowns = 0
    const listeners = new Map<string, () => void>()
    const target: { exit: NodeJS.Process['exit']; on: NodeJS.Process['on'] } = {
      exit: (code?: number) => {
        // the interception REPLACES this — it must never run directly
        realExitCode = code
      },
      on: (signal: string, listener: () => void) => {
        listeners.set(signal, listener)
        return target as unknown as NodeJS.Process
      },
    }
    installExitPaths(
      () => {
        shutdowns += 1
        return Promise.resolve()
      },
      target as unknown as NodeJS.Process,
      20,
    )
    expect(listeners.has('SIGINT')).toBe(true)
    expect(listeners.has('SIGTERM')).toBe(true)
    expect(listeners.has('SIGHUP')).toBe(true)

    target.exit(0) // /quit · ctrl+c path
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(shutdowns).toBe(1)
    expect(realExitCode).toBe(0)

    listeners.get('SIGTERM')!() // external kill path
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(shutdowns).toBe(2)
  })

  test('force-exits after the grace when dispose hangs', async () => {
    let realExitCode: number | undefined
    const target: { exit: NodeJS.Process['exit']; on: NodeJS.Process['on'] } = {
      exit: (code?: number) => {
        realExitCode = code
      },
      on: (() => target as unknown as NodeJS.Process) as NodeJS.Process['on'],
    }
    installExitPaths(
      () => new Promise<void>(() => {}), // hung dispose
      target as unknown as NodeJS.Process,
      20,
    )
    target.exit(0)
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(realExitCode).toBe(0) // did not hang forever
  })
})
