/**
 * Pre-execute approval gate — policy / shape / override / empty-policy tests.
 *
 * Pure logic tests: the gate module imports no host package and exports its
 * decision helpers, so no cordis instance is needed. The listener's next()
 * delegation is exercised with a fake `next` returning a plain allow.
 */
import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_GATE_REASON,
  WRITE_TOOL_POLICY,
  apply,
  createPreExecuteListener,
  decideAsk,
  resolveApprovalGateConfig,
} from '../src/approval-gate'
import type { GateExecLike } from '../src/approval-gate'

const allow = () => Promise.resolve({ kind: 'allow' as const })

describe('approval gate: policy hit / pass-through', () => {
  const config = resolveApprovalGateConfig({
    enabled: true,
    reason: 'custom reason',
    tools: { bash: 'ask', write: 'ask', edit: 'ask', apply_patch: 'ask' },
  })

  test('write tools hit: bash, write, edit, apply_patch each return ask', () => {
    for (const name of ['bash', 'write', 'edit', 'apply_patch']) {
      const d = decideAsk({ name }, config)
      expect(d).toBeDefined()
      expect(d?.kind).toBe('ask')
      expect(d?.reason).toBe('custom reason')
    }
  })

  test('read-only tools pass: read / search / view are undefined', () => {
    for (const name of ['read', 'search', 'view', 'glob', 'grep']) {
      expect(decideAsk({ name }, config)).toBeUndefined()
    }
  })

  test('an unlisted tool passes even when it resembles a write tool', () => {
    expect(decideAsk({ name: 'bash_something' }, config)).toBeUndefined()
  })

  test('missing / non-string exec.name passes (never asks on malformed input)', () => {
    expect(decideAsk({}, config)).toBeUndefined()
    expect(decideAsk({ name: 42 }, config)).toBeUndefined()
    expect(decideAsk(null, config)).toBeUndefined()
    expect(decideAsk(undefined, config)).toBeUndefined()
  })
})

describe('approval gate: return shape', () => {
  test('ask decision carries kind+reason and optional displayReason only when configured', () => {
    const bare = resolveApprovalGateConfig({ tools: { bash: 'ask' } })
    expect(decideAsk({ name: 'bash' }, bare)).toEqual({
      kind: 'ask',
      reason: DEFAULT_GATE_REASON,
    })

    const localized = resolveApprovalGateConfig({
      tools: { bash: 'ask' },
      displayReason: { en: 'Approve bash?', zh: '批准 bash？', bad: 3 },
    })
    const d = decideAsk({ name: 'bash' }, localized)
    expect(d?.kind).toBe('ask')
    expect(d?.displayReason?.en).toBe('Approve bash?')
    expect(d?.displayReason?.zh).toBe('批准 bash？')
    expect((d?.displayReason as Record<string, unknown>)?.bad).toBeUndefined()
  })

  test('listener returns a Promise resolving to the ask decision (never calls next on a hit)', () => {
    const config = resolveApprovalGateConfig({ tools: { bash: 'ask' }, reason: 'r' })
    const listener = createPreExecuteListener(config)
    let nextCalls = 0
    const result = listener({ name: 'bash' }, () => {
      nextCalls += 1
      return allow()
    })
    expect(result).toBeInstanceOf(Promise)
    return result.then((decision) => {
      expect(decision).toEqual({ kind: 'ask', reason: 'r' })
      expect(nextCalls).toBe(0)
    })
  })

  test('listener delegates to next() verbatim on a pass', () => {
    const config = resolveApprovalGateConfig({ tools: { bash: 'ask' } })
    const listener = createPreExecuteListener(config)
    const sentinel = Promise.resolve({ kind: 'deny' as const, reason: 'from next' })
    const result = listener({ name: 'read' }, () => sentinel)
    expect(result).toBe(sentinel)
  })
})

