/**
 * M3-05 (post-8e0e847) — legacy append preset id is INERT metadata in inproc.
 *
 * Drives the real `apply()` over the NDJSON wire with a fake `ctx.sessionPersistence`
 * whose read handle exposes `header.agentPreset` (the real host field —
 * dsh-session `SessionHeader.agentPreset`, dsh-session-persistence
 * `SessionHandle.header`). Pins:
 *  - golden (a): a legacy-header session resumes with section text = the
 *    APPEND_SYSTEM.md content, appearing EXACTLY ONCE (no double injection);
 *  - golden (b): the `agents.resume` payload has NO `preset` key at all;
 *  - golden (c): new and legacy-header-resume sessions yield equal section text
 *    under the same APPEND_SYSTEM.md;
 *  - detection stays read-only and is logged as ONE debug line PER resume
 *    (no once-per-session Set), never as warn;
 *  - missing preset field / read failure / ctx.get throw are clean misses.
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
const EXPECTED_DEBUG = `[append-system] header.agentPreset="${APPEND_SYSTEM_PRESET_ID}" 为旧版合成 preset id，在本 profile 中不生效（无 agentPresets 服务）；append 内容由 bridge section 注入，行为与新建会话一致`
type Frame = Record<string, any>
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function occurrences(haystack: string, needle: string): number {
  let count = 0
  let at = haystack.indexOf(needle)
  while (at !== -1) {
    count += 1
    at = haystack.indexOf(needle, at + needle.length)
  }
  return count
}

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
  debugs: unknown[][]
  sections: SystemPromptSectionLike[]
  openCalls: Array<{ id: string; access: string }>
  appendCalls: number
}

function legacyDebugCount(h: Harness): number {
  return h.debugs.filter(
    (d) => typeof d[0] === 'string' && (d[0] as string).includes('旧版合成 preset id'),
  ).length
}

function migrationWarningCount(h: Harness): number {
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

  // Temp DSH_HOME with real append content so the unconditional section text()
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
  const debugs: unknown[][] = []
  const sections: SystemPromptSectionLike[] = []
  const agentCtx = {
    logger: {
      info() {},
      warn(...args: unknown[]) { warnings.push(args) },
      error() {},
      debug(...args: unknown[]) { debugs.push(args) },
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
    async create(options: Record<string, any>) {
      if (typeof options?.setup === 'function') await options.setup(agentCtx, agent)
      return { agent, dispose: async () => {} }
    },
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
      debug(...args: unknown[]) { debugs.push(args) },
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
    frames, send, waitFor, resumeOptions, warnings, debugs, sections, openCalls,
    get appendCalls() { return appendCalls },
  }
}

async function openResume(h: Harness, id: string, reqId: number): Promise<Frame> {
  h.send({ id: reqId, method: 'session.open', params: { mode: 'resume', id } })
  return h.waitFor(reqId)
}

describe('M3-05: legacy preset id is inert metadata (post-8e0e847)', () => {
  test('golden (a): legacy header id -> section text = APPEND_SYSTEM.md content exactly once', async () => {
    const h = makeHarness({ presets: { 'm3-05-golden-a': APPEND_SYSTEM_PRESET_ID } })
    expect((await openResume(h, 'm3-05-golden-a', 1)).ok).toBe(true)

    expect(h.sections).toHaveLength(1)
    const text = sectionText(h.sections.at(-1))
    expect(text).toBe(APPEND_MARKER)
    // Exactly once: guards against a future double-injection regression.
    expect(occurrences(text, APPEND_MARKER)).toBe(1)
  })

  test('golden (b): agents.resume payload has NO preset key', async () => {
    const h = makeHarness({ presets: { 'm3-05-golden-b': APPEND_SYSTEM_PRESET_ID } })
    expect((await openResume(h, 'm3-05-golden-b', 1)).ok).toBe(true)

    expect(h.resumeOptions).toHaveLength(1)
    const opts = h.resumeOptions[0]!
    expect(opts).not.toHaveProperty('preset')
    expect(opts.agentOptions).not.toHaveProperty('preset')
    // Pre-existing accessors are untouched.
    expect(opts.agentOptions.provider).toBe('fake-provider')
    expect(opts.agentOptions.model).toBe('fake-model')
  })

  test('golden (c): new session and legacy-header resume yield equal section text', async () => {
    const h = makeHarness({ presets: { 'm3-05-golden-c': APPEND_SYSTEM_PRESET_ID } })

    h.send({ id: 1, method: 'session.open', params: { mode: 'new' } })
    expect((await h.waitFor(1)).ok).toBe(true)
    const newText = sectionText(h.sections[0])

    h.send({ id: 2, method: 'session.close', params: {} })
    await h.waitFor(2)

    expect((await openResume(h, 'm3-05-golden-c', 3)).ok).toBe(true)
    const resumeText = sectionText(h.sections[1])
    expect(newText).toBe(APPEND_MARKER)
    expect(resumeText).toBe(newText)
  })

  test('legacy id -> one exact debug line per resume, never warn (no once-per-session Set)', async () => {
    const h = makeHarness({
      presets: { 'm3-05-debug-a': APPEND_SYSTEM_PRESET_ID, 'm3-05-debug-b': APPEND_SYSTEM_PRESET_ID },
    })
    expect((await openResume(h, 'm3-05-debug-a', 1)).ok).toBe(true)
    expect(legacyDebugCount(h)).toBe(1)
    expect(String(h.debugs.at(-1)?.[0])).toBe(EXPECTED_DEBUG)
    expect(migrationWarningCount(h)).toBe(0)

    // Same session re-resume: another debug line (detection is NOT deduped).
    h.send({ id: 2, method: 'session.close', params: {} })
    await h.waitFor(2)
    expect((await openResume(h, 'm3-05-debug-a', 3)).ok).toBe(true)
    expect(legacyDebugCount(h)).toBe(2)

    // A different session likewise gets its own line.
    h.send({ id: 4, method: 'session.close', params: {} })
    await h.waitFor(4)
    expect((await openResume(h, 'm3-05-debug-b', 5)).ok).toBe(true)
    expect(legacyDebugCount(h)).toBe(3)
    expect(migrationWarningCount(h)).toBe(0)
  })

  test('read-only: every open is read; zero append/write calls', async () => {
    const h = makeHarness({ presets: { 'm3-05-readonly': APPEND_SYSTEM_PRESET_ID } })
    expect((await openResume(h, 'm3-05-readonly', 1)).ok).toBe(true)
    expect(h.openCalls.length).toBeGreaterThan(0)
    expect(h.openCalls.every((c) => c.access === 'read')).toBe(true)
    expect(h.appendCalls).toBe(0)
  })

  test('boundary: missing preset field or read failure -> clean miss, section still injects', async () => {
    const h = makeHarness({
      presets: { 'm3-05-no-preset': 'standard' },
      failOpen: ['m3-05-read-fail'],
    })

    expect((await openResume(h, 'm3-05-no-preset', 1)).ok).toBe(true)
    expect(h.resumeOptions[0]!.agentOptions).not.toHaveProperty('preset')
    expect(legacyDebugCount(h)).toBe(0)
    expect(sectionText(h.sections.at(-1))).toBe(APPEND_MARKER)

    h.send({ id: 2, method: 'session.close', params: {} })
    await h.waitFor(2)
    expect((await openResume(h, 'm3-05-read-fail', 3)).ok).toBe(true)
    expect(h.resumeOptions[1]!.agentOptions).not.toHaveProperty('preset')
    expect(legacyDebugCount(h)).toBe(0)
    expect(sectionText(h.sections.at(-1))).toBe(APPEND_MARKER)

    // Detection never blocked either resume, and stayed read-only throughout.
    expect(h.openCalls.every((c) => c.access === 'read')).toBe(true)
    expect(h.appendCalls).toBe(0)
  })

  test('boundary: ctx.get(sessionPersistence) throwing is contained -> resume still succeeds', async () => {
    const h = makeHarness({ throwGetPersistence: true })
    const reply = await openResume(h, 'm3-05-get-throw', 1)
    expect(reply.ok).toBe(true)
    expect(h.resumeOptions[0]!.agentOptions).not.toHaveProperty('preset')
    expect(legacyDebugCount(h)).toBe(0)
    expect(sectionText(h.sections.at(-1))).toBe(APPEND_MARKER)
  })

  test('nested/array preset shape still detected -> debug line, no preset written', async () => {
    const h = makeHarness({
      presets: {
        'm3-05-array': ['ptc', APPEND_SYSTEM_PRESET_ID],
        'm3-05-nested': { agentPreset: { id: APPEND_SYSTEM_PRESET_ID } },
      },
    })
    expect((await openResume(h, 'm3-05-array', 1)).ok).toBe(true)
    expect(legacyDebugCount(h)).toBe(1)
    expect(h.resumeOptions[0]!.agentOptions).not.toHaveProperty('preset')

    h.send({ id: 2, method: 'session.close', params: {} })
    await h.waitFor(2)
    expect((await openResume(h, 'm3-05-nested', 3)).ok).toBe(true)
    expect(legacyDebugCount(h)).toBe(2)
    expect(h.resumeOptions[1]!.agentOptions).not.toHaveProperty('preset')
  })
})
