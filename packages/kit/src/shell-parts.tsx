/**
 * Shell building blocks extracted from the Shell host: the transcript
 * renderer (per-item layout), a scrollback line-window over the same
 * items, the input line with inverse-video caret, and the footer
 * key-hint strip. Presentation only — state and keyboard handling stay
 * in the Shell; the spinner frame and translator arrive as props so
 * these parts render whatever the host feeds them.
 */
import { For, Show, type JSX } from "solid-js"
import { createTextAttributes } from "@opentui/core"
import type { Theme } from "./theme.ts"

export type TranscriptItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; final?: boolean }
  | { kind: "thinking"; tail: string; chars: number }
  | { kind: "tool"; name: string; args: string; ok: boolean; brief: string; imagePath?: string }
  | { kind: "error"; text: string }
  | { kind: "system"; text: string }

/** Default number of trailing transcript items kept visible. */
const MAX_VISIBLE_ITEMS = 120

/** Hint strip rendered above the status bar (dsh-tui-pi style). */
const footerHints: { key: string; label: string }[] = [
  { key: "enter", label: "send" },
  { key: "y/n", label: "approve" },
  { key: "esc", label: "abort" },
  { key: "/help", label: "commands" },
  { key: "ctrl+c", label: "quit" },
]

/** Minimal markdown-ish streaming render: headings pop, fenced code
 * blocks get a dim left rail, everything else passes through. Used for
 * assistant text that is still streaming; finalized text goes through
 * the real <markdown> intrinsic instead. */
