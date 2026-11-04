/**
 * LastPromptLine — the ` ● ` last-request echo (tui-pi's activityDoc
 * shape): the user's latest submitted model prompt as ONE dim row in the
 * fixed dock below the input box, visible while the turn runs. Ports the
 * reference semantics: only MODEL prompts set it (slash commands never
 * do), a multi-line prompt echoes its FIRST line, and the row never
 * wraps — wrapMode "none" + truncate (OpenTUI elides the middle, keeps
 * head+tail on one row), the dock single-line widgets' exact technique.
 * Blank text renders zero rows via an empty For (the TodosWidget
 * zero-row technique — a falsy <Show> trips the test-render reconciler's
 * orphan-text guard). This host clears it at turn end (the user spec
 * tightens tui-pi's persistent echo to running-turns-only).
 */
import { For, type JSX } from "solid-js"
import type { Theme } from "./theme.ts"

export function LastPromptLine(props: { text: string; theme: Theme }): JSX.Element {
  const th = () => props.theme
  return (
    <For each={props.text.trim().length > 0 ? [props.text] : []}>
      {(t) => (
        <text style={{ fg: th().tokens.dim, wrapMode: "none", truncate: true }}>{`● ${t.split("\n")[0]!.trim()}`}</text>
      )}
    </For>
  )
}
