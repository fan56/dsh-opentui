/**
 * The Runtime: boots the OpenTUI engine, optionally registers the surface
 * service on a cordis context, and mounts the shell's Solid root.
 *
 * Usage (from the shell):
 *
 *   const runtime = await bootRuntime({ root: (store) => <Shell deps={{store,...}} /> })
 *   // with a host context: bootRuntime({ ctx, root })
 */
import type { Context } from "@deepseek-ai/cordis"
import { render } from "@opentui/solid"
import type { JSX } from "solid-js"
import { SurfaceStore, registerSurfaceService } from "./surface-service.ts"
import { mountEngine, unmountEngine, type EngineOptions, type StdoutCapture } from "./engine.ts"

export * from "./protocol.ts"
export { SurfaceStore, registerSurfaceService, hasSurface, OpentuiSurfaceService } from "./surface-service.ts"
export { mountEngine, unmountEngine, type EngineOptions, type StdoutCapture } from "./engine.ts"

export interface RuntimeOptions extends EngineOptions {
  /** Host context; when given, `ctx.surface` is registered for plugins. */
  ctx?: Context
  /** Pre-created surface store. */
  store?: SurfaceStore
  /** The shell's Solid root component. */
  root: (store: SurfaceStore) => JSX.Element
}

export interface RuntimeHandle {
  store: SurfaceStore
  stop(): Promise<void>
}

export async function bootRuntime(options: RuntimeOptions): Promise<RuntimeHandle> {
  const store = options.store ?? new SurfaceStore()
  if (options.ctx) registerSurfaceService(options.ctx, store)

  let exitReason = "unknown"
  const { renderer, capture } = await mountEngine({
    ...options,
    onExit: (reason) => {
      exitReason = reason
      options.onExit?.(reason)
    },
  })

  await render(() => options.root(store), renderer)

  return {
    store,
    stop: async () => {
      await unmountEngine(renderer, capture)
      options.ctx?.logger?.info(`runtime stopped: ${exitReason}`)
    },
  }
}
