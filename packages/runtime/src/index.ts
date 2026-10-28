/**
 * The Runtime plugin: boots the OpenTUI engine inside a cordis context,
 * registers the surface service, and mounts the shell's Solid root.
 *
 * Usage (from the shell):
 *
 *   const runtime = await bootRuntime(ctx, { root: () => <Shell /> })
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
  /** Pre-created surface store; the runtime registers it as ctx.surface. */
  store?: SurfaceStore
  /** The shell's Solid root component. */
  root: (store: SurfaceStore) => JSX.Element
}

export interface RuntimeHandle {
  store: SurfaceStore
  stop(): Promise<void>
}

export async function bootRuntime(ctx: Context, options: RuntimeOptions): Promise<RuntimeHandle> {
  const store = options.store ?? new SurfaceStore()
  registerSurfaceService(ctx, store)

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
      ctx.logger?.info(`runtime stopped: ${exitReason}`)
    },
  }
}
