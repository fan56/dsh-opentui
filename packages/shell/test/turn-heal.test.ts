// Batch B turn-end renderer heal, DETECTION half: threshold logic unit
// tests. The shipped heal action is a deliberate no-op (the suspend/
// resume API bounce was falsified by the live repro — it froze the
// client); here the churn counter, thresholds, one-heal-per-turn,
// newer-turn voiding and the no-op default are exercised against fakes.
import { describe, expect, test } from 'bun:test'
import {
  createTurnHeal,
  DEFAULT_HEAL_THRESHOLDS,
  type TurnHealState,
} from '../src/client/turn-heal.ts'
import type { ShellSessionSurface } from '../src/client/shell-session.ts'
import type { TurnCallbacks } from '../src/agent/loop.ts'

// ---------------------------------------------------------------------------
// Fakes.
// ---------------------------------------------------------------------------

/** Minimal session fake: only the members the wrapper + tests touch. */
function fakeSession(runTurn?: (text: string, cb: TurnCallbacks) => Promise<void>): ShellSessionSurface {
  return {
    label: 'dsh-host',
    turn: async (text: string, cb: TurnCallbacks) => {
      await runTurn?.(text, cb)
    },
    configLoad: () => ({}),
  } as unknown as ShellSessionSurface
}

const noCallbacks = (): TurnCallbacks => ({
  onThinkingDelta: () => {},
  onContentDelta: () => {},
  onTurnEnd: () => {},
  onApprove: async () => true,
  onToolRun: () => {},
  onError: () => {},
})

interface Harness {
  session: ShellSessionSurface
  state: TurnHealState
  heals: number
}

/** Build the wrapped surface with a recording heal. */
function makeHealed(
  raw: ShellSessionSurface,
  opts: { settleMs?: number; now?: () => number; heal?: (() => Promise<void>) | null } = {},
): Harness {
  const h: Harness = { session: null as unknown as ShellSessionSurface, state: null as unknown as TurnHealState, heals: 0 }
  h.session = createTurnHeal(raw, {
    settleMs: opts.settleMs ?? 10,
    ...(opts.now ? { now: opts.now } : {}),
    heal: opts.heal !== undefined ? opts.heal : () => async () => {
      h.heals += 1
    },
  })
  h.state = (h.session as unknown as { turnHealState: TurnHealState }).turnHealState
  return h
}

// ---------------------------------------------------------------------------
// Threshold tests.
// ---------------------------------------------------------------------------

