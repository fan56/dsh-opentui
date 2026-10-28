/**
 * Kit basic components v0: StatusBar (renders layer-2 status widgets),
 * Panel, Line (SurfaceLine renderer). Dogfooded by the Shell.
 */
import { For, type JSX } from "solid-js"
import type { SurfaceLine, SurfaceTextPart, SurfaceWidgetDecl } from "@dsh-opentui/runtime"
import { defaultTheme } from "./theme.ts"

export function renderParts(parts: SurfaceTextPart[]): JSX.Element {
  return (
    <For each={parts}>
      {(p) => (
        <span style={{ fg: p.dim ? defaultTheme.tokens.dim : p.color }}>{p.text}</span>
      )}
    </For>
  )
}

export function Line(props: { line: SurfaceLine }): JSX.Element {
  return (
    <text style={{ paddingLeft: (props.line.indent ?? 0) * 2 }}>{renderParts(props.line.parts)}</text>
  )
}

export function StatusBar(props: { widgets: SurfaceWidgetDecl[] }): JSX.Element {
  return (
    <box style={{ border: true, borderColor: defaultTheme.tokens.border, flexDirection: "row", gap: 2 }}>
      <text style={{ fg: defaultTheme.tokens.accent }}>dsh</text>
      <For each={props.widgets.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0))}>
        {(w) => <text>{renderParts(w.parts)}</text>}
      </For>
    </box>
  )
}

export function Panel(props: { title: string; body: SurfaceLine[]; onClose?: () => void }): JSX.Element {
  return (
    <box
      style={{
        border: true,
        borderColor: defaultTheme.tokens.border,
        flexDirection: "column",
        padding: 1,
        flexGrow: 1,
      }}
    >
      <text style={{ fg: defaultTheme.tokens.accent }}>{props.title}</text>
      <For each={props.body}>{(line) => <Line line={line} />}</For>
    </box>
  )
}