describe('approval gate: config override', () => {
  test('patch tools override the shipped write policy table', () => {
    const defaultCfg = resolveApprovalGateConfig({ tools: WRITE_TOOL_POLICY })
    const narrowed = resolveApprovalGateConfig({ tools: { custom_tool: 'ask' }, reason: 'narrow' })

    expect(decideAsk({ name: 'bash' }, defaultCfg)?.kind).toBe('ask')
    expect(decideAsk({ name: 'custom_tool' }, defaultCfg)).toBeUndefined()
    expect(decideAsk({ name: 'custom_tool' }, narrowed)?.kind).toBe('ask')
    expect(decideAsk({ name: 'bash' }, narrowed)).toBeUndefined()
    expect(narrowed.reason).toBe('narrow')
  })

  test('only the literal "ask" directive triggers; other directives are ignored', () => {
    const cfg = resolveApprovalGateConfig({ tools: { a: 'ask', b: 'deny', c: 'allow', d: 1 } })
    expect(decideAsk({ name: 'a' }, cfg)?.kind).toBe('ask')
    expect(decideAsk({ name: 'b' }, cfg)).toBeUndefined()
    expect(decideAsk({ name: 'c' }, cfg)).toBeUndefined()
    expect(decideAsk({ name: 'd' }, cfg)).toBeUndefined()
  })

  test('enabled:false passes everything even with a populated policy', () => {
    const cfg = resolveApprovalGateConfig({ enabled: false, tools: { bash: 'ask' } })
    expect(decideAsk({ name: 'bash' }, cfg)).toBeUndefined()
  })
})

describe('approval gate: empty policy = all pass (explicit)', () => {
  test('tools:{} asks for nothing, for any tool name', async () => {
    const cfg = resolveApprovalGateConfig({ tools: {} })
    expect(Object.keys(cfg.tools)).toHaveLength(0)
    for (const name of ['bash', 'write', 'edit', 'apply_patch', 'read']) {
      expect(decideAsk({ name }, cfg)).toBeUndefined()
    }
    const listener = createPreExecuteListener(cfg)
    let nextCalls = 0
    for (const name of ['bash', 'write', 'read']) {
      await listener({ name }, () => {
        nextCalls += 1
        return allow()
      })
    }
    expect(nextCalls).toBe(3)
  })

  test('missing config / malformed tools is fail-soft: all pass', () => {
    // Non-object configs are treated as disabled outright.
    for (const raw of [undefined, null, 'nope', 42, []]) {
      const cfg = resolveApprovalGateConfig(raw)
      expect(cfg.enabled).toBe(false)
      expect(Object.keys(cfg.tools)).toHaveLength(0)
      expect(decideAsk({ name: 'bash' }, cfg)).toBeUndefined()
    }
    // Object configs with a malformed `tools` field still normalize to an
    // empty policy, so no tool is ever asked about (even though enabled=true).
    for (const raw of [{ tools: 'bash' }, { tools: [1, 2] }, {}]) {
      const cfg = resolveApprovalGateConfig(raw)
      expect(Object.keys(cfg.tools)).toHaveLength(0)
      expect(decideAsk({ name: 'bash' }, cfg)).toBeUndefined()
    }
  })
})

/**
 * Listener-layer policy bypass. These drive the real `apply(ctx) →
 * ctx.on('tools/pre-execute')` registration with a fake cordis ctx whose `get`
 * serves the approval service — the seam the research confirmed exists at
 * runtime. Every uncertain path must fall back to today's behaviour (ask).
 */
