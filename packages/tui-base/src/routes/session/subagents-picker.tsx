/**
 * SubagentsPicker — the seam-native SubagentsTab (batch C10a mount-gap fix).
 *
 * The vendored SubagentsTab (./composer/subagents-tab.tsx) predates the seam
 * and reads the vendored app contexts (useData/useClient/useRoute/useStorage)
 * that NEITHER rebuilt face mounts — both pages render the rebuilt
 * SessionComposer, which has no tab container, so the vendored tab (F6 marker
 * rows + G2 steer UI) was unreachable everywhere. This component paints the
 * same picker off the module stores the rebuilt faces already feed:
 *
 *   rows     ← subagentMarkerViews()  (both seam adapters fold on subscribe)
 *   steer    ← steerSubagent()        (the module bridge both adapters
 *                                      register their steerChild into)
 *   markers  ← subagentMarkerSuffix / subagentHardStopGlyph (F6 shapes)
 *
 * Open state is internal, toggled by the vendored `session.child.first`
 * keybind (down — resolved from the same keybind config the vendored app
 * uses) and closed by esc. While a dialog is open the layers gate OFF
 * (TurnCancelKeys' `dialog.stack.length === 0` gate — the DialogProvider owns
 * the keys). The steer prompt is the vendored DialogPrompt shape: Enter on a
 * RUNNING row opens it, esc cancels silently, submit echoes `steered <agent>`
 * (the e2e-asserted text, printed as a transcript row — batch D9) or prints
 * the rejection the same way.
 *
 * OpenTUI law: the root box carries an explicit height (header + capped rows
 * + hints + padding), never auto-height in a flex column.
 */
