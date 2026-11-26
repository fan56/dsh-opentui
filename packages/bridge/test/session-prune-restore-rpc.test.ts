/**
 * retention B4/C7 — protocol-level tests for `session.prune.restore`. Same
 * fake-cordis-ctx + fake-stdio technique as the plan RPC tests. The list case
 * uses an empty temp dshHome: no trash entry exists, so nothing is scanned and
 * nothing is written. Capability and param gates are checked before any fs.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply } from "../src/index"
import { setFlockTryLockExclusiveForTest } from "../src/prune-lock-probe"

const STDIO_SWITCH = "DSH_OPENTUI_BRIDGE_STDIO"
type Frame = Record<string, any>
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

function makeHarness(services: Record<string, unknown>, config: Record<string, unknown>): {
  send(frame: unknown): void
  waitFor(id: number | string): Promise<Frame>
} {
  const previousSwitch = process.env[STDIO_SWITCH]
  process.env[STDIO_SWITCH] = "1"
  const originalWrite = process.stdout.write.bind(process.stdout)
  const frames: string[] = []
  process.stdout.write = function (this: unknown, chunk: any, ...rest: any[]) {
    const text = String(chunk)
    frames.push(text)
    let parsed: any
    try { parsed = JSON.parse(text.trim()) } catch { /* reporter noise */ }
    const isBridgeFrame = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) &&
      ("ok" in parsed || "type" in parsed) && ("id" in parsed || "payload" in parsed || "result" in parsed || "error" in parsed)
    if (isBridgeFrame) return true
    return originalWrite(chunk, ...rest)
  } as typeof process.stdout.write
  const stdinListeners: Record<string, Array<(...a: any[]) => void>> = {}
  const fakeStdin = {
    setEncoding() {},
    on(name: string, fn: (...a: any[]) => void) { (stdinListeners[name] ||= []).push(fn); return fakeStdin },
    off(name: string, fn: (...a: any[]) => void) {
      stdinListeners[name] = (stdinListeners[name] ?? []).filter((f) => f !== fn)
      return fakeStdin
    },
    once(name: string, fn: (...a: any[]) => void) { (stdinListeners[name] ||= []).push(fn); return fakeStdin },
    pause() { return fakeStdin },
    resume() { return fakeStdin },
  }
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process, "stdin")
  Object.defineProperty(process, "stdin", { value: fakeStdin, configurable: true })
  let disposeBridge: (() => void) | undefined
  const ctx: any = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    effect(execute: () => () => void) { disposeBridge = execute(); return { dispose: () => disposeBridge?.() } },
    on() { return () => {} },
    get(name: string) { return services[name] },
    agents: { async create() { throw new Error("unused") }, async resume() { throw new Error("unused") }, get() { return undefined } },
  }
  setFlockTryLockExclusiveForTest(async () => {})
  apply(ctx, config)
  cleanups.push(() => {
    setFlockTryLockExclusiveForTest(undefined)
    try { disposeBridge?.() } catch { /* already torn down */ }
    process.stdout.write = originalWrite
    if (stdinDescriptor) Object.defineProperty(process, "stdin", stdinDescriptor)
    else delete (process as any).stdin
    if (previousSwitch === undefined) delete process.env[STDIO_SWITCH]
    else process.env[STDIO_SWITCH] = previousSwitch
  })
  const latest = (id: number | string): Frame | undefined => {
    for (let i = frames.length - 1; i >= 0; i--) {
      try {
        const frame = JSON.parse(frames[i])
        if (frame !== null && typeof frame === "object" && frame.id === id) return frame
      } catch { /* non-frame output */ }
    }
    return undefined
  }
  return {
    send(frame) { for (const fn of stdinListeners.data ?? []) fn(JSON.stringify(frame) + "\n") },
    async waitFor(id) {
      const deadline = Date.now() + 2000
      for (;;) {
        const frame = latest(id)
        if (frame !== undefined) return frame
        if (Date.now() > deadline) throw new Error(`no response frame for id=${id}`)
        await sleep(1)
      }
    },
  }
}

const statCapable = { async open() { throw new Error("unused") }, async stat() { return undefined } }
const controller = { async list() { return { items: [] } } }
function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "dsh-restore-rpc-"))
  mkdirSync(join(dir, "sessions"))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
const configFor = (dshHome: string) => ({ dshHome, sessionsRoot: join(dshHome, "sessions") })

