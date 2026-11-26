/**
 * retention P2 — read-only flock probe unit tests + real addon canary.
 *
 * Unit cases inject a fake io seam: they create no file, never open with a
 * write flag, and never take a real writer lease. The last case is an OPT-IN
 * canary against the installed host addon; it runs only when
 * `DSH_PRUNE_LOCK_CANARY_ROOT` points at a host require root (the running dsh
 * bin or the `@deepseek-ai/node-addon-system` package dir) and touches only
 * an existing checked-in fixture file with a read-only descriptor.
 */
import { describe, expect, test } from "bun:test"
import { open } from "node:fs/promises"
import { resolve } from "node:path"
import {
  createPruneLockProbe,
  resolveFlockTryLockExclusive,
  type FileHandleLike,
  type LockProbeIo,
  type TryLockExclusive,
} from "../src/prune-lock-probe"

function errno(code: string): Error {
  return Object.assign(new Error(`${code}: probe test`), { code })
}

interface FakeIoOptions {
  readonly openError?: string
  readonly lockError?: string
  readonly fstatError?: string
  readonly statError?: string
  readonly closeThrows?: boolean
  readonly currentDev?: number
  readonly currentIno?: number
}

function fakeIo(options: FakeIoOptions = {}) {
  const calls: Array<{ op: string; arg?: unknown }> = []
  const handle: FileHandleLike = {
    fd: 42,
    async stat() {
      calls.push({ op: "fstat" })
      if (options.fstatError !== undefined) throw errno(options.fstatError)
      return { dev: 1, ino: 10 }
    },
    async close() {
      calls.push({ op: "close" })
      if (options.closeThrows === true) throw errno("EIO")
    },
  }
  const io: LockProbeIo = {
    async open(path: string, flags: "r") {
      calls.push({ op: "open", arg: [path, flags] })
      if (options.openError !== undefined) throw errno(options.openError)
      return handle
    },
    async stat(path: string) {
      calls.push({ op: "stat", arg: path })
      if (options.statError !== undefined) throw errno(options.statError)
      return { dev: options.currentDev ?? 1, ino: options.currentIno ?? 10 }
    },
  }
  return { io, calls }
}

