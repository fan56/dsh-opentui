/**
 * F1 (c) verification — REAL-PACKAGE evidence for the `session/event` firehose.
 *
 * Imports the actual `@deepseek-ai/cordis` + `@deepseek-ai/dsh-scope` (the same
 * versions the bridge declares as devDeps) and reproduces the host's exact
 * dispatch shape from `dsh-session/lib/index.js`:
 *   - `commit()` / `appendBatch()` publish via
 *     `collectSessionCallbacks(entry.emitCtx, [entry.carrier, 'session/event', session, event])`
 *     → `ctx.events.emit(carrier, 'session/event', session, event)`;
 *   - `entry.carrier = scopeTarget(session, scopeOf(store.ctx))` (`SessionStore.enter`, :1947);
 *   - `entry.emitCtx = this.ctx` — the STORE's ctx (`:1950`), so every live append
 *     on any session in that store publishes through the same ctx event bus.
 *
 * `dsh-scope` `scopeTarget` docs (lib/types/index.d.ts:88-97): an UNTAGGED listener
 * is admitted globally; a listener in an enclosing scope receives every
 * descendant scope's events; a tag BELOW the dispatch key stays excluded —
 * "events flow up the chain, never down". The bridge subscribes with a plain
 * root `ctx.on('session/event', ...)`, i.e. UNTAGGED, so it sees every session's
 * live events on the bus — including subagent child sessions.
 *
 * This file is test-only. No product src, no dist bundle change, no host package
 * in the shipped artifact.
 */
import { describe, expect, test } from 'bun:test'
import { Context } from '@deepseek-ai/cordis'
import { bindScopeParent, createScope, scopeOf, scopeTarget } from '@deepseek-ai/dsh-scope'

/** Reproduce dsh-session's publish: emit on `storeCtx` with a session-scoped carrier. */
function publish(storeCtx: Context, session: { id: string }, event: { type: string; data?: Record<string, unknown> }): void {
  const carrier = scopeTarget(session, scopeOf(storeCtx))
  storeCtx.events.emit(carrier, 'session/event', session, event)
}

describe('F1 (c) — session/event firehose scope evidence', () => {
  test('an unscoped (bridge-style) root listener receives parent AND child session events', () => {
    const root = new Context()
    const parentKey = {}
    const childKey = {}
    const siblingKey = {}
    bindScopeParent(childKey, parentKey)
    bindScopeParent(siblingKey, parentKey)

    const storeCtx = createScope(root, parentKey).ctx
    createScope(root, childKey)
    createScope(root, siblingKey)

    const rootSeen: string[] = []
    root.on('session/event', (session: { id: string }, event: { type: string }) => {
      rootSeen.push(`${session.id}:${event.type}`)
    })

    const parent = { id: 'parent-session' }
    const child = { id: 'child-session' }
    // Host fact: parent + child live in one SessionStore, so BOTH publish on the
    // same `emitCtx` (SessionStore.enter :1950). Child scope is a descendant of
    // the store scope; the root listener is untagged.
    publish(storeCtx, parent, { type: 'approval/policy', data: { policy: 'ask' } })
    publish(storeCtx, child, { type: 'approval/policy', data: { policy: 'never', source: 'delegation' } })

    expect(rootSeen).toContain('parent-session:approval/policy')
    expect(rootSeen).toContain('child-session:approval/policy')
  })

  test('scope is one-way: a sibling-scope listener never sees another branch\'s events', () => {
    const root = new Context()
    const parentKey = {}
    const childKey = {}
    const siblingKey = {}
    bindScopeParent(childKey, parentKey)
    bindScopeParent(siblingKey, parentKey)

    const parentStoreCtx = createScope(root, parentKey).ctx
    const siblingCtx = createScope(root, siblingKey).ctx

    const siblingSeen: string[] = []
    siblingCtx.on('session/event', (session: { id: string }) => siblingSeen.push(session.id))

    publish(parentStoreCtx, { id: 'child-of-parent' }, { type: 'approval/policy' })
    expect(siblingSeen).toEqual([])
  })

  test('host forbids reentrant append from inside that session\'s own session/event listener', () => {
    const root = new Context()
    const sessions = new Map<string, { appended: string[]; appending: boolean; id: string }>()
    const makeSession = (id: string) => {
      const s = {
        id,
        appended: [] as string[],
        appending: false,
        append(type: string) {
          // Mirrors dsh-session publicationEntry(): throw while a publish is in flight.
          if (s.appending) throw new Error('session append cannot reenter while another append is being published')
          s.appending = true
          try {
            publish(root, s, { type })
            s.appended.push(type)
          } finally {
            s.appending = false
          }
        },
      }
      sessions.set(id, s)
      return s
    }
    const child = makeSession('child-session')

    let syncErr: string | undefined
    let deferredErr: string | undefined
    root.on('session/event', (session: { id: string }, event: { type: string }) => {
      if (session.id !== 'child-session' || event.type !== 'approval/policy') return
      try { child.append('ask-sync') } catch (err) { syncErr = String(err) }
      queueMicrotask(() => {
        try { child.append('ask-sync-deferred') } catch (err) { deferredErr = String(err) }
      })
    })

    child.append('approval/policy')
    expect(syncErr).toContain('cannot reenter')
    expect(deferredErr).toBeUndefined()
    // await the queued microtask, then assert the deferred append landed
    return Promise.resolve().then(() => {
      expect(child.appended).toEqual(['approval/policy', 'ask-sync-deferred'])
    })
  })
})
