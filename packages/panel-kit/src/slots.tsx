/**
 * slots.tsx — the three structural panel slots (spec §3.4): PanelTitle,
 * PanelBody, PanelActions.
 *
 * They are deliberately lightweight: no state, no timers, no layout writes.
 * Every color/attribute comes from the injected PanelTheme, so the shell's
 * whole-subtree fade applies unchanged (T17-INT2). PanelTitle paints the
 * optional static identity gradient by interpolating theme.identity endpoints
 * per grapheme — the same fadeColor projection the shell uses, and still one
 * static paint (no animation).
 *
 * v1.1 (/settings + /agents migration).
 */
import type { RGBA } from "@opentui/core"
import { For, Show, type JSX } from "solid-js"
import type {
  PanelAction,
  PanelActionsProps,
  PanelBodyProps,
  PanelTitleProps,
} from "./contracts"
import { Button } from "./controls/button"
import { fadeColor, usePanelTheme } from "./theme"
import { graphemes } from "./text"

/** One painted gradient run: a grapheme cluster and its interpolated color. */
export interface TitleStop {
  readonly text: string
  readonly color: RGBA
}

/**
 * Static identity gradient projection (spec §4.6): endpoints exact, one
 * grapheme cluster per stop. Empty text yields no stops; a single cluster
 * takes the start color (no division by zero).
 */
export function titleGradientStops(
  text: string,
  gradient: readonly [RGBA, RGBA],
): TitleStop[] {
  const parts = graphemes(text)
  if (parts.length === 0) return []
  if (parts.length === 1) return [{ text: parts[0]!, color: gradient[0] }]
  return parts.map((part, index) => ({
    text: part,
    color: fadeColor(gradient[0], gradient[1], index / (parts.length - 1)),
  }))
}

/**
 * Title slot: the heading on the left, a right hint slot on the right
 * (`right` element when supplied, otherwise `closeHint`, default "esc"), and
 * the optional subtitle on its own muted line.
 */
export function PanelTitle(props: PanelTitleProps): JSX.Element {
  const theme = usePanelTheme()
  const hint = () => (props.closeHint === false ? undefined : props.closeHint ?? "esc")
  const stops = () => (props.gradient ? titleGradientStops(props.title, props.gradient) : undefined)

  return (
    <box flexDirection="column" flexShrink={0}>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <Show
          when={stops()}
          fallback={
            <text fg={theme().text.base} attributes={theme().attributes.title}>
              {props.title}
            </text>
          }
        >
          <box flexDirection="row">
            <For each={stops()}>
              {(stop) => (
                <text fg={stop.color} attributes={theme().attributes.title}>
                  {stop.text}
                </text>
              )}
            </For>
          </box>
        </Show>
        <Show when={props.right !== undefined} fallback={
          <Show when={hint()}>
            <text fg={theme().text.muted} attributes={theme().attributes.keyHint}>
              {hint()}
            </text>
          </Show>
        }>
          {props.right}
        </Show>
      </box>
      <Show when={props.subtitle !== undefined}>
        <text
          fg={theme().text.muted}
          attributes={theme().attributes.subtitle}
          wrapMode="none"
        >
          {props.subtitle}
        </text>
      </Show>
    </box>
  )
}

/**
 * Body slot: a vertical flex column with the dialog inset. `maxRows` caps the
 * painted rows (the host still owns the frame); scrolling stays deferred in
 * v1.1 — `scroll` is accepted but not implemented, lists paginate instead.
 */
export function PanelBody(props: PanelBodyProps): JSX.Element {
  const inset = () => props.inset ?? 3
  return (
    <box
      flexDirection="column"
      flexGrow={1}
      flexShrink={1}
      paddingLeft={inset()}
      paddingRight={inset()}
      maxHeight={props.maxRows}
    >
      {props.children}
    </box>
  )
}

function actionHint(action: PanelAction): string {
  return action.keyHint === undefined ? action.label : `${action.keyHint} ${action.label}`
}

/**
 * Actions slot: the bottom hint band. Secondary actions paint as muted key
 * hints on the left, primary actions as right-aligned buttons (the Button
 * variant/disabled semantics apply), and `hint` is a faint right-aligned line
 * underneath.
 */
export function PanelActions(props: PanelActionsProps): JSX.Element {
  const theme = usePanelTheme()
  const secondary = () => props.secondary ?? []
  const primary = () => props.primary ?? []
  const hasRow = () => secondary().length > 0 || primary().length > 0

  return (
    <box flexDirection="column" flexShrink={0}>
      <Show when={hasRow()}>
        <box flexDirection="row" justifyContent="space-between" gap={2} flexShrink={0}>
          <text fg={theme().text.muted} attributes={theme().attributes.keyHint} wrapMode="none">
            {secondary().map(actionHint).join(" · ")}
          </text>
          <box flexDirection="row" justifyContent="flex-end" gap={2}>
            <For each={primary()}>
              {(action) => (
                <Button
                  label={action.label}
                  keyHint={action.keyHint}
                  variant={action.variant}
                  disabled={action.disabled}
                  onPress={action.onPress}
                />
              )}
            </For>
          </box>
        </box>
      </Show>
      <Show when={props.hint !== undefined}>
        <box flexDirection="row" justifyContent="flex-end">
          <text fg={theme().text.system} attributes={theme().attributes.keyHint} wrapMode="none">
            {props.hint}
          </text>
        </box>
      </Show>
    </box>
  )
}
