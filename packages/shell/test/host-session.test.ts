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
  const opens: string[] = []
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
          open: async (id: string, _mode: string) => {
            opens.push(id)
            return {
              read: async (offset: number) => (offset < PERSISTED.length ? { events: PERSISTED.slice(offset) } : { events: [] }),
              close: async () => {},
            }
          },
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
  return { ctx, emit, creates, handles, opens, setFail: (name: string) => { failNextCreateWith = name } }
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

// F1c (cold-boot attach stall): the v2 page's projection.load() passes ""
// before the first session exists; persistence.open("") rejects with
// `session "" not found` and the hydration loader (whose catch swallows
// rejections) never clears. An empty id must RESOLVE [] — no session yet,
// no stored history — and never touch the persistence layer.
describe("storedTranscript empty-id guard (F1c)", () => {
  test("empty id resolves [] without opening persistence", async () => {
    const env = makeCtx()
    const session = new HostSession(env.ctx)
    const rows = await session.storedTranscript("")
    expect(rows).toEqual([])
    expect(env.opens).toEqual([])
  })

  test("a real id still drains the persisted rows", async () => {
    const env = makeCtx()
    const session = new HostSession(env.ctx)
    const rows = await session.storedTranscript("s1")
    expect(rows.map((r) => r.kind)).toEqual(["user", "assistant", "user", "assistant"])
    expect(env.opens).toEqual(["s1"])
  })
})

// The in-process subagents service fallback in steerChildDetailed must call
// `prompt(request, signal)` — the lib's rejectPrompt dereferences
// `signal.aborted` unguarded, so a missing signal turns every delivery
// rejection into `TypeError: ... (reading 'aborted')` and masks the reason.
describe("steerChildDetailed subagents-service fallback", () => {
  /** Install a recording fake `subagents` service on the ctx. */
  function installService(env: ReturnType<typeof makeCtx>) {
    const calls: { request: any; signal: unknown }[] = []
    let failWith: Error | undefined
    const baseGet = env.ctx.get.bind(env.ctx)
    env.ctx.get = (key: string) => {
      if (key === "subagents") {
        return {
          prompt: async (request: any, signal: unknown) => {
            calls.push({ request, signal })
            if (failWith !== undefined) throw failWith
            return { messageId: "msg-1" }
          },
        }
      }
      return baseGet(key)
    }
    return { calls, setFail: (error: Error) => { failWith = error } }
  }

  test("service delivery rides a live (never-aborted) signal and the continuable steer shape", async () => {
    const env = makeCtx()
    const session = new HostSession(env.ctx)
    const service = installService(env)
    await runTurn(session, env, "first")
    const result = await session.steerChildDetailed("child-1", "wrap up now")
    expect(result).toEqual({ ok: true })
    expect(service.calls).toHaveLength(1)
    const { request, signal } = service.calls[0]
    expect(request).toMatchObject({
      mode: "continuable",
      delivery: "steer",
      parentSessionId: env.creates[0].sessionId,
      childSessionId: "child-1",
      content: [{ type: "text", text: "wrap up now" }],
    })
    expect(typeof request.requestId).toBe("string")
    expect(request.requestId).not.toBe("")
    // the lib reads `signal.aborted` and calls `signal.throwIfAborted()`
    expect(signal).toBeInstanceOf(AbortSignal)
    expect((signal as AbortSignal).aborted).toBe(false)
  })

  test("a service rejection surfaces its real reason, not the missing-signal TypeError", async () => {
    const env = makeCtx()
    const session = new HostSession(env.ctx)
    const service = installService(env)
    await runTurn(session, env, "first")
    service.setFail(new Error("subagent follow-up is temporarily unavailable"))
    const result = await session.steerChildDetailed("child-1", "wrap up now")
    expect(result).toEqual({ ok: false, reason: "subagent follow-up is temporarily unavailable" })
  })

  test("no service and no adopted agent reports the unreachable reason", async () => {
    const env = makeCtx()
    const session = new HostSession(env.ctx)
    await runTurn(session, env, "first")
    expect(await session.steerChildDetailed("child-1", "go")).toEqual({
      ok: false,
      reason: "child agent not reachable and no subagents service",
    })
  })
})

