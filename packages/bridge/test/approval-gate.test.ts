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
  createPreExecuteListener,
  decideAsk,
  resolveApprovalGateConfig,
} from '../src/approval-gate'

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
