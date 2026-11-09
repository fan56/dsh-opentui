import { TextAttributes } from "@opentui/core"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useNewDesigns } from "../config"
import { DialogHeader, DialogLayout, useDialog } from "./dialog"
import { createStore } from "solid-js/store"
import { For } from "solid-js"
import { Locale } from "../util/locale"
import { currentRowColors } from "../skin/semantic"
import { ReminderBadge } from "../routes/session/turn-overlays"

export type DialogConfirmProps = {
  title: string
  message: string
  onConfirm?: () => void
  onCancel?: () => void
  label?: {
    confirm?: string
    cancel?: string
  }
}

export function DialogConfirm(props: DialogConfirmProps) {
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const newDesigns = useNewDesigns()
  // Active-button highlight = the skin's current-row semantics (one source,
  // skin/semantic.ts). The confirm card itself is warning-tier via the
  // stack's DialogTone (set by the caller's dialog.replace options).
  const row = () => currentRowColors(theme)
  const [store, setStore] = createStore({
    active: "confirm" as "confirm" | "cancel",
  })

  const choose = (key: "confirm" | "cancel") => {
    if (key === "confirm") props.onConfirm?.()
    if (key === "cancel") props.onCancel?.()
    dialog.clear()
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: newDesigns()
      ? [
          { bind: "return", title: "Confirm", group: "Dialog", run: () => choose("confirm") },
          { bind: "escape", title: "Cancel", group: "Dialog", run: () => choose("cancel") },
        ]
      : [
          {
            bind: "return",
            title: "Confirm dialog selection",
            group: "Dialog",
            run: () => choose(store.active),
          },
          {
            bind: "left",
            title: "Previous dialog option",
            group: "Dialog",
            run: () => {
              setStore("active", store.active === "confirm" ? "cancel" : "confirm")
            },
          },
          {
            bind: "right",
            title: "Next dialog option",
            group: "Dialog",
            run: () => {
              setStore("active", store.active === "confirm" ? "cancel" : "confirm")
            },
          },
        ],
  }))
  return (
    <DialogLayout
      // Reminder marker (skin contract §1 提醒脉冲): the `⚠` badge pulses
      // 3 bright/dim cycles on the shared motion clock; the plain title
      // text stays static in the header's warning tier. Lazy reference —
      // turn-overlays imports this file for the approval card (ESM cycle,
      // render-time use only).
      header={
        <DialogHeader
          title={props.title}
          titleView={
            <box flexDirection="row">
              <ReminderBadge />
              <text
                attributes={newDesigns() ? undefined : TextAttributes.BOLD}
                fg={theme.text.base}
                wrapMode="none"
              >
                {props.title.replace(/^⚠\s*/, "")}
              </text>
            </box>
          }
        />
      }
      footer={{
        actions: {
          primary: [
            // Footer labels are lowercase; the legacy buttons title-case the same labels.
            { title: (props.label?.cancel ?? "cancel").toLowerCase(), key: "esc", onTrigger: () => choose("cancel") },
            {
              title: (props.label?.confirm ?? "confirm").toLowerCase(),
              key: "enter",
              onTrigger: () => choose("confirm"),
            },
          ],
        },
      }}
      legacyFooter={
        <box flexDirection="row" justifyContent="flex-end">
          <For each={["cancel", "confirm"] as const}>
            {(key) => (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={key === store.active ? row().backgroundColor : undefined}
                onMouseUp={() => choose(key)}
              >
                <text fg={key === store.active ? row().textColor : theme.text.muted}>
                  {Locale.titlecase(props.label?.[key] ?? key)}
                </text>
              </box>
            )}
          </For>
        </box>
      }
    >
      <text fg={theme.text.muted}>{props.message}</text>
    </DialogLayout>
  )
}
