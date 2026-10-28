/**
 * The starter plugin — copy this directory to start a new dsh plugin on
 * dsh-opentui. It demonstrates the layer-2 path: zero Solid build step,
 * pure declarative surface protocol via the `surface` service.
 *
 * Headless degradation is built in: when no surface service exists the
 * plugin still loads and logs — hasSurface() is the probe.
 */
import type { Context } from "@deepseek-ai/cordis"
import { hasSurface } from "@dsh-opentui/runtime"
import "@dsh-opentui/runtime/protocol"

export function apply(ctx: Context) {
  ctx.effect(() => {
    let ticks = 0
    const render = () => {
      ticks++
      ctx.surface.declare({
        kind: "widget",
        slot: "status",
        id: "starter.tick",
        order: 100,
        parts: [{ text: "starter", dim: true }, { text: ` tick=${ticks}`, color: "#ffb86c" }],
      })
    }
    render()

    if (!hasSurface(ctx)) return () => {} // headless: nothing to render
    render()
    const timer = setInterval(render, 1000)
    return () => clearInterval(timer) // auto-disposed when the plugin unloads
  })
}

export const plugin = { name: "dsh-opentui-starter", apply }
export default plugin
