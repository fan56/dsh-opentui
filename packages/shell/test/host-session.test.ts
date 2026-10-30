// HostSession idle-release contract (the lock half of the takeover story):
// an idle TUI must not hold the kernel write lease forever — the phone's
// /resume degrades to a read-only watch against whoever holds it. After the
// configured quiet window the handle is disposed; the next send re-attaches
// the SAME session id and folds in the durable rows other surfaces wrote
// meanwhile. abort() still means "/new semantics" (fresh id), and an
// explicit resume keeps winning over the reattach.
import { describe, expect, test } from "bun:test"
import { HostSession } from "../src/host-session.ts"
import type { TurnCallbacks } from "../src/agent/loop.ts"

type Handler = (payload: any) => void

/** Durable events of a session that lived before the release and gained two
 * more rows (from the phone) while the TUI slept. */
const PERSISTED = [
  { type: "session", id: "s1" },
  { type: "user/message", seq: 0, data: { source: { kind: "user" }, content: [{ type: "text", text: "early question" }] } },
  { type: "assistant/message", seq: 1, data: { message: { content: [{ type: "text", text: "early answer" }] } } },
  { type: "user/message", seq: 2, data: { source: { kind: "user" }, content: [{ type: "text", text: "phone follow-up" }] } },
  { type: "assistant/message", seq: 3, data: { message: { content: [{ type: "text", text: "phone answer" }] } } },
]
/** What the TUI had seen when it released: turn 1 completed (its answer
 * included) — the wake diff base is a natural turn boundary. */
const SNAPSHOT = PERSISTED.slice(0, 3)

function makeCtx() {
  const handlers = new Map<string, Handler[]>()
  const creates: { sessionId: string; meta: any; agentOptions: any }[] = []
  let failNextCreateWith: string | undefined
  const handles: { disposed: boolean; agent: any }[] = []
  let agentSeq = 0
  const ctx: any = {
    on(event: string, handler: Handler) {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
    },
    get(key: string) {
      if (key === "sessionPersistence") {
        return {
          list: async () => [],
          open: async (_id: string, _mode: string) => ({
            read: async (offset: number) => (offset < PERSISTED.length ? { events: PERSISTED.slice(offset) } : { events: [] }),
            close: async () => {},
          }),
        }
      }
      return undefined
    },
    agents: {
      async create(options: any) {
        creates.push({ sessionId: String(options.sessionId), meta: options.meta, agentOptions: options.agentOptions })
        if (failNextCreateWith !== undefined) {
          const error = new Error("session is owned")
          error.name = failNextCreateWith
          failNextCreateWith = undefined
          throw error
        }
        const agent = {
          id: `agent-${++agentSeq}`,
          session: { id: String(options.sessionId), snapshotEvents: () => SNAPSHOT.slice() },
          status: "idle",
          followup: (_message: any) => {},
          steer: (_message: any) => {},
        }
        const handle = { agent, disposed: false, dispose: () => { handle.disposed = true } }
        handles.push(handle)
        return handle
      },
    },
  }
  const emit = (event: string, payload: any) => {
    for (const handler of handlers.get(event) ?? []) handler(payload)
  }
  return { ctx, emit, creates, handles, setFail: (name: string) => { failNextCreateWith = name } }
}

function callbacks(overrides: Partial<TurnCallbacks> = {}): TurnCallbacks {
  return {
    onThinkingDelta: () => {},
    onContentDelta: () => {},
    onTurnEnd: () => {},
    onApprove: async () => true,
    onToolRun: () => {},
    onError: () => {},
    ...overrides,
  }
}

/** Drive one turn: fire-and-forget the prompt, let the (re)create land,
 * then emit the running→idle transition that settles the turn promise
 * (and arms the idle-release timer via finishTurn). The agent id tracks
 * HANDLES (failed creates never mint an agent). */
async function runTurn(session: HostSession, env: ReturnType<typeof makeCtx>, text: string, cb?: Partial<TurnCallbacks>) {
  const pending = session.turn(text, callbacks(cb))
  await new Promise((resolve) => setTimeout(resolve, 0))
  const agentId = `agent-${env.handles.length}`
  env.emit("agent/status", { agent: { id: agentId }, status: "running" })
  env.emit("agent/status", { agent: { id: agentId }, status: "idle" })
  await pending
}

describe("HostSession idle release", () => {
  test("frees the handle after the quiet window and re-attaches the SAME id", async () => {
    const env = makeCtx()
    const session = new HostSession(env.ctx)
    ;(session as any).configLoad = () => ({ idleReleaseSec: 0.05 })
    await runTurn(session, env, "first")
    expect(env.creates).toHaveLength(1)
    const firstId = env.creates[0].sessionId
    expect(env.handles[0].disposed).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(env.handles[0].disposed).toBe(true)
    // the next send wakes: same session id, fresh handle
    await runTurn(session, env, "second")
    expect(env.creates).toHaveLength(2)
    expect(env.creates[1].sessionId).toBe(firstId)
    expect(env.handles[1].disposed).toBe(false)
  })

  test("the wake folds in the rows other surfaces wrote while released", async () => {
    const env = makeCtx()
    const session = new HostSession(env.ctx)
    ;(session as any).configLoad = () => ({ idleReleaseSec: 0.05 })
    const missed: { kind: string; text: string }[] = []
    await runTurn(session, env, "first")
    await new Promise((resolve) => setTimeout(resolve, 200))
    await runTurn(session, env, "second", {
      onReattachedMissed: (rows) => missed.push(...rows),
    })
    expect(missed).toEqual([
      { kind: "user", text: "phone follow-up" },
      { kind: "assistant", text: "phone answer" },
    ])
  })

  test("a lease owned by another surface fails the wake with an actionable error and keeps the id", async () => {
    const env = makeCtx()
    const session = new HostSession(env.ctx)
    ;(session as any).configLoad = () => ({ idleReleaseSec: 0.05 })
    await runTurn(session, env, "first")
    await new Promise((resolve) => setTimeout(resolve, 200))
    env.setFail("SessionAlreadyOwnedError")
    await expect(session.turn("second", callbacks())).rejects.toThrow(/another process/)
    // the id survives the refusal — a retry (owner idle) re-attaches it
    await runTurn(session, env, "third")
    expect(env.creates).toHaveLength(3)
    expect(env.creates[2].sessionId).toBe(env.creates[0].sessionId)
  })

  test("abort keeps /new semantics: the next send mints a FRESH id", async () => {
    const env = makeCtx()
    const session = new HostSession(env.ctx)
    ;(session as any).configLoad = () => ({ idleReleaseSec: 0.05 })
    await runTurn(session, env, "first")
    session.abort()
    await runTurn(session, env, "second")
    expect(env.creates).toHaveLength(2)
    expect(env.creates[1].sessionId).not.toBe(env.creates[0].sessionId)
  })

  test("an explicit resume wins over the reattach", async () => {
    const env = makeCtx()
    const session = new HostSession(env.ctx)
    ;(session as any).configLoad = () => ({ idleReleaseSec: 0.05 })
    await runTurn(session, env, "first")
    await new Promise((resolve) => setTimeout(resolve, 200))
    session.resumeSession("picked-history")
    await runTurn(session, env, "second")
    expect(env.creates[1].sessionId).toBe("picked-history")
  })

  test("idleReleaseSec 0 disables the release", async () => {
    const env = makeCtx()
    const session = new HostSession(env.ctx)
    ;(session as any).configLoad = () => ({ idleReleaseSec: 0 })
    await runTurn(session, env, "first")
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(env.handles[0].disposed).toBe(false)
  })
})
