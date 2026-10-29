/**
 * Feature: /history fork-at-turn — turn-grouped picker over the live
 * session, forking at the chosen boundary via ctx.agents.create seeding
 * (see host-session.forkAtTurn). Rebuilds the transcript from the seed.
 */
import type { SelectItem, TodoItem } from "@dsh-opentui/kit"
import type { OverlayRequest } from "./model-select.tsx"

export interface HistoryForkDeps {
  session: import("../host-session.ts").HostSession
  t: (key: string, vars?: Record<string, string>) => string
  push: (it: { kind: "system" | "error"; text: string }) => void
  setItems: (items: { kind: "user" | "assistant" | "error" | "system"; text: string; final?: boolean }[]) => void
  resetDock: () => void
  onForked: () => void
}

export function createHistoryForkFeature(deps: HistoryForkDeps) {
  return {
    open(openOverlay: (req: OverlayRequest) => void) {
      const turns = deps.session.historyTurns()
      if (turns.length === 0) {
        deps.push({ kind: "system", text: "no completed turns yet" })
        return
      }
      openOverlay({
        title: deps.t("picker.history.title"),
        items: [...turns]
          .reverse()
          .map((tn): SelectItem => ({ label: `#${tn.turn} ${tn.preview.slice(0, 46) || "(no text)"}`, value: String(tn.seqEnd), description: "fork before this turn" })),
        onSelect: async (value) => {
          // fork at the picked turn boundary: the host seeds a NEW session
          // with the parent's event prefix and hands back the rebuilt rows
          try {
            const forked = await deps.session.forkAtTurn(Number(value))
            deps.setItems(
              forked.items.map((it) => (it.kind === "assistant" ? { kind: "assistant" as const, text: it.text, final: true } : { kind: "user" as const, text: it.text })),
            )
            deps.resetDock()
            deps.onForked()
            deps.push({ kind: "system", text: `⑂ forked at turn boundary — reply continues from here` })
          } catch (e) {
            deps.push({ kind: "error", text: String(e instanceof Error ? e.message : e).slice(0, 300) })
          }
        },
      })
    },
  }
}
