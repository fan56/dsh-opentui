/**
 * M3-05 — resume preset migration decoration layer.
 *
 * Drives the real `apply()` over the NDJSON wire with a fake `ctx.sessionPersistence`
 * whose read handle exposes `header.agentPreset` (the real host field —
 * dsh-session `SessionHeader.agentPreset`, dsh-session-persistence
 * `SessionHandle.header`). Pins:
 *  - legacy append preset -> resume agentOptions.preset overridden to 'standard'
 *    (set, not deleted), and the synthetic id never appears in the options;
 *  - one warning per migrated session per process (same session re-resume stays
 *    1; a different session warns once more);
 *  - dedupe: the M3-04 setup's section text() is '' for a hit session (no
 *    double injection) and the real append content for a miss session;
 *  - read-only: every persistence open is 'read', zero append/write calls;
 *  - boundary: missing preset field or read failure is a clean miss — no
 *    override, no warning, resume still succeeds.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index'
import type { SystemPromptSectionLike } from '../src/index'
import { APPEND_SYSTEM_PRESET_ID } from '../src/append-text'

const STDIO_SWITCH = 'DSH_OPENTUI_BRIDGE_STDIO'
const APPEND_MARKER = 'M3-05-APPEND-CONTENT-MARKER'
type Frame = Record<string, any>
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

interface HarnessOptions {
  /** session id -> value exposed at handle.header.agentPreset (absent = no field). */
  presets?: Record<string, unknown>
  /** session ids whose persistence.open('read') throws. */
  failOpen?: string[]
  /** simulate a host that throws on ctx.get('sessionPersistence') (undeclared inject). */
  throwGetPersistence?: boolean
}

interface Harness {
  frames: string[]
  send(frame: unknown): void
  waitFor(id: number | string): Promise<Frame>
  resumeOptions: Array<Record<string, any>>
  warnings: unknown[][]
  sections: SystemPromptSectionLike[]
  openCalls: Array<{ id: string; access: string }>
  appendCalls: number
}

function migrationWarnings(h: Harness): number {
  return h.warnings.filter(
    (w) => typeof w[0] === 'string' && (w[0] as string).includes('migrated to'),
  ).length
}

function sectionText(spec: SystemPromptSectionLike | undefined): string {
  if (spec === undefined) throw new Error('no section was registered by setup')
  return typeof spec.text === 'function' ? spec.text({}) : spec.text
}

