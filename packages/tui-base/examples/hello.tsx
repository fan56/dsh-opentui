// Hello-world smoke for the vendored tui-base (ADR-0006 batch 1).
// Session shape inherited from opencode: box>box>scrollbox transcript with
// keyed marginTop=1 rows rendered as <markdown>, fixed 3-row bordered input
// at the bottom. Streams TOTAL rows at INTERVAL_MS, settles, quits.
// Run from packages/tui-base: bun examples/hello.tsx
import { createComponent, render, useRenderer } from "@opentui/solid"
import { SyntaxStyle } from "@opentui/core"
import { createSignal, For, onMount } from "solid-js"

const TOTAL = Number(process.env.MINI_ROWS ?? 250)
const INTERVAL_MS = Number(process.env.MINI_INTERVAL_MS ?? 60)
const SETTLE_MS = Number(process.env.MINI_SETTLE_MS ?? 8000)

const App = () => {
  const renderer = useRenderer()
  const syntaxStyle = SyntaxStyle.fromStyles({}, renderer.nativeScene)
  const [rows, setRows] = createSignal<string[]>([])
  onMount(() => {
    let n = 0
    const t = setInterval(() => {
      n += 1
      setRows((prev) => [
        ...prev,
        `${String(n).padStart(3, " ")} deterministic streaming payload row ${n} — assistant text node`,
      ])
      if (n >= TOTAL) {
        clearInterval(t)
        setTimeout(() => process.exit(0), SETTLE_MS) // settle window, then quit
      }
    }, INTERVAL_MS)
  })
  return (
    <box style={{ flexDirection: "column", flexGrow: 1, width: "100%", backgroundColor: "black" }}>
      {/* session route shape: row > flexGrow col (position relative) > scrollbox */}
      <box style={{ flexDirection: "row", flexGrow: 1, minHeight: 0 }}>
        <box style={{ flexGrow: 1, minHeight: 0, position: "relative", paddingLeft: 3 }}>
          <scrollbox
            focused
            style={{ flexGrow: 1, minHeight: 0, backgroundColor: "black" }}
            stickyScroll={true}
            stickyStart="bottom"
          >
            {/* REACTIVE-PROP LAW (batch 10e): the rows() read rides a getter.
                An eager `each={rows()}` is tracked by the root render effect
                (bun's JSX emits eager props), so every streamed row rebuilt
                the whole tree instead of just the For. */}
            {createComponent(For, {
              get each() {
                return rows()
              },
              children: (r: string, i: () => number) => (
                <box id={`session-row-${i()}`} marginTop={1} flexShrink={0}>
                  <markdown content={r} syntaxStyle={syntaxStyle} />
                </box>
              ),
              // The `as never` bridges the vendored JSX child slot (Element)
              // to createComponent's BaseRenderable — the v2-entry composition.
            }) as never}
          </scrollbox>
        </box>
      </box>
      {/* fixed bottom input area like dsh */}
      <box style={{ border: true, borderStyle: "rounded", borderColor: "yellow", width: "100%", height: 3, flexShrink: 0 }}>
        <text fg="green">{"❯ input placeholder (fixed bottom box)"}</text>
      </box>
    </box>
  )
}

render(() => <App />)