describe("session.prune.restore — RPC gates", () => {
  test("stat capability missing => UNSUPPORTED", async () => {
    const h = makeHarness({ sessionController: controller, sessionPersistence: { async open() { throw new Error("unused") } } }, configFor(tempHome()))
    h.send({ id: 1, method: "session.prune.restore", params: { phase: "list" } })
    expect((await h.waitFor(1)).error.code).toBe("UNSUPPORTED")
  })

  test("sessionController missing => UNSUPPORTED", async () => {
    const h = makeHarness({ sessionPersistence: statCapable }, configFor(tempHome()))
    h.send({ id: 2, method: "session.prune.restore", params: { phase: "list" } })
    expect((await h.waitFor(2)).error.code).toBe("UNSUPPORTED")
  })

  test("client path / root / manifest params => BAD_PARAMS", async () => {
    for (const [i, key] of [3, 4, 5].map((n, idx) => [n, ["path", "sessionsRoot", "manifest"][idx]] as const)) {
      const h = makeHarness({ sessionController: controller, sessionPersistence: statCapable }, configFor(tempHome()))
      h.send({ id: i, method: "session.prune.restore", params: { phase: "list", [key]: "/etc/passwd" } })
      expect((await h.waitFor(i)).error.code).toBe("BAD_PARAMS")
    }
  })

  test("bad phase / missing id => BAD_PARAMS", async () => {
    const h = makeHarness({ sessionController: controller, sessionPersistence: statCapable }, configFor(tempHome()))
    h.send({ id: 6, method: "session.prune.restore", params: { phase: "commit" } })
    expect((await h.waitFor(6)).error.code).toBe("BAD_PARAMS")
    h.send({ id: 7, method: "session.prune.restore", params: { phase: "restore" } })
    expect((await h.waitFor(7)).error.code).toBe("BAD_PARAMS")
  })

  test("list on empty trash => ok with empty entries, no paths", async () => {
    const h = makeHarness({ sessionController: controller, sessionPersistence: statCapable }, configFor(tempHome()))
    h.send({ id: 8, method: "session.prune.restore", params: { phase: "list" } })
    const reply = await h.waitFor(8)
    expect(reply.ok).toBe(true)
    expect(reply.result.entries).toEqual([])
    expect(reply.result.rejected).toEqual([])
    expect(JSON.stringify(reply.result)).not.toContain("/home/")
  })

  test("restore unknown id => NOT_FOUND", async () => {
    const h = makeHarness({ sessionController: controller, sessionPersistence: statCapable }, configFor(tempHome()))
    h.send({ id: 9, method: "session.prune.restore", params: { phase: "restore", id: "missing" } })
    expect((await h.waitFor(9)).error.code).toBe("NOT_FOUND")
  })

  test("lister throws with dshHome in the message => fixed wire text, no path", async () => {
    const home = tempHome()
    const secret = `${home}/sessions/private-run`
    const throwingController = {
      async list() { throw new Error(`EACCES: cannot read ${secret}`) },
    }
    const h = makeHarness({ sessionController: throwingController, sessionPersistence: statCapable }, configFor(home))
    h.send({ id: 10, method: "session.prune.restore", params: { phase: "restore", id: "target" } })
    const reply = await h.waitFor(10)
    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("INTERNAL")
    expect(reply.error.message).toBe("session.prune.restore failed")
    expect(reply.error.detail).toBeUndefined()
    expect(JSON.stringify(reply)).not.toContain(secret)
    expect(JSON.stringify(reply)).not.toContain(home)
  })

  test("apply-lock throws with dshHome in the message => fixed wire text, no path", async () => {
    const home = tempHome()
    const secret = `${home}/trash/.apply.lock`
    const h = makeHarness({ sessionController: controller, sessionPersistence: statCapable }, configFor(home))
    setFlockTryLockExclusiveForTest(async () => { throw new Error(`EACCES: cannot lock ${secret}`) })
    h.send({ id: 11, method: "session.prune.restore", params: { phase: "restore", id: "target" } })
    const reply = await h.waitFor(11)
    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe("INTERNAL")
    expect(reply.error.message).toBe("session.prune.restore failed")
    expect(reply.error.detail).toBeUndefined()
    expect(JSON.stringify(reply)).not.toContain(secret)
    expect(JSON.stringify(reply)).not.toContain(home)
  })
})
