import { describe, expect, test } from "bun:test"

// Batch-1 vendor smoke: the vendored sibling closures resolve at runtime and
// behave. Keeps `bun test` meaningful in this package (CI runs it per-package;
// zero test files fail the loop) without dragging in the stubbed seams or the
// native renderer.

describe("vendored util closure", () => {
  test("duration formats compact elapsed time", async () => {
    const { duration } = await import("../src/vendor/util/src/duration")
    expect(duration(850)).toBe("850ms")
    expect(duration(12_400)).toBe("12.4s")
    expect(duration(185_000)).toBe("3m 5s")
  })

  test("retry retries transient failures then settles", async () => {
    const { retry } = await import("../src/vendor/util/src/retry")
    let attempts = 0
    const value = await retry(
      async () => {
        attempts += 1
        if (attempts < 3) throw new Error("econnreset")
        return "ok"
      },
      { delay: 1 },
    )
    expect(value).toBe("ok")
    expect(attempts).toBe(3)
  })

  test("retry rethrows non-transient failures immediately", async () => {
    const { retry } = await import("../src/vendor/util/src/retry")
    let attempts = 0
    await expect(
      retry(async () => {
        attempts += 1
        throw new Error("permanent")
      }),
    ).rejects.toThrow("permanent")
    expect(attempts).toBe(1)
  })
})

describe("vendored schema", () => {
  test("exports the namespaces the tui imports", async () => {
    const mod = await import("../src/vendor/schema/src/index")
    expect(mod.SessionMessage).toBeDefined()
    expect(mod.SessionInbox).toBeDefined()
  })
})