describe("retention P2 — read-only flock probe", () => {
  test("success path: open 'r' -> tryLockExclusive(fd) -> fstat/stat recheck -> close", async () => {
    const { io, calls } = fakeIo()
    const lockedFds: number[] = []
    const tryLock: TryLockExclusive = async (fd) => { lockedFds.push(fd) }
    const result = await createPruneLockProbe(tryLock, io)("/sessions/_no-cwd/s/session.lock")
    expect(result).toEqual({ status: "unlocked" })
    expect(lockedFds).toEqual([42])
    expect(calls.map((c) => c.op)).toEqual(["open", "fstat", "stat", "close"])
    // The only open flag is the READ-ONLY 'r'; no 'w', 'a', 'wx', etc.
    expect(calls.find((c) => c.op === "open")?.arg).toEqual(["/sessions/_no-cwd/s/session.lock", "r"])
  })

  test("ENOENT/ENOTDIR means no lock file; other open errors are unknown", async () => {
    expect((await createPruneLockProbe(async () => {}, fakeIo({ openError: "ENOENT" }).io)("x")).status).toBe("no-lock")
    expect((await createPruneLockProbe(async () => {}, fakeIo({ openError: "ENOTDIR" }).io)("x")).status).toBe("no-lock")
    const denied = fakeIo({ openError: "EACCES" })
    const result = await createPruneLockProbe(async () => {}, denied.io)("x")
    expect(result.status).toBe("unknown")
    expect(result.detail).toBe("EACCES")
  })

  test("EAGAIN/EWOULDBLOCK -> lock-held; ENOENT -> no-lock; other syscall errors -> unknown", async () => {
    for (const code of ["EAGAIN", "EWOULDBLOCK"]) {
      const { io, calls } = fakeIo()
      const result = await createPruneLockProbe(async () => { throw errno(code) }, io)("x")
      expect(result).toEqual({ status: "lock-held", detail: code })
      // close must run even when the lock attempt rejects.
      expect(calls.map((c) => c.op)).toEqual(["open", "close"])
    }
    expect((await createPruneLockProbe(async () => { throw errno("ENOENT") }, fakeIo().io)("x")).status).toBe("no-lock")
    expect((await createPruneLockProbe(async () => { throw errno("EBADF") }, fakeIo().io)("x").then((r) => r.status))).toBe("unknown")
  })

  test("inode/dev recheck rejects a swapped lock file; close is still called", async () => {
    const swapped = fakeIo({ currentIno: 99 })
    const result = await createPruneLockProbe(async () => {}, swapped.io)("x")
    expect(result).toEqual({ status: "unknown", detail: "lock-file-replaced" })
    expect(swapped.calls.map((c) => c.op)).toEqual(["open", "fstat", "stat", "close"])

    const devSwapped = fakeIo({ currentDev: 2 })
    expect((await createPruneLockProbe(async () => {}, devSwapped.io)("x")).status).toBe("unknown")

    const statBroken = fakeIo({ fstatError: "EIO" })
    expect((await createPruneLockProbe(async () => {}, statBroken.io)("x")).status).toBe("unknown")
    expect(statBroken.calls.map((c) => c.op)).toEqual(["open", "fstat", "close"])
  })

  test("close failure is contained: it cannot turn a probe into a prune", async () => {
    const { io } = fakeIo({ closeThrows: true })
    const result = await createPruneLockProbe(async () => {}, io)("x")
    expect(result.status).toBe("unlocked")
  })

  test("no write surface: the probe module never uses open('w') / mkdir / SessionWriteLease", async () => {
    const { io, calls } = fakeIo()
    await createPruneLockProbe(async () => {}, io)("x")
    expect(calls.filter((c) => c.op === "open").every((c) => (c.arg as unknown[])[1] === "r")).toBe(true)
  })
})

/** Real addon canary — opportunistic, never faked. It resolves the host addon
 *  from the bundle/argv roots and, when set, `DSH_PRUNE_LOCK_CANARY_ROOT`
 *  (a require root such as the installed dsh bin). A host without the addon
 *  reports a clear skip instead of pretending the probe worked. */
test("canary: real host tryLockExclusive resolves and probes read-only", async () => {
  const canaryRoot = process.env.DSH_PRUNE_LOCK_CANARY_ROOT
  // `import.meta.url` is a sentinel that bypasses the module-level cache so
  // the protocol tests' test seam cannot mask this real resolution.
  const roots = canaryRoot === undefined ? [import.meta.url] : [canaryRoot, import.meta.url]
  const fn = resolveFlockTryLockExclusive(roots)
  if (fn === undefined) {
    console.log("[prune-lock-probe] canary skipped: no host flock addon resolvable; set DSH_PRUNE_LOCK_CANARY_ROOT")
    return
  }
  expect(typeof fn).toBe("function")

  // Existing checked-in file; the probe opens it 'r' and closes it. No
  // creation, modification or deletion of any file in this test.
  const target = resolve(
    import.meta.dir,
    "fixtures/session-prune-sessions/_no-cwd/s-prune/session.v4.jsonl.zstd",
  )
  const handle = await open(target, "r")
  try {
    await fn(handle.fd)
    expect(typeof handle.fd).toBe("number")
  } finally {
    await handle.close()
  }
  const probe = createPruneLockProbe(fn)
  expect((await probe("/definitely/missing/session.lock")).status).toBe("no-lock")
  // The real addon must also drive a full read-only probe on an existing file.
  // `lock-held` is acceptable (another process could own the file); `unknown`
  // is not — it would mean the capability/probe chain failed.
  expect(["unlocked", "lock-held"]).toContain((await probe(target)).status)
})