import { createEffect, createMemo, createSignal, For, Show, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { TextAttributes } from "@opentui/core"
import { Keymap } from "../../context/keymap"
import { useThemeOptional } from "../../context/theme"
import { useDialog } from "../../ui/dialog"
import { DialogPrompt } from "../../ui/dialog-prompt"
import { Locale } from "../../util/locale"
import {
  printSteerFeedback,
  subagentHardStopGlyph,
  subagentMarkerSuffix,
  subagentMarkerViews,
  steerSubagent,
  subagentSteerWired,
  type SubagentMarkerView,
} from "./subagent-markers"
import type { SessionSeam } from "../../seams/session"

export type SubagentsPickerProps = {
  /** The page's session seam. Rows ride the module store; the seam prop
   * keeps THIS component's subscription feeding the fold (both faces pass
   * the real seam, so the snapshot stays live even without SessionComposer). */
  seam: SessionSeam
}

/** Visible row cap (the vendored tab's scrollbox maxHeight). */
const ROW_CAP = 5

export function SubagentsPicker(props: SubagentsPickerProps) {
  const theme = useThemeOptional()
  const dialog = useDialog()

  const [open, setOpen] = createSignal(false)
  const [showAll, setShowAll] = createSignal(false)
  const [store, setStore] = createStore({ selected: 0 })

  // Module-store subscription (batch F6 law): subscribing keeps this face's
  // adapter folding the live snapshot; the body is a deliberate no-op.
  if (props.seam.onSubagentViews) {
    onCleanup(props.seam.onSubagentViews(() => {}))
  }

  const entries = createMemo<SubagentMarkerView[]>(() => {
    const views = subagentMarkerViews()
    return showAll() ? views : views.filter((view) => view.status === "running")
  })
  const selectedEntry = createMemo(() => entries()[store.selected])
  const visibleRows = createMemo(() => Math.min(ROW_CAP, Math.max(1, entries().length)))

  // Reopening resets the selection to the first row.
  createEffect(() => {
    if (!open()) return
    setStore("selected", 0)
  })

  function moveTo(next: number) {
    const count = entries().length
    if (count === 0) return
    setStore("selected", (next + count) % count)
  }

  // Batch G2 parity (vendored openSteer): Enter on a RUNNING row opens the
  // steer prompt; the submitted text rides the module bridge (the seam
  // adapters registered their steerChild). esc=cancel returns silently.
  // Batch D9: the outcome echoes as a transcript row through the module
  // bridge's feedback slot (the page registered its say() — the /help print
  // path); the useToast route never painted (the unpainted-toast family).
  function openSteer(entry: SubagentMarkerView) {
    const agent = Locale.titlecase(entry.label)
    dialog.replace(() => (
      <DialogPrompt
        title={`Steer ${agent}`}
        placeholder="Steer message"
        onConfirm={(value) => {
          const text = value.trim()
          if (!text) return
          const sent = steerSubagent(entry.id, text)
          dialog.clear()
          if (sent) {
            printSteerFeedback(`steered ${agent.toLowerCase()}`)
          } else {
            printSteerFeedback(`steer rejected — ${agent} is not running`)
          }
        }}
        onCancel={() => dialog.clear()}
      />
    ))
  }

  // Returns true (handled) unconditionally once the picker layer owns the
  // key: the keymap runs layers highest-priority first and only falls through
  // on a false return, so an explicit true TERMINATES the dispatch here and
  // the composer's managed-textarea submit layer (priority 0, `input.submit`
  // = return) can never also consume Enter while the picker is open.
  function select(): boolean {
    const entry = selectedEntry()
    if (!entry) return true
    if (entry.status === "running" && subagentSteerWired()) {
      openSteer(entry)
    }
    return true
  }

  // Picker-open nav layer (priority above TurnCancelKeys' esc, gated off
  // while a dialog owns the keys — the steer prompt rides the DialogProvider).
  Keymap.createLayer(() => ({
    mode: "global",
    enabled: open() && dialog.stack.length === 0,
    priority: 2,
    commands: [
      { bind: "down", title: "Next subagent", group: "Subagents", run: () => moveTo(store.selected + 1) },
      { bind: "up", title: "Previous subagent", group: "Subagents", run: () => moveTo(store.selected - 1) },
      { bind: "return", title: "Steer / select subagent", group: "Subagents", run: select },
      { bind: "ctrl+a", title: "Toggle active subagents", group: "Subagents", run: () => {
          setShowAll((value) => !value)
          setStore("selected", 0)
        } },
      { bind: "escape", title: "Close subagents picker", group: "Subagents", run: () => setOpen(false) },
    ],
  }))

  // Toggle layer (picker closed): the vendored `session.child.first` command
  // id resolves its configured binding (down) from the shared keybind config.
  Keymap.createLayer(() => ({
    mode: "global",
    enabled: !open() && dialog.stack.length === 0 && subagentMarkerViews().length > 0,
    commands: [
      {
        id: "session.child.first",
        title: "Toggle subagent picker",
        group: "Session",
        run: () => setOpen(true),
      },
    ],
  }))

  return (
    <Show when={open()}>
      <box
        flexShrink={0}
        width="100%"
        // Explicit height (OpenTUI law): header + capped rows + hints + padding.
        height={1 + visibleRows() + 1 + 2}
        flexDirection="column"
        border={["left"]}
        borderColor={theme?.border.base ?? "#7aa2f7"}
        backgroundColor={theme?.background.raised.base ?? "#1a1b26"}
        paddingLeft={1}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
      >
        <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between" paddingLeft={1}>
          <text fg={theme?.text.base ?? "#e6e6e6"} attributes={TextAttributes.BOLD}>
            Subagents
          </text>
          <text fg={theme?.text.muted ?? "#565f89"}>esc</text>
        </box>
        <Show
          when={entries().length > 0}
          fallback={
            <box height={1} flexShrink={0} paddingLeft={1}>
              <text fg={theme?.text.muted ?? "#565f89"}>
                No {showAll() ? "inactive" : "active"} subagents
              </text>
            </box>
          }
        >
          <For each={entries().slice(0, ROW_CAP)}>
            {(entry, index) => {
              const active = createMemo(() => index() === store.selected)
              return (
                <box height={1} flexShrink={0} flexDirection="row" paddingLeft={1} paddingRight={1}>
                  <text
                    fg={
                      active()
                        ? theme?.text.action.primary.focused ?? "#e6e6e6"
                        : theme?.text.action.primary.base ?? "#e6e6e6"
                    }
                    attributes={active() ? TextAttributes.BOLD : undefined}
                    wrapMode="none"
                  >
                    {subagentHardStopGlyph(entry)}
                    {subagentHardStopGlyph(entry) ? " " : ""}
                    {Locale.titlecase(entry.label)}
                  </text>
                  <Show when={entry.status === "running"}>
                    <text fg={active() ? theme?.text.action.primary.focused ?? "#e6e6e6" : theme?.text.muted ?? "#565f89"} wrapMode="none">
                      {"  Running"}
                    </text>
                  </Show>
                  <Show when={subagentMarkerSuffix(entry)}>
                    <text fg={theme?.text.muted ?? "#565f89"} wrapMode="none">
                      {subagentMarkerSuffix(entry)}
                    </text>
                  </Show>
                </box>
              )
            }}
          </For>
        </Show>
        <box height={1} flexShrink={0} flexDirection="row" gap={2} paddingLeft={1}>
          <text>
            <span style={{ fg: theme?.text.base ?? "#e6e6e6" }}>
              <b>steer</b>{" "}
            </span>
            <span style={{ fg: theme?.text.muted ?? "#565f89" }}>enter</span>
          </text>
          <text>
            <span style={{ fg: theme?.text.base ?? "#e6e6e6" }}>
              <b>{`show ${showAll() ? "inactive" : "active"}`}</b>{" "}
            </span>
            <span style={{ fg: theme?.text.muted ?? "#565f89" }}>ctrl+a</span>
          </text>
        </box>
      </box>
    </Show>
  )
}
