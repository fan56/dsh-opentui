/**
 * M3-02 — unit tests for the append section registration skeleton.
 *
 * No @deepseek-ai runtime package here: the host contract is already pinned by
 * M3-01's real-package handshake test (system-prompt-section-contract.test.ts).
 * These tests only exercise OUR registration glue: the section arg shape, the
 * effect-held disposer, and the containment/degrade path.
 */
import { describe, expect, test } from 'bun:test'
import { APPEND_SECTION_NAME, registerAppendSection } from '../src/append-section'
import { armAppendSection } from '../src/index'
import type {
  BridgeContext,
  SystemPromptLike,
  SystemPromptSectionLike,
} from '../src/index'

interface EffectCall {
  execute: () => () => void | Promise<void>
  label?: string
}

function makeLogger() {
  const warnings: unknown[][] = []
  const noop = () => {}
  return {
    warnings,
    logger: {
      info: noop,
      warn: (...args: unknown[]) => { warnings.push(args) },
      error: noop,
      debug: noop,
    },
  }
}

/** Fake host systemPrompt: records section specs and dispose calls. */
function makeSystemPrompt() {
  const sections: SystemPromptSectionLike[] = []
  let disposeCalls = 0
  const sp: SystemPromptLike = {
    section(spec: SystemPromptSectionLike) {
      sections.push(spec)
      return () => { disposeCalls += 1 }
    },
  }
  return { sp, sections, disposeCalls: () => disposeCalls }
}

/** Fake ctx with a working ctx.get('systemPrompt') and effect capture. */
function makeCtx(sp: SystemPromptLike, logger: ReturnType<typeof makeLogger>['logger']) {
  const effects: EffectCall[] = []
  const ctx = {
    logger,
    effect(execute: () => () => void | Promise<void>, label?: string) {
      effects.push({ execute, label })
      return {}
    },
    get(name: string) {
      return name === 'systemPrompt' ? sp : undefined
    },
  } as unknown as BridgeContext
  return { ctx, effects }
}

describe('M3-02: registerAppendSection', () => {
  test('registers a section with the pinned arg shape (name/order/text/interpolate)', () => {
    const { logger } = makeLogger()
    const { sp, sections } = makeSystemPrompt()
    const { ctx } = makeCtx(sp, logger)

    const cleanup = registerAppendSection(ctx)

    expect(sections).toHaveLength(1)
    const spec = sections[0]!
    expect(typeof spec.name).toBe('string')
    expect(spec.name.length).toBeGreaterThan(0)
    expect(spec.name.startsWith('dsh-opentui')).toBe(true)
    expect(spec.name).toBe(APPEND_SECTION_NAME)
    expect(spec.order).toBe(200)
    expect(typeof spec.text).toBe('function')
    expect((spec.text as (context: unknown) => string)({})).toBe('')
    expect(spec.interpolate).toBe(false)
    expect(typeof cleanup).toBe('function')
  })

  test('text provider is injectable (M3-03 seam), default is the empty provider', () => {
    const { logger } = makeLogger()
    const { sp, sections } = makeSystemPrompt()
    const { ctx } = makeCtx(sp, logger)
    const provider = () => 'REAL-TEXT-FROM-M3-03'

    registerAppendSection(ctx, { text: provider })
    expect(sections[0]!.text).toBe(provider)
  })

  test('holds the disposer via ctx.effect and the returned cleanup disposes (idempotent)', () => {
    const { logger } = makeLogger()
    const { sp, disposeCalls } = makeSystemPrompt()
    const { ctx, effects } = makeCtx(sp, logger)

    const cleanup = registerAppendSection(ctx)

    expect(effects).toHaveLength(1)
    expect(typeof effects[0]!.execute).toBe('function')
    const heldDisposer = effects[0]!.execute()
    expect(typeof heldDisposer).toBe('function')
    expect(disposeCalls()).toBe(0)

    cleanup()
    expect(disposeCalls()).toBe(1)
    // Both the explicit cleanup and the effect-held disposer are the same
    // idempotent closure: teardown after an explicit cleanup must not double-run.
    cleanup()
    ;(heldDisposer as () => void)()
    expect(disposeCalls()).toBe(1)
  })

  test('falls back to the direct ctx.systemPrompt property when ctx.get is absent', () => {
    const { logger } = makeLogger()
    const { sp, sections } = makeSystemPrompt()
    const ctx = { logger, effect: () => {}, systemPrompt: sp } as unknown as BridgeContext

    expect(() => registerAppendSection(ctx)).not.toThrow()
    expect(sections).toHaveLength(1)
  })

  test('degrades when systemPrompt is missing: no throw, logger warns, no-op cleanup', () => {
    const { logger, warnings } = makeLogger()
    let effectCalls = 0
    const ctx = {
      logger,
      effect: () => { effectCalls += 1 },
      get: () => undefined,
    } as unknown as BridgeContext

    let cleanup!: () => void
    expect(() => { cleanup = registerAppendSection(ctx) }).not.toThrow()
    expect(warnings.length).toBeGreaterThan(0)
    expect(effectCalls).toBe(0)
    expect(typeof cleanup).toBe('function')
    expect(() => cleanup()).not.toThrow()
  })

  test('degrades when ctx.get throws (undeclared cordis inject): plugin stays live', () => {
    const { logger, warnings } = makeLogger()
    const ctx = {
      logger,
      effect: () => { throw new Error('effect must not be reached on degrade') },
      get: () => { throw new Error('cannot get property systemPrompt without inject') },
    } as unknown as BridgeContext

    let cleanup!: () => void
    expect(() => { cleanup = registerAppendSection(ctx) }).not.toThrow()
    expect(warnings.length).toBeGreaterThan(0)
    expect(() => cleanup()).not.toThrow()
  })

  test('index.ts armAppendSection assembly helper delegates to the registration', () => {
    const { logger } = makeLogger()
    const { sp, sections } = makeSystemPrompt()
    const { ctx } = makeCtx(sp, logger)

    const cleanup = armAppendSection(ctx)
    expect(sections).toHaveLength(1)
    expect(sections[0]!.order).toBe(200)
    expect(typeof cleanup).toBe('function')
  })
})