function makeHarness(options: HarnessOptions = {}): Harness {
  const presets = new Map<string, unknown>(Object.entries(options.presets ?? {}))
  const failOpen = new Set(options.failOpen ?? [])

  // Temp DSH_HOME with real append content so a non-suppressed section text()
  // returns a non-empty marker we can assert on.
  const home = mkdtempSync(join(tmpdir(), 'dsh-m3-05-'))
  const appendFile = join(home, 'APPEND_SYSTEM.md')
  writeFileSync(appendFile, APPEND_MARKER)
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home

  const previousSwitch = process.env[STDIO_SWITCH]
  process.env[STDIO_SWITCH] = '1'
  const originalWrite = process.stdout.write.bind(process.stdout)
  const frames: string[] = []
  const patchedWrite = function (this: unknown, chunk: any, ...rest: any[]) {
    const text = String(chunk)
    frames.push(text)
    let parsed: any
    try { parsed = JSON.parse(text.trim()) } catch { /* reporter noise */ }
    const isBridgeFrame =
      parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) &&
      ('ok' in parsed || 'type' in parsed) &&
      ('id' in parsed || 'payload' in parsed || 'result' in parsed || 'error' in parsed)
    if (isBridgeFrame) return true
    return originalWrite(chunk, ...rest)
  } as typeof process.stdout.write
  process.stdout.write = patchedWrite

  const stdinListeners: Record<string, Array<(...args: any[]) => void>> = {}
  const fakeStdin = {
    setEncoding() {},
    on(name: string, fn: (...args: any[]) => void) {
      ;(stdinListeners[name] ||= []).push(fn)
      return fakeStdin
    },
    off(name: string, fn: (...args: any[]) => void) {
      ;(stdinListeners[name] ||= []).filter((f) => f !== fn)
      return fakeStdin
    },
    once(name: string, fn: (...args: any[]) => void) {
      ;(stdinListeners[name] ||= []).push(fn)
      return fakeStdin
    },
    pause() { return fakeStdin },
    resume() { return fakeStdin },
  }
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin')
  Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true })

  const warnings: unknown[][] = []
  const sections: SystemPromptSectionLike[] = []
  const agentCtx = {
    logger: {
      info() {},
      warn(...args: unknown[]) { warnings.push(args) },
      error() {},
      debug() {},
    },
    effect() { return {} },
    get(name: string) {
      return name === 'systemPrompt'
        ? { section(spec: SystemPromptSectionLike) { sections.push(spec); return () => {} } }
        : undefined
    },
  }
  const agent = {
    status: 'idle', session: { seq: 0 },
    followup() {}, steer() {}, cancel() {},
    whenIdle() { return new Promise<void>(() => {}) },
  }
  const resumeOptions: Array<Record<string, any>> = []
  const agents = {
    async create() { return { agent, dispose: async () => {} } },
    async resume(options: Record<string, any>) {
      resumeOptions.push(options)
      if (typeof options.setup === 'function') await options.setup(agentCtx, agent)
      return { agent, dispose: async () => {} }
    },
    get() { return undefined },
  }

  const openCalls: Array<{ id: string; access: string }> = []
  let appendCalls = 0
  const persistence = {
    async open(id: string, access: string) {
      openCalls.push({ id, access })
      if (failOpen.has(id)) throw new Error('fake persistence open failure')
      return {
        header: presets.has(id) ? { agentPreset: presets.get(id) } : {},
        async read() { return { events: [] } },
        async append() { appendCalls += 1 },
        async close() {},
      }
    },
  }

  let disposeBridge: (() => void) | undefined
  const ctx: any = {
    logger: {
      info() {},
      warn(...args: unknown[]) { warnings.push(args) },
      error() {},
      debug() {},
    },
    effect(execute: () => () => void) {
      disposeBridge = execute()
      return { dispose: () => disposeBridge?.() }
    },
    on() { return () => {} },
    get(name: string) {
      if (name === 'agents') return agents
      if (name === 'sessionPersistence') {
        if (options.throwGetPersistence) throw new Error('ctx.get: sessionPersistence not injected')
        return persistence
      }
      if (name === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: 'fake-provider', model: 'fake-model', reasoningEffort: 'high' }) }
      }
      return undefined
    },
    agents,
  }
  apply(ctx, {})

  cleanups.push(() => {
    try { disposeBridge?.() } catch { /* already torn down */ }
    process.stdout.write = originalWrite
    if (stdinDescriptor) Object.defineProperty(process, 'stdin', stdinDescriptor)
    else delete (process as any).stdin
    if (previousSwitch === undefined) delete process.env[STDIO_SWITCH]
    else process.env[STDIO_SWITCH] = previousSwitch
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    unlinkSync(appendFile)
    rmdirSync(home)
  })

  const latest = (id: number | string): Frame | undefined => {
    for (let i = frames.length - 1; i >= 0; i--) {
      try {
        const frame = JSON.parse(frames[i])
        if (frame !== null && typeof frame === 'object' && frame.id === id) return frame
      } catch { /* non-frame noise */ }
    }
    return undefined
  }
  const waitFor = async (id: number | string): Promise<Frame> => {
    const deadline = Date.now() + 2000
    for (;;) {
      const frame = latest(id)
      if (frame !== undefined) return frame
      if (Date.now() > deadline) throw new Error(`no response frame for id=${id}`)
      await sleep(1)
    }
  }
  const send = (frame: unknown) => {
    const line = `${JSON.stringify(frame)}\n`
    for (const fn of stdinListeners['data'] || []) fn(line)
  }

  return {
    frames, send, waitFor, resumeOptions, warnings, sections, openCalls,
    get appendCalls() { return appendCalls },
  }
}

async function openResume(h: Harness, id: string, reqId: number): Promise<Frame> {
  h.send({ id: reqId, method: 'session.open', params: { mode: 'resume', id } })
  return h.waitFor(reqId)
}

