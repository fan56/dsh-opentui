/**
 * M3-04 — agent-scoped append section registration via `session.open` setup.
 *
 * Drives the real `apply()` over the NDJSON wire with a fake `ctx.agents` whose
 * create/resume CAPTURE and INVOKE the `setup` callback with a distinct fake
 * `agentCtx` (the way the host does, dsh-agent `AgentSetup`). This pins:
 *  - the section lands on the passed agentCtx, never the bridge root ctx;
 *  - order 200 and the effect-held disposer;
 *  - new (create) and resume (resume) paths both carry setup;
 *  - a throw inside setup is contained to logger.warn — session.open still ok;
 *  - the default `shouldSuppress` is false (text provider stays active).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index'
import type { SystemPromptSectionLike } from '../src/index'

const STDIO_SWITCH = 'DSH_OPENTUI_BRIDGE_STDIO'
type Frame = Record<string, any>
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

interface EffectCall {
  execute: () => () => void | Promise<void>
  label?: string
}

/** Fake agent-scoped ctx: records section specs + effect-held disposer. */
interface AgentCtxProbe {
  ctx: any
  sections: SystemPromptSectionLike[]
  effects: EffectCall[]
  disposeCalls: () => number
  throwOnSection: (v: boolean) => void
  throwOnEffect: (v: boolean) => void
}

function makeAgentCtxProbe(warnings: unknown[][]): AgentCtxProbe {
  const sections: SystemPromptSectionLike[] = []
  const effects: EffectCall[] = []
  let disposeCalls = 0
  let throwSection = false
  let throwEffect = false
  const sp = {
    section(spec: SystemPromptSectionLike) {
      if (throwSection) throw new Error('probe: section registration exploded')
      sections.push(spec)
      return () => { disposeCalls += 1 }
    },
  }
  const ctx = {
    logger: {
      info() {},
      warn(...args: unknown[]) { warnings.push(args) },
      error() {},
      debug() {},
    },
    effect(execute: () => () => void | Promise<void>, label?: string) {
      if (throwEffect) throw new Error('probe: effect exploded')
      effects.push({ execute, label })
      return {}
    },
    get(name: string) { return name === 'systemPrompt' ? sp : undefined },
  }
  return {
    ctx,
    sections,
    effects,
    disposeCalls: () => disposeCalls,
    throwOnSection: (v) => { throwSection = v },
    throwOnEffect: (v) => { throwEffect = v },
  }
}

interface Harness {
  frames: string[]
  send(frame: unknown): void
  latest(id: number | string): Frame | undefined
  waitFor(id: number | string): Promise<Frame>
  readonly capturedCreate: Record<string, any> | undefined
  readonly capturedResume: Record<string, any> | undefined
  readonly setupReturns: unknown[]
  readonly agentCtx: AgentCtxProbe
  readonly rootSections: SystemPromptSectionLike[]
  readonly warnings: unknown[][]
}

