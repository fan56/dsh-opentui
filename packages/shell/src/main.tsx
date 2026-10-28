/**
 * Shell entrypoint: boots a cordis context + the runtime with the Shell root.
 * In M2 this becomes the full host bridge (session, approvals, ask); for M1
 * it proves the whole stack mounts and quits cleanly.
 */
import { Context } from "@deepseek-ai/cordis"
import { bootRuntime } from "@dsh-opentui/runtime"
import { createI18n } from "@dsh-opentui/kit"
import { Shell } from "./Shell.tsx"

const i18n = createI18n("zh-CN")
const ctx = new Context()

try {
  const runtime = await bootRuntime(ctx, {
    root: (store) => <Shell deps={{ store, t: i18n.t }} />,
  })

  process.on("SIGINT", () => {
    runtime.stop().finally(() => process.exit(0))
  })
} catch (e) {
  process.stderr.write("BOOT-ERROR: " + (e instanceof Error ? e.stack : String(e)) + "\n")
  process.exit(1)
}
