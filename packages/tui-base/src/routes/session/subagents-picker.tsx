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
 * OpenTUI law: the root box carries an explicit height (1 — batch D5 made
 * the picker a single selection line; the roster itself paints once, in
 * the lastRequest dock tree), never auto-height in a flex column.
 */
import { createEffect, createMemo, createSignal, Show, onCleanup } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { clipToWidth } from "./tool-summarize"
import { createStore } from "solid-js/store"
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

  // Batch D5 (user finding: "subagent widget 好像有 2 个"): the roster is
  // painted ONCE — by the lastRequest dock's `├─` tree below the editor.
  // The picker no longer paints its own bordered multi-row roster dock; it
  // is a single selection line (the viewer entry stays: ↓ opens, ↑↓
  // select, enter steers, ctrl+a toggles inactive, esc closes).
  const dimensions = useTerminalDimensions()
  return (
    <Show when={open()}>
      <box flexShrink={0} width="100%" height={1} flexDirection="row" paddingLeft={3}>
        <text fg={theme?.text.base ?? "#e6e6e6"} wrapMode="none">
          {clipToWidth(pickerLineText(entries(), store.selected, showAll()), Math.max(16, dimensions().width - 4))}
        </text>
      </box>
    </Show>
  )
}

/** The one-line picker body (pure, testable): `Subagents ▸ <label> ·
 * Running · i/n · enter steer · ctrl+a show inactive · esc`. */
export function pickerLineText(entries: readonly SubagentMarkerView[], selected: number, showAll: boolean): string {
  const toggle = `ctrl+a show ${showAll ? "active" : "inactive"}`
  const entry = entries[selected]
  if (entry === undefined) return `Subagents ▸ no ${showAll ? "inactive" : "active"} subagents · ${toggle} · esc`
  const glyph = subagentHardStopGlyph(entry)
  const suffix = subagentMarkerSuffix(entry)
  const label = `${glyph ? `${glyph} ` : ""}${Locale.titlecase(entry.label)}`
  const status = entry.status === "running" ? " · Running" : ""
  return `Subagents ▸ ${label}${status}${suffix ? ` ${suffix.trim()}` : ""} · ${selected + 1}/${entries.length} · ↑↓ select · enter steer · ${toggle} · esc`
}