function makeHarness(): Harness {
  const previousSwitch = process.env[STDIO_SWITCH]
  process.env[STDIO_SWITCH] = '1'

  const originalWrite = process.stdout.write.bind(process.stdout)
  const frames: string[] = []
  const patchedWrite = function (this: unknown, chunk: any, ...rest: any[]) {
    const text = String(chunk)
    frames.push(text)
    let parsed: any
    try {
      parsed = JSON.parse(text.trim())
    } catch {
      /* plain reporter output */
    }
    const isBridgeFrame =
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
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
      stdinListeners[name] = (stdinListeners[name] || []).filter((f) => f !== fn)
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
  const agentCtx = makeAgentCtxProbe(warnings)
  const rootSections: SystemPromptSectionLike[] = []
  const rootSp = {
    section(spec: SystemPromptSectionLike) { rootSections.push(spec); return () => {} },
  }
  let capturedCreate: Record<string, any> | undefined
  let capturedResume: Record<string, any> | undefined
  const setupReturns: unknown[] = []
  const agent = {
    status: 'idle',
    session: { seq: 0 },
    followup() {},
    steer() {},
    cancel() {},
    whenIdle() { return new Promise<void>(() => {}) },
  }
  const agents = {
    async create(options: Record<string, any>) {
      capturedCreate = options
      if (typeof options.setup === 'function') {
        setupReturns.push(await options.setup(agentCtx.ctx, agent))
      }
      return { agent, dispose: async () => {} }
    },
    async resume(options: Record<string, any>) {
      capturedResume = options
      if (typeof options.setup === 'function') {
        setupReturns.push(await options.setup(agentCtx.ctx, agent))
      }
      return { agent, dispose: async () => {} }
    },
    get() { return undefined },
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
      if (name === 'systemPrompt') return rootSp
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
  })

  const latest = (id: number | string): Frame | undefined => {
    for (let i = frames.length - 1; i >= 0; i--) {
      try {
        const frame = JSON.parse(frames[i])
        if (frame !== null && typeof frame === 'object' && frame.id === id) return frame
      } catch {
        /* non-frame stdout noise */
      }
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

  return {
    frames,
    send(frame: unknown) {
      const line = `${JSON.stringify(frame)}\n`
      for (const fn of stdinListeners['data'] || []) fn(line)
    },
    latest,
    waitFor,
    get capturedCreate() { return capturedCreate },
    get capturedResume() { return capturedResume },
    get setupReturns() { return setupReturns },
    get agentCtx() { return agentCtx },
    get rootSections() { return rootSections },
    get warnings() { return warnings },
  }
}

describe('M3-04: append section setup at agent scope', () => {
  test('new path (agents.create): setup registers on the passed agentCtx, not root; order 200; effect-held disposer', async () => {
    const h = makeHarness()
    h.send({ id: 1, method: 'session.open', params: { mode: 'new' } })
    const reply = await h.waitFor(1)

    expect(reply.ok).toBe(true)
    expect(h.capturedCreate).toBeDefined()
    expect(h.capturedResume).toBeUndefined()
    expect(typeof h.capturedCreate!.setup).toBe('function')

    // Scope: registered on the agentCtx passed to setup, never the bridge root ctx.
    expect(h.agentCtx.sections).toHaveLength(1)
    expect(h.rootSections).toHaveLength(0)
    const spec = h.agentCtx.sections[0]!
    expect(spec.name.startsWith('dsh-opentui')).toBe(true)
    expect(spec.order).toBe(200)
    expect(spec.interpolate).toBe(false)
    expect(typeof spec.text).toBe('function')

    // Disposer is held through the agentCtx's effect, not returned to the host.
    expect(h.agentCtx.effects).toHaveLength(1)
    const held = h.agentCtx.effects[0]!.execute()
    expect(typeof held).toBe('function')
    expect(h.agentCtx.disposeCalls()).toBe(0)
    ;(held as () => void)()
    expect(h.agentCtx.disposeCalls()).toBe(1)

    // Host setup contract: the callback returns void (not a disposer/commit).
    expect(h.setupReturns).toEqual([undefined])
  })

  test('resume path (agents.resume): same agent-scoped setup, no create call', async () => {
    const h = makeHarness()
    h.send({ id: 2, method: 'session.open', params: { mode: 'resume', id: 'session-to-resume' } })
    const reply = await h.waitFor(2)

    expect(reply.ok).toBe(true)
    expect(h.capturedResume).toBeDefined()
    expect(h.capturedCreate).toBeUndefined()
    expect(h.capturedResume!.resumeSessionId).toBe('session-to-resume')
    expect(typeof h.capturedResume!.setup).toBe('function')

    expect(h.agentCtx.sections).toHaveLength(1)
    expect(h.agentCtx.sections[0]!.order).toBe(200)
    expect(h.rootSections).toHaveLength(0)
    expect(h.agentCtx.effects).toHaveLength(1)
    expect(h.setupReturns).toEqual([undefined])
  })

  test('containment: a throw inside setup (agentCtx.effect) is warn-only; session.open still succeeds', async () => {
    const h = makeHarness()
    h.agentCtx.throwOnEffect(true)
    h.send({ id: 3, method: 'session.open', params: { mode: 'new' } })
    const reply = await h.waitFor(3)

    expect(reply.ok).toBe(true)
    expect(h.setupReturns).toEqual([undefined])
    expect(
      h.warnings.some((w) => String(w[0]).includes('append section setup failed')),
    ).toBe(true)
  })

  test('containment: a throwing systemPrompt.section degrades inside registerAppendSection; session.open still succeeds', async () => {
    const h = makeHarness()
    h.agentCtx.throwOnSection(true)
    h.send({ id: 4, method: 'session.open', params: { mode: 'new' } })
    const reply = await h.waitFor(4)

    expect(reply.ok).toBe(true)
    expect(h.setupReturns).toEqual([undefined])
    expect(
      h.warnings.some((w) => String(w[0]).includes('append section registration contained')),
    ).toBe(true)
  })

  test('default shouldSuppress is false: the section text provider stays active', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-m3-04-'))
    const file = join(tmp, 'APPEND_SYSTEM.md')
    writeFileSync(file, 'M3-04-APPEND-BODY')
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = tmp
    try {
      const h = makeHarness()
      h.send({ id: 5, method: 'session.open', params: { mode: 'new' } })
      const reply = await h.waitFor(5)

      expect(reply.ok).toBe(true)
      const spec = h.agentCtx.sections[0]!
      // A default-true shouldSuppress would return '' (no disk read).
      expect((spec.text as (context: unknown) => string)({})).toBe('M3-04-APPEND-BODY')
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      unlinkSync(file)
      rmdirSync(tmp)
    }
  })
})
