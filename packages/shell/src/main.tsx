/**
 * Shell entrypoint: boots the runtime with the chat Shell root.
 * Usage: bun src/main.tsx [--model provider/model]
 */
import { bootRuntime } from "@dsh-opentui/runtime"
import { createI18n } from "@dsh-opentui/kit"
import { Shell } from "./Shell.tsx"

const i18n = createI18n("zh-CN")

const modelArg = (() => {
  const i = process.argv.indexOf("--model")
  return i > 0 ? process.argv[i + 1] : undefined
})()

try {
  const runtime = await bootRuntime({
    root: (store) => <Shell deps={{ store, t: i18n.t, modelOverride: modelArg }} />,
  })

  process.on("SIGINT", () => {
    runtime.stop().finally(() => process.exit(0))
  })
} catch (e) {
  process.stderr.write("BOOT-ERROR: " + (e instanceof Error ? e.stack : String(e)) + "\n")
  process.exit(1)
}
