import { describe, expect, test } from "bun:test"
import { SurfaceStore, OpentuiSurfaceService, registerSurfaceService, hasSurface } from "../src/surface-service.ts"
import { Context } from "@deepseek-ai/cordis"

const widget = {
  kind: "widget" as const,
  slot: "status" as const,
  id: "test.w",
  parts: [{ text: "hi" }],
}

describe("SurfaceStore", () => {
  test("upsert replaces by id and bumps version", () => {
    const s = new SurfaceStore()
    s.upsert(widget)
    s.upsert({ ...widget, parts: [{ text: "ho" }] })
    expect(s.snapshot).toHaveLength(1)
    const w = s.snapshot[0]
    expect(w.kind === "widget" && w.parts[0].text).toBe("ho")
    expect(s.version).toBe(2)
  })

  test("remove only bumps when present", () => {
    const s = new SurfaceStore()
    s.upsert(widget)
    s.remove("nope")
    expect(s.version).toBe(1)
    s.remove("test.w")
    expect(s.snapshot).toHaveLength(0)
    expect(s.version).toBe(2)
  })

  test("subscribe fires on change, unsubscribe stops it", () => {
    const s = new SurfaceStore()
    let hits = 0
    const off = s.subscribe(() => hits++)
    s.upsert(widget)
    off()
    s.upsert(widget)
    expect(hits).toBe(1)
  })
})

describe("OpentuiSurfaceService", () => {
  test("declare/retract/onEvent roundtrip", () => {
    const svc = new OpentuiSurfaceService(new SurfaceStore())
    const events: string[] = []
    svc.onEvent((e) => events.push(e.type))
    svc.declare(widget)
    svc.retract("test.w")
    svc.dispatch({ type: "open", id: "test.w" })
    expect(events).toEqual(["open"])
  })
})

describe("registerSurfaceService + hasSurface", () => {
  test("provides ctx.surface and hasSurface sees it", async () => {
    const ctx = new Context()
    expect(hasSurface(ctx)).toBe(false)
    registerSurfaceService(ctx, new SurfaceStore())
    await new Promise((r) => setTimeout(r, 50))
    expect(hasSurface(ctx)).toBe(true)
    ;(ctx as any).surface.declare(widget)
    expect(hasSurface(ctx)).toBe(true)
  })
})
