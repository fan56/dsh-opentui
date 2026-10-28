/**
 * The surface service implementation — the layer-2 bridge.
 *
 * One instance is registered per cordis context by the Runtime plugin.
 * Declarations are held in a versioned store; the shell re-renders from the
 * snapshot on each version bump.
 */
import type { Context, Service } from "@deepseek-ai/cordis"
import type { SurfaceDecl, SurfaceEvent, SurfaceService } from "./protocol.ts"

export class SurfaceStore {
  #decls = new Map<string, SurfaceDecl>()
  #version = 0
  #listeners = new Set<() => void>()

  get snapshot(): SurfaceDecl[] {
    return [...this.#decls.values()]
  }
  get version(): number {
    return this.#version
  }
  upsert(decl: SurfaceDecl) {
    this.#decls.set(decl.id, decl)
    this.#bump()
  }
  remove(id: string) {
    if (this.#decls.delete(id)) this.#bump()
  }
  subscribe(cb: () => void): () => void {
    this.#listeners.add(cb)
    return () => this.#listeners.delete(cb)
  }
  #bump() {
    this.#version++
    for (const l of this.#listeners) l()
  }
}

export class OpentuiSurfaceService implements SurfaceService {
  #store: SurfaceStore
  #events = new Set<(e: SurfaceEvent) => void>()

  constructor(store: SurfaceStore) {
    this.#store = store
  }
  declare(decl: SurfaceDecl) {
    this.#store.upsert(decl)
  }
  retract(id: string) {
    this.#store.remove(id)
  }
  onEvent(cb: (event: SurfaceEvent) => void): () => void {
    this.#events.add(cb)
    return () => this.#events.delete(cb)
  }
  /** Runtime-internal: dispatch an event to subscribed plugins. */
  dispatch(event: SurfaceEvent) {
    for (const cb of this.#events) cb(event)
  }
}

/**
 * Registers `ctx.surface` for the given context. Plugins injected into the
 * same fiber graph receive the handle when they `inject: ["surface"]`.
 */
export function registerSurfaceService(ctx: Context, store: SurfaceStore): void {
  const svc = new OpentuiSurfaceService(store)
  ctx.provide("surface", svc)
}

/**
 * Availability probe for plugins that degrade gracefully:
 *
 *   if (ctx.hasSurface?.()) { ctx.surface.declare(...) } else { /* headless *​/ }
 *
 * Returns true when a surface service is registered AND active in this fiber.
 */
export function hasSurface(ctx: Context): boolean {
  return !!(ctx as any).surface
}