describe('approval gate: listener policy bypass (session effective policy)', () => {
  type Listener = (exec: GateExecLike, next: () => Promise<{ kind: 'allow' }>) => Promise<unknown>

  function makeGateListener(options: {
    getApproval?: () => unknown
    noGet?: boolean
    getThrows?: boolean
  } = {}) {
    const listeners = new Map<string, Listener>()
    const infoLogs: string[] = []
    const debugLogs: string[] = []
    const format = (fmt: unknown, params: unknown[]) => {
      let text = String(fmt)
      for (const param of params) text = text.replace('%s', String(param))
      return text
    }
    const ctx: any = {
      logger: {
        info(fmt: unknown, ...params: unknown[]) { infoLogs.push(format(fmt, params)) },
        warn() {},
        debug(fmt: unknown, ...params: unknown[]) { debugLogs.push(format(fmt, params)) },
      },
      on(name: string, listener: Listener) {
        listeners.set(name, listener)
        return () => {}
      },
      effect(execute: () => () => void) { return execute() },
    }
    if (!options.noGet) {
      ctx.get = (name: string) => {
        if (options.getThrows) throw new Error('ctx.get failed')
        return name === 'approval' ? options.getApproval?.() : undefined
      }
    }
    apply(ctx, { enabled: true, reason: 'r', tools: { bash: 'ask', write: 'ask' } })
    const listener = listeners.get('tools/pre-execute')
    if (listener === undefined) throw new Error('gate did not register tools/pre-execute')
    return { listener, infoLogs, debugLogs }
  }

  const execWithSession = (name: string, sessionId = 'sess-1'): GateExecLike => ({
    name,
    agent: { session: { id: sessionId } },
  })

  async function run(listener: Listener, exec: GateExecLike) {
    let nextCalls = 0
    const decision = await listener(exec, () => {
      nextCalls += 1
      return allow()
    })
    return { decision, nextCalls }
  }

  test('effectivePolicy=never → next() passes the write with no ask, debug logged (not info)', async () => {
    const { listener, infoLogs, debugLogs } = makeGateListener({
      getApproval: () => ({ effectivePolicy: () => 'never' }),
    })
    const { decision, nextCalls } = await run(listener, execWithSession('bash'))
    expect(decision).toEqual({ kind: 'allow' })
    expect(nextCalls).toBe(1)
    expect(debugLogs.some((line) => line.includes(
      'policy bypass: bash passes without ask (session sess-1 effective policy never)',
    ))).toBe(true)
    expect(infoLogs.some((line) => line.includes('policy bypass'))).toBe(false)
  })

  test('effectivePolicy=ask → still emits ask (no bypass)', async () => {
    const { listener } = makeGateListener({
      getApproval: () => ({ effectivePolicy: () => 'ask' }),
    })
    const { decision, nextCalls } = await run(listener, execWithSession('bash'))
    expect(decision).toEqual({ kind: 'ask', reason: 'r' })
    expect(nextCalls).toBe(0)
  })

  test('exec without agent.session → still emits ask', async () => {
    const { listener } = makeGateListener({
      getApproval: () => ({ effectivePolicy: () => 'never' }),
    })
    const { decision, nextCalls } = await run(listener, { name: 'bash' })
    expect((decision as { kind: string }).kind).toBe('ask')
    expect(nextCalls).toBe(0)
  })

  test('approval service missing → still emits ask', async () => {
    const { listener } = makeGateListener()
    const { decision, nextCalls } = await run(listener, execWithSession('bash'))
    expect((decision as { kind: string }).kind).toBe('ask')
    expect(nextCalls).toBe(0)
  })

  test('effectivePolicy throwing → still emits ask (contained)', async () => {
    const { listener } = makeGateListener({
      getApproval: () => ({
        effectivePolicy() { throw new Error('projection not ready') },
      }),
    })
    const { decision, nextCalls } = await run(listener, execWithSession('bash'))
    expect((decision as { kind: string }).kind).toBe('ask')
    expect(nextCalls).toBe(0)
  })

  test('ctx.get absent → still emits ask', async () => {
    const { listener } = makeGateListener({ noGet: true })
    const { decision, nextCalls } = await run(listener, execWithSession('bash'))
    expect((decision as { kind: string }).kind).toBe('ask')
    expect(nextCalls).toBe(0)
  })

  test('ctx.get throwing → lookup contained, still emits ask', async () => {
    const { listener } = makeGateListener({ getThrows: true })
    const { decision, nextCalls } = await run(listener, execWithSession('bash'))
    expect((decision as { kind: string }).kind).toBe('ask')
    expect(nextCalls).toBe(0)
  })

  test('approval resolved per call: a service loaded after apply is observed', async () => {
    let approval: unknown = undefined
    const { listener } = makeGateListener({ getApproval: () => approval })
    const first = await run(listener, execWithSession('bash'))
    expect((first.decision as { kind: string }).kind).toBe('ask')
    approval = { effectivePolicy: () => 'never' }
    const second = await run(listener, execWithSession('bash'))
    expect(second.decision).toEqual({ kind: 'allow' })
    expect(second.nextCalls).toBe(1)
  })
})
