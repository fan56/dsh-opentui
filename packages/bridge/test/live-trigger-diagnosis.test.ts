/**
 * T4 (2026-11-23) — live-trigger diagnosis with the REAL host packages.
 *
 * Question from the field: catalog trigger (a) works, but a parent
 * `approval/policy` switch does NOT mirror onto known children (trigger b),
 * with no warn. These probes pin down H1-H4 against the ACTUAL installed host
 * closure (`0.2.2-rc.5`), not a fake. Host packages are imported by absolute
 * path (they are the binary the TUI loads); the bridge src is imported normally.
 *
 * H1 — does a real store-attached `session.append('approval/policy')` publish
 *      `session/event`? (vs catalog / tool/call / approval/asked)
 * H2 — is the delivered event shape `{type, data.policy}` identical to the log?
 * H3 — do real `approval.overrideOf` / `effectivePolicy` work on the session
 *      object that `sessions.get(childId)` returns?
 * H4 — does a DETACHED session's append land in the log but NOT publish? (the
 *      one host mechanism that can yield "log grew, no listener fired, no warn")
 *
 * No product src is changed by this file.
 */
import { describe, expect, test } from 'bun:test'

const HOST = "/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai"
const { existsSync } = await import("node:fs")
// On a machine without the installed host closure (e.g. a bare CI checkout) the
// probe is inapplicable — load nothing and skip below rather than fail to import.
const HOST_PRESENT = existsSync(`${HOST}/dsh-session/lib/index.js`)
let Context: any, SessionStore: any, Session: any, SessionProjectionRegistry: any, ApprovalService: any, setApprovalPolicy: any
if (HOST_PRESENT) {
  ;({ Context } = await import(`${HOST}/cordis/lib/index.js`))
  ;({ SessionStore, Session } = await import(`${HOST}/dsh-session/lib/index.js`))
  ;({ SessionProjectionRegistry } = await import(`${HOST}/dsh-session-projection/lib/index.js`))
  ;({ ApprovalService, setApprovalPolicy } = await import(`${HOST}/dsh-user-approval/lib/index.js`))
}
const probe = describe.skipIf(!HOST_PRESENT)

/** Build a real cordis root with real sessions + approval services. */
async function makeHost() {
  const root = new Context()
  root.provide("logger", { info() {}, warn() {}, error() {}, debug() {}, trace() {} })
  const projections = new SessionProjectionRegistry(root)
  const store = new SessionStore(root)
  const approval = new ApprovalService(root, { policy: "ask" })
  // register() is a thenable resolving to the projection handle (with stateOf),
  // exactly how ApprovalService.Service.init awaits it.
  approval.approvalProjectionHandle = await projections.register({
    key: "approvalState", stateVersion: 1, stateSchema: { parse: (x: unknown) => x },
    init: () => ({ policy: null, turnOpen: false }),
    apply(state: any, event: any) {
      return event.type === "approval/policy" ? { ...state, policy: event.data.policy } : state
    },
  })
  return { root, store, approval, projections }
}

probe("H1/H2 — real dsh-session publishes approval/policy with intact shape", () => {
  test("all four types publish; delivered event.data matches log, id matches", async () => {
    const { root, store } = await makeHost()
    const parent = store.create("P", { meta: { cwd: "/tmp" } })
    const seen: Array<{ id: string; type: string; data: any }> = []
    root.on("session/event", (session: any, event: any) => {
      seen.push({ id: session.id, type: event.type, data: event.data })
    })
    const writes: Array<[string, Record<string, unknown>]> = [
      ["approval/policy", { policy: "ask" }],
      ["subagent/catalog", { childId: "C", childCreatedAt: 1 }],
      ["tool/call", { callId: "x", name: "write" }],
      ["approval/asked", { callId: "y" }],
    ]
    for (const [type, data] of writes) parent.append(type, data)
    expect(seen.map((e) => e.type)).toEqual(writes.map(([t]) => t))
    const policyEvent = seen.find((e) => e.type === "approval/policy")!
    expect(policyEvent.data).toEqual({ policy: "ask" })
    expect(policyEvent.id).toBe("P")
  })
})

probe("H3 — real approval policy reads work on store.get() sessions", () => {
  test("overrideOf/effectivePolicy on sessions.get(childId) reflect a live append", async () => {
    const { store, approval } = await makeHost()
    const child = store.create("C", { meta: { parentSession: "P", origin: "subagent", cwd: "/tmp" } })
    const fetched = store.get("C")
    expect(fetched).toBe(child) // same live instance as catalog path would use
    setApprovalPolicy(child, "never")
    expect(approval.overrideOf(fetched!)).toBe("never")
    expect(approval.effectivePolicy(fetched!)).toBe("never")
    setApprovalPolicy(child, "ask")
    expect(approval.overrideOf(fetched!)).toBe("ask")
  })
})

probe("H4 — append on a DETACHED session lands in its log but publishes nothing", () => {
  test("detached setApprovalPolicy grows log with no session/event and no warn", async () => {
    const { root, store } = await makeHost()
    const attached = store.create("ATTACHED", { meta: { cwd: "/tmp" } })
    const detached = Session.create("DETACHED") // never entered into the store
    const seen: string[] = []
    root.on("session/event", (session: any, event: any) => seen.push(`${session.id}:${event.type}`))
    setApprovalPolicy(attached, "ask")
    setApprovalPolicy(detached, "never")
    expect(attached.snapshotEvents().map((e: any) => e.type)).toContain("approval/policy")
    expect(detached.snapshotEvents().map((e: any) => e.type)).toContain("approval/policy")
    // Only the store-attached append published; the detached one is silent.
    expect(seen).toEqual(["ATTACHED:approval/policy"])
  })
})