// ---------------------------------------------------------------------------
// cacheHitMode (batch F2, tui-pi parity): the CH footer rate modes over the
// usage-frame handler. Reference numbers = e2e scenario-63/71 semantics:
// turn one 1000 billed input with 900 cached (90%), turn two 1000 billed
// with 200 cached (20%) — session cumulative 1100/2000 = 55%.
// ---------------------------------------------------------------------------
describe("HostSession cacheHitMode", () => {
  const usageEmit = (usage: Record<string, number>) => ({
    agent: { id: "agent-1" },
    frame: { type: "chunk", chunk: { type: "usage", usage } },
  })

  async function turnWithUsage(env: ReturnType<typeof makeCtx>, session: HostSession, frames: Record<string, number>[]) {
    const pending = session.turn("go", callbacks())
    await new Promise((resolve) => setTimeout(resolve, 0))
    env.emit("agent/status", { agent: { id: "agent-1" }, status: "running" })
    for (const usage of frames) env.emit("agent/assistant-stream", usageEmit(usage))
    env.emit("agent/status", { agent: { id: "agent-1" }, status: "idle" })
    await pending
  }

  test("session mode is the cumulative rate, lastMessage the latest request's", async () => {
    const env = makeCtx()
    const session = new HostSession(env.ctx)
    const pending = session.turn("go", callbacks())
    await new Promise((resolve) => setTimeout(resolve, 0))
    env.emit("agent/status", { agent: { id: "agent-1" }, status: "running" })
    // turn one (warm): 1000 billed input, 900 cached -> 90% both modes
    env.emit("agent/assistant-stream", usageEmit({ inputTokens: 100, outputTokens: 5, cacheReadTokens: 900 }))
    expect(session.cacheHitRate()).toBeCloseTo(90, 5)
    expect(session.cacheHitRate("lastMessage")).toBeCloseTo(90, 5)
    expect(session.cacheHitRate("session")).toBeCloseTo(90, 5)
    // turn two (cold): 1000 billed, 200 cached -> latest 20%, cumulative 55%
    env.emit("agent/assistant-stream", usageEmit({ inputTokens: 800, outputTokens: 3, cacheReadTokens: 200 }))
    expect(session.cacheHitRate()).toBeCloseTo(20, 5)
    expect(session.cacheHitRate("lastMessage")).toBeCloseTo(20, 5)
    expect(session.cacheHitRate("session")).toBeCloseTo(55, 5)
    env.emit("agent/status", { agent: { id: "agent-1" }, status: "idle" })
    await pending
    // the assignment-semantics `usage` view is untouched (🧠 reads latest)
    expect(session.usage.prompt).toBe(800)
    expect(session.usage.cacheRead).toBe(200)
  })

  test("cacheWrite bills into both denominators (tui-pi billed input)", async () => {
    const env = makeCtx()
    const session = new HostSession(env.ctx)
    await turnWithUsage(env, session, [
      { inputTokens: 100, outputTokens: 5, cacheReadTokens: 900, cacheWriteTokens: 50 },
      { inputTokens: 800, outputTokens: 3, cacheWriteTokens: 100 },
    ])
    // latest request: 0 read / 900 billed (800 + 0 + 100 write)
    expect(session.cacheHitRate()).toBeCloseTo(0, 5)
    // cumulative: 900 read / 1950 billed (Σ900 prompt + Σ900 read + Σ150 write)
    expect(session.cacheHitRate("session")).toBeCloseTo((900 / 1950) * 100, 5)
  })

  test("no cache traffic gates both modes to null", async () => {
    const env = makeCtx()
    const session = new HostSession(env.ctx)
    await turnWithUsage(env, session, [{ inputTokens: 100, outputTokens: 5 }])
    expect(session.cacheHitRate()).toBeNull()
    expect(session.cacheHitRate("session")).toBeNull()
  })
})
