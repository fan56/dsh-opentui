/**
 * Shell building blocks extracted from the Shell host: the transcript
 * renderer (per-item layout), a scrollback line-window over the same
 * items, the multi-line input editor (an OpenTUI <textarea> in a
 * rounded box), and the footer key-hint strip. Presentation only —
 * session state stays in the Shell; the spinner frame and translator
 * arrive as props so these parts render whatever the host feeds them.
 */
import { createEffect, For, on, Show, type JSX } from "solid-js"
import { defaultTextareaKeyBindings, type KeyEvent, type TextareaRenderable } from "@opentui/core"
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

  return (
    <box style={{ flexDirection: "column", flexGrow: 1, padding: 1 }}>
      <For
        each={visibleItems()}
        fallback={<text style={{ fg: props.theme.tokens.dim }}>{props.t("shell.transcript.empty")}</text>}
      >
        {(it) => itemNode(it, props.theme, props.t, props.mdStyle)}
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
  /** One transcript item -> JSX (markdown for finalized assistant text). */
  const itemNode = (it: TranscriptItem, theme: Theme, t: (k: string) => string, mdStyle?: any, spinnerFrame = "") => {
    const th = theme
    if (it.kind === "user") {
      return <text style={{ fg: th.tokens.userMark ?? th.tokens.accent }}>❯ {it.text}</text>
    }
    if (it.kind === "assistant") {
      if (it.final) {
        return (
          <box style={{ flexDirection: "column" }}>
            <markdown content={it.text} streaming={false} syntaxStyle={mdStyle} />
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
        <text style={{ fg: th.tokens.dim }}>{`${spinnerFrame} ${t("agent.thinking")} (${it.chars}) ${it.tail.slice(-120)}`}</text>
      )
    }
    if (it.kind === "tool") {
      return (
        <box style={{ flexDirection: "column" }}>
          <text style={{ fg: th.tokens.toolOk ?? th.tokens.warn }}>{` ⚒ ${it.name} ${it.args.slice(0, 90)}`}</text>
          <text style={{ fg: it.ok ? th.tokens.dim : th.tokens.toolFail ?? th.tokens.danger }}>{` ⎿ ${it.ok ? t("agent.tool.ok") : t("agent.tool.fail")}: ${it.brief.slice(0, 110)}`}</text>
        </box>
      )
    }
    if (it.kind === "error") {
      return <text style={{ fg: th.tokens.danger }}>✗ {t("agent.error")}: {it.text}</text>
    }
    return <text style={{ fg: th.tokens.dim }}>· {it.text}</text>
  }

export function TranscriptWindow(props: {
  items: TranscriptItem[]
  theme: Theme
  t: (k: string) => string
  spinnerFrame: string
  maxItems?: number
  mdStyle?: any
  /** Rows scrolled up from the bottom (0 = pinned to the newest line). */
  offset?: number
  /** Explicit top-anchored start line — when set, the window stays put
   * while content grows (offset alone re-anchors to the moving end). */
  startIndex?: number
  viewportRows?: number
  /** Reports the flattened line count + the window size (key boundary math). */
  onLayout?: (totalLines: number, viewportRows: number) => void
}): JSX.Element {
  const offset = () => props.offset ?? 0

  // The flattened line window — bottom-anchored when following (offset 0
  // slices the NEWEST rows), top-anchored while the user is scrolled back
  // (startIndex stays put while content grows).
  const windowLines = () => {
    const visible = props.items.slice(-(props.maxItems ?? MAX_VISIBLE_ITEMS))
    const all = itemsToLines(visible, props.theme, props.t, props.spinnerFrame, props.mdStyle)
    const vrows = props.viewportRows ?? 30
    props.onLayout?.(all.length, vrows)
    if (props.startIndex !== undefined) {
      const start = Math.max(0, Math.min(props.startIndex, Math.max(0, all.length - vrows)))
      return all.slice(start, start + vrows)
    }
    const start = Math.max(0, all.length - vrows - offset())
    const end = Math.max(1, all.length - offset())
    return all.slice(start, end)
  }

  // Both modes render the flattened line window — bottom-anchored when
  // following (offset 0 slices the NEWEST rows), top-anchored while the
  // user is scrolled back. The full-JSX path (per-item markdown) is not
  // windowable and used to overflow the box from the top, which read as
  // "stuck at the oldest lines".
  // FOLLOWING mode (no startIndex, offset 0): the RICH per-item
  // transcript — real <markdown> tables/bullets, spacers between items —
  // inside the flex-end container. Overflow grows upward and the oldest
  // rows clip at the box top: newest content hugs the dock, which is the
  // chat-correct anchor. The plain-text line window serves ONLY the
  // scrolled-back mode.
  if (props.startIndex === undefined && (props.offset ?? 0) === 0) {
    return (
      <box style={{ flexDirection: "column", flexGrow: 1, justifyContent: "flex-end", padding: 1 }}>
        <For each={props.items.slice(-(props.maxItems ?? MAX_VISIBLE_ITEMS))}>
          {(it) => (
            <box style={{ flexDirection: "column" }}>
              {itemNode(it, props.theme, props.t, props.mdStyle, props.spinnerFrame)}
              <text>{" "}</text>
            </box>
          )}
        </For>
      </box>
    )
  }
  return (
    <box style={{ flexDirection: "column", flexGrow: 1, justifyContent: "flex-end", padding: 1 }}>
      {/* reactive call — a component body runs once in Solid, so the window
          must be derived inside the JSX expression, never in a body const.
          justifyContent flex-end anchors short content to the BOTTOM — the
          newest line hugs the dock instead of hanging at the top-left */}
      <For each={windowLines()}>
        {(l) => <text style={l.fg ? { fg: l.fg } : {}}>{l.text || " "}</text>}
      </For>
      <Show when={(props.offset ?? 0) > 0 || props.startIndex !== undefined}>
        <text style={{ fg: props.theme.tokens.dim }}>{`↑ scrolled (PgDn = follow latest)`}</text>
      </Show>
    </box>
  )
}

export interface InputLineProps {
  theme: Theme
  placeholder: string
  /** Visual "steering" mode: the textarea is blurred and a dim busy row is shown. */
  busy: boolean
  busyLabel: string
  /** Legacy spinner glyph, still shown next to busyLabel when busy. */
  spinnerFrame?: string
  /** Focus the editor (default true); blurred while busy regardless. */
  focused?: boolean
  /** Editor content rows. Single row when unset — the Shell passes a
   * content-derived value so the box grows only when the text wraps. */
  height?: number
  /** Enter pressed with content in the buffer. */
  onSubmit?: () => void
  /** Fires after every content mutation (typing, paste, newline, clear). */
  onContentChange?: (value: string) => void
  /** Up/down pressed while the cursor sits on the first/last visual line.
   * Return true when the key is consumed (history recall) — the editor
   * then suppresses its default cursor movement for that key. */
  onHistoryNav?: (dir: "up" | "down") => boolean
  /** First say on every unmodified key: return true to consume it (the
   * slash palette uses this for up/down/tab/enter while the menu is
   * open). Runs before the history routing below. */
  onKeyFilter?: (key: { name: string }) => boolean
  /** When this number changes, the buffer is fully reset (undo history
   * included) — bump it for /clear. */
  resetKey?: number
  /** When setKey changes, the buffer is replaced with setValue (undoable,
   * cursor at end) — the history-recall write path. */
  setKey?: number
  setValue?: string
  /** When this changes, focus() is re-asserted imperatively — the prop
   * flip alone does not reclaim the terminal focus singleton after a
   * focused overlay (select) unmounted holding it. */
  focusKey?: number
  /** Legacy single-line props, kept so old call sites compile. Ignored. */
  value?: string
  cursor?: number
}

/** Key bindings on top of defaultTextareaKeyBindings: plain Enter submits,
 * Shift+Enter / Alt(Option)+Enter insert a newline. mergeKeyBindings keys
 * entries on name + modifier flags, so these entries override the defaults
 * ("return" -> newline, "return"+meta -> submit). Behavior verified against
 * @opentui/solid's <textarea> with a headless testRender probe. */
const INPUT_KEY_BINDINGS = [
  ...defaultTextareaKeyBindings,
  { name: "return", action: "submit" as const },
  { name: "kpenter", action: "submit" as const },
  { name: "return", shift: true, action: "newline" as const },
  { name: "kpenter", shift: true, action: "newline" as const },
  { name: "return", meta: true, action: "newline" as const },
  { name: "kpenter", meta: true, action: "newline" as const },
]

export function InputLine(props: InputLineProps): JSX.Element {
  let ta: TextareaRenderable | undefined

  // resetKey change -> full buffer reset (clears undo history too).
  createEffect(
    on(
      () => props.resetKey,
      () => {
        ta?.setText("")
      },
      { defer: true },
    ),
  )

  // setKey change -> replace buffer content undoably, cursor at the end.
  createEffect(
    on(
      () => props.setKey,
      () => {
        if (!ta) return
        ta.replaceText(props.setValue ?? "")
        ta.gotoBufferEnd()
      },
      { defer: true },
    ),
  )

  // focusKey change -> reclaim focus imperatively (overlay teardown guard).
  createEffect(
    on(
      () => props.focusKey,
      () => {
        if (!props.busy) ta?.focus()
      },
      { defer: true },
    ),
  )

  const onKeyDown = (key: KeyEvent) => {
    // host-level key consumption (slash palette) beats editor actions
    if (props.onKeyFilter?.(key)) {
      key.preventDefault()
      return
    }
    if (!ta || key.shift || key.ctrl || key.meta) return
    const row = ta.visualCursor.visualRow
    if (key.name === "up" && row === 0) {
      if (props.onHistoryNav?.("up")) key.preventDefault()
    } else if (key.name === "down" && row >= Math.max(0, ta.virtualLineCount - 1)) {
      if (props.onHistoryNav?.("down")) key.preventDefault()
    }
  }

  return (
    <box style={{ border: true, borderStyle: "rounded", borderColor: props.theme.tokens.border, flexDirection: "column" }}>
      <box style={{ flexDirection: "row" }}>
        <text style={{ fg: props.theme.tokens.accent }}>{"❯ "}</text>
        <textarea
          ref={(el: TextareaRenderable) => (ta = el)}
          focused={!props.busy && (props.focused ?? true)}
          placeholder={props.placeholder}
          keyBindings={INPUT_KEY_BINDINGS}
          textColor={props.theme.tokens.text}
          focusedTextColor={props.theme.tokens.text}
          placeholderColor={props.theme.tokens.dim}
          style={{ flexGrow: 1, height: props.height ?? 1, wrapMode: "char" }}
          onContentChange={() => props.onContentChange?.(ta?.plainText ?? "")}
          onSubmit={() => props.onSubmit?.()}
          onKeyDown={onKeyDown}
        />
      </box>
      <Show when={props.busy}>
        <text style={{ fg: props.theme.tokens.dim }}>{`${props.spinnerFrame ? `${props.spinnerFrame} ` : ""}${props.busyLabel}`}</text>
      </Show>
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
