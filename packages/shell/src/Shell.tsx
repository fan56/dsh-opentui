/**
 * The minimal Shell: proves the architecture runs. Transcript + input line +
 * status bar fed by layer-2 surface declarations. Host seams (approval, ask,
 * attachments, live model switching) land here in M2.
 */
import { For, createSignal, onCleanup, onMount } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { StatusBar, defaultTheme, type I18n } from "@dsh-opentui/kit"
import type { SurfaceStore, SurfaceWidgetDecl } from "@dsh-opentui/runtime"

export interface ShellDeps {
  store: SurfaceStore
  t: I18n["t"]
  /** Sent when the user submits the input line. */
  onSubmit?: (text: string) => void
}

export function Shell(props: { deps: ShellDeps }) {
  const store = props.deps.store
  const [input, setInput] = createSignal("")
  const [messages, setMessages] = createSignal<string[]>([])
  const [snapshot, setSnapshot] = createSignal(store.snapshot)

  onMount(() => onCleanup(store.subscribe(() => setSnapshot(store.snapshot))))

  useKeyboard((key) => {
    if ((key.name === "c" && key.ctrl) || key.sequence === "\x03") process.exit(0)
    if (key.name === "return") {
      const text = input().trim()
      if (!text) return
      setMessages((m) => [...m, `you: ${text}`])
      props.deps.onSubmit?.(text)
      setInput("")
      return
    }
    if (key.name === "backspace") return setInput((s) => s.slice(0, -1))
    if (key.name === "escape") return setInput("")
    const ch = key.sequence
    if (ch && ch.length === 1 && !key.ctrl && !key.meta && !/[\x00-\x1f]/.test(ch)) setInput((s) => s + ch)
  })

  const widgets = () => snapshot().filter((d): d is SurfaceWidgetDecl => d.kind === "widget")

  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <box style={{ flexDirection: "column", flexGrow: 1, padding: 1 }}>
        <For each={messages()} fallback={<text style={{ fg: defaultTheme.tokens.dim }}>{props.deps.t("shell.transcript.empty")}</text>}>
          {(m) => <text>{m}</text>}
        </For>
      </box>
      <box style={{ border: true, borderColor: defaultTheme.tokens.border, flexDirection: "row" }}>
        <text style={{ fg: defaultTheme.tokens.accent }}>› </text>
        <text>{input() || props.deps.t("shell.input.placeholder")}</text>
      </box>
      <StatusBar widgets={widgets()} />
    </box>
  )
}
