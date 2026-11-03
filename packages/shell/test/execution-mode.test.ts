// HostSession.executionMode(): the powerline's `dsh(native|ptc)` segment must
// report the presentation the model actually sees, read from the host tool
// registry — never guessed from the installed plugin list (mounting
// dsh-ptc-subagent used to flip the label to "ptc" while the main agent kept
// calling native tools). Under a `ptc` presentation the registry collapses
// every capability into the reserved `run_code` transport and lists it in
// `tools.schemas()`; under `native` it never appears.
import { describe, expect, test } from "bun:test"
import { HostSession } from "../src/host-session.ts"
import type { TurnCallbacks } from "../src/agent/loop.ts"

type Handler = (payload: any) => void

function makeCtx(schemaNames: string[] | undefined) {
  const handlers = new Map<string, Handler[]>()
  const scopesSeen: unknown[] = []
  let agentSeq = 0
  const ctx: any = {
    on(event: string, handler: Handler) {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
    },
    get(key: string) {
      if (key === "tools" && schemaNames !== undefined) {
        return {
          schemas(scope: unknown) {
            scopesSeen.push(scope)
            return schemaNames.map((name) => ({ name }))
          },
        }
      }
      return undefined
    },
    agents: {
      async create(options: any) {
        const agent = {
          id: `agent-${++agentSeq}`,
          session: { id: String(options.sessionId), snapshotEvents: () => [] },
          status: "idle",
          followup: () => {},
          steer: () => {},
        }
        return { agent, disposed: false, dispose() {} }
      },
    },
  }
  const emit = (event: string, payload: any) => {
    for (const handler of handlers.get(event) ?? []) handler(payload)
  }
  return { ctx, emit, scopesSeen }
}

function callbacks(): TurnCallbacks {
  return {
    onThinkingDelta: () => {},
    onContentDelta: () => {},
    onTurnEnd: () => {},
    onApprove: async () => true,
    onToolRun: () => {},
    onError: () => {},
  }
}

/** One turn through the fake host so the session owns a live agent handle. */
async function runTurn(session: HostSession, env: ReturnType<typeof makeCtx>) {
  const pending = session.turn("hello", callbacks())
  await new Promise((resolve) => setTimeout(resolve, 0))
  env.emit("agent/status", { agent: { id: "agent-1" }, status: "running" })
  env.emit("agent/status", { agent: { id: "agent-1" }, status: "idle" })
  await pending
}

describe("HostSession.executionMode", () => {
  test("native when the registry lists no run_code transport", () => {
    const env = makeCtx(["read_file", "bash"])
    expect(new HostSession(env.ctx).executionMode()).toBe("native")
  })

  test("ptc when the registry collapses tools into run_code", () => {
    const env = makeCtx(["run_code"])
    expect(new HostSession(env.ctx).executionMode()).toBe("ptc")
  })

  test("native when no tools service is reachable (headless/boot)", () => {
    const env = makeCtx(undefined)
    expect(new HostSession(env.ctx).executionMode()).toBe("native")
  })

  test("resolves the global view before a session and the live agent's scope after", async () => {
    const env = makeCtx(["read_file"])
    const session = new HostSession(env.ctx)
    ;(session as any).configLoad = () => ({ idleReleaseSec: 0 })
    session.executionMode()
    expect(env.scopesSeen).toEqual([undefined])
    await runTurn(session, env)
    session.executionMode()
    expect(env.scopesSeen).toHaveLength(2)
    expect((env.scopesSeen[1] as { id: string }).id).toBe("agent-1")
  })

  test("a throwing registry degrades to native instead of breaking the status bar", () => {
    const ctx: any = {
      on() {},
      get(key: string) {
        if (key === "tools") return { schemas() { throw new Error("registry not ready") } }
        return undefined
      },
    }
    expect(new HostSession(ctx).executionMode()).toBe("native")
  })
})
