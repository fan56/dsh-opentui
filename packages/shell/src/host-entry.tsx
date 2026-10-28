/**
 * The cordis plugin entry — this file is what the dsh host loads when the
 * `dsh-opentui` profile boots. It mounts the OpenTUI engine inside the host
 * process and renders ShellHost, wired to a HostSession.
 *
 * Runtime contract (see build-host.ts): @opentui/* and solid-js stay
 * external (resolved from the profile's node_modules); dsh-llm resolves
 * from the global dsh closure via symlink.
 */
import type { Context } from "@deepseek-ai/cordis"
import { render } from "@opentui/solid"
// source-imports are inlined by the bundler; none of them import cordis at runtime
import { mountEngine } from "../../runtime/src/engine.ts"
import { SurfaceStore } from "../../runtime/src/surface-service.ts"
import { createI18n } from "../../kit/src/i18n.ts"
import { ShellHost } from "./ShellHost.tsx"
import { HostSession } from "./host-session.ts"

// cordis v4: every ctx.<service> access must be declared here — and the
// loader unwraps `default ?? exports`, so inject must ride ON the default
// export object, not as a sibling named export
const inject = ["agents"]

export function apply(ctx: Context, config?: { theme?: string }) {
  const i18n = createI18n("zh-CN")
  const store = new SurfaceStore()
  const session = new HostSession(ctx)

  mountEngine({}).then(({ renderer }) => {
    render(
      () => <ShellHost deps={{ store, t: i18n.t, session, themeName: config?.theme }} />,
      renderer,
    )
  }).catch((e) => {
    process.stderr.write("dsh-opentui boot failed: " + String(e) + "\n")
  })
}

export const plugin = { name: "dsh-opentui", inject, apply }
export default plugin