function renderAssistant(text: string, theme: Theme): { text: string; fg?: string }[] {
  const out: { text: string; fg?: string }[] = []
  let inFence = false
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1")
    if (/^```/.test(line)) {
      inFence = !inFence
      out.push({ text: inFence ? "┌─" : "└─", fg: theme.tokens.dim })
      continue
    }
    if (inFence) {
      out.push({ text: `│ ${line}`, fg: theme.tokens.dim })
      continue
    }
    const heading = /^(#{1,3})\s+(.*)/.exec(line)
    if (heading) out.push({ text: heading[2], fg: theme.tokens.accent })
    else out.push({ text: line })
  }
  return out
}

/** Flatten transcript items to plain-text styled lines — the same
 * per-item content the JSX path renders, expressed as a line array so a
 * scrollback window can slice it. Finalized markdown cannot be split
 * into lines, so those items degrade to their stripped plain-text lines
 * (renderAssistant already strips **bold** / `code` markers); the real
 * <markdown> intrinsic is only used on the offset=0 JSX path below.
 * `mdStyle` exists for signature parity with that path and is unused
 * here by design. */
function itemsToLines(
  items: TranscriptItem[],
  theme: Theme,
  t: (k: string) => string,
  spinnerFrame: string,
  _mdStyle?: any,
): { text: string; fg?: string }[] {
  const out: { text: string; fg?: string }[] = []
  for (const it of items) {
    if (it.kind === "user") {
      out.push({ text: `❯ ${it.text}`, fg: theme.tokens.userMark ?? theme.tokens.accent })
    } else if (it.kind === "assistant") {
      // Both streaming and final text run through the stripped renderer;
      // final items additionally get the spacer line the JSX path adds.
      out.push(...renderAssistant(it.text, theme))
      if (it.final) out.push({ text: "" })
    } else if (it.kind === "thinking") {
      out.push({
        text: `${spinnerFrame} ${t("agent.thinking")} (${it.chars}) ${it.tail.slice(-120)}`,
        fg: theme.tokens.dim,
      })
    } else if (it.kind === "tool") {
      out.push({ text: ` ⚒ ${it.name} ${it.args.slice(0, 90)}`, fg: theme.tokens.toolOk ?? theme.tokens.warn })
      out.push({
        text: ` ⎿ ${it.ok ? t("agent.tool.ok") : t("agent.tool.fail")}: ${it.brief.slice(0, 110)}`,
        fg: it.ok ? theme.tokens.dim : theme.tokens.toolFail ?? theme.tokens.danger,
      })
    } else if (it.kind === "error") {
      out.push({ text: `✗ ${t("agent.error")}: ${it.text}`, fg: theme.tokens.danger })
    } else {
      out.push({ text: `· ${it.text}`, fg: theme.tokens.dim })
    }
  }
  return out
}

export function Transcript(props: {
  items: TranscriptItem[]
  theme: Theme
  t: (k: string) => string
  spinnerFrame: string
  maxItems?: number
  mdStyle?: any
}): JSX.Element {
  // Keep only the trailing window of items so long sessions stay cheap.
  const visibleItems = () => props.items.slice(-(props.maxItems ?? MAX_VISIBLE_ITEMS))

  /** One transcript item -> JSX (markdown for finalized assistant text). */
  const itemNode = (it: TranscriptItem) => {
    const th = props.theme
    if (it.kind === "user") {
      return <text style={{ fg: th.tokens.userMark ?? th.tokens.accent }}>❯ {it.text}</text>
    }
    if (it.kind === "assistant") {
      if (it.final) {
        return (
          <box style={{ flexDirection: "column" }}>
            <markdown content={it.text} streaming={false} syntaxStyle={props.mdStyle} />
            <text>{" "}</text>
          </box>
        )
      }
      return (
        <box style={{ flexDirection: "column" }}>
          <For each={renderAssistant(it.text, th)}>
            {(l) => (
              <text style={l.fg ? { fg: l.fg } : {}}>
                {`┃ ${l.text || " "}`}
              </text>
            )}
          </For>
        </box>
      )
    }
    if (it.kind === "thinking") {
      return (
        <text style={{ fg: th.tokens.dim }}>{`${props.spinnerFrame} ${props.t("agent.thinking")} (${it.chars}) ${it.tail.slice(-120)}`}</text>
      )
    }
    if (it.kind === "tool") {
      return (
        <box style={{ flexDirection: "column" }}>
          <text style={{ fg: th.tokens.toolOk ?? th.tokens.warn }}>{` ⚒ ${it.name} ${it.args.slice(0, 90)}`}</text>
          <text style={{ fg: it.ok ? th.tokens.dim : th.tokens.toolFail ?? th.tokens.danger }}>{` ⎿ ${it.ok ? props.t("agent.tool.ok") : props.t("agent.tool.fail")}: ${it.brief.slice(0, 110)}`}</text>
        </box>
      )
    }
    if (it.kind === "error") {
      return <text style={{ fg: th.tokens.danger }}>✗ {props.t("agent.error")}: {it.text}</text>
    }
    return <text style={{ fg: th.tokens.dim }}>· {it.text}</text>
  }

  return (
    <box style={{ flexDirection: "column", flexGrow: 1, padding: 1 }}>
      <For
        each={visibleItems()}
        fallback={<text style={{ fg: props.theme.tokens.dim }}>{props.t("shell.transcript.empty")}</text>}
      >
        {(it) => itemNode(it)}
      </For>
    </box>
  )
}

/** Transcript with a scrollback window bolted on. `offset` 0 means
 * bottom-anchored: renders exactly like <Transcript> (finalized markdown
 * keeps its real JSX renderer, spinner stays live). offset > 0 switches
 * to a line-level window over the items flattened to plain text — line
 * slicing is the whole point of scrollback, and rich JSX blocks cannot
 * be split that way, so in that mode every item (markdown included)
 * degrades to its stripped plain-text lines. Keyboard handling stays in
 * the Shell; this component only renders whatever offset it is given. */
export function TranscriptWindow(props: {
  items: TranscriptItem[]
  theme: Theme
  t: (k: string) => string
  spinnerFrame: string
  maxItems?: number
  mdStyle?: any
  offset?: number
  viewportRows?: number
}): JSX.Element {
  const offset = () => props.offset ?? 0

  // Bottom-anchored: delegate to the untouched JSX path, so behavior is
  // identical to Transcript when the user is not scrolled back. The branch
  // must live INSIDE the JSX: a component body runs once in Solid, so an
  // early `return` here would pin the offset-0 branch forever.
  const bottomView = () => (
    <Transcript
      items={props.items}
      theme={props.theme}
      t={props.t}
      spinnerFrame={props.spinnerFrame}
      maxItems={props.maxItems}
      mdStyle={props.mdStyle}
    />
  )

  // Scrolled back: window over the flattened plain-text lines.
  const windowLines = () => {
    const visible = props.items.slice(-(props.maxItems ?? MAX_VISIBLE_ITEMS))
    const all = itemsToLines(visible, props.theme, props.t, props.spinnerFrame, props.mdStyle)
    const rows = props.viewportRows ?? 30
    const start = Math.max(0, all.length - rows - offset())
    const end = Math.max(1, all.length - offset())
    return all.slice(start, end)
  }

  const scrolledView = () => (
    <box style={{ flexDirection: "column", flexGrow: 1, padding: 1 }}>
      <For each={windowLines()}>
        {(l) => <text style={l.fg ? { fg: l.fg } : {}}>{l.text || " "}</text>}
      </For>
      <text style={{ fg: props.theme.tokens.dim }}>{`↑ scrolled ${offset()} rows (PgDn = bottom)`}</text>
    </box>
  )

  return <Show when={offset() === 0} fallback={scrolledView()}>{bottomView()}</Show>
}

export function InputLine(props: {
  value: string
  cursor: number
  busy: boolean
  spinnerFrame: string
  placeholder: string
  busyLabel: string
  theme: Theme
}): JSX.Element {
  /** Split the input line at the cursor for caret rendering. */
  const inputChunks = () => {
    const s = props.value
    const c = Math.min(props.cursor, s.length)
    return {
      before: s.slice(0, c),
      at: c < s.length ? s.charAt(c) : " ",
      after: c < s.length ? s.slice(c + 1) : "",
    }
  }

  return (
    <box style={{ border: true, borderStyle: "rounded", borderColor: props.theme.tokens.border, flexDirection: "row" }}>
      <text style={{ fg: props.theme.tokens.accent }}>{props.busy ? `${props.spinnerFrame} ` : "❯ "}</text>
      {props.busy ? (
        <text style={{ fg: props.theme.tokens.dim }}>{props.busyLabel}</text>
      ) : props.value === "" ? (
        <>
          <text style={{ fg: props.theme.tokens.accent, attributes: createTextAttributes({ inverse: true }) }}> </text>
          <text style={{ fg: props.theme.tokens.dim }}>{props.placeholder}</text>
        </>
      ) : (
        <>
          <text style={{ fg: props.theme.tokens.text }}>{inputChunks().before}</text>
          <text style={{ fg: props.theme.tokens.text, attributes: createTextAttributes({ inverse: true }) }}>{inputChunks().at}</text>
          <text style={{ fg: props.theme.tokens.text }}>{inputChunks().after}</text>
        </>
      )}
    </box>
  )
}

export function FooterHints(props: { theme: Theme }): JSX.Element {
  return (
    <box style={{ flexDirection: "row", paddingLeft: 2, paddingRight: 2 }}>
      <For each={footerHints}>
        {(h, i) => (
          <text style={{ fg: props.theme.tokens.dim }}>
            {i() > 0 ? " · " : ""}
            {h.key} {h.label}
          </text>
        )}
      </For>
    </box>
  )
}
