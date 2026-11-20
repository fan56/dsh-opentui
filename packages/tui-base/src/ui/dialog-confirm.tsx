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

/** An optional extra action (ADR-0011 escalation actions: always / session).
 *  Rendered in the secondary footer and bound in the SAME modal keymap layer
 *  as confirm/cancel, so it can never reach the page's turn-abort keys. */
export type DialogConfirmExtraAction = {
  label: string
  /** Single-key binding, e.g. "a". */
  bind: string
  title?: string
  onTrigger: () => void
}

export type DialogConfirmProps = {
  title: string
  message: string
  onConfirm?: () => void
  onCancel?: () => void
  label?: {
    confirm?: string
    cancel?: string
  }
  extraActions?: readonly DialogConfirmExtraAction[]
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

  const chooseExtra = (action: DialogConfirmExtraAction) => {
    action.onTrigger()
    dialog.clear()
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      ...(newDesigns()
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
            // Tab selects in the SAME modal layer as ←/→ (dialog-export-options
            // / dialog-go-upsell parity): without this binding Tab falls through
            // to the page's base layer and moves the page focus while the
            // dialog's active button never moves — the on-device "Tab does
            // nothing" symptom. Two options, so both directions toggle.
            {
              bind: "tab",
              title: "Next dialog option",
              group: "Dialog",
              run: () => {
                setStore("active", store.active === "confirm" ? "cancel" : "confirm")
              },
            },
            {
              bind: "shift+tab",
              title: "Previous dialog option",
              group: "Dialog",
              run: () => {
                setStore("active", store.active === "confirm" ? "cancel" : "confirm")
              },
            },
          ]),
      ...(props.extraActions ?? []).map((action) => ({
        bind: action.bind,
        title: action.title ?? action.label,
        group: "Dialog",
        run: () => chooseExtra(action),
      })),
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
          // Escalation actions sit on the left so allow-once/reject keep their
          // established right-hand primary positions (and Enter/Esc bindings).
          secondary: (props.extraActions ?? []).map((action) => ({
            title: action.label.toLowerCase(),
            key: action.bind,
            onTrigger: () => chooseExtra(action),
          })),
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
        <box flexDirection="row" justifyContent="space-between" gap={1}>
          <box flexDirection="row">
            <For each={props.extraActions ?? []}>
              {(action) => (
                <box paddingLeft={1} paddingRight={1} onMouseUp={() => chooseExtra(action)}>
                  <text fg={theme.text.muted}>{`${action.label} [${action.bind}]`}</text>
                </box>
              )}
            </For>
          </box>
          <box flexDirection="row">
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
        </box>
      }
    >
      <text fg={theme.text.muted}>{props.message}</text>
    </DialogLayout>
  )
}
