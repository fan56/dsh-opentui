// Client-entry wiring (ADR-0005 bucket (c)): bootClient must chain
// ensureHost → ClientConnection({authority, cookieHeader}) →
// RemoteHostSession → render with zero ShellHost edits, source the theme
// from the session's post-start configLoad(), and shut down CLEANLY
// (dispose session → release host ref — never dispose the host, the
// grace-window re-attach semantics stay intact). Everything runs against
// fakes injected through ClientBootOptions; the exit-path interception is
// exercised against a fake process-like target.
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
