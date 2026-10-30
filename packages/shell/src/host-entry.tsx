/**
 * The cordis plugin entry — this file is what the dsh host loads when the
 * `dsh-opentui` profile boots. It mounts the OpenTUI engine inside the host
 * process and renders ShellHost, wired to a HostSession.
 *
 * Runtime contract (see build-host.ts): @opentui/* and solid-js stay
 * external (resolved from the profile's node_modules); dsh-llm resolves
 * from the global dsh closure via symlink.
 */
import { spawn } from "node:child_process"
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

/** True when this process already carries the FFI flag (guards re-exec). */
function hasFfiFlag(): boolean {
  return (process.env.NODE_OPTIONS ?? "").includes("--experimental-ffi")
}

/**
 * OpenTUI's native layer needs --experimental-ffi, which a bare
 * `dsh --profile dsh-opentui` does not carry (only the dsh-opentui launcher
 * injects it). Instead of dying, re-exec the SAME dsh command with the flag
 * merged into NODE_OPTIONS: the child reaches this path again WITH the flag
 * and boots normally. Guarded by hasFfiFlag so it never loops.
 */
function reExecWithFfi(): boolean {
  if (hasFfiFlag()) return false
  const env = {
    ...process.env,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --experimental-ffi`.trim(),
  }
  const child = spawn(process.argv[1]!, process.argv.slice(2), {
    env,
    stdio: "inherit",
    cwd: process.cwd(),
  })
  child.on("exit", (code) => process.exit(code ?? 0))
  return true
}

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
    const msg = String(e)
    if (/native FFI is not available/.test(msg) && reExecWithFfi()) return
    process.stderr.write("dsh-opentui boot failed: " + msg + "\n")
  })
}

export const plugin = { name: "dsh-opentui", inject, apply }
export default plugin