describe('M3-05: resume preset mapping + single warning + dedupe', () => {
  test('legacy append preset -> agentOptions.preset === standard (override, not delete); no synthetic id', async () => {
    const h = makeHarness({ presets: { 'm3-05-map-1': APPEND_SYSTEM_PRESET_ID } })
    const reply = await openResume(h, 'm3-05-map-1', 1)
    expect(reply.ok).toBe(true)

    expect(h.resumeOptions).toHaveLength(1)
    const opts = h.resumeOptions[0]!
    expect(opts.resumeSessionId).toBe('m3-05-map-1')
    expect(opts.agentOptions.preset).toBe('standard')
    // Override, not delete: the pre-existing accessors are untouched.
    expect(opts.agentOptions.provider).toBe('fake-provider')
    expect(opts.agentOptions.model).toBe('fake-model')
    // The synthetic id never leaks into the resume options.
    expect(JSON.stringify(opts)).not.toContain(APPEND_SYSTEM_PRESET_ID)
  })

  test('warn exactly once per session per process; a different session warns once', async () => {
    const h = makeHarness({
      presets: { 'm3-05-warn-a': APPEND_SYSTEM_PRESET_ID, 'm3-05-warn-b': APPEND_SYSTEM_PRESET_ID },
    })
    expect((await openResume(h, 'm3-05-warn-a', 1)).ok).toBe(true)
    expect(migrationWarnings(h)).toBe(1)

    // Same session re-resume in the SAME process: still exactly one warning.
    h.send({ id: 2, method: 'session.close', params: {} })
    await h.waitFor(2)
    expect((await openResume(h, 'm3-05-warn-a', 3)).ok).toBe(true)
    expect(migrationWarnings(h)).toBe(1)

    // A different session gets its own single warning.
    h.send({ id: 4, method: 'session.close', params: {} })
    await h.waitFor(4)
    expect((await openResume(h, 'm3-05-warn-b', 5)).ok).toBe(true)
    expect(migrationWarnings(h)).toBe(2)
  })

  test('dedupe: hit session section text() === "" ; miss session returns append content', async () => {
    const hit = makeHarness({ presets: { 'm3-05-suppress-hit': APPEND_SYSTEM_PRESET_ID } })
    expect((await openResume(hit, 'm3-05-suppress-hit', 1)).ok).toBe(true)
    expect(hit.sections).toHaveLength(1)
    expect(sectionText(hit.sections.at(-1))).toBe('')

    const miss = makeHarness({ presets: { 'm3-05-suppress-miss': 'standard' } })
    expect((await openResume(miss, 'm3-05-suppress-miss', 1)).ok).toBe(true)
    expect(miss.sections).toHaveLength(1)
    expect(sectionText(miss.sections.at(-1))).toBe(APPEND_MARKER)
  })

  test('read-only: every open is read; zero append/write calls', async () => {
    const h = makeHarness({ presets: { 'm3-05-readonly': APPEND_SYSTEM_PRESET_ID } })
    expect((await openResume(h, 'm3-05-readonly', 1)).ok).toBe(true)
    expect(h.openCalls.length).toBeGreaterThan(0)
    expect(h.openCalls.every((c) => c.access === 'read')).toBe(true)
    expect(h.appendCalls).toBe(0)
  })

  test('boundary: missing preset field or read failure -> clean miss, no warning, resume succeeds', async () => {
    const h = makeHarness({ failOpen: ['m3-05-read-fail'] })

    expect((await openResume(h, 'm3-05-no-preset', 1)).ok).toBe(true)
    expect(h.resumeOptions[0]!.agentOptions.preset).toBeUndefined()
    expect(migrationWarnings(h)).toBe(0)

    h.send({ id: 2, method: 'session.close', params: {} })
    await h.waitFor(2)
    expect((await openResume(h, 'm3-05-read-fail', 3)).ok).toBe(true)
    expect(h.resumeOptions[1]!.agentOptions.preset).toBeUndefined()
    expect(migrationWarnings(h)).toBe(0)

    // Detection never blocked either resume, and stayed read-only throughout.
    expect(h.openCalls.every((c) => c.access === 'read')).toBe(true)
    expect(h.appendCalls).toBe(0)
  })

  test('boundary: ctx.get(sessionPersistence) throwing is contained -> resume still succeeds', async () => {
    const h = makeHarness({ throwGetPersistence: true })
    const reply = await openResume(h, 'm3-05-get-throw', 1)
    expect(reply.ok).toBe(true)
    expect(h.resumeOptions[0]!.agentOptions.preset).toBeUndefined()
    expect(migrationWarnings(h)).toBe(0)
  })

  test('nested/array preset shape still detected (robust equality)', async () => {
    const h = makeHarness({
      presets: {
        'm3-05-array': ['ptc', APPEND_SYSTEM_PRESET_ID],
        'm3-05-nested': { agentPreset: { id: APPEND_SYSTEM_PRESET_ID } },
      },
    })
    expect((await openResume(h, 'm3-05-array', 1)).ok).toBe(true)
    expect(h.resumeOptions[0]!.agentOptions.preset).toBe('standard')
    h.send({ id: 2, method: 'session.close', params: {} })
    await h.waitFor(2)
    expect((await openResume(h, 'm3-05-nested', 3)).ok).toBe(true)
    expect(h.resumeOptions[1]!.agentOptions.preset).toBe('standard')
    expect(migrationWarnings(h)).toBe(2)
  })
})