describe('createTurnHeal', () => {
  test('short turn never trips: no heal, no flash', async () => {
    const raw = fakeSession(async (_t, cb) => {
      cb.onContentDelta('a short reply')
      cb.onTurnEnd({ prompt: 10, completion: 13 })
    })
    const h = makeHealed(raw)
    await h.session.turn('q', noCallbacks())
    await new Promise((r) => setTimeout(r, 30))
    expect(h.heals).toBe(0)
    expect(h.state.tripped).toBe(0)
    expect(h.state.chars).toBe(13) // "a short reply".length
  })

  test('long turn by streamed chars trips exactly one deferred heal', async () => {
    const raw = fakeSession(async (_t, cb) => {
      cb.onContentDelta('x'.repeat(2_500)) // > maxChars (2000)
      cb.onTurnEnd({ prompt: 1, completion: 2_500 })
    })
    const h = makeHealed(raw)
    await h.session.turn('q', noCallbacks())
    await new Promise((r) => setTimeout(r, 40))
    expect(h.state.tripped).toBe(1)
    expect(h.heals).toBe(1)
  })

  test('long turn by delta count trips (>maxDeltas small deltas)', async () => {
    const raw = fakeSession(async (_t, cb) => {
      for (let i = 0; i < 450; i++) cb.onContentDelta('ab') // 900 chars < 2000
      cb.onTurnEnd({ prompt: 1, completion: 900 })
    })
    const h = makeHealed(raw)
    await h.session.turn('q', noCallbacks())
    await new Promise((r) => setTimeout(r, 40))
    expect(h.state.tripped).toBe(1)
    expect(h.heals).toBe(1)
  })

  test('long turn by streaming seconds trips even with few chars', async () => {
    let clock = 0
    const raw = fakeSession(async (_t, cb) => {
      clock += 121_000 // 121s of streaming, 30 chars total
      cb.onContentDelta('x'.repeat(30))
      cb.onTurnEnd({ prompt: 1, completion: 30 })
    })
    const h = makeHealed(raw, { now: () => clock })
    await h.session.turn('q', noCallbacks())
    await new Promise((r) => setTimeout(r, 40))
    expect(h.state.tripped).toBe(1)
    expect(h.heals).toBe(1)
  })

  test('turn ending without onTurnEnd (error path) still settles the heal', async () => {
    const raw = fakeSession(async (_t, cb) => {
      cb.onContentDelta('x'.repeat(2_500))
      throw new Error('stream died')
    })
    const h = makeHealed(raw)
    await h.session.turn('q', noCallbacks()).catch(() => {}) // rejection swallowed by caller
    await new Promise((r) => setTimeout(r, 40))
    expect(h.heals).toBe(1)
  })

  test('a newer turn voids the pending heal (no terminal bounce mid-turn)', async () => {
    let releaseSecond!: () => void
    const gate = new Promise<void>((r) => {
      releaseSecond = r
    })
    let firstEnded = false
    const raw = fakeSession(async (text, cb) => {
      if (text === 'long-one') {
        cb.onContentDelta('x'.repeat(2_500))
        cb.onTurnEnd({ prompt: 1, completion: 2_500 })
        firstEnded = true
        await gate // stay "settling" while the second turn starts
      }
    })
    const h = makeHealed(raw, { settleMs: 15 })
    const first = h.session.turn('long-one', noCallbacks())
    await new Promise((r) => {
      const poll = () => (firstEnded ? r(null) : setTimeout(poll, 2))
      poll()
    })
    // second turn starts BEFORE the first turn's settle window expires
    await h.session.turn('quick', noCallbacks())
    releaseSecond()
    await first
    await new Promise((r) => setTimeout(r, 60))
    expect(h.state.tripped).toBe(1) // tripped, but...
    expect(h.heals).toBe(0) // ...voided by the newer turn
  })

  test('heal === null (renderer not ready) is a clean no-op', async () => {
    const raw = fakeSession(async (_t, cb) => {
      cb.onContentDelta('x'.repeat(2_500))
      cb.onTurnEnd({ prompt: 1, completion: 2_500 })
    })
    const h = makeHealed(raw, { heal: null })
    await h.session.turn('q', noCallbacks())
    await new Promise((r) => setTimeout(r, 40))
    expect(h.state.tripped).toBe(1)
    expect(h.state.healsRun).toBe(0)
    expect(h.heals).toBe(0)
  })

  test('rejecting heal does not escape the wrapper', async () => {
    const raw = fakeSession(async (_t, cb) => {
      cb.onContentDelta('x'.repeat(2_500))
      cb.onTurnEnd({ prompt: 1, completion: 2_500 })
    })
    const h = makeHealed(raw, { heal: () => async () => Promise.reject(new Error('bounce failed')) })
    await h.session.turn('q', noCallbacks())
    await new Promise((r) => setTimeout(r, 40))
    expect(h.state.healsRun).toBe(1) // attempted, failure logged, no throw
  })

  test('wrapped surface stays ShellSessionSurface-shaped (Proxy pass-through)', async () => {
    const raw = fakeSession()
    const h = makeHealed(raw)
    expect(h.session.label).toBe('dsh-host')
    expect(h.session.configLoad()).toEqual({})
    expect(h.session.turn).not.toBe(raw.turn)
  })

  test('default thresholds match the repro tuning', () => {
    expect(DEFAULT_HEAL_THRESHOLDS).toEqual({ maxChars: 2_000, maxDeltas: 400, maxSecs: 120 })
  })
})

describe('createTerminalBounceHeal', () => {
  // Removed with the falsified bounce: the live tear repro froze the
  // client (suspend halts the render loop; its native transition never
  // completes in this configuration, so resume is impossible). See the
  // client/turn-heal.ts header for the evidence.
})
