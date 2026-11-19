/**
 * M3-01 — handshake test pinning the host `systemPrompt.section` contract.
 *
 * This is a REAL-PACKAGE test: it imports the actual `@deepseek-ai/dsh-system-prompt`
 * (0.2.2-rc.3), plus the real `@deepseek-ai/cordis` and `@deepseek-ai/dsh-scope`
 * it needs to build a scoped context. No fake, no re-implementation of host
 * behaviour — every assertion below runs against the host's compiled lib.
 *
 * Host source mapping (paths are inside the 0.2.2-rc.3 package, `src/index.ts`
 * unless noted; every cited line was read before writing this test):
 *   - contract (a) `order: 200` is a literal:
 *       SECTION_ORDERS (no 200) ................................ :136-166
 *       getSectionOrder(name: keyof SECTION_ORDERS) ........... :501-503
 *       PromptSection.order doc / Number.isFinite guard ....... :57, :485-488
 *   - contract (b) equal order -> code-unit name tie-break:
 *       compareNames (a < b, plain UTF-16 code units) ......... :250-252
 *       comparePromptSections (order || name) ................. :255-257
 *   - contract (c) scoped section shadows global same name:
 *       section() doc: "scoped section shadows a global section
 *       with the same name" .................................... :478-481
 *       duplicate-in-one-layer error (per-agent override hint)  :414-417
 *       assemble() merge(scope) + sort ......................... :635, :651
 *       ScopedLayers.merge / effect ........... dsh-scope/src/store.ts :205-245
 *
 * Product-code discipline: this file lives in test/ only. It adds dev-only
 * deps to packages/bridge/package.json; it does NOT change any product src and
 * does NOT put any @deepseek-ai package into a dist bundle.
 */
import { describe, expect, test } from 'bun:test'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'

/** Names of every centrally allocated section order (host src/index.ts:136-166). */
const SECTION_ORDER_NAMES = [
  'HARNESS_IDENTITY', 'DEPLOYMENT_PERSONA_PREFIX', 'PLAN_POLICY', 'TEAM_POLICY',
  'PTC_ONLY', 'FILE_REFERENCE', 'TOOL_BASH', 'TOOL_PWSH', 'TOOL_READ', 'TOOL_WRITE',
  'TOOL_EDIT', 'TOOL_APPLY_PATCH', 'TOOL_GLOB', 'TOOL_GREP', 'TOOL_JOBS', 'TOOL_PTY',
  'TOOL_PTY_PANEL', 'TOOL_WEB_SEARCH', 'TOOL_WEB_FETCH', 'TOOL_LSP', 'TOOL_SESSION_QUERY',
  'TOOL_GOAL', 'TOOL_SCHEDULE', 'TOOL_WORKFLOW', 'TOOL_RALPH', 'TOOL_SUBAGENT', 'TOOL_REPORT',
  'TOOL_COMPUTER_USE', 'MCP_SERVERS', 'TOOLS_SDK', 'DELIVERABLE_FILE_REFERENCES',
  'STRUCTURED_OUTPUT', 'HARNESS_SOURCE', 'WEB_SURFACE', 'DEPLOYMENT_PERSONA_SUFFIX',
] as const

/** Fresh real host registry with a quiet baseline (only empty persona slots remain). */
function freshPrompt(): { ctx: Context; sp: InstanceType<typeof SystemPrompt> } {
  const ctx = new Context()
  const sp = new SystemPrompt(ctx, {
    includeHarnessIdentity: false,
    includeRuntimeContext: false,
    personaPrefix: '',
    personaSuffix: '',
  })
  return { ctx, sp }
}

describe('M3-01: host systemPrompt.section contract handshake (real package)', () => {
  test('(a) order 200 is a literal: no named order equals 200, and literal 200 registers', () => {
    const { sp } = freshPrompt()

    // Every value reachable through getSectionOrder(keyof SECTION_ORDERS) is
    // enumerated; none of them is 200 (host src/index.ts:136-166, :501-503).
    const namedOrders = SECTION_ORDER_NAMES.map((name) => sp.getSectionOrder(name))
    expect(namedOrders).toHaveLength(35)
    expect(namedOrders).not.toContain(200)

    // There is no named key a caller could pass to resolve 200 — at runtime the
    // lookup is undefined, and in TS `getSectionOrder(200)` is a type error
    // because the parameter is keyof SECTION_ORDERS (host :501-503).
    expect((sp as unknown as { getSectionOrder(n: number): number | undefined })
      .getSectionOrder(200)).toBeUndefined()

    // The only way to place a section at 200 is the literal, which the finite
    // number guard accepts (host :57, :485-488) and yields a real disposer.
    const dispose = sp.section({ name: 'm3:literal-200', order: 200, text: 'x' })
    expect(typeof dispose).toBe('function')
    dispose()
  })

  test('(b) two sections at order 200 sort by code-unit name, not registration order', async () => {
    const { sp } = freshPrompt()

    // Register Z before a. Code-unit order puts 'Z' (0x5A) before 'a' (0x61);
    // a locale-aware sort would put 'a' first, so this pins the exact rule.
    sp.section({ name: 'm3:Z', order: 200, text: 'Z-text' })
    sp.section({ name: 'm3:a', order: 200, text: 'a-text' })
    sp.section({ name: 'm3:B', order: 200, text: 'B-text' })

    const assembly = await sp.assemble()
    const at = (name: string): number => assembly.sections.findIndex((s) => s.name === name)

    expect(at('m3:B')).toBeGreaterThanOrEqual(0)
    expect(at('m3:Z')).toBeGreaterThanOrEqual(0)
    expect(at('m3:a')).toBeGreaterThanOrEqual(0)
    // B (0x42) < Z (0x5A) < a (0x61) — plain UTF-16 code-unit ascending.
    expect(at('m3:B')).toBeLessThan(at('m3:Z'))
    expect(at('m3:Z')).toBeLessThan(at('m3:a'))

    // All three share order 200; the tie-break alone produced this sequence.
    const slice = assembly.sections.filter((s) => s.name.startsWith('m3:'))
    expect(slice.map((s) => s.name)).toEqual(['m3:B', 'm3:Z', 'm3:a'])
  })

  test('(c) a scoped section with the same name shadows the global one (replace, not stack)', async () => {
    const { ctx, sp } = freshPrompt()

    sp.section({ name: 'dup:section', order: 200, text: 'GLOBAL' })

    const scopeKey = {}
    const scope = createScope(ctx, scopeKey)
    // Registering through the scoped ctx puts the section in the scoped layer
    // (dsh-scope store.ts:226-245), so it shadows the global same-name entry
    // at assembly time (host :478-481, :635).
    ;(scope.ctx as unknown as { systemPrompt: typeof sp }).systemPrompt.section({
      name: 'dup:section', order: 200, text: 'SCOPED',
    })

    const scopedAssembly = await sp.assemble({ scope: scopeKey })
    const scopedDup = scopedAssembly.sections.filter((s) => s.name === 'dup:section')
    expect(scopedDup).toHaveLength(1)
    expect(scopedDup[0]!.text).toBe('SCOPED')

    // The global view is unchanged: shadowing is a view-local replacement,
    // not a mutation of the global layer and not an appended second section.
    const globalAssembly = await sp.assemble()
    const globalDup = globalAssembly.sections.filter((s) => s.name === 'dup:section')
    expect(globalDup).toHaveLength(1)
    expect(globalDup[0]!.text).toBe('GLOBAL')
  })
})
